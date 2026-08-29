'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');
const { serializeKnowledgeForPrompt } = require('./knowledge/knowledgeContext');
const { loadCanonicalBarbers, resolveCanonicalBarber } = require('../../services/canonicalBarberResolver');
const { getBarberScheduleStatus } = require('../../services/barberScheduleAuthority');
const {
  extractBookingContext, buildPrefilledBookingUrl, reconstructBookingContextFromTurns, resolveRelativeDate,
} = require('./bookingContext');
const { guardReddyReply, suppressUnsolicitedBookingCta, REDDY_BOOKING_EXECUTION } = require('./bookingGuards');
const { guardRealtimeBarberFacts } = require('./realtimeFactGuard');
const { stripGenericClosingQuestion } = require('./closingSuppressionGuard');
const { deriveBookingEligibility } = require('./bookingEligibility');
const { logOrchestratedEvent } = require('../../orchestrator/telemetry');

// Task orchestratorService.buildDecisionEnvelope already decided, upstream,
// whether this turn is a customer-reported booking completion ("sudah kak",
// "udah booking di web"). Reddy must acknowledge naturally but must NEVER
// claim a backend-confirmed booking or repeat the booking CTA — the safest
// way to guarantee both is a single deterministic reply that bypasses the
// LLM (and therefore also bypasses guardReddyReply's prohibited-claim regex,
// which cannot distinguish "Reddy claims it booked" from "customer says they
// already booked" and was the actual source of the original bug).
const BOOKING_COMPLETION_ACK_REPLY =
  'Sip Kak, kalau sudah selesai booking di website berarti tinggal datang sesuai jadwal yang dipilih ya.';

// A barber presence/schedule question ("Mas Opan masuk hari ini?") needs a
// temporal-today/specific-day marker plus a presence/attendance verb — this
// is intentionally independent of bookingEligibility.js's signals, since
// "is this barber working today" is a real-time FACT question, not a
// booking-journey question (it must not grant CTA eligibility, and it needs
// canonical barbers loaded even on turns booking memory wouldn't load them for).
const REALTIME_BARBER_QUERY_VERB_PATTERN = /\b(masuk|kerja|hadir|ada|tersedia|standby|bertugas)\b/i;
const REALTIME_BARBER_QUERY_TIME_PATTERN = /\bhari\s*ini\b|\bsekarang\b|\bbesok\b|\blusa\b/i;

/**
 * Redbox Reddy Execution Adapter v0.1
 * Adapts AI Orchestrator route decision ("reddy_agent") to existing Reddy conversation execution.
 */

