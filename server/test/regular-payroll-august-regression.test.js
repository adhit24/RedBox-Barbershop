'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRegularPayrollItem } = require('../services/regularPayrollEngine');

test('Regression: Adam Apriliano Fahrezy (Redbox Row 3)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'adam-uuid',
      name: 'Adam Apriliano Fahrezy',
      business_unit: 'Redbox',
      position: 'Helper Cashier',
      base_salary: 1000000,
    },
    attendanceSummary: {
      present_days: 29,
      late_count: 8,
      overtime_hours: 16,
    },
    allowances: {
      meal_allowance_days: 25,
      meal_allowance_rate: 30000,
      position_allowance: 0,
      attendance_allowance: 150000,
    },
    variables: {
      product_commission: 91000,
      service_barber_amount: 482900,
      approved_overtime_hours: 16,
    },
    lateDeductionOverride: 125000, // Explicit in sheet
    adjustments: [
      { type: 'DEBT', amount: 50000, reason: 'Utang' },
    ],
  });

  // Daily = 33333.33 -> 29 * 33333.33 = 966667 (rounded)
  assert.equal(res.actual_salary, 966667);
  assert.equal(res.meal_allowance_total, 750000);
  assert.equal(res.attendance_allowance, 150000);
  assert.equal(res.product_commission, 91000);
  assert.equal(res.service_barber_amount, 482900);
  assert.equal(res.overtime_amount, 120000);
  // Gross: 966667 + 750000 + 150000 + 91000 + 482900 + 120000 = 2560567
  assert.equal(res.gross_pay, 2560567);
  // Deduction: 125000 + 50000 = 175000
  assert.equal(res.total_deduction, 175000);
  // Net: 2560567 - 175000 = 2385567
  assert.equal(res.take_home_pay, 2385567);
  // Excel value was 2385566.67. Difference is < 1 Rupiah due to rounding.
  assert.ok(Math.abs(res.take_home_pay - 2385566.67) < 1);
});

test('Regression: Asep Maulana Yusup (Redbox Row 5)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'asep-uuid',
      name: 'Asep Maulana Yusup',
      business_unit: 'Redbox',
      position: 'Helper Cashier',
      base_salary: 1700000,
      position_allowance: 500000,
    },
    attendanceSummary: {
      present_days: 30,
      late_count: 8,
      overtime_hours: 16,
    },
    allowances: {
      meal_allowance_days: 27,
      meal_allowance_rate: 15000,
      attendance_allowance: 200000,
    },
    variables: {
      product_commission: 37000,
      service_barber_amount: 334200,
      approved_overtime_hours: 16,
    },
    lateDeductionOverride: 120000,
    adjustments: [
      { type: 'DEBT', amount: 50000, reason: 'Utang' },
    ],
  });

  assert.equal(res.actual_salary, 1700000);
  assert.equal(res.meal_allowance_total, 405000);
  assert.equal(res.position_allowance, 500000);
  assert.equal(res.attendance_allowance, 200000);
  assert.equal(res.product_commission, 37000);
  assert.equal(res.service_barber_amount, 334200);
  assert.equal(res.overtime_amount, 120000);
  assert.equal(res.gross_pay, 3296200);
  assert.equal(res.late_deduction, 120000);
  assert.equal(res.debt_deduction, 50000);
  assert.equal(res.total_deduction, 170000);
  assert.equal(res.take_home_pay, 3126200);
});

test('Regression: Elsa Octavia (Redbox Row 8)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'elsa-uuid',
      name: 'Elsa Octavia',
      business_unit: 'Redbox',
      position: 'Cashier',
      base_salary: 1100000,
    },
    attendanceSummary: {
      present_days: 30,
      late_count: 0,
      overtime_hours: 24,
    },
    allowances: {
      meal_allowance_days: 26,
      meal_allowance_rate: 25000,
      attendance_allowance: 200000,
    },
    variables: {
      product_commission: 98000,
      service_barber_amount: 0,
      approved_overtime_hours: 24,
    },
    adjustments: [],
  });

  assert.equal(res.actual_salary, 1100000);
  assert.equal(res.meal_allowance_total, 650000);
  assert.equal(res.attendance_allowance, 200000);
  assert.equal(res.product_commission, 98000);
  assert.equal(res.overtime_amount, 180000);
  assert.equal(res.gross_pay, 2228000);
  assert.equal(res.total_deduction, 0);
  assert.equal(res.take_home_pay, 2228000);
});

test('Regression: Abi Bhakti (Sundaze Row 3)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'abi-uuid',
      name: 'Abi Bhakti',
      business_unit: 'Sundaze',
      position: 'Barista',
      base_salary: 1800000,
      position_allowance: 500000,
    },
    attendanceSummary: {
      present_days: 30,
      late_count: 0,
      overtime_hours: 12,
    },
    allowances: {
      meal_allowance_days: 25,
      meal_allowance_rate: 20000,
      attendance_allowance: 200000,
    },
    variables: {
      approved_overtime_hours: 12,
    },
    adjustments: [
      { type: 'DEBT', amount: 800000, reason: 'Utang' },
    ],
  });

  assert.equal(res.actual_salary, 1800000);
  assert.equal(res.meal_allowance_total, 500000);
  assert.equal(res.position_allowance, 500000);
  assert.equal(res.attendance_allowance, 200000);
  assert.equal(res.overtime_amount, 90000);
  assert.equal(res.gross_pay, 3090000);
  assert.equal(res.total_deduction, 800000);
  assert.equal(res.take_home_pay, 2290000);
});

test('Regression: Andika Sofyanto (Sundaze Row 6)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'andika-uuid',
      name: 'Andika Sofyanto',
      business_unit: 'Sundaze',
      position: 'Cook',
      base_salary: 1300000,
    },
    attendanceSummary: {
      present_days: 30,
      late_count: 1,
      overtime_hours: 0,
    },
    allowances: {
      meal_allowance_days: 27,
      meal_allowance_rate: 25000,
      attendance_allowance: 200000,
    },
  });

  assert.equal(res.actual_salary, 1300000);
  assert.equal(res.meal_allowance_total, 675000);
  assert.equal(res.attendance_allowance, 200000);
  assert.equal(res.gross_pay, 2175000);
  assert.equal(res.late_deduction, 15000);
  assert.equal(res.total_deduction, 15000);
  assert.equal(res.take_home_pay, 2160000);
});

test('Regression: Karnadi (Sundaze Row 18)', () => {
  const res = calculateRegularPayrollItem({
    employee: {
      id: 'karnadi-uuid',
      name: 'Karnadi',
      business_unit: 'Sundaze',
      position: 'Barista',
      base_salary: 2000000,
    },
    attendanceSummary: {
      present_days: 30,
      late_count: 14,
      overtime_hours: 18,
    },
    allowances: {
      meal_allowance_days: 26,
      meal_allowance_rate: 15000,
      attendance_allowance: 100000,
    },
    variables: {
      approved_overtime_hours: 18,
    },
  });

  assert.equal(res.actual_salary, 2000000);
  assert.equal(res.meal_allowance_total, 390000);
  assert.equal(res.attendance_allowance, 100000);
  assert.equal(res.overtime_amount, 135000);
  assert.equal(res.gross_pay, 2625000);
  assert.equal(res.late_deduction, 210000); // 14 * 15000 = 210000
  assert.equal(res.total_deduction, 210000);
  assert.equal(res.take_home_pay, 2415000);
});
