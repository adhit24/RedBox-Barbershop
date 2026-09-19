'use strict';

/**
 * Pure Calculation Engine for Regular Salaried Payroll (Redbox & Sundaze)
 *
 * Requirements:
 *   - Pure function: No DB calls.
 *   - Accurate whole Rupiah rounding (no floating artifacts).
 *   - Traceable component breakdown.
 *   - Clear statuses: READY, REVIEW_REQUIRED, MISSING_SALARY, MISSING_ATTENDANCE.
 */

const { getPolicyForUnit, roundRupiah } = require('./regularPayrollPolicy');

const REGULAR_ITEM_STATUS = Object.freeze({
  READY: 'READY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  MISSING_SALARY: 'MISSING_SALARY',
  MISSING_ATTENDANCE: 'MISSING_ATTENDANCE',
  BLOCKED_ATTENDANCE_SOURCE: 'BLOCKED_ATTENDANCE_SOURCE',
  LOCKED: 'LOCKED',
});

const SOURCE_ORIGIN = Object.freeze({
  MASTER_DATA: 'MASTER_DATA',
  ATTENDANCE: 'ATTENDANCE',
  POLICY: 'POLICY',
  MOKA: 'MOKA',
  MANUAL: 'MANUAL',
  POLICY_PENDING: 'POLICY_PENDING',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
  ATTENDANCE_AND_MASTER: 'ATTENDANCE + MASTER_SALARY',
  ATTENDANCE_POLICY: 'ATTENDANCE + POLICY',
});

/**
 * Calculate single regular payroll item
 *
 * @param {Object} params
 * @param {Object} params.employee
 * @param {Object} params.period - { period_start, period_end }
 * @param {Object} [params.policy]
 * @param {Object} [params.attendanceSummary]
 * @param {Object} [params.allowances]
 * @param {Object} [params.variables]
 * @param {number} [params.lateDeductionOverride]
 * @param {Array}  [params.adjustments]
 * @returns {Object} Calculated payroll item result
 */
