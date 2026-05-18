/**
 * WhatsApp Notification Templates (via Fonnte)
 *
 * Required env vars:
 *   FONNTE_TOKEN       — Fonnte device token
 *   WA_ADMIN_NUMBER   — Admin/owner number (628xxx), receives new booking alerts
 */

const { sendWA } = require('./fonnte');

const ADMIN_NUMBER = process.env.WA_ADMIN_NUMBER;
if (!ADMIN_NUMBER) {
  console.warn('[waNotification] WA_ADMIN_NUMBER env var not set — admin booking notifications will be skipped');
}

const BRANCH_LABELS = {
  bypass:    'RedBox Bypass (Pusat)',
  samadikun: 'RedBox Samadikun',
  csb:       'RedBox CSB Mall',
  sumber:    'RedBox Sumber',
  tegal:     'RedBox Tegal',
};

function branchLabel(location) {
  return BRANCH_LABELS[String(location || '').toLowerCase()] || 'RedBox Barbershop';
}

// 1. Konfirmasi booking ke pelanggan — dikirim otomatis setelah booking berhasil
async function notifyCustomerBookingConfirmed(booking) {
  const { name, wa, service, date, time, location, barber_name, price, duration } = booking;

  const fn     = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);
  const tgl    = formatDate(date);
  const harga  = price ? `\n💰 *Rp ${Number(price).toLocaleString('id-ID')}*` : '';
  const durasi = duration ? `\n⏱ Durasi ±${duration}` : '';
  const kapster = barber_name ? `\n💈 Kapster: *${barber_name}*` : '';

  const message =
`Haii kak *${fn}*! 👋

Yeay, booking kamu sudah *CONFIRMED* nih! 🎉✅

📋 *Detail Booking:*
✂️ ${service}${harga}${durasi}
📅 ${tgl}
⏰ Jam *${time} WIB*${kapster}
📍 *${branch}*

Kami udah catat jadwalnya — tinggal dateng aja kak! 😄

Ada yang mau ditanyain? Mau tanya soal layanan, tips perawatan rambut, atau hal lain — aku siap bantu kapan aja! 💬✂️`;

  return sendWA(wa, message);
}

// 2. Reminder H-1 ke pelanggan (sehari sebelum) — dipakai oleh cron reminders.js
async function notifyCustomerReminderH1(booking) {
  const { name, wa, service, date, time, location, barber_name } = booking;

  const fn     = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);
  const tgl    = formatDate(date);
  const kapster = barber_name ? `\n💈 Kapster: *${barber_name}*` : '';

  const message =
`Halo kak *${fn}*! 👋

🔔 *Reminder: Besok ada jadwal kamu di RedBox!*

📅 ${tgl}
⏰ Jam *${time} WIB*
✂️ ${service}${kapster}
📍 *${branch}*

Dateng tepat waktu ya kak biar langsung bisa dilayani! 😊
Sampai besok! ✂️🔴`;

  return sendWA(wa, message);
}

// 3. Notifikasi ke admin/barber saat ada booking baru
async function notifyAdminNewBooking(booking) {
  if (!ADMIN_NUMBER) return null;

  const { name, wa, service, date, time, location, barber_name, price, notes } = booking;

  const tgl = formatDate(date);
  const message =
`🔔 *Booking Baru Masuk!*

👤 *Customer:*
• Nama   : ${name}
• WA     : ${wa}

📋 *Detail:*
• Layanan : ${service}${price ? ` (Rp ${Number(price).toLocaleString('id-ID')})` : ''}
• Tanggal : ${tgl}
• Jam     : ${time} WIB
• Lokasi  : ${branchLabel(location)}
${barber_name ? `• Kapster : ${barber_name}\n` : ''}${notes ? `• Catatan : ${notes}\n` : ''}
#RedBoxBooking`;

  return sendWA(ADMIN_NUMBER, message);
}

// --- helpers ---

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

module.exports = {
  notifyCustomerBookingConfirmed,
  notifyCustomerReminderH1,
  notifyAdminNewBooking,
};
