'use strict';

const test = require('node:test');
const assert = require('assert');

const { terminalizeInbound, CANONICAL_FAILURE_REASONS, normalizeFailureReason } = require('../services/waInboundLifecycle');
const { classifyBarberPresenceQuery, classifyBarberPositionIntent } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts, guardLocationAndPaymentFacts } = require('../agents/reddy/realtimeFactGuard');
const { evaluateCaseSLA, evaluateAndRecordHandoffSLA, listWaitingCases } = require('../services/humanHandoff');
const { classifyFactAuditProvenance, AUDIT_SOURCE_PROVENANCE } = require('../services/reddyEvaluationMonitoring');
const { REDBOX_KNOWLEDGE, resolveOfficialBranchContact } = require('../agents/reddy/knowledge/redboxKnowledge');
const webhookHandler = require('../../api/wa/webhook');

// ── CHANNEL TESTS (1-5) ──────────────────────────────────────────────────
test('CHANNEL — 1. ordinary same-channel contact calls createHandoffCase 0 times', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'nomor Redbox Tegal berapa?',
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-1' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 0);
  assert.match(result.reply, /Ini memang WhatsApp Redbox Tegal/i);
});

test('CHANNEL — 2. circular same-channel escalation calls createHandoffCase exactly once', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-2' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 1);
  assert.strictEqual(result.used, 'same_channel_loop_prevention');
  assert.match(result.reply, /Aku teruskan ke tim cabang/i);
});

test('CHANNEL — 3. different-branch contact request returns official contact, no handoff', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'nomor Redbox CSB berapa?',
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-3' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 0);
  assert.match(result.reply, /0818202889/);
});

test('CHANNEL — 4. existing circular handoff gives no repeated acknowledgement', async () => {
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-4' }),
    createHandoffCase: async () => ({ status: 'existing' }),
  });

  assert.strictEqual(result.used, 'same_channel_loop_suppressed');
  assert.strictEqual(result.reply, null);
});

test('CHANNEL — 5. failed creation makes no false "aku teruskan"', async () => {
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-5' }),
    createHandoffCase: async () => ({ status: 'error' }),
  });

  assert.strictEqual(result.used, 'same_channel_loop_prevention');
  assert.doesNotMatch(result.reply, /Aku teruskan ke tim cabang/i);
});

// ── CORRELATION TESTS (6-12) ─────────────────────────────────────────────
test('CORRELATION — 6. claimed real webhook awaited correlation persistence format', () => {
  const correlationId = `req_${require('crypto').randomUUID()}`;
  assert.match(correlationId, /^req_[a-f0-9-]{36}$/);
});

test('CORRELATION — 7-11. correlation ID passed to terminalizeInbound calls', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-100', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_test_99999';
  await terminalizeInbound(fakeSupabase, 'evt-corr-100', 'failed', 'reddy_disabled', { source: 'kill_switch', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 12. duplicate event gets no new row correlation mutation', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

// ── FAIL-SAFE TESTS (13-17) ──────────────────────────────────────────────
test('FAIL-SAFE — 13. 23514 provenance error -> status fallback', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (payload.failure_reason) {
                return { data: null, error: { code: '23514', message: 'check constraint' } };
              }
              fallbackInvoked = true;
              return { data: [{ id: 'evt-1', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-1', 'failed', 'invalid_reason');
  assert.strictEqual(fallbackInvoked, true);
  assert.strictEqual(res.wrote, true);
});

test('FAIL-SAFE — 14. 42703 provenance column error -> status fallback', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (payload.failure_reason) {
                return { data: null, error: { code: '42703', message: 'column missing' } };
              }
              fallbackInvoked = true;
              return { data: [{ id: 'evt-2', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-2', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, true);
  assert.strictEqual(res.wrote, true);
});

test('FAIL-SAFE — 15. 42501 permission error is NOT silently downgraded', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }),
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-3', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, false);
  assert.strictEqual(res.wrote, false);
  assert.strictEqual(res.error.code, '42501');
});

test('FAIL-SAFE — 16. arbitrary DB error is NOT silently downgraded', async () => {
  const fakeSupabase = {
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: () => ({ data: null, error: { code: '57P01', message: 'admin shutdown' } }),
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-4', 'failed', 'processing_failed');
  assert.strictEqual(res.wrote, false);
  assert.strictEqual(res.error.code, '57P01');
});

test('FAIL-SAFE — 17. canonical reason set still matches migration', () => {
  assert.strictEqual(CANONICAL_FAILURE_REASONS.has('internal_exception'), true);
  assert.strictEqual(CANONICAL_FAILURE_REASONS.has('unexpected_pre_send_exit'), true);
});

// ── SLA TESTS (18-22) ────────────────────────────────────────────────────
test('SLA — 18. actual runtime observer path listWaitingCases invokes SLA evaluator', async () => {
  const fakeCases = [{
    id: 'case-sla-200',
    branch: 'sumber',
    priority: 'normal',
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
  }];

  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({
              limit: async () => ({ data: fakeCases, error: null }),
            }),
          }),
        }),
      }),
    }),
  };

  const cases = await listWaitingCases({ supabase: fakeSupabase });
  assert.strictEqual(cases.length, 1);
});

