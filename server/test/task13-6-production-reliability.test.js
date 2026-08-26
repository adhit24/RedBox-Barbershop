'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { createClassifier } = require('../orchestrator/classifier');
const {
  executeCustomerIntelligence,
  TASK11_CRM_ALLOWLIST,
} = require('../orchestrator/executionService');
const { projectCustomerSelf } = require('../crm/customerPrivacy');
const {
  extractCustomerIntelligenceEnvelope,
} = require('../agents/reddy/customerFactsContext');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { handleMessage } = require('../../api/wa/webhook');
const { sanitizeTelemetry } = require('../orchestrator/telemetry');

const TRUSTED_IDENTITY = issueTrustedIdentity({
  source: 'whatsapp',
  verifiedPhone: '6281111110136',
  verifiedCustomerId: '12345678-1234-1234-1234-123456789136',
});

function runIsolatedWebhook(script) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
  });
}

function successfulCrmResult(tool, data) {
  return {
    status: 'success',
    tool,
    customer_found: true,
    projection: 'CUSTOMER_SELF',
    data,
  };
}

test('R1: legacy OpenAI path reports explicit missing-key configuration error, never undeclared client state', () => {
  const child = runIsolatedWebhook(`
    delete process.env.OPENAI_API_KEY;
    const assert = require('node:assert/strict');
    const { callOpenAI } = require('./api/wa/webhook');
    callOpenAI('628100000001', 'Halo', 'Kak', 'bypass', null, null, null, {
      persistConversationExchange: async () => {},
    }).then(
      () => { throw new Error('expected configuration failure'); },
      (error) => assert.equal(error.message, 'OPENAI_API_KEY not set'),
    );
  `);

  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('R2: transaction-history taxonomy executes the existing canonical transaction summary tool', async () => {
  let calls = 0;
  let receivedTool = null;
  const result = await executeCustomerIntelligence({
    intent: 'customer_transaction_history',
    trustedIdentity: TRUSTED_IDENTITY,
  }, {
    crmExecutor: async (tool) => {
      calls += 1;
      receivedTool = tool;
      return successfulCrmResult(tool, {
        activity: { completed_transaction_count: 4, last_visit: '2026-08-20' },
      });
    },
  });

  assert.equal(TASK11_CRM_ALLOWLIST.customer_transaction_history, 'get_transaction_summary');
  assert.equal(receivedTool, 'get_transaction_summary');
  assert.equal(calls, 1);
  assert.equal(result.execution_status, 'success');
  assert.equal(result.intelligence.facts.completed_transaction_count, 4);
});

test('R3: CRM failure path is fail-closed, emits valid telemetry, and sends exactly one safe response', async () => {
  const sent = [];
  const telemetry = [];
  const result = await handleMessage({
    from: '6281111110136',
    name: 'Adhit',
    text: 'transaksi terakhir aku gimana?',
    branchFromPayload: 'csb',
    trustedIdentity: TRUSTED_IDENTITY,
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'customer_transaction_history', route: 'crm_agent', agent: 'crm_agent',
      action: 'get_transaction_summary', confidence: 1, model_tier: 'none',
    }),
    executeIntelligence: async () => ({
      execution_status: 'unsupported_intent', intelligence: null,
      crm_tool: null, customer_found: false,
    }),
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: (event) => { telemetry.push(event); return event; },
  });

  assert.equal(result.used, 'crm_unavailable_guard');
  assert.equal(sent.length, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].execution_status, 'unsupported_intent');
  assert.equal(telemetry[0].fallback_used, true);
});

