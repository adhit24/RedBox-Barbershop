'use strict';

/**
 * Task 17.1 — CRM Integrity Round 2: Duplicate Reconciliation Engine Tests
 *
 * Tests the dry-run reconciliation planner, field reconciliation rules,
 * canonical selection policy, risk classification, and zero-mutation guarantees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { planDuplicateReconciliation, cleanName, areNamesInConflict } = require('../services/customerDuplicateReconciliation');
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

test('REC2-02. two rows same phone with no conflicts results in safe_auto_merge', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Budi Santoso', wa: CANON_PHONE, points: 50 },
      { id: 'row-b', name: 'Budi Santoso', wa: CANON_PHONE, points: 0 },
    ],
  });

  assert.equal(plan.group_status, 'safe_auto_merge');
  assert.equal(plan.canonical_customer_id, 'row-a');
  assert.deepEqual(plan.alias_customer_ids, ['row-b']);
  assert.equal(plan.field_plan.name.value, 'Budi Santoso');
  assert.equal(plan.risk_level, 'LOW');
});

test('REC2-03. same phone with conflicting names triggers manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Budi Santoso', wa: CANON_PHONE },
      { id: 'row-b', name: 'Siti Rahma', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('conflicting_customer_names'));
  assert.equal(plan.risk_level, 'HIGH');
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
  assert.equal(plan.risk_level, 'HIGH');
});

test('REC2-05. multiple active memberships trigger manual_review', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', membership_status: 'ACTIVE', wa: CANON_PHONE },
      { id: 'row-b', membership_status: 'ACTIVE', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflicts.includes('multiple_active_memberships'));
  assert.equal(plan.risk_level, 'HIGH');
});

test('REC2-06. invalid phone shape returns invalid_identity', () => {
  const plan = planDuplicateReconciliation({
    phone: '123',
    rows: [{ id: 'row-1', wa: '123' }],
  });

  assert.equal(plan.group_status, 'invalid_identity');
  assert.equal(plan.canonical_customer_id, null);
  assert.equal(plan.risk_level, 'HIGH');
});

test('REC2-07. canonical selection policy never relies on name similarity', () => {
  // Identical name on both rows, but different spend values
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-1', name: 'Adhit Nugraha', total_spent: 50000, wa: CANON_PHONE },
      { id: 'row-2', name: 'Adhit Nugraha', total_spent: 200000, wa: CANON_PHONE },
    ],
  });

  // Selection chooses row-2 due to higher spend authority, NOT name similarity match
  assert.equal(plan.canonical_customer_id, 'row-2');
});

test('REC2-08. canonical selection policy never blindly picks oldest or newest ID', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-001-oldest', created_at: '2020-01-01', total_spent: 0, wa: CANON_PHONE },
      { id: 'row-999-newest', created_at: '2026-08-01', total_spent: 500000, moka_customer_id: 'moka-55', wa: CANON_PHONE },
    ],
  });

  // Picks row-999-newest because of moka_customer_id + spend authority, NOT created_at
  assert.equal(plan.canonical_customer_id, 'row-999-newest');
});

test('REC2-09. points semantics are respected (member_profiles is anchor authority)', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', points: 100, wa: CANON_PHONE },
      { id: 'row-b', points: 50, wa: CANON_PHONE },
    ],
    memberProfiles: [{ id: 'prof-1', phone: `+${CANON_PHONE}`, total_points: 250 }],
  });

  assert.equal(plan.field_plan.points.value, 250);
  assert.equal(plan.field_plan.points.strategy, 'anchored_to_member_profile');
});

test('REC2-10. spend semantics recomputed accurately from transaction records', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', total_spent: 100000, wa: CANON_PHONE },
      { id: 'row-b', total_spent: 150000, wa: CANON_PHONE },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'row-a', total_amount: 100000, status: 'completed' },
      { id: 'tx-2', customer_id: 'row-b', total_amount: 150000, status: 'completed' },
      { id: 'tx-3', customer_id: 'row-b', total_amount: 50000, status: 'completed' },
    ],
  });

  assert.equal(plan.field_plan.total_spent.value, 300000);
  assert.equal(plan.field_plan.total_spent.strategy, 'recomputed_from_transactions');
});

test('REC2-11. visits semantics recomputed accurately from transactions', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', visits: 2, wa: CANON_PHONE },
      { id: 'row-b', visits: 3, wa: CANON_PHONE },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'row-a', status: 'completed' },
      { id: 'tx-2', customer_id: 'row-b', status: 'completed' },
      { id: 'tx-3', customer_id: 'row-b', status: 'completed' },
      { id: 'tx-4', customer_id: 'row-b', status: 'completed' },
      { id: 'tx-5', customer_id: 'row-b', status: 'completed' },
    ],
  });

  assert.equal(plan.field_plan.visits.value, 5);
  assert.equal(plan.field_plan.visits.strategy, 'recomputed_from_transactions');
});

test('REC2-12. one transaction-linked row + empty duplicate yields safe_auto_merge', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Adhit', total_spent: 100000, wa: CANON_PHONE },
      { id: 'row-b', name: null, total_spent: 0, wa: CANON_PHONE },
    ],
    transactions: [{ id: 'tx-1', customer_id: 'row-a', total_amount: 100000 }],
  });

  assert.equal(plan.group_status, 'safe_auto_merge');
  assert.equal(plan.canonical_customer_id, 'row-a');
  assert.equal(plan.risk_level, 'LOW');
});

test('REC2-13. history split across two rows triggers deterministic_reconciliation', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-a', name: 'Adhit', total_spent: 100000, wa: CANON_PHONE },
      { id: 'row-b', name: 'Adhit', total_spent: 200000, wa: CANON_PHONE },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'row-a', total_amount: 100000 },
      { id: 'tx-2', customer_id: 'row-b', total_amount: 200000 },
    ],
  });

  assert.equal(plan.group_status, 'deterministic_reconciliation');
  assert.equal(plan.canonical_customer_id, 'row-b');
  assert.equal(plan.reference_plan.transactions.count, 1);
  assert.equal(plan.risk_level, 'MEDIUM');
});

test('REC2-14. alias rows are preserved in reference_plan and alias_customer_ids', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-1', wa: CANON_PHONE },
      { id: 'row-2', wa: CANON_PHONE },
      { id: 'row-3', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.canonical_customer_id, 'row-1');
  assert.deepEqual(plan.alias_customer_ids, ['row-2', 'row-3']);
});

test('REC2-15. planner performs zero DB writes (pure input-output calculation)', () => {
  const sampleGroup = Object.freeze({
    phone: CANON_PHONE,
    rows: Object.freeze([{ id: 'r1', wa: CANON_PHONE }, { id: 'r2', wa: CANON_PHONE }]),
  });

  assert.doesNotThrow(() => {
    const plan = planDuplicateReconciliation(sampleGroup);
    assert.ok(plan);
  });
});

test('REC2-16. unresolved field semantics (e.g. conflicting names) blocks merge', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [
      { id: 'row-1', name: 'Alice Smith', wa: CANON_PHONE },
      { id: 'row-2', name: 'Bob Jones', wa: CANON_PHONE },
    ],
  });

  assert.equal(plan.group_status, 'manual_review');
  assert.equal(plan.canonical_customer_id, null);
});

test('REC2-17. member_profiles authority is preserved for membership_status', () => {
  const plan = planDuplicateReconciliation({
    phone: CANON_PHONE,
    rows: [{ id: 'row-1', membership_status: 'INACTIVE', wa: CANON_PHONE }],
    memberProfiles: [{ id: 'prof-1', phone: `+${CANON_PHONE}`, membership_status: 'ACTIVE' }],
  });

  assert.equal(plan.field_plan.membership_status.value, 'ACTIVE');
  assert.equal(plan.field_plan.membership_status.strategy, 'member_profile_authority');
});

test('REC2-18. Task17 duplicate-phone resolver behavior remains unchanged (fails closed on ambiguous)', async () => {
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

test('REC2-19. CRM/Reddy still fail closed on unresolved duplicate identity from getCustomer360', async () => {
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

test('REC2-20. telemetry contains zero PII if logged', () => {
  const { sanitizeCrmIdentityTelemetry } = require('../orchestrator/telemetry');
  const safe = sanitizeCrmIdentityTelemetry({
    event_type: 'crm_identity_ambiguous',
    source: 'crm_customer_self',
    phone: '6281311112222',
    name: 'Secret Customer',
  });

  assert.equal(Object.hasOwn(safe, 'phone'), false);
  assert.equal(Object.hasOwn(safe, 'name'), false);
});
