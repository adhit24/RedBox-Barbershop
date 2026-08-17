'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generateOpnameNumber, computeDifference, validateOpnameSubmission } = require('../services/stockistOpname');

test('generateOpnameNumber produces an OPN-<LABEL>-... number, uppercased and unique', () => {
  const a = generateOpnameNumber('csb');
  const b = generateOpnameNumber('csb');
  assert.match(a, /^OPN-CSB-\d+-[0-9a-f]{6}$/);
  assert.notEqual(a, b);
});

test('computeDifference is physical minus system', () => {
  assert.equal(computeDifference(10, 8), -2);
  assert.equal(computeDifference(10, 12), 2);
  assert.equal(computeDifference(10, 10), 0);
});

test('validateOpnameSubmission requires every item to have a physical count', () => {
  assert.throws(
    () => validateOpnameSubmission([{ product_id: 'p1', system_quantity: 10, physical_quantity: null, reason: null }]),
    /missing a physical count/,
  );
  assert.throws(
    () => validateOpnameSubmission([{ product_id: 'p1', system_quantity: 10, physical_quantity: -1, reason: null }]),
    /missing a physical count/,
  );
});

test('validateOpnameSubmission requires a reason only when there is a nonzero difference', () => {
  assert.doesNotThrow(() => validateOpnameSubmission([
    { product_id: 'p1', system_quantity: 10, physical_quantity: 10, reason: null },
  ]));
  assert.throws(
    () => validateOpnameSubmission([{ product_id: 'p1', system_quantity: 10, physical_quantity: 8, reason: null }]),
    /a reason is required/,
  );
  assert.throws(
    () => validateOpnameSubmission([{ product_id: 'p1', system_quantity: 10, physical_quantity: 8, reason: '   ' }]),
    /a reason is required/,
  );
  assert.doesNotThrow(() => validateOpnameSubmission([
    { product_id: 'p1', system_quantity: 10, physical_quantity: 8, reason: 'barang rusak saat pindah rak' },
  ]));
});

test('validateOpnameSubmission rejects an empty item list', () => {
  assert.throws(() => validateOpnameSubmission([]), /no items/);
});
