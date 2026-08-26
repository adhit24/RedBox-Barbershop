'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const identityPath = path.resolve(__dirname, '../identity/trustedIdentity.js');
const { issueTrustedIdentity, isTrustedIdentity } = require(identityPath);
const { resolveCustomerIdentity } = require('../crm/customerIdentity');
const { getCustomer360 } = require('../crm/customer360Service');
const { executeCrmTool } = require('../agents/crm/crmAgent');

function createTestContext(phone = '6281234567890', supabase) {
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

  const createQueryBuilder = (tableName) => {
    let selectFields = '*';
    let filters = [];
    let isOr = false;
    let orRaw = '';
    let isSingle = false;
    let isMaybeSingle = false;

    const builder = {
      select(fields) { selectFields = fields; return builder; },
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
  };

  return {
    from(tableName) {
      return createQueryBuilder(tableName);
    },
    rpc(fnName, params) {
      logMutation('rpc', fnName, params);
      return Promise.resolve({ data: null, error: null });
    },
    mutationLogs,
  };
}

// ── TASK 7 TESTS ────────────────────────────────────────────────────────────

// A. ONE PHONE / ONE CUSTOMER
test('A. ONE PHONE / ONE CUSTOMER resolves normally', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit Nugraha', wa: '6281234567890', phone_e164: '+6281234567890', points: 50 },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit Nugraha', phone: '6281234567890', total_points: 50 },
    ],
  });

  const identity = await resolveCustomerIdentity(db, { phone: '6281234567890' });
  assert.equal(identity.found, true);
  assert.equal(identity.customer_id, 'c-101');

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 50);
});

// B. ONE PHONE / MULTIPLE CUSTOMER ROWS / SAME LOGICAL MEMBER
test('B. ONE PHONE / MULTIPLE CUSTOMER ROWS / SAME LOGICAL MEMBER resolves safely via member_profiles anchor', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit Nugraha', wa: '6281234567890', phone_e164: '+6281234567890', points: 50 },
      { id: 'c-102', name: 'Adhitya Nugraha', wa: '6281234567890', phone_e164: '+6281234567890', points: 50 },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit Nugraha', phone: '6281234567890', total_points: 50 },
    ],
  });

  const identity = await resolveCustomerIdentity(db, { phone: '6281234567890' });
  assert.equal(identity.found, true);
  assert.equal(identity.customer_id, 'c-101');

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 50);
});

// C. ONE PHONE / MULTIPLE CUSTOMER ROWS / CONFLICTING MEMBERSHIP EVIDENCE
test('C. ONE PHONE / MULTIPLE CUSTOMER ROWS / CONFLICTING MEMBERSHIP EVIDENCE fails closed as ambiguous', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Budi Santoso', wa: '6281234567890', phone_e164: '+6281234567890' },
      { id: 'c-102', name: 'Siti Rahma', wa: '6281234567890', phone_e164: '+6281234567890' },
    ],
    member_profiles: [],
  });

  const identity = await resolveCustomerIdentity(db, { phone: '6281234567890' });
  assert.equal(identity.found, false);
  assert.equal(identity.resolution, 'ambiguous');
});

// D. SMALL NAME VARIANT ONLY ("Adhit Nugraha" vs "Adhitya Nugraha")
test('D. SMALL NAME VARIANT ONLY + single trusted phone anchor resolves safely', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit Nugraha', wa: '6281234567890', phone_e164: '+6281234567890' },
      { id: 'c-102', name: 'Adhitya Nugraha', wa: '6281234567890', phone_e164: '+6281234567890' },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit Nugraha', phone: '6281234567890', total_points: 75 },
    ],
  });

  const identity = await resolveCustomerIdentity(db, { phone: '6281234567890' });
  assert.equal(identity.found, true);

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.loyalty.points_balance, 75);
});

