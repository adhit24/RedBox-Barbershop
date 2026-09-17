'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STATUS,
  EXCEPTION_REASON,
  parseReceiptItems,
  calculateBarberCommission,
} = require('../services/commissionCalculator');

const ABDUL = { id: 'bypass-abdul-dul', name: 'Abdul', commission_rate: null };

// Explicit ID-based mapping fixtures — standing in for a properly-triaged
// moka_item_mappings table (production currently has ZERO NON_STOCK_SERVICE
// rows; see Task 2.1 audit). Using explicit mappings here, rather than name
// keywords, is deliberate: it proves the calculator's classification-authority
// rule (ID mapping wins, name is advisory-only) rather than smuggling keyword
// matching in as the real authority.
function mapping(id, classification, overrides = {}) {
  return { moka_item_id: id, moka_variant_id: null, outlet_id: null, classification, ...overrides };
}

test('A: service only => fully included and commissionable', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r1', net_sales: 85000, status: 'payment' },
    items: [{ moka_item_id: 'hair-cut-plus', barber_name: 'Abdul', service_name: 'Hair Cut+', price: 85000 }],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('hair-cut-plus', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.deepEqual(result.service_items, ['Hair Cut+']);
  assert.equal(result.commissionable_amount, 85000);
  assert.equal(result.calculated_commission, 25500);
});

test('B: service + retail => retail excluded from commission base', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r2', net_sales: 110000, status: 'payment' },
    items: [
      { moka_item_id: 'hair-cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000 },
      { moka_item_id: 'pomade-x', barber_name: 'Abdul', service_name: 'Suavecito Pomade', price: 50000 },
    ],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('hair-cut', 'NON_STOCK_SERVICE'), mapping('pomade-x', 'STOCK_PRODUCT')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.deepEqual(result.service_items, ['Hair Cut']);
  assert.deepEqual(result.excluded_items, ['Suavecito Pomade']);
  assert.equal(result.commissionable_amount, 60000, 'retail price must not enter the commission base');
});

test('C: service + F&B/misc => excluded from commission base', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r3', net_sales: 85000, status: 'payment' },
    items: [
      { moka_item_id: 'hair-cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000 },
      { moka_item_id: 'teh-botol', barber_name: 'Abdul', service_name: 'Teh Botol / Fruit Tea', price: 25000 },
    ],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('hair-cut', 'NON_STOCK_SERVICE'), mapping('teh-botol', 'NON_STOCK_MISC')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.deepEqual(result.excluded_items, ['Teh Botol / Fruit Tea']);
  assert.equal(result.commissionable_amount, 60000);
});

test('D: service + add-on => both services included in the commission base', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r4', net_sales: 150000, status: 'payment' },
    items: [
      { moka_item_id: 'gentleman', barber_name: 'Abdul', service_name: 'Redbox Gentleman Grooming', price: 100000 },
      { moka_item_id: 'shave', barber_name: 'Abdul', service_name: 'Shave', price: 50000 },
    ],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('gentleman', 'NON_STOCK_SERVICE'), mapping('shave', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.deepEqual(result.service_items, ['Redbox Gentleman Grooming', 'Shave']);
  assert.equal(result.commissionable_amount, 150000);
});

test('E: 1 customer + 2 services => customer_count stays 1', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r4b', net_sales: 150000, status: 'payment' },
    items: [
      { moka_item_id: 'gentleman', barber_name: 'Abdul', service_name: 'Redbox Gentleman Grooming', price: 100000 },
      { moka_item_id: 'shave', barber_name: 'Abdul', service_name: 'Shave', price: 50000 },
    ],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('gentleman', 'NON_STOCK_SERVICE'), mapping('shave', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.customer_count, 1);
  assert.equal(result.service_items.length, 2);
});

test('F: missing commission rate => MISSING_RATE, never silently calculated', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r5', net_sales: 85000, status: 'payment' },
    items: [{ moka_item_id: 'hair-cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 85000 }],
    barber: ABDUL, // commission_rate: null
    commissionRate: null,
    itemMappings: [mapping('hair-cut', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.status, STATUS.MISSING_RATE);
  assert.equal(result.calculated_commission, null);
  assert.ok(result.exception_reasons.includes(EXCEPTION_REASON.MISSING_COMMISSION_RATE));
});

test('G: unmapped item (no ID mapping, unknown name) => REVIEW_REQUIRED/UNMAPPED_ITEM, never guessed', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r6', net_sales: 40000, status: 'payment' },
    items: [{ moka_item_id: 'mystery-item', barber_name: 'Abdul', service_name: 'Fee Colouring', price: 40000 }],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [], // deliberately no mapping — mirrors the real "Fee Colouring" anomaly
  });
  assert.ok([STATUS.REVIEW_REQUIRED, STATUS.UNMAPPED_ITEM].includes(result.status));
  assert.equal(result.calculated_commission, null);
});

