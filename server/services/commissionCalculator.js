'use strict';

// Task 2.1: Kapster Revenue Sharing Foundation — pure-function calculator.
//
// Ground truth this is built from (see audit for full detail):
//   - Real barber-performed services currently exist only as UNCLASSIFIED
//     anomaly names in `moka_stockist_anomalies` — `moka_item_mappings` has
//     ZERO NON_STOCK_SERVICE rows in production today. This function treats
//     an explicit ID-based mapping (moka_item_id + moka_variant_id +
//     outlet_id -> classification) as the ONLY authority. A name match is
//     never a final answer — only a `suggested_classification` a reviewer
//     can confirm, per the "no keyword-as-final-authority" rule.
//   - Moka's "Served By" export column is 100% empty in this dataset and
//     cannot be used for attribution. The only attribution signal available
//     is the barber's name embedded in each parsed line item
//     ("BarberName (Service)"), which the caller is expected to have
//     already parsed into `items[].barber_name` (see parseReceiptItems).
//   - Moka's item-level text carries NO per-item price — only a single
//     receipt-level net_sales/gross_sales total. That means a precise
//     per-item revenue split is only possible when the caller supplies
//     `items[].price` explicitly (e.g. once a future data source provides
//     it). Without per-item price, this function will only produce a READY
//     result for the unambiguous case (single barber on the receipt, every
//     item is that barber's and classified NON_STOCK_SERVICE) and will
//     never guess a split for a multi-barber or mixed-classification
//     receipt without per-item price — it returns REVIEW_REQUIRED instead.
//
// This module does not read or write the database, does not compute
// payroll, and does not touch attendance/membership/Command Center code.

const STATUS = Object.freeze({
  READY: 'READY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  MISSING_RATE: 'MISSING_RATE',
  MISSING_BARBER: 'MISSING_BARBER',
  UNMAPPED_ITEM: 'UNMAPPED_ITEM',
});

const EXCEPTION_REASON = Object.freeze({
  UNMAPPED_ITEM: 'UNMAPPED_ITEM',
  REVIEW_REQUIRED_ITEM: 'REVIEW_REQUIRED_ITEM',
  MISSING_BARBER: 'MISSING_BARBER',
  MISSING_COMMISSION_RATE: 'MISSING_COMMISSION_RATE',
  AMBIGUOUS_BARBER: 'AMBIGUOUS_BARBER',
  MULTI_BARBER_UNRESOLVED: 'MULTI_BARBER_UNRESOLVED',
  INVALID_TRANSACTION_STATUS: 'INVALID_TRANSACTION_STATUS',
  // Not in the original exception list — added because it is a distinct,
  // real, frequently-hit case in the current data: we know an item is a
  // commissionable service and who performed it, but cannot isolate its
  // price from the receipt total because no item-level price is available.
  NO_ITEM_LEVEL_PRICE: 'NO_ITEM_LEVEL_PRICE',
});

