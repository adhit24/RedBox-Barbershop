const config = require('../config');
const homeServiceHandler = require('./homeServiceHandler');
const whatsappService = require('./whatsappService');
const knowledgeService = require('./knowledgeService');
const bookingService = require('./bookingService');
const foreignBookingService = require('./foreignBookingService');
const aiService = require('./aiService');
const bookingStatusService = require('./bookingStatusService');
const costGuard = require('../middleware/costGuard');
const escalationService = require('./escalationService');
const handoffStore = require('./handoffStore');
const logger = require('../utils/logger');

const sendText = whatsappService.sendText;

const BOOKING_URL = 'redboxbarbershop.com/booking.html';
const HOME_SERVICE_URL = 'redboxbarbershop.com/home-service.html';
const WEDDING_URL = `${HOME_SERVICE_URL}#wedding-pricing`;

// Track how many times each user was redirected to booking page (resets daily)
const redirectState = new Map(); // phone → { count, date }

const getRedirectCount = (from) => {
  const entry = redirectState.get(from);
  if (!entry) return 0;
  if (entry.date !== new Date().toDateString()) return 0;
  return entry.count;
};

const incrementRedirect = (from) => {
  const count = getRedirectCount(from);
  redirectState.set(from, { count: count + 1, date: new Date().toDateString() });
};

// --- Intent detection helpers ---

const isBookingForm = (text) => {
  const hasName = /nama\s*:/i.test(text);
  const hasTime = /jam\s*:/i.test(text);
  const hasExtra = /barber\s*:|kapster\s*:|tanggal\s*:|hari\s*:|no\s*\.?\s*hp\s*:/i.test(text);
  return hasName && (hasTime || hasExtra);
};

const isSlotInquiry = (text) => {
  const lower = text.toLowerCase();
  return ['antrian', 'antrean', 'penuh ga', 'penuh gak', 'full ga', 'full gak', 'masih ada slot', 'masih kosong', 'ada tempat', 'bisa jam', 'slot tersedia'].some(k => lower.includes(k));
};

const isKapsterInquiry = (text) => {
  const lower = text.toLowerCase();
  return ['mau sama', 'sama mas', 'sama om', 'sama pak', 'barbernya', 'barber nya', 'kapsternya', 'minta mas', 'minta om', 'minta pak', 'ada mas', 'ada om', 'ada pak', 'dengan mas', 'dengan om'].some(k => lower.includes(k));
};

// Deteksi konfirmasi detail booking (misal: "yang anak2", "oke yg 2 anak", setelah user diarahkan ke web)
const isBookingDetailConfirmation = (text) => {
  const lower = text.toLowerCase();
  const detailPatterns = [
    /yang\s+anak/i,                          // "yang anak"
    /\b(anak2|anak-anak)\b/i,               // "anak2", "anak-anak"
    /\b(oke|ok|okey|sip|noted|ya)\b.*\b(anak|orang)\b/i,  // "oke yg 2 anak"
    /jadi\s+.*\b(booking|reservasi|pesan)\b/i,             // "jadi mau booking..."
    /(nomor|no)\s*\.?\s*\d+.*\b(orang|anak|orangnya)\b/i, // "yg 2 orang"
    /\b\d+\s*(orang|anak|orangnya|anaknya)\b/,           // "3 orang", "2 anak"
  ];
  return detailPatterns.some(p => p.test(lower));
};

const isLateNotification = (text) => {
  const lower = text.toLowerCase();
  return ['otw', 'di jalan', 'lagi jalan', 'macet', 'bentar lagi', 'sebentar lagi', 'hampir sampai', 'mau nyampe', 'mau sampai'].some(k => lower.includes(k));
};

const isWalkInIntent = (text) => {
  const lower = text.toLowerCase();
  return /(langsung\s+datang|datang\s+langsung|tanpa\s+booking|ga\s+perlu\s+booking|gak\s+perlu\s+booking|langsung\s+ke\s+sana|langsung\s+ke\s+outlet)/i.test(lower);
};

const isHomeServiceRequest = (text) => {
  const lower = text.toLowerCase();
  return lower.includes('home service') && /(booking|pesan|mau|jadwal|kapan|harga|paket|datang)/i.test(lower);
};

