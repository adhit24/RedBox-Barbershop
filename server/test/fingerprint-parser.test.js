'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const importer = require('../services/fingerprintAttendanceImporter');

// Path to real sample reference file
const SAMPLE_PATH = 'C:/Users/Win11/Downloads/1_StandardReport-51.xls';

test('Fingerprint Parser: File Safety & Signature Validation', (t) => {
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);

  // Valid .xls file
  const meta = importer.validateFileSafety(sampleBuf, '1_StandardReport-51.xls');
  assert.equal(meta.cleanFilename, '1_StandardReport-51.xls');
  assert.equal(meta.isXls, true);
  assert.equal(meta.isXlsx, false);
  assert.equal(meta.fileHash.length, 64);

  // Reject invalid extension
  assert.throws(
    () => importer.validateFileSafety(sampleBuf, 'attendance.csv'),
    (err) => err.code === 'INVALID_FILE_EXTENSION'
  );
  assert.throws(
    () => importer.validateFileSafety(sampleBuf, 'attendance.pdf'),
    (err) => err.code === 'INVALID_FILE_EXTENSION'
  );

  // Reject invalid magic bytes (e.g. text or image masquerading as .xls)
  const fakeXls = Buffer.from('Name,Date,Punch\nJohn,2026-08-01,09:00');
  assert.throws(
    () => importer.validateFileSafety(fakeXls, 'fake.xls'),
    (err) => err.code === 'INVALID_FILE_SIGNATURE'
  );

  // Reject oversized file (> 10MB)
  const hugeBuf = Buffer.alloc(11 * 1024 * 1024);
  assert.throws(
    () => importer.validateFileSafety(hugeBuf, 'huge.xls'),
    (err) => err.code === 'FILE_TOO_LARGE'
  );
});

test('Fingerprint Parser: Real XLS Workbook Parsing & Format Detection', (t) => {
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);
  const wb = importer.parseWorkbook(sampleBuf);
  assert.ok(wb);
  assert.ok(wb.SheetNames.length >= 4);

  const format = importer.detectReportFormat(wb);
  assert.equal(format.hasStatAbsen, true);
  assert.equal(format.hasLogAbsen, true);
  assert.equal(format.hasExceptionStat, true);
  assert.equal(format.hasJadwalInfo, true);
});

test('Fingerprint Parser: Period Extraction from Real Reference XLS', (t) => {
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);
  const wb = importer.parseWorkbook(sampleBuf);
  const period = importer.extractReportPeriod(wb);

  assert.equal(period.from, '2026-08-01');
  assert.equal(period.to, '2026-08-24');
});

test('Fingerprint Parser: Employee Detection from Real Reference XLS', (t) => {
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);
  const wb = importer.parseWorkbook(sampleBuf);
  const emps = importer.extractEmployees(wb);

  assert.equal(emps.length, 16);

  const names = emps.map(e => e.external_name);
  assert.ok(names.includes('Refal'));
  assert.ok(names.includes('Abi'));
  assert.ok(names.includes('Yuda'));
  assert.ok(names.includes('Reza'));
  assert.ok(names.includes('Sarif'));
  assert.ok(names.includes('Husen'));
  assert.ok(names.includes('Ragil'));
  assert.ok(names.includes('Ega'));
  assert.ok(names.includes('Ubay'));
  assert.ok(names.includes('Dede'));
  assert.ok(names.includes('Jumadi'));
  assert.ok(names.includes('Nadi'));
  assert.ok(names.includes('Dendi'));
  assert.ok(names.includes('RizkiAdi'));
  assert.ok(names.includes('Indra'));
  assert.ok(names.includes('Aziz'));

  // Verify external IDs
  const empMap = Object.fromEntries(emps.map(e => [e.external_employee_id, e]));
  assert.equal(empMap['1'].external_name, 'Refal');
  assert.equal(empMap['22'].external_name, 'RizkiAdi');
  assert.equal(empMap['69'].external_name, 'Indra');
  assert.equal(empMap['13'].external_name, 'Ubay');
});

test('Fingerprint Parser: Daily Punch Timestamp Extraction', (t) => {
  const sampleBuf = fs.readFileSync(SAMPLE_PATH);
  const wb = importer.parseWorkbook(sampleBuf);
  const period = importer.extractReportPeriod(wb);
  const punches = importer.extractDailyPunches(wb, period);

  assert.ok(punches.length > 200, `Expected > 200 daily records, got ${punches.length}`);

  // Inspect specific employee punches (e.g. Yuda on 2026-08-04)
  const yudaRecord = punches.find(p => p.external_employee_id === '3' && p.attendance_date === '2026-08-04');
  assert.ok(yudaRecord);
  assert.ok(yudaRecord.raw_punches.length >= 2);
  assert.equal(yudaRecord.first_check_in, '13:57');
  assert.equal(yudaRecord.last_check_out, '21:31');
  assert.equal(yudaRecord.late_minutes, 297);

  // Verify raw punch timestamps are preserved as valid HH:MM strings
  for (const r of punches) {
    for (const punch of r.raw_punches) {
      assert.match(punch, /^\d{1,2}:\d{2}$/);
    }
  }
});
