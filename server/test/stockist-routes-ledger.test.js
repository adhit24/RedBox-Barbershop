'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'admin-csb', role = 'branch_admin', branch = 'csb' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified: true };
    next();
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}

function fakeSupabase() {
  const outlets = [
    { id: 'outlet-csb', slug: 'csb', name: 'CSB Mall' },
    { id: 'outlet-samadikun', slug: 'samadikun', name: 'Samadikun' },
  ];
  const locations = [
    { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' },
    { id: 'loc-samadikun', type: 'branch', outlet_id: 'outlet-samadikun' },
  ];
  const ledger = [
    { id: 'ledger-1', product_id: 'p1', location_id: 'loc-csb', movement_type: 'SALE_RETAIL', quantity_delta: -1, created_at: '2026-08-20T01:00:00Z' },
    { id: 'ledger-2', product_id: 'p2', location_id: 'loc-samadikun', movement_type: 'TRANSFER_IN', quantity_delta: 5, created_at: '2026-08-20T02:00:00Z' },
    { id: 'ledger-3', product_id: 'p1', location_id: 'loc-csb', movement_type: 'ADJUSTMENT', quantity_delta: 2, created_at: '2026-08-20T03:00:00Z' },
  ];
  const tables = { outlets, inventory_locations: locations, inventory_ledger: ledger };

  function query(table) {
    const state = { filters: [], order: null };
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return q; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return q; },
      order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return q; },
      single: async () => {
        const rows = evaluate();
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: evaluate(), error: null }).then(resolve, reject); },
    };
    function evaluate() {
      let rows = tables[table] || [];
      rows = rows.filter((row) => state.filters.every((filter) => filter(row)));
      if (state.order) rows = [...rows].sort((a, b) => (state.order.ascending ? 1 : -1) * String(a[state.order.column]).localeCompare(String(b[state.order.column])));
      return rows;
    }
    return q;
  }

  return { from: query };
}

test('GET /inventory/ledger returns every location for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ledger.length, 3);
  }, { role: 'owner', branch: null, staffId: 'owner-1' });
});

test('GET /inventory/ledger scopes branch_admin to their own location only', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ledger.length, 2);
    assert.ok(body.ledger.every((row) => row.location_id === 'loc-csb'));
  }, { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});

test('GET /inventory/ledger ignores any client-supplied location for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger?location_id=loc-samadikun`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.ledger.every((row) => row.location_id === 'loc-csb'));
  }, { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});
