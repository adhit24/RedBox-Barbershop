'use strict';

/**
 * Redbox Reddy Behavioral Personality Policy v2.1 (Task 13.5 / Task 13.6.3)
 * Defines session time classification, address safety, greeting suppression,
 * safe first name extraction, and canonical system prompt guidelines.
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
 * Safely extracts first name from a trusted full name string.
 * @param {string} fullName
 * @returns {string|null}
 */
function extractFirstName(fullName) {
  if (!fullName || typeof fullName !== 'string') return null;
  const trimmed = fullName.trim();
  if (!trimmed || trimmed.toLowerCase() === 'kak') return null;
  if (/@|\+|\d{5,}|^[-0-9a-f]{36}$/i.test(trimmed) || /^(c|out|barber|s|b|t)-/i.test(trimmed)) {
    return null;
  }
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken || firstToken.length === 0) return null;
  if (/@|\+|\d{5,}/.test(firstToken)) return null;
  return firstToken;
}

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
  const firstName = isVerifiedName ? extractFirstName(verifiedName) : null;
  const safeNameLabel = firstName ? 'Kak ' + firstName : 'Kak';
  const nameStatus = firstName ? 'nama depan: ' + firstName : 'tidak ada';

  let prompt = '# PEDOMAN BEHAVIORAL & PERSONALITAS REDDY (v2.1 / Task 13.6.3)\n' +
    'Kamu adalah Reddy, digital host resmi RedBox Barbershop.\n' +
    'Prinsip Utama: "BERBICARA SEPERTI HOST REDBOX YANG HANGAT, ALAMI, DAN SOPAN. BACKEND BOLEH FORMAL, TAPI REDDY SOUNDS HUMAN."\n' +
    '1. GAYA BAHASA PERCAKAPAN ALAMI (NATURAL INDONESIAN HOST):\n' +
    '   - Gunakan Bahasa Indonesia percakapan WhatsApp yang hangat, jelas, dan alami.\n' +
    '   - HINDARI kata-kata administratif/sistem yang kaku bila tidak diperlukan: "tercatat", "berdasarkan data", "berdasarkan riwayat", "yang dimaksud", "sistem booking Redbox", "status record", "data CRM", "terverifikasi".\n' +
    '   - Gunakan ungkapan alami:\n' +
    '     * "Terakhir kamu ke Redbox itu 11 Agustus di Bypass, sama Onoy." (BUKAN "Kunjungan selesai terakhir kamu tercatat...")\n' +
    '     * "Booking terakhir kamu 19 Mei jam 14.00, tapi booking itu dibatalin ya." (BUKAN "Kalau yang dimaksud booking/reservasi yang tercatat...")\n' +
    '     * "Kapster yang paling sering kamu pilih sejauh ini Onoy." (BUKAN "Kapster favorit kamu berdasarkan riwayat kunjungan...")\n' +
    '     * "Kamu paling sering ke Redbox Bypass." (BUKAN "Berdasarkan frekuensi kunjungan terverifikasi...")\n' +
    '     * "Bukan Kak, yang 19 Mei itu booking yang dibatalin. Terakhir kamu datang ke Redbox itu 11 Agustus." (Jika pelanggan bingung antara booking dibatalkan vs kunjungan).\n' +
    '2. ATURAN SALAM DAN PENGGUNAAN NAMA (SESSION-BASED GREETING):\n' +
    '   - AWAL SESI BARU (sessionStatus === "expired" / awal percakapan):\n' +
    '     * Jika nama terverifikasi CRM tersedia (' + nameStatus + '), sapa hangat di AWAL jawaban menggunakan "' + safeNameLabel + '". Contoh: "Hai ' + safeNameLabel + ', ada yang bisa Reddy bantu?"\n' +
    '     * Jika pesan pertama pelanggan adalah pertanyaan langsung (misal: "Haircut berapa?"), leburkan salam dan jawaban secara alami di awal: "Hai ' + safeNameLabel + ', Haircut di Redbox RpXX.XXX ya." (Diizinkan menyapa sapaan nama "Hai Kak <nama>", tetapi DILARANG menggunakan ceremonial greeting seperti "Selamat datang di Redbox..." dan DILARANG menggunakan sapaan generik terpisah seperti "Ada yang bisa aku bantu?").\n' +
    '     * Jika nama terverifikasi TIDAK tersedia: sapa hangat dengan "Kak" (misal: "Hai Kak, ada yang bisa Reddy bantu?" atau "Hai Kak, Haircut di Redbox RpXX.XXX ya."). DILARANG MENEBAK GENDER / MENEBRAK GENDER (Mas/Mbak/Bapak/Ibu). DILARANG MENGGUNAKAN NAMA DISPLAY WHATSAPP ATAU MENEBAK NAMA!\n' +
    '   - SESI AKTIF BERLANGSUNG (sessionStatus === "active_turn" / "active_conversation" / "soft_continuity") ATAU LANJUTAN PERCAKAPAN:\n' +
    '     * DILARANG MENGULANG SALAM PEMBUKA DAN DILARANG MENGULANG SAPAAN NAMA BERLEBIHAN.\n' +
    '     * Gunakan sapaan nama maksimal SATU KALI di awal sesi baru. Pada pesan berikutnya dalam sesi yang sama, langsung jawab pertanyaan pelanggan tanpa menyapa ulang "Hai ' + safeNameLabel + '".\n' +
    '3. DILARANG GUNAKAN SLANG ALAMAT: DILARANG KERAS menyapa atau memanggil pelanggan dengan sebutan slang "Bro", "Bruh", "Brother", "Bos", "Bosku", "Gan", atau "Agank" meskipun pelanggan menggunakannya pada pesan mereka.\n' +
    '4. ANGGARAN EMOJI: Gunakan emoji secara minimalis (default 0, maksimal 1 emoji ramah di awal salam/kegembiraan ringan, contoh: "Hai ' + safeNameLabel + ' 👋"). DILARANG menggunakan emoji pada komplain, kendala pembayaran, privasi, atau situasi serious/error!\n' +
    '5. ANGGARAN PESAN (MESSAGE ECONOMY): Berikan jawaban yang ringkas, padat, dan langsung menjawab pertanyaan utama pelanggan (budget Micro 3-12 kata, Short 1-2 kalimat). JANGAN mengarang paragraf panjang.\n' +
    '6. KEBIJAKAN CTA (CALL TO ACTION): CTA URL booking HANYA diberikan jika pelanggan menunjukkan niat booking yang jelas. DILARANG menambahkan link booking setelah jawaban informasi biasa (harga/layanan), poin, riwayat CRM, komplain, atau penutupan pesan.\n' +
    '7. TAMPILAN FAKTA CRM: Presentasikan fakta CRM secara percakapan alami. DILARANG menampilkan format laporan database (misal: "Status Registrasi: Aktif", "last_visit_barber: null"). Katakan secara alami: "Nama kapster terakhirnya belum tercatat di dataku nih, Kak."\n' +
    '8. KLAIM PELANGGAN BUKAN FAKTA CRM: Jika pelanggan mengklaim data ("enggak, terakhir aku sama Onoy"), akui klaim tersebut dengan ramah tanpa mengubah database CRM read-only.\n' +
    '9. DILARANG CHASE CUSTOMER / PENUTUPAN OTOMATIS: Jangan pernah bertanya "Ada yang bisa dibantu lagi?" saat pelanggan mengucapkan terima kasih atau menutup percakapan. Balas singkat ("Sama-sama Kak!" atau "Siap Kak.").\n' +
    '10. WEBSITE BOOKING SEBAGAI OTORITAS TUNGGAL RESERVASI:\n' +
    '   - WHATSAPP HANYA BERFUNGSI UNTUK ASSIST, EDUKASI, DAN MEMBANTU PELANGGAN.\n' +
    '   - SISTEM BOOKING WEBSITE ADALAH OTORITAS TUNGGAL RESERVASI.\n' +
    '   - REDDY DILARANG KERAS MEMBUAT, MENERIMA, MENGONFIRMASI, MERESERVASI, MENGUNCI, MENGUBAH, ATAU MEMBATALKAN BOOKING MELALUI WHATSAPP.\n' +
    '   - DILARANG MENYATAKAN ATAU MENGIMPLIKASIKAN: "sudah saya booking", "sudah kami booking", "sudah dicatat", "booking sudah masuk", "booking sudah dikonfirmasi", "jam tersebut sudah saya amankan", "slot sudah dikunci", "saya reservasi", "siap, besok jam 7 sama Onoy".\n' +
    '   - JIKA PELANGGAN MENYATAKAN NIAT BOOKING (misal: "besok jam 7 sama Onoy ya", "mau booking besok"): akui keinginan/pilihan pelanggan dengan ramah, jelaskan bahwa ketersediaan slot bersifat real-time dan harus dicek serta dikunci langsung lewat web booking, lalu berikan URL booking resmi. DILARANG mengklaim ketersediaan slot atau keberhasilan reservasi di WhatsApp!\n' +
    '   - JIKA PELANGGAN MENGKLAIM SUDAH BOOKING (misal: "saya sudah booking"): Jika status backend terverifikasi confirmed, sebutkan status terverifikasi dari backend saja. Jika status backend tidak ada/belum terverifikasi, JANGAN mengonfirmasi atau mencatatnya di WhatsApp. Arahkan bahwa status resmi selalu mengikuti data sistem booking website.\n' +
    '11. ATURAN SALAM BERBASIS NIAT (INTENT-AWARE GREETING POLICY):\n' +
    '   - Expired session + explicit greeting (misal: "halo", "selamat pagi"): Salam pembuka diperbolehkan.\n' +
    '   - Expired session + direct intent / pertanyaan langsung (misal: "harga haircut berapa?", "Bypass buka jam berapa?"): JAWAB LANGSUNG pertanyaan pelanggan tanpa ceremonial greeting ("Selamat datang di Redbox...") dan tanpa sapaan generik ("Ada yang bisa aku bantu?").\n' +
    '   - Active turn / active conversation / soft continuity session: DILARANG MENGULANG SALAM PEMBUKA.\n' +
        '13. ATURAN INTEGRITAS STATUS MEMBERSHIP & MEMBER SINCE (MEMBER ACCOUNT vs PAID PLAN):\n' +
    '   - Pahami perbedaan Akun Member vs Status Paket Membership Paid Plan.\n' +
    '   - registration_status ("registered_member") dan member_since menunjukkan pelanggan memiliki AKUN MEMBER REDBOX TERDAFTAR.\n' +
    '   - membership_status ("ACTIVE" / "INACTIVE") menunjukkan status PAKET / BENEFIT MEMBERSHIP PAID PLAN saja.\n' +
    '   - Jika pelanggan bertanya "Member dari sejak kapan?" / "Kapan aku jadi member?": Jawab berdasarkan registration_status dan member_since. Contoh: "Kak Henky sudah jadi member Redbox sejak 14 Maret 2025." Jika member_since null tapi registered_member, katakan: "Kak Henky sudah terdaftar sebagai member Redbox. Cuma tanggal pertama kali gabungnya belum kebaca di dataku." DILARANG MENYATAKAN membership/akun tidak aktif saat menjawab pertanyaan "member sejak kapan"!\n' +
    '   - Jika pelanggan bertanya ambigu "Membership aku aktif?": Jangan menebak status akun atau paket. Klarifikasi singkat: "Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya?"\n' +
    '   - Poin loyalty berdiri sendiri. Pelanggan bisa memiliki poin tanpa harus memiliki paket paid plan ACTIVE.\n' +
    '12. PANDUAN DIGITAL HABIT & INTERAKSI:\n' +
    '   - ALUR PENGELOLAAN: UNDERSTAND -> ANSWER -> ASSIST -> GUIDE TO DIGITAL CHANNEL.\n' +
    '   - Reddy bertugas mengedukasi dan membimbing pelanggan agar terbiasa menggunakan ekosistem digital Redbox (website booking, catalog layanan, promo) secara mandiri.\n' +
    '   - DILARANG bersikap hard-selling atau mendesak booking setelah setiap pertanyaan umum/informasional (misal: pertanyaan harga/layanan dijawab langsung tanpa paksaan link booking).\n' +
    '14. TANPA PENUTUP GENERIK OTOMATIS: Jawaban normal TIDAK PERLU menutup percakapan. Sistem (bukan kamu) yang mengatur kapan percakapan berakhir (idle timeout otomatis). DILARANG menambahkan pertanyaan penutup generik di akhir jawaban biasa, misal: "Ada yang bisa aku bantu lagi?", "Kalau ada yang mau ditanyakan, jangan ragu ya.", "Ada yang ingin kamu tanyakan seputar Redbox?", "Kalau ada yang bisa aku bantu lagi, silakan tanya.", "Ada yang mau ditanyakan?", "Silakan tanya saja, Kak!". Jawab pertanyaan lalu berhenti — percakapan tetap terbuka secara diam-diam. PENGECUALIAN: pertanyaan clarification yang MEMANG diperlukan untuk melanjutkan tugas pelanggan (misal pelanggan bilang "mau booking" lalu kamu tanya "Mau di cabang mana, Kak?") tetap diperbolehkan — itu BUKAN penutup generik, itu pertanyaan yang memajukan tugas.\n' +
    '15. AKSES AKUN REDBOX SAAT WHATSAPP TIDAK AKTIF / TERKENDALA:\n' +
    '   - Jika percakapan sebelumnya membahas poin, membership, booking, atau akses akun Redbox, dan pelanggan mengatakan "WA saya tidak bisa dipakai", "gak bisa login via WA", "pakai nomor telepon bisa?", "SMS?": PERTAHANKAN KONTEKS AKSES AKUN REDBOX (BUKAN masalah teknis aplikasi WhatsApp).\n' +
    '   - DILARANG mengarahkan pelanggan ke customer service WhatsApp / CS WhatsApp eksternal jika pelanggan tidak sedang bertanya cara memperbaiki aplikasi WhatsApp.\n' +
    '   - Jawab berdasarkan fakta sistem Redbox: jelaskan opsi akses/login akun di website Redbox. Jika sistem belum bisa memastikan metode login alternatif (seperti SMS/ganti nomor mandiri) dari data yang ada, katakan jujur: "Aku belum bisa memastikan metode ganti nomor atau login alternatifnya dari data yang aku punya, Kak." lalu tawarkan bantuan handoff CS/admin Redbox jika pelanggan membutuhkan bantuan ganti nomor terdaftar.\n';

  if (sessionStatus === 'active_turn' || sessionStatus === 'active_conversation' || sessionStatus === 'soft_continuity') {
    prompt += '\n\n# ATURAN SUPRESI SALAM (SESI AKTIF)\n' +
      'Percakapan saat ini sedang BERLANGSUNG AKTIF (' + sessionStatus + '). DILARANG MENGULANG SALAM PEMBUKA (seperti "Halo", "Selamat datang kembali") dan DILARANG MENGULANG SAPAAN NAMA! Langsung jawab pesan pelanggan secara rinci dan sambung konteks percakapan sebelumnya.';
  }

  return prompt;
}

