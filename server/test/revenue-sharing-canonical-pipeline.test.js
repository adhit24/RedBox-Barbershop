'use strict';

/**
 * Regression tests for the Revenue Sharing Preview canonical pipeline.
 *
 * Production incident (2026-09-24): the preview query was unpaginated, so PostgREST's
 * 1000-row cap silently truncated 1602 canonical rows to 1000. The summary table then
 * disagreed with the per-barber detail drawer (Ubay: Rp1.260.000 vs Rp3.140.000).
 *
 * The fake Supabase below enforces the same 1000-row default cap as PostgREST.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLASSIFICATION,
  getRevenueSharingPreview,
  getBarberRevenueDetail,
} = require('../services/revenueSharingService');

const MAX_ROWS = 1000;

function createFakeSupabase(tables) {
  function from(table) {
    const filters = [];
    let orderCol = null;
    let range = null;
    let single = false;
    const q = {
      select() { return q; },
      eq(col, val) { filters.push((r) => r[col] === val); return q; },
      gte(col, val) { filters.push((r) => r[col] >= val); return q; },
      lte(col, val) { filters.push((r) => r[col] <= val); return q; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
      order(col) { orderCol = col; return q; },
      range(a, b) { range = [a, b]; return q; },
      single() { single = true; return q; },
      then(resolve, reject) {
        try {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (orderCol) rows = [...rows].sort((a, b) => String(a[orderCol]).localeCompare(String(b[orderCol]), 'en', { numeric: true }));
          rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, MAX_ROWS);
          resolve(single ? { data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } } : { data: rows, error: null });
        } catch (e) { reject(e); }
      },
    };
    return q;
  }
  return { from };
}

let seq = 0;
function item(over = {}) {
  seq += 1;
  return {
    id: `item-${String(seq).padStart(6, '0')}`,
    receipt_number: `R${seq}`,
    outlet_slug: 'csb',
    tx_date: '2026-09-20',
    tx_time: '10:00:00',
    item_name: 'Ubay',
    variant_name: 'Premium Cutting',
    classification: CLASSIFICATION.NON_STOCK_SERVICE,
    quantity: 1,
    gross_amount: 120000,
    discount_amount: 0,
    net_amount: 120000,
    barber_id: 'csb-ubay',
    is_deleted: false,
    refunded_quantity: 0,
    ...over,
  };
}

const BARBERS = [
  { id: 'csb-ubay', name: 'Ubay', branch: 'csb', commission_rate: null, is_active: true },
  { id: 'csb-ega', name: 'Ega', branch: 'csb', commission_rate: null, is_active: true },
  { id: 'bypass-bob', name: 'Bob', branch: 'bypass', commission_rate: null, is_active: true },
];

const PERIOD = { dateFrom: '2026-09-01', dateTo: '2026-09-24' };

function bulkItems(n, over = {}) {
  return Array.from({ length: n }, () => item(over));
}

async function detailNet(sb, barberId) {
  const d = await getBarberRevenueDetail(sb, { barberId, ...PERIOD });
  return d;
}

test('Revenue Sharing canonical pipeline', async (t) => {
  await t.test('pagination: >1000 canonical rows are not truncated (regression for Ubay Rp1.26M vs Rp3.14M)', async () => {
    const items = [
      ...bulkItems(1200, { barber_id: 'csb-ega' }),
      ...bulkItems(22, { barber_id: 'csb-ubay' }),
    ];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const ubay = preview.barbers.find((b) => b.barber_id === 'csb-ubay');
    const ega = preview.barbers.find((b) => b.barber_id === 'csb-ega');
    assert.equal(ega.net_service_revenue, 1200 * 120000);
    assert.equal(ubay.net_service_revenue, 22 * 120000);
    assert.equal(ubay.service_item_count, 22);
  });

  await t.test('pagination: >2000 rows spanning three pages', async () => {
    const items = bulkItems(2500, { barber_id: 'csb-ega' });
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    assert.equal(preview.summary.total_net_service_revenue, 2500 * 120000);
  });

  await t.test('pagination: detail drawer is also paginated for a barber with >1000 items', async () => {
    const items = bulkItems(1300, { barber_id: 'csb-ega' });
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const d = await detailNet(sb, 'csb-ega');
    assert.equal(d.summary.net_service_revenue, 1300 * 120000);
  });

  await t.test('invariant: summary.net_service == sum(detail included item net) for every barber', async () => {
    const items = [
      ...bulkItems(1100, { barber_id: 'csb-ega', net_amount: 100000, gross_amount: 100000 }),
      ...bulkItems(30, { barber_id: 'csb-ubay' }),
      ...bulkItems(40, { barber_id: 'bypass-bob', outlet_slug: 'bypass', net_amount: 90000, gross_amount: 90000 }),
    ];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    for (const b of preview.barbers) {
      const d = await detailNet(sb, b.barber_id);
      const sumItems = d.service_items.reduce((s, i) => s + i.net_amount, 0);
      assert.equal(b.net_service_revenue, sumItems, `${b.barber_name} summary vs detail items`);
      assert.equal(b.net_service_revenue, d.summary.net_service_revenue, `${b.barber_name} summary vs detail header`);
      assert.equal(b.service_item_count, d.summary.service_item_count, `${b.barber_name} item count`);
    }
  });

  await t.test('invariant: sum(barber net) + unassigned eligible net == total canonical eligible net', async () => {
    const items = [
      ...bulkItems(1050, { barber_id: 'csb-ega' }),
      ...bulkItems(10, { barber_id: 'csb-ubay' }),
      ...bulkItems(7, { barber_id: null, net_amount: 150000, gross_amount: 150000 }),
      item({ barber_id: 'csb-ubay', classification: CLASSIFICATION.STOCK_PRODUCT, net_amount: 75000, gross_amount: 75000 }),
    ];
    const canonicalEligible = items
      .filter((i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE)
      .reduce((s, i) => s + i.net_amount, 0);
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const barberSum = preview.barbers.reduce((s, b) => s + b.net_service_revenue, 0);
    assert.equal(preview.unassigned.service_items_count, 7);
    assert.equal(preview.unassigned.service_net_amount, 7 * 150000);
    assert.equal(barberSum + preview.unassigned.service_net_amount, canonicalEligible);
  });

  await t.test('product/drink/membership never enter service base; add-on service does', async () => {
    const items = [
      item({ item_name: 'Gentleman Grooming', net_amount: 200000, gross_amount: 200000 }),
      item({ item_name: 'Shave', receipt_number: 'RX', net_amount: 50000, gross_amount: 50000 }),
      item({ item_name: 'Pomade', classification: CLASSIFICATION.STOCK_PRODUCT, net_amount: 90000, gross_amount: 90000 }),
      item({ item_name: 'Minuman', classification: CLASSIFICATION.NON_STOCK_MISC, net_amount: 15000, gross_amount: 15000 }),
    ];
    items[1].receipt_number = items[0].receipt_number; // multi-service receipt
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const ubay = preview.barbers.find((b) => b.barber_id === 'csb-ubay');
    assert.equal(ubay.net_service_revenue, 250000);
    assert.equal(ubay.service_item_count, 2); // per service item
    assert.equal(ubay.service_transaction_count, 1); // one receipt
    const d = await detailNet(sb, 'csb-ubay');
    assert.equal(d.excluded_items.length, 2);
  });

  await t.test('discount is applied exactly once (net_amount is authoritative)', async () => {
    const items = [item({ gross_amount: 150000, discount_amount: 30000, net_amount: 120000 })];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const ubay = preview.barbers.find((b) => b.barber_id === 'csb-ubay');
    assert.equal(ubay.gross_service_revenue, 150000);
    assert.equal(ubay.discount_total, 30000);
    assert.equal(ubay.net_service_revenue, 120000);
  });

  await t.test('deleted and fully refunded items are not counted', async () => {
    const items = [
      item(),
      item({ is_deleted: true }),
      item({ quantity: 1, refunded_quantity: 1 }),
    ];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    assert.equal(preview.barbers.find((b) => b.barber_id === 'csb-ubay').net_service_revenue, 120000);
  });

  await t.test('period start and end dates are inclusive; outside dates excluded', async () => {
    const items = [
      item({ tx_date: '2026-08-31' }),
      item({ tx_date: '2026-09-01' }),
      item({ tx_date: '2026-09-24' }),
      item({ tx_date: '2026-09-25' }),
    ];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    assert.equal(preview.barbers.find((b) => b.barber_id === 'csb-ubay').net_service_revenue, 240000);
  });

  await t.test('branch filter: CSB only returns CSB barbers and items', async () => {
    const items = [item(), item({ barber_id: 'bypass-bob', outlet_slug: 'bypass' })];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, { ...PERIOD, branch: 'csb' });
    assert.deepEqual(preview.barbers.map((b) => b.barber_id).sort(), ['csb-ega', 'csb-ubay']);
    assert.equal(preview.summary.total_net_service_revenue, 120000);
  });

  await t.test('unknown barber goes to unassigned/review, never to an arbitrary barber', async () => {
    const items = [
      item({ barber_id: null }),
      item({ barber_id: null, classification: CLASSIFICATION.REVIEW_REQUIRED }),
    ];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    assert.equal(preview.summary.total_net_service_revenue, 0);
    assert.equal(preview.unassigned.service_items_count, 1);
    assert.equal(preview.unassigned.review_items_count, 1);
  });

  await t.test('missing rate does not affect net service revenue', async () => {
    const items = bulkItems(5);
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const ubay = preview.barbers.find((b) => b.barber_id === 'csb-ubay');
    assert.equal(ubay.status, 'MISSING_RATE');
    assert.equal(ubay.calculated_commission, null);
    assert.equal(ubay.net_service_revenue, 600000);
  });

  // Duplicate-sync protection is a DB invariant, not service logic:
  //   UNIQUE INDEX moka_transaction_items_idempotency_key (outlet_id, receipt_number, source_line_key)
  // Production audit 2026-09-24: 0 duplicate source_line_key rows. Not re-implemented here on purpose.

  await t.test('void/refund: partially refunded line counts only remaining quantity share of count', async () => {
    const items = [item({ quantity: 2, refunded_quantity: 1, gross_amount: 240000, net_amount: 240000 })];
    const sb = createFakeSupabase({ barbers: BARBERS, barber_commission_rates: [], moka_transaction_items: items });
    const preview = await getRevenueSharingPreview(sb, PERIOD);
    const ubay = preview.barbers.find((b) => b.barber_id === 'csb-ubay');
    assert.equal(ubay.service_item_count, 1);
    const d = await detailNet(sb, 'csb-ubay');
    assert.equal(d.summary.service_item_count, 1);
    assert.equal(ubay.net_service_revenue, d.summary.net_service_revenue);
  });
});
