'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, notifications, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }, notifications));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function fakeNotifications() {
  const calls = [];
  const stub = (name) => async (...args) => { calls.push({ name, args }); };
  return {
    calls,
    notifyStockRequestSubmitted: stub('notifyStockRequestSubmitted'),
    notifyStockRequestReviewed: stub('notifyStockRequestReviewed'),
    notifyStockRequestFulfilled: stub('notifyStockRequestFulfilled'),
    notifyTransferDiscrepancy: stub('notifyTransferDiscrepancy'),
    checkAndNotifyLowStock: stub('checkAndNotifyLowStock'),
  };
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase({
  locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }],
  requests = [], requestItems = [], transfers = [], transferItems = [], products = [],
  balances = [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 100, reserved_quantity: 0 }],
} = {}) {
  const state = {
    locations, outlets,
    requests: structuredClone(requests), requestItems: structuredClone(requestItems),
    transfers: structuredClone(transfers), transferItems: structuredClone(transferItems),
    products: structuredClone(products),
    balances: new Map(balances.map((b) => [`${b.product_id}::${b.location_id}`, { ...b }])),
    rpcCalls: [],
  };

  function genericTable(list, idPrefix) {
    const query = {
      _filters: [], _patch: null,
      select() { return query; }, order() { return query; },
      eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
      insert(rows) {
        const records = (Array.isArray(rows) ? rows : [rows]).map((row, i) => ({ id: `${idPrefix}-${list.length + i + 1}`, created_at: new Date().toISOString(), ...row }));
        list.push(...records);
        return { select() { return { single: async () => ({ data: records[0], error: null }), then(res, rej) { return Promise.resolve({ data: records, error: null }).then(res, rej); } }; } };
      },
      update(patch) { query._patch = patch; return query; },
      single: async () => {
        const matched = list.filter((r) => query._filters.every((f) => f(r)));
        if (query._patch) for (const row of matched) Object.assign(row, query._patch);
        return { data: matched[0] || null, error: null };
      },
      then(res, rej) {
        const matched = list.filter((r) => query._filters.every((f) => f(r)));
        if (query._patch) for (const row of matched) Object.assign(row, query._patch);
        return Promise.resolve({ data: matched, error: null }).then(res, rej);
      },
    };
    return query;
  }

  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: state.locations.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'outlets') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          single: async () => ({ data: state.outlets.find((r) => query._filters.every((f) => f(r))) || null, error: null }) };
        return query;
      }
      if (table === 'products') {
        const query = {
          _filters: [], select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          in(c, vals) { query._filters.push((r) => vals.includes(r[c])); return query; },
          single: async () => ({ data: state.products.find((r) => query._filters.every((f) => f(r))) || null, error: null }),
          then(res, rej) { return Promise.resolve({ data: state.products.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); },
        };
        return query;
      }
      if (table === 'stock_requests') return genericTable(state.requests, 'req');
      if (table === 'stock_request_items') return genericTable(state.requestItems, 'reqitem');
      if (table === 'stock_transfers') return genericTable(state.transfers, 'transfer');
      if (table === 'stock_transfer_items') return genericTable(state.transferItems, 'item');
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (name === 'reserve_inventory_stock' || name === 'fulfill_reserved_transfer_out') {
        const key = `${args.p_product_id}::${args.p_location_id}`;
        const bal = state.balances.get(key) || { quantity: 0, reserved_quantity: 0 };
        if (name === 'fulfill_reserved_transfer_out') bal.quantity -= args.p_quantity;
        state.balances.set(key, bal);
        return { data: { ...bal, id: `ledger-${state.rpcCalls.length}` }, error: null };
      }
      return { data: { id: `ledger-${state.rpcCalls.length}`, quantity_after: 0 }, error: null };
    },
  };
}

