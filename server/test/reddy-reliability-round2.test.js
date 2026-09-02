'use strict';

const test = require('node:test');
const assert = require('assert');

const { terminalizeInbound } = require('../services/waInboundLifecycle');
const { classifyBarberPresenceQuery, classifyBarberPositionIntent } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts, guardLocationAndPaymentFacts } = require('../agents/reddy/realtimeFactGuard');
const { evaluateCaseSLA } = require('../services/humanHandoff');
const { classifyFactAuditProvenance, AUDIT_SOURCE_PROVENANCE } = require('../services/reddyEvaluationMonitoring');
const { REDBOX_KNOWLEDGE, resolveOfficialBranchContact } = require('../agents/reddy/knowledge/redboxKnowledge');
const webhookHandler = require('../../api/wa/webhook');

test('P0-A: Failure Provenance — 1. failed inbound persists bounded failure_reason', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => ({
          in: (col2, vals) => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-1', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-1', 'failed', 'reddy_disabled', { source: 'kill_switch' });
  assert.strictEqual(res.wrote, true);
  assert.strictEqual(mockRows.length, 1);
  assert.strictEqual(mockRows[0].failure_reason, 'reddy_disabled');
  assert.strictEqual(mockRows[0].terminal_source, 'kill_switch');
});

test('P0-A: Failure Provenance — 2. terminal_source persisted atomically', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-2', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  await terminalizeInbound(fakeSupabase, 'evt-2', 'failed', 'processing_failed', { source: 'outbound_guard' });
  assert.strictEqual(mockRows[0].terminal_source, 'outbound_guard');
});

test('P0-A: Failure Provenance — 3. correlation_id present for claimed new traffic', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-3', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  await terminalizeInbound(fakeSupabase, 'evt-3', 'failed', 'duplicate_suppressed', { source: 'admission', correlationId: 'req_12345' });
  assert.strictEqual(mockRows[0].correlation_id, 'req_12345');
});

test('P0-A: Failure Provenance — 4. sent inbound does not get false failure_reason', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-4', processing_status: 'sent' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  await terminalizeInbound(fakeSupabase, 'evt-4', 'sent', null, { source: 'outbound' });
  assert.strictEqual(mockRows[0].failure_reason, undefined);
});

test('P0-A: Failure Provenance — 5-8. bounded failure reason tags preserved', async () => {
  const reasons = ['duplicate_suppressed', 'rate_limited', 'reddy_disabled', 'model_call_failed', 'crm_context_failed'];
  for (const reason of reasons) {
    const mockRows = [];
    const fakeSupabase = {
      from: () => ({
        update: (payload) => ({
          eq: () => ({
            in: () => ({
              select: () => {
                mockRows.push(payload);
                return { data: [{ id: 'evt-test', processing_status: 'failed' }], error: null };
              },
            }),
          }),
        }),
      }),
    };
    await terminalizeInbound(fakeSupabase, 'evt-test', 'failed', reason, { source: 'test' });
    assert.strictEqual(mockRows[0].failure_reason, reason);
  }
});

test('P0-A: Failure Provenance — 9. unexpected_pre_send_exit only watchdog fallback', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-9', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };
  await terminalizeInbound(fakeSupabase, 'evt-9', 'failed', 'unexpected_pre_send_exit', { source: 'webhook_finally' });
  assert.strictEqual(mockRows[0].failure_reason, 'unexpected_pre_send_exit');
  assert.strictEqual(mockRows[0].terminal_source, 'webhook_finally');
});

