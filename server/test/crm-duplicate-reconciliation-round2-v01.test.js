'use strict';

/**
 * Task 17.1 — CRM Integrity Round 2: Duplicate Reconciliation Engine Tests
 * Correction Round 1
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

test('REC2-01. one Moka row + one web duplicate selects Moka row as deterministic canonical', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'web-row-1', name: 'Adhit', source: 'web', moka_customer_id: null, wa: CANON_PHONE },
      { id: 'moka-row-2', name: 'Adhit', source: 'moka', moka_customer_id: 'moka-101', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'safe_auto_merge');
  assert.equal(plan.canonical_customer_id, 'moka-row-2');
  assert.deepEqual(plan.alias_customer_ids, ['web-row-1']);
  assert.equal(plan.field_plan.moka_customer_id.value, 'moka-101');
  assert.equal(plan.risk_level, 'LOW');
});

test('REC2-02. two rows same phone with exact normalized same name results in safe_auto_merge', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Budi Santoso', wa: CANON_PHONE, points: 50 },
      { id: 'row-b', name: 'budi   santoso', wa: CANON_PHONE, points: 0 },
    ],
  });

  assert.equal(plan.group_status, 'safe_auto_merge');
  assert.equal(plan.canonical_customer_id, 'row-a');
  assert.deepEqual(plan.alias_customer_ids, ['row-b']);
  assert.equal(plan.field_plan.name.value, 'Budi Santoso');
  assert.equal(plan.risk_level, 'LOW');
});

test('REC2-03a. Budi A vs Budi B triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Budi A', wa: CANON_PHONE },
      { id: 'row-b', name: 'Budi B', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('conflicting_customer_names'));
});

test('REC2-03b. Adhit vs Adhit Nugraha triggers manual_review', () => {
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

test('REC2-03c. John vs John Doe triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'John', wa: CANON_PHONE },
      { id: 'row-b', name: 'John Doe', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('conflicting_customer_names'));
});

test('REC2-03d. Budi Santoso vs Budi Santoso Jr triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Budi Santoso', wa: CANON_PHONE },
      { id: 'row-b', name: 'Budi Santoso Jr', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('conflicting_customer_names'));
});

test('REC2-04. two distinct Moka IDs on same phone triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', moka_customer_id: 'moka-001', wa: CANON_PHONE },
      { id: 'row-b', moka_customer_id: 'moka-002', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('multiple_distinct_moka_customer_ids'));
});

test('REC2-05a. two customers rows both membership_status=ACTIVE with zero member_profiles does NOT create membership conflict', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', membership_status: 'ACTIVE', wa: CANON_PHONE },
      { id: 'row-b', membership_status: 'ACTIVE', wa: CANON_PHONE },
    ],
    memberProfiles: [],
  });

  assert.equal(plan.group_status, 'safe_auto_merge');
  assert.ok(!plan.conflicts.includes('multiple_authoritative_memberships'));
});

test('REC2-05b. two authoritative member_profiles that genuinely conflict triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', wa: CANON_PHONE },
      { id: 'row-b', wa: CANON_PHONE },
    ],
    memberProfiles: [
      { id: 'p1', membership_status: 'ACTIVE' },
      { id: 'p2', membership_status: 'ACTIVE' },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('multiple_authoritative_memberships'));
});

test('REC2-06a. no member_profile results in explicit no_authoritative_membership_fact, not synthetic INACTIVE', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-1', membership_status: 'ACTIVE', wa: CANON_PHONE }],
    memberProfiles: [],
  });

  assert.equal(plan.field_plan.membership_status.value, null);
  assert.equal(plan.field_plan.membership_status.strategy, 'no_authoritative_membership_fact');
});

test('REC2-06b. invalid phone shape returns invalid_identity', () => {
  const plan = planDuplicateReconciliation({
    phone: '123',
    rows: [{ id: 'row-1', wa: '123' }],
  });

  assert.equal(plan.group_status, 'invalid_identity');
  assert.equal(plan.canonical_customer_id, null);
  assert.equal(plan.risk_level, 'HIGH');
});

test('REC2-07. completed transactions are included in spend, cancelled/refunded/void/failed/pending excluded', () => {
  const txs = [
    { id: 't1', status: 'completed', total_amount: 100000 },
    { id: 't2', status: 'PAID', total_amount: 50000 },
    { id: 't3', status: 'cancelled', total_amount: 80000 },
    { id: 't4', status: 'refunded', total_amount: 60000 },
    { id: 't5', status: 'failed', total_amount: 40000 },
    { id: 't6', status: 'pending', total_amount: 30000 },
    { id: 't7', status: null, total_amount: 20000 },
  ];

  assert.equal(isTransactionCountableForSpend(txs[0]), true);
  assert.equal(isTransactionCountableForSpend(txs[1]), true);
  assert.equal(isTransactionCountableForSpend(txs[2]), false);
  assert.equal(isTransactionCountableForSpend(txs[3]), false);
  assert.equal(isTransactionCountableForSpend(txs[4]), false);
  assert.equal(isTransactionCountableForSpend(txs[5]), false);
  assert.equal(isTransactionCountableForSpend(txs[6]), false);

  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', wa: CANON_PHONE }],
    transactions: txs.map(t => ({ ...t, customer_id: 'row-a' })),
  });

  assert.equal(plan.field_plan.total_spent.value, 150000);
});

test('REC2-08. visit count uses correct completed/paid status semantics only', () => {
  const txs = [
    { id: 't1', status: 'completed', total_amount: 100000 },
    { id: 't2', status: 'completed', total_amount: 50000 },
    { id: 't3', status: 'cancelled', total_amount: 80000 },
    { id: 't4', status: 'pending', total_amount: 30000 },
  ];

  assert.equal(isTransactionCountableForVisit(txs[0]), true);
  assert.equal(isTransactionCountableForVisit(txs[1]), true);
  assert.equal(isTransactionCountableForVisit(txs[2]), false);
  assert.equal(isTransactionCountableForVisit(txs[3]), false);

  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-a', wa: CANON_PHONE }],
    transactions: txs.map(t => ({ ...t, customer_id: 'row-a' })),
  });

  assert.equal(plan.field_plan.visits.value, 2);
});

test('REC2-09. plan reasons and metadata contain ZERO customer PII and zero moka ID strings', () => {
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
  assert.deepEqual(plan.reasons, ['conflicting_moka_customer_ids', 'conflicting_customer_names']);
});

test('REC2-10. Task17 duplicate-phone resolver behavior remains unchanged (fails closed on ambiguous)', async () => {
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

test('REC2-11. CRM/Reddy still fail closed on unresolved duplicate identity from getCustomer360', async () => {
  const fakeSupabase = {
    from(table) {
      return {
        select() {
          return {
            or: async () => ({
              data: [
                { id: 'c1', wa: CANON_PHONE, phone_e164: `+${CANON_PHONE}`, name: 'A' },
                { id: 'c2', wa: CANON_PHONE, phone_e164: `+${CANON_PHONE}`, name: 'B' },
              ],
              error: null,
            }),
          };
        },
      };
    },
  };

  const c360 = await getCustomer360(fakeSupabase, { phone: CANON_PHONE });
  assert.equal(c360.identity.customer_found, false);
  assert.equal(c360.identity.customer_id, null);
  assert.equal(c360.customer, null);
});

test('REC2-12. planner performs zero DB writes (pure calculation engine)', () => {
  const sampleGroup = Object.freeze({
    phone: CANON_PHONE,
    rows: Object.freeze([{ id: 'r1', wa: CANON_PHONE }, { id: 'r2', wa: CANON_PHONE }]),
  });

  assert.doesNotThrow(() => {
    const plan = planDuplicateReconciliation(sampleGroup);
    assert.ok(plan);
  });
});
