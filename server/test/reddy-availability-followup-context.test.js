'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDecisionEnvelope } = require('../orchestrator/orchestratorService');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

const ABDUL = { id: 'barber-abdul', name: 'Abdul', branch: 'bypass', is_active: true };
const SOFYAN = { id: 'barber-sofyan', name: 'Sofyan', branch: 'bypass', is_active: true };

function turnsFrom(pairs) {
  // pairs: [[userText, assistantText], ...] — last entry may be user-only (current turn appended by caller).
  const turns = [];
  for (const [user, assistant] of pairs) {
    turns.push({ role: 'user', content: user });
    if (assistant) turns.push({ role: 'assistant', content: assistant });
  }
  return turns;
}

function contextWithTurns(turns) {
  return {
    turns,
    turn_count: turns.length,
    history_status: turns.length ? 'present' : 'empty',
    sessionStatus: 'active',
    response_language: 'indonesian',
  };
}

test('routing: bare "Kalau jam 8?" after an availability-shaped turn wins over booking-flow temporal_followup', () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Mas Abdul hari ini kosong jam berapa?', 'Mas Abdul hari ini masih ada slot jam 17:00, 18:00 dan 20:00 kak'],
  ]));
  const decision = buildDecisionEnvelope({
    message: 'Kalau jam 8?',
    conversationContext,
    decision: { intent: 'unknown', route: 'reddy_agent', confidence: 0 },
  });
  assert.equal(decision.intent, 'specific_time_availability_query');
  assert.equal(decision.action, 'answer_barber_availability');
  assert.equal(decision.context_reference, 'prior_availability_barber_date');
});

test('routing: "Booking yang jam 8" after an availability turn still goes to booking-write handling, not availability', () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Mas Abdul hari ini kosong jam berapa?', 'Mas Abdul hari ini masih ada slot jam 17:00, 18:00 dan 20:00 kak'],
  ]));
  const decision = buildDecisionEnvelope({
    message: 'Booking yang jam 8',
    conversationContext,
    decision: { intent: 'booking_request', route: 'reddy_agent', confidence: 1 },
  });
  assert.notEqual(decision.intent, 'specific_time_availability_query');
});

test('routing: "Lock jam 8" after an availability turn is refused as a write attempt, not routed to availability', () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Mas Abdul hari ini kosong jam berapa?', 'Mas Abdul hari ini masih ada slot jam 17:00, 18:00 dan 20:00 kak'],
  ]));
  const decision = buildDecisionEnvelope({
    message: 'Lock jam 8',
    conversationContext,
    decision: { intent: 'unknown', route: 'reddy_agent', confidence: 0 },
  });
  assert.notEqual(decision.intent, 'specific_time_availability_query');
});

test('routing: normal booking-flow "jam 8" continuation (no prior availability turn) is unaffected', () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Saya mau booking Abdul besok', 'Baik kak, mau jam berapa?'],
  ]));
  const decision = buildDecisionEnvelope({
    message: 'jam 8',
    conversationContext,
    decision: { intent: 'unknown', route: 'reddy_agent', confidence: 0 },
  });
  assert.equal(decision.intent, 'booking_request');
  assert.equal(decision.action, 'continue_time_selection');
});

test('end-to-end: "Abdul hari ini kosong jam berapa?" then "Kalau jam 8 malam?" resolves Abdul + today + 20:00 with a fresh lookup', async () => {
  // Note: bare "jam 8" with no am/pm-equivalent period word is genuinely
  // ambiguous under bookingContext.js's existing resolveTimeAndPreference
  // (pre-existing behavior, intentionally not changed here — Reddy should
  // ask rather than guess AM/PM). "malam" disambiguates it, same as it would
  // on a first-turn message.
  const conversationContext = contextWithTurns(turnsFrom([
    ['Mas Abdul hari ini kosong jam berapa?', 'Mas Abdul hari ini masih ada slot jam 17:00, 18:00 dan 20:00 kak'],
  ]));
  let capturedParams = null;
  const result = await executeReddyAgent({
    from: '628100000005',
    text: 'Kalau jam 8 malam?',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: {
      intent: 'specific_time_availability_query', route: 'reddy_agent', action: 'answer_barber_availability',
      context_reference: 'prior_availability_barber_date',
    },
  }, {
    callOpenAI: async () => { throw new Error('must not call the LLM for this deterministic branch'); },
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN], reason: null }),
    getAvailability: async (_supabase, params) => {
      capturedParams = params;
      return { success: true, reason_code: 'available', requested_time: '20:00', available: true, alternative_slots: [] };
    },
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(capturedParams.barberId, ABDUL.id);
  assert.equal(capturedParams.time, '20:00');
  assert.match(result.reply, /available jam 20:00/);
});

