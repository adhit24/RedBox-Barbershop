const whatsappService = require('./whatsappService');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Build the notification message sent to the branch WA number.
 */
const buildBranchNotification = (booking) => {
  return (
    `🔔 *BOOKING BARU — ${booking.branch.toUpperCase()}*\n` +
    `─────────────────────\n` +
    `👤 Nama    : *${booking.customer_name}*\n` +
    `📱 No. WA  : wa.me/${booking.phone_number}\n` +
    `✂️ Layanan : *${booking.service}*\n` +
    `📅 Tanggal : *${booking.booking_date}*\n` +
    `🕐 Jam     : *${booking.booking_time}*\n` +
    `─────────────────────\n` +
    `_Notifikasi otomatis dari RedBox Dispatch_ 🤖`
  );
};

/**
 * Forward confirmed booking to the target branch WA number.
 * Skips silently if branch WA number is not configured.
 *
 * @param {object} booking - saved booking object from bookingStore
 */
const forwardToBranch = async (booking) => {
  const branchKey = booking.branch_key || '';
  const branchWa = config.BRANCH_WA[branchKey];

  if (!branchWa) {
    console.warn(`[Dispatch] No WA number configured for branch "${branchKey}" — skipping forward.`);
    logger.logError('dispatch', `No WA number for branch: ${branchKey}`);
    return;
  }

  const message = buildBranchNotification(booking);

  try {
    await whatsappService.sendText(branchWa, message);
    console.log(`[Dispatch] ✅ Forwarded to ${booking.branch} (${branchWa}) — ${booking.customer_name} | ${booking.booking_date} ${booking.booking_time}`);
    logger.logDispatch(booking, branchWa, 'sent');
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[Dispatch] ❌ Failed to forward to ${booking.branch}: ${errMsg}`);
    logger.logDispatch(booking, branchWa, 'failed');
    throw err; // re-throw so bookingService can catch + log
  }
};

module.exports = { forwardToBranch };
