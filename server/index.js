 // ================================================
// REDBOX BARBERSHOP — Express API Server
// Backend: Node.js + MySQL (XAMPP) / Supabase
// ================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const mysql = require('mysql2/promise');
const { syncBookingToAirtable, updateBookingInAirtable, fetchBarbersFromAirtable, isBarbersConfigured, getBarbersTableName } = require('./airtable');

const app  = express();
const PORT = process.env.PORT || 3001;
const DB_TYPE = process.env.DATABASE_TYPE || 'supabase';

// Returns YYYY-MM-DD in local (server) timezone — avoids UTC shift near midnight
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ================================================
// MOKA POS INTEGRATION (DRAFT)
// ================================================
const MOKA_BASE_URL  = String(process.env.MOKA_BASE_URL || '').trim();
const MOKA_API_KEY   = String(process.env.MOKA_API_KEY || '').trim();
const MOKA_OUTLET_ID = String(process.env.MOKA_OUTLET_ID || '').trim();

function isMokaConfigured() {
  return Boolean(MOKA_BASE_URL && MOKA_API_KEY && MOKA_OUTLET_ID);
}

async function mokaRequest(pathname, { method = 'GET', body } = {}) {
  if (!isMokaConfigured()) {
    const err = new Error('MOKA not configured');
    err.code = 'MOKA_NOT_CONFIGURED';
    throw err;
  }

  // TODO: isi API MOKA di sini (endpoint + auth scheme mengikuti dokumentasi MOKA)
  const url = `${MOKA_BASE_URL}${pathname}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MOKA_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'follow',
  });

  const text = await resp.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!resp.ok) {
    const err = new Error('MOKA API request failed');
    err.status = resp.status;
    err.details = data;
    throw err;
  }

  return data;
}

function toE164Indonesia(waDigits) {
  const raw = String(waDigits || '').trim().replace(/[^\d]/g, '');
  if (!raw) return '';
  if (raw.startsWith('62')) return `+${raw}`;
  if (raw.startsWith('0')) return `+62${raw.slice(1)}`;
  return `+62${raw}`;
}

function bookingTimeIso({ date, time }) {
  const d = String(date || '').trim();
  const t = String(time || '').trim().slice(0, 5);
  if (!d || !t) return '';
  return `${d}T${t}:00+07:00`;
}

async function mokaUpsertCustomerFromBooking(booking) {
  const customerPayload = {
    customer_name: String(booking?.name || '').trim(),
    phone: toE164Indonesia(booking?.wa),
    email: String(booking?.email || '').trim() || undefined,
    external_ref: String(booking?.id || '').trim(),
    notes: 'Customer dari website booking',
  };

  // TODO: isi API MOKA di sini (buat/update customer sesuai docs)
  const result = await mokaRequest('/customers', { method: 'POST', body: customerPayload });
  const mokaCustomerId = result?.customer_id || result?.id || result?.data?.id || null;
  return { result, moka_customer_id: mokaCustomerId, payload: customerPayload };
}

async function mokaCreateTransactionFromBooking(booking, mokaCustomerId) {
  const items = [
    {
      sku: String(booking?.service_id || 'SRV').trim() || 'SRV',
      name: String(booking?.service || '').trim(),
      qty: 1,
      price: Number(booking?.price || 0),
    },
  ];

  const payload = {
    outlet_id: MOKA_OUTLET_ID,
    external_ref: String(booking?.id || '').trim(),
    booking_time: bookingTimeIso({ date: booking?.date, time: booking?.time }),
    customer: {
      customer_id: mokaCustomerId || undefined,
      customer_name: String(booking?.name || '').trim(),
      phone: toE164Indonesia(booking?.wa),
    },
    items,
    amounts: {
      subtotal: Number(booking?.price || 0),
      discount: 0,
      tax: 0,
      total: Number(booking?.price || 0),
    },
    notes: [
      `Booking via website`,
      booking?.barber_name ? `Barber: ${booking.barber_name}` : (booking?.barber_id ? `Barber ID: ${booking.barber_id}` : ''),
      booking?.location ? `Location: ${booking.location}` : '',
      booking?.payment ? `Payment: ${booking.payment}` : '',
      booking?.notes ? `Notes: ${booking.notes}` : '',
    ].filter(Boolean).join('. '),
    status: 'CONFIRMED',
  };

  // TODO: isi API MOKA di sini (buat transaksi sesuai docs)
  const result = await mokaRequest('/transactions', { method: 'POST', body: payload });
  const mokaTransactionId = result?.transaction_id || result?.id || result?.data?.id || null;
  return { result, moka_transaction_id: mokaTransactionId, payload };
}

async function pushConfirmedBookingToMoka(booking) {
  if (!isMokaConfigured()) return { ok: false, skipped: true, reason: 'not_configured' };
  const customer = await mokaUpsertCustomerFromBooking(booking);
  const trx = await mokaCreateTransactionFromBooking(booking, customer.moka_customer_id);
  return { ok: true, customer, transaction: trx };
}

// ── Rate Limiting ────────────────────────────────
// Simple in-memory rate limiter (no extra dependency needed)
const rateLimitMap = new Map();
function rateLimit({ windowMs = 60000, max = 10 } = {}) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${ip}`;
    const record = rateLimitMap.get(key) || { count: 0, start: now };

    if (now - record.start > windowMs) {
      record.count = 1;
      record.start = now;
    } else {
      record.count++;
    }
    rateLimitMap.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' });
    }
    next();
  };
}
// Cleanup map setiap 5 menit agar tidak memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) {
    if (now - v.start > 120000) rateLimitMap.delete(k);
  }
}, 300000);

