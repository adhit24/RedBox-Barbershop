'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createMembershipRegistrationRoutes } = require('../routes/adminCrm');
const {
  createMembershipRegistrationRateLimiters,
  getTierPrice,
  normalizePhone,
} = require('../services/membershipRegistration');

function canonicalOrNull(value) {
  try {
    return normalizePhone(value);
  } catch (_) {
    return null;
  }
}

function isActive(row, now) {
  if (row?.membership_status !== 'ACTIVE') return false;
  if (row.membership_expires_at && new Date(row.membership_expires_at) > now) return true;
  return !row.membership_started_at && !row.membership_expires_at;
}

function createFakeSupabase(seed = {}) {
  const state = {
    profiles: structuredClone(seed.profiles || []),
    customers: structuredClone(seed.customers || []),
    registrations: structuredClone(seed.registrations || []),
    rpcCalls: [],
  };
  const now = new Date(seed.now || '2026-08-08T10:00:00.000Z');
  const locks = new Map();
  let sequence = state.registrations.length;

  function restore(target, snapshot) {
    target.splice(0, target.length, ...snapshot);
  }

  function serialized(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.then(fn, fn);
    locks.set(key, current.catch(() => {}));
    return current;
  }

  return {
    state,
    async rpc(name, args) {
      assert.equal(name, 'create_membership_registration');
      state.rpcCalls.push({ name, args: { ...args } });
      const phone = normalizePhone(args.p_phone);

      return serialized(phone, async () => {
        // Yield once so Promise.all tests exercise overlapping endpoint calls.
        await Promise.resolve();
        const snapshot = {
          profiles: structuredClone(state.profiles),
          customers: structuredClone(state.customers),
          registrations: structuredClone(state.registrations),
        };

        try {
          const activeProfile = state.profiles.find((profile) => (
            canonicalOrNull(profile.phone) === phone && isActive(profile, now)
          ));
          const activeCustomer = state.customers.find((customer) => (
            (canonicalOrNull(customer.phone_e164) === phone || canonicalOrNull(customer.wa) === phone)
            && isActive(customer, now)
          ));
          if (activeProfile || activeCustomer) {
            const active = activeProfile || activeCustomer;
            return { data: [{
              outcome: 'ACTIVE_MEMBERSHIP',
              was_created: false,
              tier: args.p_tier,
              amount: getTierPrice(args.p_tier),
              active_tier: active.current_tier || null,
              active_expires_at: active.membership_expires_at || null,
            }], error: null };
          }

          for (const registration of state.registrations) {
            if (
              registration.phone_normalized === phone
              && registration.tier === args.p_tier
              && registration.status === 'PENDING'
              && new Date(registration.expires_at) <= now
            ) registration.status = 'EXPIRED';
          }
          const existing = state.registrations.find((registration) => (
            registration.phone_normalized === phone
            && registration.tier === args.p_tier
            && registration.status === 'PENDING'
            && new Date(registration.expires_at) > now
          ));
          if (existing) {
            return { data: [{
              outcome: 'EXISTING_PENDING',
              was_created: false,
              registration_id: existing.id,
              registration_code: existing.registration_code,
              tier: existing.tier,
              amount: existing.price_snapshot,
              status: existing.status,
              expires_at: existing.expires_at,
            }], error: null };
          }

          let profile = state.profiles.find((row) => canonicalOrNull(row.phone) === phone);
          let customer = state.customers.find((row) => (
            canonicalOrNull(row.phone_e164) === phone || canonicalOrNull(row.wa) === phone
          ));
          const email = args.p_email || profile?.email || customer?.email
            || `member_${phone.slice(3)}@redbox.internal`;

          if (!profile) {
            profile = {
              id: `profile-${++sequence}`,
              user_key: `member_${phone.slice(1)}`,
              full_name: args.p_full_name,
              email,
              phone,
              membership_status: 'INACTIVE',
              membership_started_at: null,
              membership_expires_at: null,
              current_tier: null,
            };
            state.profiles.push(profile);
          }
          if (seed.failAt === 'profile') throw new Error('simulated profile write failure');

          if (!customer) {
            customer = {
              id: `customer-${++sequence}`,
              wa: phone.slice(1),
              phone_e164: phone,
              name: args.p_full_name,
              email,
              membership_status: 'INACTIVE',
              membership_started_at: null,
              membership_expires_at: null,
            };
            state.customers.push(customer);
          }
          if (seed.failAt === 'customer') throw new Error('simulated customer write failure');

          const expiresAt = new Date(now);
          expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
          const registration = {
            id: `registration-${++sequence}`,
            registration_code: `RBM-${String(sequence).padStart(12, '0')}`,
            user_key: profile.user_key,
            full_name: args.p_full_name,
            phone,
            phone_normalized: phone,
            email,
            tier: args.p_tier,
            price_snapshot: getTierPrice(args.p_tier),
            status: 'PENDING',
            expires_at: expiresAt.toISOString(),
          };
          state.registrations.push(registration);
          if (seed.failAt === 'registration') throw new Error('simulated registration write failure');

          return { data: [{
            outcome: 'CREATED',
            was_created: true,
            registration_id: registration.id,
            registration_code: registration.registration_code,
            tier: registration.tier,
            amount: registration.price_snapshot,
            status: registration.status,
            expires_at: registration.expires_at,
          }], error: null };
        } catch (error) {
          restore(state.profiles, snapshot.profiles);
          restore(state.customers, snapshot.customers);
          restore(state.registrations, snapshot.registrations);
          return { data: null, error: { message: error.message } };
        }
      });
    },
  };
}

