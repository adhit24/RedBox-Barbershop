'use strict';

/**
 * Regular Payroll Policies for Redbox Barbershop & Sundaze Cafe
 *
 * Source Authority:
 *   - Reference: LAPORAN GAJI REDBOX BARBERSHOP & SUNDAZE (AGUSTUS 2026).xlsx
 *   - Divisor: 30 days
 *   - Overtime rate: Rp 7,500 / hour
 *   - Late penalty: Rp 15,000 / occurrence
 *   - Decimal-safe rounding standard: whole Rupiah (Math.round / ROUND_HALF_UP)
 */

const REGULAR_PAYROLL_POLICY = Object.freeze({
  DEFAULT: {
    salaryDivisor: 30,
    overtimeRate: 7500,
    latePenaltyRate: 15000,
    defaultMealRate: 25000,
  },
  Redbox: {
    salaryDivisor: 30,
    overtimeRate: 7500,
    latePenaltyRate: 15000,
    // Typical meal rate by role in August 2026
    defaultMealRatesByPosition: {
      'Helper Cashier': 30000,
      'Cashier': 25000,
      'Umum': 25000,
      '-': 15000,
    },
  },
  Sundaze: {
    salaryDivisor: 30,
    overtimeRate: 7500,
    latePenaltyRate: 15000,
    // Typical meal rate by role in August 2026
    defaultMealRatesByPosition: {
      'Barista': 20000,
      'Cook': 25000,
      'Waitress': 30000,
      'Waiter': 30000,
      'Greeter': 25000,
      'Cashier': 25000,
      '-': 25000,
    },
  },
});

function getPolicyForUnit(businessUnit) {
  const norm = (businessUnit || '').trim().toLowerCase();
  if (norm.includes('sundaze')) {
    return REGULAR_PAYROLL_POLICY.Sundaze;
  }
  return REGULAR_PAYROLL_POLICY.Redbox;
}

/**
 * Decimal-safe rounding standard for whole Rupiah
 */
function roundRupiah(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return 0;
  return Math.round(Number(amount));
}

module.exports = {
  REGULAR_PAYROLL_POLICY,
  getPolicyForUnit,
  roundRupiah,
};
