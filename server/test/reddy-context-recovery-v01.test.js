'use strict';

/**
 * Reddy Context Recovery — Neutral Fallback + Explicit Correction Authority.
 *
 * Regression coverage for the audited incident: Reddy repeated a stale
 * membership clarification ("akun member Redbox-nya atau paket membership
 * berbayarnya?") after the customer had moved on or explicitly said Reddy
 * misread them. See server/agents/reddy/contextRecovery.js and the
 * context_correction fallback in server/orchestrator/orchestratorService.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDecisionEnvelope } = require('../orchestrator/orchestratorService');
const { sanitizeTelemetry } = require('../orchestrator/telemetry');
const {
  detectExplicitContextCorrection,
  detectNeutralAcknowledgement,
} = require('../agents/reddy/contextRecovery');
const { handleMessage } = require('../../api/wa/webhook');

const baseDecision = {
  intent: 'unknown',
  route: 'reddy_agent',
  action: 'fallback_unknown',
  confidence: 0.5,
  model_tier: 'none',
};

const priorMembershipContext = {
  history_status: 'available',
  sessionStatus: 'active_conversation',
  turns: [{
    role: 'assistant',
    content: 'Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya?',
  }],
};

const priorBookingContext = {
  history_status: 'available',
  sessionStatus: 'active_conversation',
  turns: [{ role: 'user', content: 'Aku mau booking besok jam 3 kalau bisa Kak.' }],
};

const priorBarberContext = {
  history_status: 'available',
  sessionStatus: 'active_conversation',
  turns: [{ role: 'assistant', content: 'Mau pilih kapster siapa, Kak?' }],
};

// 1. prior membership context + "Aman kak" => NO membership clarification
test('CR1. "Aman kak" after prior membership context never re-triggers membership clarification', () => {
  const decision = buildDecisionEnvelope({
    message: 'Aman kak',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.notEqual(decision.action, 'clarify_membership_scope');
  assert.notEqual(decision.action, 'clarify_membership_time_scope');
  assert.notEqual(decision.response_strategy, 'clarify_short');
  assert.equal(decision.conversational_act, 'social_acknowledgement');
  assert.equal(decision.response_strategy, 'acknowledge_only');
});

// 2. prior membership context + "Bukan itu maksud saya" => NO membership clarification
test('CR2. "Bukan itu maksud saya" after prior membership context never re-triggers membership clarification', () => {
  const decision = buildDecisionEnvelope({
    message: 'Bukan itu maksud saya',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.notEqual(decision.action, 'clarify_membership_scope');
  assert.notEqual(decision.action, 'clarify_membership_time_scope');
  assert.equal(decision.conversational_act, 'context_correction');
  assert.equal(decision.continuation_type, 'none');
  assert.equal(decision.context_reference, null);
  assert.equal(decision.response_strategy, 'acknowledge_correction_or_clarify_neutral');
  assert.equal(decision.context_recovery_triggered, true);
  assert.equal(decision.context_recovery_reason, 'explicit_user_correction');
});

// 3. prior membership context + "Itu balasan untuk pesan lain" => neutral recovery
test('CR3. "Itu balasan untuk pesan lain" resolves to neutral context recovery', () => {
  const decision = buildDecisionEnvelope({
    message: 'Itu balasan untuk pesan lain',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.equal(decision.conversational_act, 'context_correction');
  assert.equal(decision.response_strategy, 'acknowledge_correction_or_clarify_neutral');
  assert.notEqual(decision.action, 'clarify_membership_scope');
});

// 4. prior membership context + "Nggak bahas membership" => stale membership reset
test('CR4. "Nggak bahas membership" resets stale membership intent instead of re-clarifying', () => {
  const decision = buildDecisionEnvelope({
    message: 'Nggak bahas membership',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.notEqual(decision.action, 'clarify_membership_scope');
  assert.notEqual(decision.response_strategy, 'answer_with_crm_fact');
  assert.equal(decision.conversational_act, 'context_correction');
  assert.equal(decision.continuation_type, 'none');
});

// 5. prior membership context + "Enggak, maksud saya akun member saya" => membership
//    MAY be processed because the CURRENT turn explicitly reintroduces it.
test('CR5. explicit correction that reintroduces membership still resolves the membership question', () => {
  const decision = buildDecisionEnvelope({
    message: 'Enggak, maksud saya akun member saya',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
  assert.notEqual(decision.conversational_act, 'context_correction');
  // Stale context is still invalidated for telemetry even though a
  // reintroduced topic won this turn.
  assert.equal(decision.context_recovery_triggered, true);
  assert.equal(decision.context_recovery_reason, 'explicit_user_correction');
});

// 6. "Membership aku aktif?" => membership ambiguity clarification still allowed
test('CR6. standalone ambiguous "Membership aku aktif?" still gets the scope clarification', () => {
  const decision = buildDecisionEnvelope({ message: 'Membership aku aktif?', decision: baseDecision });

  assert.equal(decision.clarification_required, true);
  assert.equal(decision.action, 'clarify_membership_scope');
  assert.equal(decision.response_strategy, 'clarify_short');
});

// 7. "akun member saya aktif?" => account scope, no repeated account-vs-paid question
test('CR7. "akun member saya aktif?" resolves account scope without re-asking', () => {
  const decision = buildDecisionEnvelope({ message: 'akun member saya aktif?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.context_reference, 'explicit_member_account_scope');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

// 8. "paket membership saya aktif?" => paid-plan scope, no repeated question
test('CR8. "paket membership saya aktif?" resolves paid-plan scope without re-asking', () => {
  const decision = buildDecisionEnvelope({ message: 'paket membership saya aktif?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

// 9. prior booking context + "Bukan booking, maksud saya harga grooming" => price wins
test('CR9. current-turn price intent wins over stale booking continuation', () => {
  const decision = buildDecisionEnvelope({
    message: 'Bukan booking, maksud saya harga grooming',
    conversationContext: priorBookingContext,
    decision: baseDecision,
  });

  assert.equal(decision.intent, 'price_inquiry');
  assert.equal(decision.conversational_act, 'business_fact_question');
  assert.equal(decision.response_strategy, 'answer_with_knowledge_fact');
  assert.notEqual(decision.continuation_type, 'contextual');
});

// 10. prior barber context + "Itu bukan yang saya tanyakan" => no stale barber continuation
test('CR10. explicit correction blocks stale barber-choice continuation', () => {
  const decision = buildDecisionEnvelope({
    message: 'Itu bukan yang saya tanyakan',
    conversationContext: priorBarberContext,
    decision: baseDecision,
  });

  assert.notEqual(decision.conversational_act, 'barber_choice_followup');
  assert.notEqual(decision.context_reference, 'prior_barber_choice');
  assert.equal(decision.continuation_type, 'none');
  assert.equal(decision.conversational_act, 'context_correction');
});

// 11. "Aman untuk booking besok?" must NOT be classified as generic acknowledgement
test('CR11. "Aman untuk booking besok?" is never swallowed as a neutral acknowledgement', () => {
  const decision = buildDecisionEnvelope({ message: 'Aman untuk booking besok?', decision: baseDecision });

  assert.notEqual(decision.conversational_act, 'social_acknowledgement');
  assert.equal(detectNeutralAcknowledgement('Aman untuk booking besok?').detected, false);
});

// 12. "Aman kak" standalone => acknowledgement / neutral response
test('CR12. standalone "Aman kak" is a neutral acknowledgement', () => {
  const decision = buildDecisionEnvelope({ message: 'Aman kak', decision: baseDecision });

  assert.equal(decision.conversational_act, 'social_acknowledgement');
  assert.equal(decision.response_strategy, 'acknowledge_only');
  for (const phrase of ['aman', 'oke aman', 'sudah aman', 'udah aman', 'sip aman']) {
    assert.equal(detectNeutralAcknowledgement(phrase).detected, true, phrase);
  }
});

// 13. private/off-topic message with no Redbox semantic => neutral, never membership
test('CR13. off-topic message after membership context never falls back to membership', () => {
  const decision = buildDecisionEnvelope({
    message: 'Eh btw temenku lagi butuh bantuan nih, gimana ya',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  assert.notEqual(decision.action, 'clarify_membership_scope');
  assert.notEqual(decision.route, 'crm_agent');
  assert.notEqual(decision.response_strategy, 'answer_with_crm_fact');
});

// 14. customer corrects Reddy twice => old erroneous clarification must not repeat
test('CR14. two consecutive corrections never resurrect the old membership clarification', () => {
  const first = buildDecisionEnvelope({
    message: 'Bukan itu maksud saya',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });
  const second = buildDecisionEnvelope({
    message: 'Salah paham kayaknya',
    conversationContext: priorMembershipContext,
    decision: baseDecision,
  });

  for (const decision of [first, second]) {
    assert.notEqual(decision.action, 'clarify_membership_scope');
    assert.equal(decision.conversational_act, 'context_correction');
  }
});

// 15/16. explicit correction must not wipe CRM identity or providerDeviceHash/branch scope
test('CR15/16. context-correction reply path preserves CRM identity, providerDeviceHash, and branch scope', async () => {
  const persistCalls = [];
  const sendCalls = [];
  let crmCalls = 0;
  let agentCalls = 0;

  const runtime = await handleMessage({
    from: '62811119999',
    name: 'Henky',
    text: 'Bukan itu maksud saya',
    branchFromPayload: 'bypass',
    providerDeviceHash: 'device-hash-abc123',
  }, {
    loadConversationHistory: async () => ({
      status: 'available',
      history: [{
        role: 'assistant',
        content: 'Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya?',
        timestamp: Date.now(),
      }],
    }),
    orchestrate: (params) => buildDecisionEnvelope({ ...params, decision: baseDecision }),
    executeReddy: async () => { agentCalls++; return { used: 'reddy_agent', reply: 'should not be used' }; },
    executeIntelligence: async () => { crmCalls++; },
    send: async (to, replyText, opts) => { sendCalls.push({ to, replyText, opts }); return { status: 'sent' }; },
    persistConversation: async (from, turns, inbound, outbound, meta, providerDeviceHash) => {
      persistCalls.push({
        from, turns, inbound, outbound, meta, providerDeviceHash,
      });
    },
    logTelemetry: () => {},
  });

  assert.equal(runtime.reply, 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?');
  assert.equal(agentCalls, 0);
  assert.equal(crmCalls, 0);
  assert.equal(persistCalls.length, 1);
  // CRM identity (the customer this exchange is persisted against) is untouched.
  assert.equal(persistCalls[0].from, '62811119999');
  // providerDeviceHash / branch scope survive the context-correction path unchanged.
  assert.equal(persistCalls[0].providerDeviceHash, 'device-hash-abc123');
  assert.equal(persistCalls[0].meta.branch, 'bypass');
  assert.equal(sendCalls[0].opts.branch, 'bypass');
});

// 18/19. no booking CTA, no generic closing on the neutral correction reply
test('CR18/19. the context-correction reply carries no booking CTA and no generic closing', () => {
  const decision = buildDecisionEnvelope({
    message: 'Bukan itu maksud saya',
    conversationContext: priorBookingContext,
    decision: baseDecision,
  });
  assert.equal(decision.response_strategy, 'acknowledge_correction_or_clarify_neutral');

  const reply = 'Sepertinya aku salah nangkep tadi. Maksud Kak yang mana?';
  assert.doesNotMatch(reply, /https?:\/\//i);
  assert.doesNotMatch(reply, /redboxbarbershop\.com/i);
  assert.doesNotMatch(reply, /ada yang bisa (aku|kami) bantu/i);
});

// 17. human handoff route is never overridden by context-recovery detection
test('CR17. a genuine human-handoff decision is not reclassified as context_correction', () => {
  const decision = buildDecisionEnvelope({
    message: 'Bukan itu, aku mau bicara sama admin manusia',
    decision: { ...baseDecision, intent: 'human_request', route: 'human' },
  });

  assert.equal(decision.route, 'human');
  assert.equal(decision.response_strategy, 'human_handoff');
});

// 20. membership CRM facts remain unchanged by context recovery
test('CR20. context recovery module never touches CRM membership fact computation', () => {
  // contextRecovery.js is a pure text classifier — it has no CRM/database
  // dependency at all, so membership fact derivation (member_profiles,
  // member_since, paid-plan status) is structurally unaffected.
  assert.doesNotMatch(
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'agents', 'reddy', 'contextRecovery.js'), 'utf8',
    ),
    /supabase|member_profiles|membership_status/i,
  );
});

test('Detector unit: detectExplicitContextCorrection covers the bounded phrase set', () => {
  const positives = [
    'bukan itu',
    'bukan itu maksud saya',
    'maksud saya bukan itu',
    'salah paham',
    'kamu salah nangkep',
    'bukan membership',
    'nggak bahas membership',
    'ga bahas member',
    'itu balasan pesan lain',
    'itu untuk chat lain',
    'saya lagi balas pesan lain',
    'bukan ngomongin itu',
    'enggak, maksud saya begini',
    'nggak, maksud saya begini',
  ];
  for (const phrase of positives) {
    assert.equal(detectExplicitContextCorrection(phrase).detected, true, phrase);
  }

  const negatives = ['harga haircut berapa?', 'aman kak', 'mau booking besok jam 3', 'membership aku aktif?'];
  for (const phrase of negatives) {
    assert.equal(detectExplicitContextCorrection(phrase).detected, false, phrase);
  }
});

test('Telemetry: context_correction act and acknowledge_correction_or_clarify_neutral strategy survive sanitizeTelemetry', () => {
  const safe = sanitizeTelemetry({
    route: 'reddy_agent',
    agent: 'reddy_agent',
    intent: 'unknown',
    action: 'fallback_unknown',
    conversational_act: 'context_correction',
    response_strategy: 'acknowledge_correction_or_clarify_neutral',
    context_recovery_triggered: true,
    context_recovery_reason: 'explicit_user_correction',
  });

  assert.equal(safe.conversational_act, 'context_correction');
  assert.equal(safe.response_strategy, 'acknowledge_correction_or_clarify_neutral');
  assert.equal(safe.context_recovery_triggered, true);
  assert.equal(safe.context_recovery_reason, 'explicit_user_correction');
});

test('Telemetry: context_recovery fields never leak message text, phone, or name', () => {
  const safe = sanitizeTelemetry({
    intent: 'unknown',
    context_recovery_triggered: true,
    context_recovery_reason: 'explicit_user_correction',
    message: 'Bukan itu maksud saya, aku Henky, 62812345678',
    phone: '62812345678',
    customer_name: 'Henky',
  });

  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /Henky/);
  assert.doesNotMatch(serialized, /62812345678/);
  assert.doesNotMatch(serialized, /Bukan itu maksud saya/);
});
