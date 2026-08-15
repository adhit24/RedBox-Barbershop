'use strict';

function normalizeIdentityPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith('62') && digits.length >= 9) digits = `62${digits}`;
  return digits;
}

function normalizeIdentityName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sameIdentityPhone(left, right) {
  const a = normalizeIdentityPhone(left);
  const b = normalizeIdentityPhone(right);
  return Boolean(a && b && a === b);
}

function sameIdentityName(left, right) {
  const a = normalizeIdentityName(left);
  const b = normalizeIdentityName(right);
  return Boolean(a && b && a === b);
}

function getMemberToken(headers = {}) {
  const authorization = String(headers.authorization || '');
  return authorization.replace(/^Bearer\s+/i, '').trim()
    || String(headers['x-member-token'] || '').trim()
    || null;
}

module.exports = {
  getMemberToken,
  normalizeIdentityName,
  normalizeIdentityPhone,
  sameIdentityName,
  sameIdentityPhone,
};
