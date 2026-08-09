'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-tokens.css defines dashboard (data-tier) scope for all four tiers', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /\[data-tier="bronze"\]\s*{[^}]*--tier-primary:\s*#CD7F32/);
  assert.match(css, /\[data-tier="silver"\]\s*{[^}]*--tier-primary:\s*#C0C0C0/);
  assert.match(css, /\[data-tier="gold"\]\s*{[^}]*--tier-primary:\s*#FFD700/);
  assert.match(css, /\[data-tier="platinum"\]\s*{[^}]*--tier-primary:\s*#C4B5FD/);
});

test('tier-tokens.css relocates the membership.html marketing card colors unchanged', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /\.tier-silver \.tier-name\s*{\s*color:\s*#9CA3AF/);
  assert.match(css, /\.tier-gold \.tier-name\s*{\s*color:\s*#FBBF24/);
  assert.match(css, /linear-gradient\(90deg,\s*#C4B5FD,\s*#E2E8F0,\s*#C4B5FD\)/);
});

test('membership.html no longer defines its own TIER COLORS block', () => {
  const html = source('membership.html');
  assert.doesNotMatch(html, /\/\* TIER COLORS \*\//);
});

test('both pages load tier-tokens.css before their own stylesheet', () => {
  const dashboardHtml = source('member-dashboard.html');
  const membershipHtml = source('membership.html');
  assert.ok(dashboardHtml.indexOf('css/tier-tokens.css') > -1);
  assert.ok(dashboardHtml.indexOf('css/tier-tokens.css') < dashboardHtml.indexOf('css/dashboard.css'));
  assert.ok(membershipHtml.indexOf('css/tier-tokens.css') > -1);
  assert.ok(membershipHtml.indexOf('css/tier-tokens.css') < membershipHtml.indexOf('<style>'));
});
