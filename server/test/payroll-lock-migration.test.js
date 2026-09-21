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
  // the ELSE that opens the barber branch (the function also contains CASE ... ELSE expressions)
  const marker = body.indexOf('-- Barber payroll');
  const i = marker >= 0 ? body.lastIndexOf('ELSE', marker) : body.indexOf('ELSE');
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
  const reconcile = list.find((f) => /reconcile_overtime_before_payroll_lock/.test(f));
  assert.ok(reconcile, 'overtime reconciliation migration exists');
  const last = list[list.length - 1];
  const lifecycle = list.find((f) => /atomic_regular_payroll_lifecycle/.test(f));
  assert.ok(lifecycle, 'atomic lifecycle migration exists');
  assert.match(last, /attendance_payroll_sync_dirty_marker/);
  assert.ok(
    restore > '20260919143000' && pendingGuard > restore && reconcile > pendingGuard && lifecycle > reconcile && last > lifecycle,
    'migrations are ordered 143000 < restore < pending-overtime guard < overtime reconciliation < atomic lifecycle < attendance sync'
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
  const corrective = read(definers().find((f) => /reconcile_overtime_before_payroll_lock/.test(f)));
  assert.doesNotMatch(corrective, /CREATE TABLE|ALTER TABLE|DROP (TABLE|COLUMN|SCHEMA|FUNCTION)/i);
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
  const reconcile = definers().find((x) => /reconcile_overtime_before_payroll_lock/.test(x));
  assert.ok(file > reconcile, 'ordered after the overtime-reconciliation lock migration');
  for (const f of [reconcile, definers().find((x) => /block_pending_overtime/.test(x)), definers().find((x) => /restore_barber_lock/.test(x))]) {
    assert.doesNotMatch(read(f), /FOR SHARE|serialize_regular_payroll_mutation/, `${f} was not edited`);
  }
  // deterministic ordering is what prevents lock-order cycles
  assert.match(sql, /ORDER BY r\.id\s+FOR SHARE/);
});

// ---------------------------------------------------------------------------------------------
// Atomic Regular Payroll lifecycle (uniqueness, atomic creation, adjustments, empty-run guard)
// ---------------------------------------------------------------------------------------------
function lifecycleMigration() {
  const f = fs.readdirSync(MIGRATIONS_DIR).find((n) => /atomic_regular_payroll_lifecycle/.test(n));
  assert.ok(f, 'atomic lifecycle migration exists');
  return { file: f, sql: read(f) };
}

test('Lifecycle: overlap trigger serializes generation with an advisory lock and rejects DRAFT/LOCKED overlaps', () => {
  const { sql } = lifecycleMigration();
  const n = norm(sql);
  const fn = n.slice(n.indexOf('FUNCTION public.find_overlapping_regular_run'), n.indexOf('CREATE TRIGGER trg_payroll_runs_no_overlap'));
  assert.match(fn, /r\.status IN \('DRAFT', 'LOCKED'\)/);
  assert.match(fn, /r\.period_start <= p_end AND r\.period_end >= p_start/);
  assert.match(fn, /\(r\.business_unit = p_business_unit OR r\.business_unit = 'ALL' OR p_business_unit = 'ALL'\)/);
  assert.match(fn, /PERFORM pg_advisory_xact_lock\(hashtext\('redbox\.regular_payroll_run_overlap'\)\);/);
  assert.ok(fn.indexOf('pg_advisory_xact_lock') < fn.lastIndexOf('find_overlapping_regular_run(NEW.id'), 'lock before the check');
  assert.match(n, /CREATE TRIGGER trg_payroll_runs_no_overlap BEFORE INSERT OR UPDATE OF period_start, period_end, business_unit, payroll_type ON public\.payroll_runs FOR EACH ROW/);
  assert.match(n, /Overlapping regular payroll run exists/);
});

test('Lifecycle: header and items are created by ONE function (one transaction), never by separate requests', () => {
  const { sql } = lifecycleMigration();
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_regular_payroll_run');
  const end = sql.indexOf('-- 3. Adjustments');
  const fn = norm(sql.slice(start, end));
  assert.match(fn, /RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER/);
  assert.match(fn, /jsonb_array_length\(p_items\) = 0 THEN RAISE EXCEPTION 'Cannot create a regular payroll run without payroll items'/);
  const iRun = fn.indexOf('INSERT INTO public.payroll_runs');
  const iItems = fn.indexOf('INSERT INTO public.payroll_regular_items');
  assert.ok(iRun > 0 && iItems > iRun, 'header then items inside the same function body');
  assert.match(fn, /jsonb_populate_recordset\(NULL::public\.payroll_regular_items, p_items\)/);
  assert.match(fn, /IF v_inserted <> v_expected THEN RAISE EXCEPTION/);
  assert.doesNotMatch(fn, /\bCOMMIT\b/, 'no transaction control inside the function');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_regular_payroll_run\(JSONB, JSONB\) TO service_role;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_regular_payroll_run\(JSONB, JSONB\) FROM PUBLIC, anon, authenticated;/);
});

