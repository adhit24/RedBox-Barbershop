'use strict';

const { timingSafeEqual } = require('node:crypto');

const MIN_SECRET_LENGTH = 32;
const QUERY_FIELDS = Object.freeze(['rb_branch', 'rb_key']);
const TRUST_STATUSES = new Set([
  'verified',
  'missing_secret',
  'invalid_secret',
  'unknown_branch',
  'not_configured',
  'malformed',
  'device_mismatch',
]);

const verifiedTrustCapabilities = new WeakSet();

// This is Redbox-managed URL shared-secret verification / Fonnte Flow body secret verification,
// not an HMAC signature or mTLS proof. Query secrets may be visible to hosting or
// provider access infrastructure, so this module never reads/logs raw secrets.

const BRANCH_SECRET_ENV = Object.freeze({
  bypass: 'WA_WEBHOOK_SECRET_BYPASS',
  samadikun: 'WA_WEBHOOK_SECRET_SAMADIKUN',
  csb: 'WA_WEBHOOK_SECRET_CSB',
  sumber: 'WA_WEBHOOK_SECRET_SUMBER',
  tegal: 'WA_WEBHOOK_SECRET_TEGAL',
});

const BRANCH_DEVICE_MAP = Object.freeze({
  '0818202569': 'bypass',
  '0818202589': 'samadikun',
  '0818202889': 'csb',
  '0818202599': 'sumber',
  '0818268883': 'tegal',
});

function result(status, branch = null, trustMethod = 'untrusted') {
  return Object.freeze({ status, branch, trust_method: trustMethod });
}

function normalizeDeviceNumber(rawDevice) {
  if (typeof rawDevice !== 'string' && typeof rawDevice !== 'number') return null;
  let deviceStr = String(rawDevice).trim();
  deviceStr = deviceStr.replace(/\D/g, '');
  if (deviceStr.startsWith('62')) deviceStr = '0' + deviceStr.slice(2);
  return deviceStr;
}

function readQuery(query) {
  if (query === undefined) return { values: {}, present: new Set() };
  if (query === null) return null;
  try {
    if (typeof query !== 'object' || Array.isArray(query)) return null;
    const prototype = Object.getPrototypeOf(query);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(query);
    if (keys.some(key => typeof key !== 'string' || !QUERY_FIELDS.includes(key))) return null;

    const descriptors = Object.getOwnPropertyDescriptors(query);
    const values = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
      values[key] = descriptor.value;
    }
    return { values, present: new Set(keys) };
  } catch {
    return null;
  }
}

function verifyBodySecretInternal(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const rawSecret = body['webhook-secret-key'];
  if (rawSecret === undefined) return null;

  if (typeof rawSecret !== 'string' || rawSecret === '') {
    return result('malformed', null, 'fonnte_body_secret');
  }

  const deviceNorm = normalizeDeviceNumber(body.device);
  if (!deviceNorm || !Object.hasOwn(BRANCH_DEVICE_MAP, deviceNorm)) {
    return result('unknown_branch', null, 'fonnte_body_secret');
  }
  const branch = BRANCH_DEVICE_MAP[deviceNorm];

  const envName = BRANCH_SECRET_ENV[branch];
  let expectedSecret;
  try {
    expectedSecret = env && Object.hasOwn(env, envName) ? env[envName] : undefined;
  } catch {
    return result('not_configured', branch, 'fonnte_body_secret');
  }

  if (
    typeof expectedSecret !== 'string'
    || expectedSecret.length < MIN_SECRET_LENGTH
    || expectedSecret.trim().length === 0
  ) {
    return result('not_configured', branch, 'fonnte_body_secret');
  }

  const expected = Buffer.from(expectedSecret, 'utf8');
  const provided = Buffer.from(rawSecret, 'utf8');
  if (expected.length !== provided.length) {
    return result('invalid_secret', branch, 'fonnte_body_secret');
  }

  const isVerified = timingSafeEqual(expected, provided);
  const trustResult = result(isVerified ? 'verified' : 'invalid_secret', branch, 'fonnte_body_secret');
  if (isVerified) {
    verifiedTrustCapabilities.add(trustResult);
  }
  return trustResult;
}

