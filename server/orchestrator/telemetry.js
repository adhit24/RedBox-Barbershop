'use strict';

const { observeTelemetry } = require('../services/reddyEvaluationMonitoring');

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
    'booking_completion_report',
  ]);
  const allowedStrategies = new Set([
    'answer_directly', 'acknowledge_only', 'acknowledge_context', 'clarify_short',
    'answer_with_crm_fact', 'answer_with_knowledge_fact', 'guide_to_booking',
    'correct_semantic_confusion', 'close_conversation', 'human_handoff',
    'acknowledge_booking_completion_report',
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
  const allowedEligibilityReasons = new Set([
    'explicit_booking_request', 'explicit_booking_link_request', 'contextual_booking_continuation',
    'availability_booking_intent', 'informational_only', 'crm_topic', 'non_booking',
    'booking_completion_acknowledged',
  ]);

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
    booking_memory_relevant: typeof event.booking_memory_relevant === 'boolean' ? event.booking_memory_relevant : null,
    booking_response_eligible: typeof event.booking_response_eligible === 'boolean' ? event.booking_response_eligible : null,
    booking_cta_eligible: typeof event.booking_cta_eligible === 'boolean' ? event.booking_cta_eligible : null,
    booking_eligibility_reason: allowedEligibilityReasons.has(event.booking_eligibility_reason)
      ? event.booking_eligibility_reason : null,
    realtime_fact_guard_triggered: typeof event.realtime_fact_guard_triggered === 'boolean'
      ? event.realtime_fact_guard_triggered : null,
  };
}

function logOrchestratedEvent(event = {}) {
  const safe = sanitizeTelemetry(event);
  console.log('[OrchestratorTelemetry]', JSON.stringify(safe));
  observeTelemetry('orchestrator', safe);
  return safe;
}

const ALLOWED_HANDOFF_EVENTS = new Set([
  'handoff_requested', 'handoff_case_created', 'handoff_case_creation_failed',
  'handoff_waiting_human', 'handoff_human_claimed', 'handoff_bot_suppressed',
  'handoff_customer_message_appended', 'handoff_resolved', 'handoff_ai_reactivated',
  'handoff_duplicate_prevented',
]);
const ALLOWED_HANDOFF_TRIGGER_TYPES = new Set(['explicit_customer_request', 'policy_escalation', null]);
const ALLOWED_HANDOFF_PRIORITIES = new Set(['normal', 'high', 'urgent', null]);
const ALLOWED_HANDOFF_STATUS_TRANSITIONS = new Set([
  'none_to_waiting_human', 'waiting_human_to_human_active', 'human_active_to_resolved',
  'waiting_human_to_resolved', null,
]);

/**
 * Sanitizes Task 15 handoff events. Deliberately excludes any conversation
 * content (customer message text, summary body) — only safe routing/state
 * dimensions are logged, matching the no-PII contract sanitizeTelemetry
 * already enforces for orchestrator_routing events (spec §20).
 */
function sanitizeHandoffTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_HANDOFF_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    trigger_type: ALLOWED_HANDOFF_TRIGGER_TYPES.has(event.trigger_type) ? event.trigger_type : null,
    reason: typeof event.reason === 'string' ? event.reason.slice(0, 64) : null,
    priority: ALLOWED_HANDOFF_PRIORITIES.has(event.priority) ? event.priority : null,
    branch: typeof event.branch === 'string' ? event.branch : 'unknown',
    status_transition: ALLOWED_HANDOFF_STATUS_TRANSITIONS.has(event.status_transition) ? event.status_transition : null,
  };
}

function logHandoffEvent(event = {}) {
  const safe = sanitizeHandoffTelemetry(event);
  console.log('[HandoffTelemetry]', JSON.stringify(safe));
  observeTelemetry('handoff', safe);
  return safe;
}

