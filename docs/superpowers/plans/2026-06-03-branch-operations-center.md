# Branch Operations Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 7-page operational admin dashboard for branch admins — Command Center, Booking Control, Attendance, Customers, Leaderboard, Schedule, Broadcast.

**Architecture:** Upgrade existing `/admin/*` Next.js pages + new pages. Add `server/routes/adminCrm.js` for all new backend endpoints. All queries branch-scoped. No revenue data exposed to branch_admin. Proxy pattern: Next.js `/app/api/admin/*` → Express with `x-admin-token` header.

**Tech Stack:** Express.js, Supabase (Postgres), Next.js 16 App Router, TypeScript, Tailwind CSS 4, existing `adminAuth` middleware, existing `useUser()` hook.

**Spec:** `docs/superpowers/specs/2026-06-03-admin-crm-dashboard-design.md`

---

## File Map

### Backend (server/)
```
routes/adminCrm.js ← BARU: semua endpoint CRM
index.js ← MODIFY: mount adminCrm routes
```

### Frontend (frontend/src/)
```
lib/adminCrmTypes.ts ← BARU: TypeScript interfaces
lib/adminCrmApi.ts ← BARU: fetch helpers

app/api/admin/crm/
 command-center/route.ts ← BARU proxy
 attendance/route.ts ← BARU proxy
 customers/route.ts ← BARU proxy
 leaderboard/route.ts ← BARU proxy
 broadcast/route.ts ← BARU proxy
 booking/reassign/route.ts ← BARU proxy
 booking/walkin/route.ts ← BARU proxy
 schedule/route.ts ← BARU proxy

app/admin/
 layout.tsx ← MODIFY: nav 7 items
 dashboard/page.tsx ← MODIFY: Command Center
 bookings/page.tsx ← MODIFY: Booking Control + new actions
 barbers/page.tsx ← MODIFY: Attendance tabs
 customers/page.tsx ← BARU
 leaderboard/page.tsx ← BARU
 schedule/page.tsx ← BARU
 broadcast/page.tsx ← BARU
```

---

## Task 1: DB Migration — barber_attendance + Extended Booking Status

**Files:**
- Create: `server/migrations/2026-06-03-branch-ops.sql`

- [ ] **Step 1: Tulis migration SQL**

```sql
-- Extend booking status untuk home service + no-show
ALTER TABLE bookings
 DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
 ADD CONSTRAINT bookings_status_check
 CHECK (status IN (
 'pending','confirmed','done','cancelled',
 'no_show','departed','arrived','in_progress'
 ));

-- Tabel absensi harian barber
CREATE TABLE IF NOT EXISTS barber_attendance (
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 date DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'hadir'
 CHECK (status IN ('hadir','terlambat','izin','sakit','cuti')),
 note TEXT,
 updated_by UUID,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (barber_id, date)
);

GRANT SELECT, INSERT, UPDATE ON barber_attendance TO anon, authenticated;

ALTER TABLE barber_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_all" ON barber_attendance FOR ALL USING (true) WITH CHECK (true);

-- Tabel broadcast log
CREATE TABLE IF NOT EXISTS admin_broadcasts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 branch TEXT NOT NULL,
 sender_id UUID,
 target TEXT NOT NULL DEFAULT 'all', -- 'all' or barber_id
 message TEXT NOT NULL,
 channel TEXT NOT NULL DEFAULT 'push', -- 'push' | 'wa' | 'both'
 sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT ON admin_broadcasts TO anon, authenticated;

ALTER TABLE admin_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts_all" ON admin_broadcasts FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply migration dengan project_id `khcvklzxfohwkyocenaf`, name `branch_ops_schema`.

- [ ] **Step 3: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
 AND table_name IN ('barber_attendance', 'admin_broadcasts');
```
Expected: 2 rows.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/2026-06-03-branch-ops.sql
git commit -m "feat(ops): DB migration — barber_attendance, admin_broadcasts, extend booking status"
```

---

## Task 2: Backend — adminCrm.js Routes

**Files:**
- Create: `server/routes/adminCrm.js`

- [ ] **Step 1: Buat file adminCrm.js**

```javascript
// server/routes/adminCrm.js
'use strict';
const express = require('express');

