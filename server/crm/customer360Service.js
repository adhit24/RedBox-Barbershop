'use strict';

/**
 * Redbox Customer 360 Read Service
 * 0-LLM, pure deterministic read layer querying Supabase database tables.
 */

const { resolveCustomerIdentity } = require('./customerIdentity');
const { resolveMembershipTier, isActiveMembership } = require('../membership-policy');
const { normalizeMemberPhone, getMemberPhoneVariants } = require('../member-identity');

/**
 * Dedicated CRM points read helper for trusted phone identity (CUSTOMER_SELF).
 * Solves duplicate legacy customer rows by anchoring points to unique member_profiles row.
 * @param {object} supabase - Supabase client
 * @param {string} targetPhone - Raw or canonical phone number
 * @returns {Promise<object>} Points resolution result
 */
async function getCustomerPointsByTrustedPhone(supabase, targetPhone) {
  if (!targetPhone || typeof targetPhone !== 'string' || !targetPhone.trim()) {
    return { found: false, resolution: 'missing_input' };
  }

  const canonical = normalizeMemberPhone(targetPhone);
  if (!canonical || canonical.length < 9) {
    return { found: false, resolution: 'invalid_phone_format' };
  }

  const variants = getMemberPhoneVariants(canonical);
  const profileConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `phone.eq.${digits},phone.eq.+${digits}`;
  }).join(',');

  const customerConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `wa.eq.${digits},phone_e164.eq.${digits},phone_e164.eq.+${digits}`;
  }).join(',');

  const [profRes, custRes] = await Promise.all([
    supabase.from('member_profiles').select('*').or(profileConditions),
    supabase.from('customers').select('*').or(customerConditions),
  ]);

  if (profRes.error || custRes.error) {
    return {
      found: false,
      resolution: 'db_error',
      error: profRes.error?.message || custRes.error?.message || 'database_error',
    };
  }

  const profileRows = Array.isArray(profRes.data) ? profRes.data : [];
  const customerRows = Array.isArray(custRes.data) ? custRes.data : [];

  // Multiple member_profile records for the same phone MUST fail closed as ambiguous
  if (profileRows.length > 1) {
    return {
      found: false,
      resolution: 'ambiguous',
      reason: 'multiple_member_profile_records',
    };
  }

  const uniqueProfile = profileRows[0] || null;

  if (!uniqueProfile && customerRows.length > 1) {
    const distinctCustIds = new Set(customerRows.map(c => c.id).filter(Boolean));
    if (distinctCustIds.size > 1) {
      const distinctNames = new Set(customerRows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
      if (distinctNames.size > 1) {
        return { found: false, resolution: 'ambiguous', reason: 'conflicting_customer_names' };
      }
    }
  }

  let profilePoints = null;
  if (uniqueProfile && typeof uniqueProfile.total_points === 'number' && uniqueProfile.total_points >= 0) {
    profilePoints = uniqueProfile.total_points;
  }

  const customerPointsList = customerRows
    .map(c => c.points)
    .filter(pts => typeof pts === 'number' && pts >= 0);

  let finalPoints = null;
  let status = 'available';

  if (profilePoints !== null) {
    if (customerPointsList.length > 0) {
      const allMatch = customerPointsList.every(pts => pts === profilePoints);
      if (!allMatch) {
        status = 'ambiguous_balance_conflict';
        finalPoints = null;
      } else {
        finalPoints = profilePoints;
      }
    } else {
      finalPoints = profilePoints;
    }
  } else if (customerPointsList.length > 0) {
    const distinctCustPoints = new Set(customerPointsList);
    if (distinctCustPoints.size > 1) {
      status = 'ambiguous_balance_conflict';
      finalPoints = null;
    } else {
      finalPoints = customerPointsList[0];
    }
  } else if (uniqueProfile || customerRows.length > 0) {
    finalPoints = 0;
  } else {
    return { found: false, resolution: 'not_found' };
  }

  return {
    found: true,
    resolution: uniqueProfile ? 'member_profile_match' : 'customer_phone_match',
    points_balance: finalPoints,
    status: status,
  };
}

