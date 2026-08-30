'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reddyAdapter = require('../agents/reddy/reddyAdapter');
const { executeReddyAgent } = reddyAdapter;
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { REDDY_BOOKING_EXECUTION } = require('../agents/reddy/bookingGuards');
const { handleMessage } = require('../../api/wa/webhook');

const HUSEN = { id: 'barber-husen', name: 'Husen', branch: 'csb', is_active: true };

function emptyContext() {
  return {
    turns: [],
    turn_count: 0,
    history_status: 'empty',
    sessionStatus: 'expired',
  };
}

async function runPresenceTurn({
  from = '628100000001',
  text = 'Mas Husen ada?',
  scheduleStatus = 'scheduled',
  barbers = [HUSEN],
  barberLoadThrows = false,
  conversationContext = emptyContext(),
  modelReply = 'Mas Husen ada di sini. Langsung booking ya: redboxbarbershop.com/booking.html?branch=csb',
  orchestrationDecision = { intent: 'barber_inquiry', route: 'reddy_agent' },
} = {}) {
  const observations = { openAI: 0, schedule: 0, sent: [] };
  const result = await executeReddyAgent({
    from,
    text,
    branch: 'csb',
    conversationContext,
    orchestrationDecision,
  }, {
    callOpenAI: async (...args) => {
      observations.openAI += 1;
      observations.modelContext = args[6];
      return modelReply;
    },
    sendWA: async (_to, reply) => {
      observations.sent.push(reply);
      return { status: true };
    },
    loadBarbers: async () => {
      if (barberLoadThrows) throw new Error('roster unavailable');
      return { status: 'verified', barbers, reason: null };
    },
    getSchedule: async (_supabase, { barberId, date }) => {
      observations.schedule += 1;
      if (scheduleStatus === 'throws') throw new Error('schedule unavailable');
      return { status: scheduleStatus, source: 'planned_schedule_lookup', date, barberId };
    },
    supabase: {},
    logBookingTelemetry: () => {},
  });
  return { result, observations };
}

test('presence classifier is exported and classifies bare current questions without temporal words', () => {
  assert.equal(typeof reddyAdapter.classifyBarberPresenceQuery, 'function');
  for (const text of [
    'Mas Husen ada?', 'Husen ada?', 'Mas Husen masuk?', 'Husen masuk gak?',
    'Mas Husen kerja?', 'Mas Husen hadir?', 'Mas Husen ready?', 'Husen free?',
    'Mas Husen available?', 'Mas Husen tersedia?', 'Mas Husen standby?',
    'Mas Husen lagi di CSB?', 'Mas Husen di sana?', 'Husen ada di situ?',
    'Mas Husen bisa sekarang?',
  ]) {
    const result = reddyAdapter.classifyBarberPresenceQuery(text);
    assert.equal(result?.matched, true, text);
    assert.equal(result?.temporalScope, 'current', text);
  }
});

test('first turn with empty history is deterministic: scheduled is bounded and attendance remains unknown', async () => {
  const { result, observations } = await runPresenceTurn();
  assert.equal(observations.openAI, 0);
  assert.equal(observations.schedule, 1);
  assert.equal(observations.sent.length, 1);
  assert.match(result.reply, /Husen memang dijadwalkan masuk hari ini/i);
  assert.match(result.reply, /belum punya data (check-in\/kehadiran|kehadiran\/check-in)/i);
  assert.doesNotMatch(result.reply, /Husen ada(?:\s|[.!?,])/i);
  assert.doesNotMatch(result.reply, /redboxbarbershop\.com|langsung booking|bantu booking/i);
});

test('not-scheduled and failed schedule lookups fail closed without a presence claim', async () => {
  const notScheduled = await runPresenceTurn({ scheduleStatus: 'not_scheduled' });
  assert.match(notScheduled.result.reply, /Husen tidak tercatat dijadwalkan masuk hari ini/i);
  assert.doesNotMatch(notScheduled.result.reply, /Husen ada(?:\s|[.!?,])/i);

  const failed = await runPresenceTurn({ scheduleStatus: 'throws' });
  assert.match(failed.result.reply, /belum bisa memastikan Mas Husen ada sekarang dari data yang terverifikasi/i);
  assert.equal(failed.observations.openAI, 0);

  const rosterFailed = await runPresenceTurn({ barberLoadThrows: true });
  assert.match(rosterFailed.result.reply, /belum bisa mengenali kapster|belum menemukan nama kapster/i);
  assert.equal(rosterFailed.observations.openAI, 0);
});

