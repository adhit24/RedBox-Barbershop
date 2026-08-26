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

// ── Mock Supabase Harness ───────────────────────────────────────────────────
function createMockSupabase(fixtures = {}) {
  const {
    memberProfiles = [],
    customers = [],
    transactions = [],
    bookings = [],
  } = fixtures;

  return {
    from(table) {
      return {
        select() {
          return {
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
            in() {
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

// ── 1. Customer360 Event Attribution Unit Test ─────────────────────────────
test('1. Customer360 correctly attributes latest visit event separate from favorite metrics', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    bookings: [
      { id: 'b-1', customer_id: 'cust-100', date: '2026-08-11', location: 'Bypass', barber_name: 'Onoy', service: 'Gentleman Grooming', status: 'done' },
      { id: 'b-2', customer_id: 'cust-100', date: '2026-08-01', location: 'CSB', barber_name: 'Ubay', service: 'Gentleman Grooming', status: 'done' },
      { id: 'b-3', customer_id: 'cust-100', date: '2026-07-20', location: 'CSB', barber_name: 'Ubay', service: 'Gentleman Grooming', status: 'done' },
      { id: 'b-4', customer_id: 'cust-100', date: '2026-07-10', location: 'CSB', barber_name: 'Ubay', service: 'Gentleman Grooming', status: 'done' },
      { id: 'b-5', customer_id: 'cust-100', date: '2026-06-01', location: 'CSB', barber_name: 'Ubay', service: 'Gentleman Grooming', status: 'done' },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.identity.customer_found, true);
  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, 'Bypass');
  assert.equal(res.activity.last_visit_barber, 'Onoy');
  assert.equal(res.activity.last_visit_service, 'Gentleman Grooming');
  assert.equal(res.activity.last_visit_confidence, 'verified');

  // Favorites are calculated by frequency and MUST remain separate!
  assert.equal(res.preferences.favorite_branch.value, 'CSB');
  assert.equal(res.preferences.favorite_barber.value, 'Ubay');
  assert.equal(res.preferences.favorite_service.value, 'Gentleman Grooming');
});

// ── 2. Same-Day Real Timestamps Test (10:00 vs 15:30 -> 15:30 wins) ────────
test('2. Two same-day events with REAL timestamps (10:00 vs 15:30): 15:30 wins deterministically', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    bookings: [
      { id: 'b-1', customer_id: 'cust-100', date: '2026-08-11T10:00:00Z', location: 'Bypass', barber_name: 'Onoy', service: 'Gentleman Grooming', status: 'done' },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-100', created_at: '2026-08-11T15:30:00Z', outlet_slug: 'CSB', barber_name: 'Ubay', status: 'completed', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, 'CSB');
  assert.equal(res.activity.last_visit_barber, 'Ubay');
  assert.equal(res.activity.last_visit_confidence, 'verified');
  assert.equal(res.activity.last_visit_event.precision, 'datetime');
});

// ── 3. Date-Only + Datetime Same Day Mixed Precision Test ────────────
test('3. Booking date-only + transaction datetime same day: does NOT assume datetime is later, returns conflict', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    bookings: [
      { id: 'b-1', customer_id: 'cust-100', date: '2026-08-11', location: 'Bypass', barber_name: 'Onoy', service: 'Gentleman Grooming', status: 'done' },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-100', created_at: '2026-08-11T15:30:00Z', outlet_slug: 'CSB', barber_name: 'Ubay', status: 'completed', transaction_items: [{ service_name: 'Gentleman Grooming' }] },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, null);
  assert.equal(res.activity.last_visit_barber, null);
  assert.equal(res.activity.last_visit_service, 'Gentleman Grooming');
  assert.equal(res.activity.last_visit_confidence, 'conflicting');
  assert.equal(res.activity.last_visit_event.precision, 'date_only');
});

// ── 4. Two Date-Only Same-Day Events Disagreeing ─────────────────────────
test('4. Two date-only same-day events disagreeing resolve to conflict', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    bookings: [
      { id: 'b-1', customer_id: 'cust-100', date: '2026-08-11', location: 'Bypass', barber_name: 'Onoy', service: 'Gentleman Grooming', status: 'done' },
      { id: 'b-2', customer_id: 'cust-100', date: '2026-08-11', location: 'CSB', barber_name: 'Ubay', service: 'Haircut', status: 'done' },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, null);
  assert.equal(res.activity.last_visit_barber, null);
  assert.equal(res.activity.last_visit_service, null);
  assert.equal(res.activity.last_visit_confidence, 'conflicting');
});

// ── 5. Same Exact Timestamp Events Disagreeing ───────────────────────────
test('5. Same exact timestamp events disagreeing resolve to conflict', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-100', created_at: '2026-08-11T15:30:00Z', outlet_slug: 'Bypass', barber_name: 'Onoy', status: 'completed' },
      { id: 'tx-2', customer_id: 'cust-100', created_at: '2026-08-11T15:30:00Z', outlet_slug: 'CSB', barber_name: 'Ubay', status: 'completed' },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, null);
  assert.equal(res.activity.last_visit_barber, null);
  assert.equal(res.activity.last_visit_confidence, 'conflicting');
});

// ── 6. Single Event with Missing Barber Field Has Partial Confidence ─────
test('6. Single event with missing barber field has partial confidence', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-100', name: 'Budi', wa: '6281234567890', points: 150 },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-100', created_at: '2026-08-11T15:30:00Z', outlet_slug: 'Bypass', status: 'completed' },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });

  assert.equal(res.activity.last_visit, '2026-08-11');
  assert.equal(res.activity.last_visit_branch, 'Bypass');
  assert.equal(res.activity.last_visit_barber, null);
  assert.equal(res.activity.last_visit_confidence, 'partial');
});

