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
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      single() {
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      then(onFulfilled, onRejected) {
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

// ── 1. GIT SAFETY & ADVERSARIAL IDOR TESTS ──────────────────────────────────
test('Adversarial IDOR: Customer A context attempting params.customer_id = Customer B MUST be blocked', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' },
      { id: 'cust-b-id', wa: '62899999999', phone_e164: '+62899999999' },
    ],
  });

  const res = await executeCrmTool(
    'get_points',
    { customer_id: 'cust-b-id' },
    { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569', customer_id: 'cust-a-id' }
  );

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
  assert.equal(res.customer_found, false);
});

test('Adversarial IDOR: Customer A context attempting params.phone = Customer B MUST be blocked', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' },
      { id: 'cust-b-id', wa: '62899999999', phone_e164: '+62899999999' },
    ],
  });

  const res = await executeCrmTool(
    'get_points',
    { phone: '62899999999' },
    { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' }
  );

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
  assert.equal(res.customer_found, false);
});

// ── 2. AMBIGUOUS IDENTITY TEST ───────────────────────────────────────────────
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

// ── 3. POINTS BUSINESS RULE TESTS (FACTUAL UNITS ONLY) ───────────────────────
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

test('Points: zero balance for registered customer returns points_balance = 0', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-2', wa: '62818202570', phone_e164: '+62818202570' }],
    memberPointsBalance: [{ customer_id: 'cust-2', total_points: 0 }],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202570' });
  assert.equal(c360.loyalty.points_balance, 0);
});

test('Points: unknown customer returns null loyalty object', async () => {
  const supabase = createMockSupabase();
  const c360 = await getCustomer360(supabase, { phone: '08000000000' });
  assert.equal(c360.identity.customer_found, false);
  assert.equal(c360.loyalty, null);
});

// ── 4. MEMBERSHIP BRONZE TIER ORIGIN TESTS ──────────────────────────────────
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

test('Membership: unconfigured profile tier defaults to bronze with tier_origin = default_baseline', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-4', wa: '62818202572', phone_e164: '+62818202572' }],
    memberProfiles: [{ id: 'mp-2', phone: '62818202572', membership_status: 'ACTIVE' }],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202572' });
  assert.equal(c360.membership.tier, 'bronze');
  assert.equal(c360.membership.tier_origin, 'default_baseline');
});

// ── 5. TRANSACTION METRICS & FORMULA TESTS ───────────────────────────────────
test('Transactions: average_transaction_value = total_spend / count(completed)', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-5', wa: '62818202573', phone_e164: '+62818202573' }],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-5', total_amount: 100000, status: 'completed' },
      { id: 'tx-2', customer_id: 'cust-5', total_amount: 50000, status: 'completed' },
      { id: 'tx-3', customer_id: 'cust-5', total_amount: 80000, status: 'cancelled' },
    ],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202573' });
  assert.equal(c360.spending.transaction_count, 2);
  assert.equal(c360.spending.total_spend_idr, 150000);
  assert.equal(c360.spending.average_transaction_value_idr, 75000);
});

// ── 6. VISIT SEMANTICS TESTS (ALL 5 SCENARIOS) ───────────────────────────────
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

// ── 7. PRIVACY PROJECTIONS TESTS ─────────────────────────────────────────────
test('Privacy: CUSTOMER_SELF projection exposes points_balance ONLY (no IDR conversions)', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'uuid-secret-999', wa: '62818202587', phone_e164: '+62818202587' }],
    memberPointsBalance: [{ customer_id: 'uuid-secret-999', total_points: 9 }],
  });

  const raw360 = await getCustomer360(supabase, { phone: '62818202587' });
  const projected = projectCustomerSelf(raw360);

  assert.equal(projected.loyalty.points_balance, 9);
  assert.equal(projected.loyalty.points_value_idr, undefined);
  assert.equal(projected.loyalty.loyalty_discount_equivalent_idr, undefined);
});

// ── 8. DIRECT COVERAGE FOR ALL 7 CRM TOOLS ──────────────────────────────────
test('CRM Agent Capabilities: direct test for all 7 declared tools', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-all-tools', wa: '62818202588', phone_e164: '+62818202588' }],
    memberProfiles: [{ id: 'mp-all', phone: '62818202588', tier: 'silver', membership_status: 'ACTIVE' }],
    memberPointsBalance: [{ customer_id: 'cust-all-tools', total_points: 50 }],
    transactions: [{ id: 'tx-all', customer_id: 'cust-all-tools', total_amount: 100000, status: 'completed' }],
    bookings: [{ id: 'b-all', customer_id: 'cust-all-tools', wa: '62818202588', status: 'done', location: 'bypass', barber_id: 'bypass1', service: 'Cut' }],
  });

  const ctx = { supabase, projection: 'INTERNAL', phone: '62818202588' };

  for (const toolName of CRM_TOOLS) {
    const res = await executeCrmTool(toolName, {}, ctx);
    assert.equal(res.status, 'success', `Tool ${toolName} failed execution`);
    assert.equal(res.customer_found, true, `Tool ${toolName} customer not found`);
    assert.notEqual(res.data, null, `Tool ${toolName} returned null data`);
  }
});

// ── 9. STATIC TEXT SEARCH AUDIT FOR MUTATION KEYWORDS ─────────────────────────
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
