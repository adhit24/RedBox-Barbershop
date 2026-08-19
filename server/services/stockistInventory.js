'use strict';

const VALID_MOVEMENT_TYPES = new Set([
  'WAREHOUSE_RECEIVE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
  'RETURN_TO_CENTER',
  'SALE_RETAIL',
  'SERVICE_USE',
  'STOCK_OPNAME_GAIN',
  'STOCK_OPNAME_LOSS',
  'DAMAGE',
  'LOST',
]);

const VALID_PRODUCT_TYPES = new Set(['RETAIL', 'SERVICE']);

function validateMovementType(movementType) {
  if (!VALID_MOVEMENT_TYPES.has(movementType)) {
    throw new Error(`invalid movement type: ${movementType}`);
  }
}

function validateProductType(productType) {
  if (!VALID_PRODUCT_TYPES.has(productType)) {
    const error = new Error('product type must be RETAIL or SERVICE');
    error.code = 'INVALID_PRODUCT_TYPE';
    throw error;
  }
}

function assertProductType(product, expectedType) {
  validateProductType(expectedType);
  const actualType = product?.product_type || 'RETAIL';
  validateProductType(actualType);
  if (actualType === expectedType) return;

  const error = new Error(
    expectedType === 'SERVICE'
      ? 'service product required'
      : `product type ${expectedType} required`
  );
  error.code = expectedType === 'SERVICE' ? 'SERVICE_PRODUCT_REQUIRED' : 'PRODUCT_TYPE_MISMATCH';
  error.productId = product?.id || null;
  error.expectedType = expectedType;
  error.actualType = actualType;
  throw error;
}

async function applyInventoryMovement(supabase, {
  productId, locationId, quantityDelta, movementType, performedBy,
  referenceType = null, referenceId = null, reason = null,
}) {
  validateMovementType(movementType);
  const { data, error } = await supabase.rpc('apply_inventory_movement', {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity_delta: quantityDelta,
    p_movement_type: movementType,
    p_performed_by: performedBy,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || 'inventory movement failed');
  return data;
}

function stripPurchasePrice(product, role) {
  if (role === 'owner') return product;
  const { purchase_price, ...rest } = product;
  return rest;
}

function calculateTransferDiscrepancy(items) {
  return items.some((item) => item.quantity_received != null && item.quantity_received !== item.quantity_sent);
}

function validateAdjustmentReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reason is required for manual adjustments');
  }
}

module.exports = {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
  validateProductType,
  assertProductType,
};
