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
        error: identity.error || 'database_unavailable',
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

  // Step 2: Query production tables in parallel (member_profiles, customers, transactions, bookings)
  const bookingsOr = `customer_id.eq.${customerId}${canonicalPhone ? `,wa.eq.${canonicalPhone}` : ''}`;
  const profileOr = `id.eq.${customerId}${canonicalPhone ? `,phone.eq.${canonicalPhone},phone.eq.+${canonicalPhone}` : ''}`;
  const customerOr = `id.eq.${customerId}${canonicalPhone ? `,wa.eq.${canonicalPhone},phone_e164.eq.${canonicalPhone},phone_e164.eq.+${canonicalPhone}` : ''}`;

  const [txRes, bookingsRes, profRes, custRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('*, transaction_items(*)')
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false }),

    supabase
      .from('bookings')
      .select('*')
      .or(bookingsOr)
      .order('date', { ascending: false }),

    supabase
      .from('member_profiles')
      .select('*')
      .or(profileOr),

    supabase
      .from('customers')
      .select('*')
      .or(customerOr),
  ]);

  if (txRes.error || bookingsRes.error || profRes.error || custRes.error) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: customerId,
        resolution: 'db_error',
        error: txRes.error?.message || bookingsRes.error?.message || profRes.error?.message || custRes.error?.message || 'database_query_error',
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

  const profileRows = Array.isArray(profRes.data) ? profRes.data : [];
  const customerRows = Array.isArray(custRes.data) ? custRes.data : [];

  const profileRow = identity.member_profile_row || profileRows[0] || {};
  const custRow = identity.customer_row || customerRows[0] || {};

  // Step 3: Loyalty Section & Production Points Alignment
  let totalPoints = null;
  let loyaltyStatus = 'available';
  let lastActivity = profileRow.updated_at || custRow.updated_at || null;

  // Primary Points Source: member_profiles.total_points
  const profilePointsList = profileRows
    .map(p => p.total_points)
    .filter(pts => typeof pts === 'number' && pts >= 0);

  // Secondary Points Source: customers.points
  const customerPointsList = customerRows
    .map(c => c.points)
    .filter(pts => typeof pts === 'number' && pts >= 0);

  if (profilePointsList.length > 0) {
    const distinctProfilePoints = new Set(profilePointsList);
    if (distinctProfilePoints.size > 1) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    } else {
      totalPoints = profilePointsList[0];
    }
  } else if (customerPointsList.length > 0) {
    const distinctCustPoints = new Set(customerPointsList);
    if (distinctCustPoints.size > 1) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    } else {
      totalPoints = customerPointsList[0];
    }
  } else {
    // If no points row contains a points number, default to 0 for found customers
    totalPoints = 0;
  }

  // Cross-source conflict check: if both profile and customer rows specify different non-empty points balances
  if (profilePointsList.length > 0 && customerPointsList.length > 0) {
    const pPoints = profilePointsList[0];
    const cPoints = customerPointsList[0];
    if (pPoints !== cPoints) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    }
  }

  const loyaltyObj = loyaltyStatus === 'ambiguous_balance_conflict'
    ? { points_balance: null, last_activity: null, status: 'ambiguous_balance_conflict' }
    : { points_balance: totalPoints, last_activity: lastActivity, status: loyaltyStatus };

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
    ...transactions.map(t => t.created_at),
    ...doneBookings.map(b => b.date || b.created_at),
  ].filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d.getTime())).sort((a, b) => a - b);

  const firstVisitDate = visitDates.length > 0 ? formatDateStr(visitDates[0]) : null;
  const lastVisitDate = visitDates.length > 0 ? formatDateStr(visitDates[visitDates.length - 1]) : null;

  const activityObj = {
    completed_visits_count: doneBookings.length,
    cancelled_visits_count: cancelledBookings.length,
    upcoming_visits_count: pendingBookings.length,
    first_visit_date: firstVisitDate,
    last_visit_date: lastVisitDate,
  };

  // --- Preferences Section ---
  const kapsters = [];
  const services = [];
  const outlets = [];
  const recentOrder = [];

  for (const b of bookings) {
    if (b.barber_name) { kapsters.push(b.barber_name); recentOrder.push(b.barber_name); }
    if (b.service_name) { services.push(b.service_name); recentOrder.push(b.service_name); }
    if (b.outlet_name || b.branch) {
      const oName = b.outlet_name || b.branch;
      outlets.push(oName);
      recentOrder.push(oName);
    }
  }

  for (const tx of transactions) {
    if (tx.outlet_name) { outlets.push(tx.outlet_name); recentOrder.push(tx.outlet_name); }
    if (Array.isArray(tx.transaction_items)) {
      for (const item of tx.transaction_items) {
        if (item.item_name) { services.push(item.item_name); recentOrder.push(item.item_name); }
      }
    }
  }

  const preferencesObj = {
    favorite_kapster: calculateMode(kapsters, recentOrder),
    favorite_service: calculateMode(services, recentOrder),
    favorite_outlet: calculateMode(outlets, recentOrder),
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
      customer_resolution: identity.resolution,
      transaction_data: completedTxCount > 0 ? 'available' : 'no_transactions',
      visit_metric: doneBookings.length > 0 ? 'available' : 'no_visits',
    },
  };
}

module.exports = {
  getCustomer360,
};
