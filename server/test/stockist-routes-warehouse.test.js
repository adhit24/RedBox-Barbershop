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
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function fakeSupabase({ locations = [], balances = [], products = [] } = {}) {
  const state = { locations, balances, products, rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'products') {
        const query = {
          _filters: [],
          select() { return query; },
          in(col, vals) { query._filters.push((row) => vals.includes(row[col])); return query; },
          then(resolve, reject) {
            const rows = state.products.filter((row) => query._filters.every((f) => f(row)));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      if (table === 'inventory_locations') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(col, val) { query._filters.push((row) => row[col] === val); return query; },
          then(resolve, reject) {
            const rows = state.locations.filter((row) => query._filters.every((f) => f(row)));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      if (table === 'inventory_balances') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(col, val) { query._filters.push((row) => row[col] === val); return query; },
          then(resolve, reject) {
            const rows = state.balances.filter((row) => query._filters.every((f) => f(row)));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: { id: 'ledger-1', quantity_after: (args.p_quantity_delta || 0) }, error: null };
    },
  };
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };

test('POST /warehouse/receive applies a WAREHOUSE_RECEIVE movement for owner', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 50, reason: 'invoice #INV-001' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'WAREHOUSE_RECEIVE');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, 50);
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-warehouse');
    assert.equal(body.ledger.quantity_after, 50);
  }, { role: 'owner' });
});

test('POST /warehouse/receive is rejected for branch_admin', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 50 }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /warehouse/receive rejects an inactive product', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE], products: [{ id: 'p1', sku: 'RB-OLD-001', is_active: false }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 50 }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /inactive/);
    assert.equal(supabase.state.rpcCalls.length, 0);
  }, { role: 'owner' });
});

test('POST /warehouse/receive rejects zero or negative quantity', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 0 }),
    });
    assert.equal(res.status, 400);
  }, { role: 'owner' });
});

test('GET /inventory/summary?location=warehouse works for owner only', async () => {
  const supabase = fakeSupabase({
    locations: [WAREHOUSE],
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 40 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=warehouse`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.balances[0].quantity, 40);
  }, { role: 'owner' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=warehouse`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /inventory/summary?location=<branch> is scoped to the caller branch', async () => {
  const csbLocation = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };
  const supabase = fakeSupabase({
    locations: [WAREHOUSE, csbLocation],
    balances: [{ product_id: 'p1', location_id: 'loc-csb', quantity: 12 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=csb`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});
