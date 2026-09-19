'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyLegacyRecovery, applyRecovery } = require('../services/mokaLegacyKeyRecovery');

const api = (receipt, date, outlet) => ({ receipt_number: receipt, tx_date: date, outlet_slug: outlet });
const legacy = (receipt, date = null, outlet = null) => ({ receipt_number: receipt, tx_date: date, outlet_slug: outlet });

// Minimal supabase fake supporting update().in().is().select() over one table.
function fakeSupabase(rows) {
  const calls = [];
  return {
    _rows: rows, _calls: calls,
    from() {
      let patch; let receipts = []; const nullCols = [];
      const api = {
        update(value) { patch = value; return api; },
        in(_key, values) { receipts = values; return api; },
        is(col, value) { if (value === null) nullCols.push(col); return api; },
        async select() {
          const hit = rows.filter(r => receipts.includes(r.receipt_number) && nullCols.every(c => r[c] === null));
          hit.forEach(r => Object.assign(r, patch));
          calls.push({ patch, receipts, nullCols });
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
  assert.equal(r.ambiguous.length, 1);
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
