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

const BOOKING_GUIDANCE_CONTEXT_PATTERN =
  /\b(booking|reservasi|website|redboxbarbershop|link|jadwal|slot|kapster|barber)\b/i;

function hasRecentBookingGuidanceContext(conversationContext) {
  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns.slice(-6) : [];
  return turns.some(
    (turn) => turn && typeof turn.content === 'string' && BOOKING_GUIDANCE_CONTEXT_PATTERN.test(turn.content),
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
  if (bare && hasRecentBookingGuidanceContext(conversationContext)) {
    return { isCompletionReport: true, reason: 'contextual_completion_ack' };
  }

  return { isCompletionReport: false, reason: bare ? 'bare_without_context' : 'no_match' };
}

module.exports = { detectBookingCompletionReport, hasRecentBookingGuidanceContext };
