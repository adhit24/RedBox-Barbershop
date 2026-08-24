'use strict';

/**
 * Redbox CRM Customer Privacy Projection Helper
 * Differentiates INTERNAL vs CUSTOMER_SELF projections.
 */

/**
 * Internal projection — complete view for internal services, CRM dashboard, and admins.
 * @param {object} customer360 - Full Customer360 object
 * @returns {object} Internal Customer360 view
 */
function projectInternal(customer360) {
  if (!customer360) return null;
  return JSON.parse(JSON.stringify(customer360));
}

/**
 * Customer Self projection — sanitized view safe for customer responses via Reddy AI.
 * Strips internal UUIDs, Moka IDs, total lifetime spend, admin notes, and complaint histories.
 * @param {object} customer360 - Full Customer360 object
 * @returns {object} Customer-safe Customer360 view
 */
function projectCustomerSelf(customer360) {
  if (!customer360) return null;

  const internal = JSON.parse(JSON.stringify(customer360));

  const safeCustomer = internal.customer ? {
    name: internal.customer.name || null,
    registration_status: internal.customer.registration_status || null,
    created_at: internal.customer.created_at || null,
  } : null;

  const safeMembership = internal.membership ? {
    status: internal.membership.status || 'INACTIVE',
    tier: internal.membership.tier || 'bronze',
    tier_origin: internal.membership.tier_origin || 'default_baseline',
    activated_at: internal.membership.activated_at || null,
    expires_at: internal.membership.expires_at || null,
  } : null;

  const safeLoyalty = internal.loyalty ? {
    points_balance: typeof internal.loyalty.points_balance === 'number' ? internal.loyalty.points_balance : null,
    last_activity: internal.loyalty.last_activity || null,
  } : null;

  const safeActivity = internal.activity ? {
    first_visit: internal.activity.first_visit || null,
    last_visit: internal.activity.last_visit || null,
    days_since_last_visit: typeof internal.activity.days_since_last_visit === 'number' ? internal.activity.days_since_last_visit : null,
    completed_booking_count: typeof internal.activity.completed_booking_count === 'number' ? internal.activity.completed_booking_count : null,
    completed_transaction_count: typeof internal.activity.completed_transaction_count === 'number' ? internal.activity.completed_transaction_count : null,
    visit_metric_status: internal.activity.visit_metric_status || 'caveated',
    repeat_customer: Boolean(internal.activity.repeat_customer),
  } : null;

  const safePreferences = internal.preferences ? {
    favorite_branch: internal.preferences.favorite_branch || null,
    favorite_barber: internal.preferences.favorite_barber || null,
    favorite_service: internal.preferences.favorite_service || null,
  } : null;

  return {
    version: internal.version || 'customer360.v0.1',
    identity: {
      customer_found: Boolean(internal.identity?.customer_found),
      resolution: internal.identity?.resolution || 'not_found',
    },
    customer: safeCustomer,
    membership: safeMembership,
    loyalty: safeLoyalty,
    activity: safeActivity,
    spending: null, // Excluded from CUSTOMER_SELF projection for privacy
    preferences: safePreferences,
    data_quality: internal.data_quality || {},
  };
}

module.exports = {
  projectInternal,
  projectCustomerSelf,
};
