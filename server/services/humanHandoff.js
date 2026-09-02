'use strict';

/**
 * Redbox Human Handoff Runtime v0.1 (Task 15)
 *
 * State machine: AI_ACTIVE -> HANDOFF_REQUESTED -> WAITING_HUMAN -> HUMAN_ACTIVE -> RESOLVED.
 * HANDOFF_REQUESTED is a transient decision, not a persisted row: a case only
 * exists once persistence to human_handoff_cases actually succeeds, at which
 * point it starts at 'waiting_human'.
 *
 * This module is the Human Takeover State Authority (see orchestrator/contract.js
 * and orchestratorService.js — the orchestrator may only RECOMMEND a handoff via
 * route:'human'; this module's persisted case status is what actually gates Reddy).
 */

const OPEN_STATUSES = Object.freeze(['requested', 'waiting_human', 'human_active']);
const SUPPRESSED_STATUSES = Object.freeze(['waiting_human', 'human_active']);

const TRIGGER_TYPES = Object.freeze({
  EXPLICIT: 'explicit_customer_request',
  POLICY: 'policy_escalation',
});

const PRIORITIES = Object.freeze({ NORMAL: 'normal', HIGH: 'high', URGENT: 'urgent' });

const UNIQUE_VIOLATION = '23505';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Reads the orchestrator's routing recommendation and classifies it into a
 * handoff trigger. The orchestrator's route:'human' outcome (see
 * orchestrator/contract.js ROUTES.complaint / ROUTES.human_request) is a
 * RECOMMENDATION only — this function decides what kind of case to open,
 * never whether Reddy is allowed to keep speaking (that is the caller's job,
 * driven by persisted case status).
 */
function detectHandoffTrigger({ orchestrationDecision } = {}) {
  const intent = orchestrationDecision?.intent || null;
  const isHumanRoute = orchestrationDecision
    && (orchestrationDecision.route === 'human' || orchestrationDecision.agent === 'human');
  if (!isHumanRoute && intent !== 'human_request' && intent !== 'complaint') return null;

  if (intent === 'human_request') {
    return { triggerType: TRIGGER_TYPES.EXPLICIT, reason: 'customer_requested_human', intent };
  }
  return {
    triggerType: TRIGGER_TYPES.POLICY,
    reason: intent === 'complaint' ? 'complaint_escalation' : 'policy_escalation',
    intent: intent || 'unknown',
  };
}

/**
 * Simple, deterministic priority mapping (no ML scoring — see spec §16).
 */
function computeHandoffPriority({ triggerType, intent, text } = {}) {
  const lower = String(text || '').toLowerCase();
  const urgentSignal = /\b(bahaya|cedera|terluka|luka\s*parah|kecelakaan|darurat|emergency|gawat)\b/.test(lower);
  if (urgentSignal) return PRIORITIES.URGENT;

  const paymentSignal = /\b(refund|dispute|sengketa|salah\s*(bayar|charge)|(bayar|charge).*(dua\s*kali|double)|uang.*(belum|tidak).*kembali)\b/.test(lower);
  if (paymentSignal || intent === 'complaint') return PRIORITIES.HIGH;

  if (triggerType === TRIGGER_TYPES.EXPLICIT) return PRIORITIES.NORMAL;
  return PRIORITIES.NORMAL;
}

/**
 * Builds a short, operational handoff summary for the human agent. Deliberately
 * NOT LLM-generated for v1: every line is either a literal quote of what the
 * customer said or a fact this module can actually verify, so it can never
 * silently overwrite/outrank canonical CRM or booking facts (see spec §7-8).
 */
function buildConversationSummary({ text, bookingContext, customerIntelligence } = {}) {
  const lines = [];
  const trimmedText = String(text || '').trim().slice(0, 300);
  if (trimmedText) lines.push(`customer says: ${trimmedText}`);

  if (bookingContext && bookingContext.booking_readiness && bookingContext.booking_readiness !== 'exploring') {
    const parts = [`readiness=${bookingContext.booking_readiness}`];
    if (bookingContext.branch?.value) parts.push(`branch=${bookingContext.branch.value}`);
    if (bookingContext.service?.name) parts.push(`service=${bookingContext.service.name}`);
    if (bookingContext.date?.value) parts.push(`date=${bookingContext.date.value}`);
    lines.push(`system verified (booking context, not a reservation): ${parts.join(', ')}`);
  }

  if (customerIntelligence?.facts?.name || customerIntelligence?.customer?.name) {
    lines.push('system verified: customer has a matched CRM profile');
  }

  lines.push('unknown: any detail not listed above has not been verified');
  return lines.join('\n');
}

