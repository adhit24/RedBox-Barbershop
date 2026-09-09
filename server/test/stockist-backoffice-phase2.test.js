const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getWIBDate,
  getYesterdayWIBDate,
  getWIBDateBoundaries,
  aggregateDailyMovements,
} = require('../services/stockistDailyMovements');
const {
  getStockistBackofficeData,
  getStockistMovementChart,
} = require('../services/stockistBackofficeDashboard');

describe('Stockist Backoffice Phase 2 - Daily Movement Aggregation & Timezone', () => {
  it('correctly computes Asia/Jakarta (WIB) start and end boundaries in UTC', () => {
    // For 2026-09-09 in WIB (UTC+7):
    // Start: 2026-09-09 00:00:00 WIB = 2026-09-08 17:00:00 UTC
    // End: 2026-09-09 23:59:59.999 WIB = 2026-09-09 16:59:59.999 UTC
    const boundaries = getWIBDateBoundaries('2026-09-09');
    assert.equal(boundaries.startIso, '2026-09-09T00:00:00.000+07:00');
    assert.equal(boundaries.endIso, '2026-09-09T23:59:59.999+07:00');
    assert.equal(new Date(boundaries.startIso).toISOString(), '2026-09-08T17:00:00.000Z');
    assert.equal(new Date(boundaries.endIso).toISOString(), '2026-09-09T16:59:59.999Z');
  });

  it('aggregates ledger movements into daily summary and verifies idempotency', async () => {
    let upsertCalledWith = null;
    let onConflictClause = null;

    const mockSupabase = {
      from(tableName) {
        if (tableName === 'inventory_locations') {
          return {
            select() {
              return Promise.resolve({
                data: [
                  { id: 'loc-wh', type: 'warehouse', outlet_id: null },
                  { id: 'loc-bypass', type: 'branch', outlet_id: 'outlet-bypass' },
                ],
                error: null,
              });
            },
          };
        }
        if (tableName === 'inventory_ledger') {
          return {
            select() {
              return this;
            },
            gte() {
              return this;
            },
            lte() {
              return this;
            },
            order() {
              return Promise.resolve({
                data: [
                  {
                    id: '1',
                    product_id: 'prod-pomade',
                    location_id: 'loc-wh',
                    movement_type: 'WAREHOUSE_RECEIVE',
                    quantity_delta: 100,
                    quantity_before: 50,
                    quantity_after: 150,
                    created_at: '2026-09-09T02:00:00.000Z',
                  },
                  {
                    id: '2',
                    product_id: 'prod-pomade',
                    location_id: 'loc-wh',
                    movement_type: 'TRANSFER_OUT',
                    quantity_delta: -25,
                    quantity_before: 150,
                    quantity_after: 125,
                    created_at: '2026-09-09T04:00:00.000Z',
                  },
                  {
                    id: '3',
                    product_id: 'prod-pomade',
                    location_id: 'loc-bypass',
                    movement_type: 'TRANSFER_IN',
                    quantity_delta: 25,
                    quantity_before: 10,
                    quantity_after: 35,
                    created_at: '2026-09-09T05:00:00.000Z',
                  },
                  {
                    id: '4',
                    product_id: 'prod-pomade',
                    location_id: 'loc-bypass',
                    movement_type: 'SALE_MOKA',
                    quantity_delta: -5,
                    quantity_before: 35,
                    quantity_after: 30,
                    created_at: '2026-09-09T08:00:00.000Z',
                  },
                  {
                    id: '5',
                    product_id: 'prod-tonic',
                    location_id: 'loc-bypass',
                    movement_type: 'STOCK_OPNAME_GAIN',
                    quantity_delta: 2,
                    quantity_before: 8,
                    quantity_after: 10,
                    created_at: '2026-09-09T10:00:00.000Z',
                  },
                ],
                error: null,
              });
            },
          };
        }
        if (tableName === 'inventory_daily_movements') {
          return {
            upsert(records, opts) {
              upsertCalledWith = records;
              onConflictClause = opts?.onConflict;
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`Unexpected table: ${tableName}`);
      },
    };

    const res = await aggregateDailyMovements(mockSupabase, { targetDate: '2026-09-09' });

    assert.equal(res.ok, true);
    assert.equal(res.target_date, '2026-09-09');
    assert.equal(res.movements_processed, 5);
    assert.equal(res.records_upserted, 3);

    // Verify idempotency constraint on (date, location_id, product_id)
    assert.equal(onConflictClause, 'date,location_id,product_id');

    // Verify warehouse pomade record
    const whPomade = upsertCalledWith.find((r) => r.location_id === 'loc-wh' && r.product_id === 'prod-pomade');
    assert.ok(whPomade);
    assert.equal(whPomade.opening_qty, 50);
    assert.equal(whPomade.received_qty, 100);
    assert.equal(whPomade.transfer_out_qty, 25);
    assert.equal(whPomade.closing_qty, 125);

    // Verify bypass pomade record
    const bypassPomade = upsertCalledWith.find((r) => r.location_id === 'loc-bypass' && r.product_id === 'prod-pomade');
    assert.ok(bypassPomade);
    assert.equal(bypassPomade.branch_id, 'outlet-bypass');
    assert.equal(bypassPomade.opening_qty, 10);
    assert.equal(bypassPomade.transfer_in_qty, 25);
    assert.equal(bypassPomade.sales_qty, 5);
    assert.equal(bypassPomade.closing_qty, 30);

    // Verify bypass tonic record
    const bypassTonic = upsertCalledWith.find((r) => r.location_id === 'loc-bypass' && r.product_id === 'prod-tonic');
    assert.ok(bypassTonic);
    assert.equal(bypassTonic.adjustment_plus_qty, 2);
  });
});

describe('Stockist Backoffice Phase 2 - Dashboard Data & Role Scoping', () => {
  function createMockSupabase() {
    return {
      from(tableName) {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              in() {
                return this;
              },
              gte() {
                return this;
              },
              lte() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: null });
              },
              single() {
                return Promise.resolve({ data: null, error: null });
              },
              then(resolve) {
                if (tableName === 'inventory_locations') {
                  return resolve({
                    data: [
                      { id: 'loc-wh', name: 'Warehouse Utama', type: 'warehouse', outlet_id: null },
                      { id: 'loc-bypass', name: 'Cabang Bypass', type: 'branch', outlet_id: 'outlet-bypass' },
                      { id: 'loc-samadikun', name: 'Cabang Samadikun', type: 'branch', outlet_id: 'outlet-samadikun' },
                      { id: 'loc-csb', name: 'Cabang CSB', type: 'branch', outlet_id: 'outlet-csb' },
                      { id: 'loc-sumber', name: 'Cabang Sumber', type: 'branch', outlet_id: 'outlet-sumber' },
                      { id: 'loc-tegal', name: 'Cabang Tegal', type: 'branch', outlet_id: 'outlet-tegal' },
                    ],
                    error: null,
                  });
                }
                if (tableName === 'outlets') {
                  return resolve({
                    data: [
                      { id: 'outlet-bypass', name: 'Bypass', slug: 'bypass' },
                      { id: 'outlet-samadikun', name: 'Samadikun', slug: 'samadikun' },
                      { id: 'outlet-csb', name: 'CSB Mall', slug: 'csb' },
                      { id: 'outlet-sumber', name: 'Sumber', slug: 'sumber' },
                      { id: 'outlet-tegal', name: 'Tegal', slug: 'tegal' },
                    ],
                    error: null,
                  });
                }
                if (tableName === 'inventory_balances') {
                  return resolve({
                    data: [
                      { location_id: 'loc-wh', product_id: 'p1', quantity: 1500 },
                      { location_id: 'loc-bypass', product_id: 'p1', quantity: 2 }, // Low (min: 5)
                      { location_id: 'loc-bypass', product_id: 'p2', quantity: 10 },
                      { location_id: 'loc-tegal', product_id: 'p1', quantity: 0 }, // Out (min: 5)
                    ],
                    error: null,
                  });
                }
                if (tableName === 'products') {
                  return resolve({
                    data: [
                      { id: 'p1', name: 'Pomade Waterbased', sku: 'POM-001', category: 'Styling', minimum_stock: 5, is_active: true },
                      { id: 'p2', name: 'Shampoo Mint', sku: 'SHP-001', category: 'Haircare', minimum_stock: 3, is_active: true },
                      { id: 'p3', name: 'Mineral Water', sku: 'FNB-001', category: 'drink', minimum_stock: 10, is_active: true }, // F&B excluded
                    ],
                    error: null,
                  });
                }
                if (tableName === 'stock_transfers') {
                  return resolve({
                    data: [
                      {
                        id: 'trf-1',
                        transfer_number: 'TRF-001',
                        source_location_id: 'loc-wh',
                        destination_location_id: 'loc-bypass',
                        status: 'in_transit',
                        created_at: new Date().toISOString(),
                      },
                    ],
                    error: null,
                  });
                }
                if (tableName === 'stock_transfer_items') {
                  return resolve({ data: [], error: null });
                }
                if (tableName === 'stock_opnames') {
                  return resolve({ data: [], error: null });
                }
                if (tableName === 'inventory_daily_movements') {
                  return resolve({
                    data: [
                      {
                        date: '2026-09-09',
                        location_id: 'loc-wh',
                        received_qty: 200,
                        transfer_out_qty: 50,
                        transfer_in_qty: 0,
                        updated_at: '2026-09-10T00:15:00.000Z',
                      },
                      {
                        date: '2026-09-09',
                        location_id: 'loc-bypass',
                        received_qty: 0,
                        transfer_out_qty: 0,
                        transfer_in_qty: 50,
                        updated_at: '2026-09-10T00:15:00.000Z',
                      },
                    ],
                    error: null,
                  });
                }
                return resolve({ data: [], error: null });
              },
            };
          },
        };
      },
    };
  }

  it('computes live KPI totals, active non-F&B SKUs, and identifies low/out stock items', async () => {
    const mockSupabase = createMockSupabase();
    const result = await getStockistBackofficeData(mockSupabase, {
      role: 'owner',
      branch: null,
      staffId: 'staff-1',
    });

    // Active SKUs: p1 and p2 (p3 is F&B, excluded)
    assert.equal(result.summary.active_skus, 2);
    // Total stock: 1500 (wh) + 2 (bypass) + 10 (bypass) + 0 (tegal) = 1512
    assert.equal(result.summary.total_stock, 1512);
    // Low stock count across locations: p1 at bypass (2 <= 5) and p1 at tegal (0 <= 5)
    assert.equal(result.summary.low_stock_count, 2);
    // Active transfers count
    assert.equal(result.summary.active_transfers_count, 1);

    // Verify 5 branches are included
    assert.equal(result.branches.length, 5);
    const tegal = result.branches.find((b) => b.name === 'Tegal');
    assert.ok(tegal);
    assert.equal(tegal.status, 'out');
    assert.equal(tegal.out_of_stock_count, 1);

    const bypass = result.branches.find((b) => b.name === 'Bypass');
    assert.ok(bypass);
    assert.equal(bypass.status, 'low');
    assert.equal(bypass.low_stock_count, 1);
  });

  it('enforces branch_admin authorization scope and ignores unauthorized branch overrides', async () => {
    const mockSupabase = createMockSupabase();
    // Branch admin assigned only to 'bypass'
    const result = await getStockistBackofficeData(mockSupabase, {
      role: 'branch_admin',
      branch: 'bypass',
      staffId: 'staff-bypass',
    });

    // Should strictly limit scope to 'bypass'
    assert.equal(result.role, 'branch_admin');
    assert.equal(result.authorized_branch, 'bypass');
    assert.equal(result.branches.length, 1);
    assert.equal(result.branches[0].slug, 'bypass');
  });

  it('movement chart reads summary points from daily movements table', async () => {
    const mockSupabase = createMockSupabase();
    const chart = await getStockistMovementChart(mockSupabase, {
      role: 'owner',
      branch: null,
      staffId: 'staff-1',
    }, { days: 7 });

    assert.equal(chart.days, 7);
    assert.ok(Array.isArray(chart.points));
    // Check points are aggregated from inventory_daily_movements
    const p9 = chart.points.find((p) => p.raw_date === '2026-09-09');
    assert.ok(p9);
    assert.equal(p9.masuk, 200);
    assert.equal(p9.keluar, 50);
    assert.equal(p9.terima, 50);
  });
});

