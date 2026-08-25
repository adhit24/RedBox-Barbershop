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

// Default warehouse balance is generous so the happy-path tests clear the
// POST /transfers pre-flight balance check; tests that exercise the
// insufficient-stock path pass their own `balances`.
const DEFAULT_BALANCES = [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 100 }];

function fakeSupabase({ locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }], transfers = [], items = [], balances = DEFAULT_BALANCES, products = [] } = {}) {
  const state = { locations, outlets, balances: structuredClone(balances), transfers: structuredClone(transfers), items: structuredClone(items), products: structuredClone(products), rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'products') {
        const query = {
          _filters: [],
          select() { return query; },
          in(c, vals) { query._filters.push((r) => vals.includes(r[c])); return query; },
          then(res, rej) { return Promise.resolve({ data: state.products.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); },
        };
        return query;
      }
      if (table === 'inventory_balances') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          in(c, vals) { query._filters.push((r) => vals.includes(r[c])); return query; },
          then(res, rej) {
            const rows = state.balances.filter((r) => query._filters.every((f) => f(r)));
            return Promise.resolve({ data: rows, error: null }).then(res, rej);
          },
        };
        return query;
      }
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
      if (table === 'stock_transfers') {
        const query = {
          _filters: [], _patch: null,
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          insert(row) {
            const record = { id: `transfer-${state.transfers.length + 1}`, status: 'SENT', created_at: new Date().toISOString(), ...row };
            state.transfers.push(record);
            return { select() { return { single: async () => ({ data: record, error: null }) }; } };
          },
          update(patch) { query._patch = patch; return query; },
          then(res, rej) {
            if (query._patch) {
              const matched = state.transfers.filter((r) => query._filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, query._patch);
              return Promise.resolve({ data: matched, error: null }).then(res, rej);
            }
            return Promise.resolve({ data: state.transfers.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej);
          },
        };
        return query;
      }
      if (table === 'stock_transfer_items') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          insert(rows) {
            const list = Array.isArray(rows) ? rows : [rows];
            const records = list.map((row, i) => ({ id: `item-${state.items.length + i + 1}`, quantity_received: null, ...row }));
            state.items.push(...records);
            return Promise.resolve({ data: records, error: null });
          },
          update(patch) {
            const target = query;
            target._patch = patch;
            return target;
          },
          then(res, rej) {
            const matched = state.items.filter((r) => query._filters.every((f) => f(r)));
            if (query._patch) { for (const row of matched) Object.assign(row, query._patch); }
            return Promise.resolve({ data: matched, error: null }).then(res, rej);
          },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: { id: `ledger-${state.rpcCalls.length}`, quantity_after: 0 }, error: null };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, _buffer, _opts) {
            state.uploadedPaths = state.uploadedPaths || [];
            state.uploadedPaths.push(`${bucket}/${path}`);
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://fake-storage.test/${bucket}/${path}` } };
          },
          async createSignedUrl(path, expires) {
            return { data: { signedUrl: `https://fake-storage.test/${bucket}/${path}?token=signed_token&expires=${expires}` }, error: null };
          },
        };
      },
    },
  };
}

test('POST /transfers creates a SENT transfer and decrements warehouse stock for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.transfer.status, 'SENT');
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'TRANSFER_OUT');
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-warehouse');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, -10);
  }, { role: 'owner' });
});

test('POST /transfers is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive lets the destination branch_admin confirm quantities and flags discrepancy', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 8, reason: 'Rusak di jalan' }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.transfer.status, 'RECEIVED');
    assert.equal(body.has_discrepancy, true);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'TRANSFER_IN');
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-csb');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, 8);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /transfers/:id returns transfer with items, scoped to destination branch_admin', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items[0].quantity_sent, 10);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('PATCH /transfers/:id/receive rejects a second receive on an already-RECEIVED transfer', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'RECEIVED', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: 10 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.error, 'transfer already received');
    // No TRANSFER_IN movement may be fabricated by the duplicate request.
    assert.equal(supabase.state.rpcCalls.length, 0);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers rejects quantities exceeding the current warehouse balance', async () => {
  const supabase = fakeSupabase({ balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 5 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /insufficient warehouse stock for product p1/);
    // Rejected before any movement is applied and before any transfer row exists.
    assert.equal(supabase.state.rpcCalls.length, 0);
    assert.equal(supabase.state.transfers.length, 0);
  }, { role: 'owner' });
});

