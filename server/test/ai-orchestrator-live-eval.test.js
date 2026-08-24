const test = require('node:test');
const assert = require('node:assert/strict');

const { createClassifier } = require('../orchestrator/classifier');

const LIVE_EVAL_ENABLED = process.env.RUN_AI_ORCHESTRATOR_LIVE_EVAL === '1';

const CASES = [
  ['poin saya berapa?', 'points_inquiry', 'crm_agent'],
  ['poin gue tinggal brp', 'points_inquiry', 'crm_agent'],
  ['terakhir aku cukur kapan?', 'customer_history', 'crm_agent'],
  ['terakhir kesini kapan ya?', 'customer_history', 'crm_agent'],
  ['riwayat potong saya ada?', 'customer_history', 'crm_agent'],
  ['biasanya saya potong sama siapa?', 'customer_preferences', 'crm_agent'],
  ['gentleman grooming berapa?', 'price_inquiry', 'reddy_agent'],
  ['yang di csb harganya sama gak?', 'price_inquiry', 'reddy_agent'],
  ['redbox sumber dimana?', 'location_inquiry', 'reddy_agent'],
  ['buka sampe jam berapa?', 'operating_hours_inquiry', 'reddy_agent'],
  ['hair curly sama down perm bedanya apa?', 'service_inquiry', 'reddy_agent'],
  ['rambut tipis gampang lepek cocok potong apa?', 'service_inquiry', 'reddy_agent'],
  ['mau cukur besok', 'booking_request', 'reddy_agent'],
  ['abdul kosong gak besok?', 'booking_availability_inquiry', 'reddy_agent'],
  ['aku mau booking jam 5', 'booking_request', 'reddy_agent'],
  ['mau pindah jam dong', 'reschedule_request', 'reddy_agent'],
  ['booking aku batalin ya', 'cancel_request', 'reddy_agent'],
  ['membership itu dapet apa aja?', 'membership_inquiry', 'reddy_agent'],
  ['admin dong', 'human_request', 'human'],
  ['bisa sambungin ke orang?', 'human_request', 'human'],
  ['saya mau bicara dengan admin', 'human_request', 'human'],
  ['pelayanan kemarin jelek banget', 'complaint', 'human'],
  ['hasil cukurnya gak sesuai dan saya kecewa', 'complaint', 'human'],
  ['asdfgh', 'unknown', 'reddy_agent'],
  ['?', 'unknown', 'reddy_agent'],
  ['halo', 'general_question', 'reddy_agent'],
  ['makasih', 'general_question', 'reddy_agent'],
  ['wkwkwk', 'general_question', 'reddy_agent'],
  ['boleh', 'unknown', 'reddy_agent'],
  ['iya', 'unknown', 'reddy_agent'],
  ['harga di CSB berapa?', 'price_inquiry', 'reddy_agent'],
  ['besok di Bypass bisa booking?', 'booking_availability_inquiry', 'reddy_agent'],
  ['kapster Sumber yang ada siapa?', 'barber_inquiry', 'reddy_agent'],
  ['Tegal buka jam berapa?', 'operating_hours_inquiry', 'reddy_agent'],
  ['Samadikun lokasi dimana?', 'location_inquiry', 'reddy_agent'],
];

test('live OpenAI evaluation classifies the required Phase 1 phrases', {
  skip: !LIVE_EVAL_ENABLED,
  timeout: 180_000,
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
