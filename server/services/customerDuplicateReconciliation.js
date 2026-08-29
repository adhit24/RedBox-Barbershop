'use strict';

/**
 * Task 17.1 — CRM Integrity Round 2: Customer Duplicate Reconciliation Engine
 * Correction Round 1
 *
 * READ-ONLY / PURE reconciliation planner.
 * Calculates deterministic canonical customer selection, field reconciliation plans,
 * reference movement plans, and classification risk levels for duplicate phone groups.
 *
 * DO NOT MUTATE DATABASE. Pure calculation engine only.
 */

const { normalizeMemberPhone } = require('../member-identity');

/**
 * Deterministic formatting for name normalization:
 * Trim, lowercase, collapse internal whitespace.
 * NO fuzzy, Levenshtein, substring, or token-similarity matching permitted.
 */
function normalizeName(val) {
  if (typeof val !== 'string') return '';
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Strict conservative name conflict detector.
 * Distinct normalized non-empty names <= 1 -> false (no conflict).
 * Distinct normalized non-empty names > 1 -> true (conflict -> manual_review).
 */
function areNamesInConflict(names = []) {
  const normalizedSet = new Set(names.map(normalizeName).filter(Boolean));
  return normalizedSet.size > 1;
}

/**
 * Transaction eligibility check for revenue / spend calculation.
 * Only completed or paid status transactions with total_amount > 0 are countable.
 * Cancelled, refunded, void, failed, pending, reserved, or null statuses are excluded.
 */
function isTransactionCountableForSpend(tx) {
  if (!tx || typeof tx !== 'object') return false;
  const st = String(tx.status || '').trim().toLowerCase();
  const amt = Number(tx.total_amount || tx.amount || 0);
  if (amt <= 0) return false;
  return st === 'completed' || st === 'paid';
}

/**
 * Transaction eligibility check for visit count calculation.
 * Only completed or paid status transactions are countable.
 * Cancelled, refunded, void, failed, pending, reserved, or null statuses are excluded.
 */
function isTransactionCountableForVisit(tx) {
  if (!tx || typeof tx !== 'object') return false;
  const st = String(tx.status || '').trim().toLowerCase();
  return st === 'completed' || st === 'paid';
}

/**
 * Plans reconciliation for a single duplicate customer phone group.
 * @param {object} group - { phone, rows: [], memberProfiles: [], transactions: [], bookings: [] }
 * @param {object} [options]
 * @returns {object} Reconciliation plan
 */
function planDuplicateReconciliation(group = {}, options = {}) {
  const phoneInput = group.phone || (group.rows && group.rows[0] && (group.rows[0].wa || group.rows[0].phone_e164));
  const canonicalPhone = phoneInput ? normalizeMemberPhone(phoneInput) : null;

  const rows = Array.isArray(group.rows) ? group.rows : [];
  const profiles = Array.isArray(group.memberProfiles) ? group.memberProfiles : [];
  const transactions = Array.isArray(group.transactions) ? group.transactions : [];
  const bookings = Array.isArray(group.bookings) ? group.bookings : [];

  const reasons = [];
  const conflicts = [];

  // --- Category D: invalid_identity ---
  if (!canonicalPhone || canonicalPhone.length < 9) {
    reasons.push('invalid_phone_format');
    return {
      group_status: 'invalid_identity',
      canonical_customer_id: null,
      alias_customer_ids: rows.map(r => r.id).filter(Boolean),
      reasons,
      conflicts: ['invalid_phone_format'],
      field_plan: {},
      reference_plan: {
        transactions: { action: 'none', from_ids: [], to_id: null, count: 0 },
        bookings: { action: 'none', from_ids: [], to_id: null, count: 0 },
      },
      risk_level: 'HIGH',
    };
  }

  // Generic / shared business numbers
  const sharedHotlines = new Set(['62800000000', '62811111111', '628123456789']);
  if (sharedHotlines.has(canonicalPhone)) {
    reasons.push('shared_hotline_number');
    return {
      group_status: 'invalid_identity',
      canonical_customer_id: null,
      alias_customer_ids: rows.map(r => r.id).filter(Boolean),
      reasons,
      conflicts: ['shared_hotline_number'],
      field_plan: {},
      reference_plan: {
        transactions: { action: 'none', from_ids: [], to_id: null, count: 0 },
        bookings: { action: 'none', from_ids: [], to_id: null, count: 0 },
      },
      risk_level: 'HIGH',
    };
  }

  if (rows.length === 0) {
    return {
      group_status: 'unresolved',
      canonical_customer_id: null,
      alias_customer_ids: [],
      reasons: ['no_customer_rows_provided'],
      conflicts: [],
      field_plan: {},
      reference_plan: {
        transactions: { action: 'none', from_ids: [], to_id: null, count: 0 },
        bookings: { action: 'none', from_ids: [], to_id: null, count: 0 },
      },
      risk_level: 'HIGH',
    };
  }

  const allCustIds = Array.from(new Set(rows.map(r => r.id).filter(Boolean)));

  // --- Category C checks: Manual Review Triggers ---

  // 1. Multiple distinct Moka customer IDs
  const mokaIds = Array.from(new Set(rows.map(r => r.moka_customer_id).filter(Boolean)));
  if (mokaIds.length > 1) {
    conflicts.push('multiple_distinct_moka_customer_ids');
    reasons.push('conflicting_moka_customer_ids');
  }

  // 2. Conflicting customer names (strict conservative check)
  const names = rows.map(r => r.name).filter(Boolean);
  if (areNamesInConflict(names)) {
    conflicts.push('conflicting_customer_names');
    reasons.push('conflicting_customer_names');
  }

  // 3. Multiple active memberships ONLY from authoritative member_profiles (Task 14.1 authority)
  // customers.membership_status is NOT authority and does NOT trigger membership conflict
  const activeProfiles = profiles.filter(p => String(p.membership_status || '').toUpperCase() === 'ACTIVE');
  if (activeProfiles.length > 1) {
    conflicts.push('multiple_authoritative_memberships');
    reasons.push('multiple_authoritative_memberships');
  }

  if (conflicts.length > 0) {
    return {
      group_status: 'manual_review',
      canonical_customer_id: null,
      alias_customer_ids: allCustIds,
      reasons,
      conflicts,
      field_plan: {},
      reference_plan: {
        transactions: { action: 'manual_review', from_ids: allCustIds, to_id: null, count: transactions.length },
        bookings: { action: 'manual_review', from_ids: allCustIds, to_id: null, count: bookings.length },
      },
      risk_level: 'HIGH',
    };
  }

  // --- Canonical Row Selection Policy ---
  // Priority 1: Row with valid unique moka_customer_id
  let canonicalRow = rows.find(r => r.moka_customer_id && mokaIds.includes(r.moka_customer_id));

  // Priority 2: Rank candidate rows by transaction evidence -> spend -> stored spend -> ID tie-breaker
  // Note: customers.membership_status is NOT used for canonical selection
  if (!canonicalRow) {
    const txCountByCustId = new Map();
    const txSumByCustId = new Map();
    for (const t of transactions) {
      if (t.customer_id && isTransactionCountableForVisit(t)) {
        txCountByCustId.set(t.customer_id, (txCountByCustId.get(t.customer_id) || 0) + 1);
      }
      if (t.customer_id && isTransactionCountableForSpend(t)) {
        txSumByCustId.set(t.customer_id, (txSumByCustId.get(t.customer_id) || 0) + (Number(t.total_amount) || 0));
      }
    }

    const sortedCandidates = [...rows].sort((a, b) => {
      const countA = txCountByCustId.get(a.id) || 0;
      const countB = txCountByCustId.get(b.id) || 0;
      if (countA !== countB) return countB - countA;

      const sumA = txSumByCustId.get(a.id) || 0;
      const sumB = txSumByCustId.get(b.id) || 0;
      if (sumA !== sumB) return sumB - sumA;

      const spendA = Number(a.total_spent) || 0;
      const spendB = Number(b.total_spent) || 0;
      if (spendA !== spendB) return spendB - spendA;

      return String(a.id).localeCompare(String(b.id));
    });

    canonicalRow = sortedCandidates[0];
  }

  const canonicalId = canonicalRow.id;
  const aliasIds = allCustIds.filter(id => id !== canonicalId);

  // --- Field Reconciliation Planning ---

  // Name: non-empty name from canonical or first non-empty
  const primaryName = canonicalRow.name || names[0] || null;
  const namePlan = {
    value: primaryName,
    strategy: canonicalRow.name ? 'canonical_primary' : 'first_non_empty',
    source_row_id: canonicalRow.name ? canonicalRow.id : (rows.find(r => r.name)?.id || null),
  };

  // Moka ID: preserve unique non-null moka_customer_id
  const targetMokaId = mokaIds[0] || null;
  const mokaPlan = {
    value: targetMokaId,
    strategy: targetMokaId ? 'preserve_unique_moka_id' : 'none',
    source_row_id: targetMokaId ? (rows.find(r => r.moka_customer_id === targetMokaId)?.id || null) : null,
  };

  // Source: canonical source or moka > web > admin
  const sources = Array.from(new Set(rows.map(r => r.source).filter(Boolean)));
  const primarySource = sources.includes('moka') ? 'moka' : (sources[0] || 'web');
  const sourcePlan = {
    value: primarySource,
    strategy: 'preserve_authoritative_provenance',
    sources_in_group: sources,
  };

  // Financial & Visit Aggregates using strict status eligibility helpers:
  const eligibleSpendTxs = transactions.filter(isTransactionCountableForSpend);
  const txSum = eligibleSpendTxs.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0);
  const hasTxRecords = transactions.length > 0;
  const storedSpendMax = Math.max(0, ...rows.map(r => Number(r.total_spent) || 0));
  const finalTotalSpent = eligibleSpendTxs.length > 0 ? txSum : storedSpendMax;
  const spendPlan = {
    value: finalTotalSpent,
    strategy: eligibleSpendTxs.length > 0 ? 'recomputed_from_eligible_transactions' : 'max_stored_snapshot',
    breakdown: {
      eligible_transaction_sum: txSum,
      stored_rows_max: storedSpendMax,
    },
  };

  // Visits: recompute from eligible transactions if available, else max stored
  const eligibleVisitTxs = transactions.filter(isTransactionCountableForVisit);
  const storedVisitsMax = Math.max(0, ...rows.map(r => Number(r.visits) || 0));
  const storedVisitsSum = rows.reduce((sum, r) => sum + (Number(r.visits) || 0), 0);
  const visitsPlan = {
    value: eligibleVisitTxs.length > 0 ? eligibleVisitTxs.length : storedVisitsMax,
    strategy: eligibleVisitTxs.length > 0 ? 'recomputed_from_eligible_transactions' : 'max_stored_snapshot',
    breakdown: {
      eligible_transaction_count: eligibleVisitTxs.length,
      stored_visits_max: storedVisitsMax,
      stored_visits_sum: storedVisitsSum,
    },
  };

  // Points: anchor to member_profiles.total_points if present, else max stored points
  const profilePoints = activeProfiles[0] ? (Number(activeProfiles[0].total_points) || 0) : (profiles[0] ? (Number(profiles[0].total_points) || 0) : null);
  const storedPointsMax = Math.max(0, ...rows.map(r => Number(r.points) || 0));
  const finalPoints = profilePoints !== null ? profilePoints : storedPointsMax;
  const pointsPlan = {
    value: finalPoints,
    strategy: profilePoints !== null ? 'anchored_to_member_profile' : 'max_stored_points',
    breakdown: {
      profile_points: profilePoints,
      stored_points_max: storedPointsMax,
    },
  };

  // Dates: first_visit = earliest, last_visit = latest
  const allFirstVisits = rows.map(r => r.first_visit).filter(Boolean).sort();
  const allLastVisits = rows.map(r => r.last_visit).filter(Boolean).sort();
  const firstVisitPlan = { value: allFirstVisits[0] || null };
  const lastVisitPlan = { value: allLastVisits.at(-1) || null };

  // Membership status: member_profiles authority ONLY (Task 14.1 authority).
  // customers.membership_status is NOT authority and is NOT synthesized as INACTIVE if missing.
  let membershipPlan;
  if (activeProfiles.length > 0) {
    membershipPlan = {
      value: 'ACTIVE',
      strategy: 'member_profile_authority',
    };
  } else if (profiles.length > 0 && profiles[0].membership_status) {
    membershipPlan = {
      value: String(profiles[0].membership_status).toUpperCase(),
      strategy: 'member_profile_authority',
    };
  } else {
    membershipPlan = {
      value: null,
      strategy: 'no_authoritative_membership_fact',
    };
  }

  // Fav barber
  const favBarbers = rows.map(r => r.fav_barber).filter(Boolean);
  const favBarberPlan = {
    value: favBarbers[0] || null,
    strategy: favBarbers[0] ? 'first_non_empty_preference' : 'none',
  };

  // Determine group status (Category A vs Category B)
  const isHistorySplit = (
    (storedSpendMax > 0 && rows.filter(r => (Number(r.total_spent) || 0) > 0).length > 1) ||
    (storedVisitsMax > 0 && rows.filter(r => (Number(r.visits) || 0) > 0).length > 1) ||
    (storedPointsMax > 0 && rows.filter(r => (Number(r.points) || 0) > 0).length > 1) ||
    (hasTxRecords && aliasIds.some(id => transactions.some(t => t.customer_id === id)))
  );

  const groupStatus = isHistorySplit ? 'deterministic_reconciliation' : 'safe_auto_merge';
  const riskLevel = isHistorySplit ? 'MEDIUM' : 'LOW';

  if (isHistorySplit) {
    reasons.push('customer_history_or_aggregates_split_across_duplicate_rows');
  } else {
    reasons.push('clean_duplicate_group_safe_for_auto_merge');
  }

  // Reference movement plan
  const txToMove = transactions.filter(t => aliasIds.includes(t.customer_id));
  const bkToMove = bookings.filter(b => aliasIds.includes(b.customer_id));

  return {
    group_status: groupStatus,
    canonical_customer_id: canonicalId,
    alias_customer_ids: aliasIds,
    reasons,
    conflicts: [],
    field_plan: {
      name: namePlan,
      moka_customer_id: mokaPlan,
      wa: { value: canonicalPhone },
      phone_e164: { value: `+${canonicalPhone}` },
      source: sourcePlan,
      points: pointsPlan,
      visits: visitsPlan,
      total_spent: spendPlan,
      first_visit: firstVisitPlan,
      last_visit: lastVisitPlan,
      membership_status: membershipPlan,
      fav_barber: favBarberPlan,
    },
    reference_plan: {
      transactions: {
        action: txToMove.length > 0 ? 'move_references' : 'none',
        from_ids: aliasIds.filter(id => transactions.some(t => t.customer_id === id)),
        to_id: canonicalId,
        count: txToMove.length,
      },
      bookings: {
        action: bkToMove.length > 0 ? 'move_references' : 'none',
        from_ids: aliasIds.filter(id => bookings.some(b => b.customer_id === id)),
        to_id: canonicalId,
        count: bkToMove.length,
      },
    },
    risk_level: riskLevel,
  };
}

module.exports = {
  planDuplicateReconciliation,
  normalizeName,
  areNamesInConflict,
  isTransactionCountableForSpend,
  isTransactionCountableForVisit,
};
