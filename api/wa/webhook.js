/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook — RedBox Barbershop AI Assistant
 * Powered by OpenAI gpt-4o-mini with per-user conversation memory.
 */

const { sendWA } = require('../../server/services/fonnte');
const OpenAI = require('openai');

// ── Conversation Memory ───────────────────────────────────────────────────────
// In-memory cache keyed by sender number. Persists across warm invocations.
// Resets on cold start — acceptable for a barbershop bot.
const conversationCache = new Map(); // sender → [{role, content}]
const MAX_HISTORY = 12; // max messages kept per user (6 exchanges)
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min inactivity clears context
const cacheTimestamps = new Map(); // sender → last activity timestamp

function getHistory(sender) {
  // Auto-expire inactive conversations
  const lastActive = cacheTimestamps.get(sender) || 0;
  if (Date.now() - lastActive > CACHE_TTL_MS) {
    conversationCache.delete(sender);
    cacheTimestamps.delete(sender);
  }
  return conversationCache.get(sender) || [];
}

function pushHistory(sender, role, content) {
  const hist = getHistory(sender);
  hist.push({ role, content });
  // Trim to keep last MAX_HISTORY messages
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  conversationCache.set(sender, hist);
  cacheTimestamps.set(sender, Date.now());
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  const dateStr = wib.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = wib.toTimeString().slice(0, 5);

  return `Kamu adalah asisten virtual RedBox Barbershop bernama "Reddy" — ramah, santai, natural, dan helpful.
Gunakan bahasa Indonesia casual sehari-hari. Boleh pakai emoji tapi jangan berlebihan.
Jangan terlalu formal. Jawab singkat dan padat, kecuali memang perlu detail.

Informasi saat ini: ${dateStr}, pukul ${timeStr} WIB.

=== TENTANG REDBOX BARBERSHOP ===
RedBox Barbershop adalah barbershop premium di Cirebon dengan beberapa cabang.

OUTLET & LOKASI:
• Bypass (pusat) — Jl. Bypass Kedawung, Cirebon | 10.00–22.00 setiap hari
• Samadikun — Jl. Samadikun, Cirebon | 10.00–21.00
• CSB Mall — Inside CSB Mall, Cirebon | 10.00–21.00
• Sumber — Jl. Raya Sumber, Cirebon | 10.00–21.00
• Tegal — Jl. Raya Tegal | 10.00–21.00

LAYANAN & HARGA:
• Haircut — Rp 75.000 (~30 menit)
• Haircut + Wash — Rp 95.000 (~45 menit)
• Two Block — Rp 85.000 (~40 menit) ← paling populer
• Fade Cut — Rp 90.000 (~40 menit)
• Hairspa — Rp 120.000 (~60 menit)
• Coloring — mulai Rp 200.000 (~90 menit)
• Beard Trim — Rp 45.000 (~20 menit)
• Combo (Haircut + Beard) — Rp 110.000 (~50 menit)

BOOKING:
Link booking online: redboxbarbershop.com/booking.html
Pilih layanan → pilih barber → pilih slot waktu → konfirmasi otomatis.
Walk-in juga boleh tapi bisa antri.

PEMBAYARAN: Cash, QRIS (semua e-wallet), Debit, Kredit.
PARKIR: Gratis, luas, bisa motor dan mobil.

=== PANDUAN MENJAWAB ===
- Kalau ditanya soal booking, berikan link dan jelaskan caranya singkat.
- Kalau ditanya lokasi/cabang tertentu, sebutkan yang paling relevan.
- Kalau customer komplain atau ada masalah, minta maaf dulu lalu tawarkan solusi.
- Kalau pertanyaan di luar topik barbershop, tetap bantu semampu mungkin tapi fokuskan ke layanan RedBox.
- Kalau customer minta ngobrol dengan admin/CS manusia, beritahu bahwa kamu akan sampaikan ke tim dan minta mereka tunggu.
- JANGAN mengarang informasi yang tidak ada di atas (misal promo yang tidak disebutkan).
- Kalau tidak yakin dengan info tertentu (misal stok, barber tertentu), sarankan untuk langsung kontak outlet atau cek website.`;
}

