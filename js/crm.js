// ================================================
// REDBOX CRM DASHBOARD — JS
// Mode 1: API (Node.js + MySQL / Supabase)
// Mode 2: localStorage fallback (offline/dev)
// ================================================

const API_URL = (() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return 'http://localhost:3001/api';
  return `${window.location.protocol}//${window.location.host}/api`;
})();

let USE_API = false;

// Admin token disimpan di sessionStorage (hilang saat tab ditutup, tidak bisa dicuri via XSS lintas sesi)
function getAdminToken() { return sessionStorage.getItem('rb_admin_token') || localStorage.getItem('rb_admin_token') || ''; }
function setAdminToken(t) {
  sessionStorage.setItem('rb_admin_token', t);
  // Hapus dari localStorage jika masih ada (migrasi dari versi lama)
  localStorage.removeItem('rb_admin_token');
}
function clearAdminToken() {
  sessionStorage.removeItem('rb_admin_token');
  localStorage.removeItem('rb_admin_token');
}

const apiHeaders = () => ({ 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() });

// ── XSS-safe helper ───────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── TOAST NOTIFICATION SYSTEM ────────────────────
const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || 'ℹ'}</span><span class="toast-msg">${esc(message)}</span><button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, duration);
}

// ── ANIMATED COUNTER ─────────────────────────────
function animateCounter(el, target, duration = 600) {
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── TIME-BASED GREETING ──────────────────────────
function updateGreeting() {
  const hour = new Date().getHours();
  let greeting = 'Good Evening';
  if (hour >= 5 && hour < 12) greeting = 'Good Morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
  const el = document.getElementById('greetingTitle');
  if (el) el.textContent = `${greeting}, Admin`;
  const sub = document.getElementById('greetingSub');
  if (sub) {
    const d = new Date();
    sub.textContent = `Here's what's happening at Redbox — ${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
}

function safePrompt(message) {
  try { return typeof window.prompt === 'function' ? window.prompt(message) : null; } catch { return null; }
}

async function handleApiError(res) {
  if (res.status === 401) {
    clearAdminToken();
    const pwd = safePrompt('Masukkan Admin Password:');
    if (pwd) { setAdminToken(pwd); window.location.reload(); return 'reauth'; }
    showToast('Admin login diperlukan untuk membuka data dashboard live', 'warning', 3500);
    return 'unauthorized';
  }
  try { const j = await res.json(); console.error('API Error:', j.error || 'Unknown error'); } catch { console.error('API Error: Could not parse response'); }
  return null;
}

function renderLockedState(message = 'Admin password diperlukan untuk memuat dashboard live.') {
  ['statToday', 'statDone', 'statPending', 'statCustomers', 'gsToday', 'gsPending'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });

  const targets = [
    ['todaySlots', 'No bookings today'],
    ['recentList', 'No bookings yet'],
    ['bookingsBody', ''],
    ['customersBody', ''],
    ['barbersGrid', ''],
    ['crmCalGrid', ''],
    ['slotTimeline', ''],
    ['view-revenue', ''],
  ];

  targets.forEach(([id, fallback]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'bookingsBody' || id === 'customersBody') {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<p class="empty-state">${esc(message)}</p>`;
  });

  const bookingsEmpty = document.getElementById('bookingsEmpty');
  if (bookingsEmpty) { bookingsEmpty.style.display = ''; bookingsEmpty.textContent = message; }

  const customersEmpty = document.getElementById('customersEmpty');
  if (customersEmpty) { customersEmpty.style.display = ''; customersEmpty.textContent = message; }

  const dayCard = document.getElementById('dayDetailCard');
  if (dayCard) dayCard.style.display = 'none';
}

async function ensureAdminSession() {
  if (!USE_API) return true;
  if (getAdminToken()) return true;
  const pwd = safePrompt('Masukkan Admin Password untuk akses CRM:');
  if (!pwd) {
    renderLockedState();
    showToast('Admin login diperlukan untuk melihat data live', 'warning', 3500);
    return false;
  }
  setAdminToken(pwd);
  return true;
}

async function detectApiMode(showStatusToast = true) {
  try {
    const res = await fetch(API_URL + '/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const info = await res.json();
      USE_API = true;
      const dbText = info.db_type === 'mysql' ? '🟢 MySQL (XAMPP)' : '🟢 PostgreSQL (Supabase)';
      showDbBadge(dbText, 'green', 'dbBadge');
      if (info.airtable === 'connected') showDbBadge('☁️ Airtable Sync: ON', 'blue', 'airtableBadge');
    }
  } catch { USE_API = false; showDbBadge('🟡 Local (Offline Mode)', 'yellow', 'dbBadge'); }
  if (showStatusToast && typeof showToast === 'function') {
    showToast(USE_API ? 'Connected to server' : 'Running in offline mode', USE_API ? 'success' : 'info', 2500);
  }
}

function showDbBadge(text, color, id = 'dbBadge') {
  let badge = document.getElementById(id);
  const colors = {
    green:  { bg: 'rgba(22,163,74,.15)', text: '#4ade80', border: 'rgba(22,163,74,.3)' },
    yellow: { bg: 'rgba(202,138,4,.15)', text: '#fbbf24', border: 'rgba(202,138,4,.3)' },
    blue:   { bg: 'rgba(59,130,246,.15)', text: '#60a5fa', border: 'rgba(59,130,246,.3)' }
  };
  const c = colors[color] || colors.yellow;
  if (!badge) { badge = document.createElement('span'); badge.id = id; document.querySelector('.topbar-left')?.appendChild(badge); }
  badge.textContent = text;
  badge.style.cssText = `font-size:.7rem;padding:3px 10px;border-radius:100px;margin-left:10px;background:${c.bg};color:${c.text};border:1px solid ${c.border};`;
}

// ── Pagination State ───────────────────────────
const PAGE_SIZE = 25;
let bookingsPage = 0;
let bookingsTotalCount = 0;

// ── API wrappers ────────────────────────────────
async function apiGetBookings(params = {}) {
  if (!USE_API) {
    const local = getBookings();
    await autoMarkDoneIfNeeded(local, true);
    return local;
  }
  try {
    params._t = Date.now();
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${API_URL}/bookings?${q}`, { headers: apiHeaders() });
    if (!res.ok) {
      const apiErr = await handleApiError(res);
      if (apiErr === 'unauthorized') return null;
      return getBookings();
    }
    const json = await res.json();
    bookingsTotalCount = json.total || json.data?.length || 0;
    const data = json.data || [];
    await autoMarkDoneIfNeeded(data, false);
    return data;
  } catch(e) { console.warn('apiGetBookings failed:', e); return getBookings(); }
}

async function apiGetCustomers(params = {}) {
  if (!USE_API) return getCustomers();
  try {
    params._t = Date.now();
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${API_URL}/customers?${q}`, { headers: apiHeaders() });
    if (!res.ok) {
      const apiErr = await handleApiError(res);
      if (apiErr === 'unauthorized') return null;
      return getCustomers();
    }
    const json = await res.json();
    return json.data || [];
  } catch(e) { return getCustomers(); }
}

async function apiGetStats() {
  if (!USE_API) {
    const today = todayStr();
    const bks = getBookings();
    return { today: bks.filter(b => b.date === today && b.status !== 'cancelled').length, done: bks.filter(b => b.status === 'done').length, pending: bks.filter(b => ['pending','confirmed'].includes(b.status)).length, customers: getCustomers().length };
  }
  try {
    const res = await fetch(`${API_URL}/stats?_t=${Date.now()}`, { headers: apiHeaders() });
    if (!res.ok) {
      const apiErr = await handleApiError(res);
      if (apiErr === 'unauthorized') return null;
    }
    return await res.json();
  } catch { return { today: 0, done: 0, pending: 0, customers: 0 }; }
}

async function apiGetBarbers() {
  if (!USE_API) return Object.entries(BARBER_DATA).map(([id, data]) => ({ id, ...data }));
  try {
    const res = await fetch(`${API_URL}/barbers?_t=${Date.now()}`, { headers: apiHeaders() });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch { return []; }
}

async function apiGetRevenue(params = {}) {
  try {
    params._t = Date.now();
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${API_URL}/revenue?${q}`, { headers: apiHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function apiSaveBooking(data, id = null) {
  if (!USE_API) {
    let bookings = getBookings();
    if (id) { bookings = bookings.map(b => b.id === id ? { ...b, ...data } : b); }
    else { bookings.push({ id: genId(), ...data, createdAt: new Date().toISOString() }); }
    saveBookings(bookings);
    return { success: true };
  }
  const url = id ? `${API_URL}/bookings/${id}` : `${API_URL}/bookings`;
  const res = await fetch(url, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(data) });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const err = await res.json(); msg = err.error || msg; } catch { try { msg += ': ' + (await res.text()).slice(0, 120); } catch {} }
    throw new Error(msg);
  }
  return res.json();
}

async function apiSetBookingStatus(id, status) {
  if (!USE_API) return true;
  const res = await fetch(`${API_URL}/bookings/${id}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ status }) });
  if (!res.ok) { await handleApiError(res); return false; }
  return true;
}

