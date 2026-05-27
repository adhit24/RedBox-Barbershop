/**
 * Human Handoff Store
 * Menyimpan status percakapan yang sedang ditangani admin manusia
 * Bot akan berhenti merespons selama handoff aktif
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../logs/handoff.json');

// In-memory store with TTL
const handoffCache = new Map();

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _load = () => {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    // Clean expired entries on load
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

const _save = (data) => {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
};

const _persist = () => {
  const data = {};
  const now = Date.now();
  for (const [customerPhone, record] of handoffCache.entries()) {
    if (record.expiresAt > now) {
      data[customerPhone] = record;
    }
  }
  _save(data);
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Aktifkan mode handoff untuk customer (admin mengambil alih)
 * @param {string} customerPhone - nomor WA pelanggan
 * @param {number} durationMinutes - berapa lama handoff aktif (default 30 menit)
 */
const enableHandoff = (customerPhone, durationMinutes = 30) => {
  const record = {
    customerPhone,
    enabledAt: Date.now(),
    expiresAt: Date.now() + (durationMinutes * 60 * 1000),
    enabled: true
  };
  handoffCache.set(customerPhone, record);
  _persist();
  console.log(`[HandoffStore] Handoff enabled for ${customerPhone}, expires in ${durationMinutes}min`);
};

/**
 * Nonaktifkan mode handoff (kembalikan ke AI)
 * @param {string} customerPhone - nomor WA pelanggan
 */
const disableHandoff = (customerPhone) => {
  handoffCache.delete(customerPhone);
  _persist();
  console.log(`[HandoffStore] Handoff disabled for ${customerPhone}`);
};

/**
 * Cek apakah customer sedang dalam mode handoff
 * @param {string} customerPhone - nomor WA pelanggan
 * @returns {boolean}
 */
const isHandoffActive = (customerPhone) => {
  const record = handoffCache.get(customerPhone);
  if (!record) return false;
  
  // Check if expired
  if (Date.now() > record.expiresAt) {
    handoffCache.delete(customerPhone);
    _persist();
    return false;
  }
  
  return true;
};

/**
 * Perpanjang durasi handoff
 * @param {string} customerPhone - nomor WA pelanggan
 * @param {number} additionalMinutes - tambahan menit
 */
const extendHandoff = (customerPhone, additionalMinutes = 30) => {
  const record = handoffCache.get(customerPhone);
  if (record) {
    record.expiresAt = Date.now() + (additionalMinutes * 60 * 1000);
    handoffCache.set(customerPhone, record);
    _persist();
    console.log(`[HandoffStore] Handoff extended for ${customerPhone}, +${additionalMinutes}min`);
  }
};

/**
 * Get semua active handoff (untuk monitoring)
 */
const getAllActive = () => {
  const active = [];
  const now = Date.now();
  for (const [customerPhone, record] of handoffCache.entries()) {
    if (record.expiresAt > now) {
      active.push({
        customerPhone,
        enabledAt: new Date(record.enabledAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
        remainingMinutes: Math.ceil((record.expiresAt - now) / 60000)
      });
    }
  }
  return active;
};

// Initialize on module load
_load();

module.exports = {
  enableHandoff,
  disableHandoff,
  isHandoffActive,
  extendHandoff,
  getAllActive
};
