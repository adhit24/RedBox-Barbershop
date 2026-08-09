'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-motion.js reads tiltMaxDeg from the shared token registry', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /theme\.getTierTokens\(tierClass\)/);
  assert.match(js, /tokens\.tiltMaxDeg/);
});

test('tier-motion.js only attaches pointer tracking when tiltMaxDeg > 0', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /tiltMaxDeg\s*[<=]=?\s*0/);
});

test('tier-motion.js removes tracking listeners on pointerleave to reset the card', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /addEventListener\(['"]pointerleave['"]/);
  assert.match(js, /addEventListener\(['"]pointermove['"]/);
});