// ── Database Setup ──────────────────────────────
let supabase = null;
let mysqlPool = null;

function buildGvizCsvUrl(inputUrl) {
  const u = String(inputUrl || '').trim();
  const m = u.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return u;
  const id = m[1];
  const gidMatch = u.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : (id === '1QKcxyKV8gHLJzQtN2s_3pMsVMvRS8kgNBYRV8k1S74c' ? '784726083' : '0');
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else { cur += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
      else { cur += ch; }
    }
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function slugify(input) {
  return String(input || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 45);
}
function normName(input) {
  return String(input || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, ' ');
}
function branchSlug(input) {
  const v = String(input || '').trim().toLowerCase();
  if (v.includes('bypass')) return 'bypass';
  if (v.includes('samad')) return 'samadikun';
  if (v.includes('csb')) return 'csb';
  if (v.includes('sumber')) return 'sumber';
  if (v.includes('tegal')) return 'tegal';
  return 'bypass';
}
function isActiveFromStatus(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return true;
  if (v.includes('tidak') || v.includes('non') || v.includes('resign') || v.includes('off')) return false;
  return true;
}
function parseWorkDays(input) {
  const s = String(input || '').trim();
  const map = new Map([
    ['senin','Mon'],['selasa','Tue'],['rabu','Wed'],['kamis','Thu'],['jumat','Fri'],['sabtu','Sat'],['minggu','Sun'],
    ['sunday','Sun'],['monday','Mon'],['tuesday','Tue'],['wednesday','Wed'],['thursday','Thu'],['friday','Fri'],['saturday','Sat'],
    ['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun'],
  ]);
  if (!s) return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const parts = s.split(/[,;/|]+/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) { const val = map.get(p.toLowerCase()); if (val && !out.includes(val)) out.push(val); }
  return out.length ? out : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
}
function normalizeKapsterKey(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function stripKapsterNoise(key) {
  return String(key || '')
    .replace(/(bypass|samadikun|csb|sumber|tegal|cirebon|mall|kota|kab|kabupaten)/g, '')
    .trim();
}

const KAPSTER_IMG_MAP = (() => {
  try {
    const dir = path.join(__dirname, '..', 'Brand_assets', 'kapster');
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name);
    const m = new Map();
    for (const f of files) {
      const key = normalizeKapsterKey(f);
      if (!key) continue;
      if (!m.has(key)) m.set(key, `/Brand_assets/kapster/${f}`);
    }
    return m;
  } catch {
    return new Map();
  }
})();

function normalizeDriveUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const isUrl = /https?:\/\//i.test(raw);
  const first = isUrl
    ? (raw.split(/[\s,]+/).filter(Boolean)[0] || '')
    : (raw.split(',').map(x => x.trim()).filter(Boolean)[0] || raw);

  if (!first) return '';

  if (!isUrl) {
    const v = first.trim();
    if (/^\/?Brand_assets\//i.test(v)) return v.startsWith('/') ? v : `/${v}`;

    const key = stripKapsterNoise(normalizeKapsterKey(v));
    const mapped = KAPSTER_IMG_MAP.get(key);
    return mapped || v;
  }

  const fileMatch = first.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (fileMatch) return `https://lh3.googleusercontent.com/d/${fileMatch[1]}=w800`;
  const openMatch = first.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (openMatch) return `https://lh3.googleusercontent.com/d/${openMatch[1]}=w800`;
  const idMatch = first.match(/[?&]id=([^&]+)/);
  if (idMatch && first.includes('drive.google.com')) return `https://lh3.googleusercontent.com/d/${idMatch[1]}=w800`;
  try {
    const u = new URL(first);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('googleusercontent.com') || host === 'drive.google.com') return first;
  } catch {}
  return first;
}
function placeholderImg(id) {
  const imgs = ['/Brand_assets/Kapster1.jpg','/Brand_assets/Kapster2.jpg','/Brand_assets/Kapster3.jpg','/Brand_assets/Kapster4.jpg'];
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return imgs[h % imgs.length];
}
function parseDurationMins(durStr) {
  if (!durStr) return 60;
  const s = String(durStr).toLowerCase();
  if (s.includes('menit')) { const m = parseInt(s, 10); return Number.isFinite(m) && m > 0 ? m : 60; }
  if (s.includes('jam')) { const h = parseFloat(s); return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 60; }
  const m = parseInt(s, 10);
  return Number.isFinite(m) && m > 0 ? m : 60;
}
function timeToMinsStr(t) {
  const s = String(t || '').slice(0, 8);
  const parts = s.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function normalizeBarberIdInput(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'any') return null;
  return raw;
}

async function hasOverlapMysql({ barberId, date, time, duration, excludeId = null }) {
  if (!mysqlPool) return false;
  if (!barberId || barberId === 'any') return false;
  const newStart = timeToMinsStr(time);
  const newEnd = newStart + parseDurationMins(duration);
  const params = [barberId, date];
  let sql = `SELECT id, TIME_FORMAT(time, '%H:%i') AS time, duration FROM bookings WHERE barber_id = ? AND date = ? AND status != 'cancelled'`;
  if (excludeId) { sql += ` AND id != ?`; params.push(excludeId); }
  const [rows] = await mysqlPool.execute(sql, params);
  return (rows || []).some(b => {
    const bStart = timeToMinsStr(b.time);
    const bEnd = bStart + parseDurationMins(b.duration);
    return (newStart < bEnd) && (bStart < newEnd);
  });
}

