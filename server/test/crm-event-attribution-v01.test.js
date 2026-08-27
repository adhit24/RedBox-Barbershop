'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { getCustomer360 } = require('../crm/customer360Service');
const {
  APPROVED_FACT_KEYS,
  extractCustomerIntelligenceEnvelope,
  buildCustomerFactsContext,
} = require('../agents/reddy/customerFactsContext');

// ── Mock Supabase Harness with Full Canonical Tables ────────────────────────
function createMockSupabase(fixtures = {}) {
  const {
    memberProfiles = [],
    customers = [],
    transactions = [],
    bookings = [],
    outlets = [],
    schedules = [],
    barbers = [],
  } = fixtures;

  return {
    from(table) {
      const records = fixtures[table] || [];
      return {
        select() {
          return {
            in(col, valArr) {
              const matched = records.filter(r => valArr.includes(r[col]));
              const chainable = Promise.resolve({ data: matched, error: null });
              chainable.eq = function() {
                return {
                  order() {
                    return Promise.resolve({ data: matched, error: null });
                  },
                };
              };
              return chainable;
            },
            or() {
              if (table === 'member_profiles') return Promise.resolve({ data: memberProfiles, error: null });
              if (table === 'customers') return Promise.resolve({ data: customers, error: null });
              if (table === 'bookings') {
                return {
                  order() {
                    return Promise.resolve({ data: bookings, error: null });
                  },
                };
              }
              return Promise.resolve({ data: [], error: null });
            },
            eq() {
              return {
                eq() {
                  return {
                    order() {
                      return Promise.resolve({ data: transactions, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

// ── 1. Live Production-Shaped Event Attribution Test ────────────────────────
test('1. Live production-shaped event attribution resolves branch & barber via canonical schema maps', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    outlets: [
      { id: 'out-bypass-uuid', slug: 'bypass', name: 'RedBox Bypass' },
    ],
    schedules: [
      { id: 'sched-101', barber_id: 'barber-onoy-uuid' },
    ],
    barbers: [
      { id: 'barber-onoy-uuid', name: 'Onoy' },
    ],
    transactions: [
      {
        id: 'tx-1',
        customer_id: 'cust-100',
        outlet_id: 'out-bypass-uuid',
        schedule_id: 'sched-101',
        created_at: '2026-08-11T15:30:00Z',
        status: 'completed',
        transaction_items: [{ service_name: 'Gentleman Grooming' }],
      },
    ],
    bookings: [
      {
        id: 'b-1',
        customer_id: 'cust-100',
        date: '2026-08-01',
        location: 'CSB',
        barber_id: 'barber-ubay-uuid',
        service: 'Haircut',
        status: 'done',
      },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.identity.customer_found, true);
  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, 'RedBox Bypass');
  assert.equal(res.activity.last_visit_barber, 'Onoy');
  assert.equal(res.activity.last_visit_service, 'Gentleman Grooming');
  assert.equal(res.activity.last_visit_confidence, 'verified');

  // Preferences use the same canonical completed-service visits; the newer
  // Bypass visit wins the 1-1 frequency tie over the older CSB booking.
  assert.equal(res.preferences.favorite_branch.value, 'RedBox Bypass');
});

// ── 2. Transaction Outlet Lookup Resolution ─────────────────────────────
test('2. Transaction outlet_id lookup resolves branch name, and unmapped outlet_id resolves to null with partial confidence', async () => {
  const supabaseMapped = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    outlets: [{ id: 'out-1', name: 'RedBox CSB' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', outlet_id: 'out-1', created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [{ service_name: 'Haircut' }] }],
  });
  const resMapped = await getCustomer360(supabaseMapped, { phone: '6281234567890' });
  assert.equal(resMapped.activity.last_visit_branch, 'RedBox CSB');

  const supabaseUnmapped = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    outlets: [], // empty outlets mapping
    transactions: [{ id: 't-1', customer_id: 'c-1', outlet_id: 'out-missing', created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [{ service_name: 'Haircut' }] }],
  });
  const resUnmapped = await getCustomer360(supabaseUnmapped, { phone: '6281234567890' });
  assert.equal(resUnmapped.activity.last_visit_branch, null);
  assert.equal(resUnmapped.activity.last_visit_confidence, 'partial');
});

// ── 3. Transaction Schedule -> Barber Resolution ─────────────────────────
test('3. Transaction schedule_id resolves barber name, while missing/null schedule_id resolves barber to null', async () => {
  const supabaseSched = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    schedules: [{ id: 'sched-5', barber_id: 'barber-7' }],
    barbers: [{ id: 'barber-7', name: 'Ubay' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', schedule_id: 'sched-5', created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [{ service_name: 'Haircut' }] }],
  });
  const resSched = await getCustomer360(supabaseSched, { phone: '6281234567890' });
  assert.equal(resSched.activity.last_visit_barber, 'Ubay');

  const supabaseNoSched = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', schedule_id: null, created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [{ service_name: 'Haircut' }] }],
  });
  const resNoSched = await getCustomer360(supabaseNoSched, { phone: '6281234567890' });
  assert.equal(resNoSched.activity.last_visit_barber, null);
});

// ── 4. Booking Barber ID Safety ─────────────────────────────────────────
test('4. Booking with barber_id resolves to barber name and NEVER exposes raw UUID', async () => {
  const supabaseBarber = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    barbers: [{ id: 'uuid-barber-99', name: 'Budi Barber' }],
    bookings: [{ id: 'b-1', customer_id: 'c-1', date: '2026-08-11', barber_id: 'uuid-barber-99', service: 'Haircut', status: 'done' }],
  });
  const resBarber = await getCustomer360(supabaseBarber, { phone: '6281234567890' });
  assert.equal(resBarber.activity.last_visit_barber, 'Budi Barber');

  const supabaseMissingBarber = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    barbers: [], // missing barber entry
    bookings: [{ id: 'b-1', customer_id: 'c-1', date: '2026-08-11', barber_id: 'uuid-barber-unmapped', service: 'Haircut', status: 'done' }],
  });
  const resMissing = await getCustomer360(supabaseMissingBarber, { phone: '6281234567890' });
  assert.equal(resMissing.activity.last_visit_barber, null);
  assert.notEqual(resMissing.activity.last_visit_barber, 'uuid-barber-unmapped');
});

// ── 5. Transaction Service Attribution ──────────────────────────────────
test('5. Transaction service attributes from transaction_items.service_name, and resolves to null if missing', async () => {
  const supabaseTxItem = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [{ service_name: 'Hot Towel Shave' }] }],
  });
  const resTxItem = await getCustomer360(supabaseTxItem, { phone: '6281234567890' });
  assert.equal(resTxItem.activity.last_visit_service, 'Hot Towel Shave');

  const supabaseNoItems = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', created_at: '2026-08-11T10:00:00Z', status: 'completed', transaction_items: [] }],
  });
  const resNoItems = await getCustomer360(supabaseNoItems, { phone: '6281234567890' });
  assert.equal(resNoItems.activity.last_visit_service, null);
});

