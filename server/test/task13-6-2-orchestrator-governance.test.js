'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { orchestrateMessage } = require('../orchestrator/orchestratorService');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const {
  extractCustomerIntelligenceEnvelope,
  buildCustomerFactsContext,
} = require('../agents/reddy/customerFactsContext');
const { sanitizeTelemetry } = require('../orchestrator/telemetry');
const { executeCustomerIntelligence } = require('../orchestrator/executionService');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { handleMessage, callOpenAI, bookingUrl } = require('../../api/wa/webhook');

const classifier = (intent, route = 'reddy_agent', action = 'answer_general_question') => async () => ({
  intent,
  route,
  agent: route === 'human' ? undefined : route,
  action,
  confidence: 0.91,
  model_tier: 'economy',
});

function context(...turns) {
  return {
    version: 'conversation_context.v0.1',
    trust: 'untrusted_conversation',
    history_status: turns.length ? 'available' : 'empty',
    turns,
    turn_count: turns.length,
    sessionStatus: turns.length ? 'active_conversation' : 'expired',
  };
}

test('O1 "Siang aja" with time context is temporal follow-up, not greeting', async () => {
  const decision = await orchestrateMessage({
    message: 'Siang aja',
    conversationContext: context({ role: 'user', content: 'Kayaknya masih lama.' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decision.conversational_act, 'temporal_followup');
  assert.equal(decision.continuation_type, 'contextual');
  assert.equal(decision.response_strategy, 'acknowledge_booking_context_without_commit');
  assert.notEqual(decision.conversational_act, 'greeting');

  let agentCalls = 0;
  let crmCalls = 0;
  const runtime = await handleMessage({
    from: '62811110001', text: 'Siang aja', branchFromPayload: 'bypass',
  }, {
    loadConversationHistory: async () => ({
      status: 'available',
      history: [{ role: 'user', content: 'Kayaknya masih lama.', timestamp: Date.now() }],
    }),
    orchestrate: params => orchestrateMessage(params, { classifier: classifier('general_question') }),
    executeReddy: async () => { agentCalls++; return { status: 'success', reply: 'Oke Kak, siang aja ya.' }; },
    executeIntelligence: async () => { crmCalls++; },
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
  });
  assert.equal(runtime.reply, 'Oke Kak, siang aja ya.');
  assert.equal(agentCalls, 1);
  assert.equal(crmCalls, 0);
});

test('O2 "Ok" in active session is acknowledge_only', async () => {
  const decision = await orchestrateMessage({
    message: 'Ok',
    conversationContext: context({ role: 'assistant', content: 'Booking bisa dilanjutkan lewat website ya Kak.' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decision.conversational_act, 'social_acknowledgement');
  assert.equal(decision.response_strategy, 'acknowledge_only');
  assert.deepEqual(decision.required_sources, []);

  let crmCalls = 0;
  const runtime = await handleMessage({
    from: '62811110002', text: 'Ok', branchFromPayload: 'bypass',
  }, {
    loadConversationHistory: async () => ({
      status: 'available',
      history: [{ role: 'assistant', content: 'Booking bisa dilanjutkan lewat website ya Kak.', timestamp: Date.now() }],
    }),
    orchestrate: params => orchestrateMessage(params, { classifier: classifier('customer_profile', 'crm_agent', 'get_customer_profile') }),
    executeIntelligence: async () => { crmCalls++; },
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
  });
  assert.equal(runtime.reply, 'Siap Kak.');
  assert.equal(crmCalls, 0);
});

test('O3 member_since question requests bounded CRM profile source', async () => {
  const decision = await orchestrateMessage({ message: 'Member sejak kapan?' }, {
    classifier: classifier('membership_inquiry'),
  });

  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_customer_profile');
  assert.deepEqual(decision.required_sources, ['crm:get_customer_profile']);
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
  const profileFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2024-03-01T00:00:00.000Z' }, membership: {} },
  }, 'customer_profile');
  assert.equal(profileFacts.facts.member_since, '2024-03-01T00:00:00.000Z');
  assert.equal(profileFacts.fact_quality.member_since, 'verified');
});

test('O4 last visit question requests CRM completed-visit source', async () => {
  const decision = await orchestrateMessage({ message: 'Terakhir aku ke Redbox kapan?' }, {
    classifier: classifier('general_question'),
  });

  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_visit_summary');
  assert.deepEqual(decision.required_sources, ['crm:get_visit_summary']);
  let calledTool;
  const trustedIdentity = issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: '081234567890' });
  const result = await executeCustomerIntelligence({
    intent: decision.intent, action: decision.action, trustedIdentity,
  }, {
    supabase: {},
    crmExecutor: async (tool) => {
      calledTool = tool;
      return { status: 'success', customer_found: true, data: { last_visit: '2026-08-11' } };
    },
  });
  assert.equal(calledTool, 'get_visit_summary');
  assert.equal(result.execution_status, 'success');
});

test('O5 points question requests get_points', async () => {
  const decision = await orchestrateMessage({ message: 'Poin aku?' }, {
    classifier: classifier('general_question'),
  });

  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_points');
  assert.deepEqual(decision.required_sources, ['crm:get_points']);
  const pointFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: { points_balance: 0, status: 'available' },
  }, 'points_inquiry');
  assert.equal(pointFacts.fact_quality.points, 'verified');
});

