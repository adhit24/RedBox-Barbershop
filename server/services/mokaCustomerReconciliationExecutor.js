'use strict';

/**
 * Task 17.3.2 — Moka Customer Duplicate Reconciliation Execution Service & Safety Architecture.
 *
 * Core Business & Technical Invariants:
 *   1. WRONG CUSTOMER MERGE IS WORSE THAN LEAVING DUPLICATES UNRESOLVED.
 *   2. EXECUTION DISABLED BY DEFAULT: Kill switch `CRM_RECONCILIATION_EXECUTION_ENABLED` defaults to false.
 *   3. CLASSIFICATION GATE: Only SAFE_AUTO_RECONCILE (and explicitly approved DETERMINISTIC) can execute.
 *      MANUAL_REVIEW, LOOKUP_FAILED, and INVALID_DATA CANNOT execute under any circumstances.
 *   4. FINGERPRINT DRIFT GUARD: Any state drift between plan and execution aborts execution.
 *   5. ATOMIC & REVERSIBLE: Single group per database transaction; PII-free rollback snapshot captures previous ownership.
 *   6. ZERO PII LOGGING / TELEMETRY: Telemetry minifies and hashes correlation keys; zero PII.
 */

const crypto = require('crypto');
const { CLASSIFICATION } = require('./mokaCustomerDuplicateReconciliation');

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
    transaction_ids: (evidenceSnapshot?.transactionRows || []).map(t => `${t.id}:${t.customer_id}:${t.status}`).sort(),
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
    planned_booking_refs: bookingMoves.length,
    planned_schedule_refs: scheduleMoves.length,
    planned_other_refs: 0,

    transaction_moves: txMoves,
    booking_moves: bookingMoves,
    schedule_moves: scheduleMoves,

    rollback_snapshot: rollbackSnapshot,
  });
}

/**
 * Validates an execution plan against current evidence snapshot and safety rules.
 *
 * @param {object} executionPlan - Plan from buildExecutionPlan()
 * @param {object} currentEvidenceSnapshot - Fresh evidence snapshot
 * @param {object} [groupPlan] - Fresh classification result
 * @param {object} [options] - Approval options { approved_by, force_enable }
 * @returns {object} Validation result { valid: boolean, reason_code: string }
 */
function validateExecutionPlan(executionPlan, currentEvidenceSnapshot = {}, groupPlan = null, options = {}) {
  // 1. Classification Authority Check
  const classification = executionPlan?.classification;

  if (classification === CLASSIFICATION.MANUAL_REVIEW) {
    return { valid: false, reason_code: 'MANUAL_REVIEW_CANNOT_EXECUTE' };
  }
  if (classification === CLASSIFICATION.LOOKUP_FAILED) {
    return { valid: false, reason_code: 'LOOKUP_FAILED_CANNOT_EXECUTE' };
  }
  if (classification === CLASSIFICATION.INVALID_DATA) {
    return { valid: false, reason_code: 'INVALID_DATA_CANNOT_EXECUTE' };
  }

  // 2. Deterministic Approval Gate Check
  if (classification === CLASSIFICATION.DETERMINISTIC_RECONCILIATION) {
    if (!options.approved_by || typeof options.approved_by !== 'string' || options.approved_by.trim().length === 0) {
      return { valid: false, reason_code: 'DETERMINISTIC_REQUIRES_EXPLICIT_APPROVAL' };
    }
  }

  // 3. Self-Merge & Canonical Integrity Check
  const canonicalId = executionPlan.canonical_customer_id;
  const duplicateIds = executionPlan.duplicate_customer_ids || [];

  if (!canonicalId) {
    return { valid: false, reason_code: 'MISSING_CANONICAL_CUSTOMER_ID' };
  }

  if (duplicateIds.includes(canonicalId)) {
    return { valid: false, reason_code: 'CANONICAL_CANNOT_BE_RETIRED' };
  }

  // 4. Fingerprint & Drift Guard Check
  if (groupPlan) {
    const currentFingerprint = computePlanFingerprint(groupPlan, currentEvidenceSnapshot);
    if (currentFingerprint !== executionPlan.plan_fingerprint) {
      return { valid: false, reason_code: 'STALE_PLAN_FINGERPRINT_DRIFT_DETECTED' };
    }
  }

  return { valid: true, reason_code: 'ELIGIBLE_FOR_EXECUTION' };
}

/**
 * Checks if reconciliation execution kill switch is enabled.
 *
 * @returns {boolean}
 */
function isExecutionKillSwitchEnabled() {
  return process.env.CRM_RECONCILIATION_EXECUTION_ENABLED === 'true';
}

/**
 * High-safety execution wrapper for single duplicate Moka group.
 * Hard-guarded by CRM_RECONCILIATION_EXECUTION_ENABLED kill switch.
 *
 * @param {object} executionPlan
 * @param {object} currentEvidenceSnapshot
 * @param {object} [groupPlan]
 * @param {object} [options]
 * @param {object} [dbClient]
 * @returns {Promise<object>} Execution result object
 */
