'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RETURN_CATEGORIES, isSellableOnReceive, generateReturnNumber, validateReturnReason } = require('../services/stockistReturns');

test('RETURN_CATEGORIES contains the expected set', () => {
  assert.deepEqual([...RETURN_CATEGORIES].sort(), ['KEDALUWARSA', 'KELEBIHAN', 'LAINNYA', 'RUSAK', 'SALAH_KIRIM']);
});

test('isSellableOnReceive excludes damaged/expired categories only', () => {
  assert.equal(isSellableOnReceive('RUSAK'), false);
  assert.equal(isSellableOnReceive('KEDALUWARSA'), false);
  assert.equal(isSellableOnReceive('SALAH_KIRIM'), true);
  assert.equal(isSellableOnReceive('KELEBIHAN'), true);
  assert.equal(isSellableOnReceive('LAINNYA'), true);
});

test('generateReturnNumber produces a RTN-<BRANCH>-... number, uppercased and unique', () => {
  const a = generateReturnNumber('tegal');
  const b = generateReturnNumber('tegal');
  assert.match(a, /^RTN-TEGAL-\d+-[0-9a-f]{6}$/);
  assert.notEqual(a, b);
});

test('validateReturnReason rejects blank or missing reasons', () => {
  assert.throws(() => validateReturnReason(''), /reason is required/);
  assert.throws(() => validateReturnReason('   '), /reason is required/);
  assert.throws(() => validateReturnReason(undefined), /reason is required/);
  assert.doesNotThrow(() => validateReturnReason('barang tidak sesuai kategori retur'));
});
