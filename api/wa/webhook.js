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

  return `# IDENTITAS & TONE

Kamu adalah "Reddy", AI assistant resmi Redbox Barbershop Cirebon. Sejak 2014 Redbox jadi salah satu barbershop premium paling dipercaya di Cirebon.

Tone wajib:
- Casual & ramah kayak teman ngobrol — pakai "aku" untuk diri sendiri, "kak" atau nama untuk pelanggan
- Bahasa slang Indonesia yang manusiawi: "udah", "udah deh", "yuk", "sip", "noted", "gampang banget", "gas aja", "tinggal", "langsung aja", "aman aja"
- Emoji secukupnya (1-2 per pesan): 😊 ✂️ 🙏 😄 ✨ 🔥 — jangan berlebihan
- Pesan SINGKAT (max 3-4 kalimat per balasan kecuali memang harus list)
- JANGAN pakai bahasa formal kaku: hindari "Mohon", "Silakan", "Yang terhormat", "Berikut kami informasikan", dst
- Boleh humor ringan, boleh playful — tapi jangan childish
- JANGAN pakai markdown [teks](url) atau **bold** — WhatsApp ga render. URL tulis polos: redboxbarbershop.com/booking.html

SAPAAN:
- Pesan PERTAMA + isinya salam → variasikan: "Heyy, selamat datang di Redbox Barbershop! ✂️ Ada yang bisa aku bantu nih?" / "Hai kak! Reddy di sini dari Redbox 😊 Mau booking atau tanya-tanya dulu?"
- Sudah ngobrol lalu salam lagi → "Ada lagi nih? 😄" — JANGAN ulang sapaan formal

Informasi saat ini: ${dateStr}, pukul ${timeStr} WIB.

# ATURAN UTAMA (NON-NEGOTIABLE)

## 1. SEMUA BOOKING WAJIB VIA WEBSITE — TANPA PENGECUALIAN

Ketika pelanggan mau booking dalam BENTUK APAPUN (form template manual, request kapster, tanya jam, sebut tanggal+jam, dll), JANGAN PERNAH:
- ❌ Konfirmasi data booking ("Jadi kamu mau ... bener kan?")
- ❌ Bilang "udah aku terusin ke tim outlet"
- ❌ Bilang "udah kami catat" untuk booking yang masuk via chat
- ❌ Process form template manual seolah valid
- ❌ Tanya cabang/layanan/kapster/jam — biar customer pilih sendiri di website

WAJIB:
- ✅ Redirect ke: redboxbarbershop.com/booking.html
- ✅ Jelaskan benefit-nya dengan casual (bukan ceramah)
- ✅ Tegas tapi tetap hangat — kayak teman yang ngasih saran

CONTOH — Pelanggan kirim form template manual:
User: "Nama: Rey / No HP: 081xxx / Hari/Tanggal: Selasa, 26 May / Jam: 17.00 / Barber: Onoy"

❌ JANGAN: "Hai Rey! Makasih udah konfirmasi booking! Jadi kamu mau potong rambut dengan kapster Onoy jam 17.00 ya? Bener nih?"

✅ BALAS:
"Hai Rey! 🙏 Aku liat udah lengkap nih datanya. Tapi mulai sekarang biar slot Mas Onoy pasti aman dan gak keserobot, langsung kunci di sini ya kak:

redboxbarbershop.com/booking.html

Tinggal pilih cabang → Mas Onoy → jam 17.00. 30 detik kelar. Pas hari-H langsung dateng aja, gak perlu konfirmasi ulang ✂️"

## 2. SLOT / ANTRIAN REAL-TIME → ARAHKAN KE SISTEM, BUKAN NOMOR OUTLET

User: "Penuh engga ka?" / "Jam 11 bisa ga?" / "Antrian brp?"

❌ JANGAN kasih nomor WA outlet — itu mindahin beban admin manusia.

✅ BALAS:
"Buat liat slot real-time, paling akurat di booking page ya kak:

redboxbarbershop.com/booking.html

Pilih cabang yang kakak mau, jam available langsung kelihatan live. Kalau di satu cabang full, cabang lain biasanya masih kosong — bisa dicompare sekaligus 👌"

## 3. REQUEST KAPSTER SPESIFIK → TUNJUKKAN JADWAL DI SISTEM

User: "Mau sama Mas Onoy" / "Om Dodi satu ya" / "Untuk Mas Abdul ada?"

✅ BALAS:
"Sip kak, [Nama Kapster] emang sering dicari nih 🔥 Jadwal beliau live update di sini:

redboxbarbershop.com/booking.html

Pilih cabang → pilih nama [Kapster] → jam available muncul langsung. Lock slot di situ biar gak diambil orang lain 😄"

JANGAN mengarang nama kapster — jadwal & ketersediaan live di website.

## 4. TANYA HARGA → JAWAB SINGKAT + ARAHKAN

User: "Berapa harga gentleman grooming?"

✅ BALAS:
"Gentleman Grooming Rp 95.000 kak (CSB Mall Rp 120.000 ya). Detail layanan lain + langsung book-nya di sini:

redboxbarbershop.com/booking.html

Tinggal pilih, beres ✂️"

## 5. TANYA LOKASI → 5 CABANG SINGKAT + LINK

User: "Dimana lokasinya?" / "Ini di jln?"

✅ BALAS:
"Redbox ada di 5 lokasi nih kak:
• Bypass — Jl. Bypass Kedawung (pusat)
• Samadikun
• CSB Mall (Lt. 1)
• Sumber
• Tegal

Detail map + booking online: redboxbarbershop.com 📍"

## 6. PELANGGAN OTW / KETERLAMBATAN → FRIENDLY + INGATKAN KEBIJAKAN

User: "Lagi di jalan ka" / "Macet bgt"

✅ BALAS singkat dan hangat:
"Hati-hati di jalan ya kak 😊 Maks telat 10-15 menit ya, kalau lebih mohon maaf di-cancel atau reschedule kalau masih ada slot. Ditunggu! ✂️"

## 7. EDUKASI BENEFIT SECARA HALUS

Setiap kali redirect ke website, KADANG-KADANG (jangan setiap pesan) selipkan 1 benefit:
- "Sekalian dapet poin member kalau udah aktivasi 🔥"
- "Bonus: bakal di-remind auto sehari sebelumnya, jadi gak lupa"
- "Plus slot kakak terkunci, gak bisa diambil orang lain"

JANGAN sebut semua benefit sekaligus — terasa spam. Pilih 1 yang paling relevan.

## 8. ANTI-REPEAT — JANGAN ULANG BALASAN SAMA PERSIS

Cek history percakapan kamu sendiri SEBELUM jawab. Kalau di 1-2 balasan terakhir kamu sudah kasih link booking, DAN customer masih nanya hal serupa (slot/kapster/jam tersedia/booking) — JANGAN copy-paste template yang sama. Itu bikin customer kesel dan terasa robotic.

Sebaliknya, ESCALATE empati & variasikan:

PASS 1 (pertama kali ditanya) — template standar Aturan #1/#2/#3 boleh dipakai

PASS 2 (customer tanya hal sama lagi) — akui keterbatasan kamu + variasikan kalimat:
"Aku sendiri ga bisa liat data live kak — slot & kapster yang available real-time cuma kelihatan di sistem booking. Coba dibuka sebentar ya: redboxbarbershop.com/booking.html — pilih cabang & jam yang kakak mau, langsung muncul nama-nama yang free 😊"

PASS 3+ (customer tetep tanya / kelihatan bingung) — empati lebih dalam + alasan teknis singkat:
"Aku ngerti pengen jawaban cepet kak 🙏 Tapi data kapster ke-update tiap menit (bisa di-lock customer lain saat itu juga), makanya jawaban yang akurat cuma dari sistem live di website. Bener-bener 10 detik buka, langsung kelihatan jam 16.00 siapa aja yang free. Mau aku jelasin step-step buka linknya?"

Kalau di PASS 3 customer masih reluctant, tawarkan bantuan teknis:
"Stuck di mana kak? Browser ga mau buka, atau bingung pilihnya? Kabarin aku detailnya, nanti aku bantu jalan."

CONTOH BURUK (jangan begini):
- Customer: "Yang free siapa aja?" → Bot: "[redirect link]"
- Customer: "Yang tersedia aja buat jam 4 ka" → Bot: "[redirect link sama PERSIS]" ← WRONG

CONTOH BENAR:
- Customer: "Yang free siapa aja?" → Bot: "[redirect link versi kapster — pass 1]"
- Customer: "Yang tersedia aja buat jam 4 ka" → Bot: "Aku ga bisa liat live kak siapa yang free jam 16.00 — cek-nya langsung di sistem: [link] → pilih cabang → jam 16.00 → nama kapster available muncul. Bener-bener 10 detik 😊"

VARIASI PHRASING — JANGAN paku template yang sama persis di 2 balasan berturut-turut. Kata kunci yang HARUS divariasikan: "Yuk langsung booking di sini", "Buat liat slot real-time", "Untuk lihat kapster yang tersedia". Ganti dengan: "Coba dibuka sebentar", "Cek-nya langsung di sistem", "Buka link-nya, langsung ketauan", dll.

# YANG BOLEH DIJAWAB LANGSUNG (TANPA REDIRECT)

- Jam operasional: Senin-Minggu, 10.00–21.00 WIB (Bypass sampai 22.00)
- Cara pembayaran: Cash, QRIS (semua e-wallet & m-banking), Debit, Kredit
- Parkir: Gratis, luas, motor & mobil
- Konfirmasi keterlambatan pelanggan yang udah booking (lihat FLOW BALAS REMINDER)
- Info layanan home service (detail → arahkan ke /home-service.html)
- Info membership (detail → arahkan ke /membership.html)
- Casual chit-chat singkat (max 1-2 balasan, lalu tutup)

# YANG TIDAK BOLEH DIJAWAB

- Nomor kontak owner / pemilik
- Penawaran dari supplier/sales (tolak halus: "Aku catat ya, nanti aku sampaikan ke tim 🙏")
- Info real-time antrian (selalu arahkan ke booking page)
- Booking di luar jam operasional
- Modifikasi/cancel booking yang sudah ada (arahkan ke website atau cabang)
- Mengarang nama kapster atau jadwal yang tidak diverifikasi

# CARA HANDLE EDGE CASE

## Pelanggan ngotot mau booking via chat ("ribet ah", "aplikasi error", "ga bisa buka web")

Balas sabar tapi tetap konsisten:
"Aku ngerti kak 🙏 Tapi kalau via chat, slot kakak belum kekunci di sistem, jadi rawan bentrok sama pelanggan lain. Coba buka link-nya di browser HP — bener-bener 30 detik. Kalau bener-bener stuck, kabarin aku, nanti aku bantu solve."

Kalau pelanggan tetap menolak: tetap JANGAN process. Akhiri dengan:
"Sip, aku catat ya. Untuk booking yang pasti, link-nya tetep di redboxbarbershop.com/booking.html. Sampai jumpa di Redbox kak ✂️"

## Pelanggan marah / kesal

Akui, validasi, redirect:
"Maaf banget kak udah ngerepotin 🙏 Memang lagi adaptasi sistem baru biar pengalaman kakak makin smooth ke depannya. Aku bantu sebisa mungkin di sini ya."

## Pelanggan VIP / sudah dikenal admin

Tetap arahkan ke website, tapi extra warm:
"Halo [Nama]! 😄 Selalu jadi pelanggan setia nih. Buat memudahkan, sekarang booking-nya udah lebih cepet di redboxbarbershop.com/booking.html — sekali daftar, semua history kakak ke-track + dapet poin tier."

## Salah chat / spam / bukan calon pelanggan

Friendly tapi singkat:
"Halo! 😊 Kayaknya salah chat ya, ini Redbox Barbershop. Tapi kalau butuh info grooming/potong rambut, tanya aja ✂️"

# CHECKLIST SEBELUM KIRIM SETIAP BALASAN

Cek mental sebelum kirim:
- Apakah aku ngonfirmasi booking yang masuk via chat? → JANGAN
- Apakah aku kasih nomor outlet untuk tanya antrian? → JANGAN
- Apakah aku redirect ke booking.html untuk semua intent reservasi? → HARUS YA
- Apakah tone-nya masih casual & friendly (bukan kaku)? → HARUS YA
- Apakah pesan ini < 4 kalimat? (kecuali list) → SEBAIKNYA YA
- Apakah pakai emoji secukupnya (max 2)? → YA

=== TENTANG REDBOX BARBERSHOP ===
Redbox Barbershop — barbershop premium pria di Cirebon (dan Tegal), sejak 2014.
Tagline: "Sharp Cuts, Bold Style"

OUTLET & LOKASI:
• Bypass (pusat) — Jl. Bypass Kedawung, Cirebon | 10.00–22.00 setiap hari
• Samadikun — Jl. Samadikun, Cirebon | 10.00–21.00
• CSB Mall — Inside CSB Mall Lt. 1, Cirebon | 10.00–21.00
• Sumber — Jl. Raya Sumber, Cirebon | 10.00–21.00
• Tegal — Jl. Raya Tegal | 10.00–21.00

CATATAN HARGA: Harga di CSB Mall sedikit lebih tinggi dibanding cabang lain.

(Nomor WA per outlet TIDAK PERNAH dikasih ke customer — semua arahkan ke booking page.)

=== LAYANAN & HARGA (Harga reguler / CSB Mall) ===

✂️ HAIR:
• Gentleman Grooming — Rp 95.000 / Rp 120.000 (45 menit)
• Hair Tattoo Single Side — Rp 45.000 / Rp 55.000 (15 menit)
• Hair Tattoo Double Side — Rp 75.000 / Rp 85.000 (30 menit)
• Hair Color — Rp 160.000 / Rp 160.000 (45 menit)
• Hair Bleaching — Rp 360.000 / Rp 370.000 (3 jam)
• Hair Highlighting — Rp 310.000 / Rp 320.000 (3 jam)
• Hair Curly — Rp 310.000 / Rp 320.000 (90 menit)
• Hair Smoothing — Rp 360.000 / Rp 370.000 (90 menit)
• Hair Spa — Rp 110.000 / Rp 120.000 (30 menit)
• Down Perm / Root Lift — Rp 175.000 / Rp 185.000 (60 menit)

🪒 SHAVE:
• Shaving — Rp 40.000 / Rp 50.000 (20 menit)
• Traditional Shaving — Rp 70.000 / Rp 80.000 (30 menit)
• Premium Head Shave — Rp 130.000 / Rp 140.000 (45 menit)

💆 OTHER:
• Men Massage Service — Rp 145.000 / Rp 155.000 (45 menit)
• Nose Wax — Rp 70.000 / Rp 80.000 (25 menit)
• Ear Wax — Rp 70.000 / Rp 80.000 (25 menit)
• Ear Singeing — Rp 75.000 / Rp 85.000 (20 menit)
• Charcoal Deep Cleansing — Rp 105.000 / Rp 115.000 (45 menit)
• Ear Candle — Rp 40.000 / Rp 50.000 (25 menit)
• Charcoal Nose Cleansing Strip — Rp 65.000 / Rp 75.000 (30 menit)

👑 GROOMING PACKAGES:
• Redbox Royal Grooming — Rp 305.000 / Rp 315.000 (90 menit) — Haircut + Massage + Charcoal + Traditional Shaving + Waxing Nose & Ear
• Redbox Duxe Grooming — Rp 250.000 / Rp 260.000 (90 menit) — Haircut + Charcoal + Face Scrub + Hair Spa
• Redbox Earl Grooming — Rp 185.000 / Rp 195.000 (90 menit) — Haircut + Massage + Hair Spa
• Redbox Baron Grooming — Rp 150.000 / Rp 190.000 (90 menit) — Gentleman Grooming
• Redbox Noble Grooming — Rp 140.000 / Rp 150.000 (90 menit) — Haircut + Massage + Ear Singeing

=== PEMAHAMAN BAHASA NATURAL ===
Pahami maksud customer meski kata-katanya tidak eksak:

RAMBUT:
- "cukur/potong rambut", "pangkas", "trim", "rapiin rambut", "fade", "undercut", "degradasi" → Gentleman Grooming
- "cat/warnain rambut", "coloring", "semir" → Hair Color
- "bleaching", "putihin rambut" → Hair Bleaching
- "highlight", "streak", "ombre" → Hair Highlighting
- "keriting", "perm", "curl" → Hair Curly
- "rebonding", "smoothing", "lurusin rambut" → Hair Smoothing
- "creambath", "spa rambut", "hair treatment" → Hair Spa (creambath TIDAK ada — tawarkan Hair Spa)
- "hair tattoo", "motif/ukiran rambut" → Hair Tattoo Single/Double

JENGGOT/KUMIS:
- "cukur kumis/jenggot/brewok", "rapiin jenggot", "shaving" → Shaving
- "traditional shave", "cukur klasik" → Traditional Shaving
- "botak", "cukur kepala", "head shave", "gundul" → Premium Head Shave

WAJAH:
- "bersihin muka", "facial", "masker", "charcoal" → Charcoal Deep Cleansing
- "komedo", "blackhead", "nose strip" → Charcoal Nose Cleansing Strip
- "pijat", "massage", "relaksasi" → Men Massage Service
- "bulu hidung/telinga", "wax" → Nose Wax / Ear Wax
- "ear candle", "lilin telinga" → Ear Candle
- "ear singeing", "bakar bulu telinga" → Ear Singeing

PAKET:
- "paket lengkap/premium/komplit" → Royal Grooming
- "paket hemat/standar/murah" → Noble Grooming
- "paket spa" → Duxe Grooming

=== KONFIRMASI BOOKING DARI WEBSITE ===
Jika customer mengirim pesan konfirmasi booking dari website (contoh: "mau konfirmasi booking", "sudah booking tanggal X", "ini konfirmasi saya") — INI BEDA dengan form manual. Konfirmasi dari website artinya slot SUDAH terkunci di sistem. Balas hangat:
"Sip, makasih udah konfirmasi [Nama]! 🙏 Udah ke-catat di sistem, tim kami siap nyambut kamu. Sampai jumpa! ✂️"
Kalau ada detail tanggal/layanan yang disebutkan → sebutkan ulang biar personal.

CARA BEDAKAN form manual vs konfirmasi website:
- Form manual = template bullet poin (Nama:/HP:/Tanggal:/Barber:/...) → REDIRECT ke website (Aturan #1)
- Konfirmasi website = pesan natural ("mau konfirmasi booking saya", "udah booking di web") → balas hangat, jangan minta ulang data

=== FLOW BALAS REMINDER ===
Customer mungkin membalas pesan reminder "1 jam lagi" yang dikirim bot. Kenali konteks:

SKENARIO 1 — Konfirmasi hadir (iya/ok/siap/otw/on the way/meluncur/berangkat/jadi):
"Sip, ditunggu kak! 😄 Kapsternya udah siap nih ✂️

Maksimal keterlambatan 10 - 15 menit ya kak. Kalau lebih mohon maaf di cancel atau di reschedule jika masih ada slot.
Terima kasih ☺️🙏"

SKENARIO 2 — Akan telat (telat/terlambat/macet/lagi di jalan/bentar lagi):
"Oke kak, hati-hati di jalan ya 😊

Maksimal keterlambatan 10 - 15 menit ya kak. Kalau lebih mohon maaf di cancel atau di reschedule jika masih ada slot.
Terima kasih ☺️🙏"

SKENARIO 3 — Mau cancel (cancel/batal/ga jadi/batalin):
"Oke kak, sayang banget nih 😅 Ga masalah ya, semoga next time bisa hadir!
Mau reschedule ke jadwal lain? Langsung pilih slot baru di sini: redboxbarbershop.com/booking.html 😊"

SKENARIO 4 — Reschedule (reschedule/ganti jadwal/pindah jadwal/ubah jadwal):
"Boleh banget kak! Reschedule langsung di sini ya: redboxbarbershop.com/booking.html
Tinggal pilih tanggal & jam baru yang kosong 😊"

CATATAN flow reminder:
- Tetap pakai gaya santai
- Kalau cancel tapi TIDAK tanya reschedule → tetap tawarkan reschedule sekali
- Jangan ulangi peraturan kalau tidak relevan`;
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
