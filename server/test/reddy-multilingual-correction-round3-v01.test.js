'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callOpenAI, fallbackReply } = require('../../api/wa/webhook');
const { resolveResponseLanguage } = require('../agents/reddy/languageResolution');
const {
  buildResponseLanguagePromptBlock,
  buildGenericTemporaryError,
} = require('../agents/reddy/responseLanguagePresentation');
const { REDDY_BOOKING_EXECUTION, containsProhibitedClaim } = require('../agents/reddy/bookingGuards');

// ── Test helpers ────────────────────────────────────────────────────────────

function fakeOpenAI(replyText) {
  const calls = [];
  return {
    client: {
      chat: {
        completions: {
          create: async (params) => {
            calls.push(params);
            return { choices: [{ message: { content: replyText } }] };
          },
        },
      },
    },
    calls,
  };
}

function fakeOpenAIThatFails() {
  return {
    chat: {
      completions: {
        create: async () => { throw new Error('simulated OpenAI outage'); },
      },
    },
  };
}

async function callWithLanguage(responseLanguage, {
  sender = '6281111110000',
  userMessage = 'test message',
  replyText = 'ok',
  turns = [],
  extra = {},
} = {}) {
  const { client, calls } = fakeOpenAI(replyText);
  const conversationContext = { turns, sessionStatus: 'expired', response_language: responseLanguage, ...extra };
  const reply = await callOpenAI(
    sender, userMessage, 'Kak', 'bypass', null, null, conversationContext,
    { openai: client, persistConversationExchange: async () => {} },
  );
  const systemPrompt = calls[0].messages[0].content;
  return { reply, systemPrompt, calls };
}

const LABELS = {
  french: 'French', german: 'German', spanish: 'Spanish', malay: 'Malay',
  arabic: 'Arabic', japanese: 'Japanese', english: 'English', indonesian: 'Bahasa Indonesia',
};

// ── LLM PROMPT CONTRACT (tests 1-10) ────────────────────────────────────────

test('response_language=french => system prompt explicitly instructs French (test 1)', async () => {
  const { systemPrompt } = await callWithLanguage('french');
  assert.match(systemPrompt, /Resolved response language: French/);
});

test('response_language=german => German (test 2)', async () => {
  const { systemPrompt } = await callWithLanguage('german');
  assert.match(systemPrompt, /Resolved response language: German/);
});

test('response_language=spanish => Spanish (test 3)', async () => {
  const { systemPrompt } = await callWithLanguage('spanish');
  assert.match(systemPrompt, /Resolved response language: Spanish/);
});

test('response_language=malay => Malay (test 4)', async () => {
  const { systemPrompt } = await callWithLanguage('malay');
  assert.match(systemPrompt, /Resolved response language: Malay/);
});

test('response_language=arabic => Arabic (test 5)', async () => {
  const { systemPrompt } = await callWithLanguage('arabic');
  assert.match(systemPrompt, /Resolved response language: Arabic/);
});

test('response_language=japanese => Japanese (test 6)', async () => {
  const { systemPrompt } = await callWithLanguage('japanese');
  assert.match(systemPrompt, /Resolved response language: Japanese/);
});

test('response_language=english => English (test 7)', async () => {
  const { systemPrompt } = await callWithLanguage('english');
  assert.match(systemPrompt, /Resolved response language: English/);
});

test('response_language=indonesian => Indonesian (test 8)', async () => {
  const { systemPrompt } = await callWithLanguage('indonesian');
  assert.match(systemPrompt, /Resolved response language: Bahasa Indonesia \(Indonesian\)/);
});

test('country/phone is not available to language decision inside callOpenAI (test 9)', async () => {
  // Japanese phone country code (+81) but resolved language is french —
  // callOpenAI must follow response_language only, never re-derive from
  // sender/phone.
  const { systemPrompt } = await callWithLanguage('french', { sender: '818012345678' });
  assert.match(systemPrompt, /Resolved response language: French/);
  assert.doesNotMatch(systemPrompt, /Resolved response language: Japanese/);
});

