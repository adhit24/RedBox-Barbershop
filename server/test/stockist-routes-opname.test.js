'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true, notifications } = {}) {
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
    notifyStockOpnameSubmitted: stub('notifyStockOpnameSubmitted'),
    notifyStockOpnameApproved: stub('notifyStockOpnameApproved'),
  };
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase({
  locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }],
  products = [{ id: 'p1', is_active: true }, { id: 'p2', is_active: true }],
  balances = [{ product_id: 'p1', location_id: 'loc-csb', quantity: 10 }, { product_id: 'p2', location_id: 'loc-csb', quantity: 5 }],
  opnames = [], opnameItems = [],
} = {}) {
  const state = {
    locations, outlets, products: structuredClone(products), balances: structuredClone(balances),
    opnames: structuredClone(opnames), opnameItems: structuredClone(opnameItems), rpcCalls: [],
  };

  function genericTable(list, idPrefix) {
    const query = {
      _filters: [], _patch: null,
      select() { return query; }, order() { return query; },
      eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
      in(c, vals) { query._filters.push((r) => vals.includes(r[c])); return query; },
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
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: state.products.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'inventory_balances') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: state.balances.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'stock_opnames') return genericTable(state.opnames, 'opname');
      if (table === 'stock_opname_items') return genericTable(state.opnameItems, 'opnameitem');
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: { id: `ledger-${state.rpcCalls.length}`, quantity_after: 0 }, error: null };
    },
  };
}

test('POST /stock-opname snapshots all active products and rejects a second open session for the same location', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_type: 'branch', location_branch: 'csb' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.opname.status, 'DRAFT');
    assert.equal(supabase.state.opnameItems.length, 2);
    const p1Item = supabase.state.opnameItems.find((i) => i.product_id === 'p1');
    assert.equal(p1Item.system_quantity, 10);
    assert.equal(p1Item.physical_quantity, null);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_type: 'branch', location_branch: 'csb' }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.match(body.error, /open stock opname already exists/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /stock-opname rejects a branch_admin opening a session for another branch', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_type: 'branch', location_branch: 'csb' }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('GET /stock-opname is scoped to the caller branch for branch_admin', async () => {
  const supabase = fakeSupabase({
    opnames: [
      { id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' },
      { id: 'opname-2', location_id: 'loc-warehouse', status: 'DRAFT' },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname`);
    const body = await res.json();
    assert.equal(body.opnames.length, 1);
    assert.equal(body.opnames[0].id, 'opname-1');
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname`);
    const body = await res.json();
    assert.equal(body.opnames.length, 2);
  }, { role: 'owner' });
});

test('GET /stock-opname/:id rejects a branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({ opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('PATCH /stock-opname/:id/count updates physical_quantity and is rejected once the opname is no longer DRAFT', async () => {
  const supabase = fakeSupabase({
    opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }],
    opnameItems: [{ id: 'item-1', stock_opname_id: 'opname-1', product_id: 'p1', system_quantity: 10, physical_quantity: null, difference: null, reason: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/count`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', physical_quantity: 8, reason: 'kurang saat hitung' }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items[0].physical_quantity, 8);
  }, { role: 'branch_admin', branch: 'csb' });

  const submitted = fakeSupabase({ opnames: [{ id: 'opname-2', location_id: 'loc-csb', status: 'SUBMITTED' }] });
  await withServer(submitted, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-2/count`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', physical_quantity: 8 }] }),
    });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /stock-opname/:id/submit rejects an incomplete count and a missing reason on a difference', async () => {
  const missingCount = fakeSupabase({
    opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }],
    opnameItems: [{ id: 'item-1', stock_opname_id: 'opname-1', product_id: 'p1', system_quantity: 10, physical_quantity: null, difference: null, reason: null }],
  });
  await withServer(missingCount, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/submit`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /missing a physical count/);
  }, { role: 'branch_admin', branch: 'csb' });

  const missingReason = fakeSupabase({
    opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }],
    opnameItems: [{ id: 'item-1', stock_opname_id: 'opname-1', product_id: 'p1', system_quantity: 10, physical_quantity: 8, difference: null, reason: null }],
  });
  await withServer(missingReason, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/submit`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /reason is required/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /stock-opname/:id/submit computes differences, sets SUBMITTED, and notifies owners with the discrepancy count', async () => {
  const supabase = fakeSupabase({
    opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }],
    opnameItems: [
      { id: 'item-1', stock_opname_id: 'opname-1', product_id: 'p1', system_quantity: 10, physical_quantity: 8, difference: null, reason: 'rusak' },
      { id: 'item-2', stock_opname_id: 'opname-1', product_id: 'p2', system_quantity: 5, physical_quantity: 5, difference: null, reason: null },
    ],
  });
  const notifications = fakeNotifications();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/submit`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.opname.status, 'SUBMITTED');
  }, { role: 'branch_admin', branch: 'csb', notifications });

  assert.equal(supabase.state.opnameItems.find((i) => i.id === 'item-1').difference, -2);
  assert.equal(supabase.state.opnameItems.find((i) => i.id === 'item-2').difference, 0);
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockOpnameSubmitted']);
  assert.equal(notifications.calls[0].args[1].discrepancyCount, 1);
});

test('PATCH /stock-opname/:id/approve applies ADJUSTMENT only for nonzero differences, is owner-only, and notifies the creator', async () => {
  const supabase = fakeSupabase({
    opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'SUBMITTED', created_by: 'branch-1' }],
    opnameItems: [
      { id: 'item-1', stock_opname_id: 'opname-1', product_id: 'p1', system_quantity: 10, physical_quantity: 8, difference: -2, reason: 'rusak' },
      { id: 'item-2', stock_opname_id: 'opname-1', product_id: 'p2', system_quantity: 5, physical_quantity: 5, difference: 0, reason: null },
    ],
  });
  const notifications = fakeNotifications();

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/approve`, { method: 'PATCH' });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb', notifications });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/approve`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.opname.status, 'APPROVED');
  }, { role: 'owner', notifications });

  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, -2);
  assert.equal(supabase.state.rpcCalls[0].args.p_reference_type, 'stock_opname');
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockOpnameApproved']);
});

test('PATCH /stock-opname/:id/cancel is allowed before APPROVED and rejected afterward', async () => {
  const draft = fakeSupabase({ opnames: [{ id: 'opname-1', location_id: 'loc-csb', status: 'DRAFT' }] });
  await withServer(draft, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-1/cancel`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.opname.status, 'CANCELLED');
  }, { role: 'branch_admin', branch: 'csb' });

  const approved = fakeSupabase({ opnames: [{ id: 'opname-2', location_id: 'loc-csb', status: 'APPROVED' }] });
  await withServer(approved, async (base) => {
    const res = await fetch(`${base}/api/stockist/stock-opname/opname-2/cancel`, { method: 'PATCH' });
    assert.equal(res.status, 409);
  }, { role: 'owner' });
});
