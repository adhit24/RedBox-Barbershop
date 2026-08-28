'use strict';

const { buildCustomerFactsContext } = require('./customerFactsContext');
const { serializeKnowledgeForPrompt } = require('./knowledge/knowledgeContext');
const { loadCanonicalBarbers } = require('../../services/canonicalBarberResolver');
const { extractBookingContext, buildPrefilledBookingUrl } = require('./bookingContext');
const { guardReddyReply, REDDY_BOOKING_EXECUTION } = require('./bookingGuards');
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
  const bookingSignal = /\b(booking|reservasi|slot|jadwal|reschedule|cancel|batal|kapster|barber|potong|pangkas|cukur|treatment|besok|lusa|jam\s*\d)\b/i.test(String(text || ''));
  const bookingMetadata = orchestrationDecision && (
    /booking|availability|reschedule|cancel|barber|service_choice|branch_choice|temporal_followup/.test(
      `${orchestrationDecision.intent || ''} ${orchestrationDecision.conversational_act || ''} ${orchestrationDecision.response_strategy || ''}`,
    )
  );
  const bookingRelevant = Boolean(bookingSignal || bookingMetadata || conversationContext?.booking_context);
  const canonicalBarberSource = bookingRelevant
    ? await loadBarbers(supabase)
    : { status: 'not_requested', barbers: [], reason: null };
  const bookingContext = bookingRelevant
    ? extractBookingContext(text, conversationContext?.booking_context || null, {
      canonicalBarbers: canonicalBarberSource?.barbers || [],
    })
    : null;
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
    ...(bookingContext ? { booking_context: bookingContext } : {}),
    booking_authority: {
      whatsapp_mode: 'assist_and_guide_only',
      execution: REDDY_BOOKING_EXECUTION,
      reservation_authority: 'website_booking_system',
      handoff_url: handoffUrl,
      canonical_barber_source_status: canonicalBarberSource?.status || 'unavailable',
    },
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