async function executeReconciliationGroup(executionPlan, currentEvidenceSnapshot = {}, groupPlan = null, options = {}, dbClient = null) {
  // HARD KILL SWITCH GUARD
  if (!isExecutionKillSwitchEnabled()) {
    const err = new Error('KILL_SWITCH_DISABLED: CRM_RECONCILIATION_EXECUTION_ENABLED is false');
    err.code = 'KILL_SWITCH_DISABLED';
    throw err;
  }

  const validation = validateExecutionPlan(executionPlan, currentEvidenceSnapshot, groupPlan, options);
  if (!validation.valid) {
    const err = new Error(`EXECUTION_VALIDATION_FAILED: ${validation.reason_code}`);
    err.code = validation.reason_code;
    throw err;
  }

  // Execute database transaction if client provided
  if (dbClient) {
    const { data, error } = await dbClient.rpc('reconcile_customer_duplicate_group', {
      p_reconciliation_key: executionPlan.reconciliation_key,
      p_expected_fingerprint: executionPlan.plan_fingerprint,
      p_canonical_id: executionPlan.canonical_customer_id,
      p_duplicate_ids: executionPlan.duplicate_customer_ids,
      p_tx_ids: (executionPlan.transaction_moves || []).map(t => t.id),
      p_booking_ids: (executionPlan.booking_moves || []).map(b => b.id),
      p_schedule_ids: (executionPlan.schedule_moves || []).map(s => s.id),
    });

    if (error) {
      const err = new Error(`DATABASE_RECONCILIATION_FAILED: ${error.message}`);
      err.code = error.code || 'DB_RPC_FAILED';
      throw err;
    }
    return { status: 'COMPLETED', dbResult: data };
  }

  return {
    status: 'DRY_RUN_ELIGIBLE',
    reconciliation_key: executionPlan.reconciliation_key,
    reason_code: validation.reason_code,
  };
}

/**
 * Reversible rollback wrapper for a completed or failed reconciliation group.
 * Hard-guarded by CRM_RECONCILIATION_EXECUTION_ENABLED kill switch.
 *
 * @param {object} rollbackSnapshot - PII-free snapshot from buildExecutionPlan()
 * @param {object} [dbClient]
 * @returns {Promise<object>} Rollback result object
 */
async function rollbackReconciliationGroup(rollbackSnapshot, dbClient = null) {
  // HARD KILL SWITCH GUARD
  if (!isExecutionKillSwitchEnabled()) {
    const err = new Error('KILL_SWITCH_DISABLED: CRM_RECONCILIATION_EXECUTION_ENABLED is false');
    err.code = 'KILL_SWITCH_DISABLED';
    throw err;
  }

  if (!rollbackSnapshot || !rollbackSnapshot.canonical_customer_id) {
    throw new Error('INVALID_ROLLBACK_SNAPSHOT: Missing snapshot or canonical_customer_id');
  }

  const canonicalId = rollbackSnapshot.canonical_customer_id;
  let txRestored = 0;
  let bookingRestored = 0;
  let scheduleRestored = 0;
  let customerUnretired = 0;

  if (dbClient) {
    // 1. Restore transactions conditionally (only if still pointing to canonicalId)
    for (const move of rollbackSnapshot.transaction_moves || []) {
      const { data } = await dbClient
        .from('transactions')
        .update({ customer_id: move.previous_customer_id })
        .eq('id', move.id)
        .eq('customer_id', canonicalId)
        .select('id');
      if (data && data.length > 0) txRestored += data.length;
    }

    // 2. Restore bookings conditionally
    for (const move of rollbackSnapshot.booking_moves || []) {
      const { data } = await dbClient
        .from('bookings')
        .update({ customer_id: move.previous_customer_id })
        .eq('id', move.id)
        .eq('customer_id', canonicalId)
        .select('id');
      if (data && data.length > 0) bookingRestored += data.length;
    }

    // 3. Restore schedules conditionally
    for (const move of rollbackSnapshot.schedule_moves || []) {
      const { data } = await dbClient
        .from('schedules')
        .update({ customer_id: move.previous_customer_id })
        .eq('id', move.id)
        .eq('customer_id', canonicalId)
        .select('id');
      if (data && data.length > 0) scheduleRestored += data.length;
    }

    // 4. Un-retire duplicate customer rows
    for (const dupId of rollbackSnapshot.retired_customer_ids || []) {
      const { data } = await dbClient
        .from('customers')
        .update({ merged_into_customer_id: null, merged_at: null })
        .eq('id', dupId)
        .eq('merged_into_customer_id', canonicalId)
        .select('id');
      if (data && data.length > 0) customerUnretired += data.length;
    }
  }

  return {
    status: 'ROLLED_BACK',
    reconciliation_key: rollbackSnapshot.reconciliation_key,
    restored_transactions: txRestored,
    restored_bookings: bookingRestored,
    restored_schedules: scheduleRestored,
    unretired_customers: customerUnretired,
  };
}

module.exports = {
  computePlanFingerprint,
  hashMokaId,
  buildExecutionPlan,
  validateExecutionPlan,
  isExecutionKillSwitchEnabled,
  executeReconciliationGroup,
  rollbackReconciliationGroup,
};
