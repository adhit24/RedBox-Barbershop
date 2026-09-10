'use strict';

/**
 * ============================================================
 * REDBOX BARBERSHOP — Test Isolation & External Side-Effect Guard
 * ============================================================
 *
 * Ensures automated tests and test fixtures can execute full booking
 * flows (DB writes, atomic locking, membership calculations, pricing)
 * WITHOUT ever triggering irreversible external side effects:
 * - Moka POS Advanced Ordering (createOrder)
 * - Moka POS Checkout (createCheckout)
 * - Fonnte WhatsApp messages
 * - Web Push notifications
 *
 * Security: Public customers can NEVER bypass external integrations
 * by sending arbitrary parameters like ?is_test=true. Test flags are
 * only honored if verified by server environment, shared internal
 * secrets, or strict known test fixtures.
 */

const KNOWN_TEST_PHONE_DIGITS = new Set([
  '8999900001',
  '8999900002',
  '8999900003',
  '8999900011',
  '8999900012',
  '8999900013',
  '81299990001',
  '81299990011',
  '81299990022',
]);

const KNOWN_TEST_USER_KEYS = [
  '@redbox.test',
];

function _cleanDigits(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^\d]/g, '');
  if (digits.startsWith('62')) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * Check if the server process itself is running in an automated test context.
 */
function isServerTestEnvironment() {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.TEST_MODE === 'true' ||
    process.env.REDBOX_TEST_ISOLATION === 'true' ||
    process.env.npm_lifecycle_event === 'test'
  );
}

/**
 * Check if an incoming HTTP request is authenticated as an internal test runner.
 * Requires a valid secret token (INTERNAL_TEST_SECRET, CRON_SECRET, or ADMIN_PASSWORD).
 */
function isRequestAuthenticatedForTest(req) {
  if (!req) return false;
  const testSecret = req.headers?.['x-test-secret'] || req.headers?.['x-internal-test-secret'] || '';
  const adminToken = req.headers?.['x-admin-token'] || '';
  const authHeader = req.headers?.['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const validSecrets = [
    process.env.INTERNAL_TEST_SECRET,
    process.env.CRON_SECRET,
    process.env.ADMIN_PASSWORD,
  ].filter(Boolean);

  if (validSecrets.length === 0) return false;

  return (
    validSecrets.includes(testSecret) ||
    validSecrets.includes(adminToken) ||
    validSecrets.includes(bearer)
  );
}

/**
 * Check if booking data matches a known static test fixture.
 */
function isTestFixture(data) {
  if (!data) return false;

  // Phone check
  const phone = data.wa || data.phone || data.customer_phone || data.customer_wa || '';
  const cleanPhone = _cleanDigits(phone);
  if (cleanPhone && KNOWN_TEST_PHONE_DIGITS.has(cleanPhone)) {
    return true;
  }

  // Email / User key check
  const email = String(data.email || data.user_key || '').toLowerCase();
  if (KNOWN_TEST_USER_KEYS.some(k => email.includes(k))) {
    return true;
  }

  // Name check for explicit test fixtures
  const name = String(data.name || data.customer_name || '').trim();
  if (/^(?:Test\s+|Prod\s+Test\s+|Guest\s+Browser\s+Verify)/i.test(name)) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether a given request and/or booking payload should be isolated
 * from external side effects (Moka, WhatsApp, Push).
 *
 * @param {object} [req] - Express request object (optional)
 * @param {object} [payload] - Booking / Schedule / Customer data (optional)
 * @returns {{ isTest: boolean, reason: string|null }}
 */
function evaluateTestIsolation(req = null, payload = null, options = {}) {
  // 1. Process environment (highest authority, unless test specifically simulates production flow with mock)
  if (!options?.forceSimulateProduction && isServerTestEnvironment()) {
    return { isTest: true, reason: 'server_test_environment' };
  }

  // 2. Request authenticated as internal test
  const reqIsTestMode = req?.headers?.['x-redbox-test-mode'] === 'true' || req?.headers?.['x-test-mode'] === 'true';
  if (reqIsTestMode && isRequestAuthenticatedForTest(req)) {
    return { isTest: true, reason: 'authenticated_test_request' };
  }

  // 3. Payload has is_test flag, but ONLY if request is authenticated
  if (payload?.is_test === true) {
    if (isRequestAuthenticatedForTest(req)) {
      return { isTest: true, reason: 'authenticated_payload_is_test' };
    }
    // Untrusted public caller tried to pass is_test=true: log warning and ignore!
    console.warn('[TestIsolation] Ignored unauthenticated is_test flag on booking from public request');
  }

  // 4. Known internal test fixture
  if (isTestFixture(payload)) {
    return { isTest: true, reason: 'known_test_fixture' };
  }

  return { isTest: false, reason: null };
}

/**
 * Log structured event when an external side effect is skipped.
 */
function logSideEffectSkipped(sideEffectName, details = {}) {
  const meta = {
    event: 'external_side_effect_skipped',
    sideEffect: sideEffectName,
    reason: details.reason || 'automated_test',
    bookingId: details.bookingId || details.id || null,
    scheduleId: details.scheduleId || null,
    timestamp: new Date().toISOString(),
  };
  console.log(`[TestIsolation] 🛡️ External side effect skipped: ${sideEffectName} (${meta.reason})`);
  return meta;
}

module.exports = {
  isServerTestEnvironment,
  isRequestAuthenticatedForTest,
  isTestFixture,
  evaluateTestIsolation,
  logSideEffectSkipped,
};