function calculateRegularPayrollItem({
  employee = {},
  period = {},
  policy: customPolicy = null,
  attendanceSummary = {},
  allowances = {},
  variables = {},
  lateDeductionOverride,
  adjustments = [],
}) {
  const warnings = [];
  const unit = employee.business_unit || 'Redbox';
  const policy = customPolicy || getPolicyForUnit(unit);

  // 1. Base Salary & Daily Salary
  const rawBaseSalary = employee.base_salary;
  const baseSalary = roundRupiah(rawBaseSalary);
  const salaryDivisor = policy.salaryDivisor || 30;
  const dailySalary = salaryDivisor > 0 ? baseSalary / salaryDivisor : 0;

  if (!rawBaseSalary || baseSalary <= 0) {
    warnings.push('Gaji pokok belum terisi pada master data karyawan.');
  }

  // 2. Attendance & Work Days
  const workDays = Number(attendanceSummary.present_days ?? attendanceSummary.work_days ?? 0);
  const absentDays = Number(attendanceSummary.absent_days ?? 0);
  const lateCount = Number(attendanceSummary.late_count ?? 0);
  const lateMinutes = Number(attendanceSummary.late_minutes ?? 0);
  const incompleteCount = Number(attendanceSummary.incomplete_attendance ?? 0);
  const exceptionCount = Number(attendanceSummary.unresolved_exceptions_count ?? 0);

  if (incompleteCount > 0) {
    warnings.push(`Terdapat ${incompleteCount} presensi belum lengkap (incomplete/missing punch).`);
  }
  if (exceptionCount > 0) {
    warnings.push(`Terdapat ${exceptionCount} anomali absensi yang belum diselesaikan.`);
  }

  // Work days calculation: actual_salary = work_days * daily_salary
  const actualSalary = roundRupiah(workDays * dailySalary);

  // 3. Meal Allowance
  // meal_allowance_days can be explicitly overridden; defaults to present workDays
  const mealDays = allowances.meal_allowance_days !== undefined
    ? Number(allowances.meal_allowance_days)
    : workDays;

  // Meal rate authority: explicit allowances -> employee master -> policy default by position -> 0
  let mealRate = 0;
  if (allowances.meal_allowance_rate !== undefined) {
    mealRate = roundRupiah(allowances.meal_allowance_rate);
  } else if (employee.meal_allowance_rate !== undefined && employee.meal_allowance_rate !== null) {
    mealRate = roundRupiah(employee.meal_allowance_rate);
  } else if (policy.defaultMealRatesByPosition && employee.position) {
    mealRate = roundRupiah(policy.defaultMealRatesByPosition[employee.position] || policy.defaultMealRatesByPosition['-'] || 0);
  }

  const mealAllowanceTotal = roundRupiah(mealDays * mealRate);

  // 4. Position Allowance
  const positionAllowance = roundRupiah(
    allowances.position_allowance !== undefined
      ? allowances.position_allowance
      : (employee.position_allowance || 0)
  );

  // 5. Attendance Allowance (Rule 12: Source is MANUAL / POLICY_PENDING)
  const attendanceAllowance = roundRupiah(allowances.attendance_allowance || 0);
  const attendanceAllowanceSource = allowances.attendance_allowance_source || SOURCE_ORIGIN.POLICY_PENDING;

  // 6. Overtime
  const approvedOvertimeHours = Number(
    variables.approved_overtime_hours !== undefined
      ? variables.approved_overtime_hours
      : (attendanceSummary.overtime_hours || 0)
  );
  const overtimeRate = policy.overtimeRate || 7500;
  const overtimeAmount = roundRupiah(approvedOvertimeHours * overtimeRate);

  // 7. Product Commission & Service Barber (Rule 15 & 16)
  const productCommission = roundRupiah(variables.product_commission || 0);
  const productCommissionSource = variables.product_commission_source || SOURCE_ORIGIN.MANUAL;

  const serviceBarberAmount = roundRupiah(variables.service_barber_amount || 0);
  const serviceBarberSource = variables.service_barber_source || SOURCE_ORIGIN.MANUAL;

  if (productCommissionSource === 'REVIEW_REQUIRED') {
    warnings.push('Komisi produk membutuhkan verifikasi (review required).');
  }

  // 8. Late Deduction
  const latePenaltyRate = policy.latePenaltyRate || 15000;
  let lateDeduction = 0;
  let lateDeductionSource = SOURCE_ORIGIN.ATTENDANCE_POLICY;

  if (lateDeductionOverride !== undefined && lateDeductionOverride !== null) {
    lateDeduction = roundRupiah(lateDeductionOverride);
    lateDeductionSource = SOURCE_ORIGIN.MANUAL_OVERRIDE;
  } else {
    lateDeduction = roundRupiah(lateCount * latePenaltyRate);
  }

  // 9. Manual Adjustments (DEBT, BONUS, DEDUCTION, CORRECTION, OTHER)
  let debtDeduction = 0;
  let manualDeduction = 0;
  let manualBonus = 0;

  for (const adj of adjustments) {
    const amt = roundRupiah(adj.amount || 0);
    const type = String(adj.type || 'OTHER').toUpperCase().trim();

    if (type === 'DEBT') {
      // Debt is a positive deduction value subtracted from take-home pay
      debtDeduction += Math.abs(amt);
    } else if (type === 'DEDUCTION') {
      manualDeduction += Math.abs(amt);
    } else if (type === 'BONUS') {
      manualBonus += Math.abs(amt);
    } else if (type === 'CORRECTION') {
      if (amt >= 0) manualBonus += amt;
      else manualDeduction += Math.abs(amt);
    } else {
      // Generic OTHER
      if (amt >= 0) manualBonus += amt;
      else manualDeduction += Math.abs(amt);
    }
  }

  const adjustmentsTotal = manualBonus - (debtDeduction + manualDeduction);

  // 10. Gross Pay
  const grossPay = roundRupiah(
    actualSalary +
    mealAllowanceTotal +
    positionAllowance +
    attendanceAllowance +
    productCommission +
    serviceBarberAmount +
    overtimeAmount +
    manualBonus
  );

  // 11. Total Deductions
  const totalDeduction = roundRupiah(
    lateDeduction +
    debtDeduction +
    manualDeduction
  );

  // 12. Take-Home Pay
  const takeHomePay = roundRupiah(grossPay - totalDeduction);

  // 13. Determine Item Status
  let status = REGULAR_ITEM_STATUS.READY;
  if (!rawBaseSalary || baseSalary <= 0) {
    status = REGULAR_ITEM_STATUS.MISSING_SALARY;
  } else if (attendanceSummary.attendance_coverage_status === 'BLOCKED_ATTENDANCE_SOURCE' || (unit === 'Sundaze' && workDays === 0 && !attendanceSummary.records_count)) {
    status = REGULAR_ITEM_STATUS.BLOCKED_ATTENDANCE_SOURCE;
    warnings.push('Data presensi Sundaze belum terintegrasi (BLOCKED_ATTENDANCE_SOURCE). Gaji tidak dapat dianggap final.');
  } else if (incompleteCount > 0 || exceptionCount > 0 || productCommissionSource === 'REVIEW_REQUIRED' || (attendanceSummary.pending_overtime_count || 0) > 0) {
    status = REGULAR_ITEM_STATUS.REVIEW_REQUIRED;
    if ((attendanceSummary.pending_overtime_count || 0) > 0) {
      warnings.push(`Terdapat ${attendanceSummary.pending_overtime_count} kandidat lembur menunggu persetujuan manager.`);
    }
  } else if (workDays === 0 && absentDays === 0 && !attendanceSummary.records_count) {
    status = REGULAR_ITEM_STATUS.MISSING_ATTENDANCE;
    warnings.push('Tidak ada catatan presensi untuk periode ini. Gaji tidak dapat dianggap final.');
  }

  const coverageStatus = attendanceSummary.attendance_coverage_status ||
    (attendanceSummary.records_count >= 18 ? 'COMPLETE' :
      (attendanceSummary.records_count > 0 ? 'PARTIAL' :
        (unit === 'Sundaze' ? 'BLOCKED_ATTENDANCE_SOURCE' : 'NO_ATTENDANCE')));

  return {
    employee_id: employee.id,
    employee_name_snapshot: employee.name || '',
    employee_nickname_snapshot: employee.nickname || '',
    business_unit_snapshot: unit,
    position_snapshot: employee.position || '',
    branch_snapshot: employee.branch || employee.branch_name || '',

    // Base salary components
    base_salary: baseSalary,
    daily_salary: roundRupiah(dailySalary),
    daily_salary_exact: dailySalary,
    salary_divisor: salaryDivisor,
    work_days: workDays,
    actual_salary: actualSalary,

    // Meal allowance
    meal_allowance_days: mealDays,
    meal_allowance_rate: mealRate,
    meal_allowance_total: mealAllowanceTotal,

    // Allowances
    position_allowance: positionAllowance,
    attendance_allowance: attendanceAllowance,
    attendance_allowance_source: attendanceAllowanceSource,

    // Variables
    product_commission: productCommission,
    product_commission_source: productCommissionSource,
    service_barber_amount: serviceBarberAmount,
    service_barber_source: serviceBarberSource,
    overtime_hours: approvedOvertimeHours,
    overtime_rate: overtimeRate,
    overtime_amount: overtimeAmount,

    // Deductions
    late_count: lateCount,
    late_penalty_rate: latePenaltyRate,
    late_deduction: lateDeduction,
    late_deduction_source: lateDeductionSource,
    debt_deduction: debtDeduction,
    manual_deduction: manualDeduction,

    // Adjustments
    manual_bonus: manualBonus,
    adjustments_total: adjustmentsTotal,
    adjustments_list: adjustments,

    // Totals
    gross_pay: grossPay,
    total_deduction: totalDeduction,
    take_home_pay: takeHomePay,

    // Attendance Coverage Metadata
    attendance_period_expected: attendanceSummary.attendance_period_expected || (period.period_start ? `${period.period_start} s/d ${period.period_end}` : '-'),
    attendance_period_available: attendanceSummary.attendance_period_available || (attendanceSummary.records_count > 0 ? `${attendanceSummary.min_date || ''} s/d ${attendanceSummary.max_date || ''}` : 'Belum tersedia'),
    attendance_coverage_days: Number(attendanceSummary.attendance_coverage_days ?? attendanceSummary.records_count ?? 0),
    attendance_coverage_status: coverageStatus,

    // Diagnostics & Sources
    warnings,
    status,
    attendance_summary: {
      present_days: workDays,
      absent_days: absentDays,
      late_count: lateCount,
      late_minutes: lateMinutes,
      overtime_hours: approvedOvertimeHours,
      incomplete_attendance: incompleteCount,
      unresolved_exceptions_count: exceptionCount,
      attendance_coverage_days: Number(attendanceSummary.attendance_coverage_days ?? attendanceSummary.records_count ?? 0),
      attendance_coverage_status: coverageStatus,
    },
    sources: {
      actual_salary: SOURCE_ORIGIN.ATTENDANCE_AND_MASTER,
      meal_allowance: allowances.meal_allowance_days !== undefined ? SOURCE_ORIGIN.MANUAL_OVERRIDE : SOURCE_ORIGIN.ATTENDANCE_POLICY,
      position_allowance: SOURCE_ORIGIN.MASTER_DATA,
      attendance_allowance: attendanceAllowanceSource,
      product_commission: productCommissionSource,
      service_barber: serviceBarberSource,
      overtime: SOURCE_ORIGIN.ATTENDANCE,
      late_deduction: lateDeductionSource,
      debt: SOURCE_ORIGIN.MANUAL,
    },
  };
}

module.exports = {
  calculateRegularPayrollItem,
  REGULAR_ITEM_STATUS,
  SOURCE_ORIGIN,
};
