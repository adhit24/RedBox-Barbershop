'use strict';

const crypto = require('crypto');

const TABLE = 'reddy_evaluation_events';
const HEALTH_QUERY_PAGE_SIZE = 1000;
const SEVERITIES = Object.freeze({ INFO: 'INFO', WARNING: 'WARNING', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
const BRANCHES = new Set(['bypass', 'csb', 'sumber', 'samadikun', 'tegal', 'unknown']);

const DEFAULT_THRESHOLDS = Object.freeze({
  providerFailuresHigh: 3,
  handoffFailuresHigh: 2,
  duplicateContentWarningRate: 0.05,
  repetitiveClosingWarningCount: 3,
  keywordShortcutWarningRate: 0.30,
  stuckHandoffMinutes: 30,
});

const EVENT_DEFINITIONS = Object.freeze({
  inbound_event_claimed: ['INFO', 'inbound', 'INBOUND_ACCEPTED'],
  inbound_duplicate_suppressed: ['INFO', 'inbound', 'INBOUND_DUPLICATE'],
  missing_provider_message_id: ['CRITICAL', 'inbound', 'P0_MISSING_MESSAGE_ID'],
  missing_stable_device: ['CRITICAL', 'inbound', 'P0_MISSING_STABLE_DEVICE'],
  invalid_fonnte_envelope: ['HIGH', 'inbound', 'INVALID_FONNTE_ENVELOPE'],
  unsupported_webhook_event: ['INFO', 'inbound', 'UNSUPPORTED_WEBHOOK_EVENT'],
  outbound_send_attempt: ['INFO', 'outbound', 'OUTBOUND_ATTEMPT'],
  outbound_sent: ['INFO', 'outbound', 'OUTBOUND_SENT'],
  outbound_duplicate_suppressed: ['WARNING', 'outbound', 'OUTBOUND_DUPLICATE'],
  outbound_rate_limited: ['WARNING', 'outbound', 'OUTBOUND_RATE_LIMITED'],
  outbound_provider_error: ['HIGH', 'provider', 'OUTBOUND_PROVIDER_ERROR'],
  outbound_kill_switch_suppressed: ['INFO', 'outbound', 'KILL_SWITCH_SUPPRESSED'],
  duplicate_automated_outbound_confirmed: ['CRITICAL', 'outbound', 'DUPLICATE_AUTOMATED_SEND'],
  routing_decision: ['INFO', 'routing', 'ROUTING_DECISION'],
  keyword_shortcut_used: ['INFO', 'routing', 'KEYWORD_SHORTCUT'],
  orchestrator_route_used: ['INFO', 'routing', 'ORCHESTRATOR_ROUTE'],
  human_route_recommended: ['INFO', 'routing', 'HUMAN_ROUTE_RECOMMENDED'],
  bounded_response_used: ['INFO', 'routing', 'BOUNDED_RESPONSE'],
  booking_execution_attempted: ['CRITICAL', 'booking', 'BOOKING_EXECUTION_ATTEMPT'],
  booking_confirmation_claim_detected: ['CRITICAL', 'booking', 'FALSE_BOOKING_CONFIRMATION'],
  slot_reserved_claim_detected: ['CRITICAL', 'booking', 'FALSE_SLOT_RESERVED'],
  barber_locked_claim_detected: ['CRITICAL', 'booking', 'FALSE_BARBER_LOCKED'],
  booking_cta_sent: ['INFO', 'booking', 'BOOKING_CTA'],
  booking_cta_context_bleed_detected: ['WARNING', 'booking', 'BOOKING_CTA_CONTEXT_BLEED'],
  crm_context_loaded: ['INFO', 'crm', 'CRM_CONTEXT_LOADED'],
  crm_context_unavailable: ['WARNING', 'crm', 'CRM_CONTEXT_UNAVAILABLE'],
  membership_fact_used: ['INFO', 'crm', 'MEMBERSHIP_FACT_USED'],
  membership_unknown_fact_suppressed: ['INFO', 'crm', 'MEMBERSHIP_UNKNOWN_SUPPRESSED'],
  crm_context_bleed: ['HIGH', 'crm', 'CRM_CONTEXT_BLEED'],
  membership_false_claim: ['HIGH', 'crm', 'MEMBERSHIP_FALSE_CLAIM'],
  customer_history_false_claim: ['HIGH', 'crm', 'CUSTOMER_HISTORY_FALSE_CLAIM'],
  synthetic_membership_status: ['HIGH', 'crm', 'SYNTHETIC_MEMBERSHIP_STATUS'],
  barber_realtime_overclaim_detected: ['HIGH', 'barber_realtime', 'BARBER_REALTIME_OVERCLAIM'],
  handoff_requested: ['INFO', 'handoff', 'HANDOFF_REQUESTED'],
  handoff_case_created: ['INFO', 'handoff', 'HANDOFF_CREATED'],
  handoff_bot_suppressed: ['INFO', 'handoff', 'HANDOFF_BOT_SUPPRESSED'],
  handoff_human_claimed: ['INFO', 'handoff', 'HANDOFF_CLAIMED'],
  handoff_resolved: ['INFO', 'handoff', 'HANDOFF_RESOLVED'],
  handoff_duplicate_prevented: ['INFO', 'handoff', 'HANDOFF_DUPLICATE_PREVENTED'],
  handoff_case_creation_failed: ['HIGH', 'handoff', 'HANDOFF_CREATION_FAILED'],
  handoff_state_lookup_failed: ['HIGH', 'handoff', 'HANDOFF_LOOKUP_FAILED'],
  false_handoff_forwarded_claim: ['HIGH', 'handoff', 'FALSE_HANDOFF_FORWARDED'],
  handoff_case_stuck: ['WARNING', 'handoff', 'HANDOFF_STUCK'],
  ai_reply_during_handoff: ['CRITICAL', 'handoff', 'AI_REPLY_DURING_HANDOFF'],
  repetitive_generic_closing: ['WARNING', 'quality', 'REPETITIVE_CLOSING'],
  repeated_customer_name: ['WARNING', 'quality', 'REPEATED_CUSTOMER_NAME'],
  repeated_greeting: ['WARNING', 'quality', 'REPEATED_GREETING'],
  excessive_emoji: ['WARNING', 'quality', 'EXCESSIVE_EMOJI'],
  context_bleed: ['WARNING', 'quality', 'CONTEXT_BLEED'],
  unnecessary_booking_cta: ['WARNING', 'quality', 'UNNECESSARY_BOOKING_CTA'],
  response_too_long_for_simple_question: ['WARNING', 'quality', 'RESPONSE_TOO_LONG'],
  p0_identity_bypass: ['CRITICAL', 'inbound', 'P0_IDENTITY_BYPASS'],
  p0_guard_bypass: ['CRITICAL', 'outbound', 'P0_GUARD_BYPASS'],
  kill_switch_bypass: ['CRITICAL', 'outbound', 'KILL_SWITCH_BYPASS'],
  // Data Authority Repair Round 1 (DA-01 schedule overlap / DA-02 home-service
  // schema drift) — observer-only, same as every other family here: nothing
  // reads these to make a decision, they exist so a degraded/unresolved
  // data-authority state is visible in Task16's existing evaluation table
  // instead of only ever reaching a console.log.
  schedule_sync_conflict_reconciled: ['INFO', 'data_authority', 'SCHEDULE_CONFLICT_RECONCILED'],
  schedule_sync_overlap_failure: ['HIGH', 'data_authority', 'SCHEDULE_OVERLAP_FAILURE'],
  schedule_sync_conflict_unresolved: ['HIGH', 'data_authority', 'SCHEDULE_CONFLICT_UNRESOLVED'],
  schedule_authority_degraded: ['HIGH', 'data_authority', 'SCHEDULE_AUTHORITY_DEGRADED'],
  home_service_schema_mismatch: ['HIGH', 'data_authority', 'HOME_SERVICE_SCHEMA_MISMATCH'],
  // CRM Integrity Round 1 (customer identity authority) — observer-only,
  // same rationale as every other family here. Fired by
  // server/services/customerIdentityResolver.js. Ambiguous and duplicate
  // findings are HIGH because they represent exactly the production risk
  // this round exists to make visible (Reddy/CRM must never guess); a
  // resolved or not-found lookup is normal traffic (INFO).
  crm_identity_resolved: ['INFO', 'crm_identity', 'CRM_IDENTITY_RESOLVED'],
  crm_identity_not_found: ['INFO', 'crm_identity', 'CRM_IDENTITY_NOT_FOUND'],
  crm_identity_ambiguous: ['HIGH', 'crm_identity', 'CRM_IDENTITY_AMBIGUOUS'],
  crm_duplicate_identity_detected: ['HIGH', 'crm_identity', 'CRM_DUPLICATE_IDENTITY_DETECTED'],
  crm_identity_lookup_failed: ['HIGH', 'crm_identity', 'CRM_IDENTITY_LOOKUP_FAILED'],
  price_placeholder_blocked: ['HIGH', 'quality', 'PRICE_PLACEHOLDER_BLOCKED'],
  final_outbound_after_guards: ['INFO', 'outbound', 'FINAL_OUTBOUND_AFTER_GUARDS'],
  request_ack_without_fulfillment: ['WARNING', 'quality', 'REQUEST_ACK_WITHOUT_FULFILLMENT'],
  // SLA Observability (P1-F)
  handoff_sla_breached: ['HIGH', 'handoff', 'HANDOFF_SLA_BREACHED'],
  // Correction Round 2, Blocker 2 — subsystem telemetry distinct from
  // terminal inbound result. The orchestrator's own exception is caught in
  // handleMessage and the turn falls through to the legacy Reddy path, so
  // this event is observer-only: it records that the orchestrator degraded,
  // it does NOT by itself mean the customer's turn ended in FAILED (see
  // waInboundLifecycle.js / ALLOWED_INBOUND_LIFECYCLE_REASONS for the
  // terminal-reason side of this split).
  orchestrator_execution_failed: ['HIGH', 'routing', 'ORCHESTRATOR_EXECUTION_FAILED'],
});

const AUDIT_SOURCE_PROVENANCE = Object.freeze({
  KNOWLEDGE_STATIC: 'knowledge_static',
  DATABASE_BRANCH: 'database_branch',
  SCHEDULE_AUTHORITY: 'schedule_authority',
  ATTENDANCE_AUTHORITY: 'attendance_authority',
  BOOKING_AUTHORITY: 'booking_authority',
  UNKNOWN: 'unknown',
});

function classifyFactAuditProvenance(factName, sourceKey) {
  const sKey = String(sourceKey || '').toLowerCase();
  if (sKey.includes('knowledge') || sKey.includes('redbox_knowledge') || sKey.includes('static')) return AUDIT_SOURCE_PROVENANCE.KNOWLEDGE_STATIC;
  if (sKey.includes('schedule')) return AUDIT_SOURCE_PROVENANCE.SCHEDULE_AUTHORITY;
  if (sKey.includes('attendance')) return AUDIT_SOURCE_PROVENANCE.ATTENDANCE_AUTHORITY;
  if (sKey.includes('booking')) return AUDIT_SOURCE_PROVENANCE.BOOKING_AUTHORITY;
  if (sKey.includes('outlets') || sKey.includes('database') || sKey.includes('branch')) return AUDIT_SOURCE_PROVENANCE.DATABASE_BRANCH;
  return AUDIT_SOURCE_PROVENANCE.UNKNOWN;
}

let supabaseProvider = () => null;

function configureEvaluationMonitoring(provider) {
  supabaseProvider = typeof provider === 'function' ? provider : () => null;
}

function normalizeBranch(value) {
  const branch = String(value || '').trim().toLowerCase();
  return BRANCHES.has(branch) ? branch : 'unknown';
}

function bounded(value, max = 128) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

function safeHash(value, namespace) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (/^[a-f0-9]{64}$/i.test(text)) return text.toLowerCase();
  return crypto.createHash('sha256').update(`${namespace}:${text}`).digest('hex');
}

function sanitizeMetadata(metadata = {}) {
  const blocked = /token|secret|auth|authorization|api.?key|service.?role|phone|message|conversation|raw|text|content/i;
  const safe = {};
  for (const [key, value] of Object.entries(metadata || {}).slice(0, 24)) {
    if (blocked.test(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) safe[key] = value;
    else if (typeof value === 'string') safe[key] = value.slice(0, 128);
    else if (Array.isArray(value)) safe[key] = value.slice(0, 10).map((item) => String(item).slice(0, 64));
  }
  return safe;
}

function normalizeEvaluationEvent(event = {}) {
  const definition = EVENT_DEFINITIONS[event.event_type];
  if (!definition) return null;
  const [defaultSeverity, defaultSource, defaultIssue] = definition;
  const severity = Object.values(SEVERITIES).includes(event.severity) ? event.severity : defaultSeverity;
  return {
    event_type: event.event_type,
    severity,
    branch: normalizeBranch(event.branch),
    provider: bounded(event.provider || 'unknown', 32),
    intent: bounded(event.intent, 64),
    route: bounded(event.route, 64),
    issue_code: bounded(event.issue_code || defaultIssue, 64),
    source_layer: bounded(event.source_layer || defaultSource, 64),
    message_id: safeHash(event.message_id, 'evaluation-message'),
    conversation_id: safeHash(event.conversation_id, 'evaluation-conversation'),
    handoff_case_id: bounded(event.handoff_case_id, 64),
    metadata: sanitizeMetadata(event.metadata),
    created_at: event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString(),
  };
}

async function recordEvaluationEvent(event, deps = {}) {
  const normalized = normalizeEvaluationEvent(event);
  if (!normalized) return { status: 'ignored', event: null };
  let supabase = deps.supabase;
  try {
    if (supabase === undefined) supabase = supabaseProvider();
  } catch {
    return { status: 'unavailable', event: normalized };
  }
  if (!supabase) return { status: 'unavailable', event: normalized };
  try {
    const { error } = await supabase.from(TABLE).insert(normalized);
    if (error) return { status: 'error', event: normalized, error };
    return { status: 'recorded', event: normalized };
  } catch (error) {
    return { status: 'error', event: normalized, error };
  }
}

function mapTelemetryToEvaluation(family, telemetry = {}) {
  const common = { branch: telemetry.branch, provider: telemetry.provider, created_at: telemetry.timestamp };
  if (family === 'anti_spam') {
    if (telemetry.event_type === 'processing_failed' && telemetry.guard_reason === 'missing_provider_message_id') {
      return [{ ...common, event_type: 'missing_provider_message_id' }];
    }
    if (telemetry.event_type === 'processing_failed' && telemetry.guard_reason === 'missing_provider_device_id') {
      return [{ ...common, event_type: 'missing_stable_device' }];
    }
    const mapped = {
      inbound_event_claimed: 'inbound_event_claimed',
      inbound_duplicate_suppressed: 'inbound_duplicate_suppressed',
      non_customer_event_suppressed: 'unsupported_webhook_event',
      outbound_duplicate_suppressed: 'outbound_duplicate_suppressed',
      rate_limit_suppressed: 'outbound_rate_limited',
      outbound_send_attempt: 'outbound_send_attempt',
      outbound_sent: 'outbound_sent',
      ai_kill_switch_suppressed: 'outbound_kill_switch_suppressed',
      processing_failed: 'outbound_provider_error',
    }[telemetry.event_type];
    return mapped ? [{
      ...common,
      event_type: mapped,
      metadata: {
        reason: telemetry.guard_reason,
        device_hash: telemetry.device_hash,
        provider_id_present: telemetry.message_id_present,
        dedup_outcome: telemetry.idempotency_status,
      },
    }] : [];
  }
  if (family === 'handoff') {
    const eventType = telemetry.reason === 'handoff_state_lookup_failed'
      ? 'handoff_state_lookup_failed' : telemetry.event_type;
    return EVENT_DEFINITIONS[eventType]
      ? [{ ...common, event_type: eventType, metadata: { priority: telemetry.priority, trigger_type: telemetry.trigger_type } }]
      : [];
  }
  if (family === 'orchestrator') {
    const events = [{
      ...common,
      event_type: 'routing_decision',
      intent: telemetry.intent,
      route: telemetry.route,
      metadata: { agent: telemetry.agent, action: telemetry.action, execution_status: telemetry.execution_status },
    }];
    if (telemetry.route && telemetry.route !== 'unknown') events.push({ ...common, event_type: 'orchestrator_route_used', intent: telemetry.intent, route: telemetry.route });
    if (telemetry.route === 'human' || telemetry.agent === 'human') events.push({ ...common, event_type: 'human_route_recommended', intent: telemetry.intent, route: telemetry.route });
    if (telemetry.execution_status === 'bounded_response') events.push({ ...common, event_type: 'bounded_response_used', intent: telemetry.intent, route: telemetry.route });
    if (telemetry.action === 'keyword_shortcut') {
      events.push({ ...common, event_type: 'keyword_shortcut_used', intent: telemetry.intent, route: telemetry.route });
    }
    if (telemetry.crm_fact_status === 'unavailable') events.push({ ...common, event_type: 'crm_context_unavailable', intent: telemetry.intent, route: telemetry.route });
    else if (telemetry.crm_tool) events.push({ ...common, event_type: 'crm_context_loaded', intent: telemetry.intent, route: telemetry.route });
    if (telemetry.realtime_fact_guard_triggered) events.push({ ...common, event_type: 'barber_realtime_overclaim_detected', intent: telemetry.intent, route: telemetry.route });
    if (telemetry.guard_blocked_prohibited_claim) events.push({ ...common, event_type: 'booking_confirmation_claim_detected', intent: telemetry.intent, route: telemetry.route });
    return events;
  }
  if (family === 'data_authority') {
    return EVENT_DEFINITIONS[telemetry.event_type]
      ? [{ ...common, event_type: telemetry.event_type, metadata: { reason: telemetry.reason, source: telemetry.source } }]
      : [];
  }
  if (family === 'crm_identity') {
    return EVENT_DEFINITIONS[telemetry.event_type]
      ? [{
        ...common,
        event_type: telemetry.event_type,
        metadata: {
          source: telemetry.source,
          match_basis: telemetry.match_basis,
          candidates_count: telemetry.candidates_count,
          normalized_input_present: telemetry.normalized_input_present,
        },
      }]
      : [];
  }
  return [];
}

function observeTelemetry(family, telemetry, deps = {}) {
  const events = mapTelemetryToEvaluation(family, telemetry);
  for (const event of events) {
    Promise.resolve(recordEvaluationEvent(event, deps)).catch(() => {});
  }
  return events;
}

function evaluateOutboundMessage(message, context = {}) {
  const text = String(message || '');
  const lower = text.toLowerCase();
  const common = {
    branch: context.branch,
    provider: context.provider || 'fonnte',
    message_id: context.messageId,
    conversation_id: context.conversationId,
    handoff_case_id: context.handoffCaseId,
  };
  const events = [];
  const add = (event_type, metadata = {}) => events.push(normalizeEvaluationEvent({ ...common, event_type, metadata }));

  if (/booking\s+(sudah\s+)?(berhasil|terkonfirmasi|confirmed)/i.test(text)) add('booking_confirmation_claim_detected');
  if (/slot\s+(sudah\s+)?(diamankan|direservasi|reserved)/i.test(text)) add('slot_reserved_claim_detected');
  if (/(kapster|barber)\s+(sudah\s+)?(dikunci|di-lock|terkunci)/i.test(text)) add('barber_locked_claim_detected');
  if (/sudah\s+(aku\s+)?teruskan\s+ke\s+admin/i.test(text) && context.handoffPersisted === false) add('false_handoff_forwarded_claim');
  if (['waiting_human', 'human_active'].includes(context.handoffStatus)) add('ai_reply_during_handoff');

  const overclaim = /(ada|hadir|masuk|tersedia|standby)\s+(sekarang|hari ini)|sedang\s+(ada|hadir|masuk|standby)/i.test(text);
  if (overclaim && context.barberFactSource && !['attendance', 'booking_availability'].includes(context.barberFactSource)) {
    add('barber_realtime_overclaim_detected', { fact_source: context.barberFactSource || 'unknown' });
  }
  if (context.membershipClaimSupported === false && /\b(silver|gold|platinum|member|membership)\b/i.test(text)) add('membership_false_claim');
  if (context.customerHistoryClaimSupported === false && /\b(terakhir|riwayat|pernah)\b/i.test(text)) add('customer_history_false_claim');

  const bookingCta = /booking\.redboxbarbershop\.com|klik\s+link\s+booking|lanjut\s+booking|yuk\s+booking/i.test(text);
  if (bookingCta) add('booking_cta_sent');
  if (bookingCta && context.bookingCtaEligible === false) {
    add('unnecessary_booking_cta');
    add('booking_cta_context_bleed_detected');
  }
  if (/(ada yang bisa (aku|saya) bantu lagi|kalau ada yang mau ditanyakan|jangan ragu untuk bertanya)/i.test(text)) add('repetitive_generic_closing');
  const greetings = lower.match(/\b(hai|halo|selamat (pagi|siang|sore|malam))\b/g) || [];
  if (greetings.length > 1) add('repeated_greeting', { count: greetings.length });
  if (context.customerName) {
    const escaped = String(context.customerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = text.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || [];
    if (names.length > 2) add('repeated_customer_name', { count: names.length });
  }
  const emojis = text.match(/[\p{Extended_Pictographic}]/gu) || [];
  if (emojis.length > (context.serious ? 0 : 1)) add('excessive_emoji', { count: emojis.length });
  if (context.simpleQuestion && text.length > 500) add('response_too_long_for_simple_question', { length_bucket: '500_plus' });
  if (context.contextBleedDetected) add('context_bleed');
  return events.filter(Boolean);
}

async function observeOutboundMessage(message, context = {}, deps = {}) {
  const events = evaluateOutboundMessage(message, context);
  for (const event of events) await recordEvaluationEvent(event, deps).catch(() => ({ status: 'error' }));
  return events;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function aggregateHealth(events = [], filters = {}, thresholds = DEFAULT_THRESHOLDS) {
  const fromMs = filters.from ? new Date(filters.from).getTime() : -Infinity;
  const toMs = filters.to ? new Date(filters.to).getTime() : Infinity;
  const requestedBranch = filters.branch ? normalizeBranch(filters.branch) : null;
  const selected = events.filter((event) => {
    const time = new Date(event.created_at).getTime();
    return time >= fromMs && time <= toMs && (!requestedBranch || normalizeBranch(event.branch) === requestedBranch);
  });
  const count = (type) => selected.filter((event) => event.event_type === type).length;
  const totalInbound = count('inbound_event_claimed');
  const totalOutbound = count('outbound_sent');
  const routingDistribution = {};
  for (const event of selected.filter((item) => item.event_type === 'routing_decision')) {
    const key = event.intent || 'unknown';
    routingDistribution[key] = (routingDistribution[key] || 0) + 1;
  }
  const issueCounts = new Map();
  for (const event of selected.filter((item) => item.severity !== 'INFO')) {
    const key = event.issue_code || event.event_type;
    issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
  }
  const totals = {
    total_inbound: totalInbound,
    total_automated_outbound: totalOutbound,
    duplicate_inbound_suppression_rate: rate(count('inbound_duplicate_suppressed'), totalInbound + count('inbound_duplicate_suppressed')),
    duplicate_outbound_suppression_rate: rate(count('outbound_duplicate_suppressed'), totalOutbound + count('outbound_duplicate_suppressed')),
    provider_error_rate: rate(count('outbound_provider_error'), totalOutbound + count('outbound_provider_error')),
    routing_distribution: routingDistribution,
    keyword_shortcut_rate: rate(count('keyword_shortcut_used'), count('routing_decision')),
    human_handoff_rate: rate(count('handoff_case_created'), totalInbound),
    handoff_failure_rate: rate(count('handoff_case_creation_failed'), count('handoff_requested') + count('handoff_case_created')),
    crm_truth_warning_count: count('crm_context_bleed') + count('customer_history_false_claim'),
    membership_false_claim_count: count('membership_false_claim') + count('synthetic_membership_status'),
    barber_realtime_overclaim_count: count('barber_realtime_overclaim_detected'),
    booking_safety_violation_count: count('booking_confirmation_claim_detected') + count('slot_reserved_claim_detected') + count('barber_locked_claim_detected') + count('booking_execution_attempted'),
    context_bleed_count: count('context_bleed') + count('booking_cta_context_bleed_detected') + count('crm_context_bleed'),
    repetitive_closing_count: count('repetitive_generic_closing'),
    kill_switch_suppression_count: count('outbound_kill_switch_suppressed'),
  };

  const branches = [...BRANCHES].map((branch) => {
    const branchEvents = selected.filter((event) => normalizeBranch(event.branch) === branch);
    const branchCount = (type) => branchEvents.filter((event) => event.event_type === type).length;
    const inbound = branchCount('inbound_event_claimed');
    const providerErrors = branchCount('outbound_provider_error');
    const critical = branchEvents.filter((event) => event.severity === 'CRITICAL').length;
    const high = branchEvents.filter((event) => event.severity === 'HIGH').length;
    return {
      branch,
      health: critical ? 'critical' : (high
        || providerErrors >= thresholds.providerFailuresHigh
        || branchCount('handoff_case_creation_failed') >= thresholds.handoffFailuresHigh
        ? 'warning' : 'healthy'),
      inbound,
      outbound: branchCount('outbound_sent'),
      provider_errors: providerErrors,
      handoff_failures: branchCount('handoff_case_creation_failed'),
      high_severity_events: high,
      critical_events: critical,
      error_rate: rate(providerErrors, inbound),
    };
  }).filter((branch) => branch.inbound || branch.outbound || branch.provider_errors || branch.high_severity_events || branch.critical_events || requestedBranch === branch.branch);

  const criticalCount = selected.filter((event) => event.severity === 'CRITICAL').length;
  const highCount = selected.filter((event) => event.severity === 'HIGH').length;
  const warningCount = selected.filter((event) => event.severity === 'WARNING').length;
  const thresholdWarning = totals.duplicate_outbound_suppression_rate >= thresholds.duplicateContentWarningRate
    || totals.keyword_shortcut_rate >= thresholds.keywordShortcutWarningRate
    || totals.repetitive_closing_count >= thresholds.repetitiveClosingWarningCount;
  return {
    status: criticalCount ? 'critical' : (highCount || warningCount || thresholdWarning ? 'warning' : 'healthy'),
    period: { from: filters.from || null, to: filters.to || null },
    totals,
    branches,
    top_issues: [...issueCounts.entries()].map(([issue_code, total]) => ({ issue_code, total }))
      .sort((a, b) => b.total - a.total || a.issue_code.localeCompare(b.issue_code)).slice(0, 10),
    severity: { info: selected.length - criticalCount - highCount - warningCount, warning: warningCount, high: highCount, critical: criticalCount },
    thresholds,
  };
}

async function getHealthSummary({ supabase, from, to, branch = null, pageSize = HEALTH_QUERY_PAGE_SIZE, thresholds = DEFAULT_THRESHOLDS }) {
  if (!supabase) return { status: 'unavailable', summary: null };
  try {
    const effectivePageSize = Math.max(1, Math.min(HEALTH_QUERY_PAGE_SIZE, Number(pageSize) || HEALTH_QUERY_PAGE_SIZE));
    const events = [];
    let offset = 0;
    while (true) {
      let query = supabase.from(TABLE).select('*').gte('created_at', from).lte('created_at', to);
      if (branch) query = query.eq('branch', normalizeBranch(branch));
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + effectivePageSize - 1);
      if (error) return { status: 'error', summary: null, error };
      const page = Array.isArray(data) ? data : [];
      events.push(...page);
      if (page.length < effectivePageSize) break;
      offset += page.length;
    }
    return { status: 'ok', summary: aggregateHealth(events, { from, to, branch }, thresholds) };
  } catch (error) {
    return { status: 'error', summary: null, error };
  }
}

function detectStuckHandoffCases(cases = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS) {
  const cutoff = now.getTime() - thresholds.stuckHandoffMinutes * 60 * 1000;
  return cases.filter((item) => ['waiting_human', 'human_active'].includes(item.status)
      && new Date(item.updated_at || item.created_at).getTime() <= cutoff)
    .map((item) => normalizeEvaluationEvent({
      event_type: 'handoff_case_stuck', branch: item.branch, handoff_case_id: item.id,
      metadata: { status: item.status, threshold_minutes: thresholds.stuckHandoffMinutes },
    }));
}

module.exports = {
  TABLE,
  HEALTH_QUERY_PAGE_SIZE,
  SEVERITIES,
  BRANCHES,
  EVENT_DEFINITIONS,
  DEFAULT_THRESHOLDS,
  configureEvaluationMonitoring,
  normalizeBranch,
  sanitizeMetadata,
  normalizeEvaluationEvent,
  recordEvaluationEvent,
  mapTelemetryToEvaluation,
  observeTelemetry,
  evaluateOutboundMessage,
  observeOutboundMessage,
  aggregateHealth,
  getHealthSummary,
  detectStuckHandoffCases,
  AUDIT_SOURCE_PROVENANCE,
  classifyFactAuditProvenance,
};
