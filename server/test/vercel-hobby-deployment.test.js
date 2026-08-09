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

test('static assets live under public/ so no outputDirectory override is needed', () => {
  // Tonight's outage traced to outputDirectory: "." -- with the repo root
  // (including the api/ folder's own source) copied into static output,
  // a Vercel Function reached only via a rewrite (any rewrite, wildcard or
  // exact-match, to any filename, dynamic-route-named or plain) got
  // shadowed by its own static copy: GET returned raw source, POST 405'd
  // (all confirmed live, repeatedly, across five different rewrite/naming
  // combinations). Moving the static site into public/ removes api/ from
  // the static output entirely, so there's nothing left to collide with --
  // and it's what Vercel's zero-config "Other" framework expects by
  // default (the earlier failed attempt to just delete outputDirectory
  // without a public/ folder broke the whole deploy: "No Output Directory
  // named 'public' found").
  assert.equal(vercelConfig.outputDirectory, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'index.html')), false);
});

test('the express catch-all stays a genuine Vercel dynamic route file', () => {
  // With api/ no longer inside the static output tree, api/[...path].js's
  // [...bracket] dynamic-route syntax is what makes it reachable at any
  // /api/* path via Vercel's own zero-config routing -- no rewrite needed
  // or wanted for it.
  const functionFiles = Object.keys(vercelConfig.functions ?? {});
  assert.equal(functionFiles.includes('api/[...path].js'), true);
  assert.equal(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.source === '/api/(.*)'
  ), false);
});
