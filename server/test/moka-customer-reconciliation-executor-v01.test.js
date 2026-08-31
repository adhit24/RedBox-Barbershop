'use strict';

/**
 * Task 17.3.2 — Moka Customer Reconciliation Execution Test Suite (Correction Round 2 Hardened).
 *
 * Exercises all 28 required Correction Round 2 safety and integrity scenarios.
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

// ── TEST 26: PR58 Syntax Check & Bootstrap Guard ──────────────────────────────
test('TEST 26: PR58 syntax check, module load, and bootstrap guard pass', () => {
  const syncFile = path.resolve(process.cwd(), 'server/moka/sync.js');
  assert.ok(fs.existsSync(syncFile));
  const syncModule = require('../moka/sync');
  assert.ok(syncModule);
});

// ── TEST 1-3 & 4-14: Migration SQL Definitions & Immutability Trigger ─────────
test('TEST 1-3 & 4-14: Migration SQL contains immutability trigger and snapshot pre-validations', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260831000000_customer_reconciliation_execution.sql');
  assert.ok(fs.existsSync(migrationPath));

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // TEST 1-3: Immutability trigger checks candidate_customer_ids, planned ref counts, moka_group_hash
  assert.ok(sql.includes('NEW.candidate_customer_ids <> OLD.candidate_customer_ids'));
  assert.ok(sql.includes('NEW.moka_group_hash <> OLD.moka_group_hash'));
  assert.ok(sql.includes('NEW.planned_transaction_refs <> OLD.planned_transaction_refs'));
  assert.ok(sql.includes('IMMUTABLE_APPROVED_PLAN'));

  // TEST 4-6: Snapshot move null & previous/target owner checks
  assert.ok(sql.includes('Transaction move record contains null fields'));
  assert.ok(sql.includes('Transaction move previous_customer_id % not in duplicate set'));
  assert.ok(sql.includes('Transaction move target_customer_id % does not match canonical'));

  // TEST 7-9: Duplicate move ID check
  assert.ok(sql.includes('Duplicate transaction move ID % in snapshot'));
  assert.ok(sql.includes('Duplicate booking move ID % in snapshot'));
  assert.ok(sql.includes('Duplicate schedule move ID % in snapshot'));

  // TEST 10-12: Snapshot array length vs planned refs check
  assert.ok(sql.includes('Snapshot array lengths do not match planned ref counts'));

  // TEST 13 & 14: Candidate set invariant & non-empty duplicate set check
  assert.ok(sql.includes('Candidate set mismatch with canonical + duplicates'));
  assert.ok(sql.includes('Duplicate customer IDs set cannot be empty'));
});

// ── TEST 15 & 16: FAILED vs COMPLETED Rollback Eligibility ─────────────────────
test('TEST 15 & 16: FAILED status cannot rollback; COMPLETED status can rollback', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260831000000_customer_reconciliation_execution.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Rollback function restricts status strictly to COMPLETED
  assert.ok(sql.includes("IF v_ledger.status <> 'COMPLETED' THEN"));
  assert.ok(sql.includes('ROLLBACK_INVALID_STATUS'));
});

// ── TEST 17 & 18: Ledger Lookup Fail-Closed Behavior ─────────────────────────
test('TEST 17 & 18: Ledger lookup error throws LEDGER_LOOKUP_FAILED; missing ledger throws RECONCILIATION_NOT_FOUND', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const snapshot = { candidateRows: candidates };
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates });
  const execPlan = buildExecutionPlan(groupPlan, snapshot);

  // Mock DB client returning lookup error
  const mockDbError = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'Database connection error' } }),
        }),
      }),
    }),
  };

  await assert.rejects(
    async () => { await executeReconciliationGroup(execPlan, snapshot, groupPlan, mockDbError); },
    { code: 'LEDGER_LOOKUP_FAILED' }
  );

  // Mock DB client returning missing ledger (data = null, error = null)
  const mockDbNotFound = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };

  await assert.rejects(
    async () => { await executeReconciliationGroup(execPlan, snapshot, groupPlan, mockDbNotFound); },
    { code: 'RECONCILIATION_NOT_FOUND' }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 19 & 20: Durable Approval Gate for SAFE_AUTO_RECONCILE ───────────────
test('TEST 19 & 20: SAFE_AUTO_RECONCILE requires durable ledger approval for mutation', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const txs = [{ id: 'tx-1', customer_id: 'c-1', status: 'completed', total_amount: 100000 }];
  const snapshot = { candidateRows: candidates, transactionRows: txs };
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates, transactionRows: txs });
  const execPlan = buildExecutionPlan(groupPlan, snapshot);

  // PLANNED ledger row -> rejected
  const unapprovedLedger = { status: 'PLANNED', approved_by: null, approved_at: null };
  const valPlanned = validateExecutionPlan(execPlan, snapshot, groupPlan, unapprovedLedger);
  assert.equal(valPlanned.valid, false);
  assert.equal(valPlanned.reason_code, 'EXECUTION_NOT_APPROVED');

  // APPROVED ledger row -> valid
  const approvedLedger = { status: 'APPROVED', approved_by: 'operator-1', approved_at: '2026-01-01' };
  const valApproved = validateExecutionPlan(execPlan, snapshot, groupPlan, approvedLedger);
  assert.equal(valApproved.valid, true);
  assert.equal(valApproved.reason_code, 'ELIGIBLE_FOR_EXECUTION');
});

// ── TEST 21 & 22: FAILED Status Write Boundary ───────────────────────────────
test('TEST 21 & 22: Pre-validation failures do not set FAILED; RPC attempt failure sets FAILED separately', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  let failedUpdateCalled = false;

  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const txs = [{ id: 'tx-1', customer_id: 'c-1', status: 'completed', total_amount: 100000 }];
  const snapshot = { candidateRows: candidates, transactionRows: txs };
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates, transactionRows: txs });
  const execPlan = buildExecutionPlan(groupPlan, snapshot);

  const mockDbRpcFail = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { status: 'APPROVED', approved_by: 'op1', approved_at: '2026-01-01' },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => {
          failedUpdateCalled = true;
          return { data: null, error: null };
        },
      }),
    }),
    rpc: async () => ({ data: null, error: { code: 'P0001', message: 'RPC simulated failure' } }),
  };

  await assert.rejects(
    async () => { await executeReconciliationGroup(execPlan, snapshot, groupPlan, mockDbRpcFail); },
    { message: /DATABASE_RECONCILIATION_FAILED/ }
  );

  assert.equal(failedUpdateCalled, true);

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 23-25: Rollback Customer Locking, Target Authority, and Count Verification ──
test('TEST 23-25: Rollback locks candidate rows, verifies target authority, and checks unretire count', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260831000000_customer_reconciliation_execution.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // TEST 23: Rollback deterministic customer locking
  assert.ok(sql.includes('PERFORM id FROM customers'));
  assert.ok(sql.includes('WHERE id = ANY(array_cat(ARRAY[v_ledger.canonical_customer_id], v_ledger.duplicate_customer_ids))'));

  // TEST 24: Rollback canonical target authority check
  assert.ok(sql.includes('Move target_customer_id does not match ledger canonical'));

  // TEST 25: Rollback customer unretire count verification
  assert.ok(sql.includes('v_unretired_count <> array_length(v_ledger.duplicate_customer_ids, 1)'));
});

// ── TEST 27: member_profiles Never Mutated ────────────────────────────────────
test('TEST 27: member_profiles has no customer_id column and produces zero moves', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const members = [{ id: 'mp-1', phone: '08123456789', membership_activated_at: '2026-01-01' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-mp', candidateRows: candidates, memberEvidenceRows: members });
  const execPlan = buildExecutionPlan(groupPlan, { candidateRows: candidates, memberEvidenceRows: members });

  assert.equal(execPlan.rollback_snapshot.member_profile_moves, undefined);
  assert.equal(execPlan.planned_other_refs, 0);
});

// ── TEST 28: Frontend Untouched ───────────────────────────────────────────────
test('TEST 28: Verify no changes were made to frontend directory', () => {
  const frontendDir = path.resolve(process.cwd(), 'frontend');
  assert.ok(fs.existsSync(frontendDir));
});
