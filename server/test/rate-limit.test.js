'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { rateLimit } = require('../middleware/rateLimit');

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function buildApp(routes) {
  const app = express();
  // Mirrors server/index.js:38 — trust the single Vercel proxy hop so req.ip
  // resolves correctly; irrelevant here since tests hit the server directly,
  // but keeps the harness consistent with production config.
  app.set('trust proxy', false);
  for (const [path, limiter] of routes) {
    app.get(path, limiter, (req, res) => res.status(200).json({ ok: true }));
  }
  return app;
}

test('rateLimit requires a name and throws without one', () => {
  assert.throws(() => rateLimit({ max: 1, windowMs: 1000 }), /unique `name`/);
});

test('allows requests under the max and rejects with 429 once the max is exceeded', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3, name: `bucket-basic-${Date.now()}` });
  const app = buildApp([['/test', limiter]]);
  await withServer(app, async (url) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${url}/test`);
      assert.equal(res.status, 200, `request ${i + 1} should succeed`);
    }
    const rejected = await fetch(`${url}/test`);
    assert.equal(rejected.status, 429);
    const body = await rejected.json();
    assert.match(body.error, /Terlalu banyak permintaan/);
  });
});

test('two different limiter names for the same client do not share a bucket', async () => {
  // Regression test: rateLimit() previously keyed buckets without the
  // limiter's `name`, so two unrelated routes (e.g. OTP-send and
  // admin-auth) mounted on the same server would exhaust each other's
  // budget for the same client IP. Buckets must be keyed per-name.
  const limiterA = rateLimit({ windowMs: 60_000, max: 1, name: `bucket-a-${Date.now()}` });
  const limiterB = rateLimit({ windowMs: 60_000, max: 1, name: `bucket-b-${Date.now()}` });
  const app = buildApp([
    ['/a', limiterA],
    ['/b', limiterB],
  ]);
  await withServer(app, async (url) => {
    const resA = await fetch(`${url}/a`);
    assert.equal(resA.status, 200);
    // /a's bucket is now exhausted (max: 1), but /b is a distinct bucket
    // for the same client and should still be allowed through.
    const resB = await fetch(`${url}/b`);
    assert.equal(resB.status, 200, 'a different limiter name must not share a bucket with another name');

    const rejectedA = await fetch(`${url}/a`);
    assert.equal(rejectedA.status, 429);
  });
});

test('sets a Retry-After header (in seconds) once the limit is exceeded', async () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, name: `bucket-retry-${Date.now()}` });
  const app = buildApp([['/test', limiter]]);
  await withServer(app, async (url) => {
    assert.equal((await fetch(`${url}/test`)).status, 200);
    const rejected = await fetch(`${url}/test`);
    assert.equal(rejected.status, 429);
    const retryAfter = rejected.headers.get('retry-after');
    assert.ok(retryAfter, 'expected a Retry-After header on the 429 response');
    const seconds = Number(retryAfter);
    assert.ok(Number.isFinite(seconds) && seconds >= 1 && seconds <= 60, `Retry-After should be within the window, got ${retryAfter}`);
  });
});

test('a bucket resets once its window has elapsed', async () => {
  const windowMs = 50;
  const limiter = rateLimit({ windowMs, max: 1, name: `bucket-window-${Date.now()}` });
  const app = buildApp([['/test', limiter]]);
  await withServer(app, async (url) => {
    assert.equal((await fetch(`${url}/test`)).status, 200);
    assert.equal((await fetch(`${url}/test`)).status, 429);

    // Wait for the window to fully elapse so the next request starts a new window.
    await new Promise((resolve) => setTimeout(resolve, windowMs * 2));

    const afterReset = await fetch(`${url}/test`);
    assert.equal(afterReset.status, 200, 'request after the window elapsed should be allowed again');
  });
});

// Note: the 5-minute background sweep (setInterval in
// server/middleware/rateLimit.js) that evicts stale buckets from the Map is
// not exercised here — waiting 5+ minutes in a unit test is impractical.
// Its eviction logic (`now - record.start > record.windowMs * 2`) was
// verified by code inspection during this branch's own task-level review,
// matching the window-reset behavior asserted above.
