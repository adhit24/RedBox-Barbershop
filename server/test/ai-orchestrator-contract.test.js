const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AGENTS,
  MODEL_TIERS,
  ROUTES,
  decisionFor,
  normalizeModelDecision,
} = require('../orchestrator/contract');
const { createClassifier } = require('../orchestrator/classifier');
const {
  DEFAULT_MODEL,
  classifyWithOpenAI,
  createOpenAIClient,
} = require('../orchestrator/openaiClient');

const EXPECTED_ROUTES = {
  general_question: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_general_question' },
  price_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_price' },
  location_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_location' },
  operating_hours_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_operating_hours' },
  service_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_service' },
  barber_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_barber_inquiry' },
  booking_request: { route: 'reddy_agent', agent: 'reddy_agent', action: 'route_booking_request' },
  booking_availability_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_booking_availability' },
  booking_status: { route: 'reddy_agent', agent: 'reddy_agent', action: 'get_booking_status' },
  reschedule_request: { route: 'reddy_agent', agent: 'reddy_agent', action: 'route_reschedule_request' },
  cancel_request: { route: 'reddy_agent', agent: 'reddy_agent', action: 'route_cancel_request' },
  customer_history: { route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_history' },
  points_inquiry: { route: 'crm_agent', agent: 'crm_agent', action: 'get_points' },
  customer_profile: { route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' },
  customer_preferences: { route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_preferences' },
  customer_transaction_history: { route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_transaction_history' },
  membership_inquiry: { route: 'reddy_agent', agent: 'reddy_agent', action: 'explain_membership' },
  complaint: { route: 'human', action: 'escalate_complaint', reason: 'complaint_escalation' },
  human_request: { route: 'human', action: 'request_human', reason: 'customer_requested_human' },
  unknown: { route: 'reddy_agent', agent: 'reddy_agent', action: 'fallback_unknown' },
};

test('canonical contract exposes only the three Phase 1 agents and four future-safe model tiers', () => {
  assert.deepEqual(AGENTS, ['orchestrator', 'crm_agent', 'reddy_agent']);
  assert.deepEqual(MODEL_TIERS, ['none', 'economy', 'standard', 'advanced']);
});

test('canonical routing contract maps every intent to a server-owned outcome', () => {
  assert.deepEqual(ROUTES, EXPECTED_ROUTES);
  for (const [intent, route] of Object.entries(EXPECTED_ROUTES)) {
    assert.deepEqual(decisionFor(intent, 0.82), {
      intent, ...route, confidence: 0.82, model_tier: 'economy',
    });
  }
});

test('no routing outcome can expose removed pseudo-agents', () => {
  const serialized = JSON.stringify(Object.values(ROUTES));
  for (const removed of ['booking_agent', 'general_agent', 'human_handoff']) {
    assert.equal(serialized.includes(removed), false);
  }
});

const intentCases = [
  ['Hai, apa kabar?', 'general_question'],
  ['Saya terakhir potong kapan?', 'customer_history'],
  ['Poin saya sekarang berapa?', 'points_inquiry'],
  ['Poin saya berapa?', 'points_inquiry'],
  ['Tampilkan profil pelanggan saya', 'customer_profile'],
  ['Apa preferensi layanan saya?', 'customer_preferences'],
  ['biasanya saya potong sama siapa?', 'customer_preferences'],
  ['Tampilkan riwayat transaksi saya', 'customer_transaction_history'],
  ['Saya mau booking Abdul besok sore', 'booking_request'],
  ['Saya mau pindah jadwal', 'reschedule_request'],
  ['Batalkan booking saya', 'cancel_request'],
  ['Gentleman Grooming berapa?', 'price_inquiry'],
  ['Redbox Sumber dimana?', 'location_inquiry'],
  ['Tegal buka jam berapa?', 'operating_hours_inquiry'],
  ['kapster Sumber siapa aja?', 'barber_inquiry'],
  ['Abdul kosong gak besok?', 'booking_availability_inquiry'],
  ['besok di Bypass bisa booking?', 'booking_availability_inquiry'],
  ['hair curly sama down perm bedanya apa?', 'service_inquiry'],
  ['Pelayanan kemarin jelek banget', 'complaint'],
  ['asdfgh qwerty', 'unknown'],
  ['Berapa harga haircut?', 'price_inquiry'],
  ['Lokasi cabang Sumber di mana?', 'location_inquiry'],
  ['Ada layanan coloring?', 'service_inquiry'],
  ['Saya mau booking besok', 'booking_request'],
  ['mau cukur besok pagi dong', 'booking_request'],
  ['Cek status booking saya', 'booking_status'],
  ['booking aku sudah masuk belum?', 'booking_status'],
  ['Saya mau ubah jadwal', 'reschedule_request'],
  ['jadwalnya geser ke sore bisa?', 'reschedule_request'],
  ['Tolong batalkan booking', 'cancel_request'],
  ['gajadi cukur, cancel ya', 'cancel_request'],
  ['Tampilkan riwayat kunjungan saya', 'customer_history'],
  ['Berapa poin saya?', 'points_inquiry'],
  ['Membership Gold benefitnya apa?', 'membership_inquiry'],
  ['Saya mau komplain', 'complaint'],
  ['teks yang tidak dapat dipahami', 'unknown'],
  ['mau cukur besok', 'booking_request'],
  ['poin gue brp', 'points_inquiry'],
  ['kapster yg kosong siapa', 'booking_availability_inquiry'],
  ['boleh', 'unknown'],
  ['mau ganti jam dong', 'reschedule_request'],
];

for (const [message, intent] of intentCases) {
  test(`classifier returns canonical ${intent} decision for: ${message}`, async () => {
    let calls = 0;
    const classifier = createClassifier({
      modelClassifier: async (actualMessage) => {
        calls += 1;
        assert.equal(actualMessage, message);
        return { intent, confidence: 0.73 };
      },
    });

    const result = await classifier(message);

    assert.deepEqual(result, {
      intent, ...EXPECTED_ROUTES[intent], confidence: 0.73, model_tier: 'economy',
    });
    assert.equal(calls, 1);
  });
}

for (const message of ['Saya mau bicara admin', 'admin dong', 'bicara dengan manusia', 'hubungkan ke customer service', 'mau bicara orang']) {
  test(`explicit human request bypasses OpenAI: ${message}`, async () => {
    const classifier = createClassifier({
      modelClassifier: async () => assert.fail('OpenAI must not be called for an explicit human request'),
    });
    assert.deepEqual(await classifier(message), {
      intent: 'human_request',
      route: 'human',
      action: 'request_human',
      reason: 'customer_requested_human',
      confidence: 1,
      model_tier: 'none',
    });
  });
}

test('invalid model output falls back to the canonical unknown decision', async () => {
  const classifier = createClassifier({ modelClassifier: async () => ({ intent: 'delete_everything', confidence: 9 }) });
  assert.deepEqual(await classifier('ambiguous'), {
    intent: 'unknown',
    route: 'reddy_agent',
    agent: 'reddy_agent',
    action: 'fallback_unknown',
    confidence: 0,
    model_tier: 'economy',
  });
  assert.deepEqual(normalizeModelDecision('{not-json'), decisionFor('unknown', 0));
});

for (const inheritedName of ['__proto__', 'constructor', 'toString']) {
  test(`inherited object property cannot bypass the canonical intent allowlist: ${inheritedName}`, () => {
    assert.deepEqual(normalizeModelDecision({ intent: inheritedName, confidence: 0.99 }), {
      intent: 'unknown',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'fallback_unknown',
      confidence: 0,
      model_tier: 'economy',
    });
  });
}

test('malformed JSON returned by the real OpenAI boundary becomes unknown instead of an upstream error', async () => {
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '{broken' } }] }) } },
  };
  const classifier = createClassifier({
    modelClassifier: (message) => classifyWithOpenAI(message, { client }),
  });
  assert.deepEqual(await classifier('pesan ambigu'), {
    intent: 'unknown',
    route: 'reddy_agent',
    agent: 'reddy_agent',
    action: 'fallback_unknown',
    confidence: 0,
    model_tier: 'economy',
  });
});

