'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyLegacyRecovery, applyRecovery, applyExtras } = require('../services/mokaLegacyKeyRecovery');

const api = (receipt, date, outlet) => ({ receipt_number: receipt, tx_date: date, outlet_slug: outlet });
const legacy = (receipt, date = null, outlet = null) => ({ receipt_number: receipt, tx_date: date, outlet_slug: outlet });

// Minimal supabase fake supporting update().in()/eq().is().select() over one table.
function fakeSupabase(rows) {
  const calls = [];
  return {
    _rows: rows, _calls: calls,
    from() {
      let patch; const filters = []; const nullCols = [];
      const api = {
        update(value) { patch = value; return api; },
        in(key, values) { filters.push(r => values.includes(r[key])); return api; },
        eq(key, value) { filters.push(r => r[key] === value); return api; },
        is(col, value) { if (value === null) { nullCols.push(col); filters.push(r => r[col] === null || r[col] === undefined); } return api; },
        async select() {
          const hit = rows.filter(r => filters.every(f => f(r)));
          hit.forEach(r => Object.assign(r, patch));
          calls.push({ patch, nullCols });
          return { data: hit.map(r => ({ receipt_number: r.receipt_number })), error: null };
        },
      };
      return api;
    },
  };
}

test('exact receipt UUID match is RECOVERABLE with API date and outlet', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u1')], apiRows: [api('u1', '2026-09-12', 'csb')] });
  assert.deepEqual(r.recoverable, [{ receipt_number: 'u1', tx_date: '2026-09-12', outlet_slug: 'csb', set_tx_date: true, set_outlet_slug: true }]);
});

test('receipt not in API window is NOT_FOUND and never guessed', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u2')], apiRows: [api('other', '2026-09-12', 'csb')] });
  assert.equal(r.recoverable.length, 0);
  assert.equal(r.notFound.length, 1);
});

test('same receipt mapping to two API date/outlet pairs is AMBIGUOUS', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u3')], apiRows: [api('u3', '2026-09-12', 'csb'), api('u3', '2026-09-12', 'tegal')] });
  assert.equal(r.recoverable.length, 0);
  assert.equal(r.ambiguous[0].reason, 'multiple_api_matches');
});

test('conflicting existing date is reported and not recovered', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u4', '2026-09-01', null)], apiRows: [api('u4', '2026-09-12', 'csb')] });
  assert.equal(r.recoverable.length, 0);
  assert.equal(r.conflicts[0].disagreements[0].field, 'tx_date');
  assert.equal(r.conflicts[0].was_null_row, true);
  assert.equal(r.ambiguous.length, 0);
  assert.equal(r.extras.length, 0);
});

test('conflicting existing branch is reported and not recovered', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u5', null, 'tegal')], apiRows: [api('u5', '2026-09-12', 'csb')] });
  assert.equal(r.recoverable.length, 0);
  assert.equal(r.conflicts[0].disagreements[0].field, 'outlet_slug');
});

test('already valid rows are classified and never queued; valid conflicting rows are only reported', () => {
  const r = classifyLegacyRecovery({
    legacyRows: [legacy('u6', '2026-09-12', 'csb'), legacy('u7', '2026-09-01', 'csb')],
    apiRows: [api('u6', '2026-09-12', 'csb'), api('u7', '2026-09-12', 'csb')],
  });
  assert.equal(r.alreadyValid.length, 1);
  assert.equal(r.recoverable.length, 0);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.ambiguous.length, 0);
});

test('partial null row only sets the missing column', () => {
  const r = classifyLegacyRecovery({ legacyRows: [legacy('u8', '2026-09-12', null)], apiRows: [api('u8', '2026-09-12', 'csb')] });
  assert.equal(r.recoverable[0].set_tx_date, false);
  assert.equal(r.recoverable[0].set_outlet_slug, true);
});

test('apply is idempotent and updates no unrelated rows', async () => {
  const rows = [
    legacy('u1'), legacy('u2'),
    legacy('keep-null'),                      // NOT_FOUND: must stay null
    legacy('valid', '2026-09-01', 'bypass'),  // already valid: must not change
  ];
  const supabase = fakeSupabase(rows);
  const plan = classifyLegacyRecovery({
    legacyRows: rows.map(r => ({ ...r })),
    apiRows: [api('u1', '2026-09-12', 'csb'), api('u2', '2026-09-13', 'tegal'), api('valid', '2026-09-12', 'csb')],
  });
  assert.equal(plan.recoverable.length, 2);
  assert.equal(await applyRecovery({ supabase, recoverable: plan.recoverable }), 2);
  assert.deepEqual(rows.find(r => r.receipt_number === 'u1'), { receipt_number: 'u1', tx_date: '2026-09-12', outlet_slug: 'csb' });
  assert.deepEqual(rows.find(r => r.receipt_number === 'keep-null'), legacy('keep-null'));
  assert.deepEqual(rows.find(r => r.receipt_number === 'valid'), legacy('valid', '2026-09-01', 'bypass'));
  // rerun: the IS NULL guard means nothing further changes
  assert.equal(await applyRecovery({ supabase, recoverable: plan.recoverable }), 0);
  assert.equal(supabase._calls.every(c => c.nullCols.length > 0 && Object.keys(c.patch).every(k => ['tx_date', 'outlet_slug'].includes(k))), true);
});

