'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrmLegacy');

function buildAppWithAuth(supabase, authContext) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = authContext;
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

test('GET /api/admin/crm/role-counts returns aggregate data only for owner', async () => {
  const mockUsers = [
    { id: 'u1', email: 'owner1@redbox.id', role: 'owner' },
    { id: 'u2', email: 'owner2@redbox.id', role: 'owner' },
    { id: 'u3', email: 'admin1@redbox.id', role: 'branch_admin' },
    { id: 'u4', email: 'admin2@redbox.id', role: 'branch_admin' },
    { id: 'u5', email: 'admin3@redbox.id', role: 'branch_admin' },
    { id: 'u6', email: 'admin4@redbox.id', role: 'branch_admin' },
    { id: 'u7', email: 'admin5@redbox.id', role: 'branch_admin' },
  ];

  const fakeSupabase = {
    from(table) {
      if (table === 'users') {
        return {
          select(fields) {
            // Verify endpoint only queries 'role'
            assert.equal(fields, 'role');
            return Promise.resolve({ data: mockUsers.map(u => ({ role: u.role })), error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const app = buildAppWithAuth(fakeSupabase, {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });

  const server = app.listen(0);
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/role-counts`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.roles, {
    owner: 2,
    branch_admin: 5,
    manager: 0,
    hr: 0,
  });

  // Verify privacy: NO email, password, tokens, salary or user IDs in response
  const bodyString = JSON.stringify(body);
  assert.equal(bodyString.includes('owner1@redbox.id'), false);
  assert.equal(bodyString.includes('email'), false);
  assert.equal(bodyString.includes('password'), false);
  assert.equal(bodyString.includes('salary'), false);
  assert.equal(bodyString.includes('u1'), false);

  server.close();
});

test('GET /api/admin/crm/role-counts fails closed (403) for non-owner or unverified roles', async () => {
  const fakeSupabase = {
    from() {
      throw new Error('Should not query DB when unauthorized');
    },
  };

  // Case 1: branch_admin role
  const appAdmin = buildAppWithAuth(fakeSupabase, {
    staffId: 'admin-1',
    role: 'branch_admin',
    sessionVerified: true,
  });
  const s1 = appAdmin.listen(0);
  const resAdmin = await fetch(`http://127.0.0.1:${s1.address().port}/api/admin/crm/role-counts`);
  assert.equal(resAdmin.status, 403);
  s1.close();

  // Case 2: unverified session
  const appUnverified = buildAppWithAuth(fakeSupabase, {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: false,
  });
  const s2 = appUnverified.listen(0);
  const resUnverified = await fetch(`http://127.0.0.1:${s2.address().port}/api/admin/crm/role-counts`);
  assert.equal(resUnverified.status, 403);
  s2.close();

  // Case 3: manager role
  const appManager = buildAppWithAuth(fakeSupabase, {
    staffId: 'manager-1',
    role: 'manager',
    sessionVerified: true,
  });
  const s3 = appManager.listen(0);
  const resManager = await fetch(`http://127.0.0.1:${s3.address().port}/api/admin/crm/role-counts`);
  assert.equal(resManager.status, 403);
  s3.close();
});