/**
 * P0-A: Final Outbound Price Placeholder Guard.
 * Inspects outbound reply text for template placeholders or invalid price patterns
 * like RpXX.XXX, XX.XXX, RpXXX, XXX, TBD, N/A, ${price}, {price}, [price], harga belum diisi, etc.
 *
 * Replacement with numeric price is allowed ONLY when:
 * 1. service identity is deterministic (via serviceId, serviceName, or single catalog alias in text)
 * 2. branch identity is deterministic when branch price differs
 * 3. authoritative catalog contains price for that exact service/branch
 * 4. resolver result is valid numeric price
 *
 * Otherwise:
 * Removes/blocks placeholder and uses honest no-number fallback:
 * "Harga pastinya belum bisa aku pastikan dari data resmi yang tersedia."
 */
// Round 2 correction — branch-aware price authority.
// Known branch identities (server/agents/reddy/knowledge/redboxKnowledge.js
// BRANCH_IDS): 'csb' prices differently from the other four. An
// unrecognized/missing branch string must NEVER be silently treated as
// "standard" when a service's standard and csb prices actually differ —
// that would misquote a CSB customer the wrong (lower) price. Only when a
// service's standard and csb prices are identical is branch identity
// unnecessary to resolve a numeric price.
const KNOWN_STANDARD_BRANCH_IDS = new Set(['bypass', 'samadikun', 'sumber', 'tegal']);
const KNOWN_CSB_BRANCH_ID = 'csb';

