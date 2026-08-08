  // ================================================
// REDBOX BARBERSHOP — Express API Server
// Backend: Node.js + MySQL (XAMPP) / Supabase
// ================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
// Node < 22 lacks a global WebSocket, which @supabase/realtime-js requires. Polyfill with `ws`.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (_) { /* ws optional */ }
}
const fs = require('fs');
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const mysql = require('mysql2/promise');
// NOTE: Airtable dependency removed - using Supabase as primary source for barbers
const { notifyCustomerBookingConfirmed, notifyAdminNewBooking, notifyCustomerReviewRequest, notifyCustomerReviewPointsCredited } = require('./services/waNotification');
const { enqueueCustomerNotification, markCustomerNotificationSent, processCustomerNotificationOutbox } = require('./services/bookingNotificationOutbox');
const { sendPushToUser, sendPushToBranch } = require('./services/webPush');
const { onBookingCompleted } = require('./services/barberMetrics');
const { membershipStateForSync, isActiveMembership } = require('./membership-policy');

const app  = express();
const PORT = process.env.PORT || 3001;
const DB_TYPE = process.env.DATABASE_TYPE || 'supabase';

// Vercel is the only trusted reverse-proxy hop in production. Outside Vercel,
// Express ignores client-supplied forwarding headers and uses the socket IP.
app.set('trust proxy', process.env.VERCEL === '1' ? 1 : false);

// Returns YYYY-MM-DD in local (server) timezone — avoids UTC shift near midnight
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ================================================
// MOKA POS INTEGRATION (DRAFT)
// ================================================
const MOKA_API_BASE = String(process.env.MOKA_API_BASE || process.env.MOKA_BASE_URL || '').trim() || 'https://api.mokapos.com';
const MOKA_ACCESS_TOKEN = String(process.env.MOKA_ACCESS_TOKEN || process.env.MOKA_API_KEY || '').trim();
const MOKA_OUTLET_ID = String(process.env.MOKA_OUTLET_ID || '').trim();
const MOKA_OUTLET_ID_BYPASS = String(process.env.MOKA_OUTLET_ID_BYPASS || '').trim();
const MOKA_PUSH_ON_BOOKING = String(process.env.MOKA_PUSH_ON_BOOKING || '').trim() === '1';
const MOKA_PUSH_BRANCHES = String(process.env.MOKA_PUSH_BRANCHES || 'bypass,samadikun,csb,sumber,tegal')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
const MOKA_DEFAULT_ITEM_ID = String(process.env.MOKA_DEFAULT_ITEM_ID || '').trim();
const MOKA_DEFAULT_CATEGORY_ID = String(process.env.MOKA_DEFAULT_CATEGORY_ID || '').trim();
const MOKA_DEFAULT_CATEGORY_NAME = String(process.env.MOKA_DEFAULT_CATEGORY_NAME || 'Services').trim();
const MOKA_PAYMENT_TYPE = String(process.env.MOKA_PAYMENT_TYPE || 'online_booking').trim();
const MOKA_SALES_TYPE_ID = String(process.env.MOKA_SALES_TYPE_ID || '').trim();
const MOKA_SALES_TYPE_NAME = String(process.env.MOKA_SALES_TYPE_NAME || '').trim();
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');

function isMokaConfigured() {
  return Boolean(MOKA_API_BASE && MOKA_ACCESS_TOKEN && (MOKA_OUTLET_ID || MOKA_OUTLET_ID_BYPASS));
}

