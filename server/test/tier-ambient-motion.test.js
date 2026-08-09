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

test('reduced-motion block disables all three tier keyframe animations', () => {
  const css = source('css/tier-tokens.css');
  const reducedBlockMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)}\s*}/);
  assert.ok(reducedBlockMatch, 'expected a reduced-motion block');
  const block = reducedBlockMatch[1];
  assert.match(block, /animation:\s*none/);
});

test('only gold and platinum get the particle-drift animation', () => {
  const css = source('css/tier-tokens.css');
  assert.doesNotMatch(css, /\[data-tier="bronze"\][^{]*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="gold"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="platinum"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
});
