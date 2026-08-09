'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('member-dashboard.html has tier-up overlay markup and a mute toggle button', () => {
  const html = source('member-dashboard.html');
  assert.match(html, /id="tierUpOverlay"/);
  assert.match(html, /id="tierUpBanner"/);
  assert.match(html, /id="btnViewNewCard"/);
  assert.match(html, /id="chimeMuteToggle"/);
});

test('dashboard.js never autoplays the chime outside a click handler', () => {
  const js = source('js/dashboard.js');
  const playCalls = js.match(/\.play\(\)/g) || [];
  assert.ok(playCalls.length >= 1, 'expected at least one .play() call for the chime');
  // The .play() call must sit inside a click listener callback, not at top level of DOMContentLoaded.
  assert.match(js, /addEventListener\(['"]click['"][\s\S]{0,400}\.play\(\)/);
});

test('dashboard.js guards chime playback against a missing audio file', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /\.play\(\)\.catch/);
});

test('dashboard.js persists the last-seen tier and the mute preference', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /redbox_last_seen_tier/);
  assert.match(js, /RedboxTierTheme\.isChimeMuted/);
  assert.match(js, /RedboxTierTheme\.setChimeMuted/);
});

test('dashboard.js fires confetti with tier-specific colors on reveal', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /window\.confetti\(/);
  assert.match(js, /getTierTokens\([^)]*\)\.confettiColors/);
});

test('dashboard.js does not fire confetti under prefers-reduced-motion', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /if \(window\.confetti && !window\.RedboxTierTheme\.prefersReducedMotion\(\)\)/);
});

test('the chime mute toggle exposes its state to assistive tech', () => {
  const html = source('member-dashboard.html');
  const js = source('js/dashboard.js');
  assert.match(html, /id="chimeMuteToggle"[^>]*aria-pressed="false"/);
  assert.match(js, /muteBtn\.setAttribute\('aria-pressed'/);
  assert.match(js, /muteBtn\.setAttribute\('aria-label'/);
});

test('revealTierUp does not reference an unused emblem variable', () => {
  const js = source('js/dashboard.js');
  assert.doesNotMatch(js, /const emblem = document\.getElementById\('tierUpEmblem'\)/);
});

test('dashboard.js suppresses the tier-up banner across multiple calls within the same page load', () => {
  // Regression test for: maybeShowTierUpBanner can be invoked more than once per page
  // load (an early call with cached/stale localStorage data, then again after the async
  // OTP/Supabase sync resolves the real tier). A guard based only on "is redbox_last_seen_tier
  // currently null" is fooled by the first call writing a value, making the second call look
  // like a genuine tier increase. The fix captures whether a value existed BEFORE this page
  // load's calls began, once, and consults that flag on every call.
  const js = source('js/dashboard.js');

  // hadStoredTierOnLoad must be captured once from localStorage, before any call to
  // maybeShowTierUpBanner can mutate redbox_last_seen_tier. It's a `const` — the value
  // is a page-load-scoped snapshot and must never be reassigned after capture.
  assert.match(js, /const\s+hadStoredTierOnLoad\s*=\s*localStorage\.getItem\(['"]redbox_last_seen_tier['"]\)\s*!==\s*null/);

  const hadStoredIdx = js.indexOf('hadStoredTierOnLoad');
  const fnIdx = js.indexOf('function maybeShowTierUpBanner');
  assert.ok(hadStoredIdx !== -1 && fnIdx !== -1, 'expected both hadStoredTierOnLoad and maybeShowTierUpBanner to exist');
  assert.ok(hadStoredIdx < fnIdx, 'hadStoredTierOnLoad must be captured before maybeShowTierUpBanner is defined');

  // The suppression branch must consult hadStoredTierOnLoad (not just a fresh localStorage
  // read), so a second in-load call can't be mistaken for "first time ever" once the first
  // call already wrote a value.
  assert.match(js, /lastSeen === null \|\| !hadStoredTierOnLoad/);
});
