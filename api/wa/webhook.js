/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook — RedBox Barbershop AI Assistant
 * Powered by OpenAI gpt-4o-mini with per-user conversation memory.
 */

const { sendWA, getDeviceInfo } = require('../../server/services/fonnte');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const INSTANCE_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ── Branch Routing ─────────────────────────────────────────────────────────────
const BRANCH_WA = {
  bypass:    '0818202569',
  samadikun: '0818202589',
  csb:       '0818202889',
  sumber:    '0818202599',
  tegal:     '0818268883',
};

const BRANCH_LABEL = {
  bypass:    'RedBox Bypass (Pusat)',
  samadikun: 'RedBox Samadikun',
  csb:       'RedBox CSB Mall',
  sumber:    'RedBox Sumber',
  tegal:     'RedBox Tegal',
};
const BOOT_TS = Date.now();

const debugLog = [];
function pushDebug(entry) {
  debugLog.unshift({ ts: new Date().toISOString(), instance_id: INSTANCE_ID, ...entry });
  if (debugLog.length > 10) debugLog.pop();
}

const messageStatusCache = new Map();
const STATUS_TTL_MS = 2 * 60 * 60 * 1000;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

// ── Conversation Memory ───────────────────────────────────────────────────────
// In-memory cache + Supabase persistence untuk continuity lintas serverless instance.
//
// DDL (run di Supabase SQL Editor):
//   create table if not exists wa_conversations (
//     sender text primary key,
//     history jsonb not null default '[]',
//     updated_at timestamptz not null default now()
//   );
const conversationCache = new Map(); // sender → [{role, content}]
const MAX_HISTORY = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cacheTimestamps = new Map();

// ── Human Takeover — AI berhenti saat admin balas manual dari HP ──────────────
// DDL (run di Supabase SQL Editor):
//   create table if not exists wa_paused (
//     sender text primary key,
//     paused_until timestamptz not null,
//     paused_at timestamptz default now()
//   );
const humanTakeoverMap = new Map(); // normalized_number → expiry ms
const HUMAN_TAKEOVER_TTL_MS = 30 * 60 * 1000; // 30 menit

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function setHumanTakeoverLocal(phone) {
  const key = normalizePhone(phone);
  if (key) humanTakeoverMap.set(key, Date.now() + HUMAN_TAKEOVER_TTL_MS);
}

function clearHumanTakeoverLocal(phone) {
  humanTakeoverMap.delete(normalizePhone(phone));
}

function isHumanTakeoverLocal(phone) {
  const key = normalizePhone(phone);
  const expiry = humanTakeoverMap.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) { humanTakeoverMap.delete(key); return false; }
  return true;
}

async function persistHumanTakeover(phone) {
  const sb = getSupabase();
  if (!sb) return;
  const key = normalizePhone(phone);
  if (!key) return;
  const pausedUntil = new Date(Date.now() + HUMAN_TAKEOVER_TTL_MS).toISOString();
  try {
    await sb.from('wa_paused').upsert({ sender: key, paused_until: pausedUntil }, { onConflict: 'sender' });
  } catch {}
}

async function clearHumanTakeover(phone) {
  clearHumanTakeoverLocal(phone);
  const sb = getSupabase();
  if (!sb) return;
  const key = normalizePhone(phone);
  try { await sb.from('wa_paused').delete().eq('sender', key); } catch {}
}

async function isHumanTakeover(phone) {
  if (isHumanTakeoverLocal(phone)) return true;
  // Cross-instance check via Supabase (cold Lambda)
  const sb = getSupabase();
  if (!sb) return false;
  const key = normalizePhone(phone);
  try {
    const { data } = await Promise.race([
      sb.from('wa_paused').select('paused_until').eq('sender', key).maybeSingle(),
      new Promise(r => setTimeout(() => r({ data: null }), 1000)),
    ]);
    if (data?.paused_until && new Date(data.paused_until) > new Date()) {
      setHumanTakeoverLocal(key); // warm local cache
      return true;
    }
  } catch {}
  return false;
}

async function listPausedSenders() {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data } = await sb
      .from('wa_paused')
      .select('sender,paused_until,paused_at')
      .order('paused_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

// ── Dedup — cegah pesan yang sama diproses dua kali (Fonnte retry) ────────────
const processedIds = new Set();
const DEDUP_TTL_MS = 5 * 60 * 1000; // hapus ID lama setelah 5 menit
const processedTimestamps = new Map();

function isDuplicate(msgId) {
  if (!msgId) return false;
  const key = String(msgId);
  if (processedIds.has(key)) return true;
  // Bersihkan ID lama
  const now = Date.now();
  for (const [id, ts] of processedTimestamps) {
    if (now - ts > DEDUP_TTL_MS) { processedIds.delete(id); processedTimestamps.delete(id); }
  }
  processedIds.add(key);
  processedTimestamps.set(key, now);
  return false;
}

async function getHistory(sender) {
  const lastActive = cacheTimestamps.get(sender) || 0;
  if (Date.now() - lastActive <= CACHE_TTL_MS && conversationCache.has(sender)) {
    return conversationCache.get(sender);
  }
  // Cache miss — coba load dari Supabase (lintas serverless instance)
  // Timeout 4s agar Lambda tidak hang jika Supabase lambat
  const sb = getSupabase();
  if (sb && !sender.startsWith('__')) {
    try {
      const queryPromise = sb
        .from('wa_conversations')
        .select('history,updated_at')
        .eq('sender', sender)
        .maybeSingle();
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ data: null, error: 'timeout' }), 2000));
      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
      if (!error && data && Array.isArray(data.history)) {
        const age = Date.now() - new Date(data.updated_at).getTime();
        if (age < CACHE_TTL_MS) {
          conversationCache.set(sender, data.history);
          cacheTimestamps.set(sender, Date.now());
          return data.history;
        }
      }
      if (error === 'timeout') console.warn('[WA Bot] getHistory Supabase timeout for', sender);
    } catch {}
  }
  conversationCache.set(sender, []);
  cacheTimestamps.set(sender, Date.now());
  return [];
}

