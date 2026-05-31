const config = require('../config');
const homeServiceHandler = require('./homeServiceHandler');
const whatsappService = require('./whatsappService');
const knowledgeService = require('./knowledgeService');
const bookingService = require('./bookingService');
const foreignBookingService = require('./foreignBookingService');
const aiService = require('./aiService');
const costGuard = require('../middleware/costGuard');
const escalationService = require('./escalationService');
const handoffStore = require('./handoffStore');
const logger = require('../utils/logger');

const sendText = whatsappService.sendText;

const BOOKING_URL = 'redboxbarbershop.com/booking.html';

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

const isLateNotification = (text) => {
  const lower = text.toLowerCase();
  return ['otw', 'di jalan', 'lagi jalan', 'macet', 'bentar lagi', 'sebentar lagi', 'hampir sampai', 'mau nyampe', 'mau sampai'].some(k => lower.includes(k));
};

// Classify message intent for routing + logging
const classifyIntent = (text) => {
  if (isBookingForm(text)) return 'booking_request_form';
  const lower = text.toLowerCase();
  if (isSlotInquiry(text)) return 'slot_inquiry';
  if (isKapsterInquiry(text)) return 'kapster_inquiry';
  if (isLateNotification(text)) return 'late_notification';
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

// Route and handle an incoming message
const handle = async ({ from, name, text }) => {
  const lower = text.toLowerCase().trim();
  const intent = classifyIntent(text);

  try {
    // 0. Admin commands - re-enable AI for a customer
    // Format: /ai_on 628123456789
    if (lower.startsWith('/ai_on ') && config.ADMIN_WHATSAPP && from === config.ADMIN_WHATSAPP) {
      const targetPhone = text.split(' ')[1]?.trim();
      if (targetPhone) {
        handoffStore.disableHandoff(targetPhone);
        await sendText(from, `✅ AI telah diaktifkan kembali untuk ${targetPhone}`);
        console.log(`[Admin] AI re-enabled for ${targetPhone} by admin ${from}`);
      }
      return;
    }

    // 0b. Check if admin is handling this conversation (human handoff)
    if (handoffStore.isHandoffActive(from)) {
      console.log(`[Handler] Handoff active for ${from}, skipping AI response`);
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

    // 5. Booking request via chat — redirect to website
    if (intent === 'booking_request_chat') {
      await sendText(from, buildRedirectMsg(from));
      return;
    }

    // 6. OTW / late notification — quick friendly reply
    if (intent === 'late_notification') {
      await sendText(from, `Hati-hati di jalan ya kak 😊 Maks telat 10-15 menit ya, kalau lebih bisa reschedule di ${BOOKING_URL}\n\nDitunggu! ✂️`);
      return;
    }

    // 7. Keyword triggers (fast, no AI cost)
    if (['harga', 'price', 'layanan', 'services', 'menu'].some(k => lower.includes(k))) {
      const servicesText = knowledgeService.getServicesText();
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
      await sendText(from, `Heyy ${name}! Selamat ${greet} ✂️\n\nAda yang bisa aku bantu? Mau lihat layanan, booking, atau nanya-nanya dulu? 😊`);
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

module.exports = { handle, sendText };
