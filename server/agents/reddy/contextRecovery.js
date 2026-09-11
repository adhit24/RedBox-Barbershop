'use strict';

/**
 * Reddy Context Recovery — Neutral Fallback + Explicit Correction Authority.
 *
 * Incident: Reddy repeated a stale membership clarification ("akun member
 * Redbox-nya atau paket membership berbayarnya?") after the customer had
 * already moved on or explicitly said Reddy misunderstood — because
 * conversation history remained visible to the LLM with no deterministic
 * signal that the old topic was no longer authoritative. Task 14.1 already
 * established that conversation history may resolve an *omitted* reference,
 * but must never resurrect a topic the customer has explicitly abandoned or
 * corrected.
 *
 * This module is intentionally small and bounded: a handful of semantic
 * regex patterns, not a brittle exact-string list, and it never decides
 * business/CRM truth — only whether the current turn is allowed to be
 * controlled by stale conversational context.
 */

// Bounded semantic patterns for "that's not what I meant / you misunderstood
// / this message is about something else". Each pattern is a short phrase
// shape (not a single literal string) so natural variants are covered
// without an ever-growing exact-match list.
const CONTEXT_CORRECTION_PATTERNS = Object.freeze([
  // "bukan itu", "bukan itu maksud saya", "bukan ini"
  /\bbukan\b.{0,15}\b(?:itu|ini)\b/,
  // "itu bukan...", "ini bukan..." (reversed word order)
  /\b(?:itu|ini)\s+bukan\b/,
  // "maksud saya bukan itu" (correction word after the reference)
  /\bmaksud\s+(?:saya|aku)\s+bukan\b/,
  // General "bukan X, maksud saya Y" shape, e.g. "Bukan booking, maksud saya harga grooming"
  /\bbukan\b.{0,30}\bmaksud\s+(?:saya|aku)\b/,
  // "salah paham", "kamu salah nangkep/tangkap/persepsi/mengerti"
  /\bsalah\s+(?:paham|nangkep|tangkap|persepsi|mengerti)\b/,
  // "itu balasan pesan lain", "itu balasan untuk pesan lain"
  /\b(?:itu|ini)\s+(?:balasan|jawaban)\s+(?:(?:untuk|buat)\s+)?(?:pesan|chat|obrolan)\s+lain\b/,
  // "itu untuk chat lain", "itu buat pesan lain"
  /\b(?:itu|ini)\s+(?:untuk|buat)\s+(?:chat|pesan|obrolan)\s+lain\b/,
  // "saya lagi balas pesan lain"
  /\b(?:saya|aku)\s+(?:lagi\s+|sedang\s+)?bal[ae]s\s+(?:pesan|chat)\s+lain\b/,
  // "bukan ngomongin itu"
  /\bbukan\s+(?:ng)?omongin\s+(?:itu|ini)\b/,
  // "enggak, maksud saya...", "nggak, maksud saya..."
  /\b(?:enggak|nggak|ga|gak)\b\s*,?\s*maksud\s+(?:saya|aku)\b/,
  // "bukan membership", "bukan booking", "bukan barber", etc.
  /\bbukan\s+(?:membership|member|booking|barber|kapster|cabang|promo)\b/,
  // "nggak bahas membership", "ga bahas member"
  /\b(?:nggak|ga|gak)\s+(?:bahas|ngomongin)\s+(?:membership|member|booking|barber|kapster|cabang)\b/,
]);

/**
 * Detects an explicit customer correction / "you misunderstood me" signal
 * in the CURRENT turn only. Never inspects conversation history — a
 * correction is, by definition, about what the customer means right now.
 * @param {string} text
 * @returns {{ detected: boolean, reason: (string|null) }}
 */
function detectExplicitContextCorrection(text = '') {
  const normalized = String(text || '').trim().toLocaleLowerCase('id-ID');
  if (!normalized) return { detected: false, reason: null };
  const matched = CONTEXT_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized));
  return matched
    ? { detected: true, reason: 'explicit_user_correction' }
    : { detected: false, reason: null };
}

// Plain WhatsApp-native status/acknowledgement words carrying NO business
// intent by themselves. Anchored to the whole message (optionally with a
// leading softener like "oke"/"sip"/"sudah" and a trailing "kak") so a real
// question that happens to CONTAIN "aman" — e.g. "Aman untuk booking besok?"
// — is never swallowed. Current-message semantics always win over shape.
const NEUTRAL_ACK_REGEX = /^(?:(?:oke?|sip|siap|udah|sudah)\s+)?aman(?:\s+kak)?[.!\s]*$/;

/**
 * Detects a bare status/acknowledgement message ("aman", "aman kak", "oke
 * aman", "sudah aman", "udah aman", "sip aman") that carries no business
 * intent of its own and must not inherit whatever topic was last discussed.
 * @param {string} text
 * @returns {{ detected: boolean, reason: (string|null) }}
 */
function detectNeutralAcknowledgement(text = '') {
  const normalized = String(text || '').trim().toLocaleLowerCase('id-ID');
  if (!normalized) return { detected: false, reason: null };
  return NEUTRAL_ACK_REGEX.test(normalized)
    ? { detected: true, reason: 'neutral_acknowledgement' }
    : { detected: false, reason: null };
}

module.exports = {
  CONTEXT_CORRECTION_PATTERNS,
  NEUTRAL_ACK_REGEX,
  detectExplicitContextCorrection,
  detectNeutralAcknowledgement,
};
