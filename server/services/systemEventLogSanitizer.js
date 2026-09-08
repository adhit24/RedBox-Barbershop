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

/**
 * Bounded shared free-text sanitizer for persisted log text (message, error_message).
 * Scrubs obvious credential-bearing patterns:
 * - Authorization: Bearer <token>
 * - Bearer <token>
 * - access_token=... / refresh_token=... / api_key=... / apikey=... / token=... / secret=... / password=... / cookie=...
 * - JSON key/value pairs: "password": "...", "token": "...", etc.
 * Masks phone-number-shaped digit sequences (8-15 consecutive digits).
 * Preserves non-string values safely and never throws.
 */
function sanitizeFreeText(value) {
  if (value === undefined || value === null) return value;
  let text = String(value);

  // 1. Scrub Bearer tokens with or without "Authorization:" header prefix
  text = text.replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]');
  text = text.replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');

  // 2. Scrub JSON / quoted credential patterns: "password": "..." or "token": "..."
  text = text.replace(
    /("(?:access_token|refresh_token|api[_-]?key|apikey|token|secret|password|cookie)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    '$1"[REDACTED]"'
  );

  // 3. Scrub key-value credential patterns: key=val or key: val
  text = text.replace(
    /\b(access_token|refresh_token|api[_-]?key|apikey|token|secret|password|cookie)(\s*[:=]\s*)(["']?)([^\s,;&"']+)\3/gi,
    '$1$2$3[REDACTED]$3'
  );

  // 4. Mask phone-number-shaped sequences (8-15 consecutive digits)
  text = text.replace(/\d{8,15}/g, (match) => `${match.slice(0, 2)}***${match.slice(-2)}`);

  return text;
}

module.exports = { sanitizeMetadata, sanitizeFreeText, SENSITIVE_KEY_PATTERN, MAX_METADATA_JSON_LENGTH };
