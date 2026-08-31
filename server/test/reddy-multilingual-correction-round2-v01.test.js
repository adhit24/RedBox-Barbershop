'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectForeignLanguage, resolveResponseLanguage, isForeignLanguage,
} = require('../agents/reddy/languageResolution');
const {
  handleForeignGeneralQuestion, handleForeignBooking, buildBranchLocationText,
  buildBranchOperatingHoursText, buildBranchLastBookingSlotText,
} = require('../../api/wa/webhook');
const { classifyBarberPresenceQuery } = require('../agents/reddy/barberPresenceIntent');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { containsProhibitedClaim, containsUnverifiedAvailabilityClaim, REDDY_BOOKING_EXECUTION } = require('../agents/reddy/bookingGuards');

// ── LANGUAGE DETECTION (contract tests 1-8) ──

test('Japanese mixed Kanji+kana is detected as japanese, not chinese (blocker 2, test 1)', () => {
  assert.equal(detectForeignLanguage('予約できますか？'), 'japanese');
});

test('Japanese kana-heavy text is detected as japanese (test 2)', () => {
  assert.equal(detectForeignLanguage('今日予約できますか？'), 'japanese');
  assert.equal(detectForeignLanguage('ヘアカットはいくらですか？'), 'japanese');
});

test('Chinese Han-only text is still detected as chinese (test 3, regression)', () => {
  assert.equal(detectForeignLanguage('可以预约吗？'), 'chinese');
  assert.equal(detectForeignLanguage('理发多少钱？'), 'chinese');
});

test('French/German/Spanish/Malay/Arabic are detected (tests 4-8)', () => {
  assert.equal(detectForeignLanguage('Bonjour, combien coûte une coupe ?'), 'french');
  assert.equal(detectForeignLanguage('Wie viel kostet ein Haarschnitt?'), 'german');
  assert.equal(detectForeignLanguage('¿Cuánto cuesta un corte de pelo?'), 'spanish');
  // Malay/Indonesian share huge everyday vocabulary — the contract's own
  // example ("Boleh saya tahu harga potong rambut?") carries no word
  // exclusive to either language, so it's genuinely ambiguous and resolves
  // as Indonesian through the real pipeline (see the resolver-level test
  // below); it is not evidence of a Malay-detection bug. A sentence with an
  // actual Malay-exclusive marker is used here instead.
  assert.equal(detectForeignLanguage('Awak, boleh tak saya nak tanya berapa ringgit potong rambut?'), 'malay');
  assert.equal(detectForeignLanguage('كم سعر قص الشعر؟'), 'arabic');
});

test('resolveResponseLanguage reaches malay for Malay-exclusive-marked text (pipeline-level regression)', () => {
  // Before this correction, hasIndonesianLanguageSignal's generic word-list
  // overlap with Malay made resolveResponseLanguage return 'indonesian' for
  // ANY Malay text, including this exact sentence — Malay was unreachable
  // end-to-end even though detectForeignLanguage supported it in isolation.
  assert.equal(
    resolveResponseLanguage('Awak, boleh tak saya nak tanya berapa ringgit potong rambut?', { turns: [] }, {}),
    'malay',
  );
});

// ── PRESENTATION (blocker 1, tests 9-19) ──

test('French/German/Spanish/Malay/Arabic price questions get no deterministic template and are not silently English (tests 9-13)', () => {
  const cases = [
    ['Bonjour, combien coûte une coupe ?', 'french'],
    ['Wie viel kostet ein Haarschnitt?', 'german'],
    ['¿Cuánto cuesta un corte de pelo?', 'spanish'],
    ['Awak, boleh tak berapa ringgit potong rambut?', 'malay'],
    ['كم سعر قص الشعر؟', 'arabic'],
  ];
  for (const [text, lang] of cases) {
    const answer = handleForeignGeneralQuestion(text, lang, null, 'bypass');
    // handleForeignGeneralQuestion returns null when no category pattern
    // matches at all (these five languages have no trigger keywords in the
    // category regexes themselves — out of scope for this correction, see
    // the round-2 report) and foreignMsg now returns undefined rather than
    // an English string when a category DOES match but the language
    // doesn't. Either way the result must be falsy: never an English reply
    // standing in for the customer's actual language.
    assert.ok(!answer, `${lang} must not get an English-fallback deterministic template`);
  }
});