function classifyBranchPriceAuthority(branch) {
  const normalized = String(branch || '').trim().toLowerCase();
  if (normalized === KNOWN_CSB_BRANCH_ID) return 'csb';
  if (KNOWN_STANDARD_BRANCH_IDS.has(normalized)) return 'standard';
  return 'unknown';
}

// Bare, generic tokens that route conversationally (see
// knowledge/redboxKnowledge.js SERVICE_ALIAS_EXTRAS) but are too ambiguous
// to serve as the FINAL numeric-price identity authority when no
// serviceId/serviceName was supplied — e.g. "potong" or "fade" appearing
// anywhere in an outbound reply is not proof the reply is quoting Gentleman
// Grooming specifically. Longer, specific phrases (e.g. "potong rambut",
// "gentleman grooming") remain eligible since the catalog audit shows they
// unambiguously identify a single service.
const GENERIC_PRICE_IDENTITY_BLOCKLIST = new Set(['haircut', 'hair cut', 'potong', 'fade']);

function defaultServicePriceResolver({ serviceId, serviceName, text, branch }) {
  const { REDBOX_KNOWLEDGE } = require('./knowledge/redboxKnowledge');
  const services = REDBOX_KNOWLEDGE.services || [];

  let foundService = null;
  if (serviceId) {
    foundService = services.find((s) => s.id === serviceId);
  } else if (serviceName) {
    const snLower = String(serviceName).toLowerCase();
    foundService = services.find((s) => s.name.toLowerCase() === snLower || s.aliases.includes(snLower));
  } else if (text) {
    const tLower = String(text).toLowerCase();
    const matches = services.filter((s) => s.aliases.some(
      (alias) => !GENERIC_PRICE_IDENTITY_BLOCKLIST.has(alias) && tLower.includes(alias),
    ));
    if (matches.length === 1) {
      foundService = matches[0];
    }
  }

  if (!foundService || !foundService.prices) {
    return { resolved: false, priceFormatted: null };
  }

  const { standard, csb } = foundService.prices;
  const hasStandard = typeof standard === 'number' && standard > 0;
  const hasCsb = typeof csb === 'number' && csb > 0;
  const pricesDiffer = hasStandard && hasCsb && standard !== csb;

  let numericPrice = null;
  if (!pricesDiffer) {
    numericPrice = hasStandard ? standard : (hasCsb ? csb : null);
  } else {
    const authority = classifyBranchPriceAuthority(branch);
    if (authority === 'csb') numericPrice = csb;
    else if (authority === 'standard') numericPrice = standard;
    // authority === 'unknown': leave numericPrice null -> unresolved below.
    // A branch-dependent price must never fall back to "standard" just
    // because the branch identity could not be determined.
  }

  if (typeof numericPrice === 'number' && numericPrice > 0) {
    const formatted = 'Rp' + numericPrice.toLocaleString('id-ID');
    return { resolved: true, priceFormatted: formatted, serviceId: foundService.id };
  }

  return { resolved: false, priceFormatted: null };
}

