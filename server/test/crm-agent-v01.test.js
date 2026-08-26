'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCustomerIdentity } = require('../crm/customerIdentity');
const { getCustomer360, calculateMode } = require('../crm/customer360Service');
const { projectInternal, projectCustomerSelf } = require('../crm/customerPrivacy');
const { executeCrmTool, CRM_TOOLS } = require('../agents/crm/crmAgent');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { executeOrchestration } = require('../orchestrator/executionService');
const fs = require('fs');
const path = require('path');
const { normalizeMemberPhone } = require('../member-identity');

// Robust Mock Supabase Factory
function createMockSupabase({
  customers = [],
  memberProfiles = [],
  memberPointsBalance = [],
  transactions = [],
  bookings = [],
  simulateDbError = false,
  simulateProfileDbError = false,
  simulateCustomerDbError = false,
  simulateTxDbError = false,
  simulateBookingsDbError = false,
} = {}) {
  return {
    from(table) {
      return {
        select(cols) {
          return {
            eq(col, val) {
              if (simulateDbError) {
                return {
                  maybeSingle: async () => ({ data: null, error: { message: 'Database connection failed' } }),
                  order: async () => ({ data: null, error: { message: 'Database connection failed' } }),
                };
              }

              if (table === 'customers') {
                if (simulateCustomerDbError) return { maybeSingle: async () => ({ data: null, error: { message: 'Customers table error' } }) };
                const found = customers.find(c => c[col] === val);
                return {
                  maybeSingle: async () => ({ data: found || null, error: null }),
                  eq(col2, val2) {
                    return {
                      order: async () => {
                        const filtered = transactions.filter(t => t[col] === val && t[col2] === val2);
                        return { data: filtered, error: null };
                      },
                    };
                  },
                };
              }

              if (table === 'transactions') {
                if (simulateTxDbError) return { eq: () => ({ order: async () => ({ data: null, error: { message: 'Transactions DB error' } }) }) };
                return {
                  eq(col2, val2) {
                    return {
                      order: async () => {
                        const filtered = transactions.filter(t => (t[col] === val || (Array.isArray(val) && val.includes(t[col]))) && t[col2] === val2);
                        return { data: filtered, error: null };
                      },
                    };
                  },
                };
              }

              return {
                maybeSingle: async () => ({ data: null, error: null }),
                order: async () => ({ data: [], error: null }),
              };
            },

            or(conditionsStr) {
              if (simulateDbError) {
                return { data: null, error: { message: 'Database connection failed' } };
              }

              if (table === 'member_profiles') {
                if (simulateProfileDbError) return { data: null, error: { message: 'Profile DB error' } };
                return { data: memberProfiles, error: null };
              }

              if (table === 'customers') {
                if (simulateCustomerDbError) return { data: null, error: { message: 'Customers DB error' } };
                return { data: customers, error: null };
              }

              if (table === 'bookings') {
                if (simulateBookingsDbError) return { data: null, error: { message: 'Bookings DB error' } };
                const res = { data: bookings, error: null };
                return {
                  ...res,
                  order: async () => res,
                  then: (resolve) => resolve(res),
                };
              }

              const emptyRes = { data: [], error: null };
              return {
                ...emptyRes,
                order: async () => emptyRes,
                then: (resolve) => resolve(emptyRes),
              };
            },

            in(col, vals) {
              if (table === 'transactions') {
                return {
                  eq: (col2, val2) => ({
                    order: async () => {
                      const filtered = transactions.filter(t => vals.includes(t[col]) && t[col2] === val2);
                      return { data: filtered, error: null };
                    },
                  }),
                };
              }
              if (table === 'member_points_balance') {
                const filtered = memberPointsBalance.filter(p => vals.includes(p.customer_id));
                return { data: filtered, error: null };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}

// ── 1. IDOR & AUTHORIZATION MATRIX TESTS ─────────────────────────────────────

test('IDOR Matrix Case A: context.phone = A, params.customer_id = B -> BLOCKED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789' },
      { id: 'uuid-B', wa: '628999999999', phone_e164: '+628999999999' },
    ],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'uuid-B' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
  assert.equal(res.data, null);
});

test('IDOR Matrix Case B: context.customer_id = A, params.phone = B -> BLOCKED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789' },
      { id: 'uuid-B', wa: '628999999999', phone_e164: '+628999999999' },
    ],
  });

  const res = await executeCrmTool('get_points', { phone: '628999999999' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    customer_id: 'uuid-A',
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
  assert.equal(res.data, null);
});

test('IDOR Matrix Case C: context.phone = A, context.customer_id = A, params absent -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789', points: 150 }],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
    customer_id: 'uuid-A',
  });

  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
  assert.equal(res.data.points_balance, 150);
});

