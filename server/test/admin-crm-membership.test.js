'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createMembershipRegistrationRoutes } = require('../routes/adminCrm');

function createFakeSupabase(seed = {}) {
  const state = {
    profiles: [...(seed.profiles || [])],
    customers: [...(seed.customers || [])],
    registrations: [...(seed.registrations || [])],
  };
  let sequence = 0;

  function rowsFor(table) {
    if (table === 'member_profiles') return state.profiles;
    if (table === 'customers') return state.customers;
    if (table === 'membership_registrations') return state.registrations;
    throw new Error(`unexpected table ${table}`);
  }

  return {
    state,
    from(table) {
      const filters = [];
      const query = {
        select() { return this; },
        eq(column, value) { filters.push((row) => row[column] === value); return this; },
        gt(column, value) { filters.push((row) => row[column] > value); return this; },
        maybeSingle: async () => {
          const rows = rowsFor(table).filter((row) => filters.every((matches) => matches(row)));
          return { data: rows[0] || null, error: null };
        },
        insert(payload) {
          const row = { ...payload, id: payload.id || `row-${++sequence}` };
          rowsFor(table).push(row);
          return {
            select() { return this; },
            single: async () => ({ data: row, error: null }),
          };
        },
      };
      return query;
    },
  };
}

async function withServer(supabase, fn) {
  const app = express();
  app.use(express.json());
  app.use(createMembershipRegistrationRoutes(supabase));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function requestBody(overrides = {}) {
  return {
    fullName: 'Test Customer',
    phone: '0812-3456-789',
    email: 'customer@example.test',
    tier: 'gold',
    ...overrides,
  };
}

test('creates a pending registration with a price snapshot', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.tier, 'gold');
    assert.equal(body.amount, 250000);
    assert.equal(body.status, 'PENDING');
    assert.ok(body.registrationId);
    assert.match(body.registrationCode, /^RBM-/);
    assert.ok(body.expiresAt);
  });
  assert.equal(supabase.state.registrations.length, 1);
  assert.equal(supabase.state.registrations[0].price_snapshot, 250000);
  assert.equal(supabase.state.registrations[0].phone_normalized, '+628123456789');
});

test('rejects missing name or invalid phone', async () => {
  for (const body of [requestBody({ fullName: '' }), requestBody({ phone: 'not-a-phone' })]) {
    const supabase = createFakeSupabase();
    await withServer(supabase, async (url) => {
      const response = await fetch(`${url}/membership/registrations`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    });
    assert.equal(supabase.state.registrations.length, 0);
    assert.equal(supabase.state.profiles.length, 0);
    assert.equal(supabase.state.customers.length, 0);
  }
});

test('rejects invalid tier without writing a row', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ tier: 'diamond' })),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid tier/i);
  });
  assert.equal(supabase.state.registrations.length, 0);
  assert.equal(supabase.state.profiles.length, 0);
  assert.equal(supabase.state.customers.length, 0);
});

test('returns an existing pending registration for the same phone and tier instead of duplicating it', async () => {
  const supabase = createFakeSupabase();
  let first;
  await withServer(supabase, async (url) => {
    const options = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ tier: 'silver' })),
    };
    first = await (await fetch(`${url}/membership/registrations`, options)).json();
    const secondResponse = await fetch(`${url}/membership/registrations`, options);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.registrationId, first.registrationId);
    assert.equal(second.registrationCode, first.registrationCode);
  });
  assert.equal(supabase.state.registrations.length, 1);
});

test('rejects a phone that already has an unexpired active membership', async () => {
  const supabase = createFakeSupabase({
    profiles: [{
      user_key: 'member-1', phone: '+628123456789', membership_status: 'ACTIVE',
      current_tier: 'silver', membership_expires_at: '2027-08-08T00:00:00.000Z',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.tier, 'silver');
    assert.equal(body.expiresAt, '2027-08-08T00:00:00.000Z');
  });
  assert.equal(supabase.state.registrations.length, 0);
});

test('does not mark the member profile ACTIVE', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody({ tier: 'platinum' })),
    });
    assert.equal(response.status, 201);
  });
  assert.equal(supabase.state.profiles.length, 1);
  assert.equal(supabase.state.profiles[0].membership_status, 'INACTIVE');
});
