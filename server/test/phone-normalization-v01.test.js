'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhoneNumber } = require('../identity/phoneNormalization');

test('Indonesian local convenience form normalizes to 62-prefixed', () => {
  assert.equal(normalizePhoneNumber('081234567890'), '6281234567890');
  assert.equal(normalizePhoneNumber('0812-3456-7890'), '6281234567890');
});

test('already-62-prefixed Indonesian numbers pass through, with or without +', () => {
  assert.equal(normalizePhoneNumber('6281234567890'), '6281234567890');
  assert.equal(normalizePhoneNumber('+6281234567890'), '6281234567890');
});

test('international personal numbers are accepted (objective 1, requirement 2)', () => {
  const cases = [
    ['+6591234567', '6591234567'],       // Singapore
    ['6591234567', '6591234567'],        // Singapore, no plus
    ['+60123456789', '60123456789'],     // Malaysia
    ['+14155552671', '14155552671'],     // USA
    ['+447911123456', '447911123456'],   // UK
    ['+819012345678', '819012345678'],   // Japan
    ['+821012345678', '821012345678'],   // Korea
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizePhoneNumber(input), expected, `expected ${input} -> ${expected}`);
  }
});

test('normalized output is always digits-only', () => {
  assert.match(normalizePhoneNumber('+1 415 555 2671'), /^\d+$/);
  assert.match(normalizePhoneNumber('081234567890'), /^\d+$/);
});

test('malformed input is rejected: letters, multiple +, embedded @, group/broadcast shapes', () => {
  const invalid = [
    '0812abc345678',
    '+62+81234567890',
    '6281234567890@s.whatsapp.net',
    '120363012345678@g.us',
    'status@broadcast',
    '6.28123456789e12',
    '',
    123456789,
    null,
    undefined,
    {},
    [],
  ];
  for (const value of invalid) {
    assert.equal(normalizePhoneNumber(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('obviously too-short numbers are rejected', () => {
  assert.equal(normalizePhoneNumber('123'), null);
});

test('bounded to max 15 normalized digits, 15 exactly is accepted, 16 is rejected', () => {
  assert.equal(normalizePhoneNumber('123456789012345'), '123456789012345'); // 15 digits, boundary
  assert.equal(normalizePhoneNumber('1234567890123456'), null); // 16 digits, rejected
});
