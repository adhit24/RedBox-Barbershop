'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { executeCrmTool } = require('../agents/crm/crmAgent');
const { resolveCustomerIdentity } = require('../crm/customerIdentity');
const { getCustomer360 } = require('../crm/customer360Service');
const { CRM_TOOLS } = require('../agents/crm/contract');

function createMockSupabase(options = {}) {
  const { simulateDbError = false, ...tables } = options;

  return {
    from(tableName) {
      return {
        select(fields) { return this; },
        eq(col, val) {
          this.filters = this.filters || [];
          this.filters.push({ col, val });
          return this;
        },
        or(conditions) {
          this.isOr = true;
          this.orRaw = conditions;
          return this;
        },
        order() { return this; },
        maybeSingle() {
          this.isMaybeSingle = true;
          return this;
        },
        then(resolve) {
          if (simulateDbError) {
            return resolve({ data: null, error: { message: 'Database connection failed' } });
          }

          const rawData = tables[tableName] || [];
          let filtered = [...rawData];

          if (this.isOr && this.orRaw) {
            const conds = this.orRaw.split(',').map(c => c.trim());
            filtered = filtered.filter(row => {
              return conds.some(cond => {
                const parts = cond.split('.eq.');
                if (parts.length === 2) {
                  const col = parts[0];
                  const targetVal = parts[1];
                  const rowVal = String(row[col] || '');
                  return rowVal === targetVal || rowVal.replace(/\D/g, '') === targetVal.replace(/\D/g, '');
                }
                return false;
              });
            });
          }

          if (this.filters) {
            for (const f of this.filters) {
              filtered = filtered.filter(row => String(row[f.col]) === String(f.val));
            }
          }

          let resultData = filtered;
          if (this.isMaybeSingle) {
            resultData = filtered.length >= 1 ? filtered[0] : null;
          }

          return resolve({ data: resultData, error: null });
        },
      };
    },
  };
}

// ── 1. IDOR DEFENSE MATRIX TESTS (ALL 6 CASES) ────────────────────────────────
test('IDOR Matrix Case A: context.phone = A, params.phone = A -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' }],
  });

  const res = await executeCrmTool('get_points', { phone: '62818202569' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
});

test('IDOR Matrix Case B: context.phone = A, params.phone = B -> BLOCKED (idor_attempt_blocked)', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'cust-a-id', wa: '62818202569' },
      { id: 'cust-b-id', wa: '62818202570' },
    ],
  });

  const res = await executeCrmTool('get_points', { phone: '62818202570' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('IDOR Matrix Case C: context.phone = A, params.customer_id = UUID_B -> BLOCKED (idor_attempt_blocked)', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-a', wa: '62818202569' },
      { id: 'uuid-b', wa: '62818202570' },
    ],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'uuid-b' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('IDOR Matrix Case D: context.customer_id = A, params.customer_id = UUID_B -> BLOCKED (idor_attempt_blocked)', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'uuid-a', wa: '62818202569' },
      { id: 'uuid-b', wa: '62818202570' },
    ],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'uuid-b' }, { supabase, projection: 'CUSTOMER_SELF', customer_id: 'uuid-a' });
  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('IDOR Matrix Case E: context.phone = A, params.phone = A (different format +62/08) -> ALLOWED', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-a-id', wa: '62818202569', phone_e164: '+62818202569' }],
  });

  const res = await executeCrmTool('get_points', { phone: '0818202569' }, { supabase, projection: 'CUSTOMER_SELF', phone: '62818202569' });
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
test('Duplicate Point Balance Rows: preferring exact member profile match', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-dup-1', wa: '62818202599', phone_e164: '+62818202599' }],
    member_profiles: [
      { id: 'cust-dup-1', phone: '62818202599', total_points: 25 },
    ],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202599' });
  assert.equal(c360.loyalty.points_balance, 25);
});

test('Duplicate Point Balance Rows: conflicting customer points fail closed to points_balance = null', async () => {
  const supabase = createMockSupabase({
    customers: [
      { id: 'unlinked-1', wa: '62818202500', points: 10 },
      { id: 'unlinked-2', wa: '62818202500', points: 50 },
    ],
    member_profiles: [],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202500' });
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

// ── 6. POINTS BUSINESS RULE TESTS (FACTUAL UNITS ONLY) ───────────────────────
test('Points: returns factual points_balance ONLY; NO monetary IDR conversion', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '62818202569', phone_e164: '+62818202569' }],
    member_profiles: [{ id: 'cust-1', phone: '62818202569', total_points: 9 }],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202569' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 9);
  assert.equal(c360.loyalty.points_value_idr, undefined);
  assert.equal(c360.loyalty.loyalty_discount_equivalent_idr, undefined);
});

// ── 7. MEMBERSHIP BRONZE TIER ORIGIN TESTS ──────────────────────────────────
test('Membership: active Gold member has tier_origin = configured', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-3', wa: '62818202571', phone_e164: '+62818202571' }],
    member_profiles: [{ id: 'mp-1', phone: '62818202571', tier: 'gold', membership_status: 'ACTIVE' }],
  });
  const c360 = await getCustomer360(supabase, { phone: '62818202571' });
  assert.equal(c360.membership.status, 'ACTIVE');
  assert.equal(c360.membership.tier, 'gold');
  assert.equal(c360.membership.tier_origin, 'configured');
});

// ── 8. VISIT SEMANTICS TESTS ───────────────────────────────────────────────
test('Visit Semantics: Booking only', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v1', wa: '62818202581', phone_e164: '+62818202581' }],
    bookings: [{ id: 'b-1', customer_id: 'cust-v1', status: 'done', date: '2026-08-01' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202581' });
  assert.equal(c360.activity.completed_visits_count, 1);
});

test('Visit Semantics: Transaction only', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-v2', wa: '62818202582', phone_e164: '+62818202582' }],
    transactions: [{ id: 't-1', customer_id: 'cust-v2', total_amount: 80000, status: 'completed', created_at: '2026-08-05T10:00:00Z' }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202582' });
  assert.equal(c360.spending.transaction_count, 1);
});

// ── 9. DIRECT COVERAGE FOR ALL 7 CRM TOOLS ──────────────────────────────────
test('CRM Agent Capabilities: direct test for all 7 declared tools', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-all-tools', wa: '62818202588', phone_e164: '+62818202588' }],
    member_profiles: [{ id: 'mp-all', phone: '62818202588', tier: 'silver', membership_status: 'ACTIVE', total_points: 50 }],
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
    /openAI/i,
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
