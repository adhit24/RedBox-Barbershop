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
const BYPASS = { id: 'loc-bypass', type: 'branch', outlet_id: 'outlet-bypass' };

function fakeSupabase({
  locations = [WAREHOUSE, BYPASS],
    outlets = [{ id: 'outlet-bypass', name: 'RedBox Bypass', slug: 'bypass' }],
  balances = [], products = [],
  requests = [], requestItems = [],
  transfers = [], transferItems = [],
  opnames = [], opnameItems = [],
} = {}) {
  const state = { locations, outlets, balances, products, requests, requestItems, transfers, transferItems, opnames, opnameItems };

  function readOnlyTable(list) {
    const query = {
      _filters: [],
      select() { return query; },
      eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
      then(res, rej) { return Promise.resolve({ data: list.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); },
    };
    return query;
  }

  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) {
            // Mimics Supabase's `outlet:outlets(name)` embed so getLocationNames()
            // resolves a friendly branch name instead of falling back to the raw id.
            const rows = state.locations
              .filter((r) => query._filters.every((f) => f(r)))
              .map((r) => ({ ...r, outlet: state.outlets.find((o) => o.id === r.outlet_id) || null }));
            return Promise.resolve({ data: rows, error: null }).then(res, rej);
          } };
        return query;
      }
      if (table === 'outlets') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          single: async () => ({ data: state.outlets.find((r) => query._filters.every((f) => f(r))) || null, error: null }) };
        return query;
      }
      if (table === 'inventory_balances') return readOnlyTable(state.balances);
      if (table === 'products') return readOnlyTable(state.products);
      if (table === 'stock_requests') return readOnlyTable(state.requests);
      if (table === 'stock_request_items') return readOnlyTable(state.requestItems);
      if (table === 'stock_transfers') return readOnlyTable(state.transfers);
      if (table === 'stock_transfer_items') return readOnlyTable(state.transferItems);
      if (table === 'stock_opnames') return readOnlyTable(state.opnames);
      if (table === 'stock_opname_items') return readOnlyTable(state.opnameItems);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('GET /dashboard/overview is owner-only', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/dashboard/overview`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'bypass' });
});

test('GET /dashboard/overview lists warehouse and Cabang Bypass as separate location rows', async () => {
  const supabase = fakeSupabase({
    products: [{ id: 'p1', name: 'Pomade', minimum_stock: 3 }],
    balances: [
      { location_id: 'loc-warehouse', product_id: 'p1', quantity: 100 },
      { location_id: 'loc-bypass', product_id: 'p1', quantity: 2 },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/dashboard/overview`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.locations.length, 2);
    const warehouse = body.locations.find((l) => l.location_id === 'loc-warehouse');
    const bypass = body.locations.find((l) => l.location_id === 'loc-bypass');
    assert.equal(warehouse.location_name, 'Gudang Pusat');
    assert.equal(warehouse.total_quantity, 100);
    assert.equal(bypass.location_name, 'RedBox Bypass');
    assert.equal(bypass.total_quantity, 2);
    assert.equal(bypass.low_stock_count, 1);
  }, { role: 'owner' });
});

test('GET /dashboard/overview reports pending request count, problem shipments, top discrepancies, and top requested products', async () => {
  const supabase = fakeSupabase({
    products: [{ id: 'p1', name: 'Pomade', minimum_stock: 3 }],
    requests: [{ id: 'req-1', status: 'SUBMITTED' }, { id: 'req-2', status: 'APPROVED' }],
    requestItems: [{ id: 'ri-1', product_id: 'p1', quantity_requested: 7 }],
    transfers: [
      { id: 'transfer-1', status: 'RECEIVED', source_location_id: 'loc-warehouse', destination_location_id: 'loc-bypass', transfer_number: 'TRF-1' },
      { id: 'transfer-2', status: 'RECEIVED', source_location_id: 'loc-warehouse', destination_location_id: 'loc-bypass', transfer_number: 'TRF-2' },
    ],
    transferItems: [
      { stock_transfer_id: 'transfer-1', quantity_sent: 10, quantity_received: 8 },
      { stock_transfer_id: 'transfer-2', quantity_sent: 10, quantity_received: 10 },
    ],
    opnames: [{ id: 'opname-1', status: 'APPROVED', opname_number: 'OPN-1', location_id: 'loc-bypass' }],
    opnameItems: [{ stock_opname_id: 'opname-1', product_id: 'p1', difference: -4 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/dashboard/overview`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.pending_requests_count, 1);
    assert.deepEqual(body.problem_shipments.map((s) => s.transfer_number), ['TRF-1']);
    assert.equal(body.top_discrepancies[0].difference, -4);
    assert.equal(body.top_discrepancies[0].product_name, 'Pomade');
    assert.equal(body.top_requested_products[0].product_name, 'Pomade');
    assert.equal(body.top_requested_products[0].total_requested, 7);
  }, { role: 'owner' });
});

test('GET /dashboard/assets returns asset values, location breakdown, attention items, and active transfers', async () => {
  const supabase = fakeSupabase({
    products: [{ id: 'p1', name: 'Pomade', purchase_price: 12000, reorder_point: 3 }],
    balances: [
      { location_id: 'loc-warehouse', product_id: 'p1', quantity: 10 },
      { location_id: 'loc-bypass', product_id: 'p1', quantity: 2 },
    ],
    transfers: [{ id: 't1', transfer_number: 'TRF-1', status: 'SENT', source_location_id: 'loc-warehouse', destination_location_id: 'loc-bypass', sent_at: '2026-08-19T08:00:00.000Z' }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/dashboard/assets`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.total_asset_value, 144000);
    assert.equal(body.warehouse_asset_value, 120000);
    assert.equal(body.branch_asset_value, 24000);
    assert.equal(body.asset_by_location.find((row) => row.location_id === 'loc-bypass').total_asset_value, 24000);
    assert.equal(body.attention_items[0].reason, 'LOW_STOCK');
    assert.equal(body.active_transfers.length, 1);
  }, { role: 'owner' });
});

test('GET /dashboard/assets scopes branch_admin to its branch and omits asset values', async () => {
  const supabase = fakeSupabase({
    products: [{ id: 'p1', name: 'Pomade', purchase_price: 12000, reorder_point: 3 }],
    balances: [
      { location_id: 'loc-warehouse', product_id: 'p1', quantity: 10 },
      { location_id: 'loc-bypass', product_id: 'p1', quantity: 2 },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/dashboard/assets`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.role, 'branch_admin');
    assert.equal(body.asset_by_location.length, 1);
    assert.equal(body.asset_by_location[0].location_id, 'loc-bypass');
    assert.equal(body.total_asset_value, null);
    assert.equal(body.asset_by_location[0].total_asset_value, null);
    assert.equal('purchase_price' in body, false);
  }, { role: 'branch_admin', branch: 'bypass' });
});
