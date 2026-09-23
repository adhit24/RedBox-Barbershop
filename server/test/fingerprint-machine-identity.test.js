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

// ---- PRRT_kwDOSNmW7c6klJoY: an existing machine-scoped mapping is identity authority only while the target is still active ----

test('Machine identity: a mapped employee who is still active is accepted (Priority 1)', () => {
  const identities = [
    { source: 'fingerprint:bypass', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-agus' },
  ];
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees, dbBarbers, existingIdentities: identities, machineSource: 'bypass',
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].match_type, 'identity_mapping');
  assert.equal(matched[0].employee_id, 'emp-agus');
  assert.equal(unmatched.length, 0);
});

test('Machine identity: same employee later deactivated -> new import rejected/ignored, no auto-remap', () => {
  const identities = [
    { source: 'fingerprint:bypass', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-agus' },
  ];
  // Emp-agus is no longer in the active roster (loadMatchingContext only ever loads is_active=true rows).
  const activeEmployeesWithoutAgus = dbEmployees.filter((e) => e.id !== 'emp-agus');
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees: activeEmployeesWithoutAgus, dbBarbers, existingIdentities: identities, machineSource: 'bypass',
  });
  assert.equal(matched.length, 0, 'must NOT auto-map (write attendance) for a deactivated mapped target');
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, 'mapped_target_inactive');
});

test('Machine identity: an inactive mapped barber is also rejected, not silently remapped', () => {
  const identities = [
    { source: 'fingerprint', external_employee_id: '3', target_type: 'barber', barber_id: 'csb-yudha' },
  ];
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees, dbBarbers: [], existingIdentities: identities, // barber roster no longer includes csb-yudha
  });
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, 'mapped_target_inactive');
});

test('Machine identity: an inactive mapped target never falls through to a lower-priority auto-map', () => {
  // emp-agus employee_code coincidentally matches the file's external id/name too -- if the inactive
  // mapping fell through to Priority 2/3/4 it would silently re-bind to someone else's identity.
  const withCode = dbEmployees.map((e) => (e.id === 'emp-adam' ? { ...e, employee_code: '3' } : e));
  const identities = [
    { source: 'fingerprint:bypass', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-agus' },
  ];
  const activeWithoutAgus = withCode.filter((e) => e.id !== 'emp-agus');
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Adam Apriliano Fahrezy' }],
    dbEmployees: activeWithoutAgus, dbBarbers, existingIdentities: identities, machineSource: 'bypass',
  });
  assert.equal(matched.length, 0, 'must not fall through to employee_code/name matching once flagged inactive');
  assert.equal(unmatched[0].reason, 'mapped_target_inactive');
});

test('Machine identity: reactivating the mapped employee restores Priority 1 matching (mapping row was never deleted)', () => {
  const identities = [
    { source: 'fingerprint:bypass', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-agus' },
  ];
  const activeWithoutAgus = dbEmployees.filter((e) => e.id !== 'emp-agus');
  const whileInactive = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees: activeWithoutAgus, dbBarbers, existingIdentities: identities, machineSource: 'bypass',
  });
  assert.equal(whileInactive.matched.length, 0);

  // The same historical identity row (never deleted) is reused once emp-agus is active again.
  const backActive = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees, dbBarbers, existingIdentities: identities, machineSource: 'bypass',
  });
  assert.equal(backActive.matched[0]?.employee_id, 'emp-agus');
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

// ---- PRRT_kwDOSNmW7c6kYVyh: employee_code alone is not authority for a brand-new machine identity ----

const dbEmployeesWithCodes = [
  { id: 'emp-a', employee_code: '3', name: 'Employee A', nickname: 'A', business_unit: 'Redbox', branch: 'bypass' },
  { id: 'emp-b', employee_code: '99', name: 'Employee B', nickname: 'B', business_unit: 'Redbox', branch: 'tegal' },
];

test('Machine ID corroboration: reused ID is NOT auto-mapped via employee_code alone when the name differs', () => {
  // Bypass: ID 3 -> Employee A (already correct via employee_code, name corroborates)
  const bypass = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee A' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'bypass',
  });
  assert.equal(bypass.matched[0]?.employee_id, 'emp-a');

  // Samadikun: first import, ID 3 belongs to a DIFFERENT person (Employee B) on this machine.
  // No scoped identity exists yet for fingerprint:samadikun, so global employee_code=3 (Employee A)
  // must NOT be trusted merely because the code matches.
  const samadikun = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee B' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'samadikun',
  });
  assert.equal(samadikun.matched.length, 0, 'must NOT map Samadikun ID 3 to Employee A merely because employee_code=3');
  assert.equal(samadikun.unmatched.length, 1);
  assert.equal(samadikun.unmatched[0].reason, 'employee_code_name_mismatch');
});

test('Machine ID corroboration: employee_code + exact normalized name match still auto-maps', () => {
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee A' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'newmachine-stub-not-in-allowlist', // machineSource is only used for identity_mapping lookup key here
  });
  assert.equal(unmatched.length, 0);
  assert.equal(matched[0].employee_id, 'emp-a');
  assert.equal(matched[0].match_type, 'employee_code');
});

test('Machine ID corroboration: code match + different name never falls through to a wrong name-only match', () => {
  // Employee B's own name ("Employee B") would legitimately name-match emp-b by Priority 3/4, but here
  // the FILE reports code "3" (Employee A's code) with name "Employee B" — an inconsistent/reused-ID
  // scenario. It must stay unresolved, not silently bind to either candidate.
  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee B' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'samadikun',
  });
  assert.equal(matched.length, 0);
  assert.equal(unmatched[0].reason, 'employee_code_name_mismatch');
  assert.equal(unmatched[0].candidate_matches[0].id, 'emp-a');
});

test('Machine ID corroboration: an existing scoped identity mapping always wins over employee_code', () => {
  const identities = [
    { source: 'fingerprint:samadikun', external_employee_id: '3', target_type: 'employee', employee_id: 'emp-b' },
  ];
  const { matched } = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Whoever' }],
    dbEmployees: dbEmployeesWithCodes,
    existingIdentities: identities,
    machineSource: 'samadikun',
  });
  assert.equal(matched[0].employee_id, 'emp-b');
});

test('Machine ID corroboration: an unresolved code/name mismatch on one machine never leaks a mapping to another', () => {
  const samadikun = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee B' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'samadikun',
  });
  assert.equal(samadikun.matched.length, 0);

  const bypass = importer.matchEmployees({
    fileEmployees: [{ external_employee_id: '3', external_name: 'Employee A' }],
    dbEmployees: dbEmployeesWithCodes,
    machineSource: 'bypass',
  });
  assert.equal(bypass.matched[0].employee_id, 'emp-a');
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