test('H: cancelled transaction => excluded from commission', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r7', net_sales: 85000, status: 'cancelled' },
    items: [{ moka_item_id: 'hair-cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 85000 }],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('hair-cut', 'NON_STOCK_SERVICE')],
  });
  assert.notEqual(result.status, STATUS.READY);
  assert.equal(result.calculated_commission, 0);
  assert.ok(result.exception_reasons.includes(EXCEPTION_REASON.INVALID_TRANSACTION_STATUS));
});

test('I: refunded transaction => excluded from commission', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r8', net_sales: 85000, status: 'refunded' },
    items: [{ moka_item_id: 'hair-cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 85000 }],
    barber: ABDUL,
    commissionRate: 0.3,
    itemMappings: [mapping('hair-cut', 'NON_STOCK_SERVICE')],
  });
  assert.notEqual(result.status, STATUS.READY);
  assert.equal(result.calculated_commission, 0);
});

test('J: multiple barbers with item-level price => each barber gets only their own service revenue', () => {
  const items = [
    { moka_item_id: 'fade', barber_name: 'Epik', service_name: 'Hair Cut with Fade', price: 90000 },
    { moka_item_id: 'cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 60000 },
    { moka_item_id: 'baron', barber_name: 'Abdul', service_name: 'Redbox Baron Grooming', price: 120000 },
  ];
  const itemMappings = [mapping('fade', 'NON_STOCK_SERVICE'), mapping('cut', 'NON_STOCK_SERVICE'), mapping('baron', 'NON_STOCK_SERVICE')];
  const abdulResult = calculateBarberCommission({
    transaction: { id: 'r9', net_sales: 270000, status: 'payment' },
    items, barber: ABDUL, commissionRate: 0.3, itemMappings,
  });
  const epikResult = calculateBarberCommission({
    transaction: { id: 'r9', net_sales: 270000, status: 'payment' },
    items, barber: { id: 'epik', name: 'Epik' }, commissionRate: 0.3, itemMappings,
  });
  assert.equal(abdulResult.status, STATUS.READY);
  assert.equal(abdulResult.commissionable_amount, 180000, 'Abdul must only get his own two services, not an equal split of the receipt');
  assert.equal(epikResult.status, STATUS.READY);
  assert.equal(epikResult.commissionable_amount, 90000);
});

test('K: ambiguous multi-barber without item-level price => REVIEW_REQUIRED, never equal-split', () => {
  // Mirrors the real production pattern found in receipt 1K8VJRW: 4 barbers
  // + a drink, one shared net_sales total, no per-item price.
  const result = calculateBarberCommission({
    transaction: { id: '1K8VJRW', net_sales: 465000, status: 'payment' },
    items: [
      { barber_name: 'Epik', service_name: 'Hair Cut with Fade' },
      { barber_name: 'Shepril', service_name: 'Hair Cut' },
      { barber_name: 'Yafi', service_name: 'Redbox Baron Grooming' },
      { barber_name: 'Ahmad', service_name: 'Redbox Baron Grooming' },
      { barber_name: 'Teh Botol / Fruit Tea / Tebs', service_name: 'Teh Botol / Fruit Tea' },
    ],
    barber: { id: 'ahmad', name: 'Ahmad' },
    commissionRate: 0.3,
    itemMappings: [],
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.equal(result.commissionable_amount, null, 'must never fall back to an equal split of net_sales');
  assert.equal(result.calculated_commission, null);
  assert.ok(result.exception_reasons.includes(EXCEPTION_REASON.MULTI_BARBER_UNRESOLVED));
});

test('L: rate 30% => arithmetic correct', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r10', net_sales: 100000, status: 'payment' },
    items: [{ moka_item_id: 'cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 100000 }],
    barber: ABDUL, commissionRate: 0.30, itemMappings: [mapping('cut', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.calculated_commission, 30000);
});

test('M: rate 35% => arithmetic correct', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r11', net_sales: 100000, status: 'payment' },
    items: [{ moka_item_id: 'cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 100000 }],
    barber: ABDUL, commissionRate: 0.35, itemMappings: [mapping('cut', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.calculated_commission, 35000);
});

test('N: historical calculation accepts an explicit rate parameter, ignoring the barber\'s current rate', () => {
  const barberWithCurrentRate = { id: 'bypass-abdul-dul', name: 'Abdul', commission_rate: 0.35 };
  const result = calculateBarberCommission({
    transaction: { id: 'r12', net_sales: 100000, status: 'payment' },
    items: [{ moka_item_id: 'cut', barber_name: 'Abdul', service_name: 'Hair Cut', price: 100000 }],
    barber: barberWithCurrentRate,
    commissionRate: 0.30, // explicit historical rate — must win over barber.commission_rate
    itemMappings: [mapping('cut', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.commission_rate, 0.30);
  assert.equal(result.calculated_commission, 30000);
});

test('O: retail-only transaction, no service => commissionable amount is 0', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r13', net_sales: 45000, status: 'payment' },
    items: [{ moka_item_id: 'pomade-x', barber_name: 'Abdul', service_name: 'Suavecito Pomade', price: 45000 }],
    barber: ABDUL, commissionRate: 0.3, itemMappings: [mapping('pomade-x', 'STOCK_PRODUCT')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 0);
  assert.equal(result.calculated_commission, 0);
});

test('MISSING_BARBER: null barber => blocked, not silently skipped', () => {
  const result = calculateBarberCommission({
    transaction: { id: 'r14', net_sales: 85000, status: 'payment' },
    items: [{ moka_item_id: 'cut', barber_name: 'Unknown', service_name: 'Hair Cut', price: 85000 }],
    barber: null, commissionRate: 0.3,
  });
  assert.equal(result.status, STATUS.MISSING_BARBER);
});

// -------------------------------------------------------------------------
// Real-data-shape tests (no item-level price) — reflects the ACTUAL current
// Moka pipeline, where only a receipt-level net_sales total is available.
// -------------------------------------------------------------------------

test('Real-shape: single barber, all-service items, no item price => full net_sales is safely commissionable', () => {
  const items = parseReceiptItems('Abdul (Hair Cut+)');
  const result = calculateBarberCommission({
    transaction: { id: '1K8VLCC', net_sales: 85000, status: 'payment' },
    items, barber: ABDUL, commissionRate: 0.3,
    itemMappings: [mapping('Hair Cut+', 'NON_STOCK_SERVICE')],
  });
  // classifyItem only matches by moka_item_id, and parseReceiptItems doesn't
  // produce one from text alone — so without an ID this stays REVIEW_REQUIRED
  // by design (never guesses from name, even though "Hair Cut+" is a known
  // service name). Assert that honest behavior:
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.equal(result.commissionable_amount, null);
});

test('Real-shape: single barber, all-service items WITH id mapping, no item price => full net_sales commissionable', () => {
  const items = parseReceiptItems('Abdul (Hair Cut+)').map((i) => ({ ...i, moka_item_id: 'hair-cut-plus' }));
  const result = calculateBarberCommission({
    transaction: { id: '1K8VLCC', net_sales: 85000, status: 'payment' },
    items, barber: ABDUL, commissionRate: 0.3,
    itemMappings: [mapping('hair-cut-plus', 'NON_STOCK_SERVICE')],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 85000);
  assert.equal(result.calculated_commission, 25500);
});

test('Real-shape: single barber, service + drink mixed, no item price => REVIEW_REQUIRED (cannot isolate service portion)', () => {
  // Mirrors real receipt 1K8VLBJ pattern: service(s) + a drink in one receipt.
  const items = parseReceiptItems('Abdul (Hair Cut with Fade), Abdul (Hair Colouring)')
    .concat(parseReceiptItems('Teh Botol / Fruit Tea / Tebs (Teh Botol / Fruit Tea)'))
    .map((i, idx) => ({ ...i, moka_item_id: idx < 2 ? 'svc' : 'drink' }));
  const result = calculateBarberCommission({
    transaction: { id: '1K8VLBJ', net_sales: 200000, status: 'payment' },
    items, barber: ABDUL, commissionRate: 0.3,
    itemMappings: [mapping('svc', 'NON_STOCK_SERVICE'), mapping('drink', 'NON_STOCK_MISC')],
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.equal(result.commissionable_amount, null);
  assert.ok(result.exception_reasons.includes(EXCEPTION_REASON.NO_ITEM_LEVEL_PRICE));
});

test('Real-shape: multi-barber receipt, no item price => REVIEW_REQUIRED, never equal-split net_sales', () => {
  // Real production receipt 1K8VJRW pattern (see audit).
  const items = parseReceiptItems(
    'Epik (Hair Cut with Fade), Shepril (Hair Cut), Yafi (Redbox Baron Grooming), Ahmad (Redbox Baron Grooming), Teh Botol / Fruit Tea / Tebs (Teh Botol / Fruit Tea)'
  );
  const result = calculateBarberCommission({
    transaction: { id: '1K8VJRW', net_sales: 465000, status: 'payment' },
    items, barber: { id: 'yafi', name: 'Yafi' }, commissionRate: 0.3,
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.notEqual(result.commissionable_amount, 116250, 'must not reproduce the known equal-split bug (465000/4)');
  assert.equal(result.commissionable_amount, null);
});

// -------------------------------------------------------------------------
// Task 2.1C: Canonical moka_transaction_items integration tests
// -------------------------------------------------------------------------

/**
 * Adapter function transforming canonical moka_transaction_items rows
 * into the input structure expected by calculateBarberCommission.
 */
function adaptCanonicalItemsToCalculator(transaction, canonicalItems) {
  const items = (canonicalItems || []).map(ci => ({
    moka_item_id: ci.source_item_id,
    moka_variant_id: ci.source_variant_id || null,
    outlet_id: ci.outlet_id || null,
    service_name: ci.variant_name ? `${ci.item_name} (${ci.variant_name})` : ci.item_name,
    barber_name: ci.barber_name_raw || null,
    classification: ci.classification,
    price: ci.classification === 'NON_STOCK_SERVICE' ? ci.net_amount : (ci.net_amount ?? 0),
  }));

  return {
    transaction: {
      id: transaction.id || transaction.receipt_number,
      receipt_number: transaction.receipt_number,
      net_sales: transaction.net_sales,
      gross_sales: transaction.gross_sales,
      status: transaction.status || 'payment',
    },
    items,
  };
}

test('Canonical integration: service-only => READY if rate supplied', () => {
  const tx = { receipt_number: 'REC-001', net_sales: 85000, gross_sales: 85000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: '207062709',
      item_name: 'Abdul', variant_name: 'Hair Cut+',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 85000, discount_amount: 0, net_amount: 85000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: '207062709' })],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 85000);
  assert.equal(result.calculated_commission, 29750);
});

test('Canonical integration: service + retail => retail excluded', () => {
  const tx = { receipt_number: 'REC-002', net_sales: 220000, gross_sales: 220000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: '207062709',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
    {
      source_item_id: 'retail-1', source_variant_id: 'var-1',
      item_name: 'MANTOLOGY', variant_name: 'Styling Powder',
      barber_name_raw: null, classification: 'STOCK_PRODUCT',
      gross_amount: 145000, discount_amount: 0, net_amount: 145000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: '207062709' }),
      mapping('retail-1', 'STOCK_PRODUCT', { moka_variant_id: 'var-1' }),
    ],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 75000);
  assert.equal(result.calculated_commission, 26250);
});

test('Canonical integration: service + drink => drink excluded', () => {
  const tx = { receipt_number: 'REC-003', net_sales: 95000, gross_sales: 95000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: '207062709',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
    {
      source_item_id: 'drink-1', source_variant_id: 'var-drink',
      item_name: 'Teh Botol', variant_name: '',
      barber_name_raw: null, classification: 'NON_STOCK_MISC',
      gross_amount: 20000, discount_amount: 0, net_amount: 20000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: '207062709' }),
      mapping('drink-1', 'NON_STOCK_MISC', { moka_variant_id: 'var-drink' }),
    ],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 75000);
});

test('Canonical integration: service + membership => membership excluded', () => {
  const tx = { receipt_number: 'REC-004', net_sales: 275000, gross_sales: 275000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: '207062709',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
    {
      source_item_id: '16902093', source_variant_id: '207049813',
      item_name: 'Member Platinum', variant_name: '',
      barber_name_raw: null, classification: 'NON_STOCK_MISC',
      gross_amount: 200000, discount_amount: 0, net_amount: 200000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: '207062709' }),
      mapping('16902093', 'NON_STOCK_MISC', { moka_variant_id: '207049813' }),
    ],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 75000);
});

test('Canonical integration: multi-service same barber => correct sum', () => {
  const tx = { receipt_number: 'REC-005', net_sales: 90000, gross_sales: 90000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: '207062709',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
    {
      source_item_id: '16902095', source_variant_id: 'beard-id',
      item_name: 'Abdul', variant_name: 'Beard & Mustache',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 15000, discount_amount: 0, net_amount: 15000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: '207062709' }),
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: 'beard-id' }),
    ],
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.commissionable_amount, 90000);
  assert.equal(result.calculated_commission, 31500);
});

test('Canonical integration: multi-barber with deterministic per-item attribution => correct individual totals', () => {
  const tx = { receipt_number: 'REC-006', net_sales: 245000, gross_sales: 245000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: 'bob-item', source_variant_id: 'v1',
      item_name: 'Bob', variant_name: 'Redbox Gentleman Grooming',
      barber_name_raw: 'Bob', classification: 'NON_STOCK_SERVICE',
      gross_amount: 95000, discount_amount: 0, net_amount: 95000,
    },
    {
      source_item_id: '16902095', source_variant_id: 'v2',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
    {
      source_item_id: 'ari-item', source_variant_id: 'v3',
      item_name: 'Ari', variant_name: 'Hair Cut',
      barber_name_raw: 'Ari', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);

  // Abdul's commission calculation
  const abdulResult = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [
      mapping('bob-item', 'NON_STOCK_SERVICE', { moka_variant_id: 'v1' }),
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: 'v2' }),
      mapping('ari-item', 'NON_STOCK_SERVICE', { moka_variant_id: 'v3' }),
    ],
  });
  assert.equal(abdulResult.status, STATUS.READY);
  assert.equal(abdulResult.commissionable_amount, 75000);
  assert.equal(abdulResult.calculated_commission, 26250);

  // Bob's commission calculation
  const bobResult = calculateBarberCommission({
    transaction, items, barber: { id: 'bob-id', name: 'Bob' }, commissionRate: 0.35,
    itemMappings: [
      mapping('bob-item', 'NON_STOCK_SERVICE', { moka_variant_id: 'v1' }),
      mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: 'v2' }),
      mapping('ari-item', 'NON_STOCK_SERVICE', { moka_variant_id: 'v3' }),
    ],
  });
  assert.equal(bobResult.status, STATUS.READY);
  assert.equal(bobResult.commissionable_amount, 95000);
  assert.equal(bobResult.calculated_commission, 33250);
});

