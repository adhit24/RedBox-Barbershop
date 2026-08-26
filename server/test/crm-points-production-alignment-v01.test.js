'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const identityPath = path.resolve(__dirname, '../identity/trustedIdentity.js');
const { issueTrustedIdentity, isTrustedIdentity } = require(identityPath);
const { executeCrmTool } = require('../agents/crm/crmAgent');
const { getCustomer360 } = require('../crm/customer360Service');

function createTestContext(phone = '62818202599', supabase) {
  const trustedIdentity = issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: phone });
  return {
    trustedIdentity,
    phone: trustedIdentity.phone,
    projection: 'CUSTOMER_SELF',
    supabase,
  };
}

function createMockSupabase(tables = {}) {
  const mutationLogs = [];
  const logMutation = (op, table, payload) => {
    mutationLogs.push({ op, table, payload });
  };

  return {
    from(tableName) {
      let filters = [];
      let isOr = false;
      let orRaw = '';
      let isSingle = false;
      let isMaybeSingle = false;

      const builder = {
        select(fields) { return builder; },
        eq(col, val) { filters.push({ col, val }); return builder; },
        or(conditions) { isOr = true; orRaw = conditions; return builder; },
        order() { return builder; },
        single() { isSingle = true; return builder; },
        maybeSingle() { isMaybeSingle = true; return builder; },

        insert(data) { logMutation('insert', tableName, data); return Promise.resolve({ data: null, error: null }); },
        update(data) { logMutation('update', tableName, data); return Promise.resolve({ data: null, error: null }); },
        upsert(data) { logMutation('upsert', tableName, data); return Promise.resolve({ data: null, error: null }); },
        delete() { logMutation('delete', tableName, null); return Promise.resolve({ data: null, error: null }); },

        then(resolve, reject) {
          if (tableName === 'member_points_balance') {
            return resolve({ data: null, error: { message: 'relation "member_points_balance" does not exist', code: '42P01' } });
          }

          const rawData = tables[tableName] || [];
          let filtered = [...rawData];

          if (isOr && orRaw) {
            const conds = orRaw.split(',').map(c => c.trim());
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

          for (const f of filters) {
            filtered = filtered.filter(row => String(row[f.col]) === String(f.val));
          }

          let resultData = filtered;
          if (isSingle) {
            resultData = filtered.length === 1 ? filtered[0] : null;
          } else if (isMaybeSingle) {
            resultData = filtered.length >= 1 ? filtered[0] : null;
          }

          return resolve({ data: resultData, error: null });
        },
      };
      return builder;
    },
    rpc(fnName, params) {
      logMutation('rpc', fnName, params);
      return Promise.resolve({ data: null, error: null });
    },
    mutationLogs,
  };
}

// ── HOTFIX REQUIRED TESTS ───────────────────────────────────────────────────

// A. TRUSTED PHONE + UNIQUE MEMBER PROFILE + DUPLICATE CUSTOMERS
test('A. trusted phone + unique member profile + duplicate customers returns total_points', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-uuid-1', phone: '+62818202599', total_points: 50, membership_status: 'ACTIVE', current_tier: 'platinum' },
    ],
    customers: [
      { id: 'cust-uuid-1', name: 'Adhit Nugraha', wa: '62818202599', points: 50 },
      { id: 'cust-uuid-2', name: 'Adhitya Nugraha', wa: '62818202599', points: 50 },
      { id: 'cust-uuid-3', name: 'Adhit', wa: '62818202599', points: 50 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.customer_found, true);
  assert.equal(result.data.points_balance, 50);
  assert.equal(result.data.status, 'available');
});

// B. DUPLICATE CUSTOMER UUIDS DO NOT BLOCK POINTS WHEN UNIQUE PROFILE ANCHOR EXISTS
test('B. duplicate customer UUIDs with different names do NOT block get_points when unique profile exists', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-uuid-1', phone: '62818202599', total_points: 50 },
    ],
    customers: [
      { id: 'cust-uuid-1', name: 'Adhit Nugraha', wa: '62818202599', points: 50 },
      { id: 'cust-uuid-2', name: 'Adhitya Nugraha', wa: '62818202599', points: 50 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.data.points_balance, 50);
});

