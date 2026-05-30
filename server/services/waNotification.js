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

const GOOGLE_REVIEW_URLS = {
  bypass:    'https://g.page/r/CQVtP1_nV-SFEBM/review',
  samadikun: 'https://g.page/r/CYSfr6rTvLs1EBM/review',
  sumber:    'https://g.page/r/CS9yPcCA-CznEBM/review',
  tegal:     'https://g.page/r/CWg3nZeYXRxSEBM/review',
  csb:       'https://g.page/r/CbsPlES6TnydEBM/review',
};

// 4. Review request — dikirim 30 menit setelah service selesai
async function notifyCustomerReviewRequest(booking) {
  const { name, wa, location, barber_name } = booking;

  const fn      = (name || 'Kak').split(' ')[0];
  const branch  = branchLabel(location);
  const kapster = barber_name ? `bareng *${barber_name}*` : 'di Redbox';
  const loc     = String(location || '').toLowerCase();
  const link    = GOOGLE_REVIEW_URLS[loc] || GOOGLE_REVIEW_URLS.bypass;

  const message =
`Haii kak *${fn}*! 👋

Makasih banget udah percayain *${branch}* jadi grooming spot kakak hari ini — beneran berarti banget buat kami 🙏✨ Semoga hasil ${kapster} bikin pede makin nampol ya 💈

Jujur kak, sebagai barbershop yang masih terus berkembang, ulasan kakak di Google itu kayak suntikan energi buat tim kami. Cuma butuh *1 menit* waktu kakak, tapi bantu banyak orang nemuin Redbox & bikin para kapster makin semangat ngasih hasil terbaik 🙏

Biar kakak gak rugi waktu, ada apresiasi spesial nih:

🎁 *Kasih ulasan positif* (rating ⭐ 4–5) → langsung dapat *5 poin RedBox senilai Rp 50.000!*
Poin auto-credit ke akun member kakak — bisa ditukar diskon haircut, free coffee, sampai treatment gratis di kunjungan next 🔥

⭐ *Tulis ulasan di sini:*
👉 ${link}

Beneran 30 detik aja — bantu kami tumbuh, kakak yang dapet hadiahnya. Win-win banget kan 😎✂️

_(Pastikan login member di redboxbarbershop.com biar poin auto-credit ya kak)_`;

  return sendWA(wa, message);
}

// 5. Notifikasi poin credited setelah review positif
async function notifyCustomerReviewPointsCredited(wa, name, rating, pointsEarned, totalPoints) {
  const fn = (name || 'Kak').split(' ')[0];
  const valueIdr = pointsEarned * 10000; // 1 poin = Rp 10.000

  const message =
`Yeayy kak *${fn}*! 🎉✨

Ulasan kakak di Google udah kami terima — *${rating} bintang* ⭐ Makasih banyak atas dukungannya! 🙏

🎁 *Bonus poin udah auto-credit ke akun member kakak:*

✅ Poin yang didapat: *+${pointsEarned} poin*
💰 Nilai: *Rp ${valueIdr.toLocaleString('id-ID')}*
🏦 Total poin sekarang: *${totalPoints} poin*

Poin bisa ditukerin untuk:
💈 Diskon haircut
☕ Free coffee di Sundaze
🎁 Treatment gratis

Cek & redeem poin di:
👉 redboxbarbershop.com/member-dashboard.html

Makasih lagi kak udah jadi bagian dari keluarga RedBox! Sampai ketemu di kunjungan next ya 😎✂️`;

  return sendWA(wa, message);
}

async function notifyBarberNewHomeServiceJob({
  barberPhone, customerName, dateStr, timeStr, address, serviceLabel, price,
}) {
  const msg =
`🔔 *[HOME SERVICE] Booking Baru*

Pelanggan : ${customerName}
Tanggal   : ${dateStr} | ${timeStr} WIB
Alamat    : ${address}
Layanan   : ${serviceLabel}
Harga     : ${price}

Balas *BERANGKAT* saat berangkat ke lokasi.
Balas *SELESAI* setelah pekerjaan selesai.`;

  return sendWA(barberPhone, msg);
}

module.exports = {
  notifyCustomerBookingConfirmed,
  notifyCustomerReminderH1,
  notifyAdminNewBooking,
  notifyCustomerReviewRequest,
  notifyCustomerReviewPointsCredited,
  notifyBarberNewHomeServiceJob,
};
