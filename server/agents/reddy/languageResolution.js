'use strict';

/**
 * One bounded language-resolution contract for Reddy (international
 * multilingual contract, objective 2). Consolidates what were four
 * independently-evolving functions inside api/wa/webhook.js into a single
 * module so there is exactly one precedence rule, used identically whether
 * or not the current turn matched the barber-presence intent path.
 *
 * Precedence: current message's clear language > recent same-conversation
 * customer language > neutral fallback (Indonesian). Never derives language
 * from phone number, country code, branch, or customer name — callers must
 * not pass any of that in.
 */

const SUPPORTED_LANGUAGES = Object.freeze([
  'indonesian', 'english', 'chinese', 'japanese', 'korean',
  'malay', 'arabic', 'french', 'german', 'spanish', 'turkish',
]);

function hasIndonesianLanguageSignal(text) {
  const lower = String(text || '').toLowerCase();
  const indonesianWords = ['mau', 'booking', 'potong', 'rambut', 'harga', 'berapa', 'bisa', 'kapan',
    'hari', 'jam', 'cabang', 'lokasi', 'dimana', 'ada', 'saya', 'aku', 'kak', 'mas',
    'terima kasih', 'makasih', 'tolong', 'bantu', 'info', 'dong', 'ya', 'iya', 'gak',
    'tidak', 'bukan', 'oke', 'siap', 'datang', 'jadi', 'batal'];
  const words = lower.split(/\s+/);
  const indonesianCount = words.filter((w) => indonesianWords.some((iw) => w.includes(iw))).length;
  return words.length > 0 && indonesianCount / words.length > 0.3;
}

const MALAY_WORDS = ['awak', 'ringgit', 'boleh tak', 'tak boleh', 'sila '];
const GERMAN_WORDS = ['wie viel', 'kostet', 'termin', 'haarschnitt', 'friseur', 'danke schön'];
const SPANISH_WORDS = ['cuánto', 'cuesta', 'corte de pelo', 'peluquero', 'reserva'];
const FRENCH_WORDS = ['bonjour', 'combien', 'coiffeur', 'réservation', 'rendez-vous', 'coupe de cheveux'];
const TURKISH_WORDS = ['merhaba', 'selam', 'günaydın', 'saç', 'berber', 'randevu',
  'rezervasyon', 'istiyorum', 'lütfen', 'teşekkürler', 'tıraş', 'kesim', 'sakal'];

// International WhatsApp multilingual contract, correction round 2: Malay
// and Indonesian share enormous everyday vocabulary ("saya", "harga",
// "berapa", "boleh", "ada", ...), so hasIndonesianLanguageSignal's generic
// >30%-word-overlap heuristic fires on genuinely Malay text too — before
// this check, Malay was unreachable through resolveResponseLanguage even
// when marked with an exclusively-Malay word (e.g. "awak"/"ringgit"), since
// the Indonesian check ran first and unconditionally won. None of these
// marker words appear in hasIndonesianLanguageSignal's own word list, so a
// hit here is unambiguous and must outrank the generic Indonesian check.
function hasMalayExclusiveSignal(text) {
  const lower = String(text || '').toLowerCase();
  return MALAY_WORDS.some((w) => lower.includes(w.trim()));
}

