'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REDBOX_OUTLET_SLUGS,
  resolveBusinessDates,
  normalizeMokaPayment,
  fetchOutletDayRange,
  aggregateRows,
  syncMokaDailyTransactions,
} = require('../services/mokaDailyTransactionSync');

function createSupabase(seed = {}) {
  const store = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  const table = name => (store[name] ||= []);
  function builder(name) {
    let mode = 'select'; let payload; let conflict = []; const filters = [];
    const api = {
      select() { return api; },
      in(key, values) { filters.push(row => values.includes(row[key])); return api; },
      eq(key, value) { filters.push(row => row[key] === value); return api; },
      not(key, _op, value) { if (value === null) filters.push(row => row[key] !== null); return api; },
      gte(key, value) { filters.push(row => row[key] >= value); return api; },
      lte(key, value) { filters.push(row => row[key] <= value); return api; },
      order() { return api; },
      upsert(value, opts = {}) { mode = 'upsert'; payload = value; conflict = String(opts.onConflict || '').split(','); return api; },
      insert(value) { mode = 'insert'; payload = value; return api; },
      async maybeSingle() { const result = await api._exec(); return { ...result, data: result.data[0] || null }; },
      async then(resolve) { resolve(await api._exec()); },
      async _exec() {
        if (mode === 'insert') { table(name).push(...(Array.isArray(payload) ? payload : [payload])); return { data: payload, error: null }; }
        if (mode === 'upsert') {
          for (const row of (Array.isArray(payload) ? payload : [payload])) {
            const found = table(name).find(existing => conflict.every(key => existing[key] === row[key]));
            if (found) Object.assign(found, row); else table(name).push({ ...row });
          }
          return { data: payload, error: null };
        }
        return { data: table(name).filter(row => filters.every(filter => filter(row))), error: null };
      },
    };
    return api;
  }
  return { _store: store, from: builder };
}

function outlets() {
  return REDBOX_OUTLET_SLUGS.map((slug, index) => ({ id: `out-${index}`, slug, moka_outlet_id: String(1000 + index), is_active: true }));
}

function payment(id, createdAt, overrides = {}) {
  return { id, created_at: createdAt, subtotal: 100000, discounts: 10000, total_refund: 0, total_collected: 90000, ...overrides };
}

test('Jakarta business window is yesterday plus day-2 and manual date is validated', () => {
  assert.deepEqual(resolveBusinessDates({ now: new Date('2026-09-10T00:15:00+07:00') }), ['2026-09-09', '2026-09-08']);
  assert.deepEqual(resolveBusinessDates({ date: '2026-09-01' }), ['2026-09-01']);
  assert.throws(() => resolveBusinessDates({ date: '2026-02-30' }), /valid YYYY-MM-DD/);
});

test('normalization uses payment UUID, subtotal-discount-refund, and one Payment count', () => {
  const row = normalizeMokaPayment(payment('global-uuid', '2026-09-09T10:00:00+07:00', { total_refund: 20000 }), 'csb');
  assert.equal(row.receipt_number, 'global-uuid');
  assert.equal(row.gross_sales, 110000);
  assert.equal(row.Discounts, 10000);
  assert.equal(row.Refunds, 20000);
  assert.equal(row.net_sales, 80000);
  assert.equal(aggregateRows([row], '2026-09-09', 'csb').transaction_count, 1);
  const refundCorrection = { ...row, receipt_number: 'refund-1', net_sales: -20000, gross_sales: 0, Discounts: 0, Refunds: 20000, 'Event Type': 'Refund' };
  const aggregate = aggregateRows([row, refundCorrection], '2026-09-09', 'csb');
  assert.equal(aggregate.net_sales, 60000);
  assert.equal(aggregate.transaction_count, 1);
});