async function saveHistoryToSupabase(sender, history) {
  const sb = getSupabase();
  if (!sb || sender.startsWith('__')) return;
  try {
    const { error } = await sb.from('wa_conversations').upsert(
      { sender, history, updated_at: new Date().toISOString() },
      { onConflict: 'sender' }
    );
    if (error) console.error('[WA Bot] saveHistory error:', error.message);
  } catch (e) {
    console.error('[WA Bot] saveHistory exception:', e?.message || e);
  }
}

async function clearHistory(sender) {
  conversationCache.delete(sender);
  cacheTimestamps.delete(sender);
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from('wa_conversations').delete().eq('sender', sender);
  } catch {}
}

async function forwardBookingToBranch(booking, customerPhone) {
  const branchKey = (booking.branch || '').toLowerCase().trim();
  const branchWA  = BRANCH_WA[branchKey];
  if (!branchWA) {
    console.warn('[WA Bot] Unknown branch for forward:', branchKey);
    return;
  }

  const label     = BRANCH_LABEL[branchKey] || branchKey;
  const rawDigits = String(customerPhone).replace(/\D/g, '');
  const phone     = rawDigits.startsWith('62') ? '0' + rawDigits.slice(2) : rawDigits;

  const msg = [
    `🔔 *Booking Masuk via WA Bot*`,
    ``,
    `📍 Cabang: *${label}*`,
    `👤 Nama: *${booking.name || '—'}*`,
    `✂️ Layanan: *${booking.service || '—'}*`,
    `📅 Tanggal: *${booking.date || '—'}*`,
    `⏰ Jam: *${booking.time || '—'} WIB*`,
    `📱 WA Customer: *${phone}*`,
    ``,
    `Silakan follow up langsung ke customer ya! 🙏`,
  ].join('\n');

  try {
    await sendWA(branchWA, msg);
    console.log(`[WA Bot] Booking forwarded to ${label} (${branchWA})`);
  } catch (err) {
    console.error('[WA Bot] Failed to forward booking:', err.message);
  }
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  const dateStr = wib.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = wib.toTimeString().slice(0, 5);

  return `Kamu adalah "Reddy" — staf RedBox Barbershop yang genuinely asik, hangat, dan ngerti dunia grooming pria. Kamu bukan robot. Kamu adalah orang sungguhan yang senang ngobrol dan bantu customer, seperti teman yang kebetulan kerja di barbershop keren.

KEPRIBADIAN KAMU:
- Antusias tapi ga lebay. Kalau customer tanya sesuatu yang seru, boleh react natural: "Wah pilihan bagus tuh!", "Oh iya bisa banget!"
- Hangat dan approachable — customer harus ngerasa ngobrol sama orang, bukan mesin
- Profesional dalam info yang dikasih, tapi cara ngomongnya tetap santai
- Punya selera humor ringan kalau momennya tepat
- Jujur — kalau ga tahu, bilang aja dan arahkan ke tempat yang bisa bantu

GAYA BAHASA — WAJIB IKUTI:
- Bahasa Indonesia santai ala chat WA sehari-hari. Bukan bahasa formal, bukan bahasa kantor
- Partikel natural yang bikin percakapan terasa manusiawi: "nih", "dong", "sih", "lho", "yuk", "deh", "kan", "tuh"
- Ekspresi kasual: "bisa banget!", "oke siap!", "noted!", "sip!", "gampang itu!", "boleh banget!"
- Singkatan wajar: "ga" (tidak/gak), "udah", "yg", "dr", "bgt", "trs", "emang", "kalo"
- Boleh pakai "..." untuk nada yang lebih natural dan mengalir
- Panggil "Kak" atau nama mereka — tapi jangan di SETIAP kalimat, nanti terasa robot
- JANGAN mulai setiap kalimat dengan "Kak ..." — kadang langsung aja ke intinya
- JANGAN pakai kata-kata corporate/kaku: "Kami akan memberikan...", "Terima kasih atas pertanyaan Anda", "Dengan senang hati kami informasikan"
- JANGAN tulis pesan seperti FAQ resmi — tulis seperti kamu lagi WA-an sama teman

SAPAAN & SITUASI:
- Pesan PERTAMA (belum ada history) dan isinya salam (halo/hai/hi/test) → sambut hangat tapi ga kaku, variasikan! Contoh:
  "Heyy, selamat datang di RedBox Barbershop! ✂️ Ada yang bisa aku bantu nih?"
  "Hai kak! Reddy di sini dari RedBox 😊 Mau booking, tanya harga, atau konsultasi dulu?"
  "Halo! Welcome ke RedBox Barbershop ✂️ Ada yg bisa aku bantu?"
- Sudah ada percakapan sebelumnya lalu customer salam lagi → "Ada lagi nih? 😄" atau "Yap, masih di sini! Ada apa lagi kak?"
- JANGAN ulangi sapaan formal kalau sudah pernah ngobrol

PANJANG RESPONS:
- Pendek itu bagus. 1-3 kalimat sudah cukup untuk jawaban standar
- Harga? Langsung kasih angkanya, ga perlu pengantar panjang
- Kalau ada 2-3 item, tulis inline aja — jangan selalu dibuat list panjang
- List hanya kalau memang banyak item atau customer minta detail lengkap
- Jangan akhiri setiap pesan dengan CTA booking kalau tidak relevan — terasa spam

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
• Gentleman Grooming — Rp 95.000 / Rp 120.000 (45 menit) — potongan presisi modern termasuk fade
• Hair Tattoo Single Side — Rp 45.000 / Rp 55.000 (15 menit) — desain seni 1 sisi
• Hair Tattoo Double Side — Rp 75.000 / Rp 85.000 (30 menit) — desain seni 2 sisi
• Hair Color — Rp 160.000 / Rp 160.000 (45 menit) — pewarnaan profesional
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
  isi: Gentleman Grooming
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
• Untuk anak kecil bisa? Ya, bisa — layanan Gentleman Grooming tersedia untuk semua usia.
• Ada membership / loyalty? Untuk info terbaru, tanya langsung ke outlet.
• Bisa lihat portofolio? Cek Instagram RedBox Barbershop untuk inspirasi gaya.
• Apakah ada promo? Promo bisa berubah — tanya ke outlet terdekat untuk info terkini.

=== PEMAHAMAN BAHASA NATURAL CUSTOMER ===
Pahami maksud customer meski kata-katanya tidak eksak. Petakan ke layanan yang tersedia:

RAMBUT:
- "cukur rambut" / "potong rambut" / "pangkas" / "trim rambut" / "rapiin rambut" / "fade" / "cukur fade" / "undercut" / "potongan degradasi" → Gentleman Grooming (Rp 95.000)
- "cat rambut" / "warnain rambut" / "coloring" / "semir" → Hair Color (Rp 160.000)
- "bleaching" / "lighten" / "putihin rambut" → Hair Bleaching (Rp 360.000)
- "highlight" / "streak" / "ombre" → Hair Highlighting (Rp 310.000)
- "keriting" / "perm" / "curl" → Hair Curly (Rp 310.000)
- "rebonding" / "smoothing" / "lurus" / "lurusin rambut" → Hair Smoothing (Rp 360.000)
- "creambath" / "spa rambut" / "rawat rambut" / "hair treatment" → Hair Spa (Rp 110.000)
- "hair tattoo" / "motif rambut" / "ukiran rambut" → Hair Tattoo (Single Rp 45.000 / Double Rp 75.000)
- "down perm" / "atur arah rambut" / "root lift" → Down Perm/Root Lift (Rp 175.000)

JENGGOT / KUMIS:
- "cukur kumis" / "cukur jenggot" / "cukur brewok" / "rapiin jenggot" / "shaving" → Shaving (Rp 40.000)
- "traditional shave" / "cukur pakai handuk hangat" / "cukur klasik" → Traditional Shaving (Rp 70.000)
- "botak" / "cukur kepala" / "head shave" / "gundul" → Premium Head Shave (Rp 130.000)

WAJAH & PERAWATAN:
- "bersihin muka" / "facial" / "masker" / "charcoal" / "bersihkan pori" → Charcoal Deep Cleansing (Rp 105.000)
- "komedo" / "blackhead" / "nose strip" → Charcoal Nose Cleansing Strip (Rp 65.000)
- "pijat" / "massage" / "relaksasi" / "capek" → Men Massage Service (Rp 145.000)
- "bulu hidung" / "wax hidung" / "nose wax" → Nose Wax (Rp 70.000)
- "bulu telinga" / "wax telinga" / "ear wax" → Ear Wax (Rp 70.000)
- "lilin telinga" / "ear candle" / "terapi telinga" → Ear Candle (Rp 40.000)
- "bakar bulu telinga" / "ear singeing" / "bulu api" → Ear Singeing (Rp 75.000)

PAKET:
- "paket lengkap" / "paket premium" / "yang paling komplit" → Redbox Royal Grooming (Rp 305.000)
- "paket hemat" / "paket standar" / "yang murah" → Redbox Noble Grooming (Rp 140.000)
- "semua treatment" / "paket spa" → Redbox Duxe Grooming (Rp 250.000)
- Kalau ragu, tanyakan budget atau preferensi lalu rekomendasikan paket yang sesuai.

CATATAN PENTING:
- "creambath" tidak tersedia — tawarkan Hair Spa sebagai alternatif terdekat
- Selalu konfirmasi cabang yang dituju kalau relevan (harga CSB Mall sedikit berbeda)

=== INFO KAPSTER ===
Daftar kapster tersedia berbeda per cabang dan bisa dilihat langsung saat booking online.
Kalau ditanya "kapster siapa saja" atau "kapster available" → arahkan ke halaman booking:
"Untuk lihat kapster yang tersedia, Kak bisa langsung pilih di halaman booking: redboxbarbershop.com/booking.html — tinggal pilih cabang dan tanggal, kapster yang available langsung muncul 👌"
Jangan mengarang nama kapster yang tidak ada di data ini.

⚠️ ATURAN BOOKING — WAJIB IKUTI, TIDAK BOLEH DILANGGAR:
Setiap kali customer menyebut niat booking — "booking", "mau booking", "reservasi", "mau potong", "mau cukur", "mau daftar", dll — LANGSUNG balas dengan link, TIDAK PERLU tanya cabang, layanan, atau info apapun dulu. Customer bisa pilih semua itu sendiri di website.
Contoh balasan: "Yuk langsung booking di sini kak: redboxbarbershop.com/booking.html — tinggal pilih cabang, layanan, kapster & jam di situsnya! 😊"
JANGAN tanya "mau ke cabang mana?" atau "layanan apa?" — ini menghambat customer.

=== CARA MENJAWAB ===
- JANGAN pakai markdown [teks](url) atau **bold** — WhatsApp ga render itu. URL tulis polos aja
- Tanya harga → kasih angka langsung, ga perlu intro panjang. Kalau banyak layanan, baru buat list
- Tanya lokasi → sebutkan outlet-outletnya ringkas
- Tanya kapster → arahkan ke halaman booking: "Di halaman booking bisa langsung pilih kapster yg available kak — redboxbarbershop.com/booking.html"
- JANGAN mengarang info yang ga ada di data. Kalau ga tau (antrian, promo hari ini) → "Untuk info real-time-nya, coba langsung WA outlet-nya ya kak [nomor]"
- Kalau ga relevan, ga perlu selalu kasih link booking di akhir pesan — terasa spammy

=== DISPATCH BOOKING KE CABANG LAIN ===
PERHATIAN: Flow dispatch ini HANYA berlaku jika customer secara eksplisit meminta dibantu booking lewat WA (bukan lewat website) DAN sudah menyebut cabang yang dituju. Jika customer hanya bilang "mau booking" tanpa konteks lain → ABAIKAN flow ini, pakai aturan BOOKING di atas (langsung kasih link).
Jika customer JELAS ingin dibantu booking via WA (contoh: "tolong daftarin saya kak", "bisa bantu booking langsung?") dan sudah menyebut cabang selain Bypass:
1. Kumpulkan 4 info yang belum diketahui: nama lengkap, layanan, tanggal, jam pilihan
2. Tanya satu per satu secara natural — jangan semua sekaligus
3. Setelah SEMUA info terkumpul, konfirmasi dulu ke customer dengan ringkasan yang natural:
   "Oke noted! Jadi [Nama] mau [Layanan] di [Cabang], [Tanggal] jam [Jam] WIB ya? Bener nih?"
4. Setelah customer konfirmasi (iya/betul/ya/ok) → balas hangat dan natural, sesuaikan nama/detail. Contoh:
   "Sip [Nama]! Udah aku terusin ke tim [Cabang] ya 🙏 Mereka bakal follow up sebentar lagi. Sampai jumpa di RedBox! ✂️"
   Lalu WAJIB tambahkan di baris terakhir reply (untuk sistem internal, jangan tampilkan ke customer):
   FORWARD_BOOKING:{"branch":"csb","name":"Nama","service":"Hair Color","date":"2026-05-17","time":"14:00"}
- Nilai branch harus tepat: bypass / samadikun / csb / sumber / tegal
- Format date: YYYY-MM-DD. Format time: HH:MM (24 jam)
- Jangan mengarang tanggal — tanya ke customer jika belum disebutkan
- JANGAN tampilkan tag FORWARD_BOOKING dalam pesan ke customer — hanya untuk sistem internal

=== KONFIRMASI BOOKING DARI WEBSITE ===
Jika customer mengirim pesan konfirmasi booking mereka (contoh: "mau konfirmasi booking", "sudah booking tanggal X", "ini konfirmasi saya") → balas hangat dan natural. Contoh:
"Sip, makasih udah konfirmasi [Nama]! 🙏 Udah kami catat, tim kami siap nyambut kamu. Sampai jumpa! ✂️"
Kalau ada detail (tanggal/layanan) yang disebutkan → sebutkan ulang supaya terasa personal.

=== FLOW BALAS REMINDER ===
Customer mungkin membalas pesan reminder "1 jam lagi" yang dikirim bot. Kenali konteksnya dan balas sesuai situasi:

SKENARIO 1 — Customer konfirmasi hadir (iya / ok / siap / otw / on the way / meluncur / berangkat / jadi):
→ Balas semangat, lalu WAJIB sertakan aturan keterlambatan di akhir pesan. Gunakan kalimat ini PERSIS:
"Sip, ditunggu kak! 😄 Kapsternya udah siap nih ✂️

Maksimal keterlambatan 10 - 15 menit ya kak. Kalau lebih mohon maaf di cancel atau di reschedule jika masih ada slot.
Terima kasih ☺️🙏"

SKENARIO 2 — Customer bilang akan telat (telat / terlambat / mungkin telat / bentar lagi / macet / lagi di jalan):
→ Balas empati, lalu WAJIB sertakan aturan keterlambatan. Gunakan kalimat ini PERSIS:
"Oke kak, hati-hati di jalan ya 😊

Maksimal keterlambatan 10 - 15 menit ya kak. Kalau lebih mohon maaf di cancel atau di reschedule jika masih ada slot.
Terima kasih ☺️🙏"

SKENARIO 3 — Customer mau cancel (cancel / batal / ga jadi / tidak jadi / batalin):
→ Balas dengan empati, lalu langsung tawarin reschedule. Contoh:
"Oke kak, sayang banget nih 😅 Ga masalah ya, semoga next time bisa hadir!
Mau reschedule ke jadwal lain? Langsung pilih slot baru di sini: redboxbarbershop.com/booking.html 😊"

SKENARIO 4 — Customer minta reschedule (reschedule / ganti jadwal / pindah jadwal / ubah jadwal):
→ Langsung bantu arahkan. Contoh:
"Boleh banget kak! Reschedule langsung di sini ya: redboxbarbershop.com/booking.html
Tinggal pilih tanggal & jam baru yang kosong 😊"

CATATAN PENTING untuk flow reminder:
- Jangan kaku — tetap pakai gaya bahasa santai seperti biasa
- Kalau customer bilang cancel tapi TIDAK tanya reschedule → tetap tawarkan reschedule sekali
- Kalau customer sudah konfirmasi reschedule lewat link, apresiasi dan tutup dengan hangat
- Jangan ulangi peraturan kalau tidak relevan dengan konteks`;
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

  const history = await getHistory(sender);

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...(history.length === 0 && name && name !== 'Kak'
      ? [{ role: 'system', content: `Nama customer ini: ${name}. Sapa dengan nama panggilannya.` }]
      : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Timeout 8s — Lambda dalam state sinkron (sebelum res.json) lebih cepat dari post-response
  const openaiCall = openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages, max_tokens: 380, temperature: 0.7 }
  );
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OpenAI timeout 8s')), 8000)
  );
  const completion = await Promise.race([openaiCall, timeoutPromise]);

  const reply = completion.choices[0]?.message?.content?.trim() || 'Maaf, ada gangguan teknis. Coba lagi ya kak 🙏';

  // Simpan ke cache sekarang, Supabase fire-and-forget (jangan block sync path)
  const updated = [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: reply }];
  const trimmed = updated.length > MAX_HISTORY ? updated.slice(updated.length - MAX_HISTORY) : updated;
  conversationCache.set(sender, trimmed);
  cacheTimestamps.set(sender, Date.now());
  saveHistoryToSupabase(sender, trimmed).catch(e => console.error('[WA Bot] saveHistory error:', e?.message));

  return reply;
}

