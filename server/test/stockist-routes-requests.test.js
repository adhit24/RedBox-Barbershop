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
const TEGAL = { id: 'loc-tegal', type: 'branch', outlet_id: 'outlet-tegal' };

function balanceKey(productId, locationId) {
  return `${productId}::${locationId}`;
}

// Stateful fake: `balances` tracks { quantity, reserved_quantity } per
// product+location so reservation math (reserve/release/fulfill) can be
// exercised the same way the real Postgres functions behave.
function fakeSupabase({
  locations = [WAREHOUSE, CSB, TEGAL],
  outlets = [{ id: 'outlet-csb', slug: 'csb' }, { id: 'outlet-tegal', slug: 'tegal' }],
  requests = [],
  requestItems = [],
  transfers = [],
  transferItems = [],
  balances = [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 100, reserved_quantity: 0 }],
} = {}) {
  const state = {
    locations, outlets,
    requests: structuredClone(requests),
    requestItems: structuredClone(requestItems),
    transfers: structuredClone(transfers),
    transferItems: structuredClone(transferItems),
    balances: new Map(balances.map((b) => [balanceKey(b.product_id, b.location_id), { ...b }])),
    ledger: [],
    rpcCalls: [],
  };

  function getBalance(productId, locationId) {
    const key = balanceKey(productId, locationId);
    if (!state.balances.has(key)) state.balances.set(key, { product_id: productId, location_id: locationId, quantity: 0, reserved_quantity: 0 });
    return state.balances.get(key);
  }

  function genericTable(list, idPrefix) {
    const query = {
      _filters: [], _patch: null,
      select() { return query; },
      order() { return query; },
      eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
      insert(rows) {
        const isArray = Array.isArray(rows);
        const list2 = isArray ? rows : [rows];
        const records = list2.map((row, i) => ({ id: `${idPrefix}-${list.length + i + 1}`, created_at: new Date().toISOString(), ...row }));
        list.push(...records);
        return {
          select() {
            return {
              single: async () => ({ data: records[0], error: null }),
              then(res, rej) { return Promise.resolve({ data: records, error: null }).then(res, rej); },
            };
          },
        };
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
      if (table === 'stock_requests') return genericTable(state.requests, 'req');
      if (table === 'stock_request_items') return genericTable(state.requestItems, 'reqitem');
      if (table === 'stock_transfers') return genericTable(state.transfers, 'transfer');
      if (table === 'stock_transfer_items') return genericTable(state.transferItems, 'item');
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });

      if (name === 'reserve_inventory_stock') {
        const bal = getBalance(args.p_product_id, args.p_location_id);
        const available = bal.quantity - bal.reserved_quantity;
        if (available < args.p_quantity) {
          return { data: null, error: { message: `insufficient available stock: product ${args.p_product_id} at location ${args.p_location_id} has ${available} available (${bal.reserved_quantity} reserved), ${args.p_quantity} requested` } };
        }
        bal.reserved_quantity += args.p_quantity;
        return { data: { ...bal }, error: null };
      }
      if (name === 'release_inventory_reservation') {
        const bal = getBalance(args.p_product_id, args.p_location_id);
        bal.reserved_quantity = Math.max(0, bal.reserved_quantity - args.p_quantity);
        return { data: { ...bal }, error: null };
      }
      if (name === 'fulfill_reserved_transfer_out') {
        const bal = getBalance(args.p_product_id, args.p_location_id);
        bal.reserved_quantity = Math.max(0, bal.reserved_quantity - args.p_quantity);
        const before = bal.quantity;
        const after = before - args.p_quantity;
        if (after < 0) return { data: null, error: { message: `insufficient stock: product ${args.p_product_id} at location ${args.p_location_id} has ${before} available, ${args.p_quantity} requested` } };
        bal.quantity = after;
        const ledgerRow = {
          id: `ledger-${state.ledger.length + 1}`, product_id: args.p_product_id, location_id: args.p_location_id,
          movement_type: 'TRANSFER_OUT', quantity_delta: -args.p_quantity, quantity_before: before, quantity_after: after,
          reference_type: args.p_reference_type, reference_id: args.p_reference_id, performed_by: args.p_performed_by,
        };
        state.ledger.push(ledgerRow);
        return { data: ledgerRow, error: null };
      }
      if (name === 'apply_inventory_movement') {
        const bal = getBalance(args.p_product_id, args.p_location_id);
        const before = bal.quantity;
        const after = before + args.p_quantity_delta;
        if (after < 0) return { data: null, error: { message: `insufficient stock: product ${args.p_product_id} at location ${args.p_location_id} has ${before} available, delta ${args.p_quantity_delta} requested` } };
        bal.quantity = after;
        const ledgerRow = {
          id: `ledger-${state.ledger.length + 1}`, product_id: args.p_product_id, location_id: args.p_location_id,
          movement_type: args.p_movement_type, quantity_delta: args.p_quantity_delta, quantity_before: before, quantity_after: after,
          reference_type: args.p_reference_type, reference_id: args.p_reference_id, performed_by: args.p_performed_by,
        };
        state.ledger.push(ledgerRow);
        return { data: ledgerRow, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test('POST /requests lets branch_admin submit a request and is rejected for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: 'p1', quantity_requested: 10 }], reason: 'stok menipis' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'SUBMITTED');
    assert.equal(body.request.branch_location_id, 'loc-csb');
    assert.equal(supabase.state.requestItems.length, 1);
    assert.equal(supabase.state.requestItems[0].quantity_requested, 10);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: 'p1', quantity_requested: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'owner' });
});

test('GET /requests is scoped to the caller branch for branch_admin, unscoped for owner', async () => {
  const supabase = fakeSupabase({
    requests: [
      { id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' },
      { id: 'req-2', branch_location_id: 'loc-tegal', status: 'SUBMITTED' },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests`);
    const body = await res.json();
    assert.equal(body.requests.length, 1);
    assert.equal(body.requests[0].id, 'req-1');
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests`);
    const body = await res.json();
    assert.equal(body.requests.length, 2);
  }, { role: 'owner' });
});

test('GET /requests/:id rejects a branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items[0].quantity_requested, 10);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /requests/:id/approve fully approves, reserves warehouse stock, and is owner-only', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'APPROVED');
    assert.equal(supabase.state.balances.get('p1::loc-warehouse').reserved_quantity, 10);
  }, { role: 'owner' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /requests/:id/approve marks PARTIALLY_APPROVED when approved qty is less than requested', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 4 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'PARTIALLY_APPROVED');
  }, { role: 'owner' });
});