test('base prompt no longer unconditionally forces Indonesian for foreign language (test 10)', async () => {
  const { systemPrompt } = await callWithLanguage('spanish');
  // The old unconditional line forced this exact sentence regardless of
  // language; it must now only appear inside a conditional ("Kalau balasan
  // dalam Bahasa Indonesia...").
  assert.doesNotMatch(systemPrompt, /^- Bahasa Indonesia casual alami/m);
  assert.match(systemPrompt, /Kalau balasan dalam Bahasa Indonesia/);
  assert.match(systemPrompt, /MENGGANTIKAN CONTOH GAYA BAHASA/);
});

// ── END-TO-END PRESENTATION (tests 11-16) ───────────────────────────────────

test('French message resolves to french and callOpenAI sees the French instruction (test 11)', async () => {
  const text = 'Bonjour, combien coûte une coupe ?';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'french');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: French/);
});

test('German message resolves to german (test 12)', async () => {
  const text = 'Wie viel kostet ein Haarschnitt?';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'german');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: German/);
});

test('Spanish message resolves to spanish (test 13)', async () => {
  const text = '¿Cuánto cuesta un corte de pelo?';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'spanish');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: Spanish/);
});

test('Arabic message resolves to arabic (test 14)', async () => {
  const text = 'كم سعر قص الشعر؟';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'arabic');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: Arabic/);
});

test('Malay-exclusive message resolves to malay (test 15)', async () => {
  const text = 'Awak, boleh tak saya nak tanya berapa ringgit potong rambut?';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'malay');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: Malay/);
});

test('Japanese Kanji+kana message resolves to japanese (test 16)', async () => {
  const text = '予約できますか？';
  const lang = resolveResponseLanguage(text, { turns: [] }, {});
  assert.equal(lang, 'japanese');
  const { systemPrompt } = await callWithLanguage(lang, { userMessage: text });
  assert.match(systemPrompt, /Resolved response language: Japanese/);
});

// ── LANGUAGE SWITCHING (tests 17-20) ────────────────────────────────────────

test('English -> Indonesian: second call receives Indonesian instruction (test 17)', async () => {
  const lang = resolveResponseLanguage('Kalau CSB berapa?', { turns: [{ role: 'user', content: 'How much is a haircut?' }] }, {});
  assert.equal(lang, 'indonesian');
  const { systemPrompt } = await callWithLanguage(lang);
  assert.match(systemPrompt, /Resolved response language: Bahasa Indonesia \(Indonesian\)/);
});

test('Indonesian -> English: English instruction (test 18)', async () => {
  const lang = resolveResponseLanguage('Can I come tomorrow?', { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] }, {});
  assert.equal(lang, 'english');
  const { systemPrompt } = await callWithLanguage(lang);
  assert.match(systemPrompt, /Resolved response language: English/);
});

test('English -> Spanish: Spanish instruction (test 19)', async () => {
  const lang = resolveResponseLanguage('¿Cuánto cuesta un corte de pelo?', { turns: [{ role: 'user', content: 'Hello, how much is a haircut?' }] }, {});
  assert.equal(lang, 'spanish');
  const { systemPrompt } = await callWithLanguage(lang);
  assert.match(systemPrompt, /Resolved response language: Spanish/);
});

test('neutral message after French follows recent context: French instruction (test 20)', async () => {
  const lang = resolveResponseLanguage('Et pour demain ?', { turns: [{ role: 'user', content: 'Bonjour, combien coûte une coupe ?' }] }, {});
  assert.equal(lang, 'french');
  const { systemPrompt } = await callWithLanguage(lang);
  assert.match(systemPrompt, /Resolved response language: French/);
});

// ── FAILURE PATH (tests 21-25) ──────────────────────────────────────────────

test('French OpenAI empty result is NOT the Indonesian fallback (test 21)', async () => {
  const { reply } = await callWithLanguage('french', { replyText: '' });
  assert.equal(reply, buildGenericTemporaryError('french'));
  assert.notEqual(reply, buildGenericTemporaryError('indonesian'));
});