// ── 7. Envelope Extraction & Context Formatting ───────────────────────────
test('7. Envelope extracts event attribution keys into APPROVED_FACT_KEYS', () => {
  for (const key of ['last_visit_branch', 'last_visit_barber', 'last_visit_service', 'last_visit_source', 'last_visit_confidence']) {
    assert.equal(APPROVED_FACT_KEYS.includes(key), true, `APPROVED_FACT_KEYS must include ${key}`);
  }

  const crmResult = {
    status: 'success',
    customer_found: true,
    data: {
      customer: { name: 'Budi' },
      activity: {
        last_visit: '2026-08-11',
        last_visit_branch: 'Bypass',
        last_visit_barber: 'Onoy',
        last_visit_service: 'Gentleman Grooming',
        last_visit_source: 'booking',
        last_visit_confidence: 'verified',
      },
      preferences: {
        favorite_branch: { value: 'CSB' },
        favorite_barber: { value: 'Ubay' },
      },
    },
  };

  const env = extractCustomerIntelligenceEnvelope(crmResult, 'customer_history');

  assert.equal(env.facts.last_visit_branch, 'Bypass');
  assert.equal(env.facts.last_visit_barber, 'Onoy');
  assert.equal(env.facts.last_visit_service, 'Gentleman Grooming');
  assert.equal(env.facts.favorite_branch.value, 'CSB');
  assert.equal(env.facts.favorite_barber.value, 'Ubay');

  const contextStr = buildCustomerFactsContext(env);

  assert.equal(contextStr.includes('"last_visit_branch": "Bypass"'), true);
  assert.equal(contextStr.includes('"last_visit_barber": "Onoy"'), true);
  assert.equal(contextStr.includes('"favorite_branch"'), true);
  assert.equal(contextStr.includes('"CSB"'), true);
  assert.equal(contextStr.includes('SEPARATE LAST VISIT vs FAVORITE'), true);

  // Assert rules 6 and 7 appear EXACTLY ONCE
  const rule6Matches = (contextStr.match(/6. SEPARATE LAST VISIT/g) || []).length;
  assert.equal(rule6Matches, 1, 'Rule 6 must appear exactly once');
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
