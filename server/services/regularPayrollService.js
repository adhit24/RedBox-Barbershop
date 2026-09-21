'use strict';

/**
 * REDBOX COMMAND CENTER — Regular Payroll Service
 * Handles regular salaried payroll runs, attendance integration,
 * item snapshots, manual adjustments, and locking.
 */

const { calculateRegularPayrollItem, REGULAR_ITEM_STATUS, SOURCE_ORIGIN } = require('./regularPayrollEngine');
const { getPolicyForUnit, roundRupiah } = require('./regularPayrollPolicy');

/**
 * List regular payroll runs
 */
async function listRegularPayrollRuns(supabase, { status = null, businessUnit = null } = {}) {
  let query = supabase
    .from('payroll_runs')
    .select('*')
    .eq('payroll_type', 'REGULAR')
    .order('period_start', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }
  if (businessUnit && businessUnit !== 'ALL') {
    query = query.eq('business_unit', businessUnit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list regular payroll runs: ${error.message}`);
  }
  return data || [];
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

function inclusiveDayCount(from, to) {
  if (!from || !to || to < from) return 0;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}

/**
 * Fetch attendance summary for a list of employees over a date range
 */
async function fetchEmployeeAttendanceSummaries(supabase, employeeIds = [], periodStart, periodEnd, employeeMap = new Map()) {
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

  if (attError) {
    console.warn('[RegularPayrollService] Warning querying employee_attendance:', attError.message);
  } else {
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
      }
    }
  }

  // 2. Query employee_overtime_approvals (ONLY approved overtime counts towards payroll)
  try {
    const { data: otApprovals, error: otErr } = await supabase
      .from('employee_overtime_approvals')
      .select('employee_id, attendance_date, raw_overtime_minutes, approved_overtime_minutes, status')
      .in('employee_id', employeeIds)
      .gte('attendance_date', periodStart)
      .lte('attendance_date', periodEnd);

    if (!otErr && otApprovals) {
      for (const ot of otApprovals) {
        const s = summaryMap.get(ot.employee_id);
        if (!s) continue;
        if (ot.status === 'APPROVED') {
          s.approved_overtime_minutes += Number(ot.approved_overtime_minutes || 0);
        } else if (ot.status === 'PENDING') {
          s.pending_overtime_count++;
        }
      }
    }
  } catch (err) {
    console.warn('[RegularPayrollService] Warning querying employee_overtime_approvals:', err.message);
  }

  // 3. Query unresolved attendance_exceptions
  try {
    const { data: excRows, error: excError } = await fetchAllRows(() => supabase
      .from('attendance_exceptions')
      .select('raw_data, status, attendance_date')
      .eq('status', 'pending')
      .gte('attendance_date', periodStart)
      .lte('attendance_date', periodEnd)
      .order('attendance_date')
      .order('id'));

    if (!excError && excRows) {
      for (const exc of excRows) {
        const empId = exc.raw_data?.employee_id;
        if (empId && summaryMap.has(empId)) {
          summaryMap.get(empId).unresolved_exceptions_count++;
        }
      }
    }
  } catch (err) {
    console.warn('[RegularPayrollService] Warning querying attendance_exceptions:', err.message);
  }

  // 4. Finalize metrics per employee
  // The attendance source only covers up to the last day it has data; days after that
  // are "not yet available", never "absent".
  let dataThrough = null;
  for (const s of summaryMap.values()) {
    if (s.max_date && (!dataThrough || s.max_date > dataThrough)) dataThrough = s.max_date;
  }
  const periodComplete = !!dataThrough && dataThrough >= periodEnd;

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

  // 1. Check for overlapping locked runs
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

  const lockedConflict = (existingRuns || []).find(r => r.status === 'LOCKED');
  if (lockedConflict) {
    throw new Error(`Cannot generate payroll draft: overlapping LOCKED run found (${lockedConflict.id} from ${lockedConflict.period_start} to ${lockedConflict.period_end})`);
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
  const attendanceMap = await fetchEmployeeAttendanceSummaries(supabase, employeeIds, periodStart, periodEnd, employeeMap);

  // 4. Calculate items
  let attendanceDataThrough = null;
  for (const a of attendanceMap.values()) {
    if (a.attendance_data_through) { attendanceDataThrough = a.attendance_data_through; break; }
  }
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

  const { data: run, error: runInsertErr } = await supabase
    .from('payroll_runs')
    .insert({
      payroll_type: 'REGULAR',
      business_unit: businessUnit,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'DRAFT',
      generated_by: userEmail,
      calculation_version: 'regular-v1.0',
      summary: summaryPayload,
    })
    .select()
    .single();

  if (runInsertErr) {
    throw new Error(`Failed to create payroll run header: ${runInsertErr.message}`);
  }

  // 6. Insert items into payroll_regular_items
  const itemsToInsert = calculatedItems.map(item => ({
    payroll_run_id: run.id,
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

  const { error: itemsInsertErr } = await supabase
    .from('payroll_regular_items')
    .insert(itemsToInsert);

  if (itemsInsertErr) {
    // Cleanup run header on failure
    await supabase.from('payroll_runs').delete().eq('id', run.id);
    throw new Error(`Failed to insert regular payroll items: ${itemsInsertErr.message}`);
  }

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
async function getRegularPayrollRunDetail(supabase, { runId, filters = {} }) {
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

  let itemsQuery = supabase
    .from('payroll_regular_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('employee_name_snapshot');

  if (filters.status && filters.status !== 'all') {
    itemsQuery = itemsQuery.eq('status', filters.status);
  }
  if (filters.business_unit && filters.business_unit !== 'all') {
    itemsQuery = itemsQuery.eq('business_unit_snapshot', filters.business_unit);
  }

  const { data: items, error: itemsErr } = await itemsQuery;
  if (itemsErr) {
    throw new Error(`Failed to load payroll regular items: ${itemsErr.message}`);
  }

  // Fetch adjustments for this run
  const { data: adjustments, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('created_at', { ascending: true });

  const adjMap = new Map();
  for (const adj of adjustments || []) {
    const itemId = adj.payroll_regular_item_id;
    if (!adjMap.has(itemId)) adjMap.set(itemId, []);
    adjMap.get(itemId).push(adj);
  }

  const enrichedItems = (items || []).map(item => ({
    ...item,
    adjustments: adjMap.get(item.id) || [],
  }));

  return {
    run,
    items: enrichedItems,
  };
}

/**
 * Add manual adjustment to regular employee item
 */
async function addRegularPayrollAdjustment(supabase, {
  runId,
  payrollRegularItemId,
  employeeId,
  type = 'OTHER',
  amount,
  reason,
  note = null,
  userEmail = 'owner@redbox.id',
}) {
  if (!amount || amount === 0) throw new Error('Adjustment amount cannot be zero');
  if (!reason || !reason.trim()) throw new Error('Reason is required for manual adjustment');

  // Verify run is DRAFT
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);
  if (run.status === 'LOCKED') throw new Error('Cannot add adjustment: payroll run is LOCKED');

  // Insert adjustment
  const { data: adj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .insert({
      payroll_run_id: runId,
      payroll_regular_item_id: payrollRegularItemId,
      employee_id: employeeId,
      type: type.toUpperCase().trim(),
      amount: roundRupiah(amount),
      reason: reason.trim(),
      note: note ? note.trim() : null,
      created_by: userEmail,
    })
    .select()
    .single();

  if (adjErr) throw new Error(`Failed to insert adjustment: ${adjErr.message}`);

  // Recalculate employee item
  await recalculateSingleRegularItem(supabase, runId, payrollRegularItemId);

  return { success: true, adjustment: adj };
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

  // Recalculate item
  await recalculateSingleRegularItem(supabase, adj.payroll_run_id, adj.payroll_regular_item_id);

  return { success: true, deleted_id: adjustmentId };
}

/**
 * Helper to recalculate a single regular item in draft after adjustments change
 */
async function recalculateSingleRegularItem(supabase, runId, itemId, { refreshOvertime = false } = {}) {
  // Fetch item
  const { data: item } = await supabase
    .from('payroll_regular_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (!item) return;
  if (item.status === 'LOCKED') return null; // never touch frozen items

  // Overtime review changes employee_overtime_approvals only; re-read it so the snapshot
  // (hours, pending count) reflects the current approvals for this run's period.
  let attendanceSummary = item.attendance_summary;
  let approvedOvertimeHours = item.overtime_hours;
  if (refreshOvertime) {
    const { data: run } = await supabase
      .from('payroll_runs')
      .select('period_start, period_end')
      .eq('id', runId)
      .single();
    const { data: otRows } = await supabase
      .from('employee_overtime_approvals')
      .select('attendance_date, approved_overtime_minutes, status')
      .eq('employee_id', item.employee_id)
      .gte('attendance_date', run.period_start)
      .lte('attendance_date', run.period_end);
    let approvedMinutes = 0;
    let pendingCount = 0;
    for (const ot of otRows || []) {
      if (ot.status === 'APPROVED') approvedMinutes += Number(ot.approved_overtime_minutes || 0);
      else if (ot.status === 'PENDING') pendingCount++;
    }
    approvedOvertimeHours = Math.round((approvedMinutes / 60) * 10) / 10;
    attendanceSummary = {
      ...(item.attendance_summary || {}),
      approved_overtime_minutes: approvedMinutes,
      pending_overtime_count: pendingCount,
      overtime_hours: approvedOvertimeHours,
    };
  }

  // Fetch all adjustments for this item
  const { data: adjs } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_regular_item_id', itemId);

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
      meal_allowance_days: item.meal_allowance_days,
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
    lateDeductionOverride: item.late_deduction,
    adjustments: adjs || [],
  });

  // Update item in database. A rejected write (e.g. the run was LOCKED concurrently and the
  // immutability trigger fired) must surface as an error, never as a successful recalculation.
  const { data: updatedItem, error: itemUpdErr } = await supabase
    .from('payroll_regular_items')
    .update({
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
 * Refresh run summary after items or adjustments update
 */
async function refreshRunSummary(supabase, runId) {
  const { data: allItems } = await supabase
    .from('payroll_regular_items')
    .select('gross_pay, total_deduction, take_home_pay, status')
    .eq('payroll_run_id', runId);

  if (!allItems) return;

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

  let previousSummary = {};
  try {
    const { data: runRow } = await supabase.from('payroll_runs').select('summary').eq('id', runId).single();
    previousSummary = runRow?.summary || {};
  } catch (_) { /* keep defaults */ }
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
  const { data: blockingItems } = await supabase
    .from('payroll_regular_items')
    .select('id, employee_name_snapshot, status')
    .eq('payroll_run_id', runId)
    .in('status', ['MISSING_ATTENDANCE', 'MISSING_SALARY', 'BLOCKED_ATTENDANCE_SOURCE']);

  if (blockingItems && blockingItems.length > 0) {
    const names = blockingItems.slice(0, 3).map(b => `${b.employee_name_snapshot} (${b.status})`).join(', ');
    throw new Error(`Cannot lock payroll run: ${blockingItems.length} employee(s) have incomplete attendance or salary data (${names}). Take-home pay is not finalized.`);
  }

  // Pending overtime guard (fail-fast; the lock RPC enforces the same rule): every overtime candidate
  // of an employee in this run and period must be approved or rejected before finalizing.
  const { data: guardRun } = await supabase.from('payroll_runs').select('period_start, period_end, payroll_type').eq('id', runId).single();
  if (guardRun && (guardRun.payroll_type === 'REGULAR' || guardRun.payroll_type === 'REGULAR_PAYROLL')) {
    const { data: runItems } = await fetchAllRows(() => supabase
      .from('payroll_regular_items')
      .select('employee_id')
      .eq('payroll_run_id', runId)
      .order('employee_id'));
    const employeeIds = [...new Set((runItems || []).map(i => i.employee_id))];
    if (employeeIds.length > 0) {
      const { data: pendingOt, error: pendingErr } = await fetchAllRows(() => supabase
        .from('employee_overtime_approvals')
        .select('id')
        .in('employee_id', employeeIds)
        .eq('status', 'PENDING')
        .gte('attendance_date', guardRun.period_start)
        .lte('attendance_date', guardRun.period_end)
        .order('id'));
      if (pendingErr) throw new Error(`Cannot verify pending overtime approvals: ${pendingErr.message}`);
      if ((pendingOt || []).length > 0) {
        throw new Error(`Cannot lock regular payroll: ${pendingOt.length} pending overtime approval(s) remain. Approve or reject them first.`);
      }
    }
  }

  // Period guard: attendance must cover the whole payroll period before locking.
  const { data: runRow } = await supabase.from('payroll_runs').select('summary, period_end').eq('id', runId).single();
  if (runRow?.summary?.attendance_period_complete === false) {
    throw new Error(`Cannot lock payroll run: attendance data is only available through ${runRow.summary.attendance_data_through || 'unknown'} but the period ends ${runRow.period_end}. Import the final fingerprint files first.`);
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
 * List overtime approvals
 */
async function listOvertimeApprovals(supabase, { periodStart, periodEnd, employeeId = null, status = null } = {}) {
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
    `)
    .order('attendance_date', { ascending: false });

  if (periodStart) query = query.gte('attendance_date', periodStart);
  if (periodEnd) query = query.lte('attendance_date', periodEnd);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (status && status !== 'ALL') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list overtime approvals: ${error.message}`);
  return data || [];
}

/**
 * Re-snapshot payroll after overtime approvals changed (review or candidate sync).
 * For every (employee, date) the covering DRAFT REGULAR runs get that employee's item recalculated
 * through recalculateSingleRegularItem (engine formula reused, run summary refreshed). LOCKED runs
 * are never mutated; they are reported as anomalies so unreviewed overtime in a frozen period is visible.
 */
async function propagateOvertimeToDraftRuns(supabase, candidates = []) {
  const result = { updated: [], locked_run_anomalies: [], error: null };
  const done = new Set();
  try {
    for (const c of candidates) {
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
        const { data: items } = await supabase
          .from('payroll_regular_items')
          .select('id')
          .eq('payroll_run_id', run.id)
          .eq('employee_id', c.employee_id);
        for (const it of items || []) {
          const res = await recalculateSingleRegularItem(supabase, run.id, it.id, { refreshOvertime: true });
          if (res) result.updated.push(res);
        }
      }
    }
  } catch (err) {
    // Approval rows are already saved; surface the failure instead of hiding a stale draft.
    console.error('[RegularPayrollService] overtime recalculation failed:', err.message);
    result.error = err.message;
    result.reason = err.code || 'RECALCULATION_FAILED';
  }
  return result;
}

/**
 * Review overtime approval (Owner or Manager only)
 */
async function reviewOvertimeApproval(supabase, { approvalId, status, approvedMinutes, note, userEmail = 'manager@redbox.id' }) {
  if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    throw new Error(`Invalid approval status: ${status}`);
  }

  const { data: existing, error: getErr } = await supabase
    .from('employee_overtime_approvals')
    .select('*')
    .eq('id', approvalId)
    .single();

  if (getErr || !existing) throw new Error(`Overtime approval ${approvalId} not found`);

  const updates = {
    status,
    note: note ? String(note).trim() : existing.note,
    updated_at: new Date().toISOString(),
  };

  if (status === 'APPROVED') {
    updates.approved_overtime_minutes = approvedMinutes !== undefined ? Number(approvedMinutes) : Number(existing.raw_overtime_minutes || 0);
    updates.approved_by = userEmail;
    updates.approved_at = new Date().toISOString();
  } else if (status === 'REJECTED') {
    updates.approved_overtime_minutes = 0;
    updates.approved_by = userEmail;
    updates.approved_at = new Date().toISOString();
  } else {
    // PENDING
    updates.approved_by = null;
    updates.approved_at = null;
  }

  const { data: updated, error: updErr } = await supabase
    .from('employee_overtime_approvals')
    .update(updates)
    .eq('id', approvalId)
    .select()
    .single();

  if (updErr) throw new Error(`Failed to update overtime approval: ${updErr.message}`);

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
 * Sync candidate overtime from employee_attendance into employee_overtime_approvals
 */
async function syncOvertimeCandidates(supabase, { periodStart, periodEnd } = {}) {
  const { data: rawRows, error } = await fetchAllRows(() => {
    let query = supabase
      .from('employee_attendance')
      .select('employee_id, attendance_date, overtime_minutes')
      .gt('overtime_minutes', 0);
    if (periodStart) query = query.gte('attendance_date', periodStart);
    if (periodEnd) query = query.lte('attendance_date', periodEnd);
    return query.order('employee_id').order('attendance_date');
  });
  if (error) throw new Error(`Failed to query attendance overtime: ${error.message}`);

  let createdCount = 0;
  const insertErrors = [];
  const rawRefreshed = [];
  const decisionDiscrepancies = [];
  const pendingCandidates = [];
  for (const row of rawRows || []) {
    const { data: existing } = await supabase
      .from('employee_overtime_approvals')
      .select('id, status, raw_overtime_minutes')
      .eq('employee_id', row.employee_id)
      .eq('attendance_date', row.attendance_date)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabase
        .from('employee_overtime_approvals')
        .insert({
          employee_id: row.employee_id,
          attendance_date: row.attendance_date,
          raw_overtime_minutes: row.overtime_minutes,
          approved_overtime_minutes: 0,
          status: 'PENDING',
        });
      if (insErr) {
        insertErrors.push({ employee_id: row.employee_id, attendance_date: row.attendance_date, error: insErr.message });
        continue;
      }
      createdCount++;
      pendingCandidates.push({ employee_id: row.employee_id, attendance_date: row.attendance_date });
    } else if (existing.status === 'PENDING') {
      // Still undecided: keep the raw value in step with attendance so the manager never reviews a
      // stale duration, and re-snapshot the draft (idempotent).
      const previousRaw = Number(existing.raw_overtime_minutes);
      if (previousRaw !== Number(row.overtime_minutes)) {
        const { error: rawErr } = await supabase
          .from('employee_overtime_approvals')
          .update({ raw_overtime_minutes: row.overtime_minutes, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (rawErr) {
          insertErrors.push({ employee_id: row.employee_id, attendance_date: row.attendance_date, error: rawErr.message });
        } else {
          rawRefreshed.push({ approval_id: existing.id, from: previousRaw, to: Number(row.overtime_minutes) });
        }
      }
      pendingCandidates.push({ employee_id: row.employee_id, attendance_date: row.attendance_date });
    } else if (Number(existing.raw_overtime_minutes) !== Number(row.overtime_minutes)) {
      // APPROVED / REJECTED are human decisions: never changed by a resync, only reported.
      decisionDiscrepancies.push({
        approval_id: existing.id,
        status: existing.status,
        decided_against_raw_minutes: Number(existing.raw_overtime_minutes),
        attendance_overtime_minutes: Number(row.overtime_minutes),
      });
    }
  }

  // Draft snapshots must reflect the pending candidates (READY -> REVIEW_REQUIRED, warning, summary).
  const recalculation = await propagateOvertimeToDraftRuns(supabase, pendingCandidates);

  return {
    success: true,
    candidates_found: (rawRows || []).length,
    newly_created: createdCount,
    insert_errors: insertErrors,
    raw_refreshed: rawRefreshed,
    decision_discrepancies: decisionDiscrepancies,
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
  fetchEmployeeAttendanceSummaries,
  listOvertimeApprovals,
  reviewOvertimeApproval,
  syncOvertimeCandidates,
};