test('free, available, and ready stay booking-availability claims and are never inferred from schedule', async () => {
  for (const text of ['Mas Husen free?', 'Mas Husen available?', 'Mas Husen ready?']) {
    const { result, observations } = await runPresenceTurn({
      text,
      orchestrationDecision: { intent: 'booking_availability_inquiry', route: 'reddy_agent' },
    });
    assert.equal(observations.openAI, 0, text);
    assert.match(result.reply, /dijadwalkan masuk hari ini/i, text);
    assert.match(result.reply, /belum bisa memastikan beliau sedang (free\/tersedia|tersedia\/free) sekarang/i, text);
    assert.doesNotMatch(result.reply, /iya[^.]{0,20}(free|available|ready|tersedia)/i, text);
    assert.doesNotMatch(result.reply, /redboxbarbershop\.com|booking/i, text);
  }
});

test('existing English presentation route renders the same bounded presence facts without forced Indonesian', async () => {
  for (const text of ['Husen available?', 'Husen free?']) {
    const { result, observations } = await runPresenceTurn({
      text,
      conversationContext: {
        ...emptyContext(),
        response_language: 'english',
      },
      modelReply: 'Husen is scheduled today. Live attendance is unverified, and slot availability is unverified.',
      orchestrationDecision: { intent: 'booking_availability_inquiry', route: 'reddy_agent' },
    });

    assert.equal(observations.openAI, 1, text);
    assert.equal(observations.schedule, 1, text);
    assert.match(result.reply, /scheduled today/i, text);
    assert.match(result.reply, /attendance is unverified/i, text);
    assert.match(result.reply, /availability is unverified/i, text);
    assert.doesNotMatch(result.reply, /\b(?:aku|kak|beliau|dijadwalkan|hari ini)\b/i, text);
    assert.deepEqual(observations.modelContext?.barber_presence_fact_decision, {
      barber: { id: HUSEN.id, name: HUSEN.name, branch: HUSEN.branch },
      schedule_status: 'scheduled',
      attendance_status: 'unavailable',
      availability_status: 'unverified',
    }, text);
    assert.equal(observations.modelContext?.booking_authority, undefined, text);
  }
});