// Supabase overlap check menggunakan data dari DB
async function hasOverlapSupabase({ barberId, date, time, duration, excludeId = null }) {
  if (!supabase) return false;
  if (!barberId || barberId === 'any') return false;
  const newStart = timeToMinsStr(time);
  const newEnd = newStart + parseDurationMins(duration);
  let q = supabase.from('bookings').select('id,time,duration').eq('barber_id', barberId).eq('date', date).neq('status', 'cancelled');
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return (data || []).some(b => {
    const bStart = timeToMinsStr(b.time);
    const bEnd = bStart + parseDurationMins(b.duration);
    return (newStart < bEnd) && (bStart < newEnd);
  });
}

async function ensureMysqlBookingSlotKey() {
  if (!mysqlPool) return;
  const dbName = process.env.DB_NAME || 'redbox_db';
  try {
    const [[col]] = await mysqlPool.execute(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'slot_key'`,
      [dbName]
    );
    if (!col?.c) {
      await mysqlPool.execute(`ALTER TABLE bookings ADD COLUMN slot_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN barber_id IS NULL OR barber_id = 'any' OR status = 'cancelled' THEN NULL ELSE CONCAT(barber_id,'|',date,'|',time) END) STORED`);
    }
    const [[idx]] = await mysqlPool.execute(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'uq_bookings_slot_key'`,
      [dbName]
    );
    if (!idx?.c) await mysqlPool.execute(`CREATE UNIQUE INDEX uq_bookings_slot_key ON bookings (slot_key)`);
  } catch (e) { console.warn('MySQL ensure slot_key failed:', e?.message || e); }
}

async function fetchBarbersFromSheet(sheetUrl) {
  const csvUrl = buildGvizCsvUrl(sheetUrl);
  const resp = await fetch(csvUrl, { redirect: 'follow' });
  if (!resp.ok) { const err = new Error('Tidak bisa mengambil data Google Sheets.'); err.details = (await resp.text().catch(() => '')).slice(0, 500); throw err; }
  const csvText = await resp.text();
  const rows = parseCsv(csvText);
  if (!rows.length) return { data: [], sheet: csvUrl };

  const header = rows[0].map(h => String(h || '').trim());
  const headerIndex = new Map(header.map((h, i) => [h, i]));
  const get = (r, col) => { const idx = headerIndex.get(col); return idx === undefined ? '' : (r[idx] ?? ''); };

  const colFull   = 'Nama Lengkap';
  const colNick   = 'Nama Panggilan';
  const colBranch = 'Cabang Tempat Bekerja';
  const colStatus = 'Status Kerja';
  const colDays   = 'Hari Kerja (Yg Pilih Part Time,Abaikan)';
  const colSkill  = 'Keahlian Utama';
  const colPhoto  = 'Upload Foto Diri (Opsional, klo ada yg terbaik ya :) )';

  const usedIds = new Set();
  const data = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const full = String(get(r, colFull) || '').trim();
    const nick = String(get(r, colNick) || '').trim();
    const name = (nick || full).trim();
    if (!name) continue;

    const branch = branchSlug(get(r, colBranch));
    let role = String(get(r, colSkill) || '').trim() || 'Barber';
    role = role.replace(/[,\s]+$/g, '');
    const is_active = isActiveFromStatus(get(r, colStatus));
    const workDays = parseWorkDays(get(r, colDays));
    const imgRaw = normalizeDriveUrl(get(r, colPhoto));

    const base = `${branch}-${slugify(name)}`.slice(0, 50);
    let id = base;
    let n = 2;
    while (usedIds.has(id)) { id = `${base}-${n++}`.slice(0, 50); }
    usedIds.add(id);

    data.push({ id, name, role, img: imgRaw || placeholderImg(id), work_days: workDays, branch, is_active: Boolean(is_active) });
  }

  return { data, sheet: csvUrl };
}

function normalizeBarberRecord(b) {
  return {
    ...b,
    role: String(b?.role || '').trim() || 'Barber',
    branch: branchSlug(b?.branch),
    work_days: Array.isArray(b?.work_days) ? b.work_days : parseWorkDays(b?.work_days),
    img: normalizeDriveUrl(b?.img) || placeholderImg(b?.id),
    is_active: Boolean(b?.is_active),
  };
}

function barberRecordScore(b) {
  let score = 0;
  if (b?.is_active) score += 100;
  if (String(b?.img || '').trim()) score += 10;
  if (String(b?.role || '').trim() && String(b?.role || '').trim().toLowerCase() !== 'barber') score += 5;
  if (Array.isArray(b?.work_days) && b.work_days.length) score += Math.min(b.work_days.length, 7);
  if (String(b?.id || '').trim()) score += 1;
  return score;
}

function dedupeBarberRecords(barbers = []) {
  const byKey = new Map();
  for (const raw of (barbers || [])) {
    const b = normalizeBarberRecord(raw);
    if (!b.id || !b.name) continue;
    const key = `${branchSlug(b.branch)}::${normName(b.name)}`;
    const existing = byKey.get(key);
    if (!existing || barberRecordScore(b) > barberRecordScore(existing)) {
      byKey.set(key, b);
    }
  }
  return Array.from(byKey.values());
}

