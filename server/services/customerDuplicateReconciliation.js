'use strict';

/**
 * Task 17.1 — CRM Integrity Round 2: Customer Duplicate Reconciliation Engine
 *
 * READ-ONLY / PURE reconciliation planner.
 * Calculates deterministic canonical customer selection, field reconciliation plans,
 * reference movement plans, and classification risk levels for duplicate phone groups.
 *
 * DO NOT MUTATE DATABASE. Pure calculation engine only.
 */

const { normalizeMemberPhone } = require('../member-identity');

/**
 * Normalizes name for comparison (lowercased, trimmed, extra whitespace collapsed)
 */
function cleanName(val) {
  if (typeof val !== 'string') return '';
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Checks if two non-empty names are in conflict (e.g. "Budi Santoso" vs "Siti Rahma")
 */
function areNamesInConflict(names = []) {
  const cleaned = Array.from(new Set(names.map(cleanName).filter(Boolean)));
  if (cleaned.length <= 1) return false;

  // Compare first words / major tokens
  const firstTokens = new Set(cleaned.map(n => n.split(' ')[0]));
  if (firstTokens.size > 1) return true;

  // If first token is identical (e.g. "Adhit Nugraha" vs "Adhitya Nugraha"), checkLevenshtein or token overlap
  // For safety: if string representations differ significantly (>2 edit distance for short strings), flag conflict
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = i + 1; j < cleaned.length; j++) {
      const a = cleaned[i];
      const b = cleaned[j];
      if (a !== b) {
        // If neither is substring of another and length difference > 3
        if (!a.includes(b) && !b.includes(a) && Math.abs(a.length - b.length) > 3) {
          return true;
        }
      }
    }
  }
  return false;
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
      conflicts: ['malformed_or_short_phone_number'],
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
      conflicts: ['shared_generic_hotline_number'],
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
  const mokaIds = Array.from(new Set(rows.map(r => r.moka_customer_id).filter(Boolean)));
  if (mokaIds.length > 1) {
    conflicts.push('multiple_distinct_moka_customer_ids');
    reasons.push(`conflicting_moka_ids: ${mokaIds.join(', ')}`);
  }

  const names = rows.map(r => r.name).filter(Boolean);
  if (areNamesInConflict(names)) {
    conflicts.push('conflicting_customer_names');
    reasons.push(`conflicting_names: ${Array.from(new Set(names)).join(' vs ')}`);
  }

  const activeCustomerMemberships = rows.filter(r => String(r.membership_status).toUpperCase() === 'ACTIVE');
  const activeProfileMemberships = profiles.filter(p => String(p.membership_status).toUpperCase() === 'ACTIVE');
  if (activeCustomerMemberships.length > 1 || activeProfileMemberships.length > 1) {
    conflicts.push('multiple_active_memberships');
    reasons.push('multiple_active_memberships_detected');
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

  // Priority 2: Rank remaining candidate rows by transaction count -> tx spend sum -> stored total_spent -> ID tie-breaker
  if (!canonicalRow) {
    const txCountByCustId = new Map();
    const txSumByCustId = new Map();
    for (const t of transactions) {
      if (t.customer_id) {
        txCountByCustId.set(t.customer_id, (txCountByCustId.get(t.customer_id) || 0) + 1);
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

      const isMemberA = String(a.membership_status).toUpperCase() === 'ACTIVE' ? 1 : 0;
      const isMemberB = String(b.membership_status).toUpperCase() === 'ACTIVE' ? 1 : 0;
      if (isMemberA !== isMemberB) return isMemberB - isMemberA;

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

  // Financial & Visit Aggregates:
  // Recompute total_spent & transaction count from linked transactions if transactions exist
  const txSum = transactions.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0);
  const hasTxRecords = transactions.length > 0;
  const storedSpendMax = Math.max(0, ...rows.map(r => Number(r.total_spent) || 0));
  const finalTotalSpent = hasTxRecords ? txSum : storedSpendMax;
  const spendPlan = {
    value: finalTotalSpent,
    strategy: hasTxRecords ? 'recomputed_from_transactions' : 'max_stored_snapshot',
    breakdown: {
      transaction_recomputed_sum: txSum,
      stored_rows_max: storedSpendMax,
    },
  };

  // Visits: recompute from completed transactions / bookings if available, else sum/max
  const txCount = transactions.filter(t => t.status === 'completed' || !t.status).length;
  const storedVisitsMax = Math.max(0, ...rows.map(r => Number(r.visits) || 0));
  const storedVisitsSum = rows.reduce((sum, r) => sum + (Number(r.visits) || 0), 0);
  const visitsPlan = {
    value: txCount > 0 ? txCount : storedVisitsMax,
    strategy: txCount > 0 ? 'recomputed_from_transactions' : 'max_stored_snapshot',
    breakdown: {
      transaction_count: txCount,
      stored_visits_max: storedVisitsMax,
      stored_visits_sum: storedVisitsSum,
    },
  };

  // Points: anchor to member_profiles.total_points if present, else max stored points
  const profilePoints = profiles[0] ? (Number(profiles[0].total_points) || 0) : null;
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

  // Membership status: member_profiles authority if profile exists, else canonical status
  const profileMembership = profiles[0]?.membership_status || null;
  const canonicalMembership = canonicalRow.membership_status || null;
  const membershipPlan = {
    value: profileMembership || canonicalMembership || 'INACTIVE',
    strategy: profileMembership ? 'member_profile_authority' : 'canonical_customer_row',
  };

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
  cleanName,
  areNamesInConflict,
};
