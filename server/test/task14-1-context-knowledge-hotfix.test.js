'use strict';

/**
 * Task 14.1 — Reddy Context Isolation, Real-Time Fact Boundary & Membership
 * Consistency (correction round after Aira's actual-source review).
 *
 * Tests A-K below are the required behavioral matrix from the correction
 * request. Where the claim is deterministically enforceable (A, B, C, D, E,
 * F, K) the test drives server/agents/reddy/reddyAdapter.js's real
 * executeReddyAgent — the actual call-level execution boundary, not just
 * prompt text — and inspects what is literally passed to callOpenAI / what
 * literally reaches sendWA. G, H, I, J are necessarily prompt-level: no
 * barber schedule/attendance source is wired into Reddy today (audited —
 * see webhook.js's "BATAS FAKTA REAL-TIME" comment), so there is no runtime
 * boundary to drive yet; these assert the prompt instruction exists and is
 * unconditional, which is the correct thing to enforce until such a source
 * exists.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { orchestrateMessage } = require('../orchestrator/orchestratorService');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { suppressUnsolicitedBookingCta } = require('../agents/reddy/bookingGuards');
const { deriveBookingEligibility } = require('../agents/reddy/bookingEligibility');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { REDBOX_KNOWLEDGE } = require('../agents/reddy/knowledge/redboxKnowledge');
const { resolveKnowledgeContext } = require('../agents/reddy/knowledge/knowledgeResolver');

const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const webhookSource = fs.readFileSync(webhookPath, 'utf8');

const classifier = (intent, route = 'reddy_agent', action = 'answer_general_question') => async () => ({
  intent,
  route,
  agent: route === 'human' ? undefined : route,
  action,
  confidence: 0.91,
  model_tier: 'economy',
});

function context(...turns) {
  return {
    version: 'conversation_context.v0.1',
    trust: 'untrusted_conversation',
    history_status: turns.length ? 'available' : 'empty',
    turns,
    turn_count: turns.length,
    sessionStatus: turns.length ? 'active_conversation' : 'expired',
  };
}

const canonicalBarbers = [
  { id: 'barber-onoy-id', name: 'Onoy', branch: 'bypass', is_active: true },
  { id: 'barber-opan-id', name: 'Opan', branch: 'samadikun', is_active: true },
];
function trustedBarberLoader() {
  return Promise.resolve({ status: 'verified', barbers: canonicalBarbers, reason: null });
}

async function runReddy({
  from = '628100000001', text, orchestrationDecision, conversationContext = null, callOpenAI, getSchedule,
}) {
  let capturedConversationContext = null;
  let sentReply = null;
  const result = await executeReddyAgent({
    from, text, branch: 'bypass', conversationContext, orchestrationDecision,
  }, {
    callOpenAI: async (...args) => {
      capturedConversationContext = args[6];
      return typeof callOpenAI === 'function' ? await callOpenAI(...args) : 'Baik Kak.';
    },
    sendWA: async (_to, reply) => { sentReply = reply; return { status: 'sent' }; },
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: () => {},
    supabase: typeof getSchedule === 'function' ? {} : null,
    getSchedule,
  });
  return { result, capturedConversationContext, sentReply };
}

// ── A. booking -> points ──────────────────────────────────────────────────
test('A. points question after an earlier branch mention: no handoff_url exposed to the model, no booking URL in the final reply', async () => {
  const { capturedConversationContext, sentReply, result } = await runReddy({
    text: 'Poin saya berapa?',
    orchestrationDecision: { intent: 'points_inquiry', route: 'crm_agent', conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact' },
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
    callOpenAI: async () => 'Saldo poin kamu 50 poin ya Kak.',
  });

  assert.equal('booking_authority' in capturedConversationContext, false);
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
  assert.equal(result.reply, 'Saldo poin kamu 50 poin ya Kak.');
});

// ── B. booking -> member ──────────────────────────────────────────────────
test('B. membership registration question after an earlier branch mention: no handoff_url, no booking URL in the reply', async () => {
  const { capturedConversationContext, sentReply } = await runReddy({
    text: 'Saya tercatat sebagai member gak?',
    orchestrationDecision: { intent: 'customer_profile', route: 'crm_agent', conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact' },
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
    callOpenAI: async () => 'Kak Adhit sudah terdaftar sebagai member Redbox ya.',
  });

  assert.equal('booking_authority' in capturedConversationContext, false);
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
});

// ── C. booking -> profile ─────────────────────────────────────────────────
test('C. "data diri aku yang terdaftar" after a booking topic: no handoff_url, no booking URL in the reply', async () => {
  const { capturedConversationContext, sentReply } = await runReddy({
    text: 'Data diri aku yang terdaftar, coba kasih tau aku.',
    orchestrationDecision: { intent: 'customer_profile', route: 'crm_agent', conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact' },
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
    callOpenAI: async () => 'Nama yang tercatat: Adhit.',
  });

  assert.equal('booking_authority' in capturedConversationContext, false);
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
});

// ── D. service information ────────────────────────────────────────────────
test('D. "Down perm itu apa?" gets a service answer, no CTA/URL, since the current message has no booking intent of its own', async () => {
  const { capturedConversationContext, sentReply } = await runReddy({
    text: 'Down perm itu apa?',
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
  });

  assert.equal('booking_authority' in capturedConversationContext, false);
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
});

test('D2. a service question that ALSO expresses booking intent on the same turn IS CTA-eligible', async () => {
  const { capturedConversationContext } = await runReddy({
    text: 'Down perm itu apa? Aku mau booking besok.',
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
  });

  assert.equal('booking_authority' in capturedConversationContext, true);
});

// ── E. operating hours ────────────────────────────────────────────────────
test('E. "Bypass buka jam berapa?" gets hours only, no automatic booking CTA', async () => {
  const { capturedConversationContext, sentReply } = await runReddy({
    text: 'Bypass buka jam berapa?',
    orchestrationDecision: { intent: 'operating_hours_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
  });

  assert.equal('booking_authority' in capturedConversationContext, false);
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
});

// ── F. resume booking after a topic detour ────────────────────────────────
test('F. booking memory survives a points detour and resumes on "Oke balik booking, Onoy aja"', async () => {
  const { capturedConversationContext } = await runReddy({
    text: 'Oke balik booking, Onoy aja.',
    orchestrationDecision: { intent: 'booking_request', route: 'reddy_agent', conversational_act: 'barber_choice_followup', response_strategy: 'acknowledge_booking_context_without_commit' },
    conversationContext: context(
      { role: 'user', content: 'Besok mau potong di Bypass.' },
      { role: 'assistant', content: 'Saldo poin kamu 50 poin ya Kak.' },
      { role: 'user', content: 'Poin aku berapa?' },
    ),
  });

  assert.equal('booking_authority' in capturedConversationContext, true);
  const bookingContext = capturedConversationContext.booking_context;
  assert.equal(bookingContext.branch.value, 'bypass');
  assert.equal(bookingContext.barber.id, 'barber-onoy-id');
  assert.doesNotMatch(capturedConversationContext.booking_authority.handoff_url, /reserved=|confirmed=|available=/);
});

// ── G. unsupported attendance claim — deterministic guard, real execution path ──
test('G. "Mas Opan masuk hari ini gak?" — a hallucinated presence claim never reaches sendWA when no schedule source is available', async () => {
  const { sentReply } = await runReddy({
    text: 'Mas Opan masuk hari ini gak?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Iya Kak, Mas Opan ada hari ini.',
  });
  assert.doesNotMatch(sentReply, /Opan ada hari ini/i);
  assert.match(sentReply, /belum bisa memastikan/i);
});

// ── H. trusted schedule source — allowed wording is still bounded ────────────
test('H. a verified "scheduled" fact allows "dijadwalkan masuk hari ini" but still forbids upgrading to an attendance claim', async () => {
  const scheduledFixture = async () => ({ status: 'scheduled', source: 'barber_working_hours', date: '2026-08-29' });
  const { sentReply: scheduledReply } = await runReddy({
    text: 'Mas Opan masuk hari ini gak?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Opan dijadwalkan masuk hari ini di Samadikun, Kak.',
    getSchedule: scheduledFixture,
  });
  assert.match(scheduledReply, /dijadwalkan masuk hari ini/i);

  const { sentReply: upgradedReply } = await runReddy({
    text: 'Mas Opan masuk hari ini gak?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Opan sudah hadir sekarang di Samadikun, Kak.',
    getSchedule: scheduledFixture,
  });
  assert.doesNotMatch(upgradedReply, /sudah hadir/i);
  assert.match(upgradedReply, /belum bisa memastikan/i);
});

test('H2. a verified "not_scheduled" fact corrects a hallucinated positive presence claim', async () => {
  const { sentReply } = await runReddy({
    text: 'Mas Opan masuk hari ini gak?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Iya Kak, Opan ada hari ini kok.',
    getSchedule: async () => ({ status: 'not_scheduled', source: 'barber_working_hours', date: '2026-08-29' }),
  });
  assert.doesNotMatch(sentReply, /ada hari ini/i);
  assert.match(sentReply, /tidak tercatat dijadwalkan/i);
});

// ── REQUIRED TESTS — SCHEDULE BINDING (round 3, Blocker 1) ────────────────
// Direct unit tests against guardRealtimeBarberFacts for precision, plus one
// full executeReddyAgent-level test (round-3-D, the entity-binding case,
// which is the actual confirmed bug) proving it end to end.
test('round3-A: verifiedSchedule null — a "dijadwalkan" claim is blocked with safe uncertainty', () => {
  const { sanitizedReply, triggered } = guardRealtimeBarberFacts(
    'Mas Opan dijadwalkan masuk hari ini.',
    { verifiedSchedule: null },
  );
  assert.equal(triggered, true);
  assert.doesNotMatch(sanitizedReply, /dijadwalkan/i);
  assert.match(sanitizedReply, /belum bisa memastikan/i);
});

test('round3-B: verifiedSchedule not_scheduled for Opan — a "dijadwalkan" claim is blocked and corrected to the negative fact', () => {
  const { sanitizedReply, triggered } = guardRealtimeBarberFacts(
    'Mas Opan dijadwalkan masuk hari ini.',
    { verifiedSchedule: { barberName: 'Opan', status: 'not_scheduled', date: '2026-08-29' } },
  );
  assert.equal(triggered, true);
  // The correction legitimately reuses "dijadwalkan masuk" inside a NEGATED
  // sentence — assert the correct negative claim, not the absence of the
  // substring (which would also match the negated form).
  assert.match(sanitizedReply, /tidak tercatat dijadwalkan masuk hari ini/i);
});

test('round3-C: verifiedSchedule scheduled for Opan — "Opan dijadwalkan masuk hari ini" is allowed', () => {
  const { sanitizedReply, triggered } = guardRealtimeBarberFacts(
    'Opan dijadwalkan masuk hari ini di Samadikun, Kak.',
    { verifiedSchedule: { barberName: 'Opan', status: 'scheduled', date: '2026-08-29' } },
  );
  assert.equal(triggered, false);
  assert.equal(sanitizedReply, 'Opan dijadwalkan masuk hari ini di Samadikun, Kak.');
});

test('round3-D (entity binding — the confirmed bug): verifiedSchedule scheduled for Opan does NOT authorize a claim about Bob', () => {
  const { sanitizedReply, triggered } = guardRealtimeBarberFacts(
    'Mas Bob dijadwalkan masuk hari ini.',
    { verifiedSchedule: { barberName: 'Opan', status: 'scheduled', date: '2026-08-29' } },
  );
  assert.equal(triggered, true);
  assert.doesNotMatch(sanitizedReply, /Bob dijadwalkan/i);
});

test('round3-D2 (entity binding, full executeReddyAgent path): a schedule fact about Opan does not authorize the model claiming Bob is scheduled', async () => {
  const { sentReply } = await runReddy({
    text: 'Mas Opan masuk hari ini gak?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Bob dijadwalkan masuk hari ini kok, Kak.',
    getSchedule: async () => ({ status: 'scheduled', source: 'planned_schedule_lookup', date: '2026-08-29' }),
  });
  assert.doesNotMatch(sentReply, /Bob dijadwalkan/i);
  assert.match(sentReply, /belum bisa memastikan/i);
});

test('round3-E: verifiedSchedule scheduled for Opan still forbids an attendance-upgrade claim', () => {
  const { sanitizedReply, triggered } = guardRealtimeBarberFacts(
    'Mas Opan sudah hadir sekarang.',
    { verifiedSchedule: { barberName: 'Opan', status: 'scheduled', date: '2026-08-29' } },
  );
  assert.equal(triggered, true);
  assert.doesNotMatch(sanitizedReply, /sudah hadir/i);
});

test('round3: SCHEDULE_CLAIM_PATTERNS catches "ada jadwal hari ini" phrasing that PRESENCE_TODAY_PATTERNS alone would miss', () => {
  const { triggered } = guardRealtimeBarberFacts(
    'Mas Opan ada jadwal hari ini kok.',
    { verifiedSchedule: null },
  );
  assert.equal(triggered, true);
});

// ── I. roster wording ─────────────────────────────────────────────────────
test('I. a roster fact ("adalah barber Redbox ...") survives untouched, but "tersedia hari ini" on the same roster-only turn is rewritten', async () => {
  const { sentReply: rosterOnly } = await runReddy({
    text: 'Mas Onoy barber Bypass ya?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Betul Kak, Onoy adalah barber Redbox Bypass.',
  });
  assert.equal(rosterOnly, 'Betul Kak, Onoy adalah barber Redbox Bypass.');

  const { sentReply: falseAvailability } = await runReddy({
    text: 'Mas Onoy barber Bypass ya?',
    orchestrationDecision: { intent: 'barber_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Betul Kak, Onoy adalah barber Redbox Bypass. Onoy tersedia hari ini.',
  });
  assert.doesNotMatch(falseAvailability, /tersedia hari ini/i);
});

// ── J. slot UI inference boundary ─────────────────────────────────────────
test('J. the prompt forbids inferring why other slots are absent from the booking website without backend availability data', () => {
  assert.match(webhookSource, /INFERENSI SLOT WEBSITE/);
  assert.match(webhookSource, /DILARANG menyimpulkan alasannya \(misal "kemungkinan slot lain sudah penuh"\) tanpa data availability terverifikasi dari backend/);
});

// ── K. deterministic guard strips a CTA the model produced anyway ────────────
test('K. suppressUnsolicitedBookingCta strips only the booking-URL sentence, preserving the rest of a legitimate factual answer', () => {
  const modelReply = 'Saldo poin kamu 50 poin.\n\nUntuk booking silakan kunjungi redboxbarbershop.com/booking.html ya Kak.';
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: false });
  assert.equal(ctaSuppressed, true);
  assert.equal(sanitizedReply, 'Saldo poin kamu 50 poin.');
  assert.doesNotMatch(sanitizedReply, /redboxbarbershop\.com/i);

  // Eligible turns are never touched.
  const untouched = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: true });
  assert.equal(untouched.sanitizedReply, modelReply);
  assert.equal(untouched.ctaSuppressed, false);
});

test('K2. the deterministic guard runs inside the real executeReddyAgent path and reaches sendWA already stripped', async () => {
  const { sentReply, result } = await runReddy({
    text: 'Poin saya berapa?',
    orchestrationDecision: { intent: 'points_inquiry', route: 'crm_agent', conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact' },
    callOpenAI: async () => 'Saldo poin Kakak 50 poin.\n\nUntuk booking silakan kunjungi redboxbarbershop.com/booking.html.',
  });

  assert.equal(sentReply, 'Saldo poin Kakak 50 poin.');
  assert.equal(result.reply, 'Saldo poin Kakak 50 poin.');
});

test('K3. suppression never sends an empty message even if the whole reply was the CTA', () => {
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(
    'Untuk booking silakan kunjungi redboxbarbershop.com/booking.html.',
    { bookingCtaEligible: false },
  );
  assert.equal(ctaSuppressed, true);
  assert.ok(sanitizedReply.trim().length > 0);
});

// ── REQUIRED TESTS — CTA WITHOUT URL (round 3, Blocker 2) ──────────────────
// A booking-action CTA needs no URL at all to be a CTA.
test('round3-F: service info — a URL-less "langsung booking aja" CTA is stripped, the factual answer survives', () => {
  const modelReply = 'Down Perm membantu merapikan arah rambut.\nKalau cocok, langsung booking aja ya Kak.';
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: false });
  assert.equal(ctaSuppressed, true);
  assert.equal(sanitizedReply, 'Down Perm membantu merapikan arah rambut.');
});

test('round3-G: barber information — a URL-less "lanjut booking" CTA is stripped, the roster fact survives', () => {
  const modelReply = 'Iya, Mas Onoy barber Redbox Bypass.\nKalau mau, lanjut booking sama Mas Onoy ya.';
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: false });
  assert.equal(ctaSuppressed, true);
  assert.equal(sanitizedReply, 'Iya, Mas Onoy barber Redbox Bypass.');
});

test('round3-H: CRM — a URL-less "yuk booking" CTA is stripped, the points balance survives', () => {
  const modelReply = 'Saldo poin Kakak 50 poin.\nYuk booking lagi di Redbox.';
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: false });
  assert.equal(ctaSuppressed, true);
  assert.equal(sanitizedReply, 'Saldo poin Kakak 50 poin.');
});

test('round3: a URL-less booking-action CTA is also caught end-to-end through executeReddyAgent', async () => {
  const { sentReply } = await runReddy({
    text: 'Down perm itu apa?',
    orchestrationDecision: { intent: 'service_inquiry', route: 'reddy_agent', conversational_act: 'business_fact_question', response_strategy: 'answer_with_knowledge_fact' },
    callOpenAI: async () => 'Down Perm membantu merapikan arah rambut.\nKalau cocok, langsung booking aja ya Kak.',
  });
  assert.equal(sentReply, 'Down Perm membantu merapikan arah rambut.');
});

test('round3: legitimate explanatory use of "booking" is preserved when the turn is eligible', () => {
  // "Booking hanya bisa dilakukan lewat website." answering an eligible turn
  // (e.g. "Booking via WA bisa gak?") must never be touched — the guard is a
  // no-op whenever bookingCtaEligible is true, by construction.
  const modelReply = 'Booking hanya bisa dilakukan lewat website resmi ya Kak.';
  const { sanitizedReply, ctaSuppressed } = suppressUnsolicitedBookingCta(modelReply, { bookingCtaEligible: true });
  assert.equal(ctaSuppressed, false);
  assert.equal(sanitizedReply, modelReply);
});

// ── REQUIRED TEST — GUARD REINTRODUCTION (Blocker 2) ──────────────────────
// Must fail on the pre-correction HEAD and pass after: guardReddyReply's own
// availability-guard correction used to always embed the booking URL, even
// on an already-ineligible turn — reintroducing exactly what the upstream
// sanitizer had just removed.
test('REQUIRED: an availability-guard trigger on a non-booking turn never reintroduces a booking URL', async () => {
  const { sentReply } = await runReddy({
    text: 'Poin saya berapa?',
    orchestrationDecision: { intent: 'points_inquiry', route: 'crm_agent', conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact' },
    callOpenAI: async () => 'Jam 4 masih tersedia Kak.',
  });
  assert.doesNotMatch(sentReply, /redboxbarbershop\.com/i);
  assert.doesNotMatch(sentReply, /dicek real-time di website resmi/i); // the ELIGIBLE-turn phrasing, which embeds the URL
  assert.match(sentReply, /belum bisa memastikan ketersediaan/i);
});

// ── Blocker 1: deriveBookingEligibility — direct unit-test matrix ─────────
test('eligibility 1: "Down perm itu apa?" — responseEligible/ctaEligible false', () => {
  const r = deriveBookingEligibility({
    text: 'Down perm itu apa?',
    orchestrationDecision: { intent: 'service_inquiry', conversational_act: 'business_fact_question' },
  });
  assert.equal(r.responseEligible, false);
  assert.equal(r.ctaEligible, false);
  assert.equal(r.reason, 'informational_only');
});

test('eligibility 2: "Mas Onoy barber Bypass ya?" — the literal word "barber" does not grant CTA eligibility', () => {
  const r = deriveBookingEligibility({
    text: 'Mas Onoy barber Bypass ya?',
    orchestrationDecision: { intent: 'barber_inquiry', conversational_act: 'business_fact_question' },
  });
  assert.equal(r.responseEligible, false);
  assert.equal(r.ctaEligible, false);
});

test('eligibility 3: "Bypass buka jam berapa?" — ctaEligible false', () => {
  const r = deriveBookingEligibility({
    text: 'Bypass buka jam berapa?',
    orchestrationDecision: { intent: 'operating_hours_inquiry', conversational_act: 'business_fact_question' },
  });
  assert.equal(r.ctaEligible, false);
});

test('eligibility 4: "Mas Opan masuk hari ini?" — ctaEligible false (a real-time fact question, not a booking one)', () => {
  const r = deriveBookingEligibility({
    text: 'Mas Opan masuk hari ini?',
    orchestrationDecision: { intent: 'barber_inquiry', conversational_act: 'business_fact_question' },
  });
  assert.equal(r.ctaEligible, false);
});

test('eligibility 5: "Besok mau potong sama Onoy" — responseEligible and ctaEligible true', () => {
  const r = deriveBookingEligibility({
    text: 'Besok mau potong sama Onoy',
    orchestrationDecision: { intent: 'booking_request', conversational_act: 'booking_request' },
  });
  assert.equal(r.responseEligible, true);
  assert.equal(r.ctaEligible, true);
  assert.equal(r.reason, 'explicit_booking_request');
});

test('eligibility 6: "Bisa kirim link booking?" — ctaEligible true', () => {
  const r = deriveBookingEligibility({ text: 'Bisa kirim link booking?', orchestrationDecision: null });
  assert.equal(r.ctaEligible, true);
  assert.equal(r.reason, 'explicit_booking_link_request');
});

test('eligibility 7/8/9: points/member/profile questions are crm_topic, never eligible', () => {
  for (const [text, intent] of [
    ['Poin saya berapa?', 'points_inquiry'],
    ['Saya tercatat sebagai member gak?', 'customer_profile'],
    ['Data diri aku yang terdaftar, coba kasih tau aku.', 'customer_profile'],
  ]) {
    const r = deriveBookingEligibility({ text, orchestrationDecision: { intent, conversational_act: 'customer_fact_question' } });
    assert.equal(r.responseEligible, false, text);
    assert.equal(r.ctaEligible, false, text);
    assert.equal(r.reason, 'crm_topic', text);
  }
});

test('eligibility 10: booking -> points -> "Onoy aja" — memoryRelevant stays true across the detour, contextual continuation resumes eligibility', () => {
  const detour = deriveBookingEligibility({
    text: 'Poin aku berapa?',
    orchestrationDecision: { intent: 'points_inquiry', conversational_act: 'customer_fact_question' },
  });
  assert.equal(detour.responseEligible, false);

  const resume = deriveBookingEligibility({
    text: 'Onoy aja.',
    orchestrationDecision: { intent: 'unknown', conversational_act: 'barber_choice_followup' },
  });
  assert.equal(resume.memoryRelevant, true);
  assert.equal(resume.responseEligible, true);
  assert.equal(resume.reason, 'contextual_booking_continuation');
});

test('eligibility 11: guardReddyReply availability correction — see REQUIRED test above (executeReddyAgent-level)', () => {
  // Covered end-to-end above; this entry keeps the numbering explicit.
  assert.ok(true);
});

test('eligibility 12: informational barber question containing the literal word "barber" must not become CTA eligible (helper + memory layer both checked)', () => {
  const r = deriveBookingEligibility({
    text: 'Mas Onoy barber Bypass ya?',
    orchestrationDecision: { intent: 'barber_inquiry', conversational_act: 'business_fact_question' },
  });
  assert.equal(r.ctaEligible, false);
  // Memory MAY be true (the word "barber" is allowed to feed the broad
  // memory layer) — that is fine and expected, per Blocker 1's own rule.
  assert.equal(r.memoryRelevant, true);
});

test('memoryRelevant stays broad on plain booking vocabulary while response/CTA stay narrow', () => {
  const r = deriveBookingEligibility({ text: 'Kapster di Bypass siapa aja ya?', orchestrationDecision: { intent: 'barber_inquiry' } });
  assert.equal(r.memoryRelevant, true);
  assert.equal(r.responseEligible, false);
});

// ── Blocker 1: memory / response / CTA eligibility are structurally separate ──
test('reddyAdapter.js no longer contains the flagged conversationContext?.booking_context OR-clause', () => {
  const adapterSource = fs.readFileSync(path.resolve(__dirname, '../agents/reddy/reddyAdapter.js'), 'utf8');
  assert.doesNotMatch(adapterSource, /bookingSignal \|\| bookingMetadata \|\| conversationContext\?\.booking_context/);
  assert.match(adapterSource, /bookingMemoryRelevant/);
  assert.match(adapterSource, /bookingResponseEligible/);
  assert.match(adapterSource, /bookingCtaEligible/);
});

// ── Root-cause regression (orchestrator classification hijack) ───────────────
test('root cause: a short reply after ANY earlier branch mention no longer forces booking_request when the current message has its own specific intent', () => {
  const shortClearlyUnrelatedMessages = [
    'Saya tercatat sebagai member gak?',
    'Poin saya berapa?',
  ];
  return Promise.all(shortClearlyUnrelatedMessages.map(async (message) => {
    const decision = await orchestrateMessage({
      message,
      conversationContext: context({ role: 'user', content: 'Besok mau potong di Bypass.' }),
    }, { classifier: classifier('customer_profile', 'crm_agent', 'get_customer_profile') });
    assert.notEqual(decision.conversational_act, 'branch_choice_followup', message);
  }));
});

// ── Membership reconciliation ─────────────────────────────────────────────
test('membership: only owner-confirmed / cross-source-consistent facts are asserted; disputed rules are flagged, not guessed', () => {
  const tiers = Object.fromEntries(REDBOX_KNOWLEDGE.membership_public.tiers.map((t) => [t.id, t]));

  // Locked by the owner during this incident.
  assert.match(tiers.platinum.benefits.join(' '), /Gratis Americano/);

  // Consistent across every audited source — safe to assert as fact.
  assert.match(tiers.gold.benefits.join(' '), /Diskon 10% haircut/);
  assert.match(tiers.silver.benefits.join(' '), /Diskon ulang tahun 50%/);
  assert.match(tiers.platinum.benefits.join(' '), /Gratis Haircut\/Gentleman Grooming/);

  // Disputed points must NOT appear as asserted fact in .benefits.
  assert.doesNotMatch(tiers.silver.benefits.join(' '), /5%/);
  assert.doesNotMatch(tiers.gold.benefits.join(' '), /CSB/);
  assert.doesNotMatch(tiers.platinum.benefits.join(' '), /ulang tahun/i);

  // But they are not silently dropped either — flagged for a human to resolve.
  assert.ok(tiers.silver.disputed_benefits?.length, 'silver disputed general discount must be flagged');
  assert.ok(tiers.gold.disputed_benefits?.length, 'gold disputed CSB scope must be flagged');
  assert.ok(tiers.platinum.disputed_benefits?.length, 'platinum disputed birthday % must be flagged');
});

test('membership: prompt instructs Reddy to defer disputed benefit details to a human rather than stating a number', () => {
  assert.match(webhookSource, /BENEFIT YANG MASIH DIPERSELISIHKAN/);
  assert.match(webhookSource, /DILARANG menyebutkan angka atau cakupan pasti untuk item ini/);
});

test('a general (non-private) platinum benefit question resolves the full public tier list, disputed items included', () => {
  const knowledgeContext = resolveKnowledgeContext({ intent: 'membership_inquiry', text: 'Benefit platinum apa aja?', branch: 'bypass' });
  const membershipFact = knowledgeContext.facts.find((f) => f.category === 'membership_public');
  assert.ok(membershipFact, 'membership_public fact must be present');
  const platinum = membershipFact.tiers.find((t) => t.id === 'platinum');
  assert.deepEqual(platinum.benefits, REDBOX_KNOWLEDGE.membership_public.tiers.find((t) => t.id === 'platinum').benefits);
  assert.ok(platinum.disputed_benefits.length > 0);
});

test('unsupported benefit assertion never gets affirmed by prompt design; "pijat" never appears in canonical Platinum benefits', () => {
  assert.match(webhookSource, /JANGAN membenarkan klaim tersebut/);
  const platinum = REDBOX_KNOWLEDGE.membership_public.tiers.find((t) => t.id === 'platinum');
  assert.doesNotMatch(platinum.benefits.join(' '), /pijat/i);
});

// ── Generic ending — already covered end-to-end in reddy-conversation-policy-v01.test.js ──
test('generic reopening endings remain explicitly prohibited in the system prompt', () => {
  assert.match(webhookSource, /DILARANG mengakhiri pesan dengan pertanyaan generik berulang/);
  assert.match(webhookSource, /Ada yang ingin ditanyakan lagi\?/);
});

// ── §4: CRM factual answers must stop cleanly ─────────────────────────────
test('CRM-stop coverage: the no-CTA list explicitly names every private/factual intent from spec §2, not just points', () => {
  assert.match(webhookSource, /DILARANG OVERSELL/);
  assert.match(webhookSource, /points_inquiry, customer_profile, customer_history, customer_preferences, customer_transaction_history, membership_inquiry/);
});

// ── Task 14 non-regression ────────────────────────────────────────────────
test('Task 14 non-regression: booking authority prompt block still exists unchanged in shape', () => {
  assert.match(webhookSource, /BOOKING INTELLIGENCE — ASSIST & GUIDE ONLY/);
  assert.match(webhookSource, /DILARANG menyatakan booking dibuat, slot diamankan, barber dikunci/);
});
