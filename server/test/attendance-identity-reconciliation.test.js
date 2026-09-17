'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAttendanceImportRoutes } = require('../routes/attendanceImport');
const { matchEmployees, previewImport, commitImport } = require('../services/fingerprintAttendanceImporter');
const path = require('node:path');
const fs = require('node:fs');

function createMockDb() {
  const store = {
    users: [
      { id: 'user-owner', role: 'owner', email: 'adhit24@gmail.com', branch: null },
      { id: 'user-mgr-csb', role: 'manager', email: 'manager.csb@redbox.com', branch: 'csb' },
      { id: 'user-mgr-kng', role: 'manager', email: 'manager.kng@redbox.com', branch: 'kuningan' },
      { id: 'user-cashier', role: 'cashier', email: 'cashier@redbox.com', branch: 'csb' },
    ],
    employees: [
      { id: 'emp-reza', employee_code: '7', name: 'Reza Budiman', nickname: 'Reza', position: 'Helper Cashier', branch: 'csb', business_unit: 'Redbox', is_active: true },
      { id: 'emp-kng', employee_code: '99', name: 'Kuningan Staff', nickname: 'Staff', position: 'Staff', branch: 'kuningan', business_unit: 'Redbox', is_active: true },
    ],
    barbers: [
      { id: 'csb-yudha', name: 'Yudha', branch: 'csb', is_active: true },
      { id: 'kng-asep', name: 'Asep', branch: 'kuningan', is_active: true },
    ],
    employee_attendance_identity: [],
    attendance_import_batches: [],
    employee_attendance: [],
    attendance_exceptions: [],
    barber_attendance: [],
    system_event_logs: [],
  };

  return {
    store,
    auth: {
      async getUser(token) {
        if (token === 'tok-owner') return { data: { user: store.users[0] }, error: null };
        if (token === 'tok-mgr-csb') return { data: { user: store.users[1] }, error: null };
        if (token === 'tok-mgr-kng') return { data: { user: store.users[2] }, error: null };
        if (token === 'tok-cashier') return { data: { user: store.users[3] }, error: null };
        return { data: { user: null }, error: new Error('Invalid token') };
      },
    },
    from(table) {
      const records = store[table] || [];
      return {
        select(cols = '*') {
          let filtered = [...records];
          const query = {
            eq(col, val) {
              filtered = filtered.filter(r => r[col] === val);
              return query;
            },
            neq(col, val) {
              filtered = filtered.filter(r => r[col] !== val);
              return query;
            },
            in(col, vals) {
              filtered = filtered.filter(r => vals.includes(r[col]));
              return query;
            },
            order() {
              return query;
            },
            limit(n) {
              filtered = filtered.slice(0, n);
              return query;
            },
            maybeSingle: async () => ({ data: filtered[0] || null, error: null }),
            single: async () => ({ data: filtered[0] || null, error: null }),
            then: (res) => res({ data: filtered, error: null }),
          };
          return query;
        },
        insert(rows) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const created = arr.map((r, i) => ({ id: r.id || `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`, ...r }));
          records.push(...created);
          return {
            select() {
              return {
                single: async () => ({ data: created[0], error: null }),
              };
            },
            then: (res) => res({ data: created, error: null }),
          };
        },
        upsert(rows, opts = {}) {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const r of arr) {
            const conflictCols = (opts.onConflict || '').split(',').map(c => c.trim());
            const idx = records.findIndex(existing =>
              conflictCols.every(c => existing[c] === r[c])
            );
            if (idx >= 0) {
              records[idx] = { ...records[idx], ...r };
            } else {
              records.push({ id: r.id || `upsert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...r });
            }
          }
          return {
            then: (res) => res({ data: arr, error: null }),
          };
        },
        update(updates) {
          let targets = [...records];
          const query = {
            eq(col, val) {
              targets = targets.filter(r => r[col] === val);
              targets.forEach(item => Object.assign(item, updates));
              return query;
            },
            select() {
              return {
                single: async () => ({ data: targets[0] || null, error: null }),
              };
            },
            then: (res) => res({ data: targets, error: null }),
          };
          return query;
        },
      };
    },
  };
}

async function startTestServer(db) {
  const legacyAuth = (_req, res) => res.status(401).json({ error: 'Unauthorized' });
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/admin/crm/attendance', createAttendanceImportRoutes(db, legacyAuth));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('Reconciliation: Unauthorized / missing token is rejected with 401', async () => {
  const db = createMockDb();
  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-1/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: 'emp-reza' }),
    });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Non-manager / non-owner role is rejected with 403', async () => {
  const db = createMockDb();
  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-cashier',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ employee_id: 'emp-reza' }),
    });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Non-existent exception returns 404', async () => {
  const db = createMockDb();
  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/non-existent-id/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ barber_id: 'csb-yudha' }),
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Invalid target person (not in DB) returns 404', async () => {
  const db = createMockDb();
  db.store.attendance_exceptions.push({
    id: 'exc-invalid-target',
    external_employee_id: '888',
    external_name: 'Ghost Employee',
    exception_type: 'unmatched_employee',
    status: 'pending',
  });

  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-invalid-target/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ employee_id: 'emp-does-not-exist' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /Target karyawan tidak ditemukan/);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Mutual exclusion — Specifying both employee_id and barber_id is rejected with 400', async () => {
  const db = createMockDb();
  db.store.attendance_exceptions.push({
    id: 'exc-both',
    external_employee_id: '123',
    external_name: 'Conflict Employee',
    exception_type: 'unmatched_employee',
    status: 'pending',
  });

  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-both/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ employee_id: 'emp-reza', barber_id: 'csb-yudha' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Hanya boleh memilih salah satu/);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Branch-scoped manager cannot resolve target person from another branch (403)', async () => {
  const db = createMockDb();
  db.store.attendance_exceptions.push({
    id: 'exc-kng-cross',
    external_employee_id: '99',
    external_name: 'Asep',
    department: 'Kuningan',
    exception_type: 'unmatched_employee',
    status: 'pending',
  });

  const server = await startTestServer(db);
  try {
    // CSB manager attempts to resolve a Kuningan barber
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-kng-cross/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-mgr-csb',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ barber_id: 'kng-asep' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Manager hanya berwenang untuk person di cabangnya/);
  } finally {
    await server.close();
  }
});

test('Reconciliation: Yudha/Yuda — Fuzzy similarity does NOT auto-resolve; manual confirm creates permanent authority and auto-resolves siblings', async () => {
  const db = createMockDb();

  // 1. Initial State: matchEmployees strictly rejects auto-mapping "Yuda" to "Yudha"
  const fileEmployees = [{ external_employee_id: '3', external_name: 'Yuda', department: 'CSB' }];
  const initialMatch = matchEmployees({
    fileEmployees,
    existingIdentities: db.store.employee_attendance_identity,
    dbEmployees: db.store.employees,
    dbBarbers: db.store.barbers,
  });

  assert.equal(initialMatch.matched.length, 0, 'Yuda must NOT auto-match to Yudha');
  assert.equal(initialMatch.unmatched.length, 1, 'Yuda must be flagged as unmatched');
  assert.equal(initialMatch.unmatched[0].external_employee_id, '3');

  // Seed two pending exceptions for Yuda (ID 3) on different dates
  db.store.attendance_exceptions.push(
    {
      id: 'exc-yuda-d1',
      import_batch_id: 'batch-001',
      attendance_date: '2026-08-01',
      external_employee_id: '3',
      external_name: 'Yuda',
      exception_type: 'unmatched_employee',
      raw_data: { first_check_in: '09:55', last_check_out: '21:00', raw_punches: ['09:55', '21:00'] },
      status: 'pending',
    },
    {
      id: 'exc-yuda-d2',
      import_batch_id: 'batch-001',
      attendance_date: '2026-08-02',
      external_employee_id: '3',
      external_name: 'Yuda',
      exception_type: 'unmatched_employee',
      raw_data: { first_check_in: '10:05', last_check_out: '21:10', raw_punches: ['10:05', '21:10'] },
      status: 'pending',
    }
  );

  const server = await startTestServer(db);
  try {
    // 2. CSB Manager resolves the first exception
    const res = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-yuda-d1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-mgr-csb',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({
        barber_id: 'csb-yudha',
        resolution_notes: 'Confirmed Yuda in machine is CSB barber Yudha',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // 3. Verify permanent mapping in employee_attendance_identity
    const mapping = db.store.employee_attendance_identity.find(i => i.external_employee_id === '3');
    assert.ok(mapping, 'Permanent identity mapping must exist');
    assert.equal(mapping.target_type, 'barber');
    assert.equal(mapping.barber_id, 'csb-yudha');

    // 4. Verify both exceptions were resolved (primary + sibling propagation)
    const exc1 = db.store.attendance_exceptions.find(e => e.id === 'exc-yuda-d1');
    const exc2 = db.store.attendance_exceptions.find(e => e.id === 'exc-yuda-d2');
    assert.equal(exc1.status, 'resolved');
    assert.equal(exc2.status, 'resolved');

    // 5. Verify barber attendance records were linked
    const attList = db.store.barber_attendance.filter(a => a.barber_id === 'csb-yudha');
    assert.equal(attList.length, 2, 'Both attendance dates must be linked to csb-yudha');

    // 6. Test Idempotency: Resolving the same exception again returns 200 OK without errors
    const res2 = await fetch(`${server.baseUrl}/api/admin/crm/attendance/exceptions/exc-yuda-d1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok-mgr-csb',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ barber_id: 'csb-yudha' }),
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.ok, true);

    // 7. Subsequent import test: With identity mapping in place, ID 3 now resolves automatically!
    const subsequentMatch = matchEmployees({
      fileEmployees,
      existingIdentities: db.store.employee_attendance_identity,
      dbEmployees: db.store.employees,
      dbBarbers: db.store.barbers,
    });
    assert.equal(subsequentMatch.matched.length, 1, 'Subsequent match must automatically recognize ID 3');
    assert.equal(subsequentMatch.matched[0].target_type, 'barber');
    assert.equal(subsequentMatch.matched[0].barber_id, 'csb-yudha');
    assert.equal(subsequentMatch.unmatched.length, 0);
  } finally {
    await server.close();
  }
});
