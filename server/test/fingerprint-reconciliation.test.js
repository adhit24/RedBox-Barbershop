'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const importer = require('../services/fingerprintAttendanceImporter');
const { calculateRegularPayrollItem, REGULAR_ITEM_STATUS } = require('../services/regularPayrollEngine');

// Period spans a month boundary on purpose: 2026-08-26 .. 2026-09-04 (10 days)
const DAYS = [26, 27, 28, 29, 30, 31, 1, 2, 3, 4];
const DATES = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31',
  '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

/**
 * people: [{ id, name, dept, punchesByDayIndex: { idx: ['08:00','17:00'] } }]
 */
function buildWorkbookBuffer(people) {
  const stat = [['Stat'], ['Periode: 2026-08-26 ~ 2026-09-04'], [], []];
  const exc = [['Exception'], [], [], []];
  const log = [['Log'], [], [], [null, null, null, ...DAYS]];
  for (const p of people) {
    stat.push([p.id, p.name, p.dept || 'ADMIN']);
    log.push(['ID:', null, p.id, null, null, null, null, null, null, null, p.name]);
    const punchRow = [null, null, null];
    DATES.forEach((d, i) => {
      const pun = p.punchesByDayIndex[i] || [];
      punchRow.push(pun.join(' '));
      exc.push([p.id, p.name, p.dept || 'ADMIN', d, pun[0] || '', pun.length > 1 ? pun[pun.length - 1] : '', null, null,
        0, 0, pun.length ? 0 : 480, 0, '']);
    });
    log.push(punchRow);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stat), 'Stat. Absen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(log), 'Lap. Log Absen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exc), 'Exception Stat.');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function fakeSupabase(store) {
  let seq = 1;
  const table = (name) => {
    const rows = (store[name] = store[name] || []);
    const filters = [];
    const orderBy = [];
    let window = null;
    const log = { table: name, gte: {}, lte: {}, ranged: false };
    (store.__queries = store.__queries || []).push(log);
    const PAGE_CAP = 1000; // PostgREST default max rows per response
    const run = () => {
      let out = rows.filter(r => filters.every(f => f(r)));
      if (orderBy.length) out = [...out].sort((a, b) => orderBy.reduce((acc, c) => acc || String(a[c]).localeCompare(String(b[c])), 0));
      if (window) return out.slice(window[0], window[1] + 1).slice(0, PAGE_CAP);
      return out.slice(0, PAGE_CAP);
    };
    const api = {
      select() { return api; },
      eq(c, v) { filters.push(r => r[c] === v); return api; },
      in(c, v) { (log.inFilters = log.inFilters || {})[c] = v; filters.push(r => v.includes(r[c])); return api; },
      gte(c, v) { log.gte[c] = v; filters.push(r => r[c] >= v); return api; },
      lte(c, v) { log.lte[c] = v; filters.push(r => r[c] <= v); return api; },
      order(c) { orderBy.push(c); return api; },
      range(a, b) { log.ranged = true; window = [a, b]; return api; },
      then(res) { res({ data: run(), error: null }); },
      maybeSingle: async () => ({ data: rows.find(r => filters.every(f => f(r))) || null, error: null }),
      single: async () => ({ data: rows.find(r => filters.every(f => f(r))) || null, error: null }),
      insert(v) {
        const arr = [].concat(v).map(r => ({ id: `id${seq++}`, ...r }));
        rows.push(...arr);
        const o = { select() { return o; }, single: async () => ({ data: arr[0], error: null }), then(res) { res({ data: arr, error: null }); } };
        return o;
      },
      upsert(v, opt) {
        const keys = (opt?.onConflict || 'id').split(',');
        for (const r of [].concat(v)) {
          const ex = rows.find(x => keys.every(k => x[k] === r[k]));
          if (ex) Object.assign(ex, r); else rows.push({ id: `id${seq++}`, ...r });
        }
        return Promise.resolve({ error: null });
      },
      update(v) {
        return { eq(c, val) { rows.filter(r => r[c] === val).forEach(r => Object.assign(r, v)); return Promise.resolve({ error: null }); } };
      },
    };
    return api;
  };
  return { from: table };
}

