'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveRelativeDate,
  resolveTimeAndPreference,
  resolveService,
  extractBookingContext,
  reconstructBookingContextFromTurns,
  buildPrefilledBookingUrl,
} = require('../agents/reddy/bookingContext');
const {
  REDDY_BOOKING_EXECUTION,
  guardReddyReply,
} = require('../agents/reddy/bookingGuards');
const {
  loadCanonicalBarbers,
  resolveCanonicalBarber,
} = require('../services/canonicalBarberResolver');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { parseBookingHandoff } = require('../../public/js/booking-handoff');
const { REDBOX_SERVICES } = require('../../public/js/services-data');
const { handleMessage } = require('../../api/wa/webhook');

const canonicalBarbers = [
  { id: 'barber-onoy-id', name: 'Onoy', branch: 'bypass', is_active: true },
  { id: 'barber-sarif-id', name: 'Sarif', branch: 'csb', is_active: true },
];

function trustedBarberLoader() {
  return Promise.resolve({ status: 'verified', barbers: canonicalBarbers, reason: null });
}

test('relative dates resolve to WIB YYYY-MM-DD', () => {
  const fixedWib = new Date(Date.UTC(2026, 7, 28, 8));
  assert.equal(resolveRelativeDate('besok', fixedWib).date, '2026-08-29');
  assert.equal(resolveRelativeDate('lusa', fixedWib).date, '2026-08-30');
  assert.equal(resolveRelativeDate('hari ini', fixedWib).date, '2026-08-28');
});

test('ambiguous and contextual time semantics remain locked', () => {
  assert.deepEqual(resolveTimeAndPreference('jam 4'), { time: null, preference: null, timeAmbiguous: true });
  assert.equal(resolveTimeAndPreference('jam 4', { time_preference: { value: 'sore' } }).time, '16:00');
  assert.equal(resolveTimeAndPreference('jam 4', { time_preference: { value: 'pagi' } }).time, '04:00');
});

test('generic treatment remains ambiguous', () => {
  const service = resolveService('mau treatment rambut');
  assert.equal(service.status, 'ambiguous');
  assert.equal(service.id, null);
  assert.equal(extractBookingContext('mau treatment rambut').clarification_required, true);
});

test('service aliases resolve identity and name from REDBOX_SERVICES', () => {
  const resolved = resolveService('besok mau potong');
  const canonical = REDBOX_SERVICES.find((service) => service.id === 'gentleman-grooming');
  assert.deepEqual(
    { id: resolved.id, slug: resolved.slug, name: resolved.name },
    { id: canonical.id, slug: canonical.id, name: canonical.name },
  );
});

test('canonical barber loader reads only active barber authority fields', async () => {
  let table = null;
  let selected = null;
  let activeFilter = null;
  const supabase = {
    from(name) {
      table = name;
      return {
        select(fields) {
          selected = fields;
          return {
            async eq(field, value) {
              activeFilter = [field, value];
              return { data: canonicalBarbers, error: null };
            },
          };
        },
      };
    },
  };
  const result = await loadCanonicalBarbers(supabase);
  assert.equal(table, 'barbers');
  assert.equal(selected, 'id,name,branch,is_active');
  assert.deepEqual(activeFilter, ['is_active', true]);
  assert.equal(result.status, 'verified');
  assert.equal(result.barbers[0].id, 'barber-onoy-id');
});

test('barber existence and branch identity come only from canonical rows', () => {
  assert.equal(resolveCanonicalBarber('sama Onoy', []).status, 'unresolved');
  const verified = resolveCanonicalBarber('sama Onoy', canonicalBarbers, 'bypass');
  assert.equal(verified.status, 'verified');
  assert.deepEqual(verified.barber, canonicalBarbers[0]);
  assert.equal(resolveCanonicalBarber('sama Onoy', canonicalBarbers, 'csb').status, 'unresolved');
});

test('unstated branch remains unknown and never silently becomes Bypass', () => {
  const context = extractBookingContext('mau potong besok', null, { canonicalBarbers });
  assert.equal(context.branch.value, null);
  assert.equal(context.branch.status, 'unknown');
  assert.doesNotMatch(buildPrefilledBookingUrl(context), /branch=/);
});

