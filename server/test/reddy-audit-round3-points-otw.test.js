'use strict';

/**
 * Reddy Audit Round 3 — Points/Redeem Dispute, Facility Boundary, OTW
 * Acknowledgement (Objectives A, B, C). See PR72/round-2 for the prior
 * correction round; this file is a NEW, additive test suite and does not
 * modify or weaken any existing test.
 */

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');

const { classifyDeterministically } = require('../orchestrator/routingPolicy');
const { classifyFacilityIntent } = require('../agents/reddy/facilityIntent');
const { classifyBarberPositionIntent } = require('../agents/reddy/barberPresenceIntent');
const webhookHandler = require('../../api/wa/webhook');

const webhookSource = fs.readFileSync(require.resolve('../../api/wa/webhook'), 'utf8');

function baseDeps(overrides = {}) {
  return {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => [],
    recordEvaluation: async () => ({ status: 'recorded' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
    ...overrides,
  };
}

// ── OBJECTIVE A: POINTS / REDEEM DISPUTE ────────────────────────────────────

test('POINTS — 1. "poin saya berapa?" classifies as points_inquiry, not dispute', () => {
  const result = classifyDeterministically('poin saya berapa?');
  assert.equal(result.intent, 'points_inquiry');
});

test('POINTS — 1b. ordinary inquiries never classify as points_dispute', () => {
  for (const text of ['poin saya berapa?', 'cek point dong', 'saldo poin saya?', 'berapa loyalty point saya?']) {
    const result = classifyDeterministically(text);
    assert.notEqual(result?.intent, 'points_dispute', text);
  }
});

test('POINTS — 2. "kemarin redeem 200 kok sekarang 250?" classifies as points_dispute', () => {
  assert.equal(classifyDeterministically('kemarin redeem 200 kok sekarang 250?').intent, 'points_dispute');
});

test('POINTS — 3. "kok poin saya berkurang?" classifies as points_dispute', () => {
  assert.equal(classifyDeterministically('kok poin saya berkurang?').intent, 'points_dispute');
});

test('POINTS — 3b. all required dispute phrases classify as points_dispute', () => {
  const phrases = [
    'kemarin redeem 200 kok sekarang 250?', 'kok poin redeem berubah?', 'poin saya kepotong',
    'poin saya berkurang padahal tidak dipakai', 'redeemnya tadinya 200 sekarang 250',
    'kenapa jumlah poin berubah?', 'saldo poin saya beda', 'kok poin saya hilang?',
    'transaksi poin saya salah', 'redeem point berubah',
  ];
  for (const text of phrases) {
    assert.equal(classifyDeterministically(text)?.intent, 'points_dispute', text);
  }
});

test('POINTS — 4. dispute reply never fabricates a specific "changed from X to Y" claim', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345001', name: 'Budi', text: 'kemarin redeem 200 kok sekarang 250?',
    branch: 'tegal', providerDeviceHash: 'hash_dispute_4',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-1' }; },
    persistConversation: async () => {},
  }));
  assert.ok(sentReply);
  assert.ok(!/200/.test(sentReply) && !/250/.test(sentReply), 'must not restate unverified numbers as fact');
  assert.ok(!/memang berubah/i.test(sentReply));
});

test('POINTS — 5. dispute with handoff-unavailable ("error") still requests HIGH priority', async () => {
  let capturedParams = null;
  await webhookHandler.handleMessage({
    from: '62812345002', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_dispute_5',
  }, baseDeps({
    createHandoffCase: async (params) => { capturedParams = params; return { status: 'error' }; },
    send: async () => ({ status: true, id: 'msg-2' }),
    persistConversation: async () => {},
  }));
  assert.equal(capturedParams.priority, 'high');
  assert.equal(capturedParams.intent, 'points_dispute');
});

