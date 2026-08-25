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
]);

const verifiedTrustCapabilities = new WeakSet();

// This is Redbox-managed URL shared-secret verification, not a Fonnte
// signature, HMAC, or mTLS proof. Query secrets may be visible to hosting or
// provider access infrastructure, so this module never reads/logs a raw URL.

const BRANCH_SECRET_ENV = Object.freeze({
  bypass: 'WA_WEBHOOK_SECRET_BYPASS',
  samadikun: 'WA_WEBHOOK_SECRET_SAMADIKUN',
  csb: 'WA_WEBHOOK_SECRET_CSB',
  sumber: 'WA_WEBHOOK_SECRET_SUMBER',
  tegal: 'WA_WEBHOOK_SECRET_TEGAL',
});

function result(status, branch = null) {
  return Object.freeze({ status, branch });
}

function readQuery(query) {
  if (query === undefined) return { values: {}, present: new Set() };
  try {
    if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
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

function verifyRedboxWebhookTrustQuery(query, env = process.env) {
  const parsed = readQuery(query);
  if (!parsed) return result('malformed');

  const { values, present } = parsed;
  const branch = values.rb_branch;
  if (!present.has('rb_branch')) return result('unknown_branch');
  if (typeof branch !== 'string' || !branch || branch.trim() !== branch) return result('malformed');

  if (!Object.hasOwn(BRANCH_SECRET_ENV, branch)) return result('unknown_branch');
  const envName = BRANCH_SECRET_ENV[branch];

  let expectedSecret;
  try {
    expectedSecret = env && Object.hasOwn(env, envName) ? env[envName] : undefined;
  } catch {
    return result('not_configured', branch);
  }
  if (
    typeof expectedSecret !== 'string'
    || expectedSecret.length < MIN_SECRET_LENGTH
    || expectedSecret.trim().length === 0
  ) {
    return result('not_configured', branch);
  }

  if (!present.has('rb_key')) return result('missing_secret', branch);
  const providedSecret = values.rb_key;
  if (providedSecret === '') return result('missing_secret', branch);
  if (typeof providedSecret !== 'string') return result('malformed', branch);

  const expected = Buffer.from(expectedSecret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');
  if (expected.length !== provided.length) return result('invalid_secret', branch);

  const isVerified = timingSafeEqual(expected, provided);
  const trustResult = result(isVerified ? 'verified' : 'invalid_secret', branch);
  if (isVerified) {
    verifiedTrustCapabilities.add(trustResult);
  }
  return trustResult;
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
  try {
    if (trustResult && typeof trustResult === 'object') {
      const statusDescriptor = Object.getOwnPropertyDescriptor(trustResult, 'status');
      const branchDescriptor = Object.getOwnPropertyDescriptor(trustResult, 'branch');
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
    }
  } catch {}

  const metadata = Object.freeze({ trust_status: trustStatus, branch });
  try {
    if (logger && typeof logger.info === 'function') {
      logger.info('[WAWebhookTrust]', metadata);
    }
  } catch {}
  return metadata;
}

module.exports = {
  BRANCH_SECRET_ENV,
  emitRedboxWebhookTrust,
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
};