test('Lifecycle: adjustments get database-enforced ownership and an atomic snapshot-dirty marker', () => {
  const n = norm(lifecycleMigration().sql);
  assert.match(n, /CREATE TRIGGER trg_payroll_adjustment_ownership BEFORE INSERT OR UPDATE OF payroll_run_id, payroll_regular_item_id, employee_id ON public\.payroll_adjustments/);
  assert.match(n, /Payroll adjustment item % does not belong to payroll run %/);
  assert.match(n, /Payroll adjustment employee does not match the payroll item/);
  assert.match(n, /CREATE TRIGGER trg_payroll_adjustment_mark_dirty AFTER INSERT OR UPDATE OR DELETE ON public\.payroll_adjustments FOR EACH ROW/);
  assert.match(n, /jsonb_set\(COALESCE\(attendance_summary, '\{\}'::JSONB\), '\{adjustments_dirty\}', 'true'::JSONB, TRUE\)/);
});

test('Lifecycle: lock RPC refuses empty runs, overlaps and stale adjustment snapshots (engine semantics, no salary formula)', () => {
  const sql = read(definers().pop());
  const body = norm(functionBody(sql));
  const regular = body.slice(body.indexOf("IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN"), body.indexOf('ELSE -- Barber'));
  assert.match(regular, /IF v_item_count = 0 THEN RAISE EXCEPTION 'Cannot lock regular payroll run %: it has no payroll items'/);
  assert.match(regular, /v_overlap := public\.find_overlapping_regular_run\(p_run_id, v_run\.business_unit, v_run\.period_start, v_run\.period_end\);/);
  assert.match(regular, /it overlaps regular payroll run/);
  // aggregate semantics: BONUS, DEBT, DEDUCTION, others by sign - identical to aggregateAdjustments in the engine
  assert.match(regular, /WHEN x\.t = 'BONUS' THEN ABS\(x\.amount\) WHEN x\.t IN \('DEBT', 'DEDUCTION'\) THEN 0 ELSE GREATEST\(x\.amount, 0\) END/);
  assert.match(regular, /CASE WHEN x\.t = 'DEBT' THEN ABS\(x\.amount\) ELSE 0 END/);
  assert.match(regular, /WHEN x\.t = 'DEDUCTION' THEN ABS\(x\.amount\) WHEN x\.t IN \('BONUS', 'DEBT'\) THEN 0 ELSE GREATEST\(-x\.amount, 0\) END/);
  assert.match(regular, /FROM public\.payroll_adjustments a WHERE a\.payroll_regular_item_id = v_snap_item\.id/);
  assert.match(regular, /v_snap_item\.adjustments_dirty OR v_adj_bonus <> v_snap_item\.manual_bonus OR v_adj_debt <> v_snap_item\.debt_deduction OR v_adj_deduction <> v_snap_item\.manual_deduction OR \(v_adj_bonus - v_adj_debt - v_adj_deduction\) <> v_snap_item\.adjustments_total/);
  assert.match(regular, /Payroll adjustment snapshot is stale for %\. Recalculate before locking\./);
  // ordering: guards first, adjustments inside the snapshot loop before period / reconciliation / freeze
  const at = (frag) => { const i = regular.indexOf(frag); assert.ok(i >= 0, 'missing ' + frag); return i; };
  assert.ok(at('v_item_count = 0') < at("status IN ('MISSING_ATTENDANCE'"));
  assert.ok(at('Payroll overtime snapshot is stale') < at('Payroll adjustment snapshot is stale'));
  assert.ok(at('Payroll adjustment snapshot is stale') < at('attendance_period_complete'));
  assert.ok(at('attendance_period_complete') < at('Reconciliation failed for %'));
  assert.ok(at('Reconciliation failed for %') < at("SET status = 'LOCKED'"));
  // no salary formula in SQL: no gross / take-home computation beyond the pre-existing reconciliation check
  assert.doesNotMatch(regular, /base_salary|daily_salary|meal_allowance|late_deduction \*/);
  assert.ok(!norm(elseBranch(functionBody(sql))).includes('payroll_adjustments'), 'barber branch untouched');
});

