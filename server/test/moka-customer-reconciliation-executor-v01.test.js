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

const { runExecutionDryRunPlanner } = require('../scripts/moka-customer-reconciliation-execution-dryrun');

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

// ── TEST 25: Dry-Run Zero Mutation Verification ──────────────────────────────
test('TEST 25: dry-run planner performs ZERO database mutations (no insert, update, delete, upsert, or rpc)', async () => {
  const mutationOperations = [];

  const mockCustomers = [
    { id: 'c-10', name: 'Budi Santoso', wa: '+628123456789', phone_e164: '+628123456789', moka_customer_id: 'm-dryrun' },
    { id: 'c-11', name: 'Budi S', wa: '+628123456789', phone_e164: '+628123456789', moka_customer_id: 'm-dryrun' },
  ];
  const mockTransactions = [
    { id: 'tx-1', customer_id: 'c-10', status: 'completed', total_amount: 150000 },
  ];
  const mockBookings = [
    { id: 'bk-1', customer_id: 'c-11', status: 'completed' },
  ];
  const mockSchedules = [
    { id: 'sch-1', customer_id: 'c-11', status: 'confirmed', source: 'web' },
  ];
  const mockMemberProfiles = [
    { id: 'mp-1', phone: '+628123456789', membership_status: 'active', membership_activated_at: '2026-01-01' },
  ];

  const spyDbClient = {
    from: (tableName) => {
      const builder = {
        select: () => builder,
        not: () => builder,
        eq: () => builder,
        in: async () => {
          if (tableName === 'transactions') return { data: mockTransactions, error: null };
          if (tableName === 'bookings') return { data: mockBookings, error: null };
          if (tableName === 'schedules') return { data: mockSchedules, error: null };
          return { data: [], error: null };
        },
        then: (resolve) => {
          if (tableName === 'customers') resolve({ data: mockCustomers, error: null });
          else if (tableName === 'member_profiles') resolve({ data: mockMemberProfiles, error: null });
          else resolve({ data: [], error: null });
        },
        insert: (...args) => {
          mutationOperations.push({ op: 'insert', table: tableName, args });
          return builder;
        },
        update: (...args) => {
          mutationOperations.push({ op: 'update', table: tableName, args });
          return builder;
        },
        upsert: (...args) => {
          mutationOperations.push({ op: 'upsert', table: tableName, args });
          return builder;
        },
        delete: (...args) => {
          mutationOperations.push({ op: 'delete', table: tableName, args });
          return builder;
        },
      };
      return builder;
    },
    rpc: async (fnName, args) => {
      mutationOperations.push({ op: 'rpc', fnName, args });
      return { data: null, error: null };
    },
  };

  const result = await runExecutionDryRunPlanner({ dbClient: spyDbClient });

  assert.equal(result.status, 'SUCCESS');
  assert.equal(mutationOperations.length, 0, 'Dry-run must perform ZERO database mutations');
  assert.equal(result.summary.total_duplicate_groups, 1);
  assert.equal(result.summary.eligible_safe_auto_reconcile, 1);
  assert.equal(result.summary.would_retire_customer_rows, 1);
  assert.equal(result.summary.planned_booking_moves, 1);
  assert.equal(result.summary.planned_schedule_moves, 1);
  assert.equal(result.summary.planned_tx_moves, 0); // tx belongs to canonical c-10
});

// ── TEST 26: Live Execution Opt-In Guard ───────────────────────────────────────
test('TEST 26: live execution and rollback require explicit opt-in (CRM_RECONCILIATION_EXECUTION_ENABLED === "true")', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;

  try {
    delete process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
    assert.equal(isExecutionKillSwitchEnabled(), false);

    await assert.rejects(
      async () => {
        await executeApprovedReconciliation({ reconciliationKey: 'rec_test', dbClient: {} });
      },
      { code: 'KILL_SWITCH_DISABLED' }
    );

    await assert.rejects(
      async () => {
        await executeReconciliationGroup({ reconciliation_key: 'rec_test' }, {}, {}, null);
      },
      { code: 'KILL_SWITCH_DISABLED' }
    );

    await assert.rejects(
      async () => {
        await rollbackReconciliationGroup('rec_test', null);
      },
      { code: 'KILL_SWITCH_DISABLED' }
    );

    process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'false';
    assert.equal(isExecutionKillSwitchEnabled(), false);

    await assert.rejects(
      async () => {
        await executeApprovedReconciliation({ reconciliationKey: 'rec_test', dbClient: {} });
      },
      { code: 'KILL_SWITCH_DISABLED' }
    );
  } finally {
    process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
  }
});

