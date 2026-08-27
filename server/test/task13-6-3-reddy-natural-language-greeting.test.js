'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFirstName, buildReddyPersonalityPrompt, FORBIDDEN_ADDRESS_TERMS_REGEX } = require('../agents/reddy/personalityPolicy');
const { buildCustomerFactsContext } = require('../agents/reddy/customerFactsContext');
const { buildSystemPrompt, handleMessage, fallbackReply } = require('../../api/wa/webhook');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

test('N1. New session + trusted CRM name "Adhit Nugraha" greets with "Kak Adhit"', () => {
  const name = 'Adhit Nugraha';
  const firstName = extractFirstName(name);
  assert.equal(firstName, 'Adhit');

  const systemPrompt = buildSystemPrompt('bypass', 'expired', name);
  assert.match(systemPrompt, /Kak Adhit/);
  assert.equal(systemPrompt.includes('Kak Adhit Nugraha'), false);
});

test('N2. New session + direct question instructs combined natural greeting and answer', () => {
  const systemPrompt = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(systemPrompt, /leburkan salam dan jawaban secara alami/i);
});

test('N3. Same session, second message instructs NO repeated "Kak Adhit" greeting', () => {
  const promptActive = buildSystemPrompt('bypass', 'active_conversation', 'Adhit Nugraha');
  assert.match(promptActive, /ATURAN SUPRESI SALAM/);
  assert.match(promptActive, /DILARANG MENGULANG SAPAAN NAMA/);
});

test('N4. New session + no trusted name uses generic "Kak" greeting', () => {
  const promptNoName = buildSystemPrompt('bypass', 'expired', null);
  assert.match(promptNoName, /Hai Kak/);
  assert.equal(promptNoName.includes('Kak Adhit'), false);
});

test('N5. WhatsApp display name exists but CRM trusted name unavailable: do NOT use WhatsApp display name as verified name', () => {
  const promptWA = buildSystemPrompt('bypass', 'expired', null);
  assert.equal(promptWA.includes('Boss Besar'), false);
  assert.equal(promptWA.includes('unverified'), false);

  const fn = extractFirstName('6281234567890');
  assert.equal(fn, null);
});

test('N6. Safe first name extraction handles edge cases deterministically', () => {
  assert.equal(extractFirstName('Adhit Nugraha'), 'Adhit');
  assert.equal(extractFirstName('  Adhit   Nugraha '), 'Adhit');
  assert.equal(extractFirstName('Adhit'), 'Adhit');
  assert.equal(extractFirstName(''), null);
  assert.equal(extractFirstName(null), null);
  assert.equal(extractFirstName('Kak'), null);
  assert.equal(extractFirstName('+6281234567890'), null);
  assert.equal(extractFirstName('adhit@gmail.com'), null);
  assert.equal(extractFirstName('c-12345'), null);
});

test('N7. Customer asks last visit: instructions prefer natural "Terakhir kamu ke Redbox..." over stiff system words', () => {
  const factsBlock = buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts: {
      last_visit: '2026-08-11',
      last_visit_branch: 'RedBox Bypass',
      last_visit_barber: 'Onoy',
      last_visit_service: 'Gentleman Grooming',
    },
  });

  assert.match(factsBlock, /Terakhir kamu ke Redbox/);
  assert.match(factsBlock, /Gantikan frasa kaku/);
});

test('N8. Customer asks latest booking: facts context uses latest_booking_* semantics', () => {
  const factsBlock = buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts: {
      latest_booking_date: '2026-05-19',
      latest_booking_time: '14:00',
      latest_booking_status: 'cancelled',
    },
  });

  assert.match(factsBlock, /latest_booking_\*/);
  assert.match(factsBlock, /Booking terakhir kamu/);
});

test('N9. Cancelled booking wording is natural and explicit (dibatalkan / dibatalin)', () => {
  const factsBlock = buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts: {
      latest_booking_date: '2026-05-19',
      latest_booking_status: 'cancelled',
      last_visit: '2026-08-11',
    },
  });

  assert.match(factsBlock, /dibatalkan \/ dibatalin/);
  assert.match(factsBlock, /NEVER replaces last_visit/);
});

test('N10. Customer confuses booking with visit: rules mandate natural, accurate correction', () => {
  const factsBlock = buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts: {
      latest_booking_date: '2026-05-19',
      latest_booking_status: 'cancelled',
      last_visit: '2026-08-11',
    },
  });

  assert.match(factsBlock, /Bukan Kak, yang 19 Mei itu booking yang dibatalin/);
});

test('N11. Favorite barber answer avoids administrative phrasing', () => {
  const factsBlock = buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts: {
      favorite_barber: 'Onoy',
      favorite_branch: 'RedBox Bypass',
    },
  });

  assert.match(factsBlock, /Kapster yang paling sering kamu pilih/);
  assert.match(factsBlock, /Avoid "berdasarkan frekuensi kunjungan terverifikasi"/);
});

test('N12. Simple price/service question does not automatically add booking CTA', async () => {
  const res = await handleMessage({ from: '6281234567890', text: 'harga haircut berapa?' });
  assert.equal(res.reply.includes('redboxbarbershop.com/booking.html'), false);
});

test('N13. System prompt strictly forbids slang address terms (bro, bos, gan)', () => {
  const systemPrompt = buildSystemPrompt('bypass', 'expired', 'Adhit');
  assert.match(systemPrompt, /DILARANG KERAS menyapa atau memanggil pelanggan dengan sebutan slang/);
  for (const term of ['Bro', 'Bruh', 'Bos', 'Bosku', 'Gan']) {
    assert.equal(FORBIDDEN_ADDRESS_TERMS_REGEX.some(r => r.test(term)), true);
  }
});

test('N14. Serious/error response contains zero emojis and no cheerful forced greeting', async () => {
  const res = await handleMessage({ from: '6281234567890', text: 'kemarin antri 30 menit males banget' });
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.reply), false);
  assert.equal(res.reply.includes('Selamat datang'), false);
});

test('N15. Existing Personality v2.1 name-overuse guard remains intact', () => {
  const promptActive = buildSystemPrompt('bypass', 'active_conversation', 'Adhit Nugraha');
  assert.match(promptActive, /DILARANG MENGULANG SAPAAN NAMA/);
  assert.match(promptActive, /Gunakan sapaan nama maksimal SATU KALI di awal sesi baru/);
});