async function syncBarbersToDatabases(barbers = [], source = 'unknown') {
  const incoming = dedupeBarberRecords(barbers || []).filter(b => b.id && b.name);
  if (!incoming.length) return { source, imported_mysql: 0, imported_supabase: 0, deactivated_demo: 0 };

  let mysqlExisting = [];
  let supaExisting = [];
  if (mysqlPool) {
    const [e] = await mysqlPool.execute('SELECT id, name FROM barbers');
    mysqlExisting = e || [];
  }
  if (supabase) {
    const { data, error } = await supabase.from('barbers').select('id,name');
    if (error) throw new Error(error.message);
    supaExisting = data || [];
  }

  const nameToId = new Map();
  for (const b of supaExisting) nameToId.set(normName(b.name), b.id);
  for (const b of mysqlExisting) nameToId.set(normName(b.name), b.id);

  const usedIds = new Set([...mysqlExisting, ...supaExisting].map(b => b.id));
  const toUpsert = [];
  for (const raw of incoming) {
    const keyName = normName(raw.name);
    let id = String(raw.id || '').trim();
    if (!id) id = nameToId.get(keyName);
    if (!id) {
      const base = `${raw.branch}-${slugify(raw.name)}`.slice(0, 50);
      id = base;
      let n = 2;
      while (usedIds.has(id)) { id = `${base}-${n++}`.slice(0, 50); }
    }
    usedIds.add(id);
    toUpsert.push({ ...raw, id });
  }

  let importedMysql = 0;
  let importedSupabase = 0;
  let supabase_error = null;

  if (mysqlPool) {
    for (const b of toUpsert) {
      await mysqlPool.execute(
        `INSERT INTO barbers (id, name, role, img, work_days, branch, is_active) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), img=VALUES(img), work_days=VALUES(work_days), branch=VALUES(branch), is_active=VALUES(is_active)`,
        [b.id, b.name, b.role, b.img, JSON.stringify(b.work_days), b.branch, b.is_active ? 1 : 0]
      );
      importedMysql++;
    }
  }

  if (supabase) {
    try {
      const stripKey = (rows, key) => rows.map(r => {
        const o = { ...r };
        delete o[key];
        return o;
      });
      let payload = toUpsert;
      for (let attempt = 0; attempt < 4; attempt++) {
        const { error } = await supabase.from('barbers').upsert(payload, { onConflict: 'id' });
        if (!error) { importedSupabase = toUpsert.length; break; }
        const msg = error.message || '';
        const m = msg.match(/Could not find the '([^']+)' column/i);
        if (m?.[1]) {
          payload = stripKey(payload, m[1]);
          continue;
        }
        throw new Error(msg);
      }
    } catch (e) {
      supabase_error = e?.message || 'Supabase sync failed';
    }
  }

  const activeIds = toUpsert.filter(x => x.is_active).map(x => x.id);
  const demoPattern = '^(bypass|samadikun|csb|sumber|tegal)[0-9]+$';
  let deactivatedDemo = 0;
  if (mysqlPool) {
    if (activeIds.length) {
      const placeholders = activeIds.map(() => '?').join(',');
      const [r1] = await mysqlPool.execute(`UPDATE barbers SET is_active = 0 WHERE is_active = 1 AND id REGEXP ? AND id NOT IN (${placeholders})`, [demoPattern, ...activeIds]);
      deactivatedDemo = r1?.affectedRows || 0;
    } else {
      const [r2] = await mysqlPool.execute(`UPDATE barbers SET is_active = 0 WHERE is_active = 1 AND id REGEXP ?`, [demoPattern]);
      deactivatedDemo = r2?.affectedRows || 0;
    }
  }

  return { source, imported_mysql: importedMysql, imported_supabase: importedSupabase, deactivated_demo: deactivatedDemo, supabase_error };
}

async function syncBarbersFromSheet(sheetUrl) {
  const result = await fetchBarbersFromSheet(sheetUrl);
  const synced = await syncBarbersToDatabases(result.data || [], 'google_sheet');
  return { sheet: result.sheet, ...synced };
}

async function syncBarbersFromAirtableSource() {
  if (!isBarbersConfigured()) throw new Error('Airtable kapster belum dikonfigurasi.');
  const result = await fetchBarbersFromAirtable();
  barbersCache = null; // invalidate cache on sync
  return syncBarbersToDatabases(result.data || [], 'airtable');
}

// In-memory cache — valid for 60s (configurable via BARBERS_CACHE_TTL env)
let barbersCache = null; // { data: [], timestamp: number }
const BARBERS_CACHE_TTL_MS = parseInt(process.env.BARBERS_CACHE_TTL || '60') * 1000;

const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

if (DB_TYPE === 'supabase') {
  if (supabaseConfigured) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log('Using Supabase (PostgreSQL)');
} else {
  mysqlPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'redbox_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log('Using MySQL (XAMPP)');
  if (supabaseConfigured) supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  ensureMysqlBookingSlotKey();
  if (process.env.AUTO_SYNC_BARBERS === '1') {
    if (isBarbersConfigured()) {
      syncBarbersFromAirtableSource()
        .then(r => console.log(`Barbers sync (${r.source}): mysql=${r.imported_mysql} supabase=${r.imported_supabase} deactivated_demo=${r.deactivated_demo}`))
        .catch(e => console.warn('Barbers Airtable sync failed:', e?.message || e));
    } else if (process.env.BARBERS_SHEET_URL || process.env.AUTO_SYNC_BARBERS_URL) {
      const u = process.env.AUTO_SYNC_BARBERS_URL || process.env.BARBERS_SHEET_URL;
      syncBarbersFromSheet(u)
        .then(r => console.log(`Barbers sync (${r.source}): mysql=${r.imported_mysql} supabase=${r.imported_supabase} deactivated_demo=${r.deactivated_demo}`))
        .catch(e => console.warn('Barbers sheet sync failed:', e?.message || e));
    }
  }
}

// ── Middleware ──────────────────────────────────
// CORS: izinkan dari localhost dev dan domain production
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Izinkan request tanpa origin (curl, Postman, server-to-server, same-origin GET)
    if (!origin) return callback(null, true);
    // Izinkan origin yang ada di whitelist
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
    // Izinkan Vercel deployment URLs dan domain produksi
    if (origin.endsWith('.vercel.app') || origin.includes('redboxbarbershop.com')) return callback(null, true);
    // Izinkan localhost untuk dev
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

