'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isExplicitPriceInquiry } = require('../../api/wa/webhook');

const PRICE_CASES = [
  'Gentleman Grooming berapa harganya?',
  'harga gentleman berapa?',
  'biaya haircut berapa?',
  'berapa harga gentleman?',
  'bayar berapa untuk gentleman?',
  'kena berapa untuk haircut?',
  'berapa rupiah gentleman grooming?',
  'price haircut',
  'tarif haircut',
];

const NON_PRICE_CASES = [
  'Tegal buka jam berapa?',
  'Tegal tutup jam berapa?',
  'jam berapa buka?',
  'jam berapa tutup?',
  'booking jam berapa?',
  'kapster Opan masuk jam berapa?',
  'besok jam berapa?',
  'terakhir booking jam berapa?',
];

test('P0.2: explicit price expressions are classified as price inquiries', () => {
  for (const message of PRICE_CASES) {
    assert.equal(isExplicitPriceInquiry(message), true, message);
  }
});

test('P0.2: generic berapa in time/schedule questions is not classified as price', () => {
  for (const message of NON_PRICE_CASES) {
    assert.equal(isExplicitPriceInquiry(message), false, message);
  }
});
