'use strict';

const TRUSTED_SOURCES = Object.freeze([
  'whatsapp',
  'member_session',
]);
const trustedCapabilities = new WeakSet();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { normalizePhoneNumber } = require('./phoneNormalization');

function identityError(message, code) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function normalizeVerifiedPhone(value) {
  return normalizePhoneNumber(value);
}

/**
 * Issues an in-process capability from claims already verified by a channel
 * authentication adapter. Request bodies and other unverified objects must
 * never be passed to this issuer.
 */
function issueTrustedIdentity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw identityError('Trusted identity input is required', 'TRUSTED_IDENTITY_REQUIRED');
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    throw identityError('Trusted identity claims must be a plain record', 'TRUSTED_IDENTITY_INVALID');
  }

  const unknownFields = Object.keys(input).filter(key => !['source', 'verifiedPhone', 'verifiedCustomerId'].includes(key));
  if (unknownFields.length > 0) {
    throw identityError('Trusted identity contains unsupported fields', 'TRUSTED_IDENTITY_INVALID');
  }

  const source = Object.hasOwn(input, 'source') && typeof input.source === 'string' ? input.source.trim() : '';
  if (!TRUSTED_SOURCES.includes(source)) {
    throw identityError('Trusted identity source is not allowed', 'TRUSTED_IDENTITY_SOURCE_INVALID');
  }

  let phone;
  if (Object.hasOwn(input, 'verifiedPhone') && input.verifiedPhone !== null && input.verifiedPhone !== '') {
    phone = normalizeVerifiedPhone(input.verifiedPhone);
    if (!phone) {
      throw identityError('Trusted phone identity is malformed', 'TRUSTED_IDENTITY_INVALID');
    }
  }

  let customerId;
  if (Object.hasOwn(input, 'verifiedCustomerId') && input.verifiedCustomerId !== null && input.verifiedCustomerId !== '') {
    customerId = typeof input.verifiedCustomerId === 'string' ? input.verifiedCustomerId.trim().toLowerCase() : '';
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
  issueTrustedIdentity,
  isTrustedIdentity,
};
