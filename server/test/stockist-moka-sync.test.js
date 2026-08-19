'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractMokaSaleLines,
  normalizeMokaTransaction,
  buildMokaSalePlan,
  processMokaSale,
} = require('../services/stockistMokaSync');

test('normalizes stable transaction identity and final status', () => {
  const result = normalizeMokaTransaction({ id: 991, receipt_number: 'RB-991', status: 'paid' }, { id: 'out-1', slug: 'csb' });
  assert.deepEqual(result, {
    externalId: '991', receiptNumber: 'RB-991', outletId: 'out-1', outletSlug: 'csb',
    status: 'PAID', occurredAt: null, isFinal: true,
  });
});

test('extracts item id, variant id, and quantity from Moka line items', () => {
  const lines = extractMokaSaleLines({ items: [{ id: 'm-1', variant_id: 'v-1', name: 'Pomade', quantity: 2 }] });
  assert.deepEqual(lines, [{ mokaItemId: 'm-1', mokaVariantId: 'v-1', name: 'Pomade', quantity: 2 }]);
});

test('does not produce a sale plan for a void or non-final transaction', () => {
  const result = buildMokaSalePlan({ id: 'tx-1', status: 'VOID' }, { id: 'out-1' }, { locationId: 'loc-1' });
  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'NOT_FINAL');
});

test('fails closed when Moka does not provide final status or line items', () => {
  const result = buildMokaSalePlan({ id: 'tx-2' }, { id: 'out-1' }, { locationId: 'loc-1' });
  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'NOT_FINAL');
});

test('unmapped item fails closed instead of silently reducing stock', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-1', status: 'PAID', items: [{ id: 'm-unknown', quantity: 1 }] },
    { id: 'out-1' },
    { locationId: 'loc-1', mappings: [] },
  );
  assert.equal(result.action, 'FAILED_MAPPING');
  assert.equal(result.unmapped[0].mokaItemId, 'm-unknown');
});

test('maps variant-specific products before item-level fallback', () => {
  const result = buildMokaSalePlan(
    { id: 'tx-1', status: 'PAID', items: [{ id: 'm-1', variant_id: 'v-2', quantity: 2 }] },
    { id: 'out-1' },
    {
      locationId: 'loc-1',
      mappings: [
        { moka_item_id: 'm-1', product_id: 'p-item' },
        { moka_item_id: 'm-1', moka_variant_id: 'v-2', product_id: 'p-variant' },
      ],
    },
  );
  assert.equal(result.action, 'PROCESS');
  assert.equal(result.lines[0].productId, 'p-variant');
});

test('requires a server-side actor before any Moka sale can mutate stock', async () => {
  const result = await processMokaSale({}, {
    payment: { id: 'tx-1', status: 'PAID', items: [{ id: 'm-1', quantity: 1 }] },
    outlet: { id: 'out-1' }, locationId: 'loc-1', mappings: [{ moka_item_id: 'm-1', product_id: 'p-1' }],
  });
  assert.equal(result.action, 'FAILED');
  assert.equal(result.errorCode, 'SYSTEM_ACTOR_REQUIRED');
});
