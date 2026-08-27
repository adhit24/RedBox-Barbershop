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
    status: internal.loyalty.status === 'ambiguous_balance_conflict'
      ? 'ambiguous_balance_conflict'
      : 'available',
  } : null;

  const safeLastVisitEvent = internal.activity?.last_visit_event ? {
    date: internal.activity.last_visit_event.date || null,
    branch: internal.activity.last_visit_event.branch || null,
    barber: internal.activity.last_visit_event.barber || null,
    service: internal.activity.last_visit_event.service || null,
    source: internal.activity.last_visit_event.source || null,
    confidence: internal.activity.last_visit_event.confidence || null,
  } : null;

  const safeActivity = internal.activity ? {
    first_visit: internal.activity.first_visit || null,
    last_visit: internal.activity.last_visit || null,
    last_visit_branch: internal.activity.last_visit_branch || null,
    last_visit_barber: internal.activity.last_visit_barber || null,
    last_visit_service: internal.activity.last_visit_service || null,
    last_visit_source: internal.activity.last_visit_source || null,
    last_visit_confidence: internal.activity.last_visit_confidence || null,
    last_visit_event: safeLastVisitEvent,
    latest_booking_date: internal.activity.latest_booking_date || null,
    latest_booking_time: internal.activity.latest_booking_time || null,
    latest_booking_branch: internal.activity.latest_booking_branch || null,
    latest_booking_barber: internal.activity.latest_booking_barber || null,
    latest_booking_service: internal.activity.latest_booking_service || null,
    latest_booking_status: internal.activity.latest_booking_status || null,
    days_since_last_visit: typeof internal.activity.days_since_last_visit === 'number' ? internal.activity.days_since_last_visit : null,
    completed_booking_count: typeof internal.activity.completed_booking_count === 'number' ? internal.activity.completed_booking_count : null,
    completed_transaction_count: typeof internal.activity.completed_transaction_count === 'number' ? internal.activity.completed_transaction_count : null,
    visit_metric_status: internal.activity.visit_metric_status || 'caveated',
    repeat_customer: Boolean(internal.activity.repeat_customer),
  } : null;

  const preferenceValue = (value) => {
    if (value && typeof value === 'object') return value.value || null;
    return value || null;
  };
  const safePreferences = internal.preferences ? {
    favorite_branch: preferenceValue(internal.preferences.favorite_branch),
    favorite_barber: preferenceValue(internal.preferences.favorite_barber),
    favorite_service: preferenceValue(internal.preferences.favorite_service),
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
