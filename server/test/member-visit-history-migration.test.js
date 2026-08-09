'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-08-09-member-visit-history.sql');

test('member_visit_history migration defines the expected table shape', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS (?:public\.)?member_visit_history/i);
  assert.match(sql, /user_key\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /receipt_number\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  assert.match(sql, /outlet_slug\s+TEXT/i);
  assert.match(sql, /visit_date\s+DATE\s+NOT NULL/i);
  assert.match(sql, /visit_time\s+TEXT/i);
  assert.match(sql, /service_summary\s+TEXT/i);
  assert.match(sql, /amount\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i);
  assert.match(sql, /points_earned\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i);
  assert.match(sql, /CREATE INDEX.*member_visit_history.*user_key.*visit_date/is);
});

test('member_visit_history migration follows the codebase RLS convention', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE (?:public\.)?member_visit_history ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM PUBLIC/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM anon/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE (?:public\.)?member_visit_history TO service_role/i);
});
