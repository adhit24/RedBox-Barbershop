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
 * Fetch attendance summary for a list of employees over a date range
 */
async function fetchEmployeeAttendanceSummaries(supabase, employeeIds = [], periodStart, periodEnd) {
  const summaryMap = new Map();
  for (const empId of employeeIds) {
    summaryMap.set(empId, {
      present_days: 0,
      absent_days: 0,
      late_count: 0,
      late_minutes: 0,
      overtime_hours: 0,
      incomplete_attendance: 0,
      records_count: 0,
      unresolved_exceptions_count: 0,
    });
  }

  if (!employeeIds.length || !periodStart || !periodEnd) return summaryMap;

  // 1. Query employee_attendance
  const { data: attendanceRows, error: attError } = await supabase
    .from('employee_attendance')
    .select('employee_id, attendance_date, status, late_minutes, overtime_minutes, first_check_in, last_check_out')
    .in('employee_id', employeeIds)
    .gte('attendance_date', periodStart)
    .lte('attendance_date', periodEnd);

  if (attError) {
    console.warn('[RegularPayrollService] Warning querying employee_attendance:', attError.message);
  } else {
    for (const row of attendanceRows || []) {
      const s = summaryMap.get(row.employee_id);
      if (!s) continue;
      s.records_count++;

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
      } else if (st === 'izin' || st === 'sakit' || st === 'cuti') {
        // Scheduled leave/permission
      } else {
        s.records_count++;
      }

      // Check missing punch
      if ((!row.first_check_in || !row.last_check_out) && st !== 'off' && st !== 'absent') {
        s.incomplete_attendance++;
      }

      // Overtime minutes
      if (row.overtime_minutes > 0) {
        s.overtime_hours += Number(row.overtime_minutes) / 60;
      }
    }
  }

  // 2. Query unresolved attendance_exceptions
  try {
    const { data: excRows, error: excError } = await supabase
      .from('attendance_exceptions')
      .select('raw_data, status, attendance_date')
      .eq('status', 'pending')
      .gte('attendance_date', periodStart)
      .lte('attendance_date', periodEnd);

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

  // Round overtime hours to 1 decimal place
  for (const s of summaryMap.values()) {
    s.overtime_hours = Math.round(s.overtime_hours * 10) / 10;
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
    .select('id, name, nickname, business_unit, branch, branch_name, position, base_salary, position_allowance, meal_allowance_rate, is_active')
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
  const attendanceMap = await fetchEmployeeAttendanceSummaries(supabase, employeeIds, periodStart, periodEnd);

  // 4. Calculate items
  const calculatedItems = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalTakeHome = 0;
  let reviewRequiredCount = 0;
  let missingSalaryCount = 0;

  for (const emp of employees) {
    const attSummary = attendanceMap.get(emp.id) || {
      present_days: 0,
      absent_days: 0,
      late_count: 0,
      late_minutes: 0,
      overtime_hours: 0,
      incomplete_attendance: 0,
      records_count: 0,
      unresolved_exceptions_count: 0,
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
async function recalculateSingleRegularItem(supabase, runId, itemId) {
  // Fetch item
  const { data: item } = await supabase
    .from('payroll_regular_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (!item) return;

  // Fetch employee master
  const { data: emp } = await supabase
    .from('employees')
    .select('*')
    .eq('id', item.employee_id)
    .single();

  // Fetch all adjustments for this item
  const { data: adjs } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_regular_item_id', itemId);

  const calc = calculateRegularPayrollItem({
    employee: emp || {
      id: item.employee_id,
      name: item.employee_name_snapshot,
      business_unit: item.business_unit_snapshot,
      position: item.position_snapshot,
      base_salary: item.base_salary,
    },
    attendanceSummary: item.attendance_summary,
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
      approved_overtime_hours: item.overtime_hours,
    },
    lateDeductionOverride: item.late_deduction,
    adjustments: adjs || [],
  });

  // Update item in database
  await supabase
    .from('payroll_regular_items')
    .update({
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
    .eq('id', itemId);

  // Update run header summary
  await refreshRunSummary(supabase, runId);
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

  await supabase
    .from('payroll_runs')
    .update({
      summary: {
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
}

/**
 * Lock regular payroll run
 */
async function lockRegularPayrollRun(supabase, { runId, userEmail = 'owner@redbox.id' }) {
  const { data, error } = await supabase.rpc('lock_payroll_run', {
    p_run_id: runId,
    p_user_email: userEmail,
  });

  if (error) {
    throw new Error(`Lock failed: ${error.message}`);
  }
  return data;
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
};
