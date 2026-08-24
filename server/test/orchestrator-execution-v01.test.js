'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  issueTrustedIdentity,
  isTrustedIdentity,
} = require('../identity/trustedIdentity');
const { executeOrchestration } = require('../orchestrator/executionService');

const POINTS_DECISION = Object.freeze({
  intent: 'points_inquiry',
  route: 'crm_agent',
  agent: 'crm_agent',
  action: 'get_points',
  confidence: 0.94,
  model_tier: 'economy',
});

function issueTestIdentity({ phone, customerId, source = 'member_session' } = {}) {
  return issueTrustedIdentity({
    source,
    ...(phone ? { verifiedPhone: phone } : {}),
    ...(customerId ? { verifiedCustomerId: customerId } : {}),
  });
}

function resultFromCrm(overrides = {}) {
  return {
    status: 'success',
    tool: 'get_points',
    contract_version: 'customer360.v0.1',
    customer_found: true,
    projection: 'CUSTOMER_SELF',
    data: { points_balance: 9, status: 'available', last_activity: null },
    ...overrides,
  };
}

test('trusted identity accepts and normalizes a server-issued phone identity', () => {
  const identity = issueTestIdentity({ source: 'whatsapp', phone: '0812-3456-7890' });

  assert.deepEqual(identity, { source: 'whatsapp', phone: '6281234567890' });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(isTrustedIdentity(identity), true);
});

test('trusted identity accepts a canonical customer UUID', () => {
  const identity = issueTrustedIdentity({
    source: 'member_session',
    verifiedCustomerId: 'A0F98A33-44B7-4D3D-9A62-54D3C16B4C20',
  });

  assert.equal(identity.customer_id, 'a0f98a33-44b7-4d3d-9a62-54d3c16b4c20');
  assert.equal(isTrustedIdentity(identity), true);
});

test('trusted identity rejects missing and malformed identity claims', () => {
  assert.throws(() => issueTrustedIdentity(), { code: 'TRUSTED_IDENTITY_REQUIRED' });
  assert.throws(
    () => issueTestIdentity({ phone: '123' }),
    { code: 'TRUSTED_IDENTITY_INVALID' },
  );
  assert.throws(
    () => issueTestIdentity({ source: 'browser_body', phone: '081234567890' }),
    { code: 'TRUSTED_IDENTITY_SOURCE_INVALID' },
  );
});

test('an arbitrary raw request body is not a trusted identity capability', () => {
  const rawBody = Object.freeze({ source: 'member_session', phone: '6281234567890' });
  assert.equal(isTrustedIdentity(rawBody), false);
  assert.throws(() => issueTrustedIdentity(rawBody), { code: 'TRUSTED_IDENTITY_INVALID' });
});

test('production issuer rejects internal_test and malformed phone identities', () => {
  assert.throws(
    () => issueTestIdentity({ source: 'internal_test', phone: '081234567890' }),
    { code: 'TRUSTED_IDENTITY_SOURCE_INVALID' },
  );
  for (const phone of ['+1 415 555 2671', '+44 20 7946 0958', '0812abc34567890', '62812x3456789', '6214155552671']) {
    assert.throws(() => issueTestIdentity({ phone }), { code: 'TRUSTED_IDENTITY_INVALID' });
  }
});

test('issuer rejects inherited, custom-prototype, null-prototype, and proto-key claims', () => {
  const inherited = Object.create({ source: 'member_session', verifiedPhone: '081234567890' });
  const customPrototype = Object.create({ attacker: true });
  customPrototype.source = 'member_session';
  customPrototype.verifiedPhone = '081234567890';
  const nullPrototype = Object.create(null);
  nullPrototype.source = 'member_session';
  nullPrototype.verifiedPhone = '081234567890';
  const protoKey = JSON.parse('{"source":"member_session","verifiedPhone":"081234567890","__proto__":{"role":"owner"}}');

  for (const claims of [inherited, customPrototype, nullPrototype, protoKey]) {
    assert.throws(() => issueTrustedIdentity(claims), { code: 'TRUSTED_IDENTITY_INVALID' });
  }
});

