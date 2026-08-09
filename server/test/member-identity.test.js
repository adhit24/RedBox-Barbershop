'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeMemberPhone, getMemberPhoneVariants, mergeCustomerRows } = require('../member-identity');

test('canonicalizes Indonesian phone variants to one identity', () => {
  assert.equal(normalizeMemberPhone('0813-5766-2424'), '6281357662424');
  assert.deepEqual(getMemberPhoneVariants('+6281357662424'), [
    '6281357662424', '+6281357662424', '081357662424'
  ]);
});

test('merges duplicate customer rows without losing the strongest data', () => {
  const merged = mergeCustomerRows([
    { wa: '6281357662424', source: 'moka', name: 'Adhit Nugraha', points: 0, visits: 0, total_spent: 250000, first_visit: '2026-04-12' },
    { wa: '+6281357662424', source: 'web', points: 50, visits: 0, total_spent: 0, services: ['Haircut'] },
    { wa: '081357662424', source: 'web', points: 0, visits: 1, total_spent: 95000, last_visit: '2026-05-18', services: ['Hair and Fade Cut'] },
  ], '081357662424');

  assert.equal(merged.wa, '6281357662424');
  assert.equal(merged.phone_e164, '+6281357662424');
  assert.equal(merged.points, 50);
  assert.equal(merged.visits, 1);
  assert.equal(merged.total_spent, 250000);
  assert.deepEqual(merged.services.sort(), ['Hair and Fade Cut', 'Haircut']);
});