test('R4: profile execution maps to one CRM read and exposes only approved profile facts', async () => {
  let calls = 0;
  const result = await executeCustomerIntelligence({
    intent: 'customer_profile',
    trustedIdentity: TRUSTED_IDENTITY,
  }, {
    crmExecutor: async (tool, params) => {
      calls += 1;
      assert.equal(tool, 'get_customer_profile');
      assert.deepEqual(params, {});
      return successfulCrmResult(tool, {
        customer: { name: 'Adhit', registration_status: 'REGISTERED' },
        membership: { tier: 'Gold', status: 'ACTIVE' },
      });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.execution_status, 'success');
  assert.deepEqual(result.intelligence.facts, {
    name: 'Adhit', registration_status: 'REGISTERED',
    membership_tier: 'Gold', membership_status: 'ACTIVE',
  });
});

test('R5: CUSTOMER_SELF history preserves verified last-visit attribution without internal identifiers', () => {
  const projection = projectCustomerSelf({
    identity: { customer_found: true, resolution: 'resolved', customer_id: 'secret-id' },
    activity: {
      first_visit: '2026-01-01', last_visit: '2026-08-20',
      last_visit_branch: 'csb', last_visit_barber: 'Onoy', last_visit_service: 'Hair Spa',
      last_visit_source: 'booking', last_visit_confidence: 'verified',
      last_visit_event: {
        date: '2026-08-20', branch: 'csb', barber: 'Onoy', service: 'Hair Spa',
        source: 'booking', confidence: 'verified', id: 'must-not-leak',
      },
      completed_booking_count: 3, completed_transaction_count: 4,
    },
  });

  assert.equal(projection.activity.last_visit_barber, 'Onoy');
  assert.equal(projection.activity.last_visit_branch, 'csb');
  assert.equal(projection.activity.last_visit_service, 'Hair Spa');
  assert.equal(Object.hasOwn(projection.identity, 'customer_id'), false);
  assert.equal(Object.hasOwn(projection.activity.last_visit_event, 'id'), false);
});

test('R6: Customer360 preference metadata is normalized to customer-safe scalar facts', () => {
  const projection = projectCustomerSelf({
    identity: { customer_found: true, resolution: 'resolved' },
    preferences: {
      favorite_branch: { value: 'CSB', basis: 'event_frequency' },
      favorite_barber: { value: 'Ubay', basis: 'event_frequency' },
      favorite_service: { value: 'Hair Spa', basis: 'event_frequency' },
    },
  });
  const envelope = extractCustomerIntelligenceEnvelope(
    successfulCrmResult('get_customer_preferences', { preferences: projection.preferences }),
    'customer_preferences',
  );

  assert.equal(envelope.facts.favorite_branch, 'CSB');
  assert.equal(envelope.facts.favorite_barber, 'Ubay');
  assert.equal(envelope.facts.favorite_service, 'Hair Spa');
});

test('R7: bounded combined history-plus-preference query uses one Customer360-backed CRM intent', async () => {
  const classifier = createClassifier({
    modelClassifier: async () => { throw new Error('combined query must not depend on model choice'); },
  });
  const decision = await classifier('terakhir aku ke Redbox kapan dan kapster favorit aku siapa?');

  assert.equal(decision.intent, 'customer_history');
  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_customer_history');
  assert.equal(decision.model_tier, 'none');
});

test('A7: combined history and favorite facts produce one CRM read and one customer response', async () => {
  let crmReads = 0;
  let reddyCalls = 0;
  const sent = [];
  const result = await handleMessage({
    from: '6281111110136', name: 'Adhit',
    text: 'terakhir aku ke Redbox kapan dan kapster favorit aku siapa?',
    branchFromPayload: 'csb', trustedIdentity: TRUSTED_IDENTITY,
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'customer_history', route: 'crm_agent', agent: 'crm_agent',
      action: 'get_customer_history', confidence: 1, model_tier: 'none',
    }),
    executeIntelligence: async () => {
      crmReads += 1;
      return {
        execution_status: 'success', crm_tool: 'get_customer_history', customer_found: true,
        intelligence: {
          intent: 'customer_history', status: 'success', customer_found: true,
          facts: { last_visit: '2026-08-20', favorite_barber: 'Ubay' }, unknown_fields: [],
        },
      };
    },
    executeReddy: async ({ customerIntelligence }, dependencies) => {
      reddyCalls += 1;
      assert.equal(customerIntelligence.facts.last_visit, '2026-08-20');
      assert.equal(customerIntelligence.facts.favorite_barber, 'Ubay');
      const reply = 'Terakhir kamu ke Redbox 20 Agustus 2026, dan kapster favoritmu Ubay.';
      return { reply, sendResult: await dependencies.sendWA('6281111110136', reply, { branch: 'csb' }) };
    },
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: () => {},
  });

  assert.equal(result.used, 'crm_reddy_intelligence');
  assert.equal(crmReads, 1);
  assert.equal(reddyCalls, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /20 Agustus 2026/);
  assert.match(sent[0], /Ubay/);
});

test('R8: personal historical booking and public booking cutoff classify to distinct executable routes', async () => {
  const classifier = createClassifier({
    modelClassifier: async () => { throw new Error('high-risk booking distinction must be deterministic'); },
  });
  const personal = await classifier('terakhir booking aku jam berapa?');
  const publicPolicy = await classifier('slot booking terakhir CSB jam berapa?');

  assert.equal(personal.intent, 'customer_booking_history');
  assert.equal(personal.route, 'crm_agent');
  assert.equal(personal.action, 'get_customer_history');
  assert.equal(publicPolicy.intent, 'booking_availability_inquiry');
  assert.equal(publicPolicy.route, 'reddy_agent');
  assert.equal(publicPolicy.action, 'answer_booking_availability');
});