test('O6 availability question has booking authority claim guard', async () => {
  const decision = await orchestrateMessage({ message: 'Jam 7 penuh?' }, {
    classifier: classifier('booking_availability_inquiry'),
  });

  assert.deepEqual(decision.required_sources, ['booking_backend:live_availability']);
  assert.ok(decision.allowed_claims.includes('availability_must_be_checked_live'));
  assert.ok(decision.prohibited_claims.includes('unsupported_slot_full_or_available'));
});

test('O7 unavailable CRM fact explicitly prevents Reddy fabrication', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'not_found', customer_found: false, data: null,
  }, 'customer_profile');
  const prompt = buildCustomerFactsContext(envelope);

  assert.equal(envelope.fact_quality.identity, 'unavailable');
  assert.match(prompt, /do not invent|jangan mengarang|Do NOT invent/i);
});

test('O8 ambiguous CRM fact carries ambiguity and safe uncertainty instruction', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'ambiguous', customer_found: false, data: null,
  }, 'customer_profile');
  const prompt = buildCustomerFactsContext(envelope);

  assert.equal(envelope.fact_quality.identity, 'ambiguous');
  assert.match(prompt, /ambiguous|ambigu/i);
  assert.match(prompt, /klarifikasi|uncertain|belum dapat dipastikan/i);
});

test('O9 CRM remains factual authority over conversation claims', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { activity: { last_visit: '2026-08-11', last_visit_barber: 'Onoy' } },
  }, 'customer_history');
  const prompt = buildCustomerFactsContext(envelope);

  assert.equal(envelope.fact_quality.last_visit, 'verified');
  assert.match(prompt, /USER CLAIMS ARE NOT CRM FACTS/);
  assert.match(prompt, /CRM tetap|CRM facts/i);
});

test('O10 short barber name after choice context is barber follow-up, not CRM', async () => {
  const decision = await orchestrateMessage({
    message: 'Yogi',
    conversationContext: context({ role: 'assistant', content: 'Mau pilih kapster siapa, Kak?' }),
  }, { classifier: classifier('customer_preferences', 'crm_agent', 'get_customer_preferences') });

  assert.equal(decision.conversational_act, 'barber_choice_followup');
  assert.equal(decision.route, 'reddy_agent');
  assert.deepEqual(decision.required_sources, []);
});

