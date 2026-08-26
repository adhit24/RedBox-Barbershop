'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCustomerIdentity } = require('../crm/customerIdentity');
const { getCustomer360 } = require('../crm/customer360Service');
const { executeCrmTool } = require('../agents/crm/crmAgent');
const { executeCustomerIntelligence } = require('../orchestrator/executionService');
const { issueTrustedIdentity, TRUSTED_SOURCES } = require('../identity/trustedIdentity');
const { handleMessage } = require('../../api/wa/webhook');

// Mock Supabase client for production-shaped alias resolution testing
function createMockSupabaseFixture() {
  const customerRows = [
    {
      id: 'cust-id-A',
      name: 'Adhit Nugraha',
      wa: '6281311112222',
      phone_e164: '+6281311112222',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    {
      id: 'cust-id-B',
      name: 'Adhitya Nugraha',
      wa: '+6281311112222',
      phone_e164: '+6281311112222',
      created_at: '2025-03-01T00:00:00Z',
      updated_at: '2025-03-01T00:00:00Z',
    },
    {
      id: 'cust-id-C',
      name: 'Adhitya Nugraha',
      wa: '081311112222',
      phone_e164: '+6281311112222',
      created_at: '2025-05-01T00:00:00Z',
      updated_at: '2025-05-01T00:00:00Z',
    },
  ];

  const memberProfileRows = [
    {
      id: 'prof-id-1',
      user_key: 'ukey-1',
      full_name: 'Adhitya Nugraha Member',
      phone: '+6281311112222',
      total_points: 150,
      tier: 'gold',
      membership_status: 'ACTIVE',
      created_at: '2025-01-01T00:00:00Z',
    },
  ];

  const transactionRows = [
    // 6 transactions under Customer A
    { id: 'tx-a1', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-01-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    { id: 'tx-a2', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-02-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    { id: 'tx-a3', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-03-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    { id: 'tx-a4', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-04-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    { id: 'tx-a5', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-05-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    { id: 'tx-a6', customer_id: 'cust-id-A', status: 'completed', total_amount: 95000, created_at: '2026-06-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Gentleman Grooming' }] },

    // 3 transactions under Customer B
    { id: 'tx-b1', customer_id: 'cust-id-B', status: 'completed', total_amount: 110000, created_at: '2026-07-10T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Hair Spa' }] },
    { id: 'tx-b2', customer_id: 'cust-id-B', status: 'completed', total_amount: 110000, created_at: '2026-08-01T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Hair Spa' }] },
    { id: 'tx-b3', customer_id: 'cust-id-B', status: 'completed', total_amount: 110000, created_at: '2026-08-20T10:00:00Z', location: 'bypass', transaction_items: [{ service_name: 'Hair Spa' }] },
  ];

  const bookingRows = [
    { id: 'bk-1', customer_id: 'cust-id-A', wa: '81311112222', status: 'done', date: '2026-01-10', location: 'bypass', barber_name: 'Budi', service: 'Gentleman Grooming' },
    { id: 'bk-2', customer_id: 'cust-id-C', wa: '081311112222', status: 'done', date: '2026-08-25', location: 'bypass', barber_name: 'Rudi', service: 'Hair Spa' },
  ];

  return {
    from(table) {
      return {
        select() {
          return {
            eq(col, val) {
              return {
                maybeSingle: async () => {
                  if (table === 'customers') {
                    const found = customerRows.find(r => r[col] === val);
                    return { data: found || null, error: null };
                  }
                  return { data: null, error: null };
                },
                eq(col2, val2) {
                  return {
                    order: async () => {
                      if (table === 'transactions') {
                        const filtered = transactionRows.filter(r => r[col] === val && r[col2] === val2);
                        return { data: filtered, error: null };
                      }
                      return { data: [], error: null };
                    },
                  };
                },
              };
            },
            or: () => {
              const res = (() => {
                if (table === 'customers') return { data: customerRows, error: null };
                if (table === 'member_profiles') return { data: memberProfileRows, error: null };
                if (table === 'bookings') return { data: bookingRows, error: null };
                return { data: [], error: null };
              })();
              return {
                ...res,
                order: async () => res,
                then: (resolve) => resolve(res),
              };
            },
            in(col, vals) {
              if (table === 'transactions') {
                return {
                  eq: (col2, val2) => ({
                    order: async () => {
                      const filtered = transactionRows.filter(r => vals.includes(r[col]) && r[col2] === val2);
                      return { data: filtered, error: null };
                    },
                  }),
                };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}

test('Task 11.1 REGRESSION FIXTURE: resolves customer_history across legacy customer aliases for same trusted phone', async () => {
  const supabase = createMockSupabaseFixture();
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281311112222',
  });

  const res = await executeCustomerIntelligence(
    { intent: 'customer_history', trustedIdentity },
    { supabase }
  );

  assert.equal(res.execution_status, 'success', `Expected success but got ${res.execution_status}`);
  assert.ok(res.intelligence, 'Intelligence payload should exist');
  assert.equal(res.intelligence.status, 'success');

  const historyData = res.intelligence.facts;
  assert.ok(historyData, 'History facts should exist');

  // Aggregated transaction count: 6 (from cust-id-A) + 3 (from cust-id-B) = 9
  assert.equal(historyData.completed_transaction_count, 9);

  // Aggregated booking count: 2 (from bk-1 and bk-2)
  assert.equal(historyData.completed_booking_count, 2);

  // Last visit is latest event across all aliases: booking on 2026-08-25 vs tx on 2026-08-20 -> 2026-08-25
  assert.equal(historyData.last_visit, '2026-08-25');

  // Security: No alias customer IDs exposed in payload
  const jsonStr = JSON.stringify(res);
  assert.equal(jsonStr.includes('cust-id-A'), false, 'cust-id-A must not leak');
  assert.equal(jsonStr.includes('cust-id-B'), false, 'cust-id-B must not leak');
  assert.equal(jsonStr.includes('cust-id-C'), false, 'cust-id-C must not leak');
});

test('Task 11.1 SECURITY NEGATIVE A: does NOT merge customers with same name but DIFFERENT phone numbers', async () => {
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            or: async () => {
              if (table === 'customers') {
                return {
                  data: [
                    { id: 'c1', name: 'Adhit Nugraha', wa: '6281311112222', phone_e164: '+6281311112222' },
                    { id: 'c2', name: 'Adhit Nugraha', wa: '6289999999999', phone_e164: '+6289999999999' },
                  ],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };

  const identity = await resolveCustomerIdentity(supabase, { phone: '6281311112222' });
  // Candidate c2 normalizes to a DIFFERENT phone (6289999999999), so it MUST NOT be merged into 6281311112222 cluster
  assert.equal(identity.found, true);
  assert.equal(identity.customer_id, 'c1');
  assert.deepEqual(identity.alias_customer_ids, ['c1']);
});

test('Task 11.1 SECURITY NEGATIVE B: fails closed as ambiguous when same phone has TWO member_profiles', async () => {
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            or: async () => {
              if (table === 'member_profiles') {
                return {
                  data: [
                    { id: 'prof-1', phone: '+6281311112222', user_key: 'ukey-1' },
                    { id: 'prof-2', phone: '+6281311112222', user_key: 'ukey-2' },
                  ],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };

  const identity = await resolveCustomerIdentity(supabase, { phone: '6281311112222' });
  assert.equal(identity.found, false);
  assert.equal(identity.resolution, 'ambiguous');
  assert.equal(identity.reason, 'multiple_member_profile_records');
});

test('Task 11.1 SECURITY NEGATIVE D: blocks dual claims (trusted phone + customer_id) that resolve to different clusters', async () => {
  const supabase = createMockSupabaseFixture();
  const identity = await resolveCustomerIdentity(supabase, { phone: '6281311112222', customer_id: 'a0000000-0000-4000-8000-000000000099' });

  assert.equal(identity.found, false);
  assert.equal(identity.resolution, 'ambiguous');
  assert.equal(identity.reason, 'dual_claim_conflict');
});

test('Task 11.1 PRODUCTION QUESTION TEST: "kapan terakhir aku potong rambut di Redbox?" flows to Reddy without crm_unavailable_guard', async () => {
  const supabase = createMockSupabaseFixture();
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281311112222',
  });

  let reddyCalled = false;
  let sentReply = null;

  const result = await handleMessage({
    from: '6281311112222',
    name: 'Adhit Nugraha',
    text: 'kapan terakhir aku potong rambut di Redbox?',
    branchFromPayload: 'bypass',
    trustedIdentity,
  }, {
    orchestrate: async () => ({
      route: 'crm_agent',
      agent: 'crm_agent',
      intent: 'customer_history',
      action: 'get_history',
    }),
    loadConversationHistory: async () => [],
    executeIntelligence: (params) => executeCustomerIntelligence(params, { supabase }),
    executeReddy: async ({ customerIntelligence }) => {
      reddyCalled = true;
      assert.ok(customerIntelligence, 'Reddy should receive customerIntelligence payload');
      assert.equal(customerIntelligence.facts.last_visit, '2026-08-25');
      const replyMsg = 'Terakhir kali potong rambut tanggal 25 Agustus 2026 di cabang Bypass kak!';
      return { reply: replyMsg, sendResult: { status: 'sent' } };
    },
    send: async (_from, reply) => {
      sentReply = reply;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  });

  assert.equal(result.used, 'crm_reddy_intelligence');
  assert.equal(reddyCalled, true);
  assert.equal(result.reply, 'Terakhir kali potong rambut tanggal 25 Agustus 2026 di cabang Bypass kak!');
  assert.notEqual(result.used, 'crm_unavailable_guard');
});