function isForeignLanguage(text) {
  const lower = String(text || '').toLowerCase();
  if (hasMalayExclusiveSignal(text)) return true;
  if (hasIndonesianLanguageSignal(text)) return false;

  const foreignPatterns = [
    /\b(i want|i need|i would|i'd like|can i|could you|please|thank you|thanks)\b/i,
    /\b(hello|hey|good morning|good afternoon|good evening)\b/i,
    /\b(haircut|hair cut|barber|appointment|schedule|book|reserve)\b/i,
    /\b(how much|what time|when|where|which)\b/i,
    /\b(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(do you|are you|is there|can you|will you)\b/i,
    /\b(my name|i am|i'm)\b/i,
    // Turkish
    /\b(merhaba|selam|berber|randevu|rezervasyon|istiyorum|saç|kesim|tıraş)\b/i,
    // Chinese
    /[一-鿿]/,
    // Japanese
    /[぀-ゟ゠-ヿ]/,
    // Korean
    /[가-힯]/,
    // Arabic
    /[؀-ۿ]/,
    // Thai
    /[฀-๿]/,
    // German (distinctive umlauts/eszett, or keywords)
    /[äöüß]/i,
    new RegExp(`\\b(${GERMAN_WORDS.join('|')})\\b`, 'i'),
    // Spanish (distinctive inverted punctuation/ñ, or keywords)
    /[¿¡ñ]/,
    new RegExp(`\\b(${SPANISH_WORDS.join('|')})\\b`, 'i'),
    // French (distinctive accented letters, or keywords)
    /[àâçéèêëîïôûùÿœ]/i,
    new RegExp(`\\b(${FRENCH_WORDS.join('|')})\\b`, 'i'),
    // Malay
    new RegExp(`\\b(${MALAY_WORDS.map((w) => w.trim()).join('|')})\\b`, 'i'),
  ];
  return foreignPatterns.some((p) => p.test(lower));
}

function detectForeignLanguage(text) {
  const raw = String(text || '');
  // International WhatsApp multilingual contract, correction round 2
  // (blocker 2): Japanese naturally mixes Kanji (the same Han-character
  // range Chinese uses) with Hiragana/Katakana — a message like
  // "予約できますか？" carries both. Kana is unique to Japanese among these
  // scripts, so it must be checked BEFORE the generic Han-character test;
  // checking Han first (the old order) misclassified any Kanji+kana message
  // as Chinese before ever reaching the Japanese test. Hangul is checked
  // first of all since it never overlaps with Han or kana.
  if (/[가-힯]/.test(raw)) return 'korean';
  if (/[぀-ゟ゠-ヿ]/.test(raw)) return 'japanese';
  if (/[一-鿿]/.test(raw)) return 'chinese';
  if (/[؀-ۿ]/.test(raw)) return 'arabic';
  if (/[฀-๿]/.test(raw)) return 'thai';

  const lower = raw.toLowerCase();
  if (TURKISH_WORDS.some((w) => lower.includes(w))) return 'turkish';
  if (MALAY_WORDS.some((w) => lower.includes(w.trim()))) return 'malay';

  // German checked before Spanish/French: ß/ä/ö/ü are highly distinctive
  // and don't collide with the other two.
  if (/[äöüß]/i.test(raw) || GERMAN_WORDS.some((w) => lower.includes(w))) return 'german';
  // Spanish's ¿/¡ are unique to Spanish among these languages — check next.
  if (/[¿¡ñ]/.test(raw) || SPANISH_WORDS.some((w) => lower.includes(w))) return 'spanish';
  if (/[àâçéèêëîïôûùÿœ]/i.test(raw) || FRENCH_WORDS.some((w) => lower.includes(w))) return 'french';

  return 'english';
}

/**
 * Single entry point for both the barber-presence path and the general
 * path in api/wa/webhook.js — previously these had two different precedence
 * rules (the general path had no conversation-history fallback at all).
 */
function resolveResponseLanguage(text, conversationContext, options = {}) {
  const { presenceIntent = null } = options;
  if (hasMalayExclusiveSignal(text)) return 'malay';
  if (hasIndonesianLanguageSignal(text)) return 'indonesian';
  if (isForeignLanguage(text)) return detectForeignLanguage(text);

  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== 'user' || !String(turn?.content || '').trim()) continue;
    if (hasMalayExclusiveSignal(turn.content)) return 'malay';
    if (hasIndonesianLanguageSignal(turn.content)) return 'indonesian';
    if (isForeignLanguage(turn.content)) return detectForeignLanguage(turn.content);
  }

  // Bounded composition for matched named-presence turns only. Does not
  // alter global language detection or infer language from a phone number.
  if (presenceIntent?.matched && /\b(?:available|free)\b/i.test(String(text || ''))) return 'english';
  return 'indonesian';
}

module.exports = {
  SUPPORTED_LANGUAGES,
  hasIndonesianLanguageSignal,
  hasMalayExclusiveSignal,
  isForeignLanguage,
  detectForeignLanguage,
  resolveResponseLanguage,
};
