'use strict';

/**
 * Distinguishes a customer REPORTING that they already completed a booking
 * (on the website) from a customer REQUESTING that Reddy create/change one,
 * and from an unrelated use of "sudah/udah". Deliberately narrow: bare
 * "sudah"/"udah"-only phrasing only counts as a completion report when
 * recent conversation context shows booking guidance was actually given.
 * Explicit self-declaring phrases ("udah booking di web", "udah dapet jam
 * 2") don't need that context.
 */

const BARE_COMPLETION_PATTERNS = [
  /^(?:sudah|udah)\s*(?:kak|ka|deh|nih|tuh|dong)?[.!]?\s*$/i,
  /^oke\s+(?:kak\s+)?sudah\s*(?:ya|kak)?[.!]?\s*$/i,
  /^(?:sudah|udah)\s+selesai[.!]?\s*$/i,
  /^sudah\s+berhasil[.!]?\s*$/i,
];

const EXPLICIT_COMPLETION_PATTERNS = [
  /\b(?:sudah|udah)\s+(?:saya\s+|aku\s+)?book(?:ing)?\b/i,
  /\b(?:sudah|udah)\s+(?:dapet|dapat)\b/i,
  /\btadi\b[^.!?]{0,40}\b(?:booking|book)\b[^.!?]{0,40}\b(?:web|website)\b/i,
  /\btadi\b[^.!?]{0,40}\b(?:web|website)\b[^.!?]{0,40}\b(?:booking|book)\b/i,
];

const STATUS_QUERY_PATTERN = /\bbelum\b/i;

// Correction Round 1 (PR #44 blocker): generic booking-adjacent vocabulary
// ("kapster", "barber", "jadwal", "slot") is NOT sufficient evidence that
// Reddy actually guided the customer to complete a booking — those words
// appear constantly in ordinary informational turns too (e.g. a customer
// saying "kapster Ubay", or Reddy merely answering "Mas Ubay kapster CSB").
// A bare completion phrase ("sudah kak") may only be interpreted as a
// completion report when a recent ASSISTANT turn (never a customer turn —
// the customer cannot self-issue the CTA that supposedly caused this reply)
// contains STRONG, unambiguous booking-flow guidance.
//
// Final Mini Correction: a bare mention of the domain alone ("Info cabang
// bisa dilihat di redboxbarbershop.com.") is NOT strong evidence either — a
// customer can be told the general website for all sorts of non-booking
// reasons (location, hours, catalog). The domain only counts when the URL
// itself clearly targets the booking flow (a /booking path, booking.html, or
// a booking-bearing query string), OR when the same turn also carries an
// explicit booking-flow instruction ("silakan booking", "lanjutkan booking",
// "booking lewat website", etc.) independent of any URL.
const EXPLICIT_BOOKING_FLOW_PHRASE_PATTERN =
  /\bsilakan\s+(?:lanjutkan\s+)?booking\b|\blanjutkan\s+booking\b|\blanjut(?:kan)?\s+(?:ke\s+)?booking\b|\bbooking\s+(?:di|lewat|melalui)\s+website\b|\bbooking\s+di\s+web\b|\bwebsite\s+booking\b|\blink\s+booking\b|\blanjutkan\s+(?:pilihan\s+)?(?:booking\s+)?di\s+website\b/i;

const BOOKING_TARGETED_URL_PATTERN = /redboxbarbershop\.com\S*booking\S*/i;

function isStrongAssistantBookingGuidance(content) {
  return EXPLICIT_BOOKING_FLOW_PHRASE_PATTERN.test(content) || BOOKING_TARGETED_URL_PATTERN.test(content);
}

function hasRecentAssistantBookingGuidance(conversationContext) {
  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns.slice(-6) : [];
  return turns.some(
    (turn) => turn && turn.role === 'assistant' && typeof turn.content === 'string'
      && isStrongAssistantBookingGuidance(turn.content),
  );
}

function detectBookingCompletionReport({ text, conversationContext } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { isCompletionReport: false, reason: 'empty' };
  if (raw.endsWith('?')) return { isCompletionReport: false, reason: 'question' };
  if (STATUS_QUERY_PATTERN.test(raw)) return { isCompletionReport: false, reason: 'status_query' };

  if (EXPLICIT_COMPLETION_PATTERNS.some((pattern) => pattern.test(raw))) {
    return { isCompletionReport: true, reason: 'explicit_completion_phrase' };
  }

  const bare = BARE_COMPLETION_PATTERNS.some((pattern) => pattern.test(raw));
  if (bare && hasRecentAssistantBookingGuidance(conversationContext)) {
    return { isCompletionReport: true, reason: 'contextual_completion_ack' };
  }

  return { isCompletionReport: false, reason: bare ? 'bare_without_context' : 'no_match' };
}

module.exports = { detectBookingCompletionReport, hasRecentAssistantBookingGuidance };
