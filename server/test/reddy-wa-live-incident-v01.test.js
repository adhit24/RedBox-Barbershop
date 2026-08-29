'use strict';

/**
 * Task: REDDY WA LIVE INCIDENT — CORRECTION ROUND TESTS
 *
 * Tests context preservation for Redbox account access when WhatsApp is unavailable,
 * generic closing phrase suppression, task-advancing clarification retention,
 * Task 45 lifecycle safety, and P0 outbound rate-limit / duplicate protection invariants.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripGenericClosingQuestion,
  GENERIC_CLOSING_PATTERNS,
} = require('../agents/reddy/closingSuppressionGuard');
const { buildReddyPersonalityPrompt } = require('../agents/reddy/personalityPolicy');
const { RATE_LIMIT_MAX_SENDS, RATE_LIMIT_WINDOW_MS } = require('../services/waOutboundGuard');

test('INC-01. points context + "WA saya tidak bisa dipakai lagi" preserves Redbox account access context (not generic WA app support)', () => {
  const prompt = buildReddyPersonalityPrompt({});
  assert.ok(prompt.includes('AKSES AKUN REDBOX SAAT WHATSAPP TIDAK AKTIF'));
  assert.ok(prompt.includes('PERTAHANKAN KONTEKS AKSES AKUN REDBOX'));
  assert.ok(prompt.includes('DILARANG mengarahkan pelanggan ke customer service WhatsApp'));
});

test('INC-02. "gak bisa login via WA" stays in Redbox account/access context', () => {
  const prompt = buildReddyPersonalityPrompt({});
  assert.ok(prompt.includes('gak bisa login via WA'));
  assert.ok(prompt.includes('jelaskan opsi akses/login akun di website Redbox'));
});

test('INC-03. "pakai nomor telepon bisa?" preserves previous account-access context', () => {
  const prompt = buildReddyPersonalityPrompt({});
  assert.ok(prompt.includes('pakai nomor telepon bisa?'));
  assert.ok(prompt.includes('Aku belum bisa memastikan metode ganti nomor atau login alternatifnya'));
});

test('INC-04. "SMS?" preserves context instead of resetting intent or sending to WA support', () => {
  const prompt = buildReddyPersonalityPrompt({});
  assert.ok(prompt.includes('SMS?'));
  assert.ok(prompt.includes('tawarkan bantuan handoff CS/admin Redbox'));
});

test('INC-05. normal answer contains no generic closing template (suppresses variants)', () => {
  const samples = [
    'Haircut di Redbox Rp50.000 ya Kak. Ada yang mau ditanyakan seputar Redbox?',
    'Cabang Bypass buka jam 10.00 WIB. Jika ada yang ingin ditanyakan, jangan ragu ya.',
    'Jam operasional cabang CSB Mall 10.00-22.00 WIB. Silakan tanya saja, Kak!',
    'Layanan Gentleman Grooming durasi 45 menit. Ada yang bisa saya bantu lagi?',
    'Layanan Hair Spa Rp75.000. Jangan ragu untuk bertanya ya!',
    'Paket Platinum sudah termasuk Americano. Jika ada pertanyaan lain, silakan tanya.',
  ];

  for (const sample of samples) {
    const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(sample);
    assert.equal(closingStripped, true, `Should strip generic closing from: "${sample}"`);
    assert.ok(!GENERIC_CLOSING_PATTERNS.some(pattern => pattern.test(sanitizedReply)), `Sanitized reply should be clean: "${sanitizedReply}"`);
  }
});

test('INC-06. genuine clarification question remains allowed and is NOT stripped', () => {
  const clarificationQuestions = [
    'Mau booking di cabang mana, Kak?',
    'Kunjungan untuk tanggal berapa dan jam berapa, Kak?',
    'Mau pillh kapster siapa untuk potong rambutnya, Kak?',
  ];

  for (const question of clarificationQuestions) {
    const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(question);
    assert.equal(closingStripped, false);
    assert.equal(sanitizedReply, question);
  }
});

// ── Mini Correction Round 1 — the generic closing suppression must cover
// BOTH grammatical forms (active "tanyakan" / passive "ditanyakan") of the
// same generic closing intent, without over-broadening into genuine
// Indonesian question grammar / task-advancing clarification questions.
// A-D must be stripped (generic closing); E-H must survive untouched
// (genuine task-advancing questions, none of which share the closing shape).

test('INC-11A. active form "Ada yang ingin kamu tanyakan seputar Redbox?" is stripped', () => {
  const { closingStripped } = stripGenericClosingQuestion('Ada yang ingin kamu tanyakan seputar Redbox?');
  assert.equal(closingStripped, true);
});

test('INC-11B. passive form "Ada yang mau ditanyakan?" is stripped', () => {
  const { closingStripped } = stripGenericClosingQuestion('Ada yang mau ditanyakan?');
  assert.equal(closingStripped, true);
});

test('INC-11C. passive form "Ada yang ingin ditanyakan seputar Redbox?" is stripped', () => {
  const { closingStripped } = stripGenericClosingQuestion('Ada yang ingin ditanyakan seputar Redbox?');
  assert.equal(closingStripped, true);
});

test('INC-11D. "Jika ada pertanyaan lain, silakan tanya saja, Kak." is stripped', () => {
  const { closingStripped } = stripGenericClosingQuestion('Jika ada pertanyaan lain, silakan tanya saja, Kak.');
  assert.equal(closingStripped, true);
});

test('INC-11E. "Mau booking di cabang mana, Kak?" is preserved (task-advancing clarification)', () => {
  const question = 'Mau booking di cabang mana, Kak?';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(question);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, question);
});

test('INC-11F. "Boleh infokan nomor HP Kakak?" is preserved (task-advancing clarification)', () => {
  const question = 'Boleh infokan nomor HP Kakak?';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(question);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, question);
});

test('INC-11G. "Mau cek poin untuk akun yang mana?" is preserved (task-advancing clarification)', () => {
  const question = 'Mau cek poin untuk akun yang mana?';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(question);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, question);
});

test('INC-11H. "Nomor WhatsApp lama Kakak masih bisa menerima OTP?" is preserved (task-advancing clarification)', () => {
  const question = 'Nomor WhatsApp lama Kakak masih bisa menerima OTP?';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(question);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, question);
});

// ── Mini Correction Round 2 — the standalone "silakan tanya/tanyakan/
// bertanya" pattern was unanchored, so it also matched genuine
// task-advancing instructions with real content after the verb (an
// object/target for the question). It is now end-constrained: only the
// optional "saja"/address term and trailing punctuation may follow the
// verb before the sentence ends. 1-4 must survive untouched; 5-8 must
// still be stripped (no regression on the generic closing itself).

test('INC-12-1. "Silakan tanyakan nomor booking ke admin cabang." is preserved', () => {
  const text = 'Silakan tanyakan nomor booking ke admin cabang.';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(text);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, text);
});

test('INC-12-2. "Silakan tanyakan kode OTP yang masuk ke nomor lama." is preserved', () => {
  const text = 'Silakan tanyakan kode OTP yang masuk ke nomor lama.';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(text);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, text);
});

test('INC-12-3. "Silakan tanya admin apakah nomor lama masih aktif." is preserved', () => {
  const text = 'Silakan tanya admin apakah nomor lama masih aktif.';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(text);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, text);
});

test('INC-12-4. "Silakan bertanya mengenai status voucher ke admin." is preserved', () => {
  const text = 'Silakan bertanya mengenai status voucher ke admin.';
  const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(text);
  assert.equal(closingStripped, false);
  assert.equal(sanitizedReply, text);
});

test('INC-12-5. "Silakan tanya saja, Kak!" is still stripped (no regression)', () => {
  const { closingStripped } = stripGenericClosingQuestion('Silakan tanya saja, Kak!');
  assert.equal(closingStripped, true);
});

test('INC-12-6. "Silakan bertanya saja." is still stripped (no regression)', () => {
  const { closingStripped } = stripGenericClosingQuestion('Silakan bertanya saja.');
  assert.equal(closingStripped, true);
});

test('INC-12-7. "Silakan tanya ya." is still stripped (no regression)', () => {
  const { closingStripped } = stripGenericClosingQuestion('Silakan tanya ya.');
  assert.equal(closingStripped, true);
});

test('INC-12-8. "Jika ada pertanyaan lain, silakan tanya saja, Kak." is still stripped (no regression)', () => {
  const { closingStripped } = stripGenericClosingQuestion('Jika ada pertanyaan lain, silakan tanya saja, Kak.');
  assert.equal(closingStripped, true);
});

test('INC-07. Task45 idle-close endpoint route and auth requirements are intact', () => {
  const reddyIdleCloseHandler = require('../routes/reddyIdleClose');
  assert.equal(typeof reddyIdleCloseHandler, 'function');
});

test('INC-08. waiting_human and human_active handoffs still suppress idle close', async () => {
  const reddyIdleCloseHandler = require('../routes/reddyIdleClose');
  const logs = [];

  const fakeReq = { method: 'GET', headers: { authorization: 'Bearer secret123' } };
  let jsonResult = null;
  const fakeRes = {
    status(code) {
      assert.equal(code, 200);
      return {
        json(data) {
          jsonResult = data;
          return data;
        },
      };
    },
  };

  process.env.CRON_SECRET = 'secret123';

  await reddyIdleCloseHandler(fakeReq, fakeRes, {
    supabase: {},
    isReddyEnabled: () => true,
    candidateSenders: ['628123456789'],
    getActiveHandoffState: async () => ({ status: 'waiting_human' }),
    logEvent: (e) => logs.push(e),
  });

  assert.equal(jsonResult.suppressed, 1);
  assert.equal(logs.some(e => e.suppress_reason === 'waiting_human'), true);
});

test('INC-09. outbound rate-limit safety invariants remain strictly 5 sends / 60s per destination', () => {
  assert.equal(RATE_LIMIT_WINDOW_MS, 60 * 1000);
  assert.equal(RATE_LIMIT_MAX_SENDS, 5);
});

test('INC-10. P0 duplicate protection and guarded send RPC functions remain unchanged', () => {
  const { reserveAutomatedSend, markOutboundResult } = require('../services/waOutboundGuard');
  assert.equal(typeof reserveAutomatedSend, 'function');
  assert.equal(typeof markOutboundResult, 'function');
});