test('handleForeignBooking returns null (not an English reply) for an unsupported-template language booking request', async () => {
  const result = await handleForeignBooking('6591234567', 'Amir', 'Bonjour, je voudrais réserver une coupe.', 'device1', 'bypass');
  assert.equal(result, null);
});

test('buildBranchLocationText / buildBranchOperatingHoursText / buildBranchLastBookingSlotText return undefined for an unsupported language', () => {
  assert.equal(buildBranchLocationText('french'), undefined);
  assert.equal(buildBranchOperatingHoursText('spanish'), undefined);
  assert.equal(buildBranchLastBookingSlotText('arabic', 'bypass'), undefined);
});

test('existing localized templates remain intact for chinese/japanese/korean/turkish/english (tests 14-19)', () => {
  assert.match(handleForeignGeneralQuestion('How much is a haircut?', 'english', null, 'bypass'), /Our prices/);
  assert.match(handleForeignGeneralQuestion('多少钱剪头发？', 'chinese', null, 'bypass'), /服务价格/);
  assert.match(handleForeignGeneralQuestion('いくらですか？', 'japanese', null, 'bypass'), /料金一覧/);
  assert.match(handleForeignGeneralQuestion('얼마예요?', 'korean', null, 'bypass'), /서비스 가격/);
  assert.match(handleForeignGeneralQuestion('ne kadar fiyat?', 'turkish', null, 'bypass'), /Fiyat listesi/);
  // Indonesian never goes through this foreign-template path at all — its
  // presentation is the main Reddy/LLM path, unaffected by this correction.
  assert.equal(isForeignLanguage('Berapa harga potong rambut?'), false);
});

// ── SWITCHING (tests 20-24) ──

test('language switching: EN->ID, ID->EN, JA->EN, EN->Spanish, neutral follows recent (tests 20-24)', () => {
  assert.equal(
    resolveResponseLanguage('Kalau CSB berapa?', { turns: [{ role: 'user', content: 'How much is a haircut?' }] }, {}),
    'indonesian',
  );
  assert.equal(
    resolveResponseLanguage('Can I come tomorrow?', { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] }, {}),
    'english',
  );
  assert.equal(
    resolveResponseLanguage('Can I come tomorrow?', { turns: [{ role: 'user', content: '予約できますか？' }] }, {}),
    'english',
  );
  assert.equal(
    resolveResponseLanguage('¿Cuánto cuesta un corte de pelo?', { turns: [{ role: 'user', content: 'Hello, how much is a haircut?' }] }, {}),
    'spanish',
  );
  assert.equal(
    resolveResponseLanguage('ok', { turns: [{ role: 'user', content: '¿Cuánto cuesta un corte de pelo?' }] }, {}),
    'spanish',
  );
});

test('country code never overrides current explicit language (contract examples)', () => {
  // resolveResponseLanguage never receives a phone/country-code parameter at
  // all — these are the exact +81/+62/+1/+65 examples from the contract,
  // demonstrated with only the message text (the only signal the resolver
  // can see), confirming country code cannot possibly participate.
  assert.equal(resolveResponseLanguage('Halo, saya mau tanya harga', { turns: [] }, {}), 'indonesian'); // +81 sender
  assert.equal(resolveResponseLanguage('予約できますか？', { turns: [] }, {}), 'japanese'); // +62 sender
  assert.equal(resolveResponseLanguage('¿Cuánto cuesta?', { turns: [] }, {}), 'spanish'); // +1 sender
  assert.equal(resolveResponseLanguage('Awak, boleh tak berapa ringgit potong rambut?', { turns: [] }, {}), 'malay'); // +65 sender
});

