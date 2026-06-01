const config = require('../config');
const logger = require('../utils/logger');
const bookingStore = require('./bookingStore');
const calendarService = require('./calendarService');
const notificationService = require('./notificationService');

// Booking states — branch step removed: each instance IS a branch
const STATES = {
  IDLE: 'idle',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_SERVICE: 'awaiting_service',
  AWAITING_DATE: 'awaiting_date',
  AWAITING_TIME: 'awaiting_time',
  CONFIRMING: 'confirming',
};

// In-memory booking sessions: { phone: { state, data } }
const sessions = new Map();

const getSession = (phone) => sessions.get(phone) || { state: STATES.IDLE, data: {} };
const setSession = (phone, session) => sessions.set(phone, session);
const clearSession = (phone) => sessions.delete(phone);

const isActive = (phone) => {
  const s = getSession(phone);
  return s.state !== STATES.IDLE;
};

// Returns { reply, done } — done=true means booking flow ended
const handle = (phone, name, text) => {
  const session = getSession(phone);
  const input = text.trim();

  // Cancel booking
  if (['batal', 'cancel', 'stop'].includes(input.toLowerCase())) {
    clearSession(phone);
    return { reply: 'Booking dibatalkan ya kak. Ada yang bisa dibantu lagi? 😊', done: true };
  }

  switch (session.state) {
    case STATES.IDLE: {
      setSession(phone, { state: STATES.AWAITING_NAME, data: {} });
      return { reply: `Siap kak! Aku bantu booking dulu ya 📝\n\nBoleh tau nama lengkapnya?`, done: false };
    }

    case STATES.AWAITING_NAME: {
      if (input.length < 2) {
        return { reply: 'Nama-nya kurang kak, tulis nama lengkap ya 😊', done: false };
      }
      session.data.name = input;
      session.state = STATES.AWAITING_SERVICE;
      setSession(phone, session);
      return {
        reply: `Hai ${input}! 👋\n\nLayanan apa yang mau dipilih kak?\n\n• Gentleman Grooming (95k)\n• Hair Spa (110k)\n• Hair Color (160k)\n• Shaving (40k)\n• Men Massage (145k)\n\nKetik nama layanannya ya 😊`,
        done: false
      };
    }

    case STATES.AWAITING_SERVICE: {
      session.data.service = input;
      session.state = STATES.AWAITING_DATE;
      setSession(phone, session);
      return {
        reply: `Oke, *${input}* ya kak ✂️\n\nTanggal berapa mau datang? (contoh: 15 Mei 2026)`,
        done: false
      };
    }

    case STATES.AWAITING_DATE: {
      session.data.date = input;
      session.state = STATES.AWAITING_TIME;
      setSession(phone, session);
      return {
        reply: `Siap, tanggal *${input}* ya 📅\n\nJam berapa? Kami buka 10.00–21.00 WIB\n(contoh: 14.00 atau 2 siang)`,
        done: false
      };
    }

    case STATES.AWAITING_TIME: {
      session.data.time = input;
      session.state = STATES.CONFIRMING;
      setSession(phone, session);
      const d = session.data;
      const branchName = config.BRANCH_NAME;
      return {
        reply: `Oke, ini summary booking kamu kak 📋\n\n👤 Nama: *${d.name}*\n📍 Cabang: *${branchName}*\n✂️ Layanan: *${d.service}*\n📅 Tanggal: *${d.date}*\n🕐 Jam: *${d.time}*\n\nKonfirmasi? Balas *YA* untuk lanjut atau *BATAL* untuk cancel`,
        done: false
      };
    }

    case STATES.CONFIRMING: {
      if (['ya', 'yes', 'iya', 'ok', 'oke', 'yep'].includes(input.toLowerCase())) {
        logger.logBooking({ ...session.data, phone, confirmedAt: new Date().toISOString() });

        // Save to bookingStore for reminder scheduler
        const savedBooking = bookingStore.saveBooking({
          customer_name: session.data.name,
          phone_number: phone,
          branch: config.BRANCH_NAME,
          branch_address: config.BRANCH_ADDRESS,
          service: session.data.service,
          booking_date: session.data.date,
          booking_time: session.data.time,
        });

        // Generate Google Calendar link
        const calLink = calendarService.generateGoogleCalendarLink(savedBooking, 60, config.BRANCH_ADDRESS);

        // Notify kapster(s) of this branch (fire-and-forget)
        notificationService.notifyKapster(savedBooking).catch(err =>
          logger.logError('notification_kapster', err.message)
        );

        // Notify admin as backup (fire-and-forget)
        notificationService.notifyAdmin(savedBooking).catch(err =>
          logger.logError('notification_admin', err.message)
        );

        clearSession(phone);
        return {
          reply: `Booking berhasil dikonfirmasi kak! 🎉\n\nSampai ketemu ya, kami tunggu kedatangannya di *${config.BRANCH_NAME}* 💈\n\n📅 *Tambah ke Google Calendar:*\n${calLink}\n\nJika ada perubahan, hubungi kami kembali 🙏`,
          done: true
        };
      } else {
        clearSession(phone);
        return { reply: 'Booking dibatalkan ya kak. Kapan-kapan mau booking lagi tinggal bilang aja 😊', done: true };
      }
    }

    default:
      clearSession(phone);
      return { reply: 'Ada yang bisa dibantu kak? 😊', done: true };
  }
};

module.exports = { handle, isActive, clearSession, STATES };
