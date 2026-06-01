const { sendWA } = require('../../services/fonnte');
const config = require('../config');
const logger = require('../utils/logger');

// Kirim dari nomor cabang ini sendiri
const sendFromBranch = (to, text) => sendWA(to, text, { branch: config.BRANCH_NAME.toLowerCase() });

/**
 * Build booking notification message for kapster.
 */
const buildKapsterNotification = (booking) => {
  return (
    `🔔 *BOOKING BARU — ${(booking.branch || config.BRANCH_NAME).toUpperCase()}*\n` +
    `─────────────────────────────\n` +
    `👤 Pelanggan : *${booking.customer_name}*\n` +
    `📱 No. WA    : wa.me/${booking.phone_number}\n` +
    `✂️ Layanan   : *${booking.service}*\n` +
    `📅 Tanggal   : *${booking.booking_date}*\n` +
    `🕐 Jam       : *${booking.booking_time}*\n` +
    `─────────────────────────────\n` +
    `_Notifikasi otomatis dari RedBox AI_ 🤖\n` +
    `_Harap konfirmasi kesiapan kepada pelanggan jika diperlukan._`
  );
};

/**
 * Send booking notification to all configured kapster WA numbers for this branch.
 * KAPSTER_WA env format (comma-separated): 628111,628222,628333
 *
 * @param {object} booking - saved booking object from bookingStore
 */
const notifyKapster = async (booking) => {
  const rawNumbers = config.KAPSTER_WA || '';

  if (!rawNumbers) {
    console.warn('[Notification] No KAPSTER_WA configured — skipping kapster notification.');
    return;
  }

  const numbers = rawNumbers
    .split(',')
    .map(n => n.trim())
    .filter(n => n.length > 0);

  if (numbers.length === 0) {
    console.warn('[Notification] KAPSTER_WA is empty after parsing — skipping.');
    return;
  }

  const message = buildKapsterNotification(booking);

  const results = await Promise.allSettled(
    numbers.map(num => sendFromBranch(num, message))
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[Notification] ✅ Kapster ${numbers[i]} notified — ${booking.customer_name} | ${booking.booking_date} ${booking.booking_time}`);
      logger.logDispatch(booking, numbers[i], 'sent');
    } else {
      const errMsg = result.reason?.response?.data?.error?.message || result.reason?.message || 'unknown';
      console.error(`[Notification] ❌ Failed to notify kapster ${numbers[i]}: ${errMsg}`);
      logger.logDispatch(booking, numbers[i], 'failed');
    }
  });
};

/**
 * Send booking notification to admin as well (backup).
 * Only fires if ADMIN_WHATSAPP is set.
 *
 * @param {object} booking
 */
const notifyAdmin = async (booking) => {
  if (!config.ADMIN_WHATSAPP) return;

  const message =
    `📋 *BOOKING CONFIRMED — ${(booking.branch || config.BRANCH_NAME).toUpperCase()}*\n` +
    `─────────────────────────────\n` +
    `👤 ${booking.customer_name} (wa.me/${booking.phone_number})\n` +
    `✂️ ${booking.service}\n` +
    `📅 ${booking.booking_date} — 🕐 ${booking.booking_time}\n` +
    `─────────────────────────────\n` +
    `_${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`;

  try {
    await sendFromBranch(config.ADMIN_WHATSAPP, message);
    console.log(`[Notification] ✅ Admin notified for booking ${booking.customer_name}`);
  } catch (err) {
    console.error('[Notification] ❌ Failed to notify admin:', err.message);
  }
};

module.exports = { notifyKapster, notifyAdmin };
