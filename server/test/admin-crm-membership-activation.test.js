'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

async function withServer(supabase, fn) {
  const app = express();
  app.use(express.json());
  app.use(createAdminCrmRoutes(supabase, (_req, _res, next) => next()));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
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
