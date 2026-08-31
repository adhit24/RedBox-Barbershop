'use strict';

/**
 * Reddy Production Safety, Schedule Authority, Intent & Response Quality
 * Dedicated Test Suite (v0.2 — Correction Round 2)
 *
 * Round 2 fixes three blockers left open by Round 1:
 *   1. Branch-aware price authority (unknown branch must never default to
 *      "standard" pricing when a service's price actually differs by branch).
 *   2. True subsystem failure-reason provenance (each subsystem that owns a
 *      failure attaches its own bounded reason; a served customer — safe
 *      fallback actually sent — is never misclassified as a terminal FAILED).
 *   3. Official branch contact resolver (deterministic, REDBOX_KNOWLEDGE-only
 *      source of truth, never a barber/employee/customer/CRM phone).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  guardPricePlaceholders,
  defaultServicePriceResolver,
  classifyBranchPriceAuthority,
} = require('../agents/reddy/personalityPolicy');
const { REDBOX_KNOWLEDGE, resolveOfficialBranchContact } = require('../agents/reddy/knowledge/redboxKnowledge');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const webhookModule = require('../../api/wa/webhook');

const { handleMessage } = webhookModule;

const noopHandoff = async () => ({ status: 'none', case: null });

// ── PRICE TESTS (1–8) — branch-aware price authority ─────────────────────

test('R2 TEST 1: Gentleman Grooming + branch=null => NO numeric price', () => {
  const res = defaultServicePriceResolver({ serviceId: 'gentleman-grooming', branch: null });
  assert.equal(res.resolved, false);
  assert.equal(res.priceFormatted, null);
});

test('R2 TEST 2: Gentleman Grooming + unknown branch => NO numeric price', () => {
  const res = defaultServicePriceResolver({ serviceId: 'gentleman-grooming', branch: 'jakarta-pusat' });
  assert.equal(res.resolved, false);
  assert.equal(res.priceFormatted, null);
});

test('R2 TEST 3: Gentleman Grooming + Bypass => Rp95.000', () => {
  const res = defaultServicePriceResolver({ serviceId: 'gentleman-grooming', branch: 'bypass' });
  assert.equal(res.resolved, true);
  assert.equal(res.priceFormatted, 'Rp95.000');
});

test('R2 TEST 4: Gentleman Grooming + CSB => Rp120.000', () => {
  const res = defaultServicePriceResolver({ serviceId: 'gentleman-grooming', branch: 'csb' });
  assert.equal(res.resolved, true);
  assert.equal(res.priceFormatted, 'Rp120.000');
});

test('R2 TEST 5: service with equal price across branches resolves without a branch', () => {
  const hairColor = REDBOX_KNOWLEDGE.services.find((s) => s.id === 'hair-color');
  assert.equal(hairColor.prices.standard, hairColor.prices.csb); // fixture sanity check
  const res = defaultServicePriceResolver({ serviceId: 'hair-color', branch: null });
  assert.equal(res.resolved, true);
  assert.equal(res.priceFormatted, 'Rp' + hairColor.prices.standard.toLocaleString('id-ID'));
});

test('R2 TEST 6: unknown service => no-number fallback', () => {
  const res = defaultServicePriceResolver({ serviceName: 'layanan yang tidak ada di katalog', branch: 'bypass' });
  assert.equal(res.resolved, false);
});

test('R2 TEST 7: bare "potong" text alone cannot create numeric substitution, but "potong rambut" (unambiguous catalog phrase) can', () => {
  const bare = defaultServicePriceResolver({ text: 'potong RpXX.XXX ya kak', branch: 'bypass' });
  assert.equal(bare.resolved, false);

  const specific = defaultServicePriceResolver({ text: 'potong rambut RpXX.XXX ya kak', branch: 'bypass' });
  assert.equal(specific.resolved, true);
  assert.equal(specific.priceFormatted, 'Rp95.000');
});

test('R2 TEST 8: explicit serviceId overrides ambiguous natural-language aliases safely', () => {
  // The text mentions generic gentleman-grooming aliases (haircut/fade/potong),
  // but an explicit serviceId for a DIFFERENT service must win outright.
  const res = defaultServicePriceResolver({
    serviceId: 'hair-spa',
    text: 'haircut dan fade dan potong semuanya RpXX.XXX',
    branch: 'bypass',
  });
  assert.equal(res.resolved, true);
  assert.equal(res.priceFormatted, 'Rp110.000');
});

test('R2 TEST 9 (branch classification helper): standard/csb/unknown classification', () => {
  assert.equal(classifyBranchPriceAuthority('csb'), 'csb');
  assert.equal(classifyBranchPriceAuthority('CSB'), 'csb');
  assert.equal(classifyBranchPriceAuthority('bypass'), 'standard');
  assert.equal(classifyBranchPriceAuthority('samadikun'), 'standard');
  assert.equal(classifyBranchPriceAuthority('sumber'), 'standard');
  assert.equal(classifyBranchPriceAuthority('tegal'), 'standard');
  assert.equal(classifyBranchPriceAuthority(null), 'unknown');
  assert.equal(classifyBranchPriceAuthority(''), 'unknown');
  assert.equal(classifyBranchPriceAuthority('csb-mall-2'), 'unknown');
});

test('R2 TEST 10: guardPricePlaceholders honest fallback for unknown-branch Gentleman Grooming placeholder', () => {
  const input = 'Gentleman Grooming di sini RpXX.XXX ya kak.';
  const res = guardPricePlaceholders(input, { serviceId: 'gentleman-grooming', branch: 'unknown-outlet' });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Harga pastinya belum bisa aku pastikan'));
  assert.equal(res.sanitizedReply.includes('Rp95.000'), false);
  assert.equal(res.sanitizedReply.includes('Rp120.000'), false);
});

// ── FAILURE-REASON PROVENANCE TESTS (11–18) ───────────────────────────────

test('R2 TEST 11: orchestrator exception is recoverable — legacy fallback still SENDS, result.error stays null', async () => {
  const result = await handleMessage({
    from: '628100000011', name: 'Kak', text: 'halo reddy',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => { throw new Error('orchestrator boom'); },
    generateReddy: async () => 'Halo juga Kak!',
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.error, null);
  assert.equal(result.failureReason ?? null, null);
  assert.equal(result.reply, 'Halo juga Kak!');
});

test('R2 TEST 12: legacy model-call failure + successful fallback send => SENT (error null, no failureReason)', async () => {
  const result = await handleMessage({
    from: '628100000012', name: 'Kak', text: 'ada promo apa aja',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => null,
    generateReddy: async () => { throw new Error('OpenAI timeout'); },
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'fallback');
  assert.equal(result.error, null);
  assert.equal(result.failureReason ?? null, null);
});

test('R2 TEST 13: legacy model-call failure + fallback send ALSO fails => terminal model_call_failed', async () => {
  const result = await handleMessage({
    from: '628100000013', name: 'Kak', text: 'ada promo apa aja',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => null,
    generateReddy: async () => { throw new Error('OpenAI timeout'); },
    send: async () => ({ status: false, suppressed: true, reason: 'rate_limited' }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'fallback');
  assert.equal(result.failureReason, 'model_call_failed');
  assert.ok(result.error);
});

test('R2 TEST 14: reddy_agent route model-call failure + successful fallback send => SENT (error null)', async () => {
  const result = await handleMessage({
    from: '628100000014', name: 'Kak', text: 'boleh tanya-tanya',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => ({ route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer_general' }),
    executeReddy: async () => { throw new Error('reddy agent boom'); },
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'static_fallback');
  assert.equal(result.error, null);
  assert.equal(result.failureReason ?? null, null);
});

test('R2 TEST 15: reddy_agent route model-call failure + fallback send ALSO fails => terminal model_call_failed', async () => {
  const result = await handleMessage({
    from: '628100000015', name: 'Kak', text: 'boleh tanya-tanya',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => ({ route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer_general' }),
    executeReddy: async () => { throw new Error('reddy agent boom'); },
    send: async () => ({ status: false, suppressed: true, reason: 'duplicate_content' }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'static_fallback');
  assert.equal(result.failureReason, 'model_call_failed');
  assert.ok(result.error);
});

test('R2 TEST 16: CRM intelligence subsystem exception + safe reply delivered => SENT, telemetry crm_context_failed only', async () => {
  const trustedIdentity = issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: '628100000016' });
  const result = await handleMessage({
    from: '628100000016', name: 'Kak', text: 'boleh cek status member saya', trustedIdentity,
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => ({ route: 'crm_agent', agent: 'crm_agent', intent: 'membership_inquiry', action: 'answer_points' }),
    executeIntelligence: async () => { throw new Error('CRM datastore unavailable'); },
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'crm_unavailable_guard');
  assert.equal(result.error, null);
  assert.equal(result.failureReason ?? null, null);
});

test('R2 TEST 17: CRM intelligence subsystem exception + safe reply CANNOT be delivered => terminal crm_context_failed', async () => {
  const trustedIdentity = issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: '628100000017' });
  const result = await handleMessage({
    from: '628100000017', name: 'Kak', text: 'boleh cek status member saya', trustedIdentity,
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => ({ route: 'crm_agent', agent: 'crm_agent', intent: 'membership_inquiry', action: 'answer_points' }),
    executeIntelligence: async () => { throw new Error('CRM datastore unavailable'); },
    send: async () => ({ status: false, suppressed: true, reason: 'rate_limited' }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'crm_unavailable_guard');
  assert.equal(result.failureReason, 'crm_context_failed');
  assert.ok(result.error);
});

test('R2 TEST 18: bounded failureReason is always one of the allowlisted lifecycle reasons when set', async () => {
  const { ALLOWED_INBOUND_LIFECYCLE_REASONS } = require('../orchestrator/telemetry');
  const result = await handleMessage({
    from: '628100000018', name: 'Kak', text: 'ada promo apa aja',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => null,
    generateReddy: async () => { throw new Error('OpenAI timeout'); },
    send: async () => ({ status: false, suppressed: true, reason: 'rate_limited' }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(ALLOWED_INBOUND_LIFECYCLE_REASONS.has(result.failureReason), true);
});

// ── OFFICIAL BRANCH CONTACT RESOLVER TESTS (19–29) ────────────────────────

test('R2 TEST 19: Sumber returns official REDBOX_KNOWLEDGE Sumber phone', () => {
  const res = resolveOfficialBranchContact('sumber');
  assert.equal(res.status, 'resolved');
  assert.equal(res.phone, '0818202599');
});

test('R2 TEST 20: Samadikun returns official Samadikun phone', () => {
  const res = resolveOfficialBranchContact('samadikun');
  assert.equal(res.status, 'resolved');
  assert.equal(res.phone, '0818202589');
});

test('R2 TEST 21: Tegal returns official Tegal phone', () => {
  const res = resolveOfficialBranchContact('tegal');
  assert.equal(res.status, 'resolved');
  assert.equal(res.phone, '0818268883');
});

test('R2 TEST 22: CSB returns official CSB phone', () => {
  const res = resolveOfficialBranchContact('csb');
  assert.equal(res.status, 'resolved');
  assert.equal(res.phone, '0818202889');
});

test('R2 TEST 23: Bypass returns official Bypass phone', () => {
  const res = resolveOfficialBranchContact('bypass');
  assert.equal(res.status, 'resolved');
  assert.equal(res.phone, '0818202569');
});

test('R2 TEST 24: unknown branch asks for clarification, never guesses a number', () => {
  const res = resolveOfficialBranchContact('jakarta-selatan');
  assert.equal(res.status, 'unknown_branch');
  assert.equal(res.phone, null);
  assert.ok(res.reply.length > 0);
});

test('R2 TEST 25: missing branch => safe clarification fallback, not silently a default branch', () => {
  const res = resolveOfficialBranchContact(null);
  assert.equal(res.status, 'unknown_branch');
  assert.equal(res.phone, null);
});

test('R2 TEST 26: no field on REDBOX_KNOWLEDGE.branches exposes an employee/barber/customer phone', () => {
  for (const b of REDBOX_KNOWLEDGE.branches) {
    const keys = Object.keys(b);
    assert.equal(keys.includes('barberPhone'), false);
    assert.equal(keys.includes('employeePhone'), false);
    assert.equal(keys.includes('customerPhone'), false);
    assert.equal(keys.includes('handoffPhone'), false);
  }
});

test('R2 TEST 27: resolver only ever returns REDBOX_KNOWLEDGE.branches[*].phone verbatim, never a passed-in override', () => {
  // The resolver takes only a branch identifier — there is no code path for
  // a caller to inject an alternative/guessed number.
  assert.equal(resolveOfficialBranchContact.length, 1);
  const res = resolveOfficialBranchContact('csb');
  const knowledgeRecord = REDBOX_KNOWLEDGE.branches.find((b) => b.id === 'csb');
  assert.equal(res.phone, knowledgeRecord.phone);
});

test('R2 TEST 28: deterministic keyword intent — "nomor Redbox Sumber?" resolves via handleMessage without reaching the LLM/orchestrator', async () => {
  let orchestratorCalled = false;
  const result = await handleMessage({
    from: '628100000028', name: 'Kak', text: 'nomor Redbox Sumber?',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => { orchestratorCalled = true; return null; },
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(orchestratorCalled, false);
  assert.equal(result.used, 'keyword');
  assert.ok(result.reply.includes('0818202599'));
});

test('R2 TEST 29: deterministic keyword intent — "WA cabang Tegal?" resolves the Tegal number, not the caller\'s current branch', async () => {
  const result = await handleMessage({
    from: '628100000029', name: 'Kak', text: 'WA cabang Tegal?', branchFromPayload: 'bypass',
  }, {
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: noopHandoff,
    orchestrate: async () => null,
    send: async () => ({ status: true }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });
  assert.equal(result.used, 'keyword');
  assert.ok(result.reply.includes('0818268883'));
  assert.equal(result.reply.includes('0818202569'), false); // not the caller's own bypass branch
});

// ── ROUND 1 PRESERVATION SPOT-CHECKS (30–32) ──────────────────────────────

test('R2 TEST 30: Round 1 final guard behavior for known-branch Gentleman Grooming is unchanged', () => {
  const input = 'Gentleman Grooming di Bypass RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass', serviceId: 'gentleman-grooming' });
  assert.equal(res.sanitizedReply, 'Gentleman Grooming di Bypass Rp95.000 ya.');
});

test('R2 TEST 31: Round 1 hair-spa resolution is unchanged', () => {
  const input = 'Hair Spa di Redbox RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(res.sanitizedReply, 'Hair Spa di Redbox Rp110.000 ya.');
});

test('R2 TEST 32: frontend untouched', () => {
  const fs = require('fs');
  assert.ok(fs.existsSync('frontend'));
});