test('O11 social acknowledgement never requests CRM', async () => {
  const decision = await orchestrateMessage({
    message: 'Sip',
    conversationContext: context({ role: 'assistant', content: 'Mau pilih kapster siapa, Kak?' }),
  }, { classifier: classifier('customer_profile', 'crm_agent', 'get_customer_profile') });

  assert.equal(decision.response_strategy, 'acknowledge_only');
  assert.deepEqual(decision.required_sources, []);
  assert.equal(decision.route, 'reddy_agent');
});

test('O12 public price question requests Knowledge, not CRM', async () => {
  const decision = await orchestrateMessage({ message: 'Harga gentleman grooming berapa?' }, {
    classifier: classifier('price_inquiry'),
  });

  assert.deepEqual(decision.required_sources, ['knowledge:verified_business_fact']);
  assert.equal(decision.route, 'reddy_agent');
});

test('O13 personalized preference question requires CRM before Reddy', async () => {
  const decision = await orchestrateMessage({ message: 'Kapster favorit aku siapa?' }, {
    classifier: classifier('general_question'),
  });

  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_customer_preferences');
  assert.deepEqual(decision.required_sources, ['crm:get_customer_preferences']);
  const preferenceFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: { favorite_barber: 'Onoy' },
  }, 'customer_preferences');
  assert.equal(preferenceFacts.fact_quality.favorite_barber, 'derived_verified');
});

test('O14 Reddy adapter consumes bounded orchestrator decision envelope', async () => {
  let receivedContext;
  const orchestrationDecision = await orchestrateMessage({ message: 'Harga grooming berapa?' }, {
    classifier: classifier('price_inquiry'),
  });

  await executeReddyAgent({
    from: 'redacted', text: 'Harga grooming berapa?', branch: 'bypass', orchestrationDecision,
  }, {
    callOpenAI: async (_from, _text, _name, _branch, _knowledge, _facts, conversationContext) => {
      receivedContext = conversationContext;
      return 'Harga terverifikasi tersedia.';
    },
  });

  assert.equal(receivedContext.orchestrator_decision.response_strategy, 'answer_with_knowledge_fact');
  assert.deepEqual(receivedContext.orchestrator_decision.required_sources, ['knowledge:verified_business_fact']);
});

test('O15 telemetry keeps source/strategy/quality metadata and strips PII', () => {
  const safe = sanitizeTelemetry({
    intent: 'customer_profile', route: 'crm_agent', action: 'get_customer_profile',
    conversational_act: 'customer_fact_question', response_strategy: 'answer_with_crm_fact',
    required_sources: ['crm:get_customer_profile'], crm_fact_status: 'verified',
    fallback_used: false, phone: '628123456789', name: 'Private Person', message: 'Member sejak kapan?',
  });

  assert.equal(safe.conversational_act, 'customer_fact_question');
  assert.equal(safe.response_strategy, 'answer_with_crm_fact');
  assert.deepEqual(safe.required_sources, ['crm:get_customer_profile']);
  assert.equal(safe.crm_fact_status, 'verified');
  assert.equal(JSON.stringify(safe).includes('628123456789'), false);
  assert.equal(JSON.stringify(safe).includes('Private Person'), false);
});

// --- ARCHITECTURE GOVERNANCE TESTS (G1 - G8) ---

