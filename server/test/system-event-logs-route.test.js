'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createSystemEventLogRoutes } = require('../routes/systemEventLogs');

async function withServer(supabase, legacyAdminAuth, fn) {
  const app = express();
  app.use(express.json());
  // createBackofficeSupabaseAuth only takes the Supabase-bearer path when
  // req.hostname === 'backoffice.redboxbarbershop.com'; a real HTTP request
  // to 127.0.0.1 (fetch cannot set the Host header) can never produce that
  // hostname on its own. Force it here, before the route, the same way
  // server/test/backoffice-supabase-auth.test.js constructs a req with that
  // exact hostname when it tests the middleware directly. This does not
  // change what's under test — it makes req.hostname match what a request
  // actually hitting backoffice.redboxbarbershop.com in production would
  // see, so both the bearer-auth path and the legacy-fallback path (a
  // request without a Bearer token still falls through to legacyAdminAuth
  // even with this hostname forced, since createBackofficeSupabaseAuth also
  // requires `authHeader.startsWith('Bearer ')`) are reachable in this test.
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'hostname', { value: 'backoffice.redboxbarbershop.com', configurable: true });
    next();
  });
  app.use('/api/internal/system-event-logs', createSystemEventLogRoutes(supabase, legacyAdminAuth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function makeFakeSupabase(rows) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'adhit24@gmail.com' } }, error: null }) },
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'owner' }, error: null }) }) }),
        };
      }
      const query = {
        _filters: [],
        select() { return query; },
        eq(col, val) { query._filters.push([col, val]); return query; },
        order() { return query; },
        limit() { return query; },
        gte() { return query; },
        lte() { return query; },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function legacyAdminAuth(req, res) { return res.status(401).json({ error: 'legacy auth not used in this test' }); }

test('GET /api/internal/system-event-logs rejects requests without a bearer token via the legacy fallback', async () => {
  const supabase = makeFakeSupabase([]);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs`);
    assert.equal(res.status, 401);
  });
});

test('GET /api/internal/system-event-logs returns rows for an authenticated owner', async () => {
  const rows = [{ id: '1', module: 'booking', event_name: 'booking_created', severity: 'INFO', created_at: new Date().toISOString() }];
  const supabase = makeFakeSupabase(rows);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs`, {
      headers: { Authorization: 'Bearer faketoken' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 1);
  });
});

test('GET /api/internal/system-event-logs/timeline/:correlationId returns rows ordered by created_at ascending', async () => {
  const rows = [{ id: '1', module: 'booking', event_name: 'booking_created', correlation_id: 'c1', created_at: new Date().toISOString() }];
  const supabase = makeFakeSupabase(rows);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs/timeline/c1`, {
      headers: { Authorization: 'Bearer faketoken' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });
});