// P0 incident hotfix — anti-spam/idempotency telemetry. Deliberately its own
// small allowlist schema (not folded into sanitizeTelemetry's
// orchestrator_routing shape): these events fire from the webhook entry
// point and outbound guard, before/around orchestrator routing, and carry
// their own bounded dimension set. No raw message content, no full phone
// numbers — branch/event_type/provider/status/reason only.
const ALLOWED_ANTISPAM_EVENTS = new Set([
  'inbound_event_received', 'inbound_event_claimed', 'inbound_duplicate_suppressed',
  'non_customer_event_suppressed', 'self_message_suppressed', 'ai_kill_switch_suppressed',
  'outbound_duplicate_suppressed', 'rate_limit_suppressed', 'outbound_send_attempt',
  'outbound_sent', 'processing_failed',
]);
const ALLOWED_ANTISPAM_EVENT_TYPES = new Set(['customer_message', 'status_callback', 'self_message', 'unsupported', null]);
const ALLOWED_ANTISPAM_PROVIDERS = new Set(['fonnte', null]);
const ALLOWED_ANTISPAM_IDEMPOTENCY_STATUS = new Set([
  'claimed', 'duplicate', 'unavailable', 'error',
  'missing_provider_message_id', 'missing_provider_device_id', null,
]);
const ALLOWED_ANTISPAM_EXECUTION_STATUS = new Set(['ok', 'suppressed', 'failed', null]);

function sanitizeAntiSpamTelemetry(event = {}) {
  const deviceHash = typeof event.device_hash === 'string' && /^[a-f0-9]{64}$/i.test(event.device_hash)
    ? event.device_hash.toLowerCase() : null;
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_ANTISPAM_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    branch: typeof event.branch === 'string' ? event.branch : 'unknown',
    provider: ALLOWED_ANTISPAM_PROVIDERS.has(event.provider) ? (event.provider || 'unknown') : 'unknown',
    inbound_event_type: ALLOWED_ANTISPAM_EVENT_TYPES.has(event.inbound_event_type) ? event.inbound_event_type : null,
    idempotency_status: ALLOWED_ANTISPAM_IDEMPOTENCY_STATUS.has(event.idempotency_status) ? event.idempotency_status : null,
    execution_status: ALLOWED_ANTISPAM_EXECUTION_STATUS.has(event.execution_status) ? event.execution_status : null,
    guard_reason: typeof event.guard_reason === 'string' ? event.guard_reason.slice(0, 64) : null,
    device_hash: deviceHash,
    message_id_present: typeof event.message_id_present === 'boolean' ? event.message_id_present : null,
  };
}

function logAntiSpamEvent(event = {}) {
  const safe = sanitizeAntiSpamTelemetry(event);
  console.log('[AntiSpamTelemetry]', JSON.stringify(safe));
  observeTelemetry('anti_spam', safe);
  return safe;
}

// Reddy conversation idle-timeout lifecycle telemetry (Task16 integration) —
// its own small allowlist schema, same rationale as the P0 anti-spam block
// above: these events fire from the inbound-message entrypoint, the P0
// guarded-send hook, and the idle-close cron job, not from orchestrator
// routing, and carry their own bounded dimension set. No message content,
// no phone numbers.
const ALLOWED_IDLE_LIFECYCLE_EVENTS = new Set([
  'conversation_idle_timer_scheduled', 'conversation_idle_timer_reset',
  'conversation_idle_close_sent', 'conversation_idle_close_suppressed',
  'conversation_session_reopened',
]);
const ALLOWED_IDLE_SUPPRESS_REASONS = new Set([
  'waiting_human', 'human_active', 'reddy_disabled', 'already_closed',
  'not_yet_due', 'claim_lost_race', 'send_failed', 'newer_inbound_detected', null,
]);

function sanitizeIdleLifecycleTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_IDLE_LIFECYCLE_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    branch: typeof event.branch === 'string' ? event.branch : 'unknown',
    suppress_reason: ALLOWED_IDLE_SUPPRESS_REASONS.has(event.suppress_reason) ? event.suppress_reason : null,
    stale_idle_close_prevented: typeof event.stale_idle_close_prevented === 'boolean'
      ? event.stale_idle_close_prevented : null,
    duplicate_idle_close_prevented: typeof event.duplicate_idle_close_prevented === 'boolean'
      ? event.duplicate_idle_close_prevented : null,
  };
}

