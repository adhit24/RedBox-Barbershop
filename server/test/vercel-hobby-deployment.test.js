'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const vercelConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8')
);

test('Vercel Hobby deployment does not declare unsupported frequent cron jobs', () => {
  assert.deepEqual(vercelConfig.crons ?? [], [], 'frequent Vercel cron jobs fail on Hobby');
});

test('catch-all API function is not routed through a static rewrite', () => {
  assert.equal(vercelConfig.outputDirectory, '.');
  assert.equal(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.destination === '/api/[...path].js'
  ), false);
});
