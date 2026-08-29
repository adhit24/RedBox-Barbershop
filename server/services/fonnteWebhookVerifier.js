'use strict';

const SHADOW_STATUS = Object.freeze({
  VERIFIED: 'verified',
  INVALID: 'invalid',
  MISSING: 'missing',
  NOT_CONFIGURED: 'not_configured',
  CONTRACT_UNKNOWN: 'contract_unknown',
  MALFORMED: 'malformed',
});

const EVENT_TYPE = Object.freeze({
  PERSONAL_MESSAGE: 'personal_message',
  GROUP_MESSAGE: 'group_message',
  STATUS_RECEIPT: 'status_receipt',
  OUTGOING: 'outgoing',
  MEDIA: 'media',
  UNSUPPORTED: 'unsupported',
});

const MEDIA_TYPES = new Set([
  'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'gif', 'ptt',
]);
const AUTH_CANDIDATE_PATTERN = /^(?:webhook_)?secret(?:_key)?$/;

// Provider-level identity/provenance may live on the outer Fonnte envelope while
// sender/message live inside `data`/`payload`. The production webhook selects
// the deepest nested object before durable admission, so preserve ONLY the
// bounded provider metadata required by the classifier/idempotency guard.
// Nested values always win; envelope values are fallback-only.
const PROVIDER_ENVELOPE_FIELDS = Object.freeze([
  'inboxid', 'id', 'message_id', 'msgid', 'messageId',
  'device', 'device_id', 'deviceId',
  'stateid', 'stateId', 'status', 'message_status',
  'isFromMe', 'is_from_me', 'fromMe',
]);

// Replay preparation only: if production evidence confirms inboxid is stable
// across retries, the future persistent idempotency key candidate is
// `fonnte + inboxid`. This shadow phase intentionally adds no persistence.

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function parseNestedRecord(value) {
  if (isPlainRecord(value)) return value;
  if (typeof value !== 'string' || value.length > 262144) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeFieldName(field) {
  if (typeof field !== 'string' || field.length > 64 || !/^[A-Za-z0-9_-]+$/.test(field)) return null;
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-+/g, '_')
    .toLowerCase();
}

function bodyLayers(root) {
  const layers = [root];
  let current = root;
  for (let depth = 0; depth < 2; depth += 1) {
    const nested = parseNestedRecord(current.data) || parseNestedRecord(current.payload);
    if (!nested) break;
    layers.push(nested);
    current = nested;
  }
  return layers;
}

function preserveProviderEnvelopeFields(layers) {
  if (!Array.isArray(layers) || layers.length < 2) return;
  const eventBody = layers[layers.length - 1];
  if (!isPlainRecord(eventBody)) return;

  for (const field of PROVIDER_ENVELOPE_FIELDS) {
    const existing = eventBody[field];
    if (existing !== undefined && existing !== null && String(existing).trim()) continue;

    for (let i = layers.length - 2; i >= 0; i -= 1) {
      const candidate = layers[i]?.[field];
      if (candidate === undefined || candidate === null || !String(candidate).trim()) continue;
      eventBody[field] = candidate;
      break;
    }
  }
}

function findAuthCandidate(layers) {
  for (const layer of layers) {
    for (const field of Object.keys(layer)) {
      const normalized = normalizeFieldName(field);
      if (normalized && AUTH_CANDIDATE_PATTERN.test(normalized)) {
        return { present: true, field };
      }
    }
  }
  return { present: false, field: null };
}

function selectEventBody(layers) {
  return layers[layers.length - 1];
}

function isTrue(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function classifyFonnteEvent(body) {
  const sender = typeof body.sender === 'string' ? body.sender : (typeof body.from === 'string' ? body.from : '');
  const message = body.message ?? body.text ?? body.chat ?? body.body ?? body.msg;
  const type = String(body.type || body.msgType || body.messageType || '').toLowerCase();

  if (isTrue(body.isFromMe) || isTrue(body.is_from_me) || isTrue(body.fromMe)) {
    return EVENT_TYPE.OUTGOING;
  }
  if (isTrue(body.isGroup) || isTrue(body.is_group)
    || /@g\.us$|@broadcast$/i.test(sender)
    || typeof body.groupId === 'string' || typeof body.group_id === 'string') {
    return EVENT_TYPE.GROUP_MESSAGE;
  }
  if (MEDIA_TYPES.has(type)) return EVENT_TYPE.MEDIA;

  const hasStatus = body.status !== undefined || body.message_status !== undefined || body.state !== undefined;
  const hasEventId = body.id !== undefined || body.message_id !== undefined
    || body.inboxid !== undefined || body.stateid !== undefined;
  if (hasStatus && hasEventId && !message) return EVENT_TYPE.STATUS_RECEIPT;
  if (sender && typeof message === 'string' && message.trim()) return EVENT_TYPE.PERSONAL_MESSAGE;
  return EVENT_TYPE.UNSUPPORTED;
}

function inspectFonnteWebhookShadow(body, configuredSecret) {
  if (!isPlainRecord(body)) {
    return Object.freeze({
      status: SHADOW_STATUS.MALFORMED,
      auth_candidate_present: false,
      auth_candidate_field: null,
      event_type: EVENT_TYPE.UNSUPPORTED,
      has_timestamp: false,
      has_inboxid: false,
    });
  }

  const layers = bodyLayers(body);
  preserveProviderEnvelopeFields(layers);
  const eventBody = selectEventBody(layers);
  const candidate = findAuthCandidate(layers);
  const secretConfigured = typeof configuredSecret === 'string' && configuredSecret.length > 0;

  // Shadow-only: no candidate is treated as verified until Fonnte's exact
  // inbound field contract has been confirmed independently.
  return Object.freeze({
    status: secretConfigured ? SHADOW_STATUS.CONTRACT_UNKNOWN : SHADOW_STATUS.NOT_CONFIGURED,
    auth_candidate_present: candidate.present,
    auth_candidate_field: candidate.field,
    event_type: classifyFonnteEvent(eventBody),
    has_timestamp: Object.hasOwn(eventBody, 'timestamp'),
    has_inboxid: Object.hasOwn(eventBody, 'inboxid'),
  });
}

function emitFonnteWebhookShadow(metadata, logger = console) {
  const normalizedField = normalizeFieldName(metadata?.auth_candidate_field);
  const safeMetadata = Object.freeze({
    status: Object.values(SHADOW_STATUS).includes(metadata?.status)
      ? metadata.status
      : SHADOW_STATUS.MALFORMED,
    auth_candidate_present: metadata?.auth_candidate_present === true,
    auth_candidate_field: normalizedField && AUTH_CANDIDATE_PATTERN.test(normalizedField)
      ? normalizedField
      : null,
    event_type: Object.values(EVENT_TYPE).includes(metadata?.event_type)
      ? metadata.event_type
      : EVENT_TYPE.UNSUPPORTED,
    has_timestamp: metadata?.has_timestamp === true,
    has_inboxid: metadata?.has_inboxid === true,
  });

  if (logger && typeof logger.info === 'function') {
    logger.info('[WAWebhookAuthShadow]', safeMetadata);
  }
  return safeMetadata;
}

module.exports = {
  SHADOW_STATUS,
  EVENT_TYPE,
  classifyFonnteEvent,
  inspectFonnteWebhookShadow,
  emitFonnteWebhookShadow,
};