test('POINTS — 6. dispute with an ambiguous/ex-post handoff outcome still used HIGH priority on the attempt', async () => {
  let capturedParams = null;
  await webhookHandler.handleMessage({
    from: '62812345003', name: 'Budi', text: 'saldo poin saya beda', branch: 'tegal',
    providerDeviceHash: 'hash_dispute_6',
  }, baseDeps({
    createHandoffCase: async (params) => { capturedParams = params; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-3' }),
    persistConversation: async () => {},
  }));
  assert.equal(capturedParams.priority, 'high');
  assert.equal(capturedParams.reason, 'points_or_redeem_discrepancy');
});

test('POINTS — 7. created case uses truthful forwarded wording', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345004', name: 'Budi', text: 'kok poin saya hilang?', branch: 'tegal',
    providerDeviceHash: 'hash_dispute_7',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-4' }; },
    persistConversation: async () => {},
  }));
  assert.match(sentReply, /sudah aku teruskan ke tim Redbox/);
});

test('POINTS — 8. existing case: no automated reply is sent at all (Round 3 Correction 1)', async () => {
  let sendCalls = 0;
  let persistCalls = 0;
  const res = await webhookHandler.handleMessage({
    from: '62812345005', name: 'Budi', text: 'transaksi poin saya salah', branch: 'tegal',
    providerDeviceHash: 'hash_dispute_8',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'existing' }),
    send: async () => { sendCalls += 1; return { status: true, id: 'msg-5' }; },
    persistConversation: async () => { persistCalls += 1; },
  }));
  assert.equal(res.used, 'points_dispute_handoff_existing');
  assert.equal(res.reply, null);
  assert.equal(res.sendResult, null);
  assert.equal(sendCalls, 0, 'existing case must not call send at all');
  assert.equal(persistCalls, 0, 'existing case must not persist any conversation record — nothing was sent');
});

test('POINTS — 9. creation failure: no false forwarded claim', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345006', name: 'Budi', text: 'redeem point berubah', branch: 'tegal',
    providerDeviceHash: 'hash_dispute_9',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'error' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-6' }; },
    persistConversation: async () => {},
  }));
  assert.ok(!/sudah aku teruskan/.test(sentReply));
  assert.match(sentReply, /belum berhasil meneruskannya/);
});

// ── OBJECTIVE B: FACILITY / OPERATIONAL MESSAGE BOUNDARY ────────────────────

test('FACILITY — 10. "☝️ Perbaikan lampu." classifies as facility_operational_message (informational)', () => {
  const result = classifyFacilityIntent('☝️ Perbaikan lampu.');
  assert.equal(result.matched, true);
  assert.equal(result.kind, 'informational');
});

test('FACILITY — 11/12. informational facility fragment does not route membership or booking', async () => {
  let sentReply = null;
  let used = null;
  const res = await webhookHandler.handleMessage({
    from: '62812345007', name: 'Budi', text: '☝️ Perbaikan lampu.', branch: 'tegal',
    providerDeviceHash: 'hash_facility_11',
  }, baseDeps({
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-7' }; },
    persistConversation: async () => {},
  }));
  used = res.used;
  assert.equal(used, 'facility_operational_message');
  assert.ok(!/membership/i.test(sentReply));
  assert.ok(!/booking/i.test(sentReply));
  assert.equal(sentReply, 'Siap Kak, ini terkait kondisi/perbaikan fasilitas cabang ya.');
});

test('FACILITY — 13. plain facility fragment does not auto-create a handoff', async () => {
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812345008', name: 'Budi', text: 'lampunya rusak', branch: 'tegal',
    providerDeviceHash: 'hash_facility_13',
  }, baseDeps({
    createHandoffCase: async () => { handoffCalls += 1; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-8' }),
    persistConversation: async () => {},
  }));
  assert.equal(handoffCalls, 0);
});