const isWeddingTooSoon = (text) => {
  const lower = text.toLowerCase();
  if (!/(wedding|nikah|pernikahan|pengantin|akad|resepsi)/i.test(lower)) return false;
  return /h\s*-\s*[0-2]\b|besok|lusa|hari\s+ini|2\s+hari\s+lagi|1\s+hari\s+lagi/i.test(lower);
};

const isExistingBookingRequest = (text) => {
  const lower = text.toLowerCase();
  return /(booking\s+saya|sudah\s+booking|udah\s+booking|cek\s+booking|status\s+booking|reschedule|ubah\s+booking|ganti\s+jadwal|cancel\s+booking|batalkan\s+booking)/i.test(lower);
};

// Deteksi keluhan pernah nunggu/antri di outlet (mis. "td udh kesana katanya nunggu 2")
// Pivot: empati → cerita digitalisasi → arahkan booking online
const isPriorWaitComplaint = (text) => {
  const lower = text.toLowerCase();
  const waitWord = /(nunggu|tunggu|ngantri|antri|antre|antrian|antrean)/.test(lower);
  if (!waitWord) return false;
  const pastIndicator = /\b(td|tadi|barusan|barusaja|kemarin|kemaren|kmrn|sebelumnya|abis|habis|udh|udah|sudah)\b/.test(lower);
  const beenThere = /(ke\s*sana|kesana|ke\s*sini|kesini|outlet|cabang|tempatnya|tokonya|store)/.test(lower);
  // "td udh kesana katanya nunggu" → pastIndicator + waitWord ✅
  // "ke sana antri panjang" → beenThere + waitWord ✅
  return pastIndicator || beenThere;
};

// Classify message intent for routing + logging
const classifyIntent = (text) => {
  if (isBookingForm(text)) return 'booking_request_form';
  const lower = text.toLowerCase();
  // Cek wait complaint DULU sebelum slot_inquiry, karena keluhan masa lalu
  // butuh empati + cerita digitalisasi, bukan sekadar info slot.
  if (isPriorWaitComplaint(text)) return 'wait_complaint';
  if (isWeddingTooSoon(text)) return 'wedding_too_soon';
  if (isLateNotification(text)) return 'late_notification';
  if (isExistingBookingRequest(text)) return 'existing_booking';
  if (isWalkInIntent(text)) return 'walk_in';
  if (isHomeServiceRequest(text)) return 'home_service_request';
  if (isSlotInquiry(text)) return 'slot_inquiry';
  if (isKapsterInquiry(text)) return 'kapster_inquiry';
  if (isBookingDetailConfirmation(text)) return 'booking_detail_confirmation';
  if (['harga', 'price', 'berapa', 'tarif', 'biaya'].some(k => lower.includes(k))) return 'price_inquiry';
  if (['lokasi', 'alamat', 'dimana', 'maps', 'tempatnya', 'cabang mana', 'ada di'].some(k => lower.includes(k))) return 'location_inquiry';
  if (['booking', 'reservasi', 'pesan tempat', 'mau book', 'mau daftar', 'mau potong'].some(k => lower.includes(k))) return 'booking_request_chat';
  return 'other';
};

// Build context-aware redirect message — shorter after 2+ redirects in the same day
const buildRedirectMsg = (from, opts = {}) => {
  const count = getRedirectCount(from);
  incrementRedirect(from);

  if (count >= 2) {
    return `Booking-nya di sini ya kak → ${BOOKING_URL} ✂️`;
  }

  if (opts.isForm) {
    return `Aku liat udah lengkap nih datanya 👌 Biar slot pasti aman dan gak keserobot, langsung kunci di sini:\n\n→ ${BOOKING_URL}\n\nTinggal pilih cabang → kapster → jam. Pas hari-H langsung dateng, gak perlu konfirmasi ulang ✂️`;
  }

  if (opts.kapster) {
    return `${opts.kapster} emang sering dicari nih 🔥 Jadwal beliau live update di:\n\n→ ${BOOKING_URL}\n\nPilih cabang → pilih nama kapsternya → jam langsung muncul. Lock sekarang biar gak diambil orang lain 😄`;
  }

  if (opts.isSlot) {
    return `Buat liat slot real-time, paling akurat langsung di sini kak:\n\n→ ${BOOKING_URL}\n\nPilih cabang yang kakak mau, jam available langsung kelihatan live. Kalau satu cabang full, cabang lain biasanya masih kosong 👌`;
  }

  const benefits = [
    'Slot langsung terkunci, gak bisa diambil orang lain 🔥',
    'Sekalian dapet poin member kalau udah aktivasi ✨',
    'Bakal di-remind otomatis sehari sebelumnya 😊',
  ];
  return `Untuk booking yang pasti aman, langsung kunci di sini ya kak:\n\n→ ${BOOKING_URL}\n\n${benefits[count % benefits.length]}`;
};