test('apply never overwrites a value that became non-null after planning', async () => {
  const rows = [legacy('u1', '2026-09-20', null)];
  const supabase = fakeSupabase(rows);
  const updated = await applyRecovery({ supabase, recoverable: [{ receipt_number: 'u1', tx_date: '2026-09-12', outlet_slug: 'csb', set_tx_date: true, set_outlet_slug: true }] });
  assert.equal(updated, 0);
  assert.equal(rows[0].tx_date, '2026-09-20');
});

// ---- Sep 7-8 recovery and fill-only extras ----

const apiFull = (receipt, date, outlet, extra = {}) => ({ receipt_number: receipt, tx_date: date, outlet_slug: outlet, tx_time: '10:15:30', collected_by: 'Kasir A', total_collected: 95000, ...extra });
const legacyFull = (receipt, extra = {}) => ({ receipt_number: receipt, tx_date: null, outlet_slug: null, tx_time: null, collected_by: null, total_collected: 0, items_raw: null, ...extra });

test('Sep 7-8 receipts recover exactly by UUID and produce fill-only extras', () => {
  const r = classifyLegacyRecovery({
    legacyRows: [legacyFull('7a'), legacyFull('8b')],
    apiRows: [apiFull('7a', '2026-09-07', 'csb'), apiFull('8b', '2026-09-08', 'tegal', { collected_by: '' })],
  });
  assert.deepEqual(r.recoverable.map(x => [x.receipt_number, x.tx_date, x.outlet_slug]), [['7a', '2026-09-07', 'csb'], ['8b', '2026-09-08', 'tegal']]);
  assert.deepEqual(r.extras[0], { receipt_number: '7a', tx_time: '10:15:30', collected_by: 'Kasir A', total_collected: 95000 });
  assert.deepEqual(r.extras[1], { receipt_number: '8b', tx_time: '10:15:30', total_collected: 95000 });
});

test('extras never plan an overwrite of a non-null value', () => {
  const r = classifyLegacyRecovery({
    legacyRows: [legacyFull('x', { tx_date: '2026-09-08', outlet_slug: 'csb', tx_time: '09:00:00', collected_by: 'Existing', total_collected: 50000 })],
    apiRows: [apiFull('x', '2026-09-08', 'csb')],
  });
  assert.equal(r.alreadyValid.length, 1);
  assert.equal(r.extras.length, 0);
});

test('extras are skipped when the primary keys conflict', () => {
  const r = classifyLegacyRecovery({
    legacyRows: [legacyFull('c', { tx_date: '2026-09-01', outlet_slug: 'csb' })],
    apiRows: [apiFull('c', '2026-09-08', 'csb')],
  });
  assert.equal(r.extras.length, 0);
  assert.equal(r.conflicts.length, 1);
});

test('applyExtras fills tx_time / collected_by / total_collected only when missing, leaves items_raw alone, and is idempotent', async () => {
  const rows = [
    legacyFull('a', { items_raw: 'legacy text' }),
    legacyFull('b', { tx_time: '08:00:00', collected_by: 'Keep', total_collected: 70000 }),
    legacyFull('untouched'),
  ];
  const supabase = fakeSupabase(rows);
  const extras = [
    { receipt_number: 'a', tx_time: '10:15:30', collected_by: 'Kasir A', total_collected: 95000 },
    { receipt_number: 'b', tx_time: '10:15:30', collected_by: 'Kasir A', total_collected: 95000 },
  ];
  const first = await applyExtras({ supabase, extras });
  assert.deepEqual(first, { tx_time: 1, collected_by: 1, total_collected: 1 });
  assert.deepEqual(rows[0], { ...legacyFull('a'), tx_time: '10:15:30', collected_by: 'Kasir A', total_collected: 95000, items_raw: 'legacy text' });
  assert.equal(rows[1].tx_time, '08:00:00');
  assert.equal(rows[1].collected_by, 'Keep');
  assert.equal(rows[1].total_collected, 70000);
  assert.deepEqual(rows[2], legacyFull('untouched'));
  assert.equal(supabase._calls.some(c => 'items_raw' in c.patch), false);
  assert.deepEqual(await applyExtras({ supabase, extras }), { tx_time: 0, collected_by: 0, total_collected: 0 });
});
