'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('renderBenefitTracker and renderShop accept a tier parameter instead of closing over the stale initial tier', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /function renderBenefitTracker\(tier\)/);
  assert.match(js, /function renderShop\(tier\)/);
});

test('the four tier-dependent panels are re-rendered with the fresh tier at both async re-sync points', () => {
  // Regression test for: a paid member's own tier badge and physical card
  // correctly updated after the OTP/Google-email async re-sync resolved
  // their real tier, but the tier map, benefit tracker, curated shop, and
  // upsell banner were only ever rendered once at initial synchronous load
  // (from whatever tier was cached in localStorage) and never re-rendered —
  // so a Platinum member could see "Bronze — Tier saat ini" with every
  // benefit locked, right next to a correctly-labeled "LEVEL 4 - PLATINUM"
  // badge.
  const js = source('js/dashboard.js');

  const upsellCalls = js.match(/renderUpsellBanner\(t2\)/g) || [];
  const benefitCalls = js.match(/renderBenefitTracker\(t2\)/g) || [];
  const tierMapCalls = js.match(/renderTierMap\(t2\)/g) || [];
  const shopCalls = js.match(/renderShop\(t2\)/g) || [];

  assert.equal(upsellCalls.length, 2, `expected renderUpsellBanner(t2) at both re-sync points, found ${upsellCalls.length}`);
  assert.equal(benefitCalls.length, 2, `expected renderBenefitTracker(t2) at both re-sync points, found ${benefitCalls.length}`);
  assert.equal(tierMapCalls.length, 2, `expected renderTierMap(t2) at both re-sync points, found ${tierMapCalls.length}`);
  assert.equal(shopCalls.length, 2, `expected renderShop(t2) at both re-sync points, found ${shopCalls.length}`);
});

test('the re-render calls sit after applyTierTheme(t2Class) in both re-sync blocks, not before the fresh tier is resolved', () => {
  const js = source('js/dashboard.js');
  const blocks = js.split('window.RedboxTierTheme.applyTierTheme(t2Class);').slice(1);
  assert.equal(blocks.length, 2, 'expected exactly 2 re-sync blocks calling applyTierTheme(t2Class)');
  for (const block of blocks) {
    const nextBlockBoundary = block.indexOf('window.RedboxTierTheme.applyTierTheme(t2Class);');
    const scoped = nextBlockBoundary === -1 ? block : block.slice(0, nextBlockBoundary);
    assert.match(scoped, /renderTierMap\(t2\)/);
    assert.match(scoped, /renderBenefitTracker\(t2\)/);
  }
});
