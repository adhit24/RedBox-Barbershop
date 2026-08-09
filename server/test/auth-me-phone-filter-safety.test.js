'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('/api/auth/me guards the customers.update(...).or(phoneFilter) calls against an empty phone filter', () => {
  // Regression test for a production incident: getMemberPhoneVariants(wa)
  // returns [] for an empty/malformed customer_wa, which used to produce
  // .or('') — an empty filter string that broke the Postgrest query
  // builder chain ("TypeError: ...or(...).catch is not a function", an
  // unhandled rejection observed inside /api/auth/me in Vercel runtime
  // logs on 2026-08-09, contributing to the endpoint occasionally hitting
  // Vercel's 60s function timeout).
  const server = source('server/index.js');

  const meRouteMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);
  assert.ok(meRouteMatch, 'expected to find the /api/auth/me route handler');
  const routeBody = meRouteMatch[0];

  // phoneFilter must be computed once and both update() calls must be
  // gated behind `if (phoneFilter)` rather than calling .or() unconditionally.
  assert.match(routeBody, /const phoneFilter = getMemberPhoneVariants\(session\.customer_wa\)/);
  const guardCount = (routeBody.match(/if \(phoneFilter\) \{/g) || []).length;
  assert.equal(guardCount, 2, `expected both update-and-or calls to be guarded by "if (phoneFilter)", found ${guardCount}`);

  // Neither branch should call .or(...) unconditionally with a freshly
  // computed (possibly empty) filter string.
  assert.doesNotMatch(
    routeBody,
    /\.or\(getMemberPhoneVariants\(session\.customer_wa\)\.map/,
    'the .or(...) filter must not be built inline and called unconditionally'
  );
});

test('/api/auth/me uses .then(ok, err) instead of .catch() on the fire-and-forget customers.update(...).or(...) calls', () => {
  // A Postgrest query builder is thenable (has .then) but is not
  // guaranteed to be a full Promise with .catch()/.finally() — chaining
  // .catch() directly can itself throw "TypeError: ...catch is not a
  // function". .then(onFulfilled, onRejected) only relies on .then, which
  // every thenable must implement.
  const server = source('server/index.js');
  const meRouteMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);
  assert.ok(meRouteMatch, 'expected to find the /api/auth/me route handler');
  const routeBody = meRouteMatch[0];

  assert.doesNotMatch(routeBody, /\}\)\.or\(phoneFilter\)\.catch\(/, 'must not chain .catch() directly on the query builder');
  const thenGuardCount = (routeBody.match(/\}\)\.or\(phoneFilter\)\.then\(\(\) => \{\}, \(\) => \{\}\);/g) || []).length;
  assert.equal(thenGuardCount, 2, `expected both fire-and-forget updates to use .then(() => {}, () => {}), found ${thenGuardCount}`);
});
