# Barber Card Always Visible — Off-Duty Blocks Slots Only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the CRM barber toggle from permanently setting `is_active = false` to a daily time-slot block, so barber cards remain visible on the booking page even when a barber is off duty today.

**Architecture:** The Next.js admin barbers page currently calls `toggle-active` (permanent). We replace this with `today-override` (date-specific) — writing to `barber_date_overrides` instead of `barbers.is_active`. A new proxy route forwards today-status from the backend to the frontend. `booking.js` and the backend require zero changes.

**Tech Stack:** Next.js App Router (TypeScript), Supabase client, Express backend (already has all required endpoints)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `frontend/src/app/api/admin/barbers-today-status/route.ts` | **Create** | Proxy GET today-status from backend |
| `frontend/src/lib/adminCrmApi.ts` | **Modify** | Add `toggleBarberTodayOverride` function |
| `frontend/src/app/admin/barbers/page.tsx` | **Modify** | Toggle logic, BarberCard props, offTodaySet state |

---

## Task 1: New Frontend Proxy Route — Today Status

**Files:**
- Create: `frontend/src/app/api/admin/barbers-today-status/route.ts`

- [ ] **Step 1: Create the route file**

```ts
// frontend/src/app/api/admin/barbers-today-status/route.ts
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url);
 const date = searchParams.get('date') ?? '';
 const params = date ? `?date=${encodeURIComponent(date)}` : '';
 const res = await fetch(`${API_URL}/api/barbers/today-status${params}`);
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Verify route file is in the right directory**

The file must be at the exact path:
```
frontend/src/app/api/admin/barbers-today-status/route.ts
```

- [ ] **Step 3: Manual test — call the route**

Run dev server (`npm run dev` inside `frontend/`), then in a browser or curl:
```
GET http://localhost:3000/api/admin/barbers-today-status?date=2026-06-05
```
Expected response shape:
```json
{ "date": "2026-06-05", "dayOfWeek": 5, "barbers": [{ "id": "...", "isWorking": true }] }
```
If backend is not running, expect a 500 — that's fine, route wiring is correct.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/admin/barbers-today-status/route.ts
git commit -m "feat(crm): add barbers-today-status proxy route"
```

---

## Task 2: Add `toggleBarberTodayOverride` to adminCrmApi

**Files:**
- Modify: `frontend/src/lib/adminCrmApi.ts:126-131`

- [ ] **Step 1: Add the new function at the end of `adminCrmApi.ts`**

Append after the existing `toggleBarberActive` function (line 131):

```ts
export function toggleBarberTodayOverride(
 id: string,
 available: boolean,
): Promise<{ success?: boolean }> {
 return crmFetch<{ success?: boolean }>(`/api/admin/barber-override/${id}`, {
 method: 'POST',
 body: JSON.stringify({ available }),
 });
}
```

The existing `toggleBarberActive` function stays — do **not** remove it (may be used elsewhere or needed for future permanent deactivation).

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors related to `adminCrmApi.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/adminCrmApi.ts
git commit -m "feat(crm): add toggleBarberTodayOverride to adminCrmApi"
```

---

## Task 3: Update Admin Barbers Page

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

This task rewrites the entire file. The logic changes are in three places:
1. Import line (swap `toggleBarberActive` → `toggleBarberTodayOverride`)
2. `BarberCard` component (add `isOffToday` prop, derive visual state from it)
3. `BarbersPageInner` (add `offTodaySet` state, fetch today-status, update handleToggle)

- [ ] **Step 1: Replace the full file content**

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { toggleBarberTodayOverride } from '@/lib/adminCrmApi';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Scissors, RefreshCw, Calendar } from 'lucide-react';
import { Suspense } from 'react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DAY_KEYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAYS_MAP: Record<string, number> = {
 sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
 minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6,
};

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseWorkDays(raw: unknown): number[] {
 if (!Array.isArray(raw)) return [];
 return (raw as string[])
 .map((d) => DAYS_MAP[String(d).trim().toLowerCase()])
 .filter((n): n is number => n !== undefined);
}

