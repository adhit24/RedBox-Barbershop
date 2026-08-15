'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getVerifiedStockistAccess,
  resolveStockistLocationScope,
} = require('../services/stockistAccess');

test('getVerifiedStockistAccess accepts a verified owner session', () => {
  const req = { adminAuth: { staffId: 'owner-1', role: 'owner', branch: null, sessionVerified: true } };
  assert.deepEqual(getVerifiedStockistAccess(req), { role: 'owner', branch: null, staffId: 'owner-1' });
});

test('getVerifiedStockistAccess accepts a verified branch_admin session with a valid branch', () => {
  const req = { adminAuth: { staffId: 'admin-csb', role: 'branch_admin', branch: 'csb', sessionVerified: true } };
  assert.deepEqual(getVerifiedStockistAccess(req), { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});

test('getVerifiedStockistAccess rejects unverified sessions, unknown roles, barbers, and bad branches', () => {
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'owner', branch: null, sessionVerified: false } }), null);
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'barber', branch: null, sessionVerified: true } }), null);
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'branch_admin', branch: 'not-a-branch', sessionVerified: true } }), null);
  assert.equal(getVerifiedStockistAccess({}), null);
});

test('resolveStockistLocationScope: owner may act on the warehouse or any branch', () => {
  const owner = { role: 'owner', branch: null, staffId: 'owner-1' };
  assert.deepEqual(resolveStockistLocationScope(owner, 'warehouse', null), { ok: true, branch: null });
  assert.deepEqual(resolveStockistLocationScope(owner, 'branch', 'tegal'), { ok: true, branch: 'tegal' });
});

test('resolveStockistLocationScope: owner rejects an invalid branch slug', () => {
  const owner = { role: 'owner', branch: null, staffId: 'owner-1' };
  assert.deepEqual(resolveStockistLocationScope(owner, 'branch', 'nowhere'), { ok: false, status: 400, error: 'invalid branch' });
});

test('resolveStockistLocationScope: branch_admin may only act on their own branch, never the warehouse', () => {
  const csbAdmin = { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' };
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'branch', 'csb'), { ok: true, branch: 'csb' });
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'branch', 'tegal'), { ok: false, status: 403, error: 'branch access denied' });
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'warehouse', null), { ok: false, status: 403, error: 'branch access denied' });
});
