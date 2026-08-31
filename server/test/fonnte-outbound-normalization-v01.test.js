'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadSendWA() {
  const fonntePath = path.resolve(__dirname, '../services/fonnte.js');
  delete require.cache[fonntePath];
  process.env.FONNTE_TOKEN = 'test-token';
  return require(fonntePath).sendWA;
}

function captureTargets() {
  const originalFetch = global.fetch;
  const capturedBodies = [];
  global.fetch = async (_url, opts) => {
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ status: true }) };
  };
  return {
    capturedBodies,
    restore: () => { global.fetch = originalFetch; },
  };
}

test('sendWA does not corrupt already-fully-qualified international target numbers', async (t) => {
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  const cases = [
    ['6591234567', '6591234567'],       // Singapore, already has its own country code
    ['14155552671', '14155552671'],     // USA
    ['081234567890', '6281234567890'],  // Indonesian local convenience — preserved
    ['6281234567890', '6281234567890'], // already 62-prefixed — preserved
  ];

  for (const [input] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass' });
  }

  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});

// International WhatsApp multilingual contract, correction round 1: a bare
// number beginning with "8" is ambiguous once punctuation is stripped — it
// could be Indonesian mobile shorthand (081234567890 minus its leading 0)
// OR a legitimate foreign country code that happens to start with 8 (Japan
// 81, Korea 82, Vietnam 84, China 86, Cambodia 855, Bangladesh 880, Taiwan
// 886, ...). The default MUST NOT guess Indonesia from the bare digit alone.
test('sendWA never corrupts a country code that starts with 8, by default', async (t) => {
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  const cases = [
    ['+819012345678', '819012345678'],   // Japan, with plus
    ['819012345678', '819012345678'],    // Japan, digits-only trusted form
    ['+821012345678', '821012345678'],   // Korea, with plus
    ['821012345678', '821012345678'],    // Korea, digits-only trusted form
    ['8613812345678', '8613812345678'],  // China — unchanged
    ['84912345678', '84912345678'],      // Vietnam — unchanged
    ['886912345678', '886912345678'],    // Taiwan — unchanged
  ];

  for (const [input] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass' });
  }

  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});

test('sendWA: the ambiguous bare-8 case is left untouched without the explicit opt-in', async (t) => {
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  await sendWA('81234567890', 'test message', { branch: 'bypass' });

  assert.deepEqual(capturedBodies.map((b) => b.target), ['81234567890']);
});

test('sendWA: assumeIndonesianLocalShorthand opts a bare-8 target into the 62-prefixed form', async (t) => {
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  await sendWA('81234567890', 'test message', { branch: 'bypass', assumeIndonesianLocalShorthand: true });

  assert.deepEqual(capturedBodies.map((b) => b.target), ['6281234567890']);
});

test('sendWA: assumeIndonesianLocalShorthand does not change already-unambiguous numbers', async (t) => {
  // The flag only reaches the bare-8 branch (no leading 0, no 62 prefix) —
  // a number that already carries its own unambiguous marker (leading 0, or
  // an existing 62 prefix) is handled before that branch and is identical
  // with or without the flag.
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  const cases = [
    ['081234567890', '6281234567890'],  // Indonesian local convenience, unaffected by the flag
    ['6281234567890', '6281234567890'], // already 62-prefixed, unaffected by the flag
  ];

  for (const [input] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass', assumeIndonesianLocalShorthand: true });
  }

  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});

test('sendWA: assumeIndonesianLocalShorthand is a per-call caller assertion, not a country detector', async (t) => {
  // Setting the flag tells sendWA "the target I'm passing THIS call is bare
  // Indonesian shorthand" — it is not a way to safely mix a bare-8 Indonesian
  // number with a bare-8 foreign number across calls. A caller must only set
  // it when it actually knows the specific target is Indonesian (see the
  // caller audit in the round-1 correction commit message: no current caller
  // does this).
  const { capturedBodies, restore } = captureTargets();
  t.after(restore);
  const sendWA = loadSendWA();

  await sendWA('819012345678', 'test message', { branch: 'bypass', assumeIndonesianLocalShorthand: true });

  assert.deepEqual(capturedBodies.map((b) => b.target), ['62819012345678']);
});
