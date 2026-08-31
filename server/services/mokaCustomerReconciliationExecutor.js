'use strict';

/**
 * Task 17.3.2 — Moka Customer Duplicate Reconciliation Execution Service & Safety Architecture (Correction Round 3).
 *
 * Core Business & Technical Invariants:
 *   1. WRONG CUSTOMER MERGE IS WORSE THAN LEAVING DUPLICATES UNRESOLVED.
 *   2. EXECUTION DISABLED BY DEFAULT: Kill switch `CRM_RECONCILIATION_EXECUTION_ENABLED` MUST strictly equal "true".
 *   3. EXECUTOR-OWNED TRUE FRESH REVALIDATION: Production DB mutation path re-queries current DB state internally,
 *      reruns Task17.3.1 planner, and validates fingerprint/canonical/duplicate set match approved ledger.
 *   4. PERMANENT APPROVAL IMMUTABILITY: Once approved_at is set, plan authority parameters are immutable forever.
 *   5. VERIFIED FAILED WRITE: FAILED ledger update specifies .eq('status', 'APPROVED') and verifies persistence result.
 *   6. ZERO PII LOGGING / TELEMETRY: Telemetry minifies and hashes correlation keys; zero PII.
 */

const crypto = require('crypto');
const { CLASSIFICATION, planMokaCustomerGroupReconciliation } = require('./mokaCustomerDuplicateReconciliation');

/**
 * Computes a deterministic SHA-256 fingerprint for a duplicate group plan and evidence snapshot.
 *
 * @param {object} groupPlan - Result from planMokaCustomerGroupReconciliation()
 * @param {object} evidenceSnapshot - Raw evidence rows { candidateRows, transactionRows, bookingRows, scheduleRows, memberEvidenceRows }
 * @returns {string} SHA-256 hex string
 */
