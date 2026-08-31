'use strict';

/**
 * P0 hotfix regression guard (hotfix/backend-bootstrap-sync-syntax).
 *
 * Incident: a stray orphaned closing brace left over from a refactor of
 * _resolveCustomer() made server/moka/sync.js fail to parse. server/index.js
 * requires('./moka/sync') at module scope, so the parse failure crashed the
 * entire backend bootstrap — every route (health, barbers, admin CRM,
 * cron endpoints) returned 500, not just Moka-specific ones.
 *
 * `node --test` only proves a file parses if some test happens to require it.
 * This guard makes that check explicit and unconditional so malformed JS in
 * a backend entry module can't silently pass release verification again.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Backend modules required at module scope by server/index.js, i.e. a syntax
// error in any of these takes down the whole process at boot, not just the
// feature that owns the file.
const BOOTSTRAP_CRITICAL_MODULES = [
  '../moka/sync.js',
  '../moka/routes.js',
  '../moka/client.js',
  '../moka/oauth.js',
  '../routes/barber.js',
  '../routes/barberCron.js',
  '../routes/adminCrm.js',
];

for (const relPath of BOOTSTRAP_CRITICAL_MODULES) {
  test(`${relPath} parses cleanly (node --check)`, () => {
    const absPath = path.join(__dirname, relPath);
    const result = spawnSync(process.execPath, ['--check', absPath], { encoding: 'utf8' });
    assert.equal(
      result.status,
      0,
      `node --check failed for ${relPath}:\n${result.stderr}`
    );
  });
}

test('server/moka/sync.js loads and exposes its public integration surface', () => {
  const sync = require('../moka/sync');
  for (const exportName of [
    'pushScheduleToMoka', 'pushCheckoutToMoka', 'pullMokaToWeb',
    'handleWebhookEvent', 'startCronJobs', 'bridgeBookingToMoka',
    'maybeRefreshOutletData', 'getLastSyncAt', 'setLastSyncAt',
  ]) {
    assert.equal(typeof sync[exportName], 'function', `expected sync.${exportName} to be a function`);
  }
});