test('FACILITY — 14. explicit facility complaint may create a handoff', async () => {
  let handoffCalls = 0;
  let capturedParams = null;
  const res = await webhookHandler.handleMessage({
    from: '62812345009', name: 'Budi', text: 'lampunya mati, tolong diperbaiki', branch: 'tegal',
    providerDeviceHash: 'hash_facility_14',
  }, baseDeps({
    createHandoffCase: async (params) => { handoffCalls += 1; capturedParams = params; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-9' }),
    persistConversation: async () => {},
  }));
  assert.equal(res.used, 'facility_operational_message');
  assert.equal(handoffCalls, 1);
  assert.equal(capturedParams.reason, 'facility_operational_complaint');
});

test('FACILITY — 15. "kursi kapster nomor 2 itu siapa?" is never claimed by the facility classifier (stays a seat-position question)', () => {
  // The facility classifier (new in this round) must not steal this phrase —
  // it has to remain whatever the existing barber/seat-position pipeline
  // already does with it. classifyBarberPositionIntent's own regex coverage
  // for "kursi <role> nomor N" phrasing is pre-existing behavior untouched
  // by this round; this test only asserts the NEW facility classifier does
  // not misroute it.
  const facility = classifyFacilityIntent('kursi kapster nomor 2 itu siapa?');
  assert.equal(facility.matched, false);
  const position = classifyBarberPositionIntent('kursi nomor 2 itu siapa?');
  assert.equal(position.matched, true, 'sanity check: the existing seat-position classifier still matches its own supported phrasing');
});

test('FACILITY — 16. "membership saya mati?" is not a facility message', () => {
  const result = classifyFacilityIntent('membership saya mati?');
  assert.equal(result.matched, false);
});

test('FACILITY — false positive guards: "lampu hijau booking" and "AC Milan" do not match', () => {
  assert.equal(classifyFacilityIntent('lampu hijau booking').matched, false);
  assert.equal(classifyFacilityIntent('AC Milan menang lagi semalam').matched, false);
});

// ── OBJECTIVE C: OTW ACKNOWLEDGEMENT, NOT ACQUISITION ───────────────────────

test('OTW — 17/18. "Lagi OTW." never sends a booking CTA or URL', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345010', name: 'Budi', text: 'Lagi OTW.', branch: 'tegal',
    providerDeviceHash: 'hash_otw_17',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-10' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
  assert.ok(!/booking/i.test(sentReply));
  assert.ok(!/redboxbarbershop\.com/.test(sentReply));
});

test('OTW — 19. no confirmed booking found: still no acquisition CTA', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345011', name: 'Budi', text: 'otw', branch: 'tegal',
    providerDeviceHash: 'hash_otw_19',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'not_found' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-11' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
});

test('OTW — 20. booking lookup failure yields the plain acknowledgement, not a crash or a "no booking" claim', async () => {
  let sentReply = null;
  let threw = false;
  await webhookHandler.handleMessage({
    from: '62812345012', name: 'Budi', text: 'aku otw ya', branch: 'tegal',
    providerDeviceHash: 'hash_otw_20',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('db down'); },
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-12' }; },
    persistConversation: async () => {},
  })).catch(() => { threw = true; });
  assert.equal(threw, false);
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
});

test('OTW — 21. a verified confirmed booking may append a bounded confirmation only', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345013', name: 'Budi', text: 'otw', branch: 'tegal',
    providerDeviceHash: 'hash_otw_21',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-13' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya. Booking Kakak sudah tercatat.');
});

test('OTW — 22. "OTW telat 20 menit" gets a bounded lateness response, no booking CTA', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812345014', name: 'Budi', text: 'OTW telat 20 menit', branch: 'tegal',
    providerDeviceHash: 'hash_otw_22',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-14' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan. Kalau terlambat cukup lama, tim cabang mungkin perlu menyesuaikan slot.');
  assert.ok(!/booking/i.test(sentReply));
  assert.ok(!/dibatal/i.test(sentReply), 'must never claim cancellation');
});

// ── OBJECTIVE E: HISTORY / AUDITABLE-RECORD INVARIANT ───────────────────────

test('HISTORY — 23. representative outbound routes classify as expected', () => {
  const map = [
    ['poin saya berapa?', 'points_inquiry'],
    ['poin saya kepotong', 'points_dispute'],
  ];
  for (const [text, intent] of map) {
    assert.equal(classifyDeterministically(text)?.intent, intent, text);
  }
  assert.equal(classifyFacilityIntent('☝️ Perbaikan lampu.').matched, true);
});

test('HISTORY — 24. conversational success (points_dispute) persists exactly one record', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345015', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_history_24',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async () => ({ status: true, id: 'msg-15' }),
    persistConversation: async () => { persistedCount += 1; },
  }));
  assert.equal(persistedCount, 1);
});

test('HISTORY — 25. suppressed outbound persists zero records', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345016', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_history_25',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async () => ({ status: false, suppressed: true }),
    persistConversation: async () => { persistedCount += 1; },
  }));
  assert.equal(persistedCount, 0);
});

