'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(workspace, rel));

test('the tier-specific membership card image assets exist', () => {
  assert.ok(exists('Brand_assets/membership_card_silver.png'));
  assert.ok(exists('Brand_assets/membership_card_gold.png'));
  assert.ok(exists('Brand_assets/membership_card_platinum.png'));
  assert.ok(exists('Brand_assets/membership_card.png'), 'the generic/bronze fallback card must still exist');
});

test('member-dashboard.html gives the physical card image an id for JS to target', () => {
  const html = source('member-dashboard.html');
  assert.match(html, /<img[^>]+class="phys-card-img"[^>]+id="physCardImg"/);
});

test('dashboard.js swaps the card image to the member\'s tier at every tier render point', () => {
  const js = source('js/dashboard.js');

  assert.match(js, /function updatePhysCardImage\(tierClass\)/);
  assert.match(js, /silver:\s*'Brand_assets\/membership_card_silver\.png'/);
  assert.match(js, /gold:\s*'Brand_assets\/membership_card_gold\.png'/);
  assert.match(js, /platinum:\s*'Brand_assets\/membership_card_platinum\.png'/);
  // Unconfigured/bronze tiers fall back to the generic card, not a missing asset.
  assert.match(js, /img\.src = TIER_CARD_IMAGES\[tierClass\] \|\| 'Brand_assets\/membership_card\.png'/);

  const callCount = (js.match(/updatePhysCardImage\(/g) || []).length;
  // 1 definition + 3 call sites (initial render, OTP re-sync, Google/email re-sync).
  assert.equal(callCount, 4, `expected updatePhysCardImage to be defined once and called at all 3 tier render points, found ${callCount} occurrences`);
});