function logIdleLifecycleEvent(event = {}) {
  const safe = sanitizeIdleLifecycleTelemetry(event);
  console.log('[IdleLifecycleTelemetry]', JSON.stringify(safe));
  return safe;
}

// Data Authority Repair Round 1 (DA-01 schedule overlap / DA-02 home-service
// schema drift) — its own small allowlist schema, same rationale as every
// other block above: this fires from server/moka/sync.js's schedule writer
// and api/cron/home-service-flag.js's reminder job, not from orchestrator
// routing or Reddy at all. OBSERVER-ONLY: nothing reads this telemetry to
// make a decision — it exists so a degraded/unresolved data-authority state
// is visible instead of silently swallowed. No customer name/phone/address,
// no raw Moka bill payload — only classification dimensions.
const ALLOWED_DATA_AUTHORITY_EVENTS = new Set([
  'schedule_sync_overlap_failure',
  'schedule_sync_conflict_reconciled',
  'schedule_sync_conflict_unresolved',
  'schedule_authority_degraded',
  'home_service_schema_mismatch',
]);
const ALLOWED_DATA_AUTHORITY_SOURCES = new Set(['moka', 'web', 'admin', 'home_service', 'cron', null]);

function sanitizeDataAuthorityTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_DATA_AUTHORITY_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    source: ALLOWED_DATA_AUTHORITY_SOURCES.has(event.source) ? event.source : null,
    reason: typeof event.reason === 'string' ? event.reason.slice(0, 96) : null,
    // Named `branch`, not `outlet`, specifically so it lines up with
    // reddyEvaluationMonitoring.js's mapTelemetryToEvaluation `common` object
    // (`branch: telemetry.branch`) — see the 'data_authority' family there.
    branch: typeof event.branch === 'string' ? event.branch.slice(0, 32) : null,
  };
}

function logDataAuthorityEvent(event = {}) {
  const safe = sanitizeDataAuthorityTelemetry(event);
  console.log('[DataAuthorityTelemetry]', JSON.stringify(safe));
  // Task16 integration (Correction Round 1, Blocker 2): observer-only, same
  // fail-open contract as every other logXEvent call in this file —
  // observeTelemetry() internally catches and swallows any recording
  // failure, never throws, never blocks the caller.
  observeTelemetry('data_authority', safe);
  return safe;
}

// CRM Integrity Round 1 — its own small allowlist schema, same rationale as
// every other block above: this fires from server/services/
// customerIdentityResolver.js, not from orchestrator routing or Reddy
// itself. OBSERVER-ONLY: nothing reads this telemetry to make a decision —
// it exists so identity-resolution health (and duplicate-identity
// prevalence) is visible instead of only ever reaching a console.log. No
// phone, name, raw WhatsApp identifier, or message content — only
// classification dimensions.
const ALLOWED_CRM_IDENTITY_EVENTS = new Set([
  'crm_identity_resolved',
  'crm_identity_not_found',
  'crm_identity_ambiguous',
  'crm_duplicate_identity_detected',
  'crm_identity_lookup_failed',
]);
const ALLOWED_CRM_IDENTITY_MATCH_BASES = new Set([
  'normalized_phone', 'moka_customer_id', 'member_profile', 'customer_id', null,
]);
const ALLOWED_CRM_IDENTITY_SOURCES = new Set([
  'crm_customer_self', 'crm_agent', 'reddy', 'moka_sync', 'admin', 'customer360', 'unknown',
  // Task 17.2 (CRM Integrity Round 3) — booking -> customer linkage call sites.
  'booking_create', 'booking_walkin', 'historical_backfill_dry_run',
]);

function sanitizeCrmIdentityTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_CRM_IDENTITY_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    source: ALLOWED_CRM_IDENTITY_SOURCES.has(event.source) ? event.source : 'unknown',
    branch: typeof event.branch === 'string' ? event.branch.slice(0, 32) : null,
    match_basis: ALLOWED_CRM_IDENTITY_MATCH_BASES.has(event.match_basis) ? event.match_basis : null,
    candidates_count: Number.isInteger(event.candidates_count) && event.candidates_count >= 0 ? event.candidates_count : null,
    normalized_input_present: typeof event.normalized_input_present === 'boolean' ? event.normalized_input_present : null,
  };
}