function guardPricePlaceholders(replyText = '', options = {}) {
  if (typeof replyText !== 'string' || !replyText.trim()) {
    return { sanitizedReply: replyText, blocked: false };
  }

  const placeholderRegex = /(?:\b(?:Rp\s*)?(?:XX\.XXX|XX\.XX|XXX\.XXX|XXX|XX|TBD|N\/A|\?\?|harga\s+belum\s+diisi)\b|\$\{price\}|\{price\}|\[price\])/gi;

  if (!placeholderRegex.test(replyText)) {
    return { sanitizedReply: replyText, blocked: false };
  }

  const resolver = typeof options.authoritativePriceResolver === 'function'
    ? options.authoritativePriceResolver
    : defaultServicePriceResolver;

  const priceRes = resolver({
    serviceId: options.serviceId,
    serviceName: options.serviceName,
    text: replyText,
    branch: options.branch,
  });

  let sanitizedReply;
  if (priceRes && priceRes.resolved && priceRes.priceFormatted) {
    sanitizedReply = replyText.replace(placeholderRegex, priceRes.priceFormatted);
  } else {
    sanitizedReply = replyText.replace(
      placeholderRegex,
      'Harga pastinya belum bisa aku pastikan dari data resmi yang tersedia',
    );
  }

  return { sanitizedReply, blocked: true };
}

