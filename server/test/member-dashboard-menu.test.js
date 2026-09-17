'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'member-dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'dashboard.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');

test('member dashboard hamburger controls the dashSidebar drawer with accessible attributes and event listeners', () => {
  assert.match(html, /<button[^>]+type="button"[^>]+id="hamburger"/);
  assert.match(html, /id="hamburger"[^>]+aria-controls="dashSidebar"/);
  assert.match(html, /id="hamburger"[^>]+aria-expanded="false"/);
  assert.match(html, /<aside class="dash-sidebar"[^>]+id="dashSidebar"/);
  assert.match(html, /<div class="dash-nav-backdrop"[^>]+id="dashNavBackdrop"/);

  // JS event wiring for mobile drawer
  assert.match(js, /const dashSidebar = document\.getElementById\('dashSidebar'\);/);
  assert.match(js, /const dashNavBackdrop = document\.getElementById\('dashNavBackdrop'\);/);
  assert.match(js, /hamburger\.setAttribute\('aria-expanded',\s*'true'\)/);
  assert.match(js, /hamburger\.setAttribute\('aria-expanded',\s*'false'\)/);
  assert.match(js, /dashNavBackdrop(?:\.addEventListener\('click',\s*closeNav|\?\.addEventListener)/);
  assert.match(js, /e\.key === 'Escape'/);
});

test('shared main navigation does not register a second member dashboard toggle handler', () => {
  const hamburgerBlock = mainJs.match(/const hamburger = document\.getElementById\('hamburger'\);[\s\S]*?\/\/ ---- SMOOTH SCROLL ----/);
  assert.ok(hamburgerBlock, 'main navigation hamburger block must remain discoverable');
  assert.match(
    hamburgerBlock[0],
    /typeof window\.toggleMemberNav !== 'function'/,
    'member dashboard must use its single canonical toggle handler'
  );
});
