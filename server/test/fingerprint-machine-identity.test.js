'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const importer = require('../services/fingerprintAttendanceImporter');
const standardParser = require('../services/attendanceParsers/standardFlatAttendanceParser');
const { calculateRegularPayrollItem, REGULAR_ITEM_STATUS } = require('../services/regularPayrollEngine');

const dbEmployees = [
  { id: 'emp-abi', name: 'Abi Bhakti', nickname: 'Abi Bhakti', business_unit: 'Sundaze', branch: 'bypass' },
  { id: 'emp-agus', name: 'Agus Habibi', nickname: 'Agus', business_unit: 'Sundaze', branch: 'bypass' },
  { id: 'emp-adam', name: 'Adam Apriliano Fahrezy', nickname: 'Adam', business_unit: 'Redbox', branch: 'bypass' },
];
const dbBarbers = [{ id: 'csb-yudha', name: 'Yudha', branch: 'csb' }];

test('Machine identity: same machine ID on two machines maps independently (no cross-machine leak)', () => {
  const identities = [
    { source: 'fingerprint:bypass', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-agus' },
    { source: 'fingerprint:samadikun', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-adam' },
    { source: 'fingerprint', external_employee_id: '3', target_type: 'barber', barber_id: 'csb-yudha' },
  ];
  const fe = [{ external_employee_id: '3', external_name: 'Whoever' }];

  const bypass = importer.matchEmployees({ fileEmployees: fe, dbEmployees, dbBarbers, existingIdentities: identities, machineSource: 'bypass' });
  const sam = importer.matchEmployees({ fileEmployees: fe, dbEmployees, dbBarbers, existingIdentities: identities, machineSource: 'Samadikun' });
  const legacy = importer.matchEmployees({ fileEmployees: fe, dbEmployees, dbBarbers, existingIdentities: identities });

  assert.equal(bypass.matched[0].employee_id, 'emp-agus');
  assert.equal(sam.matched[0].employee_id, 'emp-adam');
  assert.equal(legacy.matched[0].barber_id, 'csb-yudha');
});

test('Machine identity: business unit / filename never decide the match (Sundaze staff on Bypass machine)', () => {
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '30', external_name: 'Agus', department: 'ADMIN' }],
    dbEmployees,
    machineSource: 'bypass',
  });
  assert.equal(unmatched.length, 0);
  assert.equal(matched[0].employee_id, 'emp-agus');
  assert.equal(matched[0].business_unit, 'Sundaze');
});

test('Machine identity: non-exact names are not fuzzy matched (AbiB stays MANUAL_REVIEW)', () => {
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '33', external_name: 'AbiB' }],
    dbEmployees,
    machineSource: 'bypass',
  });
  assert.equal(matched.length, 0);
  assert.equal(unmatched[0].reason, 'unresolved_employee');
});

test('Terminated guard: Ajeng/Reka/Anggi/Hardi/Farhan are rejected, not exception-routed', () => {
  const names = ['Ajeng', 'Reka', 'Anggi', 'Hardi', 'Farhan'];
  const { matched, unmatched, rejected } = importer.matchEmployees({
    fileEmployees: names.map((n, i) => ({ external_employee_id: String(100 + i), external_name: n })),
    dbEmployees,
    dbBarbers,
    machineSource: 'bypass',
  });
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 0);
  assert.equal(rejected.length, 5);
});

test('Terminated guard: inactive DB names are rejected too, active same-name stays manual review', () => {
  const r1 = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '9', external_name: 'Budi' }],
    dbEmployees,
    terminatedNames: ['Budi'],
  });
  assert.equal(r1.rejected.length, 1);

  const r2 = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '9', external_name: 'Agus' }],
    dbEmployees,
    terminatedNames: ['Agus'],
  });
  assert.equal(r2.rejected.length, 0);
  assert.equal(r2.unmatched[0].reason, 'ambiguous_terminated_name');
});

test('mergeAttendanceRecords: unions punches, never lets zero-punch override evidence, idempotent', () => {
  const a = { raw_punches: ['08:00', '17:00'], first_check_in: '08:00', last_check_out: '17:00', late_minutes: 0, status: 'hadir' };
  const b = { raw_punches: ['08:05', '17:30'], first_check_in: '08:05', last_check_out: '17:30', late_minutes: 5, status: 'terlambat' };
  const zero = { raw_punches: [], first_check_in: null, last_check_out: null, status: 'absent' };

  assert.deepEqual(importer.mergeAttendanceRecords(a, zero).raw_punches, a.raw_punches);
  assert.deepEqual(importer.mergeAttendanceRecords(zero, a).raw_punches, a.raw_punches);

  const m = importer.mergeAttendanceRecords(a, b);
  assert.deepEqual(m.raw_punches, ['08:00', '08:05', '17:00', '17:30']);
  assert.equal(m.first_check_in, '08:00');
  assert.equal(m.last_check_out, '17:30');

  const again = importer.mergeAttendanceRecords(m, b);
  assert.deepEqual(again.raw_punches, m.raw_punches);
  assert.equal(again.first_check_in, m.first_check_in);
});

test('Standard parser: cross-month period maps day numbers to the correct month', () => {
  const rows = [
    ['Lap. Log Absen'],
    ['Periode: 2026-08-26 ~ 2026-09-20'],
    [],
    [null, null, null, 26, 27, 1, 2],
    ['ID:', null, '7', null, null, null, null, null, null, null, 'Tester'],
    [null, null, null, '08:00 17:00', null, '08:10 17:00', null],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Lap. Log Absen');
  const out = standardParser.extractDailyPunches(wb, { from: '2026-08-26', to: '2026-09-20' });
  const dates = out.map(r => r.attendance_date).sort();
  assert.deepEqual(dates, ['2026-08-26', '2026-09-01']);
});

test('Regular payroll: Sundaze without attendance is MISSING_ATTENDANCE, never BLOCKED_ATTENDANCE_SOURCE', () => {
  const item = calculateRegularPayrollItem({
    employee: { id: 'e1', name: 'Abi Bhakti', business_unit: 'Sundaze', base_salary: 3000000, position: 'Barista' },
    period: { period_start: '2026-08-26', period_end: '2026-09-25' },
    attendanceSummary: { records_count: 0, present_days: 0, absent_days: 0, late_count: 0, late_minutes: 0, incomplete_attendance: 0, unresolved_exceptions_count: 0, pending_overtime_count: 0 },
  });
  assert.equal(item.status, REGULAR_ITEM_STATUS.MISSING_ATTENDANCE);
  assert.equal(item.attendance_coverage_status, 'NO_ATTENDANCE');
});
