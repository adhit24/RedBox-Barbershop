'use strict';

/**
 * Static regression guard for public.lock_payroll_run().
 *
 * 20260919143000 once replaced the function with a generic lock that dropped the Barber Payroll
 * safeguards from 20260918_create_payroll_draft_schema.sql. The final function (the LAST migration
 * that defines it) must keep both branches explicit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const DEF = /CREATE OR REPLACE FUNCTION public\.lock_payroll_run\(/i;

const read = (f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\r\n/g, '\n');
const norm = (sql) => sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

function definers() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && DEF.test(read(f))).sort();
}

const AUTHORITATIVE = '20260918_create_payroll_draft_schema.sql';

function functionBody(sql) {
  const start = sql.search(DEF);
  const end = sql.indexOf('$$;', sql.indexOf('AS $$', start));
  return sql.slice(start, end + 3);
}

function elseBranch(body) {
  const i = body.indexOf('ELSE');
  const j = body.indexOf('END IF;\n\n    -- 3. Mark run as LOCKED');
  return body.slice(i, j);
}

test('Final lock_payroll_run definition is the newest forward migration (not the regressed 143000 one)', () => {
  const list = definers();
  assert.ok(list.includes('20260919143000_create_overtime_approvals_and_guards.sql'), 'sanity: regressed migration still defines it');
  const restore = list.find((f) => /restore_barber_lock_and_regular_guards/.test(f));
  assert.ok(restore, 'barber-restoring migration exists');
  const pendingGuard = list.find((f) => /block_pending_overtime_on_payroll_lock/.test(f));
  assert.ok(pendingGuard, 'pending-overtime guard migration exists');
  const last = list[list.length - 1];
  assert.match(last, /reconcile_overtime_before_payroll_lock/);
  assert.ok(
    restore > '20260919143000' && pendingGuard > restore && last > pendingGuard,
    'migrations are ordered 143000 < restore < pending-overtime guard < overtime reconciliation'
  );
});

test('Final lock_payroll_run enforces the full overtime invariants (attendance -> approval -> snapshot)', () => {
  const body = norm(functionBody(read(definers().pop())));
  const regular = body.slice(body.indexOf("IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN"), body.indexOf('ELSE -- Barber'));
  const at = (frag) => { const i = regular.indexOf(frag); assert.ok(i >= 0, 'missing: ' + frag); return i; };

  // 5. attendance overtime without a reviewed (APPROVED/REJECTED) approval
  const unreviewed = at('FROM public.employee_attendance att WHERE att.overtime_minutes > 0');
  assert.match(regular, /NOT EXISTS \( SELECT 1 FROM public\.employee_overtime_approvals a WHERE a\.employee_id = att\.employee_id AND a\.attendance_date = att\.attendance_date AND a\.status IN \('APPROVED', 'REJECTED'\) \)/);
  assert.match(regular, /attendance overtime row\(s\) have no reviewed approval/);
  // 6. pending
  const pending = at("a.status = 'PENDING'");
  // 7. approval raw minutes vs current attendance overtime
  const mismatch = at('a.raw_overtime_minutes <> COALESCE(');
  assert.match(regular, /no longer match attendance overtime/);
  // 8. sum(APPROVED) == item snapshot, without duplicating the payroll formula
  const snapshot = at("i.attendance_summary ->> 'approved_overtime_minutes'");
  assert.match(regular, /SUM\(a\.approved_overtime_minutes\)/);
  assert.match(regular, /a\.status = 'APPROVED'/);
  assert.match(regular, /Payroll overtime snapshot is stale for %\. Recalculate before locking\./);
  // ordering: pending -> unreviewed -> mismatch -> snapshot -> period -> reconciliation -> freeze
  const period = at('attendance_period_complete');
  const recon = at('Reconciliation failed for %');
  const freeze = at("SET status = 'LOCKED'");
  assert.ok(pending < unreviewed && unreviewed < mismatch && mismatch < snapshot && snapshot < period && period < recon && recon < freeze,
    'invariants are evaluated in order before items are frozen');
  // none of the overtime rules leak into the barber branch
  assert.ok(!norm(elseBranch(functionBody(read(definers().pop())))).includes('overtime'));
});

test('Final lock_payroll_run blocks locking while overtime approvals are PENDING (authority: approvals, not item status)', () => {
  const body = norm(functionBody(read(definers().pop())));
  assert.match(body, /FROM public\.employee_overtime_approvals a WHERE a\.status = 'PENDING'/);
  assert.match(body, /a\.attendance_date BETWEEN v_run\.period_start AND v_run\.period_end/);
  assert.match(body, /EXISTS \( SELECT 1 FROM public\.payroll_regular_items i WHERE i\.payroll_run_id = p_run_id AND i\.employee_id = a\.employee_id \)/);
  assert.match(body, /pending overtime approval\(s\) remain/);
  // The guard is inside the REGULAR branch, before anything is frozen
  const regular = body.slice(body.indexOf("IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN"), body.indexOf('ELSE -- Barber'));
  assert.ok(regular.includes('v_pending_overtime'), 'guard lives in the REGULAR branch');
  assert.ok(regular.indexOf('v_pending_overtime') < regular.indexOf("SET status = 'LOCKED'"), 'guard runs before items are frozen');
  // and does not leak into the barber branch
  assert.ok(!norm(elseBranch(functionBody(read(definers().pop())))).includes('employee_overtime_approvals'));
});

test('Already-applied migrations were not edited to add the overtime rules', () => {
  const restore = read(definers().find((f) => /restore_barber_lock_and_regular_guards/.test(f)));
  const pendingGuard = read(definers().find((f) => /block_pending_overtime_on_payroll_lock/.test(f)));
  assert.doesNotMatch(restore, /pending overtime/i);
  assert.doesNotMatch(read('20260919143000_create_overtime_approvals_and_guards.sql'), /pending overtime approval/i);
  assert.match(pendingGuard, /pending overtime approval/i);
  assert.doesNotMatch(pendingGuard, /no reviewed approval|snapshot is stale|no longer match/i);
});

test('Final lock_payroll_run: explicit REGULAR and non-REGULAR branches, DRAFT-only with row lock', () => {
  const body = functionBody(read(definers().pop()));
  assert.match(body, /SECURITY INVOKER/);
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /status <> 'DRAFT'/);
  assert.match(body, /IF v_run\.payroll_type IN \('REGULAR', 'REGULAR_PAYROLL'\) THEN/);
  assert.match(body, /\bELSE\b/, 'non-REGULAR payroll must have its own branch, not fall through to a generic lock');
});

test('Final lock_payroll_run: Barber branch keeps review validation, reconciliation, source claims and duplicate protection', () => {
  const final = functionBody(read(definers().pop()));
  const branch = norm(elseBranch(final));
  assert.match(branch, /FROM public\.payroll_review_items/);
  assert.match(branch, /blocking = true/);
  assert.match(branch, /Reconciliation failed for barber/);
  assert.match(branch, /FROM public\.payroll_barber_commission_items/);
  assert.match(branch, /INSERT INTO public\.payroll_source_claims/);
  assert.match(branch, /GET DIAGNOSTICS v_claim_count = ROW_COUNT/);
  assert.match(final, /'claims_created', v_claim_count/);
});

test('Barber claim/reconciliation statements are verbatim the authoritative 20260918 ones', () => {
  const auth = norm(functionBody(read(AUTHORITATIVE)));
  const fin = norm(elseBranch(functionBody(read(definers().pop()))));
  const claimInsert = /INSERT INTO public\.payroll_source_claims \([^)]*\) SELECT [\s\S]*?FROM public\.payroll_barber_commission_items WHERE payroll_run_id = p_run_id;/;
  assert.equal(fin.match(claimInsert)[0], auth.match(claimInsert)[0]);
  for (const frag of [
    'SELECT COUNT(*) INTO v_blocking_count FROM public.payroll_review_items WHERE payroll_run_id = p_run_id AND blocking = true;',
    "IF v_line_sum.sum_net <> v_barber_rec.net_service_revenue THEN",
    "IF v_line_sum.sum_comm <> v_barber_rec.commission_amount THEN",
  ]) {
    assert.ok(auth.includes(frag), 'authoritative source contains: ' + frag);
    assert.ok(fin.includes(frag), 'final function preserves: ' + frag);
  }
});

test('Final lock_payroll_run keeps the Regular Payroll guards and service_role-only execution', () => {
  const sql = read(definers().pop());
  const body = norm(functionBody(sql));
  assert.match(body, /status IN \('MISSING_ATTENDANCE', 'MISSING_SALARY', 'BLOCKED_ATTENDANCE_SOURCE'\)/);
  assert.match(body, /attendance_period_complete/);
  assert.match(body, /gross_pay - v_reg_item\.total_deduction\) <> v_reg_item\.take_home_pay/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.lock_payroll_run\(UUID, TEXT\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lock_payroll_run\(UUID, TEXT\) TO service_role;/);
});

test('Corrective migration is forward-only: applied migrations were not edited to fake a fix', () => {
  const regressed = read('20260919143000_create_overtime_approvals_and_guards.sql');
  // The regressed migration is left as historically applied (generic lock still present) ...
  assert.match(regressed, /status = 'LOCKED'/);
  // ... and the fix lives in a new file that does not run schema DDL beyond the function.
  const corrective = read(definers().pop());
  assert.doesNotMatch(corrective, /CREATE TABLE|ALTER TABLE|DROP /i);
});

// ---------------------------------------------------------------------------------------------
// Serialization protocol (payroll_runs row = synchronization object)
// ---------------------------------------------------------------------------------------------
function serializeMigration() {
  const f = fs.readdirSync(MIGRATIONS_DIR).find((n) => /serialize_regular_payroll_mutations/.test(n));
  assert.ok(f, 'serialization migration exists');
  return { file: f, sql: read(f) };
}

test('Serialization protocol: helper takes FOR SHARE on covering DRAFT runs in id order, then detects LOCKED coverage', () => {
  const { sql } = serializeMigration();
  const helper = norm(sql.slice(sql.indexOf('FUNCTION public.serialize_regular_payroll_mutation'), sql.indexOf('CREATE OR REPLACE FUNCTION public.trg_overtime_approval_serialize')));
  assert.match(helper, /FROM public\.payroll_runs r WHERE r\.payroll_type IN \('REGULAR', 'REGULAR_PAYROLL'\) AND r\.status = 'DRAFT' AND p_date BETWEEN r\.period_start AND r\.period_end ORDER BY r\.id FOR SHARE;/);
  assert.match(helper, /r\.status = 'LOCKED'/);
  assert.ok(helper.indexOf('FOR SHARE') < helper.indexOf("r.status = 'LOCKED'"), 'lock first, then read the (fresh) LOCKED state');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.serialize_regular_payroll_mutation\(UUID, DATE\) FROM PUBLIC, anon, authenticated;/);
});

test('Serialization protocol: every mutation path that can affect a DRAFT run participates', () => {
  const { sql } = serializeMigration();
  const n = norm(sql);
  // approvals: any write, refused for a LOCKED run
  assert.match(n, /CREATE TRIGGER trg_overtime_approval_serialize BEFORE INSERT OR UPDATE OR DELETE ON public\.employee_overtime_approvals FOR EACH ROW/);
  assert.match(n, /Cannot modify overtime approval: employee % on % belongs to a LOCKED regular payroll run/);
  // attendance overtime: only when the value changes (importer's unchanged zero upserts pay nothing)
  assert.match(n, /BEFORE INSERT ON public\.employee_attendance FOR EACH ROW WHEN \(NEW\.overtime_minutes > 0\)/);
  assert.match(n, /BEFORE UPDATE OF overtime_minutes ON public\.employee_attendance FOR EACH ROW WHEN \(OLD\.overtime_minutes IS DISTINCT FROM NEW\.overtime_minutes\)/);
  assert.match(n, /BEFORE DELETE ON public\.employee_attendance FOR EACH ROW WHEN \(OLD\.overtime_minutes > 0\)/);
  // items + adjustments (existing immutability trigger function) now take the SHARE lock
  assert.match(n, /SELECT status INTO v_status FROM public\.payroll_runs WHERE id = v_run_id FOR SHARE;/);
  assert.match(n, /Cannot modify payroll data: payroll run % is LOCKED/);
});

test('Serialization protocol: lock RPC is the exclusive side (FOR UPDATE on the run before any validation)', () => {
  const body = norm(functionBody(read(definers().pop())));
  const forUpdate = body.indexOf('FOR UPDATE');
  assert.ok(forUpdate > 0);
  for (const frag of ['pending overtime approval(s) remain', 'no reviewed approval', 'no longer match attendance overtime', 'snapshot is stale']) {
    assert.ok(forUpdate < body.indexOf(frag), `FOR UPDATE precedes validation: ${frag}`);
  }
});

test('Serialization migration: non-negative overtime minutes constraints, ordering, and applied migrations untouched', () => {
  const { file, sql } = serializeMigration();
  assert.match(norm(sql), /ADD CONSTRAINT employee_overtime_approved_minutes_nonneg CHECK \(approved_overtime_minutes >= 0\)/);
  assert.match(norm(sql), /ADD CONSTRAINT employee_overtime_raw_minutes_nonneg CHECK \(raw_overtime_minutes >= 0\)/);
  const reconcile = definers().pop();
  assert.ok(file > reconcile, 'ordered after the overtime-reconciliation lock migration');
  for (const f of [reconcile, definers().find((x) => /block_pending_overtime/.test(x)), definers().find((x) => /restore_barber_lock/.test(x))]) {
    assert.doesNotMatch(read(f), /FOR SHARE|serialize_regular_payroll_mutation/, `${f} was not edited`);
  }
  // deterministic ordering is what prevents lock-order cycles
  assert.match(sql, /ORDER BY r\.id\s+FOR SHARE/);
});