function verifyQuerySecretInternal(query, env) {
  const parsed = readQuery(query);
  if (!parsed) return result('malformed', null, 'query_secret_fallback');

  const { values, present } = parsed;
  const branch = values.rb_branch;
  if (!present.has('rb_branch')) return result('unknown_branch', null, 'query_secret_fallback');
  if (typeof branch !== 'string' || !branch || branch.trim() !== branch) return result('malformed', null, 'query_secret_fallback');

  if (!Object.hasOwn(BRANCH_SECRET_ENV, branch)) return result('unknown_branch', null, 'query_secret_fallback');
  const envName = BRANCH_SECRET_ENV[branch];

  let expectedSecret;
  try {
    expectedSecret = env && Object.hasOwn(env, envName) ? env[envName] : undefined;
  } catch {
    return result('not_configured', branch, 'query_secret_fallback');
  }
  if (
    typeof expectedSecret !== 'string'
    || expectedSecret.length < MIN_SECRET_LENGTH
    || expectedSecret.trim().length === 0
  ) {
    return result('not_configured', branch, 'query_secret_fallback');
  }

  if (!present.has('rb_key')) return result('missing_secret', branch, 'query_secret_fallback');
  const providedSecret = values.rb_key;
  if (providedSecret === '') return result('missing_secret', branch, 'query_secret_fallback');
  if (typeof providedSecret !== 'string') return result('malformed', branch, 'query_secret_fallback');

  const expected = Buffer.from(expectedSecret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');
  if (expected.length !== provided.length) return result('invalid_secret', branch, 'query_secret_fallback');

  const isVerified = timingSafeEqual(expected, provided);
  const trustResult = result(isVerified ? 'verified' : 'invalid_secret', branch, 'query_secret_fallback');
  if (isVerified) {
    verifiedTrustCapabilities.add(trustResult);
  }
  return trustResult;
}

function verifyRedboxWebhookTrustQueryInternal(query, body, env = process.env) {
  const bodyResult = verifyBodySecretInternal(body, env);
  if (bodyResult !== null) {
    return bodyResult;
  }
  return verifyQuerySecretInternal(query, env);
}

/**
 * Production Webhook Trust Verifier (Fonnte Body Secret Primary + Query Secret Fallback).
 * Strictly reads secret configuration from process.env ONLY.
 */
function verifyRedboxWebhookTrustQuery(query, body) {
  return verifyRedboxWebhookTrustQueryInternal(query, body, process.env);
}

function isVerifiedRedboxWebhookTrust(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Object.isFrozen(value)
    && verifiedTrustCapabilities.has(value)
  );
}

function emitRedboxWebhookTrust(trustResult, logger = console) {
  let trustStatus = 'malformed';
  let branch = null;
  let trustMethod = 'untrusted';
  try {
    if (trustResult && typeof trustResult === 'object') {
      const statusDescriptor = Object.getOwnPropertyDescriptor(trustResult, 'status');
      const branchDescriptor = Object.getOwnPropertyDescriptor(trustResult, 'branch');
      const methodDescriptor = Object.getOwnPropertyDescriptor(trustResult, 'trust_method');

      if (
        statusDescriptor
        && Object.hasOwn(statusDescriptor, 'value')
        && TRUST_STATUSES.has(statusDescriptor.value)
      ) {
        trustStatus = statusDescriptor.value;
      }
      if (
        branchDescriptor
        && Object.hasOwn(branchDescriptor, 'value')
        && Object.hasOwn(BRANCH_SECRET_ENV, branchDescriptor.value)
      ) {
        branch = branchDescriptor.value;
      }
      if (
        methodDescriptor
        && Object.hasOwn(methodDescriptor, 'value')
        && ['fonnte_body_secret', 'query_secret_fallback', 'untrusted'].includes(methodDescriptor.value)
      ) {
        trustMethod = methodDescriptor.value;
      }
    }
  } catch {}

  const metadata = Object.freeze({ trust_status: trustStatus, branch, trust_method: trustMethod });
  try {
    if (logger && typeof logger.info === 'function') {
      logger.info('[WAWebhookTrust]', metadata);
    }
  } catch {}
  return metadata;
}

const productionApi = {
  BRANCH_SECRET_ENV,
  BRANCH_DEVICE_MAP,
  emitRedboxWebhookTrust,
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
};

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  productionApi.__verifyRedboxWebhookTrustQueryForTest = verifyRedboxWebhookTrustQueryInternal;
}

module.exports = Object.freeze(productionApi);