test('R8b: historical booking facts survive Customer360 CUSTOMER_SELF projection', () => {
  const projection = projectCustomerSelf({
    identity: { customer_found: true, resolution: 'resolved' },
    activity: {
      latest_booking_date: '2026-08-20', latest_booking_time: '19:30',
      latest_booking_branch: 'csb', latest_booking_barber: 'Onoy',
      latest_booking_service: 'Hair Spa', latest_booking_status: 'cancelled',
    },
  });

  assert.equal(projection.activity.latest_booking_date, '2026-08-20');
  assert.equal(projection.activity.latest_booking_time, '19:30');
  assert.equal(projection.activity.latest_booking_status, 'cancelled');
  assert.equal(Object.keys(projection.activity).some(key => key.startsWith('last_booking_')), false);
});

test('B4 booking cutoff remains public Knowledge and never executes customer history', async () => {
  const classifier = createClassifier({
    modelClassifier: async () => { throw new Error('public cutoff must be deterministic'); },
  });
  const decision = await classifier('slot booking terakhir CSB jam berapa?');
  let intelligenceCalls = 0;
  const sent = [];
  const result = await handleMessage({
    from: '6281111110136', text: 'slot booking terakhir CSB jam berapa?', branchFromPayload: 'csb',
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => decision,
    executeIntelligence: async () => { intelligenceCalls += 1; },
    executeReddy: async (_params, dependencies) => {
      const reply = 'Slot booking terakhir CSB adalah 21:00 WIB.';
      return { reply, sendResult: await dependencies.sendWA('6281111110136', reply, { branch: 'csb' }) };
    },
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: () => {},
  });

  assert.equal(decision.intent, 'booking_availability_inquiry');
  assert.equal(result.used, 'reddy_agent');
  assert.equal(intelligenceCalls, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /21:00/);
});

test('B5 visit query remains completed-visit fact, not latest booking record', async () => {
  let passedFacts = null;
  const result = await handleMessage({
    from: '6281111110136', text: 'terakhir aku potong kapan?', branchFromPayload: 'csb',
    trustedIdentity: TRUSTED_IDENTITY,
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'customer_history', route: 'crm_agent', agent: 'crm_agent',
      action: 'get_customer_history', confidence: 0.9, model_tier: 'economy',
    }),
    executeIntelligence: async () => ({
      execution_status: 'success', crm_tool: 'get_customer_history', customer_found: true,
      intelligence: {
        intent: 'customer_history', status: 'success', customer_found: true,
        facts: {
          last_visit: '2026-08-25',
          latest_booking_date: '2026-08-27', latest_booking_status: 'confirmed',
        },
        unknown_fields: [],
      },
    }),
    executeReddy: async ({ customerIntelligence }, dependencies) => {
      passedFacts = customerIntelligence.facts;
      const reply = `Kunjungan selesai terakhir kamu ${passedFacts.last_visit}.`;
      return { reply, sendResult: await dependencies.sendWA('6281111110136', reply, { branch: 'csb' }) };
    },
    send: async () => ({ ok: true }),
    logTelemetry: () => {},
  });

  assert.equal(result.used, 'crm_reddy_intelligence');
  assert.equal(passedFacts.last_visit, '2026-08-25');
  assert.equal(passedFacts.latest_booking_date, '2026-08-27');
  assert.match(result.reply, /2026-08-25/);
  assert.doesNotMatch(result.reply, /2026-08-27/);
});