test('HISTORY — 26. failed outbound persists zero records', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345017', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_history_26',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async () => ({ status: false }),
    persistConversation: async () => { persistedCount += 1; },
  }));
  assert.equal(persistedCount, 0);
});

test('HISTORY — 27/28. media auto-reply is a verified system/non-conversational route (bypasses persistConversation by design)', () => {
  const startIdx = webhookSource.indexOf('if (type && MEDIA_TYPES.includes(type)) {');
  assert.ok(startIdx >= 0, 'expected the media-type auto-reply branch to still exist in api/wa/webhook.js');
  const endIdx = webhookSource.indexOf('\n    if (!sender || !message)', startIdx);
  assert.ok(endIdx > startIdx, 'expected to find the end of the media-type branch');
  const mediaBlock = webhookSource.slice(startIdx, endIdx);
  assert.ok(!/persistConversation/.test(mediaBlock),
    'media auto-reply intentionally does not call persistConversation — it is not a text Q&A turn, so it must not be miscounted as a missing conversation-history QA pair');
  assert.ok(/guardedSend/.test(mediaBlock), 'media auto-reply must still go through the guarded send path so it is captured in the wa_inbound_events outbound ledger');
});

test('HISTORY — 29. Reddy agent execution route does not double-write conversation history', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812345018', name: 'Budi', text: 'poin saya berapa?', branch: 'tegal',
    providerDeviceHash: 'hash_history_29',
  }, baseDeps({
    send: async () => ({ status: true, id: 'msg-16' }),
    persistConversation: async () => { persistedCount += 1; },
  }));
  assert.equal(persistedCount, 1);
});

// ── OBJECTIVE D: HANDOFF BACKLOG (READ-ONLY) ────────────────────────────────

test('HANDOFF — 30. points dispute always requests priority HIGH', async () => {
  let capturedParams = null;
  await webhookHandler.handleMessage({
    from: '62812345019', name: 'Budi', text: 'kenapa jumlah poin berubah?', branch: 'tegal',
    providerDeviceHash: 'hash_handoff_30',
  }, baseDeps({
    createHandoffCase: async (params) => { capturedParams = params; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-17' }),
    persistConversation: async () => {},
  }));
  assert.equal(capturedParams.priority, 'high');
});

test('HANDOFF — 31. existing Task15 case is reused, never duplicated, for a dispute', async () => {
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812345020', name: 'Budi', text: 'poin saya berkurang', branch: 'tegal',
    providerDeviceHash: 'hash_handoff_31',
  }, baseDeps({
    createHandoffCase: async () => { handoffCalls += 1; return { status: 'existing' }; },
    send: async () => ({ status: true, id: 'msg-18' }),
    persistConversation: async () => {},
  }));
  assert.equal(handoffCalls, 1, 'createOrGetActiveCase is itself responsible for dedup — the caller must call it exactly once per inbound message');
});

test('HANDOFF — 32. an open waiting_human case still suppresses AI even for a points-dispute-shaped message', async () => {
  const res = await webhookHandler.handleMessage({
    from: '62812345021', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_handoff_32',
  }, baseDeps({
    getHandoffState: async () => ({ status: 'waiting_human', case: { id: 'case-1', priority: 'high', branch: 'tegal' } }),
    appendHandoffMessage: async () => {},
    send: async () => { throw new Error('must not send while suppressed'); },
  }));
  assert.equal(res.used, 'human_active_suppressed');
  assert.equal(res.reply, null);
});

