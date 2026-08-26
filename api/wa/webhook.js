/**
 * Vercel Serverless — POST /api/wa/webhook
 * Fonnte WhatsApp webhook — RedBox Barbershop AI Assistant
 * Powered by OpenAI gpt-4o-mini with per-user conversation memory.
 */

const { sendWA, detectBranchFromNumber } = require('../../server/services/fonnte');
const {
  inspectFonnteWebhookShadow,
  emitFonnteWebhookShadow,
} = require('../../server/services/fonnteWebhookVerifier');
const {
  verifyRedboxWebhookTrustQuery,
  emitRedboxWebhookTrust,
} = require('../../server/services/fonnteWebhookTrustGate');
const { isTrustedIdentity } = require('../../server/identity/trustedIdentity');
const { classifyDeterministically } = require('../../server/orchestrator/routingPolicy');
const executionService = require('../../server/orchestrator/executionService');
const { orchestrateMessage } = require('../../server/orchestrator/orchestratorService');
const { executeReddyAgent } = require('../../server/agents/reddy/reddyAdapter');
const { logOrchestratedEvent } = require('../../server/orchestrator/telemetry');
const {
  issueAuthenticatedWhatsappEvent,
  adaptAuthenticatedWhatsappEvent,
} = require('../../server/identity/whatsappIdentityAdapter');
const { reconcileCustomerNotificationDelivery } = require('../../server/services/bookingNotificationOutbox');
const { STATUS: BOOKING_STATUS, getCustomerBookingStatus } = require('../../server/whatsapp-ai/services/bookingStatusService');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

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
function bookingUrl(branch) {
  const key = ['bypass', 'samadikun', 'csb', 'sumber', 'tegal'].includes(branch) ? branch : 'bypass';
  return `redboxbarbershop.com/booking.html?branch=${key}`;
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

// ── Per-branch AI off-hours schedule ──────────────────────────────────────────
// Bot diam total di luar jam ini. Jam dalam WIB, format "HH:MM".
// AI_ON_FROM ≤ AI_OFF_AT → bot aktif di interval [AI_ON_FROM, AI_OFF_AT).
const BRANCH_AI_HOURS = {
  bypass:    { on_from: '10:00', off_at: '20:30' },
  samadikun: { on_from: '10:00', off_at: '20:30' },
  sumber:    { on_from: '10:00', off_at: '20:30' },
  tegal:     { on_from: '10:00', off_at: '20:30' },
  csb:       { on_from: '10:00', off_at: '21:30' },
};

function isBranchAiOff(branch) {
  const cfg = BRANCH_AI_HOURS[branch];
  if (!cfg) return false;
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const nowMin = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  const toMin = (s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  const onMin = toMin(cfg.on_from);
  const offMin = toMin(cfg.off_at);
  return nowMin < onMin || nowMin >= offMin;
}

// ── Conversation Memory ───────────────────────────────────────────────────────
const conversationCache = new Map(); // sender → [{role, content}]
const MAX_HISTORY = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cacheTimestamps = new Map();

// ── Human Takeover — AI berhenti saat admin balas manual dari HP ──────────────
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
  const sb = getSupabase();
  if (!sb) return false;
  const key = normalizePhone(phone);
  if (!key) return false;
  try {
    const { data } = await sb.from('wa_paused').select('paused_until').eq('sender', key).maybeSingle();
    if (data && data.paused_until) {
      if (new Date(data.paused_until).getTime() > Date.now()) {
        const remainingMs = new Date(data.paused_until).getTime() - Date.now();
        humanTakeoverMap.set(key, Date.now() + remainingMs);
        return true;
      }
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
      .select('sender, paused_until, paused_by')
      .gt('paused_until', new Date().toISOString());
    return data || [];
  } catch {
    return [];
  }
}

async function handleAdminCommand(sender, message, device) {
  const lower = String(message || '').trim().toLowerCase();
  const branch = detectBranchFromNumber(device || sender);

  const senderNorm = normalizePhone(sender).replace(/^0/, '62');
  const ADMIN_NUMBERS = [
    '62818202569', '62818202589', '62818202889', '62818202599', '62818268883',
    '6281234567890', '6285724000000', '6281222000000',
  ];
  const envAdmin = (process.env.WA_ADMIN_NUMBER || '').replace(/\D/g, '');
  if (envAdmin) ADMIN_NUMBERS.push(envAdmin);

  if (!ADMIN_NUMBERS.includes(senderNorm)) {
    console.log('[WA Bot] Non-admin tried command:', senderNorm);
    return false;
  }

  if (lower.startsWith('/ai_off ')) {
    const parts = message.trim().split(/\s+/);
    const target = normalizePhone(parts[1]);
    const minutes = Number(parts[2]) || 30;
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
    console.log('[WA Bot] Authenticated admin pause command completed', { minutes });
    return true;
  }

  if (lower.startsWith('/ai_on ')) {
    const target = normalizePhone(message.trim().split(/\s+/)[1]);
    if (!target || target.length < 8) {
      await sendWA(sender, '❌ Format: /ai_on 628xxxxxxxxxx', { branch });
      return true;
    }
    await clearHumanTakeover(target);
    await sendWA(sender, `✅ AI diaktifkan kembali untuk ${target}\n(berlaku semua cabang)`, { branch });
    console.log('[WA Bot] Authenticated admin resume command completed');
    return true;
  }

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

const processedIds = new Set();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const processedTimestamps = new Map();

function isDuplicate(msgId) {
  if (!msgId) return false;
  const key = String(msgId);
  if (processedIds.has(key)) return true;
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
      if (error === 'timeout') console.warn('[WA Bot] getHistory Supabase timeout');
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

function buildServicesText(branch) {
  const isCsb = branch === 'csb';
  return [
    `• Redbox Gentleman Grooming — Rp ${isCsb ? '120.000' : '95.000'} (45 menit) — potong + fade`,
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

const BARBERS_BY_BRANCH = {
  bypass:    ['Opik', 'Arul', 'Tedi', 'Idan', 'Subhan', 'Tio'],
  samadikun: ['Ipan', 'Eef', 'Yuda', 'Azil', 'Aan'],
  csb:       ['Ozi', 'Jojo', 'Subhan'],
  sumber:    ['Dani', 'Eki', 'Ipul', 'Pikran'],
  tegal:     ['Reza', 'Restu', 'Teguh'],
};
const ALL_KAPSTER_NAMES = Object.values(BARBERS_BY_BRANCH).flat();

function getKapsterListForBranch(branch) {
  return (BARBERS_BY_BRANCH[branch] || BARBERS_BY_BRANCH.bypass).map(n => `Mas ${n}`);
}

function findKapsterMention(text, branch) {
  const lower = text.toLowerCase();
  const branchList = getKapsterListForBranch(branch);
  const branchMatch = branchList.find(k => lower.includes(k.toLowerCase().replace('mas ', '')));
  if (branchMatch) return branchMatch;
  const anyMatch = ALL_KAPSTER_NAMES.find(n => lower.includes(n.toLowerCase()));
  if (anyMatch) return `Mas ${anyMatch}`;
  return text.trim();
}

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
`;
}

function fallbackReply(text, name, branch = 'bypass') {
  const firstName = (name || 'Kak').split(' ')[0];
  const url = bookingUrl(branch);
  return `Halo ${firstName}! Maaf banget nih, koneksi aku lagi sedikit bermasalah 🙏 Buat info layanan & booking langsung, yuk cek di web kita: ${url} ✂️`;
}

async function callOpenAI(sender, userMessage, userName = 'Kak', branch = 'bypass') {
  const apiKey = process.env.REDDY_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[WA Bot] OPENAI_API_KEY not set');
    return fallbackReply(userMessage, userName, branch);
  }

  const history = await getHistory(sender);
  const systemPrompt = buildSystemPrompt(branch);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 350,
    temperature: 0.7,
  });

  const reply = response.choices[0]?.message?.content?.trim();
  if (!reply) throw new Error('Empty response from OpenAI');

  const newHistory = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: reply },
  ].slice(-MAX_HISTORY);

  conversationCache.set(sender, newHistory);
  cacheTimestamps.set(sender, Date.now());
  saveHistoryToSupabase(sender, newHistory).catch(() => {});

  return reply;
}

const foreignSessions = new Map();
const FOREIGN_SESSION_TTL_MS = 30 * 60 * 1000;

function isForeignLanguage(text) {
  const str = String(text || '').trim();
  if (!str) return false;

  const latinLetters = (str.match(/[a-zA-Z]/g) || []).length;
  const nonLatinLetters = (str.match(/[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\u0400-\u04FF\u0E00-\u0E7F]/g) || []).length;
  if (nonLatinLetters > 2 && nonLatinLetters > latinLetters) return true;

  const lower = str.toLowerCase();
  const englishKeywords = [
    'hello', 'hi reddy', 'good morning', 'good afternoon', 'good evening',
    'how much', 'price', 'haircut', 'shave', 'booking', 'appointment',
    'address', 'location', 'open hours', 'what time', 'available',
    'speak english', 'english please', 'can i book', 'i want to book',
  ];

  return englishKeywords.some(kw => lower.includes(kw));
}

function getForeignSession(sender) {
  const session = foreignSessions.get(sender);
  if (!session) return null;
  if (Date.now() - session.updatedAt > FOREIGN_SESSION_TTL_MS) {
    foreignSessions.delete(sender);
    return null;
  }
  return session;
}

async function handleForeignBooking(from, name, text, device, branch) {
  const lower = String(text || '').trim().toLowerCase();
  const existing = getForeignSession(from);

  if (!existing) {
    foreignSessions.set(from, { step: 'awaiting_confirmation', updatedAt: Date.now(), language: 'en' });
    const reply = `Hello! Welcome to RedBox Barbershop 💈\n\n` +
      `We noticed you're messaging in English! Our full service menu and instant appointment booking are available on our website:\n\n` +
      `👉 ${bookingUrl(branch)}\n\n` +
      `Would you like me to guide you on how to book online, or give you our branch address & hours?`;
    return { used: 'foreign_flow', reply };
  }

  if (existing.step === 'awaiting_confirmation') {
    if (/\b(address|location|where|hours|time|open)\b/.test(lower)) {
      foreignSessions.set(from, { ...existing, updatedAt: Date.now() });
      const reply = `📍 RedBox Barbershop (${branch.toUpperCase()} Branch)\n` +
        `Operating Hours: 10:00 AM – 9:00 PM WIB daily.\n` +
        `Walk-ins are welcome, but online booking guarantees your slot without waiting!\n\n` +
        `Book your slot here: ${bookingUrl(branch)} ✂️`;
      return { used: 'foreign_flow', reply };
    }
    foreignSessions.set(from, { ...existing, updatedAt: Date.now() });
    const reply = `You can easily book your appointment online in under 1 minute:\n` +
      `1. Visit ${bookingUrl(branch)}\n` +
      `2. Choose your service & preferred barber\n` +
      `3. Pick your date & time slot\n\n` +
      `See you soon at RedBox! 💈`;
    return { used: 'foreign_flow', reply };
  }

  return null;
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function handleMessage({ from, name, text, device, receiver, branchFromPayload, trustedIdentity = null }) {
  let branch = branchFromPayload;
  if (!branch) {
    branch = detectBranchFromNumber(receiver || device || from);
  }
  console.log('[WA Bot] Branch detected:', { branch, fromPayload: Boolean(branchFromPayload) });

  // 1. Deterministic CRM Points Inquiry Shortcut (0 LLM)
  const classification = classifyDeterministically(text);
  if (classification && classification.intent === 'points_inquiry') {
    const orchResult = await executionService.executeOrchestration(
      {
        intent: 'points_inquiry',
        route: 'crm_agent',
        agent: 'crm_agent',
        action: 'get_points',
        confidence: 1.0,
        model_tier: 'economy',
      },
      { trustedIdentity, supabase: getSupabase() }
    );
    let pointsReply;
    if (orchResult.execution_status === 'unauthorized') {
      pointsReply = 'Halo kak! Untuk mengecek saldo poin member RedBox, pastikan kamu menghubungi kami via nomor terverifikasi ya!';
    } else if (orchResult.execution_status === 'success') {
      const points = orchResult.result?.data?.points_balance ?? 0;
      pointsReply = 'Halo kak! Saldo poin member RedBox kamu saat ini: ' + points + ' poin ✨';
    } else if (orchResult.execution_status === 'customer_not_found') {
      pointsReply = 'Halo kak! Nomor WhatsApp kamu belum terdaftar sebagai member RedBox. Dapatkan poin loyalty di setiap kunjungan cukur kamu!';
    } else {
      pointsReply = 'Halo kak! Saat ini sistem poin sedang tidak dapat diakses. Silakan coba lagi beberapa saat lagi ya!';
    }
    logOrchestratedEvent({
      route: 'crm_agent',
      agent: 'crm_agent',
      intent: 'points_inquiry',
      action: 'get_points',
      confidence: 1.0,
      model_tier: 'none',
      fallback_used: false,
      branch,
      trust_status: trustedIdentity ? 'verified' : 'unverified',
    });
    const sendResult = await sendWA(from, pointsReply, { branch });
    return { used: 'crm_points', reply: pointsReply, sendResult, error: null };
  }

  // 2. Foreign Customer Intercept
  const existingForeignSession = getForeignSession(from);
  if (existingForeignSession) {
    console.log('[WA Bot] Foreign session active:', { language: existingForeignSession.language });
    const result = await handleForeignBooking(from, name, text, device, branch);
    if (result) {
      const sendResult = await sendWA(from, result.reply, { branch });
      return { used: result.used, reply: result.reply, sendResult, error: null };
    }
  }

  if (isForeignLanguage(text)) {
    console.log('[WA Bot] Foreign language detected; starting foreign booking flow');
    const result = await handleForeignBooking(from, name, text, device, branch);
    if (result) {
      const sendResult = await sendWA(from, result.reply, { branch });
      return { used: result.used, reply: result.reply, sendResult, error: null };
    }
  }

  // 3. Central AI Orchestrator Execution
  const orchStart = Date.now();
  let orchDecision = null;
  try {
    orchDecision = await orchestrateMessage({
      message: text,
      channel: 'whatsapp',
      branch,
      trustedIdentity,
    });
  } catch (err) {
    console.warn('[WA Bot] Orchestrator exception:', err.message);
  }
  const latencyMs = Date.now() - orchStart;

  // Handle Human Handoff Route
  if (orchDecision && (orchDecision.route === 'human' || orchDecision.agent === 'human' || orchDecision.intent === 'human_request' || orchDecision.intent === 'complaint')) {
    setHumanTakeoverLocal(from);
    persistHumanTakeover(from, 'orchestrator_human_handoff').catch(() => {});
    logOrchestratedEvent({
      ...orchDecision,
      fallback_used: false,
      latency_ms: latencyMs,
      branch,
      trust_status: trustedIdentity ? 'verified' : 'unverified',
    });
    const handoffReply = 'Pesan Kakak sudah kami teruskan ke admin cabang RedBox. Mohon tunggu sebentar ya, admin akan segera membalas 🙏';
    const sendResult = await sendWA(from, handoffReply, { branch });
    return { used: 'human_handoff', reply: handoffReply, sendResult, error: null };
  }

  // Handle Orchestrated Reddy Agent Route
  if (orchDecision && (orchDecision.route === 'reddy_agent' || orchDecision.agent === 'reddy_agent')) {
    try {
      const reddyExec = await executeReddyAgent({
        from, name, text, device, branch, trustedIdentity,
      }, {
        callOpenAI, sendWA,
      });
      logOrchestratedEvent({
        ...orchDecision,
        fallback_used: false,
        latency_ms: latencyMs,
        branch,
        trust_status: trustedIdentity ? 'verified' : 'unverified',
      });
      return { used: 'reddy_agent', reply: reddyExec.reply, sendResult: reddyExec.sendResult, error: null };
    } catch (err) {
      console.warn('[WA Bot] Reddy execution error, falling back to legacy path:', err.message);
    }
  }

  // 4. Safe Legacy Reddy Fallback
  logOrchestratedEvent({
    route: orchDecision?.route || 'reddy_agent',
    agent: orchDecision?.agent || 'reddy_agent',
    intent: orchDecision?.intent || 'unknown',
    action: orchDecision?.action || 'fallback_unknown',
    confidence: orchDecision?.confidence || 0,
    model_tier: orchDecision?.model_tier || 'none',
    fallback_used: true,
    fallback_reason: 'orchestrator_or_reddy_fallback',
    latency_ms: latencyMs,
    branch,
    trust_status: trustedIdentity ? 'verified' : 'unverified',
  });

  const msgLower = text.toLowerCase();
  const msgHas = (kws) => kws.some(k => msgLower.includes(k));

  const isOtw = /\b(otw|on the way|di jalan|dijalan|lagi jalan|berangkat|telat|terlambat|kesiangan)\b/.test(msgLower);
  const isWalkIn = /\b(walk\s*in|langsung datang|langsung dateng|datang langsung|dateng langsung|tanpa booking|tanpa bookingan)\b/.test(msgLower);
  const isHomeService = /(home\s*service|ke rumah|datang ke rumah|panggil barber|barber ke kantor)/.test(msgLower);
  const isWedding = /(wedding|pernikahan|nikah|pengantin|prewedding|pre-wedding)/.test(msgLower);

  let reply;
  let used = 'openai';
  let error = null;

  if (isHomeService) {
    reply = 'Untuk home service, booking-nya lewat halaman khusus ya kak 😊 redboxbarbershop.com/home-service.html';
    used = 'policy';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (isWedding && /\b(h-?2|2\s*hari|besok|lusa|tomorrow|day after tomorrow)\b/.test(msgLower)) {
    reply = 'Untuk wedding grooming, booking minimal H-3 ya kak supaya tim bisa siapin slot dan kebutuhannya dengan rapi 🙏 Kalau masih H-2, coba hubungi admin untuk dicek kemungkinan khusus.';
    used = 'policy';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (isOtw) {
    const booking = await getCustomerBookingStatus(from, branch, { statuses: ['confirmed'], limit: 5 });
    if (booking.status === BOOKING_STATUS.CONFIRMED) {
      reply = 'Hati-hati di jalan ya kak 😊 Kalau keterlambatan lebih dari 10–15 menit, kabari admin/cabang karena slot bisa perlu disesuaikan.';
    } else {
      reply = `Siap kak. Biar slot dan jamnya aman, cek atau buat booking dulu di ${bookingUrl(branch)} ya ✂️`;
    }
    used = 'policy';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (isWalkIn) {
    reply = `Boleh coba datang langsung kak, tapi slot walk-in belum tentu tersedia ya 😊 Biar lebih aman, cek dan booking lewat ${bookingUrl(branch)}`;
    used = 'policy';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (msgHas(['layanan apa', 'service apa', 'ada apa aja', 'ada apa saja', 'menu apa', 'jenis layanan',
               'list layanan', 'apa aja layanan', 'apa saja layanan', 'layanan saja', 'layanan aja',
               'service saja', 'service aja', 'ada layanan', 'ada service'])) {
    const firstName = (name || 'Kak').split(' ')[0];
    const svcText = buildServicesText(branch);
    reply = `Ini layanan lengkap RedBox ${BRANCH_LABEL[branch] || 'Barbershop'} kak 💈\n\n${svcText}\n\nAda yang mau dicoba, ${firstName}? Langsung book di: ${bookingUrl(branch)} ✂️`;
    used = 'keyword';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  if (msgHas(['harga', 'berapa', 'price', 'tarif', 'biaya', 'bayar berapa'])) {
    const svcText = buildServicesText(branch);
    reply = `Ini harga layanan RedBox ${BRANCH_LABEL[branch] || 'Barbershop'} kak 💈\n\n${svcText}\n\nMau langsung lock slot? → ${bookingUrl(branch)} ✂️`;
    used = 'keyword';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  const _waitWord = /(nunggu|tunggu|ngantri|antri|antre|antrian|antrean)/.test(msgLower);
  const _pastIndicator = /\b(td|tadi|barusan|barusaja|kemarin|kemaren|kmrn|sebelumnya|abis|habis|udh|udah|sudah)\b/.test(msgLower);
  const _beenThere = /(ke\s*sana|kesana|ke\s*sini|kesini|outlet|cabang|tempatnya|tokonya|store)/.test(msgLower);
  if (_waitWord && (_pastIndicator || _beenThere)) {
    reply =
      `Aduh, maaf banget kak udah sempet nunggu kayak gitu 🙏\n\n` +
      `Biar kejadian itu gak keulang, sekarang Redbox udah pakai sistem booking online — ketersediaan kapster live update di web. ` +
      `Jadi kakak tinggal pilih jam yang available, slot terjamin tercatat di sistem tanpa perlu menebak-nebak antrian.\n\n` +
      `Lock jadwalnya di sini ya kak → ${bookingUrl(branch)} ✂️`;
    used = 'keyword';
    const sendResult = await sendWA(from, reply, { branch });
    return { used, reply, sendResult, error: null };
  }

  try {
    reply = await callOpenAI(from, text, name, branch);
  } catch (err) {
    console.warn('[WA Bot] OpenAI error, using fallback:', err.message);
    reply = fallbackReply(text, name, branch);
    used = 'fallback';
    error = err?.message || String(err);
  }

  const sendResult = await sendWA(from, reply, { branch });
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

// ── Webhook Entry Point ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'redbox-wa-webhook' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  let parsedTrustQuery;
  try { parsedTrustQuery = req.query; } catch { parsedTrustQuery = null; }
  const redboxWebhookTrust = verifyRedboxWebhookTrustQuery(parsedTrustQuery);
  emitRedboxWebhookTrust(redboxWebhookTrust);

  try {
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

    const shadowMetadata = inspectFonnteWebhookShadow(rawBody, process.env.FONNTE_WEBHOOK_SECRET);
    emitFonnteWebhookShadow(shadowMetadata);

    let parsedTrustQuery;
    try { parsedTrustQuery = req.query; } catch { parsedTrustQuery = null; }
    const redboxWebhookTrust = verifyRedboxWebhookTrustQuery(parsedTrustQuery, body);
    emitRedboxWebhookTrust(redboxWebhookTrust);

    let trustedIdentity = null;
    if (redboxWebhookTrust && redboxWebhookTrust.status === 'verified') {
      try {
        const eventCap = issueAuthenticatedWhatsappEvent(redboxWebhookTrust, body);
        const identityResult = adaptAuthenticatedWhatsappEvent(eventCap);
        if (identityResult && identityResult.status === 'success' && isTrustedIdentity(identityResult.trustedIdentity)) {
          trustedIdentity = identityResult.trustedIdentity;
        }
      } catch {}
    }

    const statusId = body.id || body.message_id || body.msgid || body.messageId;
    const statusStateId = body.stateid || body.stateId;
    const messageStatus = body.message_status || body.status;
    const statusTarget = body.target || body.to || body.number || body.phone;
    const hasIncomingMessageField = body.message || body.text || body.chat || body.body || body.msg;
    const likelyStatusWebhook = !!messageStatus && (!!statusId || !!statusStateId)
      && !hasIncomingMessageField
      && !body.sender && !body.from && !body.name && !body.pushName;
    const likelyFonnteStatusWebhook = likelyStatusWebhook
      || ((!!statusId || !!statusStateId) && !!body.status && (!!body.stateid || !!body.state) && !hasIncomingMessageField);
    if (likelyFonnteStatusWebhook) {
      if (statusId) {
        cacheMessageStatus(statusId, { message_status: messageStatus, target: statusTarget, reason: body.reason, raw: body });
      }
      const persisted = statusId
        ? await persistMessageStatus(statusId, { message_status: messageStatus, target: statusTarget, reason: body.reason, raw: body })
        : null;
      const delivery = await reconcileCustomerNotificationDelivery(getSupabase(), {
        messageId: statusId,
        stateId: statusStateId,
        status: messageStatus,
        state: body.state,
        target: statusTarget,
        raw: body,
      });
      return res.status(200).json({
        status: 'ok',
        delivery_reconciled: delivery?.matched ?? false,
        delivery_error: delivery?.error || null,
      });
    }

    const sender = body.sender || body.from || body.number || body.phone || body.target;
    const name = body.name || body.pushName || body.senderName;
    const message = body.message || body.text || body.chat || body.body || body.msg;
    const type = body.type || body.msgType || body.messageType;
    const device = body.device || body.device_id || body.deviceId;
    const id = body.id || body.message_id || body.msgid || body.messageId;
    
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
              console.log('[WA Bot] Branch marker found in webhook payload:', { branch });
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
    console.log('[WA Bot] Branch deep-scan completed:', { branch: branchFromPayload || 'not_found' });

    if (isDuplicate(id)) {
      console.log('[WA Bot] Duplicate message ignored');
      return res.status(200).json({ status: 'ignored', reason: 'duplicate' });
    }

    const isFromMe = body.isFromMe === true || body.isFromMe === 1
      || body.is_from_me === true || body.is_from_me === 1
      || body.fromMe === true || body.fromMe === 1
      || (device && sender && String(sender) === String(device));
    if (isFromMe) {
      const rawTarget = body.target || body.to || body.recipient || sender;
      const deviceNum = normalizePhone(device);
      const targetNum = normalizePhone(rawTarget);
      if (targetNum && targetNum.length >= 8 && targetNum !== deviceNum) {
        setHumanTakeoverLocal(targetNum);
        const branchName = detectBranchFromNumber(deviceNum || sender);
        persistHumanTakeover(targetNum, `manual_reply_${branchName}`).catch(() => {});
        console.log('[WA Bot] Human takeover set from manual reply:', { branch: branchName });
      }
      console.log('[WA Bot] Ignored outgoing message');
      return res.status(200).json({ status: 'ignored', reason: 'outgoing' });
    }

    const BRANCH_WA_NORMALIZED = Object.values(BRANCH_WA).map(n => n.replace(/\D/g, '').replace(/^0/, '62'));
    const senderNormalized = normalizePhone(sender).replace(/^0/, '62');
    if (BRANCH_WA_NORMALIZED.includes(senderNormalized)) {
      console.log('[WA Bot] Ignored message from a branch number (bot-to-bot loop prevention)');
      return res.status(200).json({ status: 'ignored', reason: 'from_branch_number' });
    }

    console.log('[WA Bot] Incoming event:', { event_type: shadowMetadata.event_type, hasMessage: Boolean(message) });

    const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'gif', 'ptt'];
    if (type && MEDIA_TYPES.includes(type)) {
      res.status(200).json({ status: 'ok' });
      const mediaReply = type === 'sticker'
        ? `Terima kasih sticker-nya Kak 😄 Ada yang bisa aku bantu? Booking, info layanan, atau tanya harga?`
        : `Maaf Kak, aku belum bisa baca ${type === 'image' ? 'gambar' : type === 'audio' || type === 'ptt' ? 'pesan suara' : 'file'} ya 🙏 Silakan ketik pertanyaan Kakak, aku siap bantu!`;
      let branch = branchFromPayload;
      if (!branch) {
        branch = detectBranchFromNumber(receiver || device || sender);
      }
      sendWA(sender, mediaReply, { branch }).catch(() => {});
      return;
    }
    if (!sender || !message) return res.status(200).json({ status: 'ignored', reason: 'missing fields' });

    if (String(message).trim().startsWith('/ai_')) {
      const handled = await handleAdminCommand(sender, message, device);
      if (handled) {
        return res.status(200).json({ status: 'ok', admin_command: true });
      }
    }

    const humanActive = await isHumanTakeover(sender);
    if (humanActive) {
      console.log('[WA Bot] AI paused — human takeover active');
      return res.status(200).json({ status: 'ignored', reason: 'human_takeover' });
    }

    {
      const branchForHours = branchFromPayload || detectBranchFromNumber(receiver || device || sender);
      if (isBranchAiOff(branchForHours)) {
        console.log('[WA Bot] AI off-hours:', { branch: branchForHours });
        return res.status(200).json({ status: 'ignored', reason: 'branch_ai_off_hours', branch: branchForHours });
      }
    }

    const t0 = Date.now();
    try {
      const result = await handleMessage({ from: sender, name: name || 'Kak', text: message, device, receiver, branchFromPayload, trustedIdentity });
      const ms = Date.now() - t0;
      console.log('[WA Bot] Processing completed:', { ms, used: result?.used || null, success: !result?.error });
    } catch (err) {
      console.error('[WA Bot] Process error:', err.message);
    }

    if (!res.headersSent) res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WA Bot] Fatal error:', err.message);
    if (!res.headersSent) res.status(200).json({ status: 'error' });
  }
};
