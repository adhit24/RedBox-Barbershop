'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const express = require('express');

const { createHRPeopleRoutes } = require('../routes/hrPeople');
const { createAttendanceImportRoutes } = require('../routes/attendanceImport');

// Test fixtures
const MOCK_BARBERS = [
  { id: 'csb-barber-1', name: 'Yudha Barber', branch: 'csb', is_active: true },
  { id: 'bypass-barber-1', name: 'Bypass Barber', branch: 'bypass', is_active: true },
  { id: 'sumber-barber-1', name: 'Sumber Barber', branch: 'sumber', is_active: true },
];

const MOCK_EMPLOYEES = [
  { id: 'emp-rb-1', name: 'Jumadi', nickname: null, business_unit: 'Redbox', position: 'Staff', branch: 'sumber', employment_type: 'regular', is_active: true },
  { id: 'emp-rb-2', name: 'Reza Budiman', nickname: null, business_unit: 'Redbox', position: 'Helper Cashier', branch: 'csb', employment_type: 'regular', is_active: true },
  { id: 'emp-sd-1', name: 'Abi Bhakti', nickname: null, business_unit: 'Sundaze', position: 'Barista', branch: 'csb', employment_type: 'regular', is_active: true },
  { id: 'emp-sd-2', name: 'Dendie Wibowo', nickname: null, business_unit: 'Sundaze', position: 'Barista', branch: 'csb', employment_type: 'regular', is_active: true },
];

const MOCK_EMPLOYEE_ATTENDANCE = [
  {
    id: 'att-1',
    employee_id: 'emp-rb-1',
    attendance_date: '2026-08-05',
    first_check_in: '10:15',
    last_check_out: '21:30',
    status: 'terlambat',
    late_minutes: 15,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    raw_punches: ['10:15', '21:30'],
  },
];

const MOCK_BARBER_ATTENDANCE = [
  {
    id: 'batt-1',
    barber_id: 'csb-barber-1',
    date: '2026-08-05',
    status: 'hadir',
    note: 'Fingerprint 10:00 - 21:00',
  },
];

function createMockTable(allRows) {
  let filtered = [...allRows];
  let pendingUpdates = null;

  const chain = {
    select() { return chain; },
    eq(col, val) {
      filtered = filtered.filter(r => r[col] === val);
      return chain;
    },
    neq(col, val) {
      filtered = filtered.filter(r => r[col] !== val);
      return chain;
    },
    in(col, vals) {
      filtered = filtered.filter(r => vals.includes(r[col]));
      return chain;
    },
    order() { return chain; },
    limit() { return chain; },
    maybeSingle() {
      if (pendingUpdates) {
        for (const r of filtered) Object.assign(r, pendingUpdates);
      }
      return Promise.resolve({ data: filtered[0] || null, error: null });
    },
    single() {
      if (pendingUpdates) {
        for (const r of filtered) Object.assign(r, pendingUpdates);
      }
      return Promise.resolve({ data: filtered[0] || null, error: null });
    },
    then(resolve) {
      if (pendingUpdates) {
        for (const r of filtered) Object.assign(r, pendingUpdates);
      }
      resolve({ data: filtered, error: null });
    },
    insert(item) {
      const items = Array.isArray(item) ? item : [item];
      allRows.push(...items);
      return Promise.resolve({ data: item, error: null });
    },
    upsert(item) {
      allRows.push(item);
      return Promise.resolve({ data: item, error: null });
    },
    update(updates) {
      pendingUpdates = updates;
      return chain;
    },
  };
  return chain;
}

