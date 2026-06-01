/**
 * Human Handoff Store — Cross-Branch AI Override
 * 
 * Ketika admin/manusia membalas chat customer secara manual,
 * AI bot akan OFF selama 30 menit untuk customer tersebut.
 * 
 * Berlaku di SEMUA CABANG — menggunakan Supabase wa_paused table
 * sebagai shared state (sama dengan Fonnte webhook system).
 * 
 * Local file masih dipakai sebagai fallback jika Supabase tidak tersedia.
 * 
 * DDL (sudah ada di Supabase):
 *   create table if not exists wa_paused (
 *     sender text primary key,
 *     paused_until timestamptz not null,
 *     paused_at timestamptz default now(),
 *     paused_by text default 'unknown'
 *   );
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../logs/handoff.json');

// In-memory store with TTL
const handoffCache = new Map();

// Supabase client (lazy init)
let supabaseClient = null;

function _getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(url, key);
    return supabaseClient;
  } catch {
    return null;
  }
}

function _normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ─── File-based fallback ──────────────────────────────────────────────────────

const _loadFile = () => {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const now = Date.now();
    const cleaned = {};
    for (const [customerPhone, record] of Object.entries(data)) {
      if (record.expiresAt > now) {
        cleaned[customerPhone] = record;
        handoffCache.set(customerPhone, record);
      }
    }
    return cleaned;
  } catch {
    return {};
  }
};

const _saveFile = (data) => {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[HandoffStore] File save error:', e.message);
  }
};

const _persistFile = () => {
  const data = {};
  const now = Date.now();
  for (const [customerPhone, record] of handoffCache.entries()) {
    if (record.expiresAt > now) {
      data[customerPhone] = record;
    }
  }
  _saveFile(data);
};

// ─── Supabase persistence (shared across all branches) ───────────────────────

async function _persistSupabase(customerPhone, durationMinutes, pausedBy) {
  const sb = _getSupabase();
  if (!sb) return;
  const key = _normalizePhone(customerPhone);
  if (!key) return;
  const pausedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  try {
    await sb.from('wa_paused').upsert(
      { sender: key, paused_until: pausedUntil, paused_at: new Date().toISOString(), paused_by: pausedBy || 'cloud_api' },
      { onConflict: 'sender' }
    );
  } catch (e) {
    console.error('[HandoffStore] Supabase persist error:', e.message);
  }
}

async function _removeSupabase(customerPhone) {
  const sb = _getSupabase();
  if (!sb) return;
  const key = _normalizePhone(customerPhone);
  try {
    await sb.from('wa_paused').delete().eq('sender', key);
  } catch (e) {
    console.error('[HandoffStore] Supabase remove error:', e.message);
  }
}

async function _checkSupabase(customerPhone) {
  const sb = _getSupabase();
  if (!sb) return null;
  const key = _normalizePhone(customerPhone);
  try {
    const { data } = await Promise.race([
      sb.from('wa_paused').select('paused_until,paused_by').eq('sender', key).maybeSingle(),
      new Promise(r => setTimeout(() => r({ data: null }), 2000)),
    ]);
    if (data?.paused_until && new Date(data.paused_until) > new Date()) {
      return data; // return full record so caller can use real paused_until
    }
  } catch {}
  return null;
}

async function _listSupabasePaused() {
  const sb = _getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb
      .from('wa_paused')
      .select('sender,paused_until,paused_at,paused_by')
      .gte('paused_until', new Date().toISOString())
      .order('paused_at', { ascending: false });
    return data || [];
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Aktifkan mode handoff untuk customer (admin mengambil alih)
 * Berlaku di semua cabang via Supabase shared state.
 * @param {string} customerPhone - nomor WA pelanggan
 * @param {number} durationMinutes - berapa lama handoff aktif (default 30 menit)
 * @param {string} pausedBy - siapa yang trigger (e.g. 'admin_bypass', 'status_webhook')
 */
const enableHandoff = (customerPhone, durationMinutes = 30, pausedBy = 'cloud_api') => {
  const record = {
    customerPhone,
    enabledAt: Date.now(),
    expiresAt: Date.now() + (durationMinutes * 60 * 1000),
    enabled: true,
    pausedBy
  };
  handoffCache.set(customerPhone, record);
  _persistFile();
  // Fire-and-forget Supabase persist (cross-branch)
  _persistSupabase(customerPhone, durationMinutes, pausedBy).catch(() => {});
  console.log(`[HandoffStore] Handoff enabled for ${customerPhone} by ${pausedBy}, expires in ${durationMinutes}min (all branches)`);
};

