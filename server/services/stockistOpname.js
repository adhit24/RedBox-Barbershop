'use strict';

const { randomUUID } = require('crypto');

function generateOpnameNumber(locationLabel) {
  return `OPN-${String(locationLabel).toUpperCase()}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

function computeDifference(systemQuantity, physicalQuantity) {
  return physicalQuantity - systemQuantity;
}

// Every item must have a physical count before submission (a partial count
// isn't a finished stocktake), and any item with a nonzero difference must
// carry a reason — mirrors validateAdjustmentReason's "no silent stock
// changes" rule, applied per-line instead of per-request.
function validateOpnameSubmission(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('opname has no items to submit');
  }
  for (const item of items) {
    if (!Number.isInteger(item.physical_quantity) || item.physical_quantity < 0) {
      throw new Error(`product ${item.product_id} is missing a physical count`);
    }
    const difference = computeDifference(item.system_quantity, item.physical_quantity);
    if (difference !== 0 && (typeof item.reason !== 'string' || !item.reason.trim())) {
      throw new Error(`a reason is required for the quantity difference on product ${item.product_id}`);
    }
  }
}

module.exports = {
  generateOpnameNumber,
  computeDifference,
  validateOpnameSubmission,
};