const AGUS = 'emp-agus';
const MELI = 'emp-meli';
const ZED = 'emp-zed';

function seedStore() {
  return {
    employees: [
      { id: AGUS, name: 'Agus Habibi', nickname: 'Agus', business_unit: 'Sundaze', branch: 'bypass', is_active: true },
      { id: MELI, name: 'Aulia Meiliani Putri', nickname: 'Meli', business_unit: 'Redbox', branch: 'tegal', is_active: true },
      { id: ZED, name: 'Zed Zedan', nickname: 'Zed', business_unit: 'Redbox', branch: 'bypass', is_active: true },
    ],
    barbers: [],
    employee_attendance_identity: [],
    employee_attendance: [],
    barber_attendance: [],
    attendance_import_batches: [],
    attendance_exceptions: [],
  };
}

function people() {
  const full = {};
  [0, 1, 2, 3, 4, 5, 6, 7].forEach(i => { full[i] = ['08:00', '17:00']; }); // days 9,10 = zero punch
  return [
    { id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: full },
    { id: '2', name: 'Meli', dept: 'ADMIN', punchesByDayIndex: { 1: ['09:00'] } }, // sporadic: 1 punch of 10 days
    { id: '3', name: 'Ajeng', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00', '17:00'], 1: ['08:00', '17:00'] } }, // terminated
    { id: '4', name: 'Ghost', dept: 'ADMIN', punchesByDayIndex: { 2: ['08:00', '17:00'] } }, // unmatched with punches
    { id: '5', name: 'Nobody', dept: 'ADMIN', punchesByDayIndex: {} }, // unmatched, no punches
    { id: '6', name: 'Zed', dept: 'ADMIN', punchesByDayIndex: {} }, // matched, enrolled but never punched
  ];
}

async function commit(store, machine = 'bypass') {
  return importer.commitImport({
    buffer: buildWorkbookBuffer(people()),
    filename: 'report.xlsx',
    uploadedBy: 'test',
    supabase: fakeSupabase(store),
    machineSource: machine,
  });
}

const rowsOf = (store, empId) => store.employee_attendance.filter(r => r.employee_id === empId);

test('Reconciliation: month rollover, primary user gets punched + absent days, dates cross Aug->Sep', async () => {
  const store = seedStore();
  await commit(store);
  const agus = rowsOf(store, AGUS);
  assert.equal(agus.length, 10);
  assert.deepEqual(agus.map(r => r.attendance_date).sort(), DATES);
  assert.equal(agus.filter(r => r.status === 'absent').length, 2);
  assert.equal(agus.find(r => r.attendance_date === '2026-09-01').raw_punches.length, 2);
});

test('Reconciliation: sparse identity (1/10 days) never gets fabricated absent/off rows', async () => {
  const store = seedStore();
  await commit(store);
  const meli = rowsOf(store, MELI);
  assert.equal(meli.length, 1);
  assert.equal(meli[0].attendance_date, '2026-08-27');
  assert.equal(meli[0].status, 'incomplete');
  assert.deepEqual(meli[0].raw_punches, ['09:00']);
});

test('Reconciliation: enrolled-but-never-punched identity writes no rows', async () => {
  const store = seedStore();
  await commit(store);
  assert.equal(rowsOf(store, ZED).length, 0);
});

test('Reconciliation: terminated identity rejected (no attendance, no exception); unmatched only with punches', async () => {
  const store = seedStore();
  const res = await commit(store);
  assert.equal(res.rejected_count, 1);
  assert.equal(store.employee_attendance.filter(r => !['emp-agus', 'emp-meli', 'emp-zed'].includes(r.employee_id)).length, 0);
  assert.equal(store.attendance_exceptions.filter(e => e.external_employee_id === '3').length, 0);
  const unmatched = store.attendance_exceptions.filter(e => e.exception_type === 'unmatched_employee');
  assert.deepEqual([...new Set(unmatched.map(e => e.external_employee_id))], ['4']);
  assert.equal(unmatched.length, 1); // only the single day with punches
});

test('Reconciliation: re-importing the same file creates 0 duplicate attendance and 0 duplicate exceptions', async () => {
  const store = seedStore();
  await commit(store);
  const attendanceAfterFirst = store.employee_attendance.length;
  const exceptionsAfterFirst = store.attendance_exceptions.length;
  const second = await commit(store);
  assert.equal(store.employee_attendance.length, attendanceAfterFirst);
  assert.equal(new Set(store.employee_attendance.map(r => `${r.employee_id}|${r.attendance_date}`)).size, attendanceAfterFirst);
  assert.equal(store.attendance_exceptions.length, exceptionsAfterFirst);
  assert.equal(second.rows_inserted, 0);
});

test('Reconciliation: existing real punches are unioned, never overwritten by absent/off', async () => {
  const store = seedStore();
  // Real punch from another source on a day the file marks as zero-punch (day index 8 = 2026-09-03)
  store.employee_attendance.push({
    id: 'seed1', employee_id: AGUS, attendance_date: '2026-09-03', first_check_in: '07:30', last_check_out: '16:00',
    status: 'hadir', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['07:30', '16:00'], source: 'fingerprint',
  });
  // Existing Meli day with real punches on a day this machine has nothing
  store.employee_attendance.push({
    id: 'seed2', employee_id: MELI, attendance_date: '2026-08-29', first_check_in: '09:00', last_check_out: '18:00',
    status: 'hadir', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['09:00', '18:00'], source: 'fingerprint',
  });
  await commit(store);
  const d3 = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-09-03');
  assert.deepEqual(d3.raw_punches, ['07:30', '16:00']);
  assert.equal(d3.status, 'hadir');
  const d29 = rowsOf(store, MELI).find(r => r.attendance_date === '2026-08-29');
  assert.deepEqual(d29.raw_punches, ['09:00', '18:00']);

  // Same day, both sources have punches -> union
  const store2 = seedStore();
  store2.employee_attendance.push({
    id: 'seed3', employee_id: AGUS, attendance_date: '2026-08-26', first_check_in: '12:00', last_check_out: null,
    status: 'incomplete', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['12:00'], source: 'fingerprint',
  });
  await commit(store2);
  const d26 = rowsOf(store2, AGUS).find(r => r.attendance_date === '2026-08-26');
  assert.deepEqual(d26.raw_punches, ['08:00', '12:00', '17:00']);
});

test('Reconciliation: machine-scoped manual mapping is stored per machine, not globally', async () => {
  const store = seedStore();
  await importer.commitImport({
    buffer: buildWorkbookBuffer(people()),
    filename: 'report.xlsx',
    supabase: fakeSupabase(store),
    machineSource: 'bypass',
    manualMappings: [{ external_employee_id: '4', external_name: 'Ghost', target_type: 'employee', employee_id: ZED }],
  });
  const idn = store.employee_attendance_identity.find(i => i.external_employee_id === '4');
  assert.equal(idn.source, 'fingerprint:bypass');
  assert.equal(store.employee_attendance_identity.filter(i => i.source === 'fingerprint').length, 0);
  // Ghost (ID 4) is now mapped on bypass -> attendance for ZED on that machine day
  assert.equal(rowsOf(store, ZED).length > 0, true);
});

test('Attendance merge lookup: existing row beyond the first 1000-row page is still found and unioned', async () => {
  const N = 120; // 120 employees x 10 days = 1200 in-period rows > 1000-row response cap
  const store = seedStore();
  store.employees = [];
  const ppl = [];
  for (let i = 0; i < N; i++) {
    const id = i === N - 1 ? 'zz-target' : `emp-${String(i).padStart(3, '0')}`; // target sorts LAST
    const nick = `E${String(i).padStart(3, '0')}`;
    store.employees.push({ id, name: `Person ${nick}`, nickname: nick, business_unit: 'Redbox', branch: 'bypass', is_active: true });
    const punches = {};
    DATES.forEach((_, d) => { punches[d] = ['08:00', '17:00']; });
    ppl.push({ id: String(i + 1), name: nick, dept: 'ADMIN', punchesByDayIndex: punches });
    DATES.forEach(d => store.employee_attendance.push({
      id: `seed-${id}-${d}`, employee_id: id, attendance_date: d, first_check_in: '08:00', last_check_out: '17:00',
      status: 'hadir', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['08:00', '17:00'], source: 'fingerprint',
    }));
  }
  // The last-sorted employee has an extra earlier punch from another source that must survive
  const targetRow = store.employee_attendance.find(r => r.employee_id === 'zz-target' && r.attendance_date === '2026-08-26');
  targetRow.raw_punches = ['07:00', '08:00', '17:00'];
  targetRow.first_check_in = '07:00';
  const before = store.employee_attendance.length;

  await importer.commitImport({
    buffer: buildWorkbookBuffer(ppl), filename: 'big.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass',
  });

  assert.equal(store.employee_attendance.length, before); // no duplicates
  const t = store.employee_attendance.find(r => r.employee_id === 'zz-target' && r.attendance_date === '2026-08-26');
  assert.deepEqual(t.raw_punches, ['07:00', '08:00', '17:00']);
  assert.equal(t.first_check_in, '07:00');
  const att = store.__queries.filter(q => q.table === 'employee_attendance' && q.ranged);
  assert.ok(att.length >= 2, 'lookup must page (range) past the first 1000 rows');
});

test('Attendance merge lookup: bounded to the import period; rows outside are never queried or merged', async () => {
  const store = seedStore();
  store.employee_attendance.push({
    id: 'old1', employee_id: AGUS, attendance_date: '2026-07-01', first_check_in: '06:00', last_check_out: '15:00',
    status: 'hadir', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['06:00', '15:00'], source: 'fingerprint',
  });
  await commit(store);
  const q = store.__queries.find(x => x.table === 'employee_attendance' && x.gte.attendance_date);
  assert.equal(q.gte.attendance_date, '2026-08-26');
  assert.equal(q.lte.attendance_date, '2026-09-04');
  const old = store.employee_attendance.find(r => r.id === 'old1');
  assert.deepEqual(old.raw_punches, ['06:00', '15:00']);
  assert.equal(old.import_batch_id, undefined); // untouched
});

test('Attendance merge lookup: a failed existing-attendance read aborts instead of overwriting blindly', async () => {
  const failing = { from: (t) => t === 'employee_attendance' ? {
    select() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; }, order() { return this; },
    range: async () => ({ data: null, error: { message: 'boom' } }),
  } : null };
  await assert.rejects(() => importer.fetchExistingAttendance(failing, ['a'], '2026-08-26', '2026-09-04'), /boom/);
});

