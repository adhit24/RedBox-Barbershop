'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const syncRouteMatch = server.match(/app\.post\('\/api\/member\/sync'[\s\S]*?\n  \}\);/);

test('the /api/member/sync route exists and was located for the other assertions', () => {
  assert.ok(syncRouteMatch, 'expected to find the POST /api/member/sync route handler');
});

test('matched payments are collected into an array during the transaction loop', () => {
  const routeBody = syncRouteMatch[0];
  assert.match(routeBody, /const matchedPayments = \[\];/);
  assert.match(routeBody, /matchedPayments\.push\(\{/);
  assert.match(routeBody, /receiptNumber:\s*String\(receiptNumber\)/);
});

test('persistVisitHistory upserts member_visit_history keyed by receipt_number', () => {
  const routeBody = syncRouteMatch[0];
  assert.match(routeBody, /const persistVisitHistory = async \(userKey, payments\) => \{/);
  assert.match(routeBody, /\.from\('member_visit_history'\)\s*\n\s*\.upsert\(visitRows, \{ onConflict: 'receipt_number', ignoreDuplicates: true \}\)/);
});

test('persistVisitHistory dedupes member_point_transactions with one batched query, not one per payment', () => {
  const routeBody = syncRouteMatch[0];
  const fnMatch = routeBody.match(/const persistVisitHistory = async[\s\S]*?\n\s+\};/);
  assert.ok(fnMatch, 'expected to find the persistVisitHistory function body');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /\.select\('notes'\)/);
  assert.match(fnBody, /\.like\('notes', 'moka-visit:%'\)/);
  assert.match(fnBody, /new Set\(/);
  assert.match(fnBody, /notes: `moka-visit:\$\{p\.receiptNumber\}`/);
  // Only one .from('member_point_transactions') call inside persistVisitHistory — the
  // lookup and the insert share the same batched-query discipline, no per-row loop calling Supabase.
  const supabaseCalls = (fnBody.match(/\.from\('member_point_transactions'\)/g) || []).length;
  assert.equal(supabaseCalls, 2, `expected exactly 2 member_point_transactions calls (lookup + insert), found ${supabaseCalls}`);
});

test('the old recordPointLedgerDelta lump-sum ledger writer is gone', () => {
  const routeBody = syncRouteMatch[0];
  assert.doesNotMatch(routeBody, /recordPointLedgerDelta/);
  assert.doesNotMatch(routeBody, /Sinkronisasi poin Moka/);
});

test('both existing/new-profile branches call persistVisitHistory with the resolved userKey', () => {
  const routeBody = syncRouteMatch[0];
  const calls = routeBody.match(/await persistVisitHistory\([^)]+\)/g) || [];
  assert.equal(calls.length, 2, `expected 2 call sites (existing profile + new profile), found ${calls.length}`);
  assert.ok(calls.some(c => c.includes('existing.user_key')), 'expected the existing-profile branch to pass existing.user_key');
  assert.ok(calls.some(c => c.includes('userKey') && !c.includes('existing.user_key')), 'expected the new-profile branch to pass the freshly derived userKey');
});
