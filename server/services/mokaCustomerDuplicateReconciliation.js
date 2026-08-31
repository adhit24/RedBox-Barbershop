'use strict';

/**
 * Task 17.3.1 — Moka Customer ID Duplicate Reconciliation (CRM Identity Integrity Round 5).
 *
 * Single canonical classification and planning authority for duplicate moka_customer_id groups.
 *
 * Core Business Contract:
 *   1. SAFE RECONCILIATION ONLY: Wrong customer merge is worse than leaving duplicates unresolved.
 *   2. AMBIGUOUS CASES MUST REMAIN MANUAL REVIEW.
 *   3. NO ARBITRARY TIE-BREAKING: Never pick newest, oldest, first row, or UUID order when business evidence conflicts.
 *   4. MEMBERSHIP AUTHORITY: member_profiles is the ONLY membership authority; multiple active profiles => MANUAL_REVIEW.
 *   5. ZERO PII TELEMETRY: Telemetry and summary logs contain zero PII.
 */

const { normalizePhoneNumber } = require('../identity/phoneNormalization');

const CLASSIFICATION = Object.freeze({
  SAFE_AUTO_RECONCILE: 'SAFE_AUTO_RECONCILE',
  DETERMINISTIC_RECONCILIATION: 'DETERMINISTIC_RECONCILIATION',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  INVALID_DATA: 'INVALID_DATA',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
});

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function normalizePhoneSafe(raw) {
  if (typeof raw !== 'string') return null;
  const digits = normalizePhoneNumber(raw);
  return digits ? `+${digits}` : null;
}

/**
 * Pure classifier function for a single duplicate moka_customer_id group.
 *
 * @param {object} params
 * @param {string} params.mokaId - Duplicate moka_customer_id string
 * @param {Array<object>} params.candidateRows - Array of customer rows with same moka_customer_id
 * @param {Array<object>} [params.transactionRows] - Array of transaction rows for these customer IDs
 * @param {Array<object>} [params.bookingRows] - Array of booking/schedule rows for these customer IDs
 * @param {Array<object>} [params.memberProfileRows] - Array of member profile rows for these customer IDs
 * @param {Array<object>} [params.otherFkRows] - Array of other FK rows (notes, vouchers, etc.)
 * @returns {object} Structured reconciliation plan
 */
