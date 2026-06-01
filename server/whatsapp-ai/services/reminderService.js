const { sendWA } = require('../../services/fonnte');
const bookingStore = require('./bookingStore');
const config = require('../config');
const logger = require('../utils/logger');

const GOOGLE_REVIEW_URLS = {
  bypass:    'https://g.page/r/CQVtP1_nV-SFEBM/review',
  samadikun: 'https://g.page/r/CYSfr6rTvLs1EBM/review',
  sumber:    'https://g.page/r/CS9yPcCA-CznEBM/review',
  tegal:     'https://g.page/r/CWg3nZeYXRxSEBM/review',
  csb:       'https://g.page/r/CbsPlES6TnydEBM/review',
};

// Kirim selalu dari nomor cabang ini sendiri
const sendFromBranch = (to, text) => sendWA(to, text, { branch: config.BRANCH_NAME.toLowerCase() });

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Message builders ─────────────────────────────────────────────────────────

const buildH1Message = (booking) => {
  const cabang = booking.branch ? ` cabang *${booking.branch}*` : '';
  return (
    `Halo ${booking.customer_name} kak 👋\n\n` +
    `Besok jadwal *${booking.service}* kakak di RedBox${cabang} ya ✂️\n` +
    `📅 Tanggal: *${booking.booking_date}*\n` +
    `🕐 Jam: *${booking.booking_time}*\n\n` +
    `Sampai ketemu besok 🙌 Jika ada perubahan, hubungi kami ya kak 🙏`
  );
};

const buildH2Message = (booking) => {
  const cabang = booking.branch ? ` cabang *${booking.branch}*` : '';
  return (
    `Halo ${booking.customer_name} kak 👋\n\n` +
    `Reminder nih, jadwal *${booking.service}* kakak *2 jam lagi* ya ✂️\n` +
    `🕐 Jam: *${booking.booking_time}*\n` +
    `📍 RedBox${cabang}\n\n` +
    `Kami tunggu 🙌 Jangan sampai lupa ya kak 😊`
  );
};

// ─── Send with retry ──────────────────────────────────────────────────────────

const sendWithRetry = async (phone, message, context) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendFromBranch(phone, message);
      return true;
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.warn(`[Reminder] ${context} attempt ${attempt}/${MAX_RETRIES} failed: ${errMsg}`);
      logger.logError('reminder', `${context} attempt ${attempt}: ${errMsg}`);

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  console.error(`[Reminder] ${context} — all retries exhausted, skipping.`);
  return false;
};

// ─── Send H-1 reminder ────────────────────────────────────────────────────────

const sendH1Reminder = async (booking) => {
  if (booking.h1_sent) return; // duplicate prevention

  const message = buildH1Message(booking);
  const context = `H1 | ${booking.id} | ${booking.customer_name}`;

  const ok = await sendWithRetry(booking.phone_number, message, context);
  if (ok) {
    bookingStore.markReminderSent(booking.id, 'h1_sent');
    logger.logReminder(booking, 'H1', 'sent');
    console.log(`[Reminder] ✅ H1 sent → ${booking.phone_number} (${booking.customer_name})`);
  } else {
    logger.logReminder(booking, 'H1', 'failed');
  }
};

// ─── Send H-2 hour reminder ───────────────────────────────────────────────────

const sendH2Reminder = async (booking) => {
  if (booking.h2_sent) return; // duplicate prevention

  const message = buildH2Message(booking);
  const context = `H2 | ${booking.id} | ${booking.customer_name}`;

  const ok = await sendWithRetry(booking.phone_number, message, context);
  if (ok) {
    bookingStore.markReminderSent(booking.id, 'h2_sent');
    logger.logReminder(booking, 'H2', 'sent');
    console.log(`[Reminder] ✅ H2 sent → ${booking.phone_number} (${booking.customer_name})`);
  } else {
    logger.logReminder(booking, 'H2', 'failed');
  }
};

// ─── Send review request (post-appointment) ───────────────────────────────────

const buildReviewMessage = (booking) => {
  const branchName = booking.branch || config.BRANCH_NAME;
  const branchKey  = branchName.toLowerCase();
  const link       = GOOGLE_REVIEW_URLS[branchKey] || GOOGLE_REVIEW_URLS.bypass;
  const fn         = (booking.customer_name || 'Kak').split(' ')[0];
  return (
`Haii kak *${fn}*! 👋

Makasih banget udah percayain *RedBox ${branchName}* jadi grooming spot kakak hari ini — beneran berarti banget buat kami 🙏✨ Semoga hasilnya bikin pede makin nampol ya 💈

Jujur kak, sebagai barbershop yang masih terus berkembang, ulasan kakak di Google itu kayak suntikan energi buat tim kami. Cuma butuh *1 menit* waktu kakak, tapi bantu banyak orang nemuin Redbox & bikin para kapster makin semangat ngasih hasil terbaik 🙏

Biar kakak gak rugi waktu, ada apresiasi spesial nih:

🎁 *Kasih ulasan positif* (rating ⭐ 4–5) → langsung dapat *5 poin RedBox senilai Rp 50.000!*
Poin auto-credit ke akun member kakak — bisa ditukar diskon haircut, free coffee, sampai treatment gratis di kunjungan next 🔥

⭐ *Tulis ulasan di sini:*
👉 ${link}

Beneran 30 detik aja — bantu kami tumbuh, kakak yang dapet hadiahnya. Win-win banget kan 😎✂️

_(Pastikan login member di redboxbarbershop.com biar poin auto-credit ya kak)_`
  );
};

const sendReviewRequest = async (booking) => {
  if (booking.review_sent) return; // duplicate prevention

  const message = buildReviewMessage(booking);
  const context = `REVIEW | ${booking.id} | ${booking.customer_name}`;

  const ok = await sendWithRetry(booking.phone_number, message, context);
  if (ok) {
    bookingStore.markReminderSent(booking.id, 'review_sent');
    logger.logReminder(booking, 'REVIEW', 'sent');
    console.log(`[Reminder] ✅ Review request sent → ${booking.phone_number} (${booking.customer_name})`);
  } else {
    logger.logReminder(booking, 'REVIEW', 'failed');
  }
};

module.exports = { sendH1Reminder, sendH2Reminder, sendReviewRequest };