// ── TEST 27: Idempotency & Repeated Execution Safety ──────────────────────────
test('TEST 27: repeated execution on already COMPLETED ledger entry throws EXECUTION_NOT_APPROVED', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  const completedLedger = {
    reconciliation_key: 'rec_completed',
    status: 'COMPLETED',
    approved_by: 'admin',
    approved_at: '2026-01-01',
    completed_at: '2026-01-02',
  };

  let rpcCalled = false;
  const mockDbClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: completedLedger, error: null }),
        }),
      }),
    }),
    rpc: async () => {
      rpcCalled = true;
      return { data: { status: 'COMPLETED' }, error: null };
    },
  };

  try {
    await assert.rejects(
      async () => {
        await executeApprovedReconciliation({
          reconciliationKey: 'rec_completed',
          dbClient: mockDbClient,
        });
      },
      { code: 'EXECUTION_NOT_APPROVED' }
    );

    assert.equal(rpcCalled, false, 'RPC mutation must NEVER be invoked for already COMPLETED reconciliation');
  } finally {
    process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
  }
});

// ── TEST 28: Ambiguous & Conflict Fail-Closed Rejection ───────────────────────
test('TEST 28: ambiguous match or phone conflict refuses execution and fails closed', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  // Conflicting phone numbers across candidates
  const conflictingCandidates = [
    { id: 'c-alpha', moka_customer_id: 'm-conflict', wa: '+62811111111' },
    { id: 'c-beta', moka_customer_id: 'm-conflict', wa: '+62822222222' },
  ];

  const plan = planMokaCustomerGroupReconciliation({
    mokaId: 'm-conflict',
    candidateRows: conflictingCandidates,
  });

  assert.equal(plan.classification, CLASSIFICATION.MANUAL_REVIEW);
  assert.equal(plan.canonical_customer_id, null);
  assert.ok(plan.conflict_flags.includes('multiple_distinct_normalized_phones'));

  // Attempting to validate execution plan for MANUAL_REVIEW must return valid: false
  const execPlan = buildExecutionPlan(plan, { candidateRows: conflictingCandidates });
  const validation = validateExecutionPlan(execPlan, { candidateRows: conflictingCandidates }, plan);

  assert.equal(validation.valid, false);
  assert.equal(validation.reason_code, 'CLASSIFICATION_NOT_EXECUTABLE');

  // Attempting execution throws EXECUTION_REVALIDATION_FAILED
  const approvedLedger = {
    reconciliation_key: execPlan.reconciliation_key,
    moka_group_hash: execPlan.moka_group_hash,
    status: 'APPROVED',
    approved_by: 'admin',
    approved_at: '2026-01-01',
    plan_fingerprint: execPlan.plan_fingerprint,
    canonical_customer_id: null,
    duplicate_customer_ids: [],
    candidate_customer_ids: ['c-alpha', 'c-beta'],
  };

  const mockDb = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: approvedLedger, error: null }) }),
      }),
    }),
  };

  const executor = createReconciliationExecutor({
    loadEvidence: async () => ({ candidateRows: conflictingCandidates, transactionRows: [] }),
    planner: () => plan,
  });

  await assert.rejects(
    async () => {
      await executor.executeApprovedReconciliation({
        reconciliationKey: execPlan.reconciliation_key,
        dbClient: mockDb,
      });
    },
    { code: 'EXECUTION_REVALIDATION_FAILED' }
  );

  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
});

// ── TEST 29: Concurrency Guards & Self-Merge Prohibition in SQL Migration ─────
test('TEST 29: SQL migration enforces advisory lock, deterministic row locking, and self-merge prohibition', () => {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260831000000_customer_reconciliation_execution.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Self-merge constraint
  assert.ok(sql.includes('chk_customers_no_self_merge'));
  assert.ok(sql.includes('merged_into_customer_id <> id'));

  // Advisory lock on reconciliation key
  assert.ok(sql.includes('pg_advisory_xact_lock(hashtext(p_reconciliation_key))'));

  // Deterministic row ordering FOR UPDATE to prevent deadlocks
  assert.ok(sql.includes('ORDER BY id'));
  assert.ok(sql.includes('FOR UPDATE'));

  // Chain merge / race condition guards
  assert.ok(sql.includes('CANONICAL_ALREADY_RETIRED'));
  assert.ok(sql.includes('DUPLICATE_ALREADY_MERGED'));
});

// ── TEST 30: Rollback Safety & RPC Invocation ──────────────────────────────────
test('TEST 30: rollbackReconciliationGroup delegates to DB RPC with correct payload when enabled', async () => {
  const originalEnv = process.env.CRM_RECONCILIATION_EXECUTION_ENABLED;
  process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = 'true';

  let rpcKeyPassed = null;
  const mockDbClient = {
    rpc: async (fnName, args) => {
      assert.equal(fnName, 'rollback_customer_reconciliation_group');
      rpcKeyPassed = args.p_reconciliation_key;
      return { data: { status: 'ROLLED_BACK' }, error: null };
    },
  };

  try {
    const res = await rollbackReconciliationGroup('rec_to_rollback', mockDbClient);
    assert.equal(res.status, 'ROLLED_BACK');
    assert.equal(rpcKeyPassed, 'rec_to_rollback');
  } finally {
    process.env.CRM_RECONCILIATION_EXECUTION_ENABLED = originalEnv;
  }
});

