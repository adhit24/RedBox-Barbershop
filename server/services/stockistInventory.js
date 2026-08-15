'use strict';

async function applyInventoryMovement(supabase, {
  productId, locationId, quantityDelta, movementType, performedBy,
  referenceType = null, referenceId = null, reason = null,
}) {
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
};