test('IDOR Matrix Case D: context.phone = A (resolves to A), context.customer_id = B (disagrees) -> FAIL CLOSED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789' },
      { id: 'uuid-B', wa: '628999999999', phone_e164: '+628999999999' },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
    customer_id: 'uuid-B',
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.data, null);
});

test('IDOR Matrix Case E: context.phone = A, params.phone = A -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789', points: 200 }],
  });

  const res = await executeCrmTool('get_points', { phone: '628123456789' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
  });

  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, 200);
});

test('IDOR Matrix Case F: context.customer_id = A, params.customer_id = A -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-A', wa: '628123456789', phone_e164: '+628123456789', points: 250 }],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'uuid-A' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    customer_id: 'uuid-A',
  });

  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, 250);
});

test('Dual Identity Leak Regression: unknown phone plus valid customer UUID cannot return 77 points', async () => {
  const customerId = '11111111-2222-3333-4444-555555555555';
  const supabase = createMockSupabase({
    customers: [
      { id: customerId, wa: '6281234567890', phone_e164: '+6281234567890', points: 77 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '6289999999999',
    customer_id: customerId,
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'identity_unverified');
  assert.equal(res.data, null);
  assert.notEqual(res.data?.points_balance, 77);
});

test('Dual Identity: trusted phone alias cluster plus matching customer UUID succeeds', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', name: 'Budi Santoso', points: 50 },
      { id: 'uuid-B', wa: '+628123456789', name: 'Andi Wijaya', points: 50 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
    customer_id: 'uuid-A',
  });

  assert.equal(res.status, 'success');
});

test('Dual Identity: phone database error plus customer UUID returns db_error', async () => {
  const res = await executeCrmTool('get_points', {}, {
    supabase: createMockSupabase({ simulateDbError: true }),
    projection: 'CUSTOMER_SELF',
    phone: '6281234567890',
    customer_id: '11111111-2222-3333-4444-555555555555',
  });

  assert.equal(res.status, 'db_error');
  assert.equal(res.error, 'database_unavailable');
});

test('Dual Identity: valid phone plus unresolved customer UUID fails closed', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: '11111111-2222-3333-4444-555555555555', wa: '6281234567890', points: 77 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '6281234567890',
    customer_id: '99999999-9999-4999-8999-999999999999',
  });

  assert.equal(res.status, 'forbidden');
});

test('End-to-end dual identity leak regression never exposes the previous 77-point balance', async () => {
  const customerId = '11111111-2222-3333-4444-555555555555';
  const supabase = createMockSupabase({
    customers: [
      { id: customerId, wa: '6281234567890', points: 77 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '6280000000000',
    customer_id: customerId,
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.data, null);
});

// ── 2. INTERNAL PROJECTION AUTHORIZATION TESTS ───────────────────────────────
test('Internal Projection Auth: params.projection = INTERNAL is ignored', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-secret-999', wa: '62818202587', phone_e164: '+62818202587' }],
  });

  const res = await executeCrmTool('get_customer_profile', { projection: 'INTERNAL' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202587' });
  assert.equal(res.projection, 'CUSTOMER_SELF');
  assert.equal(res.data.customer.customer_id, undefined);
});

test('Internal Projection Auth: context.projection = INTERNAL without allow_internal_projection flag falls back to CUSTOMER_SELF', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-secret-999', wa: '62818202587', phone_e164: '+62818202587' }],
  });

  const res = await executeCrmTool('get_customer_profile', {}, { supabase, projection: 'INTERNAL', phone: '62818202587' });
  assert.equal(res.projection, 'CUSTOMER_SELF');
  assert.equal(res.data.customer.customer_id, undefined);
});

test('Internal Projection Auth: context.projection = INTERNAL with allow_internal_projection = true is ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-secret-999', wa: '62818202587', phone_e164: '+62818202587' }],
  });

  const res = await executeCrmTool('get_customer_profile', {}, { supabase, projection: 'INTERNAL', allow_internal_projection: true, phone: '62818202587' });
  assert.equal(res.projection, 'INTERNAL');
  assert.equal(res.data.customer.customer_id, 'uuid-secret-999');
});

// ── 3. DUPLICATE POINT BALANCE ROW TEST ──────────────────────────────────────
test('Duplicate Point Balance Rows: preferring exact customer_id match', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-uuid-target', wa: '62818202570', points: 100 }],
    memberPointsBalance: [
      { customer_id: 'cust-uuid-target', total_points: 100 },
      { customer_id: 'cust-uuid-other', total_points: 50 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202570' });
  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, 100);
});