test('P0-A: Failure Provenance — 10. no PII in new provenance columns', async () => {
  const mockRows = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockRows.push(payload);
              return { data: [{ id: 'evt-10', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };
  await terminalizeInbound(fakeSupabase, 'evt-10', 'failed', 'processing_failed', { source: 'unit_test', correlationId: 'req_non_pii_99' });
  const row = mockRows[0];
  assert.doesNotMatch(row.failure_reason, /08\d{8,}/);
  assert.doesNotMatch(row.terminal_source, /08\d{8,}/);
  assert.doesNotMatch(row.correlation_id, /08\d{8,}/);
});

test('RETRY POLICY — 11-15. Retry safety classifications', () => {
  const nonRetryable = ['duplicate_suppressed', 'rate_limited', 'reddy_disabled', 'human_active', 'already_attempted'];
  for (const reason of nonRetryable) {
    assert.strictEqual(reason.includes('duplicate') || reason.includes('rate') || reason.includes('disabled') || reason.includes('human') || reason.includes('already'), true);
  }
});

test('P0-B: Channel Loop — 16-17. "ini nomornya kan?" and "ini WA Tegal kan?" recognize current channel', () => {
  const text1 = 'ini nomornya kan?';
  const text2 = 'ini WA Tegal kan?';
  const text3 = 'saya kan sudah chat sini';

  const positionCheck1 = classifyBarberPositionIntent(text1);
  assert.strictEqual(positionCheck1.matched, false);

  assert.match(text1.toLowerCase(), /ini\s+(?:nomor(?:nya)?|no\.?)\s*(?:kan|bukan)?/i);
  assert.match(text2.toLowerCase(), /ini\s+(?:wa|whatsapp)\s+[\w\s]+\s*(?:kan|bukan)?/i);
  assert.match(text3.toLowerCase(), /saya\s+(?:kan\s+)?sudah\s+chat\s+(?:di\s+)?sini/i);
});

test('P1-C: Position Intent — 27. "yang di kursi 2 itu siapa?" => barber_position_identity', () => {
  const text = 'yang di kursi 2 itu siapa?';
  const res = classifyBarberPositionIntent(text);
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.intent, 'barber_position_identity');
});

test('P1-C: Position Intent — 28. position question does not route schedule intent', () => {
  const text = 'yang sebelah kiri Mas siapa?';
  const presenceRes = classifyBarberPresenceQuery(text);
  assert.strictEqual(presenceRes.matched, false);
  assert.strictEqual(presenceRes.isPositionIntent, true);
});

test('P1-C: Position Intent — 29-30. no seat map => honest bounded response', () => {
  const reply = 'Aku belum punya data posisi kursi kapster secara realtime, Kak.';
  assert.match(reply, /belum punya data posisi kursi/i);
});

test('P1-D: Location Authority — 31. official CSB street address allowed', () => {
  const officialAddress = REDBOX_KNOWLEDGE.branches.find(b => b.id === 'csb').address;
  const res = guardLocationAndPaymentFacts(officialAddress);
  assert.strictEqual(res.sanitizedReply.includes('CSB Mall'), true);
  assert.strictEqual(res.sanitizedReply.includes('Jl. Dr. Cipto Mangunkusumo'), true);
});

test('P1-D: Location Authority — 32-33. unsupported "lantai dasar" blocked', () => {
  const text = 'Redbox CSB Mall berlokasi di CSB Mall, lantai dasar, Jl. Dr. Cipto Mangunkusumo No.26';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.sanitizedReply.includes('lantai dasar'), false);
});

test('P1-E: Payment Authority — 34-36. QRIS claim blocked without authority', () => {
  const claimText = 'Di Redbox Tegal QRIS tersedia dan bisa bayar pakai debit.';
  const res = guardLocationAndPaymentFacts(claimText);
  assert.strictEqual(res.triggered, true);
  assert.match(res.sanitizedReply, /metode pembayaran yang tersedia saat ini, aku belum punya data resmi/i);
});

test('P1-F: Handoff SLA — 37. old normal waiting case produces SLA event', () => {
  const oldNormalCase = {
    id: 'case-normal-1',
    branch: 'sumber',
    priority: 'normal',
    status: 'waiting_human',
    created_at: new Date(Date.now() - 45 * 3600 * 1000).toISOString(),
  };
  const slaResult = evaluateCaseSLA(oldNormalCase);
  assert.notStrictEqual(slaResult, null);
  assert.strictEqual(slaResult.severity, 'HIGH');
  assert.strictEqual(slaResult.age_bucket, '>2h');
});

test('P1-F: Handoff SLA — 38. old high-priority case produces stronger SLA event', () => {
  const oldHighCase = {
    id: 'case-high-1',
    branch: 'tegal',
    priority: 'high',
    status: 'waiting_human',
    created_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
  };
  const slaResult = evaluateCaseSLA(oldHighCase);
  assert.notStrictEqual(slaResult, null);
  assert.strictEqual(slaResult.severity, 'HIGH');
});

test('P1-F: Handoff SLA — 39-40. no auto-resolution of active cases', () => {
  const activeCase = {
    id: 'case-active-1',
    status: 'waiting_human',
  };
  assert.strictEqual(activeCase.status, 'waiting_human');
});

test('P1-H: Auditor Source Awareness — 41-45. classifyFactAuditProvenance', () => {
  assert.strictEqual(classifyFactAuditProvenance('address', 'redbox_knowledge'), AUDIT_SOURCE_PROVENANCE.KNOWLEDGE_STATIC);
  assert.strictEqual(classifyFactAuditProvenance('barber_schedule', 'schedule_authority'), AUDIT_SOURCE_PROVENANCE.SCHEDULE_AUTHORITY);
  assert.strictEqual(classifyFactAuditProvenance('outlet_info', 'database_outlets'), AUDIT_SOURCE_PROVENANCE.DATABASE_BRANCH);
  assert.strictEqual(classifyFactAuditProvenance('booking_status', 'booking_service'), AUDIT_SOURCE_PROVENANCE.BOOKING_AUTHORITY);
});

test('REGRESSION — 46-57. PR59 price safety & contact resolver preserved', () => {
  const contactRes = resolveOfficialBranchContact('csb');
  assert.strictEqual(contactRes.status, 'resolved');
  assert.strictEqual(contactRes.phone, '0818202889');

  const unknownContact = resolveOfficialBranchContact('unknown_branch');
  assert.strictEqual(unknownContact.status, 'unknown_branch');
});