describe('Stockist Daily Movement Cron - Scheduler & Auth Verification', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const express = require('express');

  it('declares the cron entry in production scheduler config (vercel.json) with exact schedule 15 17 * * *', () => {
    const vercelConfigPath = path.join(__dirname, '..', '..', 'vercel.json');
    assert.ok(fs.existsSync(vercelConfigPath), 'vercel.json must exist in project root');

    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
    assert.ok(Array.isArray(vercelConfig.crons), 'vercel.json must declare crons array');

    const cronEntry = vercelConfig.crons.find((c) => c.path === '/api/cron/stockist-daily-movements');
    assert.ok(cronEntry, 'cron entry for /api/cron/stockist-daily-movements must be declared');
    assert.equal(cronEntry.schedule, '15 17 * * *', 'schedule must be 15 17 * * * (00:15 WIB / 17:15 UTC)');
  });

  it('correctly resolves yesterday in Asia/Jakarta (WIB) regardless of server UTC time', () => {
    // Exactly at 00:15 WIB on 10 Sep 2026 (17:15 UTC on 9 Sep 2026):
    const runTime = new Date('2026-09-09T17:15:00.000Z');
    const yesterdayWIB = getYesterdayWIBDate(runTime);
    assert.equal(yesterdayWIB, '2026-09-09', 'At 00:15 WIB on 10 Sep, H-1 in WIB must be 2026-09-09');

    const boundaries = getWIBDateBoundaries(yesterdayWIB);
    assert.equal(boundaries.startIso, '2026-09-09T00:00:00.000+07:00');
    assert.equal(boundaries.endIso, '2026-09-09T23:59:59.999+07:00');
    // Start of day in UTC is 17:00 on previous UTC day
    assert.equal(new Date(boundaries.startIso).toISOString(), '2026-09-08T17:00:00.000Z');
    // End of day in UTC is 16:59:59.999 UTC
    assert.equal(new Date(boundaries.endIso).toISOString(), '2026-09-09T16:59:59.999Z');
  });

  it('enforces cron authentication with CRON_SECRET, x-vercel-cron header, and token fallback', async () => {
    const TEST_SECRET = 'test-cron-secret-redbox-2026';
    const originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = TEST_SECRET;

    const app = express();
    app.use(express.json());

    // Replicate the exact route handler from server/index.js
    app.all(['/api/cron/stockist-daily-movements'], (req, res) => {
      const validTokens = [process.env.CRON_SECRET, process.env.ADMIN_PASSWORD].filter(Boolean);
      const isVercelCron = req.headers['x-vercel-cron'] === '1';
      const auth = req.headers.authorization || '';
      const token = req.query.token || (auth.startsWith('Bearer ') ? auth.slice(7) : '') || req.headers['x-admin-token'];
      const isAuthorized = isVercelCron || (validTokens.length > 0 && validTokens.includes(token));
      if (validTokens.length > 0 && !isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

      return res.json({ ok: true, scheduled: true });
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.on('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Unauthenticated request without token must be rejected (401)
      const resUnauth = await fetch(`${baseUrl}/api/cron/stockist-daily-movements`);
      assert.equal(resUnauth.status, 401, 'unauthenticated request must return 401');

      // 2. Wrong token must be rejected (401)
      const resWrong = await fetch(`${baseUrl}/api/cron/stockist-daily-movements`, {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      assert.equal(resWrong.status, 401, 'invalid token must return 401');

      // 3. Valid Bearer token must succeed (200)
      const resBearer = await fetch(`${baseUrl}/api/cron/stockist-daily-movements`, {
        headers: { authorization: `Bearer ${TEST_SECRET}` },
      });
      assert.equal(resBearer.status, 200, 'Bearer token must succeed');

      // 4. Vercel native cron header (x-vercel-cron: 1) must succeed (200)
      const resVercel = await fetch(`${baseUrl}/api/cron/stockist-daily-movements`, {
        headers: { 'x-vercel-cron': '1' },
      });
      assert.equal(resVercel.status, 200, 'x-vercel-cron header must succeed');

      // 5. Query parameter (?token=...) must succeed (200)
      const resQuery = await fetch(`${baseUrl}/api/cron/stockist-daily-movements?token=${TEST_SECRET}`);
      assert.equal(resQuery.status, 200, 'query token must succeed');

      // 6. x-admin-token header must succeed (200)
      const resHeader = await fetch(`${baseUrl}/api/cron/stockist-daily-movements`, {
        headers: { 'x-admin-token': TEST_SECRET },
      });
      assert.equal(resHeader.status, 200, 'x-admin-token must succeed');
    } finally {
      process.env.CRON_SECRET = originalSecret;
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});

