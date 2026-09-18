'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RUN_STATUS,
  ITEM_STATUS,
  BLOCKER_TYPE,
  REVIEW_REASON,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  getPayrollRunDetail,
  getBarberRunDetail,
} = require('../services/kapsterPayrollService');

/**
 * Helper to check daterange overlap [s1, e1] && [s2, e2]
 */
function datesOverlap(s1, e1, s2, e2) {
  const end1 = e1 || '9999-12-31';
  const end2 = e2 || '9999-12-31';
  return s1 <= end2 && end1 >= s2;
}

/**
 * In-memory Mock Supabase DB that simulates tables & triggers:
 * - payroll_runs
 * - payroll_barber_items
 * - payroll_barber_commission_items
 * - payroll_review_items
 * - payroll_adjustments
 * - payroll_source_claims
 * - moka_transaction_items
 * - barbers
 * - barber_commission_rates (with EXCLUDE constraint simulation)
 * - barber_attendance
 */
function createMockDb(initialState = {}) {
  const tables = {
    payroll_runs: initialState.payroll_runs || [],
    payroll_barber_items: initialState.payroll_barber_items || [],
    payroll_barber_commission_items: initialState.payroll_barber_commission_items || [],
    payroll_review_items: initialState.payroll_review_items || [],
    payroll_adjustments: initialState.payroll_adjustments || [],
    payroll_source_claims: initialState.payroll_source_claims || [],
    moka_transaction_items: initialState.moka_transaction_items || [],
    barbers: initialState.barbers || [],
    barber_commission_rates: initialState.barber_commission_rates || [],
    barber_attendance: initialState.barber_attendance || [],
  };

  const mock = {
    tables,
    from(table) {
      const rows = tables[table] || [];

      return {
        select(cols, { count, head } = {}) {
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
              resolve({
                data: head ? null : filtered,
                count: count ? filtered.length : null,
                error: null,
              });
            },
          };
          return queryObj;
        },
        insert(data) {
          const toInsert = Array.isArray(data) ? data : [data];

          // 1. barber_commission_rates exclusion constraint simulation
          if (table === 'barber_commission_rates') {
            for (const item of toInsert) {
              const conflict = rows.find(
                (r) =>
                  r.barber_id === item.barber_id &&
                  r.id !== item.id &&
                  datesOverlap(r.effective_from, r.effective_to, item.effective_from, item.effective_to)
              );
              if (conflict) {
                const err = new Error(
                  `exclusion_violation: conflicting key value violates exclusion constraint "uq_barber_commission_rate_no_overlap"`
                );
                err.code = '23P01';
                return {
                  select: () => ({ single: async () => ({ data: null, error: err }) }),
                  then(resolve) {
                    resolve({ data: null, error: err });
                  },
                };
              }
            }
          }

          // 2. payroll_source_claims PK & immutability constraint simulation
          if (table === 'payroll_source_claims') {
            for (const item of toInsert) {
              const run = tables.payroll_runs.find((r) => r.id === item.payroll_run_id);
              if (run && run.status === RUN_STATUS.LOCKED) {
                const err = new Error(`Cannot add source claim: payroll run ${item.payroll_run_id} is already LOCKED`);
                return {
                  select: () => ({ single: async () => ({ data: null, error: err }) }),
                  then(resolve) {
                    resolve({ data: null, error: err });
                  },
                };
              }
              const existingClaim = rows.find(
                (r) => r.source_moka_transaction_item_id === item.source_moka_transaction_item_id
              );
              if (existingClaim) {
                const err = new Error(
                  `duplicate key value violates unique constraint "payroll_source_claims_pkey": source item ${item.source_moka_transaction_item_id} already claimed by run ${existingClaim.payroll_run_id}`
                );
                err.code = '23505';
                return {
                  select: () => ({ single: async () => ({ data: null, error: err }) }),
                  then(resolve) {
                    resolve({ data: null, error: err });
                  },
                };
              }
            }
          }

          // 3. payroll_review_items uniqueness constraint (uq_review_run_source_item)
          if (table === 'payroll_review_items') {
            for (const item of toInsert) {
              if (item.source_moka_transaction_item_id) {
                const existing = rows.find(
                  (r) =>
                    r.payroll_run_id === item.payroll_run_id &&
                    r.source_moka_transaction_item_id === item.source_moka_transaction_item_id
                );
                if (existing) {
                  const err = new Error(
                    `duplicate key value violates unique constraint "uq_review_run_source_item"`
                  );
                  err.code = '23505';
                  return {
                    select: () => ({ single: async () => ({ data: null, error: err }) }),
                    then(resolve) {
                      resolve({ data: null, error: err });
                    },
                  };
                }
              }
            }
          }

          // 4. Child tables immutability trigger simulation (trg_child_immutability: INSERT)
          if (['payroll_barber_items', 'payroll_barber_commission_items', 'payroll_review_items', 'payroll_adjustments'].includes(table)) {
            for (const item of toInsert) {
              const run = tables.payroll_runs.find((r) => r.id === item.payroll_run_id);
              if (run && run.status === RUN_STATUS.LOCKED) {
                const err = new Error(`Cannot modify payroll data: payroll run ${item.payroll_run_id} is LOCKED`);
                return {
                  select: () => ({ single: async () => ({ data: null, error: err }) }),
                  then(resolve) {
                    resolve({ data: null, error: err });
                  },
                };
              }
            }
          }

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
              // 1. payroll_runs header immutability trigger simulation
              if (table === 'payroll_runs') {
                for (const r of rows) {
                  if (r[col] === val) {
                    if (r.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Cannot modify payroll run ${r.id}: run is LOCKED and immutable`);
                    }
                    if (values.status === RUN_STATUS.DRAFT && r.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Invalid status transition from LOCKED to DRAFT`);
                    }
                    if (r.status === RUN_STATUS.DRAFT && values.status === RUN_STATUS.LOCKED) {
                      // Check the 10 forbidden fields:
                      const historicalFields = [
                        'id', 'payroll_type', 'business_unit', 'period_start', 'period_end',
                        'generated_at', 'generated_by', 'calculation_version', 'summary', 'created_at'
                      ];
                      for (const field of historicalFields) {
                        if (values[field] !== undefined) {
                          const valBefore = JSON.stringify(r[field] === undefined ? null : r[field]);
                          const valAfter = JSON.stringify(values[field]);
                          if (valBefore !== valAfter) {
                            throw new Error(`Cannot alter historical fields when locking payroll run ${r.id}: field ${field} altered`);
                          }
                        }
                      }
                    }
                  }
                }
              }

              // 2. Child tables immutability check
              if (['payroll_barber_items', 'payroll_barber_commission_items', 'payroll_review_items', 'payroll_adjustments'].includes(table)) {
                for (const r of rows) {
                  if (r[col] === val) {
                    const run = tables.payroll_runs.find((rn) => rn.id === r.payroll_run_id);
                    if (run && run.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Cannot modify payroll data: payroll run ${r.payroll_run_id} is LOCKED`);
                    }
                  }
                }
              }

              // 3. payroll_source_claims immutability on UPDATE
              if (table === 'payroll_source_claims') {
                for (const r of rows) {
                  if (r[col] === val) {
                    const run = tables.payroll_runs.find((rn) => rn.id === r.payroll_run_id);
                    if (run && run.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Cannot modify source claim: payroll run ${r.payroll_run_id} is LOCKED and claims are immutable`);
                    }
                  }
                }
              }

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
              // Header immutability on delete
              if (table === 'payroll_runs') {
                for (const r of rows) {
                  if (r[col] === val && r.status === RUN_STATUS.LOCKED) {
                    throw new Error(`Cannot delete payroll run ${r.id}: run is LOCKED`);
                  }
                }
              }

              // Child tables immutability on delete
              if (['payroll_barber_items', 'payroll_barber_commission_items', 'payroll_review_items', 'payroll_adjustments'].includes(table)) {
                for (const r of rows) {
                  if (r[col] === val) {
                    const run = tables.payroll_runs.find((rn) => rn.id === r.payroll_run_id);
                    if (run && run.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Cannot modify payroll data: payroll run ${r.payroll_run_id} is LOCKED`);
                    }
                  }
                }
              }

              // Source claims permanence: cannot delete claims belonging to a locked run
              if (table === 'payroll_source_claims') {
                for (const r of rows) {
                  if (r[col] === val) {
                    const run = tables.payroll_runs.find((rn) => rn.id === r.payroll_run_id);
                    if (run && run.status === RUN_STATUS.LOCKED) {
                      throw new Error(`Cannot delete source claim: payroll run ${r.payroll_run_id} is LOCKED and claims are permanent`);
                    }
                  }
                }
              }

              const initialLen = rows.length;
              for (let i = rows.length - 1; i >= 0; i--) {
                if (rows[i][col] === val) {
                  rows.splice(i, 1);
                }
              }
              return {
                then(resolve) {
                  resolve({ data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return mock;
}

test('Task 2.3 Hardened Suite: Kapster Payroll Draft Engine & Snapshot Guarantees', async (t) => {
  // A. Concurrent rate overlap rejected by database exclusion constraint
  await t.test('A: concurrent rate overlap rejected by exclusion constraint', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', is_active: true }],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-09-16' },
      ],
    });

    // Attempt to insert overlapping rate (2026-09-10 to 2026-09-20)
    const { error } = await mockDb.from('barber_commission_rates').insert({
      barber_id: 'b1',
      rate: 0.35,
      effective_from: '2026-09-10',
      effective_to: '2026-09-20',
    });

    assert.ok(error, 'Expected error on overlapping rate insert');
    assert.equal(error.code, '23P01');
  });

  // B. Adjacent rate ranges accepted
  await t.test('B: adjacent rate ranges accepted', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', is_active: true }],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-09-16' },
      ],
    });

    // Insert adjacent non-overlapping rate (2026-09-17 to infinity/null)
    const { data, error } = await mockDb.from('barber_commission_rates').insert({
      barber_id: 'b1',
      rate: 0.35,
      effective_from: '2026-09-17',
      effective_to: null,
    });

    assert.equal(error, null, 'Adjacent range must be accepted without error');
    assert.ok(data);
  });

  // C. Missing rate source item is persisted in payroll_review_items
  await t.test('C: missing rate source item is persisted in payroll_review_items', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: null, is_active: true }],
      barber_commission_rates: [], // No rates configured
      moka_transaction_items: [
        {
          id: 'm1',
          receipt_number: 'R_NO_RATE',
          barber_id: 'b1',
          item_name: 'Haircut Premium',
          classification: 'NON_STOCK_SERVICE',
          gross_amount: 100000,
          discount_amount: 0,
          net_amount: 100000,
          quantity: 1,
          is_deleted: false,
          tx_date: '2026-09-10',
        },
      ],
    });

    const res = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(mockDb.tables.payroll_review_items.length, 1);
    const revItem = mockDb.tables.payroll_review_items[0];
    assert.equal(revItem.reason_code, REVIEW_REASON.MISSING_RATE);
    assert.equal(revItem.net_amount, 100000);
    assert.equal(revItem.blocking, true);

    // Ensure it is NOT in commission lines
    assert.equal(mockDb.tables.payroll_barber_commission_items.length, 0);

    // Blocker surfaced
    assert.ok(res.blockers.some((b) => b.type === REVIEW_REASON.MISSING_RATE));
  });

  // D. Missing barber source item is persisted in payroll_review_items
  await t.test('D: missing barber source item is persisted in payroll_review_items', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        {
          id: 'm_nobarber',
          receipt_number: 'R_NO_BARBER',
          barber_id: null,
          item_name: 'Haircut Regular',
          classification: 'NON_STOCK_SERVICE',
          gross_amount: 80000,
          discount_amount: 0,
          net_amount: 80000,
          quantity: 1,
          is_deleted: false,
          tx_date: '2026-09-05',
        },
      ],
    });

    const res = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(mockDb.tables.payroll_review_items.length, 1);
    const revItem = mockDb.tables.payroll_review_items[0];
    assert.equal(revItem.reason_code, REVIEW_REASON.MISSING_BARBER);
    assert.equal(revItem.net_amount, 80000);
    assert.equal(revItem.blocking, true);

    // Commission lines empty
    assert.equal(mockDb.tables.payroll_barber_commission_items.length, 0);
  });

  // E. REVIEW_REQUIRED item persists as review snapshot
  await t.test('E: REVIEW_REQUIRED item persists as review snapshot', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        {
          id: 'm_rev',
          receipt_number: 'R_REV',
          barber_id: 'b1',
          item_name: 'Unknown Package',
          classification: 'REVIEW_REQUIRED',
          classification_reason: 'Unmapped custom item',
          gross_amount: 120000,
          discount_amount: 0,
          net_amount: 120000,
          quantity: 1,
          is_deleted: false,
          tx_date: '2026-09-12',
        },
      ],
    });

    const res = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    assert.equal(mockDb.tables.payroll_review_items.length, 1);
    const revItem = mockDb.tables.payroll_review_items[0];
    assert.equal(revItem.reason_code, REVIEW_REASON.REVIEW_REQUIRED_ITEM);
    assert.equal(revItem.net_amount, 120000);
    assert.equal(revItem.blocking, true);
  });

  // F. Exactly-one service invariant: count(comm) + count(rev) === 1 for every relevant canonical source item
  await t.test('F: exactly-one service invariant across all 5 test cases', async () => {
    // 5 Test cases:
    // 1. resolved service -> comm=1, rev=0
    // 2. missing rate -> comm=0, rev=1 (reason: MISSING_RATE)
    // 3. missing barber -> comm=0, rev=1 (reason: MISSING_BARBER)
    // 4. REVIEW_REQUIRED -> comm=0, rev=1 (reason: REVIEW_REQUIRED_ITEM)
    // 5. duplicate locked source -> comm=0, rev=1 (reason: DUPLICATE_SOURCE)
    const mockDb = createMockDb({
      payroll_runs: [
        { id: 'run-locked-prior', status: RUN_STATUS.LOCKED, period_start: '2026-08-01', period_end: '2026-08-31' },
      ],
      payroll_source_claims: [
        { source_moka_transaction_item_id: 'item-dup-locked', payroll_run_id: 'run-locked-prior', claimed_by: 'owner@redbox.id' },
      ],
      barbers: [
        { id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true },
        { id: 'b2', name: 'Budi', branch: 'csb', commission_rate: null, is_active: true }, // b2 missing rate
      ],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null },
      ],
      moka_transaction_items: [
        // Case 1: Resolved service item
        { id: 'item-resolved', receipt_number: 'R1', barber_id: 'b1', item_name: 'Haircut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-02' },
        // Case 2: Missing rate
        { id: 'item-no-rate', receipt_number: 'R2', barber_id: 'b2', item_name: 'Shave', classification: 'NON_STOCK_SERVICE', gross_amount: 50000, discount_amount: 0, net_amount: 50000, is_deleted: false, tx_date: '2026-09-03' },
        // Case 3: Missing barber
        { id: 'item-no-barber', receipt_number: 'R3', barber_id: null, item_name: 'Coloring', classification: 'NON_STOCK_SERVICE', gross_amount: 200000, discount_amount: 0, net_amount: 200000, is_deleted: false, tx_date: '2026-09-04' },
        // Case 4: REVIEW_REQUIRED item
        { id: 'item-review-req', receipt_number: 'R4', barber_id: 'b1', item_name: 'Custom Package', classification: 'REVIEW_REQUIRED', gross_amount: 80000, discount_amount: 0, net_amount: 80000, is_deleted: false, tx_date: '2026-09-05' },
        // Case 5: Duplicate locked source
        { id: 'item-dup-locked', receipt_number: 'R5', barber_id: 'b1', item_name: 'Haircut Dup', classification: 'NON_STOCK_SERVICE', gross_amount: 90000, discount_amount: 0, net_amount: 90000, is_deleted: false, tx_date: '2026-09-06' },
      ],
    });

    await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    const testCases = [
      { id: 'item-resolved', expectedComm: 1, expectedRev: 0, expectedReason: null },
      { id: 'item-no-rate', expectedComm: 0, expectedRev: 1, expectedReason: REVIEW_REASON.MISSING_RATE },
      { id: 'item-no-barber', expectedComm: 0, expectedRev: 1, expectedReason: REVIEW_REASON.MISSING_BARBER },
      { id: 'item-review-req', expectedComm: 0, expectedRev: 1, expectedReason: REVIEW_REASON.REVIEW_REQUIRED_ITEM },
      { id: 'item-dup-locked', expectedComm: 0, expectedRev: 1, expectedReason: REVIEW_REASON.DUPLICATE_SOURCE },
    ];

    for (const tc of testCases) {
      const commCount = mockDb.tables.payroll_barber_commission_items.filter(
        (c) => c.source_moka_transaction_item_id === tc.id
      ).length;
      const revCount = mockDb.tables.payroll_review_items.filter(
        (r) => r.source_moka_transaction_item_id === tc.id
      ).length;

      const totalCount = commCount + revCount;

      // Invariant: count in commission + count in review MUST EQUAL EXACTLY 1 (never 0 or >1)
      assert.equal(
        totalCount,
        1,
        `Invariant violated for source item ${tc.id}: commCount(${commCount}) + revCount(${revCount}) must be exactly 1, but was ${totalCount}`
      );
      assert.equal(commCount, tc.expectedComm, `Item ${tc.id} comm count mismatch`);
      assert.equal(revCount, tc.expectedRev, `Item ${tc.id} rev count mismatch`);

      if (tc.expectedReason) {
        const revItem = mockDb.tables.payroll_review_items.find(
          (r) => r.source_moka_transaction_item_id === tc.id
        );
        assert.equal(revItem.reason_code, tc.expectedReason, `Item ${tc.id} reason code mismatch`);
      }
    }
  });

  // F2. Review item uniqueness: duplicate review rows for same source item rejected by uq_review_run_source_item
  await t.test('F2: review item uniqueness rejected by uq_review_run_source_item', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-draft', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_review_items: [
        {
          id: 'pri-1',
          payroll_run_id: 'run-draft',
          source_moka_transaction_item_id: 'item-uniq-test',
          receipt_number: 'R1',
          tx_date: '2026-09-10',
          item_name_snapshot: 'Haircut',
          classification_snapshot: 'NON_STOCK_SERVICE',
          reason_code: REVIEW_REASON.MISSING_RATE,
        },
      ],
    });

    const { error } = await mockDb.from('payroll_review_items').insert({
      id: 'pri-2',
      payroll_run_id: 'run-draft',
      source_moka_transaction_item_id: 'item-uniq-test',
      receipt_number: 'R1',
      tx_date: '2026-09-10',
      item_name_snapshot: 'Haircut Dup',
      classification_snapshot: 'NON_STOCK_SERVICE',
      reason_code: REVIEW_REASON.MISSING_BARBER,
    });

    assert.ok(error, 'Inserting duplicate review row for same source item must fail');
    assert.equal(error.code, '23505');
    assert.ok(error.message.includes('uq_review_run_source_item'));
  });

  // G. Blocking review prevents lock
  await t.test('G: blocking review prevents lock', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: null, is_active: true }],
      barber_commission_rates: [],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    await assert.rejects(
      async () => {
        await lockPayrollRun(mockDb, { runId: draft.run.id });
      },
      /blocking review issues remain unresolved/
    );
  });

  // H. Source claim prevents double-pay across LOCKED runs
  await t.test('H: source claim prevents double-pay across LOCKED runs', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-08-01', period_end: '2026-08-31' }],
      payroll_source_claims: [
        { source_moka_transaction_item_id: 'm-claimed', payroll_run_id: 'run-locked', claimed_by: 'owner@redbox.id' },
      ],
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm-claimed', receipt_number: 'R_DUP', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 85000, discount_amount: 0, net_amount: 85000, is_deleted: false, tx_date: '2026-09-01' },
      ],
    });

    const res = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    // Item must be in payroll_review_items with DUPLICATE_SOURCE
    const revItem = mockDb.tables.payroll_review_items.find((r) => r.source_moka_transaction_item_id === 'm-claimed');
    assert.ok(revItem, 'Claimed item must be in review items');
    assert.equal(revItem.reason_code, REVIEW_REASON.DUPLICATE_SOURCE);
    assert.equal(revItem.blocking, true);
  });

  // I. Simulated concurrent lock cannot double claim item
  await t.test('I: simulated concurrent lock cannot double claim item', async () => {
    const mockDb = createMockDb({
      payroll_runs: [
        { id: 'run-1', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-15' },
        { id: 'run-2', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-15' },
      ],
      payroll_barber_items: [
        { id: 'pbi-1', payroll_run_id: 'run-1', barber_id: 'b1', barber_name_snapshot: 'Abdul', net_service_revenue: 100000, commission_amount: 30000 },
        { id: 'pbi-2', payroll_run_id: 'run-2', barber_id: 'b1', barber_name_snapshot: 'Abdul', net_service_revenue: 100000, commission_amount: 30000 },
      ],
      payroll_barber_commission_items: [
        { id: 'c1', payroll_run_id: 'run-1', payroll_barber_item_id: 'pbi-1', source_moka_transaction_item_id: 'item-shared', net_amount: 100000, commission_amount: 30000 },
        { id: 'c2', payroll_run_id: 'run-2', payroll_barber_item_id: 'pbi-2', source_moka_transaction_item_id: 'item-shared', net_amount: 100000, commission_amount: 30000 },
      ],
    });

    // Lock run-1 first
    const lock1 = await lockPayrollRun(mockDb, { runId: 'run-1' });
    assert.equal(lock1.success, true);
    assert.equal(mockDb.tables.payroll_source_claims.length, 1);

    // Attempt to lock run-2 claiming the same item-shared
    await assert.rejects(
      async () => {
        await lockPayrollRun(mockDb, { runId: 'run-2' });
      },
      /duplicate key value violates unique constraint/
    );
  });

  // J. Header immutability suite: DRAFT -> LOCKED and locked immutability
  await t.test('J: header immutability suite (transition and post-lock guarantees)', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-05' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const runId = draft.run.id;

    // Test 1: DRAFT -> LOCKED normal transition PASS via atomic lock function
    const lockRes = await lockPayrollRun(mockDb, { runId, userEmail: 'owner@redbox.id' });
    assert.equal(lockRes.success, true);
    assert.equal(lockRes.run.status, RUN_STATUS.LOCKED);
    assert.ok(lockRes.run.locked_at);
    assert.equal(lockRes.run.locked_by, 'owner@redbox.id');

    // Test 2: DRAFT -> LOCKED + changed summary FAIL
    const draft2 = createMockDb({
      payroll_runs: [{
        id: 'run-d2',
        payroll_type: 'BARBER_REVENUE_SHARE',
        business_unit: 'Redbox',
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        status: RUN_STATUS.DRAFT,
        generated_at: '2026-09-01T00:00:00.000Z',
        generated_by: 'owner@redbox.id',
        calculation_version: 'v2.3',
        summary: { barber_count: 1 },
        created_at: '2026-09-01T00:00:00.000Z',
      }],
    });
    assert.throws(() => {
      draft2.from('payroll_runs').update({
        status: RUN_STATUS.LOCKED,
        summary: { barber_count: 999 },
      }).eq('id', 'run-d2');
    }, /Cannot alter historical fields when locking payroll run run-d2: field summary altered/);

    // Test 3: DRAFT -> LOCKED + changed calculation_version FAIL
    assert.throws(() => {
      draft2.from('payroll_runs').update({
        status: RUN_STATUS.LOCKED,
        calculation_version: 'v3.0-unauthorized',
      }).eq('id', 'run-d2');
    }, /Cannot alter historical fields when locking payroll run run-d2: field calculation_version altered/);

    // Test 4: DRAFT -> LOCKED + changed generated_by FAIL
    assert.throws(() => {
      draft2.from('payroll_runs').update({
        status: RUN_STATUS.LOCKED,
        generated_by: 'attacker@evil.com',
      }).eq('id', 'run-d2');
    }, /Cannot alter historical fields when locking payroll run run-d2: field generated_by altered/);

    // Test 5: LOCKED -> DRAFT FAIL
    assert.throws(() => {
      mockDb.from('payroll_runs').update({ status: RUN_STATUS.DRAFT }).eq('id', runId);
    }, /run is LOCKED and immutable/);

    // Test 6: LOCKED summary UPDATE FAIL
    assert.throws(() => {
      mockDb.from('payroll_runs').update({ summary: { tampered: true } }).eq('id', runId);
    }, /run is LOCKED and immutable/);

    // Test 7: LOCKED DELETE FAIL
    assert.throws(() => {
      mockDb.from('payroll_runs').delete().eq('id', runId);
    }, /Cannot delete payroll run .* run is LOCKED/);
  });

  // M. Locked children cannot be edited
  await t.test('M: locked children cannot be edited', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi-1', payroll_run_id: 'run-locked', barber_id: 'b1', commission_amount: 30000 }],
    });

    assert.throws(() => {
      mockDb.from('payroll_barber_items').update({ commission_amount: 999999 }).eq('id', 'pbi-1');
    }, /payroll run run-locked is LOCKED/);
  });

  // M2. Child DELETE immutability: DRAFT allows DELETE, LOCKED rejects DELETE across all 4 tables
  await t.test('M2: child DELETE immutability trigger across all 4 child tables', async () => {
    // 1. DRAFT run: DELETE must be allowed on all 4 child tables
    const draftDb = createMockDb({
      payroll_runs: [{ id: 'run-draft', status: RUN_STATUS.DRAFT, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi-draft', payroll_run_id: 'run-draft', barber_id: 'b1' }],
      payroll_barber_commission_items: [{ id: 'pbci-draft', payroll_run_id: 'run-draft', source_moka_transaction_item_id: 's1' }],
      payroll_review_items: [{ id: 'pri-draft', payroll_run_id: 'run-draft', source_moka_transaction_item_id: 's2' }],
      payroll_adjustments: [{ id: 'pa-draft', payroll_run_id: 'run-draft', barber_id: 'b1', amount: 15000 }],
    });

    // Delete allowed on all 4 in DRAFT
    await draftDb.from('payroll_adjustments').delete().eq('id', 'pa-draft');
    assert.equal(draftDb.tables.payroll_adjustments.length, 0);

    await draftDb.from('payroll_review_items').delete().eq('id', 'pri-draft');
    assert.equal(draftDb.tables.payroll_review_items.length, 0);

    await draftDb.from('payroll_barber_commission_items').delete().eq('id', 'pbci-draft');
    assert.equal(draftDb.tables.payroll_barber_commission_items.length, 0);

    await draftDb.from('payroll_barber_items').delete().eq('id', 'pbi-draft');
    assert.equal(draftDb.tables.payroll_barber_items.length, 0);

    // 2. LOCKED run: DELETE must be rejected on all 4 child tables
    const lockedDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi-locked', payroll_run_id: 'run-locked', barber_id: 'b1' }],
      payroll_barber_commission_items: [{ id: 'pbci-locked', payroll_run_id: 'run-locked', source_moka_transaction_item_id: 's1' }],
      payroll_review_items: [{ id: 'pri-locked', payroll_run_id: 'run-locked', source_moka_transaction_item_id: 's2' }],
      payroll_adjustments: [{ id: 'pa-locked', payroll_run_id: 'run-locked', barber_id: 'b1', amount: 15000 }],
    });

    assert.throws(() => {
      lockedDb.from('payroll_barber_items').delete().eq('id', 'pbi-locked');
    }, /payroll run run-locked is LOCKED/);

    assert.throws(() => {
      lockedDb.from('payroll_barber_commission_items').delete().eq('id', 'pbci-locked');
    }, /payroll run run-locked is LOCKED/);

    assert.throws(() => {
      lockedDb.from('payroll_review_items').delete().eq('id', 'pri-locked');
    }, /payroll run run-locked is LOCKED/);

    assert.throws(() => {
      lockedDb.from('payroll_adjustments').delete().eq('id', 'pa-locked');
    }, /payroll run run-locked is LOCKED/);

    // Rows remain intact
    assert.equal(lockedDb.tables.payroll_barber_items.length, 1);
    assert.equal(lockedDb.tables.payroll_barber_commission_items.length, 1);
    assert.equal(lockedDb.tables.payroll_review_items.length, 1);
    assert.equal(lockedDb.tables.payroll_adjustments.length, 1);
  });

  // M3. Source claim immutability suite: A through F
  await t.test('M3: source claims immutability suite (A through F)', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-05' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    // A. lock creates source claims
    const lockRes = await lockPayrollRun(mockDb, { runId: draft.run.id, userEmail: 'owner@redbox.id' });
    assert.equal(lockRes.success, true);
    assert.equal(mockDb.tables.payroll_source_claims.length, 1);
    const claim = mockDb.tables.payroll_source_claims[0];
    assert.equal(claim.source_moka_transaction_item_id, 'm1');
    assert.equal(claim.payroll_run_id, draft.run.id);
    assert.equal(claim.claimed_by, 'owner@redbox.id');

    // B. source claim UPDATE after LOCKED rejected
    assert.throws(() => {
      mockDb.from('payroll_source_claims').update({ claimed_by: 'malicious@redbox.id' }).eq('source_moka_transaction_item_id', 'm1');
    }, /Cannot modify source claim: payroll run .* is LOCKED and claims are immutable/);

    // C. source claim DELETE after LOCKED rejected
    assert.throws(() => {
      mockDb.from('payroll_source_claims').delete().eq('source_moka_transaction_item_id', 'm1');
    }, /Cannot delete source claim: payroll run .* is LOCKED and claims are permanent/);

    // D. locked payroll run DELETE rejected and cannot cascade claims
    assert.throws(() => {
      mockDb.from('payroll_runs').delete().eq('id', draft.run.id);
    }, /Cannot delete payroll run .* run is LOCKED/);

    // E. duplicate source claim still rejects second payroll atomically
    const { error: dupClaimErr } = await mockDb.from('payroll_source_claims').insert({
      source_moka_transaction_item_id: 'm1',
      payroll_run_id: 'run-other-draft',
      claimed_by: 'other@redbox.id',
    });
    assert.ok(dupClaimErr);
    assert.equal(dupClaimErr.code, '23505');

    // F. source claim remains present after all rejected mutation attempts
    assert.equal(mockDb.tables.payroll_source_claims.length, 1);
    assert.equal(mockDb.tables.payroll_source_claims[0].claimed_by, 'owner@redbox.id');
    assert.equal(mockDb.tables.payroll_source_claims[0].source_moka_transaction_item_id, 'm1');
    assert.equal(mockDb.tables.payroll_runs.length, 1);
    assert.equal(mockDb.tables.payroll_runs[0].status, RUN_STATUS.LOCKED);
  });

  // N. Locked adjustments cannot be edited or added
  await t.test('N: locked adjustments cannot be edited or added', async () => {
    const mockDb = createMockDb({
      payroll_runs: [{ id: 'run-locked', status: RUN_STATUS.LOCKED, period_start: '2026-09-01', period_end: '2026-09-30' }],
      payroll_barber_items: [{ id: 'pbi-1', payroll_run_id: 'run-locked', barber_id: 'b1', commission_amount: 30000, manual_adjustment_total: 0, payable_amount: 30000 }],
    });

    await assert.rejects(
      async () => {
        await addManualAdjustment(mockDb, {
          runId: 'run-locked',
          barberId: 'b1',
          amount: 50000,
          reason: 'Bonus post-lock',
        });
      },
      /payroll run run-locked is LOCKED/
    );
  });

  // O. Locked snapshot unaffected by Moka / rate changes
  await t.test('O: locked snapshot unaffected by Moka or rate changes', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-05' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    await lockPayrollRun(mockDb, { runId: draft.run.id });

    // Later: rate changed to 50%
    mockDb.tables.barber_commission_rates[0].rate = 0.50;
    // Later: Moka transaction item modified
    mockDb.tables.moka_transaction_items[0].net_amount = 500000;

    // View locked run detail
    const detail = await getPayrollRunDetail(mockDb, { runId: draft.run.id });
    assert.equal(detail.run.total_service_revenue, 100000);
    assert.equal(detail.run.total_commission, 30000);
  });

  // P. Full reconciliation remains exact
  await t.test('P: full reconciliation exact between commission lines and barber totals', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut 1', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 20000, net_amount: 80000, is_deleted: false, tx_date: '2026-09-05' },
        { id: 'm2', receipt_number: 'R2', barber_id: 'b1', item_name: 'Cut 2', classification: 'NON_STOCK_SERVICE', gross_amount: 150000, discount_amount: 50000, net_amount: 100000, is_deleted: false, tx_date: '2026-09-06' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    const detail = await getBarberRunDetail(mockDb, { runId: draft.run.id, barberId: 'b1' });
    const sumNet = detail.commission_lines.reduce((s, l) => s + l.net_amount, 0);
    const sumComm = detail.commission_lines.reduce((s, l) => s + l.commission_amount, 0);

    assert.equal(sumNet, detail.barber.net_service_revenue);
    assert.equal(sumComm, detail.barber.commission_amount);
  });

  // Historical Rate Progression within period test (Sep 1-16: 30%, Sep 17-30: 35%)
  await t.test('Rate change within period calculates historical progression per item date', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.35, is_active: true }],
      barber_commission_rates: [
        { id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-09-16' },
        { id: 'r2', barber_id: 'b1', rate: 0.35, effective_from: '2026-09-17', effective_to: null },
      ],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-10' },
        { id: 'm2', receipt_number: 'R2', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-20' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const detail = await getBarberRunDetail(mockDb, { runId: draft.run.id, barberId: 'b1' });

    const line1 = detail.commission_lines.find((l) => l.receipt_number === 'R1');
    const line2 = detail.commission_lines.find((l) => l.receipt_number === 'R2');

    assert.equal(line1.commission_rate_used, 0.30);
    assert.equal(line1.commission_amount, 30000);

    assert.equal(line2.commission_rate_used, 0.35);
    assert.equal(line2.commission_amount, 35000);

    assert.equal(detail.barber.commission_amount, 65000);
  });

  // Manual Adjustments: Positive, Negative, and Zero rejection
  await t.test('Manual adjustments: positive bonus, negative deduction, and zero rejection', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });

    // Positive adjustment
    const adjPos = await addManualAdjustment(mockDb, {
      runId: draft.run.id,
      barberId: 'b1',
      amount: 50000,
      reason: 'Bonus target',
    });
    assert.equal(adjPos.amount, 50000);

    let detail = await getBarberRunDetail(mockDb, { runId: draft.run.id, barberId: 'b1' });
    assert.equal(detail.barber.commission_amount, 30000);
    assert.equal(detail.barber.manual_adjustment_total, 50000);
    assert.equal(detail.barber.payable_amount, 80000);

    // Negative adjustment
    const adjNeg = await addManualAdjustment(mockDb, {
      runId: draft.run.id,
      barberId: 'b1',
      amount: -10000,
      reason: 'Koreksi kasir',
    });
    assert.equal(adjNeg.amount, -10000);

    detail = await getBarberRunDetail(mockDb, { runId: draft.run.id, barberId: 'b1' });
    assert.equal(detail.barber.manual_adjustment_total, 40000);
    assert.equal(detail.barber.payable_amount, 70000);

    // Zero adjustment rejected
    await assert.rejects(
      async () => {
        await addManualAdjustment(mockDb, {
          runId: draft.run.id,
          barberId: 'b1',
          amount: 0,
          reason: 'Zero test',
        });
      },
      /Adjustment amount must be non-zero/
    );

    // Delete adjustment
    await deleteManualAdjustment(mockDb, { runId: draft.run.id, adjustmentId: adjPos.id });
    detail = await getBarberRunDetail(mockDb, { runId: draft.run.id, barberId: 'b1' });
    assert.equal(detail.barber.manual_adjustment_total, -10000);
    assert.equal(detail.barber.payable_amount, 20000);
  });

  // Regenerate draft atomically preserves manual adjustments
  await t.test('Regenerate draft atomically preserves manual adjustments', async () => {
    const mockDb = createMockDb({
      barbers: [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30, is_active: true }],
      barber_commission_rates: [{ id: 'r1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null }],
      moka_transaction_items: [
        { id: 'm1', receipt_number: 'R1', barber_id: 'b1', item_name: 'Cut 1', classification: 'NON_STOCK_SERVICE', gross_amount: 100000, discount_amount: 0, net_amount: 100000, is_deleted: false, tx_date: '2026-09-10' },
      ],
    });

    const draft = await generatePayrollDraft(mockDb, { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    await addManualAdjustment(mockDb, {
      runId: draft.run.id,
      barberId: 'b1',
      amount: 25000,
      reason: 'Incentive',
    });

    // Add a new Moka transaction item before regenerate
    mockDb.tables.moka_transaction_items.push({
      id: 'm2',
      receipt_number: 'R2',
      barber_id: 'b1',
      item_name: 'Cut 2',
      classification: 'NON_STOCK_SERVICE',
      gross_amount: 100000,
      discount_amount: 0,
      net_amount: 100000,
      is_deleted: false,
      tx_date: '2026-09-15',
    });

    const regen = await regeneratePayrollDraft(mockDb, { runId: draft.run.id });
    const detail = await getBarberRunDetail(mockDb, { runId: regen.run.id, barberId: 'b1' });

    // 2 service items: 100k + 100k = 200k net -> 60k comm
    assert.equal(detail.barber.service_item_count, 2);
    assert.equal(detail.barber.net_service_revenue, 200000);
    assert.equal(detail.barber.commission_amount, 60000);
    // Adjustment preserved: 25k
    assert.equal(detail.barber.manual_adjustment_total, 25000);
    assert.equal(detail.barber.payable_amount, 85000);
  });
});
