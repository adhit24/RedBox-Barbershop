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