app.use((req, res, next) => {
  try { console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${JSON.stringify(req.body || {})}`); } catch (e) {}
  next();
});

app.use(express.static(path.join(__dirname, '..')));

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/img', async (req, res) => {
  const u = String(req.query.u || '').trim();
  if (!u) return res.status(400).end();
  let url;
  try { url = new URL(u); } catch (e) { return res.status(400).end(); }
  if (url.protocol !== 'https:') return res.status(400).end();
  const host = url.hostname.toLowerCase();
  const allowed = host === 'drive.google.com' || host.endsWith('googleusercontent.com') || host.endsWith('gstatic.com');
  if (!allowed) return res.status(403).end();
  try {
    // If old uc?export=view format, upgrade to lh3 thumbnail URL
    let fetchUrl = url.toString();
    const ucMatch = fetchUrl.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
    if (ucMatch) fetchUrl = `https://lh3.googleusercontent.com/d/${ucMatch[1]}=w800`;

    const r = await fetch(fetchUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(404).end();
    const ct = r.headers.get('content-type') || 'image/jpeg';
    // Reject non-image responses (e.g. Google login page HTML)
    if (!ct.startsWith('image/')) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.end(buf);
  } catch (e) { res.status(502).end(); }
});

// ================================================
// HEALTH CHECK
// ================================================
app.get('/api/health', (req, res) => {
  const airtableConfigured = process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_API_KEY !== 'your_airtable_api_key';
  res.json({ status: 'ok', service: 'Redbox CRM API', db_type: DB_TYPE, airtable: airtableConfigured ? 'connected' : 'not_configured', timestamp: new Date().toISOString() });
});

// ================================================
// BOOKINGS
// ================================================

// GET /api/bookings
app.get('/api/bookings', async (req, res) => {
  const token = req.headers['x-admin-token'];
  const isAdmin = (token === process.env.ADMIN_PASSWORD);

  if (!isAdmin && !req.query.date) return res.status(401).json({ error: 'Admin access required' });

  const { date, barber, barber_id, status, search, limit = 100, offset = 0 } = req.query;
  const bid = barber_id || barber;

  if (DB_TYPE === 'supabase') {
    const tableName = isAdmin ? 'booking_full' : 'bookings';
    const selectCols = isAdmin ? '*' : 'id,date,time,duration,barber_id,status';
    let q = supabase.from(tableName).select(selectCols).order('date', { ascending: false }).order('time', { ascending: true }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (date) q = q.eq('date', date);
    if (bid && bid !== 'all' && bid !== 'any') q = q.eq('barber_id', bid);
    if (status && status !== 'all') q = q.eq('status', status);
    else q = q.neq('status', 'cancelled');
    if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%,service.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [], total: data?.length || 0 });
  } else {
    const selectCols = isAdmin
      ? `b.id, b.customer_id, b.name, b.wa, b.service_id, b.service, b.price, b.duration,
             b.barber_id, DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
             b.location, b.status, b.notes, b.payment, b.created_at, b.updated_at, br.name AS barber_name`
      : `b.id, DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
             b.duration, b.barber_id, b.status`;
    let sql = `SELECT ${selectCols} FROM bookings b LEFT JOIN barbers br ON b.barber_id = br.id WHERE 1=1`;
    const params = [];
    if (date)   { sql += ` AND b.date = ?`; params.push(date); }
    if (bid && bid !== 'all' && bid !== 'any') { sql += ` AND b.barber_id = ?`; params.push(bid); }
    if (status && status !== 'all') { sql += ` AND b.status = ?`; params.push(status); }
    else { sql += ` AND b.status != 'cancelled'`; }
    if (search) { sql += ` AND (b.name LIKE ? OR b.wa LIKE ? OR b.service LIKE ?)`; const s = `%${search}%`; params.push(s, s, s); }

    // Count total untuk pagination
    let countSql = sql.replace(/SELECT[\s\S]+?FROM/, 'SELECT COUNT(*) AS total FROM');
    countSql = countSql.replace(/ORDER BY[\s\S]*$/, '');

    sql += ` ORDER BY b.date DESC, b.time ASC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    try {
      const [rows] = await mysqlPool.execute(sql, params);
      const [countRows] = await mysqlPool.execute(countSql, params.slice(0, params.length - 2));
      res.json({ data: rows, total: countRows[0]?.total || 0 });
    } catch (error) {
      console.error('MySQL Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/bookings — Rate limited: max 10 booking per menit per IP
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment } = req.body;
  const normalizedBarberId = normalizeBarberIdInput(barber_id);

  if (!name || !wa || !service || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields: name, wa, service, date, time' });
  }
  // Validasi format WA (hanya angka, 8-15 digit)
  if (!/^\d{8,15}$/.test(String(wa))) {
    return res.status(400).json({ error: 'Format nomor WhatsApp tidak valid (8-15 angka tanpa kode negara)' });
  }

  const bookingId = randomUUID();

  if (DB_TYPE === 'supabase') {
    try {
      // 1. Cek overlap terlebih dahulu
      if (await hasOverlapSupabase({ barberId: barber_id, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 2. Insert booking
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: price || 0,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: location || 'bypass', notes: notes || '', payment: payment || ''
      }]).select().single();
      if (error) return res.status(500).json({ error: error.message });

      // 3. Upsert customer (Supabase trigger trg_sync_customer hanya jalan saat done;
      //    kita buat/update customer saat booking dibuat agar data tersedia segera)
      await supabase.from('customers').upsert({
        name, wa, visits: 0, total_spent: 0, last_visit: null
      }, { onConflict: 'wa', ignoreDuplicates: true });

      // Sync to Airtable
      syncBookingToAirtable(data);

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Supabase POST Error:', err);
      return res.status(500).json({ error: err.message });
    }
  } else {
    try {
      // 1. Get or Create Customer
      let customerId;
      const [customers] = await mysqlPool.execute('SELECT id FROM customers WHERE wa = ?', [wa]);
      if (customers.length > 0) {
        customerId = customers[0].id;
      } else {
        customerId = randomUUID();
        await mysqlPool.execute('INSERT INTO customers (id, name, wa) VALUES (?, ?, ?)', [customerId, name, wa]);
      }

      // 2. Overlap check
      if (await hasOverlapMysql({ barberId: barber_id, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 3. Insert Booking
      await mysqlPool.execute(
        `INSERT INTO bookings (id, customer_id, name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, customerId, name, wa, service_id || '', service, price || 0, duration || '', normalizedBarberId, date, time, location || 'bypass', notes || '', payment || '']
      );

      const [newBooking] = await mysqlPool.execute(
        `SELECT b.id, b.customer_id, b.name, b.wa, b.service_id, b.service, b.price, b.duration, b.barber_id,
                DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
                b.location, b.status, b.notes, b.payment, b.created_at, b.updated_at
         FROM bookings b WHERE b.id = ?`,
        [bookingId]
      );

      syncBookingToAirtable(newBooking[0]);
      res.status(201).json({ data: newBooking[0] });
    } catch (error) {
      console.error('MySQL Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/booking-status — flat endpoint for cancel/confirm/deny (avoids dynamic-segment routing issues)
app.post('/api/booking-status', adminAuth, async (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase.from('bookings').update({ status }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    updateBookingInAirtable(data);
    return res.json({ data });
  } else {
    try {
      await mysqlPool.execute('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);
      return res.json({ success: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
});

// PATCH /api/bookings/:id  (also accepts POST for proxies that block PATCH)
async function handleBookingUpdate(req, res) {
  const allowed = ['name','wa','service_id','service','price','duration','barber_id','date','time','location','status','notes','payment'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (updates.barber_id !== undefined) updates.barber_id = normalizeBarberIdInput(updates.barber_id);

  if (DB_TYPE === 'supabase') {
    const { data: cur, error: curError } = await supabase.from('bookings').select('id,status').eq('id', req.params.id).single();
    if (curError) return res.status(500).json({ error: curError.message });

    const nextStatus = updates.status !== undefined ? updates.status : cur.status;

    const { data, error } = await supabase.from('bookings').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    updateBookingInAirtable(data);

    let moka = null;
    if (nextStatus === 'confirmed' && cur.status !== 'confirmed') {
      try {
        moka = await pushConfirmedBookingToMoka(data);
      } catch (e) {
        moka = { ok: false, error: e?.message || 'MOKA sync failed' };
      }
    }

    return res.json({ data, moka });
  } else {
    try {
      const [curRows] = await mysqlPool.execute(
        `SELECT id, barber_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, TIME_FORMAT(time, '%H:%i') AS time, duration, status, wa, service, price FROM bookings WHERE id = ?`,
        [req.params.id]
      );
      const cur = curRows?.[0];
      if (!cur) return res.status(404).json({ error: 'Booking not found' });

      const nextStatus   = updates.status    !== undefined ? updates.status    : cur.status;
      const nextBarber   = updates.barber_id !== undefined ? updates.barber_id : cur.barber_id;
      const nextDate     = updates.date      !== undefined ? updates.date      : cur.date;
      const nextTime     = updates.time      !== undefined ? updates.time      : cur.time;
      const nextDuration = updates.duration  !== undefined ? updates.duration  : cur.duration;

      if (nextStatus !== 'cancelled') {
        if (await hasOverlapMysql({ barberId: nextBarber, date: nextDate, time: nextTime, duration: nextDuration, excludeId: req.params.id })) {
          return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
        }
      }

      const keys = Object.keys(updates);
      if (!keys.length) return res.status(400).json({ error: 'No fields to update' });
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id];
      await mysqlPool.execute(`UPDATE bookings SET ${setClause} WHERE id = ?`, values);

      // ── Sync customer saat booking di-done ───────────────────────────────
      // Ekuivalen MySQL dengan trigger trg_sync_customer di Supabase
      if (nextStatus === 'done' && cur.status !== 'done') {
        const wa = updates.wa || cur.wa;
        const serviceName = updates.service || cur.service;
        const bookingPrice = updates.price !== undefined ? Number(updates.price) : Number(cur.price || 0);
        const bookingDate = nextDate;

        const [existCust] = await mysqlPool.execute('SELECT id, visits, total_spent, services FROM customers WHERE wa = ?', [wa]);
        if (existCust.length > 0) {
          const c = existCust[0];
          let services = [];
          try { services = typeof c.services === 'string' ? JSON.parse(c.services) : (Array.isArray(c.services) ? c.services : []); } catch { services = []; }
          if (!services.includes(serviceName)) services.push(serviceName);
          await mysqlPool.execute(
            `UPDATE customers SET visits = visits + 1, total_spent = total_spent + ?, last_visit = GREATEST(COALESCE(last_visit, ?), ?), services = ?, updated_at = NOW() WHERE wa = ?`,
            [bookingPrice, bookingDate, bookingDate, JSON.stringify(services), wa]
          );
        } else {
          // Buat customer baru jika belum ada (seharusnya sudah ada dari POST, tapi sebagai fallback)
          const custId = randomUUID();
          const custName = updates.name || cur.name || '';
          await mysqlPool.execute(
            `INSERT INTO customers (id, name, wa, visits, total_spent, last_visit, services) VALUES (?, ?, ?, 1, ?, ?, ?)`,
            [custId, custName, wa, bookingPrice, bookingDate, JSON.stringify([serviceName])]
          );
        }
      }

      const [updated] = await mysqlPool.execute(
        `SELECT b.id, b.customer_id, b.name, b.wa, b.service_id, b.service, b.price, b.duration, b.barber_id,
                DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
                b.location, b.status, b.notes, b.payment, b.created_at, b.updated_at, br.name AS barber_name
         FROM bookings b LEFT JOIN barbers br ON b.barber_id = br.id WHERE b.id = ?`,
        [req.params.id]
      );
      updateBookingInAirtable(updated[0]);

      let moka = null;
      if (nextStatus === 'confirmed' && cur.status !== 'confirmed') {
        try {
          moka = await pushConfirmedBookingToMoka(updated[0]);
        } catch (e) {
          moka = { ok: false, error: e?.message || 'MOKA sync failed' };
        }
      }

      res.json({ data: updated[0], moka });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}
app.patch('/api/bookings/:id', adminAuth, handleBookingUpdate);
app.post('/api/bookings/:id', adminAuth, handleBookingUpdate);

// DELETE /api/bookings/:id
app.delete('/api/bookings/:id', adminAuth, async (req, res) => {
  if (DB_TYPE === 'supabase') {
    const { error } = await supabase.from('bookings').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Deleted' });
  } else {
    try {
      await mysqlPool.execute('DELETE FROM bookings WHERE id = ?', [req.params.id]);
      res.json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

// GET /api/barbers
app.get('/api/barbers', async (req, res) => {
  if (isBarbersConfigured()) {
    // Serve from cache if still fresh
    if (barbersCache && (Date.now() - barbersCache.timestamp) < BARBERS_CACHE_TTL_MS) {
      res.setHeader('x-barbers-source', 'airtable-cache');
      return res.json({ data: barbersCache.data });
    }
    try {
      const airtableResult = await fetchBarbersFromAirtable();
      const normalized = dedupeBarberRecords(airtableResult.data || []).filter(b => b.is_active);
      if (normalized.length) {
        barbersCache = { data: normalized, timestamp: Date.now() };
        res.setHeader('x-barbers-source', 'airtable');
        return res.json({ data: normalized });
      }
    } catch (airtableError) {
      console.error('Airtable barbers fetch failed:', airtableError?.message || airtableError);
      // Return stale cache rather than wrong DB data
      if (barbersCache) {
        res.setHeader('x-barbers-source', 'airtable-cache-stale');
        return res.json({ data: barbersCache.data });
      }
      return res.status(503).json({ error: 'Data kapster dari Airtable tidak tersedia.', details: airtableError?.message });
    }
  }

  // Fallback ke database hanya jika Airtable tidak dikonfigurasi
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase.from('barbers').select('*').eq('is_active', true);
    if (error) return res.status(500).json({ error: error.message });
    const normalized = dedupeBarberRecords(data || []);
    res.setHeader('x-barbers-source', 'supabase');
    return res.json({ data: normalized });
  } else {
    try {
      const [rows] = await mysqlPool.execute('SELECT * FROM barbers WHERE is_active = 1');
      const normalized = dedupeBarberRecords(rows || []);
      res.setHeader('x-barbers-source', 'mysql');
      res.json({ data: normalized });
    } catch (error) {
      if (process.env.BARBERS_SHEET_URL) {
        try {
          const r = await fetchBarbersFromSheet(process.env.BARBERS_SHEET_URL);
          res.setHeader('x-barbers-source', 'google_sheet');
          return res.json({ data: dedupeBarberRecords(r.data || []).filter(b => b.is_active) });
        } catch (sheetErr) {}
      }
      const details = error?.message || error?.code || String(error || '');
      res.status(503).json({ error: 'Data kapster sedang offline.', details });
    }
  }
});

// GET /api/barbers/:id/availability
app.get('/api/barbers/:id/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase.from('bookings').select('time').eq('barber_id', req.params.id).eq('date', date).neq('status', 'cancelled');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ booked_slots: (data || []).map(b => b.time.slice(0, 5)) });
  } else {
    try {
      const [rows] = await mysqlPool.execute(
        `SELECT TIME_FORMAT(time, '%H:%i') AS time FROM bookings WHERE barber_id = ? AND date = ? AND status != 'cancelled'`,
        [req.params.id, date]
      );
      res.json({ booked_slots: rows.map(b => b.time) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

// GET /api/customers
app.get('/api/customers', adminAuth, async (req, res) => {
  const { search, limit = 100, offset = 0, segment } = req.query;
  const now = new Date();
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const thirtyStr = localDateStr(thirtyDaysAgo);
  const ninetyStr = localDateStr(ninetyDaysAgo);

  if (DB_TYPE === 'supabase') {
    let q = supabase.from('customers').select('*').order('visits', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%`);
    // Segmentasi
    if (segment === 'loyal')  q = q.gte('visits', 5);
    if (segment === 'atrisk') q = q.lt('last_visit', thirtyStr).gte('last_visit', ninetyStr);
    if (segment === 'lost')   q = q.lt('last_visit', ninetyStr);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } else {
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    if (search) { sql += ' AND (name LIKE ? OR wa LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (segment === 'loyal')  { sql += ' AND visits >= 5'; }
    if (segment === 'atrisk') { sql += ' AND last_visit < ? AND last_visit >= ?'; params.push(thirtyStr, ninetyStr); }
    if (segment === 'lost')   { sql += ' AND last_visit < ?'; params.push(ninetyStr); }
    sql += ' ORDER BY visits DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    try {
      const [rows] = await mysqlPool.execute(sql, params);
      res.json({ data: rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

// GET /api/stats
app.get('/api/stats', adminAuth, async (req, res) => {
  const today = localDateStr();
  if (DB_TYPE === 'supabase') {
    const [todayRes, doneRes, pendingRes, custRes] = await Promise.all([
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('date', today).neq('status', 'cancelled'),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'done'),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).in('status', ['pending', 'confirmed']),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
    ]);
    return res.json({ today: todayRes.count || 0, done: doneRes.count || 0, pending: pendingRes.count || 0, customers: custRes.count || 0 });
  } else {
    try {
      const [[t]] = await mysqlPool.execute('SELECT COUNT(*) as count FROM bookings WHERE date = ? AND status != "cancelled"', [today]);
      const [[d]] = await mysqlPool.execute('SELECT COUNT(*) as count FROM bookings WHERE status = "done"');
      const [[p]] = await mysqlPool.execute('SELECT COUNT(*) as count FROM bookings WHERE status IN ("pending", "confirmed")');
      const [[c]] = await mysqlPool.execute('SELECT COUNT(*) as count FROM customers');
      res.json({ today: t.count, done: d.count, pending: p.count, customers: c.count });
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

// ================================================
// REVENUE REPORT
// ================================================
// GET /api/revenue?period=week|month|year&branch=all|bypass|...&barber_id=all|id
app.get('/api/revenue', adminAuth, async (req, res) => {
  const { period = 'month', branch, barber_id } = req.query;
  const now = new Date();
  let dateFrom;
  if (period === 'week')  { dateFrom = new Date(now); dateFrom.setDate(dateFrom.getDate() - 7); }
  else if (period === 'year') { dateFrom = new Date(now); dateFrom.setFullYear(dateFrom.getFullYear() - 1); }
  else { dateFrom = new Date(now); dateFrom.setMonth(dateFrom.getMonth() - 1); } // default: month
  const fromStr = localDateStr(dateFrom);
  const toStr = localDateStr(now);

  if (DB_TYPE === 'supabase') {
    let q = supabase.from('booking_full').select('price,barber_id,barber_name,location,date,service').eq('status', 'done').gte('date', fromStr).lte('date', toStr);
    if (branch && branch !== 'all') q = q.eq('location', branch);
    if (barber_id && barber_id !== 'all') q = q.eq('barber_id', barber_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(buildRevenueReport(data || [], fromStr, toStr));
  } else {
    try {
      let sql = `
        SELECT b.price, b.barber_id, br.name AS barber_name, b.location, DATE_FORMAT(b.date,'%Y-%m-%d') AS date, b.service
        FROM bookings b LEFT JOIN barbers br ON b.barber_id = br.id
        WHERE b.status = 'done' AND b.date BETWEEN ? AND ?`;
      const params = [fromStr, toStr];
      if (branch && branch !== 'all')   { sql += ' AND b.location = ?'; params.push(branch); }
      if (barber_id && barber_id !== 'all') { sql += ' AND b.barber_id = ?'; params.push(barber_id); }
      const [rows] = await mysqlPool.execute(sql, params);
      res.json(buildRevenueReport(rows, fromStr, toStr));
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

function buildRevenueReport(rows, fromStr, toStr) {
  const total = rows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const byBarber = {};
  const byBranch = {};
  const byDate = {};
  for (const r of rows) {
    const price = Number(r.price) || 0;
    const barberKey = r.barber_name || r.barber_id || 'Unknown';
    const branchKey = r.location || 'Unknown';
    const dateKey = String(r.date).slice(0, 10);
    byBarber[barberKey] = (byBarber[barberKey] || 0) + price;
    byBranch[branchKey] = (byBranch[branchKey] || 0) + price;
    byDate[dateKey]     = (byDate[dateKey] || 0) + price;
  }
  return {
    total,
    count: rows.length,
    period: { from: fromStr, to: toStr },
    by_barber: Object.entries(byBarber).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue),
    by_branch: Object.entries(byBranch).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue),
    by_date: Object.entries(byDate).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// POST /api/admin/sync-barbers
app.post('/api/admin/sync-barbers', adminAuth, async (req, res) => {
  try {
    let result;
    if (req.body?.source === 'sheet') {
      const sheetUrl = req.body?.sheetUrl || process.env.BARBERS_SHEET_URL;
      if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl wajib diisi untuk source=sheet' });
      result = await syncBarbersFromSheet(sheetUrl);
    } else if (isBarbersConfigured()) {
      result = await syncBarbersFromAirtableSource();
    } else if (process.env.BARBERS_SHEET_URL) {
      result = await syncBarbersFromSheet(process.env.BARBERS_SHEET_URL);
    } else {
      return res.status(400).json({ error: 'Airtable kapster belum dikonfigurasi.' });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e?.message || 'Sync failed' }); }
});

// ── MOKA INTEGRATION ROUTER ──────────────────────────────
// Registers: /api/availability, /api/reservations, /api/schedules,
//            /api/outlets, /api/services, /api/moka/*
// Now works with or without Supabase (in-memory fallback)
const { createInMemorySupabase } = require('./moka/memoryStore');
const mokaSupabase = supabase || createInMemorySupabase();

try {
  const createMokaRouter = require('./moka/routes');
  const { startCronJobs } = require('./moka/sync');
  app.use('/api', createMokaRouter(mokaSupabase));
  console.log('✅ Moka integration routes mounted');
  if (supabase) startCronJobs(supabase);
} catch (e) {
  console.error('❌ Failed to load Moka integration:', e.message);
}

// START SERVER
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🔴 REDBOX CRM API running at http://localhost:${PORT}`);
    console.log(`📋 Database: ${DB_TYPE}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health\n`);
  });
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
