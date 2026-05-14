/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook handler.
 * Fonnte POST payload: { device, sender, name, message, id, type }
 */

const { sendWA } = require('../../server/services/fonnte');

const MENU_TEXT = `Halo! Ada yang bisa dibantu? 😊

📋 *Menu Cepat:*
• Ketik *harga* — lihat layanan & harga
• Ketik *booking* — link reservasi online
• Ketik *lokasi* — alamat & jam buka
• Ketik *promo* — info promo terkini`;

const SERVICES_TEXT = `💈 *Layanan RedBox Barbershop*

✂️ Hair Cut — Rp 85.000 (45 menit)
✂️ Hair & Fade Cut — Rp 95.000 (60 menit)
💈 Hair Tattoo Single Side — Rp 45.000
💈 Hair Tattoo Double Side — Rp 75.000
🪒 Clean Shave — Rp 65.000
💆 Hair Cream Bath — Rp 85.000
📦 Paket tersedia — hubungi kami

Mau booking? Ketik *booking* ya kak! 😊`;

const LOCATION_TEXT = `📍 *RedBox Barbershop*

🏠 Jl. Bypass, Cirebon (Kedawung)
🕐 Buka: 09.00 – 21.00 (Setiap Hari)
📞 WhatsApp: nomor ini
🌐 Website: redboxbarbershop.com

Sampai jumpa kak! ✂️`;

async function handleMessage({ from, name, text }) {
  const lower = text.toLowerCase().trim();

  // Greeting
  if (['halo', 'hai', 'hi', 'hello', 'pagi', 'siang', 'sore', 'malam', 'assalam', 'selamat'].some(k => lower.startsWith(k))) {
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam';
    await sendWA(from, `Halo ${name}! Selamat ${greet} ✂️\n\nAku asisten digital *RedBox Barbershop*. Ada yang bisa dibantu?\n\n${MENU_TEXT}`);
    return;
  }

  // Services / prices
  if (['harga', 'price', 'layanan', 'services', 'menu', 'daftar'].some(k => lower.includes(k))) {
    await sendWA(from, SERVICES_TEXT);
    return;
  }

  // Booking
  if (['booking', 'reservasi', 'jadwal', 'pesan', 'book', 'daftar'].some(k => lower.includes(k))) {
    await sendWA(from, `📅 *Booking RedBox Barbershop*\n\nKlik link berikut untuk reservasi online:\n👉 https://redboxbarbershop.com/booking.html\n\nPilih layanan, barber, tanggal & jam — langsung konfirmasi! ✅`);
    return;
  }

  // Location / hours
  if (['lokasi', 'alamat', 'jam', 'buka', 'tutup', 'maps', 'dimana', 'where'].some(k => lower.includes(k))) {
    await sendWA(from, LOCATION_TEXT);
    return;
  }

  // Promo
  if (['promo', 'diskon', 'discount', 'voucher', 'potongan'].some(k => lower.includes(k))) {
    await sendWA(from, `🎉 *Promo RedBox Barbershop*\n\nCek promo terkini di website kami:\n👉 redboxbarbershop.com\n\nAtau tanya langsung tim kami! 😊`);
    return;
  }

  // Default fallback
  await sendWA(from, `Halo ${name}! 👋\n\n${MENU_TEXT}`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', service: 'RedBox WA Webhook' });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Fonnte payload: { device, sender, name, message, id, type }
    const { sender, name, message, type } = req.body || {};

    // Only handle text
    if (type && type !== 'text') {
      return res.status(200).json({ status: 'ignored' });
    }

    if (!sender || !message) {
      return res.status(200).json({ status: 'ignored', reason: 'missing fields' });
    }

    // Process then respond (Fonnte tolerant of delay up to ~30s)
    await handleMessage({ from: sender, name: name || 'Kak', text: message });
    return res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(200).json({ status: 'error' }); // always 200 to avoid Fonnte retry storm
  }
};
