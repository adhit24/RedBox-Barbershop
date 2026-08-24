const OpenAI = require('openai');
const { ROUTES } = require('./contract');

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 8000;

const INTENT_GUIDE = [
  'general_question: casual or general question',
  'price_inquiry: asks price or cost',
  'location_inquiry: asks outlet address or location',
  'service_inquiry: asks available barbershop service',
  'booking_request: wants a new booking',
  'booking_status: asks status of an existing booking',
  'reschedule_request: wants to change an existing schedule',
  'cancel_request: wants to cancel an existing booking',
  'customer_history: asks visit or transaction history',
  'points_inquiry: asks loyalty point balance',
  'membership_inquiry: asks membership tier or benefit',
  'complaint: expresses a complaint or dissatisfaction',
  'human_request: explicitly asks for a human or admin',
  'unknown: cannot classify reliably',
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
          content: `Classify one Indonesian RedBox customer message. Return only the schema.\n${INTENT_GUIDE}`,
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
