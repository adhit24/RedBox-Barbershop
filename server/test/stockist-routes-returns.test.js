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
    notifyStockRequestSubmitted: stub('a'), notifyStockRequestReviewed: stub('b'), notifyStockRequestFulfilled: stub('c'),
    notifyTransferDiscrepancy: stub('d'), checkAndNotifyLowStock: stub('e'),
    notifyStockOpnameSubmitted: stub('f'), notifyStockOpnameApproved: stub('g'),
    notifyStockReturnSubmitted: stub('notifyStockReturnSubmitted'),
    notifyStockReturnReviewed: stub('notifyStockReturnReviewed'),
    notifyStockReturnReceived: stub('notifyStockReturnReceived'),
  };
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function balanceKey(productId, locationId) { return `${productId}::${locationId}`; }

function fakeSupabase({
  locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }],
  returns = [], returnItems = [],
  balances = [{ product_id: 'p1', location_id: 'loc-csb', quantity: 10 }],
} = {}) {
  const state = {
    locations, outlets,
    returns: structuredClone(returns), returnItems: structuredClone(returnItems),
    balances: new Map(balances.map((b) => [balanceKey(b.product_id, b.location_id), { ...b }])),
    rpcCalls: [],
  };

  function getBalance(productId, locationId) {
    const key = balanceKey(productId, locationId);
    if (!state.balances.has(key)) state.balances.set(key, { product_id: productId, location_id: locationId, quantity: 0 });
    return state.balances.get(key);
  }

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
      if (table === 'inventory_balances') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          in(c, vals) { query._filters.push((r) => vals.includes(r[c])); return query; },
          then(res, rej) { return Promise.resolve({ data: [...state.balances.values()].filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'stock_returns') return genericTable(state.returns, 'return');
      if (table === 'stock_return_items') return genericTable(state.returnItems, 'returnitem');
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (name === 'apply_inventory_movement') {
        const bal = getBalance(args.p_product_id, args.p_location_id);
        const before = bal.quantity;
        const after = before + args.p_quantity_delta;
        if (after < 0) return { data: null, error: { message: `insufficient stock: product ${args.p_product_id} at location ${args.p_location_id} has ${before} available, delta ${args.p_quantity_delta} requested` } };
        bal.quantity = after;
        return { data: { id: `ledger-${state.rpcCalls.length}`, quantity_before: before, quantity_after: after }, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
}

test('POST /returns rejects insufficient branch stock and creates a SUBMITTED return otherwise', async () => {
  const supabase = fakeSupabase({ balances: [{ product_id: 'p1', location_id: 'loc-csb', quantity: 3 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'RUSAK', reason: 'jatuh saat display', items: [{ product_id: 'p1', quantity: 5 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /insufficient branch stock/);
  }, { role: 'branch_admin', branch: 'csb' });

  const notifications = fakeNotifications();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'RUSAK', reason: 'jatuh saat display', items: [{ product_id: 'p1', quantity: 2 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'SUBMITTED');
  }, { role: 'branch_admin', branch: 'csb', notifications });
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockReturnSubmitted']);
});

test('POST /returns rejects an invalid category and is branch_admin-only', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'BUKAN_KATEGORI', items: [{ product_id: 'p1', quantity: 1 }] }),
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'RUSAK', items: [{ product_id: 'p1', quantity: 1 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'owner' });
});

test('GET /returns is scoped to the caller branch for branch_admin', async () => {
  const supabase = fakeSupabase({
    returns: [
      { id: 'return-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' },
      { id: 'return-2', branch_location_id: 'loc-warehouse', status: 'SUBMITTED' },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns`);
    const body = await res.json();
    assert.equal(body.returns.length, 1);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /returns/:id rejects a branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({ returns: [{ id: 'return-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('approve/reject a return: owner-only, requires SUBMITTED, reject requires a reason', async () => {
  const approveSupabase = fakeSupabase({ returns: [{ id: 'return-1', branch_location_id: 'loc-csb', status: 'SUBMITTED', requested_by: 'branch-1' }] });
  const notifications = fakeNotifications();
  await withServer(approveSupabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1/approve`, { method: 'PATCH' });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
  await withServer(approveSupabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1/approve`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'APPROVED');
  }, { role: 'owner', notifications });
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockReturnReviewed']);

  const rejectSupabase = fakeSupabase({ returns: [{ id: 'return-2', branch_location_id: 'loc-csb', status: 'SUBMITTED', requested_by: 'branch-1' }] });
  await withServer(rejectSupabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/reject`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(res.status, 400);
  }, { role: 'owner' });
  await withServer(rejectSupabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'kategori tidak sesuai' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'REJECTED');
  }, { role: 'owner' });
});

test('PATCH /returns/:id/ship decrements branch stock via RETURN_TO_CENTER and rolls back on partial failure', async () => {
  const supabase = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-csb', quantity: 5 }, { product_id: 'p2', location_id: 'loc-csb', quantity: 1 }],
    returns: [{ id: 'return-1', branch_location_id: 'loc-csb', status: 'APPROVED' }],
    returnItems: [
      { id: 'item-1', stock_return_id: 'return-1', product_id: 'p1', quantity: 3 },
      { id: 'item-2', stock_return_id: 'return-1', product_id: 'p2', quantity: 5 },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1/ship`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /insufficient stock/);
  }, { role: 'branch_admin', branch: 'csb' });

  // p1's decrement (applied before p2 failed) must have been reversed back to 5.
  assert.equal(supabase.state.balances.get('p1::loc-csb').quantity, 5);

  const happy = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-csb', quantity: 5 }],
    returns: [{ id: 'return-2', branch_location_id: 'loc-csb', status: 'APPROVED' }],
    returnItems: [{ id: 'item-1', stock_return_id: 'return-2', product_id: 'p1', quantity: 3 }],
  });
  await withServer(happy, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/ship`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'SHIPPED');
  }, { role: 'owner' });
  assert.equal(happy.state.balances.get('p1::loc-csb').quantity, 2);
});