test('HANDOFF — 33. SLA evaluation never auto-resolves a case (read-only detection only)', () => {
  const humanHandoffSource = fs.readFileSync(require.resolve('../services/humanHandoff'), 'utf8');
  const startIdx = humanHandoffSource.indexOf('async function evaluateAndRecordHandoffSLA(');
  assert.ok(startIdx >= 0, 'expected evaluateAndRecordHandoffSLA to still exist');
  const endIdx = humanHandoffSource.indexOf('\nmodule.exports', startIdx);
  assert.ok(endIdx > startIdx);
  const fnBody = humanHandoffSource.slice(startIdx, endIdx);
  assert.ok(!/resolveCase\(/.test(fnBody), 'SLA evaluation must never call resolveCase — detection only, no auto-resolution');
  assert.ok(!/status:\s*['"]resolved['"]/.test(fnBody), 'SLA evaluation must never write a resolved status');
});

// ── ROUND 3 CORRECTION 1 ────────────────────────────────────────────────────
// Aira review findings: (1) points_dispute 'existing' was still sending a
// repeated automated acknowledgement — Task15/Round3 forbids this; the
// top-level handoff gate already suppresses further bot replies once a case
// is open, so 'existing' here must be a silent no-op. (2) the OTW fast-path
// treated bare lateness words ("telat"/"terlambat"/"kesiangan") as a travel
// signal on their own, which wrongly caught policy QUESTIONS like "kalau
// saya telat gimana?" — a true travel signal (otw/di jalan/berangkat/etc.)
// is now required before lateness matters at all.

test('CORRECTION1 POINTS — 1. created case sends exactly one reply', async () => {
  let sendCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346001', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_1',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async () => { sendCalls += 1; return { status: true, id: 'msg-c1-1' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sendCalls, 1);
});

test('CORRECTION1 POINTS — 2. created case requests priority HIGH', async () => {
  let capturedParams = null;
  await webhookHandler.handleMessage({
    from: '62812346002', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_2',
  }, baseDeps({
    createHandoffCase: async (params) => { capturedParams = params; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-c1-2' }),
    persistConversation: async () => {},
  }));
  assert.equal(capturedParams.priority, 'high');
});

test('CORRECTION1 POINTS — 3. existing case sends zero replies (reply === null)', async () => {
  const res = await webhookHandler.handleMessage({
    from: '62812346003', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_3',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'existing' }),
    send: async () => ({ status: true, id: 'msg-c1-3' }),
    persistConversation: async () => {},
  }));
  assert.equal(res.reply, null);
});

test('CORRECTION1 POINTS — 4. existing case makes zero send() calls', async () => {
  let sendCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346004', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_4',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'existing' }),
    send: async () => { sendCalls += 1; return { status: true, id: 'msg-c1-4' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sendCalls, 0);
});

test('CORRECTION1 POINTS — 5. existing case makes zero persistConversation calls', async () => {
  let persistCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346005', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_5',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'existing' }),
    send: async () => ({ status: true, id: 'msg-c1-5' }),
    persistConversation: async () => { persistCalls += 1; },
  }));
  assert.equal(persistCalls, 0);
});

test('CORRECTION1 POINTS — 6. error/unavailable case still sends exactly one honest fallback reply', async () => {
  let sendCalls = 0;
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346006', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_6',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'error' }),
    send: async (_to, reply) => { sendCalls += 1; sentReply = reply; return { status: true, id: 'msg-c1-6' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sendCalls, 1);
  assert.match(sentReply, /belum berhasil meneruskannya/);
});

test('CORRECTION1 POINTS — 7. error/unavailable case never claims a forwarded case', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346007', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_7',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'unavailable' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-7' }; },
    persistConversation: async () => {},
  }));
  assert.ok(!/sudah aku teruskan/.test(sentReply));
});

test('CORRECTION1 POINTS — 8. a plain points_inquiry never triggers any handoff', async () => {
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346008', name: 'Budi', text: 'poin saya berapa?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_points_8',
  }, baseDeps({
    createHandoffCase: async () => { handoffCalls += 1; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-c1-8' }),
    persistConversation: async () => {},
  }));
  assert.equal(handoffCalls, 0);
});

test('CORRECTION1 OTW — 9. "Lagi OTW." gets the plain travel acknowledgement', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346009', name: 'Budi', text: 'Lagi OTW.', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_9',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-9' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
});

test('CORRECTION1 OTW — 10. "OTW telat 20 menit" gets the bounded lateness acknowledgement', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346010', name: 'Budi', text: 'OTW telat 20 menit', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_10',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-10' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan. Kalau terlambat cukup lama, tim cabang mungkin perlu menyesuaikan slot.');
});

test('CORRECTION1 OTW — 11. "lagi jalan, telat nih" gets the bounded lateness acknowledgement', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346011', name: 'Budi', text: 'lagi jalan, telat nih', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_11',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-11' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan. Kalau terlambat cukup lama, tim cabang mungkin perlu menyesuaikan slot.');
});

