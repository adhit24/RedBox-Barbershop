'use strict';

/**
 * Reddy Context Recovery — Correction Round 1 (Aira actual-source review).
 *
 * Direct EXECUTION-level tests (real handleMessage from api/wa/webhook.js),
 * not just orchestrator-envelope tests. The blocker this covers: the
 * clarify_short renderer in webhook.js used to be STRATEGY-wide rather than
 * ACTION-specific, so any generic "unknown" -> clarify_short turn (including
 * the new context_recovery_reason === 'ambiguous_unrelated_message' case)
 * rendered the membership account-vs-paid-plan clarification even when the
 * current turn had nothing to do with membership.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { orchestrateMessage } = require('../orchestrator/orchestratorService');
const { handleMessage } = require('../../api/wa/webhook');

const MEMBERSHIP_WORDING = /\b(member|membership|paket|berbayar)\b/i;

function classifier(intent, route = 'reddy_agent', action = 'answer_general_question') {
  return async () => ({
    intent,
    route,
    agent: route === 'human' ? undefined : route,
    action,
    confidence: 0.6,
    model_tier: 'economy',
  });
}

function throwingClassifier() {
  return async () => { throw new Error('classifier_unavailable'); };
}

const priorMembershipHistory = [{
  role: 'assistant',
  content: 'Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya?',
  timestamp: Date.now(),
}];

function baseMocks(overrides = {}) {
  return {
    loadConversationHistory: async () => ({ status: 'empty', history: [] }),
    executeReddy: async () => ({ used: 'reddy_agent', reply: 'should not be used' }),
    executeIntelligence: async () => {},
    send: async () => ({ status: 'sent' }),
    persistConversation: async () => {},
    logTelemetry: () => {},
    ...overrides,
  };
}

// 1. prior membership context + unrelated private text + classifier -> unknown
//    => final outbound reply carries NO membership wording.
test('X1. prior membership context + unrelated text classified unknown => neutral outbound, no membership wording', async () => {
  const runtime = await handleMessage({
    from: '62811120001', text: 'Eh btw temenku lagi butuh bantuan nih, gimana ya', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: priorMembershipHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  assert.equal(runtime.reply, 'Maksud Kak yang bagian mana?');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 2. no prior context + unrelated/unknown text => generic neutral clarification, no membership wording
test('X2. no prior context + unknown text => generic neutral clarification, no membership wording', async () => {
  const runtime = await handleMessage({
    from: '62811120002', text: 'Random gak jelas nih maksudnya apa', branchFromPayload: 'bypass',
  }, baseMocks({
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  assert.equal(runtime.reply, 'Maksud Kak yang bagian mana?');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 3. prior membership context + current ambiguous unknown => context_recovery_reason =
//    ambiguous_unrelated_message => outbound reply is neutral.
test('X3. ambiguous_unrelated_message context-recovery reason still renders a neutral outbound reply', async () => {
  let capturedTelemetry = null;
  const runtime = await handleMessage({
    from: '62811120003', text: 'Hmm gimana ya enaknya', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: priorMembershipHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
    logTelemetry: (event) => { capturedTelemetry = event; },
  }));

  assert.equal(capturedTelemetry.context_recovery_reason, 'ambiguous_unrelated_message');
  assert.equal(capturedTelemetry.context_recovery_triggered, true);
  assert.equal(runtime.reply, 'Maksud Kak yang bagian mana?');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 4. "Membership aku aktif?" => clarify_membership_scope remains correct.
test('X4. genuine ambiguous "Membership aku aktif?" still gets the account-vs-paid clarification', async () => {
  const runtime = await handleMessage({
    from: '62811120004', text: 'Membership aku aktif?', branchFromPayload: 'bypass',
  }, baseMocks({
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  assert.equal(runtime.reply, 'Maksud Kak, status akun member Redbox atau status paket membership berbayar?');
});

// 5. genuine ambiguous membership TIME question => clarify_membership_time_scope remains correct.
test('X5. genuine "member aktif kapan?" still gets the membership time-scope clarification', async () => {
  const runtime = await handleMessage({
    from: '62811120005', text: 'member aktif kapan?', branchFromPayload: 'bypass',
  }, baseMocks({
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  assert.equal(
    runtime.reply,
    'Maksud Kak, sejak kapan terdaftar sebagai member Redbox, atau sejak kapan paket membership-nya aktif?',
  );
});

// 6. generic orchestrator error/fallback_unknown leading to clarify_short => neutral, not membership.
test('X6. orchestrator classifier failure -> fallback_unknown -> clarify_short renders neutral, not membership', async () => {
  const runtime = await handleMessage({
    from: '62811120006', text: 'asdkjaslkdj random text', branchFromPayload: 'bypass',
  }, baseMocks({
    orchestrate: (params) => orchestrateMessage(params, { classifier: throwingClassifier() }),
  }));

  assert.equal(runtime.reply, 'Maksud Kak yang bagian mana?');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 7. "Aman kak" => "Siap Kak." => no membership wording.
test('X7. "Aman kak" after prior membership context renders the plain acknowledgement', async () => {
  const runtime = await handleMessage({
    from: '62811120007', text: 'Aman kak', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: priorMembershipHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('general_question') }),
  }));

  assert.equal(runtime.reply, 'Siap Kak.');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 8. "Bukan itu maksud saya" => deterministic context-correction response, no membership wording.
test('X8. "Bukan itu maksud saya" renders the deterministic context-correction reply', async () => {
  const runtime = await handleMessage({
    from: '62811120008', text: 'Bukan itu maksud saya', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: priorMembershipHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  assert.equal(runtime.reply, 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?');
  assert.doesNotMatch(runtime.reply, MEMBERSHIP_WORDING);
});

// 9. "Bukan booking, maksud saya harga grooming" => current price intent wins, no neutral hijack.
test('X9. current-turn price intent is not hijacked by the neutral context-correction reply', async () => {
  let agentCalls = 0;
  let capturedTelemetry = null;
  const runtime = await handleMessage({
    from: '62811120009', text: 'Bukan booking, maksud saya harga grooming', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({
      status: 'available',
      history: [{ role: 'user', content: 'Aku mau booking besok jam 3 kalau bisa Kak.', timestamp: Date.now() }],
    }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
    executeReddy: async () => { agentCalls++; return { used: 'reddy_agent', reply: 'Gentleman Grooming Rp120.000.' }; },
    logTelemetry: (event) => { capturedTelemetry = event; },
  }));

  assert.equal(capturedTelemetry.response_strategy, 'answer_with_knowledge_fact');
  assert.equal(agentCalls, 1);
  assert.notEqual(runtime.reply, 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?');
});

// 10. human handoff remains unaffected by context-recovery changes.
test('X10. human handoff route is untouched by context-recovery rendering', async () => {
  let createCalls = 0;
  const runtime = await handleMessage({
    from: '62811120010', text: 'Bukan itu, aku mau bicara sama admin manusia', branchFromPayload: 'bypass',
  }, baseMocks({
    orchestrate: async () => ({
      route: 'human', intent: 'human_request', action: 'request_human', fallback_used: false,
    }),
    getHandoffState: async () => ({ status: 'none', case: null }),
    createHandoffCase: async () => { createCalls++; return { status: 'created', case: {}, created: true }; },
  }));

  assert.equal(createCalls, 1);
  assert.notEqual(runtime.reply, 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?');
  assert.doesNotMatch(runtime.reply || '', MEMBERSHIP_WORDING);
});

// Secondary review item — multilingual parity check (not a fix, a verification):
// the pre-existing "strict low-risk deterministic" block in webhook.js
// (acknowledge_only / close_conversation / clarify_short) has ALWAYS rendered
// hard-coded Indonesian regardless of conversationContext.response_language —
// this is a pre-existing architectural gap, not something introduced by
// context recovery. This test proves the new
// acknowledge_correction_or_clarify_neutral strategy has IDENTICAL behavior
// to its existing sibling strategies under a non-Indonesian resolved
// response_language: no new regression, same known limitation.
test('X11 (multilingual parity). acknowledge_correction_or_clarify_neutral matches sibling deterministic strategies under non-Indonesian response_language', async () => {
  const englishHistory = [{ role: 'user', content: 'What is the price for a haircut?', timestamp: Date.now() }];

  const ackRuntime = await handleMessage({
    from: '62811120011', text: 'Ok', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: englishHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('general_question') }),
  }));
  const correctionRuntime = await handleMessage({
    from: '62811120012', text: 'Bukan itu maksud saya', branchFromPayload: 'bypass',
  }, baseMocks({
    loadConversationHistory: async () => ({ status: 'available', history: englishHistory }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier('unknown') }),
  }));

  // Both are the existing, pre-existing-limitation Indonesian deterministic
  // strings — parity proven, no new language regression introduced here.
  assert.equal(ackRuntime.reply, 'Siap Kak.');
  assert.equal(correctionRuntime.reply, 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?');
});
