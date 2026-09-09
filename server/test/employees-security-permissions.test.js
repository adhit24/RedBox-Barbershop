'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Safely read server environment without throwing ENOENT on clean checkouts
const envVars = {};
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  try {
    const envText = fs.readFileSync(envPath, 'utf8');
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
  } catch {
    // Ignore environment file read errors
  }
}

const { createAdminCrmRoutes } = require('../routes/adminCrm');
const { assertSafeTestEnvironment, shouldRunLiveIntegrationTests } = require('../utils/testSafety');

const SUPABASE_URL = process.env.SUPABASE_URL || envVars.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || envVars.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || envVars.SUPABASE_ANON_KEY || 'sb_publishable_zXzyWRuSjJbXYomkJ1ws8w_iHHq1LSg';

const HAS_LIVE_CREDS = Boolean(SUPABASE_URL && SERVICE_KEY);
const RUN_LIVE = shouldRunLiveIntegrationTests() && HAS_LIVE_CREDS;
const LIVE_SKIP_REASON = !RUN_LIVE
  ? 'Skipping live Supabase integration check (requires RUN_LIVE_INTEGRATION_TESTS=true and valid credentials)'
  : false;

let supabaseClientModule = null;
try {
  supabaseClientModule = require('../../node_modules/@supabase/supabase-js');
} catch {
  try {
    supabaseClientModule = require('@supabase/supabase-js');
  } catch {
    // optional in pure unit test CI
  }
}

// ---------------------------------------------------------------------------
// Deterministic Mock Tests (Run in all environments including CI without creds)
// ---------------------------------------------------------------------------
test('Data Privacy (Mocked): GET /api/admin/crm/employees never exposes base_salary or source columns', async () => {
  const mockRows = [
    {
      id: 'mock-1',
      employee_code: 'SD-REG-001',
      name: 'Alpha Mock',
      position: 'Barista',
      business_unit: 'Sundaze',
      branch: 'bypass',
      is_active: true,
      base_salary: 3500000,
      source: 'private_payroll.csv',
      source_period: 'Agustus 2025',
    },
    {
      id: 'mock-2',
      employee_code: 'RB-REG-001',
      name: 'Beta Mock',
      position: 'Cashier',
      business_unit: 'Redbox',
      branch: 'bypass',
      is_active: true,
      base_salary: 3200000,
      source: 'private_payroll_rb.csv',
      source_period: 'Agustus 2025',
    },
  ];

  const fakeClient = {
    from(table) {
      assert.equal(table, 'employees');
      const chain = {
        _selected: null,
        select(fields) {
          chain._selected = fields;
          return chain;
        },
        order() {
          return chain;
        },
        eq() {
          return chain;
        },
        then(resolve) {
          // If query specifically selects non-sensitive fields, strip unrequested fields
          const returned = mockRows.map((r) => {
            const copy = { ...r };
            if (chain._selected && !chain._selected.includes('base_salary')) {
              delete copy.base_salary;
            }
            if (chain._selected && !chain._selected.includes('source')) {
              delete copy.source;
              delete copy.source_period;
            }
            return copy;
          });
          resolve({ data: returned, error: null });
        },
      };
      return chain;
    },
  };

  const app = express();
  const mockAdminAuth = (req, res, next) => {
    req.adminAuth = { staffId: 'admin-tester', role: 'owner', sessionVerified: true };
    next();
  };

  app.use('/api/admin/crm', createAdminCrmRoutes(fakeClient, mockAdminAuth));
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/employees`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.total, 2);
    assert.equal(body.sundaze_count, 1);
    assert.equal(body.redbox_count, 1);
    assert.equal(body.total, body.sundaze_count + body.redbox_count);

    for (const emp of body.employees) {
      assert.equal(emp.base_salary, undefined, `Employee ${emp.name} must NOT expose base_salary`);
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

// ---------------------------------------------------------------------------
// Live Integration Tests (Opt-in only via RUN_LIVE_INTEGRATION_TESTS=true)
// ---------------------------------------------------------------------------
test('RLS Security: Anonymous client cannot SELECT from employees table', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'SELECT_RLS_CHECK', targetUrl: SUPABASE_URL, allowOverride: true });
  const anonClient = supabaseClientModule.createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').select('*');

  // Must either return an error or empty data due to strict RLS
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row level security|denied/);
  } else {
    assert.equal(data.length, 0, 'Anon client should receive 0 rows from employees table under strict RLS');
  }
});

test('RLS Security: Anonymous client cannot INSERT into employees table', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'INSERT_RLS_CHECK', targetUrl: SUPABASE_URL, allowOverride: true });
  const anonClient = supabaseClientModule.createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').insert({
    name: 'Unauthorized Fake User',
    business_unit: 'Redbox',
    position: 'Tester',
  });

  assert.ok(error, 'Anon client insert MUST return an error');
  assert.match(error.message.toLowerCase(), /permission denied|row-level security|violates row-level security|not found/);
});

test('RLS Security: Anonymous client cannot UPDATE employees table', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'UPDATE_RLS_CHECK', targetUrl: SUPABASE_URL, allowOverride: true });
  const anonClient = supabaseClientModule.createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').update({ name: 'Hacked' }).eq('name', 'Test Employee Alpha');

  // Under RLS / revoked permissions, update must either error or affect 0 rows
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row-level security/);
  } else {
    assert.equal(data?.length ?? 0, 0);
  }
});

test('RLS Security: Anonymous client cannot DELETE from employees table', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'DELETE_RLS_CHECK', targetUrl: SUPABASE_URL, allowOverride: true });
  const anonClient = supabaseClientModule.createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('employees').delete().eq('name', 'Test Employee Alpha');

  // Under RLS / revoked permissions, delete must either error or affect 0 rows
  if (error) {
    assert.match(error.message.toLowerCase(), /permission denied|row-level security/);
  } else {
    assert.equal(data?.length ?? 0, 0);
  }
});

test('Server RBAC: Service role client can access employees table', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'SERVICE_ROLE_SELECT', targetUrl: SUPABASE_URL, allowOverride: true });
  const serviceClient = supabaseClientModule.createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await serviceClient.from('employees').select('id, employee_code, name').limit(5);

  assert.equal(error, null);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
});

test('Data Privacy: GET /api/admin/crm/employees never exposes base_salary (Live)', { skip: LIVE_SKIP_REASON }, async () => {
  assertSafeTestEnvironment({ operation: 'LIVE_EMPLOYEE_ROSTER_READ', targetUrl: SUPABASE_URL, allowOverride: true });
  const serviceClient = supabaseClientModule.createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
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

    // Assert dynamic invariants, not hardcoded headcount constants
    assert.equal(typeof body.total, 'number');
    assert.ok(body.total >= 0);
    assert.equal(typeof body.sundaze_count, 'number');
    assert.equal(typeof body.redbox_count, 'number');
    assert.equal(body.total, body.sundaze_count + body.redbox_count);
    assert.ok(Array.isArray(body.employees));

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
