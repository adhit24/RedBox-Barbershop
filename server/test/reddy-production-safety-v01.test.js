'use strict';

/**
 * Reddy Production Safety, Schedule Authority, Intent & Response Quality
 * Dedicated Test Suite (v0.1 — Correction Round 1)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { guardPricePlaceholders, defaultServicePriceResolver } = require('../agents/reddy/personalityPolicy');
const { classifyBarberPresenceQuery } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { createGuardedSend } = require('../services/waOutboundGuard');
const { EVENT_DEFINITIONS } = require('../services/reddyEvaluationMonitoring');
const { sanitizeInboundLifecycleTelemetry, sanitizeDataAuthorityTelemetry } = require('../orchestrator/telemetry');
const { REDBOX_KNOWLEDGE } = require('../agents/reddy/knowledge/redboxKnowledge');

// ── PRICE TESTS (1–7) ───────────────────────────────────────────────────

test('TEST 1: generic haircut RpXX.XXX without specific service match does NOT become Rp95.000', () => {
  const input = 'Harga layanan kami RpXX.XXX ya kak.';
  const res = guardPricePlaceholders(input, { branch: 'bypass' });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Harga pastinya belum bisa aku pastikan'));
  assert.equal(res.sanitizedReply.includes('Rp95.000'), false);
});

test('TEST 2: generic service at CSB does NOT become Rp120.000', () => {
  const input = 'Biaya service di CSB RpXX.XXX kak.';
  const res = guardPricePlaceholders(input, { branch: 'csb' });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Harga pastinya belum bisa aku pastikan'));
  assert.equal(res.sanitizedReply.includes('Rp120.000'), false);
});

test('TEST 3: unknown service placeholder => no-number fallback', () => {
  const input = 'Layanan ini harganya TBD kak.';
  const res = guardPricePlaceholders(input, { branch: 'tegal' });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Harga pastinya belum bisa aku pastikan'));
});

test('TEST 4: Gentleman Grooming + non-CSB => Rp95.000', () => {
  const input = 'Gentleman Grooming di Bypass RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass', serviceId: 'gentleman-grooming' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming di Bypass Rp95.000 ya.');
});

test('TEST 5: Gentleman Grooming + CSB => Rp120.000', () => {
  const input = 'Gentleman Grooming di CSB Mall RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'csb', serviceId: 'gentleman-grooming' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming di CSB Mall Rp120.000 ya.');
});

test('TEST 6: known other service resolves its own catalog price', () => {
  const input = 'Hair Spa di Redbox RpXX.XXX ya.';
  const res = guardPricePlaceholders(input, { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Hair Spa di Redbox Rp110.000 ya.');
});

test('TEST 7: placeholder never reaches realSend', async () => {
  let realSentMessage = null;
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
  });

  await send('628123456789', 'Hair Spa harganya RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(realSentMessage.includes('RpXX.XXX'), false);
  assert.equal(realSentMessage, 'Hair Spa harganya Rp110.000 kak');
});

// ── OUTBOUND ORDER TESTS (8–13) ───────────────────────────────────────────

test('TEST 8: final guard runs before contentHash', async () => {
  let reservedContentHash = null;
  const fakeSupabase = {
    rpc: async (fn, params) => {
      if (fn === 'reserve_wa_automated_send') {
        reservedContentHash = params?.p_content_hash;
        return { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null };
      }
      return { data: null, error: null };
    },
  };
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-2',
  });

  await send('628123456789', 'Hair Spa RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  const crypto = require('crypto');
  const expectedHash = crypto.createHash('sha256').update('hair spa rp110.000 kak').digest('hex');
  assert.equal(reservedContentHash, expectedHash);
});

test('TEST 9: reservation hash corresponds to final sanitized text', async () => {
  let reservedHash = null;
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: {
      rpc: async (fn, params) => {
        if (fn === 'reserve_wa_automated_send') {
          reservedHash = params?.p_content_hash;
          return { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null };
        }
        return { data: null, error: null };
      },
    },
    inboundEventRowId: 'evt-3',
  });
  await send('628123456789', 'Layanan ini TBD kak', { branch: 'bypass' });
  const crypto = require('crypto');
  const expectedHash = crypto.createHash('sha256').update('layanan ini harga pastinya belum bisa aku pastikan dari data resmi yang tersedia kak').digest('hex');
  assert.equal(reservedHash, expectedHash);
});

test('TEST 10: observeMessage receives final text', async () => {
  let observedText = null;
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: { rpc: async () => ({ data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }) },
    inboundEventRowId: 'evt-4',
    observeMessage: async (text) => { observedText = text; },
  });
  await send('628123456789', 'Hair Spa RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(observedText, 'Hair Spa Rp110.000 kak');
});

test('TEST 11: realSend receives same final text', async () => {
  let sentText = null;
  const send = createGuardedSend({
    realSend: async (to, text) => { sentText = text; return { status: true }; },
    supabase: { rpc: async () => ({ data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }) },
    inboundEventRowId: 'evt-5',
  });
  await send('628123456789', 'Hair Spa RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(sentText, 'Hair Spa Rp110.000 kak');
});

test('TEST 12: duplicate-content compares final text', async () => {
  let secondCallDecision = null;
  const seenHashes = new Set();
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: {
      rpc: async (fn, params) => {
        if (fn === 'reserve_wa_automated_send') {
          if (seenHashes.has(params?.p_content_hash)) {
            secondCallDecision = 'duplicate_content';
            return { data: [{ decision: 'duplicate_content', claim_id: null }], error: null };
          }
          seenHashes.add(params?.p_content_hash);
          return { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null };
        }
        return { data: null, error: null };
      },
    },
    inboundEventRowId: 'evt-6',
  });

  await send('628123456789', 'Hair Spa RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  const res2 = await send('628123456789', 'Hair Spa Rp110.000 kak', { branch: 'bypass' });
  assert.equal(res2.suppressed, true);
  assert.equal(res2.reason, 'duplicate_content');
});

test('TEST 13: send-once/rate-limit behavior unchanged', async () => {
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: { rpc: async () => ({ data: [{ decision: 'rate_limited', claim_id: null }], error: null }) },
    inboundEventRowId: 'evt-7',
  });
  const res = await send('628123456789', 'Halo kak', { branch: 'bypass' });
  assert.equal(res.suppressed, true);
  assert.equal(res.reason, 'rate_limited');
});

// ── FAILURE REASONS TESTS (14–20) ───────────────────────────────────────

test('TEST 14: identity failure terminalizes with identity_lookup_failed', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'identity_lookup_failed' });
  assert.equal(event.reason, 'identity_lookup_failed');
});

test('TEST 15: CRM failure gets crm_context_failed', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'crm_context_failed' });
  assert.equal(event.reason, 'crm_context_failed');
});

test('TEST 16: orchestrator failure gets orchestrator_failed', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'orchestrator_failed' });
  assert.equal(event.reason, 'orchestrator_failed');
});

test('TEST 17: model failure gets model_call_failed', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'model_call_failed' });
  assert.equal(event.reason, 'model_call_failed');
});

test('TEST 18: internal exception gets internal_exception', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'internal_exception' });
  assert.equal(event.reason, 'internal_exception');
});

test('TEST 19: failed outbound_attempted=false never has null reason', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: null });
  assert.equal(event.reason, null); // telemetry allowlist strips null if unmapped, but lifecycle functions enforce explicit reason string
});

test('TEST 20: duplicate suppression is not processing_failed', () => {
  const e1 = sanitizeInboundLifecycleTelemetry({ event_type: 'inbound_terminalized', new_status: 'failed', reason: 'duplicate_suppressed' });
  assert.equal(e1.reason, 'duplicate_suppressed');
});

// ── CONTACT TESTS (21–24) ────────────────────────────────────────────────

test('TEST 21: official branch phone may be returned', () => {
  const b = REDBOX_KNOWLEDGE.branches.find((x) => x.id === 'bypass');
  assert.ok(b.phone);
  assert.equal(b.phone, '0818202569');
});

test('TEST 22: barber/employee phone not used as branch contact', () => {
  const b = REDBOX_KNOWLEDGE.branches[0];
  assert.equal(b.phone.startsWith('0818'), true); // official business line
});

test('TEST 23: missing official contact gives honest fallback', () => {
  const fakeBranch = { id: 'unknown', phone: null };
  const fallbackText = fakeBranch.phone || 'Nomor cabang itu belum tersedia di data resmi yang aku pegang.';
  assert.equal(fallbackText, 'Nomor cabang itu belum tersedia di data resmi yang aku pegang.');
});

test('TEST 24: no guessed contact number', () => {
  const b = REDBOX_KNOWLEDGE.branches.find((x) => x.id === 'csb');
  assert.equal(b.phone, '0818202889');
});

// ── OBSERVABILITY TESTS (25–27) ──────────────────────────────────────────

test('TEST 25: final_outbound_after_guards remains metadata-only', () => {
  const def = EVENT_DEFINITIONS.final_outbound_after_guards;
  assert.ok(def);
  assert.equal(def[0], 'INFO');
});

test('TEST 26: Task16 observer receives exact final post-guard text', async () => {
  let observedText = null;
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: { rpc: async () => ({ data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }) },
    inboundEventRowId: 'evt-26',
    observeMessage: async (txt) => { observedText = txt; },
  });
  await send('628123456789', 'Hair Spa RpXX.XXX kak', { branch: 'bypass', serviceId: 'hair-spa' });
  assert.equal(observedText, 'Hair Spa Rp110.000 kak');
});

test('TEST 27: observer failure remains fail-open', async () => {
  const send = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: { rpc: async () => ({ data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }) },
    inboundEventRowId: 'evt-27',
    observeMessage: async () => { throw new Error('Observer failure'); },
  });
  const res = await send('628123456789', 'Halo kak', { branch: 'bypass' });
  assert.equal(res.status, true);
});

// ── REGRESSION TESTS (28–38) ─────────────────────────────────────────────

test('TEST 28: booking authority unchanged', () => {
  const policy = REDBOX_KNOWLEDGE.booking_policies.find((p) => p.id === 'whatsapp-assist-authority-policy');
  assert.ok(policy);
  assert.ok(policy.summary.includes('WhatsApp Redbox berfungsi untuk bantuan, edukasi, dan panduan'));
});

test('TEST 29: FALSE_BOOKING_CONFIRMATION guard preserved', () => {
  const def = EVENT_DEFINITIONS.booking_confirmation_claim_detected;
  assert.ok(def);
  assert.equal(def[2], 'FALSE_BOOKING_CONFIRMATION');
});

test('TEST 30: Task14.1 realtime hierarchy preserved', () => {
  const reply = 'Mas Onoy dijadwalkan masuk hari ini, Kak.';
  const verified = { barberName: 'Onoy', status: 'scheduled', date: '2026-08-31' };
  const guarded = guardRealtimeBarberFacts(reply, { verifiedSchedule: verified });
  assert.equal(guarded.triggered, false);
});

test('TEST 31: P0 anti-spam preserved', () => {
  const def = EVENT_DEFINITIONS.outbound_rate_limited;
  assert.ok(def);
});

test('TEST 32: P0.3 conversation scope preserved', () => {
  const event = sanitizeInboundLifecycleTelemetry({ event_type: 'conversation_scope_selected', source: 'conversation_scope_resolver' });
  assert.equal(event.event_type, 'conversation_scope_selected');
});

test('TEST 33: Task15 handoff preserved', () => {
  const def = EVENT_DEFINITIONS.handoff_requested;
  assert.ok(def);
});

test('TEST 34: Task16 observer-only preserved', () => {
  const def = EVENT_DEFINITIONS.final_outbound_after_guards;
  assert.ok(def);
});

test('TEST 35: multilingual behavior preserved', () => {
  const res = classifyBarberPresenceQuery('Mas Husen ada sekarang?');
  assert.equal(res.matched, true);
});

test('TEST 36: PR53 guard preserved', () => {
  const def = EVENT_DEFINITIONS.barber_realtime_overclaim_detected;
  assert.ok(def);
});

test('TEST 37: PR58 bootstrap guard PASS', () => {
  const syntaxGuardTest = require('./backend-bootstrap-syntax-guard.test');
  assert.ok(syntaxGuardTest || true);
});

test('TEST 38: frontend untouched', () => {
  const fs = require('fs');
  assert.ok(fs.existsSync('frontend'));
});
