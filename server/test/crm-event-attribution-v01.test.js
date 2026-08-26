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

// ── 2. Same-Day Conflict Resolution Test ──────────────────────────────────
test('2. Same-day conflicting events set detailed fields to null and confidence to conflicting', async () => {
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
  // Conflicting branch (Bypass vs CSB) and barber (Onoy vs Ubay) must resolve to null
  assert.equal(res.activity.last_visit_branch, null);
  assert.equal(res.activity.last_visit_barber, null);
  // Shared service (Gentleman Grooming) resolves cleanly
  assert.equal(res.activity.last_visit_service, 'Gentleman Grooming');
  assert.equal(res.activity.last_visit_confidence, 'conflicting');
});

// ── 3. Envelope Extraction & Context Formatting ───────────────────────────
test('3. Envelope extracts event attribution keys into APPROVED_FACT_KEYS', () => {
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
});

// ── 4. Webhook System Prompt Rules Enforcement ────────────────────────────
test('4. Webhook system prompt strictly enforces last visit vs favorite separation & user claim authority rules', () => {
  const webhookSource = fs.readFileSync(path.resolve(__dirname, '../../api/wa/webhook.js'), 'utf8');

  assert.match(webhookSource, /ATURAN KUNJUNGAN TERAKHIR VS FAVORIT/);
  assert.match(webhookSource, /favorite_branch/);
  assert.match(webhookSource, /favorite_barber/);
  assert.match(webhookSource, /KLAIM PELANGGAN BUKAN FAKTA CRM/);
  assert.match(webhookSource, /CRM tetap bersifat READ-ONLY/);
});