test('forged, cloned, spread, and serialized identities remain untrusted', () => {
  const identity = issueTestIdentity({ phone: '081234567890' });
  const forged = Object.freeze({ source: identity.source, phone: identity.phone });

  assert.equal(isTrustedIdentity(forged), false);
  assert.equal(isTrustedIdentity({ ...identity }), false);
  assert.equal(isTrustedIdentity(Object.assign({}, identity)), false);
  assert.equal(isTrustedIdentity(JSON.parse(JSON.stringify(identity))), false);
});

test('points inquiry executes get_points with empty params and trusted CUSTOMER_SELF context', async () => {
  const calls = [];
  const trustedIdentity = issueTestIdentity({ phone: '081234567890' });
  const output = await executeOrchestration(POINTS_DECISION, {
    trustedIdentity,
    supabase: { marker: 'read-only-client' },
    crmExecutor: async (...args) => {
      calls.push(args);
      return resultFromCrm();
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'get_points');
  assert.deepEqual(calls[0][1], {});
  assert.equal(calls[0][2].projection, 'CUSTOMER_SELF');
  assert.equal(calls[0][2].phone, '6281234567890');
  assert.equal(calls[0][2].customer_id, undefined);
  assert.equal(output.mode, 'execute');
  assert.equal(output.execution_status, 'success');
  assert.deepEqual(output.result.data, { points_balance: 9, status: 'available' });
  assert.doesNotMatch(JSON.stringify(output), /6281234567890/);
});

test('known customer with zero points is a successful execution', async () => {
  const output = await executeOrchestration(POINTS_DECISION, {
    trustedIdentity: issueTestIdentity({ phone: '081234567890' }),
    supabase: {},
    crmExecutor: async () => resultFromCrm({ data: { points_balance: 0, status: 'available' } }),
  });

  assert.equal(output.execution_status, 'success');
  assert.equal(output.result.data.points_balance, 0);
});

test('missing or forged trusted identity blocks CRM execution', async () => {
  let calls = 0;
  const crmExecutor = async () => { calls += 1; return resultFromCrm(); };

  for (const trustedIdentity of [undefined, { source: 'member_session', phone: '6281234567890' }]) {
    const output = await executeOrchestration(POINTS_DECISION, { trustedIdentity, supabase: {}, crmExecutor });
    assert.equal(output.execution_status, 'unauthorized');
    assert.equal(output.result.status, 'unauthorized');
  }
  assert.equal(calls, 0);
});

test('only the exact server-owned points allowlist can invoke CRM', async () => {
  let calls = 0;
  const dependency = {
    trustedIdentity: issueTestIdentity({ phone: '081234567890' }),
    supabase: {},
    crmExecutor: async () => { calls += 1; return resultFromCrm(); },
  };
  const decisions = [
    { ...POINTS_DECISION, intent: 'customer_history', action: 'get_customer_history' },
    { ...POINTS_DECISION, route: 'reddy_agent' },
    { intent: 'operating_hours_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_operating_hours', confidence: 0.9, model_tier: 'economy' },
    { intent: 'human_request', route: 'human', action: 'request_human', reason: 'customer_requested_human', confidence: 1, model_tier: 'none' },
    { intent: 'points_inquiry', route: 'crm_agent', agent: 'crm_agent', action: 'get_points', confidence: 0.94 },
    { intent: 'points_inquiry', route: 'crm_agent', agent: 'crm_agent', action: 'get_points', model_tier: 'economy' },
    null,
    undefined,
    [],
    'points_inquiry',
  ];

  for (const decision of decisions) {
    const output = await executeOrchestration(decision, dependency);
    assert.equal(output.mode, 'classify_only');
    assert.equal(output.execution_status, 'unsupported_execution');
  }
  assert.equal(calls, 0);
});

test('execution service exposes no target params and maps safe CRM failure semantics', async () => {
  const trustedIdentity = issueTestIdentity({ customerId: 'a0f98a33-44b7-4d3d-9a62-54d3c16b4c20' });
  const cases = [
    [{ status: 'forbidden', error: 'idor_attempt_blocked', customer_found: false, data: null }, 'forbidden'],
    [{ status: 'not_found', customer_found: false, data: null }, 'customer_not_found'],
    [{ status: 'ambiguous', error: 'ambiguous_identity', customer_found: false, data: null }, 'ambiguous_identity'],
    [{ status: 'db_error', error: 'Database connection failed for customer secret', customer_found: false, data: null }, 'database_unavailable'],
  ];

  for (const [crmResult, expected] of cases) {
    const output = await executeOrchestration(POINTS_DECISION, {
      trustedIdentity,
      supabase: {},
      crmExecutor: async (_tool, params) => {
        assert.deepEqual(params, {});
        return crmResult;
      },
    });
    assert.equal(output.execution_status, expected);
    assert.doesNotMatch(JSON.stringify(output), /a0f98a33|Database connection failed|customer secret/);
  }
});

test('an unexpected CRM exception fails closed without leaking its message', async () => {
  const output = await executeOrchestration(POINTS_DECISION, {
    trustedIdentity: issueTestIdentity({ phone: '081234567890' }),
    supabase: {},
    crmExecutor: async () => { throw new Error('raw database host and customer detail'); },
  });

  assert.equal(output.execution_status, 'database_unavailable');
  assert.doesNotMatch(JSON.stringify(output), /raw database host|customer detail/);
});

test('conflicting or unavailable point balance is not reported as success', async () => {
  const output = await executeOrchestration(POINTS_DECISION, {
    trustedIdentity: issueTestIdentity({ phone: '081234567890' }),
    supabase: {},
    crmExecutor: async () => resultFromCrm({
      data: { points_balance: null, status: 'ambiguous_balance_conflict' },
    }),
  });

  assert.equal(output.execution_status, 'points_unavailable');
  assert.deepEqual(output.result.data, {
    points_balance: null,
    status: 'ambiguous_balance_conflict',
  });
});

test('nested target injection never becomes CRM params or trusted context', async () => {
  const calls = [];
  const maliciousClassification = {
    ...POINTS_DECISION,
    params: { phone: '6289999999999', customer_id: 'attacker-id', user_key: 'attacker-key' },
    metadata: { phone: '6289999999999' },
    result: { customer_id: 'attacker-id' },
  };
  const output = await executeOrchestration(maliciousClassification, {
    trustedIdentity: issueTestIdentity({ phone: '081234567890' }),
    supabase: {},
    crmExecutor: async (tool, params, context) => {
      calls.push({ tool, params, context });
      return resultFromCrm();
    },
  });

  assert.equal(output.execution_status, 'success');
  assert.deepEqual(calls[0].params, {});
  assert.equal(calls[0].context.phone, '6281234567890');
  assert.equal(calls[0].context.customer_id, undefined);
  assert.equal(calls[0].context.user_key, undefined);
});

test('identity and execution layers contain no LLM, mutation, Fonnte, or WhatsApp side effects', () => {
  const files = [
    path.join(__dirname, '../identity/trustedIdentity.js'),
    path.join(__dirname, '../orchestrator/executionService.js'),
  ];
  const forbiddenPatterns = [
    /\bOpenAI\b/i,
    /chat\.completions/i,
    /responses\.create/i,
    /\.insert\s*\(/i,
    /\.update\s*\(/i,
    /\.upsert\s*\(/i,
    /\.delete\s*\(/i,
    /\bfonnte\b/i,
    /\bwa_paused\b/i,
    /sendWA\s*\(/i,
    /console\.(?:log|warn|error)\s*\(/i,
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) assert.doesNotMatch(content, pattern, `${pattern} found in ${file}`);
  }
});
