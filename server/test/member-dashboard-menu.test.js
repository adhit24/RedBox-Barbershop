'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'member-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dashboard.js'), 'utf8');

test('member dashboard hamburger is an accessible button wired before dashboard data loading', () => {
  assert.match(html, /<button[^>]+type="button"[^>]+id="hamburger"/);
  assert.match(html, /id="hamburger"[^>]+aria-controls="navLinks"/);
  assert.match(html, /id="hamburger"[^>]+aria-expanded="false"/);
  assert.match(html, /id="hamburger"[^>]+onclick="window\.toggleMemberNav\(this\)"/);
  assert.match(js, /const hamburger = document\.getElementById\('hamburger'\);/);
  assert.match(js, /window\.toggleMemberNav = function/);
  assert.ok(
    js.indexOf("const hamburger = document.getElementById('hamburger');") <
      js.indexOf('// ---- Check login state ----'),
    'hamburger setup must run before dashboard initialization'
  );
});
