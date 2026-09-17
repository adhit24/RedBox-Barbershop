'use strict';

/**
 * REDBOX COMMAND CENTER — Moka Transaction & Line Item Normalizer
 * Single canonical logic authority for normalizing raw Moka POS payment payloads
 * into structured transactions and deterministic line items.
 *
 * Rules:
 *  - Stable line-item identity: checkout.uuid first; composite key fallback.
 *  - Strict service classification: EXACT_SERVICE_MATCH (NON_STOCK_SERVICE),
 *    STOCK_PRODUCT, NON_STOCK_MISC, REVIEW_REQUIRED.
 *  - Custom Amount, Fee Colouring, Men Massage Service -> REVIEW_REQUIRED.
 *  - Barber attribution: exact barber match via matchBarberName; NULL if ambiguous.
 *    Never equal-split. Never guess.
 *  - Item net revenue: post-discount item net sales.
 *  - Exclude from commission: tax, gratuity, retail, F&B, membership, misc, refunded/deleted.
 */

const { matchBarberName } = require('../moka/txSync');

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

function jakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function parsePaymentDate(payment) {
  const iso = payment.created_at || payment.synchronized_at || payment.updated_at;
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return jakartaDate(parsed);
  }
  const display = String(payment.transaction_date || '').trim();
  const match = display.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (match) {
    const months = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const month = months[match[2]];
    if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
  }
  return null;
}

function parsePaymentTime(payment) {
  const iso = payment.created_at || payment.synchronized_at || payment.updated_at || '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(iso)) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: JAKARTA_TIME_ZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(parsed);
    }
  }
  return String(payment.transaction_time || '');
}

function deriveSourceLineKey(checkout, receiptNumber, position) {
  if (checkout?.uuid && typeof checkout.uuid === 'string' && checkout.uuid.trim().length > 0) {
    return String(checkout.uuid).trim();
  }
  const itemId = checkout?.item_id !== undefined && checkout?.item_id !== null ? String(checkout.item_id) : 'no_item';
  const variantId = checkout?.item_variant_id !== undefined && checkout?.item_variant_id !== null ? String(checkout.item_variant_id) : 'no_var';
  return `${receiptNumber}:${itemId}:${variantId}:${position}`;
}

/**
 * Classify a line item deterministically based on exact mappings,
 * catalog verification, and approved business rules.
 */
function classifyLineItem(checkout, mappingsMap = new Map(), outletId = null) {
  const itemName = String(checkout?.item_name || checkout?.name || '').trim();
  const variantName = String(checkout?.item_variant_name || checkout?.variant_name || '').trim();
  const itemId = checkout?.item_id !== undefined && checkout?.item_id !== null ? String(checkout.item_id) : null;
  const variantId = checkout?.item_variant_id !== undefined && checkout?.item_variant_id !== null ? String(checkout.item_variant_id) : null;

  // Rule 1: Custom Amount & Fee Colouring always require review
  if (/^custom\s*amount/i.test(itemName) || /^custom\s*amount/i.test(variantName)) {
    return {
      classification: 'REVIEW_REQUIRED',
      reason: 'Rule: Custom Amount requires manual review to identify underlying item.',
    };
  }
  if (/fee\s*colou?ring/i.test(itemName) || /fee\s*colou?ring/i.test(variantName)) {
    return {
      classification: 'REVIEW_REQUIRED',
      reason: 'Rule: Fee Colouring requires manual review before commission allocation.',
    };
  }

  // Rule 2: Men Massage Service - no canonical service in Redbox catalog
  if (/men\s*massage/i.test(itemName) || /men\s*massage/i.test(variantName)) {
    return {
      classification: 'REVIEW_REQUIRED',
      reason: 'Rule: Men Massage Service not found in canonical services catalog — review required.',
    };
  }

  // Rule 3: Exact lookup in moka_item_mappings
  // Key format precedence: outletId:itemId:variantId, then itemId:variantId
  if (itemId && variantId) {
    if (outletId) {
      const outletSpecific = mappingsMap.get(`${outletId}:${itemId}:${variantId}`);
      if (outletSpecific && outletSpecific.classification) {
        return {
          classification: outletSpecific.classification,
          reason: outletSpecific.classification_reason || 'Exact (outlet, item, variant) mapping match',
        };
      }
    }
    const globalMatch = mappingsMap.get(`${itemId}:${variantId}`);
    if (globalMatch && globalMatch.classification) {
      return {
        classification: globalMatch.classification,
        reason: globalMatch.classification_reason || 'Exact (item, variant) mapping match',
      };
    }
  }

  // Rule 4: Membership patterns explicitly confirmed
  if (/member\s*(platinum|student|gold|silver)/i.test(itemName) || /member\s*(platinum|student|gold|silver)/i.test(variantName)) {
    return {
      classification: 'NON_STOCK_MISC',
      reason: 'Membership tier product — non-stock misc',
    };
  }

  // Rule 5: Fallback if completely unmapped
  return {
    classification: 'REVIEW_REQUIRED',
    reason: `Unmapped line item: "${itemName} (${variantName})" [item=${itemId}, var=${variantId}]`,
  };
}

