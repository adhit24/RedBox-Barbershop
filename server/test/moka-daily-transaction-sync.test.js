'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REDBOX_OUTLET_SLUGS,
  resolveBusinessDates,
  normalizeMokaPayment,
  fetchOutletDayRange,
  aggregateRows,
  aggregateItems,
  zeroOverwriteBlocker,
  syncMokaDailyTransactions,
} = require('../services/mokaDailyTransactionSync');

function createSupabase(seed = {}) {
  const store = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  const table = name => (store[name] ||= []);
  function builder(name) {
    let mode = 'select'; let payload; let conflict = []; const filters = []; let window = null;
    const api = {
      select() { return api; },
      in(key, values) { filters.push(row => values.includes(row[key])); return api; },
      eq(key, value) { filters.push(row => row[key] === value); return api; },
      not(key, _op, value) { if (value === null) filters.push(row => row[key] !== null); return api; },
      gte(key, value) { filters.push(row => row[key] >= value); return api; },
      lte(key, value) { filters.push(row => row[key] <= value); return api; },
      order() { return api; },
      range(from, to) { window = [from, to]; return api; },
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
        const rows = table(name).filter(row => filters.every(filter => filter(row)));
        return { data: window ? rows.slice(window[0], window[1] + 1) : rows, error: null };
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

// ---- Canonical item aggregation (Sep 16-18 zero-revenue regression) ----

function item(receipt, slug, date, gross, net, extra = {}) {
  return {
    receipt_number: receipt, outlet_slug: slug, tx_date: date, gross_amount: gross, net_amount: net,
    discount_amount: 0, quantity: 1, refunded_quantity: 0, is_deleted: false, source_line_key: `${receipt}-${extra.line || 1}`, ...extra,
  };
}

function apiPayment(id, createdAt, gross, net) {
  return payment(id, createdAt, { subtotal: net, discounts: gross - net, total_collected: net, checkouts: [
    { uuid: `${id}-l1`, item_id: 1, item_variant_id: 2, item_name: 'Haircut', item_variant_name: 'Regular', item_price_quantity: gross, net_sales: net, quantity: 1 },
  ] });
}

test('aggregateItems: receipts, gross, net and derived discounts reconcile per branch/date', () => {
  const rows = [
    item('r1', 'csb', '2026-09-16', 100000, 90000),
    item('r1', 'csb', '2026-09-16', 50000, 50000, { line: 2 }),
    item('r2', 'csb', '2026-09-16', 200000, 200000),
    item('r3', 'tegal', '2026-09-16', 70000, 70000),
    item('r4', 'csb', '2026-09-17', 999, 999),
  ];
  const csb = aggregateItems(rows, '2026-09-16', 'csb');
  assert.deepEqual(
    { net: csb.net_sales, gross: csb.gross_sales, disc: csb.discounts, n: csb.transaction_count },
    { net: 340000, gross: 350000, disc: 10000, n: 2 },
  );
  assert.equal(aggregateItems(rows, '2026-09-16', 'tegal').transaction_count, 1);
});

test('aggregateItems: empty date is a genuine zero; deleted items and refunds are handled', () => {
  const empty = aggregateItems([], '2026-09-16', 'csb');
  assert.equal(empty.net_sales, 0);
  assert.equal(empty.transaction_count, 0);
  const rows = [
    item('v1', 'csb', '2026-09-16', 80000, 80000, { is_deleted: true }),
    item('k1', 'csb', '2026-09-16', 100000, 100000, { refunded_quantity: 1 }),
  ];
  const agg = aggregateItems(rows, '2026-09-16', 'csb');
  assert.equal(agg.transaction_count, 1);
  assert.equal(agg.refunds, 100000);
});

test('zeroOverwriteBlocker only allows zero for genuinely empty canonical data', () => {
  const zero = { net_sales: 0, transaction_count: 0 };
  assert.equal(zeroOverwriteBlocker(zero, { canonicalReceipts: 3 }), 'canonical_transactions_exist');
  assert.equal(zeroOverwriteBlocker(zero, { canonicalReceipts: 0, existing: { net_sales: 500, transaction_count: 2 } }), 'would_overwrite_non_zero_row');
  assert.equal(zeroOverwriteBlocker(zero, { canonicalReceipts: 0, existing: null }), null);
  assert.equal(zeroOverwriteBlocker({ net_sales: 10, transaction_count: 1 }, { canonicalReceipts: 1 }), null);
});

test('regression: API date with real transactions aggregates even when moka_transactions has NULL tx_date/outlet_slug', async () => {
  // Production: trg_sync_moka_csv_columns nulls tx_date/outlet_slug on API rows and
  // stale zero moka_api aggregates already exist for the date.
  const stale = REDBOX_OUTLET_SLUGS.map(slug => ({ business_date: '2026-09-16', branch_slug: slug, net_sales: 0, gross_sales: 0, discounts: 0, refunds: 0, transaction_count: 0, source: 'moka_api' }));
  const supabase = createSupabase({ outlets: outlets(), business_performance_daily: stale });
  const realFrom = supabase.from;
  supabase.from = name => {
    const api = realFrom(name);
    if (name !== 'moka_transactions') return api;
    const upsert = api.upsert;
    api.upsert = (value, opts) => {
      const result = upsert(value, opts);
      for (const row of supabase._store.moka_transactions || []) { row.tx_date = null; row.outlet_slug = null; }
      return result;
    };
    return api;
  };
  const options = {
    supabase, date: '2026-09-16', eventLogger: async () => ({}),
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => ({ data: { payments: [
      apiPayment(`a-${outlet.slug}`, '2026-09-16T10:00:00+07:00', 120000, 100000),
      apiPayment(`b-${outlet.slug}`, '2026-09-16T11:00:00+07:00', 50000, 50000),
    ], completed: true } }) }),
  };
  const first = await syncMokaDailyTransactions(options);
  assert.equal(first.status, 'SUCCESS');
  const rows = supabase._store.business_performance_daily;
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.net_sales, 150000);
    assert.equal(row.transaction_count, 2);
    assert.equal(row.discounts, 20000);
  }
  const strip = list => JSON.stringify(list.map(({ imported_at, ...rest }) => rest));
  const snapshot = strip(rows);
  await syncMokaDailyTransactions(options);
  assert.equal(supabase._store.business_performance_daily.length, 5);
  assert.equal(strip(supabase._store.business_performance_daily), snapshot);
  assert.equal(supabase._store.moka_transaction_items.length, 10);
});

