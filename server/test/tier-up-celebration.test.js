'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
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
