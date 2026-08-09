'use strict';

function normalizeMemberPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith('62') && digits.length >= 9) digits = `62${digits}`;
  return digits;
}

function getMemberPhoneVariants(value) {
  const canonical = normalizeMemberPhone(value);
  if (!canonical) return [];
  return [...new Set([canonical, `+${canonical}`, `0${canonical.slice(2)}`])];
}

function firstNonEmpty(rows, field) {
  return rows.map(row => row?.[field]).find(value => value !== null && value !== undefined && value !== '');
}

function earliest(rows, field) {
  return rows.map(row => row?.[field]).filter(Boolean).sort()[0] || null;
}

function latest(rows, field) {
  return rows.map(row => row?.[field]).filter(Boolean).sort().at(-1) || null;
}

function mergeCustomerRows(rows, requestedPhone) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const canonical = normalizeMemberPhone(requestedPhone || rows[0].wa || rows[0].phone_e164);
  const ranked = [...rows].sort((a, b) => {
    const score = row => (
      (normalizeMemberPhone(row.phone_e164) === canonical ? 40 : 0) +
      (normalizeMemberPhone(row.wa) === canonical ? 20 : 0) +
      (row.source === 'moka' ? 10 : 0) +
      (row.membership_status === 'ACTIVE' ? 5 : 0) +
      (Number(row.total_spent || 0) > 0 ? 2 : 0)
    );
    return score(b) - score(a);
  });
  const merged = { ...ranked[0] };
  for (const field of ['name', 'email', 'birth_date', 'birthday', 'gender', 'address', 'fav_barber', 'referral_code', 'phone_e164']) {
    if (!merged[field]) merged[field] = firstNonEmpty(ranked, field) || null;
  }
  merged.wa = canonical;
  merged.phone_e164 = `+${canonical}`;
  merged.points = Math.max(0, ...rows.map(row => Number(row.points) || 0));
  merged.visits = Math.max(0, ...rows.map(row => Number(row.visits) || 0));
  merged.total_spent = Math.max(0, ...rows.map(row => Number(row.total_spent) || 0));
  merged.first_visit = earliest(rows, 'first_visit');
  merged.last_visit = latest(rows, 'last_visit');
  merged.services = [...new Set(rows.flatMap(row => Array.isArray(row.services) ? row.services : []))];
  return merged;
}

module.exports = { normalizeMemberPhone, getMemberPhoneVariants, mergeCustomerRows };
