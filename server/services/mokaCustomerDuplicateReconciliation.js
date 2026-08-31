'use strict';

/**
 * Task 17.3.1 — Moka Customer ID Duplicate Reconciliation (CRM Identity Integrity Round 5 Correction 1).
 *
 * Single canonical classification and planning authority for duplicate moka_customer_id groups.
 *
 * Core Business & Technical Invariants:
 *   1. DISTINCT PHONES = MANUAL REVIEW: Multiple distinct valid normalized phones MUST be MANUAL_REVIEW.
 *      Transaction volume or booking ownership NEVER overrides conflicting identity.
 *   2. BOOKINGS VS SCHEDULES SEPARATION: bookings (customer intent) and schedules (operational)
 *      are distinct tables in production schema and evaluated separately.
 *   3. MEMBERSHIP PHONE BRIDGE: member_profiles does not have a customer_id column. It is bridged
 *      via canonical normalized phone matching (member_profiles.phone == candidate.phone_e164/wa).
 *   4. FAIL-CLOSED LOOKUP ERRORS: Any evidence query failure results in LOOKUP_FAILED with NULL canonical ID.
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
 * @param {Array<object>} [params.bookingRows] - Array of bookings table rows for these customer IDs
 * @param {Array<object>} [params.scheduleRows] - Array of schedules table rows for these customer IDs
 * @param {Array<object>} [params.memberEvidenceRows] - Array of member_profiles rows (bridged via phone)
 * @param {Array<object>} [params.otherReferenceRows] - Array of other FK rows (notes, vouchers, etc.)
 * @param {object} [params.lookupStatus] - Status of evidence queries { transactions, bookings, schedules, membership }
 * @returns {object} Structured reconciliation plan
 */
