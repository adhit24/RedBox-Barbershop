(function exposeMembershipAccess(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxMembership = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMembershipAccess() {
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  // Membership expiry is a business date, not a moment-in-time display.
  // Keep the YYYY-MM-DD supplied by the backend intact so customer/admin
  // pages cannot disagree because of browser timezone conversion.
  function membershipDateKey(value) {
    if (!hasValue(value)) return '';
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';

    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function formatMembershipExpiryDate(value) {
    const key = membershipDateKey(value);
    if (!key) return '';
    const [year, month, day] = key.split('-').map(Number);
    return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
  }

  function renderCustomerMembershipExpiry(record = {}, isActive = record.membership_status === 'ACTIVE' || record.status === 'ACTIVE') {
    if (typeof document === 'undefined') return;

    const badge = document.getElementById('memberStatusBadge');
    if (!badge) return;

    let display = document.getElementById('membershipExpiryDisplay');
    const expiresAt = record.membership_expires_at ?? record.expiresAt;
    const formatted = formatMembershipExpiryDate(expiresAt);

    if (!isActive || !formatted) {
      if (display) {
        display.textContent = '';
        display.hidden = true;
      }
      return;
    }

    if (!display) {
      display = document.createElement('div');
      display.id = 'membershipExpiryDisplay';
      display.setAttribute('aria-live', 'polite');
      display.style.marginTop = '6px';
      display.style.fontSize = '12px';
      display.style.fontWeight = '600';
      display.style.letterSpacing = '0.02em';
      display.style.color = 'rgba(255,255,255,.72)';
      badge.insertAdjacentElement('afterend', display);
    }

    display.textContent = `Berakhir ${formatted}`;
    display.hidden = false;
  }

  function isActiveMembership(record = {}, now = new Date()) {
    const active = evaluateActiveMembership(record, now);
    // The customer dashboard passes the current membership record through this
    // authority function; render the backend expiry business date alongside it.
    renderCustomerMembershipExpiry(record, active);
    return active;
  }

  function evaluateActiveMembership(record, now) {
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

  return {
    isActiveMembership,
    calculateMembershipExpiry,
    membershipDateKey,
    formatMembershipExpiryDate,
    renderCustomerMembershipExpiry,
  };
});
