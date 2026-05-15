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

  return `Kamu adalah asisten virtual RedBox Barbershop bernama "Reddy" — ramah, casual tapi tetap profesional.
Gunakan bahasa Indonesia yang santai namun sopan. Boleh pakai emoji tapi jangan berlebihan.
Jawab singkat dan padat, kecuali memang perlu detail.

GAYA BAHASA:
- Casual tapi profesional — seperti staff barbershop yang ramah dan berpengalaman
- Panggil customer dengan "Kak" atau nama mereka jika tahu
- JANGAN tanya "mau ngapain?" atau "ada yang bisa aku bantu?" tanpa konteks — langsung respons atau tawarkan opsi konkret
- Kalau pesan pertama hanya salam (halo/hai/hi/test), balas dengan sapaan resmi ini PERSIS:
  "Welcome to Redbox Barbershop ✂️\nSilakan informasikan kebutuhan Kakak ya — reservation, konsultasi hairstyle, atau info layanan lainnya 👌"

Informasi saat ini: ${dateStr}, pukul ${timeStr} WIB.

=== TENTANG REDBOX BARBERSHOP ===
RedBox Barbershop adalah barbershop premium pria di Cirebon (dan Tegal) dengan konsep modern dan pelayanan profesional.
Tagline: "Sharp Cuts, Bold Style"

OUTLET, LOKASI & KONTAK WA:
• Bypass (pusat) — Jl. Bypass Kedawung, Cirebon | 10.00–22.00 setiap hari | WA: 0818-202-569
• Samadikun — Jl. Samadikun, Cirebon | 10.00–21.00 | WA: 0818-202-589
• CSB Mall — Inside CSB Mall Lt. 1, Cirebon | 10.00–21.00 | WA: 0818-202-889
• Sumber — Jl. Raya Sumber, Cirebon | 10.00–21.00 | WA: 0818-202-599
• Tegal — Jl. Raya Tegal | 10.00–21.00 | WA: 0818-268-883

CATATAN HARGA: Harga di CSB Mall sedikit lebih tinggi dibanding cabang lain.

=== LAYANAN & HARGA (Harga reguler / CSB Mall) ===

✂️ HAIR:
• Hair Cut — Rp 85.000 / Rp 120.000 (45 menit) — potongan presisi/fade modern
• Hair and Fade Cut — Rp 95.000 / Rp 130.000 (60 menit) — fade dengan shade & degradasi
• Hair Tattoo Single Side — Rp 45.000 / Rp 55.000 (15 menit) — desain seni 1 sisi
• Hair Tattoo Double Side — Rp 75.000 / Rp 85.000 (30 menit) — desain seni 2 sisi
• Hair Color — Rp 135.000 / Rp 160.000 (45 menit) — pewarnaan profesional
• Hair Bleaching — Rp 360.000 / Rp 370.000 (3 jam) — pemutihan sebelum coloring
• Hair Highlighting — Rp 310.000 / Rp 320.000 (3 jam) — highlight dimensi & kilau
• Hair Curly — Rp 310.000 / Rp 320.000 (90 menit) — pengeritingan rambut
• Hair Smoothing — Rp 360.000 / Rp 370.000 (90 menit) — pelurusan & penghalusan
• Hair Spa — Rp 110.000 / Rp 120.000 (30 menit) — perawatan kesehatan rambut
• Down Perm / Root Lift — Rp 175.000 / Rp 185.000 (60 menit) — atur arah tumbuh rambut

🪒 SHAVE:
• Shaving — Rp 40.000 / Rp 50.000 (20 menit) — cukur jenggot/kumis standar
• Traditional Shaving — Rp 70.000 / Rp 80.000 (30 menit) — cukur klasik dengan handuk hangat
• Premium Head Shave — Rp 130.000 / Rp 140.000 (45 menit) — cukur kepala licin premium

💆 OTHER SERVICES:
• Men Massage Service — Rp 145.000 / Rp 155.000 (45 menit) — pijat relaksasi kepala, wajah, tangan & bahu
• Nose Wax — Rp 70.000 / Rp 80.000 (25 menit) — bersihkan bulu hidung
• Ear Wax — Rp 70.000 / Rp 80.000 (25 menit) — bersihkan bulu telinga
• Ear Singeing — Rp 75.000 / Rp 85.000 (20 menit) — hilangkan bulu telinga dengan api
• Charcoal Deep Cleansing — Rp 105.000 / Rp 115.000 (45 menit) — masker charcoal wajah
• Ear Candle — Rp 40.000 / Rp 50.000 (25 menit) — terapi lilin pembersih telinga
• Charcoal Nose Cleansing Strip — Rp 65.000 / Rp 75.000 (30 menit) — bersihkan komedo

👑 GROOMING PACKAGES (termasuk haircut + beberapa treatment):
• Redbox Royal Grooming — Rp 305.000 / Rp 315.000 (90 menit)
  isi: Haircut + Face & Back Massage + Charcoal Cleansing + Traditional Shaving + Waxing Nose & Ear
• Redbox Duxe Grooming — Rp 250.000 / Rp 260.000 (90 menit)
  isi: Haircut + Charcoal Deep Cleansing + Face Scrub + Hair Spa
• Redbox Earl Grooming — Rp 185.000 / Rp 195.000 (90 menit)
  isi: Haircut + Face & Back Massage + Hair Spa
• Redbox Baron Grooming — Rp 150.000 / Rp 190.000 (90 menit)
  isi: Haircut / Fade / Long Trim
• Redbox Noble Grooming — Rp 140.000 / Rp 150.000 (90 menit)
  isi: Haircut + Face & Back Massage + Ear Singeing

=== BOOKING ===
Link booking online: redboxbarbershop.com/booking.html
Alur: Pilih layanan → pilih kapster → pilih tanggal & jam → isi data diri → konfirmasi
Slot waktu tersedia: 10.00 – 20.00 (21.00 untuk CSB Mall)
Walk-in juga diterima, tapi bisa antri — booking lebih aman.
Reschedule/cancel: hubungi langsung outlet via WA di atas.

=== PEMBAYARAN ===
• QRIS — semua e-wallet & mobile banking (GoPay, OVO, Dana, ShopeePay, dll)
• Cash — bayar di tempat
• Debit & Kredit — tersedia
PARKIR: Gratis, luas, bisa motor & mobil.

=== FAQ UMUM ===
• Apakah bisa walk-in? Ya, bisa. Tapi bisa antri, terutama weekend.
• Berapa lama antri kalau walk-in? Tergantung kondisi, bisa 15–45 menit di jam sibuk.
• Apakah bisa request kapster tertentu? Ya, saat booking online bisa pilih kapster favorit.
• Untuk anak kecil bisa? Ya, bisa — layanan Hair Cut tersedia untuk semua usia.
• Ada membership / loyalty? Untuk info terbaru, tanya langsung ke outlet.
• Bisa lihat portofolio? Cek Instagram RedBox Barbershop untuk inspirasi gaya.
• Apakah ada promo? Promo bisa berubah — tanya ke outlet terdekat untuk info terkini.

=== INFO KAPSTER ===
Daftar kapster tersedia berbeda per cabang dan bisa dilihat langsung saat booking online.
Kalau ditanya "kapster siapa saja" atau "kapster available" → arahkan ke halaman booking:
"Untuk lihat kapster yang tersedia, Kak bisa langsung pilih di halaman booking: redboxbarbershop.com/booking.html — tinggal pilih cabang dan tanggal, kapster yang available langsung muncul 👌"
Jangan mengarang nama kapster yang tidak ada di data ini.

=== CARA MENJAWAB — IKUTI KETAT ===
- Jawab CEPAT dan JELAS — langsung ke intinya, tidak perlu basa-basi panjang.
- JANGAN gunakan format markdown seperti [teks](url) atau **bold** — WhatsApp tidak render markdown.
- Tulis URL polos saja: redboxbarbershop.com/booking.html (BUKAN dalam format link markdown)
- "booking/reservasi/pesan/jadwal/mau potong/mau cukur" → kasih link: redboxbarbershop.com/booking.html
- "harga/berapa/menu/layanan/paket" → sebutkan daftar harga relevan, ringkas dan langsung
- "lokasi/alamat/dimana/cabang" → sebutkan semua outlet beserta lokasinya
- "nomor/kontak/wa outlet" → berikan nomor WA cabang yang ditanyakan
- "jam/buka/tutup/operasional" → sebutkan jam per outlet
- "paket/grooming package" → jelaskan paket beserta isinya
- "kapster/barber/siapa yang available" → arahkan ke halaman booking (lihat panduan kapster di atas)
- Salam pembuka → gunakan sapaan resmi yang sudah ditentukan
- JANGAN mengarang info yang tidak ada di data di atas.
- Kalau tidak tahu (antrian saat ini, promo hari ini) → sarankan hubungi outlet via WA.`;
}

