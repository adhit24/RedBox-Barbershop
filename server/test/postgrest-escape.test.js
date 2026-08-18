'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { escapePostgrestValue } = require('../utils/postgrestEscape');

test('passes a normal search term through unchanged', () => {
  assert.equal(escapePostgrestValue('budi'), 'budi');
});

test('strips commas and parentheses that could inject extra PostgREST filter clauses', () => {
  // Matches the exact behavior verified during Task 4: a caller-controlled
  // value that tries to append a structural filter clause (e.g.
  // ",role.eq.admin") has its `,`/`(`/`)` characters stripped, so it can
  // never break out of the single value position it was interpolated into.
  assert.equal(escapePostgrestValue('budi,role.eq.admin'), 'budirole.eq.admin');
  assert.equal(escapePostgrestValue('a(b)c'), 'abc');
  assert.equal(escapePostgrestValue('a,(b),c'), 'abc');
});

test('null/undefined input does not throw and produces an empty string', () => {
  assert.equal(escapePostgrestValue(null), '');
  assert.equal(escapePostgrestValue(undefined), '');
});
