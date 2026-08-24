'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCustomerIdentity } = require('../crm/customerIdentity');
const { getCustomer360, calculateMode } = require('../crm/customer360Service');
const { projectInternal, projectCustomerSelf } = require('../crm/customerPrivacy');
const { executeCrmTool, CRM_TOOLS } = require('../agents/crm/crmAgent');
const fs = require('fs');
const path = require('path');

// Robust Mock Supabase Factory
function createMockSupabase({
  customers = [],
  memberProfiles = [],
  memberPointsBalance = [],
  transactions = [],
  bookings = [],
  simulateDbError = false,
} = {}) {
  const getTableData = (table) => {
    switch (table) {
      case 'customers': return customers;
      case 'member_profiles': return memberProfiles;
      case 'member_points_balance': return memberPointsBalance;
      case 'transactions': return transactions;
      case 'bookings': return bookings;
      default: return [];
    }
  };

  const createQueryBuilder = (table) => {
    let rows = [...getTableData(table)];

    const builder = {
      select(cols) {
        return builder;
      },
      eq(field, val) {
        rows = rows.filter(r => String(r[field] || '').toLowerCase() === String(val || '').toLowerCase());
        return builder;
      },
      or(orClause) {
        if (!orClause) return builder;
        const clauses = orClause.split(',').map(c => c.trim()).filter(Boolean);
        rows = rows.filter(row => {
          return clauses.some(clause => {
            const parts = clause.split('.');
            const f = parts[0];
            const op = parts[1];
            const val = parts.slice(2).join('.');
            if (op === 'eq') {
              const rowVal = String(row[f] || '').toLowerCase();
              const targetVal = String(val || '').toLowerCase();
              return rowVal === targetVal || rowVal === `+${targetVal.replace(/^\+/, '')}`;
            }
            return false;
          });
        });
        return builder;
      },
      order(orderCol, { ascending = true } = {}) {
        rows.sort((a, b) => {
          const valA = a[orderCol] || '';
          const valB = b[orderCol] || '';
          return ascending ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
        return builder;
      },
      maybeSingle() {
        if (simulateDbError) return Promise.resolve({ data: null, error: { message: 'Database connection failed' } });
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      single() {
        if (simulateDbError) return Promise.resolve({ data: null, error: { message: 'Database connection failed' } });
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      then(onFulfilled, onRejected) {
        if (simulateDbError) return Promise.resolve({ data: null, error: { message: 'Database connection failed' } }).then(onFulfilled, onRejected);
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  };

  return {
    from(table) {
      return createQueryBuilder(table);
    },
  };
}

// ── 1. TRUSTED CONTEXT CONFLICT & IDOR MATRIX TESTS ───────────────────────────
test('IDOR Matrix Case A: context.phone = A, params.customer_id = B -> BLOCKED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' },
      { id: 'cust-b-id', wa: '62899999999', phone_e164: '+62899999999' },
    ],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'cust-b-id' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('IDOR Matrix Case B: context.customer_id = A, params.phone = B -> BLOCKED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' },
      { id: 'cust-b-id', wa: '62899999999', phone_e164: '+62899999999' },
    ],
  });

  const res = await executeCrmTool('get_points', { phone: '62899999999' }, { supabase, projection: 'CUSTOMER_SELF', customer_id: 'cust-a-id' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('IDOR Matrix Case C: context.phone = A, context.customer_id = A, params absent -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' }],
  });

  const res = await executeCrmTool('get_points', {}, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569', customer_id: 'cust-a-id' });
  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
});

test('IDOR Matrix Case D: context.phone = A (resolves to A), context.customer_id = B (disagrees) -> FAIL CLOSED', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' },
      { id: 'cust-b-id', wa: '62899999999', phone_e164: '+62899999999' },
    ],
  });

  const res = await executeCrmTool('get_points', {}, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569', customer_id: 'cust-b-id' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'identity_conflict_blocked');
});

test('IDOR Matrix Case E: context.phone = A, params.phone = A -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' }],
  });

  const res = await executeCrmTool('get_points', { phone: '62818202569' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
});

test('IDOR Matrix Case F: context.customer_id = A, params.customer_id = A -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' }],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'cust-a-id' }, { supabase, projection: 'CUSTOMER_SELF', customer_id: 'cust-a-id' });
  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
});

// ── 2. INTERNAL PROJECTION AUTHORIZATION TESTS ────────────────────────────────
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
    customers: [{ id: 'cust-dup-1', wa: '62818202599', phone_e164: '+62818202599' }],
    memberPointsBalance: [
      { customer_id: 'cust-dup-1', customer_wa: '62818202599', total_points: 25 },
      { customer_id: 'other-cust', customer_wa: '62818202599', total_points: 100 },
    ],
  });

  const c360 = await getCustomer360(supabase, { customer_id: 'cust-dup-1' });
  assert.equal(c360.loyalty.points_balance, 25); // Prefers exact customer_id match
});