async function mokaRequest(pathname, { method = 'GET', body } = {}) {
  if (!isMokaConfigured()) {
    const err = new Error('MOKA not configured');
    err.code = 'MOKA_NOT_CONFIGURED';
    throw err;
  }

  const url = `${MOKA_API_BASE}${pathname}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MOKA_ACCESS_TOKEN}`,
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

function mokaOutletIdForLocation(location) {
  const loc = String(location || '').trim().toLowerCase();
  if (loc === 'bypass') return MOKA_OUTLET_ID_BYPASS || MOKA_OUTLET_ID;
  return MOKA_OUTLET_ID;
}

function isMokaBranchEnabled(location) {
  const loc = String(location || '').trim().toLowerCase() || 'bypass';
  return MOKA_PUSH_BRANCHES.includes(loc);
}

function shouldPushBookingToMokaOnCreate(location) {
  return MOKA_PUSH_ON_BOOKING && isMokaBranchEnabled(location);
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

// ── MOKA INTEGRATION WITH OAUTH ─────────────────────────────
// Using MokaClient with OAuth Client Credentials
async function pushConfirmedBookingToMoka(booking) {
  const { createInMemorySupabase } = require('./moka/memoryStore');
  const MokaClient = require('./moka/client');
  const { isMokaOAuthConfigured } = require('./moka/oauth');

  if (!isMokaOAuthConfigured()) {
    return { ok: false, skipped: true, reason: 'oauth_not_configured' };
  }

  try {
    const sb = supabase || createInMemorySupabase();

    const locSlug = String(booking?.location || 'bypass').trim().toLowerCase() || 'bypass';
    let outletId = 'default-outlet';
    let mokaOutletId = String(process.env.MOKA_OUTLET_ID || '').trim();

    if (sb && typeof sb.from === 'function') {
      const { data: bySlug } = await sb
        .from('outlets')
        .select('id, slug, moka_outlet_id')
        .eq('slug', locSlug)
        .maybeSingle();
      if (bySlug?.id) outletId = bySlug.id;
      if (bySlug?.moka_outlet_id) mokaOutletId = String(bySlug.moka_outlet_id);
    }

    if (!mokaOutletId) {
      return { ok: false, skipped: true, reason: 'no_moka_outlet_id_configured', location: locSlug };
    }

    const client = new MokaClient(sb, outletId, mokaOutletId);

    // Enrich with barber name and moka_employee_id from DB
    let barberName = String(booking?.barber_name || '').trim();
    let mokaItemId = null;
    if (booking?.barber_id && sb && typeof sb.from === 'function') {
      try {
        const { data: barber } = await sb
          .from('barbers')
          .select('name, moka_employee_id')
          .eq('id', booking.barber_id)
          .maybeSingle();
        if (!barberName && barber?.name) barberName = barber.name;
        if (barber?.moka_employee_id) mokaItemId = Number(barber.moka_employee_id);
      } catch (_) {}
    }

    // Enrich with Moka category IDs from services table
    let categoryId = null;
    let categoryName = null;
    let variantName = String(booking?.service || '').trim() || null;
    if (booking?.service_id && sb && typeof sb.from === 'function') {
      try {
        const { data: svc } = await sb
          .from('services')
          .select('moka_variant_name, moka_category_id, moka_category_name')
          .eq('id', booking.service_id)
          .maybeSingle();
        if (svc?.moka_category_id) categoryId = Number(svc.moka_category_id);
        if (svc?.moka_category_name) categoryName = svc.moka_category_name;
        if (svc?.moka_variant_name) variantName = svc.moka_variant_name;
      } catch (_) {}
    }

    const note = [
      'Booking via website',
      barberName ? `Barber: ${barberName}` : '',
      booking?.location ? `Cabang: ${booking.location}` : '',
      booking?.payment ? `Pembayaran: ${booking.payment}` : '',
      booking?.notes ? `Catatan: ${booking.notes}` : '',
    ].filter(Boolean).join('. ').slice(0, 255);

    // Build order_items using Moka API spec field names
    const orderItem = {
      item_name: barberName || variantName || 'Layanan',
      quantity: 1,
      item_price_library: Number(booking?.price || 0),
    };
    if (mokaItemId) orderItem.item_id = mokaItemId;
    if (variantName) orderItem.item_variant_name = variantName;
    if (categoryId) orderItem.category_id = categoryId;
    if (categoryName) orderItem.category_name = categoryName;

    // Payload sesuai Moka Advanced Ordering API spec
    const orderPayload = {
      application_order_id: String(booking?.id || '').trim(),
      payment_type: 'online_booking',
      customer_name: String(booking?.name || 'Guest').trim(),
      customer_phone_number: toE164Indonesia(booking?.wa) || undefined,
      note,
      client_created_at: bookingTimeIso({ date: booking?.date, time: booking?.time }) || undefined,
      order_items: [orderItem],
    };

    const orderResult = await client.createOrder(orderPayload);
    const mokaOrderId = orderResult?.data?.id || orderResult?.id || orderResult?.order_id;

    if (!mokaOrderId) {
      throw new Error('Moka order created but no ID returned');
    }

    return {
      ok: true,
      order: { moka_order_id: mokaOrderId, payload: orderPayload }
    };

  } catch (error) {
    console.error('[Moka] Booking sync failed:', error.message);
    return { ok: false, error: error.message, skipped: false };
  }
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

function formatBookingDateTimeWIB(dateValue, timeValue) {
  const rawDate = String(dateValue || '').trim();
  const rawTime = String(timeValue || '').trim();

  let dateStr = rawDate || '-';
  let timeStr = rawTime || '-';

  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    const dateObj = new Date(`${year}-${month}-${day}T12:00:00+07:00`);
    if (!Number.isNaN(dateObj.getTime())) {
      dateStr = dateObj.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  }

  const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    const [, hourStr, minuteStr, secondStr = '00'] = timeMatch;
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    const second = parseInt(secondStr, 10);
    if (
      Number.isFinite(hour) && Number.isFinite(minute) && Number.isFinite(second) &&
      hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    ) {
      const timeObj = new Date(`1970-01-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+07:00`);
      if (!Number.isNaN(timeObj.getTime())) {
        timeStr = timeObj.toLocaleTimeString('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
  }

  return { dateStr, timeStr };
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

  // Check legacy bookings table
  let q = supabase.from('bookings').select('id,time,duration').eq('barber_id', barberId).eq('date', date).neq('status', 'cancelled');
  if (excludeId) q = q.neq('id', excludeId);
  const { data: legacyRows } = await q;
  if ((legacyRows || []).some(b => {
    const bStart = timeToMinsStr(b.time);
    const bEnd = bStart + parseDurationMins(b.duration);
    return (newStart < bEnd) && (bStart < newEnd);
  })) return true;

  // Also check schedules table (includes Moka walk-ins)
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd   = `${date}T23:59:59+07:00`;
  const { data: schedRows } = await supabase
    .from('schedules')
    .select('start_time, end_time')
    .eq('barber_id', barberId)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .not('status', 'in', '("cancelled","rejected")');

  const newStartMs = new Date(`${date}T${String(time).slice(0,5)}:00+07:00`).getTime();
  const newEndMs   = newStartMs + parseDurationMins(duration) * 60_000;
  return (schedRows || []).some(s => {
    const sStart = new Date(s.start_time).getTime();
    const sEnd   = new Date(s.end_time).getTime();
    return (newStartMs < sEnd) && (sStart < newEndMs);
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

function _dedupeByIdPreferRichest(barbers = []) {
  const byId = new Map();
  for (const b of (barbers || [])) {
    if (!b?.id) continue;
    const existing = byId.get(b.id);
    if (!existing || barberRecordScore(b) > barberRecordScore(existing)) byId.set(b.id, b);
  }
  return Array.from(byId.values());
}

async function _remapBarberIdsFromSupabase(barbers = []) {
  if (!supabase || DB_TYPE !== 'supabase') return barbers;
  const { data: sbBarbers, error } = await supabase
    .from('barbers')
    .select('id,name,branch,is_active');
  if (error) return barbers;

  const byBranch = new Map();
  for (const b of sbBarbers || []) {
    const br = branchSlug(b.branch);
    if (!byBranch.has(br)) byBranch.set(br, []);
    byBranch.get(br).push(b);
  }

  const out = [];
  for (const b of barbers || []) {
    const br = branchSlug(b.branch);
    const candidates = byBranch.get(br) || [];
    const incomingId = String(b.id || '').trim();
    if (incomingId && candidates.some(x => String(x.id) === incomingId)) {
      out.push(b);
      continue;
    }

    const nIncoming = normName(b.name);
    let match = candidates.find(x => normName(x.name) === nIncoming) || null;
    if (!match && nIncoming && nIncoming.length >= 3) {
      const broad = candidates.filter(x => {
        const n = normName(x.name);
        return n === nIncoming || n.includes(nIncoming) || nIncoming.includes(n);
      });
      if (broad.length === 1) match = broad[0];
    }

    out.push(match ? { ...b, id: match.id } : b);
  }

  return _dedupeByIdPreferRichest(out);
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

// NOTE: Airtable sync removed - using Supabase as primary source

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
    if (process.env.BARBERS_SHEET_URL || process.env.AUTO_SYNC_BARBERS_URL) {
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
  try {
    const { phone, wa_number, name, customer_name, otp, token, password, notes, ...safeBody } = req.body || {};
    const filtered = Object.fromEntries(Object.entries(safeBody).filter(([k]) => !/^customer_/i.test(k)));
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${JSON.stringify(filtered)}`);
  } catch (e) {}
  next();
});

app.use(express.static(path.join(__dirname, '..')));

const { verifyAdminSessionAssertion } = require('./services/adminSessionAssertion');

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  const validTokens = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
  if (!token || !validTokens.includes(token)) return res.status(401).json({ error: 'Unauthorized' });

  const sessionAssertion = req.headers['x-redbox-admin-session'];
  if (sessionAssertion) {
    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      req.adminAuth = verifyAdminSessionAssertion(String(sessionAssertion), {
        adminSessionProxySecret: process.env.ADMIN_SESSION_PROXY_SECRET,
        adminPassword: process.env.ADMIN_PASSWORD,
      });
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid admin session' });
    }
  }

  const credentialId = token === process.env.ADMIN_PASSWORD ? 'crm-admin' : 'cron-service';
  req.adminAuth = {
    staffId: String(process.env.ADMIN_AUDIT_STAFF_ID || credentialId).trim(),
    role: null,
    branch: null,
    sessionVerified: false,
  };
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
app.get('/api/health', async (req, res) => {
  let supabaseTest = null;
  if (supabase && req.query.debug === '1') {
    try {
      const { data: allData, error } = await supabase.from('barbers').select('id, name, is_active');
      const inactive = (allData || []).filter(b => !b.is_active);
      const onoy = (allData || []).find(b => (b.name||'').toLowerCase().includes('onoy'));
      supabaseTest = { supabase_url_prefix: (process.env.SUPABASE_URL||'').slice(0,40), total: allData?.length, inactive_count: inactive.length, inactive: inactive.map(b => ({id:b.id,name:b.name})), onoy, error: error?.message };
    } catch (e) { supabaseTest = { error: e.message }; }
  }
  res.json({ status: 'ok', service: 'Redbox CRM API', db_type: DB_TYPE, supabase_client: !!supabase, timestamp: new Date().toISOString(), ...(supabaseTest ? { supabaseTest } : {}) });
});

// ================================================
// BOOKINGS
// ================================================

// GET /api/bookings
app.get('/api/bookings', async (req, res) => {
  const token = req.headers['x-admin-token'];
  const isAdmin = (token === process.env.ADMIN_PASSWORD);

  if (!isAdmin && !req.query.date) return res.status(401).json({ error: 'Admin access required' });

  const { date, barber, barber_id, location, status, search, limit = 100, offset = 0 } = req.query;
  const bid = barber_id || barber;

  if (DB_TYPE === 'supabase') {
    const tableName = isAdmin ? 'booking_full' : 'bookings';
    const selectCols = isAdmin ? '*' : 'id,date,time,duration,barber_id,name,wa,service,notes,status,location';
    let q = supabase.from(tableName).select(selectCols).order('date', { ascending: false }).order('time', { ascending: true }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (date) q = q.eq('date', date);
    if (location) q = q.eq('location', location);
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
      : `DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
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

// Notifikasi kapster home service menggunakan data booking langsung (tidak bergantung Moka bridge)
function assertWaSendResult(result, label) {
  if (!result) throw new Error(`${label}: Fonnte token missing or send skipped`);
  if (result.status === false) {
    const reason = result.reason || result.error || result.message || JSON.stringify(result);
    throw new Error(`${label}: ${reason}`);
  }
  return result;
}

async function _notifyBarberHomeServiceFromBooking(supabase, bookingData, address) {
  if (!bookingData.barber_id) return;
  const { notifyBarberNewHomeServiceJob } = require('./services/waNotification');

  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', bookingData.barber_id).single();
  if (!barber?.phone) return;

  const { dateStr, timeStr } = formatBookingDateTimeWIB(bookingData.date, bookingData.time);

  const result = await notifyBarberNewHomeServiceJob({
    barberPhone:  barber.phone,
    barberName:   barber.name,
    customerName: bookingData.name || 'Pelanggan',
    dateStr,
    timeStr,
    address,
    serviceLabel: bookingData.service || 'Home Service',
    price:        bookingData.price ? `Rp ${bookingData.price.toLocaleString('id-ID')}` : '-',
    branch:       bookingData.location,
  });
  return assertWaSendResult(result, 'Home service barber notification failed');
}

async function _notifyBarberOutletBookingSupabase(supabase, bookingData) {
  if (!bookingData.barber_id) return; // Skip if no barber assigned
  const { notifyBarberNewOutletBooking } = require('./services/waNotification');

  // Get barber details
  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', bookingData.barber_id).single();
  if (!barber?.phone) {
    console.warn(`[BarberNotif] Kapster ${barber?.name || bookingData.barber_id} tidak punya nomor phone — notif dilewati`);
    return;
  }

  const { dateStr, timeStr } = formatBookingDateTimeWIB(bookingData.date, bookingData.time);

  // Get location label
  const locationLabel = {
    bypass: 'RedBox Bypass',
    samadikun: 'RedBox Samadikun',
    csb: 'RedBox CSB Mall',
    sumber: 'RedBox Sumber',
    tegal: 'RedBox Tegal',
  }[bookingData.location] || 'RedBox Barbershop';

  const result = await notifyBarberNewOutletBooking({
    barberPhone: barber.phone,
    barberName: barber.name,
    customerName: bookingData.name || bookingData.customer_name || 'Pelanggan',
    dateStr,
    timeStr,
    location: locationLabel,
    serviceLabel: bookingData.service,
    price: bookingData.price ? `Rp ${bookingData.price.toLocaleString('id-ID')}` : '-',
    branch: bookingData.location,
  });
  return assertWaSendResult(result, 'Outlet barber notification failed');
}

async function _notifyBarberOutletBookingMysql(bookingData) {
  if (!bookingData.barber_id) return; // Skip if no barber assigned
  const { notifyBarberNewOutletBooking } = require('./services/waNotification');

  // Get barber details from MySQL
  const [barbers] = await mysqlPool.execute(
    'SELECT name, phone FROM barbers WHERE id = ?',
    [bookingData.barber_id]
  );
  if (!barbers[0]?.phone) return;

  const { dateStr, timeStr } = formatBookingDateTimeWIB(bookingData.date, bookingData.time);

  // Get location label
  const locationLabel = {
    bypass: 'RedBox Bypass',
    samadikun: 'RedBox Samadikun',
    csb: 'RedBox CSB Mall',
    sumber: 'RedBox Sumber',
    tegal: 'RedBox Tegal',
  }[bookingData.location] || 'RedBox Barbershop';

  const result = await notifyBarberNewOutletBooking({
    barberPhone: barbers[0].phone,
    barberName: barbers[0].name,
    customerName: bookingData.name || bookingData.customer_name || 'Pelanggan',
    dateStr,
    timeStr,
    location: locationLabel,
    serviceLabel: bookingData.service,
    price: bookingData.price ? `Rp ${bookingData.price.toLocaleString('id-ID')}` : '-',
    branch: bookingData.location,
  });
  return assertWaSendResult(result, 'Outlet barber notification failed');
}

// Satu jalur notifikasi pelanggan untuk semua sumber konfirmasi:
// booking publik, booking admin, dan perubahan status pending -> confirmed.
// Outbox dibuat sebelum provider dipanggil supaya kegagalan Fonnte tidak
// membuat notifikasi hilang saat fungsi serverless berakhir atau timeout.
async function _notifyCustomerConfirmedWithRetry(supabaseClient, bookingData, barberName = null) {
  if (!supabaseClient || !bookingData?.id || !bookingData?.wa) return { skipped: true };

  let queued = false;
  try {
    await enqueueCustomerNotification(supabaseClient, bookingData);
    queued = true;
  } catch (e) {
    // Kirim langsung tetap dicoba; error queue dicatat agar terlihat di log.
    console.error('[WA Confirm] customer outbox enqueue failed:', e.message);
  }

  try {
    const providerResponse = await notifyCustomerBookingConfirmed({
      ...bookingData,
      barber_name: barberName,
    });
    if (queued) {
      await markCustomerNotificationSent(supabaseClient, bookingData.id, providerResponse);
    }
    return { sent: true, providerResponse };
  } catch (e) {
    console.error('[WA Confirm] customer send failed; queued for retry:', e.message);
    return { sent: false, queued };
  }
}

const WEDDING_PACKAGE_PRICES = {
  'wedding-gentleman': 350000,
  'wedding-silver': 500000,
  'wedding-gold': 750000,
  'wedding-platinum': 1000000,
};

function normalizeBookingPrice({ service_id, service, price, type }) {
  const serviceKey = String(service_id || '').trim().toLowerCase().replace(/^weeding-/, 'wedding-');
  const serviceName = String(service || '').trim().toLowerCase();
  const bookingType = String(type || '').trim().toLowerCase();
  const packagePrice = WEDDING_PACKAGE_PRICES[serviceKey];
  if (bookingType === 'wedding' && packagePrice) return packagePrice;
  if (bookingType === 'wedding' || serviceName.includes('wedding') || serviceName.includes('weeding')) {
    if (serviceName.includes('platinum')) return WEDDING_PACKAGE_PRICES['wedding-platinum'];
    if (serviceName.includes('gold')) return WEDDING_PACKAGE_PRICES['wedding-gold'];
    if (serviceName.includes('silver')) return WEDDING_PACKAGE_PRICES['wedding-silver'];
    if (serviceName.includes('gentleman')) return WEDDING_PACKAGE_PRICES['wedding-gentleman'];
  }
  return Number(price) || 0;
}

// POST /api/bookings — Rate limited: max 10 booking per menit per IP
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address } = req.body;
  const bookingPrice = normalizeBookingPrice({ service_id, service, price, type });
  const normalizedBarberId = normalizeBarberIdInput(barber_id);
  const isAdmin = (req.headers['x-admin-token'] === process.env.ADMIN_PASSWORD);
  const desiredStatus = isAdmin ? (status || 'pending') : 'confirmed';

  if (!name || !wa || !service || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields: name, wa, service, date, time' });
  }
  // Validasi format WA (hanya angka, 8-15 digit)
  if (!/^\d{8,15}$/.test(String(wa))) {
    return res.status(400).json({ error: 'Format nomor WhatsApp tidak valid (8-15 angka tanpa kode negara)' });
  }

  const bookingId = randomUUID();
  let resolvedLocation = location || 'bypass';

  if (DB_TYPE === 'supabase') {
    try {
      // 1. Validasi barber aktif (kecuali admin)
      if (normalizedBarberId && normalizedBarberId !== 'any') {
        const { data: barberCheck, error: barberErr } = await supabase
          .from('barbers')
          .select('id, is_active, branch')
          .eq('id', normalizedBarberId)
          .single();
        if (barberErr && barberErr.code !== 'PGRST116') {
          return res.status(500).json({ error: 'Gagal memvalidasi kapster' });
        }
        if (!barberCheck) {
          return res.status(400).json({ error: 'Kapster tidak ditemukan' });
        }
        if (!isAdmin && barberCheck.is_active === false) {
          return res.status(403).json({ error: 'Kapster sedang tidak aktif dan tidak bisa dipesan' });
        }
        // Cabang booking WAJIB ikut cabang asli kapster — mencegah booking tersimpan
        // dengan barber_id dan location yang tidak sinkron (kapster "pindah cabang"
        // secara keliru di notifikasi WA). Berlaku untuk submit pelanggan maupun admin.
        if (barberCheck.branch && barberCheck.branch !== resolvedLocation) {
          console.warn(`[Booking] location "${resolvedLocation}" tidak sinkron dengan cabang kapster ${normalizedBarberId} ("${barberCheck.branch}") — dikoreksi otomatis.`);
          resolvedLocation = barberCheck.branch;
        }
      }

      // 2. Cek overlap terlebih dahulu
      if (await hasOverlapSupabase({ barberId: normalizedBarberId, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 3. Insert booking
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: bookingPrice,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: resolvedLocation, status: desiredStatus, notes: notes || '', payment: payment || ''
      }]).select().single();
      if (error) return res.status(500).json({ error: error.message });

      // 3. Upsert customer (Supabase trigger trg_sync_customer hanya jalan saat done;
      //    kita buat/update customer saat booking dibuat agar data tersedia segera)
      await supabase.from('customers').upsert({
        name, wa, visits: 0, total_spent: 0, last_visit: null
      }, { onConflict: 'wa', ignoreDuplicates: true });

      // Notif admin untuk setiap booking baru (fire-and-forget — tidak block response)
      if (data.wa) {
        notifyAdminNewBooking({ ...data }).catch(e => console.warn('[WA Admin] failed:', e.message));
      }

      // Kirim WA konfirmasi ke pelanggan + notif barber (if assigned)
      // Awaited (bukan fire-and-forget) agar selesai sebelum res.end() — Vercel kills
      // orphaned promises setelah response dikirim.
      if (desiredStatus === 'confirmed' && data.wa) {
        let barberName = null;
        if (data.barber_id) {
          try {
            const { data: b } = await supabase.from('barbers').select('name').eq('id', data.barber_id).single();
            barberName = b?.name || null;
          } catch (_) {}
        }
        await _notifyCustomerConfirmedWithRetry(supabase, data, barberName);
        // Send notification to barber regardless of booking type
        try {
          if (type !== 'home_service' && type !== 'wedding') {
            await _notifyBarberOutletBookingSupabase(supabase, data);
          } else {
            // Home service / wedding — kapster datang ke lokasi pelanggan
            const addrPattern = type === 'wedding'
              ? /\[WEDDING\] Alamat:\s*(.+)/
              : /\[HOME SERVICE\] Alamat:\s*(.+)/;
            const jobAddress = address || (notes?.match(addrPattern)?.[1]?.trim()) || '';
            if (jobAddress) {
              await _notifyBarberHomeServiceFromBooking(supabase, data, jobAddress);
            }
          }
        } catch (err) {
          console.error('[Booking] Barber notif failed:', err.message);
        }
      }

      // Send Web Push to the assigned barber (fire-and-forget)
      if (data && data.barber_id && data.location) {
        supabase
          .from('users')
          .select('id')
          .eq('barber_id', data.barber_id)
          .eq('role', 'barber')
          .single()
          .then(({ data: barberUser }) => {
            if (!barberUser) return;
            sendPushToUser(supabase, barberUser.id, {
              title: '📋 Booking Baru!',
              body: `${data.name} — ${data.service} jam ${data.time}`,
              url: '/barber/schedule',
            }).catch(() => {});
          })
          .catch(() => {});
      }

      // Auto-book: untuk booking dari public website, status langsung CONFIRMED
      // dan langsung dibridge ke schedules + push ke Moka (non-blocking untuk admin draft).
      if (supabase && desiredStatus === 'confirmed') {
        try {
          const r = await require('./moka/sync').bridgeBookingToMoka(supabase, { ...data, type, address });

          // If home service: create lifecycle tracking row
          let homeServiceJobId = null;
          if ((type === 'home_service' || type === 'wedding') && r.scheduleId) {
            const addrPattern = type === 'wedding'
              ? /\[WEDDING\] Alamat:\s*(.+)/
              : /\[HOME SERVICE\] Alamat:\s*(.+)/;
            const jobAddress = address || (notes?.match(addrPattern)?.[1]?.trim()) || '';
            if (jobAddress) {
              const { data: hsJob } = await supabase
                .from('home_service_jobs')
                .insert({ schedule_id: r.scheduleId, address: jobAddress, status: 'confirmed' })
                .select('id')
                .single();
              homeServiceJobId = hsJob?.id || null;
            }
          }

          return res.status(201).json({ data, autoBooked: true, scheduleId: r.scheduleId, mokaSync: r.mokaSync, homeServiceJobId });
        } catch (e) {
          console.warn(`[Moka Bridge] booking ${data.id} failed:`, e.message);
          return res.status(201).json({ data, autoBooked: true, scheduleId: null, mokaSync: 'failed' });
        }
      }

      return res.status(201).json({ data, autoBooked: desiredStatus === 'confirmed' });
    } catch (err) {
      console.error('Supabase POST Error:', err);
      return res.status(500).json({ error: err.message });
    }
  } else {
    try {
      // 1. Validasi barber aktif (kecuali admin)
      if (normalizedBarberId && normalizedBarberId !== 'any') {
        const [barberCheck] = await mysqlPool.execute(
          'SELECT id, is_active FROM barbers WHERE id = ?',
          [normalizedBarberId]
        );
        if (barberCheck.length === 0) {
          return res.status(400).json({ error: 'Kapster tidak ditemukan' });
        }
        if (!isAdmin && barberCheck[0].is_active === 0) {
          return res.status(403).json({ error: 'Kapster sedang tidak aktif dan tidak bisa dipesan' });
        }
      }

      // 2. Get or Create Customer
      let customerId;
      const [customers] = await mysqlPool.execute('SELECT id FROM customers WHERE wa = ?', [wa]);
      if (customers.length > 0) {
        customerId = customers[0].id;
      } else {
        customerId = randomUUID();
        await mysqlPool.execute('INSERT INTO customers (id, name, wa) VALUES (?, ?, ?)', [customerId, name, wa]);
      }

      // 3. Overlap check
      if (await hasOverlapMysql({ barberId: normalizedBarberId, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 4. Insert Booking
      await mysqlPool.execute(
        `INSERT INTO bookings (id, customer_id, name, wa, service_id, service, price, duration, barber_id, date, time, location, status, notes, payment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, customerId, name, wa, service_id || '', service, bookingPrice, duration || '', normalizedBarberId, date, time, location || 'bypass', desiredStatus, notes || '', payment || '']
      );

      const [newBooking] = await mysqlPool.execute(
        `SELECT b.id, b.customer_id, b.name, b.wa, b.service_id, b.service, b.price, b.duration, b.barber_id,
                DATE_FORMAT(b.date, '%Y-%m-%d') AS date, TIME_FORMAT(b.time, '%H:%i') AS time,
                b.location, b.status, b.notes, b.payment, b.created_at, b.updated_at
         FROM bookings b WHERE b.id = ?`,
        [bookingId]
      );

      // Kirim WA konfirmasi + notif barber sebelum response selesai (serverless can kill orphan promises).
      if (desiredStatus === 'confirmed' && newBooking[0]?.wa) {
        await _notifyCustomerConfirmedWithRetry(supabase, newBooking[0], null);
        // Send notification to barber if it's an outlet booking and barber is assigned
        try {
          if (type !== 'home_service' && type !== 'wedding') {
            await _notifyBarberOutletBookingMysql(newBooking[0]);
          }
        } catch (err) {
          console.error('[Outlet Booking] Barber notif failed:', err.message);
        }
      }

      let moka = null;
      if (desiredStatus === 'confirmed' && shouldPushBookingToMokaOnCreate(newBooking[0]?.location)) {
        try {
          moka = await pushConfirmedBookingToMoka(newBooking[0]);
        } catch (e) {
          moka = { ok: false, error: e?.message || 'MOKA sync failed', status: e?.status, details: e?.details };
        }
      }
      res.status(201).json({ data: newBooking[0], moka, autoBooked: desiredStatus === 'confirmed' });
    } catch (error) {
      console.error('MySQL Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/bookings/:id/resend-notif — kirim ulang WA ke pelanggan + kapster
app.post('/api/bookings/:id/resend-notif', adminAuth, async (req, res) => {
  const { id } = req.params;
  if (DB_TYPE !== 'supabase') return res.status(400).json({ error: 'Only supported on Supabase' });

  const { data: bk, error } = await supabase
    .from('bookings')
    .select('*, barbers(name, phone)')
    .eq('id', id)
    .single();
  if (error || !bk) return res.status(404).json({ error: error?.message || 'Booking not found' });

  const barberName = bk.barbers?.name || null;
  const results = { customer: false, barber: false };

  // Kirim ke pelanggan
  if (bk.wa) {
    try {
      const delivery = await _notifyCustomerConfirmedWithRetry(supabase, bk, barberName);
      // True berarti terkirim ke Fonnte atau sudah masuk outbox retry.
      results.customer = Boolean(delivery.sent || delivery.queued);
    } catch (e) {
      console.warn('[ResendNotif] Customer failed:', e.message);
    }
  }

  // Kirim ke kapster
  if (bk.barber_id) {
    const isHomeService = bk.notes?.includes('[HOME SERVICE]');
    try {
      if (isHomeService) {
        const addrMatch = bk.notes?.match(/\[HOME SERVICE\] Alamat:\s*(.+)/);
        const address = addrMatch?.[1]?.trim() || '';
        if (address) {
          await _notifyBarberHomeServiceFromBooking(supabase, bk, address);
          results.barber = true;
        }
      } else {
        await _notifyBarberOutletBookingSupabase(supabase, bk);
        results.barber = true;
      }
    } catch (e) {
      console.warn('[ResendNotif] Barber failed:', e.message);
    }
  }

  return res.json({ ok: true, ...results });
});

// POST /api/booking-status — flat endpoint for cancel/confirm/deny (avoids dynamic-segment routing issues)
app.post('/api/booking-status', adminAuth, async (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  if (DB_TYPE === 'supabase') {
    const { data: cur, error: curError } = await supabase
      .from('bookings')
      .select('id,status,barber_id,notes,schedule_id')
      .eq('id', id)
      .single();
    if (curError) return res.status(500).json({ error: curError.message });

    const { data, error } = await supabase.from('bookings').update({ status }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Dashboard confirmation must notify the customer as well as the barber.
    // Previously this route only notified the barber, which caused the
    // customer-missed-notification bug for pending -> confirmed bookings.
    if (status === 'confirmed' && cur?.status !== 'confirmed' && data?.wa) {
      let barberName = null;
      if (data.barber_id) {
        const { data: barber } = await supabase
          .from('barbers').select('name').eq('id', data.barber_id).maybeSingle();
        barberName = barber?.name || null;
      }
      await _notifyCustomerConfirmedWithRetry(supabase, data, barberName);
    }
    if (status === 'confirmed' && cur?.status !== 'confirmed' && data?.barber_id) {
      try {
        const isHomeService = data.notes?.includes('[HOME SERVICE]');
        if (isHomeService) {
          const addrMatch = data.notes?.match(/\[HOME SERVICE\] Alamat:\s*(.+)/);
          const jobAddress = addrMatch?.[1]?.trim() || '';
          if (jobAddress) await _notifyBarberHomeServiceFromBooking(supabase, data, jobAddress);
        } else {
          await _notifyBarberOutletBookingSupabase(supabase, data);
        }
      } catch (e) {
        console.error('[BookingStatus] Barber notif failed:', e.message);
      }
    }
    // Propagate cancellation to linked schedule so the slot is freed immediately
    if (status === 'cancelled' && cur?.schedule_id) {
      supabase.from('schedules').update({ status: 'cancelled' })
        .eq('id', cur.schedule_id).neq('status', 'cancelled')
        .then().catch(e => console.error('[BookingStatus] schedule cancel sync failed:', e.message));
    }
    // Fire-and-forget: update gamification when booking marked done
    if (status === 'done' && data) {
      onBookingCompleted(supabase, data).catch(e => console.error('[Metrics] onBookingCompleted error:', e.message));
    }
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
    const { data: cur, error: curError } = await supabase
      .from('bookings')
      .select('id,status,barber_id,date,time,name,wa,service,price,location,notes,schedule_id')
      .eq('id', req.params.id)
      .single();
    if (curError) return res.status(500).json({ error: curError.message });

    const nextStatus = updates.status !== undefined ? updates.status : cur.status;

    const { data, error } = await supabase.from('bookings').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Propagate cancellation to linked schedule so the slot is freed immediately
    if (nextStatus === 'cancelled' && cur.status !== 'cancelled' && cur.schedule_id) {
      supabase.from('schedules').update({ status: 'cancelled' })
        .eq('id', cur.schedule_id).neq('status', 'cancelled')
        .then().catch(e => console.error('[PATCH] schedule cancel sync failed:', e.message));
    }
    let moka = null;
    if (nextStatus === 'confirmed' && cur.status !== 'confirmed') {
      try {
        moka = await pushConfirmedBookingToMoka(data);
      } catch (e) {
        moka = { ok: false, error: e?.message || 'MOKA sync failed', status: e?.status, details: e?.details };
      }
    }

    // Direct admin edit/status update must use the same customer notification
    // path as public booking creation. This covers pending -> confirmed.
    if (nextStatus === 'confirmed' && cur.status !== 'confirmed' && data?.wa) {
      let barberName = null;
      if (data.barber_id) {
        const { data: barber } = await supabase
          .from('barbers').select('name').eq('id', data.barber_id).maybeSingle();
        barberName = barber?.name || null;
      }
      await _notifyCustomerConfirmedWithRetry(supabase, data, barberName);
    }

    // Notify kapster if: booking is confirmed AND (barber just assigned/changed OR booking just confirmed)
    const nextBarberId = updates.barber_id !== undefined ? updates.barber_id : cur.barber_id;
    const barberChanged = updates.barber_id !== undefined && updates.barber_id !== cur.barber_id;
    const justConfirmed = nextStatus === 'confirmed' && cur.status !== 'confirmed';
    if (nextStatus === 'confirmed' && nextBarberId && (barberChanged || justConfirmed)) {
      const isHomeService = data.notes?.includes('[HOME SERVICE]');
      if (isHomeService) {
        const addrMatch = data.notes?.match(/\[HOME SERVICE\] Alamat:\s*(.+)/);
        const jobAddress = addrMatch?.[1]?.trim() || '';
        if (jobAddress) {
          try {
            await _notifyBarberHomeServiceFromBooking(supabase, data, jobAddress);
          } catch (err) {
            console.error('[PATCH HomeService] Barber notif failed:', err.message);
          }
        }
      } else {
        try {
          await _notifyBarberOutletBookingSupabase(supabase, data);
        } catch (err) {
          console.error('[PATCH Outlet] Barber notif failed:', err.message);
        }
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
      let moka = null;
      if (nextStatus === 'confirmed' && cur.status !== 'confirmed') {
        try {
          moka = await pushConfirmedBookingToMoka(updated[0]);
        } catch (e) {
          moka = { ok: false, error: e?.message || 'MOKA sync failed', status: e?.status, details: e?.details };
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

// GET /api/barbers?include_inactive=1 (admin only)
app.get('/api/barbers', async (req, res) => {
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  
  // Jika request include_inactive, verifikasi admin auth (sama dengan adminAuth middleware)
  if (includeInactive) {
    const token = req.headers['x-admin-token'] || '';
    const validTokens = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
    if (!token || !validTokens.includes(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  // Force invalidate cache jika ada ?_nocache atau barbers_cache_bust
  if (req.query._nocache || req.query.cache_bust) {
    barbersCache = null;
  }

  // Primary source: Supabase (Airtable removed to save Vercel env var limits)
  // Serve from cache if still fresh (hanya untuk aktif)
  if (!includeInactive && barbersCache && (Date.now() - barbersCache.timestamp) < BARBERS_CACHE_TTL_MS) {
    res.setHeader('x-barbers-source', 'supabase-cache');
    return res.json({ data: barbersCache.data });
  }
  if (DB_TYPE === 'supabase') {
    let query = supabase.from('barbers').select('*');
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const normalized = dedupeBarberRecords(data || []);
    res.setHeader('x-barbers-source', 'supabase');
    return res.json({ data: normalized });
  } else {
    try {
      let sql = 'SELECT * FROM barbers';
      if (!includeInactive) {
        sql += ' WHERE is_active = 1';
      }
      const [rows] = await mysqlPool.execute(sql);
      const normalized = dedupeBarberRecords(rows || []);
      res.setHeader('x-barbers-source', 'mysql');
      res.json({ data: normalized });
    } catch (error) {
      if (process.env.BARBERS_SHEET_URL) {
        try {
          const r = await fetchBarbersFromSheet(process.env.BARBERS_SHEET_URL);
          let data = dedupeBarberRecords(r.data || []);
          if (!includeInactive) {
            data = data.filter(b => b.is_active);
          }
          res.setHeader('x-barbers-source', 'google_sheet');
          return res.json({ data });
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

// POST /api/barbers/:id/toggle-active — Admin: aktifkan/nonaktifkan kapster
// PATCH /api/barbers/:id/phone — set nomor WA kapster (untuk notifikasi)
app.patch('/api/barbers/:id/phone', adminAuth, async (req, res) => {
  const { id } = req.params;
  let { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  // Normalize: strip non-digits, ensure starts with 62
  phone = String(phone).replace(/\D/g, '').replace(/^0/, '62');
  if (!phone.startsWith('62') || phone.length < 10) {
    return res.status(400).json({ error: 'Format nomor tidak valid (contoh: 628123456789)' });
  }
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase
      .from('barbers').update({ phone }).eq('id', id).select('id, name, phone').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  }
  return res.status(400).json({ error: 'Only supported on Supabase' });
});

app.post('/api/barbers/:id/toggle-active', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active (boolean) required' });
  }
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase
      .from('barbers')
      .update({ is_active })
      .eq('id', id)
      .select('id, name, is_active')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    // Invalidate barbers cache agar perubahan langsung terlihat
    barbersCache = null;
    return res.json({ success: true, barber: data });
  } else {
    try {
      await mysqlPool.execute(
        'UPDATE barbers SET is_active = ? WHERE id = ?',
        [is_active ? 1 : 0, id]
      );
      barbersCache = null;
      res.json({ success: true, id, is_active });
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
});

// POST /api/barbers/:id/today-override — Admin: override ketersediaan kapster hari ini
// Supports optional ?date=YYYY-MM-DD (defaults to today WIB).
// available=true  → tandai tersedia di tanggal tersebut (hapus admin-block)
// available=false → tandai libur di tanggal tersebut (insert admin-block)
//
// FIX (2026-06-02): dulu memakai barber_working_hours.is_off + day_of_week sehingga
// memblokir SEMUA hari yang sama di minggu-minggu berikutnya secara permanen.
// Sekarang menggunakan barber_date_overrides (per-tanggal) agar blokir hanya berlaku
// untuk tanggal spesifik yang dipilih.
app.post('/api/barbers/:id/today-override', adminAuth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB unavailable' });
  const { id } = req.params;
  const { available } = req.body;
  if (typeof available !== 'boolean') return res.status(400).json({ error: 'available (boolean) required' });

  const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  // Allow admin to override a future date (e.g., block a barber for next Saturday)
  const targetDate = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date
    : wibNow.toISOString().slice(0, 10);

  // Upsert into barber_date_overrides (date-specific, not day-of-week)
  const { error: overrideErr } = await supabase
    .from('barber_date_overrides')
    .upsert({ barber_id: id, date: targetDate, is_off: !available }, { onConflict: 'barber_id,date' });
  if (overrideErr) return res.status(500).json({ error: overrideErr.message });

  // Also manage admin-block schedules so slot-blockers debug and legacy code stays in sync
  if (!available) {
    // Insert a full-day block schedule for this specific date
    const dayStart = `${targetDate}T00:00:00+07:00`;
    const dayEnd   = `${targetDate}T23:59:59+07:00`;
    const { data: outletRow } = await supabase
      .from('barbers').select('outlet_id').eq('id', id).single();
    if (outletRow?.outlet_id) {
      await supabase.from('schedules').insert({
        barber_id:    id,
        outlet_id:    outletRow.outlet_id,
        start_time:   dayStart,
        end_time:     dayEnd,
        status:       'confirmed',
        source:       'admin-block',
        service_name: 'Libur / Admin Block',
        notes:        `[admin-block] tanggal ${targetDate}`,
      });
    }
  } else {
    // Cancel all admin-block schedules for this specific date
    await supabase.from('schedules')
      .update({ status: 'cancelled', notes: `[auto] admin override: kapster tersedia ${targetDate}` })
      .eq('barber_id', id)
      .ilike('notes', '%admin-block%')
      .gte('start_time', `${targetDate}T00:00:00+07:00`)
      .lt('start_time',  `${targetDate}T23:59:59+07:00`)
      .neq('status', 'cancelled');
  }

  barbersCache = null;
  res.json({ success: true, barberId: id, available, date: targetDate });
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
    let q = supabase.from('customers').select('*', { count: 'exact' }).order('visits', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%`);
    // Segmentasi
    if (segment === 'loyal')  q = q.gte('visits', 5);
    if (segment === 'atrisk') q = q.lt('last_visit', thirtyStr).gte('last_visit', ninetyStr);
    if (segment === 'lost')   q = q.lt('last_visit', ninetyStr);
    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    // Add computed points field (visits * 10) if not stored in DB
    const enriched = (data || []).map(c => ({ ...c, points: c.points ?? (c.visits || 0) * 10 }));
    return res.json({ data: enriched, total: count ?? enriched.length });
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
    } else if (process.env.BARBERS_SHEET_URL) {
      result = await syncBarbersFromSheet(process.env.BARBERS_SHEET_URL);
    } else {
      return res.status(400).json({ error: 'BARBERS_SHEET_URL belum dikonfigurasi di environment variables.' });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e?.message || 'Sync failed' }); }
});

// POST /api/admin/test-moka-bypass
// ── GET /api/admin/moka-token-debug — probe what the stored token can access
app.get('/api/admin/moka-token-debug', adminAuth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB unavailable' });
  const MokaClient = require('./moka/client');
  const outletId   = '8a55df01-8b02-4105-b248-c73f08426aaa';
  const mokaId     = '100818';
  const client     = new MokaClient(supabase, outletId, mokaId);
  const probes = [
    `/v3/outlets/${mokaId}/reports/get_latest_transactions?per_page=1`,
    `/v1/outlets/${mokaId}/customers?page=1&per_page=1`,
    `/v1/businesses/${mokaId}/customers?page=1&per_page=1`,
    `/v1/outlets/${mokaId}/sync_bills/?statuses=PENDING&start=01/05/2026&end=16/05/2026&per_page=1`,
    `/v1/profile`,
    `/v2/profile`,
  ];
  const results = {};
  for (const path of probes) {
    try {
      const r = await client._req('GET', path);
      results[path] = { ok: true, keys: Object.keys(r || {}), sample: JSON.stringify(r).slice(0, 200) };
    } catch (e) {
      results[path] = { ok: false, error: e.message };
    }
  }
  return res.json(results);
});

app.post('/api/admin/test-moka-bypass', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const date = localDateStr(now);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    const booking = {
      id: `test-${randomUUID()}`,
      name: req.body?.name || 'Test Bypass',
      wa: req.body?.wa || '81234567890',
      service_id: req.body?.service_id || 'test-service',
      service: req.body?.service || 'Hair Cut',
      price: Number(req.body?.price ?? 100000),
      duration: req.body?.duration || '45 menit',
      barber_id: req.body?.barber_id || 'any',
      barber_name: req.body?.barber_name || '',
      date: req.body?.date || date,
      time: req.body?.time || `${hh}:${mm}`,
      location: 'bypass',
      notes: req.body?.notes || 'Simulasi booking dari API',
      payment: req.body?.payment || 'Test',
    };

    const moka = await pushConfirmedBookingToMoka(booking);
    res.json({ booking, moka });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Moka test failed' });
  }
});

// GET /api/admin/moka-health
app.get('/api/admin/moka-health', adminAuth, async (req, res) => {
  try {
    if (!isMokaConfigured()) {
      return res.json({
        ok: false,
        configured: false,
        required_env: [
          'MOKA_API_BASE (optional)',
          'MOKA_ACCESS_TOKEN (or MOKA_API_KEY)',
          'MOKA_OUTLET_ID (or MOKA_OUTLET_ID_BYPASS)',
          'MOKA_DEFAULT_ITEM_ID (recommended)',
          'MOKA_DEFAULT_CATEGORY_ID (required if item has no category_id)',
        ],
      });
    }
    const outletId = mokaOutletIdForLocation('bypass');
    const itemsRes = await mokaRequest(`/v1/outlets/${encodeURIComponent(outletId)}/items`, { method: 'GET' });
    const items = itemsRes?.data?.items || itemsRes?.items || itemsRes?.data || [];
    const itemCount = Array.isArray(items) ? items.length : 0;

    const catsRes = await mokaRequest(`/v1/outlets/${encodeURIComponent(outletId)}/categories`, { method: 'GET' });
    const cats = catsRes?.data?.category || catsRes?.categories || catsRes?.data || [];
    const categoryCount = Array.isArray(cats) ? cats.length : 0;

    res.json({
      ok: true,
      configured: true,
      outlet_id: outletId,
      items_count: itemCount,
      categories_count: categoryCount,
      env: {
        push_on_booking: MOKA_PUSH_ON_BOOKING,
        push_branches: MOKA_PUSH_BRANCHES,
        payment_type: MOKA_PAYMENT_TYPE,
        default_item_id: MOKA_DEFAULT_ITEM_ID || null,
        default_category_id: MOKA_DEFAULT_CATEGORY_ID || null,
        sales_type_id: MOKA_SALES_TYPE_ID || null,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Moka health failed', status: e?.status, details: e?.details });
  }
});

// ── POST /api/admin/moka-backfill ──────────────────────────────────────────────
// Force-reset last_polled_at untuk semua (atau satu) outlet ke N hari lalu,
// sehingga cron tick berikutnya akan fetch ulang semua transaksi yang terlewat.
// Body: { days?: number (default 3), outlet_slug?: string (all if omitted) }
app.post('/api/admin/moka-backfill', adminAuth, async (req, res) => {
  const { days = 3, outlet_slug } = req.body || {};
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase.from('outlets').select('id, slug, name').eq('is_active', true).not('moka_outlet_id', 'is', null);
  if (outlet_slug) q = q.eq('slug', outlet_slug);
  const { data: outlets, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const results = [];
  for (const outlet of (outlets || [])) {
    const { error: updErr } = await supabase
      .from('outlets').update({ last_polled_at: since }).eq('id', outlet.id);
    results.push({ slug: outlet.slug, name: outlet.name, reset_to: since, ok: !updErr });
    // Also clear in-memory cache so next tick picks up the new since
    try {
      const { setLastSyncAt } = require('./moka/sync');
      if (setLastSyncAt) setLastSyncAt(outlet.id, since);
    } catch {}
    console.log(`[Backfill] Reset ${outlet.slug} last_polled_at → ${since}`);
  }

  res.json({ ok: true, message: `Cursor reset to ${days} days ago. Next cron tick will backfill.`, since, outlets: results });
});

// ── GET /api/admin/moka-token-debug ────────────────────────────────────────────
// Debug: cek apakah client_credentials menghasilkan token valid dari Moka
app.get('/api/admin/moka-token-debug', async (req, res) => {
  const tok = req.headers['x-admin-token'] || req.query.token || '';
  const valid = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
  if (!tok || !valid.includes(tok)) return res.status(401).json({ error: 'Unauthorized' });

  const MOKA_TOKEN_URL = process.env.MOKA_TOKEN_URL || 'https://api.mokapos.com/oauth/token';
  const MOKA_API_BASE_URL = String(process.env.MOKA_API_BASE || 'https://api.mokapos.com').trim();
  const clientId = process.env.MOKA_CLIENT_ID || '';
  const clientSecret = process.env.MOKA_CLIENT_SECRET || '';
  const redirectUri = process.env.MOKA_REDIRECT_URI || '';

  const result = {
    env: {
      MOKA_CLIENT_ID: clientId ? `set (${clientId.length} chars, starts: ${clientId.slice(0,8)}...)` : 'NOT SET',
      MOKA_CLIENT_SECRET: clientSecret ? `set (${clientSecret.length} chars)` : 'NOT SET',
      MOKA_REDIRECT_URI: redirectUri || 'NOT SET',
      MOKA_TOKEN_URL,
      MOKA_API_BASE: MOKA_API_BASE_URL,
    },
  };

  // Step 1: try client_credentials
  try {
    const tokenRes = await fetch(MOKA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'customer library profile report transaction checkout checkout_api sales_type',
      }).toString(),
    });
    const tokenText = await tokenRes.text();
    let tokenBody;
    try { tokenBody = JSON.parse(tokenText); } catch { tokenBody = { raw: tokenText }; }
    result.client_credentials = {
      status: tokenRes.status,
      ok: tokenRes.ok,
      token_type: tokenBody.token_type,
      scope: tokenBody.scope,
      expires_in: tokenBody.expires_in,
      has_access_token: !!tokenBody.access_token,
      access_token_prefix: tokenBody.access_token ? tokenBody.access_token.slice(0, 20) + '...' : null,
      error: tokenBody.error || tokenBody.error_description || null,
    };

    // Step 2: if token obtained, try profile/self
    if (tokenBody.access_token) {
      const profRes = await fetch(`${MOKA_API_BASE_URL}/v1/profile/self`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      });
      const profText = await profRes.text();
      let profBody;
      try { profBody = JSON.parse(profText); } catch { profBody = { raw: profText }; }
      result.profile_self_test = {
        status: profRes.status,
        ok: profRes.ok,
        email: profBody.email || profBody.data?.email || null,
        outlet_ids: profBody.outlet_ids || profBody.data?.outlet_ids || null,
        error: profBody.meta?.error_message || profBody.error || null,
        raw_preview: profText.slice(0, 200),
      };
    }
  } catch (e) {
    result.client_credentials = { error: e.message };
  }

  res.json(result);
});

// ── GET /api/admin/moka-sync-status ────────────────────────────────────────────
// Debug: lihat status sync per outlet — last_polled_at, jumlah schedules hari ini, token status
app.get('/api/admin/moka-sync-status', adminAuth, async (req, res) => {
  const today = new Date();
  const wib = new Date(today.getTime() + 7 * 3600000);
  const todayStr = wib.toISOString().slice(0, 10);
  const dayStartWIB = `${todayStr}T00:00:00+07:00`;
  const dayEndWIB   = `${todayStr}T23:59:59+07:00`;

  const { data: outlets } = await supabase
    .from('outlets').select('id, slug, name, moka_outlet_id, last_polled_at').eq('is_active', true);

  const { data: tokens } = await supabase
    .from('moka_tokens').select('outlet_id, expires_at, updated_at');
  const tokenMap = {};
  for (const t of (tokens || [])) tokenMap[t.outlet_id] = t;

  const results = await Promise.all((outlets || []).map(async (o) => {
    const { count: completedToday } = await supabase
      .from('schedules').select('*', { count: 'exact', head: true })
      .eq('outlet_id', o.id).eq('source', 'moka').eq('status', 'completed')
      .gte('start_time', dayStartWIB).lte('start_time', dayEndWIB);

    const { count: reservedToday } = await supabase
      .from('schedules').select('*', { count: 'exact', head: true })
      .eq('outlet_id', o.id).eq('source', 'moka').eq('status', 'reserved')
      .gte('start_time', dayStartWIB).lte('start_time', dayEndWIB);

    const tok = tokenMap[o.id];
    const lastPolledWIB = o.last_polled_at
      ? new Date(new Date(o.last_polled_at).getTime() + 7*3600000).toISOString().slice(0,19) + ' WIB'
      : null;
    const staleMins = o.last_polled_at
      ? Math.round((Date.now() - new Date(o.last_polled_at).getTime()) / 60000)
      : null;

    return {
      slug: o.slug,
      name: o.name,
      moka_outlet_id: o.moka_outlet_id,
      last_polled_wib: lastPolledWIB,
      stale_mins: staleMins,
      stale_warn: staleMins !== null && staleMins > 30,
      completed_today: completedToday || 0,
      reserved_today: reservedToday || 0,
      token_ok: !!tok,
      token_expires: tok?.expires_at?.slice(0, 10) || null,
    };
  }));

  res.json({ today: todayStr, outlets: results });
});

// ── GET /api/moka/auth-start ───────────────────────────────────────────────────
// Mulai Moka OAuth flow untuk satu outlet.
// Tidak butuh admin auth — user tetap harus login ke akun Moka merchant mereka.
// ?outlet=csb|bypass|samadikun|sumber|tegal
app.get('/api/moka/auth-start', async (req, res) => {
  const { buildAuthorizationUrl } = require('./moka/oauth');
  const slug = (req.query.outlet || '').toLowerCase().trim();
  if (!slug) {
    const { data: outlets } = await supabase.from('outlets').select('slug, name, moka_outlet_id').eq('is_active', true);
    const links = (outlets || []).map(o =>
      `<li><a href="/api/moka/auth-start?outlet=${o.slug}" style="color:#0af;font-size:18px">${o.name} (${o.moka_outlet_id})</a></li>`
    ).join('');
    return res.send(`<!DOCTYPE html><html><body style="background:#111;color:#eee;font-family:sans-serif;padding:40px">
      <h2>🔑 Moka OAuth — Pilih Outlet</h2>
      <p>Klik outlet yang ingin di-authorize. Kamu akan diarahkan ke halaman login Moka.</p>
      <ul style="line-height:2.5">${links}</ul>
    </body></html>`);
  }
  const { data: outlet } = await supabase.from('outlets').select('id, name, moka_outlet_id').eq('slug', slug).maybeSingle();
  if (!outlet) return res.status(404).send(`Outlet '${slug}' tidak ditemukan`);
  const state = `${slug}|${outlet.id}`;
  const authUrl = buildAuthorizationUrl(Buffer.from(state).toString('base64'));
  res.redirect(authUrl);
});

// ── GET /api/moka/callback ─────────────────────────────────────────────────────
// Moka redirect ke sini setelah user authorize (sesuai MOKA_REDIRECT_URI).
// ?code=AUTH_CODE&state=BASE64_STATE
app.get('/api/moka/callback', async (req, res) => {
  const { exchangeCode } = require('./moka/oauth');
  const { code, state, error } = req.query;
  if (error) return res.send(`<h2>❌ Moka Error: ${error}</h2>`);
  if (!code) return res.status(400).send('Missing authorization code');

  // No-state fallback: Moka drops the state param in its callback URL.
  // Exchange code once for the first outlet, then copy token to all others.
  if (!state) {
    try {
      const { data: outlets } = await supabase.from('outlets').select('id, name').eq('is_active', true);
      const outletList = outlets || [];
      if (!outletList.length) return res.status(500).send('No active outlets found');

      await exchangeCode(supabase, String(code), outletList[0].id);

      const { data: firstToken } = await supabase
        .from('moka_tokens').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (firstToken) {
        for (const outlet of outletList) {
          if (outlet.id === firstToken.outlet_id) continue;
          await supabase.from('moka_tokens').upsert(
            { ...firstToken, outlet_id: outlet.id, updated_at: new Date().toISOString() },
            { onConflict: 'outlet_id' }
          );
        }
      }

      const names = outletList.map(o => o.name).join(', ');
      return res.send(`<!DOCTYPE html><html><body style="background:#111;color:#eee;font-family:sans-serif;padding:40px">
        <h2>✅ Token Moka berhasil disimpan untuk semua outlet!</h2>
        <p>Outlets: <strong>${names}</strong></p>
        <p>Online order dari website sekarang akan masuk ke Moka POS di semua cabang.</p>
        <p><a href="/api/moka/auth-start" style="color:#0af">← Authorize ulang jika perlu</a></p>
      </body></html>`);
    } catch (e) {
      return res.status(500).send(`<h2>❌ Gagal exchange token</h2><pre>${e.message}</pre>`);
    }
  }

  // Normal flow: state contains slug|outletId
  let slug, outletId;
  try {
    const decoded = Buffer.from(String(state), 'base64').toString();
    [slug, outletId] = decoded.split('|');
  } catch {
    return res.status(400).send('Invalid state');
  }
  if (!outletId) return res.status(400).send('Invalid state — no outlet ID');
  try {
    await exchangeCode(supabase, String(code), outletId);
    const { data: outlet } = await supabase.from('outlets').select('name, moka_outlet_id').eq('id', outletId).maybeSingle();
    res.send(`<!DOCTYPE html><html><body style="background:#111;color:#eee;font-family:sans-serif;padding:40px">
      <h2>✅ Berhasil!</h2>
      <p>Token Moka untuk <strong>${outlet?.name || slug}</strong> (ID: ${outlet?.moka_outlet_id}) berhasil disimpan.</p>
      <p>Online order dari website untuk outlet ini sekarang akan masuk ke Moka POS.</p>
      <p><a href="/api/moka/auth-start" style="color:#0af">← Authorize outlet lain</a></p>
    </body></html>`);
  } catch (e) {
    res.status(500).send(`<h2>❌ Gagal exchange token</h2><pre>${e.message}</pre>`);
  }
});

// ── POST /api/admin/moka-retry-schedules ───────────────────────────────────────
// Retry semua schedule yang belum dapat Moka order ID (external_id IS NULL atau 'booking:...').
// Bisa juga retry schedule tertentu via ?schedule_id=UUID.
// Auth: x-admin-token header ATAU ?token= query param.
app.all('/api/admin/moka-retry-schedules', async (req, res) => {
  const tok = req.headers['x-admin-token'] || req.query.token || req.body?.token || '';
  const valid = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
  if (!tok || !valid.includes(tok)) return res.status(401).json({ error: 'Unauthorized' });
  if (!supabase) return res.status(503).json({ error: 'DB unavailable' });

  const { pushScheduleToMoka } = require('./moka/sync');
  const specificId = req.query.schedule_id || req.body?.schedule_id;

  let scheduleIds = [];
  if (specificId) {
    scheduleIds = [specificId];
  } else {
    const now = new Date();
    const ceiling = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const { data: nullMissed } = await supabase
      .from('schedules').select('id')
      .is('external_id', null)
      .in('status', ['reserved', 'confirmed'])
      .gte('start_time', now.toISOString())
      .lte('start_time', ceiling.toISOString());
    const { data: bridgeMissed } = await supabase
      .from('schedules').select('id')
      .like('external_id', 'booking:%')
      .in('status', ['reserved', 'confirmed'])
      .gte('start_time', now.toISOString())
      .lte('start_time', ceiling.toISOString());
    scheduleIds = [...(nullMissed || []), ...(bridgeMissed || [])].map(s => s.id);
  }

  if (!scheduleIds.length) return res.json({ ok: true, retried: 0, message: 'Tidak ada schedule yang perlu di-retry' });

  const results = [];
  for (const id of scheduleIds) {
    try {
      await pushScheduleToMoka(supabase, id);
      results.push({ id, status: 'success' });
    } catch (e) {
      results.push({ id, status: 'failed', error: e.message });
    }
  }
  res.json({ ok: true, retried: scheduleIds.length, results });
});

// ── GET /api/admin/moka-advanced-ordering ──────────────────────────────────────
// Cek status Advanced Ordering (BeeSales) untuk semua outlet.
// Jika active → {status:'active', auto_accept:bool}
// Jika tidak active → {status:'not_active', error:'404'}
// Juga coba generate_sales_type untuk mengaktifkan outlet yang belum aktif.
app.get('/api/admin/moka-advanced-ordering', async (req, res) => {
  const tok = req.headers['x-admin-token'] || req.query.token || '';
  const valid = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
  if (!tok || !valid.includes(tok)) return res.status(401).json({ error: 'Unauthorized' });
  const MokaClient  = require('./moka/client');
  const { invalidateToken } = require('./moka/oauth');
  const { data: outlets } = await supabase
    .from('outlets').select('id, slug, name, moka_outlet_id').eq('is_active', true);

  // ?clear_cache=1 — paksa hapus token dari memory cache + DB sebelum cek
  if (req.query.clear_cache === '1') {
    await Promise.all((outlets || []).map(o => invalidateToken(supabase, o.id)));
  }

  const results = await Promise.all((outlets || []).map(async (o) => {
    const client = new MokaClient(supabase, o.id, o.moka_outlet_id);
    const row = { slug: o.slug, moka_outlet_id: o.moka_outlet_id };
    try {
      const r = await client.getAdvancedOrderingStatus();
      row.status = 'active';
      row.auto_accept = r?.data?.auto_accept_status ?? null;
    } catch (err) {
      row.status = err.status === 404 ? 'not_active' : 'error';
      row.error = err.message;
    }
    // Check which outlet_ids this token can access (profile/self)
    try {
      const MOKA_API_BASE_URL = String(process.env.MOKA_API_BASE || 'https://api.mokapos.com').trim();
      const token = await require('./moka/oauth').getAccessToken(supabase, o.id);
      const profRes = await fetch(`${MOKA_API_BASE_URL}/v1/profile/self`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const prof = await profRes.json();
      row.profile_outlet_ids = prof?.outlet_ids ?? prof?.data?.outlet_ids ?? `status ${profRes.status}`;
      row.profile_email = prof?.email ?? prof?.data?.email ?? null;
      row.token_covers_this_outlet = Array.isArray(row.profile_outlet_ids)
        ? row.profile_outlet_ids.includes(Number(o.moka_outlet_id))
        : null;
    } catch (errP) {
      row.profile_outlet_ids = `error: ${errP.message}`;
    }

    // Verify basic API access (items endpoint — always available if outlet_id + token correct)
    try {
      const items = await client.getItems();
      const count = items?.data?.items?.length ?? items?.data?.length ?? '?';
      row.items_api = `ok — ${count} items`;
    } catch (errI) {
      row.items_api = `failed: ${errI.message}`;
    }

    // Try to activate Advanced Ordering for inactive outlets
    if (row.status === 'not_active' && req.query.activate === '1') {
      // Step 1: POST auto_accept — may enable Advanced Ordering
      try {
        const aa = await client.setAutoAccept(true);
        row.set_auto_accept = `ok — auto_accept_status: ${aa?.data?.auto_accept_status}`;
        row.status = 'activated';
      } catch (err2) {
        row.set_auto_accept = `failed: ${err2.message}`;
      }
      // Step 2: generate_sales_type — creates the payment_type entry
      try {
        const g = await client.generateSalesType();
        const name = Array.isArray(g?.data) ? g.data[0]?.name : g?.data?.name;
        row.generate_sales_type = name ? `ok — payment_type: ${name}` : 'ok (no name returned)';
      } catch (err3) {
        row.generate_sales_type = `failed: ${err3.message}`;
      }
    }
    return row;
  }));

  res.json({ outlets: results });
});

// POST /api/admin/notify-barber — kirim ulang notif WA ke kapster untuk booking tertentu
app.post('/api/admin/notify-barber', adminAuth, async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, name, wa, service, price, date, time, location, barber_id, status')
    .eq('id', booking_id)
    .single();
  if (error || !booking) return res.status(404).json({ error: error?.message || 'Booking not found' });
  try {
    await _notifyBarberOutletBookingSupabase(supabase, booking);
    res.json({ ok: true, booking_id, barber_id: booking.barber_id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.all('/api/ai/upload', (req, res) => {
  return res.redirect(308, '/api/ai/upload.js');
});

// ── POST /api/admin/sync-customers-full ──────────────────────────────────────
// Chunk-based historical customer pull from Moka.
// Body: { outlet_id?, next_url?, max_pages? (default 4) }
// Returns: { done, next_url, outlet_id, pages_fetched, customers_found, upserted, error? }
// Caller chains calls until done=true.
app.post('/api/admin/sync-customers-full', adminAuth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'DB unavailable' });

  const { next_url: startNextUrl, max_pages = 4 } = req.body || {};
  let { outlet_id: rawOutletId, moka_outlet_id: rawMokaOutletId } = req.body || {};

  const MokaClient = require('./moka/client');

  // Auto-pick first authorized outlet if not specified
  if (!rawOutletId) {
    const { data: tokens } = await supabase.from('moka_tokens').select('outlet_id').limit(1);
    rawOutletId = tokens?.[0]?.outlet_id;
  }
  if (!rawOutletId) return res.status(400).json({ error: 'No Moka outlets configured' });

  // Get moka_outlet_id — accept from body (override) or look up in outlets table
  let mokaOutletId = rawMokaOutletId || null;
  if (!mokaOutletId) {
    const { data: outlet } = await supabase.from('outlets')
      .select('moka_outlet_id').eq('id', rawOutletId).maybeSingle();
    mokaOutletId = outlet?.moka_outlet_id || null;
  }
  if (!mokaOutletId) return res.status(400).json({ error: 'Outlet has no moka_outlet_id — pass moka_outlet_id in body' });

  const client = new MokaClient(supabase, rawOutletId, mokaOutletId);
  const customerMap = new Map();
  let nextUrl = startNextUrl || null;
  let page = 0;

  // ── Strategy 1: business customers endpoint (direct list, no transactions needed)
  // ── Strategy 2: outlet customers endpoint
  // ── Strategy 3: v3 transaction report (extract customers embedded in payments)
  const businessId = mokaOutletId; // Moka business ID often same as outlet ID
  const strategies = [
    { label: 'v1_biz_customers',    path: `/v1/businesses/${businessId}/customers?page=${nextUrl||1}&per_page=100` },
    { label: 'v1_outlet_customers', path: `/v1/outlets/${mokaOutletId}/customers?page=${nextUrl||1}&per_page=100` },
    { label: 'v3_transactions',     path: nextUrl ? nextUrl.replace(/^https?:\/\/[^/]+/, '') : `/v3/outlets/${mokaOutletId}/reports/get_latest_transactions?per_page=100` },
  ];

  let workingStrategy = req.body.strategy || null;
  let apiError = null;

  // Fetch up to max_pages using the working strategy
  do {
    let response = null;
    const tryStrategies = workingStrategy ? [{ label: workingStrategy, path: strategies.find(s => s.label === workingStrategy)?.path || '' }] : strategies;

    for (const s of tryStrategies) {
      try {
        const tryPath = page > 0 ? (nextUrl ? nextUrl.replace(/^https?:\/\/[^/]+/, '') : s.path) : s.path;
        response = await client._req('GET', tryPath);
        workingStrategy = s.label;
        apiError = null;
        break;
      } catch (err) {
        apiError = `${s.label}: ${err.message}`;
        response = null;
      }
    }

    if (!response) break;
    page++;

    // Parse response — each strategy returns different shape
    let customers = [];
    let payments  = [];
    if (workingStrategy === 'v3_transactions') {
      payments = Array.isArray(response?.data?.payments) ? response.data.payments : [];
      nextUrl  = response?.data?.next_url || null;
    } else {
      // v1 customer endpoints: { data: { customers: [...] } } or { data: [...] }
      const raw = response?.data?.customers || response?.data || response?.customers || [];
      customers = Array.isArray(raw) ? raw : [];
      const meta = response?.meta || response?.data?.meta || {};
      const total = meta.total_count || meta.total || customers.length;
      const perPage = meta.per_page || 100;
      const currentPage = meta.current_page || page;
      nextUrl = currentPage * perPage < total ? String(currentPage + 1) : null;
    }

    // Aggregate customers from whichever source
    const items = workingStrategy === 'v3_transactions' ? payments : customers;
    for (const p of items) {
      if (p.is_deleted || p.is_refunded) continue;
      const rawPhone = String(p.customer_phone_number || p.customer_phone || p.phone_number || p.phone || '').trim();
      const cName    = String(p.customer_name  || p.name  || p.full_name || '').trim();
      const cEmail   = String(p.customer_email || p.email || '').trim();
      const cId      = String(p.customer_id    || p.id    || '').trim();
      const amount   = Number(p.total_collected || p.total_transaction || 0);
      const txTime   = p.transaction_time || p.last_transaction_at || p.created_at || null;

      let wa = rawPhone.replace(/\D/g, '');
      if (wa.startsWith('0')) wa = '62' + wa.slice(1);
      else if (wa && !wa.startsWith('62')) wa = '62' + wa;
      const key = wa || cId;
      if (!key) continue;

      if (!customerMap.has(key)) {
        customerMap.set(key, { name: cName, email: cEmail || null, mokaId: cId || null, wa, phone_e164: wa ? `+${wa}` : null, visits: 0, total_spent: 0, last_visit: null });
      }
      const c = customerMap.get(key);
      if (cName && !c.name)   c.name   = cName;
      if (cEmail && !c.email) c.email  = cEmail;
      if (cId && !c.mokaId)   c.mokaId = cId;
      if (workingStrategy === 'v3_transactions') {
        c.visits++;
        c.total_spent += amount;
      }
      if (txTime && (!c.last_visit || txTime > c.last_visit)) c.last_visit = txTime;
    }

    if (!nextUrl || items.length === 0) break;
  } while (page < max_pages);

  const done = !nextUrl;

  // Bulk upsert found customers
  let upserted = 0;
  let upsertError = null;
  if (customerMap.size) {
    const rows = Array.from(customerMap.values()).map(c => ({
      name: c.name || 'Moka Customer', wa: c.wa || '',
      phone_e164: c.phone_e164 || null, email: c.email || null,
      source: 'moka', moka_customer_id: c.mokaId || null,
      visits: c.visits, total_spent: c.total_spent,
      last_visit: c.last_visit || null, points: c.visits * 10,
      updated_at: new Date().toISOString(),
    }));

    let { error } = await supabase.from('customers')
      .upsert(rows, { onConflict: 'wa', ignoreDuplicates: false });
    if (error?.message?.includes('points')) {
      const r2 = rows.map(({ points: _, ...rest }) => rest);
      ({ error } = await supabase.from('customers').upsert(r2, { onConflict: 'wa', ignoreDuplicates: false }));
    }
    upserted = error ? 0 : rows.length;
    if (error) upsertError = error.message;
  }

  return res.json({
    done, next_url: nextUrl || null, outlet_id: rawOutletId,
    moka_outlet_id: mokaOutletId,
    pages_fetched: page, customers_found: customerMap.size,
    upserted, strategy_used: workingStrategy,
    ...(upsertError ? { error: upsertError } : {}),
    ...(apiError && !workingStrategy ? { api_error: apiError } : {}),
  });
});

// ── MEMBER AUTH (OTP via WhatsApp) ───────────────────────────────────────────
{
  const { sendWA: sendWAFonnte } = require('./services/fonnte');

  function normalizeWa(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) return '62' + digits.slice(1);
    if (digits.startsWith('62')) return digits;
    return '62' + digits;
  }

  function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'RBX';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // POST /api/auth/otp/send
  app.post('/api/auth/otp/send', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Nomor HP wajib diisi' });

    const wa = normalizeWa(phone);
    if (wa.length < 10 || !wa.startsWith('62')) {
      return res.status(400).json({ error: 'Format nomor HP tidak valid (contoh: 08123456789)' });
    }

    const phoneE164 = '+' + wa;
    const localPhone = '0' + wa.slice(2);

    // Cek customer dengan format nomor lama maupun format normal baru.
    let customer = null;
    for (const candidate of [wa, phoneE164, localPhone]) {
      const result = await supabase
        .from('customers').select('id, name, wa, phone_e164').eq('wa', candidate).maybeSingle();
      if (result.data) { customer = result.data; break; }
    }
    if (!customer) {
      const result = await supabase
        .from('customers').select('id, name, wa, phone_e164').eq('phone_e164', phoneE164).maybeSingle();
      if (result.data) customer = result.data;
    }

    if (!customer) {
      // Fallback: cek member_profiles (member terdaftar via Moka POS)
      let profile = null;
      for (const candidate of [phoneE164, localPhone, wa]) {
        const result = await supabase
          .from('member_profiles')
          .select('full_name, phone, email, membership_status, membership_activated_at, membership_started_at, membership_expires_at, total_points, total_visits, current_tier, referral_code, birthdate, gender, address')
          .eq('phone', candidate)
          .maybeSingle();
        if (result.data) { profile = result.data; break; }
      }

      if (!profile) {
        return res.status(404).json({
          error: 'Nomor tidak terdaftar sebagai member. Silakan kunjungi outlet untuk mendaftar.'
        });
      }

      // Auto-provision ke customers — satu kali saja
      // upsert onConflict:'wa' mencegah duplikasi saat race condition
      const isSyntheticEmail = Boolean(
        profile.email && /^moka_.+@redbox\.internal$/.test(profile.email)
      );
      const bd = profile.birthdate ? new Date(profile.birthdate) : null;
      const profileMembership = membershipStateForSync({
        existingStatus: profile.membership_status,
        existingActivatedAt: profile.membership_activated_at,
        existingStartedAt: profile.membership_started_at,
        existingExpiresAt: profile.membership_expires_at,
      });
      const provisionData = {
        name:                    profile.full_name || '',
        wa,
        phone_e164:              phoneE164,
        email:                   isSyntheticEmail ? null : (profile.email || null),
        ...profileMembership,
        membership_started_at:   profileMembership.membership_status === 'ACTIVE' ? profile.membership_started_at || null : null,
        points:                  Number(profile.total_points) || 0,
        visits:                  Number(profile.total_visits) || 0,
        referral_code:           profile.referral_code || generateReferralCode(),
        birth_date:              profile.birthdate || null,
        ...(bd && !isNaN(bd) ? {
          birthday: `${String(bd.getUTCMonth()+1).padStart(2,'0')}-${String(bd.getUTCDate()).padStart(2,'0')}`
        } : {}),
        gender:  profile.gender  || null,
        address: profile.address || null,
      };

      let { data: provisioned, error: provErr } = await supabase
        .from('customers')
        .upsert(provisionData, { onConflict: 'wa' })
        .select('id, name, wa')
        .single();

      // Fallback jika kolom points belum ada di DB (sama seperti pola di line ~1768)
      if (provErr?.message?.includes('points')) {
        const { points: _, ...withoutPoints } = provisionData;
        ({ data: provisioned, error: provErr } = await supabase
          .from('customers')
          .upsert(withoutPoints, { onConflict: 'wa' })
          .select('id, name, wa')
          .single());
      }

      if (provErr) {
        console.warn('[OTP] Auto-provision gagal, lanjut in-memory:', provErr.message);
        customer = { id: null, name: provisionData.name, wa };
      } else {
        customer = provisioned || { id: null, name: provisionData.name, wa };
        console.log(`[OTP] Auto-provision sukses: ${wa}`);
      }
    }

    // Naikkan data lama ke format canonical setelah nomor berhasil dikenali.
    if (customer?.id && customer.wa !== wa) {
      const { data: normalizedCustomer } = await supabase.from('customers')
        .update({ wa, phone_e164: phoneE164 }).eq('id', customer.id)
        .select('id, name, wa, phone_e164').maybeSingle();
      if (normalizedCustomer) customer = normalizedCustomer;
    }

    // Rate limit: max 3 OTP per 10 menit
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await supabase.from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('phone', wa).gte('created_at', since);
    if (count >= 3) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Tunggu 10 menit ya kak.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('otp_codes').insert({ phone: wa, code, expires_at: expiresAt });

    const firstName = (customer.name || 'Kak').split(' ')[0];
    const msg = `Halo kak ${firstName}! 👋\n\nKode OTP login Member RedBox Barbershop:\n\n*${code}*\n\nBerlaku 10 menit. Jangan bagikan ke siapapun ya! 🔒\n\nRedBox Barbershop — Sharp Cuts, Bold Style ✂️`;

    try {
      await sendWAFonnte(wa, msg, { branch: 'bypass' });
    } catch (e) {
      console.error('[OTP] sendWA error:', e.message);
      return res.status(500).json({ error: 'Gagal kirim OTP ke WhatsApp. Coba lagi.' });
    }

    console.log(`[OTP] Sent to ${wa}`);
    return res.json({ success: true, message: 'Kode OTP sudah dikirim ke WhatsApp kamu 🎉' });
  });

  // POST /api/auth/otp/verify
  app.post('/api/auth/otp/verify', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ error: 'Phone dan kode OTP wajib diisi' });

    const wa = normalizeWa(phone);
    const phoneE164 = '+' + wa;
    const localPhone = '0' + wa.slice(2);

    const { data: otp } = await supabase
      .from('otp_codes')
      .select('id, attempts')
      .eq('phone', wa)
      .eq('code', String(code).trim())
      .is('verified_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      // Increment attempts on latest OTP
      const { data: latest } = await supabase.from('otp_codes')
        .select('id, attempts').eq('phone', wa).is('verified_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latest) {
        await supabase.from('otp_codes')
          .update({ attempts: (latest.attempts || 0) + 1 }).eq('id', latest.id);
      }
      return res.status(401).json({ error: 'Kode OTP salah atau sudah expired' });
    }

    await supabase.from('otp_codes')
      .update({ verified_at: new Date().toISOString() }).eq('id', otp.id);

    // Get/update customer — support legacy phone formats and converge to canonical WA.
    let customer = null;
    for (const candidate of [wa, phoneE164, localPhone]) {
      const result = await supabase.from('customers').select('*').eq('wa', candidate).maybeSingle();
      if (result.data) { customer = result.data; break; }
    }
    if (!customer) {
      const result = await supabase.from('customers').select('*').eq('phone_e164', phoneE164).maybeSingle();
      if (result.data) customer = result.data;
    }
    if (customer?.id && customer.wa !== wa) {
      const { data: normalizedCustomer } = await supabase.from('customers')
        .update({ wa, phone_e164: phoneE164 }).eq('id', customer.id).select('*').maybeSingle();
      if (normalizedCustomer) customer = normalizedCustomer;
    }
    if (customer && !customer.referral_code) {
      const refCode = generateReferralCode();
      const { data: updated } = await supabase.from('customers')
        .update({ referral_code: refCode }).eq('wa', wa).select().single();
      customer = updated || customer;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('member_sessions').insert({ customer_wa: wa, token, expires_at: expiresAt });

    console.log(`[OTP] Login success: ${wa}`);
    return res.json({ success: true, token, customer });
  });

  // GET /api/auth/me — validasi token, return customer data
  app.get('/api/auth/me', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || req.headers['x-member-token'];
    if (!token) return res.status(401).json({ error: 'Login diperlukan' });

    const { data: session } = await supabase.from('member_sessions')
      .select('customer_wa').eq('token', token)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!session) return res.status(401).json({ error: 'Session expired, silakan login ulang' });

    const { data: customer } = await supabase.from('customers')
      .select('*').eq('wa', session.customer_wa).maybeSingle();

    if (customer) {
      // Cross-reference member_profiles by phone to sync membership status.
      // Orang yang sama bisa punya akun OTP (customers) dan Google (member_profiles)
      // dengan data membership yang berbeda — ambil yang terbaik.
      const phoneE164 = customer.phone_e164 || ('+' + session.customer_wa);
      const localPhone = '0' + session.customer_wa.slice(2);
      const wa = session.customer_wa;
      let profile = null;
      for (const candidate of [phoneE164, localPhone, wa]) {
        const result = await supabase.from('member_profiles')
          .select('membership_status, total_points, total_visits, membership_activated_at, membership_started_at, membership_expires_at, referral_code, full_name, current_tier')
          .eq('phone', candidate).maybeSingle();
        if (result.data) { profile = result.data; break; }
      }

      const profileIsActive = isActiveMembership({
        status: profile?.membership_status,
        startsAt: profile?.membership_started_at,
        expiresAt: profile?.membership_expires_at,
      });
      const customerIsActive = isActiveMembership({
        status: customer.membership_status,
        startsAt: customer.membership_started_at,
        expiresAt: customer.membership_expires_at,
      });
      if (profileIsActive) {
        customer.membership_status      = 'ACTIVE';
        customer.membership_activated_at= profile.membership_activated_at ?? null;
        customer.membership_started_at  = profile.membership_started_at ?? null;
        customer.membership_expires_at  = profile.membership_expires_at;
        customer.points                 = profile.total_points   ?? customer.points ?? 0;
        customer.visits                 = profile.total_visits   ?? customer.visits ?? 0;
        customer.current_tier           = profile.current_tier ?? customer.current_tier ?? null;
        customer.referral_code          = profile.referral_code  ?? customer.referral_code;
        // Sync nama dari member_profiles jika customer belum punya nama lengkap
        if (!customer.name && profile.full_name) customer.name = profile.full_name;
        // Persist ke customers agar next login tidak perlu cross-ref lagi
        supabase.from('customers').update({
          membership_status:       'ACTIVE',
          membership_activated_at: profile.membership_activated_at,
          membership_started_at:   profile.membership_started_at,
          membership_expires_at:   profile.membership_expires_at,
        }).eq('wa', session.customer_wa).catch(() => {});
      } else if (!customerIsActive && customer.membership_status !== 'INACTIVE') {
        customer.membership_status = 'INACTIVE';
        customer.membership_activated_at = null;
        supabase.from('customers').update({
          membership_status: 'INACTIVE',
          membership_activated_at: null,
        }).eq('wa', session.customer_wa).catch(() => {});
      }
    }

    return res.json({ customer: customer || null });
  });

  // POST /api/member/sync — tarik data Moka fresh untuk member yang login
  app.post('/api/member/sync', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || req.headers['x-member-token'];
    if (!token) return res.status(401).json({ error: 'Login diperlukan' });

    const { data: session } = await supabase.from('member_sessions')
      .select('customer_wa').eq('token', token)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!session) return res.status(401).json({ success: false, error: 'Session expired' });

    const wa = session.customer_wa;
    const digits    = String(wa).replace(/\D/g, '');
    const waNorm    = digits.startsWith('62') ? digits : '62' + (digits.startsWith('0') ? digits.slice(1) : digits);
    const phoneE164 = '+' + waNorm;
    const normPhone = (raw) => {
      if (!raw) return '';
      let d = String(raw).replace(/\D/g, '');
      if (d.startsWith('62')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1);
      return d.slice(-11);
    };
    const targetNorm = normPhone(wa);

    const { data: outlets } = await supabase
      .from('outlets').select('id,slug,name,moka_outlet_id')
      .not('moka_outlet_id', 'is', null).eq('is_active', true);
    if (!outlets?.length) return res.json({ success: false, error: 'No active outlets' });

    const PAGE_DELAY_MS  = 150;
    const MAX_BUDGET_MS  = 8000;
    const POINTS_PER_VISIT = 50;
    const TIER_THRESHOLDS = [
      { name: 'platinum', min: 3000 },
      { name: 'gold',     min: 1000 },
      { name: 'silver',   min:  500 },
      { name: 'bronze',   min:    0 },
    ];
    const getTier = (pts) => { for (const t of TIER_THRESHOLDS) if (pts >= t.min) return t.name; return 'bronze'; };

    let totalVisits = 0, totalSpent = 0, lastVisit = null, firstVisit = null;
    const startTime = Date.now();

    try {
      const MokaClient = require('./moka/client');
      for (const outlet of outlets) {
        if (Date.now() - startTime > MAX_BUDGET_MS) break;
        const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
        let sinceEpoch = null;
        while (true) {
          if (Date.now() - startTime > MAX_BUDGET_MS) break;
          let json;
          try {
            const remaining = MAX_BUDGET_MS - (Date.now() - startTime);
            if (remaining <= 0) break;
            const budgetDeadline = new Promise((_, reject) =>
              setTimeout(() => reject(Object.assign(new Error('budget'), { status: 408 })), remaining)
            );
            json = await Promise.race([client.getTransactionPage({ sinceEpoch, limit: 100 }), budgetDeadline]);
          } catch (err) { if (err.status === 404 || err.status === 403 || err.status === 408) break; throw err; }
          const payments = json?.data?.payments ?? [];
          for (const p of payments) {
            if (p.is_deleted || p.is_refunded) continue;
            const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
            if (norm !== targetNorm) continue;
            totalVisits++;
            totalSpent += Number(p.total_collected || p.total_transaction || 0);
            const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
            if (txDate && (!lastVisit  || txDate > lastVisit))  lastVisit  = txDate;
            if (txDate && (!firstVisit || txDate < firstVisit)) firstVisit = txDate;
          }
          if (json?.data?.completed || !payments.length) break;
          const m2 = (json?.data?.next_url || '').match(/[?&]since=([0-9.]+)/);
          if (!m2) break;
          sinceEpoch = parseFloat(m2[1]);
          await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
        }
      }

      const newPoints = totalVisits * POINTS_PER_VISIT;
      const newTier   = getTier(newPoints);
      const now       = new Date().toISOString();

      const custPatch = { visits: totalVisits, points: newPoints, total_spent: totalSpent, last_visit: lastVisit, updated_at: now };
      if (firstVisit) custPatch.first_visit = firstVisit;
      const { error: custErr } = await supabase.from('customers').update(custPatch).eq('wa', waNorm);
      if (custErr) throw new Error(`customers update failed: ${custErr.message}`);

      const { data: existing } = await supabase.from('member_profiles')
        .select('id,full_name,phone,membership_status,membership_activated_at,membership_started_at,membership_expires_at')
        .eq('phone', phoneE164).maybeSingle();

      if (existing) {
        const membership = membershipStateForSync({
          existingStatus: existing.membership_status,
          existingActivatedAt: existing.membership_activated_at,
          existingStartedAt: existing.membership_started_at,
          existingExpiresAt: existing.membership_expires_at,
        });
        const { error: profErr } = await supabase.from('member_profiles').update({
          total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
          ...membership,
          updated_at: now,
        }).eq('id', existing.id);
        if (profErr) throw new Error(`member_profiles update failed: ${profErr.message}`);
      } else {
        const { data: cust } = await supabase.from('customers')
          .select('name,email,referral_code,membership_status,membership_activated_at,membership_started_at,membership_expires_at')
          .eq('wa', waNorm).maybeSingle();
        const phoneNormShort = targetNorm;
        const userKey = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}`;
        const email   = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}@redbox.internal`;
        const membership = membershipStateForSync({
          customerStatus: cust?.membership_status,
          customerActivatedAt: cust?.membership_activated_at,
          customerStartedAt: cust?.membership_started_at,
          customerExpiresAt: cust?.membership_expires_at,
        });
        const { error: upsertErr } = await supabase.from('member_profiles').upsert({
          user_key: userKey, email, full_name: cust?.name || '', phone: phoneE164,
          ...membership,
          total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
        }, { onConflict: 'user_key' });
        if (upsertErr) throw new Error(`member_profiles upsert failed: ${upsertErr.message}`);
      }

      const { data: custData } = await supabase.from('customers').select('name').eq('wa', waNorm).maybeSingle();

      return res.json({
        success: true,
        full_name: existing?.full_name || custData?.name || '',
        visits: totalVisits, points: newPoints, tier: newTier,
        last_visit: lastVisit, first_visit: firstVisit, total_spent: totalSpent,
      });
    } catch (err) {
      console.error('[MemberSync]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/auth/me — update profil member
  app.patch('/api/auth/me', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || req.headers['x-member-token'];
    if (!token) return res.status(401).json({ error: 'Login diperlukan' });

    const { data: session } = await supabase.from('member_sessions')
      .select('customer_wa').eq('token', token)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!session) return res.status(401).json({ error: 'Session expired' });

    const allowed = ['name', 'email', 'birth_date', 'gender', 'address', 'fav_barber'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    // Sync birthday MM-DD dari birth_date untuk cron ulang tahun
    if (updates.birth_date) {
      const d = new Date(updates.birth_date);
      if (!isNaN(d)) {
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        updates.birthday = `${mm}-${dd}`;
      }
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Tidak ada field yang diupdate' });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('customers')
      .update(updates).eq('wa', session.customer_wa).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ customer: data });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, res) => {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || req.headers['x-member-token'];
    if (token && supabase) {
      await supabase.from('member_sessions').delete().eq('token', token).catch(() => {});
    }
    return res.json({ success: true });
  });
}

// ── MOKA INTEGRATION ROUTER ──────────────────────────────
// Registers: /api/availability, /api/reservations, /api/schedules,
//            /api/outlets, /api/services, /api/moka/*
// Uses real Supabase when available, falls back to in-memory for OAuth only
const { createInMemorySupabase } = require('./moka/memoryStore');
const memorySupabase = createInMemorySupabase();

const createMokaRouter = require('./moka/routes');
// Prefer real Supabase so sync-schema and DB writes work correctly
const mokaRouter = createMokaRouter(supabase || memorySupabase);
app.use('/api', mokaRouter);
console.log('✅ Moka integration routes mounted');

// Background: start cron jobs
try {
  const { startCronJobs } = require('./moka/sync');
  if (supabase) {
    supabase.from('outlets').select('id').limit(1)
      .then(() => console.log('✅ Supabase outlets table available'))
      .catch(() => console.log('⚠️  Supabase outlets table missing'));
    const { isMokaOAuthConfigured } = require('./moka/oauth');
    if (isMokaOAuthConfigured()) startCronJobs(supabase);
  }
} catch (e) {
  console.warn('[Cron] Could not start Moka cron jobs:', e.message);
}

// Barber self-service routes
const { createBarberRoutes } = require('./routes/barber');
app.use('/api/barber', createBarberRoutes(supabase));
const { createBarberCronRoutes } = require('./routes/barberCron');
app.use('/api/cron', createBarberCronRoutes(supabase, adminAuth));
const { createAdminCrmRoutes, createMembershipRegistrationRoutes } = require('./routes/adminCrm');
const { createMembershipRegistrationRateLimiters } = require('./services/membershipRegistration');
app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
app.use('/api', createMembershipRegistrationRoutes(supabase, {
  rateLimiters: createMembershipRegistrationRateLimiters(),
}));

// POST /api/push/subscribe — save push subscription token
app.post('/api/push/subscribe', async (req, res) => {
  const { user_id, endpoint, p256dh, auth } = req.body;
  if (!user_id || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /api/push/send — send push to user or branch (admin only)
app.post('/api/push/send', adminAuth, async (req, res) => {
  const { user_id, branch, title, body, url } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  try {
    if (user_id) {
      await sendPushToUser(supabase, user_id, { title, body, url });
    } else if (branch) {
      await sendPushToBranch(supabase, branch, { title, body, url });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// START SERVER
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🔴 REDBOX CRM API running at http://localhost:${PORT}`);
    console.log(`📋 Database: ${DB_TYPE}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health\n`);
  });
}

// ================================================
// TEST — Send review WA for a specific booking (bypass time check)
// POST /api/cron/review-request/test  { booking_id }
// ================================================
app.post('/api/cron/review-request/test', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers['authorization'];
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const { booking_id } = req.body || {};
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, date, time, location, barber_id, duration')
      .eq('id', booking_id)
      .single();

    if (error || !booking) return res.status(404).json({ error: 'Booking not found' });

    let barberName = null;
    if (booking.barber_id) {
      const { data: barber } = await supabase.from('barbers').select('name').eq('id', booking.barber_id).single();
      barberName = barber?.name || null;
    }

    const result = await notifyCustomerReviewRequest({ ...booking, barber_name: barberName });
    return res.json({ ok: true, wa: booking.wa, name: booking.name, kapster: barberName, fonnte: result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ================================================
// CRON — REVIEW REQUEST (called by cron-job.org every 30 min)
// GET /api/cron/review-request
// ================================================
function parseDurationMinutes(durStr) {
  if (!durStr) return 60;
  const m = String(durStr).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 60;
}

app.get('/api/cron/review-request', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers['authorization'];
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const nowUTC = new Date();
  const nowWIB = new Date(nowUTC.getTime() + 7 * 3600000);
  console.log(`[ReviewRequest] Fired at ${nowWIB.toISOString().slice(0,16)} WIB`);

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const cutoffDate = new Date(nowUTC.getTime() - 48 * 3600000).toISOString().slice(0, 10);

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, date, time, location, barber_id, duration, status')
      .in('status', ['confirmed', 'done'])
      .is('review_sent_at', null)
      .gte('date', cutoffDate)
      .not('wa', 'is', null);

    if (error) return res.status(500).json({ error: error.message });
    if (!bookings || bookings.length === 0) return res.status(200).json({ sent: 0 });

    const barberIds = [...new Set(bookings.map(b => b.barber_id).filter(Boolean))];
    const barberMap = {};
    if (barberIds.length) {
      const { data: barbers } = await supabase.from('barbers').select('id, name').in('id', barberIds);
      for (const b of barbers || []) barberMap[b.id] = b.name;
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const booking of bookings) {
      if (!booking.wa) { skipped++; continue; }
      const durationMin = parseDurationMinutes(booking.duration);
      const triggerTime = new Date(
        new Date(`${booking.date}T${booking.time}+07:00`).getTime() + (durationMin + 30) * 60000
      );
      if (nowUTC < triggerTime) { skipped++; continue; }

      try {
        const result = await notifyCustomerReviewRequest({ ...booking, barber_name: barberMap[booking.barber_id] || null });
        if (result && result.status === false) {
          failed++;
        } else {
          await supabase.from('bookings').update({ review_sent_at: nowUTC.toISOString() }).eq('id', booking.id);
          sent++;
          console.log(`[ReviewRequest] Sent → ${booking.name} (${booking.wa})`);
        }
      } catch (e) { failed++; console.error('[ReviewRequest] send error:', e.message); }
    }

    console.log(`[ReviewRequest] sent:${sent} skipped:${skipped} failed:${failed}`);
    return res.json({ sent, skipped, failed });
  } catch (e) {
    console.error('[ReviewRequest] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// CRON — durable customer WhatsApp delivery retry (called every 2 minutes)
app.get('/api/cron/booking-notifications', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const token = req.query.token || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (secret && token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  if (DB_TYPE !== 'supabase' || !supabase) return res.json({ ok: true, skipped: 'supabase_not_configured' });
  try {
    const result = await processCustomerNotificationOutbox(supabase, 25);
    return res.json({ ok: true, ...result, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[BookingNotifCron] failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Notification retry failed' });
  }
});

// ================================================
// REVIEW SYSTEM
// ================================================

const GOOGLE_REVIEW_URLS = {
  bypass:    'https://g.page/r/CQVtP1_nV-SFEBM/review',
  samadikun: 'https://g.page/r/CYSfr6rTvLs1EBM/review',
  sumber:    'https://g.page/r/CS9yPcCA-CznEBM/review',
  tegal:     'https://g.page/r/CWg3nZeYXRxSEBM/review',
  csb:       'https://g.page/r/CbsPlES6TnydEBM/review',
};

// GET /api/reviews/booking?b=<uuid>  — fetch booking info for review page
app.get('/api/reviews/booking', async (req, res) => {
  const { b } = req.query;
  if (!b || !/^[0-9a-f-]{36}$/i.test(b)) return res.status(400).json({ error: 'Invalid booking id' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('bookings')
      .select('id, name, service, date, time, location, barber_id')
      .eq('id', b)
      .neq('status', 'cancelled')
      .single();

    if (error || !data) return res.status(404).json({ error: 'Booking not found' });

    // Resolve kapster name
    let kapsterName = null;
    if (data.barber_id) {
      const { data: barber } = await supabase
        .from('barbers').select('name').eq('id', data.barber_id).single();
      kapsterName = barber?.name || null;
    }

    // Check if already reviewed
    const { data: existing } = await supabase
      .from('reviews').select('id').eq('booking_id', b).maybeSingle();

    return res.json({
      id: data.id,
      customer_name: data.name,
      service: data.service,
      date: data.date,
      time: data.time,
      branch: data.location,
      kapster_id: data.barber_id,
      kapster_name: kapsterName,
      already_reviewed: !!existing,
      google_review_url: GOOGLE_REVIEW_URLS[String(data.location).toLowerCase()] || null,
    });
  } catch (e) {
    console.error('[Reviews] booking fetch error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reviews/submit  — save review + auto-credit points + sync to Moka
app.post('/api/reviews/submit', async (req, res) => {
  const { booking_id, rating, comment } = req.body || {};

  if (!booking_id || !/^[0-9a-f-]{36}$/i.test(booking_id))
    return res.status(400).json({ error: 'Invalid booking_id' });
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating harus 1–5' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Validate booking exists with wa number for points credit
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, name, wa, barber_id, location')
      .eq('id', booking_id)
      .neq('status', 'cancelled')
      .single();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Duplicate check
    const { data: dup } = await supabase
      .from('reviews').select('id').eq('booking_id', booking_id).maybeSingle();
    if (dup) return res.status(409).json({ error: 'Sudah pernah review' });

    // Resolve kapster name
    let kapsterName = null;
    if (booking.barber_id) {
      const { data: barber } = await supabase
        .from('barbers').select('name').eq('id', booking.barber_id).single();
      kapsterName = barber?.name || null;
    }

    // Insert review
    const { error: insertErr } = await supabase.from('reviews').insert({
      booking_id,
      customer_name: booking.name,
      kapster_id: booking.barber_id || null,
      kapster_name: kapsterName,
      branch: booking.location,
      rating: Number(rating),
      comment: comment ? String(comment).trim().slice(0, 1000) : null,
      is_public: true,
    });

    if (insertErr) {
      if (insertErr.code === '23505') return res.status(409).json({ error: 'Sudah pernah review' });
      throw insertErr;
    }

    // Auto-credit points for positive reviews (rating 4-5)
    let pointsCredited = false;
    let totalPoints = 0;
    if (rating >= 4) {
      try {
        // Find customer by WA number
        const { data: customer } = await supabase
          .from('customers')
          .select('id, wa')
          .eq('wa', booking.wa)
          .single();

        if (customer) {
          // Check if already credited for this booking
          const { data: existing } = await supabase
            .from('member_points')
            .select('id')
            .eq('source', 'review')
            .eq('source_id', booking_id)
            .eq('customer_id', customer.id)
            .maybeSingle();

          if (!existing) {
            // Credit 5 points (Rp 50,000 value)
            const { error: pointsErr } = await supabase.from('member_points').insert({
              customer_id: customer.id,
              customer_wa: customer.wa,
              points: 5,
              type: 'earned',
              source: 'review',
              source_id: booking_id,
              description: `Bonus 5 poin (Rp 50,000) untuk ulasan positif ${rating} bintang ⭐`,
              value_idr: 50000,
            });

            if (!pointsErr) {
              pointsCredited = true;
              // Get total points
              const { data: balance } = await supabase
                .from('member_points_balance')
                .select('total_points')
                .eq('customer_id', customer.id)
                .single();
              totalPoints = balance?.total_points || 5;

              // Send WA notification about points (non-blocking)
              notifyCustomerReviewPointsCredited(customer.wa, customer.wa, rating, 5, totalPoints, booking.location).catch(() => {});
            }
          }
        }
      } catch (pointsError) {
        console.error('[Reviews] Points credit error:', pointsError.message);
        // Don't fail the review submission if points credit fails
      }
    }

    // Sync review to Moka Feedback CRM (non-blocking, don't fail if Moka fails)
    let mokaSyncResult = null;
    try {
      const { isMokaOAuthConfigured } = require('./moka/oauth');
      if (isMokaOAuthConfigured()) {
        // Get outlet moka_outlet_id from location
        const { data: outlet } = await supabase
          .from('outlets')
          .select('id, moka_outlet_id')
          .eq('slug', booking.location)
          .maybeSingle();

        // Get moka_order_id from schedules if exists
        const { data: schedule } = await supabase
          .from('schedules')
          .select('external_id')
          .eq('id', booking_id)
          .maybeSingle();

        if (outlet?.moka_outlet_id) {
          const MokaClient = require('./moka/client');
          const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);

          // Normalize WA to +62 format
          const waNormalized = toE164Indonesia(booking.wa);

          mokaSyncResult = await client.submitFeedback({
            customer_name: booking.name,
            customer_phone: waNormalized,
            rating: Number(rating),
            comment: comment ? String(comment).trim().slice(0, 500) : null,
            order_id: schedule?.external_id || null,
            source: 'website',
          });

          if (mokaSyncResult.success) {
            console.log(`[Reviews] Moka feedback synced: ${booking_id}`);
          } else {
            console.warn(`[Reviews] Moka feedback failed: ${mokaSyncResult.error}`);
          }
        }
      }
    } catch (mokaError) {
      console.error('[Reviews] Moka sync error:', mokaError.message);
      mokaSyncResult = { success: false, error: mokaError.message };
    }

    return res.json({
      ok: true,
      points_credited: pointsCredited,
      total_points: totalPoints,
      moka_synced: mokaSyncResult?.success || false,
      moka_error: mokaSyncResult?.error || null,
      google_review_url: GOOGLE_REVIEW_URLS[String(booking.location).toLowerCase()] || null,
    });
  } catch (e) {
    console.error('[Reviews] submit error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews/public?branch=<branch>&limit=<n>  — public reviews for website
app.get('/api/reviews/public', async (req, res) => {
  const branch = req.query.branch ? String(req.query.branch).toLowerCase() : null;
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const kapster = req.query.kapster || null;

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    let q = supabase
      .from('reviews')
      .select('id, customer_name, kapster_name, branch, rating, comment, created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (branch) q = q.eq('branch', branch);
    if (kapster) q = q.eq('kapster_id', kapster);

    const { data, error } = await q;
    if (error) throw error;

    // Aggregate stats
    const avg = data.length ? (data.reduce((s, r) => s + r.rating, 0) / data.length).toFixed(1) : null;

    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.json({ reviews: data || [], count: data?.length || 0, average_rating: avg });
  } catch (e) {
    console.error('[Reviews] public fetch error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