function localDateStr(d = new Date()) {
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getMonthStart() {
 const now = new Date();
 return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

function createAdminCrmRoutes(supabase, adminAuth) {
 const router = express.Router();

 // ─── COMMAND CENTER ──────────────────────────────────────────
 router.get('/command-center', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const today = localDateStr();

 // Barbers kehadiran hari ini
 const { data: barbers } = await supabase
 .from('barbers')
 .select('id, name, branch')
 .eq('is_active', true)
 .eq('branch', branch);

 const barberIds = (barbers || []).map(b => b.id);

 // Attendance hari ini
 const { data: attendance } = await supabase
 .from('barber_attendance')
 .select('barber_id, status')
 .in('barber_id', barberIds)
 .eq('date', today);

 const attendMap = {};
 for (const a of (attendance || [])) attendMap[a.barber_id] = a.status;

 const hadir = (barbers || []).filter(b =>
 ['hadir','terlambat'].includes(attendMap[b.id])
 );
 const tidakHadir = (barbers || []).filter(b =>
 ['izin','sakit','cuti'].includes(attendMap[b.id])
 );
 const belumCheckIn = (barbers || []).filter(b => !attendMap[b.id]);

 // Booking stats hari ini
 const { data: bookings } = await supabase
 .from('bookings')
 .select('id, status, time, barber_id, name, wa, service, notes')
 .eq('date', today)
 .eq('location', branch);

 const allBookings = bookings || [];
 const pending = allBookings.filter(b => b.status === 'pending');
 const homeServiceActive = allBookings.filter(b =>
 ['departed','arrived','in_progress'].includes(b.status) &&
 (b.notes || '').toUpperCase().includes('HOME SERVICE')
 );

 // Customer counts hari ini per barber
 const { data: countRows } = await supabase
 .from('barber_daily_counts')
 .select('barber_id, count')
 .in('barber_id', barberIds)
 .eq('date', today);
 const countMap = {};
 for (const r of (countRows || [])) countMap[r.barber_id] = r.count;

 // Smart alerts
 const alerts = [];
 const nowHour = new Date().getHours();

 // Alert: barber belum check-in setelah jam 10
 if (nowHour >= 10) {
 for (const b of belumCheckIn) {
 const hasBookingToday = allBookings.some(bk => bk.barber_id === b.id);
 if (hasBookingToday) {
 alerts.push({
 type: 'warning',
 message: `${b.name} belum check-in — ada booking hari ini`,
 });
 }
 }
 }

 // Alert: booking pending > 1 jam
 const oneHourAgo = new Date(Date.now() - 3600000);
 for (const bk of pending) {
 alerts.push({
 type: 'warning',
 message: `Booking ${bk.name} jam ${bk.time} belum di-confirm`,
 });
 }

 // Alert: home service belum berangkat 30 menit sebelum jadwal
 const homePending = allBookings.filter(b =>
 b.status === 'confirmed' &&
 (b.notes || '').toUpperCase().includes('HOME SERVICE')
 );
 for (const bk of homePending) {
 const [h, m] = bk.time.split(':').map(Number);
 const schedMs = new Date().setHours(h, m, 0, 0);
 const diffMin = (schedMs - Date.now()) / 60000;
 if (diffMin <= 30 && diffMin > 0) {
 alerts.push({
 type: 'warning',
 message: `Home service jam ${bk.time} (${bk.name}) — barber belum berangkat`,
 });
 }
 }

 return res.json({
 today,
 barbers: (barbers || []).map(b => ({
 ...b,
 attendance_status: attendMap[b.id] || null,
 today_count: countMap[b.id] || 0,
 })),
 stats: {
 hadir: hadir.length,
 tidak_hadir: tidakHadir.length,
 belum_check_in: belumCheckIn.length,
 booking_today: allBookings.length,
 pending: pending.length,
 home_service_active: homeServiceActive.length,
 },
 home_service: homeServiceActive,
 booking_feed: allBookings
 .filter(b => ['pending','confirmed'].includes(b.status))
 .sort((a, b) => a.time.localeCompare(b.time))
 .slice(0, 10),
 alerts,
 });
 });

 // ─── ATTENDANCE ───────────────────────────────────────────────
 router.get('/attendance', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const date = req.query.date || localDateStr();

 const { data: barbers } = await supabase
 .from('barbers')
 .select('id, name')
 .eq('is_active', true)
 .eq('branch', branch);

 const barberIds = (barbers || []).map(b => b.id);

 const { data: attendance } = await supabase
 .from('barber_attendance')
 .select('barber_id, status, note, updated_at')
 .in('barber_id', barberIds)
 .eq('date', date);

 const attMap = {};
 for (const a of (attendance || [])) attMap[a.barber_id] = a;

 // Count today per barber
 const { data: counts } = await supabase
 .from('barber_daily_counts')
 .select('barber_id, count')
 .in('barber_id', barberIds)
 .eq('date', date);
 const countMap = {};
 for (const c of (counts || [])) countMap[c.barber_id] = c.count;

 return res.json({
 date,
 barbers: (barbers || []).map(b => ({
 ...b,
 attendance: attMap[b.id] || null,
 today_count: countMap[b.id] || 0,
 })),
 });
 });

 router.post('/attendance', adminAuth, async (req, res) => {
 const { barber_id, date, status, note } = req.body;
 if (!barber_id || !date || !status) {
 return res.status(400).json({ error: 'barber_id, date, status required' });
 }

 const { error } = await supabase
 .from('barber_attendance')
 .upsert({ barber_id, date, status, note: note || null, updated_at: new Date().toISOString() },
 { onConflict: 'barber_id,date' });

 if (error) return res.status(500).json({ error: error.message });

 // Jika izin/sakit/cuti → blokir slot hari ini via today-override
 if (['izin','sakit','cuti'].includes(status)) {
 await supabase.from('barber_date_overrides').upsert(
 { barber_id, date, is_off: true },
 { onConflict: 'barber_id,date' }
 );
 } else if (status === 'hadir') {
 // Batal blokir kalau hadir
 await supabase.from('barber_date_overrides')
 .delete().eq('barber_id', barber_id).eq('date', date);
 }

 return res.json({ ok: true });
 });

 router.get('/attendance/history', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const month = req.query.month || localDateStr().slice(0, 7);
 const monthStart = month + '-01';
 const monthEnd = month + '-31';

 const { data: barbers } = await supabase
 .from('barbers').select('id, name').eq('is_active', true).eq('branch', branch);
 const barberIds = (barbers || []).map(b => b.id);

 const { data: rows } = await supabase
 .from('barber_attendance')
 .select('barber_id, date, status')
 .in('barber_id', barberIds)
 .gte('date', monthStart).lte('date', monthEnd);

 return res.json({ barbers, records: rows || [], month });
 });

 // ─── CUSTOMERS ────────────────────────────────────────────────
 router.get('/customers/loyal', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const monthStart = getMonthStart();

 const { data } = await supabase
 .from('bookings')
 .select('customer_id, name, wa, barber_id')
 .eq('location', branch)
 .eq('status', 'done')
 .gte('date', monthStart);

 // Aggregate by customer
 const map = {};
 for (const b of (data || [])) {
 const key = b.wa || b.name;
 if (!map[key]) map[key] = { name: b.name, wa: b.wa, count: 0, barber_id: b.barber_id };
 map[key].count++;
 }

 const loyal = Object.values(map)
 .filter(c => c.count >= 3)
 .sort((a, b) => b.count - a.count)
 .slice(0, 50);

 return res.json({ customers: loyal });
 });

 router.get('/customers/new', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const monthStart = getMonthStart();

 // Customer yang booking pertama kali bulan ini di cabang ini
 const { data } = await supabase
 .from('bookings')
 .select('name, wa, barber_id, service, date, created_at')
 .eq('location', branch)
 .eq('status', 'done')
 .gte('date', monthStart)
 .order('created_at', { ascending: false });

 // Deduplicate by wa — ambil yang pertama kali muncul
 const seen = new Set();
 const newCustomers = [];
 for (const b of (data || [])) {
 const key = b.wa || b.name;
 if (!seen.has(key)) {
 seen.add(key);
 newCustomers.push(b);
 }
 }

 return res.json({ customers: newCustomers.slice(0, 50) });
 });

 router.get('/customers/dormant', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

 // Customer yang pernah datang tapi tidak balik sejak >30 hari
 const { data: recent } = await supabase
 .from('bookings')
 .select('wa, name')
 .eq('location', branch)
 .eq('status', 'done')
 .gte('date', cutoff);
 const recentWa = new Set((recent || []).map(b => b.wa));

 const { data: old } = await supabase
 .from('bookings')
 .select('name, wa, date, barber_id')
 .eq('location', branch)
 .eq('status', 'done')
 .lt('date', cutoff)
 .order('date', { ascending: false });

 const map = {};
 for (const b of (old || [])) {
 if (!recentWa.has(b.wa) && !map[b.wa]) {
 map[b.wa] = b;
 }
 }

 return res.json({ customers: Object.values(map).slice(0, 50) });
 });

 // ─── LEADERBOARD ──────────────────────────────────────────────
 router.get('/leaderboard', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const category = req.query.category || 'customer';
 const monthStart = getMonthStart();
 const today = localDateStr();

 const { data: barbers } = await supabase
 .from('barbers').select('id, name, branch')
 .eq('is_active', true)
 .eq('branch', branch);
 if (!barbers?.length) return res.json({ items: [] });

 const barberIds = barbers.map(b => b.id);

 if (category === 'customer') {
 const { data: counts } = await supabase
 .from('barber_daily_counts').select('barber_id, count')
 .in('barber_id', barberIds)
 .gte('date', monthStart).lte('date', today);

 const map = {};
 for (const r of (counts || [])) map[r.barber_id] = (map[r.barber_id] || 0) + r.count;

 const ranked = barbers
 .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0} customer` }))
 .sort((a, b) => b.score - a.score)
 .map((b, i) => ({ rank: i + 1, ...b }));

 return res.json({ items: ranked, category });
 }

 if (category === 'streak') {
 const { data: streaks } = await supabase
 .from('barber_streaks').select('barber_id, current_streak')
 .in('barber_id', barberIds);

 const map = {};
 for (const r of (streaks || [])) map[r.barber_id] = r.current_streak;

 const ranked = barbers
 .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0} hari` }))
 .sort((a, b) => b.score - a.score)
 .map((b, i) => ({ rank: i + 1, ...b }));

 return res.json({ items: ranked, category });
 }

 if (category === 'home_service') {
 const { data: rows } = await supabase
 .from('bookings').select('barber_id')
 .in('barber_id', barberIds)
 .eq('status', 'done')
 .gte('date', monthStart)
 .ilike('notes', '%HOME SERVICE%');

 const map = {};
 for (const r of (rows || [])) map[r.barber_id] = (map[r.barber_id] || 0) + 1;

 const ranked = barbers
 .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0}x home service` }))
 .sort((a, b) => b.score - a.score)
 .map((b, i) => ({ rank: i + 1, ...b }));

 return res.json({ items: ranked, category });
 }

 return res.status(400).json({ error: 'Unknown category' });
 });

 // ─── BOOKING ACTIONS ──────────────────────────────────────────
 router.post('/booking/reassign', adminAuth, async (req, res) => {
 const { booking_id, new_barber_id } = req.body;
 if (!booking_id || !new_barber_id) {
 return res.status(400).json({ error: 'booking_id and new_barber_id required' });
 }

 const { error } = await supabase
 .from('bookings')
 .update({ barber_id: new_barber_id })
 .eq('id', booking_id);

 if (error) return res.status(500).json({ error: error.message });
 return res.json({ ok: true });
 });

 router.post('/booking/walkin', adminAuth, async (req, res) => {
 const { name, wa, barber_id, service, branch } = req.body;
 if (!barber_id || !service || !branch) {
 return res.status(400).json({ error: 'barber_id, service, branch required' });
 }

 const today = localDateStr();
 const now = new Date();
 const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

 const { data, error } = await supabase
 .from('bookings')
 .insert({
 name: name || 'Walk-in',
 wa: wa || '-',
 barber_id,
 service,
 service_id: 'walk_in',
 date: today,
 time: timeStr,
 location: branch,
 status: 'done',
 notes: 'WALK-IN',
 })
 .select()
 .single();

 if (error) return res.status(500).json({ error: error.message });
 return res.json({ ok: true, booking: data });
 });

 // ─── SCHEDULE / SLOT BLOCK ────────────────────────────────────
 router.post('/schedule/block', adminAuth, async (req, res) => {
 const { barber_id, date, note } = req.body;
 if (!barber_id || !date) return res.status(400).json({ error: 'barber_id, date required' });

 const { error } = await supabase
 .from('barber_date_overrides')
 .upsert({ barber_id, date, is_off: true }, { onConflict: 'barber_id,date' });

 if (error) return res.status(500).json({ error: error.message });
 return res.json({ ok: true });
 });

 router.post('/schedule/unblock', adminAuth, async (req, res) => {
 const { barber_id, date } = req.body;
 if (!barber_id || !date) return res.status(400).json({ error: 'barber_id, date required' });

 await supabase.from('barber_date_overrides')
 .delete().eq('barber_id', barber_id).eq('date', date);

 return res.json({ ok: true });
 });

 router.get('/schedule', adminAuth, async (req, res) => {
 const branch = req.query.branch;
 const weekStart = req.query.week || localDateStr();

 // 7 hari dari weekStart
 const days = [];
 for (let i = 0; i < 7; i++) {
 const d = new Date(weekStart + 'T00:00:00');
 d.setDate(d.getDate() + i);
 days.push(localDateStr(d));
 }

 const { data: barbers } = await supabase
 .from('barbers').select('id, name, work_days')
 .eq('is_active', true).eq('branch', branch);

 const barberIds = (barbers || []).map(b => b.id);

 const { data: overrides } = await supabase
 .from('barber_date_overrides')
 .select('barber_id, date, is_off')
 .in('barber_id', barberIds)
 .in('date', days);

 const overrideMap = {};
 for (const o of (overrides || [])) {
 if (!overrideMap[o.barber_id]) overrideMap[o.barber_id] = {};
 overrideMap[o.barber_id][o.date] = o.is_off;
 }

 return res.json({ barbers, days, overrides: overrideMap });
 });

 // ─── BROADCAST ────────────────────────────────────────────────
 router.post('/broadcast', adminAuth, async (req, res) => {
 const { branch, message, target } = req.body;
 if (!branch || !message) return res.status(400).json({ error: 'branch, message required' });

 // Get barber user IDs for push
 const barberQuery = supabase
 .from('barbers').select('id').eq('is_active', true).eq('branch', branch);

 const { data: branchBarbers } = await barberQuery;
 const barberIds = (branchBarbers || []).map(b => b.id);

 // Get users mapped to barbers
 const { data: barberUsers } = await supabase
 .from('users').select('id, barber_id')
 .in('barber_id', barberIds).eq('role', 'barber');

 // Send push to each
 const { sendPushToUser } = require('../services/webPush');
 let sent = 0;
 for (const u of (barberUsers || [])) {
 try {
 await sendPushToUser(supabase, u.id, {
 title: ' Pengumuman Cabang',
 body: message,
 url: '/barber/home',
 });
 sent++;
 } catch (e) { /* ignore */ }
 }

 // Log broadcast
 await supabase.from('admin_broadcasts').insert({
 branch, message,
 target: target || 'all',
 channel: 'push',
 sent_at: new Date().toISOString(),
 });

 return res.json({ ok: true, sent });
 });

 router.get('/broadcast/log', adminAuth, async (req, res) => {
 const branch = req.query.branch;

 const { data } = await supabase
 .from('admin_broadcasts')
 .select('id, message, target, channel, sent_at')
 .eq('branch', branch)
 .order('sent_at', { ascending: false })
 .limit(20);

 return res.json({ logs: data || [] });
 });

 return router;
}

module.exports = { createAdminCrmRoutes };
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/adminCrm.js
git commit -m "feat(ops): adminCrm.js — command center, attendance, customers, leaderboard, broadcast, schedule"
```

