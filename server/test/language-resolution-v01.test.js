'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasIndonesianLanguageSignal, isForeignLanguage, detectForeignLanguage, resolveResponseLanguage, SUPPORTED_LANGUAGES,
} = require('../agents/reddy/languageResolution');

test('supported language minimum list matches the contract (objective 2)', () => {
  for (const lang of ['indonesian', 'english', 'chinese', 'japanese', 'korean', 'malay', 'arabic', 'french', 'german', 'spanish', 'turkish']) {
    assert.ok(SUPPORTED_LANGUAGES.includes(lang), `missing ${lang}`);
  }
});

test('existing supported-language detection is unchanged (regression)', () => {
  assert.equal(detectForeignLanguage('你好，多少钱剪头发？'), 'chinese');
  // Kana-only phrasing deliberately avoids Kanji here: Kanji is drawn from
  // the same Han-character range this module (and the pre-existing
  // implementation before it) checks first for Chinese, so a Kanji-bearing
  // sentence classifies as Chinese by design, not a Japanese detection bug.
  assert.equal(detectForeignLanguage('こんにちは、いくらですか？'), 'japanese');
  assert.equal(detectForeignLanguage('안녕하세요, 이발 얼마예요?'), 'korean');
  assert.equal(detectForeignLanguage('Merhaba, saç kesimi ne kadar?'), 'turkish');
  assert.equal(detectForeignLanguage('How much is a haircut?'), 'english');
});

test('new supported languages are recognized (objective 2 minimum list)', () => {
  assert.equal(detectForeignLanguage('Wie viel kostet ein Haarschnitt beim Friseur?'), 'german');
  assert.equal(detectForeignLanguage('¿Cuánto cuesta un corte de pelo?'), 'spanish');
  assert.equal(detectForeignLanguage('Bonjour, combien coûte une coupe de cheveux chez le coiffeur?'), 'french');
  assert.equal(detectForeignLanguage('Awak, boleh tak saya nak tanya berapa ringgit potong rambut?'), 'malay');
});

test('language is never derived from phone/country code (function signatures take only text)', () => {
  assert.equal(hasIndonesianLanguageSignal.length, 1);
  assert.equal(isForeignLanguage.length, 1);
  assert.equal(detectForeignLanguage.length, 1);
});

test('resolveResponseLanguage: current message wins over conversation history', () => {
  const history = { turns: [{ role: 'user', content: 'How much is a haircut?' }] };
  assert.equal(resolveResponseLanguage('Kalau CSB berapa?', history, {}), 'indonesian');
});

test('resolveResponseLanguage: neutral continuation follows recent conversation language (objective 4, test 19)', () => {
  const history = { turns: [
    { role: 'user', content: 'How much is a haircut?' },
    { role: 'assistant', content: 'It is Rp100.000.' },
  ] };
  assert.equal(resolveResponseLanguage('ok', history, {}), 'english');
});

test('resolveResponseLanguage: falls back to neutral (indonesian) with no signal anywhere', () => {
  assert.equal(resolveResponseLanguage('ok', { turns: [] }, {}), 'indonesian');
});

test('resolveResponseLanguage: language switching follows current-turn override (objective 4, tests 17-18)', () => {
  const afterEnglish = { turns: [{ role: 'user', content: 'Hello, how much is a haircut?' }] };
  assert.equal(resolveResponseLanguage('Kalau CSB berapa?', afterEnglish, {}), 'indonesian');

  const afterIndonesian = { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] };
  assert.equal(resolveResponseLanguage('Can I come tomorrow?', afterIndonesian, {}), 'english');
});
