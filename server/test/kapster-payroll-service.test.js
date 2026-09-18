'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RUN_STATUS,
  ITEM_STATUS,
  BLOCKER_TYPE,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  getPayrollRunDetail,
  getBarberRunDetail,
} = require('../services/kapsterPayrollService');

/**
 * In-memory Mock Supabase DB that simulates tables:
 * - payroll_runs
 * - payroll_barber_items
 * - payroll_barber_commission_items
 * - payroll_adjustments
 * - moka_transaction_items
 * - barbers
 * - barber_commission_rates
 * - barber_attendance
 */
function createMockDb(initialState = {}) {
  const tables = {
    payroll_runs: initialState.payroll_runs || [],
    payroll_barber_items: initialState.payroll_barber_items || [],
    payroll_barber_commission_items: initialState.payroll_barber_commission_items || [],
    payroll_adjustments: initialState.payroll_adjustments || [],
    moka_transaction_items: initialState.moka_transaction_items || [],
    barbers: initialState.barbers || [],
    barber_commission_rates: initialState.barber_commission_rates || [],
    barber_attendance: initialState.barber_attendance || [],
  };

  return {
    tables,
    from(table) {
      const rows = tables[table] || [];

      return {
        select(cols) {
          let filtered = [...rows];
          const queryObj = {
            eq(col, val) {
              filtered = filtered.filter((r) => r[col] === val);
              return queryObj;
            },
            neq(col, val) {
              filtered = filtered.filter((r) => r[col] !== val);
              return queryObj;
            },
            in(col, vals) {
              filtered = filtered.filter((r) => vals.includes(r[col]));
              return queryObj;
            },
            gte(col, val) {
              filtered = filtered.filter((r) => r[col] >= val);
              return queryObj;
            },
            lte(col, val) {
              filtered = filtered.filter((r) => r[col] <= val);
              return queryObj;
            },
            order(col, { ascending = true } = {}) {
              filtered.sort((a, b) => {
                const cmp = String(a[col] || '').localeCompare(String(b[col] || ''));
                return ascending ? cmp : -cmp;
              });
              return queryObj;
            },
            limit(n) {
              filtered = filtered.slice(0, n);
              return queryObj;
            },
            single: async () => ({
              data: filtered[0] || null,
              error: filtered[0] ? null : { message: 'Row not found' },
            }),
            maybeSingle: async () => ({
              data: filtered[0] || null,
              error: null,
            }),
            then(resolve) {
              resolve({ data: filtered, error: null });
            },
          };
          return queryObj;
        },
        insert(data) {
          const toInsert = Array.isArray(data) ? data : [data];
          const inserted = toInsert.map((item) => ({
            id: item.id || `uuid-${Math.random().toString(36).slice(2, 9)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...item,
          }));
          rows.push(...inserted);

          return {
            select() {
              return {
                single: async () => ({ data: inserted[0], error: null }),
                then(resolve) {
                  resolve({ data: inserted, error: null });
                },
              };
            },
            then(resolve) {
              resolve({ data: inserted, error: null });
            },
          };
        },
        update(values) {
          return {
            eq(col, val) {
              for (const r of rows) {
                if (r[col] === val) {
                  Object.assign(r, values, { updated_at: new Date().toISOString() });
                }
              }
              const updated = rows.filter((r) => r[col] === val);
              return {
                select() {
                  return {
                    single: async () => ({ data: updated[0] || null, error: null }),
                    then(resolve) {
                      resolve({ data: updated, error: null });
                    },
                  };
                },
                then(resolve) {
                  resolve({ data: updated, error: null });
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(col, val) {
              const remaining = rows.filter((r) => r[col] !== val);
              tables[table] = remaining;
              return {
                then(resolve) {
                  resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

test('Task 2.3: Kapster Payroll Draft Engine & Snapshot Tests', async (t) => {

  await t.test('A: generate draft creates payroll_runs and child snapshots', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Hair Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, refunded_quantity: 0, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const { run, blockers } = await generatePayrollDraft(mockDb, {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      userEmail: 'owner@redbox.id',
    });

    assert.equal(run.status, RUN_STATUS.DRAFT);
    assert.equal(blockers.length, 0);
    assert.equal(mockDb.tables.payroll_barber_items.length, 1);
    assert.equal(mockDb.tables.payroll_barber_commission_items.length, 1);

    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.net_service_revenue, 100000);
    assert.equal(bItem.commission_amount, 30000);
    assert.equal(bItem.payable_amount, 30000);
  });

  await t.test('B: rate 30% calculation arithmetic correct', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Hair Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const snap = mockDb.tables.payroll_barber_commission_items[0];
    assert.equal(snap.net_amount, 100000);
    assert.equal(snap.commission_rate_used, 0.30);
    assert.equal(snap.commission_amount, 30000);
  });

  await t.test('C: rate change within period calculates historical progression per item date', async () => {
    // 30% until Sep 16, 35% starting Sep 17
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: null, is_active: true }],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-09-16' },
        { id: 'r2', barber_id: 'b1', rate: 0.35, effective_from: '2026-09-17', effective_to: null },
      ],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut 1', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm2', receipt_number: 'R2', barber_id: 'b1', item_name: 'Cut 2', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-18' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    const lines = mockDb.tables.payroll_barber_commission_items;
    assert.equal(lines.length, 2);

    const line1 = lines.find((l) => l.source_moka_transaction_item_id === 'm1');
    const line2 = lines.find((l) => l.source_moka_transaction_item_id === 'm2');

    assert.equal(line1.commission_rate_used, 0.30);
    assert.equal(line1.commission_amount, 30000);

    assert.equal(line2.commission_rate_used, 0.35);
    assert.equal(line2.commission_amount, 35000);

    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.commission_amount, 65000); // 30000 + 35000
  });

  await t.test('D: missing rate surfaces as blocker', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b2', name: 'Budi', branch: 'csb', commission_rate: null, is_active: true }],
      barber_commission_rates: [],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b2', item_name: 'Hair Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const { blockers } = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(blockers.some((b) => b.type === BLOCKER_TYPE.MISSING_RATE), true);

    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.status, ITEM_STATUS.MISSING_RATE);
    assert.equal(bItem.commission_amount, 0); // never guess fallback
  });

  await t.test('E: net-after-discount calculation used for commission', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 85000, discount_amount: 42500, net_amount: 42500, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const line = mockDb.tables.payroll_barber_commission_items[0];
    assert.equal(line.gross_amount, 85000);
    assert.equal(line.discount_amount, 42500);
    assert.equal(line.net_amount, 42500);
    assert.equal(line.commission_amount, 12750); // 42500 * 0.30, never 25500 from gross
  });

  await t.test('F: retail items excluded from commission snapshot', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Hair Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 85000, discount_amount: 0, net_amount: 85000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm2', receipt_number: 'R1', barber_id: 'b1', item_name: 'Pomade', classification: 'STOCK_PRODUCT', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(mockDb.tables.payroll_barber_commission_items.length, 1);
    assert.equal(mockDb.tables.payroll_barber_commission_items[0].service_name_snapshot, 'Hair Cut');
  });

  await t.test('G: misc/F&B excluded from commission snapshot', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Hair Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 85000, discount_amount: 0, net_amount: 85000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm2', receipt_number: 'R1', barber_id: 'b1', item_name: 'Coffee', classification: 'NON_STOCK_MISC', gross_amount: 30000, discount_amount: 0, net_amount: 30000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(mockDb.tables.payroll_barber_commission_items.length, 1);
    assert.equal(mockDb.tables.payroll_barber_commission_items[0].service_name_snapshot, 'Hair Cut');
  });

  await t.test('H: multi-barber receipt item attribution', async () => {
    const mockDb = createMockDb({
      barbers: [
        { id: 'b1', name: 'Miftah', branch: 'csb', commission_rate: 0.30, is_active: true },
        { id: 'b2', name: 'Sofyan', branch: 'csb', commission_rate: 0.30, is_active: true },
      ],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null },
        { id: 'r2', barber_id: 'b2', rate: 0.30, effective_from: '2026-09-01', effective_to: null },
      ],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'MULTI_1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 150000, discount_amount: 0, net_amount: 150000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm2', receipt_number: 'MULTI_1', barber_id: 'b2', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 150000, discount_amount: 0, net_amount: 150000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm3', receipt_number: 'MULTI_1', barber_id: 'b2', item_name: 'Shave', classification: 'NON_STOCK_SERVICE', gross_amount: 150000, discount_amount: 0, net_amount: 150000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm4', receipt_number: 'MULTI_1', barber_id: null, item_name: 'Drink', classification: 'NON_STOCK_MISC', gross_amount: 10000, discount_amount: 0, net_amount: 10000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    const miftahItem = mockDb.tables.payroll_barber_items.find((x) => x.barber_id === 'b1');
    const sofyanItem = mockDb.tables.payroll_barber_items.find((x) => x.barber_id === 'b2');

    assert.equal(miftahItem.net_service_revenue, 150000);
    assert.equal(miftahItem.commission_amount, 45000);

    assert.equal(sofyanItem.net_service_revenue, 300000);
    assert.equal(sofyanItem.commission_amount, 90000);
  });

  await t.test('I: duplicate source prevention (cross locked run)', async () => {
    const mockDb = createMockDb({
      payroll_runs: [
        { id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-08-01', period_end: '2026-08-31' },
      ],
      payroll_barber_commission_items: [
        { id: 'c1', payroll_run_id: 'run-locked', source_moka_transaction_item_id: 'm-old' },
      ],
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm-old', receipt_number: 'R_DUP', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 85000, discount_amount: 0, net_amount: 85000, quantity: 1, is_deleted: false, tx_date: '2026-09-01' },
      ],
    });

    // Attempting to generate a draft with item already locked in previous run
    const { blockers } = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(blockers.some((b) => b.type === BLOCKER_TYPE.DUPLICATE_SOURCE), true);
  });

  await t.test('J: regenerate draft atomic replaces calculation items while preserving manual adjustments', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut 1', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const { run } = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const runId = run.id;

    // Add manual adjustment
    await addManualAdjustment(mockDb, {
      runId,
      barberId: 'b1',
      amount: 50000,
      reason: 'Bonus target',
    });

    // Add a new transaction item into Moka before regenerate
    mockDb.tables.moka_transaction_items.push({
      id: 'm2', receipt_number: 'R2', barber_id: 'b1', item_name: 'Cut 2', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, quantity: 1, is_deleted: false, tx_date: '2026-09-11',
    });

    // Regenerate draft
    const { run: regenRun } = await regeneratePayrollDraft(mockDb, { runId });
    assert.equal(regenRun.id, runId);

    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.net_service_revenue, 200000); // 100k + 100k
    assert.equal(bItem.commission_amount, 60000); // 200k * 0.30
    assert.equal(bItem.manual_adjustment_total, 50000); // Preserved!
    assert.equal(bItem.payable_amount, 110000); // 60k + 50k
  });

  await t.test('K: positive adjustment adds to payable', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', commission_amount: 30000, manual_adjustment_total: 0, payable_amount: 30000 }],
    });

    await addManualAdjustment(mockDb, { runId: 'run1', barberId: 'b1', amount: 20000, reason: 'Bonus lembur event' });
    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.manual_adjustment_total, 20000);
    assert.equal(bItem.payable_amount, 50000);
  });

  await t.test('L: negative adjustment deducts from payable', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', commission_amount: 50000, manual_adjustment_total: 0, payable_amount: 50000 }],
    });

    await addManualAdjustment(mockDb, { runId: 'run1', barberId: 'b1', amount: -15000, reason: 'Koreksi kasbon manual' });
    const bItem = mockDb.tables.payroll_barber_items[0];
    assert.equal(bItem.manual_adjustment_total, -15000);
    assert.equal(bItem.payable_amount, 35000);
  });

  await t.test('M: zero adjustment rejected', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT }],
    });

    await assert.rejects(
      () => addManualAdjustment(mockDb, { runId: 'run1', barberId: 'b1', amount: 0, reason: 'Test' }),
      /non-zero number/
    );
  });

  await t.test('N: lock blocked when exception exists', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT }],
      payroll_barber_items: [
        { id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', barber_name_snapshot: 'Abdul', missing_rate_count: 1, status: ITEM_STATUS.MISSING_RATE },
      ],
    });

    await assert.rejects(
      () => lockPayrollRun(mockDb, { runId: 'run1', userEmail: 'owner@redbox.id' }),
      /missing commission rates/
    );
  });

  await t.test('O: lock succeeds when clean', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT }],
      payroll_barber_items: [
        { id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', barber_name_snapshot: 'Abdul', missing_rate_count: 0, net_service_revenue: 100000, commission_amount: 30000, status: ITEM_STATUS.READY },
      ],
      payroll_barber_commission_items: [
        { id: 'pbci1', payroll_run_id: 'run1', payroll_barber_item_id: 'pbi1', net_amount: 100000, commission_amount: 30000 },
      ],
    });

    const locked = await lockPayrollRun(mockDb, { runId: 'run1', userEmail: 'owner@redbox.id' });
    assert.equal(locked.status, RUN_STATUS.LOCKED);
    assert.equal(locked.locked_by, 'owner@redbox.id');
    assert.ok(locked.locked_at);
  });

  await t.test('P: locked draft immutable (rejects mutation)', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED }],
      payroll_barber_items: [{ id: 'pbi1', payroll_run_id: 'run-locked', barber_id: 'b1' }],
    });

    // Cannot regenerate locked
    await assert.rejects(
      () => regeneratePayrollDraft(mockDb, { runId: 'run-locked' }),
      /Cannot regenerate a LOCKED/
    );

    // Cannot add adjustment
    await assert.rejects(
      () => addManualAdjustment(mockDb, { runId: 'run-locked', barberId: 'b1', amount: 10000, reason: 'Late adj' }),
      /Cannot add adjustments to a LOCKED/
    );
  });

  await t.test('Q: rate change after lock does not alter locked snapshot', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi1', payroll_run_id: 'run-locked', barber_id: 'b1', commission_amount: 30000 }],
      payroll_barber_commission_items: [{ id: 'c1', payroll_run_id: 'run-locked', payroll_barber_item_id: 'pbi1', commission_rate_used: 0.30, commission_amount: 30000 }],
    });

    // Simulate changing rate in barber_commission_rates after lock
    mockDb.tables.barber_commission_rates.push({
      id: 'r-new', barber_id: 'b1', rate: 0.50, effective_from: '2026-09-01',
    });

    // Fetch locked detail
    const detail = await getBarberRunDetail(mockDb, { runId: 'run-locked', barberId: 'b1' });
    assert.equal(detail.commission_lines[0].commission_rate_used, 0.30);
    assert.equal(detail.commission_lines[0].commission_amount, 30000);
    assert.notEqual(detail.commission_lines[0].commission_rate_used, 0.50);
  });

  await t.test('R: Moka change after lock does not alter locked snapshot', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED }],
      payroll_barber_items: [{ id: 'pbi1', payroll_run_id: 'run-locked', barber_id: 'b1', net_service_revenue: 100000, commission_amount: 30000 }],
      payroll_barber_commission_items: [{ id: 'c1', payroll_run_id: 'run-locked', payroll_barber_item_id: 'pbi1', net_amount: 100000, commission_amount: 30000 }],
      moka_transaction_items: [{ id: 'm1', net_amount: 100000 }],
    });

    // Simulate Moka data modification after lock
    mockDb.tables.moka_transaction_items[0].net_amount = 500000;

    // Locked payroll lines must remain 100000
    const detail = await getBarberRunDetail(mockDb, { runId: 'run-locked', barberId: 'b1' });
    assert.equal(detail.commission_lines[0].net_amount, 100000);
    assert.equal(detail.barber_item.net_service_revenue, 100000);
  });

  await t.test('S: branch security restricts Manager to own branch', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT }],
      payroll_barber_items: [
        { id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', branch_snapshot: 'csb' },
        { id: 'pbi2', payroll_run_id: 'run1', barber_id: 'b2', branch_snapshot: 'bypass' },
      ],
    });

    // CSB Manager query run detail: should only return CSB barber items
    const csbDetail = await getPayrollRunDetail(mockDb, {
      runId: 'run1',
      auth: { role: 'manager', branch: 'csb' },
    });
    assert.equal(csbDetail.barbers.length, 1);
    assert.equal(csbDetail.barbers[0].branch_snapshot, 'csb');

    // CSB Manager attempting to access bypass barber detail directly -> 403 Forbidden
    await assert.rejects(
      () => getBarberRunDetail(mockDb, { runId: 'run1', barberId: 'b2', auth: { role: 'manager', branch: 'csb' } }),
      /Forbidden: You cannot view barber details for branch bypass/
    );
  });

  await t.test('T: source reconciliation exact before lock', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run1', status: RUN_STATUS.DRAFT }],
      payroll_barber_items: [
        { id: 'pbi1', payroll_run_id: 'run1', barber_id: 'b1', barber_name_snapshot: 'Abdul', missing_rate_count: 0, net_service_revenue: 100000, commission_amount: 30000, status: ITEM_STATUS.READY },
      ],
      // Intentional discrepancy between lines and summary item
      payroll_barber_commission_items: [
        { id: 'pbci1', payroll_run_id: 'run1', payroll_barber_item_id: 'pbi1', net_amount: 90000, commission_amount: 27000 },
      ],
    });

    await assert.rejects(
      () => lockPayrollRun(mockDb, { runId: 'run1', userEmail: 'owner@redbox.id' }),
      /Reconciliation discrepancy/
    );
  });

});
