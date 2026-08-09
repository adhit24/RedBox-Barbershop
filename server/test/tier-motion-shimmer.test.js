'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-motion.js imports motion the same way js/animations.js does', () => {
  const animations = source('js/animations.js');
  const tierMotion = source('js/tier-motion.js');
  const importLine = animations.match(/^import .+ from ["'][^"']+["'];?$/m)[0];
  assert.ok(tierMotion.includes(importLine),
    'tier-motion.js should import from the same motion CDN URL as animations.js');
  assert.match(tierMotion, /from ["']https:\/\/cdn\.jsdelivr\.net\/npm\/motion@11\/\+esm["']/);
});

test('tier-motion.js waits for DOMContentLoaded before touching the DOM', () => {
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /addEventListener\(['"]DOMContentLoaded['"]/);
});

test('tier-motion.js checks prefers-reduced-motion before animating', () => {
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /RedboxTierTheme\.prefersReducedMotion\(\)/);
});

test('both pages load tier-motion.js as a module script after dashboard-specific scripts', () => {
  const dashboardHtml = source('member-dashboard.html');
  const membershipHtml = source('membership.html');
  assert.match(dashboardHtml, /<script[^>]+type="module"[^>]+src="js\/tier-motion\.js/);
  assert.ok(dashboardHtml.indexOf('js/dashboard.js') < dashboardHtml.indexOf('js/tier-motion.js'));
  assert.match(membershipHtml, /<script[^>]+type="module"[^>]+src="js\/tier-motion\.js/);
});

test('the profile tier badge carries the breathing-glow class at every render point', () => {
  const js = source('js/dashboard.js');
  const matches = js.match(/tierBadge\.className\s*=\s*'profile-tier-badge tier-badge-emblem /g) || [];
  assert.ok(matches.length >= 3, `expected the class on all 3 render points, found ${matches.length}`);
});
