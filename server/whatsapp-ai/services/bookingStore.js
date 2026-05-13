const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : require('crypto');

const STORE_PATH = path.join(__dirname, '../logs/bookings.json');

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _load = () => {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
};

const _save = (bookings) => {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(bookings, null, 2), 'utf8');
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a confirmed booking.
 * Returns the saved booking object with generated id.
 *
 * @param {{ customer_name, phone_number, service, booking_date, booking_time }} data
 */
const saveBooking = (data) => {
  const bookings = _load();

  const booking = {
    id: require('crypto').randomUUID(),
    customer_name: data.customer_name || data.name || '',
    phone_number: data.phone_number || data.phone || '',
    branch: data.branch || '',
    branch_address: data.branch_address || '',
    service: data.service || '',
    booking_date: data.booking_date || data.date || '',
    booking_time: data.booking_time || data.time || '',
    created_at: new Date().toISOString(),
    status: 'confirmed',
    h1_sent: false,
    h2_sent: false,
  };

  bookings.push(booking);
  _save(bookings);

  console.log(`[BookingStore] Saved: ${booking.id} | ${booking.customer_name} | ${booking.booking_date} ${booking.booking_time}`);
  return booking;
};

/**
 * Get all bookings with status confirmed and at least one reminder not yet sent.
 */
const getPendingReminders = () => {
  return _load().filter(b =>
    b.status === 'confirmed' && (!b.h1_sent || !b.h2_sent)
  );
};

/**
 * Mark a reminder flag as sent for a booking id.
 * @param {string} id - booking id
 * @param {'h1_sent'|'h2_sent'} flag
 */
const markReminderSent = (id, flag) => {
  const bookings = _load();
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) return;
  bookings[idx][flag] = true;
  _save(bookings);
};

/**
 * Get all bookings (for debug / admin).
 */
const getAllBookings = () => _load();

module.exports = { saveBooking, getPendingReminders, markReminderSent, getAllBookings };
