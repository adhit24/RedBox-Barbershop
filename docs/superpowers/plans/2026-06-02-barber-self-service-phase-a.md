# Barber Self-Service App — Phase A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kapster bisa onboarding sendiri via WA OTP, setup profil (avatar + target), lalu pakai PWA untuk lihat dashboard pribadi, jadwal lengkap, stats performa, history customer, dan kelola profil.

**Architecture:** Extend existing Next.js 16 PWA + Express backend. Custom phone OTP auth (reuse infrastruktur Fonnte OTP yang sudah jalan untuk customer) dengan cookie session `redbox_barber_session`. Avatar disimpan di Supabase Storage bucket baru. Semua endpoint kapster di-proxy lewat Next.js API routes ke Express.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS 4, Express.js, Supabase (Postgres + Storage), Fonnte WA API, Web Push (existing)

**Spec:** `docs/superpowers/specs/2026-06-02-barber-self-service-design.md`

**Out of scope (Phase B):** streak, badges, achievements, missions, tier system, leaderboard, smart cron notifications, owner reward dashboard.

---

## File Map

### Backend (server/)
```
migrations/005_barber_users.sql ← BARU: tabel barber_users + barber_sessions
services/barberAuth.js ← BARU: middleware + session token helpers
services/barberOTP.js ← BARU: send + verify OTP untuk kapster
routes/barber.js ← BARU: semua endpoint /api/barber/*
index.js ← MODIFY: wire routes/barber.js
```

### Frontend (frontend/src/)
```
lib/
 barberApi.ts ← BARU: typed client untuk /api/barber/*
 barberTypes.ts ← BARU: shared types (BarberProfile, BarberStats, dll)

hooks/
 useUser.ts ← MODIFY: support cookie session barber
 useBarberSession.ts ← BARU: fetch /api/barber/me + cache

components/barber/
 TargetProgressBar.tsx ← BARU: progress bar target harian
 UpcomingBookingCard.tsx ← BARU: card "berikutnya"
 StatsGrid.tsx ← BARU: 4-card grid (count, revenue, jam, rating)

app/barber/
 login/page.tsx ← BARU: input HP → OTP
 setup/page.tsx ← BARU: upload avatar + target form
 home/page.tsx ← BARU: dashboard pribadi
 progress/page.tsx ← BARU: stats + history per periode
 profile/page.tsx ← BARU: settings + logout
 layout.tsx ← MODIFY: 4 tab nav, auth guard via cookie
 schedule/page.tsx ← MODIFY: tambah tab Hari Ini / Besok / Minggu

app/api/barber/
 auth/otp/send/route.ts ← BARU: proxy POST
 auth/otp/verify/route.ts ← BARU: proxy POST + set cookie
 auth/logout/route.ts ← BARU: proxy + clear cookie
 me/route.ts ← BARU: proxy GET
 setup/route.ts ← BARU: proxy POST
 avatar/upload/route.ts ← BARU: proxy multipart POST
 target/route.ts ← BARU: proxy PUT
 stats/route.ts ← BARU: proxy GET
 upcoming/route.ts ← BARU: proxy GET
 history/route.ts ← BARU: proxy GET
```

---

## Task 1: Database Migration

**Files:**
- Create: `server/migrations/005_barber_users.sql`

- [ ] **Step 1: Tulis migration SQL**

```sql
-- Profil + setup status kapster (extend tabel barbers)
CREATE TABLE IF NOT EXISTS barber_users (
 barber_id TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
 phone TEXT NOT NULL,
 avatar_url TEXT,
 target_daily INT,
 target_monthly INT,
 setup_completed BOOLEAN DEFAULT FALSE,
 notif_enabled BOOLEAN DEFAULT TRUE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_barber_users_phone ON barber_users(phone);
GRANT SELECT, INSERT, UPDATE ON barber_users TO anon, authenticated;

-- Session token untuk kapster (custom OTP, bukan Supabase Auth)
CREATE TABLE IF NOT EXISTS barber_sessions (
 token TEXT PRIMARY KEY,
 barber_id TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_barber_sessions_barber_id ON barber_sessions(barber_id);
GRANT SELECT, INSERT, DELETE ON barber_sessions TO anon, authenticated;
```

- [ ] **Step 2: Jalankan di Supabase SQL Editor**

Verifikasi:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
 AND table_name IN ('barber_users', 'barber_sessions');
-- Expected: 2 rows
```

- [ ] **Step 3: Commit migration file**

```bash
git add server/migrations/005_barber_users.sql
git commit -m "feat: add barber_users and barber_sessions tables"
```

---

## Task 2: Supabase Storage Bucket Setup

**Manual setup (tidak ada file di-commit).**

- [ ] **Step 1: Buat bucket di Supabase Dashboard**

1. Buka Supabase Dashboard → Storage → **New bucket**
2. Name: `barber-avatars`
3. Public bucket: **ON** (avatar di-read publik via URL)
4. Klik **Create bucket**

- [ ] **Step 2: Buat RLS policy untuk upload**

Storage → policies → barber-avatars → **New policy**:

Policy 1 — INSERT untuk authenticated:
```sql
-- (Pakai expression builder; SQL equivalent:)
-- bucket_id = 'barber-avatars' AND auth.role() = 'authenticated'
```

Alternatif lebih simple (karena auth kita custom): bisa skip policy upload dan handle upload via service_role di backend (Task 6 menggunakan service_role).

- [ ] **Step 3: Verifikasi bucket created**

Cek di Storage → bucket list → harus muncul `barber-avatars`.

Tidak ada commit di task ini.

---

## Task 3: Backend OTP Service

**Files:**
- Create: `server/services/barberOTP.js`

- [ ] **Step 1: Buat file**

```javascript
// server/services/barberOTP.js
const { randomUUID } = require('crypto');
const { sendWA: sendWAFonnte } = require('./fonnte');

function normalizeWa(phone) {
 return String(phone || '').replace(/\D/g, '').replace(/^0/, '62');
}

/**
 * Kirim OTP ke kapster.
 * Cek di tabel `barbers` apakah phone ini terdaftar.
 * Return { ok, barber, error }
 */
async function sendBarberOTP(supabase, phone) {
 const wa = normalizeWa(phone);
 if (wa.length < 10 || !wa.startsWith('62')) {
 return { ok: false, error: 'Format nomor HP tidak valid' };
 }

 const { data: barber } = await supabase
 .from('barbers')
 .select('id, name, phone, branch')
 .eq('phone', wa)
 .eq('is_active', true)
 .maybeSingle();

 if (!barber) {
 return { ok: false, error: 'Nomor tidak terdaftar sebagai kapster. Hubungi admin.' };
 }

 // Rate limit: max 3 OTP per 10 menit (reuse tabel otp_codes existing)
 const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
 const { count } = await supabase.from('otp_codes')
 .select('*', { count: 'exact', head: true })
 .eq('phone', wa).gte('created_at', since);
 if (count >= 3) {
 return { ok: false, error: 'Terlalu banyak percobaan. Tunggu 10 menit.' };
 }

 const code = String(Math.floor(100000 + Math.random() * 900000));
 const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
 await supabase.from('otp_codes').insert({ phone: wa, code, expires_at: expiresAt });

 const firstName = (barber.name || 'Kapster').split(' ')[0];
 const msg = `Halo ${firstName}! \n\nKode OTP login RedBox Staff:\n\n*${code}*\n\nBerlaku 10 menit. Jangan bagikan ke siapapun ya! `;

 try {
 await sendWAFonnte(wa, msg);
 } catch (e) {
 console.error('[BarberOTP] sendWA error:', e.message);
 return { ok: false, error: 'Gagal kirim OTP ke WhatsApp. Coba lagi.' };
 }

 return { ok: true, barber: { id: barber.id, name: barber.name, branch: barber.branch } };
}

/**
 * Verify OTP, auto-enroll ke barber_users kalau belum ada, issue session token.
 * Return { ok, token, barber, setup_completed, error }
 */
