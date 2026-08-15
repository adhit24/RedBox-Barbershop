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

function fakeSupabase({ products = [] } = {}) {
  const state = { products: structuredClone(products), inserted: [] };
  return {
    state,
    from(table) {
      if (table !== 'products') throw new Error(`unexpected table ${table}`);
      const query = {
        _order: null,
        select() { return query; },
        order(column, opts) { query._order = { column, ascending: opts?.ascending !== false }; return query; },
        insert(row) {
          const record = { id: `product-${state.inserted.length + 1}`, is_active: true, ...row };
          state.inserted.push(record);
          state.products.push(record);
          return { select() { return { single: async () => ({ data: record, error: null }) }; } };
        },
        then(resolve, reject) {
          let rows = structuredClone(state.products);
          if (query._order) {
            const { column, ascending } = query._order;
            rows.sort((a, b) => (ascending ? 1 : -1) * String(a[column]).localeCompare(String(b[column])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('GET /products returns full product data for owner', async () => {
  const supabase = fakeSupabase({ products: [{ id: 'p1', sku: 'RB-POM-001', name: 'Pomade Matte', purchase_price: 12000, retail_price: 25000 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.products[0].purchase_price, 12000);
  }, { role: 'owner' });
});

test('GET /products strips purchase_price for branch_admin', async () => {
  const supabase = fakeSupabase({ products: [{ id: 'p1', sku: 'RB-POM-001', name: 'Pomade Matte', purchase_price: 12000, retail_price: 25000 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal('purchase_price' in body.products[0], false);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /products creates a product for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'RB-FW-001', name: 'Facewash 100ml', unit: 'pcs', purchase_price: 8000, retail_price: 20000 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.product.sku, 'RB-FW-001');
    assert.equal(supabase.state.inserted.length, 1);
  }, { role: 'owner' });
});

test('POST /products is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'RB-FW-001', name: 'Facewash 100ml' }),
    });
    assert.equal(res.status, 403);
    assert.equal(supabase.state.inserted.length, 0);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /products requires sku and name', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  }, { role: 'owner' });
});

test('all /products endpoints reject unverified sessions', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    assert.equal(res.status, 403);
  }, { sessionVerified: false });
});
