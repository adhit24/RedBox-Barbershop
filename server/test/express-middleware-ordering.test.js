'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStockistRoutes } = require('../routes/stockist');

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase({ locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }], transfers = [], items = [], balances = [], products = [] } = {}) {
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

async function withFullExpressServer(supabase, fn, authOptions = { role: 'branch_admin', branch: 'csb' }) {
  const app = express();

  // Replicate exact production middleware chain from server/index.js (7MB parser)
  app.use('/api/stockist/transfers/:id/items/:itemId/photo', express.json({ limit: '7mb' }));

  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.match(/^\/api\/stockist\/transfers\/[^/]+\/items\/[^/]+\/photo$/)) {
      return next();
    }
    express.json({ limit: '100kb' })(req, res, next);
  });

  // Auth stub middleware matching getVerifiedStockistAccess requirement
  const adminAuth = (req, _res, next) => {
    req.adminAuth = {
      staffId: 'staff-1',
      role: authOptions.role,
      branch: authOptions.branch,
      sessionVerified: true,
    };
    next();
  };

  app.use('/api/stockist', createStockistRoutes(supabase, adminAuth));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Integration: Valid 4.8MB decoded PNG image succeeds through 7MB JSON parser', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  // 4.8MB valid PNG buffer (base64 ~6.4MB, within 7MB parser limit)
  const pBuf = Buffer.alloc(4.8 * 1024 * 1024);
  pBuf[0] = 0x89; pBuf[1] = 0x50; pBuf[2] = 0x4E; pBuf[3] = 0x47;
  const pBase64 = pBuf.toString('base64');

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${pBase64}` }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.object_path, 'transfer-1/item-1/evidence');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('Integration: Valid 5.2MB decoded PNG image passes JSON parser but is rejected by 5MB buffer size validation (400)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  // 5.2MB valid PNG buffer (base64 ~6.93MB, passes 7MB JSON parser but fails 5MB buffer check)
  const pBuf = Buffer.alloc(5.2 * 1024 * 1024);
  pBuf[0] = 0x89; pBuf[1] = 0x50; pBuf[2] = 0x4E; pBuf[3] = 0x47;
  const pBase64 = pBuf.toString('base64');

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${pBase64}` }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /file size exceeds maximum limit of 5MB/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('Integration: Payload exceeding 7MB middleware limit is rejected on photo upload endpoint (413)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  // 6MB binary image -> ~8MB base64 JSON payload
  const pBuf = Buffer.alloc(6 * 1024 * 1024);
  pBuf[0] = 0x89; pBuf[1] = 0x50; pBuf[2] = 0x4E; pBuf[3] = 0x47;
  const pBase64 = pBuf.toString('base64');

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${pBase64}` }),
    });
    assert.equal(res.status, 413);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('Integration: Regular JSON endpoint rejects payload above 100KB global limit (413)', async () => {
  const supabase = fakeSupabase();
  const largeNotes = 'x'.repeat(120 * 1024); // 120KB payload

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }], notes: largeNotes }),
    });
    assert.equal(res.status, 413);
  }, { role: 'owner', branch: null });
});

test('Integration: Corrupted base64 payload is rejected on photo upload endpoint (400)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'data:image/png;base64,%%%INVALID_BASE64%%%' }),
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('Integration: Non-JSON Content-Type is rejected (400)', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });

  await withFullExpressServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not a json payload',
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });
});
