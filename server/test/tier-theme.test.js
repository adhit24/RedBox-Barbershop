'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { TIER_ORDER, TOKENS, getTierIndex, getTierTokens, getParticleCount } =
  require('../../js/tier-theme');

test('TIER_ORDER lists all four tiers low to high', () => {
  assert.deepEqual(TIER_ORDER, ['bronze', 'silver', 'gold', 'platinum']);
});

test('every tier has a complete token set', () => {
  for (const tier of TIER_ORDER) {
    const t = TOKENS[tier];
    assert.ok(t, `missing tokens for ${tier}`);
    assert.match(t.primary, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(typeof t.particleDensity, 'number');
    assert.equal(typeof t.tiltMaxDeg, 'number');
    assert.ok(Array.isArray(t.confettiColors) && t.confettiColors.length > 0);
  }
});

test('getTierIndex ranks tiers in ascending order, -1 for unknown', () => {
  assert.equal(getTierIndex('bronze'), 0);
  assert.equal(getTierIndex('silver'), 1);
  assert.equal(getTierIndex('gold'), 2);
  assert.equal(getTierIndex('platinum'), 3);
  assert.equal(getTierIndex('nonsense'), -1);
});

test('getTierTokens falls back to bronze for an unknown tier', () => {
  assert.equal(getTierTokens('nonsense'), TOKENS.bronze);
  assert.equal(getTierTokens('gold'), TOKENS.gold);
});

test('bronze and silver never emit particles; gold and platinum do, and mobile halves the count', () => {
  assert.equal(getParticleCount('bronze', {}), 0);
  assert.equal(getParticleCount('silver', {}), 0);
  const goldDesktop = getParticleCount('gold', { isMobile: false });
  const goldMobile = getParticleCount('gold', { isMobile: true });
  assert.ok(goldDesktop > 0);
  assert.equal(goldMobile, Math.round(goldDesktop / 2));
  const platDesktop = getParticleCount('platinum', { isMobile: false });
  assert.ok(platDesktop > goldDesktop, 'platinum must be denser than gold');
});

test('getParticleCount returns 0 for any tier when reducedMotion is true', () => {
  assert.equal(getParticleCount('platinum', { reducedMotion: true }), 0);
  assert.equal(getParticleCount('gold', { isMobile: true, reducedMotion: true }), 0);
});