const TIME_SLOTS = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];
const BARBER_DATA = {};
const LOCATION_LABELS = { bypass: 'Bypass', samadikun: 'Samadikun', csb: 'Csb Mall', sumber: 'Sumber', tegal: 'Tegal' };
let CACHED_BARBERS = null;

async function getBarberById(id) {
  if (!CACHED_BARBERS) CACHED_BARBERS = await apiGetBarbers();
  return CACHED_BARBERS.find(b => b.id === id) || null;
}
async function getBarberName(id) { const b = await getBarberById(id); return b ? b.name : 'Anyone'; }

async function populateBarberFilters() {
  const barbers = await apiGetBarbers();
  const barberOptions = barbers.map(b => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(LOCATION_LABELS[b.branch] || b.branch)})</option>`).join('');
  const update = (id, html) => { const el = document.getElementById(id); if (el) { const v = el.value; el.innerHTML = html; if (v) el.value = v; } };
  update('calBarberFilter', '<option value="all">All Barbers</option>' + barberOptions);
  update('bookingBarberFilter', '<option value="all">All Barbers</option>' + barberOptions + '<option value="any">Anyone Available</option>');
  update('mBarber', '<option value="any">Anyone Available</option>' + barberOptions);
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let adminCalYear = new Date().getFullYear();
let adminCalMonth = new Date().getMonth();
let selectedCalDate = null;
let editingBookingId = null;
let detailBookingId = null;
let REFRESHING = false;

// ── STORAGE HELPERS ─────────────────────────────
function getBookings() { try { return JSON.parse(localStorage.getItem('rb_bookings') || '[]'); } catch { return []; } }
function saveBookings(arr) { localStorage.setItem('rb_bookings', JSON.stringify(arr)); }
function getCustomers() { try { return JSON.parse(localStorage.getItem('rb_customers') || '[]'); } catch { return []; } }
function saveCustomers(arr) { localStorage.setItem('rb_customers', JSON.stringify(arr)); }

function genId() { return 'bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
const fmt = n => 'Rp ' + Number(n).toLocaleString('id-ID');
function dateKey(v) { return v ? String(v).slice(0, 10) : ''; }
function timeKey(v) { return v ? String(v).slice(0, 5) : ''; }
function fmtDate(str) {
  const key = dateKey(str);
  if (!key) return '—';
  const d = new Date(key + 'T12:00:00');
  return DAYS_SHORT[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── ANTI DOUBLE BOOKING ─────────────────────────
function timeToMins(t) { if (!t) return 0; const [h, m] = t.split(':'); return parseInt(h) * 60 + parseInt(m); }
function parseDuration(durStr) {
  if (!durStr) return 60;
  const s = durStr.toLowerCase();
  if (s.includes('menit')) { const m = parseInt(s); return isNaN(m) ? 60 : m; }
  if (s.includes('jam')) { const m = parseFloat(s); return isNaN(m) ? 60 : m * 60; }
  return 60;
}
function bookingEndMs(b) {
  const date = dateKey(b?.date), time = timeKey(b?.time);
  if (!date || !time) return null;
  const base = new Date(date + 'T00:00:00');
  if (isNaN(base.getTime())) return null;
  base.setMinutes(timeToMins(time) + parseDuration(b?.duration), 0, 0);
  return base.getTime();
}

async function autoMarkDoneIfNeeded(bookings, persistLocal) {
  const now = Date.now();
  const toUpdate = bookings.filter(b => b?.id && b.status !== 'done' && b.status !== 'cancelled' && (bookingEndMs(b) || 0) <= now);
  if (!toUpdate.length) return;
  for (const b of toUpdate) {
    const ok = USE_API ? await apiSetBookingStatus(b.id, 'done') : true;
    if (!ok) continue;
    b.status = 'done';
    if (persistLocal) {
      try { const ex = getBookings(); const idx = ex.findIndex(x => x.id === b.id); if (idx >= 0) ex[idx] = { ...ex[idx], status: 'done' }; saveBookings(ex); } catch {}
    }
    try { syncCustomer(b); } catch {}
  }
}

async function hasConflict(barber, date, time, durationStr = '60 menit', excludeId = null) {
  if (barber === 'any') return false;
  const newStart = timeToMins(time), newEnd = newStart + parseDuration(durationStr);

  // Check legacy bookings table
  const bookings = await apiGetBookings();
  const legacyHit = bookings.some(b => {
    const bb = b.barber_id || b.barber;
    if (b.id === excludeId || bb !== barber || dateKey(b.date) !== date || b.status === 'cancelled') return false;
    const bStart = timeToMins(timeKey(b.time)), bEnd = bStart + parseDuration(b.duration);
    return (newStart < bEnd) && (bStart < newEnd);
  });
  if (legacyHit) return true;

  // Also check schedules table (Moka walk-ins & online bookings)
  try {
    const res = await fetch(
      `${API_URL}/schedules?barberId=${encodeURIComponent(barber)}&date=${date}&limit=50`,
      { headers: apiHeaders(), signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return false;
    const { schedules } = await res.json();
    const newStartMs = new Date(`${date}T${time.slice(0, 5)}:00+07:00`).getTime();
    const newEndMs   = newStartMs + parseDuration(durationStr) * 60_000;
    return (schedules || []).some(s => {
      if (s.status === 'cancelled' || s.status === 'rejected') return false;
      const sStart = new Date(s.start_time).getTime();
      const sEnd   = new Date(s.end_time).getTime();
      return (newStartMs < sEnd) && (sStart < newEndMs);
    });
  } catch {
    return false; // non-fatal — jangan block booking jika schedules check gagal
  }
}

function hasConflictSync(bookings, barber, date, time, durationStr, excludeId) {
  const newStart = timeToMins(time), newEnd = newStart + parseDuration(durationStr);
  return bookings.some(b => {
    const bb = b.barber_id || b.barber;
    if (b.id === excludeId || bb !== barber || b.date !== date || b.status === 'cancelled') return false;
    const bStart = timeToMins(b.time), bEnd = bStart + parseDuration(b.duration);
    return (newStart < bEnd) && (bStart < newEnd);
  });
}

// ── CUSTOMER SYNC (localStorage offline mode) ───
function syncCustomer(booking) {
  let customers = getCustomers();
  let existing = customers.find(c => c.wa === booking.wa);
  if (existing) {
    existing.visits = (existing.visits || 0) + 1;
    existing.lastVisit = booking.date;
    existing.totalSpent = (existing.totalSpent || 0) + (booking.price || 0);
    existing.services = existing.services || [];
    if (!existing.services.includes(booking.service)) existing.services.push(booking.service);
  } else {
    customers.push({ id: 'cu_' + Date.now(), name: booking.name, wa: booking.wa, visits: 1, lastVisit: booking.date, totalSpent: booking.price || 0, services: [booking.service], createdAt: booking.date });
  }
  saveCustomers(customers);
}

// ── VIEW NAVIGATION ─────────────────────────────
document.querySelectorAll('.sb-link').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.sb-link').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.crm-view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) { el.classList.add('active'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; }
    document.getElementById('pageTitle').textContent = btn.textContent.trim();
    renderView(view);
    document.getElementById('crmSidebar').classList.remove('open');
  });
});
document.getElementById('sidebarToggle')?.addEventListener('click', () => document.getElementById('crmSidebar').classList.toggle('open'));

async function renderView(view) {
  if (!(await ensureAdminSession())) return;
  if (view === 'overview')   await renderOverview();
  if (view === 'calendar')   await renderAdminCalendar();
  if (view === 'bookings') {
    const s = document.getElementById('bookingSearch')?.value || '';
    const st = document.getElementById('bookingStatusFilter')?.value || 'all';
    const b = document.getElementById('bookingBarberFilter')?.value || 'all';
    await renderBookingsTable(s, st, b, bookingsPage || 0);
  }
  if (view === 'barbers')    await renderBarbers();
  if (view === 'customers')  await renderCustomers();
  if (view === 'revenue')    await renderRevenue();
}

function getCurrentView() { return document.querySelector('.sb-link.active')?.dataset.view || 'overview'; }

// ── OVERVIEW ────────────────────────────────────
async function renderOverview() {
  const today = todayStr();
  const stats = await apiGetStats();
  if (!stats) return renderLockedState();
  animateCounter(document.getElementById('statToday'), stats.today);
  animateCounter(document.getElementById('statDone'), stats.done);
  animateCounter(document.getElementById('statPending'), stats.pending);
  animateCounter(document.getElementById('statCustomers'), stats.customers);
  animateCounter(document.getElementById('gsToday'), stats.today);
  animateCounter(document.getElementById('gsPending'), stats.pending);
  document.getElementById('todayDateLabel').textContent = fmtDate(today);
  updateGreeting();

  const bookings = await apiGetBookings({ date: today });
  if (!bookings) return renderLockedState();
  const todayBks = bookings.filter(b => dateKey(b.date) === today);
  const slotsEl = document.getElementById('todaySlots');
  if (!todayBks.length) {
    slotsEl.innerHTML = '<p class="empty-state">No bookings today</p>';
  } else {
    todayBks.sort((a, b) => timeKey(a.time).localeCompare(timeKey(b.time)));
    const items = await Promise.all(todayBks.map(async b => {
      const barberName = await getBarberName(b.barber_id || b.barber);
      return `<div class="slot-item">
        <span class="slot-time">${esc(timeKey(b.time))}</span>
        <div class="slot-info"><div class="slot-name">${esc(b.name)}</div><div class="slot-meta">${esc(b.service)} · ${esc(barberName)}</div></div>
        <span class="slot-status status-${esc(b.status)}">${esc(b.status)}</span>
      </div>`;
    }));
    slotsEl.innerHTML = items.join('');
  }

  const allBookings = await apiGetBookings({ limit: 6 });
  if (!allBookings) return renderLockedState();
  const recentEl = document.getElementById('recentList');
  const recent = [...allBookings].sort((a, b) => (b.created_at || b.createdAt || '').localeCompare(a.created_at || a.createdAt || '')).slice(0, 6);
  recentEl.innerHTML = recent.length ? recent.map(b => `
    <div class="slot-item">
      <span class="slot-time">${esc(timeKey(b.time))}</span>
      <div class="slot-info"><div class="slot-name">${esc(b.name)}</div><div class="slot-meta">${esc(fmtDate(b.date))} · ${esc(b.service)}</div></div>
      <span class="slot-status status-${esc(b.status)}">${esc(b.status)}</span>
    </div>`).join('') : '<p class="empty-state">No bookings yet</p>';
}

// ── ADMIN CALENDAR ──────────────────────────────
async function renderAdminCalendar() {
  const grid = document.getElementById('crmCalGrid');
  const label = document.getElementById('calAdminLabel');
  if (!grid || !label) return;
  label.textContent = MONTHS[adminCalMonth] + ' ' + adminCalYear;
  const firstDay = new Date(adminCalYear, adminCalMonth, 1).getDay();
  const daysInMonth = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();
  const today = todayStr();
  const bookings = await apiGetBookings();
  if (!bookings) return renderLockedState();
  const barberFilter = document.getElementById('calBarberFilter')?.value || 'all';
  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) { const el = document.createElement('div'); el.className = 'crm-cal-day empty'; grid.appendChild(el); }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = adminCalYear + '-' + String(adminCalMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dayBks = bookings.filter(b => dateKey(b.date) === dateStr && b.status !== 'cancelled' && (barberFilter === 'all' || (b.barber_id || b.barber) === barberFilter));
    const el = document.createElement('div');
    el.className = 'crm-cal-day';
    if (dateStr < today) el.classList.add('past');
    if (dateStr === today) el.classList.add('today');
    if (dateStr === selectedCalDate) el.classList.add('selected');
    const dots = dayBks.slice(0, 3).map(b => `<div class="day-dot dot-${esc(b.status)}"></div>`).join('');
    el.innerHTML = `<span>${d}</span><div class="day-dots">${dots}</div>`;
    el.addEventListener('click', async () => { selectedCalDate = dateStr; await renderAdminCalendar(); await renderDayDetail(dateStr); });
    grid.appendChild(el);
  }
}

async function renderDayDetail(dateStr) {
  const card = document.getElementById('dayDetailCard');
  const title = document.getElementById('dayDetailTitle');
  const timeline = document.getElementById('slotTimeline');
  if (!card || !timeline) return;
  card.style.display = '';
  title.textContent = 'Schedule — ' + fmtDate(dateStr);

  const allBookings = await apiGetBookings();
  if (!allBookings) return renderLockedState();
  const bookings = allBookings.filter(b => dateKey(b.date) === dateStr && b.status !== 'cancelled');

  // Also load Moka walk-ins & online schedules for the day
  let mokaSched = [];
  try {
    const res = await fetch(`${API_URL}/schedules?date=${dateStr}&limit=100`, { headers: apiHeaders(), signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const { schedules } = await res.json();
      // Exclude schedules already bridged from bookings (they'd have external_id = booking:<uuid>)
      mokaSched = (schedules || []).filter(s =>
        s.status !== 'cancelled' && s.status !== 'rejected' && !String(s.external_id || '').startsWith('booking:')
      );
    }
  } catch { /* non-fatal */ }

  const barberFilter = document.getElementById('calBarberFilter')?.value || 'all';

  const timelineItems = await Promise.all(TIME_SLOTS.map(async slot => {
    const slotHour = slot; // e.g. "10:00"

    // Website bookings matching this slot
    const slotBookings = bookings.filter(b =>
      timeKey(b.time) === slot &&
      (barberFilter === 'all' || (b.barber_id || b.barber) === barberFilter)
    );

    // Moka walk-ins whose start_time falls in this slot (±30 min window)
    const slotMoka = mokaSched.filter(s => {
      const startWIB = new Date(s.start_time).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
      return startWIB === slotHour && (barberFilter === 'all' || s.barber_id === barberFilter);
    });

    const allSlotItems = [...slotBookings.map(b => ({ type: 'booking', data: b })), ...slotMoka.map(s => ({ type: 'moka', data: s }))];

    if (allSlotItems.length > 0) {
      const cards = await Promise.all(allSlotItems.map(async item => {
        if (item.type === 'booking') {
          const bk = item.data;
          const barberName = await getBarberName(bk.barber_id || bk.barber);
          return `<div class="tl-booking tl-cell occupied" data-id="${esc(bk.id)}" style="cursor:pointer">
              <div class="tl-bname">${esc(bk.name)}</div>
              <div class="tl-bmeta">${esc(bk.service)} · ${esc(barberName)} · <span class="slot-status status-${esc(bk.status)}" style="font-size:.65rem;padding:1px 6px">${esc(bk.status)}</span></div>
            </div>`;
        } else {
          const s = item.data;
          const src = s.source === 'moka' ? '🏪 Walk-in' : '🌐 Online';
          return `<div class="tl-booking tl-cell occupied" style="border-left:3px solid #f59e0b;cursor:default">
              <div class="tl-bname">${esc(s.customer_name || 'Walk-in')} <span style="font-size:.65rem;color:#f59e0b">${src}</span></div>
              <div class="tl-bmeta">${esc(s.service_name || '—')} · ${esc(s.barber_name || '—')} · <span class="slot-status status-${esc(s.status)}" style="font-size:.65rem;padding:1px 6px">${esc(s.status)}</span></div>
            </div>`;
        }
      }));
      return `<div class="timeline-row">
        <div class="tl-time">${esc(slot)}</div>
        <div class="tl-cell" style="flex-direction:column;gap:4px">${cards.join('')}</div>
      </div>`;
    }

    return `<div class="timeline-row">
      <div class="tl-time">${esc(slot)}</div>
      <div class="tl-cell">
        <span class="tl-empty">Available</span>
        <button class="tl-add-btn" data-date="${esc(dateStr)}" data-time="${esc(slot)}">+ Add</button>
      </div>
    </div>`;
  }));

  timeline.innerHTML = timelineItems.join('');
  timeline.querySelectorAll('.tl-booking[data-id]').forEach(card => card.addEventListener('click', () => openDetailModal(card.dataset.id)));
  timeline.querySelectorAll('.tl-add-btn').forEach(btn => btn.addEventListener('click', () => openBookingModal(null, btn.dataset.date, btn.dataset.time)));
}

document.getElementById('calPrevAdmin')?.addEventListener('click', () => { adminCalMonth--; if (adminCalMonth < 0) { adminCalMonth = 11; adminCalYear--; } renderAdminCalendar(); });
document.getElementById('calNextAdmin')?.addEventListener('click', () => { adminCalMonth++; if (adminCalMonth > 11) { adminCalMonth = 0; adminCalYear++; } renderAdminCalendar(); });
document.getElementById('calBarberFilter')?.addEventListener('change', () => { renderAdminCalendar(); if (selectedCalDate) renderDayDetail(selectedCalDate); });
document.getElementById('addBookingBtn')?.addEventListener('click', () => openBookingModal(null, selectedCalDate, null));

// ── BOOKINGS TABLE dengan Pagination ─────────────
async function renderBookingsTable(search = '', statusF = 'all', barberF = 'all', page = 0) {
  bookingsPage = page;
  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  if (search) params.search = search;
  if (statusF !== 'all') params.status = statusF;
  if (barberF !== 'all') params.barber_id = barberF;

  let bookings = await apiGetBookings(params);
  if (!bookings) return renderLockedState();

  // Offline fallback filtering
  if (!USE_API) {
    if (search) bookings = bookings.filter(b => b.name?.toLowerCase().includes(search.toLowerCase()) || b.service?.toLowerCase().includes(search.toLowerCase()) || (b.wa || '').includes(search));
    if (statusF !== 'all') bookings = bookings.filter(b => b.status === statusF);
    else bookings = bookings.filter(b => b.status !== 'cancelled');
    if (barberF !== 'all') bookings = bookings.filter(b => (b.barber_id || b.barber) === barberF);
    bookingsTotalCount = bookings.length;
    bookings = bookings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }

  // API mode: exclude cancelled when no specific status filter
  if (USE_API && statusF === 'all') {
    bookings = bookings.filter(b => b.status !== 'cancelled');
    bookingsTotalCount = bookings.length;
  }

  bookings.sort((a, b) => (dateKey(b.date) + timeKey(b.time)).localeCompare(dateKey(a.date) + timeKey(a.time)));

  const tbody = document.getElementById('bookingsBody');
  const empty = document.getElementById('bookingsEmpty');
  if (!bookings.length) { tbody.innerHTML = ''; empty.style.display = ''; renderPagination(); return; }
  empty.style.display = 'none';

  const tableRows = await Promise.all(bookings.map(async b => {
    const barberName = await getBarberName(b.barber_id || b.barber);
    const canConfirm = b.status === 'pending';
    const canCancel  = b.status === 'pending' || b.status === 'confirmed';
    const dis = 'disabled style="opacity:.4;pointer-events:none"';
    return `<tr data-booking-id="${esc(b.id)}" onclick="openDetailModal('${esc(b.id)}')">
      <td><div class="td-name">${esc(fmtDate(b.date))}</div><div class="td-meta">${esc(timeKey(b.time))}</div></td>
      <td><div class="td-name">${esc(b.name)}</div><div class="td-meta"><a href="https://wa.me/62${esc(b.wa || '')}" target="_blank" class="wa-link">+62${esc(b.wa || '')}</a></div></td>
      <td>${esc(b.service)}<div class="td-meta">${esc(b.duration || '')}</div></td>
      <td>${esc(barberName)}</td>
      <td>${esc(LOCATION_LABELS[b.location] || b.location || '—')}</td>
      <td><span class="slot-status status-${esc(b.status)}">${esc(b.status)}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="action-btn" ${canConfirm ? '' : dis} onclick="event.stopPropagation();confirmBooking('${esc(b.id)}')">Confirm</button>
        <button class="action-btn danger" ${canCancel ? '' : dis} onclick="event.stopPropagation();cancelBooking('${esc(b.id)}')">Cancel</button>
      </td>
    </tr>`;
  }));
  tbody.innerHTML = tableRows.join('');
  renderPagination();
}

function renderPagination() {
  const total = bookingsTotalCount;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  let el = document.getElementById('bookingPagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bookingPagination';
    el.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:center;margin-top:12px;font-size:.82rem;';
    document.getElementById('bookingsBody')?.closest('table')?.after(el);
  }
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const from = bookingsPage * PAGE_SIZE + 1, to = Math.min((bookingsPage + 1) * PAGE_SIZE, total);
  el.innerHTML = `
    <button class="action-btn" onclick="changePage(-1)" ${bookingsPage === 0 ? 'disabled style="opacity:.4"' : ''}>‹ Prev</button>
    <span style="color:#aaa">${from}–${to} dari ${total}</span>
    <button class="action-btn" onclick="changePage(1)" ${bookingsPage >= totalPages - 1 ? 'disabled style="opacity:.4"' : ''}>Next ›</button>`;
}

window.changePage = function(dir) {
  const search   = document.getElementById('bookingSearch')?.value || '';
  const statusF  = document.getElementById('bookingStatusFilter')?.value || 'all';
  const barberF  = document.getElementById('bookingBarberFilter')?.value || 'all';
  renderBookingsTable(search, statusF, barberF, bookingsPage + dir);
};

document.getElementById('bookingSearch')?.addEventListener('input', function() { renderBookingsTable(this.value, document.getElementById('bookingStatusFilter').value, document.getElementById('bookingBarberFilter').value, 0); });
document.getElementById('bookingStatusFilter')?.addEventListener('change', function() { renderBookingsTable(document.getElementById('bookingSearch').value, this.value, document.getElementById('bookingBarberFilter').value, 0); });
document.getElementById('bookingBarberFilter')?.addEventListener('change', function() { renderBookingsTable(document.getElementById('bookingSearch').value, document.getElementById('bookingStatusFilter').value, this.value, 0); });

// ── BARBERS VIEW ────────────────────────────────
async function renderBarbers() {
  const bookings = await apiGetBookings();
  if (!bookings) return renderLockedState();
  const barbers = await apiGetBarbers();
  const grid = document.getElementById('barbersGrid');
  if (!grid) return;
  const allDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  if (!barbers.length) { grid.innerHTML = '<p class="empty-state">No barbers found in database.</p>'; return; }

  function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '', b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : (parts[0]?.[1] || '');
    return (a + b).toUpperCase() || 'RB';
  }

  grid.innerHTML = barbers.map(b => {
    const bkCount   = bookings.filter(bk => (bk.barber_id || bk.barber) === b.id).length;
    const doneCount = bookings.filter(bk => (bk.barber_id || bk.barber) === b.id && bk.status === 'done').length;
    let workDays = [];
    try { workDays = Array.isArray(b.work_days) ? b.work_days : JSON.parse(b.work_days || '[]'); } catch { workDays = []; }
    const days = allDays.map(d => `<span class="sday${workDays.includes(d) ? '' : ' off'}">${esc(d)}</span>`).join('');
    const img = String(b.img || '').trim();
    const imgHtml = img
      ? `<img src="${esc(img)}" alt="${esc(b.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='Brand_assets/Kapster1.jpg';" />`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-4);color:var(--white);font-weight:800;font-size:1.1rem;">${esc(getInitials(b.name))}</div>`;
    return `<div class="barber-crm-card">
      <div class="barber-crm-top">
        <div class="barber-crm-img">${imgHtml}</div>
        <div>
          <div class="barber-crm-name">${esc(b.name)}</div>
          <div class="barber-crm-role">${esc(b.role || 'Barber')}</div>
          <div class="barber-crm-branch">${esc(LOCATION_LABELS[b.branch] || b.branch || '')}</div>
        </div>
      </div>
      <div class="barber-crm-stats">
        <div class="bcs"><span class="bcs-val">${bkCount}</span><span class="bcs-label">Total Bk</span></div>
        <div class="bcs"><span class="bcs-val">${doneCount}</span><span class="bcs-label">Done</span></div>
        <div class="bcs"><span class="bcs-val">${bkCount - doneCount}</span><span class="bcs-label">Upcoming</span></div>
      </div>
      <div class="barber-crm-schedule"><h5>Working Days</h5><div class="schedule-days">${days}</div></div>
    </div>`;
  }).join('');
}

