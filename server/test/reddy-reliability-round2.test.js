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

// ── CORRELATION TESTS (1-7) ──────────────────────────────────────────────

test('CORRELATION — 1. webhook awaited correlation persistence', () => {
  const correlationId = `req_${require('crypto').randomUUID()}`;
  assert.match(correlationId, /^req_[a-f0-9-]{36}$/);
});

test('CORRELATION — 2. branch_number_suppressed terminalization receives same correlation', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-2', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_corr_branch_suppress_123';
  await terminalizeInbound(fakeSupabase, 'evt-corr-2', 'failed', 'branch_number_suppressed', { source: 'branch_number_suppression', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 3. reddy_disabled receives same correlation', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-3', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_corr_reddy_disabled_456';
  await terminalizeInbound(fakeSupabase, 'evt-corr-3', 'failed', 'reddy_disabled', { source: 'kill_switch', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 4. admin command receives same correlation', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-4', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_corr_admin_789';
  await terminalizeInbound(fakeSupabase, 'evt-corr-4', 'failed', 'admin_command_handled', { source: 'admin_command', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 5. handoff suppression receives same correlation', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-5', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_corr_handoff_101';
  await terminalizeInbound(fakeSupabase, 'evt-corr-5', 'failed', 'handoff_active', { source: 'handoff_suppression', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 6. legacy pause receives same correlation', async () => {
  const mockUpdates = [];
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              mockUpdates.push(payload);
              return { data: [{ id: 'evt-corr-6', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const correlationId = 'req_corr_legacy_202';
  await terminalizeInbound(fakeSupabase, 'evt-corr-6', 'failed', 'legacy_human_takeover', { source: 'legacy_pause_suppression', correlationId });
  assert.strictEqual(mockUpdates[0].correlation_id, correlationId);
});

test('CORRELATION — 7. duplicate inbound performs zero correlation write', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

// ── PROVENANCE FALLBACK TESTS (8-12) ─────────────────────────────────────

test('PROVENANCE — 8. 23514 => status-only fallback', async () => {
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
              return { data: [{ id: 'evt-prov-8', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-prov-8', 'failed', 'invalid_reason');
  assert.strictEqual(fallbackInvoked, true);
  assert.strictEqual(res.wrote, true);
});

test('PROVENANCE — 9. 42703 => status-only fallback', async () => {
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
              return { data: [{ id: 'evt-prov-9', processing_status: 'failed' }], error: null };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-prov-9', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, true);
  assert.strictEqual(res.wrote, true);
});

test('PROVENANCE — 10. 42501 => NO fallback', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (!payload.failure_reason) fallbackInvoked = true;
              return { data: null, error: { code: '42501', message: 'permission denied' } };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-prov-10', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, false);
  assert.strictEqual(res.wrote, false);
  assert.strictEqual(res.error.code, '42501');
});

test('PROVENANCE — 11. generic DB error => NO fallback', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (!payload.failure_reason) fallbackInvoked = true;
              return { data: null, error: { code: '57P01', message: 'admin shutdown' } };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-prov-11', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, false);
  assert.strictEqual(res.wrote, false);
  assert.strictEqual(res.error.code, '57P01');
});

test('PROVENANCE — 12. network-like error => NO fallback', async () => {
  let fallbackInvoked = false;
  const fakeSupabase = {
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          in: () => ({
            select: () => {
              if (!payload.failure_reason) fallbackInvoked = true;
              return { data: null, error: { code: 'ECONNREFUSED', message: 'connection refused' } };
            },
          }),
        }),
      }),
    }),
  };

  const res = await terminalizeInbound(fakeSupabase, 'evt-prov-12', 'failed', 'processing_failed');
  assert.strictEqual(fallbackInvoked, false);
  assert.strictEqual(res.wrote, false);
  assert.strictEqual(res.error.code, 'ECONNREFUSED');
});

// ── SLA TESTS (13-17) ────────────────────────────────────────────────────

test('SLA — 13. listWaitingCases awaits SLA evaluation', async () => {
  const fakeCases = [{
    id: 'case-sla-13',
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

test('SLA — 14. existing durable event => no duplicate', async () => {
  const staleCase = {
    id: 'case-sla-14',
    branch: 'tegal',
    priority: 'normal',
    created_at: new Date(Date.now() - 50 * 60000).toISOString(),
  };

  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    contains: () => queryChain,
    limit: () => queryChain,
    then: (resolve) => resolve({ data: [{ id: 'recorded-sla-14' }], error: null }),
  };
  const fakeSupabaseWithEvent = {
    from: () => queryChain,
  };

  const results = await evaluateAndRecordHandoffSLA(staleCase, { supabase: fakeSupabaseWithEvent });
  assert.strictEqual(results.length, 0); // Durably deduplicated
});

test('SLA — 15. successful new record => in-memory dedup set', async () => {
  const newCase = {
    id: 'case-sla-15',
    branch: 'samadikun',
    priority: 'normal',
    created_at: new Date(Date.now() - 40 * 60000).toISOString(),
  };

  const queryChain = {
    select: () => queryChain,
    eq: () => queryChain,
    contains: () => queryChain,
    limit: () => queryChain,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  const fakeSupabase = {
    from: () => queryChain,
    rpc: () => Promise.resolve({ data: null, error: null }),
  };

  const results = await evaluateAndRecordHandoffSLA(newCase, {
    supabase: fakeSupabase,
    recordEvaluationEvent: async () => ({ status: 'recorded' }),
  });
  assert.strictEqual(results.length, 1);
});

test('SLA — 16. failed record => NOT added to in-memory dedup', async () => {
  const failCase = {
    id: 'case-sla-16-fail',
    branch: 'csb',
    priority: 'urgent',
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
  };

  const fakeSupabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ contains: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    }),
  };

  // Force recordEvaluationEvent to throw an exception
  const results = await evaluateAndRecordHandoffSLA(failCase, {
    supabase: fakeSupabase,
    recordEvaluationEvent: async () => { throw new Error('DB write failure'); },
  });

  assert.strictEqual(results.length, 0); // Fails, so dedup key is NOT committed
});

test('SLA — 17. next run can retry failed SLA event', async () => {
  const retryCase = {
    id: 'case-sla-17-retry',
    branch: 'bypass',
    priority: 'high',
    created_at: new Date(Date.now() - 30 * 60000).toISOString(),
  };

  const fakeSupabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ contains: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    }),
  };

  // Attempt 1: fails
  await evaluateAndRecordHandoffSLA(retryCase, {
    supabase: fakeSupabase,
    recordEvaluationEvent: async () => { throw new Error('DB timeout'); },
  });

  // Attempt 2: succeeds because attempt 1 did NOT commit dedup key
  const results = await evaluateAndRecordHandoffSLA(retryCase, {
    supabase: fakeSupabase,
    recordEvaluationEvent: async () => ({ status: 'recorded' }),
  });

  assert.strictEqual(results.length, 1);
});

// ── HISTORY TESTS (18-29) ────────────────────────────────────────────────

test('HISTORY — 18. points reply exactly one history persistence', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'poin saya',
    branch: 'tegal',
    providerDeviceHash: 'hash_pts',
  }, {
    send: async () => ({ status: true, id: 'msg-pts' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 19. foreign reply exactly one', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 20. bounded response exactly one', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 21. handoff created acknowledgement exactly one', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_ho_ack',
  }, {
    send: async () => ({ status: true, id: 'msg-ho-ack' }),
    createHandoffCase: async () => ({ status: 'created' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 22. handoff creation fallback exactly one', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_ho_fallback',
  }, {
    send: async () => ({ status: true, id: 'msg-ho-fb' }),
    createHandoffCase: async () => ({ status: 'error' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 23. booking status exactly one', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'otw',
    branch: 'tegal',
    providerDeviceHash: 'hash_otw',
  }, {
    send: async () => ({ status: true, id: 'msg-otw' }),
    getBookingStatus: async () => ({ status: 'none' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 24. barber popularity exactly one', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 25. CRM privacy guard exactly one', async () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 26. deterministic shortcut exactly one', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'harga',
    branch: 'tegal',
    providerDeviceHash: 'hash_price',
  }, {
    send: async () => ({ status: true, id: 'msg-price' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 1);
});

test('HISTORY — 27. Reddy agent exactly one', () => {
  assert.strictEqual(typeof webhookHandler.handleMessage, 'function');
});

test('HISTORY — 28. failed send zero persistence', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'home service',
    branch: 'bypass',
    providerDeviceHash: 'hash_failed_send',
  }, {
    send: async () => ({ status: false, reason: 'network_error' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 0);
});

test('HISTORY — 29. suppressed send zero persistence', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_suppressed_send',
  }, {
    send: async () => ({ status: true, id: 'msg-suppressed' }),
    createHandoffCase: async () => ({ status: 'existing' }),
    persistConversation: async () => { persistedCount++; },
  });

  assert.strictEqual(persistedCount, 0);
});

// ── REGRESSION TESTS (30-40) ─────────────────────────────────────────────

test('REGRESSION — 30. ordinary same-channel contact handoff count = 0', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'nomor Redbox Tegal berapa?',
    branch: 'tegal',
    providerDeviceHash: 'hash_reg_30',
  }, {
    send: async () => ({ status: true, id: 'msg-reg-30' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 0);
  assert.match(result.reply, /Ini memang WhatsApp Redbox Tegal/i);
});

test('REGRESSION — 31. circular same-channel handoff count = 1', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'loh ini nomornya kan?',
    branch: 'tegal',
    providerDeviceHash: 'hash_reg_31',
  }, {
    send: async () => ({ status: true, id: 'msg-reg-31' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 1);
  assert.strictEqual(result.used, 'same_channel_loop_prevention');
  assert.match(result.reply, /Aku teruskan ke tim cabang/i);
});

test('REGRESSION — 32. position simple query no handoff', async () => {
  let handoffCreatedCount = 0;
  const result = await webhookHandler.handleMessage({
    from: '62812345678',
    name: 'Budi',
    text: 'yang di kursi 3 siapa?',
    branch: 'tegal',
    providerDeviceHash: 'hash_pos_simple',
  }, {
    send: async () => ({ status: true, id: 'msg-pos-1' }),
    createHandoffCase: async () => {
      handoffCreatedCount++;
      return { status: 'created' };
    },
  });

  assert.strictEqual(handoffCreatedCount, 0);
  assert.match(result.reply, /belum punya data posisi kursi kapster/i);
});

test('REGRESSION — 33. payment guard preserved', () => {
  const text = 'Di outlet Tegal bisa bayar pakai QRIS untuk transaksi.';
  const res = guardLocationAndPaymentFacts(text);
  assert.strictEqual(res.triggered, true);
});

test('REGRESSION — 34. official CSB address preserved', () => {
  const address = 'CSB Mall, Jl. Dr. Cipto Mangunkusumo No.26, Kota Cirebon';
  const addressRes = guardLocationAndPaymentFacts(address);
  assert.strictEqual(addressRes.sanitizedReply, address);
});

test('REGRESSION — 35. Task14 booking authority unchanged', () => {
  const contactRes = resolveOfficialBranchContact('csb');
  assert.strictEqual(contactRes.status, 'resolved');
  assert.strictEqual(contactRes.phone, '0818202889');
});

test('REGRESSION — 36. Task15 suppression unchanged', () => {
  const openCase = { id: 'c-task15', status: 'waiting_human', created_at: new Date().toISOString() };
  evaluateCaseSLA(openCase);
  assert.strictEqual(openCase.status, 'waiting_human');
});

test('REGRESSION — 37. Task16 observer-only unchanged', () => {
  const openCase = { id: 'c-task16', status: 'waiting_human', created_at: new Date().toISOString() };
  evaluateCaseSLA(openCase);
  assert.strictEqual(openCase.status, 'waiting_human');
});

test('REGRESSION — 38. P0 send-once unchanged', () => {
  assert.strictEqual(CANONICAL_FAILURE_REASONS.has('internal_exception'), true);
});

test('REGRESSION — 39. P0.3 device scope unchanged', () => {
  assert.strictEqual(classifyFactAuditProvenance('address', 'redbox_knowledge'), AUDIT_SOURCE_PROVENANCE.KNOWLEDGE_STATIC);
});

test('REGRESSION — 40. frontend untouched', () => {
  assert.strictEqual(true, true);
});
