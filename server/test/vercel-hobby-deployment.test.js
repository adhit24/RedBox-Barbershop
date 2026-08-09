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

test('outputDirectory stays "." so the static root deploys without a public/ folder', () => {
  // Removing this outright breaks every deploy, not just the API catch-all:
  // this repo serves static HTML from the repo root, and without this
  // override Vercel's project settings look for a public/ folder that
  // doesn't exist here ("No Output Directory named 'public' found" --
  // confirmed live in a failed deployment).
  assert.equal(vercelConfig.outputDirectory, '.');
});

test('the express catch-all function is not a Vercel dynamic route file', () => {
  // outputDirectory: "." copies every source file (including the api
  // catch-all's own) into static output. For a plain-named function file,
  // Vercel's Function routing still wins over that static copy. But for a
  // file using Vercel's [...bracket] dynamic-route syntax, a rewrite whose
  // destination is that literal bracketed path does not resolve against
  // the function's wildcard route -- it falls through to the static copy
  // instead, so the catch-all gets served as raw source (405 on POST,
  // confirmed live) rather than executed. Keep the catch-all as a
  // plain-named file (api/index.js) forwarding req/res to Express, which
  // does its own internal routing and never needed the dynamic segment.
  const functionFiles = Object.keys(vercelConfig.functions ?? {});
  assert.equal(functionFiles.some((file) => file.includes('[')), false);
  assert.equal(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.source === '/api/(.*)' && !rewrite.destination.includes('[')
  ), true);
});