test('cursor pagination retrieves all pages and filters dates without PII logging', async () => {
  let calls = 0;
  const client = { getPaidTransactionsPage: async () => {
    calls += 1;
    if (calls === 1) return { data: { payments: [payment('a', '2026-09-09T10:00:00+07:00')], completed: false, next_url: '?since=2' } };
    return { data: { payments: [payment('b', '2026-09-08T10:00:00+07:00'), payment('x', '2026-09-10T10:00:00+07:00', { customer_phone: '08123456789' })], completed: true } };
  } };
  const result = await fetchOutletDayRange({
    supabase: {}, outlet: outlets()[0], businessDates: ['2026-09-09', '2026-09-08'], clientFactory: () => client,
  });
  assert.equal(result.pages, 2);
  assert.equal(result.fetched, 3);
  assert.equal(result.accepted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(JSON.stringify(result.rows).includes('08123456789'), false);
});

test('five Redbox outlets sync, Parker is excluded, and duplicate run updates instead of appending', async () => {
  const supabase = createSupabase({ outlets: [...outlets(), { id: 'parker', slug: 'parker', moka_outlet_id: '999', is_active: true }] });
  const requested = [];
  const clientFactory = outlet => ({ getPaidTransactionsPage: async () => {
    requested.push(outlet.slug);
    return { data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-09T12:00:00+07:00')], completed: true } };
  } });
  const options = { supabase, date: '2026-09-09', clientFactory, eventLogger: async () => ({ status: 'recorded' }) };
  await syncMokaDailyTransactions(options);
  await syncMokaDailyTransactions(options);
  assert.deepEqual([...new Set(requested)].sort(), [...REDBOX_OUTLET_SLUGS].sort());
  assert.equal(requested.includes('parker'), false);
  assert.equal(supabase._store.moka_transactions.length, 5);
  assert.equal(supabase._store.business_performance_daily.length, 5);
});

test('one outlet failure is isolated and successful outlets remain persisted', async () => {
  const supabase = createSupabase({ outlets: outlets() });
  const result = await syncMokaDailyTransactions({
    supabase, date: '2026-09-09', eventLogger: async () => ({}),
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => {
      if (outlet.slug === 'sumber') throw new Error('temporary Moka failure');
      return { data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-09T12:00:00+07:00')], completed: true } };
    } }),
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.outlets_succeeded, 4);
  assert.equal(supabase._store.moka_transactions.length, 4);
});

test('reused cron input still refreshes moka_barber_services for original barber counts', async () => {
  const barberRows = REDBOX_OUTLET_SLUGS.map((branch, index) => ({ id: `barber-${index}`, name: `Kapster${index}`, branch, is_active: true }));
  const supabase = createSupabase({ outlets: outlets(), barbers: barberRows });
  await syncMokaDailyTransactions({
    supabase, date: '2026-09-09', eventLogger: async () => ({}),
    clientFactory: outlet => {
      const index = REDBOX_OUTLET_SLUGS.indexOf(outlet.slug);
      return { getPaidTransactionsPage: async () => ({ data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-09T12:00:00+07:00', {
        checkouts: [{ item_name: `Kapster${index}`, item_variant_name: 'Gentleman Grooming', item_price_quantity: 100000 }],
      })], completed: true } }) };
    },
  });
  assert.equal(supabase._store.moka_barber_services.length, 5);
  assert.equal(supabase._store.moka_transactions.every(row => row._barber_items === undefined), true);
});

test('seeded September mismatch is reported and never overwritten', async () => {
  const seed = outlets().map(outlet => ({ business_date: '2026-09-08', branch_slug: outlet.slug, net_sales: 999, gross_sales: 999, discounts: 0, refunds: 0, transaction_count: 1, source: 'moka_csv' }));
  const supabase = createSupabase({ outlets: outlets(), business_performance_daily: seed });
  const result = await syncMokaDailyTransactions({
    supabase, date: '2026-09-08', eventLogger: async () => ({}),
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => ({ data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-08T12:00:00+07:00')], completed: true } }) }),
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.reconciliations.length, 5);
  assert.equal(supabase._store.business_performance_daily.every(row => row.net_sales === 999 && row.source === 'moka_csv'), true);
});

test('dry run performs no transaction or aggregate writes', async () => {
  const supabase = createSupabase({ outlets: outlets() });
  const result = await syncMokaDailyTransactions({
    supabase, date: '2026-09-09', dryRun: true, eventLogger: async () => ({}),
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => ({ data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-09T12:00:00+07:00')], completed: true } }) }),
  });
  assert.equal(result.transactions_upserted, 0);
  assert.equal(supabase._store.moka_transactions, undefined);
  assert.equal(supabase._store.business_performance_daily, undefined);
});

test('summary event and returned result never contain customer PII', async () => {
  const supabase = createSupabase({ outlets: outlets() });
  let loggedEvent;
  const result = await syncMokaDailyTransactions({
    supabase, date: '2026-09-09', dryRun: true,
    eventLogger: async event => { loggedEvent = event; return {}; },
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => ({
      data: { payments: [payment(`uuid-${outlet.slug}`, '2026-09-09T12:00:00+07:00', { customer_name: 'Sensitive Name', customer_phone: '081234567890' })], completed: true },
    }) }),
  });
  assert.equal(JSON.stringify({ result, loggedEvent }).includes('081234567890'), false);
  assert.equal(JSON.stringify({ result, loggedEvent }).includes('Sensitive Name'), false);
});
