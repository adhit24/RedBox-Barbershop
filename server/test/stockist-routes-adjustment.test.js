'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase() {
  const state = { rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: [WAREHOUSE, CSB].filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'outlets') {
        return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { id: 'outlet-csb' }, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) { state.rpcCalls.push({ name, args }); return { data: { id: 'ledger-1' }, error: null }; },
  };
}

test('POST /inventory/adjustment applies an ADJUSTMENT movement for owner with a reason', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'warehouse', quantity_delta: -2, reason: 'koreksi salah input' }),
    });
    assert.equal(res.status, 200);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'ADJUSTMENT');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, -2);
  }, { role: 'owner' });
});

test('POST /inventory/adjustment rejects a missing reason', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'warehouse', quantity_delta: -2 }),
    });
    assert.equal(res.status, 400);
    assert.equal(supabase.state.rpcCalls.length, 0);
  }, { role: 'owner' });
});

test('POST /inventory/adjustment is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'branch', location_branch: 'csb', quantity_delta: 2, reason: 'koreksi' }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});
