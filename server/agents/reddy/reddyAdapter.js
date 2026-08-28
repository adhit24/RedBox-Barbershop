'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');
const { serializeKnowledgeForPrompt } = require('./knowledge/knowledgeContext');
const { loadCanonicalBarbers } = require('../../services/canonicalBarberResolver');
const { extractBookingContext, buildPrefilledBookingUrl, reconstructBookingContextFromTurns } = require('./bookingContext');
const { guardReddyReply, suppressUnsolicitedBookingCta, REDDY_BOOKING_EXECUTION } = require('./bookingGuards');
const { logOrchestratedEvent } = require('../../orchestrator/telemetry');

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

  // Task 14.1 correction: booking MEMORY, booking RESPONSE authority, and
  // booking CTA authority are three distinct questions — memory alone must
  // never grant response/CTA authority (locked principle: "BOOKING MEMORY !=
  // BOOKING RESPONSE AUTHORITY"). All three are computed from CURRENT-TURN
  // signals only (the current message's own text, or the orchestrator's
  // CURRENT-TURN decision) — never from a raw "does old context object happen
  // to carry a booking_context key" check, which is exactly what let a stale
  // booking topic leak into an unrelated new answer in production.
  const bookingSignal = /\b(booking|reservasi|slot|jadwal|reschedule|cancel|batal|kapster|barber|potong|pangkas|cukur|treatment|besok|lusa|jam\s*\d)\b/i.test(String(text || ''));
  const bookingMetadata = Boolean(orchestrationDecision && (
    /booking|availability|reschedule|cancel|barber|service_choice|branch_choice|temporal_followup/.test(
      `${orchestrationDecision.intent || ''} ${orchestrationDecision.conversational_act || ''} ${orchestrationDecision.response_strategy || ''}`,
    )
  ));

  // bookingMemoryRelevant: worth reconstructing/remembering booking preferences
  // this turn. Deliberately broad — reconstruction is memory-only (§ below) and
  // carries no response/CTA authority by itself, so it's safe to err inclusive
  // here purely to keep continuity working (e.g. resuming after a topic switch).
  const bookingMemoryRelevant = bookingSignal || bookingMetadata;

  // bookingResponseEligible / bookingCtaEligible: the CURRENT turn must itself
  // be booking-shaped. For v1 these collapse to the same current-turn signal
  // set as bookingMemoryRelevant (there is currently no case where a turn is
  // response-eligible but not CTA-eligible) — kept as separate named booleans,
  // not because their values differ today, but because the outbound sanitizer
  // below and the prompt context gate both key off bookingCtaEligible
  // specifically, and future work may narrow it further without touching
  // response eligibility.
  const bookingResponseEligible = bookingMemoryRelevant;
  const bookingCtaEligible = bookingResponseEligible;

  const canonicalBarberSource = bookingMemoryRelevant
    ? await loadBarbers(supabase)
    : { status: 'not_requested', barbers: [], reason: null };
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
    });
  }

  const guarded = guardReddyReply(reply, {
    isBackendVerified: false,
    bookingUrl: handoffUrl,
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
