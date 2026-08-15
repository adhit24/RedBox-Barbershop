'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getMemberToken,
  normalizeIdentityName,
  normalizeIdentityPhone,
  sameIdentityName,
  sameIdentityPhone,
} = require('../membership-identity');

test('normalizes Indonesian member phone variants to one identity', () => {
  assert.equal(normalizeIdentityPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeIdentityPhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(sameIdentityPhone('081234567890', '+6281234567890'), true);
  assert.equal(sameIdentityPhone('081234567890', '081234567891'), false);
});

test('normalizes member names without weakening identity matching', () => {
  assert.equal(normalizeIdentityName('  Sugiono  '), 'sugiono');
  assert.equal(normalizeIdentityName('SUGIONO'), 'sugiono');
  assert.equal(sameIdentityName('Sugiono', 'sugiono'), true);
  assert.equal(sameIdentityName('Sugiono', 'Sugiono Jr'), false);
});

test('prefers bearer member token and supports legacy x-member-token header', () => {
  assert.equal(getMemberToken({ authorization: 'Bearer abc', 'x-member-token': 'legacy' }), 'abc');
  assert.equal(getMemberToken({ 'x-member-token': 'legacy' }), 'legacy');
  assert.equal(getMemberToken({}), null);
});