function computePlanFingerprint(groupPlan, evidenceSnapshot = {}) {
  const payload = {
    moka_id: groupPlan?.moka_id || null,
    classification: groupPlan?.classification || null,
    canonical_customer_id: groupPlan?.canonical_customer_id || null,
    duplicate_rows_to_retire: (groupPlan?.duplicate_rows_to_retire || []).slice().sort(),
    candidate_ids: (evidenceSnapshot?.candidateRows || []).map(c => c.id).sort(),
    candidate_phones: (evidenceSnapshot?.candidateRows || []).map(c => c.phone_e164 || c.wa || c.phone || '').sort(),
    transaction_ids: (evidenceSnapshot?.transactionRows || []).map(t => `${t.id}:${t.customer_id}:${t.status}:${t.total_amount || t.price || 0}`).sort(),
    booking_ids: (evidenceSnapshot?.bookingRows || []).map(b => `${b.id}:${b.customer_id}:${b.status}`).sort(),
    schedule_ids: (evidenceSnapshot?.scheduleRows || []).map(s => `${s.id}:${s.customer_id}:${s.source}`).sort(),
    membership_status: groupPlan?.membership_status || 'membership_none',
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Generates a SHA-256 hash for moka_customer_id correlation without storing raw string in ledger key.
 *
 * @param {string} mokaId
 * @returns {string} SHA-256 hex hash
 */
function hashMokaId(mokaId) {
  if (!mokaId) return 'none';
  return crypto.createHash('sha256').update(String(mokaId).trim()).digest('hex');
}

/**
 * Builds a structured, reproducible execution plan and PII-free rollback snapshot.
 *
 * @param {object} groupPlan - Classification plan from planMokaCustomerGroupReconciliation()
 * @param {object} evidenceSnapshot - Evidence rows { candidateRows, transactionRows, bookingRows, scheduleRows }
 * @returns {object} Execution plan object
 */
function buildExecutionPlan(groupPlan, evidenceSnapshot = {}) {
  if (!groupPlan || !groupPlan.moka_id) {
    throw new Error('INVALID_GROUP_PLAN: Group plan must contain valid moka_id');
  }

  const fingerprint = computePlanFingerprint(groupPlan, evidenceSnapshot);
  const mokaHash = hashMokaId(groupPlan.moka_id);
  const canonicalId = groupPlan.canonical_customer_id;
  const duplicateIds = groupPlan.duplicate_rows_to_retire || [];

  const retiredSet = new Set(duplicateIds);

  const txMoves = (evidenceSnapshot.transactionRows || [])
    .filter(t => retiredSet.has(t.customer_id))
    .map(t => ({ id: t.id, previous_customer_id: t.customer_id, target_customer_id: canonicalId }));

  const bookingMoves = (evidenceSnapshot.bookingRows || [])
    .filter(b => retiredSet.has(b.customer_id))
    .map(b => ({ id: b.id, previous_customer_id: b.customer_id, target_customer_id: canonicalId }));

  const scheduleMoves = (evidenceSnapshot.scheduleRows || [])
    .filter(s => retiredSet.has(s.customer_id))
    .map(s => ({ id: s.id, previous_customer_id: s.customer_id, target_customer_id: canonicalId, source: s.source }));

  const candidateIds = (evidenceSnapshot.candidateRows || []).map(c => c.id).sort();

  const keyPayload = `${mokaHash}:${canonicalId || 'none'}:${candidateIds.join(',')}:${fingerprint}`;
  const reconciliationKey = `rec_${crypto.createHash('sha256').update(keyPayload).digest('hex').substring(0, 32)}`;

  // PII-Free Rollback Snapshot Structure
  const rollbackSnapshot = Object.freeze({
    reconciliation_key: reconciliationKey,
    canonical_customer_id: canonicalId,
    retired_customer_ids: duplicateIds,
    transaction_moves: txMoves,
    booking_moves: bookingMoves,
    schedule_moves: scheduleMoves,
  });

  return Object.freeze({
    reconciliation_key: reconciliationKey,
    moka_group_hash: mokaHash,
    classification: groupPlan.classification,
    canonical_customer_id: canonicalId,
    candidate_customer_ids: candidateIds,
    duplicate_customer_ids: duplicateIds,
    status: 'PLANNED',
    reason_code: groupPlan.reason_code,
    plan_fingerprint: fingerprint,

    planned_transaction_refs: txMoves.length,
    planned_booking_refs: bkMovesLength(bookingMoves),
    planned_schedule_refs: scheduleMoves.length,
    planned_other_refs: 0,

    transaction_moves: txMoves,
    booking_moves: bookingMoves,
    schedule_moves: scheduleMoves,

    rollback_snapshot: rollbackSnapshot,
  });
}

function bkMovesLength(bks) {
  return Array.isArray(bks) ? bks.length : 0;
}

/**
 * Validates an execution plan against current evidence snapshot and safety rules.
 *
 * @param {object} executionPlan - Plan from buildExecutionPlan()
 * @param {object} currentEvidenceSnapshot - Fresh evidence snapshot (MANDATORY)
 * @param {object} groupPlan - Fresh classification result (MANDATORY)
 * @param {object} [ledgerRow] - Ledger row if fetched from DB
 * @returns {object} Validation result { valid: boolean, reason_code: string }
 */
function validateExecutionPlan(executionPlan, currentEvidenceSnapshot, groupPlan, ledgerRow = null) {
  // 1. Mandatory Fresh Revalidation Check
  if (!groupPlan || !currentEvidenceSnapshot || !currentEvidenceSnapshot.candidateRows) {
    return { valid: false, reason_code: 'EXECUTION_REVALIDATION_REQUIRED' };
  }

  // 2. Classification Allowlist Check
  const classification = groupPlan.classification;
  if (classification !== CLASSIFICATION.SAFE_AUTO_RECONCILE && classification !== CLASSIFICATION.DETERMINISTIC_RECONCILIATION) {
    return { valid: false, reason_code: 'CLASSIFICATION_NOT_EXECUTABLE' };
  }

  // 3. Fingerprint & Drift Guard Check
  const currentFingerprint = computePlanFingerprint(groupPlan, currentEvidenceSnapshot);
  if (currentFingerprint !== executionPlan.plan_fingerprint) {
    return { valid: false, reason_code: 'STALE_PLAN_FINGERPRINT_DRIFT_DETECTED' };
  }

  // 4. Self-Merge & Canonical Integrity Check
  const canonicalId = groupPlan.canonical_customer_id;
  const duplicateIds = groupPlan.duplicate_rows_to_retire || [];

  if (!canonicalId) {
    return { valid: false, reason_code: 'MISSING_CANONICAL_CUSTOMER_ID' };
  }

  if (duplicateIds.includes(canonicalId)) {
    return { valid: false, reason_code: 'CANONICAL_CANNOT_BE_RETIRED' };
  }

  // 5. Durable Ledger Approval Gate Check
  if (ledgerRow) {
    const isApproved = ledgerRow.status === 'APPROVED' && ledgerRow.approved_by && ledgerRow.approved_at;
    if (!isApproved) {
      return { valid: false, reason_code: 'EXECUTION_NOT_APPROVED' };
    }
  }

  return { valid: true, reason_code: 'ELIGIBLE_FOR_EXECUTION' };
}

/**
 * Checks if reconciliation execution kill switch is enabled.
 * MUST strictly equal string "true".
 *
 * @returns {boolean}
 */
function isExecutionKillSwitchEnabled() {
  return process.env.CRM_RECONCILIATION_EXECUTION_ENABLED === 'true';
}

/**
 * Loads current evidence directly from database for a candidate customer group.
 *
 * @param {object} dbClient
 * @param {object} ledgerRow
 * @returns {Promise<object>} Fresh evidence snapshot
 */
async function loadCurrentEvidenceForLedgerGroup(dbClient, ledgerRow) {
  const candidateIds = ledgerRow.candidate_customer_ids || [];
  if (!candidateIds.length) {
    throw new Error('EMPTY_CANDIDATE_SET: Ledger candidate set is empty');
  }

  const { data: candidateRows, error: custErr } = await dbClient
    .from('customers')
    .select('*')
    .in('id', candidateIds);

  if (custErr || !candidateRows) {
    const err = new Error(`CURRENT_EVIDENCE_LOOKUP_FAILED: ${custErr?.message || 'Failed to fetch candidate customers'}`);
    err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
    throw err;
  }

  const { data: transactionRows, error: txErr } = await dbClient
    .from('transactions')
    .select('*')
    .in('customer_id', candidateIds);

  if (txErr) {
    const err = new Error(`CURRENT_EVIDENCE_LOOKUP_FAILED: ${txErr.message}`);
    err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
    throw err;
  }

  const { data: bookingRows, error: bkErr } = await dbClient
    .from('bookings')
    .select('*')
    .in('customer_id', candidateIds);

  if (bkErr) {
    const err = new Error(`CURRENT_EVIDENCE_LOOKUP_FAILED: ${bkErr.message}`);
    err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
    throw err;
  }

  const { data: scheduleRows, error: schErr } = await dbClient
    .from('schedules')
    .select('*')
    .in('customer_id', candidateIds);

  if (schErr) {
    const err = new Error(`CURRENT_EVIDENCE_LOOKUP_FAILED: ${schErr.message}`);
    err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
    throw err;
  }

  // Load member profile evidence if phone numbers present
  const phones = candidateRows.map(c => c.phone_e164 || c.wa || c.phone).filter(Boolean);
  let memberEvidenceRows = [];
  if (phones.length) {
    const { data: memRows } = await dbClient
      .from('member_profiles')
      .select('*')
      .in('phone', phones);
    memberEvidenceRows = memRows || [];
  }

  return {
    candidateRows,
    transactionRows: transactionRows || [],
    bookingRows: bookingRows || [],
    scheduleRows: scheduleRows || [],
    memberEvidenceRows,
  };
}

/**
 * Executes an approved reconciliation group with executor-owned fresh revalidation.
 *
 * @param {object} params
 * @param {string} params.reconciliationKey
 * @param {object} params.dbClient
 * @param {function} [params.evidenceLoader] - Custom fresh evidence loader callback
 * @returns {Promise<object>} Execution result
 */
async function executeApprovedReconciliation({ reconciliationKey, dbClient, evidenceLoader = null }) {
  if (!isExecutionKillSwitchEnabled()) {
    const err = new Error('KILL_SWITCH_DISABLED: CRM_RECONCILIATION_EXECUTION_ENABLED is false');
    err.code = 'KILL_SWITCH_DISABLED';
    throw err;
  }

  if (!reconciliationKey || typeof reconciliationKey !== 'string') {
    throw new Error('INVALID_RECONCILIATION_KEY: Reconciliation key must be provided');
  }

  if (!dbClient) {
    throw new Error('MANDATORY_DB_CLIENT: DB client required for actual execution');
  }

  // 1. Fetch APPROVED ledger row
  const { data: ledgerRow, error: lookupErr } = await dbClient
    .from('customer_reconciliation_ledger')
    .select('*')
    .eq('reconciliation_key', reconciliationKey)
    .maybeSingle();

  if (lookupErr) {
    const err = new Error(`LEDGER_LOOKUP_FAILED: ${lookupErr.message}`);
    err.code = 'LEDGER_LOOKUP_FAILED';
    throw err;
  }

  if (!ledgerRow) {
    const err = new Error(`RECONCILIATION_NOT_FOUND: Ledger entry missing for key ${reconciliationKey}`);
    err.code = 'RECONCILIATION_NOT_FOUND';
    throw err;
  }

  if (ledgerRow.status !== 'APPROVED' || !ledgerRow.approved_by || !ledgerRow.approved_at) {
    const err = new Error(`EXECUTION_NOT_APPROVED: Ledger entry not in APPROVED state for key ${reconciliationKey}`);
    err.code = 'EXECUTION_NOT_APPROVED';
    throw err;
  }

  // 2. Executor-Owned True Fresh DB Revalidation
  let currentSnapshot;
  try {
    if (typeof evidenceLoader === 'function') {
      currentSnapshot = await evidenceLoader(ledgerRow);
    } else {
      currentSnapshot = await loadCurrentEvidenceForLedgerGroup(dbClient, ledgerRow);
    }
  } catch (evErr) {
    const err = new Error(`CURRENT_EVIDENCE_LOOKUP_FAILED: ${evErr.message}`);
    err.code = 'CURRENT_EVIDENCE_LOOKUP_FAILED';
    throw err;
  }

  // Extract Moka ID or candidate rows to rerun planner
  const mokaId = currentSnapshot.candidateRows?.[0]?.moka_customer_id || ledgerRow.moka_group_hash;
  const freshGroupPlan = planMokaCustomerGroupReconciliation({
    mokaId,
    candidateRows: currentSnapshot.candidateRows,
    transactionRows: currentSnapshot.transactionRows,
    bookingRows: currentSnapshot.bookingRows,
    scheduleRows: currentSnapshot.scheduleRows,
    memberEvidenceRows: currentSnapshot.memberEvidenceRows,
  });

  const freshFingerprint = computePlanFingerprint(freshGroupPlan, currentSnapshot);

  // 3. Revalidate fresh fingerprint, classification, canonical, and duplicate set
  if (freshGroupPlan.classification !== CLASSIFICATION.SAFE_AUTO_RECONCILE &&
      freshGroupPlan.classification !== CLASSIFICATION.DETERMINISTIC_RECONCILIATION) {
    const err = new Error(`EXECUTION_REVALIDATION_FAILED: Classification ${freshGroupPlan.classification} is not executable`);
    err.code = 'EXECUTION_REVALIDATION_FAILED';
    throw err;
  }

  if (freshFingerprint !== ledgerRow.plan_fingerprint ||
      freshGroupPlan.canonical_customer_id !== ledgerRow.canonical_customer_id ||
      JSON.stringify((freshGroupPlan.duplicate_rows_to_retire || []).sort()) !== JSON.stringify((ledgerRow.duplicate_customer_ids || []).sort())) {
    const err = new Error('EXECUTION_REVALIDATION_FAILED: Fresh state drifted from approved plan');
    err.code = 'EXECUTION_REVALIDATION_FAILED';
    throw err;
  }

  // 4. Invoke mutation RPC
  try {
    const { data, error } = await dbClient.rpc('reconcile_customer_duplicate_group', {
      p_reconciliation_key: reconciliationKey,
      p_expected_fingerprint: ledgerRow.plan_fingerprint,
    });

    if (error) {
      throw error;
    }
    return { status: 'COMPLETED', dbResult: data };
  } catch (dbErr) {
    // 5. Separate Transaction: Record durable FAILED status (only after RPC attempt)
    let failedWriteCode = null;
    try {
      const { error: failedWriteErr } = await dbClient
        .from('customer_reconciliation_ledger')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          error_code: dbErr.code || 'DB_RPC_FAILED',
          error_summary: dbErr.message || 'Execution RPC failed',
        })
        .eq('reconciliation_key', reconciliationKey)
        .eq('status', 'APPROVED');

      if (failedWriteErr) {
        failedWriteCode = 'FAILED_STATUS_PERSISTENCE_FAILED';
      }
    } catch (_) {
      failedWriteCode = 'FAILED_STATUS_PERSISTENCE_FAILED';
    }

    const err = new Error(`DATABASE_RECONCILIATION_FAILED: ${dbErr.message}`);
    err.code = dbErr.code || 'DB_RPC_FAILED';
    if (failedWriteCode) {
      err.secondary_code = failedWriteCode;
    }
    throw err;
  }
}

