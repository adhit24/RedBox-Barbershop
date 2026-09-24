/**
 * WhatsApp Notification Templates (via Fonnte)
 *
 * Required env vars:
 *   FONNTE_TOKEN       — Fonnte device token
 *   WA_ADMIN_NUMBER   — Admin/owner number (628xxx), receives new booking alerts
 */

const { sendWA } = require('./fonnte');

// Fonnte may return HTTP 200 with { status: false }; never treat that as sent.
async function sendNotification(to, message, branch) {
  const result = await sendWA(to, message, { branch });
  if (!result) throw new Error('Fonnte token missing or send skipped');
  if (result.status === false) {
    const reason = result.reason || result.error || result.message || 'Fonnte rejected message';
    // Machine-readable code so telemetry can tell "branch device not configured"
    // apart from provider rejections (the original text is kept for existing matchers).
    if (/not configured for branch/i.test(String(reason))) throw new Error(`branch_token_missing: ${reason}`);
    throw new Error(reason);
  }
  return result;
}

function canFailoverOperationalNotification(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('disconnected device')
    || message.includes('token missing')
    || message.includes('send skipped');
}

// ADMIN alerts only: they must not disappear just because one branch device is
// offline (the admin number is a single GLOBAL number, WA_ADMIN_NUMBER, not per-branch).
// Barber and customer messages NEVER use this: sender identity is part of branch ownership.
// The result is annotated so telemetry can show the requested branch vs the device
// that actually sent (failover=true means it did NOT go out from the branch device).
async function sendOperationalNotification(to, message, branch) {
  const normalizedBranch = String(branch || '').toLowerCase();
  const requested = normalizedBranch || 'bypass';
  try {
    const r = await sendNotification(to, message, requested);
    return { ...r, requested_branch: requested, actual_device: requested, failover: false };
  } catch (error) {
    if (normalizedBranch && normalizedBranch !== 'bypass' && canFailoverOperationalNotification(error)) {
      console.warn(`[WA Operational] ${normalizedBranch} unavailable; retrying via bypass device: ${error.message}`);
      const r = await sendNotification(to, message, 'bypass');
      return {
        ...r, requested_branch: requested, actual_device: 'bypass', failover: true,
        failover_reason: String(error.message || error).slice(0, 200),
      };
    }
    throw error;
  }
}

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
  const { name, wa, service, date, time, location, barber_name, price, duration, notes, type, discount_label, original_price } = booking;

  const fn     = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);
  const tgl    = formatDate(date);
  const harga  = (price === 0 || price) ? `\n💰 *Rp ${Number(price).toLocaleString('id-ID')}*` : '';
  const durasi = duration ? `\n⏱ Durasi ±${duration}` : '';
  const kapster = barber_name ? `\n💈 Kapster: *${barber_name}*` : '';
  const diskon = discount_label
    ? `\n🎉 ${discount_label} diterapkan (harga asli Rp ${Number(original_price).toLocaleString('id-ID')})`
    : '';

  const isWedding     = type === 'wedding'      || Boolean(notes?.includes('[WEDDING]'));
  const isHomeService = (type === 'home_service' || Boolean(notes?.includes('[HOME SERVICE]'))) && !isWedding;

  const closingLine = isWedding
    ? `Kapster kami akan hadir ke *venue pernikahan kamu* tepat waktu! Siap buat kesan pertama yang tak terlupakan di hari spesialnya ✨💈`
    : isHomeService
    ? `Kapster kami langsung *meluncur ke lokasi kamu* tepat waktu ya kak! Kamu tinggal standby aja di tempat — nggak perlu repot ke mana-mana! 🛵✨`
    : `Kami udah catat jadwalnya — tinggal dateng aja kak! 😄`;

  const closingQuestion = isWedding
    ? `Ada yang mau ditanyain soal persiapan grooming hari H? Kami siap bantu kapan aja! 💬✂️`
    : isHomeService
    ? `Ada yang mau ditanyain? Soal layanan, persiapan sebelum grooming, atau konfirmasi lokasi — aku siap bantu kapan aja! 💬✂️`
    : `Ada yang mau ditanyain? Mau tanya soal layanan, tips perawatan rambut, atau hal lain — aku siap bantu kapan aja! 💬✂️`;

  const message =