async function verifyBarberOTP(supabase, phone, code) {
 const wa = normalizeWa(phone);

 const { data: otp } = await supabase
 .from('otp_codes')
 .select('id')
 .eq('phone', wa)
 .eq('code', String(code).trim())
 .is('verified_at', null)
 .gt('expires_at', new Date().toISOString())
 .order('created_at', { ascending: false })
 .limit(1)
 .maybeSingle();

 if (!otp) {
 return { ok: false, error: 'Kode OTP salah atau sudah expired' };
 }

 await supabase.from('otp_codes')
 .update({ verified_at: new Date().toISOString() })
 .eq('id', otp.id);

 // Lookup barber by phone
 const { data: barber } = await supabase
 .from('barbers')
 .select('id, name, branch')
 .eq('phone', wa)
 .eq('is_active', true)
 .maybeSingle();

 if (!barber) {
 return { ok: false, error: 'Kapster tidak ditemukan' };
 }

 // Auto-enroll kalau belum ada di barber_users
 const { data: existing } = await supabase
 .from('barber_users')
 .select('barber_id, setup_completed')
 .eq('barber_id', barber.id)
 .maybeSingle();

 let setupCompleted = false;
 if (!existing) {
 await supabase.from('barber_users').insert({
 barber_id: barber.id,
 phone: wa,
 setup_completed: false,
 last_login_at: new Date().toISOString(),
 });
 } else {
 setupCompleted = !!existing.setup_completed;
 await supabase.from('barber_users')
 .update({ last_login_at: new Date().toISOString() })
 .eq('barber_id', barber.id);
 }

 // Issue session token
 const token = randomUUID();
 const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
 await supabase.from('barber_sessions').insert({
 token,
 barber_id: barber.id,
 expires_at: expiresAt,
 });

 return {
 ok: true,
 token,
 barber: { id: barber.id, name: barber.name, branch: barber.branch },
 setup_completed: setupCompleted,
 };
}

/**
 * Destroy session token (logout)
 */
async function destroyBarberSession(supabase, token) {
 if (!token) return;
 await supabase.from('barber_sessions').delete().eq('token', token);
}

module.exports = { sendBarberOTP, verifyBarberOTP, destroyBarberSession, normalizeWa };
```

- [ ] **Step 2: Commit**

```bash
git add server/services/barberOTP.js
git commit -m "feat: barber OTP send/verify with auto-enroll"
```

---

## Task 4: Backend Auth Middleware

**Files:**
- Create: `server/services/barberAuth.js`

- [ ] **Step 1: Buat middleware file**

```javascript
// server/services/barberAuth.js

/**
 * Middleware factory. Validates barber_sessions.token from header.
 * Frontend mengirim token via header 'x-barber-token' (proxy ambil dari cookie).
 * Attach req.barber = { id, name, branch } pada success.
 */
function createBarberAuth(supabase) {
 return async function barberAuth(req, res, next) {
 const token = req.headers['x-barber-token'] || '';
 if (!token) return res.status(401).json({ error: 'No barber session' });

 const { data: session } = await supabase
 .from('barber_sessions')
 .select('barber_id, expires_at')
 .eq('token', token)
 .gt('expires_at', new Date().toISOString())
 .maybeSingle();

 if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

 const { data: barber } = await supabase
 .from('barbers')
 .select('id, name, branch')
 .eq('id', session.barber_id)
 .maybeSingle();

 if (!barber) return res.status(401).json({ error: 'Barber not found' });

 req.barber = barber;
 next();
 };
}

module.exports = { createBarberAuth };
```

- [ ] **Step 2: Commit**

```bash
git add server/services/barberAuth.js
git commit -m "feat: barberAuth middleware for session token validation"
```

---

## Task 5: Backend Routes File — Auth + Profile + Setup

**Files:**
- Create: `server/routes/barber.js`
- Modify: `server/index.js` — wire up routes

- [ ] **Step 1: Buat file routes**

```javascript
// server/routes/barber.js
const express = require('express');
const { sendBarberOTP, verifyBarberOTP, destroyBarberSession } = require('../services/barberOTP');
const { createBarberAuth } = require('../services/barberAuth');

function createBarberRoutes(supabase) {
 const router = express.Router();
 const barberAuth = createBarberAuth(supabase);

 // ─── AUTH ────────────────────────────────────────────
 router.post('/auth/otp/send', async (req, res) => {
 const { phone } = req.body || {};
 if (!phone) return res.status(400).json({ error: 'Phone required' });
 const result = await sendBarberOTP(supabase, phone);
 if (!result.ok) return res.status(400).json({ error: result.error });
 return res.json({ ok: true, barber: result.barber });
 });

 router.post('/auth/otp/verify', async (req, res) => {
 const { phone, code } = req.body || {};
 if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
 const result = await verifyBarberOTP(supabase, phone, code);
 if (!result.ok) return res.status(401).json({ error: result.error });
 return res.json({
 ok: true,
 token: result.token,
 barber: result.barber,
 setup_completed: result.setup_completed,
 });
 });

 router.post('/auth/logout', barberAuth, async (req, res) => {
 const token = req.headers['x-barber-token'];
 await destroyBarberSession(supabase, token);
 return res.json({ ok: true });
 });

 // ─── PROFILE ─────────────────────────────────────────
 router.get('/me', barberAuth, async (req, res) => {
 const { data: profile } = await supabase
 .from('barber_users')
 .select('barber_id, phone, avatar_url, target_daily, target_monthly, setup_completed, notif_enabled')
 .eq('barber_id', req.barber.id)
 .maybeSingle();

 return res.json({
 barber: req.barber,
 profile: profile || null,
 });
 });

 router.post('/setup', barberAuth, async (req, res) => {
 const { target_daily, target_monthly, avatar_url } = req.body || {};
 if (!target_daily || !target_monthly) {
 return res.status(400).json({ error: 'target_daily and target_monthly required' });
 }
 const update = {
 target_daily: Number(target_daily),
 target_monthly: Number(target_monthly),
 setup_completed: true,
 };
 if (avatar_url) update.avatar_url = avatar_url;

 const { error } = await supabase
 .from('barber_users')
 .update(update)
 .eq('barber_id', req.barber.id);

 if (error) return res.status(500).json({ error: error.message });
 return res.json({ ok: true });
 });

 router.put('/target', barberAuth, async (req, res) => {
 const { target_daily, target_monthly } = req.body || {};
 const update = {};
 if (target_daily) update.target_daily = Number(target_daily);
 if (target_monthly) update.target_monthly = Number(target_monthly);
 if (Object.keys(update).length === 0) {
 return res.status(400).json({ error: 'Nothing to update' });
 }
 const { error } = await supabase
 .from('barber_users')
 .update(update)
 .eq('barber_id', req.barber.id);
 if (error) return res.status(500).json({ error: error.message });
 return res.json({ ok: true });
 });

 return router;
}

