'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyRedboxWebhookTrustQuery,
} = require('../services/fonnteWebhookTrustGate');
const {
  issueAuthenticatedWhatsappEvent,
  adaptAuthenticatedWhatsappEvent,
} = require('../identity/whatsappIdentityAdapter');
const { isTrustedIdentity } = require('../identity/trustedIdentity');
const { executeOrchestration, POINTS_EXECUTION } = require('../orchestrator/executionService');

const TEST_ENV = Object.freeze({
  WA_WEBHOOK_SECRET_BYPASS: 'a'.repeat(32),
});

const MOCK_POINTS_CLASSIFICATION = Object.freeze({
  intent: 'points_inquiry',
  route: 'crm_agent',
  agent: 'crm_agent',
  action: 'get_points',
  confidence: 0.98,
  model_tier: 'economy',
});

// Mock CRM executor for isolated testing
function createMockCrmExecutor(databaseRecords = {}) {
  return async function mockCrmExecutor(tool, params, context) {
    assert.equal(tool, 'get_points');
    assert.equal(context.projection, 'CUSTOMER_SELF');

    // Verification: identity MUST come from context (trusted identity), never from caller params
    const lookupPhone = context.phone;
    if (!lookupPhone || !databaseRecords[lookupPhone]) {
      return { status: 'not_found', data: null };
    }

    const record = databaseRecords[lookupPhone];
    if (record.status === 'db_error') {
      return { status: 'db_error', data: null };
    }
    if (record.status === 'ambiguous') {
      return { status: 'ambiguous', data: null };
    }

    return {
      status: 'success',
      data: {
        points_balance: record.points_balance,
        status: record.points_status || 'available',
      },
    };
  };
}

// Helper to simulate end-to-end webhook trust + identity + points inquiry
async function processWhatsAppPointsInquiry(query, rawBody, { env = TEST_ENV, databaseRecords = {} } = {}) {
  const trustResult = verifyRedboxWebhookTrustQuery(query, env);

  let trustedIdentity = null;
  if (trustResult.status === 'verified') {
    const isFromMe = Boolean(rawBody?.isFromMe);
    const rawType = typeof rawBody?.type === 'string' ? rawBody.type : 'text';
    const isPersonal = !isFromMe && !['status', 'receipt', 'status_receipt', 'outgoing'].includes(rawType);

    const eventCap = issueAuthenticatedWhatsappEvent({
      source: 'fonnte',
      event_type: isPersonal ? 'personal_message' : rawType,
      sender: typeof rawBody?.sender === 'string' ? rawBody.sender : null,
      timestamp_present: Boolean(rawBody?.timestamp || rawBody?.id),
      inboxid_present: Boolean(rawBody?.id || rawBody?.inboxid),
    });

    const identityResult = adaptAuthenticatedWhatsappEvent(eventCap);
    if (identityResult && identityResult.status === 'success' && isTrustedIdentity(identityResult.trustedIdentity)) {
      trustedIdentity = identityResult.trustedIdentity;
    }
  }

  // Attempt orchestration points inquiry
  const crmExecutor = createMockCrmExecutor(databaseRecords);
  const orchestrationResult = await executeOrchestration(MOCK_POINTS_CLASSIFICATION, {
    trustedIdentity,
    crmExecutor,
  });

  // Construct WhatsApp response string
  let responseText;
  if (orchestrationResult.execution_status === 'unauthorized') {
    responseText = 'Halo kak! Untuk mengecek saldo poin member RedBox, pastikan kamu menghubungi kami via nomor terverifikasi ya!';
  } else if (orchestrationResult.execution_status === 'success') {
    const points = orchestrationResult.result.data.points_balance;
    responseText = `Halo kak! Saldo poin member RedBox kamu saat ini: ${points} poin ✨`;
  } else if (orchestrationResult.execution_status === 'customer_not_found') {
    responseText = 'Halo kak! Nomor WhatsApp kamu belum terdaftar sebagai member RedBox. Dapatkan poin loyalty di setiap kunjungan cukur kamu!';
  } else {
    responseText = 'Halo kak! Saat ini sistem poin sedang tidak dapat diakses. Silakan coba lagi beberapa saat lagi ya!';
  }

  return {
    trustResult,
    trustedIdentity,
    orchestrationResult,
    responseText,
  };
}