/**
 * Formats a Date object or string to YYYY-MM-DD
 */
function formatDateStr(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/**
 * Calculates frequency mode from an array of strings with deterministic tie-breaking.
 */
function calculateMode(items = [], recentOrder = []) {
  const filtered = items.filter(Boolean);
  if (filtered.length === 0) return null;

  const counts = new Map();
  for (const item of filtered) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  let maxCount = 0;
  let candidates = [];
  for (const [item, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      candidates = [item];
    } else if (count === maxCount) {
      candidates.push(item);
    }
  }

  if (candidates.length === 1) return candidates[0];

  for (const recentItem of recentOrder) {
    if (candidates.includes(recentItem)) {
      return recentItem;
    }
  }

  return candidates.sort()[0];
}

/**
 * Fetches Customer 360 facts.
 * @param {object} supabase - Supabase client instance
 * @param {object} identityInput - { phone, customer_id, user_key }
 * @returns {Promise<object>} Complete versioned Customer360 object
 */
async function getCustomer360(supabase, identityInput = {}) {
  // Step 1: Resolve identity
  const identity = await resolveCustomerIdentity(supabase, identityInput);

  if (identity.resolution === 'db_error') {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: null,
        resolution: 'db_error',
        error: identity.error || 'database_query_error',
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: 'db_error',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  if (identity.resolution === 'ambiguous' || !identity.found) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: null,
        resolution: identity.resolution || 'not_found',
        reason: identity.reason || null,
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: identity.resolution || 'not_found',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  const customerId = identity.customer_id;
  const aliasCustomerIds = Array.isArray(identity.alias_customer_ids) && identity.alias_customer_ids.length > 0
    ? identity.alias_customer_ids
    : (customerId ? [customerId] : []);
  const canonicalPhone = identity.canonical_phone;
  const phoneVariants = canonicalPhone ? getMemberPhoneVariants(canonicalPhone) : [];

  const profileOrConditions = phoneVariants.length > 0
    ? phoneVariants.map(v => {
        const digits = String(v).replace(/\D/g, '');
        return `phone.eq.${digits},phone.eq.+${digits}`;
      }).join(',')
    : (customerId ? `id.eq.${customerId}` : '');

  const customerOrConditions = [];
  if (aliasCustomerIds.length > 0) {
    customerOrConditions.push(...aliasCustomerIds.map(id => `id.eq.${id}`));
  }
  if (phoneVariants.length > 0) {
    customerOrConditions.push(...phoneVariants.map(v => {
      const digits = String(v).replace(/\D/g, '');
      return `wa.eq.${digits},phone_e164.eq.${digits},phone_e164.eq.+${digits}`;
    }));
  }

  const bookingOrConditions = [];
  if (aliasCustomerIds.length > 0) {
    bookingOrConditions.push(...aliasCustomerIds.map(id => `customer_id.eq.${id}`));
  }
  if (phoneVariants.length > 0) {
    bookingOrConditions.push(...phoneVariants.map(v => {
      const digits = String(v).replace(/\D/g, '');
      return `wa.eq.${digits},wa.eq.+${digits}`;
    }));
  }

  const profileQuery = profileOrConditions
    ? supabase.from('member_profiles').select('*').or(profileOrConditions)
    : Promise.resolve({ data: [] });

  const customerQuery = customerOrConditions.length > 0
    ? supabase.from('customers').select('*').or(customerOrConditions.join(','))
    : Promise.resolve({ data: [] });

  const txSelect = supabase.from('transactions').select('*, transaction_items(*)');
  const txQuery = aliasCustomerIds.length > 0
    ? (typeof txSelect.in === 'function'
        ? txSelect.in('customer_id', aliasCustomerIds).eq('status', 'completed').order('created_at', { ascending: false })
        : txSelect.eq('customer_id', customerId).eq('status', 'completed').order('created_at', { ascending: false }))
    : Promise.resolve({ data: [] });

  const bookingQuery = bookingOrConditions.length > 0
    ? supabase.from('bookings').select('*').or(bookingOrConditions.join(',')).order('date', { ascending: false })
    : Promise.resolve({ data: [] });

  const [profRes, custRes, txRes, bookingsRes] = await Promise.all([
    profileQuery,
    customerQuery,
    txQuery,
    bookingQuery,
  ]);

  if (profRes.error || custRes.error || txRes.error || bookingsRes.error) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: customerId,
        resolution: 'db_error',
        error: profRes.error?.message || custRes.error?.message || txRes.error?.message || bookingsRes.error?.message || 'database_query_error',
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: 'db_error',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  // --- Loyalty Section & Points Anchor ---
  const profileRows = Array.isArray(profRes.data) ? profRes.data : [];
  const customerRows = Array.isArray(custRes.data) ? custRes.data : [];
  const fetchedProfile = profileRows[0] || identity.member_profile_row || null;
  const custRow = customerRows[0] || identity.customer_row || {};

  let totalPoints = 0;
  let lastActivity = fetchedProfile?.updated_at || custRow.updated_at || null;
  let loyaltyStatus = 'available';

  if (fetchedProfile && typeof fetchedProfile.total_points === 'number' && fetchedProfile.total_points >= 0) {
    totalPoints = fetchedProfile.total_points;
    const custPointsList = customerRows.map(c => c.points).filter(p => typeof p === 'number' && p >= 0);
    if (custPointsList.length > 0 && !custPointsList.every(p => p === fetchedProfile.total_points)) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    }
  } else if (customerRows.length > 0) {
    const custPointsList = customerRows.map(c => c.points).filter(p => typeof p === 'number' && p >= 0);
    const distinctPts = new Set(custPointsList);
    if (distinctPts.size > 1) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    } else if (custPointsList.length > 0) {
      totalPoints = custPointsList[0];
    }
  }

  const loyaltyObj = loyaltyStatus === 'ambiguous_balance_conflict'
    ? { points_balance: null, last_activity: null, status: 'ambiguous_balance_conflict' }
    : { points_balance: totalPoints, last_activity: lastActivity };

  // --- Deduplicate Transactions & Bookings by Primary Key ---
  const rawTx = Array.isArray(txRes.data) ? txRes.data : [];
  const rawBookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

  const transactionsMap = new Map();
  for (const t of rawTx) {
    if (t && t.id && !transactionsMap.has(t.id)) transactionsMap.set(t.id, t);
  }
  const transactions = Array.from(transactionsMap.values());

  const bookingsMap = new Map();
  for (const b of rawBookings) {
    if (b && b.id && !bookingsMap.has(b.id)) bookingsMap.set(b.id, b);
  }
  const bookings = Array.from(bookingsMap.values());

  // --- Profile Section ---
  const customerName = fetchedProfile?.full_name || custRow.name || null;
  const customerObj = {
    customer_id: customerId,
    name: customerName,
    wa_number: canonicalPhone || null,
    phone_e164: identity.phone_e164 || (canonicalPhone ? `+${canonicalPhone}` : null),
    birthday: formatDateStr(fetchedProfile?.birthday || custRow.birthday || custRow.birth_date),
    registration_status: fetchedProfile?.id ? 'registered_member' : 'guest_customer',
    created_at: custRow.created_at || fetchedProfile?.created_at || null,
  };

  // --- Membership Section ---
  const rawTier = fetchedProfile?.tier || fetchedProfile?.current_tier || custRow.membership_tier;
  const tier = resolveMembershipTier(rawTier);
  const tierOrigin = (rawTier && String(rawTier).trim()) ? 'configured' : 'default_baseline';

  const rawStatus = fetchedProfile?.membership_status || custRow.membership_status || 'INACTIVE';
  const isActive = isActiveMembership({
    status: rawStatus,
    startsAt: fetchedProfile?.membership_activated_at || custRow.membership_activated_at,
    expiresAt: fetchedProfile?.membership_expires_at,
  });

  const membershipObj = {
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    tier: tier,
    tier_origin: tierOrigin,
    activated_at: fetchedProfile?.membership_activated_at || custRow.membership_activated_at || null,
    expires_at: fetchedProfile?.membership_expires_at || null,
  };

  // --- Transactions / Financial Section ---
  const completedTxCount = transactions.length;
  const totalSpendIdr = transactions.reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
  const avgTxValue = completedTxCount > 0 ? Math.round(totalSpendIdr / completedTxCount) : null;

  const spendingObj = {
    transaction_count: completedTxCount,
    total_spend_idr: totalSpendIdr,
    average_transaction_value_idr: avgTxValue,
  };

  // --- Activity / Visit Section ---
  const doneBookings = bookings.filter(b => b.status === 'done');
  const cancelledBookings = bookings.filter(b => b.status === 'cancelled');
  const pendingBookings = bookings.filter(b => ['pending', 'confirmed'].includes(b.status));

  const visitDates = [
    ...doneBookings.map(b => b.date),
    ...transactions.map(t => formatDateStr(t.created_at)),
  ].filter(Boolean).sort();

  const firstVisit = visitDates[0] || null;
  const lastVisit = visitDates.at(-1) || null;

  let daysSinceLastVisit = null;
  if (lastVisit) {
    const diffMs = Date.now() - new Date(lastVisit).getTime();
    daysSinceLastVisit = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  const activityObj = {
    first_visit: firstVisit,
    last_visit: lastVisit,
    days_since_last_visit: daysSinceLastVisit,
    completed_booking_count: doneBookings.length,
    cancelled_booking_count: cancelledBookings.length,
    pending_booking_count: pendingBookings.length,
    completed_transaction_count: completedTxCount,
    visit_metric_status: 'caveated',
    repeat_customer: (doneBookings.length + completedTxCount) > 1,
  };

  // --- Preferences Section ---
  const completedBranches = [
    ...doneBookings.map(b => b.location),
    ...transactions.map(t => t.outlet_slug || t.location),
  ];
  const recentBranchesOrder = completedBranches.slice().reverse();
  const favBranch = calculateMode(completedBranches, recentBranchesOrder);

  const completedBarbers = doneBookings.map(b => b.barber_id || b.barber_name);
  const recentBarbersOrder = completedBarbers.slice().reverse();
  const favBarber = calculateMode(completedBarbers, recentBarbersOrder);

  const completedServices = [
    ...doneBookings.map(b => b.service),
    ...transactions.flatMap(t => Array.isArray(t.transaction_items) ? t.transaction_items.map(i => i.service_name) : []),
  ];
  const recentServicesOrder = completedServices.slice().reverse();
  const favService = calculateMode(completedServices, recentServicesOrder);

  const preferencesObj = {
    favorite_branch: favBranch ? { value: favBranch, basis: 'event_frequency' } : null,
    favorite_barber: favBarber ? { value: favBarber, basis: 'event_frequency' } : null,
    favorite_service: favService ? { value: favService, basis: 'event_frequency' } : null,
  };

  return {
    version: 'customer360.v0.1',
    identity: {
      customer_found: true,
      customer_id: customerId,
      resolution: identity.resolution,
    },
    customer: customerObj,
    membership: membershipObj,
    loyalty: loyaltyObj,
    activity: activityObj,
    spending: spendingObj,
    preferences: preferencesObj,
    data_quality: {
      customer_resolution: 'resolved',
      transaction_data: 'available',
      visit_metric: 'caveated',
    },
  };
}

module.exports = {
  getCustomer360,
  getCustomerPointsByTrustedPhone,
  formatDateStr,
  calculateMode,
};