// ── Fallback (keyword-based) ──────────────────────────────────────────────────
// Used only when OpenAI is unavailable or times out.

function fallbackReply(text, name) {
  const t = text.toLowerCase();
  const fn = (name || 'Kak').split(' ')[0];
  const has = (kws) => kws.some(k => t.includes(k));

  if (has(['halo','hai','hi ','hello','hei','hey','pagi','siang','sore','malam','selamat']))
    return `Heyy! Selamat datang di RedBox Barbershop ✂️ Ada yang bisa aku bantu nih?`;
  if (has(['harga','berapa','layanan','menu','paket','price']))
    return `Ini beberapa layanan kita ${fn} 💈\n\n✂️ Hair Cut — Rp 85.000\n✂️ Hair & Fade Cut — Rp 95.000\n🪒 Shaving — Rp 40.000\n💆 Men Massage — Rp 145.000\n👑 Noble Grooming — Rp 140.000\n👑 Royal Grooming — Rp 305.000\n\nInfo lengkap: redboxbarbershop.com/booking.html`;
  if (has(['booking','reservasi','jadwal','pesan','mau potong','mau cukur']))
    return `Yuk langsung booking di sini aja ${fn} 📅\nredboxbarbershop.com/booking.html\n\nTinggal pilih layanan, kapster, sama slot waktu — gampang!`;
  if (has(['lokasi','alamat','dimana','maps','cabang']))
    return `Cabang RedBox ada di sini ${fn} 📍\n• Bypass (pusat) — Jl. Bypass Kedawung | 10.00–22.00\n• Samadikun — Jl. Samadikun | 10.00–21.00\n• CSB Mall — Lt. 1 | 10.00–21.00\n• Sumber — Jl. Raya Sumber | 10.00–21.00\n• Tegal — Jl. Raya Tegal | 10.00–21.00`;
  if (has(['konfirmasi booking','konfirmasi bkng','sudah booking','mau konfirmasi','ini konfirmasi']))
    return `Sip, makasih udah konfirmasi ${fn}! 🙏 Udah kami catat nih, sampai jumpa di RedBox! ✂️`;
  if (has(['makasih','terima kasih','thanks','thx']))
    return `Sama-sama ${fn}! Kalau ada yg lain, aku di sini 😊`;

  return `Aduh ${fn}, ada gangguan dikit nih 😅 Coba lagi sebentar ya, atau cek redboxbarbershop.com buat info lengkap!`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function handleMessage({ from, name, text }) {
  let reply;
  let used = 'openai';
  let error = null;

  try {
    reply = await callOpenAI(from, text, name);
  } catch (err) {
    console.warn('[WA Bot] OpenAI error, using fallback:', err.message);
    reply = fallbackReply(text, name);
    used = 'fallback';
    error = err?.message || String(err);
  }

  // Parse FORWARD_BOOKING tag — strip dari reply customer, proses di background
  let forwardBooking = null;
  const fwdMatch = reply.match(/FORWARD_BOOKING:(\{[^}]+\})/);
  if (fwdMatch) {
    try { forwardBooking = JSON.parse(fwdMatch[1]); } catch {}
    reply = reply.replace(/\s*FORWARD_BOOKING:\{[^}]+\}/, '').trim();
  }

  const sendResult = await sendWA(from, reply);
  // Persist message status fire-and-forget — jangan block sync path
  if (sendResult && Array.isArray(sendResult.id) && sendResult.id.length > 0) {
    for (let i = 0; i < sendResult.id.length; i++) {
      const msgId = sendResult.id[i];
      const target = Array.isArray(sendResult.target) ? sendResult.target[i] : from;
      persistMessageStatus(msgId, { message_status: sendResult.process || 'queued', target, raw: sendResult }).catch(() => {});
    }
  }

  // Forward booking ke branch WA jika ada tag (fire-and-forget)
  if (forwardBooking) {
    forwardBookingToBranch(forwardBooking, from).catch(err =>
      console.error('[WA Bot] forwardBookingToBranch error:', err.message)
    );
  }

  return { used, reply, sendResult, error };
}

