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

test('legacy Moka cron URL is routed to an executable Vercel function', () => {
  assert.ok(vercelConfig.functions?.['api/moka/sync.js']);
  assert.ok(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.source === '/api/moka/sync' && rewrite.destination === '/api/moka/sync.js'
  ));
});
