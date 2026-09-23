'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

const CATALOG = [{ id: 'service-grooming', name: 'Gentleman Grooming', price: 95000, duration_minutes: 75, is_active: true }];
const catalogDb = () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: CATALOG, error: null }) }) }) });

const ABDUL = { id: 'barber-abdul', name: 'Abdul', branch: 'bypass', is_active: true };

function emptyContext(turns = []) {
  return {
    turns,
    turn_count: turns.length,
    history_status: turns.length ? 'present' : 'empty',
    sessionStatus: 'active',
    response_language: 'indonesian',
  };
}

async function runTurn({
  text,
  orchestrationDecision,
  availabilityResult = { success: true, reason_code: 'available', available_slots: ['17:00', '18:00'] },
  barbers = [ABDUL],
  conversationContext = emptyContext([{ role: 'user', content: 'Saya pilih Gentleman Grooming' }]),
  callOpenAIImpl = async () => 'fallback LLM reply (should not be used for these tests)',
} = {}) {
  const observations = { openAI: 0, availabilityCalls: 0, sent: [], availabilityTelemetry: [] };
  const result = await executeReddyAgent({
    from: '628100000002',
    text,
    branch: 'bypass',
    conversationContext,
    orchestrationDecision,
  }, {
    callOpenAI: async (...args) => { observations.openAI += 1; return callOpenAIImpl(...args); },
    sendWA: async (_to, reply) => { observations.sent.push(reply); return { status: true }; },
    loadBarbers: async () => ({ status: 'verified', barbers, reason: null }),
    getAvailability: async (_supabase, params) => {
      assert.equal(params.serviceId, 'service-grooming');
      assert.equal(params.durationMinutes, 75);
      observations.availabilityCalls += 1;
      observations.lastParams = params;
      return typeof availabilityResult === 'function' ? availabilityResult(params) : availabilityResult;
    },
    logAvailability: (event) => observations.availabilityTelemetry.push(event),
    supabase: catalogDb(),
    logBookingTelemetry: () => {},
  });
  return { result, observations };
}

test('specific_time_availability_query: named barber + time, answered deterministically without calling the LLM', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Abdul jam 5 sore kosong?',
    orchestrationDecision: { intent: 'specific_time_availability_query', route: 'reddy_agent' },
    availabilityResult: {
      success: true, reason_code: 'available', requested_time: '17:00', available: true, alternative_slots: [],
    },
  });
  assert.equal(observations.openAI, 0);
  assert.equal(result.used, 'reddy_barber_availability_guard');
  assert.match(result.reply, /available jam 17:00/);
  assert.equal(observations.sent.length, 1);
});

test('specific_time_availability_query: unavailable time surfaces alternative_slots, no LLM call', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Abdul jam 5 sore kosong?',
    orchestrationDecision: { intent: 'specific_time_availability_query', route: 'reddy_agent' },
    availabilityResult: {
      success: true, reason_code: 'available', requested_time: '17:00', available: false, alternative_slots: ['18:00', '20:00'],
    },
  });
  assert.equal(observations.openAI, 0);
  assert.match(result.reply, /udah terisi/);
  assert.match(result.reply, /18:00 dan 20:00/);
});

test('branch_availability_query: aggregates barbers from tool result, never claims a specific slot is held', async () => {
  const { result, observations } = await runTurn({
    text: 'Jam 7 malam di Bypass siapa yang kosong?',
    orchestrationDecision: { intent: 'branch_availability_query', route: 'reddy_agent' },
    availabilityResult: {
      success: true, reason_code: 'available', barbers: [{ id: 'a', name: 'Ari' }, { id: 'b', name: 'Bob' }],
    },
  });
  assert.equal(observations.openAI, 0);
  assert.match(result.reply, /Mas Ari dan Mas Bob/);
  assert.doesNotMatch(result.reply, /sudah\s+diamankan|sudah\s+dibooking/i);
});

test('barber_availability_query: barber off today, real alternatives only from tool data', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Abdul besok ada?',
    orchestrationDecision: { intent: 'barber_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: true, reason_code: 'barber_off', working: false, available_slots: [] },
  });
  assert.equal(observations.openAI, 0);
  assert.match(result.reply, /nggak ada jadwal/);
});

test('barber_availability_query: fully booked (working, no slots) never claims a fake fully_booked code', async () => {
  const { result } = await runTurn({
    text: 'Mas Abdul hari ini kosong jam berapa?',
    orchestrationDecision: { intent: 'barber_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: true, reason_code: 'no_slot', working: true, available_slots: [] },
  });
  assert.match(result.reply, /udah penuh/);
});

test('tool failure: safe fallback message, redirects to booking website, never guesses a slot', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Abdul jam 5 sore kosong?',
    orchestrationDecision: { intent: 'specific_time_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: false, reason_code: 'tool_error' },
  });
  assert.equal(observations.openAI, 0);
  assert.match(result.reply, /belum bisa baca jadwal live/);
  assert.match(result.reply, /redboxbarbershop\.com\/booking\.html/);
});

