'use strict';

/**
 * Task 14.1 — Reddy Context Isolation & Membership Knowledge Hotfix
 * Production repro tests (spec §9 A-G) plus direct coverage of the canonical
 * membership data and the anti-fabrication prompt guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { orchestrateMessage } = require('../orchestrator/orchestratorService');
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

// ── A. Booking -> points topic switch (real deterministic classifier — no mock) ──
test('A. points question after an earlier branch mention answers points_inquiry, not booking', async () => {
  const decision = await orchestrateMessage({
    message: 'Poin saya terakhir berapa?',
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
  });

  assert.equal(decision.intent, 'points_inquiry');
  assert.equal(decision.route, 'crm_agent');
  assert.notEqual(decision.conversational_act, 'branch_choice_followup');
  assert.notEqual(decision.response_strategy, 'acknowledge_booking_context_without_commit');
});

// ── B. Booking -> membership switch ───────────────────────────────────────────
test('B. membership registration question after an earlier branch mention answers customer_profile, not booking', async () => {
  const decision = await orchestrateMessage({
    message: 'Saya tercatat sebagai member gak?',
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
  }, { classifier: classifier('customer_profile', 'crm_agent', 'get_customer_profile') });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.notEqual(decision.conversational_act, 'branch_choice_followup');
  assert.notEqual(decision.response_strategy, 'acknowledge_booking_context_without_commit');
});

// ── C. Booking -> customer profile ────────────────────────────────────────────
test('C. "data diri aku yang terdaftar" after a booking topic answers customer_profile, not a booking CTA', async () => {
  const decision = await orchestrateMessage({
    message: 'Data diri aku yang terdaftar, coba kasih tau aku.',
    conversationContext: context({ role: 'user', content: 'Besok mau potong di CSB.' }),
  }, { classifier: classifier('customer_profile', 'crm_agent', 'get_customer_profile') });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.notEqual(decision.conversational_act, 'branch_choice_followup');
});

// ── D. Return to booking after a temporary topic switch ───────────────────────
test('D. after switching to points and back, a bare barber name still resumes booking safely (no memory deletion)', async () => {
  const decision = await orchestrateMessage({
    message: 'Oke balik lagi, Onoy aja.',
    conversationContext: context(
      { role: 'user', content: 'Besok mau potong di CSB.' },
      { role: 'assistant', content: 'Saldo poin kamu 50 poin ya Kak.' },
      { role: 'user', content: 'Poin aku berapa?' },
    ),
  }, { classifier: classifier('general_question') });

  // The exact sub-classification (barber vs branch continuation) can depend on
  // punctuation shape, but the outcome that matters is: booking resumes as a
  // safe, no-commit continuation — the topic detour did not wipe the memory.
  assert.equal(decision.intent, 'booking_request');
  assert.equal(decision.continuation_type, 'contextual');
  assert.deepEqual(decision.prohibited_claims.includes('reservation_confirmed'), true);
  assert.equal(decision.response_strategy, 'acknowledge_booking_context_without_commit');
});

// ── Root-cause regression: the exact production trigger conditions ───────────
test('root cause: a short reply after ANY earlier branch mention no longer forces booking_request when the current message has its own specific intent', () => {
  // This is the literal mechanism Bug A reproduced: priorBranchChoice becomes
  // true the moment any earlier turn merely mentions a branch name, and the
  // old unconditioned fallback treated every short subsequent message as a
  // branch continuation regardless of what it actually said.
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

// ── E. Membership benefit canonical truth ─────────────────────────────────────
test('E. canonical membership tiers match public/membership.html exactly — no invented benefit', () => {
  const tiers = Object.fromEntries(REDBOX_KNOWLEDGE.membership_public.tiers.map((t) => [t.id, t]));

  assert.deepEqual(tiers.silver.benefits, [
    'Diskon 5% haircut (tidak berlaku di cabang CSB Mall).',
    'Diskon ulang tahun 50% (-7 hari s/d +7 hari dari tanggal lahir).',
  ]);
  assert.equal(tiers.silver.price_idr, 100000);
  assert.equal(tiers.silver.branch_applicability, 'all_branches_except_csb');

  assert.deepEqual(tiers.gold.benefits, [
    'Diskon 10% haircut, berlaku di semua cabang Redbox.',
    'Diskon ulang tahun 50% (-7 hari s/d +7 hari dari tanggal lahir).',
  ]);
  assert.equal(tiers.gold.price_idr, 250000);
  assert.equal(tiers.gold.branch_applicability, 'all_branches');

  assert.deepEqual(tiers.platinum.benefits, [
    'Gratis Haircut/Gentleman Grooming, berlaku di semua cabang Redbox.',
    'Gratis ulang tahun (-7 hari s/d +7 hari dari tanggal lahir).',
    'Gratis Americano.',
  ]);
  assert.equal(tiers.platinum.price_idr, 1500000);
  assert.equal(tiers.platinum.uses_points, false);
  assert.equal(tiers.platinum.branch_applicability, 'all_branches');
});

test('E2. a general (non-private) platinum benefit question resolves the full public tier list', () => {
  const knowledgeContext = resolveKnowledgeContext({ intent: 'membership_inquiry', text: 'Benefit platinum apa aja?', branch: 'bypass' });
  const membershipFact = knowledgeContext.facts.find((f) => f.category === 'membership_public');
  assert.ok(membershipFact, 'membership_public fact must be present');
  const platinum = membershipFact.tiers.find((t) => t.id === 'platinum');
  assert.deepEqual(platinum.benefits, REDBOX_KNOWLEDGE.membership_public.tiers.find((t) => t.id === 'platinum').benefits);
});

// ── F. Unsupported benefit assertion never gets affirmed by prompt design ────
test('F. the system prompt instructs Reddy to reject an unsupported membership benefit claim rather than affirm it', () => {
  assert.match(webhookSource, /BENEFIT MEMBERSHIP HANYA DARI DAFTAR TERVERIFIKASI/);
  assert.match(webhookSource, /JANGAN membenarkan klaim tersebut/);
  // "pijat" (massage) is the literal example claim in spec §9-F and must not
  // appear anywhere in the canonical Platinum benefit list.
  const platinum = REDBOX_KNOWLEDGE.membership_public.tiers.find((t) => t.id === 'platinum');
  assert.doesNotMatch(platinum.benefits.join(' '), /pijat/i);
});

// ── G. Generic ending — covered end-to-end in reddy-conversation-policy-v01.test.js ──
test('G. generic reopening endings remain explicitly prohibited in the system prompt', () => {
  assert.match(webhookSource, /DILARANG mengakhiri pesan dengan pertanyaan generik berulang/);
  assert.match(webhookSource, /Ada yang ingin ditanyakan lagi\?/);
});

// ── §4: CRM factual answers must stop cleanly — the full intent list, not just points ──
test('CRM-stop coverage: the no-CTA list explicitly names every private/factual intent from spec §2, not just points', () => {
  assert.match(webhookSource, /DILARANG OVERSELL/);
  assert.match(webhookSource, /points_inquiry, customer_profile, customer_history, customer_preferences, customer_transaction_history, membership_inquiry/);
});

// ── Task 14 non-regression: booking authority language untouched ─────────────
test('Task 14 non-regression: booking authority prompt block still exists unchanged in shape', () => {
  assert.match(webhookSource, /BOOKING INTELLIGENCE — ASSIST & GUIDE ONLY/);
  assert.match(webhookSource, /DILARANG menyatakan booking dibuat, slot diamankan, barber dikunci/);
});
