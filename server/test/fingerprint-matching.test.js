'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const importer = require('../services/fingerprintAttendanceImporter');

test('Fingerprint Matching: Priority 1 - Deterministic Identity Mapping', () => {
  const fileEmployees = [
    { external_employee_id: '99', external_name: 'Custom Nick' },
  ];
  const dbEmployees = [
    { id: 'emp-uuid-1', name: 'Original Name', nickname: null },
  ];
  const existingIdentities = [
    {
      source: 'fingerprint',
      external_employee_id: '99',
      target_type: 'employee',
      employee_id: 'emp-uuid-1',
      external_name: 'Custom Nick',
    },
  ];

  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers: [],
    existingIdentities,
  });

  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(matched[0].match_type, 'identity_mapping');
  assert.equal(matched[0].employee_id, 'emp-uuid-1');
});

test('Fingerprint Matching: Priority 2 - Employee Code', () => {
  const fileEmployees = [
    { external_employee_id: 'RB-042', external_name: 'Budi' },
  ];
  const dbEmployees = [
    { id: 'emp-uuid-2', employee_code: 'RB-042', name: 'Budi Santoso', nickname: null },
  ];

  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers: [],
    existingIdentities: [],
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0].match_type, 'employee_code');
  assert.equal(matched[0].employee_id, 'emp-uuid-2');
});

test('Fingerprint Matching: Priority 3 - Normalized Whitespace / Case Exact Match', () => {
  // Test case from user prompt: "Rizki Adi" in DB vs "RizkiAdi" in fingerprint
  const fileEmployees = [
    { external_employee_id: '22', external_name: 'RizkiAdi' },
  ];
  const dbEmployees = [
    { id: 'emp-uuid-3', name: 'Rizki Adi Nugroho', nickname: 'Rizki Adi' },
  ];

  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers: [],
    existingIdentities: [],
  });

  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(matched[0].match_type, 'normalized_exact_employee');
  assert.equal(matched[0].employee_id, 'emp-uuid-3');
});

test('Fingerprint Matching: Rejects Fuzzy Guessing (Yuda != Yudha, Rizki != Rizky)', () => {
  const fileEmployees = [
    { external_employee_id: '3', external_name: 'Yuda' },
    { external_employee_id: '4', external_name: 'Rizki' },
  ];
  const dbBarbers = [
    { id: 'csb-yudha', name: 'Yudha', branch: 'csb' },
  ];
  const dbEmployees = [
    { id: 'emp-rizky', name: 'Rizky Pratama', nickname: 'Rizky' },
  ];

  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers,
    existingIdentities: [],
  });

  // Neither should be auto-matched! Both must be UNMATCHED for manual review
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 2);
  assert.equal(unmatched[0].external_name, 'Yuda');
  assert.equal(unmatched[0].reason, 'unresolved_employee');
  assert.equal(unmatched[1].external_name, 'Rizki');
  assert.equal(unmatched[1].reason, 'unresolved_employee');
});

test('Fingerprint Matching: Ambiguous Multiple Matches Flagged as UNMATCHED', () => {
  const fileEmployees = [
    { external_employee_id: '15', external_name: 'Agus' },
  ];
  const dbEmployees = [
    { id: 'emp-agus-1', name: 'Agus Setiawan', nickname: 'Agus' },
    { id: 'emp-agus-2', name: 'Agus Habibi', nickname: 'Agus' },
  ];

  const { matched, unmatched } = importer.matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers: [],
    existingIdentities: [],
  });

  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, 'ambiguous_name_match');
  assert.equal(unmatched[0].candidate_matches.length, 2);
});