function parseMultipartFormData(buffer, contentType) {
  const m = String(contentType || '').match(/boundary=([^;]+)/i);
  const boundary = m ? m[1].trim().replace(/^"|"$/g, '') : '';
  if (!boundary) return {};

  const raw = buffer.toString('utf8');
  const delimiter = `--${boundary}`;
  const parts = raw.split(delimiter);
  const out = {};

  for (const part of parts) {
    const p = part.trim();
    if (!p || p === '--') continue;
    const sepIndex = p.indexOf('\r\n\r\n');
    if (sepIndex < 0) continue;
    const headerBlock = p.slice(0, sepIndex);
    let value = p.slice(sepIndex + 4);
    value = value.replace(/\r\n$/, '');

    const nameMatch = headerBlock.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    out[fieldName] = value;
  }

  return out;
}

async function readRawBody(req, limitBytes = 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function coerceBody(body, req) {
  if (body && typeof body === 'object' && Object.keys(body).length > 0) return body;

  if (Buffer.isBuffer(body)) {
    const raw = body.toString('utf8');
    try { return JSON.parse(raw); } catch {}
    try {
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    } catch {}
    return {};
  }

  if (typeof body === 'string' && body.trim()) {
    const raw = body;
    try { return JSON.parse(raw); } catch {}
    try {
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    } catch {}
    return {};
  }

  if (!req) return {};

  try {
    const contentType = String(req.headers['content-type'] || '');
    const buf = await readRawBody(req);
    if (!buf || buf.length === 0) return {};

    if (contentType.toLowerCase().includes('multipart/form-data')) {
      return parseMultipartFormData(buf, contentType);
    }

    const raw = buf.toString('utf8');
    try { return JSON.parse(raw); } catch {}
    try {
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    } catch {}
    return {};
  } catch {
    return {};
  }
}

function cacheMessageStatus(id, payload) {
  const msgId = String(id || '').trim();
  if (!msgId) return;
  const now = Date.now();
  for (const [k, v] of messageStatusCache.entries()) {
    if (!v?.ts || now - v.ts > STATUS_TTL_MS) messageStatusCache.delete(k);
  }
  messageStatusCache.set(msgId, { ts: now, ...payload });
}

async function persistMessageStatus(id, payload) {
  const sb = getSupabase();
  if (!sb) return null;
  const msgId = String(id || '').trim();
  if (!msgId) return null;

  try {
    const record = {
      message_id: msgId,
      message_status: payload?.message_status ? String(payload.message_status) : null,
      target: payload?.target ? String(payload.target) : null,
      payload: payload?.raw || payload || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from('wa_message_status')
      .upsert(record, { onConflict: 'message_id' })
      .select('message_id')
      .maybeSingle();
    if (error) return { status: false, error: error.message };
    return { status: true, data };
  } catch (e) {
    return { status: false, error: e?.message || String(e) };
  }
}

async function getPersistedMessageStatus(id) {
  const sb = getSupabase();
  if (!sb) return null;
  const msgId = String(id || '').trim();
  if (!msgId) return null;

  try {
    const { data, error } = await sb
      .from('wa_message_status')
      .select('message_id,message_status,target,payload,updated_at')
      .eq('message_id', msgId)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

async function dumpPersistedStatuses(limit = 20) {
  const sb = getSupabase();
  if (!sb) return null;
  const n = Math.max(1, Math.min(50, Number(limit) || 20));

  try {
    const { data, error } = await sb
      .from('wa_message_status')
      .select('message_id,message_status,target,updated_at')
      .order('updated_at', { ascending: false })
      .limit(n);
    if (error) return { status: false, error: error.message };
    return { status: true, data: data || [] };
  } catch (e) {
    return { status: false, error: e?.message || String(e) };
  }
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
        const reply = await callOpenAI('__test__', test_msg, test_name || 'Tester');
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

    if (req.query.debug === 'redbox2026') {
      if (req.query.ping === '1') pushDebug({ step: 'ping' });

      if (req.query.device_info === '1') {
        const info = await getDeviceInfo();
        pushDebug({ step: 'device_info', device_status: info?.device_status, status: info?.status });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, device: info });
      }

      if (req.query.db_dump === '1') {
        const result = await dumpPersistedStatuses(req.query.limit);
        pushDebug({ step: 'db_dump', ok: !!result?.status });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, supabase: !!getSupabase(), result });
      }

      if (req.query.db_test === '1') {
        const testId = `test_${Date.now()}`;
        const persisted = await persistMessageStatus(testId, { message_status: 'test', target: 'test', raw: { test: true } });
        const fetched = await getPersistedMessageStatus(testId);
        pushDebug({ step: 'db_test', persisted: persisted?.status ?? null, fetched: !!fetched });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, supabase: !!getSupabase(), persisted, fetched });
      }

      if (req.query.msg_status_id) {
        const msgId = String(req.query.msg_status_id);
        const cached = messageStatusCache.get(msgId) || null;
        const persisted = await getPersistedMessageStatus(msgId);
        pushDebug({ step: 'msg_status', id: msgId, cached: !!cached });
        return res.status(200).json({
          status: 'ok',
          instance_id: INSTANCE_ID,
          message_status: cached || persisted,
          note: 'Fonnte /status API deprecated. Endpoint ini membaca cache per-instance atau Supabase (jika tabel wa_message_status ada).',
        });
      }

      if (req.query.conv_dump) {
        const target = String(req.query.conv_dump);
        const hist = await getHistory(target);
        pushDebug({ step: 'conv_dump', sender: target, messages: hist.length });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, sender: target, history: hist });
      }

      if (req.query.reset_history) {
        const target = String(req.query.reset_history);
        await clearHistory(target);
        pushDebug({ step: 'reset_history', sender: target });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, sender: target, cleared: true });
      }

      if (req.query.paused_list === '1') {
        const list = await listPausedSenders();
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, paused: list });
      }

      if (req.query.resume_ai) {
        const target = String(req.query.resume_ai);
        await clearHumanTakeover(target);
        pushDebug({ step: 'resume_ai', target });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, target, resumed: true });
      }

      if (req.query.send_to && req.query.send_msg) {
        const to = String(req.query.send_to);
        const msg = String(req.query.send_msg);
        const normalized = to.replace(/\D/g, '').replace(/^0/, '62');
        if (normalized.length < 10) {
          pushDebug({ step: 'debug_send', to, error: 'invalid_target' });
          return res.status(200).json({ status: 'error', instance_id: INSTANCE_ID, error: 'invalid_target', target: normalized });
        }

        const result = await sendWA(to, msg);
        if (result && Array.isArray(result.id) && result.id.length > 0) {
          for (let i = 0; i < result.id.length; i++) {
            const msgId = result.id[i];
            const target = Array.isArray(result.target) ? result.target[i] : normalized;
            await persistMessageStatus(msgId, { message_status: result.process || 'queued', target, raw: result });
          }
        }
        pushDebug({ step: 'debug_send', to: String(req.query.send_to), fonnte_result: result });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, result });
      }

      return res.status(200).json({
        instance_id: INSTANCE_ID,
        boot_ts: new Date(BOOT_TS).toISOString(),
        received: debugLog,
        note: 'Log ini per-instance (serverless). Kalau kosong, bisa karena request POST masuk ke instance lain.',
      });
    }

    return res.status(200).json({
      status: 'ok', service: 'RedBox WA Bot (AI)',
      openai_key_set: openaiReady, fonnte_token_set: fonnteReady,
      instance_id: INSTANCE_ID,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Fonnte payload: { device, sender, name, message, id, type, isFromMe }
    const rawBody = await coerceBody(req.body, req);
    let body = rawBody;
    if (rawBody && rawBody.data) {
      if (typeof rawBody.data === 'object') {
        body = rawBody.data;
      } else if (typeof rawBody.data === 'string') {
        try {
          const parsed = JSON.parse(rawBody.data);
          if (parsed && typeof parsed === 'object') body = parsed;
        } catch {}
      }
    }
    if (body === rawBody && rawBody && rawBody.payload && typeof rawBody.payload === 'string') {
      try {
        const parsed = JSON.parse(rawBody.payload);
        if (parsed && typeof parsed === 'object') body = parsed;
      } catch {}
    }

    const statusId = body.id || body.message_id || body.msgid || body.messageId;
    const messageStatus = body.message_status || body.status;
    const statusTarget = body.target || body.to || body.number || body.phone;
    const hasIncomingMessageField = body.message || body.text || body.chat || body.body || body.msg;
    const likelyStatusWebhook = !!messageStatus && !!statusId
      && !hasIncomingMessageField
      && !body.sender && !body.from && !body.name && !body.pushName;
    const likelyFonnteStatusWebhook = likelyStatusWebhook
      || (!!statusId && !!body.status && (!!body.stateid || !!body.state) && !hasIncomingMessageField);
    if (likelyFonnteStatusWebhook) {
      cacheMessageStatus(statusId, { message_status: messageStatus, target: statusTarget, reason: body.reason, raw: body });
      const persisted = await persistMessageStatus(statusId, { message_status: messageStatus, target: statusTarget, reason: body.reason, raw: body });
      pushDebug({
        step: 'webhook_status',
        id: String(statusId),
        message_status: String(messageStatus),
        target: Array.isArray(statusTarget) ? statusTarget[0] : statusTarget,
        persisted: persisted?.status ?? null,
      });
      return res.status(200).json({ status: 'ok' });
    }

    const sender = body.sender || body.from || body.number || body.phone || body.target;
    const name = body.name || body.pushName || body.senderName;
    const message = body.message || body.text || body.chat || body.body || body.msg;
    const type = body.type || body.msgType || body.messageType;
    const device = body.device || body.device_id || body.deviceId;
    const id = body.id || body.message_id || body.msgid || body.messageId;

    // Simpan ke debug log
    pushDebug({ sender, name, type, id, isFromMe: body.isFromMe, fromMe: body.fromMe, device, message: String(message || '').slice(0, 60) });

    // Log raw body untuk diagnose field Fonnte
    console.log('[WA Bot] Raw payload:', JSON.stringify({ ...body, message: String(message || '').slice(0, 60) }));

    // Dedup — abaikan jika pesan ID ini sudah pernah diproses (Fonnte retry)
    if (isDuplicate(id)) {
      console.log('[WA Bot] Duplicate message ignored, id:', id);
      return res.status(200).json({ status: 'ignored', reason: 'duplicate' });
    }

    // Filter pesan keluar (dikirim oleh bot sendiri) — Fonnte kirim webhook untuk outgoing juga
    const isFromMe = body.isFromMe === true || body.isFromMe === 1
      || body.is_from_me === true || body.is_from_me === 1
      || body.fromMe === true || body.fromMe === 1
      || (device && sender && String(sender) === String(device));
    if (isFromMe) {
      // Human takeover: admin balas manual dari HP → pause AI untuk customer tersebut
      const rawTarget = body.target || body.to || body.recipient;
      const deviceNum = normalizePhone(device);
      const targetNum = normalizePhone(rawTarget);
      if (targetNum && targetNum.length >= 8 && targetNum !== deviceNum) {
        setHumanTakeoverLocal(targetNum);
        persistHumanTakeover(targetNum).catch(() => {});
        console.log(`[WA Bot] Human takeover set for ${targetNum} — admin replied manually`);
        pushDebug({ step: 'human_takeover_set', target: targetNum });
      }
      console.log('[WA Bot] Ignored outgoing message, fields:', JSON.stringify({ isFromMe: body.isFromMe, fromMe: body.fromMe, sender, device }));
      return res.status(200).json({ status: 'ignored', reason: 'outgoing' });
    }

    console.log('[WA Bot] Incoming:', JSON.stringify({ sender, name, type, message: String(message || '').slice(0, 80) }));

    // Only block clear media types; allow text, chat, conversation, undefined, etc.
    const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'gif', 'ptt'];
    if (type && MEDIA_TYPES.includes(type)) {
      // Balas agar customer tahu pesan mereka diterima, tapi bot tidak bisa proses media
      res.status(200).json({ status: 'ok' });
      const mediaReply = type === 'sticker'
        ? `Terima kasih sticker-nya Kak 😄 Ada yang bisa aku bantu? Booking, info layanan, atau tanya harga?`
        : `Maaf Kak, aku belum bisa baca ${type === 'image' ? 'gambar' : type === 'audio' || type === 'ptt' ? 'pesan suara' : 'file'} ya 🙏 Silakan ketik pertanyaan Kakak, aku siap bantu!`;
      sendWA(sender, mediaReply).catch(() => {});
      return;
    }
    if (!sender || !message) return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    // Human takeover check — skip AI jika admin sedang handle manual
    const humanActive = await isHumanTakeover(sender);
    if (humanActive) {
      pushDebug({ step: 'human_takeover_active', sender });
      console.log(`[WA Bot] AI paused for ${sender} — human takeover active`);
      return res.status(200).json({ status: 'ignored', reason: 'human_takeover' });
    }

    // Proses AI + kirim WA DULU (sebelum res.json) — Lambda dalam state sinkron = network lebih cepat.
    // Post-response state menyebabkan HTTPS throttling → OpenAI & Fonnte timeout.
    const t0 = Date.now();
    try {
      pushDebug({ step: 'processing_start', sender, message: message?.slice(0, 40) });
      const result = await handleMessage({ from: sender, name: name || 'Kak', text: message });
      const ms = Date.now() - t0;
      pushDebug({
        step: 'processing_done',
        ms,
        used: result?.used,
        reply_preview: String(result?.reply || '').slice(0, 120),
        error: result?.error || null,
        fonnte_result: result?.sendResult ?? null,
      });
      console.log(`[WA Bot] Done in ${ms}ms for sender=${sender}`, result);
    } catch (err) {
      pushDebug({ step: 'processing_error', error: err.message });
      console.error('[WA Bot] Process error:', err.message);
    }

    // Balas 200 ke Fonnte setelah proses selesai.
    // Kalau total > ~10s, Fonnte mungkin timeout duluan — tapi customer tetap terima balasan via sendWA.
    if (!res.headersSent) res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WA Bot] Fatal error:', err.message);
    if (!res.headersSent) res.status(200).json({ status: 'error' });
  }
};
