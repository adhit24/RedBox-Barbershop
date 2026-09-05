'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBackofficeSupabaseAuth,
  normalizeRole,
} = require('../middleware/backofficeSupabaseAuth');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createSupabase({ user, profile, userError = null, profileError = null }) {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: userError }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile, error: profileError }),
        }),
      }),
    }),
  };
}

test('owner email fallback matches the shared Stockist owner identity', () => {
  assert.equal(normalizeRole('Suwandi_Gunawan@Yahoo.com', 'branch_admin'), 'owner');
  assert.equal(normalizeRole('manager@redbox.test', 'manager'), 'manager');
});

test('Backoffice bearer session authorizes owner and populates verified adminAuth', async () => {
  const supabase = createSupabase({
    user: { id: 'owner-1', email: 'suwandi_gunawan@yahoo.com' },
    profile: { id: 'owner-1', name: 'Gunawan Suwandi', role: 'branch_admin', branch: 'csb' },
  });
  let legacyCalled = false;
  const middleware = createBackofficeSupabaseAuth(supabase, () => { legacyCalled = true; });
  const req = {
    hostname: 'backoffice.redboxbarbershop.com',
    headers: { authorization: 'Bearer valid-session' },
  };
  const res = createResponse();
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(legacyCalled, false);
  assert.deepEqual(req.adminAuth, {
    staffId: 'owner-1',
    role: 'owner',
    branch: null,
    sessionVerified: true,
    email: 'suwandi_gunawan@yahoo.com',
    name: 'Gunawan Suwandi',
    authSource: 'supabase',
  });
});

test('Backoffice bearer session permits manager but rejects branch_admin', async () => {
  for (const [profileRole, expected] of [['manager', 200], ['branch_admin', 403]]) {
    const supabase = createSupabase({
      user: { id: `user-${profileRole}`, email: `${profileRole}@redbox.test` },
      profile: { id: `user-${profileRole}`, name: profileRole, role: profileRole, branch: 'csb' },
    });
    const middleware = createBackofficeSupabaseAuth(supabase, () => assert.fail('legacy auth should not run'));
    const req = {
      hostname: 'backoffice.redboxbarbershop.com',
      headers: { authorization: 'Bearer valid-session' },
    };
    const res = createResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, expected);
    assert.equal(nextCalled, profileRole === 'manager');
    if (profileRole === 'manager') {
      assert.equal(req.adminAuth.role, 'manager');
      assert.equal(req.adminAuth.branch, 'csb');
    }
  }
});

test('non-Backoffice or non-bearer requests preserve legacy admin auth path', async () => {
  const supabase = createSupabase({ user: null, profile: null });
  let legacyCalls = 0;
  const middleware = createBackofficeSupabaseAuth(supabase, (_req, _res, next) => {
    legacyCalls++;
    next();
  });

  for (const req of [
    { hostname: 'admin.redboxbarbershop.com', headers: { authorization: 'Bearer anything' } },
    { hostname: 'backoffice.redboxbarbershop.com', headers: { 'x-admin-token': 'legacy' } },
  ]) {
    const res = createResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }
  assert.equal(legacyCalls, 2);
});
