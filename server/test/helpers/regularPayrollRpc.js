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

module.exports = { emulateCreateRegularPayrollRun };