test('G1 "Siang aja" after booking/time discussion has no-commit semantics and prohibited claims', async () => {
  const decision = await orchestrateMessage({
    message: 'Siang aja',
    conversationContext: context({ role: 'user', content: 'Kayaknya masih lama.' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decision.conversational_act, 'temporal_followup');
  assert.equal(decision.context_reference, 'prior_arrival_or_booking_time');
  assert.equal(decision.response_strategy, 'acknowledge_booking_context_without_commit');
  assert.ok(decision.prohibited_claims.includes('selection_saved'));
  assert.ok(decision.prohibited_claims.includes('slot_reserved'));
  assert.ok(decision.prohibited_claims.includes('time_selected_in_system'));
  assert.ok(decision.prohibited_claims.includes('reservation_confirmed'));
});

test('G2 barber candidate follow-up is understood but prohibited from claiming barber selected in system', async () => {
  const decision = await orchestrateMessage({
    message: 'Onoy aja',
    conversationContext: context({ role: 'assistant', content: 'Mau potong sama kapster siapa Kak?' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decision.conversational_act, 'barber_choice_followup');
  assert.equal(decision.response_strategy, 'acknowledge_booking_context_without_commit');
  assert.ok(decision.prohibited_claims.includes('barber_selected_in_system'));
  assert.ok(decision.prohibited_claims.includes('selection_saved'));
  assert.ok(decision.prohibited_claims.includes('booking_updated'));
});

test('G3 branch and service follow-up carry no-commit semantics and prohibited claims', async () => {
  const decisionBranch = await orchestrateMessage({
    message: 'Redbox Bypass',
    conversationContext: context({ role: 'assistant', content: 'Mau ke cabang mana Kak?' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decisionBranch.conversational_act, 'branch_choice_followup');
  assert.equal(decisionBranch.response_strategy, 'acknowledge_booking_context_without_commit');
  assert.ok(decisionBranch.prohibited_claims.includes('selection_saved'));

  const decisionService = await orchestrateMessage({
    message: 'Gentleman Grooming',
    conversationContext: context({ role: 'assistant', content: 'Mau ambil paket layanan apa Kak?' }),
  }, { classifier: classifier('general_question') });

  assert.equal(decisionService.conversational_act, 'service_choice_followup');
  assert.equal(decisionService.response_strategy, 'acknowledge_booking_context_without_commit');
  assert.ok(decisionService.prohibited_claims.includes('selection_saved'));
});

test('G4 member_since absent in raw customer profile keeps member_since unavailable despite customer.created_at', () => {
  const profileFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { created_at: '2024-03-01T00:00:00.000Z' }, membership: {} },
  }, 'customer_profile');

  assert.equal(profileFacts.facts.member_since, undefined);
  assert.equal(profileFacts.fact_quality.member_since, 'unavailable');
});

test('G5 canonical member_since present passes through canonical field', () => {
  const profileFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2024-03-01T00:00:00.000Z' }, membership: {} },
  }, 'customer_profile');

  assert.equal(profileFacts.facts.member_since, '2024-03-01T00:00:00.000Z');
  assert.equal(profileFacts.fact_quality.member_since, 'verified');
});

test('G6 fact_quality.member_since must be unavailable if canonical fact absent', () => {
  const profileFacts = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { name: 'Adhit' }, membership: {} },
  }, 'customer_profile');

  assert.equal(profileFacts.fact_quality.member_since, 'unavailable');
});

test('G7 Reddy consumes response strategy and prohibited booking mutation claims', async () => {
  const decision = await orchestrateMessage({
    message: 'Siang aja',
    conversationContext: context({ role: 'user', content: 'Kayaknya masih lama.' }),
  }, { classifier: classifier('general_question') });

  let capturedPrompt = '';
  await callOpenAI(
    '6281234567890',
    'Siang aja',
    'Adhit Nugraha',
    'bypass',
    { sessionStatus: 'active_conversation', orchestrator_decision: decision },
    null,
    null,
    {
      openai: {
        chat: {
          completions: {
            create: async (params) => {
              capturedPrompt = params.messages[0].content;
              return { choices: [{ message: { content: 'Oh, maksudnya datang siang aja ya Kak. Kalau mau reservasi, jam finalnya tetap pilih di website booking ya.' } }] };
            },
          },
        },
      },
    }
  );

  assert.match(capturedPrompt, /KEPUTUSAN ORCHESTRATOR/);
  assert.match(capturedPrompt, /acknowledge_booking_context_without_commit/);
  assert.match(capturedPrompt, /selection_saved/);
});

test('G8 booking URL authority remains unchanged', () => {
  const url = bookingUrl('bypass');
  assert.match(url, /redboxbarbershop.com/);
});