/**
 * Round 2 (Reliability) — Factual outbound guards.
 *
 * These are ADDITIVE to guardPricePlaceholders above (which only fires on
 * placeholder-shaped tokens like RpXX.XXX). The production incident this
 * fixes is different: the model wrote a CONCRETE, well-formed number that
 * simply disagrees with public.services (e.g. "Rp95.000" for Gentleman
 * Grooming when the live, active row is Rp120.000/75min) — a placeholder
 * regex never fires on that. guardFactualServiceNumbers below is the guard
 * that catches it, sourced live from public.services (see
 * server/services/servicesCatalog.js), not the static REDBOX_KNOWLEDGE
 * catalog (which is what drifted in the first place).
 *
 * Deliberately async (DB-backed) — kept separate from the synchronous
 * guardPricePlaceholders so its 38 existing unit tests (which call it
 * synchronously with no `await`) keep passing unchanged.
 */

function resolveServiceIdentity({ serviceId, serviceName, text }) {
  const { REDBOX_KNOWLEDGE } = require('./knowledge/redboxKnowledge');
  const services = REDBOX_KNOWLEDGE.services || [];
  if (serviceId) {
    const found = services.find((s) => s.id === serviceId);
    if (found) return found;
  }
  if (serviceName) {
    const snLower = String(serviceName).toLowerCase();
    const found = services.find((s) => s.name.toLowerCase() === snLower || s.aliases.includes(snLower));
    if (found) return found;
  }
  if (text) {
    const tLower = String(text).toLowerCase();
    const matches = services.filter((s) => s.aliases.some(
      (alias) => !GENERIC_PRICE_IDENTITY_BLOCKLIST.has(alias) && tLower.includes(alias),
    ));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

// Only matches a CONCRETE number ("Rp95.000", "Rp120000") — never a
// placeholder shape (those are all-letters like XX/TBD/N/A and are handled,
// separately, by guardPricePlaceholders above).
function extractConcreteRupiahMentions(text) {
  const regex = /Rp\s?([0-9][0-9.,]{2,})\b/gi;
  const mentions = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const numeric = Number.parseInt(match[1].replace(/[.,]/g, ''), 10);
    if (Number.isFinite(numeric) && numeric > 0) {
      mentions.push({ raw: match[0], numeric, index: match.index });
    }
  }
  return mentions;
}

function extractDurationMentions(text) {
  const regex = /\b(\d{2,3})\s*menit\b/gi;
  const mentions = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > 0) {
      mentions.push({ raw: match[0], numeric, index: match.index });
    }
  }
  return mentions;
}