async function findActiveCaseRow(supabase, customerPhone) {
  const { data, error } = await supabase
    .from('human_handoff_cases')
    .select('*')
    .eq('customer_phone', normalizePhone(customerPhone))
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Creates a new waiting_human case, or returns the existing open case for this
 * customer unchanged in status (duplicate-case protection — spec §15). A unique
 * index on (customer_phone) WHERE status is open enforces this at the DB level
 * too, so a race between two concurrent messages still converges on one case.
 */
async function createOrGetActiveCase(params = {}, deps = {}) {
  const { supabase = null } = deps;
  const {
    customerPhone, customerId = null, channel = 'whatsapp', branch = null,
    triggerType, reason, intent = null, priority = PRIORITIES.NORMAL,
    conversationSummary = null, latestCustomerMessage = null, bookingReference = null,
  } = params;

  if (!supabase) return { status: 'unavailable', case: null, created: false };
  const phone = normalizePhone(customerPhone);
  if (!phone) return { status: 'unavailable', case: null, created: false };

  try {
    const existing = await findActiveCaseRow(supabase, phone);
    if (existing) {
      const { data, error } = await supabase
        .from('human_handoff_cases')
        .update({ latest_customer_message: latestCustomerMessage, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return { status: 'existing', case: data || existing, created: false };
    }

    const { data, error } = await supabase
      .from('human_handoff_cases')
      .insert({
        customer_id: customerId,
        customer_phone: phone,
        channel,
        branch,
        reason,
        trigger_type: triggerType,
        intent,
        priority,
        conversation_summary: conversationSummary,
        latest_customer_message: latestCustomerMessage,
        booking_reference: bookingReference,
        status: 'waiting_human',
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const raced = await findActiveCaseRow(supabase, phone);
        if (raced) return { status: 'existing', case: raced, created: false };
      }
      throw error;
    }
    return { status: 'created', case: data, created: true };
  } catch (error) {
    return { status: 'error', case: null, created: false, error };
  }
}

/**
 * The runtime gate (spec §9). Called on every inbound message before the
 * orchestrator/Reddy/OpenAI are reached. Fails SAFE: a genuine lookup error
 * (supabase configured but the query throws/times out) suppresses Reddy rather
 * than risk talking over an active human conversation. Supabase simply not
 * being configured for this environment is a different, expected state (no
 * handoff case system provisioned here) and does not suppress — this keeps
 * local/test environments and the pre-Task-15 unconfigured deployments working
 * exactly as before.
 */
async function getActiveHandoffState(customerPhone, deps = {}) {
  const { supabase = null } = deps;
  if (!supabase) return { status: 'none', case: null };

  const phone = normalizePhone(customerPhone);
  if (!phone) return { status: 'none', case: null };

  try {
    const row = await findActiveCaseRow(supabase, phone);
    if (!row) return { status: 'none', case: null };
    if (SUPPRESSED_STATUSES.includes(row.status)) return { status: row.status, case: row };
    return { status: 'none', case: row }; // e.g. 'requested' — not persisted in v1, kept for schema forward-compat
  } catch (_error) {
    return { status: 'lookup_failed', case: null };
  }
}

async function appendCustomerMessage(caseId, message, deps = {}) {
  const { supabase = null } = deps;
  if (!supabase || !caseId) return false;
  try {
    await supabase
      .from('human_handoff_cases')
      .update({ latest_customer_message: String(message || '').slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('id', caseId);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * branchScope enforces Correction Round 1 / Blocker 2's branch authority
 * model at the query itself (fail closed), never by fetching globally and
 * filtering afterward: undefined/null means unrestricted (owner, or a
 * manager with no branch assigned); a branch string restricts the update to
 * exactly that branch (branch_admin, or a branch-assigned manager), so a
 * case belonging to a different branch simply does not match and the update
 * returns zero rows — same observable outcome as "not claimable"/"not
 * resolvable", never a 500 or a leak of another branch's case.
 */
async function claimCase(caseId, assignedTo, deps = {}) {
  const { supabase = null, branchScope = null } = deps;
  if (!supabase) return { status: 'unavailable', case: null };
  try {
    let query = supabase
      .from('human_handoff_cases')
      .update({ status: 'human_active', assigned_to: assignedTo, updated_at: new Date().toISOString() })
      .eq('id', caseId)
      .eq('status', 'waiting_human');
    if (branchScope) query = query.eq('branch', branchScope);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) return { status: 'not_claimable', case: null };
    return { status: 'claimed', case: data };
  } catch (error) {
    return { status: 'error', case: null, error };
  }
}

async function resolveCase(caseId, deps = {}) {
  const { supabase = null, branchScope = null } = deps;
  if (!supabase) return { status: 'unavailable', case: null };
  try {
    const nowIso = new Date().toISOString();
    let query = supabase
      .from('human_handoff_cases')
      .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', caseId)
      .in('status', SUPPRESSED_STATUSES);
    if (branchScope) query = query.eq('branch', branchScope);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) return { status: 'not_resolvable', case: null };
    return { status: 'resolved', case: data };
  } catch (error) {
    return { status: 'error', case: null, error };
  }
}

/**
 * Deterministic business priority order (Correction Round 1, Correction 3):
 * urgent, then high, then normal, each oldest-first. `priority` is a TEXT
 * enum, so ordering by it directly is lexical ('high' < 'normal' < 'urgent')
 * and does NOT produce the required order — priority_rank is a generated
 * column (see the Task 15 migration) that maps urgent=0, high=1, normal=2
 * specifically so this can be a plain, index-backed ORDER BY.
 */
async function listWaitingCases(deps = {}) {
  const { supabase = null, limit = 50, branchScope = null } = deps;
  if (!supabase) return [];
  try {
    let query = supabase
      .from('human_handoff_cases')
      .select('*')
      .eq('status', 'waiting_human');
    if (branchScope) query = query.eq('branch', branchScope);
    const { data } = await query
      .order('priority_rank', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit);

    const cases = data || [];
    evaluateAndRecordHandoffSLA(cases, deps);
    return cases;
  } catch (_error) {
    return [];
  }
}

/**
 * Operational SLA Observability (P1-F).
 * Inspects waiting/active handoff cases, checks aging threshold without auto-resolving,
 * and emits telemetry events for SLA breaches.
 */
function evaluateCaseSLA(handoffCase, nowMs = Date.now()) {
  if (!handoffCase || !handoffCase.created_at) return null;
  const createdAtMs = new Date(handoffCase.created_at).getTime();
  if (isNaN(createdAtMs)) return null;

  const ageMinutes = Math.floor((nowMs - createdAtMs) / 60000);
  const priority = String(handoffCase.priority || 'normal').toLowerCase();

  let severity = null;
  let ageBucket = null;

  if (priority === PRIORITIES.URGENT) {
    if (ageMinutes >= 10) {
      severity = 'CRITICAL';
      ageBucket = ageMinutes >= 60 ? '>1h' : '10m-1h';
    }
  } else if (priority === PRIORITIES.HIGH) {
    if (ageMinutes >= 30) {
      severity = 'HIGH';
      ageBucket = ageMinutes >= 120 ? '>2h' : '30m-2h';
    }
  } else {
    // Normal priority
    if (ageMinutes >= 120) {
      severity = 'HIGH';
      ageBucket = '>2h';
    } else if (ageMinutes >= 30) {
      severity = 'WARNING';
      ageBucket = '30m-2h';
    }
  }

  if (!severity) return null;

  return {
    case_id: handoffCase.id,
    branch: handoffCase.branch || 'unknown',
    priority,
    severity,
    age_minutes: ageMinutes,
    age_bucket: ageBucket,
  };
}

const recordedSlaBreaches = new Set();

/**
 * Evaluates SLA for cases and records telemetry with age-bucket deduplication.
 */
function evaluateAndRecordHandoffSLA(cases = [], deps = {}) {
  const { recordEvaluationEvent } = require('./reddyEvaluationMonitoring');
  const results = [];
  const caseList = Array.isArray(cases) ? cases : [cases];

  for (const item of caseList) {
    const sla = evaluateCaseSLA(item);
    if (!sla) continue;

    const dedupKey = `${sla.case_id}:${sla.age_bucket}`;
    if (recordedSlaBreaches.has(dedupKey)) continue;

    recordedSlaBreaches.add(dedupKey);
    results.push(sla);

    Promise.resolve(recordEvaluationEvent({
      event_type: 'handoff_sla_breached',
      severity: sla.severity,
      branch: sla.branch,
      handoff_case_id: sla.case_id,
      metadata: {
        priority: sla.priority,
        age_minutes: sla.age_minutes,
        age_bucket: sla.age_bucket,
      },
    }, deps)).catch(() => {});
  }

  return results;
}

module.exports = {
  OPEN_STATUSES,
  SUPPRESSED_STATUSES,
  TRIGGER_TYPES,
  PRIORITIES,
  normalizePhone,
  detectHandoffTrigger,
  computeHandoffPriority,
  buildConversationSummary,
  createOrGetActiveCase,
  getActiveHandoffState,
  appendCustomerMessage,
  claimCase,
  resolveCase,
  listWaitingCases,
  evaluateCaseSLA,
  evaluateAndRecordHandoffSLA,
  recordedSlaBreaches,
};