test('OpenAI SDK timeout is normalized for the route while other provider errors remain upstream errors', async () => {
  const timeout = new Error('timeout detail');
  timeout.name = 'APIConnectionTimeoutError';
  const timeoutClient = { chat: { completions: { create: async () => { throw timeout; } } } };
  await assert.rejects(classifyWithOpenAI('status?', { client: timeoutClient }), {
    code: 'CLASSIFICATION_TIMEOUT',
  });

  const upstream = new Error('provider detail');
  const upstreamClient = { chat: { completions: { create: async () => { throw upstream; } } } };
  await assert.rejects(classifyWithOpenAI('status?', { client: upstreamClient }), upstream);
});

test('OpenAI classifier makes one short structured-output call and returns only intent plus confidence', async () => {
  const calls = [];
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          calls.push(payload);
          return { choices: [{ message: { content: '{"intent":"price_inquiry","confidence":0.91}' } }] };
        },
      },
    },
  };

  const result = await classifyWithOpenAI('harga potong berapa?', { client });

  assert.deepEqual(result, { intent: 'price_inquiry', confidence: 0.91 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, DEFAULT_MODEL);
  assert.equal(calls[0].temperature, 0);
  assert.ok(calls[0].max_tokens <= 100);
  assert.equal(calls[0].response_format.type, 'json_schema');
  assert.equal(calls[0].response_format.json_schema.strict, true);
  assert.equal(JSON.stringify(calls[0]).includes('628123456789'), false);
});

test('OpenAI client uses only OPENAI_ORCHESTRATOR_API_KEY and disables retries', () => {
  const constructorCalls = [];
  class FakeOpenAI {
    constructor(options) { constructorCalls.push(options); }
  }

  assert.throws(
    () => createOpenAIClient({ OPENAI_API_KEY: 'must-not-be-used' }, FakeOpenAI),
    { code: 'ORCHESTRATOR_NOT_CONFIGURED' },
  );
  createOpenAIClient({ OPENAI_ORCHESTRATOR_API_KEY: 'orchestrator-only' }, FakeOpenAI);
  assert.deepEqual(constructorCalls, [{ apiKey: 'orchestrator-only', timeout: 8000, maxRetries: 0 }]);
});
