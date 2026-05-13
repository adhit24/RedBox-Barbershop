const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
const REMINDER_LOG_DIR = path.join(__dirname, '../logs/reminderLogs');

const ensureLogDir = async () => {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(REMINDER_LOG_DIR)) fs.mkdirSync(REMINDER_LOG_DIR, { recursive: true });
};

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

const append = (filename, line) => {
  const filePath = path.join(LOG_DIR, filename);
  fs.appendFileSync(filePath, line + '\n', 'utf8');
};

const logIncoming = (from, name, text) => {
  append(`messages-${today()}.log`, `[${now()}] IN  | ${from} (${name}) | ${text}`);
};

const logOutgoing = (to, text) => {
  append(`messages-${today()}.log`, `[${now()}] OUT | ${to} | ${text.replace(/\n/g, ' ')}`);
};

const logTokenUsage = (phone, tokens) => {
  append(`tokens-${today()}.log`, `[${now()}] ${phone} | ${tokens} tokens`);
};

const logBooking = (booking) => {
  const line = JSON.stringify({ timestamp: now(), ...booking });
  append(`bookings-${today()}.log`, line);
  console.log('[Booking] Saved:', booking.name, booking.service, booking.date, booking.time);
};

const logEscalation = (from, name, text) => {
  append(`escalations-${today()}.log`, `[${now()}] ${from} (${name}) | ${text}`);
  console.warn(`[ESCALATION] ${from} (${name}): ${text}`);
};

const logError = (source, message) => {
  append(`errors-${today()}.log`, `[${now()}] [${source}] ${message}`);
};

const logDispatch = (booking, branchWa, status) => {
  const line = `[${now()}] ${status.toUpperCase()} | ${booking.branch} (${branchWa}) | ${booking.customer_name} | ${booking.booking_date} ${booking.booking_time} | ${booking.service}`;
  append(`dispatch-${today()}.log`, line);
};

const logReminder = (booking, type, status) => {
  fs.mkdirSync(REMINDER_LOG_DIR, { recursive: true });
  const line = `[${now()}] ${type} | ${status.toUpperCase()} | ${booking.phone_number} (${booking.customer_name}) | ${booking.booking_date} ${booking.booking_time} | ${booking.service}`;
  const filePath = path.join(REMINDER_LOG_DIR, `reminders-${today()}.log`);
  fs.appendFileSync(filePath, line + '\n', 'utf8');
};

module.exports = {
  ensureLogDir,
  logIncoming,
  logOutgoing,
  logTokenUsage,
  logBooking,
  logEscalation,
  logError,
  logDispatch,
  logReminder,
};