function planMokaCustomerGroupReconciliation({
  mokaId = null,
  candidateRows = [],
  transactionRows = [],
  bookingRows = [],
  scheduleRows = [],
  memberEvidenceRows = [],
  otherReferenceRows = [],
  lookupStatus = { transactions: 'ok', bookings: 'ok', schedules: 'ok', membership: 'ok' },
} = {}) {
  const cleanMokaId = isNonEmptyString(mokaId) ? String(mokaId).trim() : null;

  // 1. Fail-Closed Lookup Error Check
  if (
    lookupStatus?.transactions === 'failed' ||
    lookupStatus?.bookings === 'failed' ||
    lookupStatus?.schedules === 'failed' ||
    lookupStatus?.membership === 'failed'
  ) {
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.LOOKUP_FAILED,
      reasonCode: 'evidence_lookup_failed',
      candidateRows: Array.isArray(candidateRows) ? candidateRows : [],
      canonicalId: null,
      transactionRows: [],
      bookingRows: [],
      scheduleRows: [],
      memberEvidenceRows: [],
      otherReferenceRows: [],
      conflictFlags: ['lookup_failed'],
    });
  }

  // 2. Input Validation Check
  if (!cleanMokaId || !Array.isArray(candidateRows) || candidateRows.length < 2) {
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.INVALID_DATA,
      reasonCode: !cleanMokaId ? 'missing_moka_id' : 'insufficient_candidates_for_duplicate_group',
      candidateRows: Array.isArray(candidateRows) ? candidateRows : [],
      canonicalId: null,
      transactionRows: [],
      bookingRows: [],
      scheduleRows: [],
      memberEvidenceRows: [],
      otherReferenceRows: [],
      conflictFlags: ['invalid_data'],
    });
  }

  const candidateIds = new Set(candidateRows.map(c => c.id));
  const conflictFlags = [];

  // 3. Normalized Phone Analysis
  const candidatePhoneMap = new Map(); // candidate_id -> normalized_phone
  const normPhonesSet = new Set();

  for (const c of candidateRows) {
    const norm = normalizePhoneSafe(c.phone_e164 || c.wa || c.phone);
    candidatePhoneMap.set(c.id, norm);
    if (norm) normPhonesSet.add(norm);
  }

  const distinctNormalizedPhones = Array.from(normPhonesSet);
  const hasMultipleDistinctPhones = distinctNormalizedPhones.length > 1;
  const hasNoValidPhone = distinctNormalizedPhones.length === 0;
  const sameNormalizedPhoneAcrossAllCandidates = (
    distinctNormalizedPhones.length === 1 &&
    candidateRows.every(c => candidatePhoneMap.get(c.id) === distinctNormalizedPhones[0])
  );

  // 4. Transaction Ownership Evidence (eligible: completed / paid, amount > 0)
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

  // 5. Booking Ownership Evidence (bookings table)
  const bookingMap = new Map(); // customer_id -> count
  for (const b of bookingRows || []) {
    if (b.customer_id && candidateIds.has(b.customer_id)) {
      bookingMap.set(b.customer_id, (bookingMap.get(b.customer_id) || 0) + 1);
    }
  }
  const candidatesWithBooking = Array.from(bookingMap.keys());

  // 6. Schedule Ownership Evidence (schedules table) — distinguish web vs moka
  const trustedWebScheduleMap = new Map();
  for (const s of scheduleRows || []) {
    if (s.customer_id && candidateIds.has(s.customer_id) && s.source === 'web') {
      trustedWebScheduleMap.set(s.customer_id, (trustedWebScheduleMap.get(s.customer_id) || 0) + 1);
    }
  }
  const candidatesWithWebSchedule = Array.from(trustedWebScheduleMap.keys());

  // 7. Membership Authority Bridge (phone-matched member_profiles)
  const activeMemberProfilesMatched = new Set(); // mp.id set
  const candidateActiveMemberMap = new Map(); // candidate_id -> Set of mp.id

  for (const c of candidateRows) {
    const candidateNormPhone = candidatePhoneMap.get(c.id);
    if (!candidateNormPhone) continue;

    for (const mp of memberEvidenceRows || []) {
      const mpNormPhone = normalizePhoneSafe(mp.phone);
      const mpStatus = String(mp.membership_status || mp.status || '').toLowerCase();
      const isActive = mpStatus !== 'inactive' && mpStatus !== 'cancelled' && (mp.membership_activated_at || mpStatus === 'active');

      if (mpNormPhone && mpNormPhone === candidateNormPhone && isActive) {
        activeMemberProfilesMatched.add(mp.id);
        if (!candidateActiveMemberMap.has(c.id)) candidateActiveMemberMap.set(c.id, new Set());
        candidateActiveMemberMap.get(c.id).add(mp.id);
      }
    }
  }

  // Conflict ONLY if more than 1 distinct active member_profile exists
  if (activeMemberProfilesMatched.size > 1) {
    conflictFlags.push('multiple_active_member_profiles');
  }

  // 8. Name Conflict Audit
  const distinctNames = new Set(candidateRows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
  if (distinctNames.size > 1) {
    conflictFlags.push('conflicting_customer_names');
  }

  // ── CANONICAL SELECTION DECISION LOGIC ──────────────────────────────────────

  // RULE 1: FAIL CLOSED ON MULTIPLE DISTINCT PHONES -> MANUAL REVIEW
  if (hasMultipleDistinctPhones) {
    conflictFlags.push('multiple_distinct_normalized_phones');
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'multiple_distinct_normalized_phones',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 2: Multiple Active Member Profiles -> MANUAL REVIEW
  if (activeMemberProfilesMatched.size > 1) {
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'multiple_active_member_profiles',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 3: Competing Transaction Ownership -> MANUAL REVIEW
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
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 4: Competing Booking Ownership -> MANUAL REVIEW
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
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 5: Unique Verified Transaction Owner (same phone or no phone conflict)
  if (candidatesWithTx.length === 1) {
    const canonicalId = candidatesWithTx[0];
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
      reasonCode: 'unique_verified_transaction_owner',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 6: Unique Booking Owner (bookings table)
  if (candidatesWithBooking.length === 1 && candidatesWithTx.length === 0) {
    const canonicalId = candidatesWithBooking[0];
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
      reasonCode: 'unique_booking_owner',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 7: Unique Trusted Web Schedule Owner
  if (candidatesWithWebSchedule.length === 1 && candidatesWithTx.length === 0 && candidatesWithBooking.length === 0) {
    const canonicalId = candidatesWithWebSchedule[0];
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.SAFE_AUTO_RECONCILE,
      reasonCode: 'unique_trusted_web_schedule_owner',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 8: Same Phone across all candidates + Single Active Member / Zero Evidence
  if (sameNormalizedPhoneAcrossAllCandidates && candidatesWithTx.length === 0 && candidatesWithBooking.length === 0) {
    const sortedIds = candidateRows.map(c => c.id).sort();
    const canonicalId = sortedIds[0];

    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.DETERMINISTIC_RECONCILIATION,
      reasonCode: 'same_phone_zero_evidence_deterministic_tiebreak',
      candidateRows,
      canonicalId,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      conflictFlags,
    });
  }

  // RULE 9: Default Manual Review (no valid phone, competing evidence, or unresolved)
  if (hasNoValidPhone) {
    conflictFlags.push('no_valid_phone_conflict');
  }

  return buildResult({
    mokaId: cleanMokaId,
    classification: CLASSIFICATION.MANUAL_REVIEW,
    reasonCode: 'unresolved_competing_or_missing_evidence',
    candidateRows,
    canonicalId: null,
    transactionRows,
    bookingRows,
    scheduleRows,
    memberEvidenceRows,
    otherReferenceRows,
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
  scheduleRows,
  memberEvidenceRows,
  otherReferenceRows,
  conflictFlags,
}) {
  const candidateIds = candidateRows.map(c => c.id);
  const duplicateRowsToRetire = canonicalId
    ? candidateIds.filter(id => id !== canonicalId)
    : [];

  const retiredSet = new Set(duplicateRowsToRetire);

  const txRefsToMove = (transactionRows || []).filter(t => retiredSet.has(t.customer_id)).length;
  const bookingRefsToMove = (bookingRows || []).filter(b => retiredSet.has(b.customer_id)).length;
  const scheduleRefsToMove = (scheduleRows || []).filter(s => retiredSet.has(s.customer_id)).length;
  const otherFkRefsToMove = (otherReferenceRows || []).filter(o => retiredSet.has(o.customer_id)).length;

  return Object.freeze({
    moka_id: mokaId,
    classification,
    reason_code: reasonCode,
    candidate_count: candidateRows.length,
    canonical_customer_id: canonicalId,
    duplicate_rows_to_retire: duplicateRowsToRetire,
    transaction_refs_to_move: txRefsToMove,
    booking_refs_to_move: bookingRefsToMove,
    schedule_refs_to_move: scheduleRefsToMove,
    member_profile_refs_to_move: 0, // member_profiles has no customer_id column to move
    other_fk_refs_to_move: otherFkRefsToMove,
    conflict_flags: Array.from(new Set(conflictFlags)),
  });
}

module.exports = {
  CLASSIFICATION,
  planMokaCustomerGroupReconciliation,
};
