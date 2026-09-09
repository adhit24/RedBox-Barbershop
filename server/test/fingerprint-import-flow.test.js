'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('node:http');
const express = require('express');
const { createAttendanceImportRoutes } = require('../routes/attendanceImport');

const SAMPLE_PATH = 'C:/Users/Win11/Downloads/1_StandardReport-51.xls';
const sampleBuf = fs.readFileSync(SAMPLE_PATH);
const sampleBase64 = sampleBuf.toString('base64');

function createMockSupabase() {
  const store = {
    users: [
      { id: 'user-owner', role: 'owner', email: 'adhit24@gmail.com', branch: null },
      { id: 'user-mgr-csb', role: 'manager', email: 'manager.csb@redbox.com', branch: 'csb' },
    ],
    employees: [
      { id: 'emp-reza', employee_code: '7', name: 'Reza Budiman', nickname: 'Reza', position: 'Helper Cashier', branch: 'csb', business_unit: 'Redbox', is_active: true },
      { id: 'emp-jumadi', employee_code: '17', name: 'Jumadi', nickname: 'Jumadi', position: 'Staff', branch: 'csb', business_unit: 'Redbox', is_active: true },
      { id: 'emp-rizki', employee_code: '22', name: 'Rizki Adi Nugroho', nickname: 'Rizki Adi', position: 'Helper Cashier', branch: 'csb', business_unit: 'Redbox', is_active: true },
      { id: 'emp-indra', employee_code: '69', name: 'Muhammad Indra Hadikusuma', nickname: 'Indra', position: 'Helper Cashier', branch: 'csb', business_unit: 'Redbox', is_active: true },
    ],
    barbers: [
      { id: 'csb-ubay', name: 'Ubay', branch: 'csb', is_active: true },
      { id: 'csb-syarif', name: 'Sarif', branch: 'csb', is_active: true },
    ],
    employee_attendance_identity: [],
    attendance_import_batches: [],
    employee_attendance: [],
    attendance_exceptions: [],
    barber_attendance: [],
  };

  return {
    store,
    auth: {
      async getUser(token) {
        if (token === 'token-owner') return { data: { user: store.users[0] }, error: null };
        if (token === 'token-manager-csb') return { data: { user: store.users[1] }, error: null };
        return { data: { user: null }, error: new Error('Invalid token') };
      },
    },
    from(table) {
      const records = store[table] || [];
      return {
        select(cols = '*') {
          return {
            eq(col, val) {
              return {
                maybeSingle: async () => ({ data: records.find(r => r[col] === val) || null, error: null }),
                order: () => ({
                  limit: async () => ({ data: records.filter(r => r[col] === val), error: null }),
                }),
                then: (res) => res({ data: records.filter(r => r[col] === val), error: null }),
              };
            },
            in(col, vals) {
              return {
                in: () => this,
                eq: () => ({
                  then: (res) => res({ data: records.filter(r => vals.includes(r[col])), error: null }),
                }),
                then: (res) => res({ data: records.filter(r => vals.includes(r[col])), error: null }),
              };
            },
            order() {
              return {
                limit: async () => ({ data: [...records], error: null }),
                then: (res) => res({ data: [...records], error: null }),
              };
            },
            maybeSingle: async () => ({ data: records[0] || null, error: null }),
            then: (res) => res({ data: [...records], error: null }),
          };
        },
        insert(rows) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const created = arr.map((r, i) => ({ id: `id-${Date.now()}-${i}`, ...r }));
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
              records.push({ id: `upsert-${Date.now()}`, ...r });
            }
          }
          return {
            then: (res) => res({ data: arr, error: null }),
          };
        },
        update(updates) {
          return {
            eq(col, val) {
              const item = records.find(r => r[col] === val);
              if (item) Object.assign(item, updates);
              return {
                select() {
                  return {
                    single: async () => ({ data: item || null, error: null }),
                  };
                },
                then: (res) => res({ data: item, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

async function withServer(callback) {
  const supabase = createMockSupabase();
  const legacyAuth = (_req, res) => res.status(401).json({ error: 'Unauthorized' });
  const app = express();
  app.set('trust proxy', true);

  // Body parser for 15mb base64 payload
  app.use('/api/admin/crm/attendance/import/preview', express.json({ limit: '15mb' }));
  app.use('/api/admin/crm/attendance/import/commit', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/admin/crm/attendance', createAttendanceImportRoutes(supabase, legacyAuth));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`, supabase);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

test('Flow: Unauthorized request without token is rejected with 401', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/crm/attendance/import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_base64: sampleBase64, filename: '1_StandardReport-51.xls' }),
    });
    assert.equal(res.status, 401);
  });
});

test('Flow: Stage B Preview returns parsed report with ZERO DB mutation', async () => {
  await withServer(async (baseUrl, supabase) => {
    const res = await fetch(`${baseUrl}/api/admin/crm/attendance/import/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ file_base64: sampleBase64, filename: '1_StandardReport-51.xls' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.period.from, '2026-08-01');
    assert.equal(body.data.period.to, '2026-08-24');
    assert.equal(body.data.employees_detected, 16);
    assert.ok(body.data.matched_count > 0);
    assert.ok(body.data.punch_records_count > 200);

    // Verify ZERO mutations in store
    assert.equal(supabase.store.attendance_import_batches.length, 0);
    assert.equal(supabase.store.employee_attendance.length, 0);
    assert.equal(supabase.store.attendance_exceptions.length, 0);
  });
});

test('Flow: Stage C Commit writes batch, employee attendance, and exceptions', async () => {
  await withServer(async (baseUrl, supabase) => {
    const res = await fetch(`${baseUrl}/api/admin/crm/attendance/import/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ file_base64: sampleBase64, filename: '1_StandardReport-51.xls' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.period.from, '2026-08-01');
    assert.ok(body.data.rows_imported > 0);

    // Verify DB mutations
    assert.equal(supabase.store.attendance_import_batches.length, 1);
    assert.ok(supabase.store.employee_attendance.length > 0);
    assert.ok(supabase.store.attendance_exceptions.length > 0);

    // Verify raw punches preserved as JSON in employee_attendance
    const firstAtt = supabase.store.employee_attendance[0];
    assert.ok(Array.isArray(firstAtt.raw_punches));
    assert.ok(firstAtt.source === 'fingerprint');
  });
});

test('Flow: Idempotent Commit — Uploading same file twice does not duplicate attendance', async () => {
  await withServer(async (baseUrl, supabase) => {
    // 1st Commit
    await fetch(`${baseUrl}/api/admin/crm/attendance/import/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ file_base64: sampleBase64, filename: '1_StandardReport-51.xls' }),
    });

    const initialEmpAttCount = supabase.store.employee_attendance.length;

    // 2nd Commit with same file
    await fetch(`${baseUrl}/api/admin/crm/attendance/import/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({ file_base64: sampleBase64, filename: '1_StandardReport-51.xls' }),
    });

    const secondEmpAttCount = supabase.store.employee_attendance.length;

    // Count of employee attendance rows must NOT double
    assert.equal(secondEmpAttCount, initialEmpAttCount);
  });
});

test('Flow: Exception Review — Map unmatched external employee and resolve', async () => {
  await withServer(async (baseUrl, supabase) => {
    // Seed an exception
    supabase.store.attendance_exceptions.push({
      id: 'exc-yuda',
      import_batch_id: 'batch-1',
      attendance_date: '2026-08-04',
      external_employee_id: '3',
      external_name: 'Yuda',
      exception_type: 'unmatched_employee',
      status: 'pending',
    });

    // Resolve exception by linking external ID 3 to barber csb-yudha
    const res = await fetch(`${baseUrl}/api/admin/crm/attendance/exceptions/exc-yuda/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-owner',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
      body: JSON.stringify({
        target_type: 'barber',
        barber_id: 'csb-yudha',
        resolution_notes: 'Mapped Yuda in fingerprint machine to barber Yudha',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Verify identity was stored in employee_attendance_identity
    const identity = supabase.store.employee_attendance_identity.find(i => i.external_employee_id === '3');
    assert.ok(identity);
    assert.equal(identity.barber_id, 'csb-yudha');
    assert.equal(identity.target_type, 'barber');

    // Verify exception status updated to resolved
    const exc = supabase.store.attendance_exceptions.find(e => e.id === 'exc-yuda');
    assert.equal(exc.status, 'resolved');
  });
});