// ─── Admin Commands ─────────────────────────────────────────────────────────
// Commands available when admin sends message starting with /
// All commands berlaku di SEMUA CABANG via Supabase shared state.
const handleAdminCommand = async (from, lower, text) => {
  // /ai_on 628xxx — Re-enable AI for a customer
  if (lower.startsWith('/ai_on ')) {
    const targetPhone = text.split(' ')[1]?.trim();
    if (targetPhone) {
      handoffStore.disableHandoff(targetPhone);
      await sendText(from, `✅ AI diaktifkan kembali untuk ${targetPhone}\n(berlaku semua cabang)`);
      console.log(`[Admin] AI re-enabled for ${targetPhone} by admin ${from}`);
    } else {
      await sendText(from, '❌ Format: /ai_on 628xxxxxxxxxx');
    }
    return true;
  }

  // /ai_off 628xxx [menit] — Manually pause AI for a customer
  if (lower.startsWith('/ai_off ')) {
    const parts = text.split(' ');
    const targetPhone = parts[1]?.trim();
    const minutes = parseInt(parts[2]) || config.HANDOFF_DURATION_MINUTES || 30;
    if (targetPhone) {
      handoffStore.enableHandoff(targetPhone, minutes, `admin_${from}`);
      await sendText(from, `🔴 AI dimatikan untuk ${targetPhone} selama ${minutes} menit\n(berlaku semua cabang)`);
      console.log(`[Admin] AI paused for ${targetPhone} by admin ${from}, ${minutes}min`);
    } else {
      await sendText(from, '❌ Format: /ai_off 628xxxxxxxxxx [menit]\nContoh: /ai_off 628123456789 30');
    }
    return true;
  }

  // /ai_status — Show all active handoffs (cross-branch)
  if (lower === '/ai_status') {
    const active = await handoffStore.getAllActive();
    if (!active || active.length === 0) {
      await sendText(from, '✅ Tidak ada customer yang sedang di-handle admin.\nAI aktif untuk semua customer.');
    } else {
      const lines = active.map(h =>
        `• ${h.customerPhone} — sisa ${h.remainingMinutes}m (by: ${h.pausedBy})`
      );
      await sendText(from, `🔴 AI OFF untuk ${active.length} customer:\n\n${lines.join('\n')}`);
    }
    return true;
  }

  // /ai_help — Show available commands
  if (lower === '/ai_help') {
    await sendText(from, [
      '🤖 *Admin Commands (semua cabang):*',
      '',
      '/ai_off 628xxx [menit] — Matikan AI untuk customer',
      '/ai_on 628xxx — Hidupkan kembali AI',
      '/ai_status — Lihat semua AI yang sedang OFF',
      '/ai_help — Tampilkan pesan ini',
    ].join('\n'));
    return true;
  }

  return false; // Not an admin command
};