// ── OpenAI Chat ───────────────────────────────────────────────────────────────

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function callOpenAI(sender, userMessage, name) {
  const openai = getOpenAI();
  if (!openai) throw new Error('OPENAI_API_KEY not set');

  const history = getHistory(sender);

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    // Inject customer name as context if first message
    ...(history.length === 0 && name && name !== 'Kak'
      ? [{ role: 'system', content: `Nama customer ini: ${name}. Sapa dengan nama panggilannya.` }]
      : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 400,
    temperature: 0.75,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || 'Maaf, ada gangguan teknis. Coba lagi ya kak 🙏';

  // Save to history
  pushHistory(sender, 'user', userMessage);
  pushHistory(sender, 'assistant', reply);

  return reply;
}

// ── Fallback (keyword-based) ──────────────────────────────────────────────────
// Used only when OpenAI is unavailable or times out.

function fallbackReply(text, name) {
  const t = text.toLowerCase();
  const fn = (name || 'Kak').split(' ')[0];
  const has = (kws) => kws.some(k => t.includes(k));

  if (has(['halo','hai','hi ','hello','hei','hey','pagi','siang','sore','malam','selamat']))
    return `Haii kak ${fn}! 👋 Ada yang bisa aku bantu?\n\nMau booking, nanya harga, atau info lokasi? 😊`;
  if (has(['harga','berapa','layanan','menu','paket','price']))
    return `Ini layanan RedBox kak 💈\n\n✂️ Haircut — 75rb\n✂️ Haircut+Wash — 95rb\n🔥 Two Block — 85rb\n⚡ Fade Cut — 90rb\n💆 Hairspa — 120rb\n🎨 Coloring — mulai 200rb\n🧔 Beard Trim — 45rb\n💥 Combo — 110rb\n\nMau booking? 😄`;
  if (has(['booking','reservasi','jadwal','pesan']))
    return `Booking online di sini ya kak 📅\n👉 *redboxbarbershop.com/booking.html*\n\nPilih layanan → barber → slot waktu. Mudah banget!`;
  if (has(['lokasi','alamat','dimana','maps']))
    return `Ada beberapa cabang kak 📍\n• Bypass (pusat) — Jl. Bypass Kedawung\n• Samadikun, CSB Mall, Sumber, Tegal\n\nBuka 10.00–22.00 setiap hari 😊`;
  if (has(['makasih','terima kasih','thanks','thx']))
    return `Sama-sama kak ${fn}! Kalau ada yang lain jangan ragu tanya ya 😊✂️`;

  return `Maaf kak ${fn}, aku lagi gangguan sedikit 😅 Coba tanya lagi ya, atau kunjungi *redboxbarbershop.com* untuk info lengkap!`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function handleMessage({ from, name, text }) {
  let reply;

  try {
    // Try OpenAI first (with 8 second timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      reply = await callOpenAI(from, text, name);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn('[WA Bot] OpenAI error, using fallback:', err.message);
    reply = fallbackReply(text, name);
  }

  return sendWA(from, reply);
}

// ── Webhook Entry ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')     return res.status(200).json({ status: 'ok', service: 'RedBox WA Bot (AI)' });
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    // Fonnte payload: { device, sender, name, message, id, type }
    const { sender, name, message, type } = req.body || {};

    if (type && type !== 'text') return res.status(200).json({ status: 'ignored' });
    if (!sender || !message)     return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    await handleMessage({ from: sender, name: name || 'Kak', text: message });
    return res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WA Bot] Fatal error:', err.message);
    if (!res.headersSent) res.status(200).json({ status: 'error' });
  }
};