/**
 * Attribute barber deterministically from line item.
 * Never equal split. Never guess.
 */
function attributeBarber(checkout, activeBarbers = [], outletSlug = null) {
  const rawName = String(checkout?.item_name || checkout?.name || '').trim();
  if (!rawName || !activeBarbers.length) {
    return { barberId: null, barberNameRaw: rawName || null, status: 'NO_BARBER_INDICATED' };
  }

  const matched = matchBarberName(rawName, activeBarbers, outletSlug);
  if (matched && matched.id) {
    return {
      barberId: matched.id,
      barberNameRaw: rawName,
      status: 'RESOLVED',
    };
  }

  return {
    barberId: null,
    barberNameRaw: rawName,
    status: 'UNMATCHED_BARBER',
  };
}

/**
 * Calculate the commissionable base for a normalized line item.
 * Post-discount net revenue of service lines only.
 */
function calculateItemCommissionBase(item) {
  // Non-services (retail, food/drink, memberships, misc) are 100% excluded
  if (item.classification !== 'NON_STOCK_SERVICE') {
    return 0;
  }
  // Void or fully refunded items
  if (item.is_deleted || (item.quantity > 0 && item.refunded_quantity >= item.quantity)) {
    return 0;
  }

  const gross = Math.max(0, Number(item.gross_amount) || 0);
  const discount = Math.max(0, Number(item.discount_amount) || 0);
  const net = item.net_amount !== undefined && item.net_amount !== null
    ? Math.max(0, Number(item.net_amount) || 0)
    : Math.max(0, gross - discount);

  // If partial refund exists, calculate effective net for remaining non-refunded units
  if (item.quantity > 0 && item.refunded_quantity > 0 && item.refunded_quantity < item.quantity) {
    const activeRatio = (item.quantity - item.refunded_quantity) / item.quantity;
    return Math.round(net * activeRatio);
  }

  return Math.round(net);
}

/**
 * Normalize an entire payment envelope and its line items.
 */
