'use strict';

/**
 * JS emulation of public.create_regular_payroll_run(p_header, p_items) for test doubles.
 * It mirrors the SQL: overlap rule (DRAFT/LOCKED, same period overlap, same business unit or either 'ALL'),
 * non-empty items, header + items as ONE unit (a failing item insert rolls the header back).
 * The SQL itself is asserted in payroll-lock-migration.test.js and was executed in a rolled-back
 * transaction against the real database objects.
 */
function emulateCreateRegularPayrollRun(store, args, { idFactory, failItemInsert = null } = {}) {
  const header = args?.p_header || {};
  const itemsIn = args?.p_items;
  if (!Array.isArray(itemsIn) || itemsIn.length === 0) {
    return { data: null, error: { message: 'Cannot create a regular payroll run without payroll items' } };
  }
  store.payroll_runs = store.payroll_runs || [];
  store.payroll_regular_items = store.payroll_regular_items || [];
  const runs = store.payroll_runs;
  const items = store.payroll_regular_items;
  const unit = header.business_unit || 'ALL';

  const overlap = runs.find((r) =>
    ['REGULAR', 'REGULAR_PAYROLL'].includes(r.payroll_type) &&
    ['DRAFT', 'LOCKED'].includes(r.status) &&
    r.period_start <= header.period_end && r.period_end >= header.period_start &&
    (r.business_unit === unit || r.business_unit === 'ALL' || unit === 'ALL'));
  if (overlap) {
    return { data: null, error: { message: `Overlapping regular payroll run exists: ${overlap.id} (a DRAFT or LOCKED run already covers this period and business unit)` } };
  }

  // Validate authoritative attendance source versions (P1-1)
  for (const it of itemsIn) {
    const rec = (store.payroll_attendance_source_versions || []).find((v) => v.employee_id === it.employee_id);
    const currVer = Number(rec?.source_revision || 0);
    const expectedVer = Number(it.attendance_source_revision || 0);
    if (currVer !== expectedVer) {
      return {
        data: null,
        error: {
          message: `ATTENDANCE_CHANGED_DURING_GENERATION: attendance source changed for employee ${it.employee_id} (expected ${expectedVer}, current ${currVer})`,
        },
      };
    }
  }

  const before = { runs: runs.length, items: items.length };
  const runId = idFactory();
  runs.push({
    id: runId,
    payroll_type: 'REGULAR',
    business_unit: unit,
    period_start: header.period_start,
    period_end: header.period_end,
    status: 'DRAFT',
    generated_by: header.generated_by,
    calculation_version: header.calculation_version || 'regular-v1.0',
    summary: header.summary || {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  try {
    if (failItemInsert) throw new Error(failItemInsert);
    for (const it of itemsIn) {
      items.push({
        id: idFactory(),
        payroll_run_id: runId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attendance_source_revision: Number(it.attendance_source_revision || 0),
        attendance_snapshot_revision: Number(it.attendance_snapshot_revision || 0),
        payroll_input_revision: Number(it.payroll_input_revision || 0),
        payroll_snapshot_revision: Number(it.payroll_snapshot_revision || 0),
        ...it,
      });
    }
  } catch (err) {
    runs.length = before.runs; // whole function is one transaction: nothing survives
    items.length = before.items;
    return { data: null, error: { message: err.message } };
  }
  return { data: { run_id: runId, items_count: itemsIn.length, status: 'DRAFT' }, error: null };
}

/**
 * JS emulation of public.add_regular_payroll_run_items(p_run_id, p_items) for test doubles.
 * Mirrors the SQL (20260922000000_regular_payroll_population_reconciliation.sql): DRAFT-only,
 * per-employee duplicate rejection, the same source-revision concurrency guard as
 * create_regular_payroll_run, and a server-side eligibility re-check (is_active, employment_type
 * = 'regular', join_date <= period_end, matching business unit) independent of the caller's snapshot.
 */
function emulateAddRegularPayrollRunItems(store, args, { idFactory = () => `n${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const runId = args?.p_run_id;
  const itemsIn = args?.p_items;
  if (!Array.isArray(itemsIn) || itemsIn.length === 0) {
    return { data: { run_id: runId, items_count: 0, status: 'NOOP' }, error: null };
  }
  store.payroll_runs = store.payroll_runs || [];
  store.payroll_regular_items = store.payroll_regular_items || [];
  store.employees = store.employees || [];
  const run = store.payroll_runs.find((r) => r.id === runId);
  if (!run) {
    return { data: null, error: { message: `Payroll run ${runId} not found` } };
  }
  if (run.status !== 'DRAFT') {
    return { data: null, error: { message: `Cannot add items to payroll run ${runId}: status is ${run.status} (only DRAFT can be modified)` } };
  }

  // Workforce serialization (P1, PRRT_kwDOSNmW7c6klyj1): the real SQL holds a `FOR UPDATE` row lock on
  // payroll_workforce_version for the rest of the transaction instead of comparing two unlocked reads --
  // a real Postgres transactional guarantee a synchronous single-threaded JS double cannot meaningfully
  // reproduce. See regular-payroll-round15.test.js for the static SQL-text assertions.

  for (const it of itemsIn) {
    const alreadyPresent = store.payroll_regular_items.some((i) => i.payroll_run_id === runId && i.employee_id === it.employee_id);
    if (alreadyPresent) {
      return { data: null, error: { message: `EMPLOYEE_ALREADY_IN_RUN: employee ${it.employee_id} already has a payroll item in run ${runId}` } };
    }

    const rec = (store.payroll_attendance_source_versions || []).find((v) => v.employee_id === it.employee_id);
    const currVer = Number(rec?.source_revision || 0);
    const expectedVer = Number(it.attendance_source_revision || 0);
    if (currVer !== expectedVer) {
      return {
        data: null,
        error: { message: `PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION: attendance source changed for employee ${it.employee_id} (expected ${expectedVer}, current ${currVer})` },
      };
    }

    const emp = store.employees.find((e) => e.id === it.employee_id);
    const empEligible = !!emp && emp.is_active === true &&
      (emp.employment_type == null || emp.employment_type === 'regular') &&
      (!emp.join_date || emp.join_date <= run.period_end) &&
      (run.business_unit === 'ALL' || emp.business_unit === run.business_unit);
    if (!empEligible) {
      return { data: null, error: { message: `EMPLOYEE_NOT_ELIGIBLE_FOR_POPULATION_RECONCILIATION: employee ${it.employee_id} is not currently eligible for run ${runId}` } };
    }
  }

  for (const it of itemsIn) {
    store.payroll_regular_items.push({
      id: idFactory(),
      payroll_run_id: runId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attendance_source_revision: Number(it.attendance_source_revision || 0),
      attendance_snapshot_revision: Number(it.attendance_snapshot_revision || 0),
      payroll_input_revision: Number(it.payroll_input_revision || 0),
      payroll_snapshot_revision: Number(it.payroll_snapshot_revision || 0),
      ...it,
    });
  }
  return { data: { run_id: runId, items_count: itemsIn.length, status: 'DRAFT' }, error: null };
}

module.exports = { emulateCreateRegularPayrollRun, emulateAddRegularPayrollRunItems };