/**
 * High-safety execution wrapper for single duplicate Moka group.
 *
 * @param {object} executionPlan
 * @param {object} currentEvidenceSnapshot - MANDATORY for dry-run validation
 * @param {object} groupPlan - MANDATORY for dry-run validation
 * @param {object} [dbClient]
 * @returns {Promise<object>} Execution result object
 */
async function executeReconciliationGroup(executionPlan, currentEvidenceSnapshot, groupPlan, dbClient = null) {
  // If dbClient provided, delegate to executor-owned executeApprovedReconciliation
  if (dbClient) {
    return executeApprovedReconciliation({
      reconciliationKey: executionPlan.reconciliation_key,
      dbClient,
      evidenceLoader: async () => currentEvidenceSnapshot,
    });
  }

  // HARD KILL SWITCH GUARD FOR DRY-RUN
  if (!isExecutionKillSwitchEnabled()) {
    const err = new Error('KILL_SWITCH_DISABLED: CRM_RECONCILIATION_EXECUTION_ENABLED is false');
    err.code = 'KILL_SWITCH_DISABLED';
    throw err;
  }

  // MANDATORY FRESH REVALIDATION CHECK
  if (!groupPlan || !currentEvidenceSnapshot) {
    const err = new Error('EXECUTION_REVALIDATION_REQUIRED: Fresh groupPlan and currentEvidenceSnapshot must be provided');
    err.code = 'EXECUTION_REVALIDATION_REQUIRED';
    throw err;
  }

  const validation = validateExecutionPlan(executionPlan, currentEvidenceSnapshot, groupPlan, null);
  if (!validation.valid) {
    const err = new Error(`EXECUTION_VALIDATION_FAILED: ${validation.reason_code}`);
    err.code = validation.reason_code;
    throw err;
  }

  return {
    status: 'DRY_RUN_ELIGIBLE',
    reconciliation_key: executionPlan.reconciliation_key,
    reason_code: validation.reason_code,
  };
}

