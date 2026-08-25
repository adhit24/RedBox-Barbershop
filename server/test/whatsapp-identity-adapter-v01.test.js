'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const adapterPath = path.resolve(__dirname, '../identity/whatsappIdentityAdapter.js');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const {
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
} = require('../services/fonnteWebhookTrustGate');
const {
  adaptAuthenticatedWhatsappEvent,
  isAuthenticatedWhatsappEvent,
  issueAuthenticatedWhatsappEvent,
} = require(adapterPath);
const { isTrustedIdentity } = require('../identity/trustedIdentity');

const TEST_ENV = Object.freeze({
  WA_WEBHOOK_SECRET_BYPASS: 'a'.repeat(32),
});
const GENUINE_TRUST = verifyRedboxWebhookTrustQuery({ rb_branch: 'bypass', rb_key: 'a'.repeat(32) }, TEST_ENV);

function issueEvent(overrides = {}) {
  const payload = {
    sender: '6281234567890',
    message: 'halo',
    id: 'msg-1',
    isFromMe: false,
    ...overrides,
  };
  if (Object.hasOwn(overrides, 'status')) {
    delete payload.message;
  }
  return issueAuthenticatedWhatsappEvent(GENUINE_TRUST, payload);
}

test('test runner receives a private authenticated-event issuer requiring genuine verified trust', () => {
  assert.equal(typeof issueAuthenticatedWhatsappEvent, 'function');
  assert.equal(isVerifiedRedboxWebhookTrust(GENUINE_TRUST), true);
});

test('authenticated personal Indonesian senders issue genuine trusted identities', () => {
  for (const [sender, canonical] of [
    ['6281234567890', '6281234567890'],
    ['+6281234567890', '6281234567890'],
    ['0812-3456-7890', '6281234567890'],
  ]) {
    const event = issueEvent({ sender });
    const result = adaptAuthenticatedWhatsappEvent(event);

    assert.equal(isAuthenticatedWhatsappEvent(event), true);
    assert.equal(result.status, 'success');
    assert.equal(result.trustedIdentity.source, 'whatsapp');
    assert.equal(result.trustedIdentity.phone, canonical);
    assert.equal(isTrustedIdentity(result.trustedIdentity), true);
    assert.equal(Object.isFrozen(result), true);
  }
});

test('invalid personal senders fail closed without identifier fallback', () => {
  const invalidSenders = [
    '+1 415 555 2671',
    '0812abc345678',
    '0812\u00e9345678',
    '\uff10\uff18\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff10',
    '0812\ud83d\ude00345678',
    '6.28123456789e12',
    '',
    '123',
    '081234567890123456789',
    6281234567890,
    {},
    [],
    null,
  ];

  for (const sender of invalidSenders) {
    const event = issueEvent({ sender });
    const result = adaptAuthenticatedWhatsappEvent(event);
    assert.equal(result.trustedIdentity, null);
  }
});

test('JID, group, broadcast, and status-like sender identifiers are unsupported', () => {
  for (const sender of [
    '6281234567890@s.whatsapp.net',
    '120363012345678@g.us',
    'status@broadcast',
    '6281234567890@broadcast',
  ]) {
    const event = issueEvent({ sender });
    const result = adaptAuthenticatedWhatsappEvent(event);
    assert.equal(result.trustedIdentity, null);
  }
});

test('non-personal authenticated event types never issue identity', () => {
  for (const payload of [
    { sender: '6281234567890', isGroup: true, message: 'group' },
    { sender: '6281234567890', status: 'delivered' },
    { sender: '6281234567890', isFromMe: true, message: 'out' },
    { sender: '6281234567890', type: 'image' },
  ]) {
    const event = issueEvent(payload);
    assert.equal(event, null);
  }
});

test('forged, spread, assigned, and serialized envelopes remain unauthorized', () => {
  const event = issueEvent();
  const forged = Object.freeze({ ...event });

  for (const candidate of [
    forged,
    Object.freeze({ authenticated: true, ...event }),
    Object.freeze({ verified: true, ...event }),
    { ...event },
    Object.assign({}, event),
    JSON.parse(JSON.stringify(event)),
    null,
    [],
  ]) {
    assert.equal(isAuthenticatedWhatsappEvent(candidate), false);
    assert.deepEqual(adaptAuthenticatedWhatsappEvent(candidate), {
      status: 'unauthorized_event',
      trustedIdentity: null,
    });
  }
});

test('timestamp and inboxid metadata never become identity or rescue an invalid sender', () => {
  const success = adaptAuthenticatedWhatsappEvent(issueEvent({
    sender: '6281234567890',
    id: 'msg-123',
    timestamp: 1234567890,
  }));
  assert.deepEqual(Object.keys(success.trustedIdentity).sort(), ['phone', 'source']);
  assert.equal(Object.hasOwn(success.trustedIdentity, 'timestamp'), false);
  assert.equal(Object.hasOwn(success.trustedIdentity, 'inboxid'), false);
  assert.equal(Object.hasOwn(success.trustedIdentity, 'customer_id'), false);
});

test('authenticated envelopes are frozen and mutation cannot alter sender claims', () => {
  const event = issueEvent();
  assert.equal(Object.isFrozen(event), true);
  assert.throws(() => {
    event.sender = '6289999999999';
  }, TypeError);
  assert.equal(event.sender, '6281234567890');
});

test('production module surface exports authenticated-event capability functions', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const probe = spawnSync(process.execPath, ['-e', `
    const api = require(${JSON.stringify(adapterPath)});
    process.stdout.write(JSON.stringify(Object.keys(api).sort()));
  `], { env, encoding: 'utf8' });

  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), [
    'adaptAuthenticatedWhatsappEvent',
    'isAuthenticatedWhatsappEvent',
    'issueAuthenticatedWhatsappEvent',
  ]);
});

test('adapter is side-effect free and remains isolated from execution', () => {
  const adapterSource = fs.readFileSync(adapterPath, 'utf8');

  for (const forbidden of [
    'OpenAI', 'fetch', 'sendWA', 'FONNTE_TOKEN', 'executeOrchestration', 'crmAgent',
    'console.log', 'console.info', 'console.warn', 'console.error',
  ]) {
    assert.doesNotMatch(adapterSource, new RegExp(forbidden.replace('.', '\\.')));
  }
  assert.doesNotMatch(adapterSource, /\.from\s*\(|\.(?:insert|upsert|update|delete)\s*\(/);
});
