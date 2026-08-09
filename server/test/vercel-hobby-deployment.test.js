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

test('catch-all API function is not shadowed by static output or a literal rewrite', () => {
  // Verified live against production: outputDirectory: "." makes Vercel copy
  // api/[...path].js's own source into static output, which then answers
  // requests for it (405 on POST, raw source on GET) before the dynamic
  // function ever runs. It must be absent so Vercel's default zero-config
  // routing detects api/[...path].js as a function reachable at any /api/*
  // path. A rewrite with a literal "/api/[...path].js" destination doesn't
  // resolve against that function's wildcard route either (confirmed live:
  // 404), so it must also stay absent -- filesystem routing handles it.
  assert.equal(vercelConfig.outputDirectory, undefined);
  assert.equal(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.destination === '/api/[...path].js'
  ), false);
});