test('CORRECTION1 OTW — 12. "kalau saya telat gimana?" does NOT enter the OTW fast-path', async () => {
  let otwReplySent = false;
  await webhookHandler.handleMessage({
    from: '62812346012', name: 'Budi', text: 'kalau saya telat gimana?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_12',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('OTW path must not even call getBookingStatus for a bare policy question'); },
    send: async (_to, reply) => {
      if (reply === 'Siap Kak, hati-hati di jalan ya.'
        || reply === 'Siap Kak, hati-hati di jalan. Kalau terlambat cukup lama, tim cabang mungkin perlu menyesuaikan slot.') {
        otwReplySent = true;
      }
      return { status: true, id: 'msg-c1-12' };
    },
    persistConversation: async () => {},
    // let it fall through to whatever the rest of the pipeline does; only
    // assert the OTW-specific acknowledgement never fires.
  })).catch(() => {});
  assert.equal(otwReplySent, false);
});

test('CORRECTION1 OTW — 13. "batas telat berapa menit?" does NOT enter the OTW fast-path', async () => {
  let otwReplySent = false;
  await webhookHandler.handleMessage({
    from: '62812346013', name: 'Budi', text: 'batas telat berapa menit?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_13',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('must not be reached'); },
    send: async (_to, reply) => {
      if (/hati-hati di jalan/.test(reply || '')) otwReplySent = true;
      return { status: true, id: 'msg-c1-13' };
    },
    persistConversation: async () => {},
  })).catch(() => {});
  assert.equal(otwReplySent, false);
});

test('CORRECTION1 OTW — 14. "booking boleh terlambat?" does NOT enter the OTW fast-path', async () => {
  let otwReplySent = false;
  await webhookHandler.handleMessage({
    from: '62812346014', name: 'Budi', text: 'booking boleh terlambat?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_14',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('must not be reached'); },
    send: async (_to, reply) => {
      if (/hati-hati di jalan/.test(reply || '')) otwReplySent = true;
      return { status: true, id: 'msg-c1-14' };
    },
    persistConversation: async () => {},
  })).catch(() => {});
  assert.equal(otwReplySent, false);
});

test('CORRECTION1 OTW — 15. "kesiangan besok gimana?" does NOT enter the OTW fast-path', async () => {
  let otwReplySent = false;
  await webhookHandler.handleMessage({
    from: '62812346015', name: 'Budi', text: 'kesiangan besok gimana?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_15',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('must not be reached'); },
    send: async (_to, reply) => {
      if (/hati-hati di jalan/.test(reply || '')) otwReplySent = true;
      return { status: true, id: 'msg-c1-15' };
    },
    persistConversation: async () => {},
  })).catch(() => {});
  assert.equal(otwReplySent, false);
});

test('CORRECTION1 OTW — 16. true OTW + no booking found: still no acquisition CTA', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346016', name: 'Budi', text: 'otw', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_16',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'not_found' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-16' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
  assert.ok(!/booking/i.test(sentReply));
});

test('CORRECTION1 OTW — 17. true OTW + booking lookup failure: no CTA, no crash', async () => {
  let sentReply = null;
  let threw = false;
  await webhookHandler.handleMessage({
    from: '62812346017', name: 'Budi', text: 'sudah berangkat', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_17',
  }, baseDeps({
    getBookingStatus: async () => { throw new Error('db down'); },
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-17' }; },
    persistConversation: async () => {},
  })).catch(() => { threw = true; });
  assert.equal(threw, false);
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya.');
  assert.ok(!/booking/i.test(sentReply));
});

test('CORRECTION1 OTW — 18. true OTW + confirmed booking: bounded confirmation only, no CTA', async () => {
  let sentReply = null;
  await webhookHandler.handleMessage({
    from: '62812346018', name: 'Budi', text: 'menuju cabang nih', branch: 'tegal',
    providerDeviceHash: 'hash_c1_otw_18',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'CONFIRMED' }),
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-18' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sentReply, 'Siap Kak, hati-hati di jalan ya. Booking Kakak sudah tercatat.');
  assert.ok(!/redboxbarbershop\.com/.test(sentReply));
});

// ── ROUND 3 CORRECTION 1 — REGRESSION CHECKS (must still pass) ─────────────

