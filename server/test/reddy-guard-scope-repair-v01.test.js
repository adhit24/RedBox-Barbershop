'use strict';

/**
 * Reddy guard scope repair (after c2079db8 "harden Reddy audit safeguards").
 *
 * R1–R8  factual guard: CURRENT price claims are verified against the live catalog
 *        (fail closed), while historical / complaint / refund / dispute figures are
 *        the customer's transaction facts and are never rewritten.
 * R9–R12 "ok/baik/siap": standalone acknowledgement shortcut only when no flow is active.
 * R13–R15 barber query: existence needs no service; bookable slots do.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  guardFactualServiceNumbers, guardLegacyServiceNames,
} = require('../agents/reddy/personalityPolicy');
const { resetServicesCatalogCache } = require('../services/servicesCatalog');
const { hasActiveConversationalFlow } = require('../agents/reddy/bookingContext');
const { orchestrateMessage } = require('../orchestrator/orchestratorService');
const { handleMessage } = require('../../api/wa/webhook');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

function catalogSupabase(rows) {
  return {
    from(table) {
      assert.equal(table, 'services');
      return { select() { return { eq() { return Promise.resolve({ data: rows, error: null }); } }; } };
    },
  };
}

const CATALOG_ROWS = [
  { id: 'hair-spa', name: 'Hair Spa', price: 110000, duration_minutes: 60, is_active: true },
  { id: 'a41ee0a1-f854-48ca-8304-30529451d3c8', name: 'Treatment Smoothing & Shave', price: 450000, duration_minutes: 90, is_active: true },
];

// ── R1–R8 ────────────────────────────────────────────────────

test('R1 current official price + valid catalog -> allowed', async () => {
  resetServicesCatalogCache();
  const reply = 'Hair Spa sekarang Rp110.000 ya kak.';
  const res = await guardFactualServiceNumbers(reply, { supabase: catalogSupabase(CATALOG_ROWS), serviceId: 'hair-spa' });
  assert.equal(res.blocked, false);
  assert.equal(res.sanitizedReply, reply);
});

test('R2 current price + catalog unavailable -> fail closed', async () => {
  resetServicesCatalogCache();
  const res = await guardFactualServiceNumbers('Hair Spa sekarang Rp110.000 ya kak.', { supabase: null, serviceId: 'hair-spa' });
  assert.equal(res.blocked, true);
  assert.equal(res.action, 'blocked_unverified');
  assert.doesNotMatch(res.sanitizedReply, /Rp110\.000/);
});

test('R3 current price that disagrees with the catalog -> corrected', async () => {
  resetServicesCatalogCache();
  const res = await guardFactualServiceNumbers('Hair Spa harganya Rp95.000 kak.', {
    supabase: catalogSupabase(CATALOG_ROWS), serviceId: 'hair-spa',
  });
  assert.equal(res.blocked, true);
  assert.equal(res.sanitizedReply, 'Hair Spa harganya Rp110.000 kak.');
});

const PRESERVED = {
  R4: ['historical transaction', 'Kemarin kamu bayar Hair Spa Rp90.000 ya kak.'],
  R5: ['complaint', 'Saya komplain karena ditagih Hair Smoothing Rp360.000 kemarin.'],
  R6: ['refund', 'Refund Hair Smoothing Rp360.000 sudah diproses.'],
  R7a: ['selisih', 'Ada selisih Hair Smoothing Rp360.000 dengan yang tertera di struk.'],
  R7b: ['beda harga', 'Kenapa beda harga Hair Smoothing Rp360.000 dari yang ditagih?'],
  R7c: ['dispute', 'Dispute tagihan Hair Smoothing Rp360.000 sedang dicek.'],
};

for (const [id, [label, reply]] of Object.entries(PRESERVED)) {
  test(`${id} ${label} with a figure -> preserved (no rewrite, no generic template)`, async () => {
    resetServicesCatalogCache();
    const factual = await guardFactualServiceNumbers(reply, { supabase: catalogSupabase(CATALOG_ROWS), serviceId: 'hair-spa' });
    assert.equal(factual.blocked, false, reply);
    assert.equal(factual.sanitizedReply, reply);
    const legacy = guardLegacyServiceNames(reply);
    assert.equal(legacy.corrected, false, reply);
    assert.equal(legacy.sanitizedReply, reply);
  });
}

test('R5b complaint + a CURRENT claim in the same reply: historical kept, current verified/corrected', async () => {
  resetServicesCatalogCache();
  const res = await guardFactualServiceNumbers(
    'Terkait komplain selisih biaya Hair Smoothing Rp360.000, harga Treatment Smoothing & Shave sekarang adalah Rp400.000.',
    { supabase: catalogSupabase(CATALOG_ROWS), serviceId: 'hair-smoothing' },
  );
  assert.equal(res.blocked, true);
  assert.equal(
    res.sanitizedReply,
    'Terkait komplain selisih biaya Hair Smoothing Rp360.000, harga Treatment Smoothing & Shave sekarang adalah Rp450.000.',
  );
});

test('R8 legacy service name inside a complaint is not renamed; a plain current quote still is', () => {
  const complaint = 'Saya komplain kemarin Hair Smoothing ditagih Rp360.000.';
  const kept = guardLegacyServiceNames(complaint);
  assert.equal(kept.corrected, false);
  assert.match(kept.sanitizedReply, /Hair Smoothing/);
  assert.doesNotMatch(kept.sanitizedReply, /Treatment Smoothing & Shave/);
  const current = guardLegacyServiceNames('Untuk layanan Hair Smoothing harganya Rp450.000 kak.');
  assert.equal(current.corrected, true);
});

// ── R9–R12 ───────────────────────────────────────────────────

function classifier(intent = 'general_question') {
  return async () => ({
    intent, route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_general_question', confidence: 0.6, model_tier: 'economy',
  });
}

async function say(text, history) {
  const persisted = [];
  const runtime = await handleMessage({ from: '62811130001', text, branchFromPayload: 'bypass' }, {
    loadConversationHistory: async () => (history ? { status: 'available', history } : { status: 'empty', history: [] }),
    orchestrate: (params) => orchestrateMessage(params, { classifier: classifier() }),
    executeReddy: async () => ({ used: 'reddy_agent', reply: 'contextual reply' }),
    executeIntelligence: async () => {},
    send: async () => ({ status: 'sent' }),
    persistConversation: async (...args) => { persisted.push(args); },
    logTelemetry: () => {},
  });
  return { runtime, persisted };
}

const now = () => Date.now();

test('R9 standalone "ok" -> normal acknowledgement', async () => {
  const { runtime } = await say('ok');
  assert.equal(runtime.reply, 'Siap, Kak.');
  assert.equal(runtime.used, 'acknowledgment');
});

test('R10 standalone "baik" -> normal acknowledgement', async () => {
  const { runtime } = await say('baik');
  assert.equal(runtime.reply, 'Siap, Kak.');
  assert.equal(runtime.used, 'acknowledgment');
});

test('R11 "ok" during an active booking flow is NOT swallowed by the early shortcut; flow history is kept', async () => {
  const history = [
    { role: 'user', content: 'mau booking haircut besok di sumber', timestamp: now() },
    { role: 'assistant', content: 'Boleh kak, mau jam berapa?', timestamp: now() },
  ];
  assert.equal(hasActiveConversationalFlow(history, { sessionStatus: 'active' }), true);
  const { runtime, persisted } = await say('ok', history);
  assert.notEqual(runtime.used, 'acknowledgment', 'early shortcut must not fire mid-flow');
  // The normal orchestrated path handled it and the accumulated flow turns were carried into persistence.
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0][1].map((t) => t.content), history.map((t) => t.content));
});

test('R12 "baik" during barber/service clarification continues through normal processing', async () => {
  const history = [
    { role: 'user', content: 'aku mau potong sama abdul', timestamp: now() },
    { role: 'assistant', content: 'Layanan apa yang kakak mau?', timestamp: now() },
  ];
  assert.equal(hasActiveConversationalFlow(history, { sessionStatus: 'active' }), true);
  const { runtime } = await say('baik', history);
  assert.notEqual(runtime.used, 'acknowledgment');
  // An unanswered assistant question alone also counts as an active flow.
  const asked = [{ role: 'assistant', content: 'Mau dibantu cek slot juga kak?', timestamp: now() }];
  assert.equal(hasActiveConversationalFlow(asked, { sessionStatus: 'active' }), true);
});

test('active-flow detector: expired session, empty history and a closed statement are not active flows', () => {
  assert.equal(hasActiveConversationalFlow([], { sessionStatus: 'active' }), false);
  assert.equal(hasActiveConversationalFlow(
    [{ role: 'user', content: 'mau haircut', timestamp: now() }], { sessionStatus: 'expired' }), false);
  assert.equal(hasActiveConversationalFlow(
    [{ role: 'assistant', content: 'Booking bisa dilanjutkan lewat website ya Kak.', timestamp: now() }],
    { sessionStatus: 'active' }), false);
});

// ── R13–R15 ──────────────────────────────────────────────────

const ABDUL = { id: 'barber-abdul', name: 'Abdul', branch: 'bypass', is_active: true };

async function askReddy(text, { scheduleStatus = 'scheduled', turns = [], sessionStatus = 'expired', availabilityCalls = [] } = {}) {
  resetServicesCatalogCache();
  return executeReddyAgent({
    from: '628100000099',
    text,
    branch: 'bypass',
    conversationContext: { turns, turn_count: turns.length, history_status: turns.length ? 'available' : 'empty', sessionStatus, response_language: 'indonesian' },
    orchestrationDecision: { intent: 'general_question', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => { throw new Error('must not be called'); },
    sendWA: async (_to, reply) => ({ status: true, reply }),
    loadBarbers: async () => ({ status: 'verified', barbers: [ABDUL], reason: null }),
    getSchedule: async () => ({ status: scheduleStatus, source: 'working_hours' }),
    getAvailability: async (_db, query) => { availabilityCalls.push(query); return { success: true, reason_code: 'available', available_slots: ['17:00', '18:00'] }; },
    supabase: catalogSupabase([
      { id: 'svc-gg', name: 'Gentleman Grooming', price: 95000, duration_minutes: 60, is_active: true },
    ]),
    logBookingTelemetry: () => {},
    logAvailability: () => {},
  });
}

test('R13 "Abdul ada hari ini?" answers existence from schedule data without demanding a service', async () => {
  const result = await askReddy('abdul ada ga hari ini');
  assert.match(result.reply, /Abdul dijadwalkan masuk hari ini/);
  assert.doesNotMatch(result.reply, /mau layanan apa\?/i, 'existence must not force a service question');
  assert.doesNotMatch(result.reply, /17:00/, 'no slots may be invented without a service duration');
  const off = await askReddy('abdul ada ga hari ini', { scheduleStatus: 'not_scheduled' });
  assert.match(off.reply, /tidak tercatat dijadwalkan masuk/);
  const unknown = await askReddy('abdul ada ga hari ini', { scheduleStatus: 'unknown' });
  assert.doesNotMatch(unknown.reply, /Abdul dijadwalkan masuk/, 'never claim the barber is in without data');
});

test('R14 "Abdul kosong jam berapa?" without a service asks for the service/duration', async () => {
  const calls = [];
  const result = await askReddy('kak abdul kosong jam berapa?', { availabilityCalls: calls });
  assert.match(result.reply, /Abdul dijadwalkan masuk hari ini, Kak\. Untuk cek jam kosong yang bisa dibooking, mau layanan apa\?/);
  assert.match(result.reply, /Durasi layanan menentukan slot/);
  assert.equal(calls.length, 0, 'no slot lookup without a service duration');
  const unknown = await askReddy('kak abdul kosong jam berapa?', { scheduleStatus: 'unknown' });
  assert.match(unknown.reply, /mau layanan apa\?/);
  assert.doesNotMatch(unknown.reply, /Abdul dijadwalkan masuk/);
});

test('R15 bare barber slot query + existing service context continues the availability lookup', async () => {
  const calls = [];
  const result = await askReddy('kak abdul kosong jam berapa?', {
    availabilityCalls: calls,
    sessionStatus: 'active',
    turns: [{ role: 'user', content: 'mau haircut', timestamp: now() }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].serviceId, 'svc-gg');
  assert.equal(calls[0].durationMinutes, 60);
  assert.match(result.reply, /17:00 dan 18:00/);
});

test('R7d a dispute word on a GENERIC price statement is still a current claim and stays verified', async () => {
  resetServicesCatalogCache();
  const res = await guardFactualServiceNumbers('Beda harga Rp75.000 biasanya untuk potongan standar.', {
    supabase: catalogSupabase(CATALOG_ROWS),
  });
  assert.equal(res.blocked, true);
  assert.doesNotMatch(res.sanitizedReply, /75|potongan standar/);
});
