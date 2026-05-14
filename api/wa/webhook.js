/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook — RedBox Barbershop assistant
 * Tone: casual Indonesian, warm, human-like, conversational
 */

const { sendWA } = require('../../server/services/fonnte');

// ── Helpers ──────────────────────────────────────────────────────────────────

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const has = (text, keywords) => keywords.some(k => text.includes(k));

function timeGreet() {
  const h = new Date().getHours();
  return h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
}

function firstName(name) {
  return (name || 'Kak').split(' ')[0];
}

// ── Responses ─────────────────────────────────────────────────────────────────

function replyGreeting(name) {
  const fn = firstName(name);
  const t = timeGreet();
  const opener = pick([
    `Haii kak ${fn}! Selamat ${t} ya ✨`,
    `Yoo kak ${fn}! 👋 Selamat ${t}~`,
    `Halo kak ${fn}! Selamat ${t} 🌟`,
    `Haloo kak ${fn}~ Selamat ${t} ya 😄`,
  ]);
  const body = pick([
    `Lagi mau potong atau ada yang ditanyain dulu?`,
    `Ada yang bisa aku bantu hari ini? ✂️`,
    `Mau booking, nanya harga, atau gimana nih? Santai aja kak 😊`,
    `Siap melayani kak! Mau ngapain dulu nih? 😁`,
  ]);
  return `${opener}\n\n${body}`;
}

function replyServices() {
  return pick([
    `Nih kak, ini yang kita punya 💈\n\n✂️ *Haircut* — 75k (30 menit)\n✂️ *Haircut + Wash* — 95k (45 menit)\n🔥 *Two Block* — 85k (40 menit) ← paling hits!\n⚡ *Fade Cut* — 90k (40 menit)\n💆 *Hairspa* — 120k (60 menit)\n🎨 *Coloring* — mulai 200k (90 menit)\n🧔 *Beard Trim* — 45k (20 menit)\n💥 *Combo (Haircut + Beard)* — 110k (50 menit)\n\nAda yang mau dicoba kak? Aku bisa saranin juga lho 😄`,
    `Boleh, ini daftar layanannya kak 👇\n\n✂️ *Haircut* — 75rb\n✂️ *Haircut + Wash* — 95rb\n🔥 *Two Block* — 85rb (banyak yang request ini!)\n⚡ *Fade Cut* — 90rb\n💆 *Hairspa* — 120rb\n🎨 *Coloring* — mulai 200rb\n🧔 *Beard Trim* — 45rb\n💥 *Combo Hair + Beard* — 110rb\n\nSemua udah include treatment ya kak! Mau pilih yang mana? 😊`,
  ]);
}

function replyBooking() {
  return pick([
    `Yuk booking sekarang kak! 📅\n\nTinggal klik link ini:\n👉 *redboxbarbershop.com/booking.html*\n\nPilih layanan → pilih barber → pilih jadwal → done! Gampang banget kok 😄\n\nMau aku jelasin caranya dulu nggak?`,
    `Oke siap! Booking bisa langsung dari sini kak 👇\n\n🔗 *redboxbarbershop.com/booking.html*\n\nNantinya tinggal pilih layanan, barber, sama slot waktu yang kosong. Biasanya prosesnya cuma 2 menit doang!\n\nAda pertanyaan soal booking? 😊`,
    `Bisa kak! Ini link bookingnya:\n👉 *redboxbarbershop.com/booking.html*\n\nOh iya, booking lebih enak daripada langsung datang — nggak perlu antri lama 😉\n\nMau hari apa rencananya?`,
  ]);
}

function replyLocation() {
  return pick([
    `Lokasinya gampang kok kak 😄\n\n📍 Jl. Bypass Kedawung, Cirebon\n🕐 Buka setiap hari — *10.00 s/d 22.00 WIB*\n\nParkirnya luas, tenang aja! 🚗🏍️\n\nMau aku kirimin link Maps-nya juga?`,
    `RedBox ada di sini kak 👇\n\n📍 *Jl. Bypass Kedawung, Cirebon*\nBuka *10.00–22.00* setiap hari (termasuk hari libur!)\n\nParkir gratis ya kak, jangan khawatir 😊\n\nMau booking dulu sebelum kesini biar nggak nunggu lama?`,
  ]);
}

function replyHours() {
  return pick([
    `Kita buka setiap hari kak! ✅\n\n🕐 *Jam 10.00 – 22.00 WIB*\nTermasuk Sabtu, Minggu, dan hari libur nasional juga tetap buka 💪\n\nMau langsung datang atau booking dulu?`,
    `Jam operasionalnya:\n⏰ *10 pagi – 10 malem* (setiap hari ya kak, no day off! 😄)\n\nKalau mau aman, booking dulu biar dapat slot yang pas 😊`,
  ]);
}

