/**
 * Vercel Serverless — GET+POST /api/wa/webhook-meta
 * WhatsApp Cloud API (Meta) webhook — RedBox Barbershop AI Assistant
 */

const OpenAI = require('openai');

// ── Conversation Memory ───────────────────────────────────────────────────────
const conversationCache = new Map();
const cacheTimestamps   = new Map();
const MAX_HISTORY    = 12;
const CACHE_TTL_MS   = 30 * 60 * 1000;

function getHistory(sender) {
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
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  conversationCache.set(sender, hist);
  cacheTimestamps.set(sender, Date.now());
}

// ── System Prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
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

=== CARA MENJAWAB — IKUTI KETAT ===
- Langsung jawab pertanyaannya. JANGAN balas pertanyaan dengan pertanyaan balik dulu.
- Kalau ada kata "booking", "reservasi", "pesan", "jadwal", "mau potong", "mau cukur" → LANGSUNG kasih link booking: redboxbarbershop.com/booking.html
- Kalau ada kata "harga", "berapa", "menu", "layanan" → LANGSUNG sebutkan daftar harga.
- Kalau ada kata "lokasi", "alamat", "dimana" → LANGSUNG sebutkan lokasi outlet.
- Kalau ada kata "jam", "buka", "tutup" → LANGSUNG sebutkan jam operasional.
- JANGAN mengarang informasi yang tidak ada di data di atas.`;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
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
    ...(history.length === 0 && name
      ? [{ role: 'system', content: `Nama customer ini: ${name}.` }]
      : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const completion = await openai.chat.completions.create(
      { model: 'gpt-4o-mini', messages, max_tokens: 400, temperature: 0.75 },
      { signal: controller.signal }
    );
    const reply = completion.choices[0]?.message?.content?.trim() || 'Maaf, ada gangguan teknis 🙏';
    pushHistory(sender, 'user', userMessage);
    pushHistory(sender, 'assistant', reply);
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Send WhatsApp via Meta Cloud API ──────────────────────────────────────────
async function sendMetaWA(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) throw new Error('WHATSAPP_PHONE_ID or WHATSAPP_TOKEN not set');

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta send failed: ${res.status} ${err}`);
  }
  return res.json();
}

// ── Webhook Handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // ── GET: Meta webhook verification ─────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('[Meta WA] Webhook verified ✓');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden — verify token mismatch' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;

    // Only process whatsapp_business_account events
    if (body?.object !== 'whatsapp_business_account') {
      return res.status(200).json({ status: 'ignored' });
    }

    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];

    if (!message) return res.status(200).json({ status: 'no_message' });

    // Only handle text messages
    if (message.type !== 'text') return res.status(200).json({ status: 'ignored', type: message.type });

    const from = message.from;
    const text = message.text?.body;
    const name = value?.contacts?.[0]?.profile?.name || 'Kak';

    if (!from || !text) return res.status(200).json({ status: 'ignored' });

    console.log(`[Meta WA] From: ${from} | Name: ${name} | Msg: ${text.slice(0, 80)}`);

    // Must respond 200 immediately, then process async
    res.status(200).json({ status: 'ok' });

    // Process AI and send reply
    try {
      const reply = await callOpenAI(from, text, name);
      await sendMetaWA(from, reply);
      console.log(`[Meta WA] Replied to ${from}`);
    } catch (err) {
      console.error('[Meta WA] Process error:', err.message);
    }

  } catch (err) {
    console.error('[Meta WA] Fatal:', err.message);
    if (!res.headersSent) res.status(200).json({ status: 'error' });
  }
};
