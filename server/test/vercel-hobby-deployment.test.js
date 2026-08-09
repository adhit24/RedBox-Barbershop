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

test('the express catch-all is reached via a proper :path* rewrite, not a bracket destination', () => {
  // Per Vercel's own rewrites docs, a wildcard destination must use the
  // :path*/$1 capture syntax (e.g. "destination": "/api/sharp" for
  // "source": "/resize/:width/:height") -- a literal bracketed path like
  // "/api/[...path].js" as a destination does not resolve to the dynamic
  // function's route table entry. That mismatch (confirmed live across
  // multiple attempts tonight: 405 served-as-static, then 404 with no
  // Express headers even for multi-segment paths) is why api/[...path].js
  // never worked as a rewrite target. Fix: keep the catch-all as a plain
  // (non-bracket) function file and rewrite the documented way.
  const functionFiles = Object.keys(vercelConfig.functions ?? {});
  assert.equal(functionFiles.some((file) => file.includes('[')), false);
  assert.equal(vercelConfig.rewrites?.some((rewrite) =>
    rewrite.source === '/api/:path*' && !rewrite.destination.includes('[') && !rewrite.destination.endsWith('.js')
  ), true);
});