---

## Task 3: Wire adminCrm Routes + Update booking-status

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add require at top of index.js**

Find the line:
```javascript
const { createBarberCronRoutes } = require('./routes/barberCron');
```
Add after it:
```javascript
const { createAdminCrmRoutes } = require('./routes/adminCrm');
```

- [ ] **Step 2: Mount routes**

Find:
```javascript
app.use('/api/cron', createBarberCronRoutes(supabase, adminAuth));
```
Add after:
```javascript
app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
```

- [ ] **Step 3: Update booking-status to allow new statuses**

Find the `POST /api/booking-status` handler. It currently validates status. Make sure it accepts new values — if there's a whitelist, update it. The handler should already work since DB constraint is updated.

If there's a status whitelist in the code, find it and update:
```javascript
const VALID_STATUSES = ['pending','confirmed','done','cancelled','no_show','departed','arrived','in_progress'];
if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
```

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(ops): mount adminCrm routes + extend booking status whitelist"
```

---

## Task 4: TypeScript Types + API Helpers

**Files:**
- Create: `frontend/src/lib/adminCrmTypes.ts`
- Create: `frontend/src/lib/adminCrmApi.ts`

- [ ] **Step 1: Buat adminCrmTypes.ts**

```typescript
// frontend/src/lib/adminCrmTypes.ts

export interface BarberWithStatus {
 id: string;
 name: string;
 branch: string;
 attendance_status: 'hadir' | 'terlambat' | 'izin' | 'sakit' | 'cuti' | null;
 today_count: number;
}

export interface CommandCenterData {
 today: string;
 barbers: BarberWithStatus[];
 stats: {
 hadir: number;
 tidak_hadir: number;
 belum_check_in: number;
 booking_today: number;
 pending: number;
 home_service_active: number;
 };
 home_service: BookingRow[];
 booking_feed: BookingRow[];
 alerts: { type: 'warning' | 'info'; message: string }[];
}

export interface BookingRow {
 id: string;
 name: string;
 wa: string;
 service: string;
 barber_id: string | null;
 time: string;
 date: string;
 status: string;
 notes: string | null;
 location: string;
}

export interface AttendanceData {
 date: string;
 barbers: Array<{
 id: string;
 name: string;
 attendance: { status: string; note: string | null } | null;
 today_count: number;
 }>;
}

export interface CustomerRow {
 name: string;
 wa: string;
 count?: number;
 barber_id?: string;
 date?: string;
 service?: string;
}

export interface LeaderboardItem {
 rank: number;
 id: string;
 name: string;
 branch: string;
 score: number;
 display: string;
}

export interface ScheduleData {
 barbers: Array<{ id: string; name: string; work_days: string[] }>;
 days: string[];
 overrides: Record<string, Record<string, boolean>>;
}

