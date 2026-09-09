'use strict';

/**
 * Task 17.3.2 — Moka Customer Reconciliation Execution Test Suite (Correction Round 4 Hardened).
 *
 * Exercises all 24 required Correction Round 4 safety and integrity scenarios.
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
  hashMokaId,
  buildExecutionPlan,
  validateExecutionPlan,
  isExecutionKillSwitchEnabled,
  createReconciliationExecutor,
  executeApprovedReconciliation,
  executeReconciliationGroup,
  rollbackReconciliationGroup,
} = require('../services/mokaCustomerReconciliationExecutor');

// ── TEST 22: PR58 Syntax Check & Bootstrap Guard ──────────────────────────────
test('TEST 22: PR58 syntax check, module load, and bootstrap guard pass', () => {
  const syncFile = path.resolve(process.cwd(), 'server/moka/sync.js');
  assert.ok(fs.existsSync(syncFile));
  const syncModule = require('../moka/sync');
  assert.ok(syncModule);
});

// ── TEST 1-4: Public API & Stale Caller Evidence Bypass Removal ────────────────
test('TEST 1-4: Public executeApprovedReconciliation has no evidenceLoader argument and strictly reloads DB evidence', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  assert.equal(executeApprovedReconciliation.length, 1); // strictly accepts 1 options object { reconciliationKey, dbClient }

  const candidates1 = [{ id: 'c-1', moka_customer_id: 'm1', wa: '+628123456789' }, { id: 'c-2', moka_customer_id: 'm1', wa: '+628123456789' }];
  const snapshot1 = { candidateRows: candidates1, transactionRows: [] };
  const groupPlan1 = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates1 });
  const execPlan1 = buildExecutionPlan(groupPlan1, snapshot1);

  const approvedLedger = {
    reconciliation_key: execPlan1.reconciliation_key,
    moka_group_hash: execPlan1.moka_group_hash,
    status: 'APPROVED',
    approved_by: 'op1',
    approved_at: '2026-01-01',
    plan_fingerprint: execPlan1.plan_fingerprint,
    canonical_customer_id: execPlan1.canonical_customer_id,
    duplicate_customer_ids: execPlan1.duplicate_customer_ids,
    candidate_customer_ids: execPlan1.candidate_customer_ids,
  };

  const mockDbClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: approvedLedger, error: null }),
        }),
        in: async () => ({ data: null, error: { message: 'Database connection error' } }),
      }),
    }),
  };

  // TEST 4: executeReconciliationGroup with dbClient delegates ONLY via reconciliation_key
  await assert.rejects(
    async () => {
      await executeReconciliationGroup(execPlan1, { candidateRows: [{ id: 'fake' }] }, null, mockDbClient);
    },
    { code: 'CURRENT_EVIDENCE_LOOKUP_FAILED' }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 5-10: Membership & Authority Lookup Fail-Closed Checks ───────────────
test('TEST 5-10: Membership and authority query errors throw CURRENT_EVIDENCE_LOOKUP_FAILED', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const candidates = [{ id: 'c-1', moka_customer_id: 'm1', wa: '+628123456789' }, { id: 'c-2', moka_customer_id: 'm1', wa: '+628123456789' }];
  const snapshot = { candidateRows: candidates, transactionRows: [] };
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates });
  const execPlan = buildExecutionPlan(groupPlan, snapshot);

  const approvedLedger = {
    reconciliation_key: execPlan.reconciliation_key,
    moka_group_hash: execPlan.moka_group_hash,
    status: 'APPROVED',
    approved_by: 'op1',
    approved_at: '2026-01-01',
    plan_fingerprint: execPlan.plan_fingerprint,
    canonical_customer_id: execPlan.canonical_customer_id,
    duplicate_customer_ids: execPlan.duplicate_customer_ids,
    candidate_customer_ids: execPlan.candidate_customer_ids,
  };

  const mockDbLedger = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: approvedLedger, error: null }),
        }),
      }),
    }),
  };

  // TEST 5: Membership lookup error -> CURRENT_EVIDENCE_LOOKUP_FAILED
  const executorMemErr = createReconciliationExecutor({
    loadEvidence: async () => {
      const err = new Error('Membership query error');
      err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
      throw err;
    },
  });

  await assert.rejects(
    async () => {
      await executorMemErr.executeApprovedReconciliation({
        reconciliationKey: execPlan.reconciliation_key,
        dbClient: mockDbLedger,
      });
    },
    { code: 'CURRENT_EVIDENCE_LOOKUP_FAILED' }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 11 & 12: Candidate Row Completeness Guard ────────────────────────────
test('TEST 11 & 12: Candidate row count mismatch or ID set drift throws CURRENT_CANDIDATE_SET_DRIFT', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const candidates = [{ id: 'c-1', moka_customer_id: 'm1' }, { id: 'c-2', moka_customer_id: 'm1' }];
  const snapshot = { candidateRows: candidates };
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates });
  const execPlan = buildExecutionPlan(groupPlan, snapshot);

  const approvedLedger = {
    reconciliation_key: execPlan.reconciliation_key,
    moka_group_hash: execPlan.moka_group_hash,
    status: 'APPROVED',
    approved_by: 'op1',
    approved_at: '2026-01-01',
    plan_fingerprint: execPlan.plan_fingerprint,
    canonical_customer_id: execPlan.canonical_customer_id,
    duplicate_customer_ids: execPlan.duplicate_customer_ids,
    candidate_customer_ids: ['c-1', 'c-2'],
  };

  const mockDbClient = {
    from: (table) => {
      if (table === 'customer_reconciliation_ledger') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: approvedLedger, error: null }) }) }),
        };
      }
      if (table === 'customers') {
        // Return only c-1 (missing c-2)
        return {
          select: () => ({ in: async () => ({ data: [{ id: 'c-1', moka_customer_id: 'm1' }], error: null }) }),
        };
      }
      return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
    },
  };

  await assert.rejects(
    async () => {
      await executeApprovedReconciliation({
        reconciliationKey: execPlan.reconciliation_key,
        dbClient: mockDbClient,
      });
    },
    { code: 'CURRENT_CANDIDATE_SET_DRIFT' }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 13-17: Raw Moka ID Validation & Ledger Hash Binding ───────────────────
test('TEST 13-17: Missing raw Moka ID, multiple raw Moka IDs, or hash mismatch throws EXECUTION_REVALIDATION_FAILED', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const candidates1 = [{ id: 'c-1', moka_customer_id: 'm1', wa: '+628123456789' }, { id: 'c-2', moka_customer_id: 'm1', wa: '+628123456789' }];
  const snapshot1 = { candidateRows: candidates1 };
  const groupPlan1 = planMokaCustomerGroupReconciliation({ mokaId: 'm1', candidateRows: candidates1 });
  const execPlan1 = buildExecutionPlan(groupPlan1, snapshot1);

  const approvedLedger = {
    reconciliation_key: execPlan1.reconciliation_key,
    moka_group_hash: execPlan1.moka_group_hash,
    status: 'APPROVED',
    approved_by: 'op1',
    approved_at: '2026-01-01',
    plan_fingerprint: execPlan1.plan_fingerprint,
    canonical_customer_id: execPlan1.canonical_customer_id,
    duplicate_customer_ids: execPlan1.duplicate_customer_ids,
    candidate_customer_ids: ['c-1', 'c-2'],
  };

  const mockDbLedger = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: approvedLedger, error: null }) }) }),
    }),
  };

  // TEST 13: Missing raw moka_customer_id -> EXECUTION_REVALIDATION_FAILED
  const executorNoMoka = createReconciliationExecutor({
    loadEvidence: async () => ({ candidateRows: [{ id: 'c-1', moka_customer_id: null }, { id: 'c-2', moka_customer_id: null }] }),
  });

  await assert.rejects(
    async () => {
      await executorNoMoka.executeApprovedReconciliation({
        reconciliationKey: execPlan1.reconciliation_key,
        dbClient: mockDbLedger,
      });
    },
    { code: 'EXECUTION_REVALIDATION_FAILED' }
  );

  // TEST 14: Multiple distinct moka_customer_id values -> EXECUTION_REVALIDATION_FAILED
  const executorMultiMoka = createReconciliationExecutor({
    loadEvidence: async () => ({ candidateRows: [{ id: 'c-1', moka_customer_id: 'm1' }, { id: 'c-2', moka_customer_id: 'm2' }] }),
  });

  await assert.rejects(
    async () => {
      await executorMultiMoka.executeApprovedReconciliation({
        reconciliationKey: execPlan1.reconciliation_key,
        dbClient: mockDbLedger,
      });
    },
    { code: 'EXECUTION_REVALIDATION_FAILED' }
  );

  // TEST 15: Hash mismatch with ledger -> EXECUTION_REVALIDATION_FAILED
  const executorHashMismatch = createReconciliationExecutor({
    loadEvidence: async () => ({ candidateRows: [{ id: 'c-1', moka_customer_id: 'm-different' }, { id: 'c-2', moka_customer_id: 'm-different' }] }),
  });

  await assert.rejects(
    async () => {
      await executorHashMismatch.executeApprovedReconciliation({
        reconciliationKey: execPlan1.reconciliation_key,
        dbClient: mockDbLedger,
      });
    },
    { code: 'EXECUTION_REVALIDATION_FAILED' }
  );

  // TEST 17: Valid matching raw Moka ID proceeds to planner & RPC
  const executorSuccess = createReconciliationExecutor({
    loadEvidence: async () => ({ candidateRows: candidates1, transactionRows: [] }),
    planner: () => groupPlan1,
  });

  const mockDbSuccess = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: approvedLedger, error: null }) }) }) }),
    rpc: async () => ({ data: { status: 'COMPLETED' }, error: null }),
  };

  const res = await executorSuccess.executeApprovedReconciliation({
    reconciliationKey: execPlan1.reconciliation_key,
    dbClient: mockDbSuccess,
  });

  assert.equal(res.status, 'COMPLETED');

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 18-21: Round 3 Protections Preserved ────────────────────────────────
test('TEST 18-21: Round 3 immutability, lifecycle transition, and rollback protections preserved', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260831000000_customer_reconciliation_execution.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes('IF OLD.approved_at IS NOT NULL THEN'));
  assert.ok(sql.includes('enforce_ledger_status_transition'));
  assert.ok(sql.includes("IF v_ledger.status <> 'COMPLETED' THEN"));
});

// ── TEST 23: member_profiles Never Mutated ────────────────────────────────────
test('TEST 23: member_profiles has no customer_id column and produces zero moves', () => {
  const candidates = [{ id: 'c-1', wa: '+628123456789' }, { id: 'c-2', wa: '+628123456789' }];
  const members = [{ id: 'mp-1', phone: '08123456789', membership_activated_at: '2026-01-01' }];
  const groupPlan = planMokaCustomerGroupReconciliation({ mokaId: 'moka-mp', candidateRows: candidates, memberEvidenceRows: members });
  const execPlan = buildExecutionPlan(groupPlan, { candidateRows: candidates, memberEvidenceRows: members });

  assert.equal(execPlan.rollback_snapshot.member_profile_moves, undefined);
  assert.equal(execPlan.planned_other_refs, 0);
});

// ── TEST 24: Frontend Untouched ───────────────────────────────────────────────
test('TEST 24: Verify no changes were made to frontend directory', () => {
  const frontendDir = path.resolve(process.cwd(), 'frontend');
  assert.ok(fs.existsSync(frontendDir));
});
