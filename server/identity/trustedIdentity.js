'use strict';

const { normalizeMemberPhone } = require('../member-identity');

const TRUSTED_SOURCES = Object.freeze([
  'whatsapp',
  'member_session',
  'internal_test',
]);
const trustedCapabilities = new WeakSet();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^62\d{8,13}$/;

function identityError(message, code) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function createTrustedIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw identityError('Trusted identity input is required', 'TRUSTED_IDENTITY_REQUIRED');
  }

  const unknownFields = Object.keys(input).filter(key => !['source', 'phone', 'customer_id'].includes(key));
  if (unknownFields.length > 0) {
    throw identityError('Trusted identity contains unsupported fields', 'TRUSTED_IDENTITY_INVALID');
  }

  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (!TRUSTED_SOURCES.includes(source)) {
    throw identityError('Trusted identity source is not allowed', 'TRUSTED_IDENTITY_SOURCE_INVALID');
  }

  let phone;
  if (input.phone !== undefined && input.phone !== null && input.phone !== '') {
    phone = normalizeMemberPhone(input.phone);
    if (!PHONE_PATTERN.test(phone)) {
      throw identityError('Trusted phone identity is malformed', 'TRUSTED_IDENTITY_INVALID');
    }
  }

  let customerId;
  if (input.customer_id !== undefined && input.customer_id !== null && input.customer_id !== '') {
    customerId = typeof input.customer_id === 'string' ? input.customer_id.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(customerId)) {
      throw identityError('Trusted customer identity is malformed', 'TRUSTED_IDENTITY_INVALID');
    }
  }

  if (!phone && !customerId) {
    throw identityError('Trusted identity requires a phone or customer ID', 'TRUSTED_IDENTITY_INVALID');
  }

  const identity = Object.freeze({
    source,
    ...(phone ? { phone } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
  });
  trustedCapabilities.add(identity);
  return identity;
}

function isTrustedIdentity(value) {
  return Boolean(value && typeof value === 'object' && Object.isFrozen(value) && trustedCapabilities.has(value));
}

module.exports = {
  TRUSTED_SOURCES,
  createTrustedIdentity,
  isTrustedIdentity,
};