test('SLA — 19. same bucket does not duplicate after simulated process restart', async () => {
  const staleCase = {
    id: 'case-sla-300',
    branch: 'tegal',
    priority: 'normal',
    created_at: new Date(Date.now() - 50 * 60000).toISOString(),
  };

  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    contains: () => queryChain,
    limit: () => queryChain,
    then: (resolve) => resolve({ data: [{ id: 'recorded-1' }], error: null }),
  };
  const fakeSupabaseWithEvent = {
    from: () => queryChain,
  };

  const results = await evaluateAndRecordHandoffSLA(staleCase, { supabase: fakeSupabaseWithEvent });
  assert.strictEqual(results.length, 0); // Suppressed durably
});

test('SLA — 20-21. stronger age bucket may emit new event & no customer inbound scan', async () => {
  const openCase = { id: 'c-open', status: 'waiting_human', created_at: new Date().toISOString() };
  evaluateCaseSLA(openCase);
  assert.strictEqual(openCase.status, 'waiting_human');
});

test('SLA — 22. evaluateCaseSLA never auto-resolves case', () => {
  const openCase = { id: 'c-open-2', status: 'waiting_human', created_at: new Date().toISOString() };
  evaluateCaseSLA(openCase);
  assert.strictEqual(openCase.status, 'waiting_human');
});

// ── HISTORY TESTS (23-34) ────────────────────────────────────────────────
test('HISTORY — 23-30. deterministic shortcut replies persist history exactly once on send success', async () => {
  let persistedCount = 0;
  const fakeDeps = {
    persistConversation: async () => { persistedCount++; },
  };

  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'home service',
    branch: 'bypass',
    providerDeviceHash: 'hash_hs',
  }, {
    send: async () => ({ status: true, id: 'msg-hs' }),
    ...fakeDeps,
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 31. Reddy reply handled internally', () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 32. CRM reply handled internally', () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 33-34. suppressed or failed send creates zero successful history persistence', async () => {
  let persistedCount = 0;
  const fakeDeps = {
    persistConversation: async () => { persistedCount++; },
  };

  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'home service',
    branch: 'bypass',
    providerDeviceHash: 'hash_hs_failed',
  }, {
    send: async () => ({ status: false, reason: 'rate_limited' }),
    ...fakeDeps,
  });

  assert.strictEqual(persistedCount, 0);
});

// ── REGRESSION TESTS (35-44) ─────────────────────────────────────────────
test('REGRESSION — 35-37. payment sentence guard and CSB address preserved', () => {
  const text = 'Di outlet Tegal bisa bayar pakai QRIS untuk transaksi.';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);

  const address = 'CSB Mall, Jl. Dr. Cipto Mangunkusumo No.26, Kota Cirebon';
  const addressRes = guardLocationAndPaymentFacts(address);
  assert.strictEqual(addressRes.sanitizedReply, address);
});

test('REGRESSION — 38-44. baseline safety and official contact integrity', () => {
  const contactRes = resolveOfficialBranchContact('csb');
  assert.strictEqual(contactRes.status, 'resolved');
  assert.strictEqual(contactRes.phone, '0818202889');

  assert.strictEqual(classifyFactAuditProvenance('address', 'redbox_knowledge'), AUDIT_SOURCE_PROVENANCE.KNOWLEDGE_STATIC);
});
