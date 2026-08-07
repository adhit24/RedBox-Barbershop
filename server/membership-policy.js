'use strict';

function isActiveMembership({ status, expiresAt, now = new Date() } = {}) {
  if (status !== 'ACTIVE' || !expiresAt) return false;
  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() > new Date(now).getTime();
}

function membershipStateForSync({
  existingStatus,
  existingActivatedAt = null,
  existingExpiresAt = null,
  customerStatus,
  customerActivatedAt = null,
  customerExpiresAt = null,
  now,
} = {}) {
  const existingIsActive = isActiveMembership({ status: existingStatus, expiresAt: existingExpiresAt, now });
  const customerIsActive = isActiveMembership({ status: customerStatus, expiresAt: customerExpiresAt, now });
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
