'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyRedboxWebhookTrustQuery,
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

  if (trustResult.status !== 'verified') {
    return {
      trustResult,
      trustedIdentity: null,
    };
  }

  const isFromMe = Boolean(rawBody?.isFromMe);
  const type = typeof rawBody?.type === 'string' ? rawBody.type : 'text';
  const isPersonal = !isFromMe && !['status', 'receipt', 'status_receipt', 'outgoing'].includes(type);

  const eventCap = issueAuthenticatedWhatsappEvent({
    source: 'fonnte',
    event_type: isPersonal ? 'personal_message' : type,
    sender: typeof rawBody?.sender === 'string' ? rawBody.sender : null,
    timestamp_present: Boolean(rawBody?.timestamp || rawBody?.id),
    inboxid_present: Boolean(rawBody?.id || rawBody?.inboxid),
  });

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
  // Bypass branch using CSB secret
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

// ── 3. INVALID / NON-PERSONAL SENDER REJECTION UNDER VERIFIED TRUST ──────────
test('verified trust + invalid or malformed sender MUST NOT mint TrustedIdentity', () => {
  const invalidSenders = [
    '+1 415 555 2671', // foreign phone
    '0812abc345678',   // letters
    '08123',          // too short
    '',               // empty
    null, undefined, 12345, {}, [],
  ];

  for (const sender of invalidSenders) {
    const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
    const body = { sender, message: 'halo', isFromMe: false };

    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

    assert.equal(trustResult.status, 'verified');
    assert.equal(trustedIdentity, null);
  }
});

test('verified trust + JID / group / broadcast sender MUST NOT mint TrustedIdentity', () => {
  const unsupportedSenders = [
    '6281234567890@s.whatsapp.net',
    '120363012345678@g.us',
    'status@broadcast',
    '6281234567890@broadcast',
  ];

  for (const sender of unsupportedSenders) {
    const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
    const body = { sender, message: 'halo', isFromMe: false };

    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

    assert.equal(trustResult.status, 'verified');
    assert.equal(trustedIdentity, null);
  }
});

test('verified trust + status / receipt / outgoing message MUST NOT mint TrustedIdentity', () => {
  const nonPersonalBodies = [
    { sender: '6281234567890', isFromMe: true }, // outgoing
    { sender: '6281234567890', type: 'status' },
    { sender: '6281234567890', type: 'receipt' },
  ];

  for (const body of nonPersonalBodies) {
    const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
    const { trustResult, trustedIdentity } = processFonnteWebhookTrustAndIdentity(query, body);

    assert.equal(trustResult.status, 'verified');
    assert.equal(trustedIdentity, null);
  }
});