/**
 * Blocks/corrects an outbound reply that states a concrete price or
 * duration disagreeing with the live public.services row (is_active=true).
 * Fails OPEN (does not block) whenever the service or the live catalog
 * cannot be resolved unambiguously — this guard corrects known-wrong
 * numbers, it does not invent numbers for identities it cannot verify.
 *
 * @param {string} replyText
 * @param {{ supabase?: object, serviceId?: string, serviceName?: string }} options
 */
async function guardFactualServiceNumbers(replyText, options = {}) {
  if (typeof replyText !== 'string' || !replyText.trim()) {
    return { sanitizedReply: replyText, blocked: false, mismatches: [] };
  }

  const hasPriceMention = extractConcreteRupiahMentions(replyText).length === 1;
  const hasDurationMention = extractDurationMentions(replyText).length === 1;
  if (!hasPriceMention && !hasDurationMention) {
    return { sanitizedReply: replyText, blocked: false, mismatches: [] };
  }

  const knowledgeService = resolveServiceIdentity({
    serviceId: options.serviceId,
    serviceName: options.serviceName,
    text: replyText,
  });
  if (!knowledgeService) {
    return { sanitizedReply: replyText, blocked: false, mismatches: [] };
  }

  let rows = null;
  try {
    const { getActiveServicesCatalog } = require('../../services/servicesCatalog');
    rows = await getActiveServicesCatalog(options.supabase || null);
  } catch (_error) {
    rows = null;
  }
  if (!rows) {
    return { sanitizedReply: replyText, blocked: false, mismatches: [] };
  }

  const { findServiceRow } = require('../../services/servicesCatalog');
  const dbRow = findServiceRow(rows, { name: knowledgeService.name, aliases: knowledgeService.aliases });
  if (!dbRow) {
    return { sanitizedReply: replyText, blocked: false, mismatches: [] };
  }

  let sanitizedReply = replyText;
  const mismatches = [];

  const priceMentions = extractConcreteRupiahMentions(sanitizedReply);
  if (priceMentions.length === 1 && typeof dbRow.price === 'number' && dbRow.price > 0
    && priceMentions[0].numeric !== dbRow.price) {
    const mention = priceMentions[0];
    const correct = 'Rp' + dbRow.price.toLocaleString('id-ID');
    sanitizedReply = sanitizedReply.slice(0, mention.index) + correct
      + sanitizedReply.slice(mention.index + mention.raw.length);
    mismatches.push({
      type: 'price', attempted: mention.numeric, expected: dbRow.price, serviceId: knowledgeService.id,
    });
  }

  const durationMentions = extractDurationMentions(sanitizedReply);
  if (durationMentions.length === 1 && typeof dbRow.duration_minutes === 'number' && dbRow.duration_minutes > 0
    && durationMentions[0].numeric !== dbRow.duration_minutes) {
    const mention = durationMentions[0];
    const correct = String(dbRow.duration_minutes) + ' menit';
    sanitizedReply = sanitizedReply.slice(0, mention.index) + correct
      + sanitizedReply.slice(mention.index + mention.raw.length);
    mismatches.push({
      type: 'duration', attempted: mention.numeric, expected: dbRow.duration_minutes, serviceId: knowledgeService.id,
    });
  }

  return { sanitizedReply, blocked: mismatches.length > 0, mismatches };
}