// ── 6. CUSTOMER_SELF Facts Sanitization (No Internal IDs, No Timestamps, No Precision Enums) ────────
test('6. CUSTOMER_SELF facts envelope strips internal IDs, epoch timestamps, and precision enums', () => {
  const crmResult = {
    status: 'success',
    customer_found: true,
    data: {
      customer: { name: 'Budi' },
      activity: {
        last_visit: '2026-08-11',
        last_visit_branch: 'RedBox Bypass',
        last_visit_barber: 'Onoy',
        last_visit_service: 'Gentleman Grooming',
        last_visit_source: 'transaction',
        last_visit_confidence: 'verified',
        last_visit_event: {
          date: '2026-08-11',
          timestamp: 1786462200000,
          precision: 'datetime',
          branch: 'RedBox Bypass',
          barber: 'Onoy',
          service: 'Gentleman Grooming',
          source: 'transaction',
          confidence: 'verified',
        },
      },
    },
  };

  const env = extractCustomerIntelligenceEnvelope(crmResult, 'customer_history');
  const contextStr = buildCustomerFactsContext(env);

  // Assert CONTAINS safe display values
  assert.equal(contextStr.includes('2026-08-11'), true, 'Context must contain date');
  assert.equal(contextStr.includes('RedBox Bypass'), true, 'Context must contain branch display value');
  assert.equal(contextStr.includes('Onoy'), true, 'Context must contain barber name');
  assert.equal(contextStr.includes('Gentleman Grooming'), true, 'Context must contain service name');
  assert.equal(contextStr.includes('transaction'), true, 'Context must contain source category');
  assert.equal(contextStr.includes('verified'), true, 'Context must contain confidence category');

  // Assert DOES NOT CONTAIN internal metadata or epoch timestamps / precision enums
  assert.equal(contextStr.includes('"timestamp"'), false, 'Context must not include "timestamp" key');
  assert.equal(contextStr.includes('1786462200000'), false, 'Context must not include epoch ms value');
  assert.equal(contextStr.includes('"precision"'), false, 'Context must not include "precision" key');
  assert.equal(contextStr.includes('"datetime"'), false, 'Context must not include "datetime" enum');

  // Assert DOES NOT CONTAIN internal database IDs
  assert.equal(contextStr.includes('outlet_id'), false, 'Context must not include outlet_id');
  assert.equal(contextStr.includes('schedule_id'), false, 'Context must not include schedule_id');
  assert.equal(contextStr.includes('barber_id'), false, 'Context must not include barber_id');
  assert.equal(contextStr.includes('customer_id'), false, 'Context must not include customer_id');
});