module.exports = { createBarberRoutes };
```

- [ ] **Step 2: Wire up di server/index.js**

Cari baris yang berisi `app.post('/api/push/subscribe'` (sekitar baris 2210, hasil dari Task 11 plan sebelumnya). Tambahkan baris berikut **tepat di atas** baris tersebut:

```javascript
// Barber self-service routes
const { createBarberRoutes } = require('./routes/barber');
app.use('/api/barber', createBarberRoutes(supabase));
```

- [ ] **Step 3: Test endpoint`/api/barber/auth/otp/send`**

```bash
curl -X POST http://localhost:3001/api/barber/auth/otp/send \
 -H "Content-Type: application/json" \
 -d '{"phone": "INVALID"}'
```
Expected: 400 dengan error "Format nomor HP tidak valid"

- [ ] **Step 4: Commit**

```bash
git add server/routes/barber.js server/index.js
git commit -m "feat: barber routes (auth, profile, setup, target)"
```

---

## Task 6: Backend Avatar Upload Endpoint

**Files:**
- Modify: `server/routes/barber.js` — tambah endpoint upload

- [ ] **Step 1: Tambah dependency multer (sudah ada Express, multer optional)**

Alternatif: pakai base64 di JSON (lebih simple, no library). Pakai approach ini.

- [ ] **Step 2: Tambah endpoint di `server/routes/barber.js`**

Sisipkan sebelum `return router;` (di akhir file `createBarberRoutes`):

```javascript
 router.post('/avatar/upload', barberAuth, async (req, res) => {
 const { dataUrl } = req.body || {};
 if (!dataUrl || typeof dataUrl !== 'string') {
 return res.status(400).json({ error: 'dataUrl required (base64 data URL)' });
 }
 const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
 if (!match) return res.status(400).json({ error: 'Invalid data URL format' });

 const mime = match[1];
 const base64 = match[2];
 const ext = mime === 'image/png' ? 'png' : 'jpg';
 const buffer = Buffer.from(base64, 'base64');
 if (buffer.length > 2 * 1024 * 1024) {
 return res.status(413).json({ error: 'File terlalu besar (max 2MB)' });
 }

 const path = `${req.barber.id}/avatar.${ext}`;
 const { error: upErr } = await supabase.storage
 .from('barber-avatars')
 .upload(path, buffer, { contentType: mime, upsert: true });

 if (upErr) return res.status(500).json({ error: upErr.message });

 const { data: { publicUrl } } = supabase.storage
 .from('barber-avatars')
 .getPublicUrl(path);

 await supabase.from('barber_users')
 .update({ avatar_url: publicUrl })
 .eq('barber_id', req.barber.id);

 return res.json({ ok: true, avatar_url: publicUrl });
 });
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/barber.js
git commit -m "feat: barber avatar upload endpoint (base64 → Supabase Storage)"
```

---

## Task 7: Backend Stats Endpoint

**Files:**
- Modify: `server/routes/barber.js`

- [ ] **Step 1: Tambah helper untuk date range**

Sisipkan di atas `function createBarberRoutes` di `server/routes/barber.js`:

```javascript
function localDateStr(d = new Date()) {
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDateRange(period) {
 const now = new Date();
 const today = localDateStr(now);
 const start = new Date(now);
 if (period === 'week') start.setDate(now.getDate() - 7);
 else if (period === 'month') start.setDate(now.getDate() - 30);
 else if (period === 'year') start.setFullYear(now.getFullYear() - 1);
 else { /* day = today only */ }
 return { from: localDateStr(start), to: today };
}
```

- [ ] **Step 2: Tambah endpoint stats**

Sisipkan sebelum `return router;`:

```javascript
 router.get('/stats', barberAuth, async (req, res) => {
 const period = String(req.query.period || 'day');
 const { from, to } = getDateRange(period);

 const { data: rows, error } = await supabase
 .from('booking_full')
 .select('price, duration, date')
 .eq('barber_id', req.barber.id)
 .eq('status', 'done')
 .gte('date', from)
 .lte('date', to);

 if (error) return res.status(500).json({ error: error.message });

 const count = rows?.length || 0;
 const revenue = (rows || []).reduce((s, r) => s + (Number(r.price) || 0), 0);
 const minutesTotal = (rows || []).reduce((s, r) => s + (Number(r.duration) || 0), 0);
 const hours = Math.round((minutesTotal / 60) * 10) / 10;

 // Rating dari tabel reviews kalau ada
 let rating = 0;
 try {
 const { data: revs } = await supabase
 .from('reviews')
 .select('rating')
 .eq('barber_id', req.barber.id)
 .gte('created_at', from + 'T00:00:00')
 .lte('created_at', to + 'T23:59:59');
 if (revs && revs.length > 0) {
 const sum = revs.reduce((s, r) => s + (Number(r.rating) || 0), 0);
 rating = Math.round((sum / revs.length) * 10) / 10;
 }
 } catch { /* reviews table optional */ }

 return res.json({
 period,
 from,
 to,
 count,
 revenue,
 hours,
 rating,
 });
 });
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/barber.js
git commit -m "feat: barber stats endpoint (count, revenue, hours, rating)"
```

---

## Task 8: Backend Upcoming + History Endpoints

**Files:**
- Modify: `server/routes/barber.js`

- [ ] **Step 1: Tambah endpoint upcoming**

Sisipkan sebelum `return router;`:

```javascript
 router.get('/upcoming', barberAuth, async (req, res) => {
 const now = new Date();
 const today = localDateStr(now);
 const tomorrow = localDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
 const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

 const { data: todayList } = await supabase
 .from('booking_full')
 .select('*')
 .eq('barber_id', req.barber.id)
 .eq('date', today)
 .neq('status', 'cancelled')
 .order('time', { ascending: true });

 const { data: tomorrowList } = await supabase
 .from('booking_full')
 .select('*')
 .eq('barber_id', req.barber.id)
 .eq('date', tomorrow)
 .neq('status', 'cancelled')
 .order('time', { ascending: true });

 const upcomingToday = (todayList || []).filter(b => b.time >= currentTime && b.status !== 'done');
 const next = upcomingToday[0] || null;

 return res.json({
 next,
 today: todayList || [],
 tomorrow: tomorrowList || [],
 });
 });
```

- [ ] **Step 2: Tambah endpoint history**

```javascript
 router.get('/history', barberAuth, async (req, res) => {
 const period = String(req.query.period || 'month');
 const offset = Number(req.query.offset || 0);
 const limit = Math.min(Number(req.query.limit || 50), 100);
 const { from, to } = getDateRange(period);

 const { data, error } = await supabase
 .from('booking_full')
 .select('*')
 .eq('barber_id', req.barber.id)
 .eq('status', 'done')
 .gte('date', from)
 .lte('date', to)
 .order('date', { ascending: false })
 .order('time', { ascending: false })
 .range(offset, offset + limit - 1);

 if (error) return res.status(500).json({ error: error.message });
 return res.json({ items: data || [], period, from, to });
 });
```

- [ ] **Step 3: Test upcoming endpoint**

Backend masih test manual. Akan diuji lewat UI di task akhir.

- [ ] **Step 4: Commit**

```bash
git add server/routes/barber.js
git commit -m "feat: barber upcoming and history endpoints"
```

---

## Task 9: Frontend — Types and API Client

**Files:**
- Create: `frontend/src/lib/barberTypes.ts`
- Create: `frontend/src/lib/barberApi.ts`

- [ ] **Step 1: Buat types**

```typescript
// frontend/src/lib/barberTypes.ts
import type { Booking } from './constants';

export interface BarberInfo {
 id: string;
 name: string;
 branch: string;
}

export interface BarberProfile {
 barber_id: string;
 phone: string;
 avatar_url: string | null;
 target_daily: number | null;
 target_monthly: number | null;
 setup_completed: boolean;
 notif_enabled: boolean;
}

export interface BarberMeResponse {
 barber: BarberInfo;
 profile: BarberProfile | null;
}

export interface BarberStats {
 period: 'day' | 'week' | 'month' | 'year';
 from: string;
 to: string;
 count: number;
 revenue: number;
 hours: number;
 rating: number;
}

export interface BarberUpcoming {
 next: Booking | null;
 today: Booking[];
 tomorrow: Booking[];
}

export interface BarberHistoryResponse {
 items: Booking[];
 period: string;
 from: string;
 to: string;
}
```

- [ ] **Step 2: Buat API client**

```typescript
// frontend/src/lib/barberApi.ts
import type {
 BarberMeResponse,
 BarberStats,
 BarberUpcoming,
 BarberHistoryResponse,
} from './barberTypes';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
 const res = await fetch(path, {
 headers: { 'Content-Type': 'application/json', ...init?.headers },
 ...init,
 });
 if (!res.ok) {
 const text = await res.text().catch(() => '');
 throw new Error(`API ${path} → ${res.status}: ${text}`);
 }
 return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────
export function sendBarberOTP(phone: string) {
 return jsonFetch<{ ok: true; barber: { id: string; name: string; branch: string } }>(
 '/api/barber/auth/otp/send',
 { method: 'POST', body: JSON.stringify({ phone }) }
 );
}

export function verifyBarberOTP(phone: string, code: string) {
 return jsonFetch<{ ok: true; setup_completed: boolean }>(
 '/api/barber/auth/otp/verify',
 { method: 'POST', body: JSON.stringify({ phone, code }) }
 );
}

export function logoutBarber() {
 return jsonFetch<{ ok: true }>('/api/barber/auth/logout', { method: 'POST' });
}

// ─── Profile ─────────────────────────────────────────
export function fetchBarberMe() {
 return jsonFetch<BarberMeResponse>('/api/barber/me');
}

export function saveBarberSetup(payload: {
 target_daily: number;
 target_monthly: number;
 avatar_url?: string;
}) {
 return jsonFetch<{ ok: true }>('/api/barber/setup', {
 method: 'POST',
 body: JSON.stringify(payload),
 });
}

export function updateBarberTarget(target_daily?: number, target_monthly?: number) {
 return jsonFetch<{ ok: true }>('/api/barber/target', {
 method: 'PUT',
 body: JSON.stringify({ target_daily, target_monthly }),
 });
}

export function uploadBarberAvatar(dataUrl: string) {
 return jsonFetch<{ ok: true; avatar_url: string }>('/api/barber/avatar/upload', {
 method: 'POST',
 body: JSON.stringify({ dataUrl }),
 });
}

// ─── Data ────────────────────────────────────────────
export function fetchBarberStats(period: BarberStats['period'] = 'day') {
 return jsonFetch<BarberStats>(`/api/barber/stats?period=${period}`);
}

export function fetchBarberUpcoming() {
 return jsonFetch<BarberUpcoming>('/api/barber/upcoming');
}

export function fetchBarberHistory(period: string = 'month', offset = 0, limit = 50) {
 return jsonFetch<BarberHistoryResponse>(
 `/api/barber/history?period=${period}&offset=${offset}&limit=${limit}`
 );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors in new files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/barberTypes.ts frontend/src/lib/barberApi.ts
git commit -m "feat: barber types and API client"
```

---

## Task 10: Frontend — Next.js Proxy Routes for Barber API

**Files:**
- Create: `frontend/src/app/api/barber/auth/otp/send/route.ts`
- Create: `frontend/src/app/api/barber/auth/otp/verify/route.ts`
- Create: `frontend/src/app/api/barber/auth/logout/route.ts`
- Create: `frontend/src/app/api/barber/me/route.ts`
- Create: `frontend/src/app/api/barber/setup/route.ts`
- Create: `frontend/src/app/api/barber/avatar/upload/route.ts`
- Create: `frontend/src/app/api/barber/target/route.ts`
- Create: `frontend/src/app/api/barber/stats/route.ts`
- Create: `frontend/src/app/api/barber/upcoming/route.ts`
- Create: `frontend/src/app/api/barber/history/route.ts`

**Pattern:** Cookie `redbox_barber_session` di-baca dari request, di-forward sebagai header `x-barber-token` ke Express. Set cookie pada login response.

- [ ] **Step 1: OTP send (no auth needed)**

`frontend/src/app/api/barber/auth/otp/send/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barber/auth/otp/send`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: OTP verify (sets cookie)**

`frontend/src/app/api/barber/auth/otp/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barber/auth/otp/verify`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const data = await res.json();

 const response = NextResponse.json(data, { status: res.status });
 if (res.ok && data.token) {
 response.cookies.set('redbox_barber_session', data.token, {
 httpOnly: true,
 sameSite: 'lax',
 secure: process.env.NODE_ENV === 'production',
 maxAge: 30 * 24 * 60 * 60,
 path: '/',
 });
 }
 return response;
}
```

- [ ] **Step 3: Logout (clears cookie)**

`frontend/src/app/api/barber/auth/logout/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 await fetch(`${API_URL}/api/barber/auth/logout`, {
 method: 'POST',
 headers: { 'x-barber-token': token },
 }).catch(() => {});
 const response = NextResponse.json({ ok: true });
 response.cookies.delete('redbox_barber_session');
 return response;
}
```

- [ ] **Step 4: Helper proxy untuk authenticated GET/POST/PUT**

Buat helper inline di setiap file. Untuk `me/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const res = await fetch(`${API_URL}/api/barber/me`, {
 headers: { 'x-barber-token': token },
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 5: Buat sisanya dengan pola sama**

`setup/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barber/setup`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'x-barber-token': token },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

`avatar/upload/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barber/avatar/upload`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'x-barber-token': token },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

`target/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function PUT(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barber/target`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json', 'x-barber-token': token },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

`stats/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const qs = req.nextUrl.search;
 const res = await fetch(`${API_URL}/api/barber/stats${qs}`, {
 headers: { 'x-barber-token': token },
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

`upcoming/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const res = await fetch(`${API_URL}/api/barber/upcoming`, {
 headers: { 'x-barber-token': token },
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

`history/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
 const token = req.cookies.get('redbox_barber_session')?.value || '';
 const qs = req.nextUrl.search;
 const res = await fetch(`${API_URL}/api/barber/history${qs}`, {
 headers: { 'x-barber-token': token },
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 6: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/api/barber/
git commit -m "feat: Next.js proxy routes for barber API"
```

---

## Task 11: Frontend — Update Middleware untuk Barber Session

**Files:**
- Modify: `frontend/src/middleware.ts`

- [ ] **Step 1: Update middleware**

Buka `frontend/src/middleware.ts`, replace dengan:

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function middleware(request: NextRequest) {
 const { pathname } = request.nextUrl;

 // Public routes — no auth needed
 if (
 pathname.startsWith('/login') ||
 pathname.startsWith('/barber/login') ||
 pathname.startsWith('/ai-hairstyle') ||
 pathname.startsWith('/api/ai-hairstyle') ||
 pathname.startsWith('/api/barber/auth/') ||
 pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json|css|woff|woff2)$/)
 ) {
 return NextResponse.next();
 }

 // Barber session cookie → allow /barber/* and /api/barber/*
 const barberSession = request.cookies.get('redbox_barber_session')?.value;
 if (barberSession) {
 if (pathname === '/') {
 return NextResponse.redirect(new URL('/barber/home', request.url));
 }
 if (pathname.startsWith('/barber/') || pathname.startsWith('/api/barber/')) {
 return NextResponse.next();
 }
 // Barber trying to access /admin → redirect to /barber/home
 if (pathname.startsWith('/admin/')) {
 return NextResponse.redirect(new URL('/barber/home', request.url));
 }
 }

 // No barber session and trying to access /barber/* → redirect to /barber/login
 if (pathname.startsWith('/barber/') && !pathname.startsWith('/barber/login')) {
 return NextResponse.redirect(new URL('/barber/login', request.url));
 }

 // Supabase admin/owner check
 if (!supabaseUrl || !supabaseKey) return NextResponse.next();

 let response = NextResponse.next({ request: { headers: request.headers } });

 const supabase = createServerClient(supabaseUrl, supabaseKey, {
 cookies: {
 getAll: () => request.cookies.getAll(),
 setAll: (cookies) => {
 cookies.forEach(({ name, value }) => request.cookies.set(name, value));
 response = NextResponse.next({ request });
 cookies.forEach(({ name, value, options }) =>
 response.cookies.set(name, value, options)
 );
 },
 },
 });

 const { data: { user } } = await supabase.auth.getUser();

 if (!user) {
 return NextResponse.redirect(new URL('/login', request.url));
 }

 if (pathname === '/') {
 const { data: profile } = await supabase
 .from('users').select('role').eq('id', user.id).single();
 const dest = profile?.role === 'barber' ? '/barber/home' : '/admin/dashboard';
 return NextResponse.redirect(new URL(dest, request.url));
 }

 return response;
}

export const config = {
 matcher: ['/((?!_next/static|_next/image|favicon.ico|icons).*)', '/'],
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/middleware.ts
git commit -m "feat: middleware supports barber session cookie"
```

---

## Task 12: Frontend — Barber Login Page

**Files:**
- Create: `frontend/src/app/barber/login/page.tsx`

- [ ] **Step 1: Buat halaman login**

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendBarberOTP, verifyBarberOTP } from '@/lib/barberApi';

export default function BarberLoginPage() {
 const router = useRouter();
 const [step, setStep] = useState<'phone' | 'otp'>('phone');
 const [phone, setPhone] = useState('');
 const [code, setCode] = useState('');
 const [barberName, setBarberName] = useState('');
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);

 async function handleSendOTP(e: React.FormEvent) {
 e.preventDefault();
 setError('');
 setLoading(true);
 try {
 const result = await sendBarberOTP(phone);
 setBarberName(result.barber.name);
 setStep('otp');
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : 'Gagal kirim OTP';
 // Extract just the error message from "API ... → 400: {"error":"..."}"
 const match = msg.match(/"error":"([^"]+)"/);
 setError(match?.[1] || msg);
 } finally {
 setLoading(false);
 }
 }

 async function handleVerify(e: React.FormEvent) {
 e.preventDefault();
 setError('');
 setLoading(true);
 try {
 const result = await verifyBarberOTP(phone, code);
 if (result.setup_completed) {
 router.push('/barber/home');
 } else {
 router.push('/barber/setup');
 }
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : 'OTP salah';
 const match = msg.match(/"error":"([^"]+)"/);
 setError(match?.[1] || msg);
 } finally {
 setLoading(false);
 }
 }

 return (
 <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
 <div className="w-full max-w-sm">
 <div className="text-center mb-8">
 <div className="text-4xl mb-2"></div>
 <h1 className="text-2xl font-bold text-white">RedBox Kapster</h1>
 <p className="text-gray-400 text-sm mt-1">
 {step === 'phone' ? 'Masukkan nomor HP yang terdaftar' : `Halo ${barberName} `}
 </p>
 </div>

 {step === 'phone' ? (
 <form onSubmit={handleSendOTP} className="bg-gray-900 rounded-2xl p-6 space-y-4">
 <div>
 <label className="block text-sm text-gray-300 mb-1">Nomor HP</label>
 <input
 type="tel"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 required
 className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
 placeholder="08xxxxxxxxxx"
 />
 </div>
 {error && <p className="text-red-400 text-sm">{error}</p>}
 <button
 type="submit"
 disabled={loading}
 className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
 >
 {loading ? 'Mengirim OTP...' : 'Kirim Kode OTP'}
 </button>
 </form>
 ) : (
 <form onSubmit={handleVerify} className="bg-gray-900 rounded-2xl p-6 space-y-4">
 <p className="text-sm text-gray-400">
 Kami kirim kode 6 digit ke WhatsApp ke nomor {phone}
 </p>
 <div>
 <label className="block text-sm text-gray-300 mb-1">Kode OTP</label>
 <input
 type="text"
 inputMode="numeric"
 maxLength={6}
 value={code}
 onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
 required
 className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500"
 placeholder="······"
 />
 </div>
 {error && <p className="text-red-400 text-sm">{error}</p>}
 <button
 type="submit"
 disabled={loading || code.length !== 6}
 className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
 >
 {loading ? 'Memverifikasi...' : 'Masuk'}
 </button>
 <button
 type="button"
 onClick={() => { setStep('phone'); setCode(''); setError(''); }}
 className="w-full text-sm text-gray-400 hover:text-white"
 >
 Ganti nomor HP
 </button>
 </form>
 )}
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/login/page.tsx
git commit -m "feat: barber OTP login page (phone + code 2-step)"
```

---

## Task 13: Frontend — useBarberSession Hook

**Files:**
- Create: `frontend/src/hooks/useBarberSession.ts`

- [ ] **Step 1: Buat hook**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { fetchBarberMe, logoutBarber } from '@/lib/barberApi';
import type { BarberMeResponse } from '@/lib/barberTypes';

export function useBarberSession() {
 const [data, setData] = useState<BarberMeResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 async function refresh() {
 try {
 const res = await fetchBarberMe();
 setData(res);
 setError(null);
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : 'failed';
 setError(msg);
 setData(null);
 } finally {
 setLoading(false);
 }
 }

 useEffect(() => {
 refresh();
 }, []);

 async function signOut() {
 await logoutBarber().catch(() => {});
 window.location.href = '/barber/login';
 }

 return { data, loading, error, refresh, signOut };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useBarberSession.ts
git commit -m "feat: useBarberSession hook"
```

---

## Task 14: Frontend — Barber Setup Page

**Files:**
- Create: `frontend/src/app/barber/setup/page.tsx`

- [ ] **Step 1: Buat halaman**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBarberSession } from '@/hooks/useBarberSession';
import { saveBarberSetup, uploadBarberAvatar } from '@/lib/barberApi';

async function resizeImage(file: File, maxSize = 400): Promise<string> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = (e) => {
 const img = new Image();
 img.onload = () => {
 const canvas = document.createElement('canvas');
 let w = img.width, h = img.height;
 if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
 else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
 canvas.width = w; canvas.height = h;
 const ctx = canvas.getContext('2d')!;
 ctx.drawImage(img, 0, 0, w, h);
 resolve(canvas.toDataURL('image/jpeg', 0.85));
 };
 img.onerror = reject;
 img.src = e.target?.result as string;
 };
 reader.onerror = reject;
 reader.readAsDataURL(file);
 });
}

export default function BarberSetupPage() {
 const router = useRouter();
 const { data, loading } = useBarberSession();
 const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
 const [targetDaily, setTargetDaily] = useState('10');
 const [targetMonthly, setTargetMonthly] = useState('250');
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState('');

 useEffect(() => {
 if (!loading && !data) router.replace('/barber/login');
 if (!loading && data?.profile?.setup_completed) router.replace('/barber/home');
 }, [data, loading, router]);

 async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
 const file = e.target.files?.[0];
 if (!file) return;
 try {
 const dataUrl = await resizeImage(file);
 setAvatarPreview(dataUrl);
 } catch {
 setError('Gagal proses foto');
 }
 }

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 setError('');
 setSaving(true);
 try {
 let avatarUrl: string | undefined;
 if (avatarPreview) {
 const upRes = await uploadBarberAvatar(avatarPreview);
 avatarUrl = upRes.avatar_url;
 }
 await saveBarberSetup({
 target_daily: Number(targetDaily),
 target_monthly: Number(targetMonthly),
 avatar_url: avatarUrl,
 });
 router.push('/barber/home');
 } catch (e: unknown) {
 setError(e instanceof Error ? e.message : 'Gagal simpan');
 } finally {
 setSaving(false);
 }
 }

 if (loading || !data) return <div className="min-h-screen flex items-center justify-center text-gray-400">Memuat...</div>;

 return (
 <div className="min-h-screen bg-gray-50 p-4">
 <div className="max-w-md mx-auto pt-6">
 <div className="text-center mb-6">
 <h1 className="text-xl font-bold text-gray-900">Halo, {data.barber.name}! </h1>
 <p className="text-sm text-gray-500 mt-1">Mari setup profil kamu</p>
 </div>

 <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 space-y-5 shadow-sm">
 <div>
 <label className="block text-sm text-gray-700 mb-2 font-medium"> Foto Profil</label>
 <div className="flex items-center gap-3">
 <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
 {avatarPreview ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
 ) : (
 <span className="text-3xl"></span>
 )}
 </div>
 <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
 Pilih Foto
 <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
 </label>
 </div>
 <p className="text-xs text-gray-400 mt-1">Max 2MB, otomatis resize ke 400×400</p>
 </div>

 <div>
 <label className="block text-sm text-gray-700 mb-1 font-medium"> Target Harian (customer)</label>
 <input
 type="number"
 min={1}
 value={targetDaily}
 onChange={(e) => setTargetDaily(e.target.value)}
 required
 className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
 />
 </div>

 <div>
 <label className="block text-sm text-gray-700 mb-1 font-medium"> Target Bulanan (customer)</label>
 <input
 type="number"
 min={1}
 value={targetMonthly}
 onChange={(e) => setTargetMonthly(e.target.value)}
 required
 className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
 />
 </div>

 {error && <p className="text-red-500 text-sm">{error}</p>}

 <button
 type="submit"
 disabled={saving}
 className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
 >
 {saving ? 'Menyimpan...' : 'Simpan & Mulai'}
 </button>
 </form>
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/setup/page.tsx
git commit -m "feat: barber setup page (avatar + target)"
```

---

## Task 15: Frontend — Shared Components

**Files:**
- Create: `frontend/src/components/barber/TargetProgressBar.tsx`
- Create: `frontend/src/components/barber/UpcomingBookingCard.tsx`
- Create: `frontend/src/components/barber/StatsGrid.tsx`

- [ ] **Step 1: TargetProgressBar**

```typescript
// frontend/src/components/barber/TargetProgressBar.tsx
interface Props {
 current: number;
 target: number;
 label?: string;
}

export function TargetProgressBar({ current, target, label }: Props) {
 const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
 const reached = current >= target;
 return (
 <div>
 {label && <p className="text-sm text-gray-500 mb-1">{label}</p>}
 <div className="flex items-baseline justify-between mb-1">
 <span className="text-2xl font-bold text-gray-900">{current}</span>
 <span className="text-sm text-gray-500">/ {target}</span>
 </div>
 <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
 <div
 className={`h-full transition-all ${reached ? 'bg-green-500' : 'bg-red-500'}`}
 style={{ width: `${pct}%` }}
 />
 </div>
 </div>
 );
}
```

- [ ] **Step 2: UpcomingBookingCard**

```typescript
// frontend/src/components/barber/UpcomingBookingCard.tsx
import type { Booking } from '@/lib/constants';

function minutesUntil(timeStr: string): number {
 const [h, m] = timeStr.split(':').map(Number);
 const now = new Date();
 const target = new Date(now);
 target.setHours(h, m, 0, 0);
 return Math.round((target.getTime() - now.getTime()) / 60000);
}

interface Props {
 booking: Booking;
}

export function UpcomingBookingCard({ booking }: Props) {
 const mins = minutesUntil(booking.time);
 const label = mins <= 0 ? 'Sekarang' : mins < 60 ? `${mins} menit lagi` : `${Math.round(mins / 60)} jam lagi`;
 return (
 <div className="bg-gradient-to-br from-red-500 to-red-600 text-white rounded-2xl p-4 shadow-sm">
 <p className="text-xs opacity-80 mb-1"> BERIKUTNYA</p>
 <p className="text-lg font-bold">{booking.customer_name}</p>
 <p className="text-sm opacity-90">{booking.service}</p>
 <div className="flex justify-between items-end mt-3">
 <span className="text-2xl font-bold">{booking.time}</span>
 <span className="text-sm opacity-90">{label}</span>
 </div>
 </div>
 );
}
```

- [ ] **Step 3: StatsGrid**

```typescript
// frontend/src/components/barber/StatsGrid.tsx
import type { BarberStats } from '@/lib/barberTypes';

function rupiah(n: number) {
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
 if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
 return String(n);
}

interface Props {
 stats: BarberStats;
}

export function StatsGrid({ stats }: Props) {
 return (
 <div className="grid grid-cols-2 gap-3">
 <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <p className="text-2xl font-bold text-gray-900"> {stats.count}</p>
 <p className="text-xs text-gray-500 mt-1">Customer</p>
 </div>
 <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <p className="text-2xl font-bold text-gray-900"> {rupiah(stats.revenue)}</p>
 <p className="text-xs text-gray-500 mt-1">Revenue</p>
 </div>
 <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <p className="text-2xl font-bold text-gray-900"> {stats.hours}j</p>
 <p className="text-xs text-gray-500 mt-1">Jam Kerja</p>
 </div>
 <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <p className="text-2xl font-bold text-gray-900"> {stats.rating || '-'}</p>
 <p className="text-xs text-gray-500 mt-1">Rating</p>
 </div>
 </div>
 );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/barber/
git commit -m "feat: barber shared components (TargetProgressBar, UpcomingBookingCard, StatsGrid)"
```

---

## Task 16: Frontend — Update Barber Layout (4 Tabs)

**Files:**
- Modify: `frontend/src/app/barber/layout.tsx`

- [ ] **Step 1: Replace seluruh isi file**

```typescript
'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBarberSession } from '@/hooks/useBarberSession';
import { BottomNav } from '@/components/BottomNav';

const BARBER_NAV = [
 { href: '/barber/home', label: 'Home', icon: '' },
 { href: '/barber/schedule', label: 'Jadwal', icon: '' },
 { href: '/barber/progress', label: 'Progress', icon: '' },
 { href: '/barber/profile', label: 'Saya', icon: '' },
];

export default function BarberLayout({ children }: { children: React.ReactNode }) {
 const { data, loading, signOut } = useBarberSession();
 const router = useRouter();
 const pathname = usePathname();

 // Don't apply guards on login or setup pages
 const isPublicBarberPage = pathname === '/barber/login' || pathname === '/barber/setup';

 useEffect(() => {
 if (loading || isPublicBarberPage) return;
 if (!data) {
 router.replace('/barber/login');
 return;
 }
 if (!data.profile?.setup_completed) {
 router.replace('/barber/setup');
 }
 }, [data, loading, router, isPublicBarberPage]);

 if (isPublicBarberPage) {
 return <>{children}</>;
 }

 if (loading) {
 return (
 <div className="min-h-screen bg-gray-50 flex items-center justify-center">
 <div className="text-gray-400">Memuat...</div>
 </div>
 );
 }

 if (!data || !data.profile?.setup_completed) {
 return null;
 }

 return (
 <div className="min-h-screen bg-gray-50 pb-20">
 <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-10">
 <div className="flex items-center gap-3">
 {data.profile.avatar_url ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={data.profile.avatar_url}
 alt=""
 className="w-9 h-9 rounded-full object-cover"
 />
 ) : (
 <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center"></div>
 )}
 <div>
 <h1 className="font-bold text-gray-900">{data.barber.name}</h1>
 <p className="text-xs text-gray-500 capitalize">{data.barber.branch}</p>
 </div>
 </div>
 <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-700">
 Keluar
 </button>
 </header>
 <main>{children}</main>
 <BottomNav items={BARBER_NAV} />
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/layout.tsx
git commit -m "feat: barber layout with 4-tab nav and cookie session guard"
```

---

## Task 17: Frontend — Barber Home Page

**Files:**
- Create: `frontend/src/app/barber/home/page.tsx`

- [ ] **Step 1: Buat halaman**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberStats, fetchBarberUpcoming } from '@/lib/barberApi';
import { BookingCard } from '@/components/BookingCard';
import { TargetProgressBar } from '@/components/barber/TargetProgressBar';
import { UpcomingBookingCard } from '@/components/barber/UpcomingBookingCard';
import type { BarberStats, BarberUpcoming } from '@/lib/barberTypes';

function rupiah(n: number) {
 return new Intl.NumberFormat('id-ID', {
 style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
 }).format(n);
}

function todayLabel() {
 return new Date().toLocaleDateString('id-ID', {
 weekday: 'long', day: 'numeric', month: 'long',
 });
}

function tomorrowLabel() {
 const t = new Date(Date.now() + 24 * 3600 * 1000);
 return t.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function BarberHomePage() {
 const { data: session } = useBarberSession();
 const [stats, setStats] = useState<BarberStats | null>(null);
 const [upcoming, setUpcoming] = useState<BarberUpcoming | null>(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!session) return;
 Promise.all([fetchBarberStats('day'), fetchBarberUpcoming()])
 .then(([s, u]) => {
 setStats(s);
 setUpcoming(u);
 })
 .catch(console.error)
 .finally(() => setLoading(false));
 }, [session]);

 if (loading || !session || !stats || !upcoming) {
 return <div className="p-4 text-center text-gray-400">Memuat...</div>;
 }

 const target = session.profile?.target_daily ?? 10;
 const homeServiceToday = upcoming.today.filter(b => b.type === 'home_service');

 return (
 <div className="p-4 space-y-4">
 <div>
 <p className="text-xs text-gray-500">{todayLabel()}</p>
 <h2 className="text-xl font-bold text-gray-900">Halo, {session.barber.name.split(' ')[0]} </h2>
 </div>

 {/* Target Card */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
 <TargetProgressBar
 current={stats.count}
 target={target}
 label=" Target Hari Ini"
 />
 <div className="flex justify-between text-sm">
 <span className="text-gray-500"> {rupiah(stats.revenue)}</span>
 <span className="text-gray-500"> {stats.hours}j</span>
 </div>
 </div>

 {/* Berikutnya */}
 {upcoming.next && <UpcomingBookingCard booking={upcoming.next} />}

 {/* Home Service Hari Ini */}
 {homeServiceToday.length > 0 && (
 <div className="space-y-2">
 <p className="text-sm font-medium text-gray-700"> Home Service Hari Ini ({homeServiceToday.length})</p>
 {homeServiceToday.map(b => (
 <BookingCard key={b.id} booking={b} />
 ))}
 </div>
 )}

 {/* Besok */}
 {upcoming.tomorrow.length > 0 && (
 <div className="space-y-2">
 <p className="text-sm font-medium text-gray-700"> Besok — {tomorrowLabel()}</p>
 <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 space-y-2">
 {upcoming.tomorrow.slice(0, 5).map(b => (
 <div key={b.id} className="flex justify-between text-sm">
 <span className="text-gray-700">{b.time} — {b.customer_name}</span>
 <span className="text-gray-500">{b.service}</span>
 </div>
 ))}
 {upcoming.tomorrow.length > 5 && (
 <p className="text-xs text-gray-400">+{upcoming.tomorrow.length - 5} booking lainnya</p>
 )}
 </div>
 </div>
 )}

 {upcoming.today.length === 0 && upcoming.tomorrow.length === 0 && (
 <div className="text-center py-10 text-gray-400">
 <p className="text-4xl mb-2"></p>
 <p>Belum ada jadwal hari ini atau besok</p>
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/home/page.tsx
git commit -m "feat: barber home dashboard page"
```

---

## Task 18: Frontend — Extend Schedule Page with Tabs

**Files:**
- Modify: `frontend/src/app/barber/schedule/page.tsx`

- [ ] **Step 1: Replace seluruh isi**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { type Booking } from '@/lib/constants';

type Tab = 'today' | 'tomorrow' | 'week';

function dateForTab(tab: Tab): { from: string; to: string; label: string } {
 const now = new Date();
 function fmt(d: Date) {
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 }
 if (tab === 'today') {
 return { from: fmt(now), to: fmt(now), label: 'Hari Ini' };
 }
 if (tab === 'tomorrow') {
 const t = new Date(now.getTime() + 24*3600*1000);
 return { from: fmt(t), to: fmt(t), label: 'Besok' };
 }
 // week
 const end = new Date(now.getTime() + 6*24*3600*1000);
 return { from: fmt(now), to: fmt(end), label: '7 Hari ke Depan' };
}

export default function SchedulePage() {
 const { data: session } = useBarberSession();
 const [tab, setTab] = useState<Tab>('today');
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [loading, setLoading] = useState(true);

 async function load(barberId: string, currentTab: Tab) {
 setLoading(true);
 const { from, to } = dateForTab(currentTab);
 try {
 if (from === to) {
 const data = await fetchBookings({ date: from, barber_id: barberId });
 setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
 } else {
 // Week range: fetch each day, flatten
 const days: string[] = [];
 let d = new Date(from);
 const endD = new Date(to);
 while (d <= endD) {
 days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
 d = new Date(d.getTime() + 24*3600*1000);
 }
 const all = await Promise.all(
 days.map(date => fetchBookings({ date, barber_id: barberId }).catch(() => []))
 );
 const flat = all.flat();
 flat.sort((a, b) => {
 if (a.date !== b.date) return a.date.localeCompare(b.date);
 return a.time.localeCompare(b.time);
 });
 setBookings(flat);
 }
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }

 useEffect(() => {
 const barberId = session?.barber.id;
 if (!barberId) return;
 load(barberId, tab);

 const supabase = createClient();
 const channel = supabase
 .channel('barber-schedule')
 .on(
 'postgres_changes',
 { event: '*', schema: 'public', table: 'bookings', filter: `barber_id=eq.${barberId}` },
 () => load(barberId, tab)
 )
 .subscribe();

 return () => { supabase.removeChannel(channel); };
 }, [session?.barber.id, tab]);

 const groupedByDate = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
 acc[b.date] = acc[b.date] || [];
 acc[b.date].push(b);
 return acc;
 }, {});

 function dateLabel(dateStr: string) {
 const d = new Date(dateStr + 'T00:00:00');
 return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Jadwal Saya</h2>

 <div className="flex gap-2">
 {(['today', 'tomorrow', 'week'] as Tab[]).map(t => (
 <button
 key={t}
 onClick={() => setTab(t)}
 className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
 tab === t ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
 }`}
 >
 {dateForTab(t).label}
 </button>
 ))}
 </div>

 {loading ? (
 <div className="text-center py-10 text-gray-400">Memuat...</div>
 ) : bookings.length === 0 ? (
 <div className="text-center py-16">
 <p className="text-4xl mb-3"></p>
 <p className="text-gray-500">Belum ada jadwal</p>
 </div>
 ) : tab === 'week' ? (
 <div className="space-y-4">
 {Object.entries(groupedByDate).map(([date, items]) => (
 <div key={date} className="space-y-2">
 <p className="text-sm font-medium text-gray-700">{dateLabel(date)}</p>
 {items.map(b => <BookingCard key={b.id} booking={b} />)}
 </div>
 ))}
 </div>
 ) : (
 <div className="space-y-3">
 {bookings.map(b => <BookingCard key={b.id} booking={b} />)}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/schedule/page.tsx
git commit -m "feat: schedule page with today/tomorrow/week tabs"
```

---

## Task 19: Frontend — Barber Progress Page (Stats + History)

**Files:**
- Create: `frontend/src/app/barber/progress/page.tsx`

- [ ] **Step 1: Buat halaman**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberStats, fetchBarberHistory } from '@/lib/barberApi';
import { StatsGrid } from '@/components/barber/StatsGrid';
import { BookingCard } from '@/components/BookingCard';
import type { BarberStats } from '@/lib/barberTypes';
import type { Booking } from '@/lib/constants';

type Period = 'day' | 'week' | 'month' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
 day: 'Hari Ini',
 week: '7 Hari',
 month: '30 Hari',
 year: '1 Tahun',
};

export default function BarberProgressPage() {
 const { data: session } = useBarberSession();
 const [period, setPeriod] = useState<Period>('month');
 const [stats, setStats] = useState<BarberStats | null>(null);
 const [history, setHistory] = useState<Booking[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!session) return;
 setLoading(true);
 Promise.all([fetchBarberStats(period), fetchBarberHistory(period)])
 .then(([s, h]) => {
 setStats(s);
 setHistory(h.items);
 })
 .catch(console.error)
 .finally(() => setLoading(false));
 }, [session, period]);

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Progress Saya</h2>

 <div className="flex gap-2 overflow-x-auto">
 {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
 <button
 key={p}
 onClick={() => setPeriod(p)}
 className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
 period === p ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
 }`}
 >
 {PERIOD_LABELS[p]}
 </button>
 ))}
 </div>

 {loading || !stats ? (
 <div className="text-center py-10 text-gray-400">Memuat...</div>
 ) : (
 <>
 <StatsGrid stats={stats} />

 <div className="space-y-2 pt-4">
 <p className="text-sm font-medium text-gray-700">
 History Customer ({history.length})
 </p>
 {history.length === 0 ? (
 <div className="text-center py-10 text-gray-400">
 Belum ada history untuk periode ini
 </div>
 ) : (
 <div className="space-y-3">
 {history.map(b => <BookingCard key={b.id} booking={b} />)}
 </div>
 )}
 </div>
 </>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/progress/page.tsx
git commit -m "feat: barber progress page (stats + history per period)"
```

---

## Task 20: Frontend — Barber Profile Page

**Files:**
- Create: `frontend/src/app/barber/profile/page.tsx`

- [ ] **Step 1: Buat halaman**

```typescript
'use client';
import { useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { updateBarberTarget, uploadBarberAvatar } from '@/lib/barberApi';

async function resizeImage(file: File, maxSize = 400): Promise<string> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = (e) => {
 const img = new Image();
 img.onload = () => {
 const canvas = document.createElement('canvas');
 let w = img.width, h = img.height;
 if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
 else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
 canvas.width = w; canvas.height = h;
 canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
 resolve(canvas.toDataURL('image/jpeg', 0.85));
 };
 img.onerror = reject;
 img.src = e.target?.result as string;
 };
 reader.onerror = reject;
 reader.readAsDataURL(file);
 });
}

export default function BarberProfilePage() {
 const { data: session, refresh, signOut } = useBarberSession();
 const [editingTarget, setEditingTarget] = useState(false);
 const [daily, setDaily] = useState('');
 const [monthly, setMonthly] = useState('');
 const [saving, setSaving] = useState(false);
 const [msg, setMsg] = useState('');

 if (!session?.profile) return null;

 async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
 const file = e.target.files?.[0];
 if (!file) return;
 try {
 const dataUrl = await resizeImage(file);
 await uploadBarberAvatar(dataUrl);
 await refresh();
 setMsg('Foto profil diupdate ');
 setTimeout(() => setMsg(''), 2000);
 } catch {
 setMsg('Gagal upload foto');
 }
 }

 async function handleSaveTarget() {
 setSaving(true);
 try {
 await updateBarberTarget(Number(daily), Number(monthly));
 await refresh();
 setEditingTarget(false);
 setMsg('Target diupdate ');
 setTimeout(() => setMsg(''), 2000);
 } catch {
 setMsg('Gagal simpan target');
 } finally {
 setSaving(false);
 }
 }

 function startEditTarget() {
 setDaily(String(session?.profile?.target_daily ?? 10));
 setMonthly(String(session?.profile?.target_monthly ?? 250));
 setEditingTarget(true);
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Saya</h2>

 {/* Profile Card */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4">
 {session.profile.avatar_url ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={session.profile.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
 ) : (
 <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-2xl"></div>
 )}
 <div className="flex-1">
 <p className="font-bold text-gray-900">{session.barber.name}</p>
 <p className="text-sm text-gray-500 capitalize"> {session.barber.branch}</p>
 <p className="text-xs text-gray-400 mt-1">{session.profile.phone}</p>
 </div>
 </div>

 {msg && <p className="text-sm text-green-600">{msg}</p>}

 {/* Target Section */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
 <div className="flex justify-between items-center mb-3">
 <h3 className="font-semibold text-gray-900"> Target</h3>
 {!editingTarget && (
 <button onClick={startEditTarget} className="text-sm text-red-600 hover:underline">
 Ubah
 </button>
 )}
 </div>
 {editingTarget ? (
 <div className="space-y-3">
 <div>
 <label className="text-xs text-gray-500">Harian</label>
 <input
 type="number"
 value={daily}
 onChange={(e) => setDaily(e.target.value)}
 className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
 />
 </div>
 <div>
 <label className="text-xs text-gray-500">Bulanan</label>
 <input
 type="number"
 value={monthly}
 onChange={(e) => setMonthly(e.target.value)}
 className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
 />
 </div>
 <div className="flex gap-2">
 <button
 onClick={handleSaveTarget}
 disabled={saving}
 className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium disabled:opacity-50"
 >
 {saving ? 'Menyimpan...' : 'Simpan'}
 </button>
 <button
 onClick={() => setEditingTarget(false)}
 className="px-4 py-2 border border-gray-200 rounded-lg text-gray-700"
 >
 Batal
 </button>
 </div>
 </div>
 ) : (
 <div className="space-y-1 text-sm">
 <p>Harian: <span className="font-semibold">{session.profile.target_daily} customer</span></p>
 <p>Bulanan: <span className="font-semibold">{session.profile.target_monthly} customer</span></p>
 </div>
 )}
 </div>

 {/* Avatar Upload */}
 <label className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
 <div className="flex items-center justify-between">
 <span className="font-medium text-gray-700"> Ganti Foto Profil</span>
 <span className="text-gray-400">›</span>
 </div>
 <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
 </label>

 {/* Logout */}
 <button
 onClick={signOut}
 className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left font-medium text-red-600 hover:bg-red-50 transition-colors"
 >
 Keluar
 </button>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/profile/page.tsx
git commit -m "feat: barber profile page (avatar update + target edit + logout)"
```

---

## Task 21: Delete Old Barber Pages and Final Testing

**Files:**
- Delete: `frontend/src/app/barber/home-service/` (lama, sudah include di home dashboard)
- Delete: `frontend/src/app/barber/notifications/` (lama, akan digantikan oleh Phase B)

- [ ] **Step 1: Remove pages lama**

```bash
rm -rf "frontend/src/app/barber/home-service"
rm -rf "frontend/src/app/barber/notifications"
```

- [ ] **Step 2: TypeScript check final**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: zero errors.

- [ ] **Step 3: End-to-end test sebagai kapster**

Persiapan data:
1. Pastikan ada minimal 1 row di tabel `barbers` dengan `phone` valid (format 62...) dan `is_active = true`
2. Cek: `SELECT id, name, phone, branch, is_active FROM barbers WHERE is_active = true LIMIT 1;`

Test flow:
1. Buka `http://localhost:3002/barber/login`
2. Input nomor HP yang terdaftar (format 08xxxx atau 62xxxx) → kirim OTP
3. Cek WhatsApp kapster: terima kode 6 digit
4. Input kode → harus redirect ke `/barber/setup`
5. Upload foto, isi target harian + bulanan → simpan
6. Otomatis ke `/barber/home`
7. Cek dashboard: target progress muncul, "berikutnya" muncul kalau ada booking, list home service muncul kalau ada
8. Klik tab Jadwal → coba ganti tab today/tomorrow/week
9. Klik tab Progress → coba ganti periode day/week/month/year, cek stats card + history list
10. Klik tab Saya → coba ubah target, ganti foto, logout
11. Setelah logout → redirect ke `/barber/login`

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove old barber pages, replaced by new dashboard"
```

---

## Ringkasan File

| File | Aksi |
|---|---|
| `server/migrations/005_barber_users.sql` | Baru |
| `server/services/barberOTP.js` | Baru |
| `server/services/barberAuth.js` | Baru |
| `server/routes/barber.js` | Baru |
| `server/index.js` | Modifikasi (wire routes) |
| `frontend/src/lib/barberTypes.ts` | Baru |
| `frontend/src/lib/barberApi.ts` | Baru |
| `frontend/src/hooks/useBarberSession.ts` | Baru |
| `frontend/src/components/barber/TargetProgressBar.tsx` | Baru |
| `frontend/src/components/barber/UpcomingBookingCard.tsx` | Baru |
| `frontend/src/components/barber/StatsGrid.tsx` | Baru |
| `frontend/src/middleware.ts` | Modifikasi |
| `frontend/src/app/barber/login/page.tsx` | Baru |
| `frontend/src/app/barber/setup/page.tsx` | Baru |
| `frontend/src/app/barber/home/page.tsx` | Baru |
| `frontend/src/app/barber/schedule/page.tsx` | Modifikasi |
| `frontend/src/app/barber/progress/page.tsx` | Baru |
| `frontend/src/app/barber/profile/page.tsx` | Baru |
| `frontend/src/app/barber/layout.tsx` | Modifikasi |
| `frontend/src/app/api/barber/auth/otp/send/route.ts` | Baru |
| `frontend/src/app/api/barber/auth/otp/verify/route.ts` | Baru |
| `frontend/src/app/api/barber/auth/logout/route.ts` | Baru |
| `frontend/src/app/api/barber/me/route.ts` | Baru |
| `frontend/src/app/api/barber/setup/route.ts` | Baru |
| `frontend/src/app/api/barber/avatar/upload/route.ts` | Baru |
| `frontend/src/app/api/barber/target/route.ts` | Baru |
| `frontend/src/app/api/barber/stats/route.ts` | Baru |
| `frontend/src/app/api/barber/upcoming/route.ts` | Baru |
| `frontend/src/app/api/barber/history/route.ts` | Baru |
| `frontend/src/app/barber/home-service/` | Hapus |
| `frontend/src/app/barber/notifications/` | Hapus |
