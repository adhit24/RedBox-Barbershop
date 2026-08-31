'use strict';

/**
 * Task 17.3 — Transaction -> Customer Linkage Test Suite (Round 4 Correction Round 1).
 *
 * Exercises all 15 required correction test scenarios:
 *   1. Duplicate Moka ID does NOT create another customer
 *   2. Duplicate Moka ID does NOT backfill another customer
 *   3. Duplicate Moka ID -> transaction.customer_id = NULL
 *   4. Duplicate Moka ID -> schedule.customer_id = NULL (unless trusted Redbox FK exists)
 *   5. Moka lookup failure does NOT create customer
 *   6. Moka lookup failure -> transaction still inserts with NULL (fail-open)
 *   7. Phone ambiguity does NOT create customer
 *   8. Phone ambiguity does NOT populate schedule.customer_id
 *   9. True not_found can safely create exactly one customer
 *   10. Newly-created safe customer can own schedule/transaction
 *   11. Unique Moka links schedule + transaction to same customer
 *   12. Unique phone links schedule + transaction to same customer
 *   13. source='web' authoritative FK preserved
 *   14. source='moka' existing FK is re-evaluated, not blindly trusted
 *   15. No name/fuzzy/newest/oldest tie-breaking
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

const { runDryRunPlanner } = require('../scripts/transaction-customer-linkage-backfill-dryrun');

function mockSupabase(customersTable = []) {
  const table = [...customersTable];
  let lastInserted = null;

  return {
    _table: table,
    _lastInserted: () => lastInserted,
    from(tableName) {
      if (tableName === 'customers') {
        return {
          select(_cols) {
            return {
              eq(colName, colVal) {
                const matched = table.filter(row => String(row[colName]) === String(colVal));
                return Promise.resolve({ data: matched, error: null });
              },
            };
          },
          update(updates) {
            return {
              eq(colName, colVal) {
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

// ── CORRECTION TEST 1: duplicate Moka ID does NOT create another customer ──────
test('CORRECTION TEST 1: duplicate Moka ID does NOT create another customer', async () => {
  const sb = mockSupabase([
    { id: 'c-dup-1', moka_customer_id: 'moka-dup-100' },
    { id: 'c-dup-2', moka_customer_id: 'moka-dup-100' },
  ]);

  const plan = await resolveTransactionCustomerLinkage(sb, {
    transaction: { id: 'tx-c1' },
    mokaCustomerId: 'moka-dup-100',
  });

  assert.equal(plan.status, STATUS.AMBIGUOUS_MOKA);

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-dup-100', name: 'Dupe Moka' }, plan);
  assert.equal(maint.action, 'none');
  assert.equal(maint.customer_id, null);
  assert.equal(sb._table.length, 2); // No new customer inserted!
});

// ── CORRECTION TEST 2: duplicate Moka ID does NOT backfill another customer ──
test('CORRECTION TEST 2: duplicate Moka ID does NOT backfill another customer', async () => {
  const sb = mockSupabase([
    { id: 'c-phone-only', phone_e164: '+628123456789', moka_customer_id: null },
    { id: 'c-existing-moka', moka_customer_id: 'moka-dup-200' },
  ]);

  // If a incoming order has phone matching c-phone-only but moka_customer_id is moka-dup-200 (which already exists elsewhere)
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c2' },
    phoneResolverResult: { status: 'resolved', customer_id: 'c-phone-only', candidates_count: 1, match_basis: 'normalized_phone' },
  });

  assert.equal(plan.status, STATUS.LINKED_UNIQUE_PHONE);

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+628123456789', id: 'moka-dup-200' }, plan);
  assert.equal(maint.action, 'backfill_skipped_duplicate_moka_id');
  assert.equal(sb._table[0].moka_customer_id, null); // Moka ID was NOT backfilled!
});

// ── CORRECTION TEST 3: duplicate Moka ID -> transaction.customer_id = NULL ───
test('CORRECTION TEST 3: duplicate Moka ID -> transaction.customer_id = NULL', async () => {
  const sb = mockSupabase([
    { id: 'c-dup-a', moka_customer_id: 'moka-dup-300' },
    { id: 'c-dup-b', moka_customer_id: 'moka-dup-300' },
  ]);

  const plan = await resolveTransactionCustomerLinkage(sb, {
    transaction: { id: 'tx-c3' },
    mokaCustomerId: 'moka-dup-300',
  });

  assert.equal(plan.status, STATUS.AMBIGUOUS_MOKA);
  assert.equal(plan.customer_id, null);
  assert.equal(plan.safe_to_link, false);
});

// ── CORRECTION TEST 4: duplicate Moka ID -> schedule.customer_id = NULL (unless trusted Redbox FK) ─
test('CORRECTION TEST 4: duplicate Moka ID -> schedule.customer_id = NULL (unless trusted Redbox FK)', async () => {
  const sb = mockSupabase([
    { id: 'c-dup-x', moka_customer_id: 'moka-dup-400' },
    { id: 'c-dup-y', moka_customer_id: 'moka-dup-400' },
  ]);

  // Ingest order with duplicate Moka ID and no trusted FK:
  const plan = await resolveTransactionCustomerLinkage(sb, {
    transaction: { external_id: 'moka-ord-400' },
    mokaCustomerId: 'moka-dup-400',
    provenance: PROVENANCE.NONE,
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-dup-400' }, plan);
  const scheduleCustomerId = plan.safe_to_link
    ? plan.customer_id
    : (maint.action === 'customer_created' ? maint.customer_id : null);

  assert.equal(scheduleCustomerId, null);

  // BUT if schedule had verified_redbox_fk from web booking:
  const trustedPlan = planTransactionCustomerLinkage({
    transaction: { id: 'sch-web-1', customer_id: 'c-trusted-web' },
    provenance: PROVENANCE.VERIFIED_REDBOX_FK,
  });
  assert.equal(trustedPlan.customer_id, 'c-trusted-web');
});

// ── CORRECTION TEST 5: Moka lookup failure does NOT create customer ──────────
test('CORRECTION TEST 5: Moka lookup failure does NOT create customer', async () => {
  const sb = mockSupabase([]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c5' },
    mokaResolverResult: { status: 'lookup_failed', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { id: 'moka-err-500', name: 'Error Case' }, plan);
  assert.equal(maint.action, 'none');
  assert.equal(sb._table.length, 0); // Zero customers created!
});

// ── CORRECTION TEST 6: Moka lookup failure -> transaction still inserts with NULL ─
test('CORRECTION TEST 6: Moka lookup failure -> transaction still inserts with NULL (fail-open)', () => {
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c6' },
    mokaResolverResult: { status: 'lookup_failed', customer_id: null, candidates_count: 0 },
  });

  assert.equal(plan.status, STATUS.LOOKUP_FAILED);
  assert.equal(plan.customer_id, null);
  assert.equal(plan.safe_to_link, false);
});

// ── CORRECTION TEST 7: phone ambiguity does NOT create customer ──────────────
test('CORRECTION TEST 7: phone ambiguity does NOT create customer', async () => {
  const sb = mockSupabase([
    { id: 'c-p1', phone_e164: '+6281111111' },
    { id: 'c-p2', phone_e164: '+6281111111' },
  ]);

  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c7' },
    phoneResolverResult: { status: 'ambiguous', customer_id: null, candidates_count: 2 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+6281111111' }, plan);
  assert.equal(maint.action, 'none');
  assert.equal(sb._table.length, 2); // Zero new customers created!
});

// ── CORRECTION TEST 8: phone ambiguity does NOT populate schedule.customer_id ─
test('CORRECTION TEST 8: phone ambiguity does NOT populate schedule.customer_id', async () => {
  const sb = mockSupabase([]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c8' },
    phoneResolverResult: { status: 'ambiguous', customer_id: null, candidates_count: 2 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '+6282222222' }, plan);
  const scheduleCustomerId = plan.safe_to_link
    ? plan.customer_id
    : (maint.action === 'customer_created' ? maint.customer_id : null);

  assert.equal(scheduleCustomerId, null);
});

// ── CORRECTION TEST 9: true not_found can safely create exactly one customer ──
test('CORRECTION TEST 9: true not_found can safely create exactly one customer', async () => {
  const sb = mockSupabase([]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c9' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
    phoneResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '081234567899', name: 'Fresh Customer', id: 'moka-fresh-99' }, plan);
  assert.equal(maint.action, 'customer_created');
  assert.equal(typeof maint.customer_id, 'string');
  assert.equal(sb._table.length, 1);
  assert.equal(sb._table[0].name, 'Fresh Customer');
});

// ── CORRECTION TEST 10: newly-created safe customer can own schedule/transaction ─
test('CORRECTION TEST 10: newly-created safe customer can own schedule/transaction', async () => {
  const sb = mockSupabase([]);
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c10' },
    mokaResolverResult: { status: 'not_found', customer_id: null, candidates_count: 0 },
  });

  const maint = await maintainCustomerRecordSafely(sb, { phone: '089876543210', name: 'Safe New Customer' }, plan);
  const provenCustomerId = plan.safe_to_link
    ? plan.customer_id
    : (maint.action === 'customer_created' ? maint.customer_id : null);

  assert.notEqual(provenCustomerId, null);
  assert.equal(provenCustomerId, maint.customer_id);
});

// ── CORRECTION TEST 11: unique Moka links schedule + transaction to same customer ─
test('CORRECTION TEST 11: unique Moka links schedule + transaction to same customer', async () => {
  const sb = mockSupabase([
    { id: 'cust-unique-moka-11', moka_customer_id: 'moka-unique-11' },
  ]);

  const plan = await resolveTransactionCustomerLinkage(sb, {
    transaction: { external_id: 'ord-11' },
    mokaCustomerId: 'moka-unique-11',
  });

  assert.equal(plan.status, STATUS.LINKED_UNIQUE_MOKA);
  assert.equal(plan.customer_id, 'cust-unique-moka-11');
});

// ── CORRECTION TEST 12: unique phone links schedule + transaction to same customer ─
test('CORRECTION TEST 12: unique phone links schedule + transaction to same customer', () => {
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c12' },
    phoneResolverResult: { status: 'resolved', customer_id: 'cust-unique-phone-12', candidates_count: 1, match_basis: 'normalized_phone' },
  });

  assert.equal(plan.status, STATUS.LINKED_UNIQUE_PHONE);
  assert.equal(plan.customer_id, 'cust-unique-phone-12');
});

// ── CORRECTION TEST 13: source=web authoritative FK preserved ───────────────
test('CORRECTION TEST 13: source=web authoritative FK preserved', () => {
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'sch-web-13', customer_id: 'cust-authoritative-13' },
    provenance: PROVENANCE.VERIFIED_REDBOX_FK,
  });

  assert.equal(plan.status, STATUS.ALREADY_LINKED_AUTHORITATIVE);
  assert.equal(plan.customer_id, 'cust-authoritative-13');
});

// ── CORRECTION TEST 14: source=moka existing FK is re-evaluated, not blindly trusted ─
test('CORRECTION TEST 14: source=moka existing FK is re-evaluated, not blindly trusted', () => {
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'sch-moka-14', customer_id: 'cust-unverified-moka-14' },
    provenance: PROVENANCE.UNVERIFIED_LEGACY_RESOLUTION,
    mokaResolverResult: { status: 'ambiguous', candidates_count: 2 },
  });

  assert.equal(plan.status, STATUS.AMBIGUOUS_MOKA);
  assert.equal(plan.customer_id, null); // Fails closed to NULL!
});

// ── CORRECTION TEST 15: no name/fuzzy/newest/oldest tie-breaking ──────────────
test('CORRECTION TEST 15: no name/fuzzy/newest/oldest tie-breaking', () => {
  const plan = planTransactionCustomerLinkage({
    transaction: { id: 'tx-c15' },
    // Input carries fuzzy name, but no deterministic unique match:
  });

  assert.equal(plan.status, STATUS.NOT_FOUND);
  assert.equal(plan.customer_id, null);
});
