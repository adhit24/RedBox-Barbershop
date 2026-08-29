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
  /\bada\s+yang\s+bisa\s+(aku|saya|kami)\s+bantu\s+lagi\s*\??/i,
  /\bkalau\s+ada\s+yang\s+(mau|ingin)\s+ditanyakan,?\s+jangan\s+ragu\s+ya\.?/i,
  /\bada\s+yang\s+ingin\s+kamu\s+tanyakan\s+seputar\s+redbox\s*\??/i,
  /\bkalau\s+ada\s+yang\s+bisa\s+(aku|saya|kami)\s+bantu\s+lagi,?\s+silakan\s+tanya\.?/i,
  /\bjangan\s+ragu\s+(untuk\s+)?(tanya|bertanya)\s+ya\.?/i,
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