test('canonical barber relationship may resolve branch after explicit barber selection', () => {
  const context = extractBookingContext('besok potong sama Onoy', null, { canonicalBarbers });
  assert.equal(context.barber.id, 'barber-onoy-id');
  assert.equal(context.branch.value, 'bypass');
  assert.equal(context.branch.status, 'canonical_barber_relationship');
});

test('handoff URL uses canonical IDs and booking page parser consumes them', () => {
  const context = extractBookingContext('2026-09-10 jam 4 sore potong sama Onoy di Bypass', null, { canonicalBarbers });
  const url = buildPrefilledBookingUrl(context);
  const parsed = parseBookingHandoff(new URL(url).search);
  assert.deepEqual(parsed, {
    branch: 'bypass',
    service_id: 'gentleman-grooming',
    barber_id: 'barber-onoy-id',
    date: '2026-09-10',
    time: '16:00',
    time_preference: null,
  });
  assert.equal(REDBOX_SERVICES.some((service) => service.id === parsed.service_id), true);
  assert.equal(canonicalBarbers.some((barber) => barber.id === parsed.barber_id && barber.branch === parsed.branch), true);
});

// --- Booking context continuity across turns ---------------------------------
// booking_context is never persisted to storage; only raw {role, content} turns
// are. These tests exercise the stateless reconstruction that rebuilds it from
// recent customer turns each request (server/agents/reddy/bookingContext.js
// reconstructBookingContextFromTurns).

function userTurn(content, timestamp) {
  return { role: 'user', content, timestamp };
}
function assistantTurn(content, timestamp) {
  return { role: 'assistant', content, timestamp };
}

test('continuity A: barber named in a later turn resolves against the branch already established', () => {
  const turns = [
    userTurn('Besok mau potong di Bypass.', 1000),
    assistantTurn('Baik Kak, mau sama siapa?', 1001),
  ];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'active_conversation', canonicalBarbers });
  const final = extractBookingContext('Onoy aja.', prior, { canonicalBarbers });

  assert.equal(final.service.id, 'gentleman-grooming');
  assert.equal(final.branch.value, 'bypass');
  assert.ok(final.date.value, 'date resolved from turn 1 must survive into turn 2');
  assert.equal(final.barber.id, 'barber-onoy-id');
  assert.equal(final.booking_readiness, 'ready_for_handoff');
});

test('continuity B: standalone time in a later turn resolves using the daypart set earlier', () => {
  const turns = [userTurn('Besok sore mau potong di Bypass.', 1000)];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'active_conversation', canonicalBarbers });
  const final = extractBookingContext('Jam 4 aja.', prior, { canonicalBarbers });

  assert.ok(final.date.value);
  assert.equal(final.time_preference.value, 'sore');
  assert.equal(final.time.value, '16:00');
});

test('continuity C: explicit branch override drops an incompatible canonical barber and requires clarification', () => {
  const turns = [userTurn('Besok sama Onoy di Bypass.', 1000)];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'active_conversation', canonicalBarbers });
  assert.equal(prior.barber.id, 'barber-onoy-id');

  const final = extractBookingContext('Eh jadi CSB.', prior, { canonicalBarbers });
  assert.equal(final.branch.value, 'csb');
  assert.equal(final.barber.id, null);
  assert.equal(final.barber.status, 'branch_mismatch');
  assert.equal(final.clarification_required, true);
  assert.equal(final.clarification_reason, 'barber_branch_mismatch');
});

test('continuity D: an ambiguous service resolved in a later turn clears clarification_required', () => {
  const turns = [userTurn('Mau treatment besok.', 1000)];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'active_conversation', canonicalBarbers });
  assert.equal(prior.clarification_required, true);
  assert.equal(prior.clarification_reason, 'ambiguous_service');

  const final = extractBookingContext('Hair Spa.', prior, { canonicalBarbers });
  assert.equal(final.service.id, 'hair-spa');
  assert.equal(final.clarification_required, false);
  assert.equal(final.clarification_reason, null);
});

