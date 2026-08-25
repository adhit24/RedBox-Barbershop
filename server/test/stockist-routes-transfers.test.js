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
      if (name === 'confirm_stock_transfer_receive') {
        if (state.simulatedRpcMissing) {
          return { data: null, error: { message: 'function confirm_stock_transfer_receive() does not exist' } };
        }
        state.rpcCalls.push({ name, args });
        state.idempotencyStore = state.idempotencyStore || new Map();
        const { p_transfer_id, p_items, p_idempotency_key, p_request_hash } = args || {};

        if (p_idempotency_key) {
          const existing = state.idempotencyStore.get(p_idempotency_key);
          if (existing) {
            if (existing.transfer_id === p_transfer_id && existing.request_hash === p_request_hash) {
              return { data: existing.response_body, error: null };
            } else {
              return { data: null, error: { message: 'IDEMPOTENCY_KEY_REUSED' } };
            }
          }
        }

        const transfer = state.transfers.find((t) => t.id === p_transfer_id);
        if (!transfer) return { data: null, error: { message: 'TRANSFER_NOT_FOUND' } };
        if (transfer.status !== 'SENT') return { data: null, error: { message: 'TRANSFER_ALREADY_RECEIVED' } };

        const transferItems = state.items.filter((i) => i.stock_transfer_id === p_transfer_id);
        if (transferItems.length !== p_items.length) {
          return { data: null, error: { message: 'INCOMPLETE_ITEM_SET' } };
        }

        let hasDiscrepancy = false;
        const byId = new Map(transferItems.map((i) => [i.id, i]));
        const seen = new Set();
        for (const itemArg of p_items) {
          if (seen.has(itemArg.id)) return { data: null, error: { message: 'DUPLICATE_ITEM_SUBMITTED' } };
          seen.add(itemArg.id);

          const existingItem = byId.get(itemArg.id);
          if (!existingItem) return { data: null, error: { message: 'INVALID_ITEM' } };
          if (itemArg.quantity_received < 0) return { data: null, error: { message: 'INVALID_QUANTITY' } };

          if (itemArg.quantity_received !== existingItem.quantity_sent) {
            hasDiscrepancy = true;
            if (!itemArg.discrepancy_reason || !itemArg.discrepancy_reason.trim()) {
              return { data: null, error: { message: 'DISCREPANCY_REASON_REQUIRED' } };
            }
          }
          existingItem.quantity_received = itemArg.quantity_received;
          existingItem.discrepancy_reason = itemArg.discrepancy_reason;
          existingItem.discrepancy_photo_url = itemArg.discrepancy_photo_url;
        }

        transfer.status = 'RECEIVED';
        const resObj = { success: true, transfer_id: p_transfer_id, status: 'RECEIVED', has_discrepancy: hasDiscrepancy };
        if (p_idempotency_key) {
          state.idempotencyStore.set(p_idempotency_key, {
            transfer_id: p_transfer_id, request_hash: p_request_hash, response_body: resObj,
          });
        }
        return { data: resObj, error: null };
      }
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
    const rpcCall = supabase.state.rpcCalls.find((c) => c.name === 'confirm_stock_transfer_receive');
    assert.ok(rpcCall);
    assert.equal(rpcCall.args.p_transfer_id, 'transfer-1');
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
    // No TRANSFER_IN movement may be fabricated by the duplicate request (RPC rejected).
    assert.equal(supabase.state.rpcCalls.length, 1);
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


test('PATCH /transfers/:id/receive passes Idempotency-Key to confirm_stock_transfer_receive RPC', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  supabase.state.useRpcMock = true;

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idempotency-key-12345',
      },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res.status, 200);
    const rpcCall = supabase.state.rpcCalls.find((c) => c.name === 'confirm_stock_transfer_receive');
    assert.ok(rpcCall);
    assert.equal(rpcCall.args.p_idempotency_key, 'idempotency-key-12345');
    assert.equal(rpcCall.args.p_transfer_id, 'transfer-1');
  }, { role: 'branch_admin', branch: 'csb' });
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

test('Migration inspection: ensure no broad TO authenticated policies exist for stockist-evidence', async () => {
  const fs = require('fs');
  const sql = fs.readFileSync('server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql', 'utf8');
  assert.equal(/create\s+policy.*to\s+authenticated/i.test(sql), false);
  assert.equal(/drop\s+policy\s+if\s+exists.*stockist\s+evidence/i.test(sql), true);
});

test('POST /transfers/:id/items/:itemId/photo uploads and returns deterministic object_path', async () => {
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
    assert.equal(body.object_path, 'transfer-1/item-1/evidence');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('Task 3 Security Grants inspection: ensure search_path, revokes, and service_role grant exist', async () => {
  const fs = require('fs');
  const sql = fs.readFileSync('server/migrations/2026-08-25-stockist-transfer-atomic-receive.sql', 'utf8');
  assert.equal(/set\s+search_path\s*=\s*public,\s*pg_temp/i.test(sql), true);
  assert.equal(/revoke\s+all\s+on\s+function.*from\s+public/i.test(sql), true);
  assert.equal(/revoke\s+all\s+on\s+function.*from\s+anon,\s+authenticated/i.test(sql), true);
  assert.equal(/grant\s+execute\s+on\s+function.*to\s+service_role/i.test(sql), true);
});

test('PATCH /transfers/:id/receive fails closed with HTTP 503 if RPC is unavailable (No JS fallback mutation)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  supabase.state.simulatedRpcMissing = true;

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-fail-test' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'STOCKIST_ATOMIC_RECEIVE_UNAVAILABLE');

    // Verify ZERO mutations occurred (Fail-Closed)
    const transfer = supabase.state.transfers.find((t) => t.id === 'transfer-1');
    assert.equal(transfer.status, 'SENT');
    assert.equal(supabase.state.rpcCalls.length, 0);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive handles Idempotency Key reuse with different payload safely (409 Conflict)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });

  await withServer(supabase, async (base) => {
    // First request with key-1
    const res1 = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-reuse-test' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res1.status, 200);

    // Second request reusing key-1 with different payload (quantity 5)
    const res2 = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-reuse-test' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 5, reason: 'mismatch' }] }),
    });
    assert.equal(res2.status, 409);
    const body2 = await res2.json();
    assert.equal(body2.code, 'IDEMPOTENCY_KEY_REUSED');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /transfers/:id/items/:itemId/photo generates a short-lived signed URL for owner, manager (global/destination), and destination branch_admin', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null, discrepancy_photo_url: 'transfer-1/item-1/evidence' }],
  });

  // Branch Admin destination branch
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.signed_url, /https:\/\/fake-storage\.test\/stockist-evidence\/transfer-1\/item-1\/evidence\?token=signed_token&expires=60/);
    assert.equal(body.expires_in, 60);
  }, { role: 'branch_admin', branch: 'csb' });

  // Owner
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 200);
  }, { role: 'owner' });

  // Manager global (no branch restriction)
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 200);
  }, { role: 'manager', branch: null });

  // Manager matching destination branch
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 200);
  }, { role: 'manager', branch: 'csb' });

  // Manager non-matching branch (Tegal manager trying to view CSB photo)
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 403);
  }, { role: 'manager', branch: 'tegal' });
});

test('GET /transfers/:id/items/:itemId/photo is rejected for branch_admin of another branch', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null, discrepancy_photo_url: 'transfer-1/item-1/evidence' }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});

test('GET /transfers/:id/items/:itemId/photo returns 404 if item has no evidence photo recorded', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null, discrepancy_photo_url: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, { method: 'GET' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /no evidence photo/);
  }, { role: 'branch_admin', branch: 'csb' });
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
