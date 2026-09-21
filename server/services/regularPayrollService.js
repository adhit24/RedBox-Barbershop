'use strict';

/**
 * REDBOX COMMAND CENTER — Regular Payroll Service
 * Handles regular salaried payroll runs, attendance integration,
 * item snapshots, manual adjustments, and locking.
 */

const { calculateRegularPayrollItem, aggregateAdjustments, REGULAR_ITEM_STATUS, SOURCE_ORIGIN } = require('./regularPayrollEngine');
const { getPolicyForUnit, roundRupiah } = require('./regularPayrollPolicy');

/**
 * List regular payroll runs
 */
async function listRegularPayrollRuns(supabase, { status = null, businessUnit = null, branchScope = null } = {}) {
  const { data, error } = await fetchAllRows(() => {
    let query = supabase
      .from('payroll_runs')
      .select('*')
      .eq('payroll_type', 'REGULAR');
    if (status) query = query.eq('status', status);
    if (businessUnit && businessUnit !== 'ALL') query = query.eq('business_unit', businessUnit);
    return query.order('period_start', { ascending: false }).order('id');
  });
  if (error) {
    throw new Error(`Failed to list regular payroll runs: ${error.message}`);
  }
  const runs = data || [];
  if (!branchScope) return runs;

  // Branch-scoped callers never see run-wide compensation totals: the summary is recomputed from the
  // items they are authorized to see.
  const scoped = [];
  for (const run of runs) {
    const items = await loadScopedRunItems(supabase, run.id, branchScope);
    scoped.push({ ...run, summary: scopedRunSummary(run, items) });
  }
  return scoped;
}

/**
 * Items of one run restricted to a branch (payroll branch snapshot, case-insensitive). Every page is
 * read (deterministic order) before the branch filter; a failed read throws (never "no items").
 */
async function loadScopedRunItems(supabase, runId, branchScope, { filters = {} } = {}) {
  const { data, error } = await fetchAllRows(() => {
    let q = supabase
      .from('payroll_regular_items')
      .select('*')
      .eq('payroll_run_id', runId);
    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters.business_unit && filters.business_unit !== 'all') q = q.eq('business_unit_snapshot', filters.business_unit);
    return q.order('employee_name_snapshot').order('id');
  });
  if (error) throw new Error(`Failed to load payroll regular items: ${error.message}`);
  return (data || []).filter((i) => isEmployeeInBranchScope(i.branch_snapshot, branchScope));
}

function scopedRunSummary(run, items) {
  const summary = run.summary || {};
  return {
    total_employees: items.length,
    total_gross_pay: items.reduce((s, i) => s + Number(i.gross_pay || 0), 0),
    total_deductions: items.reduce((s, i) => s + Number(i.total_deduction || 0), 0),
    total_take_home_pay: items.reduce((s, i) => s + Number(i.take_home_pay || 0), 0),
    review_required_count: items.filter((i) => i.status === 'REVIEW_REQUIRED').length,
    missing_salary_count: items.filter((i) => i.status === 'MISSING_SALARY').length,
    missing_attendance_count: items.filter((i) => i.status === 'MISSING_ATTENDANCE' || i.status === 'BLOCKED_ATTENDANCE_SOURCE').length,
    attendance_data_through: summary.attendance_data_through ?? null,
    expected_period_end: summary.expected_period_end ?? null,
    attendance_period_complete: summary.attendance_period_complete ?? null,
    is_final: summary.is_final ?? false,
    scoped_to_branch: true,
  };
}

/**
 * Read every row of a query, paging past PostgREST's 1000-row response cap.
 * buildQuery must return a fresh, deterministically ordered query each call.
 */
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const q = buildQuery();
    const pageable = typeof q.range === 'function';
    const res = await (pageable ? q.range(from, from + pageSize - 1) : q);
    if (res.error) return { data: null, error: res.error };
    out.push(...(res.data || []));
    if (!pageable || !res.data || res.data.length < pageSize) break;
  }
  return { data: out, error: null };
}

const OVERTIME_DECIDED_STATUSES = ['APPROVED', 'REJECTED'];

function normalizeBranch(value) {
  return String(value || '').trim().toLowerCase();
}

/** branchScope: null/undefined = unrestricted (owner); otherwise only that branch. */
function isEmployeeInBranchScope(employeeBranch, branchScope) {
  if (!branchScope) return true;
  return normalizeBranch(employeeBranch) === normalizeBranch(branchScope);
}

/**
 * Overtime minutes must be a finite number >= 0 (numeric strings are accepted). No upper limit is
 * invented: none exists as Redbox policy. Returns the number or throws INVALID_OVERTIME_MINUTES.
 */
function parseNonNegativeMinutes(value, label = 'approved_minutes') {
  let n = value;
  if (typeof n === 'string' && n.trim() !== '') n = Number(n);
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    const err = new Error(`${label} must be a finite number >= 0`);
    err.code = 'INVALID_OVERTIME_MINUTES';
    throw err;
  }
  return n;
}

/**
 * LOCKED regular payroll runs (with their employees) that overlap the period. Locked payroll is
 * immutable: overtime for those (employee, date) pairs is never created, refreshed or deleted here
 * (the database triggers enforce the same rule); it is reported as an anomaly instead.
 */
async function loadLockedRegularCoverage(supabase, { periodStart = null, periodEnd = null } = {}) {
  const { data: runs, error } = await fetchAllRows(() => {
    let q = supabase
      .from('payroll_runs')
      .select('id, period_start, period_end')
      .in('payroll_type', ['REGULAR', 'REGULAR_PAYROLL'])
      .eq('status', 'LOCKED');
    if (periodEnd) q = q.lte('period_start', periodEnd);
    if (periodStart) q = q.gte('period_end', periodStart);
    return q.order('id');
  });
  if (error) throw new Error(`Failed to load locked payroll runs: ${error.message}`);

  const coverage = [];
  for (const run of runs || []) {
    const { data: items, error: itemsErr } = await fetchAllRows(() => supabase
      .from('payroll_regular_items')
      .select('employee_id')
      .eq('payroll_run_id', run.id)
      .order('employee_id'));
    if (itemsErr) throw new Error(`Failed to load locked payroll items: ${itemsErr.message}`);
    coverage.push({
      run_id: run.id,
      period_start: run.period_start,
      period_end: run.period_end,
      employees: new Set((items || []).map((i) => i.employee_id)),
    });
  }
  return (employeeId, date) => coverage.find(
    (c) => c.employees.has(employeeId) && date >= c.period_start && date <= c.period_end
  ) || null;
}

function branchForbiddenError() {
  const err = new Error('Forbidden: overtime approval is outside your assigned branch');
  err.code = 'FORBIDDEN_BRANCH';
  return err;
}

/**
 * Overtime state of ONE employee for a period, derived from approvals and the attendance source.
 *   approved_minutes   sum of APPROVED approved minutes
 *   pending_count      approvals still PENDING
 *   discrepancy_count  approvals whose raw minutes differ from current attendance overtime
 *   unsynced_count     attendance overtime days that have no approval row at all
 * attendanceOvertimeByDate: Map(date -> overtime_minutes) (only days with overtime > 0).
 */
function summarizeOvertimeState(approvals = [], attendanceOvertimeByDate = new Map()) {
  let approvedMinutes = 0;
  let pendingCount = 0;
  let discrepancyCount = 0;
  const approvalDates = new Set();
  for (const a of approvals) {
    approvalDates.add(a.attendance_date);
    if (a.status === 'APPROVED') approvedMinutes += Number(a.approved_overtime_minutes || 0);
    if (a.status === 'PENDING') pendingCount++;
    const source = Number(attendanceOvertimeByDate.get(a.attendance_date) || 0);
    if (Number(a.raw_overtime_minutes || 0) !== source) discrepancyCount++;
  }
  let unsyncedCount = 0;
  for (const [date, minutes] of attendanceOvertimeByDate.entries()) {
    if (Number(minutes) > 0 && !approvalDates.has(date)) unsyncedCount++;
  }
  return {
    approved_minutes: approvedMinutes,
    pending_count: pendingCount,
    discrepancy_count: discrepancyCount,
    unsynced_count: unsyncedCount,
  };
}

/**
 * Unified overtime reconciliation: attendance source -> approval state.
 *   A attendance > 0, no approval           -> create PENDING (raw = attendance)
 *   B attendance changed, approval PENDING  -> refresh raw_overtime_minutes
 *   C attendance = 0, approval PENDING      -> invalidate (delete the undecided, system-generated candidate)
 *   D source differs, APPROVED / REJECTED   -> never overwrite a human decision; report a discrepancy
 *                                              (the lock invariants keep the run from finalizing)
 * (employee, date) pairs that belong to a LOCKED regular payroll run are never touched: they are skipped
 * and reported in locked_run_anomalies (the database triggers refuse such writes anyway).
 * Reads both sides (attendance overtime AND existing approvals), paged and deterministically ordered.
 * Failed writes are collected per kind (insert_errors / update_errors / delete_errors); failed reads throw.
 */