function replyPayment() {
  return pick([
    `Soal bayar, fleksibel banget kak 😊\n\n💵 *Tunai / Cash*\n📱 *QRIS* — GoPay, OVO, Dana, Shopee, semua bisa!\n💳 *Debit / Kredit*\n\nTinggal pilih yang paling nyaman! Ada lagi yang mau ditanyain?`,
    `Kami terima semua cara bayar kak! 🙌\n\n✅ Cash\n✅ QRIS (semua e-wallet)\n✅ Debit & Kredit\n\nJadi nggak perlu khawatir soal pembayaran 😄`,
  ]);
}

function replyParking() {
  return pick([
    `Tenang kak, parkir gratis dan lumayan luas kok! 🚗🏍️\nAman buat motor maupun mobil.\n\nAda yang mau ditanyain lagi?`,
    `Ada parkir gratis di depan outlet kak, jadi nggak usah khawatir 😊 Bisa motor atau mobil.\n\nMau sekalian booking?`,
  ]);
}

function replyWalkin() {
  return pick([
    `Bisa langsung datang kok kak! Walk-in welcome 😊\n\nTapi kalau mau lebih santai dan nggak nunggu lama,断然 booking dulu lebih aman.\n\nMau aku kasih link bookingnya?`,
    `Walk-in bisa kak, tenang aja! Tapi saran aku mending booking dulu — biar kamu tinggal dateng langsung masuk, nggak perlu antri 😄\n\nBookingnya di sini: *redboxbarbershop.com/booking.html*`,
  ]);
}

function replyRecommend(name) {
  const fn = firstName(name);
  return pick([
    `Ooh mau rekomendasi? Aku saranin *Two Block* kak ${fn} — ini yang paling banyak diminta sekarang dan hasilnya clean banget 🔥\n\nKalau mau yang lebih low maintenance, *Fade Cut* juga oke banget. Nggak perlu sering-sering ke barber!\n\nMau tau lebih detail yang mana?`,
    `Kalau lagi tren sekarang sih *Two Block* kak — kayak gaya Korea gitu, cocok buat wajah oval maupun kotak 😄\n\nAlternativenya *Fade Cut* — clean, rapi, dan tahan lama.\n\nMau booking salah satunya? 😊`,
  ]);
}

function replyDuration() {
  return `Tergantung layanannya kak:\n\n⚡ *Beard Trim* — ~20 menit\n✂️ *Haircut* — ~30 menit\n✂️ *Haircut + Wash / Two Block / Fade* — ~40 menit\n💥 *Combo Hair+Beard* — ~50 menit\n💆 *Hairspa* — ~60 menit\n🎨 *Coloring* — ~90 menit\n\nJadi kalau ada keperluan setelah itu, bisa estimasi waktunya dari sini ya kak 😊`;
}

function replyPromo() {
  return pick([
    `Promo terbaru bisa dicek langsung di website ya kak! 🎉\n👉 *redboxbarbershop.com*\n\nAtau follow sosmed kita buat dapet info promo yang paling fresh 😄`,
    `Wah kebetulan banget nanya promo! 😄\nInfo promo terkini ada di website:\n🔗 *redboxbarbershop.com*\n\nKadang ada flash promo juga, jadi stay tune ya kak! 🔔`,
  ]);
}

function replyThanks(name) {
  const fn = firstName(name);
  return pick([
    `Sama-sama kak ${fn}! 😊 Kalau ada yang lain jangan ragu tanya ya. Sampai ketemu di RedBox! ✂️✨`,
    `Siap kak ${fn}! 🙌 Senang bisa bantu. Ditunggu kedatangannya ya, nanti pasti puas! 💈`,
    `Tentu kak ${fn}! Kalau butuh apa-apa, aku selalu di sini 😄 Jangan lupa booking ya biar nggak antri~`,
  ]);
}

function replyAfterBooking(name) {
  const fn = firstName(name);
  return pick([
    `Keren kak ${fn}! Abis booking langsung konfirmasi otomatis ya 😊 Kalau ada yang perlu diubah jadwalnya, kabarin aku aja!\n\nSampai ketemu di RedBox! ✂️`,
    `Nice! Nanti dateng langsung bisa masuk aja kak ${fn}, nggak perlu nunggu lama 💪 See you! 🙏`,
  ]);
}

function replyUnknown(name) {
  const fn = firstName(name);
  return pick([
    `Hmm aku belum ngerti maksudnya kak ${fn} 😅 Coba tanya dengan kata lain ya?\n\nOr mau aku bantu soal:\n• *harga* layanan\n• *booking* jadwal\n• *lokasi* & jam buka\n• rekomendasi gaya rambut`,
    `Wah aku kurang paham nih kak ${fn} 😅\n\nCoba ketik salah satu ini ya:\n🔹 *harga* — lihat daftar layanan\n🔹 *booking* — reservasi\n🔹 *lokasi* — alamat & jam buka\n🔹 *rekomendasi* — saranin gaya`,
    `Maaf kak ${fn}, aku belum nangkep 🙏 Mungkin bisa tanya lagi dengan cara lain?\n\nKalau butuh langsung ngobrol sama tim kami, ketik *admin* ya!`,
  ]);
}

