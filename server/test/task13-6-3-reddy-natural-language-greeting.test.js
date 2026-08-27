'use strict';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFirstName, buildReddyPersonalityPrompt, FORBIDDEN_ADDRESS_TERMS_REGEX } = require('../agents/reddy/personalityPolicy');
const { buildCustomerFactsContext } = require('../agents/reddy/customerFactsContext');
const { buildSystemPrompt, handleMessage, fallbackReply, callOpenAI } = require('../../api/wa/webhook');
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

// --- AIRA CORRECTION #1 TESTS (R1 - R7) ---

test('R1. extractFirstName() is used in runtime path, safely handling invalid inputs', () => {
  const invalidName1 = 'adhit@gmail.com';
  const invalidName2 = '+6281234567890';
  const invalidName3 = 'c-12345';

  assert.equal(extractFirstName(invalidName1), null);
  assert.equal(extractFirstName(invalidName2), null);
  assert.equal(extractFirstName(invalidName3), null);

  const prompt1 = buildSystemPrompt('bypass', 'expired', invalidName1);
  assert.equal(prompt1.includes('Hai Kak adhit@gmail.com'), false);
  assert.match(prompt1, /Hai Kak/);
});

test('R2. sessionStatus === "expired" is canonical new-session authority even with old history turns', () => {
  const promptExpired = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(promptExpired, /Kak Adhit/);
  assert.match(promptExpired, /AWAL SESI BARU/);
});

test('R3. sessionStatus active suppresses re-greeting and name overuse', () => {
  const promptActive = buildSystemPrompt('bypass', 'active_conversation', 'Adhit Nugraha');
  assert.match(promptActive, /ATURAN SUPRESI SALAM/);
  assert.match(promptActive, /DILARANG MENGULANG SAPAAN NAMA/);
});

test('R4. Direct question on new session allows "Hai Kak Adhit, <answer>" blended greeting', () => {
  const promptExpired = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(promptExpired, /leburkan salam dan jawaban secara alami/);
  assert.match(promptExpired, /Hai Kak Adhit, Haircut di Redbox/);
});

test('R5. Direct question on new session strictly forbids ceremonial greeting and generic greeting', () => {
  const promptExpired = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(promptExpired, /DILARANG menggunakan ceremonial greeting/);
  assert.match(promptExpired, /DILARANG menggunakan sapaan generik terpisah/);
});

test('R6. fallbackReply uses extractFirstName() safely', () => {
  const replyValid = fallbackReply('halo', 'Adhit Nugraha', 'bypass');
  assert.match(replyValid, /Kak Adhit/);

  const replyInvalid = fallbackReply('halo', 'c-12345', 'bypass');
  assert.equal(replyInvalid.includes('c-12345'), false);
  assert.match(replyInvalid, /Kak/);
});

test('R7. Trusted CRM name source rule remains enforced; unverified names strictly fall back to generic Kak', () => {
  const promptUnverified = buildSystemPrompt('bypass', 'expired', null);
  assert.equal(promptUnverified.includes('Kak Boss Besar'), false);
  assert.match(promptUnverified, /Hai Kak/);
});

// --- RUNTIME callOpenAI TESTS (RUNTIME1 - RUNTIME6) ---

test('RUNTIME1. callOpenAI injects Kak Adhit greeting for sessionStatus="expired" even when historical turns exist', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Hai Kak Adhit, Haircut di Redbox Rp40.000 ya.' } }] };
        },
      },
    },
  };

  const historyTurns = [
    { role: 'user', content: 'kemarin potong jam berapa' },
    { role: 'assistant', content: 'kemarin buka jam 10' },
    { role: 'user', content: 'makasih' },
  ];

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    'Adhit Nugraha',
    'bypass',
    { sessionStatus: 'expired', turns: historyTurns },
    null,
    null,
    { openai: mockOpenAI }
  );

  const systemMsg = capturedMessages.find(m => m.role === 'system' && m.content.includes('Nama terverifikasi customer CRM ini'));
  assert.ok(systemMsg, 'System message instruction for new session must be injected');
  assert.match(systemMsg.content, /Kak Adhit/);
  assert.match(systemMsg.content, /Ini awal sesi baru/);
});