async function withServer(supabase, fn, { rateLimiters = [], trustProxy = false } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  app.use(createMembershipRegistrationRoutes(supabase, { rateLimiters }));
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

function postRegistration(url, body = requestBody(), forwardedIp = '203.0.113.10') {
  const headers = { 'content-type': 'application/json' };
  if (forwardedIp) headers['x-forwarded-for'] = forwardedIp;
  return fetch(`${url}/membership/registrations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('creates a pending registration with a fixed price snapshot through the atomic RPC', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const response = await postRegistration(url);
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

test('rejects missing name and invalid or short phones before calling the RPC', async () => {
  const invalidBodies = [
    requestBody({ fullName: '' }),
    requestBody({ phone: 'not-a-phone' }),
    requestBody({ phone: '08123' }),
  ];
  for (const body of invalidBodies) {
    const supabase = createFakeSupabase();
    await withServer(supabase, async (url) => {
      assert.equal((await postRegistration(url, body)).status, 400);
    });
    assert.equal(supabase.state.rpcCalls.length, 0);
    assert.equal(supabase.state.registrations.length, 0);
    assert.equal(supabase.state.profiles.length, 0);
    assert.equal(supabase.state.customers.length, 0);
  }
});

test('rejects invalid tier without writing any identity or registration row', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const response = await postRegistration(url, requestBody({ tier: 'diamond' }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid tier/i);
  });
  assert.equal(supabase.state.rpcCalls.length, 0);
  assert.equal(supabase.state.registrations.length, 0);
  assert.equal(supabase.state.profiles.length, 0);
  assert.equal(supabase.state.customers.length, 0);
});

test('concurrent canonical variants return one non-expired pending registration', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    const [first, second] = await Promise.all([
      postRegistration(url, requestBody({ phone: '0812-3456-789', tier: 'silver' })),
      postRegistration(url, requestBody({ phone: '+62 812 3456 789', tier: 'silver' }), '203.0.113.11'),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.equal(firstBody.registrationId, secondBody.registrationId);
    assert.equal(firstBody.registrationCode, secondBody.registrationCode);
    assert.equal(firstBody.amount, 100000);
    assert.equal(secondBody.amount, 100000);
  });
  assert.equal(supabase.state.registrations.length, 1);
});

test('resolves legacy profile and customer phone formats without duplicate identities', async () => {
  const supabase = createFakeSupabase({
    profiles: [{
      id: 'profile-legacy', user_key: 'legacy-user', phone: '0812 3456 789',
      email: 'legacy@example.test', membership_status: 'INACTIVE',
    }],
    customers: [{
      id: 'customer-legacy', wa: '628123456789', phone_e164: '+628111111111',
      email: 'legacy@example.test', membership_status: 'INACTIVE',
    }],
  });
  await withServer(supabase, async (url) => {
    assert.equal((await postRegistration(url, requestBody({ phone: '+628123456789' }))).status, 201);
  });
  assert.equal(supabase.state.profiles.length, 1);
  assert.equal(supabase.state.customers.length, 1);
  assert.equal(supabase.state.profiles[0].phone, '0812 3456 789');
  assert.equal(supabase.state.customers[0].wa, '628123456789');
  assert.equal(supabase.state.registrations[0].user_key, 'legacy-user');
});

test('rejects active customer when wa matches even if phone_e164 contains another valid number', async () => {
  const supabase = createFakeSupabase({
    customers: [{
      id: 'customer-active',
      wa: '628123456789',
      phone_e164: '+628111111111',
      membership_status: 'ACTIVE',
      membership_started_at: '2026-08-08T00:00:00.000Z',
      membership_expires_at: '2027-08-08T00:00:00.000Z',
      current_tier: 'gold',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await postRegistration(url, requestBody({ phone: '+628123456789' }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.tier, 'gold');
    assert.equal(body.expiresAt, '2027-08-08T00:00:00.000Z');
  });
  assert.equal(supabase.state.registrations.length, 0);
});

test('rejects a canonical phone that already has an unexpired active membership', async () => {
  const supabase = createFakeSupabase({
    profiles: [{
      id: 'profile-active', user_key: 'member-1', phone: '0812-3456-789',
      membership_status: 'ACTIVE', membership_started_at: '2026-08-08T00:00:00.000Z',
      current_tier: 'silver', membership_expires_at: '2027-08-08T00:00:00.000Z',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await postRegistration(url, requestBody({ phone: '+628123456789' }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.tier, 'silver');
    assert.equal(body.expiresAt, '2027-08-08T00:00:00.000Z');
  });
  assert.equal(supabase.state.registrations.length, 0);
});

test('does not mark newly created profile or customer ACTIVE', async () => {
  const supabase = createFakeSupabase();
  await withServer(supabase, async (url) => {
    assert.equal((await postRegistration(url, requestBody({ tier: 'platinum' }))).status, 201);
  });
  assert.equal(supabase.state.profiles[0].membership_status, 'INACTIVE');
  assert.equal(supabase.state.customers[0].membership_status, 'INACTIVE');
});

test('rolls back profile and customer creation when registration creation fails', async () => {
  const supabase = createFakeSupabase({ failAt: 'registration' });
  await withServer(supabase, async (url) => {
    const response = await postRegistration(url);
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /simulated registration write failure/i);
  });
  assert.equal(supabase.state.profiles.length, 0);
  assert.equal(supabase.state.customers.length, 0);
  assert.equal(supabase.state.registrations.length, 0);
});

test('rate limits canonical phone variants before any rejected-request write', async () => {
  const supabase = createFakeSupabase();
  const rateLimiters = createMembershipRegistrationRateLimiters({ maxPerIp: 10, maxPerPhone: 1 });
  await withServer(supabase, async (url) => {
    assert.equal((await postRegistration(url, requestBody({ phone: '0812-3456-789' }), '203.0.113.20')).status, 201);
    const rejected = await postRegistration(url, requestBody({ phone: '+62 812 3456 789' }), '203.0.113.21');
    assert.equal(rejected.status, 429);
    assert.match((await rejected.json()).error, /nomor ini/i);
    assert.ok(rejected.headers.get('retry-after'));
  }, { rateLimiters });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.registrations.length, 1);
});

test('ignores spoofed forwarded IPs when the direct connection is not a trusted proxy', async () => {
  const supabase = createFakeSupabase();
  const rateLimiters = createMembershipRegistrationRateLimiters({ maxPerIp: 1, maxPerPhone: 10 });
  await withServer(supabase, async (url) => {
    assert.equal((await postRegistration(url, requestBody({ phone: '0812-3456-789' }), '203.0.113.30')).status, 201);
    const rejected = await postRegistration(
      url,
      requestBody({ phone: '0821-9876-5432' }),
      '198.51.100.90'
    );
    assert.equal(rejected.status, 429);
    assert.match((await rejected.json()).error, /jaringan ini/i);
  }, { rateLimiters });
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.registrations.length, 1);
});

test('uses Express trusted-proxy resolution for distinct forwarded clients', async () => {
  const supabase = createFakeSupabase();
  const rateLimiters = createMembershipRegistrationRateLimiters({ maxPerIp: 1, maxPerPhone: 10 });
  await withServer(supabase, async (url) => {
    assert.equal((await postRegistration(
      url,
      requestBody({ phone: '0812-3456-789' }),
      '203.0.113.40'
    )).status, 201);
    assert.equal((await postRegistration(
      url,
      requestBody({ phone: '0821-9876-5432' }),
      '198.51.100.40'
    )).status, 201);
    const rejected = await postRegistration(
      url,
      requestBody({ phone: '0857-1111-2222' }),
      '203.0.113.40'
    );
    assert.equal(rejected.status, 429);
  }, { rateLimiters, trustProxy: 1 });
  assert.equal(supabase.state.rpcCalls.length, 2);
  assert.equal(supabase.state.registrations.length, 2);
});
