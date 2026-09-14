'use strict';

/**
 * Reddy 4-hour audit — "High: permintaan pembatalan tidak dijawab".
 *
 * Root cause (actual source): api/wa/webhook.js's deterministic OTW/travel
 * keyword shortcut ran before the orchestrator and matched purely on travel
 * words (otw/di jalan/berangkat/...) with no awareness of a cancellation
 * signal in the same message, so "Kalau saya cancel bisa tidak?" and mixed
 * messages like "udah otw tapi jadi mau batal" were answered "Siap Kak,
 * hati-hati di jalan ya." instead of addressing the cancellation.
 *
 * Fix: an explicit cancel/batal signal now (a) always wins over the OTW
 * shortcut, and (b) routes to a dedicated deterministic cancel-request path
 * that verifies against the backend booking status and hands off to a human
 * — it must NEVER claim a cancellation succeeded on WhatsApp (Task14:
 * website is the sole reservation authority).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const webhookHandler = require('../../api/wa/webhook');

const CANCEL_SUCCESS_CLAIM = /\b(sudah|udah)\s+(di)?batal(kan|in)?\b|\bberhasil\s+(di)?batal/i;

function baseDeps(overrides = {}) {
  return {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => [],
    recordEvaluation: async () => ({ status: 'recorded' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
    createHandoffCase: async () => { throw new Error('createHandoffCase must be overridden per test'); },
    getBookingStatus: async () => { throw new Error('getBookingStatus must be overridden per test'); },
    ...overrides,
  };
}

test('CANCEL 1. "Kalau saya cancel bisa tidak?" is never answered with the OTW acknowledgement', async () => {
  let sentReply = null;
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812350001', name: 'Budi', text: 'Kalau saya cancel bisa tidak?', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_01',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    createHandoffCase: async (params) => { handoffCalls++; return { status: 'created', case: { id: 'case-1' }, created: true }; },
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1' }; },
    persistConversation: async () => {},
  }));

  assert.notEqual(sentReply, 'Siap Kak, hati-hati di jalan ya.');
  assert.doesNotMatch(sentReply || '', /hati-hati di jalan/);
  assert.equal(handoffCalls, 1);
  assert.doesNotMatch(sentReply || '', CANCEL_SUCCESS_CLAIM);
});

test('CANCEL 2. a mixed OTW + cancel message ("udah otw tapi jadi mau batal") lets cancellation win', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812350002', name: 'Budi', text: 'udah otw tapi jadi mau batal aja', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_02',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    createHandoffCase: async () => ({ status: 'created', case: { id: 'case-2' }, created: true }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c2' }; },
    persistConversation: async () => {},
  }));

  assert.doesNotMatch(sentReply || '', /hati-hati di jalan/);
  assert.doesNotMatch(sentReply || '', CANCEL_SUCCESS_CLAIM);
});

test('CANCEL 3. "batalin" / "dibatalkan" / "pembatalan" phrasing variants all route to the cancel path', async () => {
  for (const text of ['boleh dibatalin gak bookingannya', 'saya mau ajukan pembatalan', 'tolong dibatalkan ya bookingnya']) {
    let sentReply = null;
    let handoffCalls = 0;
    await webhookHandler.handleMessage({
      from: '6281235000' + Math.floor(Math.random() * 9000 + 1000), name: 'Budi', text, branch: 'tegal',
      providerDeviceHash: 'hash_cancel_variant_' + text.length,
    }, baseDeps({
      getBookingStatus: async () => ({ status: 'PENDING' }),
      createHandoffCase: async () => { handoffCalls++; return { status: 'created', case: { id: 'case-v' }, created: true }; },
      send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-cv' }; },
      persistConversation: async () => {},
    }));
    assert.doesNotMatch(sentReply || '', /hati-hati di jalan/, text);
    assert.equal(handoffCalls, 1, text);
  }
});

test('CANCEL 4. no booking found for this number => honest "nothing to cancel", no handoff spam', async () => {
  let sentReply = null;
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812350004', name: 'Budi', text: 'mau cancel booking saya', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_04',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'NOT_FOUND' }),
    createHandoffCase: async () => { handoffCalls++; return { status: 'created', case: {}, created: true }; },
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c4' }; },
    persistConversation: async () => {},
  }));

  assert.match(sentReply || '', /belum menemukan booking/i);
  assert.equal(handoffCalls, 0);
  assert.doesNotMatch(sentReply || '', CANCEL_SUCCESS_CLAIM);
});

test('CANCEL 5. booking lookup failure still hands off safely, never crashes, never claims success', async () => {
  let sentReply = null;
  let threw = false;
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812350005', name: 'Budi', text: 'cancel dong bookingnya', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_05',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('db down'); },
    createHandoffCase: async () => { handoffCalls++; return { status: 'created', case: {}, created: true }; },
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c5' }; },
    persistConversation: async () => {},
  })).catch(() => { threw = true; });

  assert.equal(threw, false);
  assert.equal(handoffCalls, 1);
  assert.doesNotMatch(sentReply || '', CANCEL_SUCCESS_CLAIM);
});

test('CANCEL 6. an already-open cancellation case does not send a duplicate acknowledgement', async () => {
  let sentReply = 'unset';
  let sendCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812350006', name: 'Budi', text: 'jadi mau batal bookingnya', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_06',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    createHandoffCase: async () => ({ status: 'existing', case: { id: 'case-6' }, created: false }),
    send: async (_to, reply) => { sendCalls++; sentReply = reply; return { status: true, id: 'msg-c6' }; },
    persistConversation: async () => {},
  }));

  assert.equal(sendCalls, 0);
  assert.equal(sentReply, 'unset');
});

test('CANCEL 7. handoff creation failure still gives an honest reply, never claims success', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812350007', name: 'Budi', text: 'saya cancel aja deh', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_07',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    createHandoffCase: async () => ({ status: 'error', case: null, created: false }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c7' }; },
    persistConversation: async () => {},
  }));

  assert.doesNotMatch(sentReply || '', CANCEL_SUCCESS_CLAIM);
  assert.match(sentReply || '', /belum berhasil meneruskan/i);
});

test('CANCEL 8. pure OTW messages (no cancel word) still behave exactly as before', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812350008', name: 'Budi', text: 'Lagi OTW.', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_08',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c8' }; },
    persistConversation: async () => {},
  }));

  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
});

test('CANCEL 9. createHandoffCase receives correct cancellation metadata', async () => {
  let capturedParams = null;
  await webhookHandler.handleMessage({
    from: '62812350009', name: 'Budi', text: 'batalin booking saya dong', branch: 'tegal',
    providerDeviceHash: 'hash_cancel_09',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    createHandoffCase: async (params) => { capturedParams = params; return { status: 'created', case: {}, created: true }; },
    send: async () => ({ status: true, id: 'msg-c9' }),
    persistConversation: async () => {},
  }));

  assert.equal(capturedParams.reason, 'booking_cancellation_request');
  assert.equal(capturedParams.intent, 'cancel_request');
  assert.equal(capturedParams.triggerType, 'explicit_customer_request');
  assert.equal(capturedParams.branch, 'tegal');
});
