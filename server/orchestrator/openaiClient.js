const OpenAI = require('openai');
const { ROUTES } = require('./contract');

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 8000;

const INTENT_GUIDE = [
  'general_question: greeting/social/nonspecific; only if no business intent fits',
  'price_inquiry: price/cost',
  'location_inquiry: address/location; not hours',
  'operating_hours_inquiry: opening/closing hours',
  'service_inquiry: service details/comparison/difference/suitability',
  'barber_inquiry: barber identity/list/branch; no date/time/slot',
  'barber_popularity_inquiry: aggregate public barber booking-selection ranking (most booked/most selected/popular); not booking_request. Requests about most customers served/melayani are unsupported served-volume semantics and must not be treated as booking popularity facts',
  'booking_request: explicitly asks to book; not availability',
  'booking_availability_inquiry: whether barber/slot/date/time is available; classify only',
  'booking_status: existing booking status',
  'reschedule_request: change existing schedule',
  'cancel_request: cancel existing booking',
  'customer_history: past visits/events/services; not habits/favorites',
  'customer_booking_history: customer-owned previous booking date/time/details; never public booking cutoff or availability',
  'points_inquiry: loyalty points balance',
  'customer_profile: customer profile data',
  'customer_preferences: habits/favorites (biasanya, favorit)',
  'customer_transaction_history: purchase/payment history',
  'membership_inquiry: membership tier/benefit explanation',
  'complaint: complaint/dissatisfaction',
  'human_request: explicitly asks for human/admin',
  'unknown: uninterpretable or missing context',
].join('\n');

function configurationError() {
  const error = new Error('Orchestrator OpenAI key is not configured');
  error.code = 'ORCHESTRATOR_NOT_CONFIGURED';
  return error;
}

function createOpenAIClient(env = process.env, OpenAIClass = OpenAI) {
  const apiKey = String(env.OPENAI_ORCHESTRATOR_API_KEY || '').trim();
  if (!apiKey) throw configurationError();
  return new OpenAIClass({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
}

async function classifyWithOpenAI(message, { client, env = process.env, model = DEFAULT_MODEL } = {}) {
  const openai = client || createOpenAIClient(env);
  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 80,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'redbox_orchestrator_intent',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              intent: { type: 'string', enum: Object.keys(ROUTES) },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['intent', 'confidence'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: `Classify one Indonesian RedBox customer message. Return only the schema. No context: boleh/iya/oke/gas/lanjut MUST be unknown; halo/makasih/wkwkwk are general_question.\n${INTENT_GUIDE}`,
        },
        { role: 'user', content: message },
      ],
    });
    return JSON.parse(completion?.choices?.[0]?.message?.content || '');
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if (/timeout/i.test(String(error?.name || '')) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)) {
      const timeoutError = new Error('OpenAI classification timed out');
      timeoutError.code = 'CLASSIFICATION_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_MODEL,
  REQUEST_TIMEOUT_MS,
  classifyWithOpenAI,
  createOpenAIClient,
};