`Haii kak *${fn}*! 👋

Yeay, booking kamu sudah *CONFIRMED* nih! 🎉✅

📋 *Detail Booking:*
✂️ ${service}${harga}${durasi}${diskon}
📅 ${tgl}
⏰ Jam *${time} WIB*${kapster}
📍 *${branch}*

${closingLine}

${closingQuestion}`;

  return sendNotification(wa, message, location);
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

  return sendNotification(wa, message, location);
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

  return sendOperationalNotification(ADMIN_NUMBER, message, location);
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

Makasih banyak ya udah percayain *${branch}* buat grooming hari ini — beneran berarti banget buat kami 🙏✨ Semoga hasil ${kapster} bikin makin pede & fresh ya 💈

Jujur kak, ulasan dari kakak di Google itu *bintang utamanya tim kami*. Cuma butuh *30 detik* aja, tapi dampaknya luar biasa buat bikin para kapster tambah semangat ngasih service terbaik 💯🔥

⭐ *Tulis ulasan kakak di sini:*
👉 ${link}

Dukungan singkat kakak = energi besar buat RedBox terus tumbuh. Terima kasih banyak kak! 😎✂️`;

  return sendNotification(wa, message, location);
}

// 5. Notifikasi poin credited setelah review positif
async function notifyCustomerReviewPointsCredited(wa, name, rating, pointsEarned, totalPoints, branch = 'bypass') {
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

  return sendNotification(wa, message, branch);
}

async function notifyBarberNewHomeServiceJob({
  barberPhone, customerName, dateStr, timeStr, address, serviceLabel, price, branch,
}) {
  const msg =
`🔔 *[HOME SERVICE] Booking Baru*

Pelanggan : ${customerName}
Tanggal   : ${dateStr} | ${timeStr} WIB
Alamat    : ${address}
Layanan   : ${serviceLabel}
Harga     : ${price}

Catat jadwal ini ya! Kamu akan mendapat pengingat beserta instruksi keberangkatan *1 jam sebelum jadwal*. 📌`;

  // Barber notice: strict branch device, no failover to Bypass.
  return sendNotification(barberPhone, msg, branch);
}

// Remind barber 1 hour before home service booking
async function notifyBarberHomeServiceReminderH1({
  barberPhone, barberName, customerName, dateStr, timeStr, address, serviceLabel, price, branch,
}) {
  const msg =
`⏰ *[REMINDER HOME SERVICE] H-1 Jam!*

Halo kak ${barberName}! 👋

Reminder: Kamu punya pesanan home service dalam 1 jam! 📋

📋 *Detail Pesanan:*
👤 Pelanggan : ${customerName}
⏰ Waktu      : ${dateStr} | ${timeStr} WIB
📍 Alamat     : ${address}
✂️ Layanan    : ${serviceLabel}
💰 Harga      : ${price}

Jangan lupa bersiap-siap ya! 🛠️

Balas *BERANGKAT* saat kamu mulai berangkat ke lokasi.
Balas *SELESAI* setelah pekerjaan selesai.`;

  // Barber notice: strict branch device, no failover to Bypass.
  return sendNotification(barberPhone, msg, branch);
}

// Notify barber of new in-outlet booking
async function notifyBarberNewOutletBooking({
  barberPhone, barberName, customerName, dateStr, timeStr, location, serviceLabel, price, branch,
}) {
  const msg =
`🔔 *[BOOKING BARU] Pemesanan di Outlet!*

Halo kak ${barberName}! 👋

Kamu punya pesanan baru di ${location}! 📋