test('continuity E: expired session does not carry old service, date, or branch into a fresh message', () => {
  const turns = [userTurn('Mau potong besok di Bypass.', 1000)];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'expired', canonicalBarbers });
  assert.equal(prior.service.value, null);
  assert.equal(prior.branch.value, null);
  assert.equal(prior.date.value, null);

  const final = extractBookingContext('Onoy ada?', prior, { canonicalBarbers });
  assert.equal(final.service.value, null, 'old service must not leak across an expired session boundary');
  assert.equal(final.date.value, null, 'old date must not leak across an expired session boundary');
});

test('continuity F: an explicit closure turn boundary prevents old context reappearing in the next scope', () => {
  const turns = [
    userTurn('Mau booking besok di Bypass.', 1000),
    assistantTurn('Siap Kak.', 1001),
    userTurn('Oke makasih.', 2000),
  ];
  // sessionStatus 'expired' here reflects what classifyConversationSession already
  // computes when the most recent customer turn is an explicit closure signal.
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'expired', canonicalBarbers });
  assert.equal(prior.branch.value, null);
  assert.equal(prior.service.value, null);
});

test('continuity: assistant turns are never interpreted as customer booking choices', () => {
  const turns = [assistantTurn('Gimana kalau di CSB Kak sama Sarif?', 1000)];
  const prior = reconstructBookingContextFromTurns(turns, { sessionStatus: 'active_conversation', canonicalBarbers });
  assert.equal(prior.branch.value, null);
  assert.equal(prior.barber.id, null);
});

test('continuity: handoff after a 3-turn journey accumulates safe preference, never a reservation claim', async () => {
  const conversationContext = {
    turns: [
      userTurn('Besok mau potong di Bypass.', 1000),
      assistantTurn('Siap Kak, mau sama siapa?', 1001),
      userTurn('Onoy aja.', 2000),
      assistantTurn('Baik Kak Onoy di Bypass, jam berapa?', 2001),
    ],
    turn_count: 4,
    history_status: 'available',
    sessionStatus: 'active_conversation',
  };
  let capturedContext = null;
  const result = await executeReddyAgent({
    from: '628100000099', text: 'Sore aja deh.', branch: 'bypass',
    conversationContext,
    orchestrationDecision: { intent: 'booking_request', route: 'reddy_agent' },
  }, {
    callOpenAI: async (...args) => {
      capturedContext = args[6];
      return 'Oke Kak, silakan lanjut pilih waktunya di link booking resmi ya.';
    },
    sendWA: async () => ({ status: 'sent' }),
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: () => {},
  });

  assert.equal(result.reply, 'Oke Kak, silakan lanjut pilih waktunya di link booking resmi ya.');
  const url = capturedContext.booking_authority.handoff_url;
  const parsed = parseBookingHandoff(new URL(url).search);
  assert.equal(parsed.branch, 'bypass');
  assert.equal(parsed.service_id, 'gentleman-grooming');
  assert.equal(parsed.barber_id, 'barber-onoy-id');
  assert.match(parsed.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(parsed.time_preference, 'sore');
  assert.doesNotMatch(url, /reserved=|available=|booking_confirmed=|confirmed=/);
});

test('booking page implementation uses handoff parser and preserves backend validation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/booking.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../public/booking.html'), 'utf8');
  assert.match(html, /booking-handoff\.js[\s\S]*booking\.js/);
  assert.match(source, /parseBookingHandoff\(window\.location\.search\)/);
  assert.match(source, /allBarbers\.find\(b => String\(b\.id\) === String\(preBarber\)\)/);
  assert.match(source, /preDate && preDate >= today/);
  assert.match(source, /verified: false/);
});

test('guard catches false booking, reschedule, cancel, lock, and availability claims', () => {
  for (const claim of [
    'Sudah aku booking jam 4 ya Kak',
    'Slotnya aman ya Kak',
    'Reschedule berhasil',
    'Cancel sudah selesai',
    'Barber sudah dikunci',
  ]) {
    assert.equal(guardReddyReply(claim).blockedProhibitedClaim, true, claim);
  }
  assert.equal(guardReddyReply('Onoy kosong jam 4').blockedUnverifiedAvailability, true);
});

