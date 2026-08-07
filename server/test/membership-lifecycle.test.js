'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

async function withServer(supabase, fn, {
  staffId = 'staff-session-42', role = 'owner', branch = null, sessionVerified = true,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(createAdminCrmRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function changeSupabase({
  sourceBranch = 'csb', wasCreated = true, registrationType = 'RENEWAL',
  destinationTier = 'silver', amount = 100000, rpcError = null,
} = {}) {
  const state = { rpcCalls: [], activationReads: 0 };
  return {
    state,
    from(table) {
      assert.equal(table, 'member_activations');
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          state.activationReads += 1;
          return {
            data: { registration_id: 'source-registration', branch: sourceBranch, status: 'completed' },
            error: null,
          };
        },
      };
      return query;
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: { message: rpcError } };
      return {
        data: [{
          outcome: wasCreated ? 'CREATED' : 'EXISTING_PENDING',
          was_created: wasCreated,
          registration_id: 'pending-change',
          registration_code: 'RBM-CHANGE',
          tier: destinationTier,
          amount,
          status: 'PENDING',
          expires_at: '2026-08-15T10:00:00.000Z',
          registration_type: registrationType,
          source_registration_id: 'source-registration',
        }],
        error: null,
      };
    },
  };
}

test('expired member renewal creates a full-price Pending registration from trusted staff and source branch', async () => {
  const supabase = changeSupabase();
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations/source-registration/change`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'silver', amount: 1, branch: 'tegal', staffId: 'spoofed' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      registrationId: 'pending-change', registrationCode: 'RBM-CHANGE', tier: 'silver',
      amount: 100000, status: 'PENDING', expiresAt: '2026-08-15T10:00:00.000Z',
      registrationType: 'RENEWAL', sourceRegistrationId: 'source-registration',
    });
  });
  assert.deepEqual(supabase.state.rpcCalls, [{
    name: 'create_membership_change_registration',
    args: {
      p_source_registration_id: 'source-registration', p_tier: 'silver',
      p_requested_by: 'staff-session-42', p_requested_branch: 'csb',
    },
  }]);
});

test('active member upgrade uses the full destination-tier snapshot and duplicate request is idempotent', async () => {
  for (const wasCreated of [true, false]) {
    const supabase = changeSupabase({
      wasCreated, registrationType: 'UPGRADE', destinationTier: 'platinum', amount: 1500000,
    });
    await withServer(supabase, async (url) => {
      const response = await fetch(`${url}/membership/registrations/source-registration/change`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier: 'platinum', amount: 100000 }),
      });
      assert.equal(response.status, wasCreated ? 201 : 200);
      const body = await response.json();
      assert.equal(body.amount, 1500000);
      assert.equal(body.registrationType, 'UPGRADE');
      assert.equal(body.status, 'PENDING');
    });
    assert.equal(supabase.state.rpcCalls.length, 1);
  }
});

test('branch admin cannot create renewal or upgrade from another branch', async () => {
  const supabase = changeSupabase({ sourceBranch: 'tegal' });
  await withServer(supabase, async (url) => {
    const response = await fetch(`${url}/membership/registrations/source-registration/change`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'gold' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /branch access denied/i);
  }, { role: 'branch_admin', branch: 'csb' });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test('membership change maps business conflicts to 409 and infrastructure failures to 500', async () => {
  for (const [message, expectedStatus] of [
    ['upgrade destination tier must be higher than current tier', 409],
    ['source membership registration is not the latest paid period', 409],
    ['database connection unavailable', 500],
  ]) {
    const supabase = changeSupabase({ rpcError: message });
    await withServer(supabase, async (url) => {
      const response = await fetch(`${url}/membership/registrations/source-registration/change`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier: 'gold' }),
      });
      assert.equal(response.status, expectedStatus);
      assert.match((await response.json()).error, new RegExp(message, 'i'));
    });
  }
});

test('renewal and upgrade lifecycle SQL preserves activation history and starts each activation for one year', () => {
  const migration = fs.readFileSync(path.join(
    __dirname, '..', 'migrations', '2026-08-08-paid-membership-registration.sql'
  ), 'utf8');
  const changeStart = migration.indexOf('CREATE OR REPLACE FUNCTION create_membership_change_registration');
  const activationStart = migration.indexOf('CREATE OR REPLACE FUNCTION activate_membership_registration');
  assert.ok(changeStart >= 0 && activationStart > changeStart);
  const changeSql = migration.slice(changeStart, activationStart);
  const activationSql = migration.slice(activationStart);

  assert.match(changeSql, /v_kind := 'UPGRADE'/);
  assert.match(changeSql, /v_kind := 'RENEWAL'/);
  assert.match(changeSql, /p_tier, v_price, v_kind/);
  assert.match(changeSql, /source membership registration is not the latest paid period/);
  assert.match(changeSql, /'EXISTING_PENDING'::TEXT, FALSE/);
  assert.match(activationSql, /v_expires_at TIMESTAMPTZ := v_now \+ INTERVAL '1 year'/);
  assert.match(activationSql, /r\.registration_type <> 'UPGRADE'/);
  assert.doesNotMatch(changeSql, /(?:UPDATE|DELETE FROM)\s+member_activations/i);
  assert.doesNotMatch(activationSql, /(?:UPDATE|DELETE FROM)\s+member_activations/i);
});

test('CRM list expires stale Pending rows before reading registrations', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminCrm.js'), 'utf8');
  const listStart = route.indexOf("router.get('/membership/registrations'");
  const changeStart = route.indexOf("router.post('/membership/registrations/:registrationId/change'");
  const listRoute = route.slice(listStart, changeStart);
  assert.ok(listRoute.indexOf('await expirePendingMembershipRegistrations(supabase, now)')
    < listRoute.indexOf(".from('membership_registrations')"));
});
