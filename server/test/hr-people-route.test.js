'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { createHRPeopleRoutes, dedupePeople } = require('../routes/hrPeople');

const BRANCH_COUNTS = { bypass: 6, csb: 7, samadikun: 4, sumber: 5, tegal: 6 };
const barbers = Object.entries(BRANCH_COUNTS).flatMap(([branch, count]) => (
  Array.from({ length: count }, (_, index) => ({ id: `${branch}-${index + 1}`, name: `${branch} barber ${index + 1}`, branch, is_active: true }))
));
const employees = [
  ...Array.from({ length: 16 }, (_, index) => ({ id: `redbox-${index + 1}`, name: `Redbox employee ${index + 1}`, nickname: null, business_unit: 'Redbox', position: 'Staff', branch: 'bypass', branch_name: 'Bypass', employment_type: 'regular', payroll_type: 'salary', is_active: true })),
  ...Array.from({ length: 23 }, (_, index) => ({ id: `sundaze-${index + 1}`, name: `Sundaze employee ${index + 1}`, nickname: null, business_unit: 'Sundaze', position: 'Staff', branch: 'bypass', branch_name: 'Bypass', employment_type: 'regular', payroll_type: 'salary', is_active: true })),
];

function query(rows, operations) {
  const filters = [];
  return {
    select(columns) { operations.push({ type: 'select', columns }); return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    then(resolve) {
      resolve({ data: rows.filter(row => filters.every(([column, value]) => row[column] === value)), error: null });
    },
  };
}

function createSupabase() {
  const operations = [];
  return {
    operations,
    auth: { async getUser() { return { data: { user: { id: 'owner-1', email: 'adhit24@gmail.com' } }, error: null }; } },
    from(table) {
      operations.push({ type: 'from', table });
      if (table === 'users') {
        return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'owner-1', role: 'owner' }, error: null }; } };
      }
      if (table === 'barbers') return query(barbers, operations);
      if (table === 'employees') return query(employees, operations);
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

async function withServer(callback) {
  const supabase = createSupabase();
  const legacyAuth = (_req, res) => res.status(401).json({ error: 'Unauthorized' });
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/admin/hr-people', createHRPeopleRoutes(supabase, legacyAuth));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`, supabase);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function getPeople(base, filter) {
  const response = await fetch(`${base}/api/admin/hr-people?filter=${filter}`, { headers: { Authorization: 'Bearer valid', 'X-Forwarded-Host': 'backoffice.redboxbarbershop.com' } });
  assert.equal(response.status, 200);
  return response.json();
}

test('Case C: HR API dynamically counts 28 active barbers and 39 regular employees yielding 67 directory records from source rows without hardcoded expectations', async () => {
  await withServer(async (base, supabase) => {
    const body = await getPeople(base, 'all');
    const barberCount = body.people.filter(person => person.source === 'barbers').length;
    const employeeCount = body.people.filter(person => person.source === 'employees').length;
    assert.equal(barberCount, 28);
    assert.equal(employeeCount, 39);
    assert.equal(body.people.length, barberCount + employeeCount);
    assert.equal(body.people.length, 67);
    assert.deepEqual(body.kpis, {
      active_barbers: barberCount,
      regular_employees: employeeCount,
      barber_branches: 5,
      active_business_units: 2,
    });
    assert.deepEqual(body.attendance, { available: false, label: 'Belum tersedia' });
    assert.equal('reconciliation' in body, false);
    assert.equal(JSON.stringify(body).includes('27'), false);
    assert.deepEqual(supabase.operations.filter(operation => operation.type === 'from').map(operation => operation.table), ['users', 'barbers', 'employees']);
    assert.equal(supabase.operations.some(operation => ['insert', 'upsert', 'update', 'delete'].includes(operation.type)), false);
  });
});

test('Redbox and Sundaze filters recalculate every KPI from filtered database rows', async () => {
  await withServer(async base => {
    const redbox = await getPeople(base, 'redbox');
    assert.deepEqual(redbox.kpis, { active_barbers: 28, regular_employees: 16, barber_branches: 5, active_business_units: 1 });
    assert.equal(redbox.people.length, 44);

    const sundaze = await getPeople(base, 'sundaze');
    assert.deepEqual(sundaze.kpis, { active_barbers: 0, regular_employees: 23, barber_branches: 0, active_business_units: 1 });
    assert.equal(sundaze.people.length, 23);
    assert.equal(sundaze.people.some(person => person.source === 'barbers'), false);
  });
});

test('Case A: two employees with identical business unit, name, and position but different IDs both remain', () => {
  const person1 = { id: 'employee:1', source: 'employees', business_unit: 'Redbox', name: 'Andi', position: 'Admin' };
  const person2 = { id: 'employee:2', source: 'employees', business_unit: 'Redbox', name: 'Andi', position: 'Admin' };
  const result = dedupePeople([person1, person2]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(person => person.id), ['employee:1', 'employee:2']);
});

test('Case B: a barber and an employee with the same normalized name remain separate unless an explicit identity link exists', () => {
  const barber = { id: 'barber:1', source: 'barbers', business_unit: 'Redbox', name: 'Andi', position: 'Kapster' };
  const employee = { id: 'employee:1', source: 'employees', business_unit: 'Redbox', name: 'andi', position: 'Admin' };
  const result = dedupePeople([barber, employee]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(person => person.id), ['barber:1', 'employee:1']);
});

test('authoritative identity deduplication preserves single record when identical ID is provided', () => {
  const employee1 = { id: 'employee:1', source: 'employees', business_unit: 'Redbox', name: 'Andi', position: 'Admin' };
  const duplicate = { id: 'employee:1', source: 'employees', business_unit: 'Redbox', name: 'Andi', position: 'Admin' };
  const result = dedupePeople([employee1, duplicate]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'employee:1');
});