export interface BroadcastLog {
 id: string;
 message: string;
 target: string;
 channel: string;
 sent_at: string;
}
```

- [ ] **Step 2: Buat adminCrmApi.ts**

```typescript
// frontend/src/lib/adminCrmApi.ts

import type {
 CommandCenterData, AttendanceData, CustomerRow,
 LeaderboardItem, ScheduleData, BroadcastLog,
} from './adminCrmTypes';

async function crmFetch<T>(path: string, init?: RequestInit): Promise<T> {
 const res = await fetch(path, {
 headers: { 'Content-Type': 'application/json', ...init?.headers },
 ...init,
 });
 if (!res.ok) {
 const text = await res.text().catch(() => '');
 throw new Error(`CRM API error ${res.status}: ${text}`);
 }
 return res.json();
}

export function fetchCommandCenter(branch: string) {
 return crmFetch<CommandCenterData>(`/api/admin/crm/command-center?branch=${branch}`);
}

export function fetchAttendance(branch: string, date?: string) {
 const q = date ? `&date=${date}` : '';
 return crmFetch<AttendanceData>(`/api/admin/crm/attendance?branch=${branch}${q}`);
}

export function updateAttendance(barber_id: string, date: string, status: string, note?: string) {
 return crmFetch<{ ok: boolean }>('/api/admin/crm/attendance', {
 method: 'POST',
 body: JSON.stringify({ barber_id, date, status, note }),
 });
}

export function fetchAttendanceHistory(branch: string, month: string) {
 return crmFetch<{ barbers: Array<{id: string; name: string}>; records: Array<{barber_id: string; date: string; status: string}>; month: string }>(
 `/api/admin/crm/attendance/history?branch=${branch}&month=${month}`
 );
}

export function fetchLoyalCustomers(branch: string) {
 return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/loyal?branch=${branch}`);
}

export function fetchNewCustomers(branch: string) {
 return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/new?branch=${branch}`);
}

export function fetchDormantCustomers(branch: string) {
 return crmFetch<{ customers: CustomerRow[] }>(`/api/admin/crm/customers/dormant?branch=${branch}`);
}

export function fetchAdminLeaderboard(branch: string, category: 'customer' | 'streak' | 'home_service') {
 return crmFetch<{ items: LeaderboardItem[]; category: string }>(
 `/api/admin/crm/leaderboard?branch=${branch}&category=${category}`
 );
}

export function reassignBooking(booking_id: string, new_barber_id: string) {
 return crmFetch<{ ok: boolean }>('/api/admin/crm/booking/reassign', {
 method: 'POST',
 body: JSON.stringify({ booking_id, new_barber_id }),
 });
}

export function createWalkIn(data: { name?: string; wa?: string; barber_id: string; service: string; branch: string }) {
 return crmFetch<{ ok: boolean }>('/api/admin/crm/booking/walkin', {
 method: 'POST',
 body: JSON.stringify(data),
 });
}

export function fetchSchedule(branch: string, week: string) {
 return crmFetch<ScheduleData>(`/api/admin/crm/schedule?branch=${branch}&week=${week}`);
}

export function blockBarberDate(barber_id: string, date: string) {
 return crmFetch<{ ok: boolean }>('/api/admin/crm/schedule/block', {
 method: 'POST',
 body: JSON.stringify({ barber_id, date }),
 });
}

export function unblockBarberDate(barber_id: string, date: string) {
 return crmFetch<{ ok: boolean }>('/api/admin/crm/schedule/unblock', {
 method: 'POST',
 body: JSON.stringify({ barber_id, date }),
 });
}

export function sendBroadcast(branch: string, message: string, target = 'all') {
 return crmFetch<{ ok: boolean; sent: number }>('/api/admin/crm/broadcast', {
 method: 'POST',
 body: JSON.stringify({ branch, message, target }),
 });
}

