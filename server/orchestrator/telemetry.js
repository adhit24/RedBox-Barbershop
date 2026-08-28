'use strict';

/**
 * Redbox AI Telemetry Logger v0.1
 * Logs safe structured routing events without PII leakage.
 */

/**
 * Sanitizes telemetry event parameters ensuring ZERO PII (phones, secrets, names, messages) is logged.
 * @param {object} event - Raw telemetry parameters
 * @returns {object} Safe telemetry payload
 */
function sanitizeTelemetry(event = {}) {
  const confidence = Number(event.confidence);
  let confidenceBucket = 'unknown';
  if (Number.isFinite(confidence)) {
    if (confidence === 1.0) confidenceBucket = '1.0';
    else if (confidence >= 0.8) confidenceBucket = '0.8-0.99';
    else if (confidence >= 0.5) confidenceBucket = '0.5-0.79';
    else confidenceBucket = '<0.5';
  }

  const allowedActs = new Set([
    'greeting', 'social_acknowledgement', 'explicit_closure', 'contextual_followup',
    'temporal_followup', 'barber_choice_followup', 'service_choice_followup',
    'branch_choice_followup', 'booking_request', 'booking_status_question',
    'customer_fact_question', 'business_fact_question', 'complaint', 'unknown',
  ]);
  const allowedStrategies = new Set([
    'answer_directly', 'acknowledge_only', 'acknowledge_context', 'clarify_short',
    'answer_with_crm_fact', 'answer_with_knowledge_fact', 'guide_to_booking',
    'correct_semantic_confusion', 'close_conversation', 'human_handoff',
  ]);
  const allowedSources = new Set([
    'crm:get_points', 'crm:get_customer_profile', 'crm:get_customer_history',
    'crm:get_visit_summary', 'crm:get_customer_preferences', 'crm:get_transaction_summary',
    'booking_backend:booking_status', 'booking_backend:live_availability',
    'booking_backend:reservation_flow', 'booking_backend:barber_popularity_trusted_read',
    'knowledge:verified_business_fact',
  ]);
  const requiredSources = Array.isArray(event.required_sources)
    ? event.required_sources.filter(source => allowedSources.has(source))
    : [];
  const qualityStates = new Set(['verified', 'derived_verified', 'unavailable', 'ambiguous', 'stale', 'legacy']);

  return {
    timestamp: new Date().toISOString(),
    event_type: 'orchestrator_routing',
    route: typeof event.route === 'string' ? event.route : 'unknown',
    agent: typeof event.agent === 'string' ? event.agent : 'unknown',
    intent: typeof event.intent === 'string' ? event.intent : 'unknown',
    action: typeof event.action === 'string' ? event.action : 'unknown',
    confidence_bucket: confidenceBucket,
    model_tier: typeof event.model_tier === 'string' ? event.model_tier : 'none',
    fallback_used: Boolean(event.fallback_used),
    fallback_reason: event.fallback_reason ? String(event.fallback_reason) : null,
    latency_ms: typeof event.latency_ms === 'number' ? Math.max(0, event.latency_ms) : null,
    branch: typeof event.branch === 'string' ? event.branch : 'unknown',
    trust_status: typeof event.trust_status === 'string' ? event.trust_status : 'unverified',
    execution_status: typeof event.execution_status === 'string' ? event.execution_status : 'unknown',
    crm_tool: typeof event.crm_tool === 'string' ? event.crm_tool : null,
    customer_found: typeof event.customer_found === 'boolean' ? event.customer_found : null,
    reddy_execution_status: typeof event.reddy_execution_status === 'string' ? event.reddy_execution_status : 'unknown',
    metric: typeof event.metric === 'string' ? event.metric : null,
    period_type: typeof event.period_type === 'string' ? event.period_type : null,
    result_count: Number.isInteger(event.result_count) && event.result_count >= 0 ? event.result_count : null,
    data_quality_exclusion_count: Number.isInteger(event.data_quality_exclusion_count)
      && event.data_quality_exclusion_count >= 0 ? event.data_quality_exclusion_count : null,
    branch_source: typeof event.branch_source === 'string' ? event.branch_source : null,
    conversational_act: allowedActs.has(event.conversational_act) ? event.conversational_act : 'unknown',
    required_sources: requiredSources,
    response_strategy: allowedStrategies.has(event.response_strategy) ? event.response_strategy : 'answer_directly',
    crm_fact_status: qualityStates.has(event.crm_fact_status) ? event.crm_fact_status : null,
    guard_blocked_prohibited_claim: Boolean(event.guard_blocked_prohibited_claim),
    guard_blocked_unverified_availability: Boolean(event.guard_blocked_unverified_availability),
  };
}

function logOrchestratedEvent(event = {}) {
  const safe = sanitizeTelemetry(event);
  console.log('[OrchestratorTelemetry]', JSON.stringify(safe));
  return safe;
}

module.exports = { sanitizeTelemetry, logOrchestratedEvent };
