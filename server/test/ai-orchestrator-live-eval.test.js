const test = require('node:test');
const assert = require('node:assert/strict');

const { createClassifier } = require('../orchestrator/classifier');

const LIVE_EVAL_ENABLED = process.env.RUN_AI_ORCHESTRATOR_LIVE_EVAL === '1';

const CASES = [
  ['Saya terakhir potong kapan?', 'customer_history', 'crm_agent'],
  ['Poin saya berapa?', 'points_inquiry', 'crm_agent'],
  ['Saya mau booking besok', 'booking_request', 'reddy_agent'],
  ['Saya mau pindah jadwal', 'reschedule_request', 'reddy_agent'],
  ['Batalkan booking saya', 'cancel_request', 'reddy_agent'],
  ['Gentleman Grooming berapa?', 'price_inquiry', 'reddy_agent'],
  ['Redbox Sumber dimana?', 'location_inquiry', 'reddy_agent'],
  ['Saya mau bicara admin', 'human_request', 'human'],
  ['Pelayanan kemarin jelek banget', 'complaint', 'human'],
  ['asdfgh qwerty', 'unknown', 'reddy_agent'],
];

test('live OpenAI evaluation classifies the required Phase 1 phrases', {
  skip: !LIVE_EVAL_ENABLED,
  timeout: 120_000,
}, async () => {
  assert.ok(
    process.env.OPENAI_ORCHESTRATOR_API_KEY,
    'OPENAI_ORCHESTRATOR_API_KEY is required when RUN_AI_ORCHESTRATOR_LIVE_EVAL=1',
  );

  const classifyMessage = createClassifier();
  for (const [message, expectedIntent, expectedRoute] of CASES) {
    const decision = await classifyMessage(message);
    assert.equal(decision.intent, expectedIntent, message);
    assert.equal(decision.route, expectedRoute, message);
    assert.equal(decision.model_tier, expectedIntent === 'human_request' ? 'none' : 'economy', message);
    if (expectedRoute === 'human') assert.equal(Object.hasOwn(decision, 'agent'), false, message);
  }
});
