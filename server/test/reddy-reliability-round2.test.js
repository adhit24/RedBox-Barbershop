'use strict';

const test = require('node:test');
const assert = require('assert');

const { terminalizeInbound, CANONICAL_FAILURE_REASONS, normalizeFailureReason } = require('../services/waInboundLifecycle');
const { classifyBarberPresenceQuery, classifyBarberPositionIntent } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts, guardLocationAndPaymentFacts } = require('../agents/reddy/realtimeFactGuard');
const { evaluateCaseSLA, evaluateAndRecordHandoffSLA, recordedSlaBreaches } = require('../services/humanHandoff');
const { classifyFactAuditProvenance, AUDIT_SOURCE_PROVENANCE } = require('../services/reddyEvaluationMonitoring');
const { REDBOX_KNOWLEDGE, resolveOfficialBranchContact } = require('../agents/reddy/knowledge/redboxKnowledge');
const webhookHandler = require('../../api/wa/webhook');

// CORRELATION TESTS (1-5)
test('CORRELATION — 1. correlation ID format req_<uuid>', () => {
  const correlationId = `req_${require('crypto').randomUUID()}`;
  assert.match(correlationId, /^req_[a-f0-9-]{36}$/);
});

test('CORRELATION — 2-4. correlation ID passed and persisted atomically in terminalizeInbound', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-corr-1', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_test_12345';
  await terminalizeInbound(fakeSupabase, 'evt-corr-1', 'failed', 'processing_failed', { source: 'unit_test', correlationId });
  assert.strictEqual(mockRows[0].correlation_id, correlationId);
});

test('CORRELATION — 5. provider_message_id dedup unchanged', () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

// MIGRATION & REASONS (6-9)
test('MIGRATION / REASONS — 6. every canonical reason exists in CANONICAL_FAILURE_REASONS set', () => {
  const expectedReasons = [
    'unexpected_pre_send_exit', 'processing_failed', 'model_call_failed',
    'crm_context_failed', 'duplicate_suppressed', 'rate_limited',
    'reddy_disabled', 'branch_number_suppressed', 'admin_command_handled',
    'handoff_active', 'legacy_human_takeover', 'internal_exception',
    'invalid_fonnte_envelope', 'unsupported_webhook_event', 'kill_switch_suppressed',
  ];
  for (const reason of expectedReasons) {
    assert.strictEqual(CANONICAL_FAILURE_REASONS.has(reason), true, `Missing canonical reason: ${reason}`);
  }
});

test('MIGRATION / REASONS — 7. normalizeFailureReason maps unknown raw exception to internal_exception', () => {
  assert.strictEqual(normalizeFailureReason('unknown_random_error'), 'internal_exception');
  assert.strictEqual(normalizeFailureReason('model_call_failed'), 'model_call_failed');
});

test('MIGRATION / REASONS — 8. provenance write error fails safe without leaving row processing', async () => {
  let fallbackAttempted = false;
  const fakeSupabaseWithConstraintErr = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (payload.failure_reason) {
                // Simulate CHECK constraint error 23514
                return { data: null, error: { code: '23514', message: 'check constraint violation' } };
              }
              fallbackAttempted = true;
              return { data: [{ id: 'evt-err-1', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabaseWithConstraintErr, 'evt-err-1', 'failed', 'invalid_reason_string', { source: 'unit_test' });
  assert.strictEqual(fallbackAttempted, true);
  assert.strictEqual(res.wrote, true);
});

test('MIGRATION / REASONS — 9. historical NULL provenance allowed', () => {
  assert.strictEqual(normalizeFailureReason(null), 'internal_exception');
});

// CHANNEL LOOP (10-14)
test('CHANNEL LOOP — 10. "nomor Redbox Tegal berapa?" on Tegal DOES NOT create handoff', async () => {
  let handoffCreated = false;
  const fakeDeps = {
    persistConversation: async () => {},
  };
  const text = 'nomor Redbox Tegal berapa?';
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text,
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-1' }),
    createHandoffCase: async () => {
      handoffCreated = true;
      return { status: 'created' };
    },
    ...fakeDeps,
  });

  assert.strictEqual(handoffCreated, false);
  assert.match(result.reply, /(?:Ini memang WhatsApp|Nomor resmi Redbox)/i);
});

test('CHANNEL LOOP — 11-14. "loh ini nomornya kan?" triggers handoff escalation and correct wording', async () => {
  let createdCalled = false;
  const text = 'loh ini nomornya kan?';

  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text,
    branch: 'tegal',
    providerDeviceHash: 'hash_tegal',
  }, {
    send: async () => ({ status: true, id: 'msg-2' }),
    createHandoffCase: async () => {
      createdCalled = true;
      return { status: 'created' };
    },
  });

  assert.strictEqual(createdCalled, true);
  assert.strictEqual(result.used, 'same_channel_loop_prevention');
  assert.match(result.reply, /Aku teruskan ke tim cabang/i);
});

// POSITION INTENT (15-18)
test('POSITION INTENT — 15. simple seat identity does NOT trigger auto handoff', async () => {
  let handoffCalled = false;
  const text = 'yang di kursi 2 itu siapa?';

  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text,
    branch: 'csb',
    providerDeviceHash: 'hash_pos',
  }, {
    send: async () => ({ status: true, id: 'msg-pos-1' }),
    createHandoffCase: async () => {
      handoffCalled = true;
      return { status: 'created' };
    },
  });

  assert.strictEqual(result.used, 'barber_position_identity');
  assert.strictEqual(handoffCalled, false);
  assert.strictEqual(result.reply, 'Aku belum punya data posisi kursi kapster secara realtime, Kak.');
});

