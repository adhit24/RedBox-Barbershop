'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyConversationSession,
  isExplicitGreeting,
  isExplicitClosureSignal,
  buildReddyPersonalityPrompt,
  FORBIDDEN_ADDRESS_TERMS_REGEX,
} = require('../agents/reddy/personalityPolicy');

// ── 1. Deterministic Session Time Classification Tests (S01 - S09) ─────────
test('S01. Session Classification: 30 seconds delta -> active_turn', () => {
  const now = Date.now();
  const lastMsg = now - 30 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'active_turn');
});

test('S02. Session Classification: 1m 59s delta -> active_turn', () => {
  const now = Date.now();
  const lastMsg = now - (1 * 60 + 59) * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'active_turn');
});

test('S03. Session Classification: 3 minutes delta -> active_conversation', () => {
  const now = Date.now();
  const lastMsg = now - 3 * 60 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'active_conversation');
});

test('S04. Session Classification: 10 minutes delta -> active_conversation', () => {
  const now = Date.now();
  const lastMsg = now - 10 * 60 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'active_conversation');
});

test('S05. Session Classification: 14m 59s delta -> active_conversation', () => {
  const now = Date.now();
  const lastMsg = now - (14 * 60 + 59) * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'active_conversation');
});

test('S06. Session Classification: 20 minutes delta -> soft_continuity', () => {
  const now = Date.now();
  const lastMsg = now - 20 * 60 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'soft_continuity');
});

test('S07. Session Classification: 29m 59s delta -> soft_continuity', () => {
  const now = Date.now();
  const lastMsg = now - (29 * 60 + 59) * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'soft_continuity');
});

test('S08. Session Classification: 31 minutes delta -> expired', () => {
  const now = Date.now();
  const lastMsg = now - 31 * 60 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'expired');
});

test('S09. Session Classification: 2 hours delta -> expired', () => {
  const now = Date.now();
  const lastMsg = now - 2 * 60 * 60 * 1000;
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg });
  assert.equal(status, 'expired');
});

test('S10. Session Classification: Explicit closure signal overrides timestamp delta -> expired', () => {
  const now = Date.now();
  const lastMsg = now - 30 * 1000; // 30s ago
  const status = classifyConversationSession({ now, lastCustomerMessageAt: lastMsg, explicitClosure: true });
  assert.equal(status, 'expired');
});

// ── 2. Greeting & Closure Helper Tests ─────────────────────────────────────
test('G01. isExplicitGreeting identifies greeting keywords correctly', () => {
  assert.equal(isExplicitGreeting('halo'), true);
  assert.equal(isExplicitGreeting('pagi mas'), true);
  assert.equal(isExplicitGreeting('selamat sore kak'), true);
  assert.equal(isExplicitGreeting('harga haircut berapa'), false);
  assert.equal(isExplicitGreeting('terakhir aku potong kapan'), false);
});

test('G02. isExplicitClosureSignal identifies closure signals correctly', () => {
  assert.equal(isExplicitClosureSignal('makasih ya'), true);
  assert.equal(isExplicitClosureSignal('thanks bro'), true);
  assert.equal(isExplicitClosureSignal('oke deh'), true);
  assert.equal(isExplicitClosureSignal('mau booking slot'), false);
});

// ── 3. Customer Address Safety & Persona Tests (P01 - P12) ────────────────
test('P01. Verified CRM Name: System prompt allows Kak <first_name> without gender guessing', () => {
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: true, verifiedName: 'Adhit Nugraha' });
  assert.match(prompt, /Adhit/);
  assert.match(prompt, /MENEBRAK GENDER/);
});

test('P02. WhatsApp Display Name Safety: Unverified display names default to Kak', () => {
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: false, verifiedName: null });
  assert.match(prompt, /Kak/);
});

test('P03. Forbidden Address Terms: Prompt strictly forbids Bro, Bruh, Bos, Gan, Agank', () => {
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: true, verifiedName: 'Adhit' });
  assert.match(prompt, /Bro/);
  assert.match(prompt, /Bos/);
  assert.match(prompt, /Gan/);
});

