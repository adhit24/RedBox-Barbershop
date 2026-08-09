'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('member-dashboard.html loads tier-theme.js before dashboard.js', () => {
  const html = source('member-dashboard.html');
  assert.ok(html.indexOf('js/tier-theme.js') > -1);
  assert.ok(html.indexOf('js/tier-theme.js') < html.indexOf('js/dashboard.js'));
});

test('dashboard.js no longer hardcodes the old icy-blue platinum color', () => {
  const js = source('js/dashboard.js');
  assert.doesNotMatch(js, /#B9F2FF/);
  assert.doesNotMatch(js, /185,\s*242,\s*255/);
});

test('css/dashboard.css no longer hardcodes the old icy-blue platinum color', () => {
  const css = source('css/dashboard.css');
  assert.doesNotMatch(css, /#B9F2FF/);
  assert.doesNotMatch(css, /185,\s*242,\s*255/);
});

test('dashboard.js applies the tier theme attribute at every tier render point', () => {
  const js = source('js/dashboard.js');
  const matches = js.match(/RedboxTierTheme\.applyTierTheme\(/g) || [];
  assert.ok(matches.length >= 3, `expected at least 3 call sites, found ${matches.length}`);
});
