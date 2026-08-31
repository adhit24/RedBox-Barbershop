'use strict';

/**
 * Reddy Production Safety, Schedule Authority, Intent & Response Quality
 * Dedicated Test Suite (v0.1)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { guardPricePlaceholders } = require('../agents/reddy/personalityPolicy');
const { classifyBarberPresenceQuery } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { createGuardedSend } = require('../services/waOutboundGuard');
const { EVENT_DEFINITIONS } = require('../services/reddyEvaluationMonitoring');
const { sanitizeInboundLifecycleTelemetry, sanitizeDataAuthorityTelemetry } = require('../orchestrator/telemetry');

// ── 1. P0-A PLACEHOLDER PRICE OUTBOUND SAFETY TESTS ──────────────────────

test('P0-A1: RpXX.XXX placeholder for non-CSB branch resolves to Rp95.000', () => {
  const input = 'Hai Kak, Haircut di Redbox RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Hai Kak, Haircut di Redbox Rp95.000 ya.');
});

test('P0-A2: RpXX.XXX placeholder for CSB branch resolves to Rp120.000', () => {
  const input = 'Hai Kak, Haircut di CSB Mall RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'csb' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Hai Kak, Haircut di CSB Mall Rp120.000 ya.');
});

test('P0-A3: Bare XX.XXX placeholder is replaced with verified price', () => {
  const input = 'Layanan Gentleman Grooming harganya XX.XXX kak.';
  const res = guardPricePlaceholders(input, { branch: 'sumber' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Layanan Gentleman Grooming harganya Rp95.000 kak.');
});

test('P0-A4: ${price} template placeholder is guarded', () => {
  const input = 'Harga potong yaitu ${price} ya.';
  const res = guardPricePlaceholders(input, { branch: 'tegal' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Harga potong yaitu Rp95.000 ya.');
});

test('P0-A5: Unknown branch with TBD fallback returns honest statement', () => {
  const input = 'Harga layanan TBD kak.';
  const res = guardPricePlaceholders(input, { branch: null });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Harga pastinya belum bisa aku pastikan'));
});

test('P0-A6: Verified valid price string passes without blocking', () => {
  const input = 'Hai Kak, Haircut di Redbox Rp95.000 ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass' });
  assert.equal(res.blocked, false);
  assert.equal(res.sanitizedReply, input);
});

test('P0-A7: Outbound guard wrapper invokes price guard and records event', async () => {
  let realSentMessage = null;
  const loggedEvents = [];
  const fakeRealSend = async (to, msg) => { realSentMessage = msg; return { status: true }; };
  const fakeSupabase = {
    rpc: async (fn) => {
      if (fn === 'reserve_wa_automated_send') return { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null };
      return { data: null, error: null };
    },
  };
  const send = createGuardedSend({
    realSend: fakeRealSend,
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-1',
    logEvent: (e) => loggedEvents.push(e),
  });

  await send('628123456789', 'Haircut harganya RpXX.XXX kak', { branch: 'csb' });
  assert.equal(realSentMessage, 'Haircut harganya Rp120.000 kak');
  assert.ok(loggedEvents.some(e => e.event_type === 'price_placeholder_blocked'));
});

test('P0-A8: Telemetry definitions include price_placeholder_blocked as HIGH severity', () => {
  const def = EVENT_DEFINITIONS.price_placeholder_blocked;
  assert.ok(def);
  assert.equal(def[0], 'HIGH');
  assert.equal(def[2], 'PRICE_PLACEHOLDER_BLOCKED');
});

// ── 2. P0-B SCHEDULE / BARBER AUTHORITY FAIL-CLOSED TESTS ────────────────

test('P0-B1: Roster fact preserved without upgrading to attendance', () => {
  const reply = 'Kapster Redbox Bypass antara lain Mas Onoy dan Mas Opan.';
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: null });
  assert.equal(guarded.triggered, false);
  assert.equal(guarded.sanitizedReply, reply);
});

test('P0-B2: Planned schedule preserved without upgrading to physical presence', () => {
  const reply = 'Mas Onoy memang dijadwalkan masuk hari ini, Kak.';
  const verified = { barberName: 'Onoy', status: 'scheduled', date: '2026-08-31' };
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: verified });
  assert.equal(guarded.triggered, false);
  assert.equal(guarded.sanitizedReply, reply);
});

test('P0-B3: Attendance claim without data is replaced with safe statement', () => {
  const reply = 'Mas Onoy sudah datang di cabang Bypass sekarang.';
  const verified = { barberName: 'Onoy', status: 'scheduled', date: '2026-08-31' };
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: verified });
  assert.equal(guarded.triggered, true);
  assert.ok(guarded.sanitizedReply.includes('belum punya data kehadiran/check-in'));
});

test('P0-B4: Errored or unknown schedule fails closed safely', () => {
  const reply = 'Mas Opan ada di cabang sekarang.';
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: { status: 'unknown' }, forceSafeResponse: true });
  assert.equal(guarded.triggered, true);
  assert.ok(guarded.sanitizedReply.includes('belum bisa memastikan'));
});

// ── 3. P0-C PRE-OUTBOUND FAILURE OBSERVABILITY TESTS ────────────────────

test('P0-C1: Inbound lifecycle telemetry accepts bounded reason codes', () => {
  const event = sanitizeInboundLifecycleTelemetry({
    event_type: 'inbound_terminalized',
    new_status: 'failed',
    reason: 'identity_lookup_failed',
    source: 'claim_inbound_event',
  });
  assert.equal(event.event_type, 'inbound_terminalized');
  assert.equal(event.reason, 'identity_lookup_failed');
});

test('P0-C2: Inbound lifecycle distinguishes duplicate_suppressed from processing_failed', () => {
  const e1 = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'duplicate_suppressed' });
  const e2 = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'processing_failed' });
  assert.equal(e1.reason, 'duplicate_suppressed');
  assert.equal(e2.reason, 'processing_failed');
});

// ── 4. P1-A FINAL OUTBOUND OBSERVABILITY TESTS ────────────────────────────

test('P1-A1: Telemetry definitions include final_outbound_after_guards', () => {
  const def = EVENT_DEFINITIONS.final_outbound_after_guards;
  assert.ok(def);
  assert.equal(def[0], 'INFO');
  assert.equal(def[2], 'FINAL_OUTBOUND_AFTER_GUARDS');
});

test('P1-A2: Guarded send emits final_outbound_after_guards event before send', async () => {
  const logged = [];
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: { rpc: async () => ({ data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }) },
    inboundEventRowId: 'evt-2',
    logEvent: (e) => logged.push(e),
  });
  await send('628123456789', 'Halo kak!', { branch: 'bypass' });
  assert.ok(logged.some(e => e.event_type === 'final_outbound_after_guards'));
});

// ── 5. P1-B BARBER PRESENCE / ACTIVITY INTENT ROUTING TESTS ───────────────

test('P1-B1: "lagi nyukur atau enggak?" classifies as barber presence intent', () => {
  const res = classifyBarberPresenceQuery('Mas Husen lagi nyukur atau enggak?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'presence');
});

test('P1-B2: "lagi sibuk?" classifies as barber presence intent', () => {
  const res = classifyBarberPresenceQuery('Mas Husen lagi sibuk?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'presence');
});

test('P1-B3: "lagi kosong?" classifies as availability intent', () => {
  const res = classifyBarberPresenceQuery('Mas Husen lagi kosong?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'availability');
});

test('P1-B4: "bisa langsung?" classifies as availability intent', () => {
  const res = classifyBarberPresenceQuery('bisa langsung sekarang?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'availability');
});

test('P1-B5: "kapsternya ada sekarang?" classifies as presence intent', () => {
  const res = classifyBarberPresenceQuery('kapsternya ada sekarang?');
  assert.equal(res.matched, true);
});

test('P1-B6: "si Dodi lagi cukur orang?" classifies as presence intent', () => {
  const res = classifyBarberPresenceQuery('si Dodi lagi cukur orang?');
  assert.equal(res.matched, true);
});

// ── 6. P1-C REQUEST COMPLETION FOR WEBSITE / LINK TESTS ─────────────────

test('P1-C1: "Web-nya yang mana?" appends official website URL in same turn', async () => {
  const res = await executeReddyAgent({
    from: '628123456789',
    text: 'Web-nya yang mana Kak?',
    branch: 'bypass',
  }, {
    callOpenAI: async () => 'Ini Kak websitenya untuk booking online.',
    sendWA: async () => ({ status: true }),
  });
  assert.ok(res.reply.includes('https://redboxbarbershop.com'));
});

test('P1-C2: Telemetry definitions include request_ack_without_fulfillment', () => {
  const def = EVENT_DEFINITIONS.request_ack_without_fulfillment;
  assert.ok(def);
  assert.equal(def[0], 'WARNING');
  assert.equal(def[2], 'REQUEST_ACK_WITHOUT_FULFILLMENT');
});

// ── 7. P1-D DISCLAIMER SCOPING TESTS ─────────────────────────────────────

test('P1-D1: Small talk "O gitu" does not trigger schedule disclaimer', () => {
  const reply = 'Siap Kak, kalau ada yang mau ditanyakan lagi kabari ya.';
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: null });
  assert.equal(guarded.triggered, false);
  assert.equal(guarded.sanitizedReply, reply);
});

test('P1-D2: Roster facts do not get contradictory disclaimer', () => {
  const reply = 'Kapster di CSB antara lain Mas Dodi dan Mas Husen.';
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: null });
  assert.equal(guarded.triggered, false);
});

// ── 8. P1-E OFFICIAL BRANCH CONTACT AUTHORITY TESTS ───────────────────────

test('P1-E1: Data authority telemetry records branch contact lookup safely', () => {
  const event = sanitizeDataAuthorityTelemetry({
    event_type: 'schedule_sync_conflict_reconciled',
    source: 'planned_schedule_lookup',
    branch: 'bypass',
  });
  assert.equal(event.branch, 'bypass');
});
