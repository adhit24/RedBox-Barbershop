'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRevenueSharingRoutes } = require('../routes/revenueSharing');

function makeApp({ role = 'owner', branch = null, mockSupabase }) {
  const app = express();
  app.use(express.json());

  // Inject req.adminAuth mock to simulate createBackofficeSupabaseAuth
  app.use((req, _res, next) => {
    req.adminAuth = {
      role,
      branch: (role === 'manager' || role === 'branch_admin') ? branch : null,
      staffId: 'user-123',
      email: role === 'owner' ? 'owner@redbox.id' : 'manager@redbox.id',
    };
    next();
  });

  const dummyLegacyAuth = (_req, _res, next) => next();
  app.use('/api/payroll/revenue-sharing', createRevenueSharingRoutes(mockSupabase, dummyLegacyAuth));
  return app;
}

test('Revenue Sharing Route Security Tests', async (t) => {

  await t.test('POST /rates is blocked for Manager with 403 Forbidden', async () => {
    const mockSupabase = {};
    const app = makeApp({ role: 'manager', branch: 'bypass', mockSupabase });

    const server = app.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/payroll/revenue-sharing/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barberId: 'b1', rate: 0.35, effectiveFrom: '2026-10-01' }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.match(json.error, /Only Owner can configure/);
    } finally {
      server.close();
    }
  });

  await t.test('GET /preview enforces branch scoping for Manager', async () => {
    const mockSupabase = {
      from(table) {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      },
    };

    const app = makeApp({ role: 'manager', branch: 'csb', mockSupabase });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      // Manager of 'csb' trying to query 'bypass' must receive 403
      const res = await fetch(`http://127.0.0.1:${port}/api/payroll/revenue-sharing/preview?branch=bypass`);
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.match(json.error, /restricted to branch csb/);
    } finally {
      server.close();
    }
  });

});