test('Duplicate Point Balance Rows: conflicting non-matching rows fail closed to points_balance = null', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'c1', wa: '62818202571', points: 100 },
      { id: 'c2', wa: '+62818202571', points: 200 },
    ],
  });

  const res = await executeCrmTool('get_points', {}, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202571' });
  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, null);
  assert.equal(res.data.status, 'ambiguous_balance_conflict');
});

// ── 4. DB ERROR SEMANTICS ───────────────────────────────────────────────────
test('Database Error Semantics: DB failure returns status db_error, NOT customer_found: false / not_found', async () => {
  const supabase = createMockSupabase({ simulateDbError: true });

  const res = await executeCrmTool('get_points', { phone: '62818202569' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'db_error');
  assert.equal(res.error, 'Database connection failed');
});

// ── 5. AMBIGUOUS IDENTITY TEST ───────────────────────────────────────────────
test('Task 11.1 Trusted Phone Alias Resolution: candidate customer rows with name variants for same verified phone cluster safely', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', name: 'Budi Santoso' },
      { id: 'uuid-B', wa: '+628123456789', name: 'Andi Wijaya' },
    ],
  });

  const res = await resolveCustomerIdentity(supabase, { phone: '628123456789' });
  assert.equal(res.found, true);
  assert.equal(res.customer_id, 'uuid-A');
  assert.deepEqual(res.alias_customer_ids, ['uuid-A', 'uuid-B']);
  assert.equal(res.resolution, 'phone_match');
});

test('CRM Agent preserves ambiguous identity instead of collapsing it to not_found', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', name: 'Budi Santoso' },
      { id: 'uuid-B', wa: '628999999999', name: 'Andi Wijaya' },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
  });
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.customer_found, false);
});

test('CRM Agent keeps an unknown customer distinct from zero points', async () => {
  const res = await executeCrmTool('get_points', {}, {
    supabase: createMockSupabase(),
    projection: 'CUSTOMER_SELF',
    phone: '628999999999',
  });
  assert.equal(res.status, 'not_found');
  assert.equal(res.customer_found, false);
});

// ── 6. POINTS SPECIFICATION SANITY TEST ──────────────────────────────────────
test('Points: returns factual points_balance ONLY; NO monetary IDR conversion', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-uuid-pts', wa: '62818202572', points: 150 }],
  });

  const res = await executeCrmTool('get_points', {}, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202572' });
  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, 150);
  assert.equal(res.data.monetary_value_idr, undefined);
});

test('Customer-self points projection distinguishes zero from unavailable without internal identifiers', async () => {
  const supabaseZero = createMockSupabase({
    customers: [{ id: 'cust-zero', wa: '62818202570', phone_e164: '+62818202570', points: 0 }],
    memberProfiles: [{ id: 'mp-zero', phone: '62818202570', total_points: 0 }],
  });
  const zeroProjection = projectCustomerSelf(await getCustomer360(supabaseZero, { phone: '62818202570' }));
  assert.deepEqual(zeroProjection.loyalty, {
    points_balance: 0,
    last_activity: null,
    status: 'available',
  });

  const supabaseMissing = createMockSupabase();
  const resMissing = await executeCrmTool('get_points', {}, { supabase: supabaseMissing, projection: 'CUSTOMER_SELF', phone: '628999999999' });
  assert.equal(resMissing.status, 'not_found');
  assert.equal(resMissing.data, null);
});