📋 *Detail Pesanan:*
👤 Pelanggan : ${customerName}
⏰ Waktu      : ${dateStr} | ${timeStr} WIB
📍 Lokasi     : ${location}
✂️ Layanan    : ${serviceLabel}
💰 Harga      : ${price}

Jangan lupa catat ya! ✂️`;

  // Barber notice: strict branch device, no failover to Bypass.
  return sendNotification(barberPhone, msg, branch);
}

function durationLabel(duration) {
  const raw = String(duration == null ? '' : duration).trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? `${raw} menit` : raw;
}

// 6. ONE consolidated confirmation for a multi-person booking (single main contact).
// members: [{ name, service, time, duration, barber_name }]
async function notifyCustomerGroupBookingConfirmed({ wa, contactName, location, date, members }) {
  const fn = String(contactName || 'Kak').trim().split(' ')[0];
  const sameDate = new Set(members.map(m => m.date || date)).size <= 1;
  const lines = members.map((m, i) => {
    const kapster = m.barber_name ? `\n   💈 Kapster *${m.barber_name}*` : '';
    const durasi = durationLabel(m.duration);
    const tgl = sameDate ? '' : `\n   📅 ${formatDate(m.date)}`;
    return `${i + 1}. *${m.name}*\n   ✂️ ${m.service}${durasi ? ` (±${durasi})` : ''}${kapster}${tgl}\n   ⏰ Jam *${m.time} WIB*`;
  }).join('\n\n');
  const label = branchLabel(location);
  const message =
`Haii kak *${fn}*! 👋

Yeay, booking kamu sudah *CONFIRMED* nih! 🎉✅

📋 *BOOKING ${members.length} ORANG — ${label.toUpperCase()}*

${lines}

${sameDate ? `📅 ${formatDate(date)}\n` : ''}📍 *${label}*

Kami udah catat jadwalnya — tinggal dateng aja kak! 😄`;

  // Customer-facing: strict branch device, no failover to another branch.
  return sendNotification(wa, message, location);
}

// 7. Assignment notice to ONE barber about ONE customer (no customer phone).
// Strict branch device: a barber notice must never silently ride another branch's device.
async function notifyBarberBookingAssignment({
  barberPhone, customerName, service, time, date, duration, location,
}) {
  const durasi = durationLabel(duration);
  const msg =
`BOOKING BARU — ${branchLabel(location).toUpperCase()}

Customer: ${customerName}
Service: ${service}
Jam: ${time} WIB
Tanggal: ${formatDate(date)}${durasi ? `\nDurasi: ${durasi}` : ''}

Kamu terpilih sebagai kapster untuk booking ini.`;
  return sendNotification(barberPhone, msg, location);
}

// 8. One consolidated admin notice for a multi-person booking (parity with single-booking admin alert).
async function notifyAdminGroupBooking({ contactName, wa, location, members }) {
  if (!ADMIN_NUMBER) return null;
  const rows = members.map((m, i) =>
    `${i + 1}. ${m.name} — ${m.service} — ${m.barber_name || m.barber_id || '-'} — ${m.time} WIB`).join('\n');
  const message =
`🔔 *Booking Grup Baru Masuk!*

👤 Kontak: ${contactName} (${wa})
📍 ${branchLabel(location)}
📅 ${formatDate(members[0]?.date)}

${rows}

#RedBoxBooking`;
  return sendOperationalNotification(ADMIN_NUMBER, message, location);
}

module.exports = {
  notifyCustomerGroupBookingConfirmed,
  notifyBarberBookingAssignment,
  notifyAdminGroupBooking,
  notifyCustomerBookingConfirmed,
  notifyCustomerReminderH1,
  notifyAdminNewBooking,
  notifyCustomerReviewRequest,
  notifyCustomerReviewPointsCredited,
  notifyBarberNewHomeServiceJob,
  notifyBarberHomeServiceReminderH1,
  notifyBarberNewOutletBooking,
};
