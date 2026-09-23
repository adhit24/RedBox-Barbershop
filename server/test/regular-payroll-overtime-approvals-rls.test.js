'use strict';

/**
 * Round-18 regression suite for Codex Round-17 finding PRRT_kwDOSNmW7c6lCAtZ.
 *
 * employee_overtime_approvals carried a permissive `authenticated` SELECT policy
 * (USING (true)) from 20260919143000_create_overtime_approvals_and_guards.sql, letting any
 * Supabase-authenticated account read every overtime approval row directly through the public API,
 * bypassing the owner/manager and branch authorization in server/routes/regularPayroll.js.
 *
 * Static regression guard (same convention as payroll-lock-migration.test.js and
 * regular-payroll-lock-protocol.test.js): these tests read migration SQL text and backend wiring
 * directly -- there is no live database connection in this suite -- and are the repo-local mirror of
 * the live production verification performed separately against project khcvklzxfohwkyocenaf.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const CREATE_MIGRATION = '20260919143000_create_overtime_approvals_and_guards.sql';
const UNSAFE_POLICY = 'Allow authenticated read on employee_overtime_approvals';
const SERVICE_ROLE_POLICY = 'Allow service_role full access on employee_overtime_approvals';

const listMigrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\r\n/g, '\n');
// Strips `-- ...` SQL comments so prose describing a statement (e.g. explaining a REVOKE in English)
// cannot accidentally match a regex meant to find the actual DDL statement.
const stripComments = (sql) => sql.replace(/--.*$/gm, '');

function findRestrictionMigration() {
  const marker = new RegExp(`DROP POLICY IF EXISTS "${UNSAFE_POLICY}"`);
  const hit = listMigrationFiles().find((f) => marker.test(read(f)));
  return hit;
}

test('a new forward-only migration drops the unsafe authenticated-read policy by exact name', () => {
  const file = findRestrictionMigration();
  assert.ok(file, 'a migration dropping the unsafe policy by name must exist');
  assert.notEqual(file, CREATE_MIGRATION, 'the fix must be a NEW migration, not an edit of the historical one');
  // Forward-only: this migration's filename timestamp must be newer than the one that created the policy.
  const restrictionTimestamp = file.split('_')[0];
  const createTimestamp = CREATE_MIGRATION.split('_')[0];
  assert.ok(restrictionTimestamp > createTimestamp, 'restriction migration must be ordered after the migration that created the unsafe policy');

  const sql = read(file);
  const ddl = stripComments(sql);
  assert.match(ddl, /ALTER TABLE public\.employee_overtime_approvals ENABLE ROW LEVEL SECURITY/i, 'RLS must remain enabled');
  assert.match(ddl, new RegExp(`DROP POLICY IF EXISTS "${UNSAFE_POLICY}" ON public\\.employee_overtime_approvals`), 'must drop the exact unsafe policy');
  // Referencing the service_role policy BY NAME in an explanatory comment is fine (and expected); what
  // must never happen is an actual DROP/ALTER POLICY statement touching it.
  assert.doesNotMatch(
    ddl,
    new RegExp(`(DROP|ALTER) POLICY[^;]*"${SERVICE_ROLE_POLICY}"`, 'i'),
    'must not drop or alter the service_role policy (backend access stays intact)'
  );
});

test('the restriction migration revokes table privileges from PUBLIC, anon, and authenticated (not only the RLS policy)', () => {
  const file = findRestrictionMigration();
  const sql = read(file);

  assert.match(sql, /REVOKE ALL ON TABLE public\.employee_overtime_approvals FROM PUBLIC/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.employee_overtime_approvals FROM anon/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.employee_overtime_approvals FROM authenticated/i);
});

test('the restriction migration explicitly (re)grants service_role the access the backend needs', () => {
  const file = findRestrictionMigration();
  const ddl = stripComments(read(file));

  assert.match(
    ddl,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.employee_overtime_approvals TO service_role/i,
    'service_role must retain explicit SELECT/INSERT/UPDATE/DELETE at the grant level, not only via RLS'
  );
  // Must never (re)grant the roles being restricted, in actual DDL (comments describing the REVOKEs
  // are fine and are stripped above before this check runs).
  assert.doesNotMatch(ddl, /\bGRANT\b[^;]*\bTO\s+(PUBLIC|anon|authenticated)\b/i);
});

test('no migration in the history creates an authenticated policy equivalent to USING (true) on this table after the restriction', () => {
  const restrictionFile = findRestrictionMigration();
  const files = listMigrationFiles();
  const afterRestriction = files.filter((f) => f > restrictionFile);

  const broadAuthenticatedPolicy = /CREATE POLICY[^;]*ON public\.employee_overtime_approvals[^;]*TO authenticated[^;]*USING\s*\(\s*true\s*\)/is;
  for (const f of afterRestriction) {
    assert.doesNotMatch(read(f), broadAuthenticatedPolicy, `${f} must not reintroduce a blanket authenticated policy`);
  }
});

test('the historical migration that first created the unsafe policy was not edited -- the fix is forward-only', () => {
  const sql = read(CREATE_MIGRATION);
  assert.match(
    sql,
    /CREATE POLICY "Allow authenticated read on employee_overtime_approvals"\s*\n\s*ON public\.employee_overtime_approvals\s*\n\s*FOR SELECT\s*\n\s*TO authenticated\s*\n\s*USING \(true\);/,
    'the original (now-superseded) policy definition must remain verbatim in the historical migration -- proof the fix did not rewrite history'
  );
  assert.match(
    sql,
    /CREATE POLICY "Allow service_role full access on employee_overtime_approvals"\s*\n\s*ON public\.employee_overtime_approvals\s*\n\s*FOR ALL\s*\n\s*TO service_role\s*\n\s*USING \(true\)\s*\n\s*WITH CHECK \(true\);/,
    'the service_role policy definition must remain verbatim in the historical migration'
  );
});

test('no employee_overtime_approvals write policy for authenticated exists anywhere in migration history', () => {
  const files = listMigrationFiles();
  const authenticatedWrite = /CREATE POLICY[^;]*ON public\.employee_overtime_approvals[^;]*FOR (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/is;
  for (const f of files) {
    assert.doesNotMatch(read(f), authenticatedWrite, `${f} must not grant authenticated write access to employee_overtime_approvals`);
  }
});

// --- Backend compatibility: confirm the payroll backend never queries this table with anything but the
// service-role Supabase client, so revoking authenticated/anon access cannot break an authorized flow. ---

const SERVER_DIR = path.join(__dirname, '..');
const readServer = (rel) => fs.readFileSync(path.join(SERVER_DIR, rel), 'utf8');

test('the shared backend Supabase client is constructed with SUPABASE_SERVICE_KEY, not an anon/authenticated key', () => {
  const indexSrc = readServer('index.js');
  const clientConstructions = [...indexSrc.matchAll(/createClient\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(clientConstructions.length > 0, 'sanity: server/index.js constructs a Supabase client');
  for (const args of clientConstructions) {
    assert.match(args, /SUPABASE_SERVICE_KEY/, `every backend Supabase client must use the service role key, got: createClient(${args})`);
    assert.doesNotMatch(args, /SUPABASE_ANON_KEY/i, `no backend Supabase client may use the anon key, got: createClient(${args})`);
  }
});

test('createRegularPayrollRoutes takes its supabase client as a parameter and never constructs its own', () => {
  const routesSrc = readServer('routes/regularPayroll.js');
  assert.match(routesSrc, /function createRegularPayrollRoutes\(supabase,/, 'the router must receive the (service-role) client from its caller');
  assert.doesNotMatch(routesSrc, /createClient\(/, 'the overtime/payroll routes must never construct their own Supabase client');
});

test('regularPayrollService overtime helpers never construct their own Supabase client', () => {
  const serviceSrc = readServer('services/regularPayrollService.js');
  assert.doesNotMatch(serviceSrc, /createClient\(/, 'service-layer overtime helpers must only use the supabase client passed in by their caller');
});

// --- Production draft safety net: this PR must never touch business payroll data. ---

test('the restriction migration contains no payroll_runs DML and never calls lock_payroll_run', () => {
  const file = findRestrictionMigration();
  const ddl = stripComments(read(file));
  assert.doesNotMatch(ddl, /\bpayroll_runs\b/i, 'an access-only RLS/grant migration must never touch payroll_runs');
  assert.doesNotMatch(ddl, /lock_payroll_run/i, 'an access-only RLS/grant migration must never call lock_payroll_run');
  assert.doesNotMatch(ddl, /\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.employee_overtime_approvals\b/i, 'must only change access, never approval data');
});