test('P04. Greeting Suppression: Active session statuses append re-greeting suppression rule', () => {
  const promptTurn = buildReddyPersonalityPrompt({ sessionStatus: 'active_turn' });
  assert.match(promptTurn, /ATURAN SUPRESI SALAM/);

  const promptConv = buildReddyPersonalityPrompt({ sessionStatus: 'active_conversation' });
  assert.match(promptConv, /ATURAN SUPRESI SALAM/);

  const promptSoft = buildReddyPersonalityPrompt({ sessionStatus: 'soft_continuity' });
  assert.match(promptSoft, /ATURAN SUPRESI SALAM/);

  const promptExpired = buildReddyPersonalityPrompt({ sessionStatus: 'expired' });
  assert.equal(promptExpired.includes('ATURAN SUPRESI SALAM'), false);
});

test('P05. Slang Address Safety Assertion: Forbidden terms regex correctly flags over-familiar customer addressing', () => {
  const testOutputs = [
    'Hair Cut Rp85.000, Bro.',
    'Terakhir sama Ubay, Bos.',
    'Sama-sama, Gan.',
    'Boleh Brother, mau booking cabang mana?',
  ];

  for (const out of testOutputs) {
    const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(out));
    assert.equal(isForbidden, true, 'Target output must be flagged as forbidden address term');
  }
});

test('P06. Safe Customer Address Terms: Kak / Mas / Bapak / Ibu / No-term are NOT flagged', () => {
  const safeOutputs = [
    'Hair Cut Rp85.000.',
    'Hair Cut Rp85.000, Kak.',
    'Terakhir kamu potong sama Ubay di Bypass, Kak.',
    'Sama-sama, Kak!',
    'Sama-sama.',
  ];

  for (const out of safeOutputs) {
    const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(out));
    assert.equal(isForbidden, false, 'Safe output must NOT be flagged');
  }
});

// ── 4. End-to-End Persona & Session Integration Tests (C01 - C06, P07 - P12) 
test('C01. Session Continuity: 3 min pause on "Bypass aja" retains context without re-greeting', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  let passedSystemPrompt = null;
  const mockCallOpenAI = async (from, text, name, branch, knowledgeFactsContext, factsContext, convContext) => {
    assert.equal(knowledgeFactsContext, null);
    passedSystemPrompt = convContext?.sessionStatus;
    return 'Oke, cabang Bypass.';
  };

  const now = Date.now();
  const lastActiveAt = now - 3 * 60 * 1000; // 3 min ago -> active_conversation

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'Bypass aja', conversationContext: { sessionStatus: 'active_conversation', lastActiveAt } },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(res.reply, 'Oke, cabang Bypass.');
  assert.equal(res.reply.includes('Halo Kak'), false);
  assert.equal(res.reply.includes('Selamat datang'), false);
});

test('C05. Direct Intent: >30 min expired query "harga haircut berapa?" returns direct answer without greeting', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async () => {
    return 'Hair Cut Rp85.000.';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'harga haircut berapa?', conversationContext: { sessionStatus: 'expired' } },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(res.reply, 'Hair Cut Rp85.000.');
  assert.equal(res.reply.includes('Halo'), false);
  assert.equal(res.reply.includes('Selamat datang'), false);
});

test('P04. Slang Safety: Customer saying "bro haircut berapa?" results in zero "Bro" in output', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async (from, text) => {
    // Assert customer input contains slang, but Reddy reply must NOT address customer as Bro
    return 'Hair Cut Rp85.000.';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'bro haircut berapa?' },
    { callOpenAI: mockCallOpenAI }
  );

  const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(res.reply));
  assert.equal(isForbidden, false, 'Reddy reply must contain ZERO "Bro"');
  assert.equal(res.reply, 'Hair Cut Rp85.000.');
});

test('P05. Slang Safety: Customer saying "thanks bro" results in "Sama-sama, Kak!" without "Bro"', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async () => {
    return 'Sama-sama, Kak!';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'thanks bro' },
    { callOpenAI: mockCallOpenAI }
  );

  const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(res.reply));
  assert.equal(isForbidden, false);
  assert.equal(res.reply.includes('Bro'), false);
  assert.match(res.reply, /Sama-sama/);
});

test('P06. Slang Safety: Customer saying "bos mau booking" does NOT address customer as Bos', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async () => {
    return 'Boleh Kak, mau booking di cabang mana?';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'bos mau booking' },
    { callOpenAI: mockCallOpenAI }
  );

  const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(res.reply));
  assert.equal(isForbidden, false);
  assert.equal(res.reply.includes('Bos'), false);
  assert.match(res.reply, /Boleh Kak/);
});

