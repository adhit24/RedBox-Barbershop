const ROUTES = Object.freeze({
  general_question: Object.freeze({ agent: 'general_agent', action: 'answer_general_question' }),
  price_inquiry: Object.freeze({ agent: 'reddy_agent', action: 'answer_price' }),
  location_inquiry: Object.freeze({ agent: 'reddy_agent', action: 'answer_location' }),
  service_inquiry: Object.freeze({ agent: 'reddy_agent', action: 'answer_service' }),
  booking_request: Object.freeze({ agent: 'booking_agent', action: 'route_booking_request' }),
  booking_status: Object.freeze({ agent: 'booking_agent', action: 'get_booking_status' }),
  reschedule_request: Object.freeze({ agent: 'booking_agent', action: 'route_reschedule_request' }),
  cancel_request: Object.freeze({ agent: 'booking_agent', action: 'route_cancel_request' }),
  customer_history: Object.freeze({ agent: 'crm_agent', action: 'get_customer_history' }),
  points_inquiry: Object.freeze({ agent: 'crm_agent', action: 'get_points' }),
  membership_inquiry: Object.freeze({ agent: 'crm_agent', action: 'get_membership' }),
  complaint: Object.freeze({ agent: 'human_handoff', action: 'escalate_complaint' }),
  human_request: Object.freeze({ agent: 'human_handoff', action: 'request_human' }),
  unknown: Object.freeze({ agent: 'general_agent', action: 'fallback_unknown' }),
});

function decisionFor(intent, confidence) {
  if (!Object.hasOwn(ROUTES, intent)) return null;
  const route = ROUTES[intent];
  return { intent, ...route, confidence };
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

module.exports = { ROUTES, decisionFor, normalizeModelDecision };