test('PATCH /requests/:id/approve rejects approving more than available warehouse stock and reserves nothing', async () => {
  const supabase = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 5, reserved_quantity: 0 }],
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /insufficient available stock/);
    assert.equal(supabase.state.balances.get('p1::loc-warehouse').reserved_quantity, 0);
  }, { role: 'owner' });
});

test('PATCH /requests/:id/approve rolls back reservations already made when a later item fails', async () => {
  const supabase = fakeSupabase({
    balances: [
      { product_id: 'p1', location_id: 'loc-warehouse', quantity: 10, reserved_quantity: 0 },
      { product_id: 'p2', location_id: 'loc-warehouse', quantity: 2, reserved_quantity: 0 },
    ],
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [
      { id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null },
      { id: 'reqitem-2', stock_request_id: 'req-1', product_id: 'p2', quantity_requested: 10, quantity_approved: null },
    ],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [
        { item_id: 'reqitem-1', quantity_approved: 10 },
        { item_id: 'reqitem-2', quantity_approved: 10 },
      ] }),
    });
    assert.equal(res.status, 400);
    // p1 was reserved successfully, then p2 failed — p1's reservation must be undone.
    assert.equal(supabase.state.balances.get('p1::loc-warehouse').reserved_quantity, 0);
    assert.equal(supabase.state.balances.get('p2::loc-warehouse').reserved_quantity, 0);
  }, { role: 'owner' });
});

test('PATCH /requests/:id/approve rejects an all-zero approval — use reject instead', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 10, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'reqitem-1', quantity_approved: 0 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /use reject/);
  }, { role: 'owner' });
});

test('PATCH /requests/:id/reject requires a reason and is owner-only', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  }, { role: 'owner' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'stok gudang kosong' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'REJECTED');
    assert.equal(body.request.rejection_reason, 'stok gudang kosong');
  }, { role: 'owner' });
});

test('PATCH /requests/:id/cancel: branch_admin can cancel only before review, owner releases reservation after approval', async () => {
  const submitted = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
  });
  await withServer(submitted, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/cancel`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'CANCELLED');
  }, { role: 'branch_admin', branch: 'csb' });

  const approved = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 10, reserved_quantity: 4 }],
    requests: [{ id: 'req-2', branch_location_id: 'loc-csb', status: 'APPROVED' }],
    requestItems: [{ id: 'reqitem-2', stock_request_id: 'req-2', product_id: 'p1', quantity_requested: 4, quantity_approved: 4 }],
  });
  // Same branch as the request, but it's already been reviewed — branch_admin
  // may only cancel while still SUBMITTED, so this is a status conflict (409),
  // not a branch mismatch (403).
  await withServer(approved, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-2/cancel`, { method: 'PATCH' });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(approved, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-2/cancel`, { method: 'PATCH' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'CANCELLED');
    assert.equal(approved.state.balances.get('p1::loc-warehouse').reserved_quantity, 0);
  }, { role: 'owner' });
});

test('POST /requests/:id/fulfill ships approved items as a transfer and consumes the reservation atomically', async () => {
  const supabase = fakeSupabase({
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 10, reserved_quantity: 6 }],
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'APPROVED', fulfilling_transfer_id: null }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 6, quantity_approved: 6 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/fulfill`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.request.status, 'FULFILLED');
    assert.equal(body.transfer.status, 'SENT');
    assert.equal(body.transfer.destination_location_id, 'loc-csb');
    const bal = supabase.state.balances.get('p1::loc-warehouse');
    assert.equal(bal.quantity, 4);
    assert.equal(bal.reserved_quantity, 0);
    assert.equal(supabase.state.transferItems[0].quantity_sent, 6);

    const second = await fetch(`${base}/api/stockist/requests/req-1/fulfill`, { method: 'POST' });
    assert.equal(second.status, 409);
  }, { role: 'owner' });
});

test('POST /requests/:id/fulfill rejects a request that has not been approved', async () => {
  const supabase = fakeSupabase({
    requests: [{ id: 'req-1', branch_location_id: 'loc-csb', status: 'SUBMITTED' }],
    requestItems: [{ id: 'reqitem-1', stock_request_id: 'req-1', product_id: 'p1', quantity_requested: 6, quantity_approved: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/requests/req-1/fulfill`, { method: 'POST' });
    assert.equal(res.status, 409);
  }, { role: 'owner' });
});
