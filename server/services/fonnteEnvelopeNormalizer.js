'use strict';

/**
 * P0.1 incident hotfix — Fonnte envelope normalization.
 *
 * Fonnte can deliver either a flat payload or one wrapped in a nested `data`
 * (or, more rarely, `payload`) envelope. The pre-hotfix normalization
 * REPLACED the working body with the nested object wholesale
 * (`body = rawBody.data`) whenever one was present. Any field that lives at
 * the envelope level but is not repeated inside the nested object — most
 * critically `inboxid`, the only stable provider message ID Fonnte
 * guarantees (see waInboundGuard.js) — was silently dropped from every
 * downstream decision. That produced the exact incident symptom: webhook
 * shadow telemetry saw the field present somewhere in the raw structure, but
 * admission's normalized body had already lost it, failing closed with
 * missing_provider_message_id even though a valid provider ID was present in
 * the original webhook call.
 *
 * This module builds ONE canonical, bounded merge used for every downstream
 * decision (classification, admission, branch detection, message routing).
 * It is an explicit fixed field list, never a blind spread of arbitrary raw
 * keys — new/unknown fields on the raw payload are never surfaced through
 * this canonical object.
 *
 * Precedence, walked shallow to deep across up to two levels of `data`/
 * `payload` nesting: the deepest layer that actually HAS a given field wins
 * (nested customer-message fields are authoritative for THIS event); any
 * field the nested layer omits falls back to the shallower/envelope layer.
 * Conceptually, per field: `nested.field ?? envelope.field`.
 */

const NESTED_KEYS = ['data', 'payload'];
const MAX_NESTED_JSON_LENGTH = 262144; // matches fonnteWebhookVerifier.js's bound
const MAX_NEST_DEPTH = 2;

// Bounded field list — the only fields the canonical representation carries.
// This is the union of every field webhook.js's handler and
// waInboundGuard.js actually read off the inbound body, plus the full
// possibleReceiverFields set. Anything else is deliberately dropped.
const CANONICAL_FIELDS = Object.freeze([
  // Stable provider message ID candidates (waInboundGuard.js resolveProviderMessageId)
  'inboxid', 'id', 'message_id', 'msgid', 'messageId',
  // Provider device/channel identity (waInboundGuard.js resolveProviderDeviceHash)
  'device', 'device_id', 'deviceId',
  // Customer identity
  'sender', 'from', 'number', 'phone',
  // Receiver / branch-channel identity (possibleReceiverFields)
  'target', 'to', 'recipient', 'receiver', 'receiver_number', 'destination',
  'target_number', 'me', 'my_number', 'bot_number', 'business_number',
  'wa_number', 'phone_number', 'to_number', 'from_number',
  // Message content
  'message', 'text', 'chat', 'body', 'msg',
  // Display name
  'name', 'pushName', 'senderName',
  // Media/message type
  'type', 'msgType', 'messageType',
  // Self/outbound-echo classification
  'isFromMe', 'is_from_me', 'fromMe',
  // Group-message classification (fonnteWebhookVerifier.js classifyFonnteEvent)
  'isGroup', 'is_group', 'groupId', 'group_id',
  // Status callback fields
  'status', 'message_status', 'state', 'stateid', 'stateId', 'reason',
  // Redbox-managed webhook body secret (fonnteWebhookTrustGate.js) — a
  // dormant CRM eligibility signal only, never a gate on the Reddy flow, but
  // it must survive normalization the same as every other field.
  'webhook-secret-key',
  // Timestamp presence (whatsappIdentityAdapter.js's inboxid/timestamp
  // presence signal for an already-trust-verified event).
  'timestamp',
]);

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseNestedRecord(value) {
  if (isPlainRecord(value)) return value;
  if (typeof value !== 'string' || value.length > MAX_NESTED_JSON_LENGTH) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findNestedRecord(record) {
  for (const key of NESTED_KEYS) {
    const nested = parseNestedRecord(record[key]);
    if (nested) return nested;
  }
  return null;
}

/** Shallow -> deep layer list: [envelope, nested, doubly-nested?]. */
function bodyLayers(root) {
  if (!isPlainRecord(root)) return [];
  const layers = [root];
  let current = root;
  for (let depth = 0; depth < MAX_NEST_DEPTH; depth += 1) {
    const nested = findNestedRecord(current);
    if (!nested) break;
    layers.push(nested);
    current = nested;
  }
  return layers;
}

/**
 * Returns a canonical, bounded inbound representation. `canonical` is what
 * every downstream consumer (admission, classification, branch detection,
 * message routing) should read fields from instead of the raw body.
 * `envelope` and `nested` are exposed for the one caller that intentionally
 * needs to search the FULL raw structure (the branch deep-scanner) rather
 * than the bounded field list.
 */
function normalizeFonnteEnvelope(rawBody) {
  const layers = bodyLayers(rawBody);
  const canonical = {};
  for (const layer of layers) {
    for (const field of CANONICAL_FIELDS) {
      if (Object.hasOwn(layer, field) && layer[field] !== undefined && layer[field] !== null) {
        canonical[field] = layer[field];
      }
    }
  }
  return {
    canonical,
    envelope: layers[0] || {},
    nested: layers[1] || null,
  };
}

module.exports = { normalizeFonnteEnvelope, CANONICAL_FIELDS };