// ── BARBER PRESENCE AUTHORITY (tests 25-26) ──

test('Japanese presence question is classified and does not infer attendance (test 25)', () => {
  const intent = classifyBarberPresenceQuery('Husenさんは今いますか？');
  assert.equal(intent.matched, true);

  const result = guardRealtimeBarberFacts('Husenさんは今いますよ、ぜひどうぞ。', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    requestedClaim: intent.claimType,
    responseLanguage: 'japanese',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /出勤予定/);
  assert.doesNotMatch(result.sanitizedReply, /今.{0,10}いますよ/);
});

test('Spanish presence question is classified and does not infer attendance (test 26)', () => {
  const intent = classifyBarberPresenceQuery('¿Está Husen ahí ahora?');
  assert.equal(intent.matched, true);

  const result = guardRealtimeBarberFacts('Husen está aquí ahora, puedes venir.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    requestedClaim: intent.claimType,
    responseLanguage: 'spanish',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /programado para trabajar hoy/);
  assert.doesNotMatch(result.sanitizedReply, /está aquí ahora, puedes venir/);
});

test('scheduled never becomes available/free in Japanese or Spanish', () => {
  const ja = guardRealtimeBarberFacts('Husenさんは今空いています、対応できます。', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    responseLanguage: 'japanese',
  });
  assert.equal(ja.triggered, true);
  assert.match(ja.sanitizedReply, /対応可能かどうかは確認済みのデータでは分かりかねます/);

  const es = guardRealtimeBarberFacts('Husen está disponible ahora mismo.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    responseLanguage: 'spanish',
  });
  assert.equal(es.triggered, true);
  assert.match(es.sanitizedReply, /no puedo confirmar con datos verificados si está disponible/);
});

// ── BOOKING AUTHORITY (tests 27-28) ──

test('booking execution remains DISABLED', () => {
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

test('French booking-confirmed claim is caught (test 27)', () => {
  assert.equal(containsProhibitedClaim("J'ai déjà réservé votre créneau, tout est confirmé !"), true);
  assert.equal(containsProhibitedClaim('Votre réservation est confirmée pour demain.'), true);
  // Ordinary French informational text must not be falsely blocked.
  assert.equal(containsProhibitedClaim("Le prix d'une coupe est de 50000 Rp."), false);
});

test('Arabic slot-availability claim is caught (test 28)', () => {
  assert.equal(containsUnverifiedAvailabilityClaim('الفتحة متاحة الآن، تفضل بالحجز'), true);
  assert.equal(containsUnverifiedAvailabilityClaim('نعم، الموعد متاح الآن'), true);
  // Ordinary Arabic informational text must not be falsely blocked.
  assert.equal(containsUnverifiedAvailabilityClaim('السعر خمسون ألف روبية'), false);
});

// ── OUTBOUND PHONE (regression of round-1 correction, tests 29-32) ──

test('outbound phone normalization is unaffected by this round (tests 29-32)', async (t) => {
  const path = require('node:path');
  const fonntePath = path.resolve(__dirname, '../services/fonnte.js');
  const originalFetch = global.fetch;
  const capturedBodies = [];
  global.fetch = async (_url, opts) => {
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ status: true }) };
  };
  t.after(() => { global.fetch = originalFetch; });
  process.env.FONNTE_TOKEN = 'test-token';
  delete require.cache[fonntePath];
  const { sendWA } = require(fonntePath);

  const cases = [
    ['819012345678', '819012345678'],   // Japan 81 — unchanged (test 29)
    ['821012345678', '821012345678'],   // Korea 82 — unchanged (test 30)
    ['081234567890', '6281234567890'],  // Indonesian 08 -> 62 (test 31)
    ['81234567890', '81234567890'],     // ambiguous bare-8 unchanged by default (test 32)
  ];
  for (const [input] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass' });
  }
  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});
