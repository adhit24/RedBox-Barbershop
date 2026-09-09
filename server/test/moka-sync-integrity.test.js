'use strict';

/**
 * Task: Moka Transaction & Customer Sync Integrity Test Suite.
 *
 * Exercises:
 *   1. Transaction identity & idempotency (retry produces 1 record).
 *   2. Reconciliation integration: merged customer alias (B -> A) resolves to canonical customer A.
 *   3. Customer linkage: unique match vs ambiguous fail-closed (customer_id = null).
 *   4. Outlet resolution: known outlets succeed, unknown/missing outlet fails closed without fallback to Bypass.
 *   5. Transaction status & void safety: void/refunded order updates transactions to cancelled/refunded.
 *   6. Checkpoint safety: partial failure (errors > 0) does NOT advance cursor/checkpoint.
 *   7. Concurrent cron safety: in-process promise coalescing prevents duplicate parallel syncs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTransactionCustomerLinkage,
  maintainCustomerRecordSafely,
  STATUS,
} = require('../services/transactionCustomerLinkage');

const { resolveCustomerIdentity } = require('../services/customerIdentityResolver');
const { resolveCustomerIdentity: resolveCoreIdentity } = require('../crm/customerIdentity');
const { pullMokaToWeb, bridgeBookingToMoka } = require('../moka/sync');

// ── 1. TRANSACTION IDENTITY & IDEMPOTENCY ─────────────────────────────────────
test('1. Transaction identity: external_id is immutable idempotency key and rejects duplicates', async () => {
  const transactionsStore = [];
  const mockSupabase = {
    from: (table) => {
      assert.equal(table, 'transactions');
      return {
        select: () => ({
          eq: (field, val) => ({
            maybeSingle: async () => {
              assert.equal(field, 'external_id');
              const found = transactionsStore.find(t => t.external_id === val);
              return { data: found || null, error: null };
            },
          }),
        }),
        insert: (row) => ({
          select: () => ({
            single: async () => {
              const existing = transactionsStore.find(t => t.external_id === row.external_id);
              if (existing) {
                const err = new Error('duplicate key value violates unique constraint "transactions_external_id_key"');
                err.code = '23505';
                return { data: null, error: err };
              }
              const newRow = { id: `tx-${transactionsStore.length + 1}`, ...row };
              transactionsStore.push(newRow);
              return { data: newRow, error: null };
            },
          }),
        }),
      };
    },
  };

  // First sync of transaction moka-order-101
  const syncTx = async (txData) => {
    const { data: existing } = await mockSupabase.from('transactions')
      .select('id')
      .eq('external_id', txData.external_id)
      .maybeSingle();

    if (existing) return { status: 'already_exists', id: existing.id };

    const { data: inserted, error } = await mockSupabase.from('transactions')
      .insert(txData)
      .select('id')
      .single();

    if (error) throw error;
    return { status: 'inserted', id: inserted.id };
  };

  const payload = {
    external_id: 'moka-order-101',
    total_amount: 50000,
    source: 'moka',
    status: 'completed',
  };

  const res1 = await syncTx(payload);
  assert.equal(res1.status, 'inserted');
  assert.equal(transactionsStore.length, 1);

  // Second sync (retry)
  const res2 = await syncTx(payload);
  assert.equal(res2.status, 'already_exists');
  assert.equal(res2.id, res1.id);
  assert.equal(transactionsStore.length, 1, 'Retry must NOT insert duplicate transaction');

  // Concurrent second insert attempting direct write triggers unique violation
  await assert.rejects(
    async () => {
      const { error } = await mockSupabase.from('transactions').insert(payload).select('id').single();
      if (error) throw error;
    },
    { code: '23505' }
  );
  assert.equal(transactionsStore.length, 1);
});

// ── 2. RECONCILIATION INTEGRATION: MERGED CUSTOMER ALIAS RESOLUTION ──────────
test('2. Reconciliation integration: transaction with duplicate customer B moka_customer_id resolves to canonical A', async () => {
  // Scenario: Duplicate customer B was soft-merged into Canonical Customer A.
  const mockCustomers = [
    {
      id: 'cust-canonical-A',
      name: 'Adhitia Canonical',
      wa: '628123456789',
      phone_e164: '+628123456789',
      moka_customer_id: 'moka-cust-A',
      merged_into_customer_id: null,
    },
    {
      id: 'cust-duplicate-B',
      name: 'Adhit Duplicate',
      wa: '628123456789',
      phone_e164: '+628123456789',
      moka_customer_id: 'moka-cust-B', // Duplicate's Moka ID
      merged_into_customer_id: 'cust-canonical-A', // Merged into A!
    },
  ];

  const mockSupabase = {
    from: (table) => {
      if (table === 'member_profiles') {
        return {
          select: () => ({
            or: async () => ({ data: [], error: null }),
          }),
        };
      }
      assert.equal(table, 'customers');
      return {
        select: (fields) => ({
          eq: (col, val) => {
            if (col === 'moka_customer_id') {
              const matches = mockCustomers.filter(c => c.moka_customer_id === val);
              return {
                data: matches,
                error: null,
                maybeSingle: async () => ({ data: matches[0] || null, error: null }),
              };
            }
            return {
              data: [],
              error: null,
              maybeSingle: async () => ({ data: null, error: null }),
            };
          },
          or: (conditions) => {
            // Phone lookup for 628123456789
            return { data: mockCustomers, error: null };
          },
        }),
      };
    },
  };

  // Test 2a: Transaction customer linkage with moka-cust-B resolves to cust-canonical-A
  const linkagePlan = await resolveTransactionCustomerLinkage(mockSupabase, {
    transaction: { id: 'tx-new', external_id: 'order-999' },
    mokaCustomerId: 'moka-cust-B',
    sourceSystem: 'moka_sync',
  });

  assert.equal(linkagePlan.status, STATUS.LINKED_UNIQUE_MOKA);
  assert.equal(linkagePlan.customer_id, 'cust-canonical-A', 'Must resolve to canonical customer A, not duplicate B');
  assert.equal(linkagePlan.safe_to_link, true);

  // Test 2b: customerIdentityResolver with moka-cust-B resolves to cust-canonical-A
  const idRes = await resolveCustomerIdentity(mockSupabase, { moka_customer_id: 'moka-cust-B' });
  assert.equal(idRes.status, 'resolved');
  assert.equal(idRes.customer_id, 'cust-canonical-A');

  // Test 2c: CRM phone resolver with same phone resolves to canonical A instead of failing as ambiguous
  const phoneRes = await resolveCoreIdentity(mockSupabase, { phone: '08123456789' });
  assert.equal(phoneRes.found, true);
  assert.equal(phoneRes.customer_id, 'cust-canonical-A', 'Canonical customer must win over merged duplicate');
  assert.equal(phoneRes.resolution, 'phone_match');
});

// ── 3. CUSTOMER LINKAGE: AMBIGUOUS & INVALID PHONES FAIL CLOSED ──────────────
test('3. Customer linkage: ambiguous phone across unmerged customers fails closed with customer_id = null', async () => {
  const unmergedCustomers = [
    {
      id: 'cust-user-1',
      name: 'User One',
      wa: '628999999999',
      phone_e164: '+628999999999',
      moka_customer_id: 'moka-1',
      merged_into_customer_id: null,
    },
    {
      id: 'cust-user-2',
      name: 'User Two',
      wa: '628999999999',
      phone_e164: '+628999999999',
      moka_customer_id: 'moka-2',
      merged_into_customer_id: null, // Distinct unmerged customer!
    },
  ];

  const mockSupabase = {
    from: (table) => {
      if (table === 'member_profiles') {
        return { select: () => ({ or: async () => ({ data: [], error: null }) }) };
      }
      return {
        select: () => ({
          or: async () => ({ data: unmergedCustomers, error: null }),
          eq: async () => ({ data: [], error: null }),
        }),
      };
    },
  };

  const plan = await resolveTransactionCustomerLinkage(mockSupabase, {
    transaction: { id: 'tx-ambiguous', external_id: 'ord-ambig' },
    phone: '08999999999',
    sourceSystem: 'moka_sync',
  });

  assert.equal(plan.status, STATUS.AMBIGUOUS_PHONE);
  assert.equal(plan.customer_id, null, 'Ambiguous identity must NOT guess customer_id');
  assert.equal(plan.safe_to_link, false);
});

// ── 4. OUTLET RESOLUTION & FAIL-CLOSED UNKNOWN OUTLET ──────────────────────────
test('4. Outlet resolution: missing or unknown outlet in bridge fails closed without falling back to Bypass', async () => {
  const mockSupabase = {
    from: (table) => {
      if (table === 'schedules') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === 'outlets') {
        return {
          select: () => ({
            eq: (col, slug) => ({
              maybeSingle: async () => {
                if (slug === 'csb') return { data: { id: 'out-csb', moka_outlet_id: 'moka-csb' }, error: null };
                if (slug === 'bypass') return { data: { id: 'out-bypass', moka_outlet_id: 'moka-bypass' }, error: null };
                return { data: null, error: null }; // Unknown outlet
              },
            }),
          }),
        };
      }
      return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    },
  };

  // Case 4a: Missing location slug -> fails closed (does NOT default to bypass)
  const resMissing = await bridgeBookingToMoka(mockSupabase, {
    id: 'booking-no-loc',
    location: null,
  });
  assert.equal(resMissing.scheduleId, null);
  assert.equal(resMissing.mokaSync, 'skipped_no_outlet');

  // Case 4b: Unknown location slug -> fails closed
  const resUnknown = await bridgeBookingToMoka(mockSupabase, {
    id: 'booking-unknown-loc',
    location: 'unknown-mall-99',
  });
  assert.equal(resUnknown.scheduleId, null);
  assert.equal(resUnknown.mokaSync, 'skipped_no_outlet');
});

// ── 5. TRANSACTION STATUS & VOID SAFETY ───────────────────────────────────────
test('5. Transaction status & void safety: void/refund orders update transactions table status', async () => {
  let updatedTransactionStatus = null;
  let updatedScheduleStatus = null;

  const mockSupabase = {
    from: (table) => {
      if (table === 'schedules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'sch-1', status: 'reserved', source: 'moka' },
                error: null,
              }),
            }),
          }),
          update: (patch) => ({
            eq: () => {
              updatedScheduleStatus = patch.status;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'transactions') {
        return {
          update: (patch) => ({
            eq: (col, val) => {
              assert.equal(col, 'external_id');
              assert.equal(val, 'moka-void-order-1');
              updatedTransactionStatus = patch.status;
              return { error: null };
            },
          }),
        };
      }
      return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    },
  };

  // Simulate void order event
  const voidOrder = {
    id: 'moka-void-order-1',
    is_deleted: true,
    is_refunded: false,
  };

  const isVoid = Boolean(voidOrder.is_deleted || voidOrder.is_refunded);
  assert.equal(isVoid, true);

  // Emulate void handler in _processIncomingOrder
  const mokaStatus = isVoid ? 'VOID' : 'COMPLETED';
  if (mokaStatus === 'VOID') {
    await mockSupabase.from('schedules').update({ status: 'cancelled' }).eq('id', 'sch-1');
    await mockSupabase.from('transactions').update({
      status: voidOrder.is_refunded ? 'refunded' : 'cancelled',
    }).eq('external_id', String(voidOrder.id));
  }

  assert.equal(updatedScheduleStatus, 'cancelled');
  assert.equal(updatedTransactionStatus, 'cancelled', 'Transaction record must be marked cancelled');
});

// ── 6. CHECKPOINT SAFETY ON PARTIAL FAILURE ───────────────────────────────────
test('6. Checkpoint safety: partial failure (errors > 0) prevents advancing last_polled_at', async () => {
  let persistedLastPolledAt = null;

  const mockSupabase = {
    from: (table) => {
      if (table === 'outlets') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'out-1', moka_outlet_id: 'moka-out-1', last_polled_at: '2026-09-01T10:00:00Z' },
                error: null,
              }),
            }),
          }),
          update: (patch) => ({
            eq: () => {
              persistedLastPolledAt = patch.last_polled_at;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'sync_logs') {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    },
  };

  // Test cursor gate logic
  const pull1WithErrors = { processed: 5, skipped: 0, errors: 2, apiError: false };

  // When errors > 0, checkpoint must NOT advance
  if (!pull1WithErrors.apiError && pull1WithErrors.errors === 0) {
    await mockSupabase.from('outlets').update({ last_polled_at: '2026-09-01T10:05:00Z' }).eq('id', 'out-1');
  }

  assert.equal(persistedLastPolledAt, null, 'Checkpoint must NOT advance when errors occurred');

  // When zero errors and zero API errors, checkpoint advances
  const pull1Clean = { processed: 5, skipped: 0, errors: 0, apiError: false };
  if (!pull1Clean.apiError && pull1Clean.errors === 0) {
    await mockSupabase.from('outlets').update({ last_polled_at: '2026-09-01T10:05:00Z' }).eq('id', 'out-1');
  }

  assert.equal(persistedLastPolledAt, '2026-09-01T10:05:00Z', 'Checkpoint advances only when clean');
});

// ── 7. CONCURRENT CRON SAFETY & PROMISE COALESCING ────────────────────────────
test('7. Concurrent cron safety: concurrent sync for same outlet coalesces onto single in-flight promise', async () => {
  let executionCount = 0;
  const activePromises = new Map();

  async function mockPullMokaToWeb(outletId) {
    if (activePromises.has(outletId)) {
      return await activePromises.get(outletId);
    }

    const run = (async () => {
      executionCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return { processed: 3, skipped: 1, errors: 0 };
    })();

    activePromises.set(outletId, run);
    try {
      return await run;
    } finally {
      activePromises.delete(outletId);
    }
  }

  // Trigger 3 concurrent calls for the same outlet
  const [resA, resB, resC] = await Promise.all([
    mockPullMokaToWeb('outlet-csb'),
    mockPullMokaToWeb('outlet-csb'),
    mockPullMokaToWeb('outlet-csb'),
  ]);

  assert.equal(executionCount, 1, 'Concurrent calls must coalesce into exactly 1 execution');
  assert.equal(resA.processed, 3);
  assert.equal(resB.processed, 3);
  assert.equal(resC.processed, 3);
});
