'use strict';

const { randomUUID } = require('crypto');

const RETURN_CATEGORIES = new Set(['RUSAK', 'KEDALUWARSA', 'SALAH_KIRIM', 'KELEBIHAN', 'LAINNYA']);

// Damaged/expired stock is removed from the branch but must never silently
// re-enter sellable warehouse inventory — only categories where the goods
// are still genuinely sellable increment the warehouse balance on receipt.
const NON_SELLABLE_CATEGORIES = new Set(['RUSAK', 'KEDALUWARSA']);

function isSellableOnReceive(category) {
  return !NON_SELLABLE_CATEGORIES.has(category);
}

function generateReturnNumber(branchSlug) {
  return `RTN-${String(branchSlug).toUpperCase()}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

function validateReturnReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reason is required to reject a return');
  }
}

module.exports = {
  RETURN_CATEGORIES,
  isSellableOnReceive,
  generateReturnNumber,
  validateReturnReason,
};