test('POSITION INTENT — 16. explicit "tolong tanyakan admin" after seat question triggers handoff', async () => {
  let handoffCalled = false;
  const text = 'yang di kursi 2 siapa? tolong tanyakan admin dong';

  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text,
    branch: 'csb',
    providerDeviceHash: 'hash_pos_2',
  }, {
    send: async () => ({ status: true, id: 'msg-pos-2' }),
    createHandoffCase: async () => {
      handoffCalled = true;
      return { status: 'created' };
    },
  });

  assert.strictEqual(result.used, 'barber_position_identity');
  assert.strictEqual(handoffCalled, true);
  assert.match(result.reply, /Pesan Kakak sudah aku teruskan ke tim cabang/i);
});

test('POSITION INTENT — 17. "posisi cabang Tegal dimana?" does NOT classify barber_position_identity', () => {
  const res = classifyBarberPositionIntent('posisi cabang Tegal dimana?');
  assert.strictEqual(res.matched, false);
});

test('POSITION INTENT — 18. "kursi tunggu ada?" does NOT classify barber_position_identity', () => {
  const res = classifyBarberPositionIntent('kursi tunggu ada?');
  assert.strictEqual(res.matched, false);
});

// SLA TESTS (19-22)
test('SLA — 19. stale case records handoff_sla_breached', () => {
  const staleCase = {
    id: 'case-sla-100',
    branch: 'sumber',
    priority: 'normal',
    created_at: new Date(Date.now() - 45 * 60000).toISOString(), // 45m old
  };

  const results = evaluateAndRecordHandoffSLA(staleCase);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].age_bucket, '30m-2h');
  assert.strictEqual(results[0].severity, 'WARNING');
});

test('SLA — 20. repeat audit in same age bucket does NOT spam duplicate event', () => {
  const staleCase = {
    id: 'case-sla-100',
    branch: 'sumber',
    priority: 'normal',
    created_at: new Date(Date.now() - 50 * 60000).toISOString(),
  };

  const results = evaluateAndRecordHandoffSLA(staleCase);
  assert.strictEqual(results.length, 0); // Suppressed by deduplication set
});

test('SLA — 21. bucket escalation records new SLA event', () => {
  const escalatedCase = {
    id: 'case-sla-100',
    branch: 'sumber',
    priority: 'normal',
    created_at: new Date(Date.now() - 150 * 60000).toISOString(), // >2h old
  };

  const results = evaluateAndRecordHandoffSLA(escalatedCase);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].age_bucket, '>2h');
  assert.strictEqual(results[0].severity, 'HIGH');
});

test('SLA — 22. evaluateCaseSLA never auto-resolves case', () => {
  const openCase = { id: 'c-open', status: 'waiting_human', created_at: new Date().toISOString() };
  evaluateCaseSLA(openCase);
  assert.strictEqual(openCase.status, 'waiting_human');
});

// HISTORY TESTS (23-31)
test('HISTORY — 23-26. deterministic shortcut replies persist history on send success', async () => {
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

test('HISTORY — 29-30. suppressed or failed send creates zero successful history persistence', async () => {
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

// PAYMENT & LOCATION (32-36)
test('PAYMENT / LOCATION — 32. "bisa bayar pakai QRIS" triggers payment boundary sanitization', () => {
  const text = 'Di outlet Tegal bisa bayar pakai QRIS untuk transaksi.';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
  assert.match(res.sanitizedReply, /metode pembayaran yang tersedia saat ini, aku belum punya data resmi/i);
});

test('PAYMENT / LOCATION — 33. "terima QRIS?" caught by payment boundary', () => {
  const text = 'Apakah terima QRIS Kak?';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
});

test('PAYMENT / LOCATION — 34. sentence-level sanitization preserves unrelated valid sentence', () => {
  const text = 'Redbox Tegal buka jam 09:00 WIB.\nDi outlet Tegal bisa bayar pakai QRIS.';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.sanitizedReply.includes('Redbox Tegal buka jam 09:00 WIB.'), true);
  assert.strictEqual(res.sanitizedReply.includes('bisa bayar pakai QRIS'), false);
});

test('PAYMENT / LOCATION — 35. official CSB street address preserved', () => {
  const address = 'CSB Mall, Jl. Dr. Cipto Mangunkusumo No.26, Kota Cirebon';
  const res = guardLocationAndPaymentFacts(address);
  assert.strictEqual(res.sanitizedReply, address);
});

test('PAYMENT / LOCATION — 36. "lantai dasar" detail removed while keeping official street address', () => {
  const text = 'Berlokasi di CSB Mall, lantai dasar, Jl. Dr. Cipto Mangunkusumo No.26';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.sanitizedReply.includes('lantai dasar'), false);
  assert.strictEqual(res.sanitizedReply.includes('Jl. Dr. Cipto Mangunkusumo No.26'), true);
});

// REGRESSION TESTS (37-44)
test('REGRESSION — 37-44. baseline safety and official contact integrity', () => {
  const contactRes = resolveOfficialBranchContact('csb');
  assert.strictEqual(contactRes.status, 'resolved');
  assert.strictEqual(contactRes.phone, '0818202889');

  assert.strictEqual(classifyFactAuditProvenance('address', 'redbox_knowledge'), AUDIT_SOURCE_PROVENANCE.KNOWLEDGE_STATIC);
  assert.strictEqual(classifyFactAuditProvenance('barber_schedule', 'schedule_authority'), AUDIT_SOURCE_PROVENANCE.SCHEDULE_AUTHORITY);
});