// ---- Payroll READY must consider coverage and source period ----

const period = { period_start: '2026-08-26', period_end: '2026-09-25' };
const baseEmployee = { id: 'e1', name: 'Tester', business_unit: 'Sundaze', base_salary: 3000000, position: 'Barista' };
const summary = (over) => ({
  present_days: 6, absent_days: 0, late_count: 0, late_minutes: 0, incomplete_attendance: 0,
  unresolved_exceptions_count: 0, pending_overtime_count: 0, records_count: 6,
  expected_coverage_days: 26, attendance_data_through: '2026-09-20', attendance_period_complete: false, ...over,
});

test('Payroll: few attendance days out of expected coverage is REVIEW_REQUIRED, not READY', () => {
  const item = calculateRegularPayrollItem({ employee: baseEmployee, period, attendanceSummary: summary({}) });
  assert.equal(item.status, REGULAR_ITEM_STATUS.REVIEW_REQUIRED);
  assert.match(item.warnings.join(' '), /Cakupan presensi hanya 6 dari 26/);
});

test('Payroll: full coverage through source end is READY but flagged not final while source ends before period end', () => {
  const item = calculateRegularPayrollItem({
    employee: baseEmployee, period,
    attendanceSummary: summary({ present_days: 22, records_count: 26 }),
  });
  assert.equal(item.status, REGULAR_ITEM_STATUS.READY);
  assert.match(item.warnings.join(' '), /Belum final/);
  assert.equal(item.attendance_summary.attendance_period_complete, false);
});