test('P07. Slang Safety: Customer saying "gan terakhir aku potong kapan?" does NOT address customer as Gan', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async () => {
    return 'Terakhir kamu potong tanggal 25 Agustus di Bypass.';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'gan terakhir aku potong kapan?' },
    { callOpenAI: mockCallOpenAI }
  );

  const isForbidden = FORBIDDEN_ADDRESS_TERMS_REGEX.some(regex => regex.test(res.reply));
  assert.equal(isForbidden, false);
  assert.equal(res.reply.includes('Gan'), false);
});

// ── 5. Aira Round 2 Required Integration & Wiring Tests ─────────────────
test('R01. Real Webhook Session Derivation: extractConversationContextEnvelope derives sessionStatus from history timestamps', () => {
  const { extractConversationContextEnvelope } = require('../agents/reddy/conversationContext');

  const now = Date.now();
  const threeMinAgo = now - 3 * 60 * 1000;
  const historyInput = [
    { role: 'user', content: 'mau tanya cabang', timestamp: threeMinAgo },
    { role: 'assistant', content: 'Boleh, mau Bypass atau Sumber?', timestamp: threeMinAgo + 1000 },
  ];

  const envelope = extractConversationContextEnvelope(historyInput, 'Bypass aja', { now });
  assert.equal(envelope.sessionStatus, 'active_conversation');
  assert.equal(envelope.lastCustomerTimestamp, threeMinAgo);
  assert.equal(envelope.turns.length, 2);
});

test('R02. Personality Prompt Wiring: System prompt generation explicitly includes PEDOMAN BEHAVIORAL & SUPRESI SALAM', () => {
  const { buildSystemPrompt } = require('../../api/wa/webhook');

  const systemPrompt = buildSystemPrompt('bypass', 'active_conversation', 'Adhit Nugraha');
  assert.match(systemPrompt, /PEDOMAN BEHAVIORAL & PERSONALITAS REDDY/);
  assert.match(systemPrompt, /ATURAN SUPRESI SALAM/);
  assert.match(systemPrompt, /Adhit/);
});

test('R03. Expired Session Prompt: Re-greeting suppression rule is absent when sessionStatus is expired', () => {
  const { buildSystemPrompt } = require('../../api/wa/webhook');

  const systemPrompt = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(systemPrompt, /PEDOMAN BEHAVIORAL & PERSONALITAS REDDY/);
  assert.equal(systemPrompt.includes('ATURAN SUPRESI SALAM'), false);
});

test('R04. Verified Name Source vs WhatsApp Display Name: Only verified CRM name reaches prompt', () => {
  const { buildSystemPrompt } = require('../../api/wa/webhook');

  // Case A: Verified CRM name "Adhit Nugraha"
  const promptA = buildSystemPrompt('bypass', 'expired', 'Adhit Nugraha');
  assert.match(promptA, /Adhit/);

  // Case B: WhatsApp display name "Boss Besar" (passed as unverified / null for CRM name)
  const promptB = buildSystemPrompt('bypass', 'expired', null);
  assert.match(promptB, /Kak/);
  assert.equal(promptB.includes('Boss Besar'), false);
});

test('R05. Direct Intent After Expiry: Direct queries on expired sessions answer directly without greeting', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  const mockCallOpenAI = async (from, text, name, branch, knowledgeFactsContext, factsContext, convContext) => {
    assert.equal(knowledgeFactsContext, null);
    assert.equal(convContext?.sessionStatus, 'expired');
    return 'Hair Cut Rp85.000.';
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'harga haircut berapa?', conversationContext: { sessionStatus: 'expired' } },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(res.reply, 'Hair Cut Rp85.000.');
  assert.equal(res.reply.includes('Halo'), false);
  assert.equal(res.reply.includes('Selamat datang'), false);
});

// ── 6. Aira Round 3 Required Hardening Tests (T01 - T07) ─────────────────
test('T01. OPENAI MESSAGE SHAPE: Prepared OpenAI messages strictly contain {role, content} with zero timestamp leak', () => {
  const { buildConversationMessages } = require('../agents/reddy/conversationContext');

  const historyWithTimestamps = [
    { role: 'user', content: 'halo', timestamp: 1700000000000 },
    { role: 'assistant', content: 'Halo Kak! Ada yang bisa dibantu?', timestamp: 1700000001000 },
  ];

  const messages = buildConversationMessages(historyWithTimestamps, 'harga haircut berapa?');

  for (const msg of messages) {
    assert.ok(Object.hasOwn(msg, 'role'));
    assert.ok(Object.hasOwn(msg, 'content'));
    assert.equal(Object.hasOwn(msg, 'timestamp'), false, 'OpenAI messages must NOT contain timestamp property');
    assert.equal(Object.hasOwn(msg, 'created_at'), false, 'OpenAI messages must NOT contain created_at property');
    assert.equal(Object.hasOwn(msg, 'createdAt'), false, 'OpenAI messages must NOT contain createdAt property');
  }
});

