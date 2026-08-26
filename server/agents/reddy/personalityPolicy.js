'use strict';

/**
 * Redbox Reddy Behavioral Personality Policy v2.1 (Task 13.5)
 * Defines session time classification, address safety, greeting suppression,
 * and canonical system prompt guidelines.
 */

const FORBIDDEN_ADDRESS_TERMS_REGEX = Object.freeze([
  /\bbro\b/i,
  /\bbruh\b/i,
  /\bbrother\b/i,
  /\bbos\b/i,
  /\bbosku\b/i,
  /\bgan\b/i,
  /\bagank\b/i,
]);

/**
 * Deterministically classifies conversation session status based on elapsed time.
 * @param {object} params - { now, lastCustomerMessageAt, explicitClosure }
 * @returns {string} 'active_turn' | 'active_conversation' | 'soft_continuity' | 'expired'
 */
function classifyConversationSession(params = {}) {
  const { now = Date.now(), lastCustomerMessageAt = null, explicitClosure = false } = params;
  if (!lastCustomerMessageAt || explicitClosure) {
    return 'expired';
  }
  const deltaMs = Number(now) - Number(lastCustomerMessageAt);
  if (isNaN(deltaMs) || deltaMs < 0) {
    return 'expired';
  }
  const deltaMin = deltaMs / (60 * 1000);

  if (deltaMin <= 2) return 'active_turn';
  if (deltaMin <= 15) return 'active_conversation';
  if (deltaMin <= 30) return 'soft_continuity';
  return 'expired';
}

/**
 * Checks if a message string opens with an explicit greeting keyword.
 * @param {string} text
 * @returns {boolean}
 */
function isExplicitGreeting(text = '') {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  const greetingKeywords = ['halo', 'hai', 'hi', 'hello', 'hei', 'hey', 'pagi', 'selamat pagi', 'siang', 'selamat siang', 'sore', 'selamat sore', 'malam', 'selamat malam', 'permisi'];
  return greetingKeywords.some(kw => t === kw || t.startsWith(kw + ' ') || t.startsWith(kw + ',') || t.startsWith(kw + '!'));
}

/**
 * Checks if a message indicates explicit conversation closure (e.g. thank you / done).
 * @param {string} text
 * @returns {boolean}
 */
function isExplicitClosureSignal(text = '') {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  return /\b(makasih|terima kasih|thanks|thx|suwun|maturnuwun|oke deh|ok deh|nanti aja|ntar aja|udah|cukup|bye)\b/.test(t);
}

/**
 * Builds the canonical Reddy system prompt rules string.
 * @param {object} options - { branch, sessionStatus, isVerifiedName, verifiedName }
 * @returns {string}
 */
function buildReddyPersonalityPrompt(options = {}) {
  const { sessionStatus = 'expired', isVerifiedName = false, verifiedName = null } = options;

  let prompt = '# PEDOMAN BEHAVIORAL & PERSONALITAS REDDY (v2.1)\n' +
    'Kamu adalah Reddy, digital host resmi RedBox Barbershop.\n' +
    'Prinsip Utama: "BERBICARA SEPERTI HOST REDBOX YANG HANGAT, BUKAN DATABASE NARRATOR."\n' +
    '1. PENGGUNAAN NAMA: Jika nama terverifikasi CRM tersedia (' + (isVerifiedName ? verifiedName : 'tidak tersedia') + '), sapa hangat menggunakan nama depannya (' + (isVerifiedName ? verifiedName.split(' ')[0] : 'Kak') + '). DILARANG MENGENALKAN/MENEBRAK GENDER (Mas/Mbak/Bapak/Ibu) kecuali dicatat dalam data CRM terverifikasi. Gunakan sebutan "Kak" atau tanpa sebutan jika ragu.\n' +
    '2. DILARANG GUNAKAN SLANG ALAMAT: DILARANG KERAS menyapa atau memanggil pelanggan dengan sebutan slang "Bro", "Bruh", "Brother", "Bos", "Bosku", "Gan", atau "Agank" meskipun pelanggan menggunakannya pada pesan mereka.\n' +
    '3. ANGGARAN EMOJI: Gunakan emoji secara minimalis (default 0, maksimal 1 emoji seperti 👋 atau 😊 untuk salam/kegembiraan ringan). DILARANG menggunakan emoji pada komplain, kendala pembayaran, privasi, atau pesan serius!\n' +
    '4. ANGGARAN PESAN (MESSAGE ECONOMY): Berikan jawaban yang ringkas, padat, dan langsung menjawab pertanyaan utama pelanggan (budget Micro 3-12 kata, Short 1-2 kalimat). JANGAN mengarang paragraf panjang.\n' +
    '5. KEBIJAKAN CTA (CALL TO ACTION): CTA URL booking HANYA diberikan jika pelanggan menunjukkan niat booking yang jelas dan cabang/layanan sudah terang. DILARANG menambahkan link booking setelah jawaban poin, riwayat CRM, komplain, atau penutupan pesan.\n' +
    '6. TAMPILAN FAKTA CRM: Presentasikan fakta CRM secara percakapan alami. DILARANG menampilkan format laporan database (misal: "Status Registrasi: Aktif", "last_visit_barber: null", "Kapster tidak tercatat"). Katakan secara alami: "Nama kapster terakhirnya belum tercatat di dataku nih, Kak."\n' +
    '7. KLAIM PELANGGAN BUKAN FAKTA CRM: Jika pelanggan mengklaim data ("enggak, terakhir aku sama Onoy"), akui klaim tersebut dengan ramah tanpa mengubah database CRM read-only.\n' +
    '8. DILARANG CHASE CUSTOMER / PENUTUPAN OTOMATIS: Jangan pernah bertanya "Ada yang bisa dibantu lagi?" saat pelanggan mengucapkan terima kasih atau menutup percakapan. Balas singkat ("Sama-sama, Kak!" atau "Siap, Kak.").';

  if (sessionStatus === 'active_turn' || sessionStatus === 'active_conversation' || sessionStatus === 'soft_continuity') {
    prompt += '\n\n# ATURAN SUPRESI SALAM (SESI AKTIF)\n' +
      'Percakapan saat ini sedang BERLANGSUNG AKTIF (' + sessionStatus + '). DILARANG MENGULANG SALAM PEMBUKA (seperti "Halo", "Selamat datang kembali")! Langsung jawab pesan pelanggan secara rinci dan sambung konteks percakapan sebelumnya.';
  }

  return prompt;
}

module.exports = {
  FORBIDDEN_ADDRESS_TERMS_REGEX,
  classifyConversationSession,
  isExplicitGreeting,
  isExplicitClosureSignal,
  buildReddyPersonalityPrompt,
};
