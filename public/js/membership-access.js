(function exposeMembershipAccess(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxMembership = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMembershipAccess() {
  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function isActiveMembership(record = {}, now = new Date()) {
    const status = record.membership_status ?? record.status;
    if (status !== 'ACTIVE') return false;

    const startsAt = record.membership_started_at ?? record.startsAt;
    const expiresAt = record.membership_expires_at ?? record.expiresAt;

    if (hasValue(expiresAt)) {
      const expiry = new Date(expiresAt);
      const boundary = new Date(now);
      return !Number.isNaN(expiry.getTime())
        && !Number.isNaN(boundary.getTime())
        && expiry.getTime() > boundary.getTime();
    }

    // Paid activations always set membership_started_at and membership_expires_at
    // atomically. Only pre-paid-plan legacy records may be ACTIVE without either.
    return !hasValue(startsAt);
  }

  return { isActiveMembership };
});
