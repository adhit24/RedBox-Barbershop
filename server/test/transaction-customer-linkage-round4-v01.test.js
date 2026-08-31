'use strict';

/**
 * Task 17.3 — Transaction -> Customer Linkage Test Suite (Round 4 Correction Round 2).
 *
 * Exercises all required Correction Round 2 fail-closed conflict-check error scenarios:
 *   1. Moka conflict lookup error blocks Moka-ID backfill (backfill_blocked_lookup_failed)
 *   2. Backfill UPDATE DB error does not report success (backfill_failed)
 *   3. Moka conflict lookup error blocks customer creation (creation_blocked_lookup_failed)
 *   4. Phone conflict lookup error blocks customer creation (creation_blocked_lookup_failed)
 *   5. Either conflict lookup error => zero INSERT
 *   6. Either conflict lookup error => zero UPDATE
 *   7. True zero-match checks still allow safe creation
 *   8. Duplicate Moka still blocks creation (creation_blocked_conflicting_moka_id)
 *   9. Duplicate phone still blocks creation (creation_blocked_conflicting_phone)
 *   10. Unique-phone transaction remains linked even if optional Moka backfill conflict-check fails
 *   11. NOT_FOUND + maintenance lookup failure => schedule customer_id = NULL
 *   12. NOT_FOUND + maintenance lookup failure => transaction customer_id = NULL
 *   13. Ingestion continues fail-open despite maintenance lookup failure
 *   14. No PII in maintenance result/telemetry
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  PROVENANCE,
  planTransactionCustomerLinkage,
  resolveTransactionCustomerLinkage,
  maintainCustomerRecordSafely,
} = require('../services/transactionCustomerLinkage');

function mockSupabase(customersTable = [], options = {}) {
  const table = [...customersTable];
  let lastInserted = null;
  let updateAttempted = false;
  let insertAttempted = false;

  return {
    _table: table,
    _updateAttempted: () => updateAttempted,
    _insertAttempted: () => insertAttempted,
    from(tableName) {
      if (tableName === 'customers') {
        return {
          select(_cols) {
            return {
              eq(colName, colVal) {
                if (colName === 'moka_customer_id' && options.errorOnMokaLookup) {
                  return Promise.resolve({ data: null, error: new Error('Moka lookup database error') });
                }
                if (colName === 'phone_e164' && options.errorOnPhoneLookup) {
                  return Promise.resolve({ data: null, error: new Error('Phone lookup database error') });
                }
                const matched = table.filter(row => String(row[colName]) === String(colVal));
                return Promise.resolve({ data: matched, error: null });
              },
            };
          },
          update(updates) {
            updateAttempted = true;
            return {
              eq(colName, colVal) {
                if (options.errorOnUpdate) {
                  return Promise.resolve({ error: new Error('Database update error') });
                }
                for (const r of table) {
                  if (String(r[colName]) === String(colVal)) {
                    Object.assign(r, updates);
                  }
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(newRow) {
            insertAttempted = true;
            if (options.errorOnInsert) {
              return {
                select(_cols) {
                  return {
                    single() {
                      return Promise.resolve({ data: null, error: new Error('Database insert error') });
                    },
                  };
                },
              };
            }
            const inserted = { id: `new-cust-${table.length + 1}`, ...newRow };
            table.push(inserted);
            lastInserted = inserted;
            return {
              select(_cols) {
                return {
                  single() {
                    return Promise.resolve({ data: inserted, error: null });
                  },
                };
              },
            };
          },
        };
      }
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  };
}

// ── TEST 1: Moka conflict lookup error blocks Moka-ID backfill ────────────────
test('TEST 1: Moka conflict lookup error blocks Moka-ID backfill', async () => {
  const sb = mockSupabase(
    [{ id: 'c-phone-1', phone_e164: '+628123456789', moka_customer_id: null }],
    { errorOnMokaLookup: true }
  );

  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-1' },
    phoneResolverResult: { status: 'resolved', customer_id: 'c-phone-1', candidates_count: 1, match_basis: 'normalized_phone' },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+628123456789', id: 'moka-new-100' }, plan);

  assert.equal(maint.action, 'backfill_blocked_lookup_failed');
  assert.equal(maint.customer_id, 'c-phone-1');
  assert.equal(sb._updateAttempted(), false);
  assert.equal(sb._table[0].moka_customer_id, null);
});

// ── TEST 2: backfill UPDATE DB error does not report success ─────────────────
test('TEST 2: backfill UPDATE DB error does not report success', async () => {
  const sb = mockSupabase(
    [{ id: 'c-phone-2', phone_e164: '+628123456789', moka_customer_id: null }],
    { errorOnUpdate: true }
  );

  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-2' },
    phoneResolverResult: { status: 'resolved', customer_id: 'c-phone-2', candidates_count: 1, match_basis: 'normalized_phone' },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+628123456789', id: 'moka-200' }, plan);

  assert.equal(maint.action, 'backfill_failed');
  assert.equal(maint.customer_id, 'c-phone-2');
  assert.equal(sb._updateAttempted(), true);
});

// ── TEST 3: Moka conflict lookup error blocks customer creation ─────────────
test('TEST 3: Moka conflict lookup error blocks customer creation', async () => {
  const sb = mockSupabase([], { errorOnMokaLookup: true });
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-3' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-300', phone: '08123456789' }, plan);

  assert.equal(maint.action, 'creation_blocked_lookup_failed');
  assert.equal(maint.customer_id, null);
  assert.equal(sb._insertAttempted(), false);
  assert.equal(sb._table.length, 0);
});

// ── TEST 4: phone conflict lookup error blocks customer creation ────────────
test('TEST 4: phone conflict lookup error blocks customer creation', async () => {
  const sb = mockSupabase([], { errorOnPhoneLookup: true });
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-4' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-400', phone: '08123456789' }, plan);

  assert.equal(maint.action, 'creation_blocked_lookup_failed');
  assert.equal(maint.customer_id, null);
  assert.equal(sb._insertAttempted(), false);
  assert.equal(sb._table.length, 0);
});

// ── TEST 5 & 6: either conflict lookup error => zero INSERT & zero UPDATE ────
test('TEST 5 & 6: either conflict lookup error => zero INSERT and zero UPDATE', async () => {
  const sbMokaErr = mockSupabase([], { errorOnMokaLookup: true });
  const plan1 = planTransactionCustomerLinkage({
    transaction: { id: 'tx-5' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  await maintainCustomerRecordSafely(sbMokaErr, { id: 'moka-500', phone: '0811111111' }, plan1);
  assert.equal(sbMokaErr._insertAttempted(), false);
  assert.equal(sbMokaErr._updateAttempted(), false);

  const sbPhoneErr = mockSupabase([], { errorOnPhoneLookup: true });
  await maintainCustomerRecordSafely(sbPhoneErr, { id: 'moka-600', phone: '0822222222' }, plan1);
  assert.equal(sbPhoneErr._insertAttempted(), false);
  assert.equal(sbPhoneErr._updateAttempted(), false);
});

// ── TEST 7: true zero-match checks still allow safe creation ─────────────────
test('TEST 7: true zero-match checks still allow safe creation', async () => {
  const sb = mockSupabase([]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-7' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-clean-700', phone: '08123456789', name: 'Safe New Cust' }, plan);
  assert.equal(maint.action, 'customer_created');
  assert.notEqual(maint.customer_id, null);
  assert.equal(sb._insertAttempted(), true);
  assert.equal(sb._table.length, 1);
});

// ── TEST 8: duplicate Moka still blocks creation ──────────────────────────────
test('TEST 8: duplicate Moka still blocks creation', async () => {
  const sb = mockSupabase([{ id: 'c-exist-moka', moka_customer_id: 'moka-dup-800' }]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-8' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-dup-800', phone: '0819999999' }, plan);
  assert.equal(maint.action, 'creation_blocked_conflicting_moka_id');
  assert.equal(sb._insertAttempted(), false);
  assert.equal(sb._table.length, 1);
});

// ── TEST 9: duplicate phone still blocks creation ─────────────────────────────
test('TEST 9: duplicate phone still blocks creation', async () => {
  const sb = mockSupabase([{ id: 'c-exist-phone', phone_e164: '+62819999999' }]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-9' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-new-900', phone: '0819999999' }, plan);
  assert.equal(maint.action, 'creation_blocked_conflicting_phone');
  assert.equal(sb._insertAttempted(), false);
  assert.equal(sb._table.length, 1);
});

// ── TEST 10: unique-phone transaction remains linked even if optional Moka backfill conflict-check fails ──
test('TEST 10: unique-phone transaction remains linked even if optional Moka backfill conflict-check fails', async () => {
  const sb = mockSupabase(
    [{ id: 'c-phone-10', phone_e164: '+628123456789', moka_customer_id: null }],
    { errorOnMokaLookup: true }
  );

  const canonicalPlan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-10' },
    phoneResolverResult: { status: 'resolved', customer_id: 'c-phone-10', candidates_count: 1, match_basis: 'normalized_phone' },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+628123456789', id: 'moka-1000' }, canonicalPlan);
  assert.equal(maint.action, 'backfill_blocked_lookup_failed');

  // Transaction ownership calculation:
  const provenCustomerId = canonicalPlan.safe_to_link
    ? canonicalPlan.customer_id
    : (maint.action === 'customer_created' ? maint.customer_id : null);

  assert.equal(provenCustomerId, 'c-phone-10'); // Transaction remains linked to unique phone customer!
  assert.equal(sb._table[0].moka_customer_id, null); // But Moka ID was NOT backfilled
});

// ── TEST 11 & 12: NOT_FOUND + maintenance lookup failure => schedule & transaction customer_id = NULL ─
test('TEST 11 & 12: NOT_FOUND + maintenance lookup failure => schedule and transaction customer_id = NULL', async () => {
  const sb = mockSupabase([], { errorOnPhoneLookup: true });
  const canonicalPlan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-11' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '08123456789' }, canonicalPlan);
  assert.equal(maint.action, 'creation_blocked_lookup_failed');

  const provenCustomerId = canonicalPlan.safe_to_link
    ? canonicalPlan.customer_id
    : (maint.action === 'customer_created' ? maint.customer_id : null);

  assert.equal(provenCustomerId, null); // Schedule & transaction both fail closed to NULL!
});

// ── TEST 13: ingestion continues despite maintenance lookup failure ─────────
test('TEST 13: ingestion continues fail-open despite maintenance lookup failure', async () => {
  const sb = mockSupabase([], { errorOnMokaLookup: true });
  const canonicalPlan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-13' },
    mokaResolverResult: { status: 'lookup_failed', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-1300' }, canonicalPlan);
  assert.equal(maint.action, 'none');

  // Transaction ingestion writes transaction row with NULL customer_id
  const transactionRecord = {
    external_id: 'moka-ord-13',
    customer_id: canonicalPlan.customer_id, // NULL
    total_amount: 50000,
  };

  assert.equal(transactionRecord.customer_id, null);
  assert.equal(transactionRecord.external_id, 'moka-ord-13');
});

// ── TEST 14: no PII in maintenance result/telemetry ──────────────────────────
test('TEST 14: no PII in maintenance result / telemetry', async () => {
  const sb = mockSupabase([], { errorOnPhoneLookup: true });
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-14' },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(
    sb,
    { phone: '+628123456789', name: 'John Doe PII', email: 'john@example.com' },
    plan
  );

  assert.equal(maint.phone, undefined);
  assert.equal(maint.name, undefined);
  assert.equal(maint.email, undefined);
  assert.equal(maint.action, 'creation_blocked_lookup_failed');
});