// ── 7. Precision & Tie-Break Regression Tests ─────────────────────────────
test('7. Real timestamp tie-break (10:00 vs 15:30) and mixed precision conflict tests remain green', async () => {
  const supabaseTs = createMockSupabase({
    customers: [{ id: 'c-1', wa: '6281234567890' }],
    outlets: [{ id: 'o-bypass', name: 'Bypass' }, { id: 'o-csb', name: 'CSB' }],
    barbers: [{ id: 'b-onoy', name: 'Onoy' }, { id: 'b-ubay', name: 'Ubay' }],
    schedules: [{ id: 's-1', barber_id: 'b-ubay' }],
    bookings: [{ id: 'b-1', customer_id: 'c-1', date: '2026-08-11T10:00:00Z', location: 'Bypass', barber_id: 'b-onoy', service: 'Gentleman Grooming', status: 'done' }],
    transactions: [{ id: 't-1', customer_id: 'c-1', outlet_id: 'o-csb', schedule_id: 's-1', created_at: '2026-08-11T15:30:00Z', status: 'completed', transaction_items: [{ service_name: 'Gentleman Grooming' }] }],
  });

  const resTs = await getCustomer360(supabaseTs, { phone: '6281234567890' });
  assert.equal(resTs.activity.last_visit_branch, 'CSB');
  assert.equal(resTs.activity.last_visit_barber, 'Ubay');
  assert.equal(resTs.activity.last_visit_confidence, 'verified');
});

// ── 8. Webhook System Prompt Rules Enforcement ────────────────────────────
test('8. Webhook system prompt strictly enforces last visit vs favorite separation & user claim authority rules', () => {
  const webhookSource = fs.readFileSync(path.resolve(__dirname, '../../api/wa/webhook.js'), 'utf8');

  assert.match(webhookSource, /ATURAN KUNJUNGAN TERAKHIR VS FAVORIT/);
  assert.match(webhookSource, /favorite_branch/);
  assert.match(webhookSource, /favorite_barber/);
  assert.match(webhookSource, /KLAIM PELANGGAN BUKAN FAKTA CRM/);
  assert.match(webhookSource, /CRM tetap bersifat READ-ONLY/);
});
