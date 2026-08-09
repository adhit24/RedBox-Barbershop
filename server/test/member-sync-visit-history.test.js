'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const syncRouteMatch = server.match(/app\.post\('\/api\/member\/sync'[\s\S]*?\n  \}\);/);

const deleteGrantMigrationPath = path.join(__dirname, '..', 'migrations', '2026-08-10-member-point-transactions-delete-grant.sql');

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
  // Exactly three .from('member_point_transactions') calls inside persistVisitHistory —
  // the legacy moka-sync delete, the moka-visit lookup, and the moka-visit insert — no
  // per-row loop calling Supabase.
  const supabaseCalls = (fnBody.match(/\.from\('member_point_transactions'\)/g) || []).length;
  assert.equal(supabaseCalls, 3, `expected exactly 3 member_point_transactions calls (legacy delete + lookup + insert), found ${supabaseCalls}`);
});

test('persistVisitHistory purges legacy moka-sync lump-sum rows unconditionally, before writing per-visit rows', () => {
  const routeBody = syncRouteMatch[0];
  const fnMatch = routeBody.match(/const persistVisitHistory = async[\s\S]*?\n\s+\};/);
  assert.ok(fnMatch, 'expected to find the persistVisitHistory function body');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /if \(!userKey\) return;/);
  assert.match(fnBody, /\.from\('member_point_transactions'\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\('user_key', userKey\)\s*\n\s*\.like\('notes', 'moka-sync:%'\)/);
  // The legacy delete must run before the `if (!payments.length) return;` guard so a
  // member with zero new visits this sync still gets their old lump-sum row cleaned up.
  const deleteIndex = fnBody.indexOf(".like('notes', 'moka-sync:%')");
  const paymentsGuardIndex = fnBody.indexOf('if (!payments.length) return;');
  assert.ok(deleteIndex !== -1 && paymentsGuardIndex !== -1 && deleteIndex < paymentsGuardIndex,
    'expected the legacy moka-sync delete to run before the payments.length guard');
});

test('persistVisitHistory maps every member_visit_history column defined by the Task 1 migration', () => {
  const routeBody = syncRouteMatch[0];
  const fnMatch = routeBody.match(/const persistVisitHistory = async[\s\S]*?\n\s+\};/);
  assert.ok(fnMatch, 'expected to find the persistVisitHistory function body');
  const fnBody = fnMatch[0];
  const rowsMatch = fnBody.match(/const visitRows = dedupedPayments\.map\(p => \(\{[\s\S]*?\}\)\);/);
  assert.ok(rowsMatch, 'expected to find the visitRows mapping');
  const rowsBody = rowsMatch[0];
  assert.match(rowsBody, /user_key: userKey,/);
  assert.match(rowsBody, /receipt_number: p\.receiptNumber,/);
  assert.match(rowsBody, /outlet_slug: p\.outletSlug,/);
  assert.match(rowsBody, /visit_date: p\.visitDate,/);
  assert.match(rowsBody, /visit_time: p\.visitTime,/);
  assert.match(rowsBody, /service_summary: p\.serviceSummary,/);
  assert.match(rowsBody, /amount: p\.amount,/);
  assert.match(rowsBody, /points_earned: POINTS_PER_VISIT,/);
});

test('persistVisitHistory dedupes matchedPayments by receiptNumber before building visitRows or newLedgerRows', () => {
  const routeBody = syncRouteMatch[0];
  const fnMatch = routeBody.match(/const persistVisitHistory = async[\s\S]*?\n\s+\};/);
  assert.ok(fnMatch, 'expected to find the persistVisitHistory function body');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /const dedupedPayments = \[\.\.\.new Map\(payments\.map\(p => \[p\.receiptNumber, p\]\)\)\.values\(\)\];/);
  const dedupIndex = fnBody.indexOf('const dedupedPayments =');
  const visitRowsIndex = fnBody.indexOf('const visitRows =');
  const newLedgerRowsIndex = fnBody.indexOf('const newLedgerRows =');
  assert.ok(dedupIndex !== -1 && visitRowsIndex !== -1 && newLedgerRowsIndex !== -1,
    'expected dedupedPayments, visitRows, and newLedgerRows to all be present');
  assert.ok(dedupIndex < visitRowsIndex, 'expected the dedup step to run before visitRows is built');
  assert.ok(dedupIndex < newLedgerRowsIndex, 'expected the dedup step to run before newLedgerRows is built');
  // Both downstream writes must consume the deduped array, not the raw payments param.
  assert.match(fnBody, /const newLedgerRows = dedupedPayments/);
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

test('a migration grants service_role DELETE on member_point_transactions, so the legacy-purge call in persistVisitHistory can actually run', () => {
  assert.ok(fs.existsSync(deleteGrantMigrationPath), `expected migration file to exist at ${deleteGrantMigrationPath}`);
  const sql = fs.readFileSync(deleteGrantMigrationPath, 'utf8');
  assert.match(sql, /GRANT DELETE ON TABLE (?:public\.)?member_point_transactions TO service_role/i);
  // Additive only — must not touch RLS or other grants on this table.
  assert.doesNotMatch(sql, /REVOKE/i);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY/i);
});