test('POST /transfers rejects a shipment containing an inactive product', async () => {
  const supabase = fakeSupabase({ products: [{ id: 'p1', sku: 'RB-OLD-001', is_active: false }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /inactive/);
    assert.equal(supabase.state.transfers.length, 0);
  }, { role: 'owner' });
});

test('PATCH /transfers/:id/receive rejects a branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('POST /transfers/:id/items/:itemId/photo uploads and returns object_path', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.object_path, 'transfer-1/item-1.png');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /transfers/:id/items/:itemId/photo generates a short-lived signed URL for authorized branch_admin', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null, discrepancy_photo_url: 'transfer-1/item-1.png' }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.signed_url, /https:\/\/fake-storage\.test\/stockist-evidence\/transfer-1\/item-1\.png\?token=signed_token&expires=60/);
    assert.equal(body.expires_in, 60);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /transfers/:id/items/:itemId/photo is rejected for branch_admin of another branch', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('GET /transfers/:id/items/:itemId/photo rejects item from a different transfer', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-2', stock_transfer_id: 'transfer-OTHER', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-2/photo`, { method: 'GET' });
    assert.equal(res.status, 404);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo is rejected for owner', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'data:image/png;base64,aGVsbG8=' }),
    });
    assert.equal(res.status, 403);
  }, { role: 'owner' });
});

test('POST /transfers/:id/items/:itemId/photo rejects a non-image data URL', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'not-a-data-url' }),
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive rejects a discrepant item with no reason', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 8 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /requires a reason/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive accepts a discrepant item with a reason and persists it', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 8, reason: 'Rusak di jalan', photo_url: 'https://fake-storage.test/x.jpg' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(supabase.state.items[0].discrepancy_reason, 'Rusak di jalan');
    assert.equal(supabase.state.items[0].discrepancy_photo_url, 'https://fake-storage.test/x.jpg');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive is rejected for owner', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'owner' });
});

test('POST /transfers/:id/items/:itemId/photo rejects item from a different transfer', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-2', stock_transfer_id: 'transfer-OTHER', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-2/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res.status, 404);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo rejects branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('POST /transfers/:id/items/:itemId/photo rejects transfer with status RECEIVED', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'RECEIVED', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: 10 }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo rejects fake magic bytes in payload', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const fakePngBase64 = Buffer.from('NOTAPNGIMAGE').toString('base64');
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${fakePngBase64}` }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /magic bytes/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo rejects corrupted base64 payload', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'data:image/png;base64,***CORRUPTED***' }),
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo rejects payload exceeding size limit (>5MB)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const largeBuf = Buffer.alloc(5.5 * 1024 * 1024);
  largeBuf[0] = 0x89; largeBuf[1] = 0x50; largeBuf[2] = 0x4E; largeBuf[3] = 0x47;
  const largeBase64 = largeBuf.toString('base64');
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${largeBase64}` }),
    });
    assert.equal(res.status, 413);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo allows overwrite upload for same item', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res1 = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res2.status, 200);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo handles storage failure gracefully', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  supabase.storage = {
    from() {
      return {
        async upload() { return { data: null, error: { message: 'Storage connection timeout' } }; },
        getPublicUrl() { return { data: { publicUrl: '' } }; },
      };
    },
  };
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Storage connection timeout');
  }, { role: 'branch_admin', branch: 'csb' });
});