// Route and handle an incoming message
const handle = async ({ from, name, text }) => {
  const lower = text.toLowerCase().trim();
  const intent = classifyIntent(text);

  try {
    // 0. Admin commands — only from ADMIN_WHATSAPP number
    const isAdmin = config.ADMIN_WHATSAPP && from === config.ADMIN_WHATSAPP;
    if (isAdmin && lower.startsWith('/')) {
      const handled = await handleAdminCommand(from, lower, text);
      if (handled) return;
    }

    // 0b. Check if admin is handling this conversation (human handoff)
    //     Uses async check → includes cross-branch Supabase lookup
    if (await handoffStore.isHandoffActiveAsync(from)) {
      console.log(`[Handler] Handoff active for ${from}, skipping AI response (cross-branch)`);
      return;
    }

    // 0c. Foreign customer booking flow — if already in session, continue
    if (foreignBookingService.isActive(from)) {
      const { reply } = await foreignBookingService.handle(from, name, text, aiService);
      if (reply) await sendText(from, reply);
      return;
    }

    // 0d. Detect foreign language — route to foreign booking service
    if (foreignBookingService.isForeignLanguage(text)) {
      console.log(`[Handler] Foreign language detected from ${from} (${name}), routing to foreign booking service`);
      logger.logIntent(from, name, 'foreign_customer', text.substring(0, 100));
      const { reply } = await foreignBookingService.handle(from, name, text, aiService);
      if (reply) await sendText(from, reply);
      return;
    }

    // 0e. If booking flow active, clear it — all bookings now via website only
    if (bookingService.isActive(from)) {
      bookingService.clearSession(from);
      console.log(`[Handler] Cleared stale booking session for ${from}, redirecting to website`);
      await sendText(from, buildRedirectMsg(from));
      return;
    }

    // 0f. Home service lifecycle commands (kapster/pelanggan): BERANGKAT / SELESAI / YA
    const hsHandled = await homeServiceHandler.handle(from, lower);
    if (hsHandled) return;

    // Log intent for monitoring dashboard
    console.log(`[Intent] ${from} (${name}) → ${intent}: "${text.substring(0, 80)}"`);
    logger.logIntent(from, name, intent, text.substring(0, 100));

    // 1. Booking form template — redirect immediately, never process
    if (intent === 'booking_request_form') {
      await sendText(from, buildRedirectMsg(from, { isForm: true }));
      return;
    }

    // 2. Escalation keywords — bypass AI, route to human
    if (escalationService.shouldEscalate(text)) {
      await escalationService.escalate(from, name, text);
      return;
    }

    // 3a. Keluhan pernah nunggu/antri di outlet — empati + cerita digitalisasi
    if (intent === 'wait_complaint') {
      const msg =
        `Aduh, maaf banget kak udah sempet nunggu kayak gitu 🙏\n\n` +
        `Biar kejadian itu gak keulang, sekarang Redbox udah pakai sistem booking online — ketersediaan kapster live update di web. ` +
        `Jadi kakak tinggal pilih jam yang available, slot langsung kekunci dan risiko nunggu bisa diminimalkan.\n\n` +
        `Lock jadwalnya di sini ya kak → ${BOOKING_URL} ✂️`;
      await sendText(from, msg);
      return;
    }

    // 3. Slot / antrian inquiry — redirect to live booking page
    if (intent === 'slot_inquiry') {
      await sendText(from, buildRedirectMsg(from, { isSlot: true }));
      return;
    }

    // 4. Kapster inquiry — redirect with kapster name context
    if (intent === 'kapster_inquiry') {
      const match = text.match(/(?:mas|om|pak|sama|minta|ada|dengan)\s+([A-Za-z]{2,})/i);
      const kapster = match ? `Mas/Om ${match[1]}` : 'Kapster pilihan kakak';
      await sendText(from, buildRedirectMsg(from, { kapster }));
      return;
    }

    // 4b. Booking detail confirmation (e.g., "yang anak2", "oke yg 2 anak")
    // Redirect to website, do NOT acknowledge booking manually
    if (intent === 'booking_detail_confirmation') {
      await sendText(from, `Aku ngerti kak, tapi booking harus lewat website biar slot-nya aman dan terkunci. Yuk langsung aja ke redboxbarbershop.com/booking.html ✂️`);
      return;
    }

    // 5. Booking request via chat — redirect to website
    if (intent === 'booking_request_chat') {
      await sendText(from, buildRedirectMsg(from));
      return;
    }

    // 6. OTW / late notification — quick friendly reply
    if (intent === 'late_notification') {
      const bookingState = await bookingStatusService.getCustomerBookingStatus(from, config.BRANCH_NAME, {
        statuses: ['confirmed', 'pending'],
      });
      if (bookingState.status === bookingStatusService.STATUS.CONFIRMED) {
        await sendText(from, `Hati-hati di jalan ya kak 😊 Maks telat 10–15 menit. Kalau lebih, perubahan jadwal perlu dibantu admin ya ✂️`);
      } else {
        await sendText(from, `Kalau belum ada booking confirmed, slot-nya belum terkunci ya kak 😅 Langsung pilih jadwal di ${BOOKING_URL} ✂️`);
      }
      return;
    }

    if (intent === 'walk_in') {
      await sendText(from, `Boleh datang kak, tapi kalau belum booking slot-nya belum dijamin tersedia 😅 Biar gak sia-sia, kunci jadwal dulu di ${BOOKING_URL} ✂️`);
      return;
    }

    if (intent === 'home_service_request') {
      await sendText(from, `Untuk layanan ke rumah, detail paket dan jadwalnya ada di sini ya kak 🏠✂️\n→ ${HOME_SERVICE_URL}`);
      return;
    }

    if (intent === 'wedding_too_soon') {
      await sendText(from, `Untuk wedding grooming, pemesanan minimal H-3 ya kak 🙏 Kalau sudah kurang dari itu, belum bisa diproses lewat sistem. Detail paketnya ada di ${WEDDING_URL}`);
      return;
    }

    if (intent === 'existing_booking') {
      if (/(reschedule|ubah|ganti|cancel|batalkan)/i.test(text)) {
        await escalationService.escalate(from, name, text);
        return;
      }
      const bookingState = await bookingStatusService.getCustomerBookingStatus(from, config.BRANCH_NAME, {
        statuses: ['pending', 'confirmed', 'done', 'cancelled'],
      });
      if (bookingState.status === bookingStatusService.STATUS.CONFIRMED && bookingState.booking) {
        const b = bookingState.booking;
        await sendText(from, `Booking confirmed kak ✅\n📅 ${b.date} • ${String(b.time).slice(0, 5)}\n✂️ ${b.service}\n📍 ${b.location}\n\nKalau mau ubah jadwal, aku teruskan ke admin ya.`);
      } else if (bookingState.status === bookingStatusService.STATUS.PENDING) {
        await sendText(from, `Booking-nya masih menunggu konfirmasi ya kak. Kalau sudah confirmed, sistem akan mengirim notifikasi resmi 🙏`);
      } else {
        await sendText(from, `Aku belum menemukan booking confirmed untuk nomor ini kak. Coba cek lagi di ${BOOKING_URL} atau kabarin admin kalau merasa sudah melakukan booking 🙏`);
      }
      return;
    }

    // 7. Keyword triggers (fast, no AI cost)
    if (['harga', 'price', 'layanan', 'services', 'menu'].some(k => lower.includes(k))) {
      const servicesText = knowledgeService.getServicesText(config.BRANCH_NAME);
      await sendText(from, `${servicesText}\n\nLangsung book di: ${BOOKING_URL} 😊`);
      return;
    }

    // 8. FAQ match — cheap, no AI
    const faqMatch = knowledgeService.matchFaq(text);
    if (faqMatch) {
      await sendText(from, faqMatch.answer);
      return;
    }

    // 9. Greeting
    if (['halo', 'hai', 'hi', 'hello', 'assalamualaikum', 'selamat'].some(k => lower.startsWith(k))) {
      const hour = new Date().getHours();
      const greet = hour < 12 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam';
      await sendText(from, `Heyy ${name}! Selamat ${greet} dari RedBox *${config.BRANCH_NAME}* ✂️\n\nAda yang bisa aku bantu? Mau lihat layanan, booking, atau nanya-nanya dulu? 😊`);
      return;
    }

    // 10. Cost guard before AI call
    const guardResult = costGuard.check(from);
    if (!guardResult.allowed) {
      await sendText(from, guardResult.message);
      return;
    }

    // 11. AI fallback
    const { reply, tokensUsed } = await aiService.chat(from, name, text);
    await sendText(from, reply);

    console.log(`[AI] ${from} → ${tokensUsed} tokens`);

  } catch (err) {
    console.error('[Handler] Error:', err.message);
    logger.logError('message_handler', `${from}: ${err.message}`);
    await sendText(from, 'Maaf kak, ada gangguan sebentar. Coba lagi ya 🙏');
  }
};

module.exports = {
  handle,
  sendText,
  classifyIntent,
  isLateNotification,
  isWalkInIntent,
  isHomeServiceRequest,
  isWeddingTooSoon,
};
