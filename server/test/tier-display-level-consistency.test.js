'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('getDisplayTier always attaches a level, even for a configured (non-computed) tier', () => {
  // Regression test: TIERS.find(...) returns a raw tier object with no
  // `level` property (only getCurrentTier() added one). Every downstream
  // `tier.level - 1` comparison (benefit tracker, rewards grid, curated
  // shop) then evaluated to NaN, rendering every benefit as permanently
  // locked — including the member's own current tier — for any member
  // whose current_tier was explicitly configured (which is now everyone,
  // since tiers only ever come from a paid activation, never from points).
  const js = source('js/dashboard.js');
  const fnMatch = js.match(/function getDisplayTier\(pts\) \{[\s\S]*?\n \}/);
  assert.ok(fnMatch, 'expected to find getDisplayTier');
  const body = fnMatch[0];

  assert.doesNotMatch(body, /return TIERS\.find\(/, 'must not return a raw TIERS.find() result without a level');
  assert.match(body, /TIERS\.findIndex\(t => t\.class === configured\)/);
  assert.match(body, /\{ \.\.\.TIERS\[idx\], level: idx \+ 1 \}/);
});

test('the smart upsell banner has copy for bronze members, not just paid tiers', () => {
  // Regression test: the banner's configs map had no `bronze` entry, so a
  // Bronze member (now everyone who hasn't paid for a tier) saw
  // configs.silver's "Silver Member" copy via the `configs[tier.class] ||
  // configs.silver` fallback.
  const js = source('js/dashboard.js');
  const fnMatch = js.match(/function renderUpsellBanner\(tier\) \{[\s\S]*?const cfg = configs\[tier\.class\][^;]*;/);
  assert.ok(fnMatch, 'expected to find renderUpsellBanner\'s configs setup');
  const body = fnMatch[0];

  assert.match(body, /bronze: \{ title:'Bronze Member/);
  assert.match(body, /const cfg = configs\[tier\.class\] \|\| configs\.bronze;/);
});