// ── 7. MEMBERSHIP SPECIFICATION TEST ─────────────────────────────────────────
test('Membership: active Gold member has tier_origin = configured', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-3', wa: '62818202571', phone_e164: '+62818202571' }],
    memberProfiles: [{ id: 'mp-1', phone: '62818202571', tier: 'gold', membership_status: 'ACTIVE' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202571' });
  assert.equal(c360.membership.status, 'ACTIVE');
  assert.equal(c360.membership.tier, 'gold');
  assert.equal(c360.membership.tier_origin, 'configured');
});

// ── 8. VISIT SEMANTICS TEST SCENARIOS ────────────────────────────────────────
test('Visit Semantics Scenario 1: Booking only', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v1', wa: '62818202581', phone_e164: '+62818202581' }],
    bookings: [{ id: 'b-1', customer_id: 'cust-v1', status: 'done', date: '2026-08-01' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202581' });
  assert.equal(c360.activity.completed_booking_count, 1);
  assert.equal(c360.activity.completed_transaction_count, 0);
});

test('Visit Semantics Scenario 2: Transaction only', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v2', wa: '62818202582', phone_e164: '+62818202582' }],
    transactions: [{ id: 't-1', customer_id: 'cust-v2', total_amount: 80000, status: 'completed', created_at: '2026-08-05T10:00:00Z' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202582' });
  assert.equal(c360.activity.completed_booking_count, 0);
  assert.equal(c360.activity.completed_transaction_count, 1);
});

test('Visit Semantics Scenario 3: Matching booking + transaction', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v3', wa: '62818202583', phone_e164: '+62818202583' }],
    bookings: [{ id: 'b-1', customer_id: 'cust-v3', status: 'done', date: '2026-08-05' }],
    transactions: [{ id: 't-1', customer_id: 'cust-v3', total_amount: 80000, status: 'completed', created_at: '2026-08-05T11:00:00Z' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202583' });
  assert.equal(c360.activity.completed_booking_count, 1);
  assert.equal(c360.activity.completed_transaction_count, 1);
});

test('Visit Semantics Scenario 4: Multiple legitimate same-day events MUST NOT be collapsed', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v4', wa: '62818202584', phone_e164: '+62818202584' }],
    bookings: [
      { id: 'b-morning', customer_id: 'cust-v4', status: 'done', date: '2026-08-10', barber_id: 'bypass1', service: 'Gentlemen Cut' },
      { id: 'b-afternoon', customer_id: 'cust-v4', status: 'done', date: '2026-08-10', barber_id: 'bypass2', service: 'Hot Towel Shave' },
    ],
    transactions: [
      { id: 't-morning', customer_id: 'cust-v4', total_amount: 90000, status: 'completed', created_at: '2026-08-10T09:00:00Z' },
      { id: 't-afternoon', customer_id: 'cust-v4', total_amount: 40000, status: 'completed', created_at: '2026-08-10T15:00:00Z' },
    ],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202584' });
  assert.equal(c360.activity.completed_booking_count, 2);
  assert.equal(c360.activity.completed_transaction_count, 2);
  assert.equal(c360.spending.transaction_count, 2);
  assert.equal(c360.spending.total_spend_idr, 130000);
});

test('Visit Semantics Scenario 5: Insufficient linkage returns visit_metric_status = caveated', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v5', wa: '62818202585', phone_e164: '+62818202585' }],
    bookings: [{ id: 'b-1', customer_id: 'cust-v5', status: 'done', date: '2026-08-01' }],
    transactions: [{ id: 't-1', customer_id: 'cust-v5', total_amount: 100000, status: 'completed', created_at: '2026-08-02T10:00:00Z' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202585' });
  assert.equal(c360.activity.visit_metric_status, 'caveated');
});

// ── 9. DIRECT COVERAGE FOR ALL 7 CRM TOOLS ──────────────────────────────────
test('CRM Agent Capabilities: direct test for all 7 declared tools', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-all-tools', wa: '62818202588', phone_e164: '+62818202588' }],
    memberProfiles: [{ id: 'mp-all', phone: '62818202588', tier: 'silver', membership_status: 'ACTIVE' }],
    memberPointsBalance: [{ customer_id: 'cust-all-tools', total_points: 50 }],
    transactions: [{ id: 'tx-all', customer_id: 'cust-all-tools', total_amount: 100000, status: 'completed' }],
    bookings: [{ id: 'b-all', customer_id: 'cust-all-tools', wa: '62818202588', status: 'done', location: 'bypass', barber_id: 'bypass1', service: 'Cut' }],
  });

  const ctx = { supabase, projection: 'INTERNAL', allow_internal_projection: true, phone: '62818202588' };

  for (const toolName of CRM_TOOLS) {
    const res = await executeCrmTool(toolName, {}, ctx);
    assert.equal(res.status, 'success', `Tool ${toolName} failed execution`);
    assert.equal(res.customer_found, true, `Tool ${toolName} customer not found`);
    assert.notEqual(res.data, null, `Tool ${toolName} returned null data`);
  }
});

// ── 10. STATIC TEXT SEARCH AUDIT FOR MUTATION KEYWORDS ─────────────────────────
test('Static Text Search: Verify zero mutations and zero LLM calls', () => {
  const crmDir = path.join(__dirname, '../crm');
  const agentDir = path.join(__dirname, '../agents/crm');

  const files = [
    ...fs.readdirSync(crmDir).map(f => path.join(crmDir, f)),
    ...fs.readdirSync(agentDir).map(f => path.join(agentDir, f)),
  ].filter(f => f.endsWith('.js'));

  const forbiddenPatterns = [
    /\.insert\s*\(/i,
    /\.update\s*\(/i,
    /\.upsert\s*\(/i,
    /\.delete\s*\(/i,
    /\.rpc\s*\(/i,
    /\bfetch\s*\(/i,
    /\baxios\b/i,
    /\bfonnte\b/i,
    /\bwa_paused\b/i,
    /\bOpenAI\b/i,
    /\bopenai\b/i,
    /chat\.completions/i,
    /responses\.create/i,
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(content, pattern, `Forbidden mutation/side-effect pattern ${pattern} found in ${file}`);
    }
  }
});