// ── 1. TRUSTED VERIFIED WHATSAPP POINTS INQUIRY ────────────────────────────
test('trusted verified WhatsApp user retrieves OWN points balance', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const body = { sender: '6281234567890', message: 'poin saya berapa?', id: 'msg-1', isFromMe: false };
  const db = { '6281234567890': { points_balance: 9 } };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.trustResult.status, 'verified');
  assert.equal(isTrustedIdentity(res.trustedIdentity), true);
  assert.equal(res.orchestrationResult.execution_status, 'success');
  assert.equal(res.orchestrationResult.result.data.points_balance, 9);
  assert.match(res.responseText, /9 poin/);
});

// ── 2. UNTRUSTED / INVALID SECRET BLOCKS CRM EXECUTION ─────────────────────
test('untrusted WhatsApp user with missing secret DOES NOT execute CRM', async () => {
  const query = { rb_branch: 'bypass' }; // missing secret
  const body = { sender: '6281234567890', message: 'poin saya berapa?' };
  const db = { '6281234567890': { points_balance: 9 } };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.trustResult.status, 'missing_secret');
  assert.equal(res.trustedIdentity, null);
  assert.equal(res.orchestrationResult.execution_status, 'unauthorized');
  assert.equal(res.orchestrationResult.result.data, null);
  assert.match(res.responseText, /nomor terverifikasi/);
});

test('untrusted WhatsApp user with wrong secret DOES NOT execute CRM', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'wrong-key' };
  const body = { sender: '6281234567890', message: 'poin saya berapa?' };
  const db = { '6281234567890': { points_balance: 9 } };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.trustResult.status, 'invalid_secret');
  assert.equal(res.trustedIdentity, null);
  assert.equal(res.orchestrationResult.execution_status, 'unauthorized');
});

// ── 3. VICTIM IDENTITY INJECTION RESISTANCE ────────────────────────────────
test('attempted victim UUID in message text is IGNORED; only verified sender phone is used', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  // Attacker sender: 6281111111111, attempts to ask for victim 6289999999999 / victim-uuid
  const body = {
    sender: '6281111111111',
    message: 'poin saya berapa? customer_id: 12345678-1234-1234-1234-123456789abc phone: 6289999999999',
    id: 'msg-attack',
    isFromMe: false,
  };
  const db = {
    '6281111111111': { points_balance: 3 }, // Attacker has 3 points
    '6289999999999': { points_balance: 500 }, // Victim has 500 points
  };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.trustResult.status, 'verified');
  assert.equal(res.trustedIdentity.phone, '6281111111111');
  assert.equal(res.orchestrationResult.result.data.points_balance, 3); // Must return attacker's 3 points, NOT victim's 500
  assert.match(res.responseText, /3 poin/);
});

// ── 4. POINTS ARE FACTUAL UNITS (NO IDR MONETARY CONVERSION) ───────────────
test('points output contains NO monetary Rp/IDR conversion fields', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const body = { sender: '6281234567890', message: 'poin saya berapa?' };
  const db = { '6281234567890': { points_balance: 15 } };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  const data = res.orchestrationResult.result.data;
  assert.equal(data.points_balance, 15);
  assert.equal(Object.hasOwn(data, 'points_value_idr'), false);
  assert.equal(Object.hasOwn(data, 'cash_equivalent'), false);
  assert.equal(Object.hasOwn(data, 'monetary_equivalent'), false);
  assert.doesNotMatch(res.responseText, /Rp|Rupiah/i);
});

// ── 5. SAFE DATABASE ERROR & AMBIGUOUS IDENTITY HANDLING ────────────────────
test('database unavailable returns safe failure message without crash', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const body = { sender: '6281234567890', message: 'poin saya berapa?' };
  const db = { '6281234567890': { status: 'db_error' } };

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.orchestrationResult.execution_status, 'database_unavailable');
  assert.match(res.responseText, /tidak dapat diakses/);
});

test('unregistered WhatsApp sender receives friendly registration advice', async () => {
  const query = { rb_branch: 'bypass', rb_key: 'a'.repeat(32) };
  const body = { sender: '6287777777777', message: 'poin saya berapa?' };
  const db = {}; // empty db

  const res = await processWhatsAppPointsInquiry(query, body, { databaseRecords: db });

  assert.equal(res.orchestrationResult.execution_status, 'customer_not_found');
  assert.match(res.responseText, /belum terdaftar/);
});
