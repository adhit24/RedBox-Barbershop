const cron = require('node-cron');
const bookingStore = require('./bookingStore');
const reminderService = require('./reminderService');
const logger = require('../utils/logger');

// How long after appointment end to send review request (minutes)
const REVIEW_AFTER_MINUTES = 30;

const TIMEZONE = 'Asia/Jakarta';

// Quiet hours: do not send reminders before 08:00 or after 21:00 WIB
const QUIET_HOUR_START = 8;
const QUIET_HOUR_END = 21;

// Guard against concurrent cron runs
let isRunning = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse "15 Mei 2026" or "2026-05-15" into a Date object (WIB midnight).
 */
const parseBookingDateTime = (dateStr, timeStr) => {
  // Normalize Indonesian month names → numbers
  const MONTHS = {
    januari: '01', februari: '02', maret: '03', april: '04',
    mei: '05', juni: '06', juli: '07', agustus: '08',
    september: '09', oktober: '10', november: '11', desember: '12',
  };

  let isoDate = dateStr.trim();

  // "15 Mei 2026" → "2026-05-15"
  const indoMatch = isoDate.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (indoMatch) {
    const day = indoMatch[1].padStart(2, '0');
    const month = MONTHS[indoMatch[2].toLowerCase()] || '01';
    const year = indoMatch[3];
    isoDate = `${year}-${month}-${day}`;
  }

  // Normalize time: "19.00" / "7 malam" / "14:00" → "HH:MM"
  let isoTime = '10:00';
  if (timeStr) {
    const t = timeStr.trim().toLowerCase();

    // "19.00" or "19:00"
    const dotMatch = t.match(/^(\d{1,2})[.:,](\d{2})/);
    if (dotMatch) {
      isoTime = `${dotMatch[1].padStart(2, '0')}:${dotMatch[2]}`;
    }

    // "7 malam" → 19:00, "7 pagi" → 07:00, "3 sore" → 15:00
    const wordMatch = t.match(/^(\d{1,2})\s*(pagi|siang|sore|malam)/);
    if (wordMatch) {
      let h = parseInt(wordMatch[1], 10);
      const period = wordMatch[2];
      if (period === 'sore' && h < 12) h += 12;
      if (period === 'malam' && h < 12) h += 12;
      if (period === 'siang' && h < 12) h += 12;
      isoTime = `${String(h).padStart(2, '0')}:00`;
    }
  }

  // Combine as WIB (+07:00)
  const combined = `${isoDate}T${isoTime}:00+07:00`;
  const dt = new Date(combined);
  return isNaN(dt.getTime()) ? null : dt;
};

/**
 * Check if current WIB time is within quiet hours (no reminders).
 */
const isQuietHour = () => {
  const jakartaNow = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  const hour = new Date(jakartaNow).getHours();
  return hour < QUIET_HOUR_START || hour >= QUIET_HOUR_END;
};

/**
 * Get current time in WIB as Date.
 */
const nowWIB = () => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
};

// ─── Core check function ──────────────────────────────────────────────────────

const checkAndSendReminders = async () => {
  // Skip during quiet hours
  if (isQuietHour()) {
    return;
  }

  // Prevent concurrent runs
  if (isRunning) {
    console.warn('[Scheduler] Already running, skipping tick.');
    return;
  }
  isRunning = true;

  try {
    // Merge pending reminders + pending reviews (deduplicated by id)
    const reminders = bookingStore.getPendingReminders();
    const reviews = bookingStore.getPendingReviews();
    const seen = new Set();
    const bookings = [...reminders, ...reviews].filter(b => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });

    if (bookings.length === 0) {
      isRunning = false;
      return;
    }

    const now = nowWIB();
    let processed = 0;

    for (const booking of bookings) {
      const appointmentTime = parseBookingDateTime(booking.booking_date, booking.booking_time);

      if (!appointmentTime) {
        console.warn(`[Scheduler] Cannot parse datetime for booking ${booking.id}, skipping.`);
        continue;
      }

      const diffMs = appointmentTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // H-1: send between 23h and 25h before appointment
      if (!booking.h1_sent && diffHours >= 23 && diffHours <= 25) {
        await reminderService.sendH1Reminder(booking);
        processed++;
      }

      // H-2: send between 1.75h and 2.25h before appointment
      if (!booking.h2_sent && diffHours >= 1.75 && diffHours <= 2.25) {
        await reminderService.sendH2Reminder(booking);
        processed++;
      }

      // Post-appointment review request: send ~REVIEW_AFTER_MINUTES after appointment
      // diffHours is negative when appointment has passed
      const minutesPast = -diffHours * 60;
      if (!booking.review_sent && minutesPast >= REVIEW_AFTER_MINUTES && minutesPast <= REVIEW_AFTER_MINUTES + 30) {
        await reminderService.sendReviewRequest(booking);
        processed++;
      }
    }

    if (processed > 0) {
      console.log(`[Scheduler] Tick complete — ${processed} reminder(s) sent.`);
    }

  } catch (err) {
    console.error('[Scheduler] Error during check:', err.message);
    logger.logError('scheduler', err.message);
  } finally {
    isRunning = false;
  }
};

// ─── Start scheduler ──────────────────────────────────────────────────────────

const start = () => {
  // Run every 15 minutes, timezone aware
  cron.schedule('*/15 * * * *', () => {
    checkAndSendReminders().catch(err => {
      console.error('[Scheduler] Unhandled error:', err.message);
      logger.logError('scheduler', err.message);
    });
  }, { timezone: TIMEZONE });

  console.log(`✅ [Scheduler] Reminder scheduler started (every 15 min, TZ: ${TIMEZONE})`);
  console.log(`   Quiet hours: ${QUIET_HOUR_START}:00 – ${QUIET_HOUR_END}:00 WIB (no reminders sent)`);
};

module.exports = { start, checkAndSendReminders };
