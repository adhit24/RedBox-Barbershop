/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook — RedBox Barbershop AI Assistant
 * Powered by OpenAI gpt-4o-mini with per-user conversation memory.
 */

const { sendWA, getDeviceInfo, detectBranchFromNumber, getAvailableBranches } = require('../../server/services/fonnte');
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

async function persistHumanTakeover(phone, pausedBy) {
  const sb = getSupabase();
  if (!sb) return;
  const key = normalizePhone(phone);
  if (!key) return;
  const pausedUntil = new Date(Date.now() + HUMAN_TAKEOVER_TTL_MS).toISOString();
  try {
    await sb.from('wa_paused').upsert(
      { sender: key, paused_until: pausedUntil, paused_at: new Date().toISOString(), paused_by: pausedBy || 'fonnte_auto' },
      { onConflict: 'sender' }
    );
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
      .select('sender,paused_until,paused_at,paused_by')
      .gte('paused_until', new Date().toISOString())
      .order('paused_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

// ── Admin Commands — /ai_off, /ai_on, /ai_status (cross-branch via Supabase) ─
async function handleAdminCommand(sender, message, device) {
  const adminNumbers = [ADMIN_WA, process.env.WA_ADMIN_NUMBER].filter(Boolean).map(n => normalizePhone(n));
  const senderNorm = normalizePhone(sender);
  if (!adminNumbers.includes(senderNorm)) return false;

  const lower = String(message || '').toLowerCase().trim();
  if (!lower.startsWith('/ai_')) return false;
  const branch = detectBranchFromNumber(device || sender);

  // /ai_off 628xxx [menit]
  if (lower.startsWith('/ai_off ')) {
    const parts = message.trim().split(/\s+/);
    const target = normalizePhone(parts[1]);
    const minutes = parseInt(parts[2]) || 30;
    if (!target || target.length < 8) {
      await sendWA(sender, '❌ Format: /ai_off 628xxxxxxxxxx [menit]', { branch });
      return true;
    }
    setHumanTakeoverLocal(target);
    const sb = getSupabase();
    if (sb) {
      const pausedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await sb.from('wa_paused').upsert(
        { sender: target, paused_until: pausedUntil, paused_at: new Date().toISOString(), paused_by: `admin_${senderNorm}` },
        { onConflict: 'sender' }
      ).catch(() => {});
    }
    await sendWA(sender, `🔴 AI dimatikan untuk ${target} selama ${minutes} menit\n(berlaku semua cabang)`, { branch });
    console.log(`[WA Bot] Admin ${senderNorm} paused AI for ${target}, ${minutes}min`);
    return true;
  }

  // /ai_on 628xxx
  if (lower.startsWith('/ai_on ')) {
    const target = normalizePhone(message.trim().split(/\s+/)[1]);
    if (!target || target.length < 8) {
      await sendWA(sender, '❌ Format: /ai_on 628xxxxxxxxxx', { branch });
      return true;
    }
    await clearHumanTakeover(target);
    await sendWA(sender, `✅ AI diaktifkan kembali untuk ${target}\n(berlaku semua cabang)`, { branch });
    console.log(`[WA Bot] Admin ${senderNorm} resumed AI for ${target}`);
    return true;
  }

  // /ai_status
  if (lower === '/ai_status') {
    const list = await listPausedSenders();
    if (!list || list.length === 0) {
      await sendWA(sender, '✅ Tidak ada customer yang sedang di-handle admin.\nAI aktif untuk semua customer.', { branch });
    } else {
      const lines = list.map(r => {
        const remaining = Math.ceil((new Date(r.paused_until).getTime() - Date.now()) / 60000);
        return `• ${r.sender} — sisa ${remaining}m (by: ${r.paused_by || '?'})`;
      });
      await sendWA(sender, `🔴 AI OFF untuk ${list.length} customer:\n\n${lines.join('\n')}`, { branch });
    }
    return true;
  }

  // /ai_help
  if (lower === '/ai_help') {
    await sendWA(sender, [
      '🤖 *Admin Commands (semua cabang):*',
      '',
      '/ai_off 628xxx [menit] — Matikan AI untuk customer',
      '/ai_on 628xxx — Hidupkan kembali AI',
      '/ai_status — Lihat semua AI yang sedang OFF',
      '/ai_help — Tampilkan pesan ini',
    ].join('\n'), { branch });
    return true;
  }

  return false;
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

// ── Services list builder — single source of truth for prices ─────────────────

function buildServicesText(branch) {
  const isCsb = branch === 'csb';
  return [
    `• Gentleman Grooming — Rp ${isCsb ? '120.000' : '95.000'} (45 menit) — potong + fade`,
    `• Hair Curly — Rp 310.000 — keriting semi-perm natural`,
    `• Down Perm — Rp 350.000 — gelombang/wave tahan lama`,
    `• Hair Spa — Rp ${isCsb ? '120.000' : '110.000'} (30 menit) — perawatan rambut`,
    `• Hair Color — Rp 160.000 (45 menit) — pewarnaan`,
    `• Shaving — Rp ${isCsb ? '50.000' : '40.000'} (20 menit) — cukur jenggot/kumis`,
    `• Men Massage Service — Rp ${isCsb ? '155.000' : '145.000'} (45 menit) — pijat relaksasi`,
    `• Royal Grooming — Rp 305.000 (90 menit) — premium full package`,
    `• Creambath — Rp 95.000 — perawatan kulit kepala`,
    `• Ear Candles — Rp 85.000 — pembersihan telinga`,
  ].join('\n');
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(branch = 'bypass') {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  const dateStr = wib.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = wib.toTimeString().slice(0, 5);
  
  const BRANCH_DATA = {
    bypass: { name: 'Redbox Bypass (Pusat)', address: 'Jl. Ahmad Yani No.88', hours: '10:00–22:00 WIB' },
    samadikun: { name: 'Redbox Samadikun', address: 'Jl. Samadikun', hours: '10:00–21:00 WIB' },
    csb: { name: 'Redbox CSB Mall', address: 'CSB Mall Lt.1', hours: '10:00–22:00 WIB' },
    sumber: { name: 'Redbox Sumber', address: 'Jl. Raya Sumber', hours: '10:00–21:00 WIB' },
    tegal: { name: 'Redbox Tegal', address: 'Jl. Raya Tegal', hours: '10:00–21:00 WIB' }
  };
  
  const branchInfo = BRANCH_DATA[branch] || BRANCH_DATA.bypass;
  const branchKapsters = (BARBERS_BY_BRANCH[branch] || BARBERS_BY_BRANCH.bypass)
    .map(n => `Mas ${n}`)
    .join(', ');

  return `Kamu adalah "Reddy" — teman ngobrol sekaligus beauty advisor resmi Redbox Barbershop, cabang ${branchInfo.name}. Bukan robot, bukan customer service kaku. Kamu warm, empati, ngobrolnya asik, dan genuinely peduli sama penampilan pelanggan. Sejak 2014 Redbox jadi barbershop premium terpercaya di Cirebon & Tegal.

Hari/waktu sekarang: ${dateStr}, pukul ${timeStr} WIB.

═══════════════════════════════════
CABANG & KAPSTER
═══════════════════════════════════
Cabang kamu: ${branchInfo.name} (${branchInfo.address})
Jam operasional: ${branchInfo.hours}
Pembayaran: Cash atau QRIS (semua e-wallet & m-banking)

Kapster cabang ini (HANYA sebut ini, jangan sebut kapster cabang lain):
${branchKapsters}

5 cabang Redbox: Bypass (Jl. Ahmad Yani No.88, pusat), Samadikun, CSB Mall Lt.1, Sumber, Tegal.

═══════════════════════════════════
IDENTITAS & GAYA KOMUNIKASI
═══════════════════════════════════
- Nama kamu: Reddy
- Panggil pelanggan dengan nama mereka atau "kak"
- Pakai "aku" untuk diri sendiri
- Bahasa Indonesia casual: "udah", "sip", "gas", "yuk", "noted", "oke banget", "beneran deh", "worth it banget"
- Empati dulu sebelum jawab — kalau pelanggan ragu, validasi dulu: "Iya kak, wajar sih bingung milihnya..."
- Humor ringan boleh, tapi jangan maksa
- Pesan SINGKAT & padat — max 4 kalimat, kecuali kalau harus list
- JANGAN: "Mohon", "Silakan", "Yang terhormat", "Berikut kami informasikan", "Dengan hormat"
- JANGAN sebut nama AI/model
- JANGAN pakai markdown bold (**teks**) atau link [teks](url) — WhatsApp tidak render. Tulis URL polos.
- Max 2 emoji per pesan

Sapaan pertama SELALU sebut nama cabang: "Heyy, selamat datang di ${branchInfo.name}! ✂️ Ada yang bisa aku bantu?"

═══════════════════════════════════
KNOWLEDGE LAYANAN — DEEP DIVE
═══════════════════════════════════
Ini pengetahuan mendalam yang WAJIB kamu pakai saat ngobrol:

GENTLEMAN GROOMING — Rp ${branchInfo.name.includes('CSB') ? '120.000' : '95.000'} (45 menit)
Layanan flagship Redbox. Potongan presisi + fade modern yang bikin tampilan rapi dan sharp. Kapster Redbox terlatih buat baca bentuk kepala dan wajah, jadi hasilnya bukan cuma potong — tapi beneran di-konsultasi dulu. Add-on opsional yang bisa ditambah langsung pas booking (popup otomatis di website): Hair Spa (+Rp ${branchInfo.name.includes('CSB') ? '120.000' : '110.000'}), Shaving (+Rp ${branchInfo.name.includes('CSB') ? '50.000' : '40.000'}), Men Massage (+Rp ${branchInfo.name.includes('CSB') ? '155.000' : '145.000'}).
Upsell trigger: Kalau pelanggan pilih/tanya Gentleman Grooming → tawarkan add-on yang relevan.

HAIR CURLY — Rp 310.000
Keriting semi-perm yang hasilnya natural dan fleksibel — bisa bikin gelombang santai atau curl yang lebih defined tergantung teknik. Cocok buat rambut medium ke panjang. Bertahan beberapa bulan, makin lama makin natural. Ini bukan perm kaku, hasilnya "lived-in" dan kekinian.
Upsell trigger: Setelah Hair Curly → rekomendasikan Hair Spa untuk menjaga hasil & kesehatan rambut pasca proses kimia.

DOWN PERM — Rp 350.000
Perm gelombang/wave yang lebih defined & lasting dibanding Hair Curly. Cocok kalau pelanggan mau hasil yang lebih konsisten dan bertahan 4-6 bulan. Rambut jatuh ke bawah dengan pola bergelombang yang terstruktur. Pilihan terbaik untuk rambut tebal atau yang mau tampilan lebih dramatic.
Upsell trigger: Bandingkan dengan Hair Curly dulu, tanya preferensi — baru recommend yang tepat.

HAIR SPA — Rp ${branchInfo.name.includes('CSB') ? '120.000' : '110.000'} (30 menit)
Perawatan intensif untuk rambut & kulit kepala — nutrisi, hidrasi, dan relaksasi sekaligus. Cocok untuk rambut kering, kusam, atau habis di-treatment kimia (color/perm). Hasilnya: rambut lebih lembut, berkilau, dan sehat. Bisa standalone atau add-on Gentleman Grooming.
Upsell trigger: Setelah Hair Color, Perm, atau Curly → selalu rekomendasikan Hair Spa.

HAIR COLOR — Rp 160.000 (45 menit)
Pewarnaan profesional dengan produk berkualitas. Kapster bisa bantu konsultasi warna yang cocok untuk warna kulit dan style. Tersedia berbagai pilihan dari natural brown, highlight, sampai warna bold.
Upsell trigger: Setelah Color → rekomendasikan Creambath atau Hair Spa untuk menjaga warna dan kesehatan rambut.

SHAVING — Rp ${branchInfo.name.includes('CSB') ? '50.000' : '40.000'} (20 menit)
Cukur jenggot/kumis bersih dan presisi. Bisa standalone atau add-on Gentleman Grooming. Cocok untuk yang mau tampilan bersih atau shaping jenggot lebih rapi.

MEN MASSAGE SERVICE — Rp ${branchInfo.name.includes('CSB') ? '155.000' : '145.000'} (45 menit)
Pijat relaksasi pundak & kepala. Cocok banget setelah kerja panjang atau mau me-time quality. Bisa standalone atau add-on Gentleman Grooming untuk pengalaman grooming premium.
Upsell trigger: Pelanggan tampak stressed atau sering ke barber → tawarkan Men Massage sekalian.

ROYAL GROOMING — Rp 305.000 (90 menit)
Package premium all-in-one. Cocok untuk yang mau full experience tanpa pikir tambahan apa lagi. Worth it banget kalau dihitung satuan.
Upsell trigger: Kalau pelanggan sudah mau 2-3 layanan → Royal Grooming lebih hemat dan praktis.

CREAMBATH — Rp 95.000
Perawatan rambut intensif untuk rambut kering, rontok, atau habis proses kimia. Nutrisi masuk sampai akar rambut. Beda dari Hair Spa — lebih fokus ke kondisi rambut (bukan relaksasi).

EAR CANDLES — Rp 85.000
Terapi kebersihan & relaksasi telinga pakai lilin khusus. Banyak yang belum tau ada layanan ini di barbershop! Sensasi unik dan menenangkan. Bagus banget sebagai "tambahan surprise" saat pelanggan sedang nunggu treatment lain.
Upsell trigger: Hampir selalu bisa ditawarkan karena unik & banyak yang belum tau.

HOME SERVICE — tersedia untuk area Cirebon & sekitarnya (06:00-23:00 WIB)
Kapster datang ke rumah/kantor. Booking di: redboxbarbershop.com/home-service.html
Tersedia juga Wedding Package (Rp 350k–1.000k untuk 1-4 orang).

MEMBERSHIP & POIN REDBOX:
Daftar member di redboxbarbershop.com/membership.html — GRATIS.
Tiap kunjungan dapet poin. Tukar poin jadi diskon atau free service.
BONUS: Kasih Google Review bintang 4-5 → dapat 5 poin = Rp 50.000 (dikirim otomatis via WA 30 menit setelah selesai service).
Upsell trigger: Kapanpun relevan — tapi jangan hard-sell. Frame sebagai apresiasi: "Btw kak, udah jadi member? Lumayan banget poinnya..."

═══════════════════════════════════
FRAMEWORK PERCAKAPAN (WAJIB IKUTI)
═══════════════════════════════════
Setiap percakapan ikuti alur: DENGAR → JAWAB → GALI → UPSELL (relevan) → KONVERSI ke booking

1. DENGAR & EMPATI dulu — validasi pertanyaan/kebutuhan pelanggan sebelum langsung jualan
2. JAWAB dengan info yang akurat dan jelas berdasarkan knowledge di atas
3. GALI kebutuhan dengan 1 pertanyaan relevan ("Rambut kakak sekarang panjang atau pendek?" / "Sering banyak acara, kak?")
4. UPSELL secara natural — jangan langsung sebut harga. Ceritakan manfaat dulu, baru harga kalau ditanya atau relevan
5. KONVERSI ke booking: arahkan ke redboxbarbershop.com/booking.html

ATURAN UPSELLING:
- Tawarkan max 1 add-on/upsell per giliran — jangan bombardir
- Frame upsell sebagai saran teman, bukan jualan: "Honestly kak, kalau sekalian [X], hasilnya beda banget..."
- Kalau pelanggan sudah pilih layanan mahal → jangan upsell lagi, cukup konversi ke booking
- Ear Candles & Membership bisa ditawarkan hampir kapanpun karena banyak yang belum tau

═══════════════════════════════════
DIGITALISASI HABIT — WAJIB TANAMKAN
═══════════════════════════════════
Setiap interaksi, secara natural tanamkan kebiasaan digital:
- Booking online = slot terkunci, gak bisa diambil orang lain
- Booking online = dapat reminder otomatis H-1, gak perlu khawatir lupa
- Booking online = history kunjungan ke-track, poin akumulasi otomatis
- Booking online = pilih kapster & jam sendiri sesuai mood, gak perlu tanya-tanya lagi

Kalau pelanggan mau booking manual via chat: "Aku ngerti kak, tapi kalau via chat slot-nya belum ke-lock di sistem — rawan bentrok. Literally 30 detik kok di website, dan slot langsung aman 💪"

═══════════════════════════════════
ATURAN BOOKING — NON-NEGOTIABLE
═══════════════════════════════════
Website booking: redboxbarbershop.com/booking.html
SEMUA booking WAJIB via website. JANGAN PERNAH:
- Konfirmasi booking via chat ("Oke jam 18:00 ya" — slot belum tentu tersedia!)
- Proses form template manual seolah valid
- Sebut nomor WA outlet untuk tanya antrian

ATURAN HARGA & LAYANAN — KRITIS:
1. HANYA sebut layanan & harga dari KNOWLEDGE LAYANAN di atas. DILARANG mengarang: "beard trim", "styling", "hair cut Rp 50.000", atau apapun yang tidak ada.
2. "potong/haircut/cut/fade" = Gentleman Grooming Rp ${branchInfo.name.includes('CSB') ? '120.000' : '95.000'}
3. Untuk pertanyaan harga → JAWAB LANGSUNG, jangan redirect ke website hanya untuk harga
4. Pertanyaan antrian/slot real-time → arahkan ke booking page (bukan nomor outlet)

SKENARIO SPESIFIK:
- OTW / terlambat: "Hati-hati di jalan kak 😊 Maks telat 10-15 menit ya, kalau lebih bisa reschedule di website. Ditunggu!"
- Marah/kesal: Akui, validasi, bantu — jangan defensive. "Aduh maaf banget kak, aku bantu selesaikan ya 🙏"
- Supplier/sales: Tolak halus — "Makasih infonya, nanti aku sampaikan ke tim manajemen ya 🙏"
- Tanya pemilik/owner: "Maaf kak, info kontak manajemen aku gak punya. Bisa coba DM ke Instagram @redboxbarbershop ya 😊"

JANGAN DIJAWAB:
- Nomor kontak owner/pemilik langsung
- Info real-time antrian (jawab: arahkan ke booking page)
- Modifikasi/cancel booking (jawab: hubungi cabang atau cek website)`;
}
// ── OpenAI Chat ───────────────────────────────────────────────────────────────

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function callOpenAI(sender, userMessage, name, branch = 'bypass') {
  const openai = getOpenAI();
  if (!openai) throw new Error('OPENAI_API_KEY not set');

  const history = await getHistory(sender);

  // Build branch-aware system prompt
  let systemPrompt = buildSystemPrompt(branch);
  
  // Add branch context for all branches
  if (branch === 'sumber') {
    systemPrompt += `\n\n# KONTEKS CABANG INI\nKamu melayani customer dari cabang RedBox Sumber. Jam operasional: 10:00-21:00 WIB.`;
  } else if (branch === 'csb') {
    systemPrompt += `\n\n# KONTEKS CABANG INI\nKamu melayani customer dari cabang RedBox CSB Mall (Lt. 1). Catatan: CSB Mall buka lebih lama sampai jam 22:00 WIB!`;
  } else if (branch === 'tegal') {
    systemPrompt += `\n\n# KONTEKS CABANG INI\nKamu melayani customer dari cabang RedBox Tegal. Jam operasional: 10:00-21:00 WIB.`;
  } else if (branch === 'samadikun') {
    systemPrompt += `\n\n# KONTEKS CABANG INI\nKamu melayani customer dari cabang RedBox Samadikun. Jam operasional: 10:00-21:00 WIB.`;
  } else if (branch === 'bypass') {
    systemPrompt += `\n\n# KONTEKS CABANG INI\nKamu melayani customer dari cabang RedBox Bypass (Pusat). Jam operasional: 10:00-22:00 WIB.`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history.length === 0 && name && name !== 'Kak'
      ? [{ role: 'system', content: `Nama customer ini: ${name}. Sapa dengan nama panggilannya.` }]
      : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Timeout 8s — Lambda dalam state sinkron (sebelum res.json) lebih cepat dari post-response
  const openaiCall = openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages, max_tokens: 500, temperature: 0.7 }
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

// ── Foreign Customer Booking Flow ─────────────────────────────────────────────
// Deteksi bahasa asing → booking conversational → kirim summary ke admin

const foreignSessions = new Map(); // phone → { state, language, data, lastActivity }
const FOREIGN_SESSION_TTL = 30 * 60 * 1000; // 30 menit

// Per-branch kapster (barber) names.
// TODO: keep in sync with FALLBACK_BARBERS @ js/main.js (and barbers table in Supabase).
// If a barber is added/removed/moved between outlets, update BOTH places.
const BARBERS_BY_BRANCH = {
  bypass:    ['Bob', 'Dodi', 'Ari', 'Onoy', 'Abdul'],
  samadikun: ['Khamami', 'Opan', 'Sofyan', 'Aden', 'Miftah'],
  csb:       ['Syarif', 'Ubay', 'Ragil', 'Ega', 'Husen', 'Yudha'],
  sumber:    ['Prima', 'Sigit', 'Didi'],
  tegal:     ['Faiz', 'Yafi', 'Epik', 'Wawan', 'Ahmad', 'Sephril']
};

function getKapsterListForBranch(branch) {
  const list = BARBERS_BY_BRANCH[branch] || BARBERS_BY_BRANCH.bypass;
  return list.map(n => `Mas ${n}`);
}

// Flat list across all branches — used for foreign-name extraction fallback only
const ALL_KAPSTER_NAMES = Object.values(BARBERS_BY_BRANCH).flat();

const ADMIN_WA = process.env.ADMIN_WHATSAPP || '6285173100365';

function isForeignLanguage(text) {
  const lower = text.toLowerCase();
  // Indonesian word check
  const indonesianWords = ['mau', 'booking', 'potong', 'rambut', 'harga', 'berapa', 'bisa', 'kapan',
    'hari', 'jam', 'cabang', 'lokasi', 'dimana', 'ada', 'saya', 'aku', 'kak', 'mas',
    'terima kasih', 'makasih', 'tolong', 'bantu', 'info', 'dong', 'ya', 'iya', 'gak',
    'tidak', 'bukan', 'oke', 'siap', 'datang', 'jadi', 'batal'];
  const words = lower.split(/\s+/);
  const indonesianCount = words.filter(w => indonesianWords.some(iw => w.includes(iw))).length;
  if (words.length > 0 && indonesianCount / words.length > 0.3) return false;

  const foreignPatterns = [
    /\b(i want|i need|i would|i'd like|can i|could you|please|thank you|thanks)\b/i,
    /\b(hello|hey|good morning|good afternoon|good evening)\b/i,
    /\b(haircut|hair cut|barber|appointment|schedule|book|reserve)\b/i,
    /\b(how much|what time|when|where|which)\b/i,
    /\b(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(do you|are you|is there|can you|will you)\b/i,
    /\b(my name|i am|i'm)\b/i,
    // Turkish
    /\b(merhaba|selam|berber|randevu|rezervasyon|istiyorum|saç|kesim|tıraş)\b/i,
    // Chinese
    /[\u4e00-\u9fff]/,
    // Japanese
    /[\u3040-\u309f\u30a0-\u30ff]/,
    // Korean
    /[\uac00-\ud7af]/,
    // Arabic
    /[\u0600-\u06ff]/,
    // Thai
    /[\u0e00-\u0e7f]/,
  ];
  return foreignPatterns.some(p => p.test(lower));
}

function detectForeignLanguage(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return 'chinese';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'korean';
  if (/[\u0600-\u06ff]/.test(text)) return 'arabic';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'thai';
  const turkishWords = ['merhaba', 'selam', 'günaydın', 'saç', 'berber', 'randevu',
    'rezervasyon', 'istiyorum', 'lütfen', 'teşekkürler', 'tıraş', 'kesim', 'sakal'];
  const lower = text.toLowerCase();
  if (turkishWords.some(w => lower.includes(w))) return 'turkish';
  return 'english';
}

function getForeignSession(phone) {
  const s = foreignSessions.get(phone);
  if (!s) return null;
  if (Date.now() - s.lastActivity > FOREIGN_SESSION_TTL) { foreignSessions.delete(phone); return null; }
  return s;
}

const SERVICES_EN = `• Gentleman Grooming — IDR 95k (45 min)\n• Hair Spa — IDR 110k (30 min)\n• Hair Color — IDR 160k (45 min)\n• Shaving — IDR 40k (20 min)\n• Men Massage — IDR 145k (45 min)\n• Royal Grooming — IDR 305k (90 min)`;
const SERVICES_ZH = `• Gentleman Grooming — 95k印尼盾 (45分钟)\n• Hair Spa — 110k印尼盾 (30分钟)\n• Hair Color — 160k印尼盾 (45分钟)\n• Shaving — 40k印尼盾 (20分钟)\n• Men Massage — 145k印尼盾 (45分钟)\n• Royal Grooming — 305k印尼盾 (90分钟)`;
const SERVICES_JA = `• Gentleman Grooming — 95kルピア (45分)\n• Hair Spa — 110kルピア (30分)\n• Hair Color — 160kルピア (45分)\n• Shaving — 40kルピア (20分)\n• Men Massage — 145kルピア (45分)\n• Royal Grooming — 305kルピア (90分)`;
const SERVICES_KO = `• Gentleman Grooming — 95k루피아 (45분)\n• Hair Spa — 110k루피아 (30분)\n• Hair Color — 160k루피아 (45분)\n• Shaving — 40k루피아 (20분)\n• Men Massage — 145k루피아 (45분)\n• Royal Grooming — 305k루피아 (90분)`;
const SERVICES_TR = `• Gentleman Grooming — 95k IDR (45 dk)\n• Hair Spa — 110k IDR (30 dk)\n• Hair Color — 160k IDR (45 dk)\n• Shaving — 40k IDR (20 dk)\n• Men Massage — 145k IDR (45 dk)\n• Royal Grooming — 305k IDR (90 dk)`;

function getServicesForLang(lang) {
  if (lang === 'chinese') return SERVICES_ZH;
  if (lang === 'japanese') return SERVICES_JA;
  if (lang === 'korean') return SERVICES_KO;
  if (lang === 'turkish') return SERVICES_TR;
  return SERVICES_EN;
}

function foreignMsg(lang, msgs) {
  return msgs[lang] || msgs['english'] || msgs['en'];
}

async function handleForeignBooking(from, name, text, device, branch = 'bypass') {
  let session = getForeignSession(from);
  const lower = text.toLowerCase().trim();
  const KAPSTER_LIST = getKapsterListForBranch(branch);

  // Cancel commands
  if (['cancel', 'stop', 'nevermind', '取消', 'キャンセル', 'iptal', '취소'].some(k => lower.includes(k))) {
    foreignSessions.delete(from);
    const lang = session?.language || detectForeignLanguage(text);
    const msg = foreignMsg(lang, {
      chinese: '已取消。如需帮助，随时联系我们！😊',
      japanese: 'キャンセルしました。またいつでもお気軽にどうぞ！😊',
      korean: '취소되었습니다. 다시 도움이 필요하시면 연락주세요! 😊',
      turkish: 'İptal edildi. Yardıma ihtiyacınız olursa bize ulaşmaktan çekinmeyin! 😊',
      english: 'Cancelled. Feel free to reach out anytime you need help! 😊'
    });
    return { reply: msg, used: 'foreign_booking' };
  }

  // ── General question handler — works in ANY state ──
  const generalAnswer = handleForeignGeneralQuestion(text, session?.language || detectForeignLanguage(text), session, branch);
  if (generalAnswer) {
    if (session) { session.lastActivity = Date.now(); foreignSessions.set(from, session); }
    return { reply: generalAnswer, used: 'foreign_booking' };
  }

  if (!session) {
    const language = detectForeignLanguage(text);
    session = { state: 'greeting', language, data: {}, lastActivity: Date.now() };
    foreignSessions.set(from, session);

    // Smart extraction: try to detect service + date/time from initial message
    const service = extractForeignService(text);
    const dateTime = extractForeignDateTime(text);

    if (service && dateTime.date && dateTime.time) {
      // Customer gave everything in one message (e.g. "내일 13시에 머리 자르고 싶은데")
      session.data.service = service;
      session.data.date = dateTime.date;
      session.data.time = dateTime.time;
      session.state = 'awaiting_kapster';
      foreignSessions.set(from, session);
      const kapsters = KAPSTER_LIST.join(', ');
      const msg = foreignMsg(language, {
        chinese: `好的！${service}，${dateTime.date} ${dateTime.time}。\n\n您有喜欢的理发师吗？\n可选理发师：${kapsters}\n\n没有偏好就回复"任意" 😊`,
        japanese: `承知しました！${service}、${dateTime.date} ${dateTime.time}ですね。\n\nご希望のバーバーはいますか？\nバーバー一覧：${kapsters}\n\nご希望がなければ「誰でも」と 😊`,
        korean: `알겠습니다! ${service}, ${dateTime.date} ${dateTime.time}이요.\n\n선호하는 바버가 있으신가요?\n바버 목록: ${kapsters}\n\n선호 없으시면 "아무나"라고 답해주세요 😊`,
        turkish: `Harika! ${service}, ${dateTime.date} ${dateTime.time}.\n\nTercih ettiğiniz berber var mı?\nBerberlerimiz: ${kapsters}\n\nTercihiniz yoksa "herhangi biri" 😊`,
        english: `Got it! ${service} on ${dateTime.date} at ${dateTime.time}.\n\nDo you have a preferred barber?\nOur barbers: ${kapsters}\n\nNo preference? Just say "any" 😊`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    if (service && dateTime.date) {
      // Service + date but no time
      session.data.service = service;
      session.data.date = dateTime.date;
      session.state = 'awaiting_time';
      foreignSessions.set(from, session);
      const msg = foreignMsg(language, {
        chinese: `好的！${service}，${dateTime.date}。几点比较方便？\n\n营业时间：10:00-21:00`,
        japanese: `承知しました！${service}、${dateTime.date}ですね。何時がよろしいですか？\n\n営業時間：10:00-21:00`,
        korean: `알겠습니다! ${service}, ${dateTime.date}이요. 몇 시가 좋으시겠습니까?\n\n영업시간: 10:00-21:00`,
        turkish: `Harika! ${service}, ${dateTime.date}. Saat kaçta?\n\nÇalışma saatleri: 10:00-21:00`,
        english: `Got it! ${service} on ${dateTime.date}. What time works for you?\n\nWe're open 10:00-21:00`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    if (service) {
      // Only service detected
      session.data.service = service;
      session.state = 'awaiting_kapster';
      foreignSessions.set(from, session);
      const kapsters = KAPSTER_LIST.join(', ');
      const msg = foreignMsg(language, {
        chinese: `好的！${service} ✂️\n\n您有喜欢的理发师吗？\n可选：${kapsters}\n\n没有偏好就回复"任意" 😊`,
        japanese: `${service}ですね！✂️\n\nご希望のバーバーはいますか？\n一覧：${kapsters}\n\nご希望がなければ「誰でも」と 😊`,
        korean: `${service} 선택하셨습니다! ✂️\n\n선호하는 바버가 있으신가요?\n목록: ${kapsters}\n\n선호 없으시면 "아무나" 😊`,
        turkish: `${service} seçildi! ✂️\n\nTercih ettiğiniz berber var mı?\nListe: ${kapsters}\n\nTercihiniz yoksa "herhangi biri" 😊`,
        english: `${service} — great choice! ✂️\n\nDo you have a preferred barber?\nAvailable: ${kapsters}\n\nNo preference? Just say "any" 😊`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    // No service detected — show full greeting
    const services = getServicesForLang(language);
    const kapsters = KAPSTER_LIST.join(', ');
    const msg = foreignMsg(language, {
      chinese: `你好 ${name}！欢迎来到 RedBox Barbershop ✂️\n\n我们的服务：\n${services}\n\n我们的理发师：${kapsters}\n\n您想预约什么服务呢？直接告诉我就行！`,
      japanese: `こんにちは ${name}さん！RedBox Barbershopへようこそ ✂️\n\nサービス一覧：\n${services}\n\nバーバー：${kapsters}\n\nどのサービスをご希望ですか？お気軽にどうぞ！`,
      korean: `안녕하세요 ${name}님! RedBox Barbershop에 오신 것을 환영합니다 ✂️\n\n서비스 목록:\n${services}\n\n바버: ${kapsters}\n\n어떤 서비스를 원하시나요? 편하게 말씀해주세요!`,
      turkish: `Merhaba ${name}! RedBox Barbershop'a hoş geldiniz ✂️\n\nHizmetlerimiz:\n${services}\n\nBerberlerimiz: ${kapsters}\n\nHangi hizmeti istersiniz? Rahatça söyleyin!`,
      english: `Hello ${name}! Welcome to RedBox Barbershop ✂️\n\nOur Services:\n${services}\n\nOur barbers: ${kapsters}\n\nWhat would you like? Just let me know!`
    });
    return { reply: msg, used: 'foreign_booking' };
  }

  session.lastActivity = Date.now();

  // State machine
  switch (session.state) {
    case 'greeting': {
      // Smart extraction: service + optional date/time from one message
      const service = extractForeignService(text);
      const dateTime = extractForeignDateTime(text);

      if (service && dateTime.date && dateTime.time) {
        session.data.service = service;
        session.data.date = dateTime.date;
        session.data.time = dateTime.time;
        session.state = 'awaiting_kapster';
        foreignSessions.set(from, session);
        const kapsters = KAPSTER_LIST.join(', ');
        const msg = foreignMsg(session.language, {
          chinese: `好的！${service}，${dateTime.date} ${dateTime.time}。\n\n选理发师吧：${kapsters}\n没偏好就说"任意" 😊`,
          japanese: `${service}、${dateTime.date} ${dateTime.time}ですね！\n\nバーバー：${kapsters}\nご希望がなければ「誰でも」と 😊`,
          korean: `${service}, ${dateTime.date} ${dateTime.time} 확인! \n\n바버 선택해주세요: ${kapsters}\n선호 없으시면 "아무나" 😊`,
          turkish: `${service}, ${dateTime.date} ${dateTime.time} tamam!\n\nBerber: ${kapsters}\nTercihiniz yoksa "herhangi biri" 😊`,
          english: `${service} on ${dateTime.date} at ${dateTime.time} — noted!\n\nPick a barber: ${kapsters}\nNo preference? Say "any" 😊`
        });
        return { reply: msg, used: 'foreign_booking' };
      }

      if (service && dateTime.date) {
        session.data.service = service;
        session.data.date = dateTime.date;
        session.state = 'awaiting_time';
        foreignSessions.set(from, session);
        const msg = foreignMsg(session.language, {
          chinese: `好的！${service}，${dateTime.date}。几点？（10:00-21:00）`,
          japanese: `${service}、${dateTime.date}ですね！何時がよろしいですか？（10:00-21:00）`,
          korean: `${service}, ${dateTime.date} 확인! 몇 시가 좋으시겠습니까? (10:00-21:00)`,
          turkish: `${service}, ${dateTime.date} tamam! Saat kaçta? (10:00-21:00)`,
          english: `${service} on ${dateTime.date} — got it! What time? (10:00-21:00)`
        });
        return { reply: msg, used: 'foreign_booking' };
      }

      if (service) {
        session.data.service = service;
        session.state = 'awaiting_kapster';
        foreignSessions.set(from, session);
        const kapsters = KAPSTER_LIST.join(', ');
        const msg = foreignMsg(session.language, {
          chinese: `好的！${service} ✂️ 选理发师吧：${kapsters}\n没偏好就说"任意" 😊`,
          japanese: `${service}ですね！✂️ バーバー：${kapsters}\nご希望がなければ「誰でも」と 😊`,
          korean: `${service} 선택! ✂️ 바버: ${kapsters}\n선호 없으시면 "아무나" 😊`,
          turkish: `${service} seçildi! ✂️ Berber: ${kapsters}\nTercihiniz yoksa "herhangi biri" 😊`,
          english: `${service} — great! ✂️ Pick a barber: ${kapsters}\nNo preference? Say "any" 😊`
        });
        return { reply: msg, used: 'foreign_booking' };
      }

      // Not recognized — ask again gently with examples
      const services = getServicesForLang(session.language);
      const msg = foreignMsg(session.language, {
        chinese: `不好意思，我没有理解您的选择 😅\n\n我们提供这些服务：\n${services}\n\n请告诉我您想要哪个服务，或者有什么问题都可以问我！`,
        japanese: `すみません、ちょっと分かりませんでした 😅\n\nサービス一覧：\n${services}\n\nどのサービスがよろしいですか？何かご質問があればお気軽にどうぞ！`,
        korean: `죄송합니다, 잘 이해하지 못했어요 😅\n\n서비스 목록:\n${services}\n\n어떤 서비스를 원하시나요? 궁금한 점이 있으시면 편하게 물어보세요!`,
        turkish: `Özür dilerim, tam anlayamadım 😅\n\nHizmetlerimiz:\n${services}\n\nHangi hizmeti istersiniz? Sorularınız varsa çekinmeden sorun!`,
        english: `Sorry, I didn't quite get that 😅\n\nHere are our services:\n${services}\n\nWhich one would you like? Feel free to ask any questions!`
      });
      foreignSessions.set(from, session);
      return { reply: msg, used: 'foreign_booking' };
    }

    case 'awaiting_kapster': {
      const kapster = extractForeignKapster(text, branch);
      session.data.kapster = kapster;
      // If we already have date+time from smart extraction, skip to name
      if (session.data.date && session.data.time) {
        session.state = 'awaiting_name';
        foreignSessions.set(from, session);
        const msg = foreignMsg(session.language, {
          chinese: `好的！最后，请确认您的名字。\n\n是 "${name}" 吗？是的话回复"是"`,
          japanese: `了解！最後に、お名前を確認させてください。\n\n「${name}」でよろしいですか？「はい」とどうぞ`,
          korean: `알겠습니다! 마지막으로 성함을 확인할게요.\n\n"${name}"이 맞으시면 "네"라고 답해주세요`,
          turkish: `Tamam! Son olarak adınızı onaylayalım.\n\n"${name}" doğru mu? "evet" yazın`,
          english: `Got it! Lastly, let me confirm your name.\n\nIs it "${name}"? Just say "yes"`
        });
        return { reply: msg, used: 'foreign_booking' };
      }
      session.state = 'awaiting_date';
      foreignSessions.set(from, session);
      const msg = foreignMsg(session.language, {
        chinese: `好的！您想哪天来？\n\n我们每天营业 10:00-21:00\n（例如：明天、周六、6月5日）\n\n也可以直接告诉我日期和时间，比如"明天下午2点"`,
        japanese: `承知しました！いつがよろしいですか？\n\n毎日 10:00-21:00 営業\n（例：明日、土曜日、6月5日）\n\n日時一緒に言っていただいてもOKです 例：「明日14時」`,
        korean: `알겠습니다! 언제 방문하시겠습니까?\n\n매일 10:00-21:00 영업\n(예: 내일, 토요일, 6월 5일)\n\n날짜와 시간을 함께 말씀해주셔도 됩니다 예: "내일 오후 2시"`,
        turkish: `Anlaşıldı! Ne zaman gelmek istersiniz?\n\nHer gün 10:00-21:00 açık\n(örn: yarın, Cumartesi, 5 Haziran)\n\nTarih ve saat birlikte söyleyebilirsiniz: "yarın 14:00"`,
        english: `Got it! When would you like to come?\n\nWe're open daily 10:00-21:00\n(e.g., tomorrow, Saturday, June 5th)\n\nYou can say date and time together like "tomorrow at 2pm"`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    case 'awaiting_date': {
      // Try to extract both date and time from one message
      const dateTime = extractForeignDateTime(text);
      if (dateTime.date && dateTime.time) {
        session.data.date = dateTime.date;
        session.data.time = dateTime.time;
        session.state = 'awaiting_name';
        foreignSessions.set(from, session);
        const msg = foreignMsg(session.language, {
          chinese: `${dateTime.date} ${dateTime.time}，好的！\n\n最后确认一下名字："${name}" 对吗？对的话回复"是"`,
          japanese: `${dateTime.date} ${dateTime.time}ですね！\n\nお名前「${name}」でよろしいですか？「はい」とどうぞ`,
          korean: `${dateTime.date} ${dateTime.time} 확인!\n\n성함 "${name}"이 맞으시면 "네"라고 답해주세요`,
          turkish: `${dateTime.date} ${dateTime.time} tamam!\n\nAdınız "${name}" doğru mu? "evet" yazın`,
          english: `${dateTime.date} at ${dateTime.time} — perfect!\n\nIs your name "${name}"? Say "yes" to confirm`
        });
        return { reply: msg, used: 'foreign_booking' };
      }
      if (dateTime.date) {
        session.data.date = dateTime.date;
      } else {
        session.data.date = text.trim();
      }
      if (dateTime.time) {
        session.data.time = dateTime.time;
        session.state = 'awaiting_name';
        foreignSessions.set(from, session);
        const msg = foreignMsg(session.language, {
          chinese: `好的！${session.data.date} ${dateTime.time}。\n\n名字确认："${name}" 对吗？对就回复"是"`,
          japanese: `${session.data.date} ${dateTime.time}ですね！\n\nお名前「${name}」でOK？「はい」とどうぞ`,
          korean: `${session.data.date} ${dateTime.time} 확인!\n\n"${name}"이 맞으시면 "네"`,
          turkish: `${session.data.date} ${dateTime.time} tamam!\n\n"${name}" doğru mu? "evet"`,
          english: `${session.data.date} at ${dateTime.time} — noted!\n\nIs "${name}" correct? Say "yes"`
        });
        return { reply: msg, used: 'foreign_booking' };
      }
      session.state = 'awaiting_time';
      foreignSessions.set(from, session);
      const msg = foreignMsg(session.language, {
        chinese: `好的，${session.data.date}！几点来？（10:00-21:00）\n例如：14:00、下午2点`,
        japanese: `${session.data.date}ですね！何時がよろしいですか？（10:00-21:00）\n例：14:00、午後2時`,
        korean: `${session.data.date} 확인! 몇 시가 좋으시겠습니까? (10:00-21:00)\n예: 14:00, 오후 2시`,
        turkish: `${session.data.date} tamam! Saat kaçta? (10:00-21:00)\nörn: 14:00`,
        english: `${session.data.date} — got it! What time? (10:00-21:00)\ne.g., 2pm, 14:00`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    case 'awaiting_time': {
      const dateTime = extractForeignDateTime(text);
      session.data.time = dateTime.time || text.trim();
      session.state = 'awaiting_name';
      foreignSessions.set(from, session);
      const msg = foreignMsg(session.language, {
        chinese: `好的！最后确认一下名字："${name}" 对吗？\n\n对的话回复"是"，或者告诉我您的名字`,
        japanese: `了解！お名前「${name}」でよろしいですか？\n\nよければ「はい」、別名なら教えてください`,
        korean: `알겠습니다! 성함 "${name}"이 맞으시면 "네", 아니면 성함을 알려주세요`,
        turkish: `Tamam! Adınız "${name}" doğru mu?\n\nDoğruysa "evet", değilse adınızı yazın`,
        english: `Got it! Is your name "${name}"?\n\nSay "yes" or tell me your name`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    case 'awaiting_name': {
      const isYes = ['yes', 'ya', 'iya', 'ok', '是', '对', 'はい', '네', '예', 'evet', 'tamam', 'doğru', '맞'].some(k => lower.includes(k));
      session.data.customerName = isYes ? name : text.trim();
      session.state = 'confirming';
      foreignSessions.set(from, session);
      const d = session.data;
      const summary = `✂️ ${d.service}\n👤 ${d.customerName}\n💇 ${d.kapster}\n📅 ${d.date}\n🕐 ${d.time}`;
      const msg = foreignMsg(session.language, {
        chinese: `请确认预约信息：\n\n${summary}\n\n确认回复"是"，修改回复"取消"重来`,
        japanese: `ご予約内容：\n\n${summary}\n\n確認→「はい」、やり直し→「キャンセル」`,
        korean: `예약 내용을 확인해주세요:\n\n${summary}\n\n확인: "네" | 취소: "취소"`,
        turkish: `Rezervasyon bilgileri:\n\n${summary}\n\nOnay: "evet" | İptal: "iptal"`,
        english: `Please confirm your booking:\n\n${summary}\n\nSay "yes" to confirm or "cancel" to start over`
      });
      return { reply: msg, used: 'foreign_booking' };
    }

    case 'confirming': {
      const isConfirm = ['yes', 'ya', 'iya', 'ok', 'confirm', 'sure', 'yep', 'yeah',
        '是', '好', '确认', '对', 'はい', '네', '예', '맞습니다', '맞', 'evet', 'onay', 'tamam', 'doğru'].some(k => lower.includes(k));
      if (isConfirm) {
        const d = session.data;
        const langLabel = { chinese: 'Chinese', japanese: 'Japanese', korean: 'Korean', turkish: 'Turkish', english: 'English', arabic: 'Arabic', thai: 'Thai' };
        const adminMsg = [
          `🌍 *BOOKING REQUEST — FOREIGN CUSTOMER*`,
          `─────────────────────────────`,
          `👤 Name     : *${d.customerName}*`,
          `📱 WhatsApp : wa.me/${from}`,
          `🗣️ Language : *${langLabel[session.language] || session.language}*`,
          `✂️ Service  : *${d.service}*`,
          `💇 Barber   : *${d.kapster}*`,
          `📅 Date     : *${d.date}*`,
          `🕐 Time     : *${d.time}*`,
          `─────────────────────────────`,
          `📝 *Action needed:* Please create this booking manually in Moka POS.`,
        ].join('\n');
        sendWA(ADMIN_WA, adminMsg).catch(e => console.error('[WA Bot] Failed to notify admin:', e.message));
        foreignSessions.delete(from);
        const msg = foreignMsg(session.language, {
          chinese: '预约请求已提交！✅\n\n我们的工作人员会尽快确认。如有问题请随时联系！\n\n到时见！✂️😊',
          japanese: '予約リクエスト受付完了！✅\n\nスタッフが確認いたします。ご質問があればお気軽にどうぞ！\n\nお会いできるのを楽しみにしております！✂️😊',
          korean: '예약 요청이 접수되었습니다! ✅\n\n직원이 확인 후 연락드리겠습니다. 궁금한 점 있으시면 언제든 물어보세요!\n\n곧 뵙겠습니다! ✂️😊',
          turkish: 'Rezervasyon talebiniz alındı! ✅\n\nEkibimiz onaylayacak. Sorularınız varsa çekinmeyin!\n\nGörüşmek üzere! ✂️😊',
          english: 'Your booking request has been submitted! ✅\n\nOur staff will confirm shortly. Feel free to ask if you have any questions!\n\nSee you soon! ✂️😊'
        });
        return { reply: msg, used: 'foreign_booking' };
      } else {
        session.state = 'greeting';
        session.data = {};
        foreignSessions.set(from, session);
        const services = getServicesForLang(session.language);
        const msg = foreignMsg(session.language, {
          chinese: `没问题，重新开始吧！\n\n我们的服务：\n${services}\n\n您想要哪个服务？`,
          japanese: `了解、最初からやり直しましょう！\n\nサービス：\n${services}\n\nどれがよろしいですか？`,
          korean: `괜찮습니다, 다시 시작할게요!\n\n서비스:\n${services}\n\n어떤 서비스를 원하시나요?`,
          turkish: `Sorun değil, baştan başlayalım!\n\nHizmetler:\n${services}\n\nHangisini istersiniz?`,
          english: `No problem, let's start fresh!\n\nOur services:\n${services}\n\nWhich one would you like?`
        });
        return { reply: msg, used: 'foreign_booking' };
      }
    }

    default:
      foreignSessions.delete(from);
      return null;
  }
}

// ── General question handler for foreign customers ──
function handleForeignGeneralQuestion(text, lang, session, branch = 'bypass') {
  const lower = text.toLowerCase();
  const KAPSTER_LIST = getKapsterListForBranch(branch);

  // Kapster/barber questions
  const kapsterPatterns = [
    /who.*(available|recommend|good|best|barber)/i,
    /which.*(barber|kapster|stylist|recommend)/i,
    /barber.*(available|who|recommend)/i,
    /누구.*추천/i, /추천.*누구/i, /이발사.*누구/i, /미용사.*누구/i, /누구인가/i, /이용.*가능.*이발/i,
    /가능한.*이발/i, /추천할.*만한/i, /어떤.*바버/i,
    /谁.*推荐/i, /推荐.*谁/i, /哪个.*理发师/i, /理发师.*谁/i, /哪位/i,
    /おすすめ/i, /誰がいい/i, /どのバーバー/i,
    /kim.*tavsiye/i, /berber.*kim/i, /hangisi.*iyi/i,
  ];
  if (kapsterPatterns.some(p => p.test(text))) {
    const kapsters = KAPSTER_LIST.join(', ');
    const currentState = session?.state || 'greeting';
    let suffix = '';
    if (currentState === 'greeting') {
      suffix = foreignMsg(lang, {
        chinese: '\n\n您想预约什么服务呢？',
        japanese: '\n\nどのサービスをご希望ですか？',
        korean: '\n\n어떤 서비스를 예약하시겠습니까?',
        turkish: '\n\nHangi hizmeti istersiniz?',
        english: '\n\nWhat service would you like to book?'
      });
    } else if (currentState === 'awaiting_kapster') {
      suffix = foreignMsg(lang, {
        chinese: '\n\n请选择一位，或说"任意"让我们安排',
        japanese: '\n\nお一人お選びいただくか「誰でも」と',
        korean: '\n\n한 분을 선택하시거나 "아무나"라고 답해주세요',
        turkish: '\n\nBirini seçin veya "herhangi biri" yazın',
        english: '\n\nPick one or say "any" for the best available'
      });
    }
    return foreignMsg(lang, {
      chinese: `我们有以下理发师：${kapsters}\n\n他们都是经验丰富的专业人员，每位都能提供优质服务！如果没有特别偏好，我们会安排当天最空闲的理发师为您服务。${suffix}`,
      japanese: `当店のバーバー一覧：${kapsters}\n\n全員経験豊富なプロです！特にご希望がなければ、当日最も空いているバーバーをご案内します。${suffix}`,
      korean: `저희 바버 목록: ${kapsters}\n\n모두 경험이 풍부한 전문가입니다! 특별한 선호가 없으시면, 당일 가장 여유 있는 바버를 배정해 드립니다.${suffix}`,
      turkish: `Berberlerimiz: ${kapsters}\n\nHepsi deneyimli profesyonellerdir! Tercihiniz yoksa, o gün müsait olan en iyi berberi atayacağız.${suffix}`,
      english: `Our barbers: ${kapsters}\n\nThey're all experienced professionals! If you have no preference, we'll assign the best available barber for your visit.${suffix}`
    });
  }

  // Price/service questions
  const pricePatterns = [
    /how much|price|cost|fee/i,
    /얼마/i, /가격/i, /비용/i,
    /多少钱/i, /价格/i, /费用/i,
    /いくら/i, /料金/i, /値段/i,
    /ne kadar|fiyat|ücret/i,
  ];
  if (pricePatterns.some(p => p.test(text))) {
    const services = getServicesForLang(lang);
    return foreignMsg(lang, {
      chinese: `我们的服务价格：\n\n${services}\n\n想预约哪个呢？`,
      japanese: `料金一覧：\n\n${services}\n\nどれがよろしいですか？`,
      korean: `서비스 가격:\n\n${services}\n\n어떤 서비스를 원하시나요?`,
      turkish: `Fiyat listesi:\n\n${services}\n\nHangisini istersiniz?`,
      english: `Our prices:\n\n${services}\n\nWhich one interests you?`
    });
  }

  // Location questions
  const locationPatterns = [
    /where|location|address|how to get|direction/i,
    /어디/i, /위치/i, /주소/i, /찾아가/i,
    /在哪/i, /地址/i, /位置/i, /怎么走/i,
    /どこ/i, /場所/i, /住所/i, /行き方/i,
    /nerede|adres|konum|nasıl gid/i,
  ];
  if (locationPatterns.some(p => p.test(text))) {
    return foreignMsg(lang, {
      chinese: `RedBox Barbershop 分店位置 📍\n\n• Bypass (旗舰店) — Jl. Bypass Kedawung | 10:00-22:00\n• Samadikun — Jl. Samadikun | 10:00-21:00\n• CSB Mall — 1楼 | 10:00-21:00\n• Sumber — Jl. Raya Sumber | 10:00-21:00\n• Tegal — Jl. Raya Tegal | 10:00-21:00\n\n位于印尼 Cirebon 市`,
      japanese: `RedBox Barbershop 店舗一覧 📍\n\n• Bypass (本店) — Jl. Bypass Kedawung | 10:00-22:00\n• Samadikun — Jl. Samadikun | 10:00-21:00\n• CSB Mall — 1F | 10:00-21:00\n• Sumber — Jl. Raya Sumber | 10:00-21:00\n• Tegal — Jl. Raya Tegal | 10:00-21:00\n\nインドネシア チレボン市`,
      korean: `RedBox Barbershop 지점 안내 📍\n\n• Bypass (본점) — Jl. Bypass Kedawung | 10:00-22:00\n• Samadikun — Jl. Samadikun | 10:00-21:00\n• CSB Mall — 1층 | 10:00-21:00\n• Sumber — Jl. Raya Sumber | 10:00-21:00\n• Tegal — Jl. Raya Tegal | 10:00-21:00\n\n인도네시아 찌르본시에 위치`,
      turkish: `RedBox Barbershop Şubeler 📍\n\n• Bypass (ana) — Jl. Bypass Kedawung | 10:00-22:00\n• Samadikun — Jl. Samadikun | 10:00-21:00\n• CSB Mall — Kat 1 | 10:00-21:00\n• Sumber — Jl. Raya Sumber | 10:00-21:00\n• Tegal — Jl. Raya Tegal | 10:00-21:00\n\nEndonezya, Cirebon`,
      english: `RedBox Barbershop Locations 📍\n\n• Bypass (main) — Jl. Bypass Kedawung | 10:00-22:00\n• Samadikun — Jl. Samadikun | 10:00-21:00\n• CSB Mall — 1st Floor | 10:00-21:00\n• Sumber — Jl. Raya Sumber | 10:00-21:00\n• Tegal — Jl. Raya Tegal | 10:00-21:00\n\nLocated in Cirebon, Indonesia`
    });
  }

  // Hours/time questions
  const hoursPatterns = [
    /what time|open|close|hour|when.*open/i,
    /몇\s*시/i, /영업/i, /운영/i, /언제.*열/i,
    /几点/i, /营业/i, /开门/i, /关门/i,
    /何時/i, /営業/i, /開店/i, /閉店/i,
    /saat kaç|açık|kapalı|çalışma saat/i,
  ];
  if (hoursPatterns.some(p => p.test(text))) {
    return foreignMsg(lang, {
      chinese: `营业时间 🕐\n\n• Bypass 旗舰店：10:00-22:00（每天）\n• 其他分店：10:00-21:00（每天）\n\n全年无休！`,
      japanese: `営業時間 🕐\n\n• Bypass 本店：10:00-22:00（毎日）\n• 他店舗：10:00-21:00（毎日）\n\n年中無休です！`,
      korean: `영업시간 🕐\n\n• Bypass 본점: 10:00-22:00 (매일)\n• 기타 지점: 10:00-21:00 (매일)\n\n연중무휴!`,
      turkish: `Çalışma saatleri 🕐\n\n• Bypass (ana): 10:00-22:00 (her gün)\n• Diğer şubeler: 10:00-21:00 (her gün)\n\nHer gün açığız!`,
      english: `Opening hours 🕐\n\n• Bypass (main): 10:00-22:00 (daily)\n• Other branches: 10:00-21:00 (daily)\n\nWe're open every day!`
    });
  }

  // Payment questions
  const paymentPatterns = [
    /pay|payment|card|cash|credit|debit/i,
    /결제|카드|현금/i,
    /付款|支付|刷卡|现金/i,
    /支払|カード|現金/i,
    /ödeme|kart|nakit/i,
  ];
  if (paymentPatterns.some(p => p.test(text))) {
    return foreignMsg(lang, {
      chinese: `付款方式 💳\n\n我们接受：\n• 现金\n• 信用卡/借记卡\n• QRIS（印尼电子支付）\n\n无需预付，到店付款即可！`,
      japanese: `お支払い方法 💳\n\n• 現金\n• クレジット/デビットカード\n• QRIS（インドネシア電子決済）\n\n事前支払い不要、ご来店時にお支払いください！`,
      korean: `결제 방법 💳\n\n• 현금\n• 신용/체크카드\n• QRIS (인도네시아 전자결제)\n\n선불 불필요, 방문 시 결제하시면 됩니다!`,
      turkish: `Ödeme yöntemleri 💳\n\n• Nakit\n• Kredi/Banka kartı\n• QRIS (Endonezya e-ödeme)\n\nÖn ödeme gerekmez, geldiğinizde ödersiniz!`,
      english: `Payment methods 💳\n\n• Cash\n• Credit/Debit card\n• QRIS (Indonesian e-payment)\n\nNo upfront payment needed — just pay when you visit!`
    });
  }

  return null; // Not a general question
}

// ── Date/Time extraction for smart multi-info parsing ──
function extractForeignDateTime(text) {
  const lower = text.toLowerCase();
  let date = null;
  let time = null;

  // Date patterns
  const datePatterns = [
    { regex: /tomorrow|besok|明天|明日|내일|yarın/i, value: 'tomorrow' },
    { regex: /today|hari ini|今天|今日|오늘|bugün/i, value: 'today' },
    { regex: /next week|minggu depan|下周|来週|다음\s*주|gelecek hafta/i, value: 'next week' },
    { regex: /monday|senin|周一|星期一|月曜|월요일|pazartesi/i, value: 'Monday' },
    { regex: /tuesday|selasa|周二|星期二|火曜|화요일|salı/i, value: 'Tuesday' },
    { regex: /wednesday|rabu|周三|星期三|水曜|수요일|çarşamba/i, value: 'Wednesday' },
    { regex: /thursday|kamis|周四|星期四|木曜|목요일|perşembe/i, value: 'Thursday' },
    { regex: /friday|jumat|周五|星期五|金曜|금요일|cuma/i, value: 'Friday' },
    { regex: /saturday|sabtu|周六|星期六|土曜|토요일|cumartesi/i, value: 'Saturday' },
    { regex: /sunday|minggu|周日|星期日|日曜|일요일|pazar/i, value: 'Sunday' },
    { regex: /(\d{1,2})[\/\-.](\d{1,2})/, value: null }, // will extract below
  ];
  for (const p of datePatterns) {
    if (p.regex.test(lower)) {
      if (p.value) { date = p.value; break; }
      const m = lower.match(p.regex);
      if (m) { date = m[0]; break; }
    }
  }

  // Time patterns — various formats
  const timePatterns = [
    // "13시", "오후 1시", "오후 2시"
    /오후\s*(\d{1,2})\s*시/i,
    /오전\s*(\d{1,2})\s*시/i,
    /(\d{1,2})\s*시/i,
    // "下午2点", "14点"
    /下午\s*(\d{1,2})\s*[点點]/i,
    /上午\s*(\d{1,2})\s*[点點]/i,
    /(\d{1,2})\s*[点點]/i,
    // "午後2時", "14時"
    /午後\s*(\d{1,2})\s*時/i,
    /午前\s*(\d{1,2})\s*時/i,
    /(\d{1,2})\s*時/i,
    // "2pm", "14:00", "2:30pm"
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    /(\d{1,2})\s*(am|pm)/i,
    // "öğleden sonra 2", "saat 14"
    /saat\s*(\d{1,2})/i,
    /(\d{1,2}):(\d{2})/,
  ];

  for (const p of timePatterns) {
    const m = text.match(p);
    if (m) {
      const src = p.source || p.toString();
      if (src.includes('오후') || src.includes('下午') || src.includes('午後') || src.includes('pm')) {
        const h = parseInt(m[1]);
        time = `${h < 12 ? h + 12 : h}:00`;
      } else if (src.includes('오전') || src.includes('上午') || src.includes('午前') || src.includes('am')) {
        time = `${m[1]}:00`;
      } else if (m[2] && /^\d{2}$/.test(m[2]) && !m[3]) {
        // HH:MM format
        time = `${m[1]}:${m[2]}`;
      } else if (m[2] && (m[2].toLowerCase() === 'pm' || m[3]?.toLowerCase() === 'pm')) {
        const h = parseInt(m[1]);
        time = `${h < 12 ? h + 12 : h}:${m[2] && /^\d{2}$/.test(m[2]) ? m[2] : '00'}`;
      } else if (m[2] && (m[2].toLowerCase() === 'am' || m[3]?.toLowerCase() === 'am')) {
        time = `${m[1]}:${m[2] && /^\d{2}$/.test(m[2]) ? m[2] : '00'}`;
      } else {
        const h = parseInt(m[1]);
        time = `${h}:00`;
      }
      break;
    }
  }

  return { date, time };
}

function extractForeignService(text) {
  const lower = text.toLowerCase();
  const map = {
    'gentleman': 'Gentleman Grooming', 'grooming': 'Gentleman Grooming', 'haircut': 'Gentleman Grooming',
    'hair cut': 'Gentleman Grooming', 'cut': 'Gentleman Grooming', 'potong': 'Gentleman Grooming',
    'hair spa': 'Hair Spa', 'spa': 'Hair Spa',
    'color': 'Hair Color', 'colour': 'Hair Color', 'dye': 'Hair Color',
    'shave': 'Shaving', 'shaving': 'Shaving', 'beard': 'Shaving',
    'massage': 'Men Massage Service',
    'royal': 'Royal Grooming',
    // Chinese
    '剪发': 'Gentleman Grooming', '理发': 'Gentleman Grooming', '剪头发': 'Gentleman Grooming',
    '染发': 'Hair Color', '按摩': 'Men Massage Service', '刮胡': 'Shaving',
    // Turkish
    'saç kesimi': 'Gentleman Grooming', 'kesim': 'Gentleman Grooming',
    'tıraş': 'Shaving', 'sakal': 'Shaving', 'masaj': 'Men Massage Service',
    'boya': 'Hair Color', 'saç boyası': 'Hair Color', 'saç bakım': 'Hair Spa',
    // Korean
    '커트': 'Gentleman Grooming', '이발': 'Gentleman Grooming',
    '머리': 'Gentleman Grooming', '자르': 'Gentleman Grooming', '헤어컷': 'Gentleman Grooming',
    '염색': 'Hair Color', '마사지': 'Men Massage Service', '면도': 'Shaving',
    '헤어스파': 'Hair Spa', '로열': 'Royal Grooming',
    // Japanese
    '散髪': 'Gentleman Grooming', 'カット': 'Gentleman Grooming', 'ヘアカット': 'Gentleman Grooming',
    'カラー': 'Hair Color', 'マッサージ': 'Men Massage Service', 'シェービング': 'Shaving',
  };
  for (const [kw, svc] of Object.entries(map)) {
    if (lower.includes(kw)) return svc;
  }
  return null;
}

function extractForeignKapster(text, branch = 'bypass') {
  const lower = text.toLowerCase();
  if (['any', 'anyone', 'no preference', '任意', '誰でも', '아무나', 'herhangi biri', 'fark etmez',
    "doesn't matter", "don't mind", 'doesnt matter'].some(k => lower.includes(k))) {
    return 'Any available';
  }
  // Prefer match within current branch, then fall back to any branch
  const branchList = getKapsterListForBranch(branch);
  const branchMatch = branchList.find(k => lower.includes(k.toLowerCase().replace('mas ', '')));
  if (branchMatch) return branchMatch;
  const anyMatch = ALL_KAPSTER_NAMES.find(n => lower.includes(n.toLowerCase()));
  if (anyMatch) return `Mas ${anyMatch}`;
  return text.trim();
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function handleMessage({ from, name, text, device, receiver, branchFromPayload }) {
  let reply;
  let used = 'openai';
  let error = null;

  // Detect branch from branchFromPayload (deep scan) first, then receiver, then device, then from
  let branch = branchFromPayload;
  if (!branch) {
    branch = detectBranchFromNumber(receiver || device || from);
  }
  console.log('[WA Bot] Branch detection:', { branchFromPayload, receiver, device, from, detectedBranch: branch });
  console.log(`[WA Bot] Detected branch: ${branch} for device: ${device || from}`);

  // ── Foreign customer check — intercept before OpenAI ──
  // If active foreign session exists, continue it
  const existingForeignSession = getForeignSession(from);
  if (existingForeignSession) {
    console.log(`[WA Bot] Foreign session active for ${from}, language: ${existingForeignSession.language}`);
    const result = await handleForeignBooking(from, name, text, device, branch);
    if (result) {
      const sendResult = await sendWA(from, result.reply, { branch });
      return { used: result.used, reply: result.reply, sendResult, error: null };
    }
  }

  // New foreign language detected → start foreign booking flow
  if (isForeignLanguage(text)) {
    console.log(`[WA Bot] Foreign language detected from ${from} (${name}), starting foreign booking flow`);
    const result = await handleForeignBooking(from, name, text, device, branch);
    if (result) {
      const sendResult = await sendWA(from, result.reply, { branch });
      return { used: result.used, reply: result.reply, sendResult, error: null };
    }
  }

  // ── Fast keyword intercept (before OpenAI — deterministic, no hallucination) ──
  const msgLower = text.toLowerCase();
  const msgHas = (kws) => kws.some(k => msgLower.includes(k));

  if (msgHas(['layanan apa', 'service apa', 'ada apa aja', 'ada apa saja', 'menu apa', 'jenis layanan',
               'list layanan', 'apa aja layanan', 'apa saja layanan', 'layanan saja', 'layanan aja',
               'service saja', 'service aja', 'ada layanan', 'ada service'])) {
    const firstName = (name || 'Kak').split(' ')[0];
    const svcText = buildServicesText(branch);
    reply = `Ini layanan lengkap RedBox ${BRANCH_LABEL[branch] || 'Barbershop'} kak 💈\n\n${svcText}\n\nAda yang mau dicoba, ${firstName}? Langsung book di: redboxbarbershop.com/booking.html ✂️`;
    used = 'keyword';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (msgHas(['harga', 'berapa', 'price', 'tarif', 'biaya', 'bayar berapa'])) {
    const svcText = buildServicesText(branch);
    reply = `Ini harga layanan RedBox ${BRANCH_LABEL[branch] || 'Barbershop'} kak 💈\n\n${svcText}\n\nMau langsung lock slot? → redboxbarbershop.com/booking.html ✂️`;
    used = 'keyword';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  try {
    reply = await callOpenAI(from, text, name, branch);
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

  // Gunakan branch-specific token untuk kirim balasan
  const sendResult = await sendWA(from, reply, { branch });
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

      if (req.query.branch_info === '1') {
        const branches = getAvailableBranches();
        pushDebug({ step: 'branch_info', branches });
        return res.status(200).json({ 
          status: 'ok', 
          instance_id: INSTANCE_ID, 
          branches,
          note: 'Add environment variables (e.g., FONNTE_TOKEN_SUMBER) to enable AI bot for specific branches'
        });
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
        const branch = req.query.branch || detectBranchFromNumber(to);
        const normalized = to.replace(/\D/g, '').replace(/^0/, '62');
        if (normalized.length < 10) {
          pushDebug({ step: 'debug_send', to, error: 'invalid_target' });
          return res.status(200).json({ status: 'error', instance_id: INSTANCE_ID, error: 'invalid_target', target: normalized });
        }

        const result = await sendWA(to, msg, { branch });
        if (result && Array.isArray(result.id) && result.id.length > 0) {
          for (let i = 0; i < result.id.length; i++) {
            const msgId = result.id[i];
            const target = Array.isArray(result.target) ? result.target[i] : normalized;
            await persistMessageStatus(msgId, { message_status: result.process || 'queued', target, raw: result });
          }
        }
        pushDebug({ step: 'debug_send', to: String(req.query.send_to), branch, fonnte_result: result });
        return res.status(200).json({ status: 'ok', instance_id: INSTANCE_ID, branch, result });
      }

      return res.status(200).json({
        instance_id: INSTANCE_ID,
        boot_ts: new Date(BOOT_TS).toISOString(),
        received: debugLog,
        note: 'Log ini per-instance (serverless). Kalau kosong, bisa karena request POST masuk ke instance lain.',
      });
    }

    // Get branch token availability
    const branches = getAvailableBranches();
    const activeBranches = Object.entries(branches)
      .filter(([_, info]) => info.available)
      .map(([name, _]) => name);

    return res.status(200).json({
      status: 'ok', service: 'RedBox WA Bot (AI)',
      openai_key_set: openaiReady, 
      fonnte_token_set: fonnteReady,
      multi_branch_support: true,
      branches,
      active_branches: activeBranches,
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
    
    // Cari SEMUA kemungkinan field yang berisi nomor penerima (cabang)
    const possibleReceiverFields = [
      'receiver', 'to', 'receiver_number', 'recipient', 'destination', 
      'target_number', 'me', 'my_number', 'bot_number', 'business_number',
      'wa_number', 'phone_number', 'to_number', 'from_number'
    ];
    let receiver = null;
    for (const field of possibleReceiverFields) {
      if (body[field]) {
        receiver = body[field];
        break;
      }
    }

    // Simpan ke debug log
    pushDebug({ sender, name, type, id, isFromMe: body.isFromMe, fromMe: body.fromMe, device, receiver, message: String(message || '').slice(0, 60) });

    // Log ALL keys and values in body to find any possible receiver/device fields!
    console.log('='.repeat(80));
    console.log('[WA Bot] 🔍 FULL RAW PAYLOAD 🔍');
    console.log('='.repeat(80));
    console.log(JSON.stringify(body, null, 2));
    console.log('='.repeat(80));
    console.log('[WA Bot] Extracted fields:', { sender, name, message, type, device, receiver, id });
    console.log('[WA Bot] All body keys:', Object.keys(body));
    Object.entries(body).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        console.log(`[WA Bot] Nested object at "${key}":`, JSON.stringify(value, null, 2));
      }
    });
    
    // 🔍 Cari nomor cabang di SELURUH payload!
    const BRANCH_WA = {
      bypass: '0818202569',
      samadikun: '0818202589',
      csb: '0818202889',
      sumber: '0818202599',
      tegal: '0818268883'
    };
    const findBranchInPayload = (obj) => {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          for (const [branch, number] of Object.entries(BRANCH_WA)) {
            if (value.includes(number)) {
              console.log(`[WA Bot] 🌟 Found branch "${branch}" in field "${key}" (value: ${value})`);
              return branch;
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          const found = findBranchInPayload(value);
          if (found) return found;
        }
      }
      return null;
    };
    const branchFromPayload = findBranchInPayload(body);
    console.log(`[WA Bot] Branch found from deep payload scan: ${branchFromPayload}`);

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
      // Fonnte TIDAK mengirim field target/to/recipient — gunakan sender sebagai fallback.
      // Untuk admin-reply dari HP: sender = nomor customer (penerima), device = nomor bot.
      // Untuk bot API-sent: sender === device → targetNum === deviceNum → kondisi gagal (aman).
      const rawTarget = body.target || body.to || body.recipient || sender;
      const deviceNum = normalizePhone(device);
      const targetNum = normalizePhone(rawTarget);
      if (targetNum && targetNum.length >= 8 && targetNum !== deviceNum) {
        setHumanTakeoverLocal(targetNum);
        const branchName = detectBranchFromNumber(deviceNum || sender);
        persistHumanTakeover(targetNum, `manual_reply_${branchName}`).catch(() => {});
        console.log(`[WA Bot] Human takeover set for ${targetNum} — admin replied manually from ${branchName} (all branches, 30 min)`);
        pushDebug({ step: 'human_takeover_set', target: targetNum, branch: branchName });
      }
      console.log('[WA Bot] Ignored outgoing message, fields:', JSON.stringify({ isFromMe: body.isFromMe, fromMe: body.fromMe, sender, device, rawTarget }));
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
      // Use branchFromPayload first for media reply
      let branch = branchFromPayload;
      if (!branch) {
        branch = detectBranchFromNumber(receiver || device || sender);
      }
      sendWA(sender, mediaReply, { branch }).catch(() => {});
      return;
    }
    if (!sender || !message) return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    // Admin commands — intercept /ai_off, /ai_on, /ai_status, /ai_help
    if (String(message).trim().startsWith('/ai_')) {
      const handled = await handleAdminCommand(sender, message, device);
      if (handled) {
        pushDebug({ step: 'admin_command', sender, cmd: String(message).slice(0, 30) });
        return res.status(200).json({ status: 'ok', admin_command: true });
      }
    }

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
      pushDebug({ step: 'processing_start', sender, message: message?.slice(0, 40), branchFromPayload });
      const result = await handleMessage({ from: sender, name: name || 'Kak', text: message, device, receiver, branchFromPayload });
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
