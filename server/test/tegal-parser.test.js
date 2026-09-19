'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const importer = require('../services/fingerprintAttendanceImporter');
const {
  FORMAT_TEGAL_HORIZONTAL,
  FORMAT_STANDARD_FLAT,
  detectAttendanceFormat,
} = require('../services/attendanceParsers/attendanceFormatDetector');
const tegalParser = require('../services/attendanceParsers/tegalHorizontalAttendanceParser');

const TEGAL_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fingerprint', 'tegalsept.xls');

test('Tegal Parser: Format Detection on Real tegalsept.xls', () => {
  const buf = fs.readFileSync(TEGAL_FIXTURE_PATH);
  const wb = importer.parseWorkbook(buf);
  const detected = detectAttendanceFormat(wb);

  assert.equal(detected.format, FORMAT_TEGAL_HORIZONTAL);
  assert.equal(detected.confidence, 1.0);

  // Backward compatible detector method
  const reportFormat = importer.detectReportFormat(wb);
  assert.equal(reportFormat.format, FORMAT_TEGAL_HORIZONTAL);
  assert.equal(reportFormat.hasLogsSheet, true);
  assert.equal(reportFormat.hasSummarySheet, true);
});

test('Tegal Parser: Real tegalsept.xls Verification (13 Employees, 411 Distinct Punches, 192 Days)', () => {
  const buf = fs.readFileSync(TEGAL_FIXTURE_PATH);
  const wb = importer.parseWorkbook(buf);

  // 1. Period Detection
  const period = importer.extractReportPeriod(wb);
  assert.equal(period.from, '2026-08-26');
  assert.equal(period.to, '2026-09-19');

  // 2. Employee Extraction & Deduplication
  const employees = importer.extractEmployees(wb);
  assert.equal(employees.length, 13, `Expected exactly 13 unique employees, got ${employees.length}`);

  const empIds = employees.map(e => e.external_employee_id);
  const expectedIds = ['1', '2', '4', '5', '7', '8', '11', '12', '13', '14', '15', '6', '10'];
  for (const expId of expectedIds) {
    assert.ok(empIds.includes(expId), `Employee ID ${expId} must be present`);
  }

  // Verify specific employees (Sanitized PII Fixture)
  const emp1 = employees.find(e => e.external_employee_id === '1');
  assert.equal(emp1.external_name, 'Kapster 01');
  assert.equal(emp1.department, 'Dept1');

  const emp10 = employees.find(e => e.external_employee_id === '10');
  assert.equal(emp10.external_name, 'Kapster 10');

  // 3. Punch & Daily Records Extraction
  const { dailyRecords, stats } = tegalParser.extractDailyPunches(wb, period);

  // 416 raw scan tokens in workbook, 5 same-minute double-taps = 411 distinct punches
  assert.equal(stats.totalRawPunchesCount, 416, `Expected 416 total raw scans, got ${stats.totalRawPunchesCount}`);
  assert.equal(stats.totalDistinctPunchesCount, 411, `Expected 411 distinct punches, got ${stats.totalDistinctPunchesCount}`);
  assert.equal(stats.employeeDaysWithAttendance, 192, `Expected 192 employee-days with attendance, got ${stats.employeeDaysWithAttendance}`);
  assert.equal(dailyRecords.length, 192);

  // Verify first and last records
  const ahmadDay1 = dailyRecords.find(r => r.external_employee_id === '1' && r.attendance_date === '2026-08-26');
  assert.ok(ahmadDay1);
  assert.equal(ahmadDay1.first_check_in, '09:59');
  assert.equal(ahmadDay1.last_check_out, '20:56');
  assert.deepEqual(ahmadDay1.raw_punches, ['09:59', '14:53', '15:22', '20:56']);
});

test('Tegal Parser: Simple 1 Employee, 1 Day, 2 Punches', () => {
  const cellVal = '09:59\n20:56\n';
  const punches = tegalParser.extractPunchTimes(cellVal);
  assert.deepEqual(punches, ['09:59', '20:56']);
  assert.equal(punches.length, 2);
  assert.equal(punches[0], '09:59');
  assert.equal(punches[1], '20:56');
});

