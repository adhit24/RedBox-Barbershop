'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyDeterministically } = require('../orchestrator/routingPolicy');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

// Representative test roster (same convention as the existing availability
// test suites) — not the real production roster, but real active-barber
// shape: {id, name}.
const ROSTER_NAMES = ['Abdul', 'Sofyan', 'Dodi'];
const ABDUL = { id: 'barber-abdul', name: 'Abdul', branch: 'bypass', is_active: true };
const SOFYAN = { id: 'barber-sofyan', name: 'Sofyan', branch: 'bypass', is_active: true };
const DODI = { id: 'barber-dodi', name: 'Dodi', branch: 'bypass', is_active: true };

test('P1 fix: bare barber name + availability signal word classifies deterministically when the roster is supplied', () => {
  const cases = [
    ['abdul ada ga hari ini', 'barber_availability_query'],
    ['besok sofyan masuk?', 'barber_availability_query'],
    ['abdul udh penuh?', 'barber_availability_query'],
    ['abang abdul ada?', 'barber_availability_query'],
    ['kak abdul kosong jam berapa?', 'barber_availability_query'],
    ['om dodi besok ada?', 'barber_availability_query'],
  ];
  for (const [text, expectedIntent] of cases) {
    const classified = classifyDeterministically(text, { canonicalBarberNames: ROSTER_NAMES });
    assert.equal(classified?.intent, expectedIntent, text);
  }
});

test('P1 fix: without a roster, behavior is unchanged (backward compatible, no false positives)', () => {
  for (const text of ['abdul ada ga hari ini', 'besok sofyan masuk?']) {
    const classified = classifyDeterministically(text);
    assert.notEqual(classified?.intent, 'barber_availability_query', text);
  }
});

test('booking-write verbs always win over bare-name roster detection', () => {
  for (const text of ['booking abdul jam 8', 'lock abdul jam 8', 'reschedule ke abdul jam 8', 'jadwal ulang abdul jam 8']) {
    const classified = classifyDeterministically(text, { canonicalBarberNames: ROSTER_NAMES });
    assert.notEqual(classified?.intent, 'barber_availability_query', text);
    assert.notEqual(classified?.intent, 'specific_time_availability_query', text);
  }
});

test('a bare mention of a barber name with no availability signal is never classified as availability', () => {
  for (const text of ['abdul ganteng juga ya', 'sofyan potongannya bagus']) {
    const classified = classifyDeterministically(text, { canonicalBarberNames: ROSTER_NAMES });
    assert.notEqual(classified?.intent, 'barber_availability_query', text);
    assert.notEqual(classified?.intent, 'specific_time_availability_query', text);
  }
});

test('specific-time still resolves correctly for a bare barber name', () => {
  const classified = classifyDeterministically('abdul ada jam 8?', { canonicalBarberNames: ROSTER_NAMES });
  assert.equal(classified?.intent, 'specific_time_availability_query');
});

test('unrelated names are never matched (roster is exact, not fuzzy)', () => {
  const classified = classifyDeterministically('budi kosong hari ini?', { canonicalBarberNames: ROSTER_NAMES });
  assert.equal(classified, null);
});

test('end-to-end: reddyAdapter answers a bare barber name deterministically (no LLM call)', async () => {
  const observations = { openAI: 0 };
  const result = await executeReddyAgent({
    from: '628100000009',
    text: 'abdul ada ga hari ini',
    branch: 'bypass',
    conversationContext: { turns: [], turn_count: 0, history_status: 'empty', sessionStatus: 'expired', response_language: 'indonesian' },
    orchestrationDecision: { intent: 'general_question', route: 'reddy_agent' }, // upstream classifier missed it, as it would in production
  }, {
    callOpenAI: async () => { observations.openAI += 1; throw new Error('must not be called'); },
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN, DODI], reason: null }),
    getAvailability: async () => ({ success: true, reason_code: 'available', available_slots: ['17:00', '18:00'] }),
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.equal(observations.openAI, 0);
  assert.equal(result.used, 'reddy_barber_availability_guard');
  assert.match(result.reply, /17:00 dan 18:00/);
});

test('end-to-end: booking-write phrase with a bare barber name still goes through normal (non-availability) handling', async () => {
  const result = await executeReddyAgent({
    from: '628100000010',
    text: 'booking abdul jam 8',
    branch: 'bypass',
    conversationContext: { turns: [], turn_count: 0, history_status: 'empty', sessionStatus: 'expired', response_language: 'indonesian' },
    orchestrationDecision: { intent: 'booking_request', route: 'reddy_agent', action: 'route_booking_request' },
  }, {
    callOpenAI: async () => 'Untuk booking, silakan lewat website ya kak: https://redboxbarbershop.com/booking.html',
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL, SOFYAN, DODI], reason: null }),
    getAvailability: async () => { throw new Error('must not be called for a booking-write turn'); },
    supabase: {},
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
  assert.notEqual(result.used, 'reddy_barber_availability_guard');
});

test('a message with no availability signal at all never triggers a roster fetch (cost control) and falls through unaffected', async () => {
  let loadBarbersCalls = 0;
  const result = await executeReddyAgent({
    from: '628100000011',
    text: 'terima kasih ya',
    branch: 'bypass',
    conversationContext: { turns: [], turn_count: 0, history_status: 'empty', sessionStatus: 'expired', response_language: 'indonesian' },
    orchestrationDecision: { intent: 'general_question', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Sama-sama kak!',
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => { loadBarbersCalls += 1; return { status: 'verified', barbers: [ABDUL], reason: null }; },
    supabase: {},
    logBookingTelemetry: () => {},
  });
  assert.equal(loadBarbersCalls, 0);
  assert.notEqual(result.used, 'reddy_barber_availability_guard');
});