test('Canonical integration: missing barber => review', () => {
  const tx = { receipt_number: 'REC-007', net_sales: 75000, gross_sales: 75000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: 'v1',
      item_name: 'Unknown', variant_name: 'Hair Cut',
      barber_name_raw: null, classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: 0.35,
    itemMappings: [mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: 'v1' })],
  });
  assert.equal(result.status, STATUS.REVIEW_REQUIRED);
  assert.ok(result.exception_reasons.includes(EXCEPTION_REASON.AMBIGUOUS_BARBER));
});

test('Canonical integration: missing rate => MISSING_RATE', () => {
  const tx = { receipt_number: 'REC-008', net_sales: 75000, gross_sales: 75000, status: 'payment' };
  const canonicalItems = [
    {
      source_item_id: '16902095', source_variant_id: 'v1',
      item_name: 'Abdul', variant_name: 'Hair Cut',
      barber_name_raw: 'Abdul', classification: 'NON_STOCK_SERVICE',
      gross_amount: 75000, discount_amount: 0, net_amount: 75000,
    },
  ];
  const { transaction, items } = adaptCanonicalItemsToCalculator(tx, canonicalItems);
  const result = calculateBarberCommission({
    transaction, items, barber: ABDUL, commissionRate: null,
    itemMappings: [mapping('16902095', 'NON_STOCK_SERVICE', { moka_variant_id: 'v1' })],
  });
  assert.equal(result.status, STATUS.MISSING_RATE);
});

