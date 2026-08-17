'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  summarizeLocations, findProblemShipments, topOpnameDiscrepancies, topRequestedProducts,
} = require('../services/stockistDashboard');

test('summarizeLocations keeps warehouse and Cabang Bypass as separate rows, never merged', () => {
  const locations = [
    { id: 'loc-warehouse', type: 'warehouse' },
    { id: 'loc-bypass', type: 'branch' },
  ];
  const products = [{ id: 'p1', minimum_stock: 3 }, { id: 'p2', minimum_stock: 5 }];
  const balances = [
    { location_id: 'loc-warehouse', product_id: 'p1', quantity: 50 },
    { location_id: 'loc-warehouse', product_id: 'p2', quantity: 2 },
    { location_id: 'loc-bypass', product_id: 'p1', quantity: 1 },
  ];

  const summary = summarizeLocations(locations, balances, products);
  assert.equal(summary.length, 2);

  const warehouse = summary.find((s) => s.location_id === 'loc-warehouse');
  const bypass = summary.find((s) => s.location_id === 'loc-bypass');
  assert.equal(warehouse.total_quantity, 52);
  assert.equal(warehouse.low_stock_count, 1); // p2 at 2 <= minimum_stock 5
  assert.equal(warehouse.sku_count, 2);
  assert.equal(bypass.total_quantity, 1);
  assert.equal(bypass.low_stock_count, 1); // p1 at 1 <= minimum_stock 3
  assert.equal(bypass.sku_count, 1);
});

test('summarizeLocations ignores zero/negative balance rows for sku_count and totals', () => {
  const locations = [{ id: 'loc-1', type: 'branch' }];
  const products = [{ id: 'p1', minimum_stock: 3 }];
  const balances = [{ location_id: 'loc-1', product_id: 'p1', quantity: 0 }];
  const summary = summarizeLocations(locations, balances, products);
  assert.equal(summary[0].sku_count, 0);
  assert.equal(summary[0].total_quantity, 0);
});

test('findProblemShipments returns only RECEIVED transfers with a quantity mismatch', () => {
  const transfers = [
    { id: 't1', status: 'RECEIVED' },
    { id: 't2', status: 'RECEIVED' },
    { id: 't3', status: 'SENT' },
  ];
  const itemsByTransferId = new Map([
    ['t1', [{ quantity_sent: 10, quantity_received: 10 }]],
    ['t2', [{ quantity_sent: 10, quantity_received: 8 }]],
    ['t3', [{ quantity_sent: 10, quantity_received: null }]],
  ]);
  const problems = findProblemShipments(transfers, itemsByTransferId);
  assert.deepEqual(problems.map((t) => t.id), ['t2']);
});

test('topOpnameDiscrepancies sorts by absolute difference and respects the limit', () => {
  const items = [
    { product_id: 'p1', difference: -2 },
    { product_id: 'p2', difference: 0 },
    { product_id: 'p3', difference: 10 },
    { product_id: 'p4', difference: -5 },
  ];
  const top = topOpnameDiscrepancies(items, 2);
  assert.deepEqual(top.map((i) => i.product_id), ['p3', 'p4']);
});

test('topRequestedProducts sums quantity_requested per product and sorts descending', () => {
  const items = [
    { product_id: 'p1', quantity_requested: 5 },
    { product_id: 'p2', quantity_requested: 20 },
    { product_id: 'p1', quantity_requested: 3 },
  ];
  const top = topRequestedProducts(items, 5);
  assert.deepEqual(top, [
    { product_id: 'p2', total_requested: 20 },
    { product_id: 'p1', total_requested: 8 },
  ]);
});
