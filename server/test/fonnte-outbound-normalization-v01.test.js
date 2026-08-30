'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('sendWA does not corrupt already-fully-qualified international target numbers', async (t) => {
  const fonntePath = path.resolve(__dirname, '../services/fonnte.js');
  const originalFetch = global.fetch;
  const capturedBodies = [];
  global.fetch = async (_url, opts) => {
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ status: true }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  process.env.FONNTE_TOKEN = 'test-token';
  delete require.cache[fonntePath];
  const { sendWA } = require(fonntePath);

  const cases = [
    ['6591234567', '6591234567'],       // Singapore, already has its own country code
    ['14155552671', '14155552671'],     // USA
    ['081234567890', '6281234567890'],  // Indonesian local convenience — preserved
    ['81234567890', '6281234567890'],   // bare Indonesian mobile, no country code — preserved
    ['6281234567890', '6281234567890'], // already 62-prefixed — preserved
  ];

  for (const [input] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass' });
  }

  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});