test('Payroll: no records stays MISSING_ATTENDANCE (never treated as absent for missing days)', () => {
  const item = calculateRegularPayrollItem({
    employee: baseEmployee, period,
    attendanceSummary: summary({ present_days: 0, records_count: 0 }),
  });
  assert.equal(item.status, REGULAR_ITEM_STATUS.MISSING_ATTENDANCE);
});

test('Exception dedup: a duplicate that sits beyond the first 1000-row page is still found (no duplicate created)', async () => {
  const store = seedStore();
  // 1100 pending exceptions for identity 4 within the period (different types) sort BEFORE the target day
  for (let i = 0; i < 1100; i++) {
    store.attendance_exceptions.push({
      id: `fill-${String(i).padStart(4, '0')}`, external_employee_id: '4', attendance_date: i % 2 ? '2026-08-26' : '2026-08-27',
      exception_type: `other_type_${i}`, status: 'pending', raw_data: { machine_source: 'bypass' },
    });
  }
  // The real earlier exception for Ghost's punched day (2026-08-28) sorts after them -> page 2
  store.attendance_exceptions.push({
    id: 'target-dup', external_employee_id: '4', attendance_date: '2026-08-28',
    exception_type: 'unmatched_employee', status: 'pending', raw_data: { machine_source: 'bypass' },
  });
  const before = store.attendance_exceptions.filter((e) => e.exception_type === 'unmatched_employee').length;

  await commit(store);

  assert.equal(store.attendance_exceptions.filter((e) => e.exception_type === 'unmatched_employee').length, before,
    'the duplicate on page 2 must be detected');
  const pagedQueries = store.__queries.filter((q) => q.table === 'attendance_exceptions' && q.ranged);
  assert.ok(pagedQueries.length >= 2, 'lookup must page past the first 1000 rows');
});

