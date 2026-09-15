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

  function renderCustomerMembershipExpiry(record = {}) {
    if (typeof document === 'undefined') return;

    const badge = document.getElementById('memberStatusBadge');
    if (!badge) return;

    let display = document.getElementById('membershipExpiryDisplay');
    const status = record.membership_status ?? record.status;
    const expiresAt = record.membership_expires_at ?? record.expiresAt;
    const formatted = formatMembershipExpiryDate(expiresAt);

    if (status !== 'ACTIVE' || !formatted) {
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
    // The customer dashboard already passes the current membership record
    // through this authority function. Render the same backend expiry value
    // there so customers see the exact business date admins see.
    renderCustomerMembershipExpiry(record);

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

  return {
    isActiveMembership,
    membershipDateKey,
    formatMembershipExpiryDate,
    renderCustomerMembershipExpiry,
  };
});
