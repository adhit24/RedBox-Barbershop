'use strict';

const {
  issueTrustedIdentity,
} = require('./trustedIdentity');

const AUTHENTICATED_EVENT_FIELDS = Object.freeze([
  'source',
  'event_type',
  'sender',
  'timestamp_present',
  'inboxid_present',
]);
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

function readPlainOwnClaims(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (Object.getPrototypeOf(input) !== Object.prototype) return null;

    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== AUTHENTICATED_EVENT_FIELDS.length) return null;
    if (ownKeys.some(key => typeof key !== 'string' || !AUTHENTICATED_EVENT_FIELDS.includes(key))) return null;

    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const field of AUTHENTICATED_EVENT_FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
    }

    return Object.fromEntries(AUTHENTICATED_EVENT_FIELDS.map(field => [field, descriptors[field].value]));
  } catch {
    return null;
  }
}

/**
 * Capability mint kept private until an exact provider-authentication contract
 * exists. The test runner receives a conditional issuer to exercise the
 * adapter without exposing a production minting surface.
 */
function issueAuthenticatedWhatsappEvent(input) {
  const claims = readPlainOwnClaims(input);
  if (!claims) return null;
  if (claims.source !== 'fonnte') return null;
  if (typeof claims.event_type !== 'string' || !claims.event_type) return null;
  if (typeof claims.timestamp_present !== 'boolean' || typeof claims.inboxid_present !== 'boolean') return null;

  const event = Object.freeze({
    source: claims.source,
    event_type: claims.event_type,
    sender: claims.sender,
    timestamp_present: claims.timestamp_present,
    inboxid_present: claims.inboxid_present,
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
};

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  productionApi.__issueAuthenticatedWhatsappEventForTest = issueAuthenticatedWhatsappEvent;
}

module.exports = Object.freeze(productionApi);
