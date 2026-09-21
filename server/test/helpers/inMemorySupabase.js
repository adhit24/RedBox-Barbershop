'use strict';

/**
 * Minimal in-memory Supabase/PostgREST double for payroll tests.
 *  - select / eq / in / gt / gte / lte / order / range / single / maybeSingle
 *  - PostgREST-like 1000-row response cap unless range() is used
 *  - embedded employees(...) join for employee_overtime_approvals
 *  - insert / update().eq().select().single() / delete().eq()
 *  - failures can be injected: opts.failOn = { 'table.insert' | 'table.update' | 'table.delete' | 'table.select': message }
 */
const { emulateCreateRegularPayrollRun } = require('./regularPayrollRpc');

function createInMemorySupabase(store, opts = {}) {
  const failOn = opts.failOn || {};
  const emulateTriggers = opts.emulateTriggers !== false;

  const bumpSourceVersion = (employeeId) => {
    store.payroll_attendance_source_versions = store.payroll_attendance_source_versions || [];
    let rec = store.payroll_attendance_source_versions.find((v) => v.employee_id === employeeId);
    if (!rec) {
      rec = { employee_id: employeeId, source_revision: 1 };
      store.payroll_attendance_source_versions.push(rec);
    } else {
      rec.source_revision = Number(rec.source_revision || 0) + 1;
    }
  };

  // trg_payroll_adjustment_mark_dirty: same transaction as the adjustment write
  const markDirty = (itemId) => {
    const item = (store.payroll_regular_items || []).find((i) => i.id === itemId);
    if (item) {
      item.payroll_input_revision = Number(item.payroll_input_revision || 0) + 1;
      item.attendance_summary = { ...(item.attendance_summary || {}), adjustments_dirty: true };
    }
  };

  // trg_overtime_approval_payroll_sync: bumps source version & draft item input revision
  const overtimeApprovalEffect = (employeeId, date) => {
    bumpSourceVersion(employeeId);
    for (const run of store.payroll_runs || []) {
      if (!['REGULAR', 'REGULAR_PAYROLL'].includes(run.payroll_type)) continue;
      if (!(date >= run.period_start && date <= run.period_end)) continue;
      const items = (store.payroll_regular_items || []).filter((i) => i.payroll_run_id === run.id && i.employee_id === employeeId);
      if (run.status === 'DRAFT') {
        items.filter((i) => i.status !== 'LOCKED').forEach((i) => {
          i.payroll_input_revision = Number(i.payroll_input_revision || 0) + 1;
        });
      }
    }
  };

  // trg_attendance_payroll_sync: a payroll-relevant employee_attendance change marks the employee's DRAFT items
  // attendance_dirty; LOCKED runs are never touched (anomaly log instead). Mirrors apply_attendance_payroll_effect.
  const ATT_FIELDS = ['status', 'late_minutes', 'overtime_minutes', 'first_check_in', 'last_check_out'];
  const attendanceEffect = (employeeId, date, operation) => {
    bumpSourceVersion(employeeId);
    for (const run of store.payroll_runs || []) {
      if (!['REGULAR', 'REGULAR_PAYROLL'].includes(run.payroll_type)) continue;
      if (!(date >= run.period_start && date <= run.period_end)) continue;
      const items = (store.payroll_regular_items || []).filter((i) => i.payroll_run_id === run.id && i.employee_id === employeeId);
      if (run.status === 'DRAFT') {
        items.filter((i) => i.status !== 'LOCKED').forEach((i) => {
          i.attendance_source_revision = Number(i.attendance_source_revision || 0) + 1;
          i.payroll_input_revision = Number(i.payroll_input_revision || 0) + 1;
          i.attendance_summary = { ...(i.attendance_summary || {}), attendance_dirty: true };
        });
      } else if (run.status === 'LOCKED' && items.length) {
        (store.payroll_attendance_post_lock_anomalies = store.payroll_attendance_post_lock_anomalies || []).push({ payroll_run_id: run.id, employee_id: employeeId, attendance_date: date, operation });
      }
    }
  };
  const CAP = 1000;
  let seq = 1;

  const table = (name) => {
    const rows = (store[name] = store[name] || []);
    const filters = [];
    const orderBy = [];
    let joinEmployees = false;
    let window = null;
    const run = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (orderBy.length) {
        out = [...out].sort((a, b) => orderBy.reduce((acc, o) => {
          if (acc) return acc;
          const cmp = String(a[o.col]).localeCompare(String(b[o.col]));
          return o.asc ? cmp : -cmp;
        }, 0));
      }
      if (window) out = out.slice(window[0], window[1] + 1);
      out = out.slice(0, CAP);
      if (joinEmployees) {
        out = out.map((r) => ({ ...r, employees: (store.employees || []).find((e) => e.id === r.employee_id) || null }));
      }
      return out;
    };
    const fail = (op) => failOn[`${name}.${op}`] || null;

    const api = {
      select(cols) { joinEmployees = name === 'employee_overtime_approvals' && /employees\s*\(/.test(String(cols || '')); return api; },
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      neq(c, v) { filters.push((r) => r[c] !== v); return api; },
      or(expr) { // "col.eq.X,col.eq.Y"
        const parts = String(expr).split(',').map((x) => x.split('.eq.'));
        filters.push((r) => parts.some(([c, v]) => String(r[c]) === v));
        return api;
      },
      in(c, v) { (api.__in = api.__in || {})[c] = v; filters.push((r) => v.includes(r[c])); return api; },
      gt(c, v) { filters.push((r) => r[c] > v); return api; },
      gte(c, v) { filters.push((r) => r[c] >= v); return api; },
      lte(c, v) { filters.push((r) => r[c] <= v); return api; },
      order(c, o) { orderBy.push({ col: c, asc: !(o && o.ascending === false) }); return api; },
      range(a, b) { window = [a, b]; (store.__ranged = store.__ranged || []).push(name); return api; },
      then(res) {
        const selMsg = fail('select');
        if (selMsg) return res({ data: null, error: { message: selMsg } });
        res({ data: run(), error: null });
      },
      single: async () => { const sm = fail('select'); if (sm) return { data: null, error: { message: sm } }; const r = run()[0]; return { data: r || null, error: r ? null : { message: 'not found' } }; },
      maybeSingle: async () => { const sm = fail('select'); if (sm) return { data: null, error: { message: sm } }; return { data: run()[0] || null, error: null }; },
      insert(v) {
        const msg = fail('insert');
        if (msg) {
          const o = { select() { return o; }, single: async () => ({ data: null, error: { message: msg } }), then(res) { res({ data: null, error: { message: msg } }); } };
          return o;
        }
        const arr = [].concat(v).map((r) => ({ id: `n${seq++}`, ...r }));
        if (emulateTriggers && name === 'payroll_adjustments') {
          // trg_payroll_adjustment_ownership
          for (const r of arr) {
            const item = (store.payroll_regular_items || []).find((i) => i.id === r.payroll_regular_item_id);
            const run = (store.payroll_runs || []).find((x) => x.id === r.payroll_run_id);
            let message = null;
            if (!item || item.payroll_run_id !== r.payroll_run_id) message = `Payroll adjustment item ${r.payroll_regular_item_id} does not belong to payroll run ${r.payroll_run_id}`;
            else if (r.employee_id && r.employee_id !== item.employee_id) message = 'Payroll adjustment employee does not match the payroll item';
            else if (run && !['REGULAR', 'REGULAR_PAYROLL'].includes(run.payroll_type)) message = 'Payroll adjustment for a regular item requires a REGULAR payroll run';
            if (message) {
              const o = { select() { return o; }, single: async () => ({ data: null, error: { message } }), then(res) { res({ data: null, error: { message } }); } };
              return o;
            }
          }
        }
        if (emulateTriggers && name === 'employee_attendance') {
          for (const r of arr) {
            const existing = rows.find((x) => x.employee_id === r.employee_id && x.attendance_date === r.attendance_date);
            if (!(existing && ATT_FIELDS.every((f) => existing[f] === r[f]))) attendanceEffect(r.employee_id, r.attendance_date, 'INSERT');
          }
        }
        if (emulateTriggers && name === 'employee_overtime_approvals') {
          arr.forEach((r) => overtimeApprovalEffect(r.employee_id, r.attendance_date));
        }
        rows.push(...arr);
        if (emulateTriggers && name === 'payroll_adjustments') arr.forEach((r) => markDirty(r.payroll_regular_item_id));
        const o = { select() { return o; }, single: async () => ({ data: arr[0], error: null }), then(res) { res({ data: arr, error: null }); } };
        return o;
      },
      upsert(v, opts = {}) {
        const msg = fail('upsert');
        if (msg) {
          const o = { select() { return o; }, single: async () => ({ data: null, error: { message: msg } }), then(res) { res({ data: null, error: { message: msg } }); } };
          return o;
        }
        const arr = [].concat(v);
        const conflictCols = (opts.onConflict || '').split(',').map((c) => c.trim()).filter(Boolean);
        for (const r of arr) {
          let idx = -1;
          if (conflictCols.length > 0) {
            idx = rows.findIndex((existing) => conflictCols.every((c) => existing[c] === r[c]));
          }
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...r };
          } else {
            rows.push({ id: r.id || `n${seq++}`, ...r });
          }
        }
        const o = { select() { return o; }, single: async () => ({ data: arr[0], error: null }), then(res) { res({ data: arr, error: null }); } };
        return o;
      },
      update(u) {
        const filters = [];
        const builder = {
          eq(c, val) {
            filters.push((r) => r[c] === val);
            return builder;
          },
          select() {
            return builder;
          },
          single: async () => execute(true),
          maybeSingle: async () => execute(false),
          then(res) {
            res(execute(false));
          },
        };
        const execute = (mustExist) => {
          const msg = fail('update');
          if (msg) return { data: null, error: { message: msg } };
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (emulateTriggers && name === 'employee_attendance') {
            hit.forEach((r) => {
              if (ATT_FIELDS.some((f) => f in u && u[f] !== r[f])) attendanceEffect(r.employee_id, r.attendance_date, 'UPDATE');
            });
          }
          if (emulateTriggers && name === 'employee_overtime_approvals') {
            hit.forEach((r) => overtimeApprovalEffect(r.employee_id, r.attendance_date));
          }
          hit.forEach((r) => Object.assign(r, u));
          return { data: hit[0] || null, error: (mustExist && !hit[0]) ? { message: 'not found' } : null };
        };
        return builder;
      },
      delete() {
        return {
          eq(c, val) {
            const msg = fail('delete');
            if (msg) return Promise.resolve({ error: { message: msg } });
            const i = rows.findIndex((r) => r[c] === val);
            let removed = null;
            if (i >= 0) removed = rows.splice(i, 1)[0];
            if (emulateTriggers && name === 'employee_attendance' && removed) attendanceEffect(removed.employee_id, removed.attendance_date, 'DELETE');
            if (emulateTriggers && name === 'employee_overtime_approvals' && removed) overtimeApprovalEffect(removed.employee_id, removed.attendance_date);
            if (emulateTriggers && name === 'payroll_adjustments' && removed) markDirty(removed.payroll_regular_item_id);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  };
  return {
    from: table,
    rpc(fn, args) {
      if (fn === 'create_regular_payroll_run') {
        return Promise.resolve(emulateCreateRegularPayrollRun(store, args, {
          idFactory: () => `n${seq++}`,
          failItemInsert: failOn['payroll_regular_items.insert'] || null,
        }));
      }
      if (fn === 'lock_payroll_run') {
        // The invariants live in the SQL (asserted statically) and in the service-side mirror; here only the state change
        const runRow = (store.payroll_runs || []).find((r) => r.id === args.p_run_id);
        if (!runRow) return Promise.resolve({ data: null, error: { message: `Payroll run ${args.p_run_id} not found` } });
        if (runRow.status !== 'DRAFT') return Promise.resolve({ data: null, error: { message: `Cannot lock payroll run: current status is ${runRow.status}` } });
        // lock invariant: a DRAFT item whose attendance changed after calculation cannot be locked (dirty OR revision mismatch)
        const dirtyItem = (store.payroll_regular_items || []).find((i) =>
          i.payroll_run_id === runRow.id && (
            i.attendance_summary?.attendance_dirty === true ||
            i.attendance_summary?.adjustments_dirty === true ||
            Number(i.attendance_source_revision || 0) !== Number(i.attendance_snapshot_revision || 0) ||
            Number(i.payroll_input_revision || 0) !== Number(i.payroll_snapshot_revision || 0)
          )
        );
        if (dirtyItem) return Promise.resolve({ data: null, error: { message: `Payroll attendance snapshot is stale for ${dirtyItem.employee_name_snapshot}. Recalculate before locking.` } });
        // lock invariant (P1-1): ANY item with REVIEW_REQUIRED rejects lock
        const reviewItems = (store.payroll_regular_items || []).filter((i) => i.payroll_run_id === runRow.id && i.status === 'REVIEW_REQUIRED');
        if (reviewItems.length > 0) return Promise.resolve({ data: null, error: { message: `Cannot lock regular payroll run ${runRow.id}: ${reviewItems.length} review-required item(s) remain. Resolve all review warnings before locking.` } });
        runRow.status = 'LOCKED';
        (store.payroll_regular_items || []).filter((i) => i.payroll_run_id === runRow.id).forEach((i) => { i.status = 'LOCKED'; });
        return Promise.resolve({ data: { success: true, status: 'LOCKED', run_id: runRow.id }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `Unknown RPC ${fn}` } });
    },
  };
}

module.exports = { createInMemorySupabase };
