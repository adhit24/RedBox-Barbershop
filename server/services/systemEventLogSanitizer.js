'use strict';

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|cookie|credential)/i;
const MAX_METADATA_JSON_LENGTH = 8000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripSensitive(value, seen) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitive(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      // Skip sensitive keys and prototype-pollution keys (__proto__, constructor, prototype)
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = stripSensitive(val, seen);
    }
    // Remove from seen after processing to track DFS path only (not global visited),
    // so sibling references to the same object aren't incorrectly flagged as circular
    seen.delete(value);
    return out;
  }
  return value;
}

/**
 * Strips sensitive keys (password/secret/token/api_key/authorization/cookie/
 * credential, case-insensitive, at any depth) and bounds the resulting size
 * so a caller can never accidentally persist a credential or an unbounded
 * payload into system_event_logs.metadata.
 */
function sanitizeMetadata(input) {
  if (!isPlainObject(input)) return {};

  let stripped;
  try {
    stripped = stripSensitive(input, new WeakSet());
  } catch {
    return { _truncated: true, _reason: 'sanitize_failed' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(stripped);
  } catch {
    return { _truncated: true, _reason: 'not_serializable' };
  }

  if (serialized.length <= MAX_METADATA_JSON_LENGTH) return stripped;

  return { _truncated: true, _original_size: serialized.length };
}

module.exports = { sanitizeMetadata, SENSITIVE_KEY_PATTERN, MAX_METADATA_JSON_LENGTH };
