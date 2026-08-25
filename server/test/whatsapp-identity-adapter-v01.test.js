'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const adapterPath = path.resolve(__dirname, '../identity/whatsappIdentityAdapter.js');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const {
  adaptAuthenticatedWhatsappEvent,
  isAuthenticatedWhatsappEvent,
  issueAuthenticatedWhatsappEvent,
  __issueAuthenticatedWhatsappEventForTest,
} = require(adapterPath);
const { isTrustedIdentity } = require('../identity/trustedIdentity');

function issueEvent(overrides = {}) {
  return issueAuthenticatedWhatsappEvent({
    source: 'fonnte',
    event_type: 'personal_message',
    sender: '6281234567890',
    timestamp_present: true,
    inboxid_present: true,
    ...overrides,
  });
}

test('test runner receives a private authenticated-event issuer', () => {
  assert.equal(typeof issueAuthenticatedWhatsappEvent, 'function');
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
    assert.deepEqual(adaptAuthenticatedWhatsappEvent(issueEvent({ sender })), {
      status: 'invalid_sender',
      trustedIdentity: null,
    });
  }
});

test('JID, group, broadcast, and status-like sender identifiers are unsupported', () => {
  for (const sender of [
    '6281234567890@s.whatsapp.net',
    '120363012345678@g.us',
    'status@broadcast',
    '6281234567890@broadcast',
  ]) {
    assert.deepEqual(adaptAuthenticatedWhatsappEvent(issueEvent({ sender })), {
      status: 'unsupported_sender',
      trustedIdentity: null,
    });
  }
});

test('non-personal authenticated event types never issue identity', () => {
  for (const event_type of [
    'group_message',
    'broadcast',
    'broadcast_message',
    'status',
    'status_receipt',
    'receipt',
    'outgoing',
    'media_only',
    'unsupported',
    'unknown',
  ]) {
    const result = adaptAuthenticatedWhatsappEvent(issueEvent({ event_type }));
    assert.deepEqual(result, { status: 'non_personal_event', trustedIdentity: null });
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
  for (const metadata of [
    { timestamp_present: true, inboxid_present: false },
    { timestamp_present: false, inboxid_present: true },
    { timestamp_present: true, inboxid_present: true },
  ]) {
    const result = adaptAuthenticatedWhatsappEvent(issueEvent({ sender: null, ...metadata }));
    assert.deepEqual(result, { status: 'invalid_sender', trustedIdentity: null });
  }

  const success = adaptAuthenticatedWhatsappEvent(issueEvent({
    sender: '6281234567890',
    timestamp_present: true,
    inboxid_present: true,
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

test('test issuer rejects inherited, accessor, symbol, extra, and custom-prototype claims', () => {
  const inherited = Object.create({ source: 'fonnte' });
  Object.assign(inherited, {
    event_type: 'personal_message', sender: '6281234567890', timestamp_present: true, inboxid_present: true,
  });
  const customPrototype = Object.create({ attacker: true });
  Object.assign(customPrototype, {
    source: 'fonnte', event_type: 'personal_message', sender: '6281234567890', timestamp_present: true, inboxid_present: true,
  });
  const accessor = {
    source: 'fonnte', event_type: 'personal_message', timestamp_present: true, inboxid_present: true,
  };
  Object.defineProperty(accessor, 'sender', { enumerable: true, get: () => '6281234567890' });
  const throwingGetter = {
    source: 'fonnte', event_type: 'personal_message', timestamp_present: true, inboxid_present: true,
  };
  Object.defineProperty(throwingGetter, 'sender', {
    enumerable: true,
    get() { throw new Error('must not escape'); },
  });
  const symbolClaim = {
    source: 'fonnte', event_type: 'personal_message', sender: '6281234567890', timestamp_present: true, inboxid_present: true,
    [Symbol('admin')]: true,
  };
  const extra = {
    source: 'fonnte', event_type: 'personal_message', sender: '6281234567890', timestamp_present: true, inboxid_present: true,
    verified: true,
  };
  const wrongSource = {
    source: 'caller_claim', event_type: 'personal_message', sender: '6281234567890', timestamp_present: true, inboxid_present: true,
  };
  const wrongMetadataType = {
    source: 'fonnte', event_type: 'personal_message', sender: '6281234567890', timestamp_present: 'true', inboxid_present: true,
  };

  for (const claims of [
    inherited, customPrototype, accessor, throwingGetter, symbolClaim, extra,
    wrongSource, wrongMetadataType, null, [],
  ]) {
    assert.equal(issueAuthenticatedWhatsappEvent(claims), null);
  }
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
