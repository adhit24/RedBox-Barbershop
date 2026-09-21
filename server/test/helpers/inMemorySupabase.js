'use strict';

/**
 * Minimal in-memory Supabase/PostgREST double for payroll tests.
 *  - select / eq / in / gt / gte / lte / order / range / single / maybeSingle
 *  - PostgREST-like 1000-row response cap unless range() is used
 *  - embedded employees(...) join for employee_overtime_approvals
 *  - insert / update().eq().select().single() / delete().eq()
 *  - failures can be injected: opts.failOn = { 'table.insert' | 'table.update' | 'table.delete': message }
 */
function createInMemorySupabase(store, opts = {}) {
  const failOn = opts.failOn || {};
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
      in(c, v) { (api.__in = api.__in || {})[c] = v; filters.push((r) => v.includes(r[c])); return api; },
      gt(c, v) { filters.push((r) => r[c] > v); return api; },
      gte(c, v) { filters.push((r) => r[c] >= v); return api; },
      lte(c, v) { filters.push((r) => r[c] <= v); return api; },
      order(c, o) { orderBy.push({ col: c, asc: !(o && o.ascending === false) }); return api; },
      range(a, b) { window = [a, b]; (store.__ranged = store.__ranged || []).push(name); return api; },
      then(res) { res({ data: run(), error: null }); },
      single: async () => { const r = run()[0]; return { data: r || null, error: r ? null : { message: 'not found' } }; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      insert(v) {
        const msg = fail('insert');
        if (msg) {
          const o = { select() { return o; }, single: async () => ({ data: null, error: { message: msg } }), then(res) { res({ data: null, error: { message: msg } }); } };
          return o;
        }
        const arr = [].concat(v).map((r) => ({ id: `n${seq++}`, ...r }));
        rows.push(...arr);
        const o = { select() { return o; }, single: async () => ({ data: arr[0], error: null }), then(res) { res({ data: arr, error: null }); } };
        return o;
      },
      update(u) {
        return {
          eq(c, val) {
            const msg = fail('update');
            if (msg) {
              const o = { select() { return o; }, single: async () => ({ data: null, error: { message: msg } }), then(res) { res({ data: null, error: { message: msg } }); } };
              return o;
            }
            const hit = rows.filter((r) => r[c] === val);
            hit.forEach((r) => Object.assign(r, u));
            const o = { select() { return o; }, single: async () => ({ data: hit[0] || null, error: hit[0] ? null : { message: 'not found' } }), then(res) { res({ data: hit, error: null }); } };
            return o;
          },
        };
      },
      delete() {
        return {
          eq(c, val) {
            const msg = fail('delete');
            if (msg) return Promise.resolve({ error: { message: msg } });
            const i = rows.findIndex((r) => r[c] === val);
            if (i >= 0) rows.splice(i, 1);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  };
  return { from: table };
}

module.exports = { createInMemorySupabase };
