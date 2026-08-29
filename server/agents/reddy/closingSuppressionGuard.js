'use strict';

/**
 * Reddy conversation lifecycle: normal replies must not append a generic
 * closing question — the system (idle-timeout cron), not the LLM on every
 * turn, controls conversation closure (see conversationLifecycle.js).
 * Deliberately scoped to the specific generic phrasings called out in spec —
 * a task-advancing clarification question ("Mau di cabang mana, Kak?") has
 * none of this shape and is never touched. Prompt-only instructions already
 * proved insufficient elsewhere in this codebase (see bookingGuards.js) —
 * this is the same deterministic-safety-net pattern.
 */
const GENERIC_CLOSING_PATTERNS = [
  /\bada\s+yang\s+(bisa|mau|ingin)\s+(aku|saya|kami)?\s*bantu\s*(lagi|selain\s+ini)?\s*\??/i,
  /\b(jika|kalau)\s+ada\s+yang\s+(mau|ingin)?\s*ditanyakan,?\s*(jangan\s+ragu|silakan)?\.?/i,
  /\b(jika|kalau)\s+ada\s+pertanyaan\s+lain,?\s*(jangan\s+ragu|silakan)?\.?/i,
  // Covers both grammatical forms of the same generic closing intent:
  // active ("...kamu tanyakan...") and passive ("...ditanyakan..."). The
  // "di" prefix is optional so a single pattern safely matches either verb
  // form without duplicating the surrounding "ada yang ... seputar redbox?"
  // shape (Mini Correction Round 1 — the prior pattern accidentally dropped
  // the pre-existing active-form phrasing when passive-form coverage was added).
  /\bada\s+yang\s+(mau|ingin)\s+(kamu\s+)?(di)?tanyakan(\s+seputar\s+redbox)?\s*\??/i,
  /\bkalau\s+ada\s+yang\s+bisa\s+(aku|saya|kami)\s+bantu\s+lagi,?\s*(silakan\s+tanya|jangan\s+ragu)?\.?/i,
  /\bjangan\s+ragu\s+(untuk\s+)?(tanya|bertanya)\s*(ya|kak|bro)?\.?/i,
  // Mini Correction Round 2: end-constrained. stripGenericClosingQuestion
  // drops the WHOLE sentence on a match, so an unanchored "silakan tanya..."
  // pattern also matched genuine task-advancing instructions with real
  // content after the verb ("Silakan tanyakan nomor booking ke admin
  // cabang."). Requiring nothing but the optional "saja"/address term and
  // trailing punctuation before the end of the sentence means real content
  // after the verb (an object/target for the question) prevents a match,
  // while the bare generic closing ("Silakan tanya saja, Kak!") still matches.
  /\bsilakan\s+(tanya|bertanya|tanyakan)\s*(saja)?\s*,?\s*(kak|bro|ya)?\s*[.!?]*\s*$/i,
  /\bada\s+lagi\s+yang\s+(mau|ingin|bisa)\s+ditanyakan\s*\??/i,
];

function stripGenericClosingQuestion(reply) {
  if (typeof reply !== 'string' || !reply.trim()) {
    return { sanitizedReply: reply, closingStripped: false };
  }
  const sentences = reply.match(/[^.!?]+[.!?]*/g) || [reply];
  let closingStripped = false;
  const kept = sentences.filter((sentence) => {
    const isGenericClosing = GENERIC_CLOSING_PATTERNS.some((pattern) => pattern.test(sentence));
    if (isGenericClosing) closingStripped = true;
    return !isGenericClosing;
  });
  const rejoined = kept.join('').trim();
  return { sanitizedReply: rejoined || reply.trim(), closingStripped };
}

module.exports = { stripGenericClosingQuestion, GENERIC_CLOSING_PATTERNS };