function logCrmIdentityEvent(event = {}) {
  const safe = sanitizeCrmIdentityTelemetry(event);
  console.log('[CrmIdentityTelemetry]', JSON.stringify(safe));
  // Fail-open, observer-only — same contract as every other logXEvent call.
  observeTelemetry('crm_identity', safe);
  return safe;
}

// Task 17.2 (CRM Integrity Round 3) — its own small allowlist schema, same
// rationale as every other block above: this fires from the booking-
// customer-linkage planner's callers (booking creation, walk-in creation,
// the historical backfill dry-run script), not from orchestrator routing or
// Reddy. OBSERVER-ONLY: nothing reads this telemetry to make a routing or
// booking decision — see server/services/bookingCustomerLinkage.js, which is
// a pure classifier with zero DB access. No phone, name, raw booking
// payload, or raw customer record — only classification dimensions.
const ALLOWED_BOOKING_LINKAGE_STATUSES = new Set([
  'already_linked', 'safe_link', 'ambiguous_identity', 'not_found',
  'invalid_identity', 'link_conflict', 'lookup_failed',
]);
const ALLOWED_BOOKING_LINKAGE_SOURCES = new Set([
  'booking_create', 'booking_walkin', 'historical_backfill_dry_run', 'unknown',
]);
const ALLOWED_BOOKING_LINKAGE_ISSUE_CODES = new Set([
  'ambiguous_phone', 'no_matching_customer', 'missing_identity', 'malformed_phone',
  'conflicting_stronger_identity', 'resolver_error', null,
]);
// Correction Round 1, Blocker 3: the actual persistence outcome of the
// conditional UPDATE, kept deliberately separate from `status` (the PURE
// pre-write plan) — so this telemetry can never be misread as claiming a
// link was written when it was not. See bookingCustomerLinkage.js's
// PERSISTENCE_STATUS for the authoritative definition of each value.
const ALLOWED_BOOKING_LINKAGE_PERSISTENCE_STATUSES = new Set([
  'not_attempted', 'persisted', 'write_failed', 'conditional_write_skipped',
]);

function sanitizeBookingLinkageTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    status: ALLOWED_BOOKING_LINKAGE_STATUSES.has(event.status) ? event.status : 'unknown',
    match_basis: ALLOWED_CRM_IDENTITY_MATCH_BASES.has(event.match_basis) ? event.match_basis : null,
    source: ALLOWED_BOOKING_LINKAGE_SOURCES.has(event.source) ? event.source : 'unknown',
    branch: typeof event.branch === 'string' ? event.branch.slice(0, 32) : null,
    candidate_count: Number.isInteger(event.candidate_count) && event.candidate_count >= 0 ? event.candidate_count : null,
    safe_to_link: typeof event.safe_to_link === 'boolean' ? event.safe_to_link : null,
    persistence_status: ALLOWED_BOOKING_LINKAGE_PERSISTENCE_STATUSES.has(event.persistence_status)
      ? event.persistence_status : 'not_attempted',
    issue_code: ALLOWED_BOOKING_LINKAGE_ISSUE_CODES.has(event.issue_code) ? event.issue_code : null,
  };
}

function logBookingLinkageEvent(event = {}) {
  const safe = sanitizeBookingLinkageTelemetry(event);
  console.log('[BookingLinkageTelemetry]', JSON.stringify(safe));
  // Fail-open, observer-only — same contract as every other logXEvent call.
  observeTelemetry('booking_linkage', safe);
  return safe;
}

module.exports = {
  sanitizeTelemetry, logOrchestratedEvent,
  sanitizeHandoffTelemetry, logHandoffEvent,
  sanitizeAntiSpamTelemetry, logAntiSpamEvent,
  sanitizeIdleLifecycleTelemetry, logIdleLifecycleEvent,
  sanitizeDataAuthorityTelemetry, logDataAuthorityEvent,
  sanitizeCrmIdentityTelemetry, logCrmIdentityEvent,
  sanitizeBookingLinkageTelemetry, logBookingLinkageEvent,
};
