'use strict';

// Legacy chat booking is intentionally disabled for Indonesian customers.
// The website database is the only source of truth for outlet reservations.
const BOOKING_URL = 'redboxbarbershop.com/booking.html';

const sessions = new Map();

const isActive = (phone) => sessions.has(phone);
const clearSession = (phone) => sessions.delete(phone);

const handle = async (phone) => {
  clearSession(phone);
  return {
    reply: `Booking outlet dilakukan lewat website ya kak supaya slot tercatat resmi:\n→ ${BOOKING_URL} ✂️`,
    done: true,
  };
};

module.exports = { handle, isActive, clearSession };