/**
 * Nonaktifkan mode handoff (kembalikan ke AI)
 * Berlaku di semua cabang.
 * @param {string} customerPhone - nomor WA pelanggan
 */
const disableHandoff = (customerPhone) => {
  handoffCache.delete(customerPhone);
  _persistFile();
  // Fire-and-forget Supabase remove (cross-branch)
  _removeSupabase(customerPhone).catch(() => {});
  console.log(`[HandoffStore] Handoff disabled for ${customerPhone} (all branches)`);
};

/**
 * Cek apakah customer sedang dalam mode handoff
 * Cek local cache dulu, lalu fallback ke Supabase (cross-branch/cross-instance).
 * @param {string} customerPhone - nomor WA pelanggan
 * @returns {boolean}
 */
const isHandoffActive = (customerPhone) => {
  // 1. Local cache check (fast path)
  const record = handoffCache.get(customerPhone);
  if (record) {
    if (Date.now() > record.expiresAt) {
      handoffCache.delete(customerPhone);
      _persistFile();
      return false;
    }
    return true;
  }
  return false;
};

/**
 * Async version — also checks Supabase for cross-branch/cross-instance override.
 * Use this in async contexts for complete cross-branch check.
 * @param {string} customerPhone - nomor WA pelanggan
 * @returns {Promise<boolean>}
 */
const isHandoffActiveAsync = async (customerPhone) => {
  // 1. Local cache check (fast)
  if (isHandoffActive(customerPhone)) return true;

  // 2. Cross-branch check via Supabase
  const supabaseRecord = await _checkSupabase(customerPhone);
  if (supabaseRecord) {
    // Warm local cache using the real paused_until from Supabase (not a hardcoded 30min)
    const record = {
      customerPhone,
      enabledAt: Date.now(),
      expiresAt: new Date(supabaseRecord.paused_until).getTime(),
      enabled: true,
      pausedBy: supabaseRecord.paused_by || 'cross_branch'
    };
    handoffCache.set(customerPhone, record);
    console.log(`[HandoffStore] Cross-branch handoff detected for ${customerPhone}`);
    return true;
  }
  return false;
};

/**
 * Perpanjang durasi handoff
 * @param {string} customerPhone - nomor WA pelanggan
 * @param {number} additionalMinutes - tambahan menit
 */
const extendHandoff = (customerPhone, additionalMinutes = 30) => {
  const record = handoffCache.get(customerPhone);
  if (record) {
    // Extend from current expiry (or now, whichever is later) — don't overwrite remaining time
    record.expiresAt = Math.max(record.expiresAt, Date.now()) + (additionalMinutes * 60 * 1000);
    handoffCache.set(customerPhone, record);
    _persistFile();
    _persistSupabase(customerPhone, additionalMinutes, record.pausedBy || 'extend').catch(() => {});
    console.log(`[HandoffStore] Handoff extended for ${customerPhone}, +${additionalMinutes}min (all branches)`);
  }
};

/**
 * Get semua active handoff (untuk monitoring).
 * Combines local cache + Supabase data.
 */
const getAllActive = async () => {
  // Try Supabase first for complete cross-branch view
  const supabaseList = await _listSupabasePaused();
  if (supabaseList) {
    return supabaseList.map(r => ({
      customerPhone: r.sender,
      pausedAt: r.paused_at,
      expiresAt: r.paused_until,
      remainingMinutes: Math.ceil((new Date(r.paused_until).getTime() - Date.now()) / 60000),
      pausedBy: r.paused_by || 'unknown'
    }));
  }

  // Fallback to local cache
  const active = [];
  const now = Date.now();
  for (const [customerPhone, record] of handoffCache.entries()) {
    if (record.expiresAt > now) {
      active.push({
        customerPhone,
        enabledAt: new Date(record.enabledAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
        remainingMinutes: Math.ceil((record.expiresAt - now) / 60000),
        pausedBy: record.pausedBy || 'unknown'
      });
    }
  }
  return active;
};

// Initialize on module load
_loadFile();

module.exports = {
  enableHandoff,
  disableHandoff,
  isHandoffActive,
  isHandoffActiveAsync,
  extendHandoff,
  getAllActive
};