test('T02. PREVIOUS CLOSURE: History with prior closure signal sets sessionStatus to expired without erasing history', () => {
  const { extractConversationContextEnvelope } = require('../agents/reddy/conversationContext');

  const now = Date.now();
  const historyWithClosure = [
    { role: 'user', content: 'mau booking Bypass', timestamp: now - 60000 },
    { role: 'assistant', content: 'Boleh, cabang Bypass.', timestamp: now - 50000 },
    { role: 'user', content: 'makasih', timestamp: now - 30000 },
    { role: 'assistant', content: 'Sama-sama, Kak!', timestamp: now - 20000 },
  ];

  const envelope = extractConversationContextEnvelope(historyWithClosure, 'harga Hair Spa berapa?', { now });

  assert.equal(envelope.sessionStatus, 'expired', 'Previous closure signal must force sessionStatus to expired');
  assert.equal(envelope.turns.length, 4, 'Historical turns must remain available in context');
});

test('T03. SERVICE CATALOG: Deterministic handleMessage path returns clean catalog without forced booking URL or emoji spam', async () => {
  const { handleMessage } = require('../../api/wa/webhook');

  const res = await handleMessage({ from: '6281234567890', text: 'layanan apa aja?' });

  assert.equal(res.used, 'keyword');
  assert.match(res.reply, /Berikut layanan di RedBox/);
  assert.equal(res.reply.includes('redboxbarbershop.com/booking.html'), false, 'Service catalog must NOT contain forced booking URL');
  assert.equal(FORBIDDEN_ADDRESS_TERMS_REGEX.some(r => r.test(res.reply)), false);
});

test('T04. PRICE: Deterministic handleMessage path returns direct price response without automatic booking CTA', async () => {
  const { handleMessage } = require('../../api/wa/webhook');

  const res = await handleMessage({ from: '6281234567890', text: 'harga haircut berapa?' });

  assert.equal(res.used, 'keyword');
  assert.match(res.reply, /Berikut daftar harga layanan RedBox/);
  assert.equal(res.reply.includes('redboxbarbershop.com/booking.html'), false, 'Price response must NOT contain automatic booking CTA');
  assert.equal(res.reply.includes('lock slot'), false);
});

test('T05. WAIT COMPLAINT: Deterministic wait complaint handler returns zero emoji and zero booking URL', async () => {
  const { handleMessage } = require('../../api/wa/webhook');

  const res = await handleMessage({ from: '6281234567890', text: 'kemarin antri 30 menit males banget' });

  assert.equal(res.used, 'keyword');
  assert.equal(res.reply, 'Maaf ya Kak, nunggu lama memang bikin tidak nyaman. Terima kasih sudah memberi tahu kami.');
  assert.equal(res.reply.includes('http'), false, 'Wait complaint must NOT contain booking URL');
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.reply), false, 'Wait complaint must contain ZERO emojis');
});

test('T06. HUMAN COMPLAINT HANDOFF: Handoff response contains zero emoji and no unsupported "segera"', async () => {
  const { handleMessage } = require('../../api/wa/webhook');

  const res = await handleMessage({ from: '6281234567890', text: 'mau ngomong sama admin' });

  assert.match(res.reply, /Pesan Kakak sudah aku teruskan ke admin Redbox/);
  assert.equal(res.reply.includes('segera'), false, 'Handoff must not make unsupported "segera" claims');
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.reply), false, 'Handoff must contain ZERO emojis');
});

test('T07. POINTS: Fast-path points response is concise micro budget with zero emoji', async () => {
  const { handleMessage } = require('../../api/wa/webhook');

  const mockExecuteOrchestration = async () => ({
    execution_status: 'success',
    result: { data: { points_balance: 150 } },
  });

  const res = await handleMessage(
    { from: '6281234567890', text: 'poin saya berapa?', trustedIdentity: { phone: '6281234567890', trust_status: 'verified' } },
    { executeOrchestration: mockExecuteOrchestration }
  );

  assert.equal(res.used, 'crm_points');
  assert.equal(res.reply, 'Saldo poin member Redbox kamu saat ini: 150 poin.');
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.reply), false, 'Points reply must contain ZERO emojis');
});
