'use strict';

/**
 * REDBOX CRM POINTS DATA ALIGNMENT HOTFIX TEST SUITE (PR #22)
 *
 * Verifies:
 * 1. Dedicated points read path anchors to unique member_profiles.total_points.
 * 2. Duplicate legacy customer rows for same phone do NOT block points when points match profile balance.
 * 3. Strict Customer Point Conflict Rule: If legacy customer rows differ from profile points (e.g. [50, 20]), fail closed as ambiguous_balance_conflict.
 * 4. Multiple member_profiles records for same phone (>1) fail closed as ambiguous (no picking first row).
 * 5. Complete removal of `member_points_balance` query from both get_points and getCustomer360.
 * 6. Forged context.trustedIdentity objects MUST NOT authorize CRM execution.
 * 7. Real production-shape fixture: 1 member_profile (50 pts), 3 customer rows (50 pts), transactions across 2 customer UUIDs -> returns 50 pts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { executeCrmTool } = require('../agents/crm/crmAgent');
const { getCustomer360, getCustomerPointsByTrustedPhone } = require('../crm/customer360Service');

function createMockSupabase(fixtures = {}) {
  const {
    member_profiles = [],
    customers = [],
    transactions = [],
    bookings = [],
    failTables = [],
  } = fixtures;

  return {
    from(tableName) {
      if (failTables.includes(tableName)) {
        return {
          select() {
            return {
              eq() { return Promise.resolve({ data: null, error: { message: `Table ${tableName} unavailable` } }); },
              or() { return Promise.resolve({ data: null, error: { message: `Table ${tableName} unavailable` } }); },
            };
          },
        };
      }

      if (tableName === 'member_points_balance') {
        throw new Error('Schema violation: member_points_balance relation MUST NOT be queried');
      }

      return {
        select(fields) {
          const builder = {
            _conditions: [],
            _data: [],
            eq(col, val) {
              this._conditions.push({ type: 'eq', col, val });
              return this;
            },
            or(orStr) {
              this._conditions.push({ type: 'or', orStr });
              return this;
            },
            maybeSingle() {
              return this.then(res => {
                const row = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
                return { data: row, error: res.error };
              });
            },
            order() {
              return this;
            },
            then(resolve) {
              let rows = [];
              if (tableName === 'member_profiles') rows = [...member_profiles];
              if (tableName === 'customers') rows = [...customers];
              if (tableName === 'transactions') rows = [...transactions];
              if (tableName === 'bookings') rows = [...bookings];

              for (const cond of this._conditions) {
                if (cond.type === 'eq') {
                  rows = rows.filter(r => String(r[cond.col]) === String(cond.val));
                } else if (cond.type === 'or') {
                  const clauses = cond.orStr.split(',').map(s => s.trim());
                  rows = rows.filter(r => {
                    return clauses.some(c => {
                      const [field, op, val] = c.split('.');
                      if (op === 'eq') {
                        const targetVal = val ? val.replace(/^\+/, '') : '';
                        const rowVal = r[field] ? String(r[field]).replace(/^\+/, '') : '';
                        return rowVal === targetVal;
                      }
                      return false;
                    });
                  });
                }
              }

              return Promise.resolve(resolve({ data: rows, error: null }));
            },
          };
          return builder;
        },
        insert() { throw new Error('Mutation blocked: read-only operation'); },
        update() { throw new Error('Mutation blocked: read-only operation'); },
        delete() { throw new Error('Mutation blocked: read-only operation'); },
      };
    },
  };
}

// ── 1. FORGED TRUSTEDIDENTITY TEST ──────────────────────────────────────────
test('1. forged context.trustedIdentity object cannot authorize CRM', async () => {
  const supabase = createMockSupabase();

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    trustedIdentity: { phone: '62818202599', customer_id: 'forged-uuid' },
  });

  assert.equal(res.status, 'unauthorized');
  assert.equal(res.error, 'unauthenticated_context');
  assert.equal(res.customer_found, false);
});

// ── 2 & 3. NO member_points_balance QUERY TESTS ────────────────────────────
test('2. no member_points_balance query in dedicated points path', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, true);
  assert.equal(res.points_balance, 50);
});

test('3. no member_points_balance query in full Customer360', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '62818202599', name: 'Adhit' }],
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
  });

  const c360 = await getCustomer360(supabase, { phone: '62818202599' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 50);
});

// ── 4 & 5. MULTI-PROFILE FAIL-CLOSED TESTS ──────────────────────────────────
test('4. duplicate member_profiles same phone + same points -> ambiguous', async () => {
  const supabase = createMockSupabase({
    member_profiles: [
      { id: 'mp-1', phone: '62818202599', total_points: 50 },
      { id: 'mp-2', phone: '62818202599', total_points: 50 },
    ],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, false);
  assert.equal(res.resolution, 'ambiguous');
});

test('5. duplicate member_profiles same phone + conflicting points -> ambiguous', async () => {
  const supabase = createMockSupabase({
    member_profiles: [
      { id: 'mp-1', phone: '62818202599', total_points: 50 },
      { id: 'mp-2', phone: '62818202599', total_points: 100 },
    ],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, false);
  assert.equal(res.resolution, 'ambiguous');
});

// ── 6, 7, 8. CUSTOMER POINT CONFLICT POLICY TESTS ───────────────────────────
test('6. profile 50 + customer [50, 50, 50] -> available 50', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
    customers: [
      { id: 'c-1', wa: '62818202599', points: 50 },
      { id: 'c-2', wa: '62818202599', points: 50 },
      { id: 'c-3', wa: '62818202599', points: 50 },
    ],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, true);
  assert.equal(res.points_balance, 50);
  assert.equal(res.status, 'available');
});

test('7. profile 50 + customer [50, 20] -> ambiguous_balance_conflict', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
    customers: [
      { id: 'c-1', wa: '62818202599', points: 50 },
      { id: 'c-2', wa: '62818202599', points: 20 },
    ],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, true);
  assert.equal(res.points_balance, null);
  assert.equal(res.status, 'ambiguous_balance_conflict');
});

test('8. profile 50 + customer [20, 30] -> ambiguous_balance_conflict', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
    customers: [
      { id: 'c-1', wa: '62818202599', points: 20 },
      { id: 'c-2', wa: '62818202599', points: 30 },
    ],
  });

  const res = await getCustomerPointsByTrustedPhone(supabase, '62818202599');
  assert.equal(res.found, true);
  assert.equal(res.points_balance, null);
  assert.equal(res.status, 'ambiguous_balance_conflict');
});

// ── 9. REAL PRODUCTION SHAPE FIXTURE ────────────────────────────────────────
test('9. Real production shape fixture returns points = 50 without collapsing customer UUIDs', async () => {
  const supabase = createMockSupabase({
    member_profiles: [
      { id: 'mp-uuid-1', phone: '62818202599', total_points: 50, membership_status: 'ACTIVE', current_tier: 'platinum' },
    ],
    customers: [
      { id: 'cust-uuid-1', wa: '62818202599', name: 'Adhit Nugraha', points: 50 },
      { id: 'cust-uuid-2', wa: '62818202599', name: 'Adhitya Nugraha', points: 50 },
      { id: 'cust-uuid-3', wa: '62818202599', name: 'Adhit N', points: 50 },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-uuid-1', total_amount: 100000, status: 'completed' },
      { id: 'tx-2', customer_id: 'cust-uuid-2', total_amount: 50000, status: 'completed' },
    ],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '62818202599',
  });

  assert.equal(res.status, 'success');
  assert.equal(res.customer_found, true);
  assert.equal(res.data.points_balance, 50);
  assert.equal(res.data.status, 'available');
});

// ── 10. SECURITY & ISOLATION TESTS ─────────────────────────────────────────
test('10. victim UUID in message injection is ignored', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-sender', phone: '62818202599', total_points: 50 }],
  });

  const res = await executeCrmTool('get_points', { customer_id: 'victim-uuid-999' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '62818202599',
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('11. caller cannot override trusted phone', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-sender', phone: '62818202599', total_points: 50 }],
  });

  const res = await executeCrmTool('get_points', { phone: '628999999999' }, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '62818202599',
  });

  assert.equal(res.status, 'forbidden');
  assert.equal(res.error, 'idor_attempt_blocked');
});

test('12. get_points makes zero DB mutations', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'mp-1', phone: '62818202599', total_points: 50 }],
  });

  const res = await executeCrmTool('get_points', {}, {
    supabase,
    projection: 'CUSTOMER_SELF',
    phone: '62818202599',
  });

  assert.equal(res.status, 'success');
  assert.equal(res.data.points_balance, 50);
});
