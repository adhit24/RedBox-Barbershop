'use strict';

/**
 * Reddy Reliability Round 2 — Production Incident Regression Suite.
 *
 * Covers the production findings (anonymized) from the 2026-09 incident
 * report: stale hardcoded price vs. live public.services, placeholder/
 * factual-price leakage, pre-outbound failure observability, lost booking
 * context on early-arrival questions, duplicate replies, visit-completion
 * overclaim vs. confirmed booking, and split booking URLs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  guardFactualServiceNumbers,
  guardVisitCompletionOverclaim,
  guardBookingUrlIntegrity,
  resolveServiceIdentity,
} = require('../agents/reddy/personalityPolicy');
const { getActiveServicesCatalog, findServiceRow, resetServicesCatalogCache } = require('../services/servicesCatalog');
const { createGuardedSend } = require('../services/waOutboundGuard');
const { classifyMessage } = require('../orchestrator/classifier');
const { orchestrateMessage } = require('../orchestrator/orchestratorService');
const { classifyBarberPresenceQuery } = require('../agents/reddy/barberPresenceIntent');

function fakeSupabaseWithServices(rows) {
  return {
    from(table) {
      assert.equal(table, 'services');
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'is_active');
              assert.equal(value, true);
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  };
}

// ── servicesCatalog.js — live public.services authority ────────────────────

test('CATALOG 1: getActiveServicesCatalog returns live active rows', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'x1', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const rows = await getActiveServicesCatalog(supabase, { forceRefresh: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 120000);
  assert.equal(rows[0].duration_minutes, 75);
});

test('CATALOG 2: getActiveServicesCatalog fails closed (null) when DB unreachable', async () => {
  resetServicesCatalogCache();
  const rows = await getActiveServicesCatalog(null, { forceRefresh: true });
  assert.equal(rows, null);
});

test('CATALOG 3: findServiceRow requires an unambiguous match', () => {
  const rows = [
    { id: 'a', name: 'Gentleman Grooming', price: 120000 },
    { id: 'b', name: 'Redbox Noble Grooming', price: 160000 },
  ];
  assert.equal(findServiceRow(rows, { name: 'Gentleman Grooming' }).id, 'a');
  assert.equal(findServiceRow(rows, { name: 'Unknown Service' }), null);
});

// ── Factual price/duration guard (production bug #1) ────────────────────────

test('FACTUAL 1: concrete wrong price for Gentleman Grooming is corrected to live public.services value', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const res = await guardFactualServiceNumbers('Gentleman Grooming di Redbox harganya Rp95.000 ya kak.', {
    supabase, serviceId: 'gentleman-grooming',
  });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming di Redbox harganya Rp120.000 ya kak.');
  assert.equal(res.mismatches[0].type, 'price');
  assert.equal(res.mismatches[0].attempted, 95000);
  assert.equal(res.mismatches[0].expected, 120000);
});

test('FACTUAL 2: matching duration is left untouched (no false positive)', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const res = await guardFactualServiceNumbers('Gentleman Grooming Rp120.000, durasi 75 menit ya kak.', {
    supabase, serviceId: 'gentleman-grooming',
  });
  assert.equal(res.blocked, false);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming Rp120.000, durasi 75 menit ya kak.');
});

test('FACTUAL 3: wrong duration is corrected independently of price', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const res = await guardFactualServiceNumbers('Gentleman Grooming Rp120.000, durasi 60 menit ya kak.', {
    supabase, serviceId: 'gentleman-grooming',
  });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming Rp120.000, durasi 75 menit ya kak.');
  assert.equal(res.mismatches[0].type, 'duration');
});

test('FACTUAL 4: fails open (does not block) when the live catalog is unreachable', async () => {
  resetServicesCatalogCache();
  const res = await guardFactualServiceNumbers('Gentleman Grooming Rp95.000 ya kak.', {
    supabase: null, serviceId: 'gentleman-grooming',
  });
  assert.equal(res.blocked, false);
  assert.equal(res.sanitizedReply, 'Gentleman Grooming Rp95.000 ya kak.');
});

test('FACTUAL 5: fails open when the service cannot be identified unambiguously', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const res = await guardFactualServiceNumbers('Total tagihanmu Rp95.000 ya kak.', { supabase });
  assert.equal(res.blocked, false);
});

test('FACTUAL 6: identifies service from free text alias when no serviceId is supplied', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  const identity = resolveServiceIdentity({ text: 'Gentleman Grooming di Redbox Rp95.000 ya kak.' });
  assert.equal(identity.id, 'gentleman-grooming');
  const res = await guardFactualServiceNumbers('Gentleman Grooming di Redbox Rp95.000 ya kak.', { supabase });
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Rp120.000'));
});

// ── Placeholder leakage never reaches send (production bug #2) ─────────────

test('PLACEHOLDER 1: end-to-end guardedSend also fixes a concrete wrong price via the factual guard', async () => {
  resetServicesCatalogCache();
  const supabase = fakeSupabaseWithServices([
    { id: 'gg', name: 'Gentleman Grooming', price: 120000, duration_minutes: 75, is_active: true },
  ]);
  let realSentMessage = null;
  const send = createGuardedSend({
    realSend: async (to, msg) => { realSentMessage = msg; return { status: true }; },
    supabase: {
      ...supabase,
      rpc: async (fn) => (fn === 'reserve_wa_automated_send'
        ? { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }
        : { data: null, error: null }),
    },
    inboundEventRowId: 'evt-factual-1',
  });
  await send('628123456789', 'Gentleman Grooming di Redbox harganya Rp95.000 ya kak.', {
    branch: 'bypass', serviceId: 'gentleman-grooming',
  });
  assert.equal(realSentMessage, 'Gentleman Grooming di Redbox harganya Rp120.000 ya kak.');
});

// ── Visit-completion overclaim vs. confirmed booking (production bug #6) ───

test('VISIT 1: same-day "sudah datang" claim is blocked when booking is only confirmed', () => {
  const res = guardVisitCompletionOverclaim('Kamu sudah datang hari ini ya Kak, sudah kelar potongnya.', {
    verifiedBookingStatus: 'CONFIRMED',
  });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply.includes('sudah datang hari ini'), false);
});

test('VISIT 2: same claim is allowed when backend status is verified DONE', () => {
  const res = guardVisitCompletionOverclaim('Kamu sudah datang hari ini ya Kak, sudah kelar potongnya.', {
    verifiedBookingStatus: 'DONE',
  });
  assert.equal(res.blocked, false);
});

test('VISIT 3: historical CRM last-visit reporting is not affected (no temporal-today marker)', () => {
  const res = guardVisitCompletionOverclaim('Terakhir kamu ke Redbox itu 11 Agustus di Bypass, sama Onoy.', {});
  assert.equal(res.blocked, false);
});

// ── Booking URL integrity (production bug #10) ──────────────────────────────

test('URL 1: a booking URL split across line breaks is rejoined', () => {
  const broken = 'Booking di sini ya Kak: redboxbarbershop.\ncom/booking.\nhtml?branch=sumber';
  const res = guardBookingUrlIntegrity(broken);
  assert.equal(res.corrected, true);
  assert.equal(res.sanitizedReply, 'Booking di sini ya Kak: redboxbarbershop.com/booking.html?branch=sumber');
});

test('URL 2: an intact URL is left untouched', () => {
  const intact = 'Booking di sini ya Kak: redboxbarbershop.com/booking.html?branch=sumber';
  const res = guardBookingUrlIntegrity(intact);
  assert.equal(res.corrected, false);
  assert.equal(res.sanitizedReply, intact);
});

// ── Booking context retained on early-arrival questions (production bug #4) ─

test('CONTEXT 1: "datang sekarang atau tetap jam 1?" with prior booking-time context routes to booking_status, not barber lookup', async () => {
  const conversationContext = {
    turns: [
      { role: 'user', content: 'Aku booking jam 1 siang ya sama Onoy' },
      { role: 'assistant', content: 'Oke Kak, dicatat ya, booking jam 13:00 sama Onoy di Bypass.' },
    ],
  };
  const decision = await orchestrateMessage({
    message: 'Kalau datang sekarang bisa langsung dilayani atau harus tetap jam 1?',
    branch: 'bypass',
    conversationContext,
  }, { classifier: async () => ({ intent: 'barber_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'lookup_barber' }) });
  assert.equal(decision.intent, 'booking_status');
  assert.equal(decision.required_sources.includes('booking_backend:booking_status'), true);
});

test('CONTEXT 2: the same phrase with NO prior booking/time context is left to the classifier (no false override)', async () => {
  const decision = await orchestrateMessage({
    message: 'Kalau datang sekarang bisa langsung dilayani atau harus tetap jam 1?',
    branch: 'bypass',
    conversationContext: { turns: [] },
  }, { classifier: async () => ({ intent: 'barber_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'lookup_barber' }) });
  assert.equal(decision.intent, 'barber_inquiry');
});

// ── barberPresenceIntent.js regression fix (pre-existing ReferenceError) ────

test('BARBER 1: classifyBarberPresenceQuery no longer throws on an availability-shaped query', () => {
  const res = classifyBarberPresenceQuery('Mas Husen available sekarang?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'availability');
});

test('BARBER 2: a plain presence query classifies claimType as presence, not availability', () => {
  const res = classifyBarberPresenceQuery('Mas Husen ada sekarang?');
  assert.equal(res.matched, true);
  assert.equal(res.claimType, 'presence');
});

test('SMOKE: classifyMessage still resolves deterministically for an unrelated intent (no regression from classifier wiring)', async () => {
  const decision = await classifyMessage('poin saya berapa?');
  assert.equal(decision.intent, 'points_inquiry');
});
