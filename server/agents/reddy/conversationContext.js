'use strict';

const {
  classifyConversationSession,
  isExplicitClosureSignal,
} = require('./personalityPolicy');


/**
 * Redbox Conversation Context Helper v0.1 (Hardened Round 3)
 * Sanitizes and bounds conversation history turns for Reddy AI prompt context.
 * Enforces strict role integrity (only 'user' and 'assistant') and customer isolation.
 */

const MAX_HISTORY_DEFAULT = 12;
const MAX_CHARS_PER_TURN_DEFAULT = 1000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

/**
 * Sanitizes historical conversation array, dropping invalid roles and non-string payloads,
 * bounding item text lengths, and returning clean turns with separate trimmed and filtered metrics.
 * @param {Array} history - Raw history items array
 * @param {object} options - Bounding options { maxItems, maxCharsPerTurn }
 * @returns {object} { turns, filtered_count, trimmed }
 */
function sanitizeConversationHistoryDetails(history, options = {}) {
  const maxItems = typeof options.maxItems === 'number' && options.maxItems > 0
    ? options.maxItems
    : MAX_HISTORY_DEFAULT;
  const maxCharsPerTurn = typeof options.maxCharsPerTurn === 'number' && options.maxCharsPerTurn > 0
    ? options.maxCharsPerTurn
    : MAX_CHARS_PER_TURN_DEFAULT;

  if (!Array.isArray(history)) {
    return { turns: [], filtered_count: 0, trimmed: false };
  }

  const clean = [];
  let filteredCount = 0;
  let perTurnTrimmed = false;

  for (const item of history) {
    if (!item || typeof item !== 'object') {
      filteredCount++;
      continue;
    }

    // Strict role validation — allow ONLY 'user' or 'assistant'
    const role = String(item.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      filteredCount++;
      continue;
    }

    // Strict content validation — must be string
    if (typeof item.content !== 'string') {
      filteredCount++;
      continue;
    }

    const contentStr = item.content.trim();
    if (!contentStr) {
      filteredCount++;
      continue;
    }

    // Bounded turn text length
    let content = contentStr;
    if (contentStr.length > maxCharsPerTurn) {
      content = contentStr.slice(0, maxCharsPerTurn);
      perTurnTrimmed = true;
    }

    const ts = item.timestamp || item.created_at || item.createdAt;
    clean.push({ role, content, ...(ts ? { timestamp: ts } : {}) });
  }

  const totalValid = clean.length;
  const turns = totalValid > maxItems ? clean.slice(totalValid - maxItems) : clean;
  const trimmed = totalValid > maxItems || perTurnTrimmed;

  return {
    turns,
    filtered_count: filteredCount,
    trimmed,
  };
}

/**
 * Convenience wrapper returning clean array of turns.
 * @param {Array} history - Raw history items array
 * @param {object} options - Bounding options
 * @returns {Array<{role: string, content: string}>} Clean turns array
 */
function sanitizeConversationHistory(history, options = {}) {
  return sanitizeConversationHistoryDetails(history, options).turns;
}

/**
 * Selects recent conversation turns.
 * @param {Array} history - Raw history items array
 * @param {object} options - Bounding options
 * @returns {Array<{role: string, content: string}>} Clean turns array
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

  // OpenAI chat messages MUST contain strictly { role, content } without extra properties like timestamp
  const projected = sanitized.map(item => ({ role: item.role, content: item.content }));

  if (!cleanUserMessage) return projected;

  const lastTurn = projected.length > 0 ? projected[projected.length - 1] : null;
  if (lastTurn && lastTurn.role === 'user' && lastTurn.content === cleanUserMessage) {
    return projected;
  }

  return [...projected, { role: 'user', content: cleanUserMessage }];
}

/**
 * Appends completed exchange (user turn + assistant reply) to history without duplicating user turn.
 * @param {Array} history - Prior history turns
 * @param {string} userMessage - Current user message
 * @param {string} assistantReply - Generated assistant reply
 * @param {object} options - Bounding options { maxItems }
 * @returns {Array<{role: string, content: string}>} Updated history array bounded to maxItems
 */
