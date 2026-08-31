'use strict';

/**
 * Task 17.3.1 — Moka Customer ID Duplicate Reconciliation (CRM Identity Integrity Round 5 Correction 3).
 *
 * Single canonical classification and planning authority for duplicate moka_customer_id groups.
 *
 * Core Business & Technical Invariants:
 *   1. DISTINCT PHONES = MANUAL REVIEW: Multiple distinct valid normalized phones MUST be MANUAL_REVIEW.
 *      Transaction volume or booking ownership NEVER overrides conflicting identity.
 *   2. BOOKINGS VS SCHEDULES SEPARATION: bookings (customer intent) and schedules (operational)
 *      are distinct tables in production schema and evaluated separately.
 *   3. WEB SCHEDULE BOUNDARY & CONFLICT: source='web' schedule is operational evidence.
 *      Multiple web schedule owners MUST be MANUAL_REVIEW (competing_trusted_web_schedule_ownership).
 *      Single web schedule owner can ONLY support DETERMINISTIC_RECONCILIATION, NEVER SAFE_AUTO_RECONCILE by itself.
 *   4. MEMBERSHIP ACTIVATION AUTHORITY: Only `membership_activated_at != null` constitutes active membership authority.
 *      `member_profiles.phone` bridged to multiple same-phone candidates = membership_unresolved.
 *   5. FAIL-CLOSED LOOKUP ERRORS: Any evidence query failure results in LOOKUP_FAILED with NULL canonical ID.
 *   6. ZERO PII TELEMETRY: Telemetry and summary logs contain zero PII.
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
      membershipStatus: 'membership_lookup_failed',
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
      membershipStatus: 'membership_none',
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
  const mokaScheduleMap = new Map();

  for (const s of scheduleRows || []) {
    if (s.customer_id && candidateIds.has(s.customer_id)) {
      if (s.source === 'web') {
        trustedWebScheduleMap.set(s.customer_id, (trustedWebScheduleMap.get(s.customer_id) || 0) + 1);
      } else if (s.source === 'moka') {
        mokaScheduleMap.set(s.customer_id, (mokaScheduleMap.get(s.customer_id) || 0) + 1);
      }
    }
  }
  const candidatesWithWebSchedule = Array.from(trustedWebScheduleMap.keys());
  const candidatesWithMokaSchedule = Array.from(mokaScheduleMap.keys());

  // 7. Membership Authority Bridge & Bounded Evidence Derivation
  // Activation authority strictly requires membership_activated_at IS NOT NULL
  const activatedMpMap = new Map(); // mp.id -> Set<candidate_id>
  for (const mp of memberEvidenceRows || []) {
    const isActivated = mp.membership_activated_at != null && String(mp.membership_activated_at).trim().length > 0;
    if (!isActivated) continue;

    const mpNormPhone = normalizePhoneSafe(mp.phone);
    if (!mpNormPhone) continue;

    for (const c of candidateRows) {
      const candidateNormPhone = candidatePhoneMap.get(c.id);
      if (candidateNormPhone && candidateNormPhone === mpNormPhone) {
        if (!activatedMpMap.has(mp.id)) activatedMpMap.set(mp.id, new Set());
        activatedMpMap.get(mp.id).add(c.id);
      }
    }
  }

  let derivedMembershipStatus = 'membership_none';
  const activatedMpCount = activatedMpMap.size;

  if (activatedMpCount === 0) {
    derivedMembershipStatus = 'membership_none';
  } else {

    const candidateIdsWithActivatedMp = new Set();
    let hasSharedPhoneMatchingMultipleCandidates = false;

    for (const [mpId, matchedCandidates] of activatedMpMap.entries()) {
      if (matchedCandidates.size > 1) {
        hasSharedPhoneMatchingMultipleCandidates = true;
      }
      for (const candId of matchedCandidates) {
        candidateIdsWithActivatedMp.add(candId);
      }
    }

    if (activatedMpCount > 1 && candidateIdsWithActivatedMp.size > 1) {
      derivedMembershipStatus = 'membership_multiple_candidates';
      conflictFlags.push('multiple_active_member_profiles');
    } else if (hasSharedPhoneMatchingMultipleCandidates) {
      derivedMembershipStatus = 'membership_unresolved';
    } else if (candidateIdsWithActivatedMp.size === 1) {
      derivedMembershipStatus = 'membership_unique_candidate';
    } else {
      derivedMembershipStatus = 'membership_unresolved';
    }
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
      membershipStatus: derivedMembershipStatus,
      conflictFlags,
    });
  }

  // RULE 2: Multiple Active Member Profiles -> MANUAL REVIEW
  if (derivedMembershipStatus === 'membership_multiple_candidates') {
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
      membershipStatus: derivedMembershipStatus,
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
      membershipStatus: derivedMembershipStatus,
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
      membershipStatus: derivedMembershipStatus,
      conflictFlags,
    });
  }

  // RULE 5: Competing Trusted Web Schedule Ownership -> MANUAL REVIEW
  if (candidatesWithWebSchedule.length > 1 && candidatesWithTx.length === 0 && candidatesWithBooking.length === 0) {
    conflictFlags.push('competing_trusted_web_schedule_ownership');
    return buildResult({
      mokaId: cleanMokaId,
      classification: CLASSIFICATION.MANUAL_REVIEW,
      reasonCode: 'competing_trusted_web_schedule_ownership',
      candidateRows,
      canonicalId: null,
      transactionRows,
      bookingRows,
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      membershipStatus: derivedMembershipStatus,
      conflictFlags,
    });
  }

  // RULE 6: Unique Verified Transaction Owner (same phone or no phone conflict)
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
      membershipStatus: derivedMembershipStatus,
      conflictFlags,
    });
  }

  // RULE 7: Unique Booking Owner (bookings table)
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
      membershipStatus: derivedMembershipStatus,
      conflictFlags,
    });
  }

  // RULE 8: Same Phone across all candidates + Single Active Member / Single Web Schedule / Zero Evidence
  if (sameNormalizedPhoneAcrossAllCandidates && candidatesWithTx.length === 0 && candidatesWithBooking.length === 0) {
    let canonicalId = null;
    if (derivedMembershipStatus === 'membership_unique_candidate') {
      for (const [mpId, cSet] of activatedMpMap.entries()) {
        if (cSet.size === 1) canonicalId = Array.from(cSet)[0];
      }
    } else if (candidatesWithWebSchedule.length === 1) {
      canonicalId = candidatesWithWebSchedule[0];
    } else {
      // Stable lexicographical tie-break ONLY when same normalized phone and zero business conflict
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
      scheduleRows,
      memberEvidenceRows,
      otherReferenceRows,
      membershipStatus: derivedMembershipStatus,
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
    membershipStatus: derivedMembershipStatus,
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
  membershipStatus,
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
    membership_status: membershipStatus,
    conflict_flags: Array.from(new Set(conflictFlags)),
  });
}

module.exports = {
  CLASSIFICATION,
  planMokaCustomerGroupReconciliation,
};
