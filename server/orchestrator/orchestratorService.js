'use strict';

/**
 * Redbox AI Internal Orchestration Service v0.3
 * Bounded decision and policy authority for inbound conversational messages.
 */

const { classifyMessage } = require('./classifier');

// Human handoff is a routing outcome/state, not an AI agent.
const ALLOWED_AGENTS = Object.freeze(['reddy_agent', 'crm_agent']);
const ALLOWED_ROUTES = Object.freeze(['reddy_agent', 'crm_agent', 'human']);

const CRM_INTENTS = new Set([
  'customer_history',
  'customer_booking_history',
  'points_inquiry',
  'customer_profile',
  'customer_preferences',
  'customer_transaction_history',
]);

const BOOKING_MUTATION_PROHIBITED_CLAIMS = Object.freeze([
  'selection_saved',
  'booking_updated',
  'slot_reserved',
  'barber_selected_in_system',
  'time_selected_in_system',
  'reservation_confirmed',
]);

const BOOKING_CONTEXT_ALLOWED_CLAIMS = Object.freeze([
  'acknowledge_context_preference',
  'website_is_reservation_authority',
  'final_selection_must_be_made_on_website',
]);

const KNOWLEDGE_INTENTS = new Set([
  'price_inquiry',
  'location_inquiry',
  'operating_hours_inquiry',
  'service_inquiry',
  'barber_inquiry',
  'membership_inquiry',
]);

function recentContextText(conversationContext) {
  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns.slice(-6) : [];
  return turns
    .filter(turn => turn && typeof turn.content === 'string')
    .map(turn => turn.content.toLocaleLowerCase('id-ID'))
    .join(' ');
}

function safeDecision(decision = {}) {
  const route = ALLOWED_ROUTES.includes(decision.route) ? decision.route : 'reddy_agent';
  return {
    intent: typeof decision.intent === 'string' ? decision.intent : 'unknown',
    route,
    ...(route !== 'human' ? { agent: route } : {}),
    action: typeof decision.action === 'string' ? decision.action : 'fallback_unknown',
    confidence: typeof decision.confidence === 'number' && Number.isFinite(decision.confidence)
      ? decision.confidence
      : 0,
    model_tier: typeof decision.model_tier === 'string' ? decision.model_tier : 'none',
  };
}

