'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('ambient tier animations are defined and gated by reduced-motion', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /@keyframes tierBreathe/);
  assert.match(css, /@keyframes tierParticleDrift/);
  assert.match(css, /@keyframes tierGradientShift/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('reduced-motion block disables all three tier keyframe animations with proper specificity', () => {
  const css = source('css/tier-tokens.css');
  const reducedBlockMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)}\s*}/);
  assert.ok(reducedBlockMatch, 'expected a reduced-motion block');
  const block = reducedBlockMatch[1];
  assert.match(block, /animation:\s*none/);
  // Verify the block includes specificity-matched selectors for particles to override animated rules
  assert.match(block, /\[data-tier="gold"\]\s*\.tier-particle/, 'reduced-motion must override gold particles with [data-tier="gold"] selector');
  assert.match(block, /\[data-tier="platinum"\]\s*\.tier-particle/, 'reduced-motion must override platinum particles with [data-tier="platinum"] selector');
});

test('only gold and platinum get the particle-drift animation', () => {
  const css = source('css/tier-tokens.css');
  assert.doesNotMatch(css, /\[data-tier="bronze"\][^{]*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="gold"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="platinum"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
});

test('the badge breathing-glow animates a ::before layer, not the badge itself, so the tier label text stays fully opaque', () => {
  // Regression guard: .tier-badge-emblem also contains #tierBadgeText. Animating
  // the badge's own opacity made the tier label permanently semi-transparent and
  // pulsing. The glow must live on a ::before layer instead.
  const css = source('css/tier-tokens.css');
  const badgeRuleMatch = css.match(/\.tier-badge-emblem\s*\{([^}]*)\}/);
  assert.ok(badgeRuleMatch, 'expected a .tier-badge-emblem rule');
  assert.doesNotMatch(badgeRuleMatch[1], /animation:/, '.tier-badge-emblem itself must not animate (would affect its text content)');
  assert.match(css, /\.tier-badge-emblem::before\s*\{[^}]*animation:\s*tierBreathe/);
});
