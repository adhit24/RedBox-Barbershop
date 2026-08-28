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
];
function trustedBarberLoader() {
  return Promise.resolve({ status: 'verified', barbers: canonicalBarbers, reason: null });
}

async function runReddy({ from = '628100000001', text, orchestrationDecision, conversationContext = null, callOpenAI }) {
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

// ── G. unsupported attendance claim (prompt-level — no schedule source exists) ──
test('G. the prompt unconditionally forbids stating a barber is present/working today without verified schedule/attendance evidence', () => {
  assert.match(webhookSource, /BATAS FAKTA REAL-TIME/);
  assert.match(webhookSource, /TANPA sumber jadwal\/kehadiran hari ini yang terverifikasi: DILARANG menyatakan/);
  assert.match(webhookSource, /"\[nama\] ada di cabang hari ini", "\[nama\] masuk", "\[nama\] sedang bertugas", atau "\[nama\] tersedia hari ini"/);
});

// ── H. trusted schedule source — allowed wording is still bounded ────────────
test('H. IF a verified schedule fact is ever supplied, the prompt still forbids upgrading "scheduled" to "already present" without separate attendance evidence', () => {
  assert.match(webhookSource, /boleh menyatakan "\[nama\] dijadwalkan masuk hari ini"/);
  assert.match(webhookSource, /TAPI tetap DILARANG meng-upgrade klaim itu menjadi "\[nama\] sudah hadir\/ada sekarang"/);
});

// ── I. roster wording ─────────────────────────────────────────────────────
test('I. canonical barber roster answers must not use "tersedia"/"masuk hari ini" wording — roster is not a daily status', () => {
  assert.match(webhookSource, /DAFTAR KAPSTER CABANG bersifat ROSTER, BUKAN status hari ini/);
  assert.match(webhookSource, /DILARANG memakai kata "tersedia", "available", "masuk hari ini", "ada hari ini", atau "sedang bertugas" untuk daftar roster biasa/);
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
