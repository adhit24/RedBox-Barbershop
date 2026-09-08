'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Read server environment
const envPath = path.resolve(__dirname, '../.env');
const envText = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envText.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const idx = t.indexOf('=');
  if (idx !== -1) {
    let v = t.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    envVars[t.slice(0, idx).trim()] = v;
  }
}

const { createClient } = require('../../node_modules/@supabase/supabase-js');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

const SUPABASE_URL = envVars.SUPABASE_URL;
const SERVICE_KEY = envVars.SUPABASE_SERVICE_KEY;
const ANON_KEY = envVars.SUPABASE_ANON_KEY || 'sb_publishable_zXzyWRuSjJbXYomkJ1ws8w_iHHq1LSg';

test('RLS Security: Anonymous client cannot SELECT from employees table', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').select('*');

  // Must either return an error or empty data due to strict RLS
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row level security|denied/);
  } else {
    assert.equal(data.length, 0, 'Anon client should receive 0 rows from employees table under strict RLS');
  }
});

test('RLS Security: Anonymous client cannot INSERT into employees table', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').insert({
    name: 'Unauthorized Fake User',
    business_unit: 'Redbox',
    position: 'Tester',
  });

  assert.ok(error, 'Anon client insert MUST return an error');
  assert.match(error.message.toLowerCase(), /permission denied|row-level security|violates row-level security|not found/);
});

test('RLS Security: Anonymous client cannot UPDATE employees table', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').update({ name: 'Hacked' }).eq('name', 'Test Employee Alpha');

  // Under RLS / revoked permissions, update must either error or affect 0 rows
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row-level security/);
  } else {
    assert.equal(data?.length ?? 0, 0);
  }
});

test('RLS Security: Anonymous client cannot DELETE from employees table', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').delete().eq('name', 'Test Employee Alpha');

  // Under RLS / revoked permissions, delete must either error or affect 0 rows
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row-level security/);
  } else {
    assert.equal(data?.length ?? 0, 0);
  }
});

test('Server RBAC: Service role client can access employees table', async () => {
  const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await serviceClient.from('employees').select('id, employee_code, name').limit(5);

  assert.equal(error, null);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
});

test('Data Privacy: GET /api/admin/crm/employees never exposes base_salary', async () => {
  const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const app = express();
  const mockAdminAuth = (req, res, next) => {
    req.adminAuth = { staffId: 'admin-tester', role: 'owner', sessionVerified: true };
    next();
  };

  app.use('/api/admin/crm', createAdminCrmRoutes(serviceClient, mockAdminAuth));
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.total, 39);
    assert.equal(body.sundaze_count, 23);
    assert.equal(body.redbox_count, 16);

    for (const emp of body.employees) {
      assert.equal(emp.base_salary, undefined, `Employee ${emp.name} must NOT expose base_salary in general HR roster`);
      assert.equal(emp.source, undefined, `Employee ${emp.name} must NOT expose raw source file`);
      assert.equal(emp.source_period, undefined, `Employee ${emp.name} must NOT expose raw source period`);
      assert.ok(emp.id, 'Must have id');
      assert.ok(emp.name, 'Must have name');
      assert.ok(emp.position, 'Must have position');
      assert.ok(emp.business_unit, 'Must have business_unit');
    }
  } finally {
    server.close();
  }
});
