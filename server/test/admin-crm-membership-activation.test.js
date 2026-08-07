'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

async function withServer(supabase, fn, { staffId = 'authenticated-staff-42' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createAdminCrmRoutes(supabase, (req, _res, next) => {
    if (staffId) req.adminAuth = { staffId };
    next();
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function createMembershipStatusSupabase({ registrations = [], profiles = [], activations = [], activation = null, activationError = null } = {}) {
  const state = { rpcCalls: [], profileReads: 0, activationReads: 0 };
  return {
    state,
    from(table) {
      if (table === 'membership_registrations') {
        return {
          select() { return this; },
          order() { return Promise.resolve({ data: structuredClone(registrations), error: null }); },
        };
      }
      if (table === 'member_profiles') {
        const query = {
          select() { return query; },
          then(resolve, reject) {
            state.profileReads += 1;
            return Promise.resolve({ data: structuredClone(profiles), error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      if (table === 'member_activations') {
        return {
          select() { return this; },
          in() { return this; },
          order() {
            state.activationReads += 1;
            return Promise.resolve({ data: structuredClone(activations), error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (activationError) return { data: null, error: { message: activationError } };
      return { data: [activation], error: null };
    },
  };
}

test('CRM activation delegates a registration to the atomic RPC with payment metadata', async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{ registration_id: args.p_registration_id, tier: 'gold', amount: 250000 }], error: null };
    },
  };
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        registrationId: '01234567-89ab-cdef-0123-456789abcdef', branch: 'csb',
        payMethod: 'qris', paymentReference: 'QRIS-123', staffId: 'staff-42',
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  });
  assert.deepEqual(calls, [{
    name: 'activate_membership_registration',
    args: {
      p_registration_id: '01234567-89ab-cdef-0123-456789abcdef',
      p_payment_method: 'qris', p_payment_reference: 'QRIS-123',
      p_branch: 'csb', p_confirmed_by: 'staff-42',
    },
  }]);
});

test('CRM rejects invalid payment methods before it can call the activation RPC', async () => {
  let rpcCalls = 0;
  await withServer({ rpc: async () => { rpcCalls++; return { data: [], error: null }; } }, async (url) => {
    const response = await fetch(`${url}/membership/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationId: 'reg-1', branch: 'csb', payMethod: 'card', paymentReference: 'CARD-1', staffId: 'staff-42' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid payment method/i);
  });
  assert.equal(rpcCalls, 0);
});

test('CRM requires a payment reference before it can call the activation RPC', async () => {
  let rpcCalls = 0;
  await withServer({ rpc: async () => { rpcCalls++; return { data: [], error: null }; } }, async (url) => {
    const response = await fetch(`${url}/membership/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationId: 'reg-1', branch: 'csb', payMethod: 'cash', paymentReference: '  ', staffId: 'staff-42' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /payment reference/i);
  });
  assert.equal(rpcCalls, 0);
});

test('CRM requires a staff identity before it can call the activation RPC', async () => {
  let rpcCalls = 0;
  await withServer({ rpc: async () => { rpcCalls++; return { data: [], error: null }; } }, async (url) => {
    const response = await fetch(`${url}/membership/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationId: 'reg-1', branch: 'csb', payMethod: 'cash', paymentReference: 'CASH-1' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /staff/i);
  });
  assert.equal(rpcCalls, 0);
});

test('legacy userKey activation creates or reuses a canonical pending registration through the RPC', async () => {
  const rpcCalls = [];
  const supabase = {
    from(table) {
      if (table === 'member_profiles') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { user_key: 'member-1', full_name: 'Member One', phone: '0812 3456 789', email: 'one@example.test' }, error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'create_membership_registration') {
        return {
          data: [{ outcome: 'CREATED', was_created: true, registration_id: 'reg-1' }],
          error: null,
        };
      }
      return { data: [{ registration_id: args.p_registration_id }], error: null };
    },
  };
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userKey: 'member-1', tier: 'silver', branch: 'csb', payMethod: 'cash', paymentReference: 'CASH-1', staffId: 'staff-42' }),
    });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(rpcCalls[0], {
    name: 'create_membership_registration',
    args: {
      p_full_name: 'Member One',
      p_phone: '+628123456789',
      p_email: 'one@example.test',
      p_tier: 'silver',
    },
  });
  assert.equal(rpcCalls[1].name, 'activate_membership_registration');
  assert.equal(rpcCalls[1].args.p_registration_id, 'reg-1');
});

test('CRM registration list exposes identity, stored amount, payment audit, periods, and derived status', async () => {
  const supabase = createMembershipStatusSupabase({
    registrations: [
      {
        id: 'pending-1', registration_code: 'RBM-PENDING', user_key: 'pending-user',
        full_name: 'Pending Person', phone: '+628111111111', email: 'pending@example.test',
        tier: 'silver', price_snapshot: 100000, status: 'PENDING',
        expires_at: '2026-08-15T10:00:00.000Z', created_at: '2026-08-08T10:00:00.000Z',
      },
      {
        id: 'active-1', registration_code: 'RBM-ACTIVE', user_key: 'active-user',
        full_name: 'Active Person', phone: '+628122222222', email: 'active@example.test',
        tier: 'gold', price_snapshot: 250000, status: 'ACTIVATED',
        expires_at: '2026-08-15T10:00:00.000Z', created_at: '2026-08-08T10:00:00.000Z',
      },
      {
        id: 'expired-1', registration_code: 'RBM-EXPIRED', user_key: 'expired-user',
        full_name: 'Expired Person', phone: '+628133333333', email: 'expired@example.test',
        tier: 'platinum', price_snapshot: 1500000, status: 'PENDING',
        expires_at: '2020-01-01T00:00:00.000Z', created_at: '2019-12-25T00:00:00.000Z',
      },
    ],
    profiles: [{
      user_key: 'active-user', membership_status: 'ACTIVE', current_tier: 'gold',
      membership_started_at: '2026-01-01T00:00:00.000Z', membership_expires_at: '2027-01-01T00:00:00.000Z',
    }],
    activations: [{
      id: 'activation-active-1', registration_id: 'active-1', amount: 250000, tier: 'gold',
      payment_method: 'qris', payment_reference: 'QRIS-2026-001', branch: 'csb',
      confirmed_by: 'authenticated-staff-42', status: 'completed',
      starts_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
      activated_at: '2026-01-01T00:00:00.000Z',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.registrations.map((row) => row.status), ['PENDING', 'ACTIVE', 'EXPIRED']);
    assert.equal(body.registrations[0].amount, 100000);
    assert.equal(body.registrations[0].pendingExpiresAt, '2026-08-15T10:00:00.000Z');
    assert.equal(body.registrations[0].paymentMethod, null);
    assert.equal(body.registrations[1].tier, 'gold');
    assert.equal(body.registrations[1].activationId, 'activation-active-1');
    assert.equal(body.registrations[1].paymentMethod, 'qris');
    assert.equal(body.registrations[1].paymentReference, 'QRIS-2026-001');
    assert.equal(body.registrations[1].branch, 'csb');
    assert.equal(body.registrations[1].confirmedBy, 'authenticated-staff-42');
    assert.equal(body.registrations[1].startsAt, '2026-01-01T00:00:00.000Z');
    assert.equal(body.registrations[1].membershipExpiresAt, '2027-01-01T00:00:00.000Z');
  });
  assert.equal(supabase.state.profileReads, 1);
  assert.equal(supabase.state.activationReads, 1);
});

test('CRM registration list matches a profile by canonical phone when the stored user key changed', async () => {
  const supabase = createMembershipStatusSupabase({
    registrations: [{
      id: 'active-phone-1', registration_code: 'RBM-PHONE', user_key: 'stale-user-key',
      full_name: 'Active By Phone', phone: '0812 3456 789', tier: 'gold', price_snapshot: 250000,
      status: 'ACTIVATED', expires_at: '2026-08-15T10:00:00.000Z',
    }],
    profiles: [{
      user_key: 'current-user-key', phone: '+628123456789', membership_status: 'ACTIVE', current_tier: 'gold',
      membership_started_at: '2026-01-01T00:00:00.000Z', membership_expires_at: '2027-01-01T00:00:00.000Z',
    }],
    activations: [{
      id: 'activation-phone-1', registration_id: 'active-phone-1', status: 'completed',
      starts_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations?status=active`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.registrations.length, 1);
    assert.equal(body.registrations[0].status, 'ACTIVE');
    assert.equal(body.registrations[0].membershipExpiresAt, '2027-01-01T00:00:00.000Z');
  });
});

test('CRM registration list filters the derived status without hiding expired history', async () => {
  const supabase = createMembershipStatusSupabase({
    registrations: [
      { id: 'pending-1', user_key: 'pending-user', tier: 'silver', price_snapshot: 100000, status: 'PENDING', expires_at: '2026-08-15T10:00:00.000Z' },
      { id: 'expired-1', user_key: 'expired-user', tier: 'gold', price_snapshot: 250000, status: 'EXPIRED', expires_at: '2026-08-01T10:00:00.000Z' },
    ],
  });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations?status=expired`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.registrations.length, 1);
    assert.equal(body.registrations[0].id, 'expired-1');
    assert.equal(body.registrations[0].status, 'EXPIRED');
  });
});

test('CRM registration list marks an old paid period expired even when the member has a newer active period', async () => {
  const supabase = createMembershipStatusSupabase({
    registrations: [{
      id: 'old-paid-registration', user_key: 'member-1', tier: 'silver', price_snapshot: 100000,
      status: 'ACTIVATED', expires_at: '2025-08-01T00:00:00.000Z',
    }],
    profiles: [{
      user_key: 'member-1', phone: '+628123456789', membership_status: 'ACTIVE',
      membership_started_at: '2026-08-08T00:00:00.000Z', membership_expires_at: '2027-08-08T00:00:00.000Z',
    }],
    activations: [{
      id: 'old-activation', registration_id: 'old-paid-registration', status: 'completed',
      starts_at: '2024-08-01T00:00:00.000Z', expires_at: '2025-08-01T00:00:00.000Z',
    }],
  });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations?status=expired`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.registrations.length, 1);
    assert.equal(body.registrations[0].status, 'EXPIRED');
    assert.equal(body.registrations[0].membershipExpiresAt, '2025-08-01T00:00:00.000Z');
  });
});

test('CRM registration list rejects unsupported status filters', async () => {
  const supabase = createMembershipStatusSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations?status=cancelled`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid membership registration status/i);
  });
  assert.equal(supabase.state.profileReads, 0);
  assert.equal(supabase.state.activationReads, 0);
});

test('CRM registration activation uses the stored registration only and returns the atomic period', async () => {
  const activation = {
    registration_id: '01234567-89ab-cdef-0123-456789abcdef', activation_id: 'activation-1',
    tier: 'gold', amount: 250000, starts_at: '2026-08-08T10:00:00.000Z', expires_at: '2027-08-08T10:00:00.000Z',
  };
  const supabase = createMembershipStatusSupabase({ activation });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations/01234567-89ab-cdef-0123-456789abcdef/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: 1, tier: 'silver', branch: 'csb', payMethod: 'qris',
        paymentReference: 'QRIS-123', staffId: 'spoofed-client-staff',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true, registrationId: activation.registration_id, activationId: 'activation-1',
      tier: 'gold', amount: 250000, startsAt: '2026-08-08T10:00:00.000Z', expiresAt: '2027-08-08T10:00:00.000Z',
    });
  });
  assert.deepEqual(supabase.state.rpcCalls, [{
    name: 'activate_membership_registration',
    args: {
      p_registration_id: activation.registration_id, p_payment_method: 'qris',
      p_payment_reference: 'QRIS-123', p_branch: 'csb', p_confirmed_by: 'authenticated-staff-42',
    },
  }]);
});

test('CRM registration activation validates method, payment reference, and branch before the atomic function', async () => {
  const supabase = createMembershipStatusSupabase();
  const invalidBodies = [
    [{ branch: 'csb', payMethod: 'card', paymentReference: 'CARD-1' }, /invalid payment method/i],
    [{ branch: 'csb', payMethod: 'cash', paymentReference: ' ' }, /payment reference/i],
    [{ branch: ' ', payMethod: 'cash', paymentReference: 'CASH-1' }, /branch/i],
  ];
  for (const [body, errorPattern] of invalidBodies) {
    await withServer(supabase, async (url) => {
      const response = await fetch(`${url}/membership/registrations/reg-1/activate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, errorPattern);
    });
  }
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test('CRM registration activation requires staff identity supplied by admin authentication', async () => {
  const supabase = createMembershipStatusSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations/reg-1/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'csb', payMethod: 'cash', paymentReference: 'CASH-1', staffId: 'client-staff' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /authenticated staff identity/i);
  }, { staffId: null });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test('CRM registration activation returns duplicate and active-member conflicts without claiming success', async () => {
  for (const message of ['membership registration is not pending', 'active membership already exists']) {
    const supabase = createMembershipStatusSupabase({ activationError: message });
    await withServer(supabase, async (url) => {
      const response = await fetch(`${url}/membership/registrations/reg-1/activate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'csb', payMethod: 'cash', paymentReference: 'CASH-1' }),
      });
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.success, undefined);
      assert.match(body.error, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    });
    assert.equal(supabase.state.rpcCalls.length, 1);
  }
});

test('CRM registration activation reports an RPC failure without any separate table write', async () => {
  const tableWrites = [];
  const supabase = {
    from(table) {
      tableWrites.push(table);
      throw new Error('route must not perform separate writes');
    },
    async rpc() { return { data: null, error: { message: 'activation transaction rolled back' } }; },
  };
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations/reg-1/activate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'csb', payMethod: 'transfer', paymentReference: 'TRX-1' }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /rolled back/i);
  });
  assert.deepEqual(tableWrites, []);
});