test('regression: zero is never persisted over existing non-zero data when canonical items exist', async () => {
  const good = { business_date: '2026-09-17', branch_slug: 'csb', net_sales: 777, gross_sales: 777, discounts: 0, refunds: 0, transaction_count: 3, source: 'moka_api' };
  const supabase = createSupabase({
    outlets: outlets(), business_performance_daily: [good],
    moka_transaction_items: [item('v1', 'csb', '2026-09-17', 100, 100, { is_deleted: true })],
  });
  const result = await syncMokaDailyTransactions({
    supabase, date: '2026-09-17', eventLogger: async () => ({}),
    clientFactory: () => ({ getPaidTransactionsPage: async () => ({ data: { payments: [], completed: true } }) }),
  });
  const csb = supabase._store.business_performance_daily.find(row => row.branch_slug === 'csb');
  assert.equal(csb.net_sales, 777);
  assert.equal(result.reconciliations.some(r => r.branch_slug === 'csb' && r.status === 'zero_overwrite_blocked'), true);
});

test('empty API date with no canonical data persists a genuine zero', async () => {
  const supabase = createSupabase({ outlets: outlets() });
  await syncMokaDailyTransactions({
    supabase, date: '2026-09-13', eventLogger: async () => ({}),
    clientFactory: () => ({ getPaidTransactionsPage: async () => ({ data: { payments: [], completed: true } }) }),
  });
  assert.equal(supabase._store.business_performance_daily.length, 5);
  assert.equal(supabase._store.business_performance_daily.every(row => row.net_sales === 0 && row.transaction_count === 0), true);
});

test('CSV historical rows are preserved when a later API date syncs', async () => {
  const csv = REDBOX_OUTLET_SLUGS.map(slug => ({ business_date: '2026-09-15', branch_slug: slug, net_sales: 4242, gross_sales: 4242, discounts: 0, refunds: 0, transaction_count: 9, source: 'moka_csv' }));
  const supabase = createSupabase({ outlets: outlets(), business_performance_daily: csv });
  await syncMokaDailyTransactions({
    supabase, date: '2026-09-16', eventLogger: async () => ({}),
    clientFactory: outlet => ({ getPaidTransactionsPage: async () => ({ data: { payments: [apiPayment(`c-${outlet.slug}`, '2026-09-16T10:00:00+07:00', 100000, 100000)], completed: true } }) }),
  });
  const rows = supabase._store.business_performance_daily;
  assert.equal(rows.filter(r => r.business_date === '2026-09-15').every(r => r.net_sales === 4242 && r.source === 'moka_csv'), true);
  assert.equal(rows.filter(r => r.business_date === '2026-09-16').every(r => r.net_sales === 100000), true);
});

test('Sep 16 production shape: csb 41 receipts / 5,848,000 gross reconciles to 5,428,000 net', () => {
  const rows = [];
  for (let i = 0; i < 41; i += 1) rows.push(item(`s${i}`, 'csb', '2026-09-16', i < 40 ? 142000 : 168000, 0));
  const total = rows.reduce((sum, row) => sum + row.gross_amount, 0);
  assert.equal(total, 5848000);
  rows.forEach(row => { row.net_amount = row.gross_amount; });
  rows[0].net_amount -= 420000;
  const agg = aggregateItems(rows, '2026-09-16', 'csb');
  assert.equal(agg.transaction_count, 41);
  assert.equal(agg.net_sales, 5428000);
  assert.equal(agg.discounts, 420000);
});
