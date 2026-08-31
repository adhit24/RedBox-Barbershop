'use strict';

/**
 * P0.3 — Conversation Device Scope Preservation, Implementation Round 1.
 *
 * Locked root cause (actual-source review): providerDeviceHash is correctly
 * established during P0 inbound admission and correctly available as
 * conversationContext.providerDeviceHash, but server/agents/reddy/reddyAdapter.js
 * called its injected persistConversation dependency with only 4 positional
 * arguments (from, turns, text, reply) — never forwarding providerDeviceHash
 * as persistConversationExchange's 6th parameter. The omitted argument
 * silently defaulted to null, so resolveConversationDeviceScope(null) always
 * resolved to the 'legacy-unscoped' sentinel regardless of the real,
 * admitted device hash used earlier in the same request by
 * touchInboundActivity.
 *
 * This suite proves the three reddyAdapter.js persistConversation call sites
 * now forward the real hash (tests 1-5), that admission still fails closed
 * on a missing device (test 6, unchanged), that the persistence signature
 * itself resolves a real hash to itself rather than the legacy sentinel
 * (test 7), and that a history-save and a lifecycle-touch given the same
 * real hash now target the identical conversation scope (test 8).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { touchInboundActivity } = require('../services/conversationLifecycle');
const { resolveConversationDeviceScope, conversationCacheKey, LEGACY_DEVICE_SCOPE } = require('../services/conversationScope');
const { admitInboundEvent } = require('../services/waInboundGuard');
const { persistConversationExchange } = require('../../api/wa/webhook');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function emptyContext(extra = {}) {
  return {
    turns: [],
    turn_count: 0,
    history_status: 'empty',
    sessionStatus: 'expired',
    ...extra,
  };
}

function capturePersistConversation() {
  const calls = [];
  return {
    calls,
    persistConversation: async (from, turns, text, reply, deps, providerDeviceHash) => {
      calls.push({ from, text, reply, deps, providerDeviceHash });
    },
  };
}

// ── TEST 1 — normal Reddy path ──────────────────────────────────────────────

test('TEST 1: normal Reddy reply path forwards the exact admitted providerDeviceHash to persistConversation', async () => {
  const { calls, persistConversation } = capturePersistConversation();
  const conversationContext = emptyContext({ providerDeviceHash: HASH_A });

  await executeReddyAgent({
    from: '628100000001',
    text: 'Gentleman Grooming berapa?',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Gentleman Grooming Rp95.000 ya Kak.',
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: () => {},
    persistConversation,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerDeviceHash, HASH_A);
  assert.notEqual(calls[0].providerDeviceHash, null);
  assert.notEqual(calls[0].providerDeviceHash, undefined);
  assert.notEqual(calls[0].providerDeviceHash, LEGACY_DEVICE_SCOPE);
});

// ── TEST 2 — booking completion ack ─────────────────────────────────────────

test('TEST 2: booking-completion-acknowledgement path forwards the exact providerDeviceHash; booking behavior unchanged', async () => {
  const { calls, persistConversation } = capturePersistConversation();
  const assistantBookingCtaTurn = {
    role: 'assistant',
    content: 'Silakan lanjutkan pilihan booking di website resmi ya Kak: https://redboxbarbershop.com/booking.html',
  };
  const conversationContext = emptyContext({
    providerDeviceHash: HASH_A,
    turns: [assistantBookingCtaTurn],
    turn_count: 1,
  });
  let callOpenAICalled = false;

  const result = await executeReddyAgent({
    from: '628100000002',
    text: 'Sudah kak',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: {
      intent: 'general_question',
      conversational_act: 'booking_completion_report',
      response_strategy: 'acknowledge_booking_completion_report',
    },
  }, {
    callOpenAI: async () => { callOpenAICalled = true; return 'should not be used'; },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: () => {},
    persistConversation,
  });

  assert.equal(callOpenAICalled, false, 'booking-completion ack must remain a zero-LLM deterministic reply');
  assert.equal(result.used, 'reddy_agent');
  assert.doesNotMatch(result.reply, /belum dibuat atau diubah/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerDeviceHash, HASH_A);
  assert.notEqual(calls[0].providerDeviceHash, LEGACY_DEVICE_SCOPE);
});

// ── TEST 3 — deterministic barber presence ──────────────────────────────────

test('TEST 3: deterministic first-turn barber-presence path forwards the exact providerDeviceHash; roster/schedule authority unchanged', async () => {
  const { calls, persistConversation } = capturePersistConversation();
  const HUSEN = { id: 'barber-husen', name: 'Husen', branch: 'csb', is_active: true };
  let openAICalls = 0;
  let scheduleCalls = 0;

  const result = await executeReddyAgent({
    from: '628100000003',
    text: 'Mas Husen ada?',
    branch: 'csb',
    conversationContext: emptyContext({ providerDeviceHash: HASH_A }),
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => { openAICalls += 1; return 'should not be used'; },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'verified', barbers: [HUSEN], reason: null }),
    getSchedule: async (_supabase, { barberId, date }) => {
      scheduleCalls += 1;
      return { status: 'scheduled', source: 'planned_schedule_lookup', date, barberId };
    },
    supabase: {},
    logBookingTelemetry: () => {},
    persistConversation,
  });

  // Roster/schedule/attendance authority is unaffected by this fix: still
  // zero-LLM, still a single verified schedule lookup, still bounded wording.
  assert.equal(openAICalls, 0, 'deterministic presence path must not call the LLM');
  assert.equal(scheduleCalls, 1);
  assert.equal(result.used, 'reddy_barber_presence_guard');
  assert.match(result.reply, /Husen memang dijadwalkan masuk hari ini/i);
  assert.doesNotMatch(result.reply, /Husen ada(?:\s|[.!?,])/i, 'must not upgrade schedule into an attendance claim');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerDeviceHash, HASH_A);
  assert.notEqual(calls[0].providerDeviceHash, LEGACY_DEVICE_SCOPE);
});

// ── TEST 4 — two devices, same customer ─────────────────────────────────────

test('TEST 4: same sender on two different admitted devices persists under two distinct hashes, never shared/null', async () => {
  const sender = '628100000004';
  const runA = capturePersistConversation();
  const runB = capturePersistConversation();

  await executeReddyAgent({
    from: sender,
    text: 'Harga haircut berapa?',
    branch: 'bypass',
    conversationContext: emptyContext({ providerDeviceHash: HASH_A }),
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Haircut Rp95.000 ya Kak.',
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: () => {},
    persistConversation: runA.persistConversation,
  });

  await executeReddyAgent({
    from: sender,
    text: 'Harga haircut berapa?',
    branch: 'csb',
    conversationContext: emptyContext({ providerDeviceHash: HASH_B }),
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Haircut Rp95.000 ya Kak (CSB Rp120.000).',
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: () => {},
    persistConversation: runB.persistConversation,
  });

  assert.equal(runA.calls[0].providerDeviceHash, HASH_A);
  assert.equal(runB.calls[0].providerDeviceHash, HASH_B);
  assert.notEqual(runA.calls[0].providerDeviceHash, runB.calls[0].providerDeviceHash);
  for (const hash of [runA.calls[0].providerDeviceHash, runB.calls[0].providerDeviceHash]) {
    assert.notEqual(hash, null);
    assert.notEqual(hash, LEGACY_DEVICE_SCOPE);
  }
});

// ── TEST 5 — boundedConversationContext preserves the hash ─────────────────

test('TEST 5: boundedConversationContext (spread of conversationContext) still carries providerDeviceHash into callOpenAI', async () => {
  let seenContext = null;
  await executeReddyAgent({
    from: '628100000005',
    text: 'Ada promo gak?',
    branch: 'bypass',
    conversationContext: emptyContext({ providerDeviceHash: HASH_A }),
    orchestrationDecision: { intent: 'general_question', route: 'reddy_agent' },
  }, {
    callOpenAI: async (_from, _text, _name, _branch, _kf, _facts, boundedConversationContext) => {
      seenContext = boundedConversationContext;
      return 'Belum ada promo publik terverifikasi saat ini ya Kak.';
    },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: () => {},
  });

  assert.ok(seenContext, 'callOpenAI must have been invoked with a bounded context');
  assert.equal(seenContext.providerDeviceHash, HASH_A);
});

// ── TEST 6 — admission security regression (must NOT change) ───────────────

test('TEST 6: admission still fails closed on a missing Fonnte provider device (unchanged)', async () => {
  const result = await admitInboundEvent({}, {
    sender: '628100000006',
    message: 'Halo',
    id: 'msg-1',
    // device / device_id / deviceId intentionally omitted
  });
  assert.equal(result.status, 'missing_provider_device_id');
  assert.equal(result.row, null);
});

// ── TEST 7 — persistence signature resolves a real hash to itself ──────────

test('TEST 7: persistConversationExchange forwarded a real hash resolves to that SAME hash, not legacy-unscoped', async () => {
  let capturedHash;
  await persistConversationExchange(
    '628100000007', [], 'Halo', 'Halo Kak!',
    {
      saveHistory: async (_sender, _history, providerDeviceHash) => { capturedHash = providerDeviceHash; },
      cache: new Map(),
      timestamps: new Map(),
    },
    HASH_A,
  );
  assert.equal(capturedHash, HASH_A);
  assert.equal(resolveConversationDeviceScope(capturedHash), HASH_A);
  assert.notEqual(resolveConversationDeviceScope(capturedHash), LEGACY_DEVICE_SCOPE);
});

// ── TEST 8 — lifecycle touch and history persistence target the SAME row ───

function makeFakeSupabaseForLifecycle() {
  const upserts = [];
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    maybeSingle: async () => ({ data: null }),
    upsert: async (payload) => { upserts.push(payload); return { error: null }; },
  };
  return { upserts, from: () => builder };
}

test('TEST 8: given the same real hash, touchInboundActivity and history persistence resolve the identical conversation scope', async () => {
  const sender = '628100000008';
  const fakeSupabase = makeFakeSupabaseForLifecycle();

  await touchInboundActivity(fakeSupabase, sender, { providerDeviceHash: HASH_A, branch: 'csb' });
  assert.equal(fakeSupabase.upserts.length, 1);
  const lifecycleScope = fakeSupabase.upserts[0].provider_device_hash;
  assert.equal(lifecycleScope, HASH_A);

  let historyScope = null;
  await persistConversationExchange(sender, [], 'Halo', 'Halo Kak!', {
    saveHistory: async (_sender, _history, providerDeviceHash) => {
      historyScope = resolveConversationDeviceScope(providerDeviceHash);
    },
  }, HASH_A);

  assert.equal(historyScope, lifecycleScope, 'history-save and lifecycle-touch must now target the identical (sender, provider_device_hash) row');
  assert.notEqual(historyScope, LEGACY_DEVICE_SCOPE);
  assert.equal(conversationCacheKey(sender, HASH_A), `${lifecycleScope}::${sender}`);
});