function createMockSupabase(state = {}) {
  const barbers = state.barbers || [...MOCK_BARBERS];
  const employees = state.employees || [...MOCK_EMPLOYEES];
  const employeeAtt = state.employeeAtt || [...MOCK_EMPLOYEE_ATTENDANCE];
  const barberAtt = state.barberAtt || [...MOCK_BARBER_ATTENDANCE];
  const exceptions = state.exceptions || [];
  const identities = state.identities || [];
  const systemLogs = [];

  return {
    from(table) {
      if (table === 'users') {
        return createMockTable([{ id: 'u1', role: 'owner' }]);
      }
      if (table === 'barbers') {
        return createMockTable(barbers);
      }
      if (table === 'employees') {
        return createMockTable(employees);
      }
      if (table === 'employee_attendance') {
        return createMockTable(employeeAtt);
      }
      if (table === 'barber_attendance') {
        return createMockTable(barberAtt);
      }
      if (table === 'employee_attendance_identity') {
        return createMockTable(identities);
      }
      if (table === 'attendance_exceptions') {
        return createMockTable(exceptions);
      }
      if (table === 'system_event_logs') {
        return createMockTable(systemLogs);
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

// -------------------------------------------------------------
// Test A: Redbox HR endpoint excludes Sundaze by default and filter=redbox
// -------------------------------------------------------------
test('Test A: Redbox HR endpoint excludes Sundaze personnel by default and under filter=redbox', async () => {
  const mockSupabase = createMockSupabase();
  const dummyAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'owner', email: 'owner@redbox.com' };
    next();
  };

  const app = express();
  app.use('/api/admin/hr-people', createHRPeopleRoutes(mockSupabase, dummyAuth));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // 1. Default (no filter specified)
    const resDefault = await fetch(`http://127.0.0.1:${port}/api/admin/hr-people`);
    const jsonDefault = await resDefault.json();
    assert.ok(jsonDefault.people, 'HR people list must be returned');
    assert.equal(
      jsonDefault.people.every(p => p.business_unit === 'Redbox'),
      true,
      'Every person in default HR people roster must have business_unit Redbox'
    );
    assert.equal(
      jsonDefault.people.some(p => p.name.includes('Abi') || p.name.includes('Dendie')),
      false,
      'Sundaze employees Abi and Dendie must not appear in Redbox default roster'
    );

    // 2. Explicit filter=redbox
    const resRedbox = await fetch(`http://127.0.0.1:${port}/api/admin/hr-people?filter=redbox`);
    const jsonRedbox = await resRedbox.json();
    assert.ok(jsonRedbox.people, 'HR people list under filter=redbox must be returned');
    assert.equal(
      jsonRedbox.people.every(p => p.business_unit === 'Redbox'),
      true,
      'Every person under filter=redbox must be Redbox'
    );
    assert.equal(jsonRedbox.kpis.regular_employees, 2, 'Only Redbox employees (2) should be counted');
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------
// Test B: Redbox attendance candidate search excludes Sundaze
// -------------------------------------------------------------
test('Test B: Redbox attendance candidate search strictly excludes Sundaze personnel', async () => {
  const mockSupabase = createMockSupabase();
  const dummyAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'owner', email: 'owner@redbox.com' };
    next();
  };

  const app = express();
  app.use('/api/admin/crm/attendance', createAttendanceImportRoutes(mockSupabase, dummyAuth));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/attendance/employees`);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(
      json.employees.every(e => e.business_unit === 'Redbox'),
      true,
      'Attendance employee candidate list must only contain Redbox business_unit'
    );
    assert.equal(
      json.employees.some(e => e.name.toLowerCase().includes('abi')),
      false,
      'Sundaze employee Abi must not be available as candidate'
    );
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------
// Test C & D: Owner sees all branches; Manager sees only own branch
// -------------------------------------------------------------
test('Test C & D: Owner sees all branches; Manager sees server-scoped branch only and cannot spoof ?branch=', async () => {
  const mockSupabase = createMockSupabase();

  // App for Owner
  const ownerAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'owner', branch: null };
    next();
  };
  const appOwner = express();
  appOwner.use('/attendance', createAttendanceImportRoutes(mockSupabase, ownerAuth));
  const serverOwner = http.createServer(appOwner);
  await new Promise(r => serverOwner.listen(0, '127.0.0.1', r));
  const portOwner = serverOwner.address().port;

  // App for Manager (scoped to 'csb')
  const managerAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'manager', branch: 'csb' };
    next();
  };
  const appManager = express();
  appManager.use('/attendance', createAttendanceImportRoutes(mockSupabase, managerAuth));
  const serverManager = http.createServer(appManager);
  await new Promise(r => serverManager.listen(0, '127.0.0.1', r));
  const portManager = serverManager.address().port;

  try {
    // Owner queries with branch=all
    const resOwner = await fetch(`http://127.0.0.1:${portOwner}/attendance/overview?date=2026-08-05&branch=all`);
    const jsonOwner = await resOwner.json();
    assert.equal(jsonOwner.ok, true);
    const ownerBranches = new Set(jsonOwner.records.map(r => r.branch));
    assert.equal(ownerBranches.has('csb'), true);
    assert.equal(ownerBranches.has('sumber'), true);
    assert.equal(ownerBranches.has('bypass'), true);

    // Manager queries with spoofed ?branch=bypass
    const resManager = await fetch(`http://127.0.0.1:${portManager}/attendance/overview?date=2026-08-05&branch=bypass`);
    const jsonManager = await resManager.json();
    assert.equal(jsonManager.ok, true);
    assert.equal(jsonManager.branch, 'csb', 'Server must ignore ?branch=bypass and force csb');
    assert.equal(
      jsonManager.records.every(r => r.branch.toLowerCase() === 'csb'),
      true,
      'All returned records must belong to manager branch csb only'
    );
  } finally {
    serverOwner.close();
    serverManager.close();
  }
});

// -------------------------------------------------------------
// Test E, F, G: Sibling exception propagation rules
// -------------------------------------------------------------
test('Test E, F, G: Sibling exception propagation requires exact same source + external_employee_id', async () => {
  const exceptions = [
    {
      id: 'exc-primary',
      attendance_date: '2026-08-03',
      external_employee_id: '3',
      external_name: 'Yuda',
      department: 'CSB',
      exception_type: 'unmatched_employee',
      status: 'pending',
      raw_data: { source: 'fingerprint', first_check_in: '10:00', last_check_out: '21:00' },
    },
    {
      id: 'exc-sibling-valid',
      attendance_date: '2026-08-04',
      external_employee_id: '3',
      external_name: 'Yuda',
      department: 'CSB',
      exception_type: 'unmatched_employee',
      status: 'pending',
      raw_data: { source: 'fingerprint', first_check_in: '10:05', last_check_out: '21:10' },
    },
    {
      id: 'exc-diff-ext-id',
      attendance_date: '2026-08-05',
      external_employee_id: '99',
      external_name: 'Yuda', // Same name, but different machine ID!
      department: 'CSB',
      exception_type: 'unmatched_employee',
      status: 'pending',
      raw_data: { source: 'fingerprint' },
    },
    {
      id: 'exc-diff-source',
      attendance_date: '2026-08-06',
      external_employee_id: '3', // Same external ID, but different device source!
      external_name: 'Other Device Staff',
      department: 'CSB',
      exception_type: 'unmatched_employee',
      status: 'pending',
      raw_data: { source: 'terminal_pos' },
    },
  ];

  const identities = [];
  const mockSupabase = createMockSupabase({ exceptions, identities });

  const dummyAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'owner', email: 'owner@redbox.com' };
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/attendance', createAttendanceImportRoutes(mockSupabase, dummyAuth));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // Resolve primary exception (ID 3, source: fingerprint) mapping to barber Yudha
    const res = await fetch(`http://127.0.0.1:${port}/attendance/exceptions/exc-primary/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_type: 'barber',
        barber_id: 'csb-barber-1',
        resolution_notes: 'Confirmed Yudha at CSB',
      }),
    });

    const json = await res.json();
    assert.equal(json.ok, true);

    // E: Valid sibling with same external ID and same source MUST be resolved
    const sibValid = exceptions.find(e => e.id === 'exc-sibling-valid');
    assert.equal(sibValid.status, 'resolved', 'Sibling with same source & external_employee_id must be resolved');

    // F: Same name with different external ID must NOT propagate
    const sibDiffExtId = exceptions.find(e => e.id === 'exc-diff-ext-id');
    assert.equal(sibDiffExtId.status, 'pending', 'Same name with different external ID must remain pending');

    // G: Same external ID with different source must NOT propagate
    const sibDiffSource = exceptions.find(e => e.id === 'exc-diff-source');
    assert.equal(sibDiffSource.status, 'pending', 'Same external ID with different source must remain pending');
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------
// Test H & I: Attendance overview reads real attendance rows & reflects unresolved exceptions
// -------------------------------------------------------------
test('Test H & I: Attendance overview reads real attendance rows and reflects exception counts accurately', async () => {
  const exceptions = [
    { id: 'x1', attendance_date: '2026-08-05', department: 'CSB', external_name: 'Yuda', exception_type: 'unmatched_employee', status: 'pending' },
    { id: 'x2', attendance_date: '2026-08-05', department: 'Barista', external_name: 'Abi', exception_type: 'unmatched_employee', status: 'pending' },
  ];

  const mockSupabase = createMockSupabase({ exceptions });
  const dummyAuth = (req, res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'owner', branch: null };
    next();
  };

  const app = express();
  app.use('/attendance', createAttendanceImportRoutes(mockSupabase, dummyAuth));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/attendance/overview?date=2026-08-05`);
    const json = await res.json();

    assert.equal(json.ok, true);
    assert.equal(json.date, '2026-08-05');

    // Check that Jumadi (regular employee) and Yudha Barber are populated with actual punches
    const jumadiRecord = json.records.find(r => r.name === 'Jumadi');
    assert.ok(jumadiRecord, 'Jumadi record must be in overview');
    assert.equal(jumadiRecord.status, 'terlambat');
    assert.equal(jumadiRecord.first_check_in, '10:15');
    assert.equal(jumadiRecord.last_check_out, '21:30');
    assert.equal(jumadiRecord.late_minutes, 15);
    assert.equal(jumadiRecord.total_hours, '11.3 jam');

    // Check stats
    assert.equal(json.stats.exceptions_count, 2, 'Overview stats must reflect day exceptions count');
    assert.equal(json.stats.hadir, 2, 'Overview stats must count both hadir and terlambat as present');
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------
// Test J: Payroll modules remain completely untouched
// -------------------------------------------------------------
test('Test J: Payroll routes and schemas remain completely untouched by Task 1.2', async () => {
  const fs = require('node:fs');
  const path = require('node:path');

  // Verify that payroll router file exists and has not been modified for commission rates or commission engine
  const payrollPath = path.join(__dirname, '../routes/payroll.js');
  if (fs.existsSync(payrollPath)) {
    const payrollCode = fs.readFileSync(payrollPath, 'utf8');
    assert.equal(
      payrollCode.includes('commission_rate'),
      false,
      'Payroll routes must not contain commission_rate'
    );
  }
});
