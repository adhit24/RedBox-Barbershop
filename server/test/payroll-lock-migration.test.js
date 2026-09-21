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
  const last = list[list.length - 1];
  assert.match(last, /block_pending_overtime_on_payroll_lock/);
  assert.ok(restore > '20260919143000' && last > restore, 'migrations are ordered 143000 < restore < pending-overtime guard');
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

test('Already-applied migrations were not edited to add the pending-overtime rule', () => {
  const restore = read(definers().find((f) => /restore_barber_lock_and_regular_guards/.test(f)));
  assert.doesNotMatch(restore, /pending overtime/i);
  assert.doesNotMatch(read('20260919143000_create_overtime_approvals_and_guards.sql'), /pending overtime approval/i);
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