test('end-to-end: "Besok Mas Sofyan ada?" then "Kalau jam 7 malam?" preserves Sofyan + tomorrow, not today', async () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Besok Mas Sofyan ada?', 'Besok Mas Sofyan masih ada slot kak'],
  ]));
  let capturedParams = null;
  await executeReddyAgent({
    from: '628100000006',
    text: 'Kalau jam 7 malam?',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: {
      intent: 'specific_time_availability_query', route: 'reddy_agent', action: 'answer_barber_availability',
      context_reference: 'prior_availability_barber_date',
    },
  }, {
    callOpenAI: async () => { throw new Error('must not call the LLM'); },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN], reason: null }),
    getAvailability: async (_supabase, params) => {
      capturedParams = params;
      return { success: true, reason_code: 'available', requested_time: '19:00', available: true, alternative_slots: [] };
    },
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(capturedParams.barberId, SOFYAN.id);
  assert.equal(capturedParams.time, '19:00');
  const tomorrow = new Date(Date.now() + 7 * 60 * 60 * 1000 + 86400000).toISOString().slice(0, 10);
  assert.equal(capturedParams.date, tomorrow);
});

test('end-to-end: branch-wide context ("siapa yang kosong" + a barber named mid-conversation) then "Kalau jam 6?" preserves that barber', async () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Di Bypass sore ini siapa yang kosong?', 'Sekarang masih ada Mas Abdul dan Mas Sofyan kak'],
    ['Oke Mas Abdul aja deh', 'Siap, ada yang bisa dibantu lagi soal Mas Abdul?'],
  ]));
  let capturedParams = null;
  await executeReddyAgent({
    from: '628100000007',
    text: 'Kalau jam 6 sore?',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: {
      intent: 'specific_time_availability_query', route: 'reddy_agent', action: 'answer_barber_availability',
      context_reference: 'prior_availability_barber_date',
    },
  }, {
    callOpenAI: async () => { throw new Error('must not call the LLM'); },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN], reason: null }),
    getAvailability: async (_supabase, params) => {
      capturedParams = params;
      return { success: true, reason_code: 'available', requested_time: '18:00', available: true, alternative_slots: [] };
    },
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(capturedParams.barberId, ABDUL.id);
  assert.equal(capturedParams.time, '18:00');
});

test('every follow-up performs a fresh lookup — never reuses a cached availability result', async () => {
  const conversationContext = contextWithTurns(turnsFrom([
    ['Mas Abdul hari ini kosong jam berapa?', 'Mas Abdul hari ini masih ada slot jam 17:00, 18:00 dan 20:00 kak'],
  ]));
  let calls = 0;
  await executeReddyAgent({
    from: '628100000008',
    text: 'Kalau jam 8?',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: {
      intent: 'specific_time_availability_query', route: 'reddy_agent', action: 'answer_barber_availability',
      context_reference: 'prior_availability_barber_date',
    },
  }, {
    callOpenAI: async () => { throw new Error('must not call the LLM'); },
    sendWA: async () => ({ status: true }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN], reason: null }),
    getAvailability: async () => { calls += 1; return { success: true, reason_code: 'available', requested_time: '20:00', available: true, alternative_slots: [] }; },
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(calls, 1);
});