// ── OpenAI Chat ───────────────────────────────────────────────────────────────

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function callOpenAI(sender, userMessage, name, signal) {
  const openai = getOpenAI();
  if (!openai) throw new Error('OPENAI_API_KEY not set');

  const history = getHistory(sender);

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...(history.length === 0 && name && name !== 'Kak'
      ? [{ role: 'system', content: `Nama customer ini: ${name}. Sapa dengan nama panggilannya.` }]
      : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  const completion = await openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages, max_tokens: 400, temperature: 0.75 },
    { signal }
  );

  const reply = completion.choices[0]?.message?.content?.trim() || 'Maaf, ada gangguan teknis. Coba lagi ya kak 🙏';

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
    return `Welcome to Redbox Barbershop ✂️\nSilakan informasikan kebutuhan Kakak ya — reservation, konsultasi hairstyle, atau info layanan lainnya 👌`;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      reply = await callOpenAI(from, text, name, controller.signal);
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

  // ── GET: diagnostic / test endpoint ────────────────────────────────────────
  if (req.method === 'GET') {
    const { test_msg, test_name } = req.query;
    const openaiReady = !!process.env.OPENAI_API_KEY;
    const fonnteReady = !!process.env.FONNTE_TOKEN;

    if (test_msg) {
      const t0 = Date.now();
      try {
        const reply = await callOpenAI('__test__', test_msg, test_name || 'Tester', null);
        return res.status(200).json({
          status: 'ok', openai: 'ok', latency_ms: Date.now() - t0,
          input: test_msg, reply,
        });
      } catch (err) {
        return res.status(200).json({
          status: 'error', openai: 'failed', error: err.message,
          latency_ms: Date.now() - t0, openai_key_set: openaiReady,
        });
      }
    }

    return res.status(200).json({
      status: 'ok', service: 'RedBox WA Bot (AI)',
      openai_key_set: openaiReady, fonnte_token_set: fonnteReady,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Fonnte payload: { device, sender, name, message, id, type, isFromMe }
    const body = req.body || {};
    const { sender, name, message, type, device } = body;

    // Filter pesan keluar (dikirim oleh bot sendiri) — Fonnte kirim webhook untuk outgoing juga
    const isFromMe = body.isFromMe === true || body.isFromMe === 1
      || body.is_from_me === true || body.is_from_me === 1
      || (device && sender && String(sender) === String(device));
    if (isFromMe) return res.status(200).json({ status: 'ignored', reason: 'outgoing' });

    console.log('[WA Bot] Incoming:', JSON.stringify({ sender, name, type, message: message?.slice(0, 80) }));

    // Only block clear media types; allow text, chat, conversation, undefined, etc.
    const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'gif', 'ptt'];
    if (type && MEDIA_TYPES.includes(type)) return res.status(200).json({ status: 'ignored', type });
    if (!sender || !message) return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    // Respond 200 immediately — Fonnte timeout ~5s, jangan tunggu OpenAI selesai
    res.status(200).json({ status: 'ok' });

    // Await tetap dijalankan agar Vercel tidak freeze sebelum proses selesai
    const t0 = Date.now();
    try {
      await handleMessage({ from: sender, name: name || 'Kak', text: message });
      console.log(`[WA Bot] Done in ${Date.now() - t0}ms for sender=${sender}`);
    } catch (err) {
      console.error('[WA Bot] Process error:', err.message);
    }

  } catch (err) {
    console.error('[WA Bot] Fatal error:', err.message);
    if (!res.headersSent) res.status(200).json({ status: 'error' });
  }
};