export function fetchBroadcastLog(branch: string) {
 return crmFetch<{ logs: BroadcastLog[] }>(`/api/admin/crm/broadcast/log?branch=${branch}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/adminCrmTypes.ts frontend/src/lib/adminCrmApi.ts
git commit -m "feat(ops): TypeScript types + API helpers for admin CRM"
```

---

## Task 5: Next.js Proxy Routes (Batch)

**Files:**
- Create 8 proxy route files in `frontend/src/app/api/admin/crm/`

- [ ] **Step 1: Buat semua proxy routes**

Buat direktori dan file berikut. Semua proxy menggunakan pattern yang sama — forward request ke Express dengan `x-admin-token`.

`frontend/src/app/api/admin/crm/command-center/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/command-center${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/attendance/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/attendance${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/admin/crm/attendance`, {
 method: 'POST',
 headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/attendance/history/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/attendance/history${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/customers/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const segment = searchParams.get('segment') || 'loyal';
 searchParams.delete('segment');
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/customers/${segment}${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/leaderboard/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/leaderboard${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/broadcast/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/broadcast/log${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/admin/crm/broadcast`, {
 method: 'POST',
 headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/booking/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function POST(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const action = searchParams.get('action') || 'reassign';
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/admin/crm/booking/${action}`, {
 method: 'POST',
 headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

`frontend/src/app/api/admin/crm/schedule/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const qs = searchParams.toString();
 const res = await fetch(`${API_URL}/api/admin/crm/schedule${qs ? '?' + qs : ''}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
export async function POST(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const action = searchParams.get('action') || 'block';
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/admin/crm/schedule/${action}`, {
 method: 'POST',
 headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/api/admin/crm/
git commit -m "feat(ops): Next.js proxy routes for admin CRM endpoints"
```

---

## Task 6: Update Layout — Nav 7 Items

**Files:**
- Modify: `frontend/src/app/admin/layout.tsx`

- [ ] **Step 1: Update ADMIN_NAV**

Replace:
```typescript
const ADMIN_NAV = [
 { href: '/admin/dashboard', label: 'Dashboard', icon: '' },
 { href: '/admin/bookings', label: 'Booking', icon: '' },
 { href: '/admin/barbers', label: 'Barber', icon: '' },
];
```

With:
```typescript
const ADMIN_NAV = [
 { href: '/admin/dashboard', label: 'Command', icon: '' },
 { href: '/admin/bookings', label: 'Booking', icon: '' },
 { href: '/admin/barbers', label: 'Absensi', icon: '' },
 { href: '/admin/customers', label: 'Customer', icon: '' },
 { href: '/admin/leaderboard',label: 'Ranking', icon: '' },
 { href: '/admin/schedule', label: 'Jadwal', icon: '' },
 { href: '/admin/broadcast', label: 'Broadcast', icon: '' },
];
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/layout.tsx
git commit -m "feat(ops): admin nav — 7 items for Branch Operations Center"
```

---

## Task 7: Command Center Page

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Replace seluruh isi dashboard/page.tsx**

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchCommandCenter } from '@/lib/adminCrmApi';
import type { CommandCenterData } from '@/lib/adminCrmTypes';

const STATUS_COLORS: Record<string, string> = {
 pending: 'bg-yellow-100 text-yellow-700',
 confirmed: 'bg-blue-100 text-blue-700',
 done: 'bg-green-100 text-green-700',
 cancelled: 'bg-red-100 text-red-700',
 no_show: 'bg-gray-100 text-gray-600',
 departed: 'bg-indigo-100 text-indigo-700',
 arrived: 'bg-cyan-100 text-cyan-700',
 in_progress: 'bg-purple-100 text-purple-700',
};

const HS_NEXT: Record<string, string> = {
 confirmed: 'departed',
 departed: 'arrived',
 arrived: 'in_progress',
 in_progress: 'done',
};

const HS_LABEL: Record<string, string> = {
 confirmed: ' Tandai Berangkat',
 departed: '🟢 Tandai Sampai',
 arrived: ' Mulai Kerjakan',
 in_progress: ' Selesai',
};

export default function CommandCenterPage() {
 const { user } = useUser();
 const [data, setData] = useState<CommandCenterData | null>(null);
 const [loading, setLoading] = useState(true);

 const branch = user?.branch || '';

 const load = useCallback(async () => {
 if (!branch) return;
 const d = await fetchCommandCenter(branch).catch(() => null);
 if (d) setData(d);
 }, [branch]);

 useEffect(() => {
 load().finally(() => setLoading(false));
 const interval = setInterval(load, 30000);
 return () => clearInterval(interval);
 }, [load]);

 async function advanceHsStatus(bookingId: string, nextStatus: string) {
 await fetch('/api/admin/booking-status', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id: bookingId, status: nextStatus }),
 });
 load();
 }

 async function quickAction(bookingId: string, status: string) {
 await fetch('/api/admin/booking-status', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id: bookingId, status }),
 });
 load();
 }

 if (loading) return <div className="p-4 text-center text-gray-400">Memuat...</div>;
 if (!data) return <div className="p-4 text-center text-red-400">Gagal memuat data</div>;

 return (
 <div className="p-4 space-y-4">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-bold text-gray-900 capitalize"> {branch}</h2>
 <p className="text-xs text-gray-400">{data.today}</p>
 </div>

 {/* Smart Alerts */}
 {data.alerts.length > 0 && (
 <div className="space-y-2">
 {data.alerts.map((alert, i) => (
 <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex gap-2 items-start">
 <span className="text-amber-500 text-sm mt-0.5"></span>
 <p className="text-sm text-amber-800">{alert.message}</p>
 </div>
 ))}
 </div>
 )}

 {/* Stat Cards */}
 <div className="grid grid-cols-3 gap-2">
 {[
 { label: 'Hadir', value: data.stats.hadir, color: 'text-green-600' },
 { label: 'Tdk Hadir', value: data.stats.tidak_hadir, color: 'text-red-500' },
 { label: 'Blm Check-in', value: data.stats.belum_check_in, color: 'text-yellow-600' },
 { label: 'Booking', value: data.stats.booking_today, color: 'text-blue-600' },
 { label: 'Pending', value: data.stats.pending, color: 'text-orange-500' },
 { label: 'Home Svc', value: data.stats.home_service_active, color: 'text-purple-600' },
 ].map(s => (
 <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
 <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
 <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
 </div>
 ))}
 </div>

 {/* Home Service Tracker */}
 {data.home_service.length > 0 && (
 <div className="space-y-2">
 <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"> Home Service Aktif</p>
 {data.home_service.map(hs => {
 const next = HS_NEXT[hs.status];
 return (
 <div key={hs.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-semibold text-gray-800 text-sm">{hs.name}</p>
 <p className="text-xs text-gray-400">{hs.time} · {hs.service}</p>
 </div>
 <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[hs.status] || 'bg-gray-100'}`}>
 {hs.status}
 </span>
 </div>
 {next && (
 <button
 onClick={() => advanceHsStatus(hs.id, next)}
 className="w-full py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg"
 >
 {HS_LABEL[hs.status]}
 </button>
 )}
 </div>
 );
 })}
 </div>
 )}

 {/* Booking Feed */}
 {data.booking_feed.length > 0 && (
 <div className="space-y-2">
 <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"> Booking Masuk</p>
 {data.booking_feed.map(bk => (
 <div key={bk.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
 <div className="flex items-center justify-between mb-2">
 <div>
 <p className="font-semibold text-gray-800 text-sm">{bk.name}</p>
 <p className="text-xs text-gray-400">{bk.time} · {bk.service}</p>
 </div>
 <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[bk.status] || 'bg-gray-100'}`}>
 {bk.status}
 </span>
 </div>
 {bk.status === 'pending' && (
 <div className="flex gap-2">
 <button onClick={() => quickAction(bk.id, 'confirmed')}
 className="flex-1 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg">
 Confirm
 </button>
 <button onClick={() => quickAction(bk.id, 'cancelled')}
 className="flex-1 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">
 Cancel
 </button>
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Kapster On-Duty */}
 <div className="space-y-2">
 <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"> Kapster Hari Ini</p>
 <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
 {data.barbers.map(b => (
 <div key={b.id} className="flex items-center justify-between px-4 py-2.5">
 <div className="flex items-center gap-2">
 <span className="text-sm">
 {b.attendance_status === 'hadir' || b.attendance_status === 'terlambat' ? '🟢' :
 b.attendance_status ? '' : ''}
 </span>
 <p className="text-sm font-medium text-gray-700">{b.name}</p>
 </div>
 <div className="flex items-center gap-2">
 {b.attendance_status && (
 <span className="text-[11px] text-gray-400 capitalize">{b.attendance_status}</span>
 )}
 <span className="text-sm font-bold text-gray-600">{b.today_count}</span>
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx
git commit -m "feat(ops): Command Center — smart alerts, home service tracker, booking feed, on-duty"
```

---

## Task 8: Booking Control Page

**Files:**
- Modify: `frontend/src/app/admin/bookings/page.tsx`

- [ ] **Step 1: Replace seluruh isi bookings/page.tsx**

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { reassignBooking, createWalkIn } from '@/lib/adminCrmApi';

const STATUS_COLORS: Record<string, string> = {
 pending: 'bg-yellow-100 text-yellow-700',
 confirmed: 'bg-blue-100 text-blue-700',
 done: 'bg-green-100 text-green-700',
 cancelled: 'bg-red-100 text-red-700',
 no_show: 'bg-gray-100 text-gray-500',
 departed: 'bg-indigo-100 text-indigo-700',
 arrived: 'bg-cyan-100 text-cyan-700',
 in_progress: 'bg-purple-100 text-purple-700',
};

type BookingFilter = { date: string; status: string; type: string };

function today() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function BookingControlPage() {
 const { user } = useUser();
 const branch = user?.branch || '';

 const [bookings, setBookings] = useState<any[]>([]);
 const [barbers, setBarbers] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);
 const [filter, setFilter] = useState<BookingFilter>({ date: today(), status: 'all', type: 'all' });
 const [walkinOpen, setWalkinOpen] = useState(false);
 const [walkinData, setWalkinData] = useState({ name: '', wa: '', barber_id: '', service: '' });
 const [reassignModal, setReassignModal] = useState<{ bookingId: string } | null>(null);

 const load = useCallback(async () => {
 if (!branch) return;
 const params = new URLSearchParams({ location: branch, date: filter.date });
 if (filter.status !== 'all') params.set('status', filter.status);
 const [bkRes, brRes] = await Promise.all([
 fetch(`/api/bookings?${params}`).then(r => r.json()),
 fetch(`/api/barbers?branch=${branch}`).then(r => r.json()),
 ]);
 let bks = bkRes.bookings || bkRes || [];
 if (filter.type !== 'all') {
 if (filter.type === 'home_service') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('HOME SERVICE'));
 else if (filter.type === 'wedding') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('WEDDING'));
 else if (filter.type === 'walk_in') bks = bks.filter((b: any) => (b.notes || '').toUpperCase().includes('WALK-IN'));
 else bks = bks.filter((b: any) => !['HOME SERVICE','WEDDING','WALK-IN'].some(t => (b.notes || '').toUpperCase().includes(t)));
 }
 setBookings(bks.sort((a: any, b: any) => a.time.localeCompare(b.time)));
 setBarbers(brRes.barbers || brRes || []);
 }, [branch, filter]);

 useEffect(() => {
 load().finally(() => setLoading(false));
 }, [load]);

 async function updateStatus(id: string, status: string) {
 await fetch('/api/admin/booking-status', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id, status }),
 });
 load();
 }

 async function doReassign(barber_id: string) {
 if (!reassignModal) return;
 await reassignBooking(reassignModal.bookingId, barber_id);
 setReassignModal(null);
 load();
 }

 async function submitWalkIn() {
 if (!walkinData.barber_id || !walkinData.service) return;
 await createWalkIn({ ...walkinData, branch });
 setWalkinOpen(false);
 setWalkinData({ name: '', wa: '', barber_id: '', service: '' });
 load();
 }

 const isHomeService = (b: any) => (b.notes || '').toUpperCase().includes('HOME SERVICE') || (b.notes || '').toUpperCase().includes('WEDDING');

 return (
 <div className="p-4 space-y-4">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-bold text-gray-900"> Booking Control</h2>
 <button onClick={() => setWalkinOpen(true)}
 className="text-sm font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-lg">
 + Walk-in
 </button>
 </div>

 {/* Filters */}
 <div className="space-y-2">
 <input type="date" value={filter.date}
 onChange={e => setFilter(f => ({ ...f, date: e.target.value }))}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
 <div className="flex gap-2">
 {['all','pending','confirmed','done','cancelled','no_show'].map(s => (
 <button key={s} onClick={() => setFilter(f => ({ ...f, status: s }))}
 className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
 filter.status === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {s === 'all' ? 'Semua' : s}
 </button>
 ))}
 </div>
 <div className="flex gap-2">
 {['all','online','home_service','wedding','walk_in'].map(t => (
 <button key={t} onClick={() => setFilter(f => ({ ...f, type: t }))}
 className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
 filter.type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {t === 'all' ? 'Semua' : t.replace('_',' ')}
 </button>
 ))}
 </div>
 </div>

 {loading ? (
 <p className="text-center text-gray-400">Memuat...</p>
 ) : bookings.length === 0 ? (
 <p className="text-center text-gray-400 py-8">Tidak ada booking</p>
 ) : (
 <div className="space-y-2">
 {bookings.map((bk: any) => (
 <div key={bk.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
 <div className="flex items-start justify-between">
 <div>
 <p className="font-semibold text-gray-800 text-sm">{bk.name}</p>
 <p className="text-xs text-gray-400">{bk.time} · {bk.service}</p>
 {bk.wa && bk.wa !== '-' && <p className="text-xs text-gray-400">{bk.wa}</p>}
 </div>
 <div className="flex flex-col items-end gap-1">
 <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[bk.status] || 'bg-gray-100'}`}>
 {bk.status}
 </span>
 {isHomeService(bk) && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700"></span>}
 </div>
 </div>

 {/* Action buttons */}
 <div className="flex flex-wrap gap-1.5">
 {bk.status === 'pending' && <>
 <button onClick={() => updateStatus(bk.id, 'confirmed')}
 className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg">Confirm</button>
 <button onClick={() => updateStatus(bk.id, 'cancelled')}
 className="px-3 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">Cancel</button>
 <button onClick={() => setReassignModal({ bookingId: bk.id })}
 className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg">Reassign</button>
 </>}
 {bk.status === 'confirmed' && <>
 <button onClick={() => updateStatus(bk.id, 'done')}
 className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg">Done</button>
 <button onClick={() => updateStatus(bk.id, 'no_show')}
 className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg">No-show</button>
 <button onClick={() => updateStatus(bk.id, 'cancelled')}
 className="px-3 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg">Cancel</button>
 {isHomeService(bk) && (
 <button onClick={() => updateStatus(bk.id, 'departed')}
 className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg"> Berangkat</button>
 )}
 </>}
 {bk.status === 'departed' && (
 <button onClick={() => updateStatus(bk.id, 'arrived')}
 className="px-3 py-1 text-xs font-medium bg-cyan-600 text-white rounded-lg">🟢 Sampai</button>
 )}
 {bk.status === 'arrived' && (
 <button onClick={() => updateStatus(bk.id, 'in_progress')}
 className="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded-lg"> Dikerjakan</button>
 )}
 {bk.status === 'in_progress' && (
 <button onClick={() => updateStatus(bk.id, 'done')}
 className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg"> Selesai</button>
 )}
 </div>
 </div>
 ))}
 </div>
 )}

 {/* Walk-in Modal */}
 {walkinOpen && (
 <div className="fixed inset-0 bg-black/50 flex items-end z-50">
 <div className="bg-white rounded-t-2xl w-full p-4 space-y-3">
 <p className="font-bold text-gray-900">+ Walk-in Customer</p>
 <input placeholder="Nama (opsional)" value={walkinData.name}
 onChange={e => setWalkinData(d => ({ ...d, name: e.target.value }))}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
 <input placeholder="No HP (opsional)" value={walkinData.wa}
 onChange={e => setWalkinData(d => ({ ...d, wa: e.target.value }))}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
 <select value={walkinData.barber_id}
 onChange={e => setWalkinData(d => ({ ...d, barber_id: e.target.value }))}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
 <option value="">Pilih Kapster</option>
 {barbers.filter((b: any) => b.branch === branch).map((b: any) => (
 <option key={b.id} value={b.id}>{b.name}</option>
 ))}
 </select>
 <input placeholder="Service (misal: Potong Rambut)" value={walkinData.service}
 onChange={e => setWalkinData(d => ({ ...d, service: e.target.value }))}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
 <div className="flex gap-2">
 <button onClick={() => setWalkinOpen(false)}
 className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Batal</button>
 <button onClick={submitWalkIn}
 className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold">Catat</button>
 </div>
 </div>
 </div>
 )}

 {/* Reassign Modal */}
 {reassignModal && (
 <div className="fixed inset-0 bg-black/50 flex items-end z-50">
 <div className="bg-white rounded-t-2xl w-full p-4 space-y-2 max-h-96 overflow-y-auto">
 <p className="font-bold text-gray-900 mb-3">Pilih Kapster Pengganti</p>
 {barbers.filter((b: any) => b.branch === branch && b.is_active).map((b: any) => (
 <button key={b.id} onClick={() => doReassign(b.id)}
 className="w-full text-left px-4 py-3 bg-gray-50 rounded-xl text-sm font-medium text-gray-700">
 {b.name}
 </button>
 ))}
 <button onClick={() => setReassignModal(null)}
 className="w-full py-2 border border-gray-200 rounded-xl text-sm text-gray-500 mt-2">Batal</button>
 </div>
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/bookings/page.tsx
git commit -m "feat(ops): Booking Control — confirm/cancel/done/reassign/no-show/home-service-pipeline/walk-in"
```

---

## Task 9: Attendance Page

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

- [ ] **Step 1: Replace seluruh isi barbers/page.tsx**

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchAttendance, updateAttendance, fetchAttendanceHistory } from '@/lib/adminCrmApi';
import type { AttendanceData } from '@/lib/adminCrmTypes';

const STATUSES = ['hadir','terlambat','izin','sakit','cuti'] as const;
type AttStatus = typeof STATUSES[number];

const STATUS_COLOR: Record<AttStatus, string> = {
 hadir: 'bg-green-100 text-green-700',
 terlambat: 'bg-yellow-100 text-yellow-700',
 izin: 'bg-blue-100 text-blue-700',
 sakit: 'bg-red-100 text-red-700',
 cuti: 'bg-gray-100 text-gray-600',
};

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function AttendancePage() {
 const { user } = useUser();
 const branch = user?.branch || '';
 const [tab, setTab] = useState<'today'|'history'>('today');
 const [data, setData] = useState<AttendanceData | null>(null);
 const [history, setHistory] = useState<any | null>(null);
 const [loading, setLoading] = useState(true);
 const [updating, setUpdating] = useState<string | null>(null);
 const [month, setMonth] = useState(todayStr().slice(0, 7));

 const loadToday = useCallback(async () => {
 if (!branch) return;
 const d = await fetchAttendance(branch).catch(() => null);
 if (d) setData(d);
 }, [branch]);

 const loadHistory = useCallback(async () => {
 if (!branch) return;
 const d = await fetchAttendanceHistory(branch, month).catch(() => null);
 if (d) setHistory(d);
 }, [branch, month]);

 useEffect(() => {
 if (tab === 'today') loadToday().finally(() => setLoading(false));
 else loadHistory().finally(() => setLoading(false));
 }, [tab, loadToday, loadHistory]);

 async function setStatus(barber_id: string, status: AttStatus) {
 setUpdating(barber_id);
 await updateAttendance(barber_id, todayStr(), status).catch(() => null);
 await loadToday();
 setUpdating(null);
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Absensi Kapster</h2>

 <div className="flex gap-2">
 {(['today','history'] as const).map(t => (
 <button key={t} onClick={() => setTab(t)}
 className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
 tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {t === 'today' ? 'Hari Ini' : 'Riwayat'}
 </button>
 ))}
 </div>

 {tab === 'today' && (
 <>
 {loading ? <p className="text-center text-gray-400">Memuat...</p> :
 !data ? <p className="text-center text-gray-400">Gagal memuat</p> : (
 <div className="space-y-2">
 {data.barbers.map(b => (
 <div key={b.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-semibold text-gray-800">{b.name}</p>
 <p className="text-xs text-gray-400">{b.today_count} customer hari ini</p>
 </div>
 {b.attendance ? (
 <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[b.attendance.status as AttStatus]}`}>
 {b.attendance.status}
 </span>
 ) : (
 <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Belum check-in</span>
 )}
 </div>
 <div className="flex gap-1.5 flex-wrap">
 {STATUSES.map(s => (
 <button key={s} disabled={updating === b.id}
 onClick={() => setStatus(b.id, s)}
 className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-all ${
 b.attendance?.status === s
 ? 'bg-gray-900 text-white border-gray-900'
 : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {s}
 </button>
 ))}
 </div>
 </div>
 ))}
 </div>
 )}
 </>
 )}

 {tab === 'history' && (
 <>
 <input type="month" value={month}
 onChange={e => setMonth(e.target.value)}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
 {loading ? <p className="text-center text-gray-400">Memuat...</p> :
 !history ? <p className="text-center text-gray-400">Gagal memuat</p> : (
 <div className="space-y-2">
 {history.barbers.map((b: any) => {
 const recs = history.records.filter((r: any) => r.barber_id === b.id);
 const counts: Record<string, number> = {};
 for (const r of recs) counts[r.status] = (counts[r.status] || 0) + 1;
 return (
 <div key={b.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
 <p className="font-semibold text-gray-800 mb-2">{b.name}</p>
 <div className="flex gap-3 flex-wrap">
 {Object.entries(counts).map(([s, c]) => (
 <span key={s} className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[s as AttStatus] || 'bg-gray-100 text-gray-600'}`}>
 {s}: {c}
 </span>
 ))}
 {recs.length === 0 && <p className="text-xs text-gray-400">Tidak ada data</p>}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(ops): Attendance — hari ini status + riwayat bulanan"
```

---

## Task 10: Customers Page

**Files:**
- Create: `frontend/src/app/admin/customers/page.tsx`

- [ ] **Step 1: Buat file**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchLoyalCustomers, fetchNewCustomers, fetchDormantCustomers } from '@/lib/adminCrmApi';
import type { CustomerRow } from '@/lib/adminCrmTypes';

type Tab = 'loyal' | 'new' | 'dormant';

const WA_TEMPLATES: Record<Tab, (name: string, branch: string) => string> = {
 loyal: (name, branch) => `Makasih udah setia ke RedBox ${branch}! Kapster favoritmu siap melayani `,
 new: (name, branch) => `Halo ${name}, senang kamu coba RedBox ${branch}! Gimana pengalamannya? `,
 dormant: (name, branch) => `Halo ${name}, sudah lama nih! Yuk balik ke RedBox ${branch} `,
};

function toWaNumber(wa: string) {
 let n = wa.replace(/\D/g, '');
 if (n.startsWith('0')) n = '62' + n.slice(1);
 return n;
}

export default function CustomersPage() {
 const { user } = useUser();
 const branch = user?.branch || '';
 const [tab, setTab] = useState<Tab>('dormant');
 const [customers, setCustomers] = useState<CustomerRow[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!branch) return;
 setLoading(true);
 const fetcher = tab === 'loyal' ? fetchLoyalCustomers :
 tab === 'new' ? fetchNewCustomers : fetchDormantCustomers;
 fetcher(branch)
 .then(r => setCustomers(r.customers))
 .catch(() => setCustomers([]))
 .finally(() => setLoading(false));
 }, [tab, branch]);

 function openWA(c: CustomerRow) {
 const num = toWaNumber(c.wa || '');
 if (!num) return;
 const branchLabel = branch.charAt(0).toUpperCase() + branch.slice(1);
 const msg = WA_TEMPLATES[tab](c.name, branchLabel);
 window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Customer</h2>

 <div className="flex gap-2">
 {([['loyal',' Loyal'],['new','🆕 Baru'],['dormant',' Dormant']] as [Tab,string][]).map(([t,label]) => (
 <button key={t} onClick={() => setTab(t)}
 className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
 tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {label}
 </button>
 ))}
 </div>

 {loading ? (
 <p className="text-center text-gray-400 py-8">Memuat...</p>
 ) : customers.length === 0 ? (
 <p className="text-center text-gray-400 py-8">Tidak ada data</p>
 ) : (
 <div className="space-y-2">
 {customers.map((c, i) => (
 <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
 <div>
 <p className="font-semibold text-gray-800 text-sm">{c.name}</p>
 <p className="text-xs text-gray-400">{c.wa}</p>
 {tab === 'loyal' && c.count && (
 <p className="text-xs text-gray-400">{c.count}x bulan ini</p>
 )}
 {tab === 'dormant' && c.date && (
 <p className="text-xs text-gray-400">Terakhir: {c.date}</p>
 )}
 {tab === 'new' && c.date && (
 <p className="text-xs text-gray-400">Pertama: {c.date}</p>
 )}
 </div>
 {c.wa && c.wa !== '-' && (
 <button onClick={() => openWA(c)}
 className="ml-3 flex-shrink-0 bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
 WA
 </button>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/customers/page.tsx
git commit -m "feat(ops): Customers — Loyal/Baru/Dormant + WA follow-up"
```

---

## Task 11: Leaderboard Admin Page

**Files:**
- Create: `frontend/src/app/admin/leaderboard/page.tsx`

- [ ] **Step 1: Buat file**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchAdminLeaderboard } from '@/lib/adminCrmApi';
import type { LeaderboardItem } from '@/lib/adminCrmTypes';

type Category = 'customer' | 'streak' | 'home_service';

const CATS: { key: Category; label: string; icon: string }[] = [
 { key: 'customer', label: 'Customer', icon: '' },
 { key: 'streak', label: 'Streak', icon: '' },
 { key: 'home_service', label: 'Home Service', icon: '' },
];

const MEDAL = ['','',''];

export default function AdminLeaderboardPage() {
 const { user } = useUser();
 const branch = user?.branch || '';
 const [category, setCategory] = useState<Category>('customer');
 const [items, setItems] = useState<LeaderboardItem[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!branch) return;
 setLoading(true);
 fetchAdminLeaderboard(branch, category)
 .then(r => setItems(r.items))
 .catch(() => setItems([]))
 .finally(() => setLoading(false));
 }, [branch, category]);

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Leaderboard Cabang</h2>

 <div className="flex gap-2">
 {CATS.map(c => (
 <button key={c.key} onClick={() => setCategory(c.key)}
 className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
 category === c.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
 }`}>
 {c.icon} {c.label}
 </button>
 ))}
 </div>

 {loading ? (
 <p className="text-center text-gray-400 py-8">Memuat...</p>
 ) : items.length === 0 ? (
 <p className="text-center text-gray-400 py-8">Tidak ada data</p>
 ) : (
 <div className="space-y-2">
 {items.map(item => (
 <div key={item.id}
 className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
 item.rank <= 3 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'
 }`}>
 <span className="w-7 text-center font-bold">
 {MEDAL[item.rank - 1] ?? <span className="text-sm text-gray-400">#{item.rank}</span>}
 </span>
 <div className="flex-1">
 <p className="font-semibold text-gray-800 text-sm">{item.name}</p>
 </div>
 <span className="text-sm font-bold text-gray-600">{item.display}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/leaderboard/page.tsx
git commit -m "feat(ops): Admin Leaderboard — Customer/Streak/Home Service tabs"
```

---

## Task 12: Schedule Page

**Files:**
- Create: `frontend/src/app/admin/schedule/page.tsx`

- [ ] **Step 1: Buat file**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchSchedule, blockBarberDate, unblockBarberDate } from '@/lib/adminCrmApi';
import type { ScheduleData } from '@/lib/adminCrmTypes';

function mondayOfWeek(dateStr: string) {
 const d = new Date(dateStr + 'T00:00:00');
 const day = d.getDay();
 d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
 return d.toISOString().slice(0, 10);
}

function todayStr() {
 return new Date().toISOString().slice(0, 10);
}

const DAY_LABELS = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];

export default function SchedulePage() {
 const { user } = useUser();
 const branch = user?.branch || '';
 const [week, setWeek] = useState(mondayOfWeek(todayStr()));
 const [data, setData] = useState<ScheduleData | null>(null);
 const [loading, setLoading] = useState(true);

 const load = async () => {
 if (!branch) return;
 const d = await fetchSchedule(branch, week).catch(() => null);
 if (d) setData(d);
 };

 useEffect(() => {
 load().finally(() => setLoading(false));
 }, [branch, week]);

 async function toggleBlock(barber_id: string, date: string, isBlocked: boolean) {
 if (isBlocked) {
 await unblockBarberDate(barber_id, date);
 } else {
 await blockBarberDate(barber_id, date);
 }
 load();
 }

 function prevWeek() {
 const d = new Date(week + 'T00:00:00');
 d.setDate(d.getDate() - 7);
 setWeek(d.toISOString().slice(0, 10));
 }
 function nextWeek() {
 const d = new Date(week + 'T00:00:00');
 d.setDate(d.getDate() + 7);
 setWeek(d.toISOString().slice(0, 10));
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Jadwal Kapster</h2>

 {/* Week navigation */}
 <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-2">
 <button onClick={prevWeek} className="text-gray-500 font-bold px-2">‹</button>
 <p className="text-sm font-semibold text-gray-700">{week}</p>
 <button onClick={nextWeek} className="text-gray-500 font-bold px-2">›</button>
 </div>

 {loading ? (
 <p className="text-center text-gray-400">Memuat...</p>
 ) : !data ? (
 <p className="text-center text-gray-400">Gagal memuat</p>
 ) : (
 <div className="space-y-3">
 {data.barbers.map(barber => (
 <div key={barber.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
 <p className="font-semibold text-gray-800 text-sm mb-2">{barber.name}</p>
 <div className="flex gap-1.5">
 {data.days.map((day, i) => {
 const isBlocked = data.overrides[barber.id]?.[day] === true;
 const dayOfWeek = new Date(day + 'T00:00:00').getDay();
 const workDayMap: Record<string, number> = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
 const isWorkDay = barber.work_days?.some((wd: string) => workDayMap[wd] === dayOfWeek) ?? true;
 return (
 <button
 key={day}
 onClick={() => toggleBlock(barber.id, day, isBlocked)}
 className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
 isBlocked ? 'bg-red-100 text-red-600' :
 !isWorkDay ? 'bg-gray-50 text-gray-300' :
 'bg-green-50 text-green-700'
 }`}
 >
 {DAY_LABELS[i]}
 </button>
 );
 })}
 </div>
 <p className="text-[11px] text-gray-400 mt-1">Tap untuk blokir/buka hari</p>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/schedule/page.tsx
git commit -m "feat(ops): Schedule — kalender mingguan, blokir/buka hari per kapster"
```

---

## Task 13: Broadcast Page

**Files:**
- Create: `frontend/src/app/admin/broadcast/page.tsx`

- [ ] **Step 1: Buat file**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { sendBroadcast, fetchBroadcastLog } from '@/lib/adminCrmApi';
import type { BroadcastLog } from '@/lib/adminCrmTypes';

function timeAgo(iso: string) {
 const diff = (Date.now() - new Date(iso).getTime()) / 1000;
 if (diff < 60) return 'baru saja';
 if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
 if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
 return `${Math.floor(diff / 86400)} hari lalu`;
}

export default function BroadcastPage() {
 const { user } = useUser();
 const branch = user?.branch || '';
 const [message, setMessage] = useState('');
 const [sending, setSending] = useState(false);
 const [result, setResult] = useState<string | null>(null);
 const [logs, setLogs] = useState<BroadcastLog[]>([]);

 const loadLogs = async () => {
 if (!branch) return;
 const r = await fetchBroadcastLog(branch).catch(() => null);
 if (r) setLogs(r.logs);
 };

 useEffect(() => {
 loadLogs();
 }, [branch]);

 async function submit() {
 if (!message.trim() || !branch) return;
 setSending(true);
 setResult(null);
 try {
 const r = await sendBroadcast(branch, message.trim());
 setResult(` Terkirim ke ${r.sent} kapster`);
 setMessage('');
 loadLogs();
 } catch {
 setResult(' Gagal mengirim');
 } finally {
 setSending(false);
 }
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900"> Broadcast ke Kapster</h2>

 <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
 <textarea
 value={message}
 onChange={e => setMessage(e.target.value.slice(0, 300))}
 placeholder="Tulis pengumuman untuk semua kapster cabang..."
 rows={4}
 className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"
 />
 <div className="flex items-center justify-between">
 <p className="text-xs text-gray-400">{message.length}/300</p>
 <button
 onClick={submit}
 disabled={sending || !message.trim()}
 className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
 >
 {sending ? 'Mengirim...' : 'Kirim Push Notif'}
 </button>
 </div>
 {result && <p className="text-sm text-center font-medium text-gray-700">{result}</p>}
 </div>

 {logs.length > 0 && (
 <div className="space-y-2">
 <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Riwayat Broadcast</p>
 {logs.map(log => (
 <div key={log.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
 <p className="text-sm text-gray-800">{log.message}</p>
 <p className="text-[11px] text-gray-400 mt-1">{timeAgo(log.sent_at)} · {log.channel}</p>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/broadcast/page.tsx
git commit -m "feat(ops): Broadcast — kirim push notif ke kapster + riwayat log"
```

---

## Task 14: Deploy

- [ ] **Step 1: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 2: Push ke GitHub**

```bash
cd .. && git push
```

- [ ] **Step 3: Verifikasi Vercel deploy**

Tunggu deploy di `redboxbarbershop.com`. Pastikan tidak ada build error.

- [ ] **Step 4: Test login Asep**

Login dengan `amyusup38@gmail.com` di `redboxbarbershop.com/login`. Pastikan redirect ke `/admin/dashboard` dan semua 7 tab muncul di nav.
