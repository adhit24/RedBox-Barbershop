'use strict';

/**
 * Redbox Customer 360 Read Service
 * 0-LLM, pure deterministic read layer querying Supabase database tables.
 */

const { resolveCustomerIdentity } = require('./customerIdentity');
const { resolveMembershipTier, isActiveMembership } = require('../membership-policy');

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

  // Tie breaker: pick the candidate that appears earliest in recentOrder (most recent)
  for (const recentItem of recentOrder) {
    if (candidates.includes(recentItem)) {
      return recentItem;
    }
  }

  // Fallback: alphabetical sort
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

  if (!identity.found || !identity.customer_id) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: null,
        resolution: identity.resolution || 'not_found',
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
  const canonicalPhone = identity.canonical_phone;
  const custRow = identity.customer_row || {};
  const profileRow = identity.member_profile_row || {};

  // Step 2: Fetch related database entities in parallel
  const [pointsRes, txRes, bookingsRes] = await Promise.all([
    // Loyalty Points Balance
    supabase
      .from('member_points_balance')
      .select('*')
      .or(`customer_id.eq.${customerId}${canonicalPhone ? `,customer_wa.eq.${canonicalPhone}` : ''}`)
      .maybeSingle(),

    // Completed Transactions
    supabase
      .from('transactions')
      .select('*, transaction_items(*)')
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false }),

    // Bookings
    supabase
      .from('bookings')
      .select('*')
      .or(`customer_id.eq.${customerId}${canonicalPhone ? `,wa.eq.${canonicalPhone}` : ''}`)
      .order('date', { ascending: false }),
  ]);

  const pointsData = pointsRes.data || null;
  const transactions = Array.isArray(txRes.data) ? txRes.data : [];
  const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

  // --- Profile Section ---
  const customerName = profileRow.full_name || custRow.name || null;
  const customerObj = {
    customer_id: customerId,
    name: customerName,
    wa_number: canonicalPhone || null,
    phone_e164: identity.phone_e164 || (canonicalPhone ? `+${canonicalPhone}` : null),
    birthday: formatDateStr(profileRow.birthday || custRow.birthday || custRow.birth_date),
    registration_status: profileRow.id ? 'registered_member' : 'guest_customer',
    created_at: custRow.created_at || profileRow.created_at || null,
  };

  // --- Membership Section ---
  const rawTier = profileRow.tier || profileRow.current_tier || custRow.membership_tier;
  const tier = resolveMembershipTier(rawTier);
  const tierOrigin = (rawTier && String(rawTier).trim()) ? 'configured' : 'default_baseline';

  const rawStatus = profileRow.membership_status || custRow.membership_status || 'INACTIVE';
  const isActive = isActiveMembership({
    status: rawStatus,
    startsAt: profileRow.membership_activated_at || custRow.membership_activated_at,
    expiresAt: profileRow.membership_expires_at,
  });

  const membershipObj = {
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    tier: tier,
    tier_origin: tierOrigin,
    activated_at: profileRow.membership_activated_at || custRow.membership_activated_at || null,
    expires_at: profileRow.membership_expires_at || null,
  };

  // --- Loyalty Section ---
  // Exposes ONLY factual loyalty units (points_balance). No IDR monetary conversions.
  const totalPoints = typeof pointsData?.total_points === 'number' ? pointsData.total_points : 0;

  const loyaltyObj = {
    points_balance: totalPoints,
    last_activity: pointsData?.last_activity || null,
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

  // Determine first & last visit dates across completed bookings and transactions
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
  formatDateStr,
  calculateMode,
};