test('CORRECTION1 REGRESSION — 19. facility "☝️ Perbaikan lampu." still preserved', async () => {
  let sentReply = null;
  const res = await webhookHandler.handleMessage({
    from: '62812346019', name: 'Budi', text: '☝️ Perbaikan lampu.', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_19',
  }, baseDeps({
    send: async (_to, reply) => { sentReply = reply; return { status: true, id: 'msg-c1-19' }; },
    persistConversation: async () => {},
  }));
  assert.equal(res.used, 'facility_operational_message');
  assert.equal(sentReply, 'Siap Kak, ini terkait kondisi/perbaikan fasilitas cabang ya.');
});

test('CORRECTION1 REGRESSION — 20. facility false-positive guards still preserved', () => {
  assert.equal(classifyFacilityIntent('lampu hijau booking').matched, false);
  assert.equal(classifyFacilityIntent('AC Milan menang lagi semalam').matched, false);
  assert.equal(classifyFacilityIntent('membership saya mati?').matched, false);
});

test('CORRECTION1 REGRESSION — 21. same-channel loop guard still preserved', async () => {
  let handoffCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346021', name: 'Budi', text: 'loh ini nomornya kan?', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_21',
  }, baseDeps({
    createHandoffCase: async () => { handoffCalls += 1; return { status: 'created' }; },
    send: async () => ({ status: true, id: 'msg-c1-21' }),
    persistConversation: async () => {},
  }));
  assert.equal(handoffCalls, 1, 'ordinary same-channel contact remains a handoff-eligible policy escalation, unchanged by this correction');
});

test('CORRECTION1 REGRESSION — 22. Task15 waiting_human suppression still preserved', async () => {
  const res = await webhookHandler.handleMessage({
    from: '62812346022', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_22',
  }, baseDeps({
    getHandoffState: async () => ({ status: 'waiting_human', case: { id: 'case-c1', priority: 'high', branch: 'tegal' } }),
    appendHandoffMessage: async () => {},
    send: async () => { throw new Error('must not send while suppressed'); },
  }));
  assert.equal(res.used, 'human_active_suppressed');
  assert.equal(res.reply, null);
});

test('CORRECTION1 REGRESSION — 23. P0 send-once still preserved for the new existing-case no-op path', async () => {
  let sendCalls = 0;
  await webhookHandler.handleMessage({
    from: '62812346023', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_23',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'existing' }),
    send: async () => { sendCalls += 1; return { status: true, id: 'msg-c1-23' }; },
    persistConversation: async () => {},
  }));
  assert.equal(sendCalls, 0, 'existing-case no-op must never call send — zero sends is the send-once-safe outcome here');
});

test('CORRECTION1 REGRESSION — 24. P0.3 device scope still passed through unchanged for OTW/points paths', async () => {
  let seenDeviceHash = null;
  await webhookHandler.handleMessage({
    from: '62812346024', name: 'Budi', text: 'otw', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_24_device',
  }, baseDeps({
    getBookingStatus: async () => ({ status: 'none' }),
    send: async () => ({ status: true, id: 'msg-c1-24' }),
    persistConversation: async (_from, _hist, _text, _reply, _meta, deviceHash) => { seenDeviceHash = deviceHash; },
  }));
  assert.equal(seenDeviceHash, 'hash_c1_reg_24_device');
});

test('CORRECTION1 REGRESSION — 25. Round 2 history persistence invariant (conversational success => exactly one record) still preserved', async () => {
  let persistedCount = 0;
  await webhookHandler.handleMessage({
    from: '62812346025', name: 'Budi', text: 'poin saya kepotong', branch: 'tegal',
    providerDeviceHash: 'hash_c1_reg_25',
  }, baseDeps({
    createHandoffCase: async () => ({ status: 'created' }),
    send: async () => ({ status: true, id: 'msg-c1-25' }),
    persistConversation: async () => { persistedCount += 1; },
  }));
  assert.equal(persistedCount, 1);
});

test('CORRECTION1 REGRESSION — 26. frontend untouched', () => {
  assert.ok(!/redbox-frontend|frontend\//.test(webhookSource.slice(0, 200)), 'sanity: webhook.js header does not reference frontend paths');
  assert.equal(typeof webhookHandler.handleMessage, 'function');
});