function normalizeTransactionPackage(payment, outlet, mappingsMap = new Map(), barbers = []) {
  if (!payment) return null;

  const receiptNumber = String(payment.id || payment.payment_no || payment.receipt_number || payment.receipt_no || '');
  if (!receiptNumber) return null;

  const txDate = parsePaymentDate(payment);
  const txTime = parsePaymentTime(payment);
  const outletSlug = outlet.slug;
  const outletId = outlet.id || null;

  const rawCheckouts = Array.isArray(payment.checkouts)
    ? payment.checkouts
    : (Array.isArray(payment.order_items) ? payment.order_items : (Array.isArray(payment.items) ? payment.items : []));

  const isVoid = Boolean(payment.is_deleted) || String(payment.transaction_status || payment.status || '').toUpperCase() === 'VOID';
  const isRefunded = Boolean(payment.is_refunded) || Number(payment.total_refund || payment.refund_amount || 0) > 0;

  const normalizedItems = [];
  let position = 0;

  for (const c of rawCheckouts) {
    const sourceLineKey = deriveSourceLineKey(c, receiptNumber, position);
    const classificationRes = classifyLineItem(c, mappingsMap, outletId);
    const barberRes = attributeBarber(c, barbers, outletSlug);

    const qty = Math.max(0, Number(c.quantity || c.qty || 1));
    const gross = Number(
      c.gross_sales !== undefined ? c.gross_sales :
      (c.item_price_quantity !== undefined ? c.item_price_quantity :
      ((Number(c.price ?? c.item_price ?? 0)) * qty))
    ) || 0;

    const disc = Number(c.discount_amount ?? c.item_discount ?? 0) || 0;
    const net = Number(c.net_sales !== undefined ? c.net_sales : (gross - disc)) || 0;
    const tax = Number(c.tax_amount || 0) || 0;
    const gratuity = Number(c.gratuity_amount || 0) || 0;
    const isItemDeleted = isVoid || Boolean(c.is_deleted);
    const refundedQty = Number(c.refunded_quantity || (isRefunded && qty === 1 ? 1 : 0)) || 0;

    const itemRow = {
      receipt_number: receiptNumber,
      source_line_key: sourceLineKey,
      outlet_id: outletId,
      outlet_slug: outletSlug,
      tx_date: txDate,
      tx_time: txTime,
      source_item_id: c.item_id !== undefined && c.item_id !== null ? String(c.item_id) : null,
      source_variant_id: c.item_variant_id !== undefined && c.item_variant_id !== null ? String(c.item_variant_id) : null,
      item_name: String(c.item_name || c.name || 'Unknown Item').trim(),
      variant_name: String(c.item_variant_name || c.variant_name || '').trim() || null,
      category_name: String(c.category_name || c.category || '').trim() || null,
      quantity: qty,
      gross_amount: gross,
      discount_amount: disc,
      net_amount: net,
      tax_amount: tax,
      gratuity_amount: gratuity,
      classification: classificationRes.classification,
      classification_reason: classificationRes.reason,
      barber_id: barberRes.barberId,
      barber_name_raw: barberRes.barberNameRaw,
      is_deleted: isItemDeleted,
      refunded_quantity: refundedQty,
      raw_payload: c,
    };

    itemRow.commission_base = calculateItemCommissionBase(itemRow);
    normalizedItems.push(itemRow);
    position++;
  }

  // Summary counts for observability
  const summary = {
    receipt_number: receiptNumber,
    tx_date: txDate,
    outlet_slug: outletSlug,
    items_total: normalizedItems.length,
    services_count: normalizedItems.filter(i => i.classification === 'NON_STOCK_SERVICE').length,
    products_count: normalizedItems.filter(i => i.classification === 'STOCK_PRODUCT').length,
    misc_count: normalizedItems.filter(i => i.classification === 'NON_STOCK_MISC').length,
    review_count: normalizedItems.filter(i => i.classification === 'REVIEW_REQUIRED').length,
    attributed_barbers_count: new Set(normalizedItems.map(i => i.barber_id).filter(Boolean)).size,
    unattributed_items_count: normalizedItems.filter(i => i.classification === 'NON_STOCK_SERVICE' && !i.barber_id).length,
    total_commission_base: normalizedItems.reduce((sum, i) => sum + i.commission_base, 0),
  };

  return {
    receipt_number: receiptNumber,
    tx_date: txDate,
    tx_time: txTime,
    outlet_slug: outletSlug,
    outlet_id: outletId,
    items: normalizedItems,
    summary,
  };
}

module.exports = {
  JAKARTA_TIME_ZONE,
  jakartaDate,
  parsePaymentDate,
  parsePaymentTime,
  deriveSourceLineKey,
  classifyLineItem,
  attributeBarber,
  calculateItemCommissionBase,
  normalizeTransactionPackage,
};
