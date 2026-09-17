'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveSourceLineKey,
  classifyLineItem,
  attributeBarber,
  calculateItemCommissionBase,
  normalizeTransactionPackage,
} = require('../services/mokaTransactionNormalizer');

const MOCK_OUTLET = { id: 'out-csb-123', slug: 'csb' };

const MOCK_BARBERS = [
  { id: 'csb-abdul', name: 'Abdul', branch: 'csb' },
  { id: 'csb-ragil', name: 'Ragil', branch: 'csb' },
  { id: 'csb-bob',   name: 'Bob',   branch: 'csb' },
];

const MOCK_MAPPINGS = new Map([
  // Exact (outlet, item, variant)
  [`out-csb-123:25658986:204187165`, { classification: 'NON_STOCK_SERVICE', classification_reason: 'Redbox Gentleman Grooming+' }],
  [`out-csb-123:18112524:207049935`, { classification: 'NON_STOCK_MISC',    classification_reason: 'Member Platinum' }],
  // Global (item, variant)
  [`94809567:147470744`,              { classification: 'NON_STOCK_SERVICE', classification_reason: 'Hair Cut' }],
  [`p-hairpowder:v-1`,                { classification: 'STOCK_PRODUCT',     classification_reason: 'Hair Powder' }],
]);

test('A. Raw Moka item normalization preserves fields correctly', () => {
  const payment = {
    id: 'tx-001',
    created_at: '2026-09-17T14:30:00.000+07:00',
    checkouts: [{
      uuid: 'line-uuid-1',
      item_name: 'Ragil',
      item_variant_name: 'Redbox Gentleman Grooming+',
      item_id: '25658986',
      item_variant_id: '204187165',
      quantity: 1,
      gross_sales: 120000,
      net_sales: 120000,
      discount_amount: 0,
      tax_amount: 12000,
      gratuity_amount: 5000,
    }],
  };

  const pkg = normalizeTransactionPackage(payment, MOCK_OUTLET, MOCK_MAPPINGS, MOCK_BARBERS);
  assert.equal(pkg.receipt_number, 'tx-001');
  assert.equal(pkg.items.length, 1);
  const item = pkg.items[0];
  assert.equal(item.source_line_key, 'line-uuid-1');
  assert.equal(item.barber_id, 'csb-ragil');
  assert.equal(item.classification, 'NON_STOCK_SERVICE');
  assert.equal(item.gross_amount, 120000);
  assert.equal(item.discount_amount, 0);
  assert.equal(item.net_amount, 120000);
  assert.equal(item.tax_amount, 12000);
  assert.equal(item.gratuity_amount, 5000);
  assert.equal(item.commission_base, 120000);
});

test('B. Stable line-item identity: uses UUID when present, deterministic fallback when absent', () => {
  const withUuid = { uuid: 'c-uuid-999', item_id: '123', item_variant_id: '456' };
  assert.equal(deriveSourceLineKey(withUuid, 'RB-100', 0), 'c-uuid-999');

  const withoutUuid = { item_id: '123', item_variant_id: '456' };
  assert.equal(deriveSourceLineKey(withoutUuid, 'RB-100', 2), 'RB-100:123:456:2');
});

test('C. Idempotent re-sync: same raw payment normalized twice yields identical rows and values', () => {
  const payment = {
    id: 'tx-idem',
    created_at: '2026-09-17T15:00:00.000+07:00',
    checkouts: [
      { uuid: 'u-1', item_name: 'Abdul', item_variant_name: 'Hair Cut', item_id: '94809567', item_variant_id: '147470744', gross_sales: 75000, net_sales: 75000 },
      { uuid: 'u-2', item_name: 'Hair Powder', item_id: 'p-hairpowder', item_variant_id: 'v-1', gross_sales: 100000, net_sales: 100000 },
    ],
  };

  const run1 = normalizeTransactionPackage(payment, MOCK_OUTLET, MOCK_MAPPINGS, MOCK_BARBERS);
  const run2 = normalizeTransactionPackage(payment, MOCK_OUTLET, MOCK_MAPPINGS, MOCK_BARBERS);

  assert.deepEqual(run1.items, run2.items);
  assert.equal(run1.items[0].source_line_key, run2.items[0].source_line_key);
  assert.equal(run1.items[1].source_line_key, run2.items[1].source_line_key);
});

test('D. Item discount: commission base is net service revenue after item discount', () => {
  const item = {
    classification: 'NON_STOCK_SERVICE',
    gross_amount: 85000,
    discount_amount: 42500,
    net_amount: 42500,
    quantity: 1,
    refunded_quantity: 0,
    is_deleted: false,
  };
  assert.equal(calculateItemCommissionBase(item), 42500);
});

