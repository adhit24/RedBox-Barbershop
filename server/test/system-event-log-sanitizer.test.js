'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeMetadata } = require('../services/systemEventLogSanitizer');

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