// ── CUSTOMERS VIEW dengan Segmentasi ────────────
let currentSegment = 'all';

async function renderCustomers(search = '', segment = currentSegment) {
  currentSegment = segment;
  const params = { limit: 200 };
  if (search) params.search = search;
  if (segment !== 'all') params.segment = segment;
  const customers = await apiGetCustomers(params);
  if (!customers) return renderLockedState();

  // Badge counts (hanya saat tidak sedang filter)
  if (!search) {
    const [loyal, atrisk, lost] = await Promise.all([
      apiGetCustomers({ segment: 'loyal', limit: 1 }),
      apiGetCustomers({ segment: 'atrisk', limit: 1 }),
      apiGetCustomers({ segment: 'lost', limit: 1 }),
    ]);
    // Update segment badge UI jika ada
    const updateBadge = (id, data) => { const el = document.getElementById(id); if (el) el.textContent = Array.isArray(data) ? data.length : 0; };
  }

  const tbody = document.getElementById('customersBody');
  const empty = document.getElementById('customersEmpty');
  if (!customers.length) { tbody.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  const now = new Date();
  tbody.innerHTML = customers.map(c => {
    const lastVisit = c.last_visit || c.lastVisit;
    let segBadge = '';
    if ((c.visits || 0) >= 5) segBadge = '<span style="font-size:.65rem;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:1px 6px;margin-left:4px">Loyal</span>';
    else if (lastVisit) {
      const daysSince = Math.floor((now - new Date(lastVisit)) / 86400000);
      if (daysSince > 90) segBadge = '<span style="font-size:.65rem;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);border-radius:99px;padding:1px 6px;margin-left:4px">Lost</span>';
      else if (daysSince > 30) segBadge = '<span style="font-size:.65rem;background:rgba(234,179,8,.15);color:#fbbf24;border:1px solid rgba(234,179,8,.3);border-radius:99px;padding:1px 6px;margin-left:4px">At-Risk</span>';
    }
    const waMsg = encodeURIComponent(`Halo ${c.name}, terima kasih sudah mengunjungi Redbox Barbershop!`);
    return `<tr>
      <td class="td-name">${esc(c.name)}${segBadge}</td>
      <td><a href="https://wa.me/62${esc(c.wa)}" target="_blank" class="wa-link">+62${esc(c.wa)}</a></td>
      <td style="text-align:center;font-weight:700">${c.visits || 0}</td>
      <td>${esc(fmtDate(lastVisit))}</td>
      <td style="font-size:.78rem">${esc((c.services || []).slice(0, 2).join(', ') || '—')}</td>
      <td style="font-weight:700;color:#f87171">${esc(fmt(c.total_spent || c.totalSpent || 0))}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="action-btn" onclick="openCustomerDetailModal('${esc(c.wa)}')">View</button>
        <a href="https://wa.me/62${esc(c.wa)}?text=${waMsg}" target="_blank" class="action-btn">💬 WA</a>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('customerSearch')?.addEventListener('input', function() { renderCustomers(this.value, currentSegment); });

// Segment filter buttons (tambahkan di crm.html jika belum ada)
document.querySelectorAll('[data-segment]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-segment]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCustomers(document.getElementById('customerSearch')?.value || '', btn.dataset.segment);
  });
});

// ── REVENUE REPORT ───────────────────────────────
async function renderRevenue() {
  const container = document.getElementById('revenueContent') || document.getElementById('view-revenue');
  if (!container) return;

  const period  = document.getElementById('revPeriod')?.value || 'month';
  const branch  = document.getElementById('revBranch')?.value || 'all';

  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--w30,#aaa)">Memuat laporan...</div>`;

  const data = await apiGetRevenue({ period, branch });
  if (!data) { container.innerHTML = `<div class="empty-state">Gagal memuat data revenue. Pastikan server berjalan.</div>`; showToast('Gagal memuat data revenue', 'error'); return; }

  const periodLabels = { week: '7 Hari Terakhir', month: '30 Hari Terakhir', year: '1 Tahun Terakhir' };

  const barberRows = (data.by_barber || []).map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(b.name)}</td>
      <td style="font-weight:700;color:#4ade80">${esc(fmt(b.revenue))}</td>
      <td style="color:#aaa;font-size:.8rem">${data.total ? Math.round(b.revenue / data.total * 100) : 0}%</td>
    </tr>`).join('');

  const branchRows = (data.by_branch || []).map(b => `
    <tr>
      <td>${esc(LOCATION_LABELS[b.name] || b.name)}</td>
      <td style="font-weight:700;color:#60a5fa">${esc(fmt(b.revenue))}</td>
      <td style="color:#aaa;font-size:.8rem">${data.total ? Math.round(b.revenue / data.total * 100) : 0}%</td>
    </tr>`).join('');

  // Mini bar chart untuk tren harian
  const dates = data.by_date || [];
  const maxRev = Math.max(...dates.map(d => d.revenue), 1);
  const chartBars = dates.map(d => {
    const h = Math.max(4, Math.round((d.revenue / maxRev) * 80));
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:18px;max-width:32px">
      <span style="font-size:.6rem;color:#aaa">${esc(fmt(d.revenue).replace('Rp ',''))}</span>
      <div style="width:100%;height:${h}px;background:#dc2626;border-radius:3px 3px 0 0;opacity:.85"></div>
      <span style="font-size:.55rem;color:#666;writing-mode:vertical-rl;transform:rotate(180deg)">${esc(d.date.slice(5))}</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:.8rem;color:#aaa">Periode:</label>
        <select id="revPeriod" class="filter-select" onchange="renderRevenue()">
          <option value="week" ${period==='week'?'selected':''}>7 Hari</option>
          <option value="month" ${period==='month'?'selected':''}>30 Hari</option>
          <option value="year" ${period==='year'?'selected':''}>1 Tahun</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:.8rem;color:#aaa">Cabang:</label>
        <select id="revBranch" class="filter-select" onchange="renderRevenue()">
          <option value="all" ${branch==='all'?'selected':''}>Semua Cabang</option>
          <option value="bypass" ${branch==='bypass'?'selected':''}>Bypass</option>
          <option value="samadikun" ${branch==='samadikun'?'selected':''}>Samadikun</option>
          <option value="csb" ${branch==='csb'?'selected':''}>CSB Mall</option>
          <option value="sumber" ${branch==='sumber'?'selected':''}>Sumber</option>
          <option value="tegal" ${branch==='tegal'?'selected':''}>Tegal</option>
        </select>
      </div>
      <button class="action-btn" onclick="exportRevenueCSV()">⬇ Export CSV</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-val" style="color:#4ade80">${esc(fmt(data.total))}</div><div class="stat-label">Total Revenue</div></div>
      <div class="stat-card"><div class="stat-val">${data.count}</div><div class="stat-label">Booking Selesai</div></div>
      <div class="stat-card"><div class="stat-val">${data.count ? esc(fmt(Math.round(data.total / data.count))) : 'Rp 0'}</div><div class="stat-label">Rata-rata/Booking</div></div>
    </div>

    ${dates.length ? `<div style="margin-bottom:24px">
      <h4 style="font-size:.85rem;color:#aaa;margin-bottom:10px">Tren Revenue — ${esc(periodLabels[period] || period)}</h4>
      <div style="display:flex;align-items:flex-end;gap:3px;height:120px;border-bottom:1px solid #333;padding-bottom:4px;overflow-x:auto">${chartBars}</div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;flex-wrap:wrap">
      <div>
        <h4 style="font-size:.85rem;color:#aaa;margin-bottom:10px">Revenue per Kapster</h4>
        <table class="crm-table"><thead><tr><th>#</th><th>Kapster</th><th>Revenue</th><th>%</th></tr></thead>
        <tbody>${barberRows || '<tr><td colspan="4" class="empty-state">Belum ada data</td></tr>'}</tbody></table>
      </div>
      <div>
        <h4 style="font-size:.85rem;color:#aaa;margin-bottom:10px">Revenue per Cabang</h4>
        <table class="crm-table"><thead><tr><th>Cabang</th><th>Revenue</th><th>%</th></tr></thead>
        <tbody>${branchRows || '<tr><td colspan="3" class="empty-state">Belum ada data</td></tr>'}</tbody></table>
      </div>
    </div>`;

  // Simpan data untuk export
  window._lastRevenueData = data;
}

window.renderRevenue = renderRevenue;

window.exportRevenueCSV = function() {
  const data = window._lastRevenueData;
  if (!data) return;
  const rows = [
    ['Laporan Revenue RedBox Barbershop'],
    [`Periode: ${data.period?.from} s/d ${data.period?.to}`],
    [`Total Revenue: ${fmt(data.total)}`],
    [`Total Booking: ${data.count}`],
    [],
    ['Revenue per Kapster'],
    ['Kapster','Revenue','%'],
    ...(data.by_barber || []).map(b => [b.name, b.revenue, data.total ? Math.round(b.revenue / data.total * 100) + '%' : '0%']),
    [],
    ['Revenue per Cabang'],
    ['Cabang','Revenue','%'],
    ...(data.by_branch || []).map(b => [LOCATION_LABELS[b.name] || b.name, b.revenue, data.total ? Math.round(b.revenue / data.total * 100) + '%' : '0%']),
    [],
    ['Tren Harian'],
    ['Tanggal','Revenue'],
    ...(data.by_date || []).map(d => [d.date, d.revenue]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `revenue-redbox-${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

// ── EXPORT BOOKINGS CSV ─────────────────────────
window.exportBookingsCSV = async function() {
  const bookings = await apiGetBookings({ limit: 9999 });
  const headers = ['ID','Nama','WA','Layanan','Harga','Durasi','Kapster','Tanggal','Jam','Lokasi','Status','Notes','Payment','Dibuat'];
  const rows = bookings.map(b => [b.id, b.name, b.wa, b.service, b.price, b.duration, b.barber_name || b.barber_id || '', b.date, b.time, b.location, b.status, b.notes || '', b.payment || '', (b.created_at || b.createdAt || '').slice(0, 10)]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `bookings-redbox-${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

window.exportCustomersCSV = async function() {
  const customers = await apiGetCustomers({ limit: 9999 });
  const headers = ['ID','Nama','WA','Kunjungan','Total Belanja','Kunjungan Terakhir','Layanan','Notes'];
  const rows = customers.map(c => [c.id, c.name, c.wa, c.visits || 0, c.total_spent || c.totalSpent || 0, c.last_visit || c.lastVisit || '', (c.services || []).join(';'), c.notes || '']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `customers-redbox-${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

// ── BOOKING MODAL ────────────────────────────────
function populateServiceDropdown() {
  const sel = document.getElementById('mService');
  if (!sel || typeof REDBOX_SERVICES === 'undefined') return;
  sel.innerHTML = REDBOX_SERVICES.map(s => `<option value="${esc(s.id)}" data-price="${esc(String(s.price))}" data-duration="${esc(s.duration)}">${esc(s.name)} — ${esc(s.categoryLabel)}</option>`).join('');
}

async function populateTimeDropdown(selDate, selBarber, excludeId = null) {
  const sel = document.getElementById('mTime');
  const serviceEl = document.getElementById('mService');
  const duration = serviceEl ? (serviceEl.options[serviceEl.selectedIndex]?.dataset.duration || '60 menit') : '60 menit';
  const bookings = await apiGetBookings();
  sel.innerHTML = TIME_SLOTS.map(t => {
    const conflict = selDate && selBarber && selBarber !== 'any' && hasConflictSync(bookings, selBarber, selDate, t, duration, excludeId);
    return `<option value="${esc(t)}" ${conflict ? 'disabled style="color:#f87171"' : ''}>${esc(t)}${conflict ? ' (booked)' : ''}</option>`;
  }).join('');
}

async function openBookingModal(bookingId = null, preDate = null, preTime = null) {
  editingBookingId = bookingId;
  populateServiceDropdown();
  document.getElementById('modalTitle').textContent = bookingId ? 'Edit Booking' : 'Add Booking';
  document.getElementById('doubleBookingWarn').style.display = 'none';
  document.getElementById('mDate').min = todayStr();

  if (bookingId) {
    const bk = (await apiGetBookings()).find(b => b.id === bookingId);
    if (bk) {
      document.getElementById('mName').value    = bk.name || '';
      document.getElementById('mWa').value      = bk.wa || '';
      document.getElementById('mService').value = bk.service_id || bk.serviceId || '';
      document.getElementById('mBarber').value  = bk.barber_id || bk.barber || 'any';
      document.getElementById('mDate').value    = bk.date || '';
      document.getElementById('mLocation').value= bk.location || 'bypass';
      document.getElementById('mStatus').value  = bk.status || 'pending';
      document.getElementById('mNotes').value   = bk.notes || '';
      await populateTimeDropdown(bk.date, bk.barber_id || bk.barber, bookingId);
      document.getElementById('mTime').value = bk.time || '';
    }
  } else {
    document.getElementById('mName').value = '';
    document.getElementById('mWa').value   = '';
    document.getElementById('mBarber').value   = 'any';
    document.getElementById('mDate').value     = preDate || todayStr();
    document.getElementById('mLocation').value = 'bypass';
    document.getElementById('mStatus').value   = 'pending';
    document.getElementById('mNotes').value    = '';
    await populateTimeDropdown(preDate || todayStr(), 'any');
    if (preTime) document.getElementById('mTime').value = preTime;
  }
  document.getElementById('bookingModal').style.display = 'flex';
}

['mBarber','mDate','mService'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', async () => {
    await populateTimeDropdown(document.getElementById('mDate').value, document.getElementById('mBarber').value, editingBookingId);
    await checkConflictWarning();
  });
});
document.getElementById('mTime')?.addEventListener('change', checkConflictWarning);

async function checkConflictWarning() {
  const barber = document.getElementById('mBarber').value;
  const date   = document.getElementById('mDate').value;
  const time   = document.getElementById('mTime').value;
  const serviceEl = document.getElementById('mService');
  const duration  = serviceEl ? (serviceEl.options[serviceEl.selectedIndex]?.dataset.duration || '60 menit') : '60 menit';
  const conflict = barber && barber !== 'any' && date && time && await hasConflict(barber, date, time, duration, editingBookingId);
  document.getElementById('doubleBookingWarn').style.display = conflict ? '' : 'none';
}

document.getElementById('modalSave')?.addEventListener('click', async () => {
  const name      = document.getElementById('mName').value.trim();
  const wa        = document.getElementById('mWa').value.trim();
  const serviceEl = document.getElementById('mService');
  const serviceId = serviceEl.value;
  const serviceName = serviceEl.options[serviceEl.selectedIndex]?.text.split(' — ')[0] || '';
  const servicePrice = parseInt(serviceEl.options[serviceEl.selectedIndex]?.dataset.price || 0);
  const serviceDuration = serviceEl.options[serviceEl.selectedIndex]?.dataset.duration || '';
  const barber   = document.getElementById('mBarber').value;
  const date     = document.getElementById('mDate').value;
  const time     = document.getElementById('mTime').value;
  const location = document.getElementById('mLocation').value;
  const status   = document.getElementById('mStatus').value || 'pending';
  const notes    = document.getElementById('mNotes').value.trim();

  if (!name || !wa || !serviceId || !date || !time) { alert('Harap isi semua field yang wajib.'); return; }
  if (!/^\d{8,15}$/.test(wa)) { alert('Format nomor WhatsApp tidak valid (8-15 angka tanpa kode negara)'); return; }
  if (barber !== 'any' && await hasConflict(barber, date, time, serviceDuration, editingBookingId)) {
    if (!confirm('Peringatan: Ada konflik jadwal! Lanjutkan?')) return;
  }
  try {
    await apiSaveBooking({ name, wa, service_id: serviceId, service: serviceName, price: servicePrice, duration: serviceDuration, barber_id: barber, date, time, location, status, notes }, editingBookingId || null);
    closeBookingModal();
    showToast(editingBookingId ? 'Booking berhasil diupdate' : 'Booking baru berhasil ditambahkan', 'success');
    await renderView(getCurrentView());
    if (selectedCalDate === date) renderDayDetail(date);
  } catch(err) { showToast(err.message, 'error'); }
});

function closeBookingModal() { document.getElementById('bookingModal').style.display = 'none'; editingBookingId = null; }
document.getElementById('modalClose')?.addEventListener('click', closeBookingModal);
document.getElementById('modalCancel')?.addEventListener('click', closeBookingModal);
document.getElementById('bookingModal')?.addEventListener('click', e => { if (e.target === document.getElementById('bookingModal')) closeBookingModal(); });

// ── DETAIL MODAL ─────────────────────────────────
async function openDetailModal(id) {
  detailBookingId = id;
  const bk = (await apiGetBookings()).find(b => b.id === id);
  if (!bk) return;
  const barberName = await getBarberName(bk.barber_id || bk.barber);
  const body = document.getElementById('detailBody');
  // Semua data di-escape untuk mencegah XSS
  body.innerHTML = `
    <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-val">${esc(bk.name)}</span></div>
    <div class="detail-row"><span class="detail-label">WhatsApp</span><span class="detail-val"><a href="https://wa.me/62${esc(bk.wa)}" target="_blank" class="wa-link">+62${esc(bk.wa)}</a></span></div>
    <div class="detail-row"><span class="detail-label">Service</span><span class="detail-val">${esc(bk.service)}</span></div>
    <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-val">${esc(bk.duration || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Barber</span><span class="detail-val">${esc(barberName)}</span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-val">${esc(fmtDate(bk.date))}</span></div>
    <div class="detail-row"><span class="detail-label">Time</span><span class="detail-val">${esc(timeKey(bk.time))}</span></div>
    <div class="detail-row"><span class="detail-label">Location</span><span class="detail-val">${esc(LOCATION_LABELS[bk.location] || bk.location || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val"><span class="slot-status status-${esc(bk.status)}">${esc(bk.status)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Price</span><span class="detail-val" style="color:#f87171">${esc(fmt(bk.price || 0))}</span></div>
    ${bk.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-val">${esc(bk.notes)}</span></div>` : ''}`;

  const btnConfirm = document.getElementById('detailConfirm');
  const btnDeny    = document.getElementById('detailDeny');
  const btnCancel  = document.getElementById('detailCancel');
  if (btnConfirm) btnConfirm.style.display = bk.status === 'pending' ? '' : 'none';
  if (btnDeny)    btnDeny.style.display    = bk.status === 'pending' ? '' : 'none';
  if (btnCancel)  btnCancel.style.display  = (bk.status === 'pending' || bk.status === 'confirmed') ? '' : 'none';
  document.getElementById('detailModal').style.display = 'flex';
}

document.getElementById('detailClose')?.addEventListener('click', () => document.getElementById('detailModal').style.display = 'none');
document.getElementById('detailModal')?.addEventListener('click', e => { if (e.target === document.getElementById('detailModal')) document.getElementById('detailModal').style.display = 'none'; });
document.getElementById('detailEdit')?.addEventListener('click', () => { document.getElementById('detailModal').style.display = 'none'; openBookingModal(detailBookingId); });
document.getElementById('detailConfirm')?.addEventListener('click', async () => { await confirmBooking(detailBookingId); document.getElementById('detailModal').style.display = 'none'; });
document.getElementById('detailDeny')?.addEventListener('click', async () => { await denyBooking(detailBookingId); document.getElementById('detailModal').style.display = 'none'; });
document.getElementById('detailCancel')?.addEventListener('click', async () => { await cancelBooking(detailBookingId); document.getElementById('detailModal').style.display = 'none'; });

// ── CUSTOMER DETAIL MODAL ─────────────────────────
async function openCustomerDetailModal(wa) {
  const customers = await apiGetCustomers();
  const c = customers.find(x => x.wa === wa);
  if (!c) return;
  const bookings = (await apiGetBookings()).filter(b => b.wa === wa).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const body = document.getElementById('customerDetailBody');
  const lastVisit = c.last_visit || c.lastVisit;
  let historyHtml = '<p class="empty-state">No booking history</p>';
  if (bookings.length) {
    const items = [];
    for (const b of bookings) {
      const barberName = await getBarberName(b.barber_id || b.barber);
      items.push(`<div style="border-bottom:1px solid #333;padding:8px 0;font-size:.85rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong>${esc(fmtDate(b.date))} - ${esc(timeKey(b.time))}</strong>
          <span class="slot-status status-${esc(b.status)}" style="font-size:.65rem;padding:2px 6px">${esc(b.status)}</span>
        </div>
        <div style="color:#aaa">${esc(b.service)} · ${esc(barberName)}</div>
      </div>`);
    }
    historyHtml = items.join('');
  }

  // Segmentasi label
  const visits = c.visits || 0;
  let segLabel = '';
  if (visits >= 5) segLabel = '<span style="background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:2px 8px;font-size:.7rem">Loyal Customer</span>';

  body.innerHTML = `
    <div class="detail-row"><span class="detail-label">Nama</span><span class="detail-val">${esc(c.name)} ${segLabel}</span></div>
    <div class="detail-row"><span class="detail-label">WhatsApp</span><span class="detail-val"><a href="https://wa.me/62${esc(c.wa)}" target="_blank" class="wa-link">+62${esc(c.wa)}</a></span></div>
    <div class="detail-row"><span class="detail-label">Kunjungan</span><span class="detail-val">${visits}</span></div>
    <div class="detail-row"><span class="detail-label">Kunjungan Terakhir</span><span class="detail-val">${esc(fmtDate(lastVisit))}</span></div>
    <div class="detail-row"><span class="detail-label">Total Belanja</span><span class="detail-val" style="color:#f87171">${esc(fmt(c.total_spent || c.totalSpent || 0))}</span></div>
    ${c.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-val">${esc(c.notes)}</span></div>` : ''}
    <h4 style="margin-top:15px;margin-bottom:10px">Riwayat Booking</h4>
    <div style="max-height:200px;overflow-y:auto">${historyHtml}</div>`;
  document.getElementById('customerDetailModal').style.display = 'flex';
}

document.getElementById('customerDetailClose')?.addEventListener('click', () => document.getElementById('customerDetailModal').style.display = 'none');
document.getElementById('customerDetailCancel')?.addEventListener('click', () => document.getElementById('customerDetailModal').style.display = 'none');
document.getElementById('customerDetailModal')?.addEventListener('click', e => { if (e.target === document.getElementById('customerDetailModal')) document.getElementById('customerDetailModal').style.display = 'none'; });

// ── ACTION HANDLERS ──────────────────────────────
async function setBookingStatus(id, status) {
  if (!USE_API) {
    const bks = getBookings();
    const idx = bks.findIndex(b => b.id === id);
    if (idx !== -1) { bks[idx].status = status; saveBookings(bks); }
    return;
  }
  const res = await fetch(`${API_URL}/booking-status`, {
    method: 'POST', headers: apiHeaders(), body: JSON.stringify({ id, status })
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const err = await res.json(); msg = err.error || msg; } catch {}
    throw new Error(msg);
  }
}

window.cancelBooking = async function(id) {
  if (!confirm('Cancel booking ini?')) return;
  document.querySelector(`tr[data-booking-id="${id}"]`)?.remove();
  try {
    await setBookingStatus(id, 'cancelled');
    showToast('Booking dibatalkan', 'warning');
  } catch(e) {
    showToast('Gagal cancel: ' + e.message, 'error');
  }
  renderView(getCurrentView());
  if (selectedCalDate) renderDayDetail(selectedCalDate);
};
window.confirmBooking = async function(id) {
  try {
    await setBookingStatus(id, 'confirmed');
    showToast('Booking dikonfirmasi', 'success');
  } catch(e) {
    showToast('Gagal confirm: ' + e.message, 'error');
  }
  renderView(getCurrentView());
  if (selectedCalDate) renderDayDetail(selectedCalDate);
};
window.denyBooking = async function(id) {
  if (!confirm('Deny booking ini?')) return;
  try {
    await setBookingStatus(id, 'cancelled');
    showToast('Booking ditolak', 'error');
  } catch(e) {
    showToast('Gagal deny: ' + e.message, 'error');
  }
  renderView(getCurrentView());
  if (selectedCalDate) renderDayDetail(selectedCalDate);
};
window.openDetailModal = openDetailModal;
window.openBookingModal = openBookingModal;
window.openCustomerDetailModal = openCustomerDetailModal;

// ── PULL TO REFRESH ──────────────────────────────
async function refreshDataAndView() {
  if (REFRESHING) return;
  REFRESHING = true;
  try {
    CACHED_BARBERS = null;
    await detectApiMode(false);
    await populateBarberFilters();
    const view = getCurrentView();
    await renderView(view);
    if (view === 'calendar' && selectedCalDate) await renderDayDetail(selectedCalDate);
    showToast(USE_API ? 'Dashboard refreshed with live data' : 'Dashboard refreshed in offline mode', 'success', 2200);
  } finally { REFRESHING = false; }
}

function setupPullToRefresh() {
  let startY = 0, pulling = false, dist = 0;
  const threshold = 72;
  const bar = document.createElement('div');
  bar.id = 'ptrBar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;pointer-events:none;';
  bar.innerHTML = '<div id="ptrInner" style="height:44px;min-width:160px;border-radius:999px;margin:10px;background:rgba(17,17,17,.95);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;gap:10px;transform:translateY(-110%);transition:transform .15s ease;backdrop-filter:blur(10px);"><span id="ptrSpinner" style="width:14px;height:14px;border-radius:999px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;display:inline-block;"></span><span id="ptrText" style="font-size:.78rem;color:rgba(255,255,255,.75);font-weight:600;letter-spacing:.02em;">Tarik untuk refresh</span></div>';
  document.body.appendChild(bar);
  const inner = bar.querySelector('#ptrInner'), spinner = bar.querySelector('#ptrSpinner'), text = bar.querySelector('#ptrText');
  const setUI = (y, state) => {
    const clamped = Math.max(0, Math.min(110, y));
    bar.style.height = clamped + 'px';
    if (inner) inner.style.transform = `translateY(${Math.min(0, -110 + clamped)}%)`;
    if (!text) return;
    if (state === 'refreshing') text.textContent = 'Refreshing...';
    else text.textContent = clamped >= threshold ? 'Lepas untuk refresh' : 'Tarik untuk refresh';
    if (spinner) spinner.style.animation = state === 'refreshing' ? 'ptrSpin .7s linear infinite' : 'none';
  };
  if (!document.getElementById('ptrSpinStyle')) {
    const s = document.createElement('style'); s.id = 'ptrSpinStyle'; s.textContent = '@keyframes ptrSpin{to{transform:rotate(360deg)}}'; document.head.appendChild(s);
  }
  document.addEventListener('touchstart', e => { if (REFRESHING || window.scrollY > 0) return; startY = e.touches[0].clientY; pulling = true; dist = 0; setUI(0); }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling || REFRESHING) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { setUI(0); return; }
    e.preventDefault();
    setUI(Math.pow(dist, 0.85));
  }, { passive: false });
  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (dist <= 0) { setUI(0); bar.style.height = '0'; return; }
    if (Math.pow(dist, 0.85) >= threshold) { setUI(threshold + 10, 'refreshing'); await refreshDataAndView(); }
    bar.style.height = '0';
    if (inner) inner.style.transform = 'translateY(-110%)';
    if (spinner) spinner.style.animation = 'none';
    if (text) text.textContent = 'Tarik untuk refresh';
  }, { passive: true });
}

// ── TOPBAR DATE ──────────────────────────────────
function setTopbarDate() {
  const d = new Date();
  const el = document.getElementById('topbarDate');
  if (el) el.textContent = DAYS_SHORT[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// ── SEED DEMO DATA ────────────────────────────────
function seedDemoData() {
  if (getBookings().length > 0) return;
  const today = todayStr();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tmrStr = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
  const demo = [
    { id: genId(), name: 'Adi Santoso', wa: '81234567890', serviceId: 'haircut-beard', service: 'Haircut & Jenggot', price: 65000, duration: '45 menit', barber: 'prima', date: today, time: '10:00', location: 'bypass', status: 'confirmed', notes: '', createdAt: new Date().toISOString() },
    { id: genId(), name: 'Rizky Maulana', wa: '82345678901', serviceId: 'haircut', service: 'Haircut', price: 45000, duration: '30 menit', barber: 'andi', date: today, time: '11:00', location: 'bypass', status: 'pending', notes: '', createdAt: new Date().toISOString() },
    { id: genId(), name: 'Dani Pratama', wa: '83456789012', serviceId: 'cornrow6', service: '6 Jalur Cornrow', price: 200000, duration: '2 jam', barber: 'rio', date: today, time: '13:00', location: 'samadikun', status: 'done', notes: '', createdAt: new Date().toISOString() },
  ];
  saveBookings(demo);
  demo.filter(b => b.status === 'done').forEach(syncCustomer);
}

// ── INIT ─────────────────────────────────────────
setTopbarDate();
async function init() {
  await detectApiMode(false);
  if (!(await ensureAdminSession())) return;
  if (!USE_API) seedDemoData();
  await populateBarberFilters();
  await renderView('overview');
  setupPullToRefresh();
  showToast(
    USE_API ? 'Welcome back, Admin. Live Redbox data is ready.' : 'Welcome back, Admin. Offline demo mode is ready.',
    USE_API ? 'success' : 'info',
    3200
  );

  // Auto-refresh setiap 60 detik
  setInterval(async () => {
    const view = getCurrentView();
    if (view === 'overview') await renderOverview();
    if (view === 'calendar') { await renderAdminCalendar(); if (selectedCalDate) await renderDayDetail(selectedCalDate); }
    if (view === 'bookings') {
      const q = document.getElementById('bookingSearch')?.value || '';
      const s = document.getElementById('bookingStatusFilter')?.value || 'all';
      const b = document.getElementById('bookingBarberFilter')?.value || 'all';
      await renderBookingsTable(q, s, b, bookingsPage);
    }
    if (view === 'barbers') await renderBarbers();
    if (view === 'customers') await renderCustomers(document.getElementById('customerSearch')?.value || '', currentSegment);
  }, 60000);
}
init();

// ============================================================
// MEMBERSHIP MODULE
// ============================================================
const SB_URL  = 'https://gtiggsilfcivuzowaexq.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0aWdnc2lsZmNpdnV6b3dhZXhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzA1OTMsImV4cCI6MjA5MjM0NjU5M30.GKq79uI5i_B31vi4McEGuqRZEJjPIrY5QKyK0LQEA4o';

async function sbMem(path, opts = {}) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      'apikey': SB_ANON,
      'Authorization': 'Bearer ' + SB_ANON,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...(opts.headers || {})
    }
  });
  if (!res.ok && res.status !== 406) {
    console.error('sbMem error', res.status, await res.text().catch(()=>''));
    return null;
  }
  if (res.status === 204 || res.status === 205) return true;
  return res.json().catch(() => true);
}

let _memCurrentKey = null; // user_key of currently found member

async function initMembershipView() {
  await loadMemStats();
  await loadRecentActivations();
  await loadAllMembers();
}

async function loadMemStats() {
  const all = await sbMem('member_profiles?select=membership_status,membership_activated_at');
  if (!all) return;
  const total    = all.length;
  const active   = all.filter(r => r.membership_status === 'ACTIVE').length;
  const inactive = total - active;
  const now      = new Date();
  const thisMonth= all.filter(r => {
    if (!r.membership_activated_at) return false;
    const d = new Date(r.membership_activated_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  document.getElementById('msTotalMembers').textContent  = total;
  document.getElementById('msActiveMembers').textContent = active;
  document.getElementById('msInactiveMembers').textContent = inactive;
  document.getElementById('msThisMonth').textContent     = thisMonth;
}

async function searchMember(query) {
  const q = query.trim().toLowerCase();
  if (!q) return;
  const card     = document.getElementById('memFoundCard');
  const notFound = document.getElementById('memNotFound');
  card.style.display = 'none';
  notFound.style.display = 'none';
  _memCurrentKey = null;

  // Search by email (exact) OR referral_code (case-insensitive)
  const byEmail = await sbMem(`member_profiles?user_key=eq.${encodeURIComponent(query.trim())}&select=*`);
  const byRef   = await sbMem(`member_profiles?referral_code=ilike.${encodeURIComponent(q)}&select=*`);
  const rows    = (byEmail && byEmail.length) ? byEmail : (byRef && byRef.length ? byRef : null);

  if (!rows || !rows.length) { notFound.style.display = 'block'; return; }
  const r = rows[0];
  _memCurrentKey = r.user_key;

  const initials = (r.full_name || r.email || '?').split(' ').map(s=>s[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('memFoundAvatar').textContent = initials;
  document.getElementById('memFoundName').textContent   = r.full_name || '(Nama belum diisi)';
  document.getElementById('memFoundEmail').textContent  = r.email;
  document.getElementById('memFoundRef').textContent    = 'Referral: ' + (r.referral_code || '—');

  const badge = document.getElementById('memFoundBadge');
  const opts  = document.getElementById('memActivateOpts');
  const already = document.getElementById('memAlreadyActive');

  if (r.membership_status === 'ACTIVE') {
    badge.textContent = '✓ AKTIF';
    badge.className = 'mem-found-badge status-active';
    opts.style.display   = 'none';
    already.style.display= 'flex';
  } else {
    badge.textContent = 'BELUM AKTIF';
    badge.className = 'mem-found-badge status-inactive';
    opts.style.display   = 'block';
    already.style.display= 'none';
  }
  card.style.display = 'block';
}

async function activateMember() {
  if (!_memCurrentKey) return;
  const branch = document.getElementById('memBranch').value;
  const payMethod = document.getElementById('memPayMethod').value;
  const btn = document.getElementById('memActivateBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  const now = new Date().toISOString();

  // 1. PATCH member profile → ACTIVE
  const patchOk = await sbMem(`member_profiles?user_key=eq.${encodeURIComponent(_memCurrentKey)}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      membership_status: 'ACTIVE',
      membership_activated_at: now,
      total_points: 0,
      current_tier: 'bronze',
      updated_at: now
    })
  });

  // 2. Record activation
  await sbMem('member_activations', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      user_key: _memCurrentKey,
      amount: 100000,
      payment_method: payMethod,
      status: 'completed',
      confirmed_by: 'admin-' + branch
    })
  });

  if (patchOk !== null) {
    showToast('✓ Membership berhasil diaktifkan!', 'success');
    // Refresh UI
    document.getElementById('memFoundBadge').textContent = '✓ AKTIF';
    document.getElementById('memFoundBadge').className = 'mem-found-badge status-active';
    document.getElementById('memActivateOpts').style.display = 'none';
    document.getElementById('memAlreadyActive').style.display = 'flex';
    await loadMemStats();
    await loadRecentActivations();
    await loadAllMembers();
  } else {
    showToast('Gagal mengaktifkan. Coba lagi.', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Aktivasi Membership — Rp 100.000';
}

async function loadRecentActivations() {
  const rows = await sbMem(
    'member_activations?select=user_key,amount,payment_method,status,confirmed_by,created_at&order=created_at.desc&limit=20'
  );
  const tbody = document.getElementById('memActivationsBody');
  if (!tbody) return;
  if (!rows || !rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="mem-empty">Belum ada aktivasi</td></tr>'; return; }

  // Fetch matching profiles for names
  const keys = [...new Set(rows.map(r=>r.user_key))];
  const profiles = await sbMem(`member_profiles?user_key=in.(${keys.map(k=>encodeURIComponent(k)).join(',')})&select=user_key,full_name`).catch(()=>null);
  const nameMap = {};
  (profiles || []).forEach(p => { nameMap[p.user_key] = p.full_name || p.user_key; });

  tbody.innerHTML = rows.map(r => {
    const branch = (r.confirmed_by || '').replace('admin-','');
    const date   = new Date(r.created_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
    const statusBadge = r.status === 'completed'
      ? '<span class="mem-badge-ok">✓ Selesai</span>'
      : `<span class="mem-badge-pend">${esc(r.status)}</span>`;
    return `<tr>
      <td>${esc(nameMap[r.user_key] || '—')}</td>
      <td class="mem-td-sm">${esc(r.user_key)}</td>
      <td>${esc(branch || '—')}</td>
      <td>${esc(r.payment_method || '—')}</td>
      <td>${date}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');
}

async function loadAllMembers() {
  const rows = await sbMem('member_profiles?select=full_name,email,membership_status,current_tier,total_points,total_visits,created_at&order=created_at.desc');
  const tbody = document.getElementById('memAllBody');
  if (!tbody) return;
  if (!rows || !rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="mem-empty">Belum ada member</td></tr>'; return; }
  const TIER_ICONS = { bronze:'🥉', silver:'🥈', gold:'🥇', platinum:'💎' };
  tbody.innerHTML = rows.map(r => {
    const statusBadge = r.membership_status === 'ACTIVE'
      ? '<span class="mem-badge-ok">Aktif</span>'
      : '<span class="mem-badge-pend">Belum Aktif</span>';
    const join = new Date(r.created_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
    return `<tr>
      <td>${esc(r.full_name || '—')}</td>
      <td class="mem-td-sm">${esc(r.email)}</td>
      <td>${statusBadge}</td>
      <td>${TIER_ICONS[r.current_tier]||''} ${esc(r.current_tier||'bronze')}</td>
      <td>${r.total_points ?? 0}</td>
      <td>${r.total_visits ?? 0}</td>
      <td>${join}</td>
    </tr>`;
  }).join('');
}

// Hook into view switcher
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sb-link[data-view="membership"]').forEach(btn => {
    btn.addEventListener('click', initMembershipView);
  });

  document.getElementById('memSearchBtn')?.addEventListener('click', () => {
    searchMember(document.getElementById('memSearchInput').value);
  });
  document.getElementById('memSearchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchMember(e.target.value);
  });
  document.getElementById('memActivateBtn')?.addEventListener('click', activateMember);
});
