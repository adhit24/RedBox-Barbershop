'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-09-19-harden-sync-moka-csv-columns.sql'), 'utf8');
const mirror = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260919_harden_sync_moka_csv_columns.sql'), 'utf8');

test('trigger migration only replaces the function and keeps a fixed search_path', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.sync_moka_csv_columns\(\)/);
  assert.match(sql, /SET search_path = public/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|DROP TABLE|DELETE FROM|UPDATE public\./i);
});

test('full-CSV branch requires Receipt Number, Date and Outlet before legacy normalization', () => {
  assert.match(sql, /"Receipt Number"\), ''\) is null then\s+return new/);
  assert.match(sql, /nullif\(trim\(new\."Date"\), ''\) is not null\s+and nullif\(trim\(new\."Outlet"\), ''\) is not null/);
  assert.match(sql, /coalesce\(new\."Net Sales", 0\)/);
});

test('partial/API branch never assigns NULL from an absent CSV field', () => {
  const partial = sql.slice(sql.indexOf('-- API row or partial CSV row'));
  const assignments = partial.match(/new\.\w+ := [^;]+;/g) || [];
  assert.ok(assignments.length >= 8);
  assert.equal(assignments.some(a => /:= new\."[^"]+";/.test(a) && !/if new\./.test(partial)), false);
  for (const field of ['Outlet', 'Date', 'Time', 'Net Sales', 'Gross Sales', 'Total Collected', 'Payment Method', 'Collected By', 'Items']) {
    assert.match(partial, new RegExp(`if [^\n]*new\."${field}"[^\n]*(is not null|null)`), `${field} must be guarded`);
  }
});

test('supabase migration mirrors the server migration', () => {
  assert.equal(mirror, sql);
});