test('English presence adapter sanitizes unsafe model availability in the resolved response language', async () => {
  const { result, observations } = await runPresenceTurn({
    text: 'Husen available?',
    conversationContext: { ...emptyContext(), response_language: 'english' },
    modelReply: 'Husen is available now.',
    orchestrationDecision: { intent: 'booking_availability_inquiry', route: 'reddy_agent' },
  });

  assert.equal(observations.openAI, 1);
  assert.equal(observations.schedule, 1);
  assert.equal(
    result.reply,
    "Husen is scheduled to work today, but I can't verify that he is free or available right now.",
  );
  assert.doesNotMatch(result.reply, /\b(?:aku|kak|beliau|dijadwalkan|hari ini|tercatat)\b/i);
  assert.doesNotMatch(result.reply, /booking|redboxbarbershop\.com|https?:\/\//i);
});

test('response language is context-owned and never inferred from sender country code', async () => {
  const plus62English = await runPresenceTurn({
    from: '628100000001',
    text: 'Husen available?',
    conversationContext: { ...emptyContext(), response_language: 'english' },
    modelReply: 'Husen is scheduled today. Live attendance is unverified, and slot availability is unverified.',
  });
  assert.match(plus62English.result.reply, /scheduled today/i);
  assert.doesNotMatch(plus62English.result.reply, /\b(?:aku|kak|beliau|dijadwalkan|hari ini)\b/i);

  const foreignNumberIndonesian = await runPresenceTurn({
    from: '447700900123',
    text: 'Mas Husen ada?',
    conversationContext: { ...emptyContext(), response_language: 'indonesian' },
  });
  assert.match(foreignNumberIndonesian.result.reply, /dijadwalkan masuk hari ini/i);
  assert.equal(foreignNumberIndonesian.observations.openAI, 0);
});

test('branch assignment alone does not become attendance and unresolved names are never fabricated', async () => {
  const branchQuestion = await runPresenceTurn({ text: 'Mas Husen ada di CSB?' });
  assert.match(branchQuestion.result.reply, /dijadwalkan masuk hari ini/i);
  assert.match(branchQuestion.result.reply, /data (check-in\/kehadiran|kehadiran\/check-in)/i);

  const unresolved = await runPresenceTurn({ text: 'Mas BukanKapster ada?' });
  assert.match(unresolved.result.reply, /belum menemukan nama kapster itu|belum bisa mengenali kapster/i);
  assert.doesNotMatch(unresolved.result.reply, /BukanKapster (ada|hadir|masuk|tersedia)/i);
});

test('ambiguous canonical barber asks a short clarification and never checks schedule', async () => {
  const { result, observations } = await runPresenceTurn({
    text: 'Mas Husen ada?',
    barbers: [HUSEN, { ...HUSEN, id: 'barber-husen-2', branch: 'bypass' }],
  });
  assert.match(result.reply, /cabang|kapster.*dimaksud/i);
  assert.equal(observations.schedule, 0);
  assert.equal(observations.openAI, 0);
});

test('pure presence turns never acquire booking CTA eligibility, including repeated turns', async () => {
  const first = await runPresenceTurn();
  const second = await runPresenceTurn({
    conversationContext: {
      turns: [
        { role: 'user', content: 'Mas Husen ada?' },
        { role: 'assistant', content: first.result.reply },
      ],
      turn_count: 2,
      history_status: 'available',
      sessionStatus: 'active_conversation',
    },
  });
  assert.equal(first.result.reply, second.result.reply);
  assert.doesNotMatch(second.result.reply, /redboxbarbershop\.com|booking/i);
});

test('outbound guard blocks natural attendance and presence claims without temporal words', () => {
  for (const claim of [
    'Mas Husen ada.', 'Mas Husen ada di sini.', 'Mas Husen ada kok.',
    'Mas Husen ada di CSB.', 'Mas Husen lagi di sini.', 'Mas Husen lagi di CSB.',
    'Mas Husen sedang di cabang.', 'Mas Husen masuk.',
    'Mas Husen hadir.', 'Mas Husen ready.', 'Mas Husen standby.',
    'Mas Husen tersedia.', 'Mas Husen free.', 'Mas Husen bisa sekarang.',
  ]) {
    const guarded = guardRealtimeBarberFacts(claim, { verifiedSchedule: null });
    assert.equal(guarded.triggered, true, claim);
    assert.doesNotMatch(guarded.sanitizedReply, new RegExp(`^${claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), claim);
    assert.match(guarded.sanitizedReply, /belum bisa memastikan|data yang terverifikasi/i, claim);
  }
});

test('outbound guard keeps ordinary foreign availability words and blocks only named-barber claims', () => {
  for (const informationalReply of [
    'Appointments are available on the website.',
    'Payment is available by card.',
    'The branch is ready to serve customers.',
  ]) {
    const guarded = guardRealtimeBarberFacts(informationalReply, {
      verifiedSchedule: null,
      knownBarberNames: ['Husen'],
    });
    assert.equal(guarded.triggered, false, informationalReply);
    assert.equal(guarded.sanitizedReply, informationalReply);
  }

  for (const barberClaim of ['Husen is present now.', 'Husen is available.', 'Husen is free.']) {
    const guarded = guardRealtimeBarberFacts(barberClaim, {
      verifiedSchedule: null,
      knownBarberNames: ['Husen'],
    });
    assert.equal(guarded.triggered, true, barberClaim);
    assert.doesNotMatch(guarded.sanitizedReply, new RegExp(barberClaim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('English guard fallback preserves language and authority for unsafe model output', () => {
  const scheduled = { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' };
  const cases = [
    {
      reply: 'Husen is available now.',
      options: { verifiedSchedule: scheduled, requestedClaim: 'availability' },
      expected: /Husen is scheduled to work today, but I can't verify that he is free or available right now\./,
    },
    {
      reply: 'Husen is here.',
      options: { verifiedSchedule: scheduled, requestedClaim: 'presence' },
      expected: /Husen is scheduled to work today, but I don't have verified check-in or attendance data to confirm that he is already at the branch\./,
    },
    {
      // In this guard, bare "is working today" is treated as a current-presence
      // claim, not as proof that a planned schedule lookup happened.
      reply: 'Husen is working today.',
      options: { verifiedSchedule: scheduled, requestedClaim: 'presence' },
      expected: /Husen is scheduled to work today, but I don't have verified check-in or attendance data to confirm that he is already at the branch\./,
    },
    {
      reply: 'Husen is here.',
      options: { verifiedSchedule: { ...scheduled, status: 'not_scheduled' }, requestedClaim: 'presence' },
      expected: /Husen is not listed as scheduled to work today\./,
    },
    {
      reply: 'Husen is available now.',
      options: { verifiedSchedule: null, requestedClaim: 'availability' },
      expected: /I can't confirm Husen's current presence from verified data\./,
    },
  ];

  for (const { reply, options, expected } of cases) {
    const guarded = guardRealtimeBarberFacts(reply, {
      ...options,
      knownBarberNames: ['Husen'],
      responseLanguage: 'english',
    });
    assert.equal(guarded.triggered, true, reply);
    assert.match(guarded.sanitizedReply, expected, reply);
    assert.doesNotMatch(guarded.sanitizedReply, /\b(?:aku|kak|beliau|dijadwalkan|hari ini|tercatat)\b/i, reply);
    assert.doesNotMatch(guarded.sanitizedReply, /booking|redboxbarbershop\.com|https?:\/\//i, reply);
  }
});

test('Indonesian guard fallback remains unchanged and never adds CTA or URL', () => {
  const guarded = guardRealtimeBarberFacts('Mas Husen ada di sini.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    requestedClaim: 'presence',
    knownBarberNames: ['Husen'],
    responseLanguage: 'indonesian',
  });

  assert.equal(guarded.triggered, true);
  assert.equal(
    guarded.sanitizedReply,
    'Husen memang dijadwalkan masuk hari ini, Kak, tapi aku belum punya data kehadiran/check-in untuk memastikan beliau sudah hadir sekarang.',
  );
  assert.doesNotMatch(guarded.sanitizedReply, /booking|redboxbarbershop\.com|https?:\/\//i);
});

test('outbound guard preserves roster and verified schedule facts but binds authorization claim-locally', () => {
  const schedule = { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' };

  const roster = guardRealtimeBarberFacts('Mas Husen tercatat sebagai kapster Redbox CSB.', { verifiedSchedule: null });
  assert.equal(roster.triggered, false);
  assert.equal(roster.sanitizedReply, 'Mas Husen tercatat sebagai kapster Redbox CSB.');

  const planned = guardRealtimeBarberFacts('Mas Husen dijadwalkan masuk hari ini.', { verifiedSchedule: schedule });
  assert.equal(planned.triggered, false);

  const otherBarber = guardRealtimeBarberFacts('Mas Bob ada di sini.', { verifiedSchedule: schedule });
  assert.equal(otherBarber.triggered, true);
  assert.doesNotMatch(otherBarber.sanitizedReply, /Bob ada di sini/i);

  const freeUpgrade = guardRealtimeBarberFacts('Mas Husen free.', {
    verifiedSchedule: schedule,
    requestedClaim: 'availability',
  });
  assert.equal(freeUpgrade.triggered, true);
  assert.match(freeUpgrade.sanitizedReply, /dijadwalkan masuk hari ini/i);
  assert.match(freeUpgrade.sanitizedReply, /belum bisa memastikan.*free\/tersedia/i);
});

test('Task14 booking execution authority remains disabled', () => {
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

test('production handleMessage intercepts a first-turn presence query before orchestrator and every response LLM fallback', async () => {
  const observations = { orchestrator: 0, openAI: 0, schedule: 0, sent: [] };
  const result = await handleMessage({
    from: '628100000001',
    name: 'Kak',
    text: 'Mas Husen ada?',
    device: '0818202889',
    receiver: '0818202889',
    branchFromPayload: 'csb',
    providerDeviceHash: 'device-hash',
  }, {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    orchestrate: async () => { observations.orchestrator += 1; return null; },
    generateReddy: async () => {
      observations.openAI += 1;
      return 'Mas Husen ada di sini. Langsung booking ya.';
    },
    send: async (_to, reply) => {
      observations.sent.push(reply);
      return { status: true };
    },
    getSupabaseClient: () => ({}),
    loadBarbers: async () => ({ status: 'verified', barbers: [HUSEN], reason: null }),
    getSchedule: async (_supabase, { date }) => {
      observations.schedule += 1;
      return { status: 'scheduled', source: 'planned_schedule_lookup', date };
    },
    logTelemetry: () => {},
    recordEvaluation: async () => {},
    persistConversation: async () => {},
  });

  assert.equal(observations.orchestrator, 0);
  assert.equal(observations.openAI, 0);
  assert.equal(observations.schedule, 1);
  assert.equal(observations.sent.length, 1);
  assert.equal(result.used, 'reddy_barber_presence_guard');
  assert.match(result.reply, /dijadwalkan masuk hari ini/i);
  assert.match(result.reply, /belum punya data (check-in\/kehadiran|kehadiran\/check-in)/i);
  assert.doesNotMatch(result.reply, /langsung booking|redboxbarbershop\.com/i);
});

test('production handleMessage preserves the existing English route before presence presentation', async () => {
  const observations = { orchestrator: 0, openAI: 0, schedule: 0, sent: [], modelContext: null };
  const result = await handleMessage({
    from: '628100000001',
    name: 'Customer',
    text: 'Husen available?',
    device: '0818202889',
    receiver: '0818202889',
    branchFromPayload: 'csb',
    providerDeviceHash: 'device-hash',
  }, {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => ({
      history: [
        { role: 'user', content: 'Hello, I need help.' },
        { role: 'assistant', content: 'How can I help?' },
      ],
      status: 'available',
    }),
    orchestrate: async () => {
      observations.orchestrator += 1;
      return { intent: 'barber_inquiry', route: 'reddy_agent', agent: 'reddy_agent' };
    },
    generateReddy: async (...args) => {
      observations.openAI += 1;
      observations.modelContext = args[6];
      return 'Husen is scheduled today. Live attendance is unverified, and slot availability is unverified.';
    },
    send: async (_to, reply) => {
      observations.sent.push(reply);
      return { status: true };
    },
    getSupabaseClient: () => ({}),
    loadBarbers: async () => ({ status: 'verified', barbers: [HUSEN], reason: null }),
    getSchedule: async (_supabase, { date }) => {
      observations.schedule += 1;
      return { status: 'scheduled', source: 'planned_schedule_lookup', date };
    },
    resolveKnowledge: () => null,
    logTelemetry: () => {},
    recordEvaluation: async () => {},
    persistConversation: async () => {},
  });

  assert.equal(observations.orchestrator, 1);
  assert.equal(observations.openAI, 1);
  assert.equal(observations.schedule, 1);
  assert.equal(observations.modelContext?.response_language, 'english');
  assert.equal(observations.modelContext?.barber_presence_fact_decision?.schedule_status, 'scheduled');
  assert.equal(observations.modelContext?.barber_presence_fact_decision?.attendance_status, 'unavailable');
  assert.equal(observations.modelContext?.barber_presence_fact_decision?.availability_status, 'unverified');
  assert.match(result.reply, /scheduled today/i);
  assert.match(result.reply, /attendance is unverified/i);
  assert.doesNotMatch(result.reply, /\b(?:aku|kak|beliau|dijadwalkan|hari ini)\b/i);
});

test('legacy response fallback also applies the outbound presence guard before send', async () => {
  const sent = [];
  const result = await handleMessage({
    from: '628100000001',
    name: 'Kak',
    text: 'Kapster CSB siapa saja?',
    device: '0818202889',
    receiver: '0818202889',
    branchFromPayload: 'csb',
    providerDeviceHash: 'device-hash',
  }, {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    orchestrate: async () => null,
    resolveKnowledge: () => ({ status: 'verified', facts: [], provenance: [] }),
    generateReddy: async () => 'Mas Husen ada di sini.',
    send: async (_to, reply) => { sent.push(reply); return { status: true }; },
    logTelemetry: () => {},
    recordEvaluation: async () => {},
  });

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /Husen ada di sini/i);
  assert.match(sent[0], /belum bisa memastikan|data yang terverifikasi/i);
  assert.equal(result.reply, sent[0]);
});

for (const unsafeLegacyReply of ['Husen is available now.', 'Husen is here.']) {
  test(`legacy English fallback blocks canonical barber claim before send: ${unsafeLegacyReply}`, async () => {
    const sent = [];
    const result = await handleMessage({
      from: '628100000001',
      name: 'Customer',
      text: 'Husen available?',
      device: '0818202889',
      receiver: '0818202889',
      branchFromPayload: 'csb',
      providerDeviceHash: 'device-hash',
    }, {
      getHandoffState: async () => ({ status: 'none', case: null }),
      touchLifecycle: async () => ({ reopened: false }),
      loadConversationHistory: async () => ({
        history: [{ role: 'user', content: 'Hello, I need help.' }],
        status: 'available',
      }),
      orchestrate: async () => null,
      resolveKnowledge: () => null,
      generateReddy: async () => unsafeLegacyReply,
      send: async (_to, reply) => { sent.push(reply); return { status: true }; },
      getSupabaseClient: () => ({}),
      loadBarbers: async () => ({ status: 'verified', barbers: [HUSEN], reason: null }),
      getSchedule: async () => assert.fail('legacy canonical identity lookup must not become schedule authority'),
      logTelemetry: () => {},
      recordEvaluation: async () => {},
      persistConversation: async () => {},
    });

    assert.equal(sent.length, 1);
    assert.equal(result.reply, sent[0]);
    assert.doesNotMatch(sent[0], /Husen is (?:available|here)/i);
    assert.match(sent[0], /I can't confirm Husen's current presence from verified data\./i);
    assert.doesNotMatch(sent[0], /\b(?:aku|kak|beliau|dijadwalkan|hari ini|tercatat)\b/i);
    assert.doesNotMatch(sent[0], /booking|redboxbarbershop\.com|https?:\/\//i);
  });
}

test('legacy matched presence query fails closed in English when canonical identity lookup fails', async () => {
  const sent = [];
  const result = await handleMessage({
    from: '628100000001',
    name: 'Customer',
    text: 'Husen available?',
    device: '0818202889',
    receiver: '0818202889',
    branchFromPayload: 'csb',
    providerDeviceHash: 'device-hash',
  }, {
    getHandoffState: async () => ({ status: 'none', case: null }),
    touchLifecycle: async () => ({ reopened: false }),
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    orchestrate: async () => null,
    resolveKnowledge: () => null,
    generateReddy: async () => 'Husen is available now.',
    send: async (_to, reply) => { sent.push(reply); return { status: true }; },
    getSupabaseClient: () => ({}),
    loadBarbers: async () => { throw new Error('canonical lookup unavailable'); },
    getSchedule: async () => assert.fail('failed canonical lookup must not attempt schedule authority'),
    logTelemetry: () => {},
    recordEvaluation: async () => {},
    persistConversation: async () => {},
  });

  assert.equal(result.reply, sent[0]);
  assert.equal(result.reply, "I can't confirm the barber's current presence from verified data.");
  assert.doesNotMatch(result.reply, /booking|redboxbarbershop\.com|https?:\/\//i);
});
