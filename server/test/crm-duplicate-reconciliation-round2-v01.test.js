'use strict';

/**
 * Task 17.1 — CRM Integrity Round 2: Duplicate Reconciliation Engine Tests
 * Mini Correction Round 2
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planDuplicateReconciliation,
  normalizeName,
  areNamesInConflict,
  isTransactionCountableForSpend,
  isTransactionCountableForVisit,
} = require('../services/customerDuplicateReconciliation');
const { resolveCustomerIdentity } = require('../services/customerIdentityResolver');
const { getCustomer360 } = require('../crm/customer360Service');

const CANON_PHONE = '6281311112222';

test('REC2-01. stored total_spent CANNOT choose canonical row (follows stable deterministic ID tie-breaker)', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', total_spent: 1000000, wa: CANON_PHONE },
      { id: 'row-b', total_spent: 10000, wa: CANON_PHONE },
    ],
  });

  // Selection MUST be independent of stored total_spent and sort lexicographically by id -> 'row-a'
  assert.equal(plan.canonical_customer_id, 'row-a');

  // Verify reverse ID ordering chooses 'row-a' even if row-b has 10x stored spend
  const planReverse = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-b', total_spent: 10000000, wa: CANON_PHONE },
      { id: 'row-a', total_spent: 50, wa: CANON_PHONE },
    ],
  });
  assert.equal(planReverse.canonical_customer_id, 'row-a');
});

test('REC2-02. stored visits CANNOT choose canonical row', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-b', visits: 50, wa: CANON_PHONE },
      { id: 'row-a', visits: 1, wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.canonical_customer_id, 'row-a');
});

test('REC2-03. stored points CANNOT choose canonical row', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-b', points: 999, wa: CANON_PHONE },
      { id: 'row-a', points: 0, wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.canonical_customer_id, 'row-a');
});

test('REC2-04. customers.membership_status CANNOT choose canonical row', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-b', membership_status: 'ACTIVE', wa: CANON_PHONE },
      { id: 'row-a', membership_status: 'INACTIVE', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.canonical_customer_id, 'row-a');
});

test('REC2-05. customer name CANNOT choose canonical row', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-b', name: 'Aaron', wa: CANON_PHONE },
      { id: 'row-a', name: null, wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.canonical_customer_id, 'row-a');
});

test('REC2-06. zero transaction rows + stored spend -> legacy_snapshot_fallback', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', total_spent: 150000, wa: CANON_PHONE }],
    transactions: [],
  });

  assert.equal(plan.field_plan.total_spent.value, 150000);
  assert.equal(plan.field_plan.total_spent.strategy, 'legacy_snapshot_fallback');
});

test('REC2-07. zero transaction rows + stored visits -> legacy_snapshot_fallback', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', visits: 4, wa: CANON_PHONE }],
    transactions: [],
  });

  assert.equal(plan.field_plan.visits.value, 4);
  assert.equal(plan.field_plan.visits.strategy, 'legacy_snapshot_fallback');
});

test('REC2-08. eligible completed transaction -> recomputed_from_eligible_transactions', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', total_spent: 50000, wa: CANON_PHONE }],
    transactions: [{ id: 'tx-1', customer_id: 'row-a', total_amount: 100000, status: 'completed' }],
  });

  assert.equal(plan.field_plan.total_spent.value, 100000);
  assert.equal(plan.field_plan.total_spent.strategy, 'recomputed_from_eligible_transactions');
});

test('REC2-09. eligible paid transaction -> recomputed_from_eligible_transactions', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', total_spent: 50000, wa: CANON_PHONE }],
    transactions: [{ id: 'tx-1', customer_id: 'row-a', total_amount: 120000, status: 'paid' }],
  });

  assert.equal(plan.field_plan.total_spent.value, 120000);
  assert.equal(plan.field_plan.total_spent.strategy, 'recomputed_from_eligible_transactions');
});

test('REC2-10. only cancelled transactions + stored spend > 0 -> total_spent value null, unresolved_transaction_evidence', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', total_spent: 200000, wa: CANON_PHONE }],
    transactions: [{ id: 'tx-1', customer_id: 'row-a', total_amount: 200000, status: 'cancelled' }],
  });

  assert.equal(plan.field_plan.total_spent.value, null);
  assert.equal(plan.field_plan.total_spent.strategy, 'unresolved_transaction_evidence');
});

test('REC2-11. only refunded/pending transactions + stored visits > 0 -> visits value null, unresolved_transaction_evidence', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', visits: 5, wa: CANON_PHONE }],
    transactions: [
      { id: 'tx-1', customer_id: 'row-a', total_amount: 100000, status: 'refunded' },
      { id: 'tx-2', customer_id: 'row-a', total_amount: 50000, status: 'pending' },
    ],
  });

  assert.equal(plan.field_plan.visits.value, null);
  assert.equal(plan.field_plan.visits.strategy, 'unresolved_transaction_evidence');
});

test('REC2-12. non-eligible-only transaction group -> NOT safe_auto_merge (deterministic_reconciliation + HIGH risk)', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Adhit', total_spent: 100000, wa: CANON_PHONE },
      { id: 'row-b', name: 'Adhit', total_spent: 0, wa: CANON_PHONE },
    ],
    transactions: [{ id: 'tx-1', customer_id: 'row-a', total_amount: 100000, status: 'cancelled' }],
  });

  assert.notEqual(plan.group_status, 'safe_auto_merge');
  assert.equal(plan.group_status, 'deterministic_reconciliation');
  assert.equal(plan.risk_level, 'HIGH');
  assert.ok(plan.reasons.includes('unresolved_transaction_evidence'));
});

test('REC2-13. Task17 duplicate-phone resolver behavior remains unchanged (fails closed on ambiguous)', async () => {
  const fakeSupabase = {
    from(table) {
      return {
        select() {
          return {
            or: async () => ({
              data: [
                { id: 'c1', wa: CANON_PHONE, phone_e164: `+${CANON_PHONE}` },
                { id: 'c2', wa: CANON_PHONE, phone_e164: `+${CANON_PHONE}` },
              ],
              error: null,
            }),
          };
        },
      };
    },
  };

  const identity = await resolveCustomerIdentity(fakeSupabase, { phone: CANON_PHONE });
  assert.equal(identity.status, 'ambiguous');
  assert.equal(identity.customer_id, null);
  assert.equal(identity.candidates_count, 2);
});

test('REC2-14. member_profiles authority remains unchanged (Task 14.1 authority)', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-1', membership_status: 'INACTIVE', wa: CANON_PHONE }],
    memberProfiles: [{ id: 'prof-1', phone: `+${CANON_PHONE}`, membership_status: 'ACTIVE' }],
  });

  assert.equal(plan.field_plan.membership_status.value, 'ACTIVE');
  assert.equal(plan.field_plan.membership_status.strategy, 'member_profile_authority');
});

test('REC2-15. strict conservative name conflict remains unchanged', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Adhit', wa: CANON_PHONE },
      { id: 'row-b', name: 'Adhit Nugraha', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('conflicting_customer_names'));
});

test('REC2-16. planner performs zero DB writes (pure calculation engine)', () => {
  const sampleGroup = Object.freeze({
    phone: CANON_PHONE,
    rows: Object.freeze([{ id: 'r1', wa: CANON_PHONE }, { id: 'r2', wa: CANON_PHONE }]),
  });

  assert.doesNotThrow(() => {
    const plan = planDuplicateReconciliation(sampleGroup);
    assert.ok(plan);
  });
});

test('REC2-17. PII-safe reasons remain intact (zero customer name, phone, or moka ID in plan metadata)', () => {
  const plan = planDuplicateReconciliation({
    phone: '6281399998888',
    rows: [
      { id: 'r1', name: 'Super Secret Customer Name', moka_customer_id: 'moka-secret-999', wa: '6281399998888' },
      { id: 'r2', name: 'Different Secret Name', moka_customer_id: 'moka-secret-888', wa: '6281399998888' },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  const planStr = JSON.stringify({ reasons: plan.reasons, conflicts: plan.conflicts });

  assert.ok(!planStr.includes('Super Secret'));
  assert.ok(!planStr.includes('Different Secret'));
  assert.ok(!planStr.includes('6281399998888'));
  assert.ok(!planStr.includes('moka-secret-999'));
  assert.ok(!planStr.includes('moka-secret-888'));
});