test('Lifecycle migration: no privilege widening, earlier migrations untouched', () => {
  const { file, sql } = lifecycleMigration();
  for (const sig of [
    'lock_payroll_run(UUID, TEXT)',
    'create_regular_payroll_run(JSONB, JSONB)',
    'find_overlapping_regular_run(UUID, TEXT, DATE, DATE)',
  ]) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`), 'revoked: ' + sig);
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`), 'service_role only: ' + sig);
  }
  assert.doesNotMatch(sql, /GRANT [A-Z ,]+ (ON|TO) (PUBLIC|anon|authenticated)/);
  const serialize = fs.readdirSync(MIGRATIONS_DIR).find((n) => /serialize_regular_payroll_mutations/.test(n));
  assert.ok(file > serialize, 'ordered after the serialization migration');
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => /restore_barber_lock|block_pending_overtime|reconcile_overtime_before|serialize_regular_payroll/.test(n))) {
    assert.doesNotMatch(read(f), /create_regular_payroll_run|find_overlapping_regular_run|adjustments_dirty/, `${f} was not edited`);
  }
});

// ---------------------------------------------------------------------------------------------
// Round 7: attendance-wide payroll sync + attendance_dirty marker
// ---------------------------------------------------------------------------------------------
function attendanceSyncMigration() {
  const f = fs.readdirSync(MIGRATIONS_DIR).find((n) => /attendance_payroll_sync_dirty_marker/.test(n));
  assert.ok(f, 'attendance sync migration exists');
  return { file: f, sql: read(f) };
}

test('Attendance sync: fires on every payroll-relevant field the engine reads (not only overtime)', () => {
  const n = norm(attendanceSyncMigration().sql);
  assert.match(n, /BEFORE UPDATE OF employee_id, attendance_date, status, late_minutes, overtime_minutes, first_check_in, last_check_out ON public.employee_attendance/);
  assert.match(n, /BEFORE INSERT ON public.employee_attendance/);
  assert.match(n, /BEFORE DELETE ON public.employee_attendance/);
  for (const f of ['status', 'late_minutes', 'overtime_minutes', 'first_check_in', 'last_check_out']) {
    assert.match(n, new RegExp('NEW\.' + f + ' IS NOT DISTINCT FROM OLD\.' + f), f + ' compared on UPDATE');
  }
  // the old overtime-only triggers are gone
  assert.match(n, /DROP TRIGGER IF EXISTS trg_attendance_overtime_serialize_upd ON public.employee_attendance/);
  // metadata columns never take part
  assert.doesNotMatch(n, /raw_punches IS DISTINCT|NEW.source IS|NEW.notes/);
});

test('Attendance sync: takes the SHARE-lock helper first, marks DRAFT items dirty, never mutates LOCKED runs', () => {
  const n = norm(attendanceSyncMigration().sql);
  const fn = n.slice(n.indexOf('FUNCTION public.apply_attendance_payroll_effect'), n.indexOf('FUNCTION public.trg_attendance_payroll_sync'));
  assert.ok(fn.indexOf('serialize_regular_payroll_mutation') < fn.indexOf('attendance_dirty'), 'serialize before marking');
  assert.match(fn, /r.status = 'DRAFT'/);
  assert.match(fn, /'{attendance_dirty}', 'true'::jsonb/);
  assert.match(fn, /INSERT INTO public.payroll_attendance_post_lock_anomalies/);
  assert.match(fn, /r.status = 'LOCKED'/);
  assert.doesNotMatch(fn, /UPDATE public.payroll_runs/);
  assert.match(n, /ALTER TABLE public.payroll_attendance_post_lock_anomalies ENABLE ROW LEVEL SECURITY/);
  assert.match(n, /REVOKE ALL ON public.payroll_attendance_post_lock_anomalies FROM PUBLIC, anon, authenticated/);
});

test('Attendance sync: lock_payroll_run rejects a dirty attendance snapshot and keeps every older invariant + barber branch', () => {
  const sql = attendanceSyncMigration().sql;
  const body = norm(functionBody(sql));
  assert.match(body, /attendance_summary ->> 'attendance_dirty'/);
  assert.match(body, /IF v_snap_item.attendance_dirty THEN RAISE EXCEPTION 'Payroll attendance snapshot is stale for %/);
  for (const inv of ['FOR UPDATE', 'find_overlapping_regular_run', 'pending overtime approval', 'no longer match attendance overtime', 'adjustments_dirty', 'attendance_period_complete', 'Reconciliation failed for %']) {
    assert.ok(body.includes(inv), 'invariant kept: ' + inv);
  }
  assert.ok(norm(elseBranch(functionBody(sql))).includes('payroll_source_claims'), 'barber branch preserved');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lock_payroll_run\(UUID, TEXT\) TO service_role/);
  assert.doesNotMatch(sql, /GRANT [^;]*TO (anon|authenticated|PUBLIC)/i);
});