function sourcePolicyFor(base) {
  if (base.intent === 'points_inquiry') {
    return { required_sources: ['crm:get_points'], response_strategy: 'answer_with_crm_fact' };
  }
  if (CRM_INTENTS.has(base.intent)) {
    return {
      required_sources: [`crm:${base.action}`],
      response_strategy: 'answer_with_crm_fact',
    };
  }
  if (base.intent === 'booking_status') {
    return {
      required_sources: ['booking_backend:booking_status'],
      response_strategy: 'answer_directly',
    };
  }
  if (base.intent === 'barber_popularity_inquiry') {
    return {
      required_sources: ['booking_backend:barber_popularity_trusted_read'],
      response_strategy: 'answer_directly',
    };
  }
  if (base.intent === 'booking_availability_inquiry') {
    return {
      required_sources: ['booking_backend:live_availability'],
      response_strategy: 'guide_to_booking',
      allowed_claims: ['website_is_reservation_authority', 'availability_must_be_checked_live'],
      prohibited_claims: ['unsupported_slot_full_or_available', 'unsupported_barber_availability'],
    };
  }
  if (base.intent === 'booking_request' || base.intent === 'reschedule_request' || base.intent === 'cancel_request') {
    return {
      required_sources: ['booking_backend:reservation_flow'],
      response_strategy: 'guide_to_booking',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  }
  if (KNOWLEDGE_INTENTS.has(base.intent)) {
    return {
      required_sources: ['knowledge:verified_business_fact'],
      response_strategy: 'answer_with_knowledge_fact',
    };
  }
  return { required_sources: [], response_strategy: 'answer_directly' };
}

/**
 * Builds the deterministic policy layer placed over classifier metadata.
 * Conversation history can resolve an omitted reference, but never supplies backend facts.
 */
function buildDecisionEnvelope({ message = '', conversationContext = null, decision = {} } = {}) {
  const base = safeDecision(decision);
  const normalized = String(message || '').trim().toLocaleLowerCase('id-ID');
  const contextText = recentContextText(conversationContext);
  const hasActiveContext = Boolean(contextText || conversationContext?.turn_count > 0);

  let conversationalAct = 'unknown';
  let continuationType = 'none';
  let contextReference = null;
  let sessionBehavior = 'continue';
  let clarificationRequired = false;
  let policy = sourcePolicyFor(base);
  let resolved = { ...base };

  const socialAck = /^(ok(?:e|ay)?|sip|siap|noted|baik|mantap|ya|iya|yoi|thanks?|makasih|terima kasih)[.!\s]*$/.test(normalized);
  const explicitClosure = /^(cukup|udah cukup|sudah cukup|selesai|gak ada lagi|ga ada lagi|bye|dadah)[.!\s]*$/.test(normalized);
  const greeting = /^(halo|hai|hi|pagi|selamat pagi|selamat siang|selamat sore|selamat malam)[!.,\s]*$/.test(normalized);
  const currentTimeChoice = /^(?:jam\s*)?(?:\d{1,2}(?:(?:[.:]\d{2})|\s*\/\s*\d{1,2})?|pagi|siang|sore|malam)(?:\s*(?:aja|saja|mungkin|ya))?[.!\s]*$/.test(normalized);
  const priorTimeContext = /\b(jam|waktu|pagi|siang|sore|malam|slot|booking|reservasi|lama)\b/.test(contextText);
  const shortChoice = normalized.length > 0 && normalized.length <= 40;
  const priorBarberChoice = /\b(pilih|mau|kapster|barber|sama siapa)\b/.test(contextText);
  const priorServiceChoice = /\b(pilih|layanan|service|treatment|grooming)\b/.test(contextText);
  const priorBranchChoice = /\b(pilih|cabang|outlet|bypass|samadikun|csb|sumber|tegal)\b/.test(contextText);
  const currentBranchChoice = /^(?:redbox\s+)?(?:bypass|samadikun|csb(?: mall)?|sumber|tegal)[.!\s]*$/.test(normalized);
  const membershipTimeSemantic = /\b(kapan|sejak|mulai|pertama)\b/.test(normalized);
  const membershipActivationSemantic = /\b(aktif|active|aktivasi|diaktifkan)\b/.test(normalized);
  const currentPaidPlanScope = /\b(paket(?:nya)?|benefit|berbayar|paid|langganan)\b/.test(normalized);
  const currentAccountScope = /\b(akun(?:nya)?|terdaftar|registrasi)\b/.test(normalized);
  const currentPaidPlanSelection = /^(?:yang\s+)?(?:paket(?:nya)?|membership\s+berbayar|paid\s+membership)[?!.\s]*$/.test(normalized);
  const currentAccountSelection = /^(?:yang\s+)?(?:akun(?:nya)?|terdaftar|registrasi)[?!.\s]*$/.test(normalized);
  const priorAccountScope = /\b(akun|terdaftar|registrasi|daftar)\b/i.test(contextText);
  const priorPaidPlanScope = /\b(paket|benefit|berbayar|paid|langganan)\b/i.test(contextText);
  const publicMembershipEnrollment = (
    /\b(cara|gimana|bagaimana|syarat)\b.*\b(jadi|daftar|mendaftar)\b.*\b(member|membership)\b/.test(normalized)
    || /\b(cara|gimana|bagaimana|syarat)\b.*\b(member|membership)\b.*\b(jadi|daftar|mendaftar)\b/.test(normalized)
    || /\b(kalau|jika)\b.*\b(mau|ingin)\b.*\b(jadi|daftar|mendaftar)\b.*\b(member|membership)\b/.test(normalized)
  );

  // Latest explicit user intent controls the response (Task 14.1 §1): the two
  // fallback continuation branches below have NO textual shape requirement of
  // their own (unlike the exact-branch-name, keyword-bearing, or name-only
  // branches above/below them) — they fire on "short message + a branch/
  // service word appeared ANYWHERE in recent history", which previously
  // hijacked unrelated new questions (e.g. "saya tercatat sebagai member
  // gak?" after an earlier branch mention) into a false booking continuation.
  // Only let them fire when the classifier's OWN independent read of the
  // current message (computed from the message alone, no history) is itself
  // weak/generic or already booking-shaped — never when it already found a
  // specific, unrelated business intent.
  const classifierIntentIsWeak = ['unknown', 'general_question', 'booking_request'].includes(base.intent);

  // Contextual ellipsis wins over an independently classified business intent.
  if (hasActiveContext && currentTimeChoice && (priorTimeContext || conversationContext?.sessionStatus !== 'expired')) {
    conversationalAct = 'temporal_followup';
    continuationType = 'contextual';
    contextReference = 'prior_arrival_or_booking_time';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_time_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (hasActiveContext && currentBranchChoice && priorBranchChoice && !socialAck && !explicitClosure) {
    conversationalAct = 'branch_choice_followup';
    continuationType = 'contextual';
    contextReference = 'prior_branch_choice';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_branch_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (hasActiveContext && shortChoice && priorServiceChoice && !socialAck && !explicitClosure && /\b(layanan|service|treatment|grooming|paket|cukur|haircut)\b/.test(normalized)) {
    conversationalAct = 'service_choice_followup';
    continuationType = 'contextual';
    contextReference = 'prior_service_choice';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_service_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (hasActiveContext && shortChoice && priorBarberChoice && !socialAck && !explicitClosure && /^[\p{L} .'-]+$/u.test(normalized)) {
    conversationalAct = 'barber_choice_followup';
    continuationType = 'contextual';
    contextReference = 'prior_barber_choice';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_barber_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (hasActiveContext && shortChoice && priorServiceChoice && !socialAck && !explicitClosure && classifierIntentIsWeak) {
    conversationalAct = 'service_choice_followup';
    continuationType = 'contextual';
    contextReference = 'prior_service_choice';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_service_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (hasActiveContext && shortChoice && priorBranchChoice && !socialAck && !explicitClosure && classifierIntentIsWeak) {
    conversationalAct = 'branch_choice_followup';
    continuationType = 'contextual';
    contextReference = 'prior_branch_choice';
    resolved = { ...resolved, intent: 'booking_request', route: 'reddy_agent', agent: 'reddy_agent', action: 'continue_branch_selection' };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_context_without_commit',
      allowed_claims: BOOKING_CONTEXT_ALLOWED_CLAIMS,
      prohibited_claims: BOOKING_MUTATION_PROHIBITED_CLAIMS,
    };
  } else if (socialAck) {
    conversationalAct = 'social_acknowledgement';
    sessionBehavior = 'keep_current_state';
    resolved = { ...resolved, intent: 'general_question', route: 'reddy_agent', agent: 'reddy_agent', action: 'acknowledge' };
    policy = { required_sources: [], response_strategy: 'acknowledge_only' };
  } else if (explicitClosure) {
    conversationalAct = 'explicit_closure';
    sessionBehavior = 'close';
    resolved = { ...resolved, intent: 'general_question', route: 'reddy_agent', agent: 'reddy_agent', action: 'close_conversation' };
    policy = { required_sources: [], response_strategy: 'close_conversation' };
  } else if (currentPaidPlanScope
    && ((membershipActivationSemantic && membershipTimeSemantic) || (hasActiveContext && currentPaidPlanSelection))) {
    conversationalAct = 'customer_fact_question';
    contextReference = 'explicit_paid_plan_activation_scope';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (currentAccountScope
    && ((membershipActivationSemantic || membershipTimeSemantic) || (hasActiveContext && currentAccountSelection))) {
    conversationalAct = 'customer_fact_question';
    contextReference = 'explicit_member_account_scope';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (hasActiveContext && membershipActivationSemantic && membershipTimeSemantic
    && priorAccountScope && !priorPaidPlanScope) {
    conversationalAct = 'customer_fact_question';
    continuationType = 'contextual';
    contextReference = 'prior_account_registration_discussion';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (hasActiveContext && membershipActivationSemantic && membershipTimeSemantic
    && priorPaidPlanScope && !priorAccountScope) {
    conversationalAct = 'customer_fact_question';
    continuationType = 'contextual';
    contextReference = 'prior_paid_membership_discussion';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (publicMembershipEnrollment) {
    conversationalAct = 'business_fact_question';
    resolved = { ...resolved, intent: 'membership_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'explain_membership' };
    policy = sourcePolicyFor(resolved);
  } else if (/\b(paket|benefit|berbayar|paid)\b.*\b(membership|member)\b|\b(membership|member)\b.*\b(paket|benefit|berbayar|paid)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    contextReference = 'explicit_paid_plan_scope';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (membershipTimeSemantic && /\b(member|membership)\b/.test(normalized) && !membershipActivationSemantic) {
    conversationalAct = 'customer_fact_question';
    contextReference = 'explicit_member_since_scope';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if ((/\b(membership|member)\b.*\b(aktif|active)\b|\b(aktif|active)\b.*\b(membership|member)\b/.test(normalized)
    && /\b(kapan|sejak|mulai)\b/.test(normalized))
    || /\b(member|membership)\b.*\b(aktif|active)\b.*\b(kapan|sejak|mulai)\b|\b(kapan|sejak|mulai)\b.*\b(member|membership)\b.*\b(aktif|active)\b|\b(member|membership)\b.*\b(kapan|sejak|mulai)\b.*\b(aktif|active)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    clarificationRequired = true;
    resolved = { ...resolved, intent: 'customer_profile', route: 'reddy_agent', agent: 'reddy_agent', action: 'clarify_membership_time_scope' };
    policy = { required_sources: [], response_strategy: 'clarify_short' };
  } else if (/\b(membership|member)\b.*\b(aktif|active)\b|\b(aktif|active)\b.*\b(membership|member)\b/.test(normalized)
    && !/\b(paket|benefit|berbayar|paid)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    clarificationRequired = true;
    resolved = { ...resolved, intent: 'customer_profile', route: 'reddy_agent', agent: 'reddy_agent', action: 'clarify_membership_scope' };
    policy = { required_sources: [], response_strategy: 'clarify_short' };
  } else if (/\b(member)\b.*\b(sejak|mulai|kapan)\b|\b(sejak|mulai)\b.*\bmember\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (/\b(aku|saya)\b.*\bmember(?:\s+redbox)?\b.*\b(gak|ga|nggak|tidak|bukan)?\b|\bmember(?:\s+redbox)?\b.*\b(aku|saya)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    resolved = { ...resolved, intent: 'customer_profile', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_profile' };
    policy = { required_sources: ['crm:get_customer_profile'], response_strategy: 'answer_with_crm_fact' };
  } else if (/\bpoin(?:ku| aku| saya)?\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    resolved = { ...resolved, intent: 'points_inquiry', route: 'crm_agent', agent: 'crm_agent', action: 'get_points' };
    policy = { required_sources: ['crm:get_points'], response_strategy: 'answer_with_crm_fact' };
  } else if (/\b(terakhir|kapan)\b.*\b(ke redbox|potong|kunjungan|treatment)\b|\b(ke redbox|potong|kunjungan|treatment)\b.*\b(terakhir|kapan)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    resolved = { ...resolved, intent: 'customer_history', route: 'crm_agent', agent: 'crm_agent', action: 'get_visit_summary' };
    policy = { required_sources: ['crm:get_visit_summary'], response_strategy: 'answer_with_crm_fact' };
  } else if (/\b(kapster|barber|cabang|layanan|service)\b.*\b(favorit|favorite|biasanya)\b|\b(favorit|favorite|biasanya)\b.*\b(kapster|barber|cabang|layanan|service)\b/.test(normalized)
    && /\b(aku|saya|ku)\b/.test(normalized)) {
    conversationalAct = 'customer_fact_question';
    resolved = { ...resolved, intent: 'customer_preferences', route: 'crm_agent', agent: 'crm_agent', action: 'get_customer_preferences' };
    policy = { required_sources: ['crm:get_customer_preferences'], response_strategy: 'answer_with_crm_fact' };
  } else if (/\b(jam|slot)\b.*\b(penuh|kosong|tersedia|available)\b|\b(penuh|kosong|tersedia|available)\b.*\b(jam|slot)\b/.test(normalized)) {
    conversationalAct = 'booking_status_question';
    resolved = { ...resolved, intent: 'booking_availability_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_booking_availability' };
    policy = sourcePolicyFor(resolved);
  } else if (/\b(harga|price|tarif|biaya)\b|\bberapa\b.*\b(grooming|haircut|layanan|service|treatment|cukur|potong)\b/.test(normalized)) {
    conversationalAct = 'business_fact_question';
    resolved = { ...resolved, intent: 'price_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_price' };
    policy = { required_sources: ['knowledge:verified_business_fact'], response_strategy: 'answer_with_knowledge_fact' };
  } else if (greeting) {
    conversationalAct = 'greeting';
    policy = { required_sources: [], response_strategy: 'answer_directly' };
  } else if (resolved.intent === 'complaint' || resolved.intent === 'human_request') {
    conversationalAct = resolved.intent === 'complaint' ? 'complaint' : 'unknown';
    policy = { required_sources: [], response_strategy: 'human_handoff' };
  } else if (CRM_INTENTS.has(resolved.intent)) {
    conversationalAct = 'customer_fact_question';
  } else if (KNOWLEDGE_INTENTS.has(resolved.intent)) {
    conversationalAct = 'business_fact_question';
  } else if (resolved.intent === 'booking_request') {
    conversationalAct = 'booking_request';
  } else if (resolved.intent === 'booking_status' || resolved.intent === 'booking_availability_inquiry') {
    conversationalAct = 'booking_status_question';
  } else if (resolved.intent === 'unknown') {
    clarificationRequired = true;
    policy = { required_sources: [], response_strategy: 'clarify_short' };
  } else {
    conversationalAct = 'contextual_followup';
  }

  return {
    ...resolved,
    conversational_act: conversationalAct,
    continuation_type: continuationType,
    context_reference: contextReference,
    required_sources: Object.freeze([...(policy.required_sources || [])]),
    allowed_claims: Object.freeze([...(policy.allowed_claims || [])]),
    prohibited_claims: Object.freeze([...(policy.prohibited_claims || [])]),
    clarification_required: clarificationRequired,
    session_behavior: sessionBehavior,
    response_strategy: policy.response_strategy || 'answer_directly',
  };
}

async function orchestrateMessage(params = {}, dependencies = {}) {
  const {
    message,
    channel = 'whatsapp',
    branch = null,
    conversationContext = null,
  } = params;
  const classifier = dependencies.classifier || classifyMessage;

  const output = (decision, fallbackUsed, fallbackReason) => ({
    ...buildDecisionEnvelope({ message, conversationContext, decision }),
    channel,
    branch: branch || 'unknown',
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
  });

  if (!message || typeof message !== 'string' || !message.trim()) {
    return output({ intent: 'unknown', route: 'reddy_agent', action: 'fallback_unknown' }, true, 'empty_message');
  }

  try {
    const decision = await classifier(message);
    if (!ALLOWED_ROUTES.includes(decision?.route)) {
      return output(decision, true, 'unsupported_route_or_agent');
    }
    return output(decision, false, null);
  } catch (_) {
    return output({ intent: 'unknown', route: 'reddy_agent', action: 'fallback_unknown' }, true, 'orchestrator_error');
  }
}

module.exports = {
  orchestrateMessage,
  buildDecisionEnvelope,
  ALLOWED_AGENTS,
  ALLOWED_ROUTES,
};