test('Tegal Parser: Multiple Punches in Single Cell (4 Punches Preserved)', () => {
  const cellVal = '09:59\r\n14:53\r\n15:22\r\n20:56';
  const punches = tegalParser.extractPunchTimes(cellVal);
  assert.deepEqual(punches, ['09:59', '14:53', '15:22', '20:56']);
  assert.equal(punches.length, 4);
});

test('Tegal Parser: Month Rollover (August 26..31 -> September 1..19)', () => {
  // Construct a synthetic minimal workbook
  const logsData = [
    ['List of Logs'],
    [],
    ['Period : ', null, '2026/08/26 ~ 09/19'],
    [30, 31, 1, 2],
    ['No :', null, '99', null, null, null, null, null, 'Name :', null, 'TestEmp'],
    ['08:00\n17:00', '08:05\n17:05', '08:10\n17:10', '08:15\n17:15'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(logsData);
  const wb = { SheetNames: ['Logs', 'Summary'], Sheets: { Logs: ws, Summary: XLSX.utils.aoa_to_sheet([]) } };

  const period = { from: '2026-08-26', to: '2026-09-19' };
  const { dailyRecords } = tegalParser.extractDailyPunches(wb, period);

  assert.equal(dailyRecords.length, 4);
  assert.equal(dailyRecords[0].attendance_date, '2026-08-30');
  assert.equal(dailyRecords[1].attendance_date, '2026-08-31');
  assert.equal(dailyRecords[2].attendance_date, '2026-09-01');
  assert.equal(dailyRecords[3].attendance_date, '2026-09-02');
});

test('Tegal Parser: Year Rollover (December 28..31 -> January 1..5)', () => {
  const logsData = [
    ['List of Logs'],
    [],
    ['Period : ', null, '2026/12/28 ~ 01/05'],
    [30, 31, 1, 2],
    ['No :', null, '99', null, null, null, null, null, 'Name :', null, 'NewYearEmp'],
    ['08:00\n17:00', '08:05\n17:05', '08:10\n17:10', '08:15\n17:15'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(logsData);
  const wb = { SheetNames: ['Logs'], Sheets: { Logs: ws } };

  const period = tegalParser.extractPeriod(wb);
  assert.equal(period.from, '2026-12-28');
  assert.equal(period.to, '2027-01-05');

  const { dailyRecords } = tegalParser.extractDailyPunches(wb, period);
  assert.equal(dailyRecords.length, 4);
  assert.equal(dailyRecords[0].attendance_date, '2026-12-30');
  assert.equal(dailyRecords[1].attendance_date, '2026-12-31');
  assert.equal(dailyRecords[2].attendance_date, '2027-01-01');
  assert.equal(dailyRecords[3].attendance_date, '2027-01-02');
});

test('Tegal Parser: Empty Attendance Cell Produces 0 Punches', () => {
  assert.deepEqual(tegalParser.extractPunchTimes(null), []);
  assert.deepEqual(tegalParser.extractPunchTimes(undefined), []);
  assert.deepEqual(tegalParser.extractPunchTimes(''), []);
  assert.deepEqual(tegalParser.extractPunchTimes('   \n  \t '), []);
});

test('Tegal Parser: Invalid Non-Time Text Filtered Out (OFF, ABSENT, -)', () => {
  assert.deepEqual(tegalParser.extractPunchTimes('OFF'), []);
  assert.deepEqual(tegalParser.extractPunchTimes('ABSENT'), []);
  assert.deepEqual(tegalParser.extractPunchTimes('-'), []);
  assert.deepEqual(tegalParser.extractPunchTimes('LIBUR'), []);
  assert.deepEqual(tegalParser.extractPunchTimes('09:00\nOFF\n17:00'), ['09:00', '17:00']);
});

test('Tegal Parser: Same-Minute Double-Tap Deduplication', () => {
  const cellVal = '09:59\n09:59\n20:56';
  const rawPunches = tegalParser.extractPunchTimes(cellVal);
  assert.deepEqual(rawPunches, ['09:59', '09:59', '20:56']);

  const distinctSorted = [...new Set(rawPunches)].sort();
  assert.deepEqual(distinctSorted, ['09:59', '20:56']);
});

test('Tegal Parser: Duplicate Employee Blocks in File Deduplicated by external_employee_id', () => {
  const logsData = [
    ['List of Logs'],
    [],
    ['Period : ', null, '2026/08/26 ~ 09/19'],
    [26],
    ['No :', null, '14', null, null, null, null, null, 'Name :', null, 'epik'],
    ['12:56\n20:46'],
    [26],
    ['No :', null, '14', null, null, null, null, null, 'Name :', null, 'epik'],
    ['12:56\n20:46'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(logsData);
  const wb = { SheetNames: ['Logs'], Sheets: { Logs: ws } };

  const period = { from: '2026-08-26', to: '2026-09-19' };
  const emps = tegalParser.extractEmployees(wb);
  assert.equal(emps.length, 1);

  const { dailyRecords } = tegalParser.extractDailyPunches(wb, period);
  assert.equal(dailyRecords.length, 1);
  assert.equal(dailyRecords[0].external_employee_id, '14');
});

test('Tegal Parser: End-to-End Preview & Commit Flow with Mock DB', async () => {
  const buf = fs.readFileSync(TEGAL_FIXTURE_PATH);

  // Mock Supabase DB
  const mockDbBatches = [];
  const mockDbEmpAttendance = [];
  const mockDbExceptions = [];

  const mockSupabase = {
    from: (tableName) => {
      if (tableName === 'attendance_import_batches') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
          insert: (data) => ({
            select: () => ({
              single: async () => {
                const row = { id: 'mock-batch-tegal-1', ...data };
                mockDbBatches.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (data) => ({
            eq: async () => {
              Object.assign(mockDbBatches[0] || {}, data);
              return { error: null };
            },
          }),
        };
      }
      if (tableName === 'employees') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { id: 'emp-ahmad-uuid', employee_code: '1', name: 'Ahmad Syarif', nickname: 'ahmad', branch: 'tegal' },
                { id: 'emp-melly-uuid', employee_code: '2', name: 'Melly Melinda', nickname: 'melly', branch: 'tegal' },
              ],
            }),
          }),
        };
      }
      if (tableName === 'barbers') {
        return {
          select: () => ({
            eq: async () => ({ data: [] }),
          }),
        };
      }
      if (tableName === 'employee_attendance_identity') {
        return {
          select: () => ({
            eq: async () => ({ data: [] }),
          }),
        };
      }
      if (tableName === 'employee_attendance') {
        return {
          upsert: async (rows) => {
            mockDbEmpAttendance.push(...rows);
            return { error: null };
          },
        };
      }
      if (tableName === 'barber_attendance') {
        return {
          select: () => ({
            in: () => ({
              in: async () => ({ data: [] }),
            }),
          }),
          insert: async () => ({ error: null }),
        };
      }
      if (tableName === 'attendance_exceptions') {
        return {
          insert: async (rows) => {
            mockDbExceptions.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${tableName}`);
    },
  };

  // 1. Preview Import
  const preview = await importer.previewImport({
    buffer: buf,
    filename: 'tegalsept.xls',
    uploadedBy: 'manager@redbox.com',
    supabase: mockSupabase,
  });

  assert.equal(preview.format, FORMAT_TEGAL_HORIZONTAL);
  assert.equal(preview.detected_format, FORMAT_TEGAL_HORIZONTAL);
  assert.equal(preview.period.from, '2026-08-26');
  assert.equal(preview.period.to, '2026-09-19');
  assert.equal(preview.employees_detected, 13);
  assert.equal(preview.matched_count, 2); // Ahmad and Melly matched by code / name
  assert.equal(preview.unmatched_count, 11); // Remaining 11 unmatched
  assert.equal(preview.punch_records_count, 192);
  assert.ok(preview.sample_records.length > 0);

  // 2. Commit Import
  const result = await importer.commitImport({
    buffer: buf,
    filename: 'tegalsept.xls',
    uploadedBy: 'manager@redbox.com',
    userAuth: { email: 'manager@redbox.com' },
    supabase: mockSupabase,
  });

  assert.equal(result.status, 'partial'); // partial because unmatched rows exist
  assert.equal(result.employees_detected, 13);
  assert.equal(result.matched_count, 2);
  assert.equal(result.unmatched_count, 11);
  assert.ok(result.rows_imported > 0);
  assert.ok(result.rows_exceptions > 0);
  assert.ok(mockDbBatches.length > 0);
  assert.ok(mockDbEmpAttendance.length > 0);
  assert.ok(mockDbExceptions.length > 0);
});

test('Attendance Import: terminated workforce names are rejected before matching', () => {
  const fileEmployees = [
    { external_employee_id: '9001', external_name: 'Ajeng' },
    { external_employee_id: '9002', external_name: 'REKA' },
    { external_employee_id: '9003', external_name: ' Anggi ' },
    { external_employee_id: '9004', external_name: 'Hardi' },
    { external_employee_id: '9005', external_name: 'farhan' },
    { external_employee_id: '1', external_name: 'Ahmad' },
  ];
  const dbEmployees = [
    { id: 'emp-ajeng', employee_code: '9001', name: 'Ajeng' },
    { id: 'emp-ahmad', employee_code: '1', name: 'Ahmad' },
  ];

  const result = importer.matchEmployees({ fileEmployees, dbEmployees, dbBarbers: [], existingIdentities: [] });

  assert.equal(result.rejected.length, 5);
  assert.deepEqual(
    result.rejected.map(r => importer.normalizeAlphanumeric(r.external_name)).sort(),
    ['ajeng', 'anggi', 'farhan', 'hardi', 'reka']
  );
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].external_name, 'Ahmad');
  assert.equal(result.unmatched.length, 0);

  for (const name of ['Ajeng', 'reka', 'ANGGI', ' hardi ', 'Farhan']) {
    assert.equal(importer.isTerminatedWorkforceName(name), true);
  }
});

test('Tegal Parser: Real User File Local Verification (Read-Only)', () => {
  const realFilePath = 'C:\\Users\\Win11\\Downloads\\tegalsept.xls';
  if (!fs.existsSync(realFilePath)) {
    // Skip if running in CI without user's local downloads
    return;
  }

  const realBuf = fs.readFileSync(realFilePath);
  const wb = importer.parseWorkbook(realBuf);

  // 1. Format
  const detected = detectAttendanceFormat(wb);
  assert.equal(detected.format, FORMAT_TEGAL_HORIZONTAL);

  // 2. Period
  const period = importer.extractReportPeriod(wb);
  assert.equal(period.from, '2026-08-26');
  assert.equal(period.to, '2026-09-19');

  // 3. 13 Unique Employees
  const employees = importer.extractEmployees(wb);
  assert.equal(employees.length, 13);

  const realEmpMap = Object.fromEntries(employees.map(e => [e.external_employee_id, e.external_name]));
  assert.equal(realEmpMap['1'], 'ahmad');
  assert.equal(realEmpMap['2'], 'melly');
  assert.equal(realEmpMap['4'], 'shepril');
  assert.equal(realEmpMap['5'], 'elsa');
  assert.equal(realEmpMap['7'], 'dede');
  assert.equal(realEmpMap['8'], 'wawan');
  assert.equal(realEmpMap['11'], 'fais');
  assert.equal(realEmpMap['12'], 'yafi');
  assert.equal(realEmpMap['13'], 'meli');
  assert.equal(realEmpMap['14'], 'epik');
  assert.equal(realEmpMap['15'], 'miftah');
  assert.equal(realEmpMap['6'], 'hamam');
  assert.equal(realEmpMap['10'], 'PaAli');

  // 4. Punches & Days
  const { dailyRecords, stats } = tegalParser.extractDailyPunches(wb, period);
  assert.equal(stats.totalRawPunchesCount, 416);
  assert.equal(stats.totalDistinctPunchesCount, 411);
  assert.equal(stats.doubleTapsCount, 5);
  assert.equal(stats.employeeDaysWithAttendance, 192);

  // 5. Sample Ahmad 2026-08-26
  const ahmadRecord = dailyRecords.find(r => r.external_employee_id === '1' && r.attendance_date === '2026-08-26');
  assert.ok(ahmadRecord);
  assert.equal(ahmadRecord.first_check_in, '09:59');
  assert.equal(ahmadRecord.last_check_out, '20:56');
  assert.deepEqual(ahmadRecord.raw_punches, ['09:59', '14:53', '15:22', '20:56']);
  assert.deepEqual(ahmadRecord.all_raw_punches, ['09:59', '14:53', '15:22', '20:56']);
});