// C. REAL PRODUCTION SHAPE FIXTURE
test('C. Real production shape fixture returns points = 50 without collapsing customer UUIDs', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-uuid-1', phone: '+62818202599', total_points: 50, membership_status: 'ACTIVE', current_tier: 'platinum' },
    ],
    customers: [
      { id: 'cust-uuid-1', name: 'Adhit Nugraha', wa: '62818202599', points: 50 },
      { id: 'cust-uuid-2', name: 'Adhitya Nugraha', wa: '62818202599', points: 50, moka_customer_id: 'moka-123' },
      { id: 'cust-uuid-3', name: 'Adhit', wa: '62818202599', points: 50 },
    ],
    transactions: [
      { id: 'tx-1', customer_id: 'cust-uuid-1', total_amount: 100000, status: 'completed' },
      { id: 'tx-2', customer_id: 'cust-uuid-1', total_amount: 80000, status: 'completed' },
      { id: 'tx-3', customer_id: 'cust-uuid-2', total_amount: 120000, status: 'completed' },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.data.points_balance, 50);
  assert.equal(result.data.status, 'available');
});

// D. UNIQUE MEMBER PROFILE BUT CUSTOMER LEGACY BALANCES CONFLICT
test('D. unique member profile with conflicting customer points returns ambiguous_balance_conflict', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-uuid-1', phone: '62818202599', total_points: 50 },
    ],
    customers: [
      { id: 'cust-uuid-1', wa: '62818202599', points: 10 },
      { id: 'cust-uuid-2', wa: '62818202599', points: 100 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.data.points_balance, null);
  assert.equal(result.data.status, 'ambiguous_balance_conflict');
});

// E. MULTIPLE MEMBER_PROFILES FOR SAME PHONE WITH CONFLICTING IDENTITY
test('E. multiple member_profiles for same phone fails closed as ambiguous', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-1', phone: '62818202599', total_points: 50 },
      { id: 'mp-2', phone: '62818202599', total_points: 100 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'ambiguous');
});

// F. NO MEMBER PROFILE (FALLBACK TO CUSTOMERS.POINTS IF AGREED)
test('F. no member profile falls back to customer points if clean', async () => {
  const db = createMockSupabase({
    member_profiles: [],
    customers: [
      { id: 'cust-1', wa: '62818202599', points: 30 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.data.points_balance, 30);
});

// G. VICTIM UUID / MESSAGE INJECTION IS IGNORED
test('G. victim UUID in message injection is ignored', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-attacker', phone: '6281111111111', total_points: 10 },
      { id: 'mp-victim', phone: '6289999999999', total_points: 1000 },
    ],
    customers: [
      { id: 'victim-uuid-999', wa: '6289999999999', points: 1000 },
      { id: 'attacker-uuid-1', wa: '6281111111111', points: 10 },
    ],
  });

  const ctx = createTestContext('6281111111111', db);

  const normalRes = await executeCrmTool('get_points', {}, ctx);
  assert.equal(normalRes.status, 'success');
  assert.equal(normalRes.data.points_balance, 10);

  const idorRes = await executeCrmTool('get_points', { customer_id: 'victim-uuid-999' }, ctx);
  assert.equal(idorRes.status, 'forbidden');
  assert.equal(idorRes.error, 'idor_attempt_blocked');
});

// H. GET_POINTS CALLER CANNOT SELECT ANOTHER PHONE
test('H. caller cannot override trusted phone', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-attacker', phone: '6281111111111', total_points: 10 },
      { id: 'mp-victim', phone: '6289999999999', total_points: 1000 },
    ],
  });

  const ctx = createTestContext('6281111111111', db);
  const result = await executeCrmTool('get_points', { phone: '6289999999999' }, ctx);
  assert.equal(result.status, 'forbidden');
});

// I. NO DB WRITES
test('I. get_points makes zero DB mutations', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-1', phone: '62818202599', total_points: 50 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  await executeCrmTool('get_points', {}, ctx);
  assert.equal(db.mutationLogs.length, 0);
});

// J. NO member_points_balance QUERY
test('J. verifies member_points_balance is never queried', async () => {
  const db = createMockSupabase({
    member_profiles: [
      { id: 'mp-1', phone: '62818202599', total_points: 42 },
    ],
  });

  const ctx = createTestContext('62818202599', db);
  const result = await executeCrmTool('get_points', {}, ctx);
  assert.equal(result.status, 'success');
  assert.equal(result.data.points_balance, 42);
});

// K. CUSTOMER360 CONTRACT UNCHANGED
test('K. Customer360 contract properties remain intact', async () => {
  const db = createMockSupabase({
    customers: [{ id: 'c-1', wa: '62818202599', name: 'Adhit' }],
    member_profiles: [{ id: 'c-1', phone: '62818202599', total_points: 50 }],
  });

  const c360 = await getCustomer360(db, { phone: '62818202599' });
  assert.equal(c360.version, 'customer360.v0.1');
  assert.notEqual(c360.activity, null);
  assert.notEqual(c360.preferences, null);
});
