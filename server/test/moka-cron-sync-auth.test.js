'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const createMokaRouter = require('../moka/routes');

// Minimal fake — only supports what an authorized-but-empty
// /moka/cron-sync run touches (no outletId, zero moka_tokens/outlets), since
// this suite is about the auth gate itself, not the sync logic underneath
// it (already covered by stockist-moka-sync.test.js and
// moka-txsync-fetch.test.js).
function emptySupabase() {
  const thenable = (data) => ({
    select() { return this; },
    eq() { return this; },
    not() { return this; },
    then(resolve) { resolve({ data, error: null }); },
  });
  return {
    from(table) {
      if (table === 'moka_tokens') return thenable([]);
      if (table === 'outlets') return thenable([]);
      return thenable([]);
    },
  };
}

async function withRouter(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api', createMokaRouter(emptySupabase()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('missing auth is denied when CRON_SECRET is configured', async () => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-123';
  try {
    await withRouter(async (base) => {
      const res = await fetch(`${base}/api/moka/cron-sync?outletId=csb-does-not-exist`);
      assert.equal(res.status, 401);
    });
  } finally {
    process.env.CRON_SECRET = original;
  }
});

test('wrong auth token is denied', async () => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-123';
  try {
    await withRouter(async (base) => {
      const res = await fetch(`${base}/api/moka/cron-sync`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      assert.equal(res.status, 401);
    });
  } finally {
    process.env.CRON_SECRET = original;
  }
});

test('valid CRON_SECRET bearer token is accepted', async () => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-123';
  try {
    await withRouter(async (base) => {
      const res = await fetch(`${base}/api/moka/cron-sync`, {
        headers: { Authorization: 'Bearer test-secret-123' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
    });
  } finally {
    process.env.CRON_SECRET = original;
  }
});

test('valid x-admin-token header is also accepted (existing convention)', async () => {
  const originalCron = process.env.CRON_SECRET;
  const originalAdmin = process.env.ADMIN_PASSWORD;
  process.env.CRON_SECRET = '';
  process.env.ADMIN_PASSWORD = 'admin-pw-456';
  try {
    await withRouter(async (base) => {
      const res = await fetch(`${base}/api/moka/cron-sync`, {
        headers: { 'x-admin-token': 'admin-pw-456' },
      });
      assert.equal(res.status, 200);
    });
  } finally {
    process.env.CRON_SECRET = originalCron;
    process.env.ADMIN_PASSWORD = originalAdmin;
  }
});

test('POST /moka/cron-sync enforces the same auth gate as GET', async () => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-123';
  try {
    await withRouter(async (base) => {
      const denied = await fetch(`${base}/api/moka/cron-sync`, { method: 'POST' });
      assert.equal(denied.status, 401);

      const accepted = await fetch(`${base}/api/moka/cron-sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-secret-123' },
      });
      assert.equal(accepted.status, 200);
    });
  } finally {
    process.env.CRON_SECRET = original;
  }
});
