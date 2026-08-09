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

test('every page that loads tier-motion.js also loads its js/tier-theme.js dependency', () => {
  // Regression guard: tier-motion.js opens with `const theme = window.RedboxTierTheme;`
  // and bails out entirely if that global is undefined. membership.html once
  // loaded the module without ever loading tier-theme.js, so the shimmer
  // feature silently no-op'd on that page in production.
  const dashboardHtml = source('member-dashboard.html');
  const membershipHtml = source('membership.html');
  for (const html of [dashboardHtml, membershipHtml]) {
    assert.ok(html.indexOf('js/tier-theme.js') > -1, 'page must load js/tier-theme.js');
    assert.ok(
      html.indexOf('js/tier-theme.js') < html.indexOf('js/tier-motion.js'),
      'js/tier-theme.js must load before js/tier-motion.js'
    );
  }
});

test('the profile tier badge carries the breathing-glow class at every render point', () => {
  const js = source('js/dashboard.js');
  const matches = js.match(/tierBadge\.className\s*=\s*'profile-tier-badge tier-badge-emblem /g) || [];
  assert.ok(matches.length >= 3, `expected the class on all 3 render points, found ${matches.length}`);
});

test('the shimmer sweep travels the full width of the card', () => {
  // Regression guard: x percentages in a motion animate() are relative to the
  // element's own width. The layer is 40% wide, so a sweep needs to start
  // fully off-screen-left (left:-40%) and travel past off-screen-right
  // (350% of its own width = 140% of the card) to actually cross the card,
  // not stop just past its center.
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /left:\s*'-40%'/);
  assert.match(tierMotion, /x:\s*\['0%',\s*'350%'\]/);
});

test('tier-motion.js exposes a re-initializable refresh so a mid-session tier change is not stuck with stale motion', () => {
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /function initTierMotion\(tierClass\)/);
  assert.match(tierMotion, /window\.RedboxTierMotion\s*=\s*\{\s*refresh:\s*initTierMotion\s*\}/);
  // Must detach previously-attached pointer listeners before re-evaluating
  // tiltMaxDeg for the new tier, and clear previously-injected particles.
  assert.match(tierMotion, /tiltController\.abort\(\)/);
  assert.match(tierMotion, /physCard\.querySelectorAll\('\.tier-particle'\)\.forEach\(\(p\) => p\.remove\(\)\)/);
});

test('dashboard.js re-runs tier-motion after each async tier re-sync', () => {
  const js = source('js/dashboard.js');
  const refreshCalls = js.match(/window\.RedboxTierMotion\?\.refresh\(/g) || [];
  assert.ok(refreshCalls.length >= 2, `expected at least 2 refresh calls (OTP + Google/email re-sync), found ${refreshCalls.length}`);
});

test('the tier-up banner and chime mute toggle render below the mobile nav drawer', () => {
  const css = source('css/dashboard.css');
  const bannerMatch = css.match(/\.tier-up-banner\{[^}]*z-index:(\d+)/);
  const muteMatch = css.match(/\.chime-mute-toggle\{[^}]*z-index:(\d+)/);
  assert.ok(bannerMatch, 'expected .tier-up-banner z-index');
  assert.ok(muteMatch, 'expected .chime-mute-toggle z-index');
  // .dash-sidebar (mobile drawer) is z-index:200, .dash-nav-backdrop is 199 (css/dashboard.css).
  assert.ok(Number(bannerMatch[1]) < 199, `tier-up-banner z-index ${bannerMatch[1]} must be below the mobile drawer`);
  assert.ok(Number(muteMatch[1]) < 199, `chime-mute-toggle z-index ${muteMatch[1]} must be below the mobile drawer`);
});