interface BarberRow {
 id: string;
 name: string;
 branch: string;
 is_active: boolean;
 img?: string | null;
 work_days?: unknown;
 today_count: number;
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: {
 on: boolean;
 onChange: (v: boolean) => void;
 disabled?: boolean;
}) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={on}
 disabled={disabled}
 onClick={() => onChange(!on)}
 className="relative flex-shrink-0 focus-visible:outline-none disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
 style={{ width: 44, height: 24 }}
 >
 <motion.div
 animate={{ backgroundColor: on ? '#16a34a' : '#3f1e22' }}
 transition={{ duration: 0.18 }}
 className="absolute inset-0 rounded-full"
 style={{ border: `1px solid ${on ? 'rgba(34,197,94,0.4)' : 'rgba(199,40,32,0.25)'}` }}
 />
 <motion.div
 animate={{ x: on ? 22 : 2 }}
 transition={{ type: 'spring', stiffness: 550, damping: 38 }}
 className="absolute top-[3px] rounded-full bg-white shadow"
 style={{ width: 18, height: 18, left: 0 }}
 />
 </button>
 );
}

// ─── Card ──────────────────────────────────────────────────────────────────────

function BarberCard({ barber, isOffToday, onToggle, toggling, index }: {
 barber: BarberRow;
 isOffToday: boolean;
 onToggle: (id: string, available: boolean) => void;
 toggling: boolean;
 index: number;
}) {
 const workDays = parseWorkDays(barber.work_days);
 const initials = barber.name.trim().slice(0, 2).toUpperCase();
 const isPermanentlyInactive = !barber.is_active;
 const effectivelyOff = isPermanentlyInactive || isOffToday;

 const borderColor = effectivelyOff
 ? 'rgba(199, 40, 32, 0.22)'
 : 'rgba(34, 197, 94, 0.25)';
 const bgColor = effectivelyOff
 ? 'rgba(199, 40, 32, 0.04)'
 : 'rgba(22, 163, 74, 0.04)';
 const dotColor = effectivelyOff ? '#C72820' : '#22c55e';
 const label = isPermanentlyInactive ? 'Nonaktif' : isOffToday ? 'Libur' : 'Aktif';
 const labelColor = effectivelyOff ? '#6B5A5E' : '#4ade80';

 return (
 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
 layout
 className="rounded-2xl overflow-hidden"
 style={{ background: bgColor, border: `1px solid ${borderColor}` }}
 >
 <div className="flex items-center gap-3 px-4 py-3.5">

 {/* Avatar */}
 <div
 className="relative flex-shrink-0 rounded-full overflow-hidden bg-[#1a0e11]"
 style={{ width: 52, height: 52 }}
 >
 {barber.img ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={barber.img}
 alt={barber.name}
 className="w-full h-full object-cover"
 loading="lazy"
 />
 ) : (
 <div
 className="w-full h-full flex items-center justify-center text-sm font-bold"
 style={{ color: '#E87068' }}
 >
 {initials}
 </div>
 )}

 {/* Status dot */}
 <div
 className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
 style={{ background: dotColor, border: '2px solid #070508' }}
 />
 </div>

 {/* Info */}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <p
 className="font-semibold text-[14px] leading-tight capitalize truncate"
 style={{ color: '#F0EAEB' }}
 >
 {barber.name}
 </p>
 {barber.today_count > 0 && (
 <span
 className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
 style={{ background: 'rgba(199,40,32,0.12)', color: '#E87068' }}
 >
 {barber.today_count} hari ini
 </span>
 )}
 </div>

 {/* Working days */}
 {workDays.length > 0 && (
 <div className="flex gap-[3px] mt-2">
 {DAY_KEYS.map((dayLabel, i) => {
 const works = workDays.includes(i);
 return (
 <div
 key={dayLabel}
 className="flex items-center justify-center rounded text-[9px] font-semibold"
 style={{
 width: 24,
 height: 18,
 background: works
 ? effectivelyOff
 ? 'rgba(199,40,32,0.15)'
 : 'rgba(34,197,94,0.15)'
 : 'rgba(255,255,255,0.04)',
 color: works
 ? effectivelyOff ? '#E87068' : '#4ade80'
 : '#2d1f23',
 }}
 >
 {dayLabel}
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* Toggle */}
 <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
 <Toggle
 on={!effectivelyOff}
 onChange={(val) => onToggle(barber.id, val)}
 disabled={toggling || isPermanentlyInactive}
 />
 <span
 className="text-[9px] font-semibold uppercase tracking-wider"
 style={{ color: labelColor }}
 >
 {label}
 </span>
 </div>
 </div>
 </motion.div>
 );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
 return (
 <motion.div
 animate={{ opacity: [0.3, 0.55, 0.3] }}
 transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
 className="rounded-2xl h-[86px]"
 style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.05)' }}
 />
 );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function BarbersPageInner() {
 const { user, loading: userLoading } = useUser();
 const branch = user?.branch ?? '';

 const [barbers, setBarbers] = useState<BarberRow[]>([]);
 const [offTodaySet, setOffTodaySet] = useState<Set<string>>(new Set());
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(false);
 const [toggling, setToggling] = useState<string | null>(null);
 const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

 const loadBarbers = useCallback(async () => {
 if (!branch) return;
 setError(false);

 const supabase = createClient();
 const today = todayStr();

 const [{ data: barberData, error: barberErr }, todayStatusRes] = await Promise.all([
 supabase
 .from('barbers')
 .select('id, name, branch, is_active, img, work_days')
 .eq('branch', branch)
 .order('name'),
 fetch(`/api/admin/barbers-today-status?date=${today}`).catch(() => null),
 ]);

 if (barberErr || !barberData) { setError(true); return; }

 const newOffSet = new Set<string>();
 if (todayStatusRes?.ok) {
 const ts = await todayStatusRes.json().catch(() => null);
 for (const b of ts?.barbers ?? []) {
 if (!b.isWorking) newOffSet.add(String(b.id));
 }
 }
 setOffTodaySet(newOffSet);

 const ids = barberData.map((b) => b.id);
 const { data: bookingData } = await supabase
 .from('bookings')
 .select('barber_id')
 .eq('date', today)
 .neq('status', 'cancelled')
 .in('barber_id', ids);

 const countMap: Record<string, number> = {};
 for (const bk of bookingData ?? []) {
 if (bk.barber_id) countMap[bk.barber_id] = (countMap[bk.barber_id] ?? 0) + 1;
 }

 setBarbers(barberData.map((b) => ({ ...b, today_count: countMap[b.id] ?? 0 })));
 }, [branch]);

 useEffect(() => {
 if (userLoading || !branch) return;
 setLoading(true);
 loadBarbers().finally(() => setLoading(false));
 }, [loadBarbers, userLoading, branch]);

 async function handleToggle(id: string, available: boolean) {
 setToggling(id);
 setOffTodaySet((prev) => {
 const next = new Set(prev);
 if (available) next.delete(id);
 else next.add(id);
 return next;
 });
 const res = await toggleBarberTodayOverride(id, available).catch(() => null);
 if (!res?.success) {
 setOffTodaySet((prev) => {
 const next = new Set(prev);
 if (available) next.add(id);
 else next.delete(id);
 return next;
 });
 }
 setToggling(null);
 }

 const isEffectivelyOff = (b: BarberRow) => !b.is_active || offTodaySet.has(b.id);

 const displayed = barbers.filter((b) =>
 filter === 'all' ? true : filter === 'active' ? !isEffectivelyOff(b) : isEffectivelyOff(b)
 );
 const activeCount = barbers.filter((b) => !isEffectivelyOff(b)).length;
 const inactiveCount = barbers.length - activeCount;

 return (
 <div className="px-4 pt-4 pb-8 space-y-4">

 {/* Header */}
 <div className="flex items-center">
 <Scissors size={14} style={{ color: '#C72820' }} className="mr-2 flex-shrink-0" />
 <h2 className="font-bold text-[15px]" style={{ color: '#F0EAEB' }}>Kapster</h2>

 {!loading && !error && (
 <div className="ml-auto flex items-center gap-3">
 <div className="flex items-center gap-1.5 text-[11px]">
 <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
 <span style={{ color: '#6B5A5E' }}>{activeCount} aktif</span>
 <span style={{ color: '#3D2E32' }}>·</span>
 <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#C72820' }} />
 <span style={{ color: '#6B5A5E' }}>{inactiveCount} off</span>
 </div>
 <button
 onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
 className="p-1 rounded-lg cursor-pointer transition-opacity active:opacity-50"
 style={{ color: '#4A3E40' }}
 >
 <RefreshCw size={12} />
 </button>
 </div>
 )}
 </div>

 {/* Filter */}
 <div className="flex gap-1.5">
 {(['all', 'active', 'inactive'] as const).map((f) => (
 <button
 key={f}
 onClick={() => setFilter(f)}
 className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer active:scale-95"
 style={filter === f
 ? { background: '#C72820', color: '#fff', border: '1px solid #C72820' }
 : { background: 'transparent', color: '#4A3E40', border: '1px solid rgba(255,255,255,0.07)' }
 }
 >
 {f === 'all' ? 'Semua' : f === 'active' ? 'Aktif' : 'Off'}
 </button>
 ))}
 </div>

 {/* Content */}
 <AnimatePresence mode="popLayout">
 {loading ? (
 <motion.div key="skel" className="space-y-2.5">
 {[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}
 </motion.div>
 ) : error ? (
 <motion.div
 key="error"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 className="text-center py-12 space-y-3"
 >
 <Calendar size={28} style={{ color: '#3D2E32', margin: '0 auto' }} />
 <p className="text-[13px]" style={{ color: '#6B5A5E' }}>Gagal memuat data kapster</p>
 <button
 onClick={() => { setLoading(true); loadBarbers().finally(() => setLoading(false)); }}
 className="text-[12px] px-4 py-2 rounded-full cursor-pointer active:scale-95 transition-all"
 style={{ background: 'rgba(199,40,32,0.12)', color: '#E87068', border: '1px solid rgba(199,40,32,0.2)' }}
 >
 Coba lagi
 </button>
 </motion.div>
 ) : displayed.length === 0 ? (
 <motion.p
 key="empty"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 className="text-center text-[13px] py-12"
 style={{ color: '#4A3E40' }}
 >
 Tidak ada kapster
 </motion.p>
 ) : (
 <motion.div key="list" className="space-y-2">
 {displayed.map((b, i) => (
 <BarberCard
 key={b.id}
 barber={b}
 isOffToday={offTodaySet.has(b.id)}
 onToggle={handleToggle}
 toggling={toggling === b.id}
 index={i}
 />
 ))}
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 );
}

export default function BarbersPage() {
 return <Suspense><BarbersPageInner /></Suspense>;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Verify the app builds**

```bash
cd frontend && npm run build
```
Expected: build completes with no errors.

- [ ] **Step 4: Manual test — CRM toggle**

1. Buka `/admin/barbers` di browser
2. Pilih satu kapster yang aktif
3. Toggle ke OFF → card harus langsung berubah ke merah dengan label "Libur", tapi masih muncul
4. Buka `booking.html` di tab baru → kapster tersebut **harus tetap muncul** di daftar card
5. Di booking: pilih kapster tadi → pilih tanggal hari ini → semua slot harus **terblokir / tidak bisa dipilih**
6. Di booking: pilih kapster tadi → pilih tanggal besok → slot **normal tersedia**
7. Kembali ke CRM → toggle ke ON → card kembali hijau "Aktif"
8. Refresh booking.html → slot hari ini normal kembali

- [ ] **Step 5: Manual test — kapster permanen nonaktif (Anggi / Putra)**

1. Buka `/admin/barbers`
2. Anggi dan Putra harus muncul dengan label "Nonaktif" dan toggle **disabled** (tidak bisa diklik)
3. Di `booking.html` → Anggi dan Putra **tidak muncul** di daftar card

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(crm): toggle kapster pakai today-override — card tetap visible di booking"
```

---

## Self-Review Checklist (sudah dijalankan saat menulis plan)

- [x] Spec coverage: semua requirement tercakup — toggle → today-override , card tetap visible , slot diblokir , Anggi/Putra tetap hidden 
- [x] No placeholders: semua step punya kode lengkap
- [x] Type consistency: `toggleBarberTodayOverride(id: string, available: boolean)` konsisten di Task 2 dan Task 3
- [x] `BarberCard` prop `onToggle: (id: string, available: boolean)` konsisten dengan call site di `BarbersPageInner`
- [x] `isOffToday={offTodaySet.has(b.id)}` — correctly derived from `offTodaySet`, not from `barber.is_active`