test('R9: ordinary Reddy path initializes and reuses one module-scoped OpenAI client', () => {
  const child = runIsolatedWebhook(`
    process.env.OPENAI_API_KEY = 'test-only-key';
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const originalLoad = Module._load;
    let clientInstances = 0;
    let completions = 0;
    class FakeOpenAI {
      constructor(options) {
        assert.equal(options.apiKey, 'test-only-key');
        clientInstances += 1;
        this.chat = { completions: { create: async () => {
          completions += 1;
          return { choices: [{ message: { content: 'Hair Spa membantu perawatan rambut dan kulit kepala.' } }] };
        } } };
      }
    }
    Module._load = function(request) {
      if (request === 'openai') return FakeOpenAI;
      return originalLoad.apply(this, arguments);
    };
    const webhook = require('./api/wa/webhook');
    const generate = (...args) => webhook.callOpenAI(
      args[0], args[1], args[2], args[3], args[4], args[5], args[6],
      { persistConversationExchange: async () => {} },
    );
    const sent = [];
    const deps = {
      loadConversationHistory: async () => [],
      orchestrate: async () => ({
        intent: 'service_inquiry', route: 'reddy_agent', agent: 'reddy_agent',
        action: 'answer_service', confidence: 1, model_tier: 'none',
      }),
      generateReddy: generate,
      send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
      logTelemetry: () => {},
    };
    Promise.all([
      webhook.handleMessage({ from: '628100000009', name: 'Kak', text: 'Hair Spa cocok buat apa?', branchFromPayload: 'bypass' }, deps),
      webhook.handleMessage({ from: '628100000010', name: 'Kak', text: 'Hair Spa manfaatnya apa?', branchFromPayload: 'bypass' }, deps),
    ]).then((results) => {
      assert.equal(results.every((result) => result.used === 'reddy_agent'), true);
      assert.equal(clientInstances, 1);
      assert.equal(completions, 2);
      assert.equal(sent.length, 2);
    });
  `);

  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('R10: provider failure returns one static fallback with complete non-PII reliability telemetry', async () => {
  const sent = [];
  const telemetry = [];
  const result = await handleMessage({
    from: '6281111110199', name: 'Kak', text: 'Hair Spa cocok buat apa?', branchFromPayload: 'bypass',
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'service_inquiry', route: 'reddy_agent', agent: 'reddy_agent',
      action: 'answer_service', confidence: 0.9, model_tier: 'economy',
    }),
    executeReddy: async () => { throw new Error('simulated provider outage'); },
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: (event) => { telemetry.push(event); return event; },
  });

  assert.equal(result.used, 'static_fallback');
  assert.equal(sent.length, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].execution_status, 'degraded');
  assert.equal(telemetry[0].reddy_execution_status, 'error');
  assert.equal(telemetry[0].fallback_used, true);
  assert.equal(telemetry[0].fallback_reason, 'reddy_execution_error');
});

test('A11: booking status uses backend authority with no Reddy or CRM-history execution', async () => {
  let bookingReads = 0;
  let reddyCalls = 0;
  let intelligenceCalls = 0;
  const sent = [];
  const result = await handleMessage({
    from: '6281111110136', name: 'Adhit', text: 'booking aku sudah confirmed belum?',
    branchFromPayload: 'csb', trustedIdentity: TRUSTED_IDENTITY,
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'booking_status', route: 'reddy_agent', agent: 'reddy_agent',
      action: 'get_booking_status', confidence: 1, model_tier: 'none',
    }),
    getBookingStatus: async () => {
      bookingReads += 1;
      return { status: 'CONFIRMED', bookings: [] };
    },
    executeReddy: async () => { reddyCalls += 1; },
    executeIntelligence: async () => { intelligenceCalls += 1; },
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: () => {},
  });

  assert.equal(result.used, 'booking_status_backend');
  assert.match(result.reply, /confirmed/i);
  assert.equal(bookingReads, 1);
  assert.equal(reddyCalls, 0);
  assert.equal(intelligenceCalls, 0);
  assert.equal(sent.length, 1);
});

test('A13b: booking-status backend exception fails safe with one deterministic response', async () => {
  const sent = [];
  const telemetry = [];
  const result = await handleMessage({
    from: '6281111110136', text: 'booking aku sudah aman belum?', branchFromPayload: 'csb',
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'booking_status', route: 'reddy_agent', agent: 'reddy_agent',
      action: 'get_booking_status', confidence: 1, model_tier: 'none',
    }),
    getBookingStatus: async () => { throw new Error('simulated database exception'); },
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: (event) => { telemetry.push(event); return event; },
  });

  assert.equal(result.used, 'booking_status_backend');
  assert.match(result.reply, /tidak dapat diperiksa/i);
  assert.equal(sent.length, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].execution_status, 'database_unavailable');
  assert.equal(telemetry[0].fallback_reason, 'database_error');
});

test('observability retains reliability fields and strips private payload fields', () => {
  const event = sanitizeTelemetry({
    intent: 'customer_history', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_history',
    execution_status: 'success', crm_tool: 'get_customer_history', customer_found: true,
    reddy_execution_status: 'success', fallback_used: false, latency_ms: 42, branch: 'csb',
    phone: '6281111110136', customer_name: 'Adhit', message: 'private message', raw_crm_data: { id: 'secret' },
  });

  assert.equal(event.execution_status, 'success');
  assert.equal(event.crm_tool, 'get_customer_history');
  assert.equal(event.customer_found, true);
  assert.equal(event.reddy_execution_status, 'success');
  assert.equal(Object.hasOwn(event, 'phone'), false);
  assert.equal(Object.hasOwn(event, 'customer_name'), false);
  assert.equal(Object.hasOwn(event, 'message'), false);
  assert.equal(Object.hasOwn(event, 'raw_crm_data'), false);
});
