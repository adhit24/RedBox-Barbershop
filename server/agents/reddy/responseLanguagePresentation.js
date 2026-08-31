'use strict';

/**
 * International WhatsApp multilingual contract, correction round 3.
 *
 * resolveResponseLanguage() (languageResolution.js) is the ONE language
 * authority in this codebase. Everything in this file only turns its
 * already-resolved output into (a) a bounded, presentation-only prompt
 * instruction for callOpenAI, and (b) a tiny deterministic generic
 * temporary-error string for the two paths that must reply without ever
 * calling the model (empty completion, OpenAI failure). Neither function
 * here re-detects language from text, phone number, or country — both take
 * only the already-resolved response_language string.
 */

const { SUPPORTED_LANGUAGES } = require('./languageResolution');

const RESPONSE_LANGUAGE_LABELS = Object.freeze({
  indonesian: 'Bahasa Indonesia (Indonesian)',
  english: 'English',
  chinese: 'Chinese (Mandarin)',
  japanese: 'Japanese',
  korean: 'Korean',
  malay: 'Malay',
  arabic: 'Arabic',
  french: 'French',
  german: 'German',
  spanish: 'Spanish',
  turkish: 'Turkish',
});

const GENERIC_TEMPORARY_ERROR = Object.freeze({
  indonesian: 'Maaf Kak, sistem sedang mengalami gangguan sementara. Coba lagi beberapa saat lagi.',
  english: 'Sorry, the system is temporarily experiencing an issue. Please try again in a moment.',
  chinese: '抱歉，系统暂时出现问题，请稍后再试。',
  japanese: '申し訳ございません、システムに一時的な問題が発生しています。しばらくしてからもう一度お試しください。',
  korean: '죄송합니다. 시스템에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  malay: 'Maaf, sistem sedang mengalami gangguan sementara. Sila cuba lagi sebentar.',
  arabic: 'عذرًا، يواجه النظام مشكلة مؤقتة. يرجى المحاولة مرة أخرى بعد قليل.',
  french: "Désolé, le système rencontre un problème temporaire. Merci de réessayer dans un instant.",
  german: 'Entschuldigung, das System hat momentan ein vorübergehendes Problem. Bitte versuchen Sie es gleich noch einmal.',
  spanish: 'Lo siento, el sistema está teniendo un problema temporal. Por favor, inténtalo de nuevo en un momento.',
  turkish: 'Üzgünüz, sistemde geçici bir sorun var. Lütfen birazdan tekrar deneyin.',
});

function normalizeResponseLanguage(responseLanguage) {
  const key = String(responseLanguage || 'indonesian').toLowerCase();
  return SUPPORTED_LANGUAGES.includes(key) ? key : 'indonesian';
}

/**
 * Bounded PRESENTATION-only instruction appended as the last block of the
 * system prompt, so it outranks any earlier language-flavored style example
 * (e.g. casual Indonesian slang) without needing to rewrite those sections.
 * Deliberately silent on CRM/booking/schedule/membership/branch/price facts
 * and human-handoff/prohibited-claim rules — those stay governed by the
 * sections already in the prompt, unaffected by output language.
 */
function buildResponseLanguagePromptBlock(responseLanguage) {
  const key = normalizeResponseLanguage(responseLanguage);
  const label = RESPONSE_LANGUAGE_LABELS[key];
  return '\n\n# RESPONSE LANGUAGE — PRESENTATION ONLY (WAJIB DIPATUHI, MENGGANTIKAN CONTOH GAYA BAHASA APA PUN DI ATAS)\n' +
    `Resolved response language: ${label}.\n` +
    'Tulis SELURUH balasan kamu dalam bahasa tersebut, termasuk sapaan dan penutup.\n' +
    'Pengaturan ini HANYA mengatur wording/presentasi. Pengaturan ini TIDAK PERNAH mengubah:\n' +
    '- fakta CRM, otoritas booking, fakta jadwal/kehadiran kapster, fakta membership, fakta cabang, harga,\n' +
    '- aturan human handoff, atau klaim yang dilarang di bagian manapun pada prompt ini.\n' +
    'Semua aturan fakta dan kebijakan di atas (walau ditulis dalam Bahasa Indonesia) tetap berlaku penuh dan wajib kamu pahami serta ikuti, apa pun bahasa balasanmu.\n' +
    'Niat pengguna pada pesan TERBARU tetap menentukan makna/isi jawaban (current-message intent authority, lihat resolveResponseLanguage upstream); bahasa balasan ditentukan HANYA oleh baris "Resolved response language" di atas — JANGAN menebak ulang bahasa dari nomor telepon, kode negara, atau isyarat lain di panggilan ini.';
}

/**
 * One safety-fallback sentence, not a duplicated business-answer system.
 * Used only when the model returns an empty completion or fails outright.
 */
function buildGenericTemporaryError(responseLanguage) {
  const key = normalizeResponseLanguage(responseLanguage);
  return GENERIC_TEMPORARY_ERROR[key];
}

module.exports = {
  RESPONSE_LANGUAGE_LABELS,
  GENERIC_TEMPORARY_ERROR,
  normalizeResponseLanguage,
  buildResponseLanguagePromptBlock,
  buildGenericTemporaryError,
};