const CLASSIFICATION = Object.freeze({
  STOCK_PRODUCT: 'STOCK_PRODUCT',
  NON_STOCK_SERVICE: 'NON_STOCK_SERVICE',
  NON_STOCK_MISC: 'NON_STOCK_MISC',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

const CANCELLED_TRANSACTION_STATUSES = new Set([
  'void', 'cancelled', 'canceled', 'refunded', 'refund', 'payment with refund',
]);

// Verified real Redbox barber-service names (from moka_stockist_anomalies,
// cross-checked against the 2026-09-07 classification backfill migration).
// Advisory only — see classifyItem().
const KNOWN_SERVICE_NAMES = new Set([
  'Beard & Mustache', 'Charcoal Deep Cleansing', 'Deep Clean White', 'Hair Colouring',
  'Hair Curly', 'Hair Cut', 'Hair Cut Long Trim', 'Hair Cut with Fade', 'Hair Cut+',
  'Hair Spa', 'Redbox Baron Grooming', 'Redbox Baron Grooming +', 'Redbox Duke Grooming',
  'Redbox Earl Grooming', 'Redbox Gentleman Grooming', 'Redbox Gentleman Grooming+',
  'Redbox Gentlemen Grooming', 'Redbox Noble Grooming', 'Shave', 'Redbox Fade Cut Grooming',
  'Hair Wash & Styling', 'Hair Smoothing', 'Smooth and Shape', 'Men Massage Service',
  'Wedding Royal Grooming Platinum',
]);

// Verified real non-service (retail/F&B/fee/membership) names. Deliberately
// closed-world, same discipline as the 2026-09-07 backfill migration: a name
// matching neither this set nor KNOWN_SERVICE_NAMES is left fully ambiguous.
const KNOWN_NON_SERVICE_NAMES = new Set([
  'Baileys Coffee', 'Chicken Karaage & French Fries', 'Chocolate', 'Cloud Latte',
  'Custom Amount', 'French Fries', 'Hazelnut Coffee', 'Hazelnut Roll', 'Hot', 'Ice',
  'Kacang Goreng', 'Kaluli Arabikapro', 'Kaluli Chocomaster', 'Kaluli Light Yummy Yoghurt',
  'Kaluli Nutalk Pecan', 'Lemonade Coffee', 'Lychee Yakult Tea', 'Macha Strawberry',
  'Member Platinum', 'Member Student', 'Nestle Pure Life Air Mineral', 'Orange Rumbillion',
  'Paper Bag', 'Pristine Water', 'Senyawa Coffee', 'Specialty Coffee', 'Sunkist Coffee',
  'TEH / TEBS Kaleng', 'Teh Botol / Fruit Tea', 'Teh Botol / Fruit Tea / Tebs', 'TIPS', 'Vanilla',
  'Milk Base (Chocolate/Taro)', 'Croissant (Double Chocolate)',
]);

function normalize(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeKey(value) {
  return normalize(value).toLowerCase();
}

/**
 * Parses Moka's "Name (Service), Name2 (Service2)" receipt item text into
 * discrete {barber_name, service_name} entries. Top-level-comma split so a
 * service name containing its own comma-free parens is handled correctly.
 * This mirrors the parsing already used elsewhere in the codebase
 * (extractBarberItems) but is reimplemented here as a standalone pure
 * function with no DB/side effects, per Task 2.1's pure-function scope.
 */
function parseReceiptItems(itemsRaw) {
  const text = normalize(itemsRaw);
  if (!text) return [];

  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  const items = [];
  for (const part of parts) {
    const parenIdx = part.indexOf('(');
    if (parenIdx < 0) continue;
    const barberName = part.slice(0, parenIdx).trim();
    const serviceName = part.slice(parenIdx + 1, part.lastIndexOf(')')).trim();
    if (barberName && serviceName) items.push({ barber_name: barberName, service_name: serviceName });
  }
  return items;
}

/**
 * Classification authority per Task 2.1 section 3:
 *   1. Explicit moka_item_id/moka_variant_id/outlet_id mapping — final.
 *   2. Everything else -> REVIEW_REQUIRED, with a `suggested_classification`
 *      derived from name matching for a human reviewer only. Never treated
 *      as the final classification, even when the name is unambiguous,
 *      because production has zero confirmed NON_STOCK_SERVICE mappings
 *      today and a keyword match must not silently stand in for that audit.
 *
 * itemMappings: [{ moka_item_id, moka_variant_id, outlet_id, classification }]
 */
function classifyItem(item, itemMappings = []) {
  const hasIdKey = item.moka_item_id != null && item.moka_item_id !== '';
  if (hasIdKey) {
    const mapping = itemMappings.find((m) =>
      m.moka_item_id === item.moka_item_id
      && normalize(m.moka_variant_id) === normalize(item.moka_variant_id)
      && normalize(m.outlet_id) === normalize(item.outlet_id));
    if (mapping && mapping.classification) {
      return { classification: mapping.classification, source: 'id_mapping' };
    }
  }

  const name = normalize(item.service_name);
  if (KNOWN_SERVICE_NAMES.has(name)) {
    return { classification: CLASSIFICATION.REVIEW_REQUIRED, suggested_classification: CLASSIFICATION.NON_STOCK_SERVICE, source: 'name_heuristic' };
  }
  if (KNOWN_NON_SERVICE_NAMES.has(name)) {
    return { classification: CLASSIFICATION.REVIEW_REQUIRED, suggested_classification: CLASSIFICATION.NON_STOCK_MISC, source: 'name_heuristic' };
  }
  return { classification: CLASSIFICATION.REVIEW_REQUIRED, suggested_classification: null, source: 'unknown' };
}

function isCancelledStatus(status) {
  return CANCELLED_TRANSACTION_STATUSES.has(normalizeKey(status));
}

function round(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * calculateBarberCommission — the Task 2.1 pure function.
 *
 * @param {object} params
 * @param {object} params.transaction  { id|receipt_number, net_sales, gross_sales, status }
 * @param {Array}  params.items        Parsed line items (see parseReceiptItems), each
 *                                      optionally carrying moka_item_id/moka_variant_id/
 *                                      outlet_id for classification and an explicit
 *                                      `price` when a source can supply per-item pricing.
 * @param {object|null} params.barber  { id, name, commission_rate } — the barber this
 *                                      calculation is FOR. null => MISSING_BARBER.
 * @param {number|null} params.commissionRate  Explicit rate (0..1) to use for THIS
 *                                      calculation. Takes precedence over
 *                                      barber.commission_rate so historical
 *                                      recalculation never silently reads a barber's
 *                                      *current* rate (see Task 2.1 section 8).
 * @param {Array}  params.itemMappings Explicit ID-based classification authority.
 */
function calculateBarberCommission({ transaction = {}, items = [], barber = null, commissionRate = null, itemMappings = [] } = {}) {
  const result = {
    transaction_id: transaction.id ?? transaction.receipt_number ?? null,
    barber_id: barber?.id ?? null,
    customer_count: 0,
    service_items: [],
    excluded_items: [],
    review_items: [],
    commissionable_amount: null,
    commission_rate: null,
    calculated_commission: null,
    status: STATUS.READY,
    exception_reasons: [],
  };

  if (isCancelledStatus(transaction.status)) {
    result.status = STATUS.REVIEW_REQUIRED;
    result.exception_reasons.push(EXCEPTION_REASON.INVALID_TRANSACTION_STATUS);
    result.commissionable_amount = 0;
    result.calculated_commission = 0;
    return result;
  }

  if (!barber || !barber.id) {
    result.status = STATUS.MISSING_BARBER;
    result.exception_reasons.push(EXCEPTION_REASON.MISSING_BARBER);
    return result;
  }

  const effectiveRate = commissionRate != null ? commissionRate : (barber.commission_rate ?? null);
  if (effectiveRate == null) {
    result.status = STATUS.MISSING_RATE;
    result.exception_reasons.push(EXCEPTION_REASON.MISSING_COMMISSION_RATE);
    return result;
  }
  result.commission_rate = effectiveRate;

  const targetKey = normalizeKey(barber.name);

  const classified = items.map((item) => ({
    ...item,
    ...classifyItem(item, itemMappings),
  }));

  const myItems = [];
  const otherBarberItems = [];
  const unattributedItems = [];

  for (const item of classified) {
    const itemBarberKey = normalizeKey(item.barber_name);
    if (!itemBarberKey) {
      unattributedItems.push(item);
    } else if (itemBarberKey === targetKey) {
      myItems.push(item);
    } else {
      otherBarberItems.push(item);
    }
  }

  result.customer_count = myItems.length > 0 ? 1 : 0;

  const myService = myItems.filter((i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE);
  const myExcluded = myItems.filter((i) => i.classification === CLASSIFICATION.STOCK_PRODUCT || i.classification === CLASSIFICATION.NON_STOCK_MISC);
  const myReview = myItems.filter((i) => i.classification === CLASSIFICATION.REVIEW_REQUIRED);

  result.service_items = myService.map((i) => i.service_name);
  result.excluded_items = myExcluded.map((i) => i.service_name);
  result.review_items = [
    ...myReview.map((i) => i.service_name),
    ...unattributedItems.map((i) => i.service_name),
  ];

  const hasOtherBarbers = otherBarberItems.length > 0;
  const allItemsHavePrice = items.length > 0 && items.every((i) => typeof i.price === 'number' && Number.isFinite(i.price));

  if (allItemsHavePrice) {
    // Precise per-item split — the ideal path once a data source can supply
    // it. Knowing each item's own price means a receipt shared by several
    // barbers is NOT automatically ambiguous: each barber's own service
    // items are summed independently of what other barbers' items cost.
    const commissionable = myService.reduce((sum, i) => sum + i.price, 0);
    result.commissionable_amount = round(commissionable);
    const unattributedServices = unattributedItems.filter((i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE);
    if (unattributedServices.length > 0) {
      result.exception_reasons.push(EXCEPTION_REASON.AMBIGUOUS_BARBER);
      result.status = STATUS.REVIEW_REQUIRED;
    } else if (myReview.length > 0) {
      result.exception_reasons.push(EXCEPTION_REASON.REVIEW_REQUIRED_ITEM);
      result.status = STATUS.UNMAPPED_ITEM;
    } else {
      result.status = STATUS.READY;
    }
  } else if (myItems.length === 0) {
    // This barber has no attributed items at all on this receipt.
    result.commissionable_amount = 0;
    if (hasOtherBarbers) result.exception_reasons.push(EXCEPTION_REASON.MULTI_BARBER_UNRESOLVED);
    if (unattributedItems.length > 0) result.exception_reasons.push(EXCEPTION_REASON.AMBIGUOUS_BARBER);
    result.status = (hasOtherBarbers || unattributedItems.length > 0) ? STATUS.REVIEW_REQUIRED : STATUS.READY;
  } else if (!hasOtherBarbers && myReview.length === 0 && unattributedItems.length === 0) {
    // Unambiguous case: this barber is the ONLY barber on the receipt and
    // every one of their items is a confirmed classification (service or
    // excluded) — the full receipt total is safely attributable to them,
    // and only the service portion is commissionable. Since Moka gives no
    // per-item price, we can only trust the receipt total as "my revenue"
    // when there is no other barber to share it with.
    if (myExcluded.length > 0 && myService.length > 0) {
      // Mixed service + retail on a single-barber receipt: we know the
      // total but not the service-only portion without item-level price.
      result.status = STATUS.REVIEW_REQUIRED;
      result.exception_reasons.push(EXCEPTION_REASON.NO_ITEM_LEVEL_PRICE);
      result.commissionable_amount = null;
    } else if (myService.length > 0) {
      result.commissionable_amount = round(Number(transaction.net_sales) || 0);
      result.status = STATUS.READY;
    } else {
      // Only excluded items, nothing commissionable.
      result.commissionable_amount = 0;
      result.status = STATUS.READY;
    }
  } else {
    // Multi-barber and/or unresolved items, with no per-item price to
    // safely split the shared receipt total by.
    result.status = STATUS.REVIEW_REQUIRED;
    if (hasOtherBarbers) result.exception_reasons.push(EXCEPTION_REASON.MULTI_BARBER_UNRESOLVED, EXCEPTION_REASON.NO_ITEM_LEVEL_PRICE);
    if (unattributedItems.length > 0) result.exception_reasons.push(EXCEPTION_REASON.AMBIGUOUS_BARBER);
    if (myReview.length > 0) result.exception_reasons.push(EXCEPTION_REASON.REVIEW_REQUIRED_ITEM);
    result.commissionable_amount = null;
  }

  result.calculated_commission = (result.status === STATUS.READY && result.commissionable_amount != null)
    ? round(result.commissionable_amount * effectiveRate)
    : null;

  result.exception_reasons = [...new Set(result.exception_reasons)];

  return result;
}

module.exports = {
  STATUS,
  EXCEPTION_REASON,
  CLASSIFICATION,
  KNOWN_SERVICE_NAMES,
  KNOWN_NON_SERVICE_NAMES,
  parseReceiptItems,
  classifyItem,
  calculateBarberCommission,
};
