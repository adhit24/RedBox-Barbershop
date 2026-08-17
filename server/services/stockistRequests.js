'use strict';

const { randomUUID } = require('crypto');

function generateRequestNumber(branchSlug) {
  return `REQ-${String(branchSlug).toUpperCase()}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

// Validates that an approval payload covers every item on the request with
// a legal quantity_approved, and that at least one item is actually being
// approved — a full-zero "approval" must go through /reject instead, so a
// decline always carries a mandatory reason.
function validateApprovalItems(requestItems, submittedItems) {
  if (!Array.isArray(submittedItems) || submittedItems.length === 0) {
    throw new Error('items must be a non-empty list of { item_id, quantity_approved >= 0 }');
  }
  const allItemIds = new Set(requestItems.map((i) => i.id));
  const submittedIds = new Set(submittedItems.map((i) => i.item_id));
  if (allItemIds.size !== submittedIds.size || [...allItemIds].some((id) => !submittedIds.has(id))) {
    throw new Error('all request items must be included in the approval');
  }
  const byId = new Map(requestItems.map((i) => [i.id, i]));
  for (const submitted of submittedItems) {
    if (!Number.isInteger(submitted.quantity_approved) || submitted.quantity_approved < 0) {
      throw new Error(`quantity_approved must be a non-negative integer for item ${submitted.item_id}`);
    }
    const existing = byId.get(submitted.item_id);
    if (!existing) throw new Error(`unknown request item ${submitted.item_id}`);
    if (submitted.quantity_approved > existing.quantity_requested) {
      throw new Error(`quantity_approved cannot exceed quantity_requested for item ${submitted.item_id}`);
    }
  }
  if (submittedItems.every((i) => i.quantity_approved === 0)) {
    throw new Error('at least one item must be approved; use reject to decline the entire request');
  }
}

function deriveRequestStatus(requestItems, submittedItems) {
  const byId = new Map(requestItems.map((i) => [i.id, i]));
  const isFull = submittedItems.every((submitted) => {
    const original = byId.get(submitted.item_id);
    return original && submitted.quantity_approved === original.quantity_requested;
  });
  return isFull ? 'APPROVED' : 'PARTIALLY_APPROVED';
}

function validateRejectionReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reason is required to reject a request');
  }
}

async function reserveInventoryStock(supabase, { productId, locationId, quantity }) {
  const { data, error } = await supabase.rpc('reserve_inventory_stock', {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity: quantity,
  });
  if (error) throw new Error(error.message || 'failed to reserve stock');
  return data;
}

async function releaseInventoryReservation(supabase, { productId, locationId, quantity }) {
  const { data, error } = await supabase.rpc('release_inventory_reservation', {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity: quantity,
  });
  if (error) throw new Error(error.message || 'failed to release reservation');
  return data;
}

async function fulfillReservedTransferOut(supabase, {
  productId, locationId, quantity, performedBy, referenceType, referenceId,
}) {
  const { data, error } = await supabase.rpc('fulfill_reserved_transfer_out', {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity: quantity,
    p_performed_by: performedBy,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
  });
  if (error) throw new Error(error.message || 'failed to fulfill reservation');
  return data;
}

module.exports = {
  generateRequestNumber,
  validateApprovalItems,
  deriveRequestStatus,
  validateRejectionReason,
  reserveInventoryStock,
  releaseInventoryReservation,
  fulfillReservedTransferOut,
};
