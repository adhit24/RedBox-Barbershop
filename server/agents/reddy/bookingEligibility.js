'use strict';

/**
 * Task 14.1 correction round 2 — deterministic booking eligibility.
 *
 * Three genuinely different questions, computed separately and NOT collapsed
 * into one flag (that collapse was exactly the bug both prior rounds left in
 * place):
 *
 *   memoryRelevant   — should booking context be reconstructed/remembered at
 *                       all this turn? Deliberately broad: booking vocabulary
 *                       anywhere in the current turn, or a prior-turn signal
 *                       the orchestrator already classified. Memory-only —
 *                       carries no authority to speak or link.
 *   responseEligible — is the CURRENT turn actually part of a booking
 *                       journey? Narrow: only a genuinely booking-shaped
 *                       current-turn intent, an explicit booking phrase, an
 *                       explicit link request, an explicit availability
 *                       question ("Onoy ada jam 4?"), or a contextual
 *                       continuation the orchestrator already proved (its
 *                       conversational_act naming a specific followup type —
 *                       that classification itself already required real
 *                       evidence in orchestratorService.js, e.g. an exact
 *                       branch-name match or name-shaped text).
 *   ctaEligible       — may a booking URL/CTA be shown? For every case this
 *                       module currently distinguishes, this equals
 *                       responseEligible (no example exists yet where a turn
 *                       is response-eligible but should NOT get a URL) —
 *                       kept as its own named value, not an alias, since a
 *                       future narrowing should not have to touch
 *                       responseEligible's callers.
 *
 * Bare booking-adjacent vocabulary ("barber", "kapster", "jam", "besok",
 * "potong", "treatment") is explicitly NOT sufficient for responseEligible/
 * ctaEligible — those words appear constantly in ordinary informational
 * questions ("Mas Onoy barber Bypass ya?", "Down perm itu apa?").
 */

const MEMORY_VOCAB_PATTERN = /\b(booking|reservasi|slot|jadwal|reschedule|cancel|batal|kapster|barber|potong|pangkas|cukur|treatment|besok|lusa|jam\s*\d)\b/i;
const MEMORY_METADATA_PATTERN = /booking|availability|reschedule|cancel|barber|service_choice|branch_choice|temporal_followup/;

const EXPLICIT_BOOKING_INTENT_PHRASES = /\b(mau booking|bookingin|pesan slot|amankan slot|mohon booking|tolong booking|bisa booking|cara booking)\b/i;
const EXPLICIT_BOOKING_LINK_PHRASES = /\b(link booking|kirim(kan)? link|url booking|website booking)\b/i;
// A concrete clock time ("jam 4") paired with an availability-question word
// is a self-contained booking-availability question regardless of what
// intent label the classifier happened to attach — unlike a bare "jam" or
// "jam berapa" (opening-hours phrasing), which is informational.
const EXPLICIT_AVAILABILITY_QUESTION = /\b(ada|kosong|tersedia|bisa|masih)\b[^.!?]{0,40}\bjam\s*\d|\bjam\s*\d[^.!?]{0,40}\b(ada|kosong|tersedia|bisa|masih)\b/i;

const EXPLICIT_BOOKING_INTENTS = new Set([
  'booking_request', 'booking_availability_inquiry', 'reschedule_request', 'cancel_request',
]);
const CONTEXTUAL_CONTINUATION_ACTS = new Set([
  'temporal_followup', 'branch_choice_followup', 'service_choice_followup', 'barber_choice_followup',
]);
const CRM_TOPIC_INTENTS = new Set([
  'points_inquiry', 'customer_profile', 'customer_history', 'customer_preferences',
  'customer_transaction_history', 'membership_inquiry',
]);
const INFORMATIONAL_INTENTS = new Set([
  'service_inquiry', 'barber_inquiry', 'operating_hours_inquiry', 'location_inquiry',
  'price_inquiry', 'general_question',
]);

function deriveBookingEligibility({ text, orchestrationDecision = null } = {}) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const intent = orchestrationDecision?.intent || null;
  const act = orchestrationDecision?.conversational_act || null;

  const memoryVocabSignal = MEMORY_VOCAB_PATTERN.test(raw);
  const memoryMetadataSignal = Boolean(orchestrationDecision && MEMORY_METADATA_PATTERN.test(
    `${orchestrationDecision.intent || ''} ${orchestrationDecision.conversational_act || ''} ${orchestrationDecision.response_strategy || ''}`,
  ));
  const memoryRelevant = memoryVocabSignal || memoryMetadataSignal;

  const explicitLinkRequest = EXPLICIT_BOOKING_LINK_PHRASES.test(lower);
  const explicitBookingPhrase = EXPLICIT_BOOKING_INTENT_PHRASES.test(lower) || EXPLICIT_BOOKING_INTENTS.has(intent);
  const explicitAvailabilityQuestion = EXPLICIT_AVAILABILITY_QUESTION.test(lower) || intent === 'booking_availability_inquiry';
  const contextualContinuation = CONTEXTUAL_CONTINUATION_ACTS.has(act);

  let reason = 'non_booking';
  let responseEligible = false;

  // A customer REPORTING they already completed a booking (Task
  // orchestratorService.buildDecisionEnvelope's booking_completion_report
  // act) must never be granted a CTA/URL — there is nothing left to guide
  // them to, and showing the link again is exactly the "CTA bleed" this
  // classification exists to prevent. Checked first: it must win over every
  // other reason, including a stray memory/vocabulary signal.
  if (act === 'booking_completion_report') {
    return { memoryRelevant, responseEligible: false, ctaEligible: false, reason: 'booking_completion_acknowledged' };
  }

  if (explicitLinkRequest) {
    reason = 'explicit_booking_link_request';
    responseEligible = true;
  } else if (explicitBookingPhrase) {
    reason = 'explicit_booking_request';
    responseEligible = true;
  } else if (explicitAvailabilityQuestion) {
    reason = 'availability_booking_intent';
    responseEligible = true;
  } else if (contextualContinuation) {
    reason = 'contextual_booking_continuation';
    responseEligible = true;
  } else if (CRM_TOPIC_INTENTS.has(intent)) {
    reason = 'crm_topic';
  } else if (INFORMATIONAL_INTENTS.has(intent)) {
    reason = 'informational_only';
  } else if (intent) {
    reason = 'non_booking';
  } else {
    reason = 'informational_only';
  }

  const ctaEligible = responseEligible;

  return { memoryRelevant, responseEligible, ctaEligible, reason };
}

module.exports = { deriveBookingEligibility };