test('Exception dedup: lookup is bounded to the import period; rows outside are never read', async () => {
  const store = seedStore();
  store.attendance_exceptions.push({
    id: 'old', external_employee_id: '4', attendance_date: '2026-07-01',
    exception_type: 'unmatched_employee', status: 'pending', raw_data: { machine_source: 'bypass' },
  });
  await commit(store);
  const q = store.__queries.find((x) => x.table === 'attendance_exceptions' && x.gte.attendance_date);
  assert.equal(q.gte.attendance_date, '2026-08-26');
  assert.equal(q.lte.attendance_date, '2026-09-04');
  assert.ok(q.inFilters && q.inFilters.external_employee_id, 'scoped to the identities being written');
  // The out-of-period row was left alone and a fresh one was still inserted for the in-period day
  assert.equal(store.attendance_exceptions.find((e) => e.id === 'old').attendance_date, '2026-07-01');
  assert.ok(store.attendance_exceptions.some((e) => e.exception_type === 'unmatched_employee' && e.attendance_date === '2026-08-28'));
});

// ---- PRRT_kwDOSNmW7c6kYVyb: fingerprint files are never authoritative for overtime_minutes ----

test('Overtime preservation: fingerprint re-import never resets an existing overtime_minutes value', async () => {
  const store = seedStore();
  store.employee_attendance.push({
    id: 'seed-ot', employee_id: AGUS, attendance_date: '2026-08-26', first_check_in: '08:00', last_check_out: '17:00',
    status: 'hadir', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['08:00', '17:00'], overtime_minutes: 90, source: 'fingerprint',
  });
  await commit(store);
  const d26 = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-08-26');
  assert.equal(d26.overtime_minutes, 90);
});

test('Overtime preservation: existing overtime_minutes survives even when the re-import supplies a missing punch', async () => {
  const store = seedStore();
  store.employee_attendance.push({
    id: 'seed-ot2', employee_id: AGUS, attendance_date: '2026-08-26', first_check_in: '08:00', last_check_out: null,
    status: 'incomplete', late_minutes: 0, early_leave_minutes: 0, raw_punches: ['08:00'], overtime_minutes: 60, source: 'fingerprint',
  });
  await commit(store); // day index 0 in the file already has both punches
  const d26 = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-08-26');
  assert.deepEqual(d26.raw_punches, ['08:00', '17:00']);
  assert.equal(d26.overtime_minutes, 60);
});