test('RUNTIME2. callOpenAI suppresses new-session greeting when sessionStatus="active_conversation"', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Haircut di Redbox Rp40.000 ya.' } }] };
        },
      },
    },
  };

  const historyTurns = [
    { role: 'user', content: 'halo' },
    { role: 'assistant', content: 'Hai Kak Adhit!' },
  ];

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    'Adhit Nugraha',
    'bypass',
    { sessionStatus: 'active_conversation', turns: historyTurns },
    null,
    null,
    { openai: mockOpenAI }
  );

  const systemMsg = capturedMessages.find(m => m.role === 'system' && m.content.includes('Sesi percakapan ini sedang AKTIF'));
  assert.ok(systemMsg, 'System message instruction for active session must be injected');
  assert.match(systemMsg.content, /DILARANG mengulang salam pembuka/);
});

test('RUNTIME3. callOpenAI ignores email-shaped name and does not inject Kak adhit@gmail.com', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Haircut di Redbox Rp40.000 ya Kak.' } }] };
        },
      },
    },
  };

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    'adhit@gmail.com',
    'bypass',
    { sessionStatus: 'expired' },
    null,
    null,
    { openai: mockOpenAI }
  );

  const namedInstruction = capturedMessages.find(m => m.role === 'system' && m.content.includes('adhit@gmail.com'));
  assert.equal(namedInstruction, undefined, 'Invalid email name must not trigger named greeting instruction');
});

test('RUNTIME4. callOpenAI ignores phone-number-shaped name and falls back to generic Kak', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Haircut di Redbox Rp40.000 ya Kak.' } }] };
        },
      },
    },
  };

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    '+6281234567890',
    'bypass',
    { sessionStatus: 'expired' },
    null,
    null,
    { openai: mockOpenAI }
  );

  const namedInstruction = capturedMessages.find(m => m.role === 'system' && m.content.includes('+6281234567890'));
  assert.equal(namedInstruction, undefined, 'Phone number name must not trigger named greeting instruction');
});

test('RUNTIME5. Source scan confirms NO raw name.trim().split(" ")[0] remains in api/wa/webhook.js', () => {
  const path = require('path');
  const webhookContent = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.equal(webhookContent.includes(".trim().split(' ')[0]"), false, 'No raw .trim().split(" ")[0] allowed in webhook.js');
});

test('RUNTIME6. buildSystemPrompt direct-question rules explicitly permit short personalized greeting for expired/new session', () => {
  const promptExpired = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(promptExpired, /leburkan salam dan jawaban secara alami/);
  assert.match(promptExpired, /Hai Kak Adhit, Haircut di Redbox/);
  assert.match(promptExpired, /DILARANG menggunakan ceremonial greeting/);
});

test('RUNTIME7. Active conversation with empty history turns does NOT trigger new-session greeting (suppression rule applies)', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Haircut di Redbox Rp40.000 ya.' } }] };
        },
      },
    },
  };

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    'Adhit Nugraha',
    'bypass',
    { sessionStatus: 'active_conversation', turns: [] },
    null,
    null,
    { openai: mockOpenAI }
  );

  const systemMsg = capturedMessages.find(m => m.role === 'system');
  assert.ok(systemMsg, 'System message must exist');
  assert.match(systemMsg.content, /INSTRUKSI SUPRESI SALAM \(SESI AKTIF\)/);
  assert.equal(systemMsg.content.includes('INSTRUKSI SALAM SESI BARU'), false);
});

test('RUNTIME8. Expired session status with empty history turns triggers new-session greeting instruction', async () => {
  let capturedMessages = [];
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (params) => {
          capturedMessages = params.messages;
          return { choices: [{ message: { content: 'Hai Kak Adhit, Haircut di Redbox Rp40.000 ya.' } }] };
        },
      },
    },
  };

  await callOpenAI(
    '6281234567890',
    'Haircut berapa?',
    'Adhit Nugraha',
    'bypass',
    { sessionStatus: 'expired', turns: [] },
    null,
    null,
    { openai: mockOpenAI }
  );

  const systemMsg = capturedMessages.find(m => m.role === 'system');
  assert.ok(systemMsg, 'System message must exist');
  assert.match(systemMsg.content, /INSTRUKSI SALAM SESI BARU/);
  assert.match(systemMsg.content, /Kak Adhit/);
});