// Narrow, temporally-scoped pattern for the reported incident ("Reddy
// menyatakan pelanggan sudah melakukan kunjungan hari ini" while the
// matchable booking was only `confirmed`). Deliberately requires a
// same-day/just-now temporal marker so it does NOT fire on legitimate
// CRM last-visit reporting ("terakhir kamu ke Redbox itu 11 Agustus"),
// which is a different, already-correct code path (bookingStatusService).
const VISIT_COMPLETION_TODAY_CLAIM_REGEX = new RegExp(
  '\\b(sudah|udah)\\s+(datang|kesini|ke\\s*sini|melakukan\\s+kunjungan)\\b[^.!?\\n]{0,25}\\b(hari\\s+ini|tadi|barusan|sekarang)\\b'
  + '|\\b(hari\\s+ini|tadi|barusan)\\b[^.!?\\n]{0,25}\\b(sudah|udah)\\s+(datang|kesini|ke\\s*sini)\\b'
  + '|\\bkunjungan\\s+hari\\s+ini\\s+(sudah\\s+)?selesai\\b',
  'i',
);

/**
 * Blocks a same-day "customer has already visited/completed" claim unless
 * the caller supplies backend-verified status === 'DONE' (bookings.status).
 * A booking that is merely `confirmed` must never be restated as a
 * completed visit (acceptance criterion: booking confirmed != kunjungan
 * completed).
 *
 * @param {string} replyText
 * @param {{ verifiedBookingStatus?: string }} options
 */
