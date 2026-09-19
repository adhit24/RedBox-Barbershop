'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateRegularPayrollItem,
  REGULAR_ITEM_STATUS,
} = require('../services/regularPayrollEngine');

test('1. Full attendance (30 days) standard regular employee', () => {
  const employee = {
    id: 'emp-1',
    name: 'Budi Test',
    business_unit: 'Redbox',
    position: 'Cashier',
    base_salary: 1500000,
    position_allowance: 200000,
  };
  const attendance = {
    present_days: 30,
    late_count: 0,
    overtime_hours: 0,
  };
  const allowances = {
    meal_allowance_days: 26,
    meal_allowance_rate: 25000,
    attendance_allowance: 200000,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: attendance,
    allowances,
  });

  // Base: 1500000, Daily: 50000, Actual: 30 * 50000 = 1500000
  assert.equal(res.actual_salary, 1500000);
  // Meal: 26 * 25000 = 650000
  assert.equal(res.meal_allowance_total, 650000);
  assert.equal(res.position_allowance, 200000);
  assert.equal(res.attendance_allowance, 200000);
  // Gross: 1500000 + 650000 + 200000 + 200000 = 2550000
  assert.equal(res.gross_pay, 2550000);
  assert.equal(res.total_deduction, 0);
  assert.equal(res.take_home_pay, 2550000);
  assert.equal(res.status, REGULAR_ITEM_STATUS.READY);
});

test('2. Partial attendance (15 days)', () => {
  const employee = {
    id: 'emp-2',
    name: 'Dede Partial',
    business_unit: 'Redbox',
    position: '-',
    base_salary: 1500000,
    position_allowance: 200000,
  };
  const attendance = {
    present_days: 15,
    absent_days: 15,
  };
  const allowances = {
    meal_allowance_days: 15,
    meal_allowance_rate: 15000,
    attendance_allowance: 0,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: attendance,
    allowances,
  });

  // 15 * (1500000 / 30) = 750000
  assert.equal(res.actual_salary, 750000);
  // 15 * 15000 = 225000
  assert.equal(res.meal_allowance_total, 225000);
  assert.equal(res.position_allowance, 200000);
  // Gross: 750000 + 225000 + 200000 = 1175000
  assert.equal(res.gross_pay, 1175000);
  assert.equal(res.total_deduction, 0);
  assert.equal(res.take_home_pay, 1175000);
  assert.equal(res.status, REGULAR_ITEM_STATUS.READY);
});

test('3. Zero attendance with absent days registered', () => {
  const employee = {
    id: 'emp-3',
    name: 'Absent Staff',
    business_unit: 'Sundaze',
    position: 'Waitress',
    base_salary: 1000000,
  };
  const attendance = {
    present_days: 0,
    absent_days: 30,
    records_count: 30,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: attendance,
  });

  assert.equal(res.work_days, 0);
  assert.equal(res.actual_salary, 0);
  assert.equal(res.gross_pay, 0);
  assert.equal(res.take_home_pay, 0);
  assert.equal(res.status, REGULAR_ITEM_STATUS.READY);
});

test('4. Overtime calculation (hours * 7500)', () => {
  const employee = {
    id: 'emp-4',
    name: 'Overtime Worker',
    business_unit: 'Redbox',
    position: 'Cashier',
    base_salary: 1000000,
  };
  const attendance = {
    present_days: 30,
    overtime_hours: 20,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: attendance,
  });

  // 20 * 7500 = 150000
  assert.equal(res.overtime_hours, 20);
  assert.equal(res.overtime_amount, 150000);
  assert.equal(res.gross_pay >= 1150000, true);
});

