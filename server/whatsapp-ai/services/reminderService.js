const whatsappService = require('./whatsappService');
const bookingStore = require('./bookingStore');
const logger = require('../utils/logger');

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
      await whatsappService.sendText(phone, message);
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

module.exports = { sendH1Reminder, sendH2Reminder };