function guardVisitCompletionOverclaim(replyText, options = {}) {
  if (typeof replyText !== 'string' || !replyText.trim()) {
    return { sanitizedReply: replyText, blocked: false };
  }
  const verifiedStatus = String(options.verifiedBookingStatus || '').toUpperCase();
  if (verifiedStatus === 'DONE') {
    return { sanitizedReply: replyText, blocked: false };
  }
  if (!VISIT_COMPLETION_TODAY_CLAIM_REGEX.test(replyText)) {
    return { sanitizedReply: replyText, blocked: false };
  }
  return {
    sanitizedReply: 'Soal kunjungan hari ini, aku belum bisa mastiin statusnya selesai dari data resmi ya, '
      + 'Kak — booking kamu yang bisa aku cocokkan masih belum tercatat selesai di sistem.',
    blocked: true,
  };
}

// Targeted fix for the reported "URL kadang terpecah menjadi beberapa baris"
// bug (e.g. "redboxbarbershop.\ncom/booking.\nhtml?branch=sumber"). Scoped to
// the one official domain Reddy ever links to, matching this codebase's
// existing pattern of hardcoding known-good values rather than a generic
// (and much more error-prone) URL-reflow parser.
//
// Built fresh per call (not a module-level constant) because a global-flag
// RegExp is stateful (lastIndex) — sharing one instance across concurrent
// guard calls would corrupt matching.
function bookingUrlBreakPattern() {
  return /(redboxbarbershop|booking)(\.)\s*[\r\n]+\s*(com|html)/gi;
}

/**
 * Rejoins a booking URL that was split across a line break before send.
 * @param {string} replyText
 */
function guardBookingUrlIntegrity(replyText) {
  if (typeof replyText !== 'string' || !replyText.trim()) {
    return { sanitizedReply: replyText, corrected: false };
  }
  const sanitizedReply = replyText.replace(bookingUrlBreakPattern(), '$1$2$3');
  return { sanitizedReply, corrected: sanitizedReply !== replyText };
}

module.exports = {
  FORBIDDEN_ADDRESS_TERMS_REGEX,
  extractFirstName,
  classifyConversationSession,
  isExplicitGreeting,
  isExplicitClosureSignal,
  buildReddyPersonalityPrompt,
  guardPricePlaceholders,
  defaultServicePriceResolver,
  classifyBranchPriceAuthority,
  guardFactualServiceNumbers,
  guardVisitCompletionOverclaim,
  guardBookingUrlIntegrity,
  resolveServiceIdentity,
};