async function reconcileOvertimeForPeriod(supabase, { periodStart = null, periodEnd = null, employeeIds = null } = {}) {
  const result = {
    attendance_rows: 0,
    created: [],
    raw_refreshed: [],
    invalidated: [],
    decision_discrepancies: [],
    pending: [],
    locked_run_anomalies: [],
    insert_errors: [],
    update_errors: [],
    delete_errors: [],
    touched: [],
  };
  if (Array.isArray(employeeIds) && employeeIds.length === 0) return result;

  const scope = (q) => {
    if (employeeIds) q = q.in('employee_id', employeeIds);
    if (periodStart) q = q.gte('attendance_date', periodStart);
    if (periodEnd) q = q.lte('attendance_date', periodEnd);
    return q;
  };

  const { data: attRows, error: attErr } = await fetchAllRows(() => scope(supabase
    .from('employee_attendance')
    .select('employee_id, attendance_date, overtime_minutes')
    .gt('overtime_minutes', 0))
    .order('employee_id')
    .order('attendance_date'));
  if (attErr) throw new Error(`Failed to query attendance overtime: ${attErr.message}`);

  const { data: approvals, error: apprErr } = await fetchAllRows(() => scope(supabase
    .from('employee_overtime_approvals')
    .select('id, employee_id, attendance_date, raw_overtime_minutes, approved_overtime_minutes, status'))
    .order('employee_id')
    .order('attendance_date')
    .order('id'));
  if (apprErr) throw new Error(`Failed to query overtime approvals: ${apprErr.message}`);

  const lockedRunFor = await loadLockedRegularCoverage(supabase, { periodStart, periodEnd });

  const keyOf = (r) => `${r.employee_id}|${r.attendance_date}`;
  const byKey = new Map((approvals || []).map((a) => [keyOf(a), a]));
  const attKeys = new Set();
  const touch = (r) => result.touched.push({ employee_id: r.employee_id, attendance_date: r.attendance_date });
  const skipLocked = (r) => {
    const locked = lockedRunFor(r.employee_id, r.attendance_date);
    if (!locked) return false;
    result.locked_run_anomalies.push({
      run_id: locked.run_id,
      employee_id: r.employee_id,
      attendance_date: r.attendance_date,
      reason: 'Overtime exists in the period of a LOCKED payroll run; nothing was changed.',
    });
    return true;
  };
  result.attendance_rows = (attRows || []).length;

  for (const row of attRows || []) {
    const key = keyOf(row);
    attKeys.add(key);
    if (skipLocked(row)) continue;
    const source = Number(row.overtime_minutes);
    const existing = byKey.get(key);

    if (!existing) {
      const { error: insErr } = await supabase.from('employee_overtime_approvals').insert({
        employee_id: row.employee_id,
        attendance_date: row.attendance_date,
        raw_overtime_minutes: source,
        approved_overtime_minutes: 0,
        status: 'PENDING',
      });
      if (insErr) {
        result.insert_errors.push({ employee_id: row.employee_id, attendance_date: row.attendance_date, error: insErr.message });
        continue;
      }
      result.created.push({ employee_id: row.employee_id, attendance_date: row.attendance_date, raw_overtime_minutes: source });
      touch(row);
    } else if (existing.status === 'PENDING') {
      const previousRaw = Number(existing.raw_overtime_minutes);
      if (previousRaw !== source) {
        const { error: rawErr } = await supabase
          .from('employee_overtime_approvals')
          .update({ raw_overtime_minutes: source, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (rawErr) {
          result.update_errors.push({ employee_id: row.employee_id, attendance_date: row.attendance_date, error: rawErr.message });
        } else {
          result.raw_refreshed.push({ approval_id: existing.id, from: previousRaw, to: source });
        }
      }
      result.pending.push({ employee_id: row.employee_id, attendance_date: row.attendance_date });
      touch(row);
    } else if (Number(existing.raw_overtime_minutes) !== source) {
      result.decision_discrepancies.push({
        approval_id: existing.id,
        employee_id: existing.employee_id,
        attendance_date: existing.attendance_date,
        status: existing.status,
        decided_against_raw_minutes: Number(existing.raw_overtime_minutes),
        attendance_overtime_minutes: source,
      });
      touch(row);
    }
  }

  // Approvals whose attendance overtime is gone (0 / no row): the other side of the reconciliation
  for (const ap of approvals || []) {
    if (attKeys.has(keyOf(ap))) continue;
    if (skipLocked(ap)) continue;
    if (ap.status === 'PENDING') {
      const { error: delErr } = await supabase.from('employee_overtime_approvals').delete().eq('id', ap.id);
      if (delErr) {
        result.delete_errors.push({ employee_id: ap.employee_id, attendance_date: ap.attendance_date, error: delErr.message });
        continue;
      }
      result.invalidated.push({
        approval_id: ap.id,
        employee_id: ap.employee_id,
        attendance_date: ap.attendance_date,
        raw_overtime_minutes: Number(ap.raw_overtime_minutes),
      });
      touch(ap);
    } else if (Number(ap.raw_overtime_minutes) !== 0) {
      result.decision_discrepancies.push({
        approval_id: ap.id,
        employee_id: ap.employee_id,
        attendance_date: ap.attendance_date,
        status: ap.status,
        decided_against_raw_minutes: Number(ap.raw_overtime_minutes),
        attendance_overtime_minutes: 0,
      });
      touch(ap);
    }
  }
  return result;
}

/** First failure message across every write kind of a reconciliation result (null when clean). */
function firstReconciliationError(r) {
  const e = [...r.insert_errors, ...r.update_errors, ...r.delete_errors][0];
  return e ? e.error : null;
}

/**
 * Adjustment lock invariant (service-side mirror of lock_payroll_run; the database stays the authority):
 * every item's manual_bonus / debt_deduction / manual_deduction / adjustments_total must equal the aggregate
 * of its adjustment rows, and an item explicitly marked dirty is stale. Returns the first violation or null.
 */
function evaluateAdjustmentLockInvariants({ items = [], adjustments = [] }) {
  for (const item of items) {
    const mine = adjustments.filter((a) => a.payroll_regular_item_id === item.id);
    const agg = aggregateAdjustments(mine);
    const dirty = item.attendance_summary?.adjustments_dirty === true || item.attendance_summary?.adjustments_dirty === 'true';
    if (
      dirty ||
      agg.bonus !== Number(item.manual_bonus || 0) ||
      agg.debt !== Number(item.debt_deduction || 0) ||
      agg.deduction !== Number(item.manual_deduction || 0) ||
      agg.bonus - agg.debt - agg.deduction !== Number(item.adjustments_total || 0)
    ) {
      return { code: 'ADJUSTMENT_SNAPSHOT_STALE', message: `Payroll adjustment snapshot is stale for ${item.employee_name_snapshot || item.employee_id}. Recalculate before locking.` };
    }
  }
  return null;
}

/**
 * Lock invariants for overtime, evaluated in the same order as the lock_payroll_run RPC (the database
 * remains the final authority; this is the service-side fail-fast and the testable mirror).
 *   items: [{ employee_id, employee_name_snapshot, overtime_hours, attendance_summary }]
 *   approvals / attendanceRows: rows of the run's employees within the run period
 * Returns the first violation {code, message} or null.
 */
function evaluateOvertimeLockInvariants({ items = [], approvals = [], attendanceRows = [] }) {
  const pending = approvals.filter((a) => a.status === 'PENDING');
  if (pending.length > 0) {
    return { code: 'PENDING_OVERTIME', message: `Cannot lock regular payroll: ${pending.length} pending overtime approval(s) remain. Approve or reject them first.` };
  }

  const decidedKeys = new Set(
    approvals.filter((a) => OVERTIME_DECIDED_STATUSES.includes(a.status)).map((a) => `${a.employee_id}|${a.attendance_date}`)
  );
  const attByKey = new Map();
  let unreviewed = 0;
  for (const r of attendanceRows) {
    if (Number(r.overtime_minutes) > 0) {
      attByKey.set(`${r.employee_id}|${r.attendance_date}`, Number(r.overtime_minutes));
      if (!decidedKeys.has(`${r.employee_id}|${r.attendance_date}`)) unreviewed++;
    }
  }
  if (unreviewed > 0) {
    return { code: 'UNREVIEWED_ATTENDANCE_OVERTIME', message: `Cannot lock regular payroll: ${unreviewed} attendance overtime row(s) have no reviewed approval. Sync and review overtime first.` };
  }

  const mismatched = approvals.filter(
    (a) => Number(a.raw_overtime_minutes || 0) !== Number(attByKey.get(`${a.employee_id}|${a.attendance_date}`) || 0)
  );
  if (mismatched.length > 0) {
    return { code: 'OVERTIME_SOURCE_MISMATCH', message: `Cannot lock regular payroll: ${mismatched.length} overtime approval(s) no longer match attendance overtime. Reconcile and re-review first.` };
  }

  for (const item of items) {
    const dbMinutes = approvals
      .filter((a) => a.employee_id === item.employee_id && a.status === 'APPROVED')
      .reduce((sum, a) => sum + Number(a.approved_overtime_minutes || 0), 0);
    const snapshotMinutes = Number(item.attendance_summary?.approved_overtime_minutes || 0);
    const expectedHours = Math.round((dbMinutes / 60) * 10) / 10;
    if (dbMinutes !== snapshotMinutes || Math.abs(Number(item.overtime_hours || 0) - expectedHours) > 0.05) {
      return { code: 'OVERTIME_SNAPSHOT_STALE', message: `Payroll overtime snapshot is stale for ${item.employee_name_snapshot || item.employee_id}. Recalculate before locking.` };
    }
  }
  return null;
}

function inclusiveDayCount(from, to) {
  if (!from || !to || to < from) return 0;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}

/**
 * Compute run-level attendance coverage from authoritative employee_attendance records.
 * Authority: The latest attendance_date present in employee_attendance for any employee
 * in the run's population within [periodStart, periodEnd].
 * If no attendance records exist, attendance_data_through is null and attendance_period_complete is false.
 * attendance_period_complete is true if and only if attendance_data_through >= periodEnd.
 * Fail-closed: Any database query error throws ATTENDANCE_COVERAGE_READ_FAILED.
 */
async function computeRunAttendanceCoverage(supabase, { periodStart, periodEnd, employeeIds = [] }) {
  if (!employeeIds.length || !periodStart || !periodEnd) {
    return {
      attendance_data_through: null,
      expected_period_end: periodEnd || null,
      attendance_period_complete: false,
    };
  }

  let q = supabase
    .from('employee_attendance')
    .select('attendance_date')
    .in('employee_id', employeeIds)
    .gte('attendance_date', periodStart)
    .lte('attendance_date', periodEnd)
    .order('attendance_date', { ascending: false });

  if (typeof q.limit === 'function') {
    q = q.limit(1);
  }

  const { data, error } = await q;

  if (error) {
    const err = new Error(`Failed to compute run attendance coverage: ${error.message}`);
    err.code = 'ATTENDANCE_COVERAGE_READ_FAILED';
    throw err;
  }

  const latestDate = (data && data.length > 0) ? data[0].attendance_date : null;
  const isComplete = Boolean(latestDate && latestDate >= periodEnd);

  return {
    attendance_data_through: latestDate,
    expected_period_end: periodEnd,
    attendance_period_complete: isComplete,
  };
}

/**
 * Fetch attendance summary for a list of employees over a date range
 */
async function fetchEmployeeAttendanceSummaries(supabase, employeeIds = [], periodStart, periodEnd, employeeMap = new Map(), { runCoverage = null } = {}) {
  const summaryMap = new Map();
  for (const empId of employeeIds) {
    const emp = employeeMap.get(empId);
    summaryMap.set(empId, {
      present_days: 0,
      absent_days: 0,
      late_count: 0,
      late_minutes: 0,
      overtime_hours: 0,
      candidate_overtime_minutes: 0,
      approved_overtime_minutes: 0,
      pending_overtime_count: 0,
      incomplete_attendance: 0,
      records_count: 0,
      unresolved_exceptions_count: 0,
      min_date: null,
      max_date: null,
      attendance_period_expected: `${periodStart} s/d ${periodEnd}`,
      attendance_period_available: 'Belum tersedia',
      attendance_coverage_days: 0,
      attendance_coverage_status: 'NO_ATTENDANCE',
    });
  }

  if (!employeeIds.length || !periodStart || !periodEnd) return summaryMap;

  // 1. Query employee_attendance
  const { data: attendanceRows, error: attError } = await fetchAllRows(() => supabase
    .from('employee_attendance')
    .select('employee_id, attendance_date, status, late_minutes, overtime_minutes, first_check_in, last_check_out')
    .in('employee_id', employeeIds)
    .gte('attendance_date', periodStart)
    .lte('attendance_date', periodEnd)
    .order('employee_id')
    .order('attendance_date'));

  // Fail closed: a failed read must never look like "no attendance" (it would yield MISSING/READY wrongly).
  if (attError) {
    throw new Error(`Failed to query employee_attendance: ${attError.message}`);
  }
  const attOvertime = new Map(); // employee_id -> Map(date -> overtime_minutes > 0)
  {
    for (const row of attendanceRows || []) {
      const s = summaryMap.get(row.employee_id);
      if (!s) continue;
      s.records_count++;

      // Track min and max dates
      if (!s.min_date || row.attendance_date < s.min_date) s.min_date = row.attendance_date;
      if (!s.max_date || row.attendance_date > s.max_date) s.max_date = row.attendance_date;

      const st = String(row.status || '').toLowerCase().trim();
      if (st === 'hadir') {
        s.present_days++;
      } else if (st === 'terlambat') {
        s.present_days++;
        s.late_count++;
        s.late_minutes += Number(row.late_minutes || 0);
      } else if (st === 'absent') {
        s.absent_days++;
      } else if (st === 'incomplete') {
        s.incomplete_attendance++;
      }
      // 'izin'/'sakit'/'cuti'/'off' rows are already counted once in records_count

      // Check missing punch
      if ((!row.first_check_in || !row.last_check_out) && st !== 'off' && st !== 'absent') {
        s.incomplete_attendance++;
      }

      // Raw candidate overtime minutes from attendance
      if (row.overtime_minutes > 0) {
        s.candidate_overtime_minutes += Number(row.overtime_minutes);
        if (!attOvertime.has(row.employee_id)) attOvertime.set(row.employee_id, new Map());
        attOvertime.get(row.employee_id).set(row.attendance_date, Number(row.overtime_minutes));
      }
    }
  }

  // 2. Query employee_overtime_approvals (ONLY approved overtime counts towards payroll).
  // Paged with a deterministic order and fail-closed: a truncated page would drop approved minutes or
  // pending candidates and make an item look READY / underpaid.
  const { data: otApprovals, error: otErr } = await fetchAllRows(() => supabase
    .from('employee_overtime_approvals')
    .select('id, employee_id, attendance_date, raw_overtime_minutes, approved_overtime_minutes, status')
    .in('employee_id', employeeIds)
    .gte('attendance_date', periodStart)
    .lte('attendance_date', periodEnd)
    .order('employee_id')
    .order('attendance_date')
    .order('id'));
  if (otErr) {
    throw new Error(`Failed to query employee_overtime_approvals: ${otErr.message}`);
  }
  const approvalsByEmployee = new Map();
  for (const ot of otApprovals || []) {
    if (!approvalsByEmployee.has(ot.employee_id)) approvalsByEmployee.set(ot.employee_id, []);
    approvalsByEmployee.get(ot.employee_id).push(ot);
  }
  for (const [empId, s] of summaryMap.entries()) {
    const state = summarizeOvertimeState(approvalsByEmployee.get(empId) || [], attOvertime.get(empId) || new Map());
    s.approved_overtime_minutes = state.approved_minutes;
    s.pending_overtime_count = state.pending_count;
    s.overtime_discrepancy_count = state.discrepancy_count;
    s.unsynced_overtime_count = state.unsynced_count;
  }

  // 3. Query unresolved attendance_exceptions.
  // Fail closed: an unreadable exception list is NOT "no exceptions" - it would let an item that must be
  // REVIEW_REQUIRED come out READY. Abort BEFORE any status is calculated / anything is written.
  const { data: excRows, error: excError } = await fetchAllRows(() => supabase
    .from('attendance_exceptions')
    .select('raw_data, status, attendance_date')
    .eq('status', 'pending')
    .gte('attendance_date', periodStart)
    .lte('attendance_date', periodEnd)
    .order('attendance_date')
    .order('id'));
  if (excError) {
    const err = new Error(`Failed to query attendance_exceptions: ${excError.message}`);
    err.code = 'ATTENDANCE_EXCEPTIONS_READ_FAILED';
    throw err;
  }
  for (const exc of excRows || []) {
    const empId = exc.raw_data?.employee_id;
    if (empId && summaryMap.has(empId)) {
      summaryMap.get(empId).unresolved_exceptions_count++;
    }
  }

  // 4. Finalize metrics per employee
  // The attendance source only covers up to the last day it has data; days after that
  // are "not yet available", never "absent".
  let computedDataThrough = null;
  for (const s of summaryMap.values()) {
    if (s.max_date && (!computedDataThrough || s.max_date > computedDataThrough)) computedDataThrough = s.max_date;
  }
  const dataThrough = runCoverage ? runCoverage.attendance_data_through : computedDataThrough;
  const periodComplete = runCoverage ? runCoverage.attendance_period_complete : (!!dataThrough && dataThrough >= periodEnd);

  for (const [empId, s] of summaryMap.entries()) {
    const joinDate = employeeMap.get(empId)?.join_date || null;
    const windowStart = joinDate && joinDate > periodStart ? joinDate : periodStart;
    const windowEnd = dataThrough && dataThrough < periodEnd ? dataThrough : periodEnd;
    s.attendance_data_through = dataThrough;
    s.attendance_period_complete = periodComplete;
    s.expected_coverage_days = dataThrough ? inclusiveDayCount(windowStart, windowEnd) : 0;
    // Only approved overtime minutes are converted to overtime hours!
    s.overtime_hours = Math.round((s.approved_overtime_minutes / 60) * 10) / 10;

    s.attendance_coverage_days = s.records_count;
    s.attendance_period_available = s.min_date && s.max_date ? `${s.min_date} s/d ${s.max_date}` : 'Belum tersedia';

    // Attendance source is resolved by fingerprint identity, never by business unit.
    if (s.records_count >= 18) {
      s.attendance_coverage_status = 'COMPLETE';
    } else if (s.records_count > 0) {
      s.attendance_coverage_status = 'PARTIAL';
    } else {
      s.attendance_coverage_status = 'NO_ATTENDANCE';
    }
  }

  return summaryMap;
}

/**
 * Generate regular payroll draft
 */
async function generateRegularPayrollDraft(supabase, {
  periodStart,
  periodEnd,
  businessUnit = 'ALL',
  userEmail = 'owner@redbox.id',
  itemOverrides = {},
}) {
  if (!periodStart || !periodEnd) {
    throw new Error('periodStart and periodEnd are required');
  }

  // 1. Friendly pre-check for an overlapping DRAFT or LOCKED run. The database is authoritative
  // (trg_payroll_runs_no_overlap under an advisory lock) and also rejects the concurrent race.
  let checkQuery = supabase
    .from('payroll_runs')
    .select('id, period_start, period_end, status, business_unit')
    .eq('payroll_type', 'REGULAR')
    .lte('period_start', periodEnd)
    .gte('period_end', periodStart);

  if (businessUnit && businessUnit !== 'ALL') {
    checkQuery = checkQuery.or(`business_unit.eq.${businessUnit},business_unit.eq.ALL`);
  }

  const { data: existingRuns, error: checkErr } = await checkQuery;
  if (checkErr) throw new Error(`Check existing runs failed: ${checkErr.message}`);

  const overlap = (existingRuns || []).find(r => r.status === 'LOCKED' || r.status === 'DRAFT');
  if (overlap) {
    throw new Error(`Cannot generate payroll draft: overlapping ${overlap.status} run found (${overlap.id} from ${overlap.period_start} to ${overlap.period_end})`);
  }

  // 2. Fetch regular employees
  let empQuery = supabase
    .from('employees')
    .select('id, name, nickname, business_unit, branch, branch_name, position, base_salary, position_allowance, meal_allowance_rate, is_active, join_date')
    .eq('is_active', true)
    .order('name');

  if (businessUnit && businessUnit !== 'ALL') {
    empQuery = empQuery.eq('business_unit', businessUnit);
  }

  const { data: employees, error: empErr } = await empQuery;
  if (empErr) throw new Error(`Failed to load employees: ${empErr.message}`);
  if (!employees || !employees.length) {
    throw new Error(`No active regular employees found for business unit: ${businessUnit}`);
  }

  // 3. Fetch attendance summaries
  const employeeIds = employees.map(e => e.id);
  const employeeMap = new Map(employees.map(e => [e.id, e]));

  // 3a. Reconcile overtime BEFORE calculating: attendance overtime must exist as an approval candidate
  // so the draft cannot be READY while unreviewed overtime exists.
  const overtimeReconciliation = await reconcileOvertimeForPeriod(supabase, { periodStart, periodEnd, employeeIds });
  if (firstReconciliationError(overtimeReconciliation)) {
    throw new Error(`Overtime reconciliation failed: ${firstReconciliationError(overtimeReconciliation)}`);
  }
  const attendanceMap = await fetchEmployeeAttendanceSummaries(supabase, employeeIds, periodStart, periodEnd, employeeMap);

  // 4. Calculate items
  const coverage = await computeRunAttendanceCoverage(supabase, { periodStart, periodEnd, employeeIds });
  const attendanceDataThrough = coverage.attendance_data_through;
  const calculatedItems = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalTakeHome = 0;
  let reviewRequiredCount = 0;
  let missingSalaryCount = 0;
  let missingAttendanceCount = 0;

  for (const emp of employees) {
    const attSummary = attendanceMap.get(emp.id) || {
      present_days: 0,
      absent_days: 0,
      late_count: 0,
      late_minutes: 0,
      overtime_hours: 0,
      candidate_overtime_minutes: 0,
      approved_overtime_minutes: 0,
      pending_overtime_count: 0,
      incomplete_attendance: 0,
      records_count: 0,
      unresolved_exceptions_count: 0,
      min_date: null,
      max_date: null,
      attendance_period_expected: `${periodStart} s/d ${periodEnd}`,
      attendance_period_available: 'Belum tersedia',
      attendance_coverage_days: 0,
      attendance_coverage_status: 'NO_ATTENDANCE',
    };

    const override = itemOverrides[emp.id] || {};

    const itemResult = calculateRegularPayrollItem({
      employee: emp,
      period: { period_start: periodStart, period_end: periodEnd },
      attendanceSummary: attSummary,
      allowances: {
        meal_allowance_days: override.meal_allowance_days,
        meal_allowance_rate: override.meal_allowance_rate,
        position_allowance: override.position_allowance,
        attendance_allowance: override.attendance_allowance,
      },
      variables: {
        product_commission: override.product_commission,
        product_commission_source: override.product_commission_source,
        service_barber_amount: override.service_barber_amount,
        service_barber_source: override.service_barber_source,
        approved_overtime_hours: override.approved_overtime_hours,
      },
      lateDeductionOverride: override.late_deduction,
      adjustments: override.adjustments || [],
    });

    totalGross += itemResult.gross_pay;
    totalDeductions += itemResult.total_deduction;
    totalTakeHome += itemResult.take_home_pay;

    if (itemResult.status === REGULAR_ITEM_STATUS.REVIEW_REQUIRED) reviewRequiredCount++;
    if (itemResult.status === REGULAR_ITEM_STATUS.MISSING_SALARY) missingSalaryCount++;
    if (itemResult.status === REGULAR_ITEM_STATUS.MISSING_ATTENDANCE || itemResult.status === REGULAR_ITEM_STATUS.BLOCKED_ATTENDANCE_SOURCE) {
      missingAttendanceCount++;
    }

    calculatedItems.push(itemResult);
  }

  // 5. Insert header payroll_runs
  const summaryPayload = {
    total_employees: employees.length,
    total_gross_pay: totalGross,
    total_deductions: totalDeductions,
    total_take_home_pay: totalTakeHome,
    review_required_count: reviewRequiredCount,
    missing_salary_count: missingSalaryCount,
    missing_attendance_count: missingAttendanceCount,
    attendance_data_through: attendanceDataThrough,
    expected_period_end: periodEnd,
    attendance_period_complete: attendanceDataThrough ? attendanceDataThrough >= periodEnd : false,
    is_final: false,
  };

  // 6. Header + items in ONE database transaction (create_regular_payroll_run): the run becomes visible
  // only when every item is stored, and any failure (including an overlapping run created concurrently)
  // rolls the header back. No visible partial / empty DRAFT can be locked.
  const itemsPayload = calculatedItems.map(item => ({
    employee_id: item.employee_id,
    employee_name_snapshot: item.employee_name_snapshot,
    employee_nickname_snapshot: item.employee_nickname_snapshot,
    business_unit_snapshot: item.business_unit_snapshot,
    position_snapshot: item.position_snapshot,
    branch_snapshot: item.branch_snapshot,

    base_salary: item.base_salary,
    daily_salary: item.daily_salary,
    salary_divisor: item.salary_divisor,
    work_days: item.work_days,
    actual_salary: item.actual_salary,

    meal_allowance_days: item.meal_allowance_days,
    meal_allowance_rate: item.meal_allowance_rate,
    meal_allowance_total: item.meal_allowance_total,

    position_allowance: item.position_allowance,
    attendance_allowance: item.attendance_allowance,
    attendance_allowance_source: item.attendance_allowance_source,

    product_commission: item.product_commission,
    product_commission_source: item.product_commission_source,
    service_barber_amount: item.service_barber_amount,
    service_barber_source: item.service_barber_source,
    overtime_hours: item.overtime_hours,
    overtime_rate: item.overtime_rate,
    overtime_amount: item.overtime_amount,

    late_count: item.late_count,
    late_penalty_rate: item.late_penalty_rate,
    late_deduction: item.late_deduction,
    late_deduction_source: item.late_deduction_source,
    debt_deduction: item.debt_deduction,
    manual_deduction: item.manual_deduction,

    manual_bonus: item.manual_bonus,
    adjustments_total: item.adjustments_total,

    gross_pay: item.gross_pay,
    total_deduction: item.total_deduction,
    take_home_pay: item.take_home_pay,

    attendance_period_expected: item.attendance_period_expected,
    attendance_period_available: item.attendance_period_available,
    attendance_coverage_days: item.attendance_coverage_days,
    attendance_coverage_status: item.attendance_coverage_status,

    attendance_summary: item.attendance_summary,
    warnings: item.warnings,
    status: item.status,
  }));

  const { data: created, error: createErr } = await supabase.rpc('create_regular_payroll_run', {
    p_header: {
      business_unit: businessUnit,
      period_start: periodStart,
      period_end: periodEnd,
      generated_by: userEmail,
      calculation_version: 'regular-v1.0',
      summary: summaryPayload,
    },
    p_items: itemsPayload,
  });

  if (createErr || !created || !created.run_id) {
    const err = new Error(`Failed to create regular payroll run: ${createErr?.message || 'no run returned'}`);
    err.code = /Overlapping regular payroll run/i.test(createErr?.message || '') ? 'OVERLAPPING_RUN' : 'RUN_CREATE_FAILED';
    throw err;
  }
  const run = { id: created.run_id };
  const itemsToInsert = itemsPayload;

  return {
    success: true,
    run_id: run.id,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'DRAFT',
    summary: summaryPayload,
    items_count: itemsToInsert.length,
  };
}

/**
 * Get payroll run detail with items and adjustments
 */
async function getRegularPayrollRunDetail(supabase, { runId, filters = {}, branchScope = null }) {
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    const err = new Error(`Payroll run ${runId} not found`);
    err.status = 404;
    throw err;
  }

  // Compensation detail is scoped BEFORE it is assembled: a branch-bound caller only ever gets the
  // items (and adjustments of those items) of their branch; direct run ids do not widen scope.
  const items = await loadScopedRunItems(supabase, runId, branchScope, { filters });

  // Fetch adjustments for this run (fail closed: a failed read must not look like "no adjustments")
  const { data: adjustments, error: adjErr } = await fetchAllRows(() => supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('created_at', { ascending: true })
    .order('id'));
  if (adjErr) {
    throw new Error(`Failed to load payroll adjustments: ${adjErr.message}`);
  }

  const visibleItemIds = new Set(items.map((i) => i.id));
  const adjMap = new Map();
  for (const adj of adjustments || []) {
    const itemId = adj.payroll_regular_item_id;
    if (!visibleItemIds.has(itemId)) continue;
    if (!adjMap.has(itemId)) adjMap.set(itemId, []);
    adjMap.get(itemId).push(adj);
  }

  const enrichedItems = items.map(item => ({
    ...item,
    adjustments: adjMap.get(item.id) || [],
  }));

  return {
    run: branchScope ? { ...run, summary: scopedRunSummary(run, items) } : run,
    items: enrichedItems,
  };
}

/**
 * Add manual adjustment to regular employee item
 */
async function addRegularPayrollAdjustment(supabase, {
  runId,
  payrollRegularItemId,
  employeeId = undefined, // optional consistency check only; the employee is derived from the item
  type = 'OTHER',
  amount,
  reason,
  note = null,
  userEmail = 'owner@redbox.id',
}) {
  if (!amount || amount === 0) throw new Error('Adjustment amount cannot be zero');
  if (!reason || !reason.trim()) throw new Error('Reason is required for manual adjustment');

  // Never trust the client's combination of runId / itemId / employeeId: load the item by BOTH ids.
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status, payroll_type')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);
  if (run.payroll_type !== 'REGULAR' && run.payroll_type !== 'REGULAR_PAYROLL') {
    throw new Error('Cannot add adjustment: payroll run is not a REGULAR payroll run');
  }
  if (run.status !== 'DRAFT') throw new Error(`Cannot add adjustment: payroll run is ${run.status}`);

  const { data: item, error: itemErr } = await supabase
    .from('payroll_regular_items')
    .select('id, payroll_run_id, employee_id, status')
    .eq('id', payrollRegularItemId)
    .eq('payroll_run_id', runId)
    .maybeSingle();

  if (itemErr) throw new Error(`Failed to load payroll item: ${itemErr.message}`);
  if (!item) throw new Error(`Payroll item ${payrollRegularItemId} does not belong to payroll run ${runId}`);
  if (item.status === 'LOCKED') throw new Error('Cannot add adjustment: payroll item is LOCKED');
  if (employeeId !== undefined && employeeId !== null && employeeId !== item.employee_id) {
    throw new Error('Adjustment employee does not match the payroll item');
  }

  // Insert adjustment (employee derived from the item, run from the verified item)
  const { data: adj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .insert({
      payroll_run_id: item.payroll_run_id,
      payroll_regular_item_id: item.id,
      employee_id: item.employee_id,
      type: type.toUpperCase().trim(),
      amount: roundRupiah(amount),
      reason: reason.trim(),
      note: note ? note.trim() : null,
      created_by: userEmail,
    })
    .select()
    .single();

  if (adjErr) throw new Error(`Failed to insert adjustment: ${adjErr.message}`);

  // Recalculate the employee item. The adjustment row is committed (and the item snapshot is already marked
  // dirty by the database in the same transaction, so lock_payroll_run refuses it until recalculated);
  // report honestly when the snapshot could not follow.
  try {
    await recalculateSingleRegularItem(supabase, item.payroll_run_id, item.id);
  } catch (recalcErr) {
    return {
      success: false,
      adjustment_saved: true,
      recalculation_success: false,
      adjustment: adj,
      reason: recalcErr.code || 'RECALCULATION_FAILED',
      error: recalcErr.message,
    };
  }

  return { success: true, adjustment_saved: true, recalculation_success: true, adjustment: adj };
}

/**
 * Delete manual adjustment
 */
async function deleteRegularPayrollAdjustment(supabase, { adjustmentId }) {
  const { data: adj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .select('id, payroll_run_id, payroll_regular_item_id')
    .eq('id', adjustmentId)
    .single();

  if (adjErr || !adj) throw new Error(`Adjustment ${adjustmentId} not found`);

  // Verify run is not locked
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('status')
    .eq('id', adj.payroll_run_id)
    .single();

  if (run && run.status === 'LOCKED') {
    throw new Error('Cannot delete adjustment: payroll run is LOCKED');
  }

  const { error: delErr } = await supabase
    .from('payroll_adjustments')
    .delete()
    .eq('id', adjustmentId);

  if (delErr) throw new Error(`Failed to delete adjustment: ${delErr.message}`);

  // Recalculate item (the database already marked the snapshot dirty in the delete's transaction)
  try {
    await recalculateSingleRegularItem(supabase, adj.payroll_run_id, adj.payroll_regular_item_id);
  } catch (recalcErr) {
    return {
      success: false,
      adjustment_deleted: true,
      recalculation_success: false,
      deleted_id: adjustmentId,
      reason: recalcErr.code || 'RECALCULATION_FAILED',
      error: recalcErr.message,
    };
  }

  return { success: true, adjustment_deleted: true, recalculation_success: true, deleted_id: adjustmentId };
}

/**
 * Helper to recalculate a single regular item in draft after adjustments change
 */
async function recalculateSingleRegularItem(supabase, runId, itemId, { refreshOvertime = false, refreshAttendance = false, runCoverage = null } = {}) {
  // Fetch item (fail closed: an unreadable item is an error, never a silent no-op)
  const { data: item, error: itemReadErr } = await supabase
    .from('payroll_regular_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (itemReadErr || !item) {
    const err = new Error(`Failed to read payroll item ${itemId}: ${itemReadErr?.message || 'not found'}`);
    err.code = 'ITEM_READ_FAILED';
    throw err;
  }
  if (item.status === 'LOCKED') return null; // never touch frozen items

  // Overtime review changes employee_overtime_approvals only; re-read it so the snapshot
  // (hours, pending count) reflects the current approvals for this run's period.
  // A payroll-relevant attendance change (late_minutes / status / punches / overtime / rows added or removed)
  // marks the DRAFT item attendance_dirty (trg_attendance_payroll_sync). The snapshot is then stale as a whole,
  // so recalculation re-reads ATTENDANCE, not only overtime; the rebuilt attendance_summary drops the marker.
  const attendanceStale = refreshAttendance || item.attendance_summary?.attendance_dirty === true;
  let freshAttendance = false;
  let attendanceSummary = item.attendance_summary;
  let approvedOvertimeHours = item.overtime_hours;
  if (refreshOvertime || attendanceStale) {
    const { data: run, error: runReadErr } = await supabase
      .from('payroll_runs')
      .select('period_start, period_end')
      .eq('id', runId)
      .single();
    if (runReadErr || !run) {
      const err = new Error(`Failed to read payroll run ${runId}: ${runReadErr?.message || 'not found'}`);
      err.code = 'RUN_READ_FAILED';
      throw err;
    }

    // Bring approvals in line with the attendance source first (create / refresh / invalidate)
    const reconciliation = await reconcileOvertimeForPeriod(supabase, {
      periodStart: run.period_start,
      periodEnd: run.period_end,
      employeeIds: [item.employee_id],
    });
    if (firstReconciliationError(reconciliation)) {
      throw new Error(`Overtime reconciliation failed: ${firstReconciliationError(reconciliation)}`);
    }

    if (attendanceStale) {
      const { data: empRow, error: empReadErr } = await supabase
        .from('employees')
        .select('id, join_date')
        .eq('id', item.employee_id)
        .single();
      if (empReadErr || !empRow) {
        const err = new Error(`Failed to read employee ${item.employee_id}: ${empReadErr?.message || 'not found'}`);
        err.code = 'EMPLOYEE_READ_FAILED';
        throw err;
      }
      const map = await fetchEmployeeAttendanceSummaries(
        supabase,
        [item.employee_id],
        run.period_start,
        run.period_end,
        new Map([[item.employee_id, empRow]]),
        { runCoverage }
      );
      attendanceSummary = map.get(item.employee_id);
      approvedOvertimeHours = attendanceSummary.overtime_hours;
      freshAttendance = true;
    }
    if (!freshAttendance) {
    const { data: otRows, error: otErr } = await fetchAllRows(() => supabase
      .from('employee_overtime_approvals')
      .select('id, attendance_date, raw_overtime_minutes, approved_overtime_minutes, status')
      .eq('employee_id', item.employee_id)
      .gte('attendance_date', run.period_start)
      .lte('attendance_date', run.period_end)
      .order('attendance_date')
      .order('id'));
    if (otErr) throw new Error(`Failed to read overtime approvals: ${otErr.message}`);
    const { data: attRows, error: attErr } = await fetchAllRows(() => supabase
      .from('employee_attendance')
      .select('attendance_date, overtime_minutes')
      .eq('employee_id', item.employee_id)
      .gt('overtime_minutes', 0)
      .gte('attendance_date', run.period_start)
      .lte('attendance_date', run.period_end)
      .order('attendance_date'));
    if (attErr) throw new Error(`Failed to read attendance overtime: ${attErr.message}`);

    const state = summarizeOvertimeState(otRows || [], new Map((attRows || []).map((r) => [r.attendance_date, Number(r.overtime_minutes)])));
    approvedOvertimeHours = Math.round((state.approved_minutes / 60) * 10) / 10;
    attendanceSummary = {
      ...(item.attendance_summary || {}),
      approved_overtime_minutes: state.approved_minutes,
      pending_overtime_count: state.pending_count,
      overtime_discrepancy_count: state.discrepancy_count,
      unsynced_overtime_count: state.unsynced_count,
      overtime_hours: approvedOvertimeHours,
    };
    }
  }

  // Fetch all adjustments for this item. A failed read must abort: continuing with "no adjustments" would
  // rewrite the snapshot without its bonuses/deductions and report success.
  const { data: adjs, error: adjReadErr } = await fetchAllRows(() => supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_regular_item_id', itemId)
    .order('created_at')
    .order('id'));
  if (adjReadErr) {
    const err = new Error(`Failed to read payroll adjustments for item ${itemId}: ${adjReadErr.message}`);
    err.code = 'ADJUSTMENTS_READ_FAILED';
    throw err;
  }

  const calc = calculateRegularPayrollItem({
    // Compensation authority is the DRAFT snapshot stored on the item. The live employees master
    // may have changed since the draft was generated; only attendance/overtime are refreshed here.
    employee: {
      id: item.employee_id,
      name: item.employee_name_snapshot,
      nickname: item.employee_nickname_snapshot,
      business_unit: item.business_unit_snapshot,
      branch: item.branch_snapshot,
      position: item.position_snapshot,
      base_salary: item.base_salary,
      position_allowance: item.position_allowance,
      meal_allowance_rate: item.meal_allowance_rate,
    },
    attendanceSummary,
    allowances: {
      // Fresh attendance: meal days follow present days again; a stored value is kept only for non-refreshed items.
      meal_allowance_days: freshAttendance ? undefined : item.meal_allowance_days,
      meal_allowance_rate: item.meal_allowance_rate,
      position_allowance: item.position_allowance,
      attendance_allowance: item.attendance_allowance,
    },
    variables: {
      product_commission: item.product_commission,
      product_commission_source: item.product_commission_source,
      service_barber_amount: item.service_barber_amount,
      service_barber_source: item.service_barber_source,
      approved_overtime_hours: approvedOvertimeHours,
    },
    // Fresh attendance recomputes late deduction from the new late count unless it was a MANUAL override.
    lateDeductionOverride: freshAttendance && item.late_deduction_source !== 'MANUAL_OVERRIDE' ? undefined : item.late_deduction,
    adjustments: adjs,
  });

  // Update item in database. A rejected write (e.g. the run was LOCKED concurrently and the
  // immutability trigger fired) must surface as an error, never as a successful recalculation.
  const { data: updatedItem, error: itemUpdErr } = await supabase
    .from('payroll_regular_items')
    .update({
      ...(freshAttendance ? {
        work_days: calc.work_days,
        actual_salary: calc.actual_salary,
        meal_allowance_days: calc.meal_allowance_days,
        meal_allowance_total: calc.meal_allowance_total,
        late_count: calc.late_count,
        late_deduction: calc.late_deduction,
        late_deduction_source: calc.late_deduction_source,
        attendance_period_expected: calc.attendance_period_expected,
        attendance_period_available: calc.attendance_period_available,
        attendance_coverage_days: calc.attendance_coverage_days,
        attendance_coverage_status: calc.attendance_coverage_status,
      } : {}),
      overtime_hours: calc.overtime_hours,
      overtime_rate: calc.overtime_rate,
      overtime_amount: calc.overtime_amount,
      attendance_summary: calc.attendance_summary,
      warnings: calc.warnings,
      manual_bonus: calc.manual_bonus,
      debt_deduction: calc.debt_deduction,
      manual_deduction: calc.manual_deduction,
      adjustments_total: calc.adjustments_total,
      gross_pay: calc.gross_pay,
      total_deduction: calc.total_deduction,
      take_home_pay: calc.take_home_pay,
      status: calc.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select('id')
    .single();

  if (itemUpdErr || !updatedItem) {
    const err = new Error(`Failed to update payroll item ${itemId}: ${itemUpdErr?.message || 'no row updated'}`);
    err.code = /LOCKED|immutable/i.test(itemUpdErr?.message || '') ? 'RUN_LOCKED_CONCURRENTLY' : 'ITEM_UPDATE_FAILED';
    throw err;
  }

  // Update run header summary
  await refreshRunSummary(supabase, runId);

  return {
    run_id: runId,
    item_id: itemId,
    employee_id: item.employee_id,
    before: {
      overtime_hours: item.overtime_hours,
      overtime_amount: item.overtime_amount,
      gross_pay: item.gross_pay,
      take_home_pay: item.take_home_pay,
      status: item.status,
    },
    after: {
      overtime_hours: calc.overtime_hours,
      overtime_amount: calc.overtime_amount,
      gross_pay: calc.gross_pay,
      take_home_pay: calc.take_home_pay,
      status: calc.status,
      pending_overtime_count: calc.attendance_summary.pending_overtime_count,
    },
  };
}

/**
 * Recalculate the DRAFT items of a run whose attendance snapshot is stale (attendance_dirty), or every
 * item with { all: true }. LOCKED runs are never touched. Any failure aborts and is reported; the items
 * that were already rebuilt stay consistent because each item is rebuilt atomically from authoritative reads.
 */
async function recalculateRegularPayrollRun(supabase, runId, { all = false } = {}) {
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status, payroll_type, period_start, period_end')
    .eq('id', runId)
    .single();
  if (runErr || !run) {
    const err = new Error(`Failed to read payroll run ${runId}: ${runErr?.message || 'not found'}`);
    err.code = 'RUN_READ_FAILED';
    throw err;
  }
  if (run.status !== 'DRAFT') {
    const err = new Error(`Cannot recalculate payroll run ${runId}: status is ${run.status} (only DRAFT can be recalculated)`);
    err.code = 'RUN_NOT_DRAFT';
    throw err;
  }
  const { data: items, error: itemsErr } = await fetchAllRows(() => supabase
    .from('payroll_regular_items')
    .select('id, employee_id, attendance_summary')
    .eq('payroll_run_id', runId)
    .order('id'));
  if (itemsErr) {
    const err = new Error(`Failed to read payroll items for run ${runId}: ${itemsErr.message}`);
    err.code = 'ITEMS_READ_FAILED';
    throw err;
  }

  // 1. Re-read attendance source & compute authoritative run coverage across all employeeIds
  const allEmployeeIds = [...new Set((items || []).map((i) => i.employee_id).filter(Boolean))];
  const runCoverage = await computeRunAttendanceCoverage(supabase, {
    periodStart: run.period_start,
    periodEnd: run.period_end,
    employeeIds: allEmployeeIds,
  });

  // 2. Recalculate affected/all payroll items
  const targets = (items || []).filter((i) => all || i.attendance_summary?.attendance_dirty === true);
  const recalculated = [];
  for (const it of targets) {
    const res = await recalculateSingleRegularItem(supabase, runId, it.id, {
      refreshOvertime: true,
      refreshAttendance: true,
      runCoverage,
    });
    if (res) recalculated.push(res);
  }

  // 3 & 4. Recompute and refresh run summary with the fresh coverage
  await refreshRunSummary(supabase, runId, { coverage: runCoverage });

  return { run_id: runId, recalculated_count: recalculated.length, items: recalculated };
}

/**
 * Refresh run summary after items or adjustments update.
 * If coverage is passed (from recalculateRegularPayrollRun or generateRegularPayrollDraft),
 * coverage fields are refreshed authoritatively. Otherwise, existing summary coverage is preserved.
 */
async function refreshRunSummary(supabase, runId, { coverage = null } = {}) {
  const { data: runRow, error: runSummaryErr } = await supabase
    .from('payroll_runs')
    .select('id, period_start, period_end, summary')
    .eq('id', runId)
    .single();
  if (runSummaryErr || !runRow) {
    const err = new Error(`Failed to read payroll run ${runId}: ${runSummaryErr?.message || 'not found'}`);
    err.code = 'RUN_READ_FAILED';
    throw err;
  }

  const { data: allItems, error: allItemsErr } = await fetchAllRows(() => supabase
    .from('payroll_regular_items')
    .select('employee_id, gross_pay, total_deduction, take_home_pay, status')
    .eq('payroll_run_id', runId)
    .order('id'));
  // Fail closed: an unreadable item list must not leave the run summary (totals/counts) silently stale.
  if (allItemsErr || !allItems) {
    const err = new Error(`Failed to read payroll items for run ${runId}: ${allItemsErr?.message || 'no data'}`);
    err.code = 'ITEMS_READ_FAILED';
    throw err;
  }

  let totalGross = 0;
  let totalDeduction = 0;
  let totalTakeHome = 0;
  let reviewRequiredCount = 0;
  let missingSalaryCount = 0;

  for (const it of allItems) {
    totalGross += Number(it.gross_pay || 0);
    totalDeduction += Number(it.total_deduction || 0);
    totalTakeHome += Number(it.take_home_pay || 0);
    if (it.status === 'REVIEW_REQUIRED') reviewRequiredCount++;
    if (it.status === 'MISSING_SALARY') missingSalaryCount++;
  }

  const previousSummary = runRow.summary || {};
  const missingAttendanceCount = allItems.filter(it => it.status === 'MISSING_ATTENDANCE' || it.status === 'BLOCKED_ATTENDANCE_SOURCE').length;

  const { error: summaryErr } = await supabase
    .from('payroll_runs')
    .update({
      summary: {
        ...previousSummary,
        missing_attendance_count: missingAttendanceCount,
        total_employees: allItems.length,
        total_gross_pay: totalGross,
        total_deductions: totalDeduction,
        total_take_home_pay: totalTakeHome,
        review_required_count: reviewRequiredCount,
        missing_salary_count: missingSalaryCount,
        ...(coverage ? {
          attendance_data_through: coverage.attendance_data_through,
          expected_period_end: coverage.expected_period_end,
          attendance_period_complete: coverage.attendance_period_complete,
        } : {}),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (summaryErr) throw new Error(`Failed to refresh payroll run summary: ${summaryErr.message}`);
}

/**
 * Lock regular payroll run
 */
async function lockRegularPayrollRun(supabase, { runId, userEmail = 'owner@redbox.id' }) {
  // Safety guard: Check for incomplete attendance or missing salary before locking
  const { data: blockingItems, error: blockingErr } = await supabase
    .from('payroll_regular_items')
    .select('id, employee_name_snapshot, status')
    .eq('payroll_run_id', runId)
    .in('status', ['MISSING_ATTENDANCE', 'MISSING_SALARY', 'BLOCKED_ATTENDANCE_SOURCE']);
  if (blockingErr) throw new Error(`Cannot verify payroll items: ${blockingErr.message}`);

  if (blockingItems && blockingItems.length > 0) {
    const names = blockingItems.slice(0, 3).map(b => `${b.employee_name_snapshot} (${b.status})`).join(', ');
    throw new Error(`Cannot lock payroll run: ${blockingItems.length} employee(s) have incomplete attendance or salary data (${names}). Take-home pay is not finalized.`);
  }

  // Overtime invariants (fail-fast; the lock RPC enforces the same rules and stays the authority):
  // no pending / unreviewed attendance overtime, approvals match the attendance source, and the payroll
  // snapshot equals the approved minutes (closes the approve -> lock race).
  const { data: guardRun, error: guardRunErr } = await supabase.from('payroll_runs').select('period_start, period_end, payroll_type').eq('id', runId).single();
  if (guardRunErr || !guardRun) throw new Error(`Cannot verify payroll run: ${guardRunErr?.message || 'not found'}`);
  if (guardRun && (guardRun.payroll_type === 'REGULAR' || guardRun.payroll_type === 'REGULAR_PAYROLL')) {
    const { data: runItems, error: itemsErr } = await fetchAllRows(() => supabase
      .from('payroll_regular_items')
      .select('id, employee_id, employee_name_snapshot, overtime_hours, attendance_summary, manual_bonus, debt_deduction, manual_deduction, adjustments_total')
      .eq('payroll_run_id', runId)
      .order('employee_id')
      .order('id'));
    if (itemsErr) throw new Error(`Cannot verify payroll items: ${itemsErr.message}`);
    if (!runItems || runItems.length === 0) {
      const err = new Error('Cannot lock regular payroll run: it has no payroll items');
      err.code = 'EMPTY_RUN';
      throw err;
    }
    const { data: runAdjustments, error: adjLockErr } = await fetchAllRows(() => supabase
      .from('payroll_adjustments')
      .select('id, payroll_regular_item_id, type, amount')
      .eq('payroll_run_id', runId)
      .order('id'));
    if (adjLockErr) throw new Error(`Cannot verify payroll adjustments: ${adjLockErr.message}`);
    // Attendance changed after the item was calculated (attendance_dirty): recalculate before locking.
    const staleAttendance = runItems.find((i) => i.attendance_summary?.attendance_dirty === true);
    if (staleAttendance) {
      const err = new Error(`Payroll attendance snapshot is stale for ${staleAttendance.employee_name_snapshot}. Recalculate before locking.`);
      err.code = 'ATTENDANCE_SNAPSHOT_STALE';
      throw err;
    }
    const adjViolation = evaluateAdjustmentLockInvariants({ items: runItems, adjustments: runAdjustments });
    if (adjViolation) {
      const err = new Error(adjViolation.message);
      err.code = adjViolation.code;
      throw err;
    }
    const employeeIds = [...new Set((runItems || []).map(i => i.employee_id))];
    if (employeeIds.length > 0) {
      const { data: runApprovals, error: apprErr } = await fetchAllRows(() => supabase
        .from('employee_overtime_approvals')
        .select('id, employee_id, attendance_date, raw_overtime_minutes, approved_overtime_minutes, status')
        .in('employee_id', employeeIds)
        .gte('attendance_date', guardRun.period_start)
        .lte('attendance_date', guardRun.period_end)
        .order('employee_id')
        .order('attendance_date')
        .order('id'));
      if (apprErr) throw new Error(`Cannot verify overtime approvals: ${apprErr.message}`);
      const { data: runAttendance, error: attErr } = await fetchAllRows(() => supabase
        .from('employee_attendance')
        .select('employee_id, attendance_date, overtime_minutes')
        .in('employee_id', employeeIds)
        .gt('overtime_minutes', 0)
        .gte('attendance_date', guardRun.period_start)
        .lte('attendance_date', guardRun.period_end)
        .order('employee_id')
        .order('attendance_date'));
      if (attErr) throw new Error(`Cannot verify attendance overtime: ${attErr.message}`);

      const violation = evaluateOvertimeLockInvariants({ items: runItems, approvals: runApprovals, attendanceRows: runAttendance });
      if (violation) {
        const err = new Error(violation.message);
        err.code = violation.code;
        throw err;
      }
    }
  }

  // Period guard: attendance must cover the whole payroll period before locking.
  const { data: runRow, error: runRowErr } = await supabase.from('payroll_runs').select('summary, period_end').eq('id', runId).single();
  if (runRowErr || !runRow) throw new Error(`Cannot verify payroll run: ${runRowErr?.message || 'not found'}`);
  if (runRow?.summary?.attendance_period_complete === false) {
    throw new Error(`Cannot lock payroll run: attendance data is only available through ${runRow.summary.attendance_data_through || 'unknown'} but the period ends ${runRow.period_end}. Import the final fingerprint files first.`);
  }

  // Safety guard (P1-1): Block locking if ANY item remains in REVIEW_REQUIRED
  const { data: reviewItems, error: reviewErr } = await supabase
    .from('payroll_regular_items')
    .select('id, employee_name_snapshot, status')
    .eq('payroll_run_id', runId)
    .eq('status', 'REVIEW_REQUIRED');
  if (reviewErr) throw new Error(`Cannot verify payroll items: ${reviewErr.message}`);

  if (reviewItems && reviewItems.length > 0) {
    const names = reviewItems.slice(0, 3).map(b => b.employee_name_snapshot).join(', ');
    throw new Error(`Cannot lock regular payroll: ${reviewItems.length} review-required item(s) remain (${names}). Resolve all review warnings before locking.`);
  }

  const { data, error } = await supabase.rpc('lock_payroll_run', {
    p_run_id: runId,
    p_user_email: userEmail,
  });

  if (error) {
    throw new Error(`Lock failed: ${error.message}`);
  }
  return data;
}

/**
 * Employee ids of one branch (employee branch authority, case-insensitive), read with paging.
 */
async function resolveBranchEmployeeIds(supabase, branchScope) {
  const { data, error } = await fetchAllRows(() => supabase
    .from('employees')
    .select('id, branch')
    .order('id'));
  if (error) throw new Error(`Failed to load employees: ${error.message}`);
  return (data || []).filter((e) => isEmployeeInBranchScope(e.branch, branchScope)).map((e) => e.id);
}

/**
 * List overtime approvals.
 * A branch scope is enforced IN the query (employee_id IN authorized ids) and every page is read
 * (deterministic order) - never "first 1000 rows, then filter in Node", which would hide a branch's
 * later approvals (still blocking the lock) from its manager.
 */
async function listOvertimeApprovals(supabase, { periodStart, periodEnd, employeeId = null, status = null, branchScope = null } = {}) {
  let scopedIds = null;
  if (branchScope) {
    scopedIds = await resolveBranchEmployeeIds(supabase, branchScope);
    if (scopedIds.length === 0) return [];
    if (employeeId && !scopedIds.includes(employeeId)) return [];
  }

  const { data, error } = await fetchAllRows(() => {
    let query = supabase
      .from('employee_overtime_approvals')
      .select(`
        id,
        employee_id,
        attendance_date,
        raw_overtime_minutes,
        approved_overtime_minutes,
        status,
        approved_by,
        approved_at,
        note,
        created_at,
        employees (
          id,
          name,
          nickname,
          business_unit,
          branch,
          position
        )
      `);
    if (scopedIds) query = query.in('employee_id', scopedIds);
    if (periodStart) query = query.gte('attendance_date', periodStart);
    if (periodEnd) query = query.lte('attendance_date', periodEnd);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (status && status !== 'ALL') query = query.eq('status', status);
    return query
      .order('attendance_date', { ascending: false })
      .order('employee_id')
      .order('id');
  });
  if (error) throw new Error(`Failed to list overtime approvals: ${error.message}`);
  return data || [];
}

/**
 * Re-snapshot payroll after overtime approvals changed (review or candidate sync).
 * For every (employee, date) the covering DRAFT REGULAR runs get that employee's item recalculated
 * through recalculateSingleRegularItem (engine formula reused, run summary refreshed). LOCKED runs
 * are never mutated; they are reported as anomalies so unreviewed overtime in a frozen period is visible.
 * A failure for one candidate does not hide the others: every failure is collected in `errors`
 * (`error` / `reason` keep the first one for callers that only need a summary).
 */
async function propagateOvertimeToDraftRuns(supabase, candidates = []) {
  const result = { updated: [], locked_run_anomalies: [], errors: [], error: null, reason: null };
  const done = new Set();
  for (const c of candidates) {
    try {
      const { data: runs, error: runsErr } = await supabase
        .from('payroll_runs')
        .select('id, status')
        .eq('payroll_type', 'REGULAR')
        .in('status', ['DRAFT', 'LOCKED'])
        .lte('period_start', c.attendance_date)
        .gte('period_end', c.attendance_date);
      if (runsErr) throw new Error(runsErr.message);

      for (const run of runs || []) {
        if (run.status === 'LOCKED') {
          result.locked_run_anomalies.push({
            run_id: run.id,
            employee_id: c.employee_id,
            attendance_date: c.attendance_date,
            reason: 'Overtime exists in the period of a LOCKED payroll run; the locked snapshot was not changed.',
          });
          continue;
        }
        const key = `${run.id}|${c.employee_id}`;
        if (done.has(key)) continue; // one recalculation per run+employee covers every date
        done.add(key);
        const { data: items, error: itemsReadErr } = await supabase
          .from('payroll_regular_items')
          .select('id')
          .eq('payroll_run_id', run.id)
          .eq('employee_id', c.employee_id);
        if (itemsReadErr) {
          const err = new Error(`Failed to read payroll items for run ${run.id}: ${itemsReadErr.message}`);
          err.code = 'ITEMS_READ_FAILED';
          throw err;
        }
        for (const it of items || []) {
          const res = await recalculateSingleRegularItem(supabase, run.id, it.id, { refreshOvertime: true });
          if (res) result.updated.push(res);
        }
      }
    } catch (err) {
      // Approval rows are already saved; surface the failure instead of hiding a stale draft.
      console.error('[RegularPayrollService] overtime recalculation failed:', err.message);
      result.errors.push({
        employee_id: c.employee_id,
        attendance_date: c.attendance_date,
        message: err.message,
        reason: err.code || 'RECALCULATION_FAILED',
      });
    }
  }
  if (result.errors.length > 0) {
    result.error = result.errors[0].message;
    result.reason = result.errors[0].reason;
  }
  return result;
}

/**
 * Review (approve / reject / reset) an overtime approval.
 * The raw minutes are refreshed from the CURRENT attendance source so a decision is always made against
 * the source as it is now; approving overtime the attendance no longer reports is refused.
 * branchScope: null = unrestricted (owner), otherwise the employee must belong to that branch.
 */
async function reviewOvertimeApproval(supabase, { approvalId, status, approvedMinutes, note, userEmail = 'manager@redbox.id', branchScope = null }) {
  if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    throw new Error(`Invalid approval status: ${status}`);
  }

  const { data: existing, error: getErr } = await supabase
    .from('employee_overtime_approvals')
    .select('*')
    .eq('id', approvalId)
    .single();

  if (getErr || !existing) throw new Error(`Overtime approval ${approvalId} not found`);

  if (branchScope) {
    const { data: emp } = await supabase.from('employees').select('id, branch').eq('id', existing.employee_id).single();
    if (!emp || !isEmployeeInBranchScope(emp.branch, branchScope)) throw branchForbiddenError();
  }

  const { data: attRow, error: attErr } = await supabase
    .from('employee_attendance')
    .select('overtime_minutes')
    .eq('employee_id', existing.employee_id)
    .eq('attendance_date', existing.attendance_date)
    .maybeSingle();
  if (attErr) throw new Error(`Failed to read attendance overtime: ${attErr.message}`);
  const sourceMinutes = Number(attRow?.overtime_minutes || 0);

  if (status === 'APPROVED' && sourceMinutes <= 0) {
    const err = new Error('Presensi tidak lagi melaporkan lembur pada tanggal ini, sehingga tidak dapat disetujui. Tolak atau kembalikan ke PENDING.');
    err.code = 'OVERTIME_SOURCE_MISSING';
    throw err;
  }

  // Validate BEFORE any write: negative / NaN / Infinity / non-numeric approved minutes would create
  // negative (or absurd) overtime pay that the lock invariants would then consider consistent.
  const requestedMinutes = status === 'APPROVED' && approvedMinutes !== undefined
    ? parseNonNegativeMinutes(approvedMinutes)
    : undefined;

  const updates = {
    status,
    raw_overtime_minutes: sourceMinutes,
    note: note ? String(note).trim() : existing.note,
    updated_at: new Date().toISOString(),
  };

  if (status === 'APPROVED') {
    updates.approved_overtime_minutes = requestedMinutes !== undefined ? requestedMinutes : sourceMinutes;
    updates.approved_by = userEmail;
    updates.approved_at = new Date().toISOString();
  } else if (status === 'REJECTED') {
    updates.approved_overtime_minutes = 0;
    updates.approved_by = userEmail;
    updates.approved_at = new Date().toISOString();
  } else {
    // PENDING
    updates.approved_overtime_minutes = 0;
    updates.approved_by = null;
    updates.approved_at = null;
  }

  const { data: updated, error: updErr } = await supabase
    .from('employee_overtime_approvals')
    .update(updates)
    .eq('id', approvalId)
    .select()
    .single();

  if (updErr) {
    // The database trigger refuses approval writes for a LOCKED run (serialized with lock_payroll_run()).
    const err = new Error(`Failed to update overtime approval: ${updErr.message}`);
    err.code = /LOCKED/i.test(updErr.message || '') ? 'RUN_LOCKED' : 'APPROVAL_UPDATE_FAILED';
    throw err;
  }

  // Propagate the review into every affected DRAFT regular payroll run (LOCKED runs untouched).
  const recalculation = await propagateOvertimeToDraftRuns(supabase, [
    { employee_id: updated.employee_id, attendance_date: updated.attendance_date },
  ]);

  // The approval row is committed regardless; report honestly whether the payroll snapshot followed.
  const recalculationSuccess = !recalculation.error;
  return {
    success: recalculationSuccess,
    approval_saved: true,
    recalculation_success: recalculationSuccess,
    approval: updated,
    recalculation,
  };
}

/**
 * Sync overtime: reconcile attendance overtime <-> approvals for the period (see
 * reconcileOvertimeForPeriod) and re-snapshot every affected DRAFT payroll item.
 * branchScope restricts the sync to employees of that branch (manager); null = all (owner).
 * success is TRUE only when every step succeeded; any failed insert / update / delete / recalculation
 * sets success=false (partial_success tells whether some changes did apply) so operators are never told
 * that a sync worked when unsynchronized overtime remains.
 */
async function syncOvertimeCandidates(supabase, { periodStart, periodEnd, branchScope = null } = {}) {
  let employeeIds = null;
  if (branchScope) {
    employeeIds = await resolveBranchEmployeeIds(supabase, branchScope);
  }

  const reconciliation = await reconcileOvertimeForPeriod(supabase, { periodStart, periodEnd, employeeIds });

  // Draft snapshots must follow every change (READY -> REVIEW_REQUIRED, warnings, summary).
  const recalculation = await propagateOvertimeToDraftRuns(supabase, reconciliation.touched);

  const failures =
    reconciliation.insert_errors.length +
    reconciliation.update_errors.length +
    reconciliation.delete_errors.length +
    recalculation.errors.length;
  const applied =
    reconciliation.created.length +
    reconciliation.raw_refreshed.length +
    reconciliation.invalidated.length +
    recalculation.updated.length;

  return {
    success: failures === 0,
    partial_success: failures > 0 && applied > 0,
    candidates_found: reconciliation.attendance_rows,
    newly_created: reconciliation.created.length,
    insert_errors: reconciliation.insert_errors,
    update_errors: reconciliation.update_errors,
    delete_errors: reconciliation.delete_errors,
    recalculation_errors: recalculation.errors,
    raw_refreshed: reconciliation.raw_refreshed,
    invalidated_pending: reconciliation.invalidated,
    decision_discrepancies: reconciliation.decision_discrepancies,
    locked_run_anomalies: [...reconciliation.locked_run_anomalies, ...recalculation.locked_run_anomalies],
    recalculation,
  };
}

module.exports = {
  listRegularPayrollRuns,
  generateRegularPayrollDraft,
  getRegularPayrollRunDetail,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  lockRegularPayrollRun,
  recalculateSingleRegularItem,
  recalculateRegularPayrollRun,
  fetchEmployeeAttendanceSummaries,
  listOvertimeApprovals,
  reviewOvertimeApproval,
  syncOvertimeCandidates,
  reconcileOvertimeForPeriod,
  evaluateOvertimeLockInvariants,
  evaluateAdjustmentLockInvariants,
  summarizeOvertimeState,
  isEmployeeInBranchScope,
  parseNonNegativeMinutes,
  computeRunAttendanceCoverage,
};