test('Spanish OpenAI failure -> static fallback is NOT Indonesian (test 22)', () => {
  const reply = fallbackReply('cualquier texto', 'Kak', 'bypass', null, 'spanish');
  assert.equal(reply, buildGenericTemporaryError('spanish'));
  assert.equal(/Kak|Redbox/.test(reply), false);
});

test('Arabic OpenAI failure -> static fallback is NOT Indonesian (test 23)', () => {
  const reply = fallbackReply('أي نص', 'Kak', 'bypass', null, 'arabic');
  assert.equal(reply, buildGenericTemporaryError('arabic'));
});

test('English OpenAI failure remains English (test 24)', () => {
  const reply = fallbackReply('booking', 'Kak', 'bypass', null, 'english');
  assert.match(reply, /booking website/i);
});

test('Indonesian OpenAI failure remains Indonesian (test 25)', () => {
  const reply = fallbackReply('booking', 'Kak', 'bypass', null, 'indonesian');
  assert.match(reply, /website booking/i);
});

// ── FACT AUTHORITY REGRESSION (tests 26-30) ─────────────────────────────────

test('French language setting cannot change CRM facts injected into the prompt (test 26)', async () => {
  const customerFactsContext = '<customer_facts_json>{"last_visit_barber":"Onoy"}</customer_facts_json>';
  const { systemPrompt } = await (async () => {
    const { client, calls } = fakeOpenAI('ok');
    const conversationContext = { turns: [], sessionStatus: 'expired', response_language: 'french' };
    await callOpenAI(
      '6281111110000', 'test', 'Kak', 'bypass', customerFactsContext, null, conversationContext,
      { openai: client, persistConversationExchange: async () => {} },
    );
    return { systemPrompt: calls[0].messages[0].content };
  })();
  assert.match(systemPrompt, /ZONA B2 — FAKTA CRM CUSTOMER TERPERCAYA/);
  assert.match(systemPrompt, /"last_visit_barber":"Onoy"/);
  assert.match(systemPrompt, /Resolved response language: French/);
  // The presentation block itself must declare it never overrides CRM facts.
  assert.match(systemPrompt, /TIDAK PERNAH mengubah:/);
});

test('Spanish presence query still cannot infer attendance from prompt content alone (test 27)', async () => {
  const { systemPrompt } = await callWithLanguage('spanish', {
    extra: { barber_schedule_status: { barberName: 'Onoy', status: 'scheduled' } },
  });
  assert.match(systemPrompt, /DILARANG meng-upgrade ini menjadi klaim kehadiran/);
  assert.match(systemPrompt, /Resolved response language: Spanish/);
});

test('Japanese schedule cannot become physical presence (test 28)', async () => {
  const { systemPrompt } = await callWithLanguage('japanese', {
    extra: { barber_schedule_status: { barberName: 'Onoy', status: 'scheduled' } },
  });
  assert.match(systemPrompt, /bukan bukti kehadiran fisik/);
  assert.match(systemPrompt, /Resolved response language: Japanese/);
});

test('English booking reply cannot claim reservation created (guard regression) (test 29)', () => {
  assert.equal(containsProhibitedClaim("I've already booked it for you"), true);
});

test('REDDY_BOOKING_EXECUTION remains DISABLED (test 30)', () => {
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

// ── buildResponseLanguagePromptBlock / buildGenericTemporaryError unit checks ─

test('buildResponseLanguagePromptBlock defaults unknown languages to indonesian safely', () => {
  const block = buildResponseLanguagePromptBlock('klingon');
  assert.match(block, /Resolved response language: Bahasa Indonesia \(Indonesian\)/);
});

test('buildGenericTemporaryError returns a distinct sentence per supported language', () => {
  const seen = new Set();
  for (const lang of Object.keys(LABELS)) {
    const msg = buildGenericTemporaryError(lang);
    assert.ok(msg && msg.length > 0);
    seen.add(msg);
  }
  assert.equal(seen.size, Object.keys(LABELS).length);
});