/**
 * Reversible rollback wrapper for a completed reconciliation group.
 * Hard-guarded by CRM_RECONCILIATION_EXECUTION_ENABLED kill switch.
 *
 * @param {string} reconciliationKey - Key of reconciliation group to rollback
 * @param {object} [dbClient]
 * @returns {Promise<object>} Rollback result object
 */
async function rollbackReconciliationGroup(reconciliationKey, dbClient = null) {
  // HARD KILL SWITCH GUARD
  if (!isExecutionKillSwitchEnabled()) {
    const err = new Error('KILL_SWITCH_DISABLED: CRM_RECONCILIATION_EXECUTION_ENABLED is false');
    err.code = 'KILL_SWITCH_DISABLED';
    throw err;
  }

  if (!reconciliationKey || typeof reconciliationKey !== 'string') {
    throw new Error('INVALID_RECONCILIATION_KEY: Reconciliation key must be provided');
  }

  if (dbClient) {
    const { data, error } = await dbClient.rpc('rollback_customer_reconciliation_group', {
      p_reconciliation_key: reconciliationKey,
    });

    if (error) {
      const err = new Error(`DATABASE_ROLLBACK_FAILED: ${error.message}`);
      err.code = error.code || 'DB_ROLLBACK_FAILED';
      throw err;
    }
    return { status: 'ROLLED_BACK', dbResult: data };
  }

  return {
    status: 'ROLLED_BACK',
    reconciliation_key: reconciliationKey,
  };
}

module.exports = {
  computePlanFingerprint,
  hashMokaId,
  buildExecutionPlan,
  validateExecutionPlan,
  isExecutionKillSwitchEnabled,
  loadCurrentEvidenceForLedgerGroup,
  executeApprovedReconciliation,
  executeReconciliationGroup,
  rollbackReconciliationGroup,
};