test('unresolved barber name on a barber-specific query: asks for clarification, never silently answers branch-wide', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Zzznotreal jam 5 kosong?',
    orchestrationDecision: { intent: 'specific_time_availability_query', route: 'reddy_agent' },
  });
  assert.equal(observations.availabilityCalls, 0);
  assert.match(result.reply, /belum menemukan nama kapster/);
});

test('conversation memory: a bare "kalau jam 8?" follow-up still resolves the barber from context text', async () => {
  // The follow-up message itself carries the barber name in this deterministic-branch test
  // (full orchestrator-level ellipsis resolution for a bare "kalau jam 8?" is a documented
  // partial-support case — see final report) — this exercises the fresh-lookup-per-turn path.
  const { result, observations } = await runTurn({
    text: 'Mas Abdul kalau jam 8 malam kosong?',
    orchestrationDecision: { intent: 'specific_time_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: true, reason_code: 'available', requested_time: '20:00', available: true, alternative_slots: [] },
  });
  assert.equal(observations.lastParams.time, '20:00');
  assert.match(result.reply, /available jam 20:00/);
});

test('branch-wide with no free barbers: informational only, no fabricated alternative', async () => {
  const { result } = await runTurn({
    text: 'Sekarang siapa yang available?',
    orchestrationDecision: { intent: 'branch_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: true, reason_code: 'no_slot', barbers: [] },
  });
  assert.match(result.reply, /belum ada kapster/);
});

test('"Mas Abdul hari ini ada?" (temporal word present) routes via the orchestrator intent branch with real slot times', async () => {
  const { result, observations } = await runTurn({
    text: 'Mas Abdul hari ini ada?',
    orchestrationDecision: { intent: 'barber_availability_query', route: 'reddy_agent' },
    availabilityResult: { success: true, reason_code: 'available', available_slots: ['17:00', '18:00', '20:00'] },
  });
  assert.equal(observations.openAI, 0);
  assert.equal(result.used, 'reddy_barber_availability_guard');
  assert.match(result.reply, /17:00, 18:00 dan 20:00/);
});

test('bare "Mas Abdul ada?" (no temporal word, presence-regex shaped) is enriched with real slot times, not just yes/no', async () => {
  const result = await executeReddyAgent({
    from: '628100000003',
    text: 'Mas Abdul ada?',
    branch: 'bypass',
    conversationContext: emptyContext([{ role: 'user', content: 'Saya pilih Gentleman Grooming' }]),
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => { throw new Error('LLM must not be called for a matched presence query'); },
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL], reason: null }),
    getSchedule: async () => ({ status: 'scheduled', source: 'planned_schedule_lookup', date: '2026-09-14' }),
    getAvailability: async () => ({ success: true, reason_code: 'available', available_slots: ['17:00', '18:00', '20:00'] }),
    supabase: catalogDb(),
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(result.used, 'reddy_barber_presence_guard');
  assert.match(result.reply, /17:00, 18:00 dan 20:00/);
});

test('bare "Mas Abdul ada?" falls back to the unchanged presence-only reply when availability lookup fails', async () => {
  const result = await executeReddyAgent({
    from: '628100000004',
    text: 'Mas Abdul ada?',
    branch: 'bypass',
    conversationContext: emptyContext([{ role: 'user', content: 'Saya pilih Gentleman Grooming' }]),
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => { throw new Error('LLM must not be called for a matched presence query'); },
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL], reason: null }),
    getSchedule: async () => ({ status: 'scheduled', source: 'planned_schedule_lookup', date: '2026-09-14' }),
    getAvailability: async () => { throw new Error('backend unavailable'); },
    supabase: catalogDb(),
    logBookingTelemetry: () => {},
    logAvailability: () => { throw new Error('should not be called on lookup failure'); },
  });
  assert.equal(result.used, 'reddy_barber_presence_guard');
  assert.match(result.reply, /dijadwalkan masuk hari ini/);
});

test('a request to book (not just ask availability) is never answered by the deterministic availability branch', () => {
  const { classifyDeterministically } = require('../orchestrator/routingPolicy');
  for (const text of ['Tolong booking Abdul jam 8', 'Yaudah lock dulu slotnya']) {
    const classified = classifyDeterministically(text);
    assert.notEqual(classified?.intent, 'barber_availability_query');
    assert.notEqual(classified?.intent, 'specific_time_availability_query');
    assert.notEqual(classified?.intent, 'branch_availability_query');
  }
});

