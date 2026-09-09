'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseCsvLine,
  resolveBranch,
  cleanPosition,
  reconcileBusinessUnit,
  executeImport,
} = require('../../scripts/import-employees');

test('import-employees: parseCsvLine handles commas inside and outside quotes', () => {
  const line = '1,2,"Doe, John",Cashier,"Rp 3,000,000"';
  const parsed = parseCsvLine(line);
  assert.deepEqual(parsed, ['1', '2', 'Doe, John', 'Cashier', 'Rp 3,000,000']);
});

test('import-employees: resolveBranch maps addresses accurately', () => {
  assert.equal(resolveBranch('Jl. Cakrabuana No. 1 Sumber').slug, 'sumber');
  assert.equal(resolveBranch('Mall CSB Lt 1').slug, 'csb');
  assert.equal(resolveBranch('Jl. Samadikun No. 5').slug, 'samadikun');
  assert.equal(resolveBranch('Jl. Dr. Soetomo Tegal').slug, 'tegal');
  assert.equal(resolveBranch('Jl. Brigjen Dharsono Bypass').slug, 'bypass');
});

test('import-employees: cleanPosition normalizes dashes and whitespace', () => {
  assert.equal(cleanPosition('-'), 'Staff');
  assert.equal(cleanPosition(''), 'Staff');
  assert.equal(cleanPosition(' Barista '), 'Barista');
});

test('import-employees: reconcileBusinessUnit soft-deactivates missing employees in scoped BU only', async () => {
  const dbActive = [
    { id: 'uuid-1', employee_code: 'RB-REG-001', name: 'Staying Employee', business_unit: 'Redbox', is_active: true },
    { id: 'uuid-2', employee_code: 'RB-REG-002', name: 'Leaving Employee', business_unit: 'Redbox', is_active: true },
  ];

  const snapshotEmployees = [
    { employee_code: 'RB-REG-001', name: 'Staying Employee', business_unit: 'Redbox' },
    { employee_code: 'RB-REG-003', name: 'New Employee', business_unit: 'Redbox' },
  ];

  const updates = [];
  const fakeClient = {
    from(table) {
      assert.equal(table, 'employees');
      return {
        select() {
          return {
            eq(f1, v1) {
              return {
                eq(f2, v2) {
                  return Promise.resolve({
                    data: dbActive.filter(r => r[f1] === v1 && r[f2] === v2),
                    error: null,
                  });
                },
              };
            },
          };
        },
        update(payload) {
          return {
            eq(field, value) {
              updates.push({ field, value, payload });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  const result = await reconcileBusinessUnit(fakeClient, 'Redbox', snapshotEmployees);

  assert.equal(result.success, true);
  assert.equal(result.deactivationsAttempted, 1);
  assert.equal(result.deactivationsSuccess, 1);
  assert.equal(result.deactivationsFailed, 0);

  // Verifies soft deactivation of leaving employee uuid-2
  assert.equal(updates.length, 1);
  assert.equal(updates[0].field, 'id');
  assert.equal(updates[0].value, 'uuid-2');
  assert.equal(updates[0].payload.is_active, false);
});

test('import-employees: executeImport fails with non-zero summary when any upsert or deactivation fails', async () => {
  const fakeClient = {
    from(table) {
      return {
        upsert() {
          return Promise.resolve({ error: { message: 'Unique constraint violation or timeout' } });
        },
        select() {
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  // Import should reject because upsert fails
  await assert.rejects(
    async () => {
      // Mocking redbox input by overriding or executing with fake client
      const fs = require('fs');
      const tempCsv = require('path').join(__dirname, 'temp-test-payroll.csv');
      fs.writeFileSync(
        tempCsv,
        'Header line 1\nHeader line 2\n1,1,Mock Person,MockPos,MockNick,3000000,,,,,,,,,,,,,,,,,,Bypass,,Agustus 2025\n'
      );
      try {
        await executeImport({
          redboxPath: tempCsv,
          supabaseClient: fakeClient,
          assertProductionSafety: false,
        });
      } finally {
        if (fs.existsSync(tempCsv)) fs.unlinkSync(tempCsv);
      }
    },
    /Import failed with 1 errors/
  );
});