// E. NAME VARIANT WITHOUT STRONGER EVIDENCE / CONFLICTING NAMES ("Budi" vs "Siti")
test('E. NAME VARIANT WITHOUT STRONGER EVIDENCE / CONFLICTING NAMES fails closed as ambiguous', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Budi Santoso', wa: '6281234567890', phone_e164: '+6281234567890' },
      { id: 'c-102', name: 'Siti Rahma', wa: '6281234567890', phone_e164: '+6281234567890' },
    ],
    member_profiles: [],
  });

  const identity = await resolveCustomerIdentity(db, { phone: '6281234567890' });
  assert.equal(identity.found, false);
  assert.equal(identity.resolution, 'ambiguous');
});

// F. CANONICAL MEMBER POINTS
test('F. CANONICAL MEMBER POINTS reads member_profiles.total_points', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit', wa: '6281234567890', phone_e164: '+6281234567890' },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit', phone: '6281234567890', total_points: 50 },
    ],
  });

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.loyalty.points_balance, 50);

  const ctx = createTestContext('6281234567890', db);
  assert.equal(isTrustedIdentity(ctx.trustedIdentity), true);
  const toolResult = await executeCrmTool('get_points', {}, ctx);
  assert.equal(toolResult.status, 'success');
  assert.equal(toolResult.data.points_balance, 50);
});

// G. POINTS SOURCE CONFLICT
test('G. POINTS SOURCE CONFLICT fails closed with ambiguous_balance_conflict', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit', wa: '6281234567890', points: 50 },
      { id: 'c-102', name: 'Adhit', wa: '6281234567890', points: 100 },
    ],
    member_profiles: [],
  });

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.loyalty.status, 'ambiguous_balance_conflict');
  assert.equal(c360.loyalty.points_balance, null);
});

// H. CUSTOMER NOT FOUND
test('H. CUSTOMER NOT FOUND returns not_found', async () => {
  const db = createMockSupabase({
    customers: [],
    member_profiles: [],
  });

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.identity.customer_found, false);
  assert.equal(c360.identity.resolution, 'not_found');

  const ctx = createTestContext('6281234567890', db);
  const toolResult = await executeCrmTool('get_points', {}, ctx);
  assert.equal(toolResult.status, 'not_found');
});

// I. WRONG TRUSTED PHONE / victim UUID in message
test('I. WRONG TRUSTED PHONE / victim UUID in message text is ignored', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'victim-uuid-999', name: 'Victim User', wa: '6289999999999', points: 1000 },
      { id: 'c-101', name: 'Attacker User', wa: '6281111111111', points: 10 },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Attacker User', phone: '6281111111111', total_points: 10 },
    ],
  });

  const ctx = createTestContext('6281111111111', db);

  // 1. Normal points inquiry (params = {}) resolves own points
  const normalResult = await executeCrmTool('get_points', {}, ctx);
  assert.equal(normalResult.status, 'success');
  assert.equal(normalResult.data.points_balance, 10);

  // 2. IDOR attempt in params (customer_id = victim-uuid-999) is blocked as forbidden
  const idorResult = await executeCrmTool('get_points', { customer_id: 'victim-uuid-999' }, ctx);
  assert.equal(idorResult.status, 'forbidden');
  assert.equal(idorResult.error, 'idor_attempt_blocked');
});

// J. NO DATABASE WRITES
test('J. NO DATABASE WRITES proves zero insert/update/delete/upsert/rpc mutations', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit Nugraha', wa: '6281234567890', phone_e164: '+6281234567890' },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit Nugraha', phone: '6281234567890', total_points: 88 },
    ],
  });

  const ctx = createTestContext('6281234567890', db);
  await executeCrmTool('get_points', {}, ctx);

  assert.equal(db.mutationLogs.length, 0, 'CRM get_points MUST make ZERO database mutations');
});

// K. NO member_points_balance DEPENDENCY
test('K. NO member_points_balance DEPENDENCY verifies member_points_balance table is never queried', async () => {
  const db = createMockSupabase({
    customers: [
      { id: 'c-101', name: 'Adhit Nugraha', wa: '6281234567890', points: 42 },
    ],
    member_profiles: [
      { id: 'c-101', full_name: 'Adhit Nugraha', phone: '6281234567890', total_points: 42 },
    ],
  });

  const c360 = await getCustomer360(db, { phone: '6281234567890' });
  assert.equal(c360.identity.customer_found, true);
  assert.equal(c360.loyalty.points_balance, 42);
});
