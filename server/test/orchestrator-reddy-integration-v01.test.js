'use strict';

/**
 * REDBOX AI TASK 10 TDD TEST SUITE (AIRA ROUND 6 FINAL HARDENED)
 * Orchestrator → Reddy Integration (Plan B — Reddy Intelligence Core)
 * 100% Isolated Dependency Injection Tests — ZERO External Network / LLM / DB Side Effects
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { orchestrateMessage, ALLOWED_AGENTS, ALLOWED_ROUTES } = require('../orchestrator/orchestratorService');
const { sanitizeTelemetry } = require('../orchestrator/telemetry');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const webhookModule = require('../../api/wa/webhook');
const { handleMessage } = webhookModule;

// ── 1. AGENTS TOPOLOGY & TAXONOMY BOUNDARY TESTS (BLOCKER 1) ─────────────────
test('1. AGENTS topology strictly contains only reddy_agent and crm_agent (NO human agent)', () => {
  assert.deepEqual(Array.from(ALLOWED_AGENTS), ['reddy_agent', 'crm_agent']);
  assert.equal(ALLOWED_AGENTS.includes('human'), false);
});

test('2. human_request route outcome contains NO human AI agent', async () => {
  const decision = await orchestrateMessage({ message: 'mau bicara admin' }, {
    classifier: async () => ({
      intent: 'human_request',
      route: 'human',
      action: 'request_human',
      confidence: 1.0,
    }),
  });

  assert.equal(decision.route, 'human');
  assert.equal(decision.agent, undefined);
  assert.notEqual(decision.agent, 'human');
});

test('3. complaint route outcome contains NO human AI agent', async () => {
  const decision = await orchestrateMessage({ message: 'saya mau komplain cukuran jelek' }, {
    classifier: async () => ({
      intent: 'complaint',
      route: 'human',
      action: 'escalate_complaint',
      confidence: 1.0,
    }),
  });

  assert.equal(decision.route, 'human');
  assert.equal(decision.agent, undefined);
  assert.notEqual(decision.agent, 'human');
});

// ── 2. FALLBACK TELEMETRY METADATA PRESERVATION ──────────────────────────────
test('4. telemetry preserves orchestrator_error fallback_used=true and fallback_reason', async () => {
  const decision = await orchestrateMessage({ message: 'halo' }, {
    classifier: async () => { throw new Error('Classifier failed'); },
  });

  assert.equal(decision.fallback_used, true);
  assert.equal(decision.fallback_reason, 'orchestrator_error');
});

test('5. telemetry preserves unsupported_route_or_agent fallback metadata', async () => {
  const decision = await orchestrateMessage({ message: 'halo' }, {
    classifier: async () => ({ route: 'unsupported_alien_agent' }),
  });

  assert.equal(decision.fallback_used, true);
  assert.equal(decision.fallback_reason, 'unsupported_route_or_agent');
});

// ── 3. REAL PRODUCTION-PATH INTEGRATION TESTS WITH DEPENDENCY INJECTION ──────
test('6. Real production path (1): ordinary message uses real executeReddyAgent adapter proving orchestrator = 1, generateReddy = 1, sendWA = 1', async () => {
  let orchestratorCalls = 0;
  let reddyGenerationCalls = 0;
  let sendCalls = 0;

  const mocks = {
    orchestrate: async () => {
      orchestratorCalls++;
      return { route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer_general', fallback_used: false };
    },
    generateReddy: async () => {
      reddyGenerationCalls++;
      return 'Halo kak! Ada yang bisa dibantu?';
    },
    send: async () => {
      sendCalls++;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    name: 'Test Customer',
    text: 'halo reddy',
    device: '0818202599',
  }, mocks);

  assert.equal(orchestratorCalls, 1);
  assert.equal(reddyGenerationCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'reddy_agent');
  assert.equal(result.reply, 'Halo kak! Ada yang bisa dibantu?');
});

test('7. Real production path (2): deterministic points inquiry triggers 0 LLM, 0 Reddy, CRM execution = 1', async () => {
  let orchestratorCalls = 0;
  let reddyCalls = 0;
  let crmExecutionCalls = 0;

  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '62818202599',
    verifiedCustomerId: '12345678-1234-1234-1234-123456789012',
  });

  const mocks = {
    orchestrate: async () => { orchestratorCalls++; },
    executeReddy: async () => { reddyCalls++; },
    executeOrchestration: async () => {
      crmExecutionCalls++;
      return { execution_status: 'success', result: { data: { points_balance: 50 } } };
    },
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    name: 'Test Customer',
    text: 'poin saya berapa',
    device: '0818202599',
    trustedIdentity,
  }, mocks);

  assert.equal(orchestratorCalls, 0);
  assert.equal(reddyCalls, 0);
  assert.equal(crmExecutionCalls, 1);
  assert.equal(result.used, 'crm_points');
  assert.equal(result.reply.includes('50 poin'), true);
});

test('8. Real production path (3): orchestrator error preserves fallback_used=true and calls Reddy once', async () => {
  let telemetryEvent = null;
  let reddyCalls = 0;

  const mocks = {
    orchestrate: async () => ({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: 'unknown',
      action: 'fallback_unknown',
      fallback_used: true,
      fallback_reason: 'orchestrator_error',
    }),
    executeReddy: async () => {
      reddyCalls++;
      return { used: 'reddy_agent', reply: 'Fallback answer', sendResult: { status: 'sent' } };
    },
    logTelemetry: (evt) => { telemetryEvent = evt; },
    send: async () => ({ status: 'sent' }),
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'halo',
  }, mocks);

  assert.equal(reddyCalls, 1);
  assert.equal(result.used, 'reddy_agent');
  assert.equal(telemetryEvent.fallback_used, true);
  assert.equal(telemetryEvent.fallback_reason, 'orchestrator_error');
});

test('9. Real production path (4): real executeReddyAgent error triggers static fallback without 2nd OpenAI call', async () => {
  let generateReddyCalls = 0;
  let sendCalls = 0;

  const mocks = {
    orchestrate: async () => ({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: 'general',
      action: 'answer',
      fallback_used: false,
    }),
    generateReddy: async () => {
      generateReddyCalls++;
      throw new Error('OpenAI timeout inside executeReddyAgent');
    },
    send: async () => {
      sendCalls++;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'halo',
  }, mocks);

  assert.equal(generateReddyCalls, 1); // Exactly 1 attempt inside real executeReddyAgent
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'static_fallback');
});

test('10. Real production path (5): human route triggers handoff with setHumanTakeover = 1, persistHumanHandoff = 1, send = 1, Reddy = 0', async () => {
  let orchestratorCalls = 0;
  let reddyCalls = 0;
  let setTakeoverCalls = 0;
  let persistHandoffCalls = 0;
  let sendCalls = 0;

  const mocks = {
    orchestrate: async () => {
      orchestratorCalls++;
      return {
        route: 'human',
        intent: 'human_request',
        action: 'request_human',
        fallback_used: false,
      };
    },
    executeReddy: async () => { reddyCalls++; },
    setHumanTakeover: () => { setTakeoverCalls++; },
    persistHumanHandoff: async () => { persistHandoffCalls++; },
    send: async () => {
      sendCalls++;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'mau bicara dengan admin',
  }, mocks);

  assert.equal(orchestratorCalls, 1);
  assert.equal(reddyCalls, 0);
  assert.equal(setTakeoverCalls, 1);
  assert.equal(persistHandoffCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'human_handoff');
  assert.equal(result.reply.includes('admin cabang RedBox'), true);
});

test('11. Real production path (6): untrusted private CRM route (customer_history) returns crm_privacy_guard with Reddy = 0', async () => {
  let reddyCalls = 0;
  let crmDeepCalls = 0;
  let sendCalls = 0;

  const mocks = {
    orchestrate: async () => ({
      route: 'crm_agent',
      agent: 'crm_agent',
      intent: 'customer_history',
      action: 'get_history',
      fallback_used: false,
    }),
    executeReddy: async () => { reddyCalls++; },
    executeOrchestration: async () => { crmDeepCalls++; },
    send: async () => {
      sendCalls++;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'riwayat cukur saya',
    trustedIdentity: null, // Untrusted
  }, mocks);

  assert.equal(reddyCalls, 0);
  assert.equal(crmDeepCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'crm_privacy_guard');
  assert.equal(result.reply.includes('nomor terverifikasi'), true);
});

test('12. Real production path (7): trusted unsupported private CRM route returns crm_unavailable_guard with Reddy = 0', async () => {
  let reddyCalls = 0;
  let crmDeepCalls = 0;
  let sendCalls = 0;

  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '62818202599',
    verifiedCustomerId: '12345678-1234-1234-1234-123456789012',
  });

  const mocks = {
    orchestrate: async () => ({
      route: 'crm_agent',
      agent: 'crm_agent',
      intent: 'customer_history',
      action: 'get_history',
      fallback_used: false,
    }),
    executeReddy: async () => { reddyCalls++; },
    executeOrchestration: async () => { crmDeepCalls++; },
    send: async () => {
      sendCalls++;
      return { status: 'sent' };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'riwayat cukur saya',
    trustedIdentity,
  }, mocks);

  assert.equal(reddyCalls, 0);
  assert.equal(crmDeepCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'crm_unavailable_guard');
  assert.equal(result.reply.includes('masih sedang kami siapkan'), true);
});

test('13. Real production path (8): points inquiry uses deterministic shortcut and bypasses orchestrator', async () => {
  let orchestratorCalls = 0;

  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '62818202599',
    verifiedCustomerId: '12345678-1234-1234-1234-123456789012',
  });

  const mocks = {
    orchestrate: async () => { orchestratorCalls++; },
    executeOrchestration: async () => ({
      execution_status: 'success',
      result: { data: { points_balance: 100 } },
    }),
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    text: 'poin saya berapa',
    trustedIdentity,
  }, mocks);

  assert.equal(orchestratorCalls, 0); // Deterministic shortcut bypasses orchestrator
  assert.equal(result.used, 'crm_points');
  assert.equal(result.reply.includes('100 poin'), true);
});

test('14. Real production path: orchestrator exception falls through to legacy generateReddy and uses injected send (send = 1)', async () => {
  let orchestratorCalls = 0;
  let generateReddyCalls = 0;
  let sendCalls = 0;

  const mocks = {
    orchestrate: async () => {
      orchestratorCalls++;
      throw new Error('catastrophic orchestrator failure');
    },
    generateReddy: async () => {
      generateReddyCalls++;
      return 'Generated fallback Reddy response';
    },
    send: async () => {
      sendCalls++;
      return { status: 'sent', id: ['msg-123'] };
    },
    logTelemetry: () => {},
  };

  const result = await handleMessage({
    from: '62818202599',
    name: 'Test Customer',
    text: 'halo reddy',
    device: '0818202599',
  }, mocks);

  assert.equal(orchestratorCalls, 1);
  assert.equal(generateReddyCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(result.reply, 'Generated fallback Reddy response');
});

// ── 4. TELEMETRY & BOUNDED ENUMS ─────────────────────────────────────────────
test('15. Telemetry sanitization strips all PII and logs bounded fallback_reason', () => {
  const safe = sanitizeTelemetry({
    route: 'reddy_agent',
    agent: 'reddy_agent',
    intent: 'price_inquiry',
    action: 'answer_price',
    confidence: 0.92,
    model_tier: 'economy',
    branch: 'sumber',
    phone: '62818202599',
    secret: 'super-secret-key',
    fallback_used: true,
    fallback_reason: 'unsupported_route_or_agent',
  });

  assert.equal(safe.phone, undefined);
  assert.equal(safe.secret, undefined);
  assert.equal(safe.fallback_used, true);
  assert.equal(safe.fallback_reason, 'unsupported_route_or_agent');
});