function appendConversationExchange(history = [], userMessage = '', assistantReply = '', options = {}) {
  const maxItems = typeof options.maxItems === 'number' && options.maxItems > 0
    ? options.maxItems
    : MAX_HISTORY_DEFAULT;
  const sanitized = sanitizeConversationHistory(history, options);
  const cleanUserMessage = typeof userMessage === 'string' ? userMessage.trim() : '';
  const cleanReply = typeof assistantReply === 'string' ? assistantReply.trim() : '';

  if (!cleanReply) return sanitized;

  const result = [...sanitized];
  const lastTurn = result.length > 0 ? result[result.length - 1] : null;

  // Append user message if not already present at the end of history
  if (cleanUserMessage) {
    if (!lastTurn || lastTurn.role !== 'user' || lastTurn.content !== cleanUserMessage) {
      result.push({ role: 'user', content: cleanUserMessage, timestamp: options.now || Date.now() });
    }
  }

  // Append assistant reply exactly once
  result.push({ role: 'assistant', content: cleanReply, timestamp: options.now || Date.now() });

  // Enforce MAX_HISTORY limit after append
  return result.length > maxItems ? result.slice(result.length - maxItems) : result;
}

/**
 * Extracts a structured Conversation Context Envelope with explicit history_status.
 * @param {Array|object} historyInput - Raw history array OR { history, status } object from loader
 * @param {string} userMessage - Current user turn text
 * @param {object} options - Bounding options
 * @returns {object} Structured Envelope
 */

/**
 * Extracts timestamp of the most recent user turn from history array.
 * @param {Array} history
 * @returns {number|null}
 */

/**
 * Extracts the most recent user turn from history array.
 * @param {Array} history
 * @returns {object|null}
 */
function extractLastCustomerTurn(history = []) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn && typeof turn === 'object' && turn.role === 'user') {
      return turn;
    }
  }
  return null;
}

function extractLastCustomerTimestamp(history = []) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn && typeof turn === 'object' && turn.role === 'user') {
      const ts = turn.timestamp || turn.created_at || turn.createdAt;
      if (ts) return Number(ts);
    }
  }
  return null;
}

function extractConversationContextEnvelope(historyInput = [], userMessage = '', options = {}) {
  let historyArray = [];
  let historyStatus = 'empty';

  if (Array.isArray(historyInput)) {
    historyArray = historyInput;
    historyStatus = historyArray.length > 0 ? 'available' : 'empty';
  } else if (historyInput && typeof historyInput === 'object') {
    historyArray = Array.isArray(historyInput.history) ? historyInput.history : [];
    historyStatus = typeof historyInput.status === 'string'
      ? historyInput.status
      : (historyArray.length > 0 ? 'available' : 'empty');
  }

  const { turns, filtered_count, trimmed } = sanitizeConversationHistoryDetails(historyArray, options);

  // If status was available but all items were filtered out, reflect status as empty
  if (historyStatus === 'available' && turns.length === 0) {
    historyStatus = 'empty';
  }

  const lastCustomerTurn = extractLastCustomerTurn(historyArray);
  const lastCustomerTimestamp = lastCustomerTurn ? (lastCustomerTurn.timestamp || lastCustomerTurn.created_at || lastCustomerTurn.createdAt) : null;
  const previousUserContent = lastCustomerTurn ? (lastCustomerTurn.content || '') : '';
  const previousCustomerClosed = isExplicitClosureSignal(previousUserContent);
  const explicitClosure = isExplicitClosureSignal(userMessage) || previousCustomerClosed;

  const sessionStatus = classifyConversationSession({
    now: options.now || Date.now(),
    lastCustomerMessageAt: lastCustomerTimestamp,
    explicitClosure,
  });

  return {
    version: 'conversation_context.v0.1',
    source: 'recent_conversation',
    trust: 'untrusted_conversation',
    turns,
    turn_count: turns.length,
    history_status: historyStatus, // 'available' | 'empty' | 'unavailable'
    sessionStatus,
    lastCustomerTimestamp,
    trimmed,
    filtered_count,
  };
}

module.exports = {
  MAX_HISTORY_DEFAULT,
  MAX_CHARS_PER_TURN_DEFAULT,
  sanitizeConversationHistoryDetails,
  sanitizeConversationHistory,
  selectRecentConversationTurns,
  buildConversationMessages,
  appendConversationExchange,
  extractConversationContextEnvelope,
};
