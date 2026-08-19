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
  const products = [
    { id: 'service-1', sku: 'RB-COLOR-1', name: 'Hair Color Red', unit: 'botol', product_type: 'SERVICE_CONSUMABLE', is_active: true },
    { id: 'both-1', sku: 'RB-CREAM-1', name: 'Treatment Cream', unit: 'botol', product_type: 'BOTH', is_active: true },
    { id: 'retail-1', sku: 'RB-POM-1', name: 'Pomade', unit: 'pcs', product_type: 'RETAIL', is_active: true },
  ];
  const users = [
    { id: 'admin-csb', name: 'Admin CSB', role: 'branch_admin', branch: 'csb' },
    { id: 'barber-csb', name: 'Barber CSB', role: 'barber', branch: 'csb' },
    { id: 'admin-samadikun', name: 'Admin Samadikun', role: 'branch_admin', branch: 'samadikun' },
  ];
  const balances = [
    { product_id: 'service-1', location_id: 'loc-csb', quantity: 5 },
    { product_id: 'both-1', location_id: 'loc-csb', quantity: 2 },
    { product_id: 'retail-1', location_id: 'loc-csb', quantity: 7 },
    { product_id: 'service-1', location_id: 'loc-samadikun', quantity: 9 },
  ];
  const usages = [
    { id: 'usage-other-branch', product_id: 'service-1', location_id: 'loc-samadikun', quantity: 1, status: 'IN_USE', pic_name: 'Admin Samadikun', opened_at: '2026-08-19T00:00:00Z' },
  ];
  const tables = { outlets, inventory_locations: locations, products, inventory_balances: balances, inventory_service_usage: usages, users };

  function query(table) {
    const state = { filters: [], order: null, insert: null };
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return q; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return q; },
      order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return q; },
      insert(row) { state.insert = row; return q; },
      single: async () => {
        const rows = evaluate();
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: evaluate(), error: null }).then(resolve, reject); },
    };
    function evaluate() {
      let rows = state.insert ? [{ id: `generated-${Date.now()}`, ...state.insert }] : (tables[table] || []);
      rows = rows.filter((row) => state.filters.every((filter) => filter(row)));
      if (state.order) rows = [...rows].sort((a, b) => (state.order.ascending ? 1 : -1) * String(a[state.order.column]).localeCompare(String(b[state.order.column])));
      return rows;
    }
    return q;
  }

  return {
    from: query,
    async rpc(name, args) {
      if (name === 'open_service_usage') {
        const record = { id: `usage-${usages.length + 1}`, product_id: args.p_product_id, location_id: args.p_location_id, quantity: args.p_quantity, status: 'IN_USE', pic_user_id: args.p_pic_user_id, pic_name: args.p_pic_name, opened_by: args.p_opened_by, opened_at: '2026-08-19T00:00:00Z', finished_at: null };
        usages.push(record);
        const balance = balances.find((item) => item.product_id === args.p_product_id && item.location_id === args.p_location_id);
        if (balance) balance.quantity -= args.p_quantity;
        return { data: record, error: null };
      }
      if (name === 'finish_service_usage') {
        const usage = usages.find((item) => item.id === args.p_usage_id);
        usage.status = 'FINISHED'; usage.finished_by = args.p_finished_by; usage.finished_at = '2026-08-19T01:00:00Z';
        return { data: usage, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test('branch_admin sees only own service usage and service products', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/service-usage`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.items.every((item) => item.branch === 'csb'));
    assert.ok(body.usages.every((usage) => usage.branch === 'csb'));
    assert.deepEqual(body.items.map((item) => item.product_id).sort(), ['both-1', 'service-1']);
  });
});

test('branch_admin can open a service consumable with a same-branch PIC, but cannot open retail stock', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const open = await fetch(`${base}/api/stockist/service-usage/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'service-1', quantity: 2, pic_user_id: 'barber-csb' }),
    });
    const opened = await open.json();
    assert.equal(open.status, 201);
    assert.equal(opened.usage.pic_name, 'Barber CSB');

    const finish = await fetch(`${base}/api/stockist/service-usage/${opened.usage.id}/finish`, { method: 'PATCH' });
    const finished = await finish.json();
    assert.equal(finish.status, 200);
    assert.equal(finished.usage.status, 'FINISHED');

    const retail = await fetch(`${base}/api/stockist/service-usage/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'retail-1' }),
    });
    assert.equal(retail.status, 400);
    assert.equal((await retail.json()).error_code, 'SERVICE_PRODUCT_REQUIRED');
  });
});

test('branch_admin cannot use a PIC from another branch or finish another branch usage', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const open = await fetch(`${base}/api/stockist/service-usage/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'service-1', pic_user_id: 'admin-samadikun' }),
    });
    assert.equal(open.status, 403);
    const finish = await fetch(`${base}/api/stockist/service-usage/usage-other-branch/finish`, { method: 'PATCH' });
    assert.equal(finish.status, 403);
  });
});