test('actual executeReddyAgent sanitizes false booking before every send', async () => {
  const sent = [];
  const telemetry = [];
  const persisted = [];
  const result = await executeReddyAgent({
    from: '628100000000', text: 'tolong booking jam 4', branch: 'bypass',
    orchestrationDecision: { intent: 'booking_request', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Sudah aku booking jam 4 ya Kak',
    sendWA: async (_to, reply) => { sent.push(reply); return { status: 'sent' }; },
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: (event) => telemetry.push(event),
    persistConversation: async (_from, _turns, _text, reply) => persisted.push(reply),
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0], result.reply);
  assert.doesNotMatch(sent[0], /Sudah aku booking/i);
  assert.match(sent[0], /belum dibuat atau diubah/i);
  assert.equal(telemetry[0].guard_blocked_prohibited_claim, true);
  assert.deepEqual(persisted, sent, 'only the sanitized reply may enter conversation history');
});

test('actual executeReddyAgent sanitizes unverified barber availability before send', async () => {
  const sent = [];
  const result = await executeReddyAgent({
    from: '628100000000', text: 'Onoy ada jam 4?', branch: 'bypass',
    orchestrationDecision: { intent: 'availability_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Onoy kosong jam 4',
    sendWA: async (_to, reply) => { sent.push(reply); return { status: 'sent' }; },
    loadBarbers: trustedBarberLoader,
    logBookingTelemetry: () => {},
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0], result.reply);
  assert.doesNotMatch(sent[0], /Onoy kosong jam 4/i);
  assert.match(sent[0], /dicek real-time/i);
});

test('production Reddy adapter has guard immediately before WhatsApp send', () => {
  const source = fs.readFileSync(path.join(__dirname, '../agents/reddy/reddyAdapter.js'), 'utf8');
  const guardIndex = source.indexOf('guardReddyReply(reply');
  const sendIndex = source.indexOf('sendWA(from, reply');
  assert.ok(guardIndex > 0 && sendIndex > guardIndex);
  assert.equal((source.match(/sendWA\(from, reply/g) || []).length, 1);
});

test('actual WhatsApp Reddy path has no reachable booking mutation module or API call', async () => {
  const webhookSource = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  const adapterSource = fs.readFileSync(path.join(__dirname, '../agents/reddy/reddyAdapter.js'), 'utf8');
  const productionPath = `${webhookSource}\n${adapterSource}`;
  assert.doesNotMatch(productionPath, /require\([^)]*(bookingStore|foreignBookingService|homeServiceHandler)[^)]*\)/);
  assert.doesNotMatch(adapterSource, /\.from\(['"]bookings['"]\)|\/api\/bookings|createBooking|reserveSlot|updateBooking|rescheduleBooking|cancelBooking/);

  const originalFetch = global.fetch;
  const mutationCalls = { create: 0, reserve: 0, update: 0, reschedule: 0, cancel: 0 };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (/bookings|reservation|slots/i.test(target) && method !== 'GET') {
      const body = String(options.body || '');
      if (/reschedule/i.test(target + body)) mutationCalls.reschedule++;
      else if (/cancel/i.test(target + body)) mutationCalls.cancel++;
      else if (/reserve|slot/i.test(target + body)) mutationCalls.reserve++;
      else if (method === 'POST') mutationCalls.create++;
      else mutationCalls.update++;
    }
    throw new Error(`Unexpected network call: ${target}`);
  };

  try {
    for (const text of [
      'bookingin saya',
      'tolong booking jam 4',
      'Nama: Adhit, Bypass, Onoy, besok jam 4',
      'pindahin booking saya ke jam 5',
      'cancel booking saya',
    ]) {
      await handleMessage({ from: '628100000000', text, branchFromPayload: 'bypass' }, {
        loadConversationHistory: async () => ({ history: [], status: 'empty' }),
        orchestrate: async () => ({
          route: 'reddy_agent', agent: 'reddy_agent', intent: 'booking_request',
          action: 'guide_to_booking', response_strategy: 'guide_to_booking',
        }),
        generateReddy: async () => 'Silakan lanjutkan pilihan di website booking resmi ya Kak.',
        send: async () => ({ status: 'sent' }),
        resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
        logTelemetry: () => {},
      });
    }
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
  assert.deepEqual(mutationCalls, { create: 0, reserve: 0, update: 0, reschedule: 0, cancel: 0 });
});
