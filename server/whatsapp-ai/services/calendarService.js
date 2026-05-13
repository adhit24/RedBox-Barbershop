const config = require('../config');

// Indonesian month names → number
const MONTHS = {
  januari: '01', februari: '02', maret: '03', april: '04',
  mei: '05', juni: '06', juli: '07', agustus: '08',
  september: '09', oktober: '10', november: '11', desember: '12',
};

/**
 * Parse "15 Mei 2026" → "2026-05-15"
 * or pass through "2026-05-15" as-is.
 */
const parseISODate = (dateStr) => {
  const indo = dateStr.trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (indo) {
    const day = indo[1].padStart(2, '0');
    const month = MONTHS[indo[2].toLowerCase()] || '01';
    return `${indo[3]}-${month}-${day}`;
  }
  return dateStr.trim(); // already ISO
};

/**
 * Parse "19.00" / "7 malam" / "14:00" → { h: number, m: number }
 */
const parseTime = (timeStr) => {
  const t = (timeStr || '').trim().toLowerCase();

  const dotMatch = t.match(/^(\d{1,2})[.:](\d{2})/);
  if (dotMatch) return { h: parseInt(dotMatch[1], 10), m: parseInt(dotMatch[2], 10) };

  const wordMatch = t.match(/^(\d{1,2})\s*(pagi|siang|sore|malam)/);
  if (wordMatch) {
    let h = parseInt(wordMatch[1], 10);
    if (['sore', 'malam'].includes(wordMatch[2]) && h < 12) h += 12;
    if (wordMatch[2] === 'siang' && h < 12) h += 12;
    return { h, m: 0 };
  }

  return { h: 9, m: 0 }; // fallback
};

/**
 * Format Date to Google Calendar datetime string: YYYYMMDDTHHmmss
 * All times treated as WIB (UTC+7), converted to UTC for the link.
 */
const toGCalFormat = (isoDate, timeObj) => {
  const { h, m } = timeObj;
  // WIB = UTC+7 → subtract 7h for UTC
  const utcH = h - 7;
  const date = new Date(`${isoDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`);
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  return `${y}${mo}${d}T${hh}${mm}00Z`;
};

/**
 * Generate a Google Calendar "Add to Calendar" link.
 *
 * @param {{ customer_name, service, booking_date, booking_time }} booking
 * @param {number} durationMinutes - default 60
 * @returns {string} URL
 */
const generateGoogleCalendarLink = (booking, durationMinutes = 60, locationOverride = null) => {
  const isoDate = parseISODate(booking.booking_date);
  const timeObj = parseTime(booking.booking_time);

  const startStr = toGCalFormat(isoDate, timeObj);

  // Compute end time
  const endDate = new Date(`${isoDate}T${String(timeObj.h).padStart(2,'0')}:${String(timeObj.m).padStart(2,'0')}:00+07:00`);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);
  const pad = (n) => String(n).padStart(2, '0');
  const endStr = `${endDate.getUTCFullYear()}${pad(endDate.getUTCMonth()+1)}${pad(endDate.getUTCDate())}T${pad(endDate.getUTCHours())}${pad(endDate.getUTCMinutes())}00Z`;

  const title = encodeURIComponent(`${booking.service} — RedBox Barbershop`);
  const details = encodeURIComponent(`Booking ${booking.service} di RedBox Barbershop.\nJangan lupa ya kak! 💈`);
  const location = encodeURIComponent(locationOverride || config.BRAND_ADDRESS || 'RedBox Barbershop');

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${location}`;
};

module.exports = { generateGoogleCalendarLink };