async function executeReddyAgent(params = {}, dependencies = {}) {
  const {
    from,
    name,
    text,
    branch = 'bypass',
    knowledgeContext = null,
    customerIntelligence = null,
    conversationContext = null,
    orchestrationDecision = null,
  } = params;
  const {
    callOpenAI,
    sendWA,
    supabase = null,
    loadBarbers = loadCanonicalBarbers,
    getSchedule = getBarberScheduleStatus,
    logBookingTelemetry = logOrchestratedEvent,
    persistConversation = null,
  } = dependencies;

  if (!callOpenAI || typeof callOpenAI !== 'function') {
    throw new Error('callOpenAI dependency function required for Reddy execution');
  }

  let factsContext = null;
  if (customerIntelligence) {
    factsContext = buildCustomerFactsContext(customerIntelligence);
  }

  let knowledgeFactsContext = knowledgeContext?.knowledgeFactsContext || null;
  if (!knowledgeFactsContext && knowledgeContext) {
    if (typeof knowledgeContext === 'string') {
      knowledgeFactsContext = knowledgeContext;
    } else {
      knowledgeFactsContext = serializeKnowledgeForPrompt(knowledgeContext);
    }
  }

  let reply;
  let used = 'reddy_agent';
  let error = null;

  // Verified CRM name source: derive ONLY from customerIntelligence facts or customer entity
  const verifiedCrmName = customerIntelligence?.facts?.name || customerIntelligence?.customer?.name || null;

  // Task 14.1 correction round 2: booking MEMORY, booking RESPONSE authority,
  // and booking CTA authority are three genuinely different, separately
  // computed questions — see bookingEligibility.js for the exact rules.
  // Booking-adjacent VOCABULARY (barber, kapster, jam, besok...) alone is
  // deliberately NOT enough for response/CTA eligibility; it only feeds the
  // (intentionally broad) memory layer.
  const {
    memoryRelevant: bookingMemoryRelevant,
    responseEligible: bookingResponseEligible,
    ctaEligible: bookingCtaEligible,
    reason: bookingEligibilityReason,
  } = deriveBookingEligibility({ text, orchestrationDecision });

  const isBookingCompletionReport = orchestrationDecision?.conversational_act === 'booking_completion_report';

  if (isBookingCompletionReport) {
    const completionReply = BOOKING_COMPLETION_ACK_REPLY;

    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_completion_acknowledged',
      branch,
      trust_status: 'unverified',
      execution_status: 'acknowledged',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });

    if (persistConversation && typeof persistConversation === 'function') {
      await persistConversation(from, conversationContext?.turns || [], text, completionReply);
    }

    let completionSendResult = null;
    if (sendWA && typeof sendWA === 'function') {
      completionSendResult = await sendWA(from, completionReply, { branch });
    }

    return { used: 'reddy_agent', reply: completionReply, sendResult: completionSendResult, error: null };
  }

  const realtimeBarberQuerySignal = REALTIME_BARBER_QUERY_VERB_PATTERN.test(String(text || ''))
    && REALTIME_BARBER_QUERY_TIME_PATTERN.test(String(text || ''));

  const canonicalBarberSource = (bookingMemoryRelevant || realtimeBarberQuerySignal)
    ? await loadBarbers(supabase)
    : { status: 'not_requested', barbers: [], reason: null };

  // Task 14.1 correction round 2 (Blocker 3): registered-at-branch (roster),
  // scheduled-today (barber_working_hours + barber_date_overrides via
  // getBarberScheduleStatus), present-now (attendance — no source exists),
  // and available-for-a-slot are four separate authorities. Only the first
  // two are ever fetched here; the real-time fact guard below never lets a
  // reply upgrade "scheduled" into "present"/"attending" regardless.
  let verifiedSchedule = null;
  if (realtimeBarberQuerySignal && supabase) {
    const scheduleBarberMatch = resolveCanonicalBarber(text, canonicalBarberSource?.barbers || [], null);
    const scheduleDate = resolveRelativeDate(text) || resolveRelativeDate('hari ini');
    if (scheduleBarberMatch.status === 'verified' && scheduleDate?.date) {
      const scheduleStatus = await getSchedule(supabase, {
        barberId: scheduleBarberMatch.barber.id,
        date: scheduleDate.date,
      });
      if (scheduleStatus && scheduleStatus.status !== 'unknown') {
        verifiedSchedule = {
          barberName: scheduleBarberMatch.barber.name,
          status: scheduleStatus.status,
          date: scheduleStatus.date,
        };
      }
    }
  }
  // booking_context is never persisted to storage (only raw {role, content} turns
  // are) — so the prior turn's structured preferences are reconstructed statelessly
  // from recent customer turns each request, respecting the existing session policy.
  const priorBookingContext = bookingMemoryRelevant
    ? reconstructBookingContextFromTurns(conversationContext?.turns || [], {
      sessionStatus: conversationContext?.sessionStatus,
      canonicalBarbers: canonicalBarberSource?.barbers || [],
    })
    : null;
  const bookingContext = bookingMemoryRelevant
    ? extractBookingContext(text, priorBookingContext, {
      canonicalBarbers: canonicalBarberSource?.barbers || [],
    })
    : null;
  // handoff_url is computed for the deterministic guard/sanitizer below even on
  // an ineligible turn (guardReddyReply still needs a real URL to redirect a
  // false booking claim to), but it is NEVER placed where the LLM can see it
  // unless bookingCtaEligible — see boundedConversationContext below.
  const handoffUrl = buildPrefilledBookingUrl(bookingContext);

  const boundedConversationContext = {
    ...(conversationContext && typeof conversationContext === 'object' ? conversationContext : {
      turns: [],
      turn_count: 0,
      history_status: 'empty',
      sessionStatus: 'expired',
    }),
    ...(orchestrationDecision && typeof orchestrationDecision === 'object' ? {
      orchestrator_decision: {
        intent: orchestrationDecision.intent || 'unknown',
        conversational_act: orchestrationDecision.conversational_act || 'unknown',
        continuation_type: orchestrationDecision.continuation_type || 'none',
        context_reference: orchestrationDecision.context_reference || null,
        route: orchestrationDecision.route || 'reddy_agent',
        required_sources: Array.isArray(orchestrationDecision.required_sources) ? orchestrationDecision.required_sources : [],
        allowed_claims: Array.isArray(orchestrationDecision.allowed_claims) ? orchestrationDecision.allowed_claims : [],
        prohibited_claims: Array.isArray(orchestrationDecision.prohibited_claims) ? orchestrationDecision.prohibited_claims : [],
        clarification_required: Boolean(orchestrationDecision.clarification_required),
        session_behavior: orchestrationDecision.session_behavior || 'continue',
        response_strategy: orchestrationDecision.response_strategy || 'answer_directly',
      },
    } : {}),
    // booking_context (memory) may still be attached even when the CTA is not
    // eligible — it lets Reddy correctly say things like "kalau nanti mau
    // lanjut booking di Bypass" in passing without granting a URL/CTA.
    ...(bookingContext ? { booking_context: bookingContext } : {}),
    ...(verifiedSchedule ? { barber_schedule_status: verifiedSchedule } : {}),
    ...(bookingCtaEligible ? {
      booking_authority: {
        whatsapp_mode: 'assist_and_guide_only',
        execution: REDDY_BOOKING_EXECUTION,
        reservation_authority: 'website_booking_system',
        handoff_url: handoffUrl,
        canonical_barber_source_status: canonicalBarberSource?.status || 'unavailable',
      },
    } : {}),
    reply_persistence_deferred: true,
  };

  try {
    if (knowledgeFactsContext) {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, knowledgeFactsContext, factsContext, boundedConversationContext);
    } else {
      reply = await callOpenAI(from, text, verifiedCrmName, branch, null, factsContext, boundedConversationContext);
    }
  } catch (err) {
    throw err;
  }

  // Deterministic outbound safeguard (Task 14.1 correction): prompt-only
  // "use the URL only if relevant" already proved insufficient in production.
  // Runs BEFORE guardReddyReply so a legitimate booking-claim redirect (which
  // always includes the URL, and only fires when the turn IS booking-relevant)
  // is never itself mistaken for an unsolicited CTA.
  const ctaSanitized = suppressUnsolicitedBookingCta(reply, { bookingCtaEligible });
  reply = ctaSanitized.sanitizedReply;
  if (ctaSanitized.ctaSuppressed) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_cta_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  // Task 14.1 correction round 2 (Blocker 2): guardReddyReply's OWN safe
  // corrections used to always embed the booking URL, even when the turn had
  // already been determined CTA-ineligible — reintroducing exactly what the
  // sanitizer above had just removed. bookingCtaEligible is now threaded
  // through so the correction text itself never contains a URL on an
  // ineligible turn.
  const guarded = guardReddyReply(reply, {
    isBackendVerified: false,
    bookingUrl: handoffUrl,
    bookingCtaEligible,
  });
  reply = guarded.sanitizedReply;

  if (guarded.blockedProhibitedClaim || guarded.blockedUnverifiedAvailability) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_reply_guard',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      guard_blocked_prohibited_claim: guarded.blockedProhibitedClaim,
      guard_blocked_unverified_availability: guarded.blockedUnverifiedAvailability,
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  // Deterministic real-time barber fact guard (Task 14.1 correction round 2,
  // Blocker 3): prompt-only instructions already failed once in production.
  // Runs regardless of whether a schedule lookup happened this turn — an
  // unsupported presence/attendance claim must be caught even if the model
  // produces one unprompted (e.g. the customer's phrasing didn't trigger
  // realtimeBarberQuerySignal, or the model just hallucinates one anyway).
  const realtimeGuarded = guardRealtimeBarberFacts(reply, { verifiedSchedule });
  reply = realtimeGuarded.sanitizedReply;
  if (realtimeGuarded.triggered) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'realtime_fact_guard',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      realtime_fact_guard_triggered: true,
    });
  }

  // Conversation lifecycle: normal replies must not append a generic closing
  // question — the idle-timeout cron, not the LLM on every turn, controls
  // when a conversation ends (see conversationLifecycle.js). Prompt-only
  // instructions already proved insufficient elsewhere in this codebase
  // (guardReddyReply's own history), so this is a deterministic safety net,
  // not the only defense. A genuine task-advancing clarification question is
  // never matched by these patterns and survives untouched.
  const closingGuarded = stripGenericClosingQuestion(reply);
  reply = closingGuarded.sanitizedReply;
  if (closingGuarded.closingStripped) {
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'generic_closing_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
    });
  }

  // Final-send invariant (Task 14.1 correction round 2): whatever guard ran
  // above, or however many of them, the literal string that reaches sendWA
  // must never carry a booking URL on an ineligible turn. Runs a second,
  // idempotent pass immediately before send/persist rather than trusting the
  // upstream guards to have been exhaustive — cheap when there's nothing left
  // to strip, and closes the door on any future guard/branch that reintroduces
  // a URL the way guardReddyReply's own corrections just did.
  const finalSanitized = suppressUnsolicitedBookingCta(reply, { bookingCtaEligible });
  if (finalSanitized.ctaSuppressed) {
    reply = finalSanitized.sanitizedReply;
    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_cta_suppressed',
      branch,
      trust_status: 'unverified',
      execution_status: 'guarded',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });
  }

  if (persistConversation && typeof persistConversation === 'function') {
    await persistConversation(from, boundedConversationContext.turns || [], text, reply);
  }

  let sendResult = null;
  if (sendWA && typeof sendWA === 'function') {
    sendResult = await sendWA(from, reply, { branch });
  }

  return {
    used,
    reply,
    sendResult,
    error,
  };
}

module.exports = { executeReddyAgent };
