'use strict';

const { isActiveMembership: isActiveMembershipRecord } = require('../js/membership-access');

function isActiveMembership({ status, startsAt, expiresAt, now = new Date() } = {}) {
  return isActiveMembershipRecord({
    membership_status: status,
    membership_started_at: startsAt,
    membership_expires_at: expiresAt,
  }, now);
}

function membershipStateForSync({
  existingStatus,
  existingActivatedAt = null,
  existingStartedAt = null,
  existingExpiresAt = null,
  customerStatus,
  customerActivatedAt = null,
  customerStartedAt = null,
  customerExpiresAt = null,
  now,
} = {}) {
  const existingIsActive = isActiveMembership({
    status: existingStatus, startsAt: existingStartedAt, expiresAt: existingExpiresAt, now,
  });
  const customerIsActive = isActiveMembership({
    status: customerStatus, startsAt: customerStartedAt, expiresAt: customerExpiresAt, now,
  });
  const status = existingIsActive || customerIsActive ? 'ACTIVE' : 'INACTIVE';
  const activatedAt = status === 'ACTIVE'
    ? (existingIsActive ? existingActivatedAt : customerActivatedAt)
    : null;
  const expiresAt = status === 'ACTIVE'
    ? (existingIsActive ? existingExpiresAt : customerExpiresAt)
    : (existingExpiresAt || customerExpiresAt || null);
  return {
    membership_status: status,
    membership_activated_at: activatedAt,
    membership_expires_at: expiresAt,
  };
}

module.exports = { isActiveMembership, membershipStateForSync };