test('PATCH /returns/:id/receive increments warehouse stock for a sellable category but not for RUSAK', async () => {
  const sellable = fakeSupabase({
    returns: [{ id: 'return-1', branch_location_id: 'loc-csb', status: 'SHIPPED', category: 'SALAH_KIRIM', requested_by: 'branch-1' }],
    returnItems: [{ id: 'item-1', stock_return_id: 'return-1', product_id: 'p1', quantity: 3 }],
  });
  const notifications = fakeNotifications();
  await withServer(sellable, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1/receive`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'RECEIVED');
  }, { role: 'owner', notifications });
  assert.equal(sellable.state.balances.get('p1::loc-warehouse').quantity, 3);
  assert.deepEqual(notifications.calls.map((c) => c.name), ['notifyStockReturnReceived']);

  const damaged = fakeSupabase({
    returns: [{ id: 'return-2', branch_location_id: 'loc-csb', status: 'SHIPPED', category: 'RUSAK', requested_by: 'branch-1' }],
    returnItems: [{ id: 'item-1', stock_return_id: 'return-2', product_id: 'p1', quantity: 3 }],
  });
  await withServer(damaged, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/receive`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'RECEIVED');
  }, { role: 'owner' });
  // Damaged goods never re-enter sellable warehouse stock — no balance row created.
  assert.equal(damaged.state.balances.has('p1::loc-warehouse'), false);
});

test('PATCH /returns/:id/cancel: branch_admin only before review, owner up to APPROVED', async () => {
  const submitted = fakeSupabase({ returns: [{ id: 'return-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }] });
  await withServer(submitted, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-1/cancel`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.return.status, 'CANCELLED');
  }, { role: 'branch_admin', branch: 'csb' });

  const approved = fakeSupabase({ returns: [{ id: 'return-2', branch_location_id: 'loc-csb', status: 'APPROVED' }] });
  await withServer(approved, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/cancel`, { method: 'PATCH' });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'csb' });
  await withServer(approved, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-2/cancel`, { method: 'PATCH' });
    assert.equal(res.status, 200);
  }, { role: 'owner' });

  const shipped = fakeSupabase({ returns: [{ id: 'return-3', branch_location_id: 'loc-csb', status: 'SHIPPED' }] });
  await withServer(shipped, async (base) => {
    const res = await fetch(`${base}/api/stockist/returns/return-3/cancel`, { method: 'PATCH' });
    assert.equal(res.status, 409);
  }, { role: 'owner' });
});
