'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
  validateProductType,
  assertProductType,
} = require('../services/stockistInventory');

test('applyInventoryMovement calls the RPC with the given params and returns the ledger row', async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: 'ledger-1', quantity_after: 5 }, error: null };
    },
  };
  const result = await applyInventoryMovement(supabase, {
    productId: 'p1', locationId: 'l1', quantityDelta: 5, movementType: 'WAREHOUSE_RECEIVE',
    performedBy: 'u1', referenceType: null, referenceId: null, reason: 'invoice #123',
  });
  assert.deepEqual(calls, [{
    name: 'apply_inventory_movement',
    args: {
      p_product_id: 'p1', p_location_id: 'l1', p_quantity_delta: 5, p_movement_type: 'WAREHOUSE_RECEIVE',
      p_performed_by: 'u1', p_reference_type: null, p_reference_id: null, p_reason: 'invoice #123',
    },
  }]);
  assert.deepEqual(result, { id: 'ledger-1', quantity_after: 5 });
});

test('applyInventoryMovement throws the Postgres error message on failure', async () => {
  const supabase = { async rpc() { return { data: null, error: { message: 'insufficient stock: ...' } }; } };
  await assert.rejects(
    () => applyInventoryMovement(supabase, {
      productId: 'p1', locationId: 'l1', quantityDelta: -5, movementType: 'TRANSFER_OUT', performedBy: 'u1',
    }),
    /insufficient stock/,
  );
});

test('stripPurchasePrice removes purchase_price for non-owner roles only', () => {
  const product = { id: 'p1', name: 'Pomade', purchase_price: 12000, retail_price: 25000 };
  assert.deepEqual(stripPurchasePrice(product, 'owner'), product);
  assert.deepEqual(stripPurchasePrice(product, 'branch_admin'), { id: 'p1', name: 'Pomade', retail_price: 25000 });
});

test('calculateTransferDiscrepancy detects any mismatched received quantity', () => {
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: 10 }]), false);
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: 8 }]), true);
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: null }]), false);
  assert.equal(calculateTransferDiscrepancy([
    { quantity_sent: 10, quantity_received: 10 },
    { quantity_sent: 5, quantity_received: 4 },
  ]), true);
});

test('validateAdjustmentReason rejects blank or missing reasons', () => {
  assert.throws(() => validateAdjustmentReason(''), /reason is required/);
  assert.throws(() => validateAdjustmentReason('   '), /reason is required/);
  assert.throws(() => validateAdjustmentReason(undefined), /reason is required/);
  assert.doesNotThrow(() => validateAdjustmentReason('koreksi salah input qty'));
});

test('validateProductType accepts only RETAIL and SERVICE', () => {
  assert.doesNotThrow(() => validateProductType('RETAIL'));
  assert.doesNotThrow(() => validateProductType('SERVICE'));
  assert.throws(() => validateProductType('WHOLESALE'), /product type/);
});

test('assertProductType rejects retail products in service flow', () => {
  assert.throws(
    () => assertProductType({ id: 'p1', product_type: 'RETAIL' }, 'SERVICE'),
    (error) => error.code === 'SERVICE_PRODUCT_REQUIRED',
  );
});
