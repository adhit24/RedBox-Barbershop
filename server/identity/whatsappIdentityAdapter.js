'use strict';

const { issueTrustedIdentity } = require('./trustedIdentity');
const { isVerifiedRedboxWebhookTrust } = require('../services/fonnteWebhookTrustGate');
const { classifyFonnteEvent, EVENT_TYPE } = require('../services/fonnteWebhookVerifier');

const authenticatedEvents = new WeakSet();

const UNAUTHORIZED_EVENT = Object.freeze({
  status: 'unauthorized_event',
  trustedIdentity: null,
});
const NON_PERSONAL_EVENT = Object.freeze({
  status: 'non_personal_event',
  trustedIdentity: null,
});
const INVALID_SENDER = Object.freeze({
  status: 'invalid_sender',
  trustedIdentity: null,
});
const UNSUPPORTED_SENDER = Object.freeze({
  status: 'unsupported_sender',
  trustedIdentity: null,
});

/**
 * Capability issuer for authenticated WhatsApp channel events.
 * Requires a genuine, un-cloned verified trust capability from verifyRedboxWebhookTrustQuery.
 */
function issueAuthenticatedWhatsappEvent(trustCapability, payload) {
  if (!isVerifiedRedboxWebhookTrust(trustCapability)) return null;

  const eventType = classifyFonnteEvent(payload || {});
  if (eventType !== EVENT_TYPE.PERSONAL_MESSAGE) return null;

  const sender = typeof payload?.sender === 'string'
    ? payload.sender
    : (typeof payload?.from === 'string' ? payload.from : null);

  const timestampPresent = Object.hasOwn(payload || {}, 'timestamp') || Object.hasOwn(payload || {}, 'id');
  const inboxidPresent = Object.hasOwn(payload || {}, 'inboxid') || Object.hasOwn(payload || {}, 'id');

  const event = Object.freeze({
    source: 'fonnte',
    event_type: 'personal_message',
    sender,
    timestamp_present: Boolean(timestampPresent),
    inboxid_present: Boolean(inboxidPresent),
  });
  authenticatedEvents.add(event);
  return event;
}

function isAuthenticatedWhatsappEvent(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Object.isFrozen(value)
    && authenticatedEvents.has(value)
  );
}

function hasUnsupportedSenderShape(sender) {
  if (typeof sender !== 'string') return false;
  const normalized = sender.toLowerCase();
  return normalized.includes('@')
    || normalized.includes('broadcast')
    || normalized.includes('g.us')
    || normalized.includes('s.whatsapp.net');
}

function adaptAuthenticatedWhatsappEvent(event) {
  if (!isAuthenticatedWhatsappEvent(event)) return UNAUTHORIZED_EVENT;
  if (event.event_type !== 'personal_message') return NON_PERSONAL_EVENT;
  if (hasUnsupportedSenderShape(event.sender)) return UNSUPPORTED_SENDER;

  try {
    const trustedIdentity = issueTrustedIdentity({
      source: 'whatsapp',
      verifiedPhone: event.sender,
    });
    return Object.freeze({ status: 'success', trustedIdentity });
  } catch {
    return INVALID_SENDER;
  }
}

const productionApi = {
  adaptAuthenticatedWhatsappEvent,
  isAuthenticatedWhatsappEvent,
  issueAuthenticatedWhatsappEvent,
};

module.exports = Object.freeze(productionApi);
