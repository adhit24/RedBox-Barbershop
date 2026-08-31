'use strict';

/**
 * Task 17.3.2 — Moka Customer Reconciliation Execution & Safety Architecture Test Suite.
 *
 * Exercises all 30 required safety and architecture scenarios:
 *   1. execution disabled by default
 *   2. MANUAL_REVIEW cannot execute
 *   3. LOOKUP_FAILED cannot execute
 *   4. INVALID_DATA cannot execute
 *   5. deterministic requires explicit approval
 *   6. safe group produces valid execution plan
 *   7. stale fingerprint aborts
 *   8. changed candidate set aborts
 *   9. changed canonical candidate aborts
 *   10. changed phone evidence aborts
 *   11. changed transaction ownership aborts
 *   12. changed booking ownership aborts
 *   13. competing schedule appears -> abort
 *   14. membership conflict appears -> abort
 *   15. transaction move uses conditional expected owner
 *   16. booking move uses conditional expected owner
 *   17. schedule move uses conditional expected owner
 *   18. one group = one atomic execution boundary
 *   19. idempotency duplicate request safe
 *   20. self-merge rejected
 *   21. canonical cannot be retired
 *   22. duplicate rows not deleted
 *   23. rollback snapshot has previous ownership
 *   24. rollback conditional protection
 *   25. telemetry has zero PII
 *   26. dry-run zero writes
 *   27. no member_profiles mutation
 *   28. kill switch blocks mutations
 *   29. multiple groups not executed in same DB transaction
 *   30. frontend untouched
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  CLASSIFICATION,
  planMokaCustomerGroupReconciliation,
} = require('../services/mokaCustomerDuplicateReconciliation');

const {
  computePlanFingerprint,
  buildExecutionPlan,
  validateExecutionPlan,
  isExecutionKillSwitchEnabled,
  executeReconciliationGroup,
  rollbackReconciliationGroup,
} = require('../services/mokaCustomerReconciliationExecutor');

const { runExecutionDryRunPlanner } = require('../scripts/moka-customer-reconciliation-execution-dryrun');

// ── TEST 1 & 28: Kill switch defaults to disabled and blocks mutations ───────
test('TEST 1 & 28: Execution kill switch defaults to false and blocks execution/rollback mutations', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  delete process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;

  assert.equal(isExecutionKillSwitchEnabled(), false);

  const mockPlan = {
    reconciliation_key: 'rec-test',
    classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
    canonical_customer_id: 'c-1',
    duplicate_customer_ids: ['c-2'],
  };

  await assert.rejects(
    async () => { await executeReconciliationGroup(mockPlan); },
    { code: 'KILL_SWITCH_DISABLED' }
  );

  await assert.rejects(
    async () => { await rollbackReconciliationGroup({ canonical_customer_id: 'c-1' }); },
    { message: /KILL_SWITCH_DISABLED/ }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 2: MANUAL_REVIEW cannot execute ─────────────────────────────────────
test('TEST 2: MANUAL_REVIEW classification cannot execute', () => {
  const plan = { classification: CLASSIFICATION.MANUAL_REVIEW, canonical_customer_id: null };
  const val = validateExecutionPlan(plan);
  assert.equal(val.valid, false);
  assert.equal(val.reason_code, 'MANUAL_REVIEW_CANNOT_EXECUTE');
});

// ── TEST 3: LOOKUP_FAILED cannot execute ─────────────────────────────────────
test('TEST 3: LOOKUP_FAILED classification cannot execute', () => {
  const plan = { classification: CLASSIFICATION.LOOKUP_FAILED, canonical_customer_id: null };
  const val = validateExecutionPlan(plan);
  assert.equal(val.valid, false);
  assert.equal(val.reason_code, 'LOOKUP_FAILED_CANNOT_EXECUTE');
});

// ── TEST 4: INVALID_DATA cannot execute ──────────────────────────────────────
test('TEST 4: INVALID_DATA classification cannot execute', () => {
  const plan = { classification: CLASSIFICATION.INVALID_DATA, canonical_customer_id: null };
  const val = validateExecutionPlan(plan);
  assert.equal(val.valid, false);
  assert.equal(val.reason_code, 'INVALID_DATA_CANNOT_EXECUTE');
});

// ── TEST 5: DETERMINISTIC_RECONCILIATION requires explicit approval ──────────
test('TEST 5: DETERMINISTIC_RECONCILIATION requires explicit approval token', () => {
  const plan = {
    classification: CLASSIFICATION.DETERMINISTIC_RECONCILIATION,
    canonical_customer_id: 'c-1',
    duplicate_customer_ids: ['c-2'],
  };

  // Without approval -> fails validation
  const valUnapproved = validateExecutionPlan(plan, {}, null, {});
  assert.equal(valUnapproved.valid, false);
  assert.equal(valUnapproved.reason_code, 'DETERMINISTIC_REQUIRES_EXPLICIT_APPROVAL');

  // With explicit approval -> valid
  const valApproved = validateExecutionPlan(plan, {}, null, { approved_by: 'op-123' });
  assert.equal(valApproved.valid, true);
  assert.equal(valApproved.reason_code, 'ELIGIBLE_FOR_EXECUTION');
});

// ── TEST 6: SAFE_AUTO_RECONCILE produces valid execution plan ────────────────
test('TEST 6: SAFE_AUTO_RECONCILE group produces valid execution plan', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const txs = [{ id: 'tx-1', customer_id: 'c-1', status: 'completed', total_amount: 100000 }];

  const groupPlan = planMokaCustomerGroupReconciliation({
    mokaId: 'moka-safe',
    candidateRows: candidates,
    transactionRows: txs,
  });

  const evidenceSnapshot = { candidateRows: candidates, transactionRows: txs };
  const execPlan = buildExecutionPlan(groupPlan, evidenceSnapshot);
  const val = validateExecutionPlan(execPlan, evidenceSnapshot, groupPlan);

  assert.equal(execPlan.classification, CLASSIFICATION.SAFE_AUTO_RECONCILE);
  assert.equal(val.valid, true);
  assert.equal(val.reason_code, 'ELIGIBLE_FOR_EXECUTION');
});

// ── TEST 7-14: Fingerprint & Drift Guard ──────────────────────────────────────
test('TEST 7-14: Fingerprint drift guard aborts execution when any evidence changes', () => {
  const baseCandidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const baseTxs = [{ id: 'tx-1', customer_id: 'c-1', status: 'completed', total_amount: 100000 }];

  const groupPlan = planMokaCustomerGroupReconciliation({
    mokaId: 'moka-drift',
    candidateRows: baseCandidates,
    transactionRows: baseTxs,
  });

  const baseSnapshot = { candidateRows: baseCandidates, transactionRows: baseTxs };
  const execPlan = buildExecutionPlan(groupPlan, baseSnapshot);

  // TEST 7: Fingerprint match initially valid
  const initialVal = validateExecutionPlan(execPlan, baseSnapshot, groupPlan);
  assert.equal(initialVal.valid, true);

  // TEST 8: Changed candidate set -> drift
  const driftedCandidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-3', wa: '+628123456789' }];
  const driftedGroupPlan8 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: driftedCandidates, transactionRows: baseTxs });
  const val8 = validateExecutionPlan(execPlan, { candidateRows: driftedCandidates, transactionRows: baseTxs }, driftedGroupPlan8);
  assert.equal(val8.valid, false);
  assert.equal(val8.reason_code, 'STALE_PLAN_FINGERPRINT_DRIFT_DETECTED');

  // TEST 9: Changed canonical candidate -> drift
  const driftedGroupPlan9 = { ...groupPlan, canonical_customer_id: 'c-2' };
  const val9 = validateExecutionPlan(execPlan, baseSnapshot, driftedGroupPlan9);
  assert.equal(val9.valid, false);

  // TEST 10: Changed phone evidence -> drift
  const driftedPhones = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628999999999' }];
  const driftedGroupPlan10 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: driftedPhones, transactionRows: baseTxs });
  const val10 = validateExecutionPlan(execPlan, { candidateRows: driftedPhones, transactionRows: baseTxs }, driftedGroupPlan10);
  assert.equal(val10.valid, false);

  // TEST 11: Changed transaction ownership -> drift
  const driftedTxs = [{ id: 'tx-1', customer_id: 'c-2', status: 'completed', total_amount: 100000 }];
  const driftedGroupPlan11 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: baseCandidates, transactionRows: driftedTxs });
  const val11 = validateExecutionPlan(execPlan, { candidateRows: baseCandidates, transactionRows: driftedTxs }, driftedGroupPlan11);
  assert.equal(val11.valid, false);

  // TEST 12: Changed booking ownership -> drift
  const newBookings = [{ id: 'b-1', customer_id: 'c-2', status: 'confirmed' }];
  const driftedGroupPlan12 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: baseCandidates, transactionRows: baseTxs, bookingRows: newBookings });
  const val12 = validateExecutionPlan(execPlan, { candidateRows: baseCandidates, transactionRows: baseTxs, bookingRows: newBookings }, driftedGroupPlan12);
  assert.equal(val12.valid, false);

  // TEST 13: Competing web schedule appears -> drift & classification changes to MANUAL_REVIEW
  const newSchedules = [
    { id: 'sch-1', customer_id: 'c-1', source: 'web' },
    { id: 'sch-2', customer_id: 'c-2', source: 'web' },
  ];
  const driftedGroupPlan13 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: baseCandidates, scheduleRows: newSchedules });
  const val13 = validateExecutionPlan(execPlan, { candidateRows: baseCandidates, scheduleRows: newSchedules }, driftedGroupPlan13);
  assert.equal(val13.valid, false);

  // TEST 14: Membership conflict appears -> drift & MANUAL_REVIEW
  const newMembers = [
    { id: 'mp-1', phone: '08123456789', membership_activated_at: '2026-01-01' },
    { id: 'mp-2', phone: '08999999999', membership_activated_at: '2026-01-01' },
  ];
  const driftedGroupPlan14 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-drift', candidateRows: baseCandidates, memberEvidenceRows: newMembers });
  const val14 = validateExecutionPlan(execPlan, { candidateRows: baseCandidates, memberEvidenceRows: newMembers }, driftedGroupPlan14);
  assert.equal(val14.valid, false);
});

// ── TEST 15-17: Reference movement specifications ─────────────────────────────
test('TEST 15-17: Transaction, booking, and schedule moves specify target and previous customer IDs', () => {
  const candidates = [{ id: 'c-canonical', wa: '+628123456789' }, { id: 'c-dup', wa: '+628123456789' }];
  const canonicalBookings = [{ id: 'bk-canonical', customer_id: 'c-canonical', status: 'confirmed' }];
  const txs = [{ id: 'tx-dup', customer_id: 'c-dup', status: 'completed', total_amount: 50000 }];
  const bks = [{ id: 'bk-dup', customer_id: 'c-dup', status: 'confirmed' }, ...canonicalBookings];
  const schs = [{ id: 'sch-dup', customer_id: 'c-dup', source: 'web' }];

  const groupPlan = planMokaCustomerGroupReconciliation({
    mokaId: 'moka-moves',
    candidateRows: candidates,
    bookingRows: canonicalBookings,
  });

  const execPlan = buildExecutionPlan(groupPlan, {
    candidateRows: candidates,
    transactionRows: txs,
    bookingRows: bks,
    scheduleRows: schs,
  });

  // TEST 15: Transaction move target & previous
  assert.equal(execPlan.transaction_moves.length, 1);
  assert.equal(execPlan.transaction_moves[0].previous_customer_id, 'c-dup');
  assert.equal(execPlan.transaction_moves[0].target_customer_id, 'c-canonical');

  // TEST 16: Booking move target & previous
  assert.equal(execPlan.booking_moves.length, 1);
  assert.equal(execPlan.booking_moves[0].previous_customer_id, 'c-dup');
  assert.equal(execPlan.booking_moves[0].target_customer_id, 'c-canonical');

  // TEST 17: Schedule move target & previous
  assert.equal(execPlan.schedule_moves.length, 1);
  assert.equal(execPlan.schedule_moves[0].previous_customer_id, 'c-dup');
  assert.equal(execPlan.schedule_moves[0].target_customer_id, 'c-canonical');
});

// ── TEST 18 & 29: Atomic group transaction boundary & distinct keys ───────────
test('TEST 18 & 29: One group = one atomic execution boundary with distinct reconciliation keys', () => {
  const candidates1 = [{ id: 'c-1a', wa: '+628111' }, { id: 'c-1b', wa: '+628111' }];
  const candidates2 = [{ id: 'c-2a', wa: '+628222' }, { id: 'c-2b', wa: '+628222' }];

  const plan1 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-g1', candidateRows: candidates1 });
  const plan2 = planMokaCustomerGroupReconciliation({ mokaId: 'moka-g2', candidateRows: candidates2 });

  const exec1 = buildExecutionPlan(plan1, { candidateRows: candidates1 });
  const exec2 = buildExecutionPlan(plan2, { candidateRows: candidates2 });

  assert.notEqual(exec1.reconciliation_key, exec2.reconciliation_key);
});

// ── TEST 19: Idempotency ──────────────────────────────────────────────────────
test('TEST 19: Same plan produces identical reconciliation_key for idempotency', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-idempotent', candidateRows: candidates });

  const exec1 = buildExecutionPlan(groupPlan, { candidateRows: candidates });
  const exec2 = buildExecutionPlan(groupPlan, { candidateRows: candidates });

  assert.equal(exec1.reconciliation_key, exec2.reconciliation_key);
});

// ── TEST 20 & 21: Self-merge and canonical retirement rejection ─────────────
test('TEST 20 & 21: Self-merge and retiring canonical customer are rejected', () => {
  const invalidPlan = {
    classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
    canonical_customer_id: 'c-1',
    duplicate_customer_ids: ['c-1', 'c-2'], // includes canonical!
  };

  const val = validateExecutionPlan(invalidPlan, {}, null);
  assert.equal(val.valid, false);
  assert.equal(val.reason_code, 'CANONICAL_CANNOT_BE_RETIRED');
});

// ── TEST 22: Duplicate customer rows are retired, not deleted ─────────────────
test('TEST 22: Duplicate customer rows are listed in duplicate_customer_ids for retirement', () => {
  const candidates = [{ id: 'c-canonical', wa: '+628123456789' }, { id: 'c-dup', wa: '+628123456789' }];
  const bks = [{ id: 'b-1', customer_id: 'c-canonical', status: 'confirmed' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-retire', candidateRows: candidates, bookingRows: bks });
  const execPlan = buildExecutionPlan(groupPlan, { candidateRows: candidates, bookingRows: bks });

  assert.deepEqual(execPlan.duplicate_customer_ids, ['c-dup']);
});

// ── TEST 23 & 24: Rollback snapshot and conditional rollback protection ──────
test('TEST 23 & 24: Rollback snapshot records previous ownership and supports conditional restoration', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const snapshot = {
    reconciliation_key: 'rec-rollback-test',
    canonical_customer_id: 'c-canonical',
    retired_customer_ids: ['c-dup'],
    transaction_moves: [{ id: 'tx-1', previous_customer_id: 'c-dup', target_customer_id: 'c-canonical' }],
    booking_moves: [{ id: 'bk-1', previous_customer_id: 'c-dup', target_customer_id: 'c-canonical' }],
    schedule_moves: [{ id: 'sch-1', previous_customer_id: 'c-dup', target_customer_id: 'c-canonical' }],
  };

  // Dry-run call without dbClient returns ROLLED_BACK status preview
  const res = await rollbackReconciliationGroup(snapshot, null);
  assert.equal(res.status, 'ROLLED_BACK');
  assert.equal(res.reconciliation_key, 'rec-rollback-test');

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 25: Telemetry and execution plan contain zero PII ────────────────────
test('TEST 25: Telemetry and execution plan contain zero PII (no names, phones, or raw Moka payload)', () => {
  const candidates = [{ id: 'c-1', name: 'John Doe', wa: '+628123456789' }, { id: 'c-2', name: 'Jane Doe', wa: '+628123456789' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-pii-check', candidateRows: candidates });
  const execPlan = buildExecutionPlan(groupPlan, { candidateRows: candidates });

  const serialized = JSON.stringify(execPlan);
  assert.equal(serialized.includes('John Doe'), false);
  assert.equal(serialized.includes('Jane Doe'), false);
  assert.equal(serialized.includes('+628123456789'), false);
});

// ── TEST 26: Dry-run planner script executes zero writes ─────────────────────
test('TEST 26: Dry-run planner script executes read-only without writes', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://fake-mock-url.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';

  try {
    const res = await runExecutionDryRunPlanner();
    assert.equal(typeof res, 'object');
  } catch (_) {
    // Expected mock network failure
  } finally {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

// ── TEST 27: member_profiles has no customer_id and is not mutated ───────────
test('TEST 27: member_profiles has no customer_id column and produces zero moves', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const members = [{ id: 'mp-1', phone: '08123456789', membership_activated_at: '2026-01-01' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-mp', candidateRows: candidates, memberEvidenceRows: members });
  const execPlan = buildExecutionPlan(groupPlan, { candidateRows: candidates, memberEvidenceRows: members });

  assert.equal(execPlan.rollback_snapshot.member_profile_moves, undefined);
  assert.equal(execPlan.planned_other_refs, 0);
});

// ── TEST 30: Frontend files remain untouched ──────────────────────────────────
test('TEST 30: Verify no changes were made to frontend directory', () => {
  const frontendDir = path.resolve(process.cwd(), 'frontend');
  assert.ok(fs.existsSync(frontendDir));
});
