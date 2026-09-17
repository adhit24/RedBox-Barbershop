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

  function calculateMembershipExpiry(activatedAt) {
    if (!hasValue(activatedAt)) return null;
    const d = new Date(activatedAt);
    if (Number.isNaN(d.getTime())) return null;

    // Follow PostgreSQL `INTERVAL '1 year'` calendar semantics:
    // 1. Advance year by 1.
    // 2. If original date is Feb 29 (leap day) and the target year is not a leap year,
    //    PostgreSQL clamps to Feb 28 (e.g. 2024-02-29 + 1 year = 2025-02-28).
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth(); // 0-indexed (1 = Feb)
    const day = d.getUTCDate();
    const targetYear = year + 1;

    if (month === 1 && day === 29) {
      const isTargetLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
      if (!isTargetLeap) {
        d.setUTCFullYear(targetYear, 1, 28);
        return d.toISOString();
      }
    }
    d.setUTCFullYear(targetYear);
    return d.toISOString();
  }

  return { isActiveMembership, calculateMembershipExpiry };
});