test('Duplicate Point Balance Rows: conflicting non-matching rows fail closed to points_balance = null', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-dup-2', wa: '62818202500', phone_e164: '+62818202500' }],
    memberPointsBalance: [
      { customer_id: 'unlinked-1', customer_wa: '62818202500', total_points: 10 },
      { customer_id: 'unlinked-2', customer_wa: '62818202500', total_points: 50 },
    ],
  });

  const c360 = await getCustomer360(supabase, { customer_id: 'cust-dup-2' });
  assert.equal(c360.loyalty.points_balance, null);
  assert.equal(c360.loyalty.status, 'ambiguous_balance_conflict');
});

// ── 4. DATABASE ERROR VS NOT FOUND TEST ──────────────────────────────────────
test('Database Error Semantics: DB failure returns status db_error, NOT customer_found: false / not_found', async () => {
  const supabase = createMockSupabase({ simulateDbError: true });

  const res = await executeCrmTool('get_points', { phone: '62818202569' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'db_error');
  assert.equal(res.error, 'Database connection failed');
});

// ── 5. AMBIGUOUS IDENTITY TEST ───────────────────────────────────────────────
test('Ambiguous Identity: candidate customer rows with conflicting names MUST return resolution: ambiguous', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', name: 'Budi Santoso' },
      { id: 'uuid-B', wa: '+628123456789', name: 'Andi Wijaya' },
    ],
  });

  const res = await resolveCustomerIdentity(supabase, { phone: '628123456789' });
  assert.equal(res.found, false);
  assert.equal(res.customer_id, null);
  assert.equal(res.resolution, 'ambiguous');
});

test('CRM Agent preserves ambiguous identity instead of collapsing it to not_found', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-A', wa: '628123456789', name: 'Budi Santoso' },
      { id: 'uuid-B', wa: '+628123456789', name: 'Andi Wijaya' },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
  });
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.error, 'ambiguous_identity');
  assert.equal(res.customer_found, false);
});

test('CRM Agent keeps an unknown customer distinct from zero points', async () => {
  const res = await executeCrmTool('get_points', {}, {
    supabase: createMockSupabase(),
    projection: 'CUSTOMER_SELF',
    phone: '628123456789',
  });

  assert.equal(res.status, 'not_found');
  assert.equal(res.customer_found, false);
  assert.equal(res.data, null);
});

// ── 6. POINTS BUSINESS RULE TESTS (FACTUAL UNITS ONLY) ───────────────────────
test('Points: returns factual points_balance ONLY; NO monetary IDR conversion', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '62818202569', phone_e164: '+62818202569' }],
    memberPointsBalance: [{ customer_id: 'cust-1', customer_wa: '62818202569', total_points: 9 }],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202569' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 9);
  assert.equal(c360.loyalty.points_value_idr, undefined);
  assert.equal(c360.loyalty.loyalty_discount_equivalent_idr, undefined);
});

test('Customer-self points projection distinguishes zero from unavailable without internal identifiers', async () => {
  const zeroProjection = projectCustomerSelf(await getCustomer360(createMockSupabase({
    customers: [{ id: 'cust-zero', wa: '62818202570', phone_e164: '+62818202570' }],
    memberPointsBalance: [{ customer_id: 'cust-zero', customer_wa: '62818202570', total_points: 0 }],
  }), { phone: '62818202570' }));
  assert.deepEqual(zeroProjection.loyalty, {
    points_balance: 0,
    last_activity: null,
    status: 'available',
  });

  const unavailableProjection = projectCustomerSelf(await getCustomer360(createMockSupabase({
    customers: [{ id: 'cust-conflict', wa: '62818202571', phone_e164: '+62818202571' }],
    memberPointsBalance: [
      { customer_id: 'unlinked-a', customer_wa: '62818202571', total_points: 10 },
      { customer_id: 'unlinked-b', customer_wa: '62818202571', total_points: 50 },
    ],
  }), { phone: '62818202571' }));
  assert.deepEqual(unavailableProjection.loyalty, {
    points_balance: null,
    last_activity: null,
    status: 'ambiguous_balance_conflict',
  });
  assert.equal(unavailableProjection.identity.customer_id, undefined);
  assert.equal(JSON.stringify(unavailableProjection).includes('cust-conflict'), false);
});

// ── 7. MEMBERSHIP BRONZE TIER ORIGIN TESTS ──────────────────────────────────
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

// ── 8. VISIT SEMANTICS TESTS (ALL 5 SCENARIOS) ───────────────────────────────
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