test('E. Tax and gratuity are excluded from commission base', () => {
  const item = {
    classification: 'NON_STOCK_SERVICE',
    gross_amount: 100000,
    discount_amount: 0,
    net_amount: 100000,
    tax_amount: 11000,
    gratuity_amount: 10000,
    quantity: 1,
    refunded_quantity: 0,
    is_deleted: false,
  };
  // Base must be strictly the service net amount (100000), never 111000 or 121000
  assert.equal(calculateItemCommissionBase(item), 100000);
});

test('F. Refunded and deleted items produce 0 commission base', () => {
  const deletedItem = {
    classification: 'NON_STOCK_SERVICE',
    gross_amount: 100000,
    net_amount: 100000,
    quantity: 1,
    refunded_quantity: 0,
    is_deleted: true,
  };
  assert.equal(calculateItemCommissionBase(deletedItem), 0);

  const refundedItem = {
    classification: 'NON_STOCK_SERVICE',
    gross_amount: 100000,
    net_amount: 100000,
    quantity: 1,
    refunded_quantity: 1,
    is_deleted: false,
  };
  assert.equal(calculateItemCommissionBase(refundedItem), 0);
});

test('G. Retail products (STOCK_PRODUCT) produce 0 commission base', () => {
  const item = {
    classification: 'STOCK_PRODUCT',
    gross_amount: 150000,
    net_amount: 150000,
    quantity: 1,
    refunded_quantity: 0,
    is_deleted: false,
  };
  assert.equal(calculateItemCommissionBase(item), 0);
});

test('H. Membership products (NON_STOCK_MISC) produce 0 commission base', () => {
  const item = {
    classification: 'NON_STOCK_MISC',
    gross_amount: 500000,
    net_amount: 500000,
    quantity: 1,
    refunded_quantity: 0,
    is_deleted: false,
  };
  assert.equal(calculateItemCommissionBase(item), 0);
});

test('I. Custom Amount and Fee Colouring stay REVIEW_REQUIRED', () => {
  const custom = classifyLineItem({ item_name: 'Custom Amount' }, MOCK_MAPPINGS, MOCK_OUTLET.id);
  assert.equal(custom.classification, 'REVIEW_REQUIRED');

  const feeCol = classifyLineItem({ item_name: 'Fee Colouring' }, MOCK_MAPPINGS, MOCK_OUTLET.id);
  assert.equal(feeCol.classification, 'REVIEW_REQUIRED');
});

test('J. Men Massage Service stays REVIEW_REQUIRED', () => {
  const massage = classifyLineItem({ item_name: 'Men Massage Service' }, MOCK_MAPPINGS, MOCK_OUTLET.id);
  assert.equal(massage.classification, 'REVIEW_REQUIRED');
});

test('K. Multi-barber receipt assigns deterministic per-item revenue without equal-split', () => {
  const payment = {
    id: 'tx-multi-barber',
    created_at: '2026-09-17T16:00:00.000+07:00',
    checkouts: [
      { uuid: 'u-b1', item_name: 'Bob',   item_variant_name: 'Gentleman Grooming', item_id: '94809567', item_variant_id: '147470744', gross_sales: 95000, net_sales: 95000 },
      { uuid: 'u-b2', item_name: 'Abdul', item_variant_name: 'Hair Cut',           item_id: '94809567', item_variant_id: '147470744', gross_sales: 75000, net_sales: 75000 },
    ],
  };

  const pkg = normalizeTransactionPackage(payment, MOCK_OUTLET, MOCK_MAPPINGS, MOCK_BARBERS);
  assert.equal(pkg.items.length, 2);

  const bobItem = pkg.items.find(i => i.barber_id === 'csb-bob');
  const abdulItem = pkg.items.find(i => i.barber_id === 'csb-abdul');

  assert.ok(bobItem);
  assert.ok(abdulItem);
  assert.equal(bobItem.commission_base, 95000);
  assert.equal(abdulItem.commission_base, 75000);
  // Total is 170000, Bob gets 95k, Abdul gets 75k — NEVER equal-split (85k each)!
  assert.notEqual(bobItem.commission_base, 85000);
  assert.notEqual(abdulItem.commission_base, 85000);
});

test('L. Ambiguous or missing barber fails closed with barber_id = null', () => {
  const resNoBarber = attributeBarber({ item_name: 'Unregistered Staff' }, MOCK_BARBERS, 'csb');
  assert.equal(resNoBarber.barberId, null);
  assert.equal(resNoBarber.status, 'UNMATCHED_BARBER');

  const resBlank = attributeBarber({ item_name: '' }, MOCK_BARBERS, 'csb');
  assert.equal(resBlank.barberId, null);
  assert.equal(resBlank.status, 'NO_BARBER_INDICATED');
});
