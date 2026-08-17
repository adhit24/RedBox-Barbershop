'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  generateRequestNumber,
  validateApprovalItems,
  deriveRequestStatus,
  validateRejectionReason,
  reserveInventoryStock,
  releaseInventoryReservation,
  fulfillReservedTransferOut,
} = require('../services/stockistRequests');

test('generateRequestNumber produces a REQ-<BRANCH>-... number, uppercased and unique', () => {
  const a = generateRequestNumber('csb');
  const b = generateRequestNumber('csb');
  assert.match(a, /^REQ-CSB-\d+-[0-9a-f]{6}$/);
  assert.notEqual(a, b);
});

test('validateApprovalItems requires every request item to be covered exactly once', () => {
  const requestItems = [
    { id: 'i1', quantity_requested: 10 },
    { id: 'i2', quantity_requested: 5 },
  ];
  assert.throws(
    () => validateApprovalItems(requestItems, [{ item_id: 'i1', quantity_approved: 10 }]),
    /all request items must be included/,
  );
  assert.throws(
    () => validateApprovalItems(requestItems, [
      { item_id: 'i1', quantity_approved: 10 },
      { item_id: 'i2', quantity_approved: 5 },
      { item_id: 'i3', quantity_approved: 1 },
    ]),
    /all request items must be included/,
  );
});

test('validateApprovalItems rejects negative, non-integer, or over-requested quantities', () => {
  const requestItems = [{ id: 'i1', quantity_requested: 10 }];
  assert.throws(() => validateApprovalItems(requestItems, [{ item_id: 'i1', quantity_approved: -1 }]), /non-negative integer/);
  assert.throws(() => validateApprovalItems(requestItems, [{ item_id: 'i1', quantity_approved: 1.5 }]), /non-negative integer/);
  assert.throws(() => validateApprovalItems(requestItems, [{ item_id: 'i1', quantity_approved: 11 }]), /cannot exceed quantity_requested/);
  assert.doesNotThrow(() => validateApprovalItems(requestItems, [{ item_id: 'i1', quantity_approved: 10 }]));
});

test('validateApprovalItems rejects an all-zero approval — must use /reject instead', () => {
  const requestItems = [
    { id: 'i1', quantity_requested: 10 },
    { id: 'i2', quantity_requested: 5 },
  ];
  assert.throws(
    () => validateApprovalItems(requestItems, [
      { item_id: 'i1', quantity_approved: 0 },
      { item_id: 'i2', quantity_approved: 0 },
    ]),
    /use reject/,
  );
  assert.doesNotThrow(() => validateApprovalItems(requestItems, [
    { item_id: 'i1', quantity_approved: 0 },
    { item_id: 'i2', quantity_approved: 5 },
  ]));
});

test('deriveRequestStatus is APPROVED only when every item is approved in full, else PARTIALLY_APPROVED', () => {
  const requestItems = [
    { id: 'i1', quantity_requested: 10 },
    { id: 'i2', quantity_requested: 5 },
  ];
  assert.equal(deriveRequestStatus(requestItems, [
    { item_id: 'i1', quantity_approved: 10 },
    { item_id: 'i2', quantity_approved: 5 },
  ]), 'APPROVED');
  assert.equal(deriveRequestStatus(requestItems, [
    { item_id: 'i1', quantity_approved: 10 },
    { item_id: 'i2', quantity_approved: 3 },
  ]), 'PARTIALLY_APPROVED');
  assert.equal(deriveRequestStatus(requestItems, [
    { item_id: 'i1', quantity_approved: 10 },
    { item_id: 'i2', quantity_approved: 0 },
  ]), 'PARTIALLY_APPROVED');
});

test('validateRejectionReason rejects blank or missing reasons', () => {
  assert.throws(() => validateRejectionReason(''), /reason is required/);
  assert.throws(() => validateRejectionReason('   '), /reason is required/);
  assert.throws(() => validateRejectionReason(undefined), /reason is required/);
  assert.doesNotThrow(() => validateRejectionReason('stok gudang tidak mencukupi'));
});

test('reserveInventoryStock/releaseInventoryReservation/fulfillReservedTransferOut call the matching RPC and surface errors', async () => {
  const calls = [];
  const supabase = { async rpc(name, args) { calls.push({ name, args }); return { data: { ok: true }, error: null }; } };

  await reserveInventoryStock(supabase, { productId: 'p1', locationId: 'l1', quantity: 5 });
  await releaseInventoryReservation(supabase, { productId: 'p1', locationId: 'l1', quantity: 5 });
  await fulfillReservedTransferOut(supabase, {
    productId: 'p1', locationId: 'l1', quantity: 5, performedBy: 'u1', referenceType: 'stock_transfer', referenceId: 't1',
  });

  assert.deepEqual(calls.map((c) => c.name), [
    'reserve_inventory_stock', 'release_inventory_reservation', 'fulfill_reserved_transfer_out',
  ]);
  assert.deepEqual(calls[0].args, { p_product_id: 'p1', p_location_id: 'l1', p_quantity: 5 });

  const failing = { async rpc() { return { data: null, error: { message: 'insufficient available stock: ...' } }; } };
  await assert.rejects(() => reserveInventoryStock(failing, { productId: 'p1', locationId: 'l1', quantity: 5 }), /insufficient available stock/);
});