function replyAdmin(name) {
  const fn = firstName(name);
  return `Oke kak ${fn}, aku sambungin ke tim kami ya 😊\n\nSebentar ditunggu, ada yang bisa aku bantu dulu sambil nunggu?`;
}

// ── Intent Detection ──────────────────────────────────────────────────────────

function detectIntent(text) {
  const t = text.toLowerCase();

  if (has(t, ['halo', 'hai', 'hi ', 'hello', 'hei', 'hey', 'pagi', 'siang', 'sore', 'malam', 'assalam', 'selamat', 'permisi', 'hallo', 'haloo']))
    return 'greeting';

  if (has(t, ['makasih', 'terima kasih', 'thanks', 'thx', 'tq ', 'tq!', 'oke makasih', 'ok makasih', 'udah cukup', 'gitu aja', 'udah deh']))
    return 'thanks';

  if (has(t, ['admin', 'cs ', 'customer service', 'manusia', 'staff', 'orang asli', 'langsung ngobrol']))
    return 'admin';

  if (has(t, ['rekomendasi', 'rekomen', 'saranin', 'suggest', 'bagus mana', 'yang bagus', 'cocok buat', 'enak mana', 'pilih mana', 'mending mana']))
    return 'recommend';

  if (has(t, ['berapa lama', 'lama ga', 'lama nggak', 'estimasi', 'durasinya', 'waktunya', 'cepet ga', 'cepat ga']))
    return 'duration';

  if (has(t, ['harga', 'price', 'tarif', 'biaya', 'berapa', 'mahal', 'murah', 'layanan', 'services', 'menu', 'paket', 'list']))
    return 'services';

  if (has(t, ['mau cukur', 'mau potong', 'pengen potong', 'pengen cukur', 'mau booking', 'mau reservasi', 'booking', 'reservasi', 'jadwal', 'pesan tempat', 'daftar', 'antrian', 'slot']))
    return 'booking';

  if (has(t, ['selesai booking', 'udah booking', 'baru aja booking', 'habis booking', 'konfirmasi']))
    return 'after_booking';

  if (has(t, ['lokasi', 'alamat', 'dimana', 'maps', 'gps', 'tempatnya', 'di mana', 'adanya dimana']))
    return 'location';

  if (has(t, ['jam buka', 'buka jam', 'jam berapa', 'tutup', 'jam operasional', 'open', 'buka kapan', 'masih buka']))
    return 'hours';

  if (has(t, ['bayar', 'pembayaran', 'transfer', 'qris', 'tunai', 'cash', 'debit', 'kredit', 'gopay', 'ovo', 'dana', 'shopee']))
    return 'payment';

  if (has(t, ['parkir', 'motor', 'mobil', 'parkirnya']))
    return 'parking';

  if (has(t, ['walk in', 'langsung datang', 'tanpa booking', 'bisa langsung', 'nggak perlu booking', 'ga perlu booking']))
    return 'walkin';

  if (has(t, ['promo', 'diskon', 'discount', 'voucher', 'potongan', 'murah', 'cashback']))
    return 'promo';

  return 'unknown';
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function handleMessage({ from, name, text }) {
  const intent = detectIntent(text);

  // Small typing delay feel (optional, skip if too slow for serverless)
  // await new Promise(r => setTimeout(r, 800));

  switch (intent) {
    case 'greeting':      return sendWA(from, replyGreeting(name));
    case 'thanks':        return sendWA(from, replyThanks(name));
    case 'admin':         return sendWA(from, replyAdmin(name));
    case 'recommend':     return sendWA(from, replyRecommend(name));
    case 'duration':      return sendWA(from, replyDuration());
    case 'services':      return sendWA(from, replyServices());
    case 'booking':       return sendWA(from, replyBooking());
    case 'after_booking': return sendWA(from, replyAfterBooking(name));
    case 'location':      return sendWA(from, replyLocation());
    case 'hours':         return sendWA(from, replyHours());
    case 'payment':       return sendWA(from, replyPayment());
    case 'parking':       return sendWA(from, replyParking());
    case 'walkin':        return sendWA(from, replyWalkin());
    case 'promo':         return sendWA(from, replyPromo());
    default:              return sendWA(from, replyUnknown(name));
  }
}

// ── Webhook Entry ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')     return res.status(200).json({ status: 'ok', service: 'RedBox WA Bot' });
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    // Fonnte payload: { device, sender, name, message, id, type }
    const { sender, name, message, type } = req.body || {};

    if (type && type !== 'text') return res.status(200).json({ status: 'ignored' });
    if (!sender || !message)     return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    await handleMessage({ from: sender, name: name || 'Kak', text: message });
    return res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WA Bot] Error:', err.message);
    return res.status(200).json({ status: 'error' }); // always 200 to avoid Fonnte retry storm
  }
};
