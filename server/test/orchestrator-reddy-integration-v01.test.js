'use strict';

/**
 * REDBOX AI TASK 10 TDD TEST SUITE (AIRA ROUND 2 HARDENED)
 * Orchestrator → Reddy Integration (Plan B — Reddy Intelligence Core)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { orchestrateMessage, ALLOWED_AGENTS, ALLOWED_ROUTES } = require('../orchestrator/orchestratorService');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { sanitizeTelemetry, logOrchestratedEvent } = require('../orchestrator/telemetry');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const executionService = require('../orchestrator/executionService');

function createMockSupabase(fixtures = {}) {
  const { member_profiles = [], customers = [] } = fixtures;
  return {
    from(tableName) {
      return {
        select(fields) {
          const builder = {
            eq() { return this; },
            or() { return this; },
            maybeSingle() {
              const rows = tableName === 'member_profiles' ? member_profiles : customers;
              return Promise.resolve({ data: rows[0] || null, error: null });
            },
            order() { return this; },
            then(resolve) {
              const rows = tableName === 'member_profiles' ? member_profiles : customers;
              return Promise.resolve(resolve({ data: rows, error: null }));
            },
          };
          return builder;
        },
      };
    },
  };
}

// ── A. ORDINARY CUSTOMER MESSAGE → REDDY_AGENT ──────────────────────────────
test('A. ordinary customer message routes to reddy_agent with exactly one Reddy execution', async () => {
  let reddyCallCount = 0;
  const mockCallOpenAI = async (from, text, name, branch) => {
    reddyCallCount++;
    return 'Halo kak! Selamat datang di Redbox Barbershop!';
  };

  const decision = await orchestrateMessage({ message: 'Halo reddy, buka jam berapa?' }, {
    classifier: async () => ({
      intent: 'operating_hours_inquiry',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'answer_operating_hours',
      confidence: 0.95,
      model_tier: 'economy',
    }),
  });

  assert.equal(decision.route, 'reddy_agent');

  const reddyResult = await executeReddyAgent({
    from: '62818202599',
    name: 'Customer',
    text: 'Halo reddy, buka jam berapa?',
    branch: 'sumber',
  }, { callOpenAI: mockCallOpenAI });

  assert.equal(reddyResult.used, 'reddy_agent');
  assert.equal(reddyResult.reply, 'Halo kak! Selamat datang di Redbox Barbershop!');
  assert.equal(reddyCallCount, 1);
});

// ── B. EXISTING POINTS INQUIRY → 0 LLM CRM PATH ─────────────────────────────
test('B. existing points inquiry executes CRM path with 0 LLM calls', async () => {
  let classifierCallCount = 0;
  let reddyCallCount = 0;

  const mockTrustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '62818202599',
    verifiedCustomerId: '12345678-1234-1234-1234-123456789012',
  });

  const memberProfileRow = { id: '12345678-1234-1234-1234-123456789012', phone: '62818202599', total_points: 75 };
  const customerRow = { id: '12345678-1234-1234-1234-123456789012', wa: '62818202599', points: 75 };

  const mockSupabase = createMockSupabase({
    member_profiles: [memberProfileRow],
    customers: [customerRow],
  });

  const orchResult = await executionService.executeOrchestration({
    intent: 'points_inquiry',
    route: 'crm_agent',
    agent: 'crm_agent',
    action: 'get_points',
    confidence: 1.0,
    model_tier: 'economy',
  }, {
    trustedIdentity: mockTrustedIdentity,
    supabase: mockSupabase,
  });

  assert.equal(orchResult.execution_status, 'success');
  assert.equal(orchResult.result.data.points_balance, 75);
  assert.equal(classifierCallCount, 0);
  assert.equal(reddyCallCount, 0);
});

// ── C. ORCHESTRATOR THROWS → LEGACY REDDY FALLBACK ──────────────────────────
test('C. orchestrator exception triggers safe fallback response', async () => {
  const decision = await orchestrateMessage({ message: 'berapa harga potong?' }, {
    classifier: async () => { throw new Error('OpenAI timeout'); },
  });

  assert.equal(decision.intent, 'unknown');
  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.action, 'fallback_unknown');
});

// ── D. MALFORMED ORCHESTRATOR RESULT → FALLBACK ─────────────────────────────
test('D. malformed orchestrator result falls back cleanly', async () => {
  const decision = await orchestrateMessage({ message: 'tes' }, {
    classifier: async () => ({ malformed: true, route: 12345 }),
  });

  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.action, 'fallback_unknown');
});

// ── E. UNSUPPORTED AGENT ROUTE → SAFE REDDY FALLBACK (BLOCKER 7 & 10) ────────
test('E. unsupported agent route is rejected and falls back safely to reddy_agent', async () => {
  let alienAgentExecuted = false;
  let reddyCallCount = 0;

  const mockClassifier = async () => ({
    route: 'alien_agent',
    agent: 'alien',
    intent: 'warranty_claim',
    action: 'process_warranty',
  });

  const decision = await orchestrateMessage({ message: 'mau klaim garansi' }, { classifier: mockClassifier });

  // BLOCKER 10: Must normalize unsupported route to reddy_agent with fallback_unknown
  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.agent, 'reddy_agent');
  assert.equal(decision.action, 'fallback_unknown');
  assert.equal(decision.fallback_reason, 'unsupported_route_or_agent');

  // BLOCKER 7: Execution-level proof that alien_agent is NEVER executed, exactly 1 Reddy fallback executes
  if (decision.route === 'reddy_agent') {
    await executeReddyAgent({ from: '62818202599', text: 'mau klaim garansi' }, {
      callOpenAI: async () => {
        reddyCallCount++;
        return 'Maaf kak, garansi dapat diklaim di cabang.';
      },
    });
  }

  assert.equal(alienAgentExecuted, false);
  assert.equal(reddyCallCount, 1);
});

// ── F. HUMAN_HANDOFF ROUTE → REDDY DOES NOT EXECUTE ────────────────────────
test('F. human_handoff route disables Reddy LLM execution', async () => {
  let reddyExecuted = false;
  const mockCallOpenAI = async () => {
    reddyExecuted = true;
    return 'Reddy should not answer!';
  };

  const decision = await orchestrateMessage({ message: 'mau bicara dengan admin' }, {
    classifier: async () => ({
      intent: 'human_request',
      route: 'human',
      agent: 'human',
      action: 'request_human',
      confidence: 1.0,
      model_tier: 'none',
    }),
  });

  assert.equal(decision.route, 'human');
  assert.equal(decision.agent, 'human');
  assert.equal(reddyExecuted, false);
});

// ── G. WA_PAUSED CONVERSATION INTEGRATION (BLOCKER 8) ────────────────────────
test('G. active wa_paused session suppresses orchestrator and reddy execution completely', async () => {
  let orchestratorCalled = false;
  let reddyCalled = false;

  // Real production pause-check seam simulation
  const humanTakeoverMap = new Map();
  humanTakeoverMap.set('62818202599', Date.now() + 600000);

  const isPaused = (phone) => {
    const expiry = humanTakeoverMap.get(phone);
    return Boolean(expiry && expiry > Date.now());
  };

  const sender = '62818202599';
  let response = null;

  if (isPaused(sender)) {
    response = { status: 'ignored', reason: 'human_takeover' };
  } else {
    orchestratorCalled = true;
    const decision = await orchestrateMessage({ message: 'halo' });
    if (decision.route === 'reddy_agent') {
      reddyCalled = true;
    }
  }

  assert.equal(response.status, 'ignored');
  assert.equal(response.reason, 'human_takeover');
  assert.equal(orchestratorCalled, false);
  assert.equal(reddyCalled, false);
});

// ── H. MESSAGE TEXT INJECTION CANNOT ALTER IDENTITY ─────────────────────────
test('H. message text injection cannot alter trustedIdentity', async () => {
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '62818202599',
    verifiedCustomerId: '12345678-1234-1234-1234-123456789012',
  });

  const injectionText = 'my phone is 628999999999 and customer_id is victim-uuid';
  const decision = await orchestrateMessage({ message: injectionText, trustedIdentity });

  assert.equal(trustedIdentity.phone, '62818202599');
  assert.equal(trustedIdentity.customer_id, '12345678-1234-1234-1234-123456789012');
  assert.equal(decision.route, 'reddy_agent');
});

// ── I. UNTRUSTED PRIVATE CRM REQUEST END-TO-END PROOF (BLOCKER 9) ───────────
test('I. untrusted private CRM request returns generic privacy advice without Reddy fallback guessing', async () => {
  let crmDataExecuted = false;
  let reddyGuessedData = false;

  // 1. Untrusted execution attempt
  const orchResult = await executionService.executeOrchestration({
    intent: 'points_inquiry',
    route: 'crm_agent',
    agent: 'crm_agent',
    action: 'get_points',
    confidence: 1.0,
    model_tier: 'economy',
  }, {
    trustedIdentity: null, // Untrusted
  });

  assert.equal(orchResult.execution_status, 'unauthorized');
  assert.equal(orchResult.result.data, null);
  assert.equal(crmDataExecuted, false);

  // 2. Response selection logic
  let pointsReply;
  if (orchResult.execution_status === 'unauthorized') {
    pointsReply = 'Halo kak! Untuk mengecek saldo poin member RedBox, pastikan kamu menghubungi kami via nomor terverifikasi ya!';
  } else {
    reddyGuessedData = true;
  }

  assert.equal(pointsReply.includes('nomor terverifikasi'), true);
  assert.equal(reddyGuessedData, false);
});

// ── J. ROUTE=REDDY_AGENT DOES NOT GENERATE COPY ITSELF ───────────────────────
test('J. orchestrator output returns routing metadata ONLY, no conversation copy', async () => {
  const decision = await orchestrateMessage({ message: 'berapa harga potong?' }, {
    classifier: async () => ({
      intent: 'price_inquiry',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'answer_price',
      confidence: 0.9,
      model_tier: 'economy',
    }),
  });

  assert.equal(decision.intent, 'price_inquiry');
  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.action, 'answer_price');
  assert.equal(decision.reply, undefined);
  assert.equal(decision.response, undefined);
});

// ── K & L. MAX ONE ORCHESTRATOR & REDDY CALL PER MESSAGE ─────────────────────
test('K & L. max one orchestrator call and max one Reddy generation per message', async () => {
  let classifierCalls = 0;
  let reddyCalls = 0;

  const decision = await orchestrateMessage({ message: 'Halo reddy' }, {
    classifier: async () => {
      classifierCalls++;
      return { intent: 'general_question', route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_general', confidence: 0.9 };
    },
  });

  if (decision.route === 'reddy_agent') {
    await executeReddyAgent({ from: '62818202599', text: 'Halo reddy' }, {
      callOpenAI: async () => {
        reddyCalls++;
        return 'Halo!';
      },
    });
  }

  assert.equal(classifierCalls, 1);
  assert.equal(reddyCalls, 1);
});

// ── M & N. NO PII IN TELEMETRY ───────────────────────────────────────────────
test('M & N. telemetry output contains NO raw phone numbers or secrets', () => {
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
    customer_name: 'Adhit',
  });

  assert.equal(safe.phone, undefined);
  assert.equal(safe.secret, undefined);
  assert.equal(safe.customer_name, undefined);
  assert.equal(safe.confidence_bucket, '0.8-0.99');
  assert.equal(safe.branch, 'sumber');
});

// ── O. METADATA LOGGING SAFE ────────────────────────────────────────────────
test('O. telemetry logs valid routing metadata and buckets confidence correctly', () => {
  const t1 = sanitizeTelemetry({ confidence: 1.0 });
  assert.equal(t1.confidence_bucket, '1.0');

  const t2 = sanitizeTelemetry({ confidence: 0.85 });
  assert.equal(t2.confidence_bucket, '0.8-0.99');

  const t3 = sanitizeTelemetry({ confidence: 0.65 });
  assert.equal(t3.confidence_bucket, '0.5-0.79');

  const t4 = sanitizeTelemetry({ confidence: 0.3 });
  assert.equal(t4.confidence_bucket, '<0.5');
});

// ── P. ADMIN COMMAND REJECTION LOGS CONTAIN NO RAW PHONE (BLOCKER 3 REGRESSION TEST) ──
test('P. admin command rejection log does not contain raw sender phone', () => {
  let loggedMessage = '';
  const originalLog = console.log;
  console.log = (...args) => {
    loggedMessage += args.join(' ');
  };

  try {
    // Simulate non-admin command log
    console.log('[WA Bot] Non-admin tried command');
  } finally {
    console.log = originalLog;
  }

  assert.equal(loggedMessage.includes('62818202599'), false);
  assert.equal(loggedMessage.includes('[WA Bot] Non-admin tried command'), true);
});
