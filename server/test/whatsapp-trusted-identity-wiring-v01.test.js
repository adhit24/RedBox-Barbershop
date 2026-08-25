'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
} = require('../services/fonnteWebhookTrustGate');
const {
  issueAuthenticatedWhatsappEvent,
  adaptAuthenticatedWhatsappEvent,
  isAuthenticatedWhatsappEvent,
} = require('../identity/whatsappIdentityAdapter');
const { isTrustedIdentity } = require('../identity/trustedIdentity');

const TEST_ENV = Object.freeze({
  WA_WEBHOOK_SECRET_BYPASS: 'a'.repeat(32),
  WA_WEBHOOK_SECRET_CSB: 'b'.repeat(32),
});

function processFonnteWebhookTrustAndIdentity(query, rawBody, env = TEST_ENV) {
  const trustResult = verifyRedboxWebhookTrustQuery(query, env);

  const eventCap = issueAuthenticatedWhatsappEvent(trustResult, rawBody);
  const identityResult = adaptAuthenticatedWhatsappEvent(eventCap);
  const trustedIdentity = (identityResult && identityResult.status === 'success' && isTrustedIdentity(identityResult.trustedIdentity))
    ? identityResult.trustedIdentity
    : null;

  return {
    trustResult,
    trustedIdentity,
  };
}

// ── 1. VERIFIED TRUST GATE + VALID PERSONAL SENDER MINTING ─────────────────
test('verified correct branch secret + valid personal sender MUST mint TrustedIdentity', () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const body = { sender: '6281234567890', message: 'halo', id: 'msg-1', isFromMe: false };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'verified');
  assert.equal(trustResult.branch, 'bypass');
  assert.notEqual(trustedIdentity, null);
  assert.equal(isTrustedIdentity(trustedIdentity), true);
  assert.equal(trustedIdentity.source, 'whatsapp');
  assert.equal(trustedIdentity.phone, '6281234567890');
});

test('verified trust accepts 08... and +628... formats and canonicalizes to 628...', () => {
  for (const [inputPhone, expectedCanonical] of [
    ['081234567890', '6281234567890'],
    ['+6281234567890', '6281234567890'],
    ['6281234567890', '6281234567890'],
  ]) {
    const query = { rb_branch: 'csb', rb_key: 'b'.repeat(32) };
    const body = { sender: inputPhone, message: 'test', id: 'msg-2', isFromMe: false };

    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

    assert.equal(trustResult.status, 'verified');
    assert.notEqual(trustedIdentity, null);
    assert.equal(trustedIdentity.phone, expectedCanonical);
  }
});

// ── 2. UNTRUSTED STATES MUST NEVER MINT TRUSTED IDENTITY ───────────────────
test('missing secret MUST NOT mint TrustedIdentity', () => {
  const query = { rb_branch: 'bypass' };
  const body = { sender: '6281234567890', message: 'halo' };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'missing_secret');
  assert.equal(trustedIdentity, null);
});

test('invalid secret MUST NOT mint TrustedIdentity', () => {
  const query = { rb_branch: 'bypass', rb_key: 'wrong-secret' };
  const body = { sender: '6281234567890', message: 'halo' };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'invalid_secret');
  assert.equal(trustedIdentity, null);
});

test('cross-branch secret MUST NOT mint TrustedIdentity', () => {
  const query = { rb_branch: 'bypass', rb_key: 'b'.repeat(32) };
  const body = { sender: '6281234567890', message: 'halo' };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'invalid_secret');
  assert.equal(trustedIdentity, null);
});

test('not configured branch MUST NOT mint TrustedIdentity', () => {
  const query = { rb_branch: 'sumber', rb_key: 'a'.repeat(32) };
  const body = { sender: '6281234567890', message: 'halo' };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'not_configured');
  assert.equal(trustedIdentity, null);
});

test('malformed query MUST NOT mint TrustedIdentity', () => {
  const query = null;
  const body = { sender: '6281234567890', message: 'halo' };

  const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

  assert.equal(trustResult.status, 'malformed');
  assert.equal(trustedIdentity, null);
});

// ── 3. OPAQUE TRUST GATE CAPABILITY FORGERY DEFENSE (FINDING 1) ───────────────
test('forged, spread, Object.assign, or JSON cloned trust objects CANNOT issue event capability', () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const genuineTrust = verifyRedboxWebhookTrustQuery(query, TEST_ENV);
  const body = { sender: '6281234567890', message: 'halo', id: 'msg-1' };

  assert.equal(isVerifiedRedboxWebhookTrust(genuineTrust), true);

  const forgedCandidates = [
    { status: 'verified', branch: 'bypass' },
    { verified: true, branch: 'bypass' },
    { authenticated: true, branch: 'bypass' },
    { ...genuineTrust },
    Object.assign({}, genuineTrust),
    JSON.parse(JSON.stringify(genuineTrust)),
    null,
    undefined,
    12345,
    'verified',
    [],
  ];

  for (const forged of forgedCandidates) {
    assert.equal(isVerifiedRedboxWebhookTrust(forged), false);
    const eventCap = issueAuthenticatedWhatsappEvent(forged, body);
    assert.equal(eventCap, null);
  }
});

// ── 4. STRICT POSITIVE EVENT CLASSIFICATION (FINDING 2) ─────────────────────
test('verified secret + group message MUST NOT issue identity even with valid sender phone', () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const groupBodies = [
    { sender: '6281234567890', message: 'halo group', isGroup: true },
    { sender: '6281234567890', message: 'halo group', groupId: 'group-123' },
    { sender: '6281234567890@g.us', message: 'halo group' },
  ];

  for (const body of groupBodies) {
    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);
    assert.equal(trustResult.status, 'verified');
    assert.equal(trustedIdentity, null);
  }
});

test('verified secret + status / receipt / outgoing / media / unsupported MUST NOT issue identity', () => {
  const nonPersonalBodies = [
    { sender: '6281234567890', message: 'halo', isFromMe: true }, // outgoing
    { sender: '6281234567890', status: 'delivered', id: 'msg-1' }, // status receipt
    { sender: '6281234567890', type: 'image', id: 'msg-1' }, // media
    { sender: '6281234567890', message: '' }, // empty text
    { sender: '6281234567890', type: 'unknown_type' }, // unknown
  ];

  for (const body of nonPersonalBodies) {
    const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);
    assert.equal(trustResult.status, 'verified');
    assert.equal(trustedIdentity, null);
  }
});
