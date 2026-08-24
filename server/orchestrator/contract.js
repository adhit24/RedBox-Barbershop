// Phase 1 AI topology. Human handoff is a routing outcome, never an AI agent.
const AGENTS = Object.freeze(['orchestrator', 'crm_agent', 'reddy_agent']);

// Cost principle: use the cheapest model capable of doing the job correctly.
// v0.2 uses `none` for deterministic routing and `economy` for model classification.
// The wider enum keeps the response contract ready for future governance without
// introducing a multi-model system or analytics persistence today.
const MODEL_TIERS = Object.freeze(['none', 'economy', 'standard', 'advanced']);

// Reddy principle: "Creative in conversation, strict with facts."
// Prices, promotions, points, membership state, availability, customer history,
// branch details, and policy must eventually come from trusted databases,
// knowledge bases, business rules, or system APIs. This contract executes none.
const ROUTES = Object.freeze({
  general_question: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_general_question' }),
  price_inquiry: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_price' }),
  location_inquiry: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_location' }),
  service_inquiry: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_service' }),
  booking_request: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'route_booking_request' }),
  booking_status: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'get_booking_status' }),
  reschedule_request: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'route_reschedule_request' }),
  cancel_request: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'route_cancel_request' }),
  customer_history: Object.freeze({ route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_history' }),
  points_inquiry: Object.freeze({ route: 'crm_agent', agent: 'crm_agent', action: 'get_points' }),
  customer_profile: Object.freeze({ route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' }),
  customer_preferences: Object.freeze({ route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_preferences' }),
  customer_transaction_history: Object.freeze({ route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_transaction_history' }),
  membership_inquiry: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'explain_membership' }),
  complaint: Object.freeze({ route: 'human', action: 'escalate_complaint', reason: 'complaint_escalation' }),
  human_request: Object.freeze({ route: 'human', action: 'request_human', reason: 'customer_requested_human' }),
  unknown: Object.freeze({ route: 'reddy_agent', agent: 'reddy_agent', action: 'fallback_unknown' }),
});

function decisionFor(intent, confidence, { modelTier = 'economy' } = {}) {
  if (!Object.hasOwn(ROUTES, intent)) return null;
  if (!MODEL_TIERS.includes(modelTier)) return null;
  const route = ROUTES[intent];
  return { intent, ...route, confidence, model_tier: modelTier };
}

function normalizeModelDecision(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const confidence = parsed?.confidence;
    if (!Object.hasOwn(ROUTES, parsed?.intent) || typeof confidence !== 'number' || !Number.isFinite(confidence)
      || confidence < 0 || confidence > 1) {
      return decisionFor('unknown', 0);
    }
    return decisionFor(parsed.intent, confidence);
  } catch (_) {
    return decisionFor('unknown', 0);
  }
}

module.exports = { AGENTS, MODEL_TIERS, ROUTES, decisionFor, normalizeModelDecision };
