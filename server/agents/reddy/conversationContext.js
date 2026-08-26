'use strict';

/**
 * Redbox Conversation Context Helper v0.1
 * Sanitizes and bounds conversation history turns for Reddy AI prompt context.
 * Enforces strict role integrity (only 'user' and 'assistant') and customer isolation.
 */

const MAX_HISTORY_DEFAULT = 12;
const MAX_CHARS_PER_TURN_DEFAULT = 1000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

/**
 * Sanitizes historical conversation array, dropping invalid roles, non-string payloads, and bounding item lengths.
 * @param {Array} history - Raw history items array
 * @param {object} options - Bounding options { maxItems, maxCharsPerTurn }
 * @returns {Array<{role: string, content: string}>} Clean, bounded history turns
 */
function sanitizeConversationHistory(history, options = {}) {
  const maxItems = typeof options.maxItems === 'number' && options.maxItems > 0
    ? options.maxItems
    : MAX_HISTORY_DEFAULT;
  const maxCharsPerTurn = typeof options.maxCharsPerTurn === 'number' && options.maxCharsPerTurn > 0
    ? options.maxCharsPerTurn
    : MAX_CHARS_PER_TURN_DEFAULT;

  if (!Array.isArray(history)) return [];

  const clean = [];
  for (const item of history) {
    if (!item || typeof item !== 'object') continue;

    // Strict role validation — allow ONLY 'user' or 'assistant'
    const role = String(item.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(role)) continue;

    // Strict content validation — must be string
    if (typeof item.content !== 'string') continue;

    const contentStr = item.content.trim();
    if (!contentStr) continue;

    // Bounded turn text length
    const content = contentStr.length > maxCharsPerTurn
      ? contentStr.slice(0, maxCharsPerTurn)
      : contentStr;

    clean.push({ role, content });
  }

  // Bounded recent turns
  return clean.length > maxItems ? clean.slice(clean.length - maxItems) : clean;
}

/**
 * Selects recent conversation turns (wrapper around sanitizeConversationHistory).
 * @param {Array} history - Raw history items array
 * @param {object} options - Bounding options
 * @returns {Array<{role: string, content: string}>} Bounded turns
 */
function selectRecentConversationTurns(history, options = {}) {
  return sanitizeConversationHistory(history, options);
}

/**
 * Prepares clean OpenAI messages array from history and current userMessage without duplicating user turns.
 * @param {Array} history - Raw history array
 * @param {string} userMessage - Current user turn text
 * @returns {Array<{role: string, content: string}>} Messages ready for OpenAI API
 */
function buildConversationMessages(history = [], userMessage = '') {
  const sanitized = sanitizeConversationHistory(history);
  const cleanUserMessage = typeof userMessage === 'string' ? userMessage.trim() : '';

  if (!cleanUserMessage) return sanitized;

  // Check if last turn in sanitized history is already identical to cleanUserMessage to avoid duplication
  const lastTurn = sanitized.length > 0 ? sanitized[sanitized.length - 1] : null;
  if (lastTurn && lastTurn.role === 'user' && lastTurn.content === cleanUserMessage) {
    return sanitized;
  }

  return [...sanitized, { role: 'user', content: cleanUserMessage }];
}

/**
 * Extracts a structured Conversation Context Envelope.
 * @param {Array} history - Raw history array
 * @param {string} userMessage - Current user turn text
 * @returns {object} Structured Envelope
 */
function extractConversationContextEnvelope(history = [], userMessage = '') {
  const turns = sanitizeConversationHistory(history);
  const rawLength = Array.isArray(history) ? history.length : 0;
  return {
    version: 'conversation_context.v0.1',
    source: 'recent_conversation',
    trust: 'untrusted_conversation',
    turns,
    turn_count: turns.length,
    trimmed: rawLength > turns.length,
  };
}

module.exports = {
  MAX_HISTORY_DEFAULT,
  MAX_CHARS_PER_TURN_DEFAULT,
  sanitizeConversationHistory,
  selectRecentConversationTurns,
  buildConversationMessages,
  extractConversationContextEnvelope,
};
