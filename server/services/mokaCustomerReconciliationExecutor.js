'use strict';

/**
 * Task 17.3.2 — Moka Customer Duplicate Reconciliation Execution Service & Safety Architecture (Correction Round 2).
 *
 * Core Business & Technical Invariants:
 *   1. WRONG CUSTOMER MERGE IS WORSE THAN LEAVING DUPLICATES UNRESOLVED.
 *   2. EXECUTION DISABLED BY DEFAULT: Kill switch `CRM_RECONCILIATION_EXECUTION_ENABLED` MUST strictly equal "true".
 *   3. CLASSIFICATION ALLOWLIST: Only SAFE_AUTO_RECONCILE and durably approved DETERMINISTIC_RECONCILIATION execute.
 *      MANUAL_REVIEW, LOOKUP_FAILED, and INVALID_DATA CANNOT execute under any circumstances.
 *   4. MANDATORY FRESH REVALIDATION: Fresh groupPlan and fresh evidenceSnapshot MUST be provided to revalidate fingerprint.
 *   5. LEDGER LOOKUP FAIL-CLOSED: Ledger lookup errors throw LEDGER_LOOKUP_FAILED without RPC invocation or FAILED writes.
 *   6. DURABLE APPROVED GATE: Both SAFE_AUTO_RECONCILE and DETERMINISTIC_RECONCILIATION require durable ledger approval before RPC mutation.
 *   7. NARROW FAILED WRITE BOUNDARY: FAILED status is written to ledger ONLY when RPC execution attempt fails after all pre-validations pass.
 *   8. ZERO PII LOGGING / TELEMETRY: Telemetry minifies and hashes correlation keys; zero PII.
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

  // 5. Durable Ledger Approval Gate Check (for actual mutation with ledgerRow)
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
 * High-safety execution wrapper for single duplicate Moka group.
 * Hard-guarded by CRM_RECONCILIATION_EXECUTION_ENABLED kill switch.
 *
 * @param {object} executionPlan
 * @param {object} currentEvidenceSnapshot - MANDATORY
 * @param {object} groupPlan - MANDATORY
 * @param {object} [dbClient]
 * @returns {Promise<object>} Execution result object
 */
async function executeReconciliationGroup(executionPlan, currentEvidenceSnapshot, groupPlan, dbClient = null) {
  // HARD KILL SWITCH GUARD
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

  let ledgerRow = null;
  if (dbClient) {
    const { data: ledgerData, error: lookupErr } = await dbClient
      .from('customer_reconciliation_ledger')
      .select('*')
      .eq('reconciliation_key', executionPlan.reconciliation_key)
      .maybeSingle();

    if (lookupErr) {
      const err = new Error(`LEDGER_LOOKUP_FAILED: ${lookupErr.message}`);
      err.code = 'LEDGER_LOOKUP_FAILED';
      throw err;
    }

    if (!ledgerData) {
      const err = new Error(`RECONCILIATION_NOT_FOUND: Ledger entry missing for key ${executionPlan.reconciliation_key}`);
      err.code = 'RECONCILIATION_NOT_FOUND';
      throw err;
    }

    ledgerRow = ledgerData;
  }

  const validation = validateExecutionPlan(executionPlan, currentEvidenceSnapshot, groupPlan, ledgerRow);
  if (!validation.valid) {
    const err = new Error(`EXECUTION_VALIDATION_FAILED: ${validation.reason_code}`);
    err.code = validation.reason_code;
    throw err;
  }

  // Execute database transaction if client provided
  if (dbClient) {
    try {
      const { data, error } = await dbClient.rpc('reconcile_customer_duplicate_group', {
        p_reconciliation_key: executionPlan.reconciliation_key,
        p_expected_fingerprint: executionPlan.plan_fingerprint,
      });

      if (error) {
        throw error;
      }
      return { status: 'COMPLETED', dbResult: data };
    } catch (dbErr) {
      // SEPARATE TRANSACTION: Record durable FAILED status in ledger ONLY after RPC attempt
      try {
        await dbClient
          .from('customer_reconciliation_ledger')
          .update({
            status: 'FAILED',
            failed_at: new Date().toISOString(),
            error_code: dbErr.code || 'DB_RPC_FAILED',
            error_summary: dbErr.message || 'Execution RPC failed',
          })
          .eq('reconciliation_key', executionPlan.reconciliation_key);
      } catch (_) {
        // Ignore separate logging errors to preserve primary RPC error
      }
      const err = new Error(`DATABASE_RECONCILIATION_FAILED: ${dbErr.message}`);
      err.code = dbErr.code || 'DB_RPC_FAILED';
      throw err;
    }
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
  executeReconciliationGroup,
  rollbackReconciliationGroup,
};