test('5. Late deduction (occurrence * 15000)', () => {
  const employee = {
    id: 'emp-5',
    name: 'Late Worker',
    business_unit: 'Sundaze',
    position: 'Barista',
    base_salary: 1500000,
  };
  const attendance = {
    present_days: 30,
    late_count: 3,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: attendance,
  });

  // 3 * 15000 = 45000
  assert.equal(res.late_count, 3);
  assert.equal(res.late_deduction, 45000);
  assert.equal(res.total_deduction, 45000);
  assert.equal(res.take_home_pay, res.gross_pay - 45000);
});

test('6. Meal allowance calculation (days * rate)', () => {
  const employee = {
    id: 'emp-6',
    name: 'Meal Test',
    business_unit: 'Sundaze',
    position: 'Cook',
    base_salary: 1300000,
  };
  const allowances = {
    meal_allowance_days: 27,
    meal_allowance_rate: 40000,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: { present_days: 30 },
    allowances,
  });

  // 27 * 40000 = 1080000
  assert.equal(res.meal_allowance_total, 1080000);
});

test('7. Manual debt deduction', () => {
  const employee = {
    id: 'emp-7',
    name: 'In Debt',
    business_unit: 'Sundaze',
    position: 'Barista',
    base_salary: 1800000,
  };
  const adjustments = [
    { type: 'DEBT', amount: 800000, reason: 'Kasbon operasional' },
  ];

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: { present_days: 30 },
    adjustments,
  });

  assert.equal(res.debt_deduction, 800000);
  assert.equal(res.total_deduction, 800000);
  assert.equal(res.take_home_pay, res.gross_pay - 800000);
});

test('8. Positive and negative adjustments', () => {
  const employee = {
    id: 'emp-8',
    name: 'Bonus Worker',
    business_unit: 'Redbox',
    position: 'Cashier',
    base_salary: 1000000,
  };
  const adjustments = [
    { type: 'BONUS', amount: 150000, reason: 'Bonus kinerja' },
    { type: 'DEDUCTION', amount: 50000, reason: 'Koreksi seragam' },
  ];

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: { present_days: 30 },
    allowances: { meal_allowance_rate: 0 },
    adjustments,
  });

  assert.equal(res.manual_bonus, 150000);
  assert.equal(res.manual_deduction, 50000);
  assert.equal(res.gross_pay, 1000000 + 150000);
  assert.equal(res.total_deduction, 50000);
  assert.equal(res.take_home_pay, 1150000 - 50000);
});

test('9. Missing salary triggers MISSING_SALARY status and warning', () => {
  const employee = {
    id: 'emp-9',
    name: 'No Salary Employee',
    business_unit: 'Redbox',
    position: 'Helper Cashier',
    base_salary: 0,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: { present_days: 30 },
  });

  assert.equal(res.status, REGULAR_ITEM_STATUS.MISSING_SALARY);
  assert.equal(res.warnings.length > 0, true);
  assert.match(res.warnings[0], /Gaji pokok belum terisi/);
});

test('10. Missing attendance (0 records) triggers MISSING_ATTENDANCE', () => {
  const employee = {
    id: 'emp-10',
    name: 'Ghost Employee',
    business_unit: 'Redbox',
    position: 'Helper Cashier',
    base_salary: 1000000,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: { present_days: 0, absent_days: 0, records_count: 0 },
  });

  assert.equal(res.status, REGULAR_ITEM_STATUS.MISSING_ATTENDANCE);
});

test('11. Incomplete attendance or unresolved exception triggers REVIEW_REQUIRED', () => {
  const employee = {
    id: 'emp-11',
    name: 'Exception Employee',
    business_unit: 'Redbox',
    position: 'Helper Cashier',
    base_salary: 1000000,
  };

  const res = calculateRegularPayrollItem({
    employee,
    attendanceSummary: {
      present_days: 28,
      incomplete_attendance: 1,
      unresolved_exceptions_count: 1,
    },
  });

  assert.equal(res.status, REGULAR_ITEM_STATUS.REVIEW_REQUIRED);
  assert.equal(res.warnings.some(w => w.includes('belum lengkap')), true);
});