function planMokaCustomerGroupReconciliation({
  mokaId = null,
  candidateRows = [],
  transactionRows = [],
  bookingRows = [],
  memberProfileRows = [],
  otherFkRows = [],
} = {}) {
  const cleanMokaId = isNonEmptyString(mokaId) ? String(mokaId).trim() : null;

  if (!cleanMokaId || !Array.isArray(candidateRows) || candidateRows.length < 2) {
    return {
      moka_id: cleanMokaId,
      classification: CLASSIFICATION.INVALID_DATA,
      reason_code: !cleanMokaId ? 'missing_moka_id' : 'insufficient_candidates_for_duplicate_group',
      candidate_count: Array.isArray(candidateRows) ? candidateRows.length : 0,
      canonical_customer_id: null,
      duplicate_rows_to_retire: [],
      transaction_refs_to_move: 0,
      booking_refs_to_move: 0,
      member_profile_refs_to_move: 0,
      other_fk_refs_to_move: 0,
      conflict_flags: ['invalid_data'],
    };
  }

  const candidateIds = new Set(candidateRows.map(c => c.id));
  const conflictFlags = [];

  // 1. Transaction Ownership Evidence (eligible: completed / paid, amount > 0)
  const eligibleTxMap = new Map(); // customer_id -> { count, total_spend }
  for (const tx of transactionRows || []) {
    const txStatus = String(tx.status || '').toLowerCase();
    const amount = Number(tx.total_amount || tx.price || 0);
    if ((txStatus === 'completed' || txStatus === 'paid') && amount > 0 && candidateIds.has(tx.customer_id)) {
      if (!eligibleTxMap.has(tx.customer_id)) {
        eligibleTxMap.set(tx.customer_id, { count: 0, total_spend: 0 });
      }
      const entry = eligibleTxMap.get(tx.customer_id);
      entry.count++;
      entry.total_spend += amount;
    }
  }
  const candidatesWithTx = Array.from(eligibleTxMap.keys());

  // 2. Booking Ownership Evidence
  const bookingMap = new Map(); // customer_id -> count
  for (const b of bookingRows || []) {
    if (b.customer_id && candidateIds.has(b.customer_id)) {
      bookingMap.set(b.customer_id, (bookingMap.get(b.customer_id) || 0) + 1);
    }
  }
  const candidatesWithBooking = Array.from(bookingMap.keys());

  // 3. Active Membership Authority (member_profiles is the ONLY membership authority)
  const activeMemberMap = new Map(); // customer_id -> count
  for (const mp of memberProfileRows || []) {
    const mpStatus = String(mp.status || '').toLowerCase();
    if (mp.customer_id && candidateIds.has(mp.customer_id) && mpStatus !== 'inactive' && mpStatus !== 'cancelled') {
      activeMemberMap.set(mp.customer_id, (activeMemberMap.get(mp.customer_id) || 0) + 1);
    }
  }
  const candidatesWithActiveMember = Array.from(activeMemberMap.keys());

  if (candidatesWithActiveMember.length > 1) {
    conflictFlags.push('multiple_active_member_profiles');
  }

  // 4. Phone / WA Consistency
  const phoneMap = new Map(); // normalized_phone -> Array of candidate IDs
  const rawPhones = [];
  for (const c of candidateRows) {
    const phone = c.phone_e164 || c.wa || c.phone || null;
    const norm = normalizePhoneSafe(phone);
    if (norm) {
      if (!phoneMap.has(norm)) phoneMap.set(norm, []);
      phoneMap.get(norm).push(c.id);
      rawPhones.push(norm);
    }
  }
  const distinctPhones = Array.from(phoneMap.keys());
  const samePhoneAcrossAll = distinctPhones.length === 1 && phoneMap.get(distinctPhones[0]).length === candidateRows.length;

  if (distinctPhones.length > 1) {
    conflictFlags.push('multiple_distinct_phones');
  }

  // 5. Name Conflicts
  const distinctNames = new Set(candidateRows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
  if (distinctNames.size > 1) {
    conflictFlags.push('conflicting_customer_names');
  }

  // ── CANONICAL SELECTION DECISION LOGIC ──────────────────────────────────────

  // Rule 1: Immediate Manual Review on Active Membership Conflict
  if (candidatesWithActiveMember.length > 1) {
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'multiple_active_member_profiles',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 2: Competing Transaction Ownership
  if (candidatesWithTx.length > 1) {
    conflictFlags.push('competing_eligible_transaction_ownership');
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'competing_eligible_transaction_ownership',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 3: Competing Booking Ownership
  if (candidatesWithBooking.length > 1 && candidatesWithTx.length === 0) {
    conflictFlags.push('competing_booking_ownership');
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'competing_booking_ownership',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 4: Unique Verified Transaction Owner
  if (candidatesWithTx.length === 1) {
    const canonicalId = candidatesWithTx[0];
    // Verify no conflicting phone on other candidate rows pushes to manual review
    if (distinctPhones.length > 1 && !samePhoneAcrossAll) {
      // Check if other candidates with different phones exist
      const canonicalPhone = normalizePhoneSafe(candidateRows.find(c => c.id === canonicalId)?.phone_e164 || candidateRows.find(c => c.id === canonicalId)?.wa);
      const otherPhones = distinctPhones.filter(p => p !== canonicalPhone);
      if (otherPhones.length > 0) {
        conflictFlags.push('tx_owner_phone_conflict');
      }
    }

    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
      reasonCode: 'unique_verified_transaction_owner',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 5: Unique Booking Owner (when zero transaction evidence)
  if (candidatesWithBooking.length === 1 && candidatesWithTx.length === 0) {
    const canonicalId = candidatesWithBooking[0];
    if (distinctPhones.length > 1) {
      return buildResult({
        mokaId: cleanMokaId,
        classification: CLASSIFICATION.MANUAL_REVIEW,
        reasonCode: 'booking_owner_multiple_distinct_phones',
        candidateRows,
        canonicalId: null,
        transactionRows,
        bookingRows,
        memberProfileRows,
        otherFkRows,
        conflictFlags,
      });
    }

    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
      reasonCode: 'unique_booking_owner',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 6: Same Phone across all rows + Single Active Member / Zero Evidence
  if (samePhoneAcrossAll && candidatesWithTx.length === 0 && candidatesWithBooking.length === 0) {
    let canonicalId = null;
    if (candidatesWithActiveMember.length === 1) {
      canonicalId = candidatesWithActiveMember[0];
    } else {
      // Stable lexicographical tie-break when phone is identical and zero business conflict
      const sortedIds = candidateRows.map(c => c.id).sort();
      canonicalId = sortedIds[0];
    }

    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.DETERMINISTIC_RECONCILIATION,
      reasonCode: 'same_phone_zero_evidence_deterministic_tiebreak',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      memberProfileRows,
      otherFkRows,
      conflictFlags,
    });
  }

  // Rule 7: Default Manual Review for remaining unresolved groups
  return buildResult({
    mokaId: cleanMokaId,
    classification: CLASSIFICATION.MANUAL_REVIEW,
    reasonCode: 'unresolved_competing_or_missing_evidence',
    candidateRows,
    canonicalId: null,
    transactionRows,
    bookingRows,
    memberProfileRows,
    otherFkRows,
    conflictFlags,
  });
}

function buildResult({
  mokaId,
  classification,
  reasonCode,
  candidateRows,
  canonicalId,
  transactionRows,
  bookingRows,
  memberProfileRows,
  otherFkRows,
  conflictFlags,
}) {
  const candidateIds = candidateRows.map(c => c.id);
  const duplicateRowsToRetire = canonicalId
    ? candidateIds.filter(id => id !== canonicalId)
    : [];

  const retiredSet = new Set(duplicateRowsToRetire);

  const txRefsToMove = (transactionRows || []).filter(t => retiredSet.has(t.customer_id)).length;
  const bookingRefsToMove = (bookingRows || []).filter(b => retiredSet.has(b.customer_id)).length;
  const memberProfileRefsToMove = (memberProfileRows || []).filter(m => retiredSet.has(m.customer_id)).length;
  const otherFkRefsToMove = (otherFkRows || []).filter(o => retiredSet.has(o.customer_id)).length;

  return Object.freeze({
    moka_id: mokaId,
    classification,
    reason_code: reasonCode,
    candidate_count: candidateRows.length,
    canonical_customer_id: canonicalId,
    duplicate_rows_to_retire: duplicateRowsToRetire,
    transaction_refs_to_move: txRefsToMove,
    booking_refs_to_move: bookingRefsToMove,
    member_profile_refs_to_move: memberProfileRefsToMove,
    other_fk_refs_to_move: otherFkRefsToMove,
    conflict_flags: Array.from(new Set(conflictFlags)),
  });
}

module.exports = {
  CLASSIFICATION,
  planMokaCustomerGroupReconciliation,
};