test('POST /requests notifies owners with the branch name and item count', async () => {
  const supabase = fakeSupabase();
  const notifications = fakeNotifications();
  await withServer(supabase, notifications, async (base) => {
    await fetch(`${base}/api/stockist/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: 'p1', quantity_requested: 5 }], reason: 'stok menipis' }),
    });
  }, { role: 'branch_admin', branch: 'csb' });

  assert.equal(notifications.calls.length, 1);
  assert.equal(notifications.calls[0].name, 'notifyStockRequestSubmitted');
  assert.equal(notifications.calls[0].args[1].itemCount, 1);
});

test('PATCH /requests/:id/approve and /reject each fire exactly one review notification', async () => {
  const approveSupabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 5, quantity_approved: null }],
  });
  const approveNotifications = fakeNotifications();
  await withServer(approveSupabase, approveNotifications, async (base) => {
    await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 5 }] }),
    });
  }, { role: 'owner' });
  assert.deepEqual(approveNotifications.calls.map((c) => c.name), ['notifyStockRequestReviewed']);

  const rejectSupabase = fakeSupabase({ requests: [{ id: 'req-2', branch_location_id: 'loc-csb', status: 'SUBMITTED' }] });
  const rejectNotifications = fakeNotifications();
  await withServer(rejectSupabase, rejectNotifications, async (base) => {
    await fetch(`${base}/api/stockist/requests/req-2/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'stok kosong' }),
    });
  }, { role: 'owner' });
  assert.deepEqual(rejectNotifications.calls.map((c) => c.name), ['notifyStockRequestReviewed']);
});

test('POST /requests/:id/fulfill fires a fulfilled notification', async () => {
  const supabase = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 10, reserved_quantity: 6 }],
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'APPROVED', fulfilling_transfer_id: null }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 6, quantity_approved: 6 }],
  });
  const notifications = fakeNotifications();
  await withServer(supabase, notifications, async (base) => {
    await fetch(`${base}/api/stockist/requests/req-1/fulfill`, { method: 'POST' });
  }, { role: 'owner' });
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockRequestFulfilled']);
});

test('PATCH /transfers/:id/receive only notifies on discrepancy, never on an exact match', async () => {
  const withDiscrepancy = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    transferItems: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const discrepancyNotifications = fakeNotifications();
  await withServer(withDiscrepancy, discrepancyNotifications, async (base) => {
    await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 7 }] }),
    });
  }, { role: 'branch_admin', branch: 'csb' });
  assert.deepEqual(discrepancyNotifications.calls.map((c) => c.name), ['notifyTransferDiscrepancy']);

  const exactMatch = fakeSupabase({
    transfers: [{ id: 'transfer-2', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    transferItems: [{ id: 'item-2', stock_transfer_id: 'transfer-2', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const exactNotifications = fakeNotifications();
  await withServer(exactMatch, exactNotifications, async (base) => {
    await fetch(`${base}/api/stockist/transfers/transfer-2/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-2', quantity_received: 10 }] }),
    });
  }, { role: 'branch_admin', branch: 'csb' });
  assert.equal(exactNotifications.calls.length, 0);
});

test('POST /inventory/adjustment checks low stock only for a branch location, never for the warehouse', async () => {
  const branchSupabase = fakeSupabase({ products: [{ id: 'p1', name: 'Pomade', minimum_stock: 3 }] });
  const branchNotifications = fakeNotifications();
  await withServer(branchSupabase, branchNotifications, async (base) => {
    await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'branch', location_branch: 'csb', quantity_delta: -2, reason: 'rusak' }),
    });
  }, { role: 'owner' });
  assert.deepEqual(branchNotifications.calls.map((c) => c.name), ['checkAndNotifyLowStock']);

  const warehouseSupabase = fakeSupabase({ products: [{ id: 'p1', name: 'Pomade', minimum_stock: 3 }] });
  const warehouseNotifications = fakeNotifications();
  await withServer(warehouseSupabase, warehouseNotifications, async (base) => {
    await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'warehouse', quantity_delta: -2, reason: 'rusak' }),
    });
  }, { role: 'owner' });
  assert.equal(warehouseNotifications.calls.length, 0);
});
