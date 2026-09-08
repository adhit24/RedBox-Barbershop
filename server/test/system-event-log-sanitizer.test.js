'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeMetadata, sanitizeFreeText } = require('../services/systemEventLogSanitizer');

test('sanitizeMetadata strips sensitive keys at top level', () => {
  const out = sanitizeMetadata({
    password: 'hunter2',
    ADMIN_PASSWORD: 'x',
    cron_secret: 'y',
    token: 'z',
    access_token: 'a',
    refresh_token: 'b',
    api_key: 'c',
    secret: 'd',
    authorization: 'Bearer abc',
    cookie: 'sid=1',
    safe: 'keep-me',
  });
  assert.deepEqual(out, { safe: 'keep-me' });
});

test('sanitizeMetadata strips sensitive keys nested inside objects and arrays', () => {
  const out = sanitizeMetadata({
    user: { name: 'Budi', password: 'hunter2' },
    items: [{ id: 1, token: 'z' }, { id: 2 }],
  });
  assert.deepEqual(out, { user: { name: 'Budi' }, items: [{ id: 1 }, { id: 2 }] });
});

test('sanitizeMetadata is case-insensitive and matches key variants', () => {
  const out = sanitizeMetadata({ Authorization: 'x', ApiKey: 'y', AccessToken: 'z', keep: 1 });
  assert.deepEqual(out, { keep: 1 });
});

test('sanitizeMetadata returns an empty object for non-object input', () => {
  assert.deepEqual(sanitizeMetadata(null), {});
  assert.deepEqual(sanitizeMetadata(undefined), {});
  assert.deepEqual(sanitizeMetadata('a string'), {});
  assert.deepEqual(sanitizeMetadata(42), {});
});

test('sanitizeMetadata bounds oversized metadata instead of storing it raw', () => {
  const big = { blob: 'x'.repeat(20000) };
  const out = sanitizeMetadata(big);
  assert.equal(out._truncated, true);
  assert.equal(typeof out._original_size, 'number');
  assert.ok(out._original_size > 8000);
  assert.ok(JSON.stringify(out).length < 1000);
});

test('sanitizeMetadata never throws on circular references', () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => sanitizeMetadata(circular));
});

test('sanitizeMetadata prevents __proto__ key from being copied to output', () => {
  // Create an input with __proto__ as a real own property (JSON.parse can produce this)
  const input = { __proto__: { injected: 'bad' }, safe: 'data' };

  const result = sanitizeMetadata(input);

  // The __proto__ key should be filtered out; result should have only 'safe'
  assert.deepEqual(result, { safe: 'data' });
  assert.strictEqual(result.safe, 'data');

  // Result must NOT have __proto__ as its own property
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, '__proto__'), false);

  // Verify JSON.stringify produces expected clean output
  const serialized = JSON.stringify(result);
  assert.strictEqual(serialized, '{"safe":"data"}');
});

test('sanitizeMetadata handles sibling references to same object (not circular)', () => {
  // A non-circular structure where the same object is referenced twice as siblings
  const shared = { id: 42, value: 'shared' };
  const input = {
    first: shared,
    second: shared,  // same object again, but not an ancestor of itself
    other: { x: 1 }
  };

  const result = sanitizeMetadata(input);

  // Both siblings should be sanitized normally, NOT as '[circular]'
  assert.deepEqual(result, {
    first: { id: 42, value: 'shared' },
    second: { id: 42, value: 'shared' },
    other: { x: 1 }
  });

  // Verify the two references were both fully processed (not truncated)
  assert.notStrictEqual(result.first, '[circular]');
  assert.notStrictEqual(result.second, '[circular]');
});

test('sanitizeMetadata still detects genuine circular references after sibling fix', () => {
  // Real circular reference: object is its own ancestor
  const circular = { a: 1 };
  circular.self = circular;

  const result = sanitizeMetadata(circular);

  // The circular reference should be marked as [circular]
  assert.strictEqual(result.self, '[circular]');
  // 'a' should still be present
  assert.strictEqual(result.a, 1);
});

test('sanitizeMetadata skips constructor and prototype keys as own properties', () => {
  const input = {
    constructor: { polluted: true },
    prototype: { also: 'bad' },
    normal: 'good'
  };

  const result = sanitizeMetadata(input);

  // Only 'normal' should be in result
  assert.deepEqual(result, { normal: 'good' });

  // Verify constructor and prototype are NOT own properties (they may be inherited from Object.prototype)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'constructor'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'prototype'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'normal'), true);
});

test('sanitizeFreeText scrubs Bearer tokens with Authorization prefix', () => {
  const input = 'upstream returned 401 with Authorization: Bearer secret-tok-123456';
  const out = sanitizeFreeText(input);
  assert.equal(out, 'upstream returned 401 with Authorization: Bearer [REDACTED]');
});

test('sanitizeFreeText scrubs standalone Bearer tokens', () => {
  const input = 'request headers included Bearer ya29.a0AfH6SM..._secret';
  const out = sanitizeFreeText(input);
  assert.equal(out, 'request headers included Bearer [REDACTED]');
});

test('sanitizeFreeText scrubs credential-bearing key=value and key: value patterns', () => {
  const cases = [
    ['failed connecting with access_token=ya29.xyz123', 'failed connecting with access_token=[REDACTED]'],
    ['auth failed: refresh_token=1//abc_def-456', 'auth failed: refresh_token=[REDACTED]'],
    ['query failed: api_key=AIzaSyD-12345678', 'query failed: api_key=[REDACTED]'],
    ['service returned apikey=secret_key_val', 'service returned apikey=[REDACTED]'],
    ['session error: token: my_secret_token_123', 'session error: token: [REDACTED]'],
    ['internal secret=ultra_secret_val', 'internal secret=[REDACTED]'],
    ['login failed for user with password=mypassword123', 'login failed for user with password=[REDACTED]'],
    ['request header cookie=sessionid_abc123', 'request header cookie=[REDACTED]'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(sanitizeFreeText(raw), expected, `failed for pattern: ${raw}`);
  }
});

test('sanitizeFreeText scrubs credentials inside JSON formatted strings', () => {
  const jsonStr = '{"error":"auth","password":"mySecretPassword","token":"secretToken123"}';
  const out = sanitizeFreeText(jsonStr);
  assert.equal(out, '{"error":"auth","password":"[REDACTED]","token":"[REDACTED]"}');
});

test('sanitizeFreeText masks phone numbers (8-15 digits) and preserves short numeric codes', () => {
  const withPhone = 'customer phone 081234567890 submitted booking';
  assert.equal(sanitizeFreeText(withPhone), 'customer phone 08***90 submitted booking');

  const withShortCode = 'status 404 code 1234 error 500';
  assert.equal(sanitizeFreeText(withShortCode), 'status 404 code 1234 error 500');
});

test('sanitizeFreeText handles non-string and empty inputs safely', () => {
  assert.equal(sanitizeFreeText(null), null);
  assert.equal(sanitizeFreeText(undefined), undefined);
  assert.equal(sanitizeFreeText(''), '');
  assert.equal(sanitizeFreeText(12345), '12345');
});
