'use strict';

/**
 * Reddy Booking Context Interpretation Hotfix — test suite.
 *
 * Covers the customer-reported-booking-completion regression: Reddy was
 * replying "Booking belum dibuat atau diubah lewat WhatsApp ya Kak..." when
 * a customer said "sudah kak" to report they had already completed a
 * booking on the website, rather than asking Reddy to create/change one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectBookingCompletionReport } = require('../agents/reddy/bookingCompletionReport');
const { buildDecisionEnvelope } = require('../orchestrator/orchestratorService');
const { deriveBookingEligibility } = require('../agents/reddy/bookingEligibility');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

const canonicalBarbers = [
  { id: 'barber-ubay-id', name: 'Ubay', branch: 'bypass', is_active: true },
];

function trustedBarberLoader() {
  return Promise.resolve({ status: 'verified', barbers: canonicalBarbers, reason: null });
}

const assistantBookingCtaTurn = {
  role: 'assistant',
  content: 'Silakan lanjutkan pilihan booking di website resmi ya Kak: https://redboxbarbershop.com/booking.html',
};

// ── Task 1: detectBookingCompletionReport ────────────────────────────────

test('B1. bare "sudah kak" requires recent booking-guidance context', () => {
  const withoutContext = detectBookingCompletionReport({ text: 'sudah kak', conversationContext: { turns: [] } });
  assert.equal(withoutContext.isCompletionReport, false);

  const withContext = detectBookingCompletionReport({
    text: 'sudah kak',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(withContext.isCompletionReport, true);
  assert.equal(withContext.reason, 'contextual_completion_ack');
});

test('B2. bare "udah" (no punctuation) requires context, same as "sudah kak"', () => {
  const withContext = detectBookingCompletionReport({
    text: 'udah',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(withContext.isCompletionReport, true);
});

test('B3. explicit "udah booking di web" fires without any context', () => {
  const result = detectBookingCompletionReport({ text: 'udah booking di web', conversationContext: { turns: [] } });
  assert.equal(result.isCompletionReport, true);
  assert.equal(result.reason, 'explicit_completion_phrase');
});

test('B4. explicit "udah dapet jam 2" fires without any context', () => {
  const result = detectBookingCompletionReport({ text: 'udah dapet jam 2', conversationContext: { turns: [] } });
  assert.equal(result.isCompletionReport, true);
});

test('B5. explicit "sudah saya booking" fires without any context', () => {
  const result = detectBookingCompletionReport({ text: 'sudah saya booking', conversationContext: { turns: [] } });
  assert.equal(result.isCompletionReport, true);
});

test('B6. "tadi sy di website ternyata ubay available kak" is NOT a completion report (still exploring)', () => {
  const result = detectBookingCompletionReport({
    text: 'Td sy di website ternyata ubay available kak',
    conversationContext: { turns: [] },
  });
  assert.equal(result.isCompletionReport, false);
});

test('B7. status question "booking saya sudah belum?" never fires', () => {
  const result = detectBookingCompletionReport({
    text: 'booking saya sudah belum?',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(result.isCompletionReport, false);
  assert.equal(result.reason, 'question');
});

test('B8. new booking request "bisa booking jam 2?" never fires', () => {
  const result = detectBookingCompletionReport({
    text: 'bisa booking jam 2?',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(result.isCompletionReport, false);
});

test('B9. "sudah bayar?" never fires', () => {
  const result = detectBookingCompletionReport({
    text: 'sudah bayar?',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(result.isCompletionReport, false);
});

test('B10. "sudah potong tadi" never fires, even with booking context and no question mark', () => {
  const result = detectBookingCompletionReport({
    text: 'sudah potong tadi',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(result.isCompletionReport, false);
});

test('B11. "Oke kak sudah jam 2 besok" (still setting the time, not yet reporting completion) does not fire', () => {
  const result = detectBookingCompletionReport({
    text: 'Oke kak sudah jam 2 besok',
    conversationContext: { turns: [assistantBookingCtaTurn] },
  });
  assert.equal(result.isCompletionReport, false, 'this turn is a time choice, not a completion report');
});

// ── Task 2: orchestratorService.buildDecisionEnvelope ────────────────────

test('B12. buildDecisionEnvelope classifies contextual "sudah kak" as booking_completion_report', () => {
  const decision = buildDecisionEnvelope({
    message: 'sudah kak',
    conversationContext: { turns: [assistantBookingCtaTurn], turn_count: 1 },
    decision: { intent: 'unknown', route: 'reddy_agent', action: 'fallback_unknown', confidence: 0 },
  });

  assert.equal(decision.conversational_act, 'booking_completion_report');
  assert.equal(decision.intent, 'general_question');
  assert.equal(decision.action, 'acknowledge_booking_completion');
  assert.equal(decision.response_strategy, 'acknowledge_booking_completion_report');
  assert.equal(decision.session_behavior, 'keep_current_state');
  assert.deepEqual([...decision.prohibited_claims], [
    'booking_confirmed_by_whatsapp',
    'booking_confirmed_by_backend',
    'repeat_booking_cta',
  ]);
});

test('B13. buildDecisionEnvelope takes completion-report precedence over the barber/branch/service bag-of-words followup rules', () => {
  // Context deliberately contains generic words ("pilih", "kapster") that would
  // otherwise satisfy barber_choice_followup's very loose shape check.
  const decision = buildDecisionEnvelope({
    message: 'Sudah kak',
    conversationContext: {
      turns: [
        { role: 'user', content: 'Mau sama kapster Ubay kak' },
        { role: 'assistant', content: 'Baik Kak, silakan pilih jadwal dan kapster di website ya: https://redboxbarbershop.com/booking.html' },
      ],
      turn_count: 2,
    },
    decision: { intent: 'unknown', route: 'reddy_agent', action: 'fallback_unknown', confidence: 0 },
  });

  assert.equal(decision.conversational_act, 'booking_completion_report');
  assert.notEqual(decision.conversational_act, 'barber_choice_followup');
});

test('B14. buildDecisionEnvelope leaves booking_status question classification untouched', () => {
  const decision = buildDecisionEnvelope({
    message: 'booking saya sudah belum?',
    conversationContext: { turns: [assistantBookingCtaTurn], turn_count: 1 },
    decision: { intent: 'booking_status', route: 'reddy_agent', action: 'get_booking_status', confidence: 1 },
  });

  assert.notEqual(decision.conversational_act, 'booking_completion_report');
});

test('B15. buildDecisionEnvelope leaves a genuine new booking request untouched', () => {
  const decision = buildDecisionEnvelope({
    message: 'bisa booking jam 2?',
    conversationContext: { turns: [assistantBookingCtaTurn], turn_count: 1 },
    decision: { intent: 'booking_request', route: 'reddy_agent', action: 'route_booking_request', confidence: 1 },
  });

  assert.notEqual(decision.conversational_act, 'booking_completion_report');
});

// ── Task 3: bookingEligibility.js ─────────────────────────────────────────

test('B16. deriveBookingEligibility marks booking_completion_report as CTA-ineligible', () => {
  const result = deriveBookingEligibility({
    text: 'Sudah kak',
    orchestrationDecision: { intent: 'general_question', conversational_act: 'booking_completion_report' },
  });

  assert.equal(result.responseEligible, false);
  assert.equal(result.ctaEligible, false);
  assert.equal(result.reason, 'booking_completion_acknowledged');
});

// ── Task 4: reddyAdapter.js deterministic short-circuit ──────────────────

test('B17. executeReddyAgent acknowledges completion deterministically, without calling the LLM', async () => {
  const sent = [];
  const telemetry = [];
  const persisted = [];
  let callOpenAICalled = false;

  const result = await executeReddyAgent({
    from: '628100000000',
    text: 'Sudah kak',
    branch: 'bypass',
    conversationContext: { turns: [assistantBookingCtaTurn], turn_count: 1 },
    orchestrationDecision: {
      intent: 'general_question',
      conversational_act: 'booking_completion_report',
      response_strategy: 'acknowledge_booking_completion_report',
    },
  }, {
    callOpenAI: async () => { callOpenAICalled = true; return 'should not be used'; },
    sendWA: async (_to, reply) => { sent.push(reply); return { status: 'sent' }; },
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: (event) => telemetry.push(event),
    persistConversation: async (_from, _turns, _text, reply) => persisted.push(reply),
  });

  assert.equal(callOpenAICalled, false, 'the LLM must not be called for a completion report');
  assert.equal(sent.length, 1);
  assert.equal(sent[0], result.reply);
  assert.doesNotMatch(sent[0], /redboxbarbershop\.com/i);
  assert.doesNotMatch(sent[0], /belum dibuat atau diubah/i);
  assert.doesNotMatch(sent[0], /terkonfirmasi|confirmed/i);
  assert.doesNotMatch(sent[0], /silakan booking|langsung booking/i);
  assert.deepEqual(persisted, sent);

  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].action, 'booking_completion_acknowledged');
  assert.equal(telemetry[0].booking_cta_eligible, false);
});

test('B18. Full production regression sequence: final "Sudah kak" gets acknowledged, not rejected', async () => {
  const sent = [];
  let callOpenAICalled = false;

  const conversationContext = {
    turn_count: 4,
    turns: [
      { role: 'user', content: 'Td sy di website ternyata ubay available kak' },
      { role: 'assistant', content: 'Kalau di website Mas Ubay tersedia, bisa langsung booking ya Kak: https://redboxbarbershop.com/booking.html' },
      { role: 'user', content: 'Oke kak besok saja ya' },
      { role: 'assistant', content: 'Siap Kak, silakan pilih jadwal besok di website resmi ya.' },
      { role: 'user', content: 'Oke kak sudah jam 2 besok' },
    ],
  };

  const result = await executeReddyAgent({
    from: '628100000000',
    text: 'Sudah kak',
    branch: 'bypass',
    conversationContext,
    orchestrationDecision: buildDecisionEnvelope({
      message: 'Sudah kak',
      conversationContext,
      decision: { intent: 'unknown', route: 'reddy_agent', action: 'fallback_unknown', confidence: 0 },
    }),
  }, {
    callOpenAI: async () => { callOpenAICalled = true; return 'Sip Kak, sudah aku catat ya jam 2 besok.'; },
    sendWA: async (_to, reply) => { sent.push(reply); return { status: 'sent' }; },
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: () => {},
  });

  assert.equal(callOpenAICalled, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], result.reply);
  assert.doesNotMatch(sent[0], /belum dibuat atau diubah/i, 'must not send the wrong-canned-rejection string');
  assert.doesNotMatch(sent[0], /redboxbarbershop\.com/i, 'no repeated CTA/link');
  assert.doesNotMatch(sent[0], /terkonfirmasi|confirmed/i, 'no fabricated backend confirmation claim');
});
