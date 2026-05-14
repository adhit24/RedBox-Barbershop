/**
 * WhatsApp Notification Templates (via Fonnte)
 *
 * Required env vars:
 *   FONNTE_TOKEN       — Fonnte device token
 *   WA_ADMIN_NUMBER   — Admin/owner number (628xxx), receives new booking alerts
 */

const { sendWA } = require('./fonnte');

const ADMIN_NUMBER = process.env.WA_ADMIN_NUMBER;

// 1. Notifikasi ke pelanggan setelah booking berhasil
async function notifyCustomerBookingConfirmed(booking) {
  const {
    name, wa, service, date, time, location, barber_name, price, duration
  } = booking;

  const tanggal = formatDate(date);
  const message = `Halo *${name}*! 👋

✅ *Booking kamu berhasil dikonfirmasi!*

📋 *Detail Appointment:*
• Layanan  : ${service}${price ? ` (Rp ${Number(price).toLocaleString('id')})` : ''}
• Tanggal  : ${tanggal}
• Jam      : ${time} WIB
• Lokasi   : RedBox Barbershop ${capitalize(location || '')}
${barber_name ? `• Barber   : ${barber_name}\n` : ''}${duration ? `• Durasi   : ±${duration} menit\n` : ''}
⚠️ Harap datang tepat waktu ya!
Jika ada perubahan, hubungi kami segera.

Terima kasih sudah booking di *RedBox Barbershop* 🔴✂️`;

  return sendWA(wa, message);
}

// 2. Reminder H-1 ke pelanggan (sehari sebelum)
async function notifyCustomerReminderH1(booking) {
  const { name, wa, service, date, time, location, barber_name } = booking;

  const tanggal = formatDate(date);
  const message = `Halo *${name}*! 👋

🔔 *Reminder: Besok ada jadwal kamu!*

📋 *Detail Appointment:*
• Layanan  : ${service}
• Tanggal  : ${tanggal} (besok)
• Jam      : ${time} WIB
• Lokasi   : RedBox Barbershop ${capitalize(location || '')}
${barber_name ? `• Barber   : ${barber_name}\n` : ''}
Sampai jumpa besok! ✂️
*RedBox Barbershop* 🔴`;

  return sendWA(wa, message);
}

// 3. Notifikasi ke admin/barber saat ada booking baru
async function notifyAdminNewBooking(booking) {
  if (!ADMIN_NUMBER) return null;

  const {
    name, wa, service, date, time, location, barber_name, price, notes
  } = booking;

  const tanggal = formatDate(date);
  const message = `🔔 *Booking Baru Masuk!*

👤 *Customer:*
• Nama   : ${name}
• WA     : ${wa}

📋 *Detail:*
• Layanan : ${service}${price ? ` (Rp ${Number(price).toLocaleString('id')})` : ''}
• Tanggal : ${tanggal}
• Jam     : ${time} WIB
• Lokasi  : ${capitalize(location || '-')}
${barber_name ? `• Barber  : ${barber_name}\n` : ''}${notes ? `• Catatan : ${notes}\n` : ''}
#RedBoxBooking`;

  return sendWA(ADMIN_NUMBER, message);
}

// --- helpers ---

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = {
  notifyCustomerBookingConfirmed,
  notifyCustomerReminderH1,
  notifyAdminNewBooking
};