test('Overtime preservation: a genuinely new attendance row (no prior DB record) still defaults overtime_minutes to 0', async () => {
  const store = seedStore();
  await commit(store);
  const d26 = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-08-26');
  assert.equal(d26.overtime_minutes, 0);
});

test('Overtime preservation: idempotent re-import of an unchanged day does not disturb overtime_minutes', async () => {
  const store = seedStore();
  await commit(store);
  const before = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-08-26').overtime_minutes;
  await commit(store); // second identical import
  const after = rowsOf(store, AGUS).find(r => r.attendance_date === '2026-08-26').overtime_minutes;
  assert.equal(after, before);
});

// ---- PRRT_kwDOSNmW7c6kYVyo: stale single_punch exceptions must be reconciled against current attendance ----

test('Stale single_punch reconciliation: exception is auto-resolved once a later import supplies the missing punch', async () => {
  const store = seedStore();
  const single = [{ id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00'] } }];
  await importer.commitImport({ buffer: buildWorkbookBuffer(single), filename: 'r1.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });
  const before = store.attendance_exceptions.find(e => e.exception_type === 'single_punch' && e.raw_data.employee_id === AGUS);
  assert.ok(before, 'single_punch exception must be created on first import');
  assert.equal(before.status, 'pending');

  const complete = [{ id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00', '17:00'] } }];
  await importer.commitImport({ buffer: buildWorkbookBuffer(complete), filename: 'r2.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });

  const after = store.attendance_exceptions.find(e => e.id === before.id);
  assert.equal(after.status, 'resolved');
  assert.equal(after.resolution_notes, 'AUTO_RESOLVED_AFTER_ATTENDANCE_CORRECTION');
  assert.equal(after.resolved_by, 'system:fingerprint_import');
  assert.ok(after.resolved_at);
});

test('Stale single_punch reconciliation: still-single-punch on re-import stays pending', async () => {
  const store = seedStore();
  const single = [{ id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00'] } }];
  await importer.commitImport({ buffer: buildWorkbookBuffer(single), filename: 'r1.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });
  await importer.commitImport({ buffer: buildWorkbookBuffer(single), filename: 'r2.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });
  const exc = store.attendance_exceptions.find(e => e.exception_type === 'single_punch');
  assert.equal(exc.status, 'pending');
});

test('Stale single_punch reconciliation: an unrelated pending exception (unmatched_employee) is never auto-resolved', async () => {
  const store = seedStore();
  await commit(store); // Ghost (id 4) creates an unmatched_employee exception
  const before = store.attendance_exceptions.find(e => e.exception_type === 'unmatched_employee');
  assert.ok(before);
  assert.equal(before.status, 'pending');
  await commit(store);
  const after = store.attendance_exceptions.find(e => e.id === before.id);
  assert.equal(after.status, 'pending');
});

test('Stale single_punch reconciliation: historical exception row is kept for audit, not deleted', async () => {
  const store = seedStore();
  const single = [{ id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00'] } }];
  await importer.commitImport({ buffer: buildWorkbookBuffer(single), filename: 'r1.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });
  const before = store.attendance_exceptions.length;
  const complete = [{ id: '1', name: 'Agus', dept: 'ADMIN', punchesByDayIndex: { 0: ['08:00', '17:00'] } }];
  await importer.commitImport({ buffer: buildWorkbookBuffer(complete), filename: 'r2.xlsx', supabase: fakeSupabase(store), machineSource: 'bypass' });
  assert.equal(store.attendance_exceptions.length, before, 'row count unchanged: resolved in place, not deleted');
});

test('Exception dedup: a failed pending-exception read aborts instead of treating it as empty', async () => {
  const failing = { from: () => ({
    select() { return this; }, eq() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; }, order() { return this; },
    range: async () => ({ data: null, error: { message: 'boom' } }),
  }) };
  await assert.rejects(() => importer.fetchPendingExceptions(failing, ['4'], '2026-08-26', '2026-09-04'), /boom/);
});
