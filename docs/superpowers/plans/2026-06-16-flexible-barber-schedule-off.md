# Flexible Barber Schedule Off/On — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin bisa set/batal libur kapster untuk tanggal mana saja (bukan hanya hari ini) via bottom sheet yang terbuka dari long-press atau tap ⋮ pada kartu kapster; sheet juga menampilkan dan membiarkan admin menghapus jadwal libur yang sudah ada.

**Architecture:** Tidak ada endpoint baru — pakai `POST /api/barbers/:id/today-override?date=YYYY-MM-DD` yang sudah ada. Upcoming blocks diambil langsung dari Supabase di frontend saat page load. Semua perubahan UI terpusat di satu file (`page.tsx`), ditambah dua perubahan kecil di `adminCrmApi.ts` dan route proxy.

**Tech Stack:** Next.js App Router, React, TypeScript, Framer Motion (sudah ada), Supabase JS Client (sudah ada), Lucide React (sudah ada).

**Spec:** `docs/superpowers/specs/2026-06-16-flexible-barber-schedule-off-design.md`

---

## File Map

| File | Aksi | Perubahan |
|---|---|---|
| `frontend/src/lib/adminCrmApi.ts` | Modify | Tambah param `date?` ke `toggleBarberTodayOverride` |
| `frontend/src/app/api/admin/barber-override/[id]/route.ts` | Modify | Forward `date` query param ke upstream |
| `frontend/src/app/admin/barbers/page.tsx` | Modify | State baru, `loadBarbers` update, `BarberCard` update, `BarberSheet` baru, handler baru |

---

## Task 1: Extend `toggleBarberTodayOverride` — tambah param `date`

**Files:**
- Modify: `frontend/src/lib/adminCrmApi.ts`

- [ ] **Step 1: Buka file dan temukan fungsi yang akan diubah**

```
frontend/src/lib/adminCrmApi.ts  baris ~137-145
```

Fungsi saat ini:
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

- [ ] **Step 2: Ganti dengan versi yang support param `date`**

```ts
export function toggleBarberTodayOverride(
  id: string,
  available: boolean,
  date?: string,
): Promise<{ success?: boolean }> {
  const path = date
    ? `/api/admin/barber-override/${id}?date=${date}`
    : `/api/admin/barber-override/${id}`;
  return crmFetch<{ success?: boolean }>(path, {
    method: 'POST',
    body: JSON.stringify({ available }),
  });
}
```

- [ ] **Step 3: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep adminCrmApi
```

Expected: tidak ada output (tidak ada error).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/adminCrmApi.ts
git commit -m "feat(barbers): tambah param date ke toggleBarberTodayOverride"
```

---

## Task 2: Forward `date` query param di API route proxy

**Files:**
- Modify: `frontend/src/app/api/admin/barber-override/[id]/route.ts`

- [ ] **Step 1: Ganti isi file dengan versi yang forward `date`**

```ts
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const date = req.nextUrl.searchParams.get('date');
  const upstream = date
    ? `${API_URL}/api/barbers/${id}/today-override?date=${date}`
    : `${API_URL}/api/barbers/${id}/today-override`;
  const res = await fetch(upstream, {
    signal: AbortSignal.timeout(10_000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "barber-override"
```

Expected: tidak ada output.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/api/admin/barber-override/[id]/route.ts"
git commit -m "feat(barbers): forward date query param ke upstream today-override"
```

---

## Task 3: Update `loadBarbers` — fetch upcoming blocks parallel

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

- [ ] **Step 1: Tambah state baru di `BarbersPageInner` (setelah state yang sudah ada)**

Temukan blok state di sekitar baris 226–231:
```ts
const [barbers, setBarbers] = useState<BarberRow[]>([]);
const [offTodaySet, setOffTodaySet] = useState<Set<string>>(new Set());
const [loading, setLoading] = useState(true);
const [error, setError] = useState(false);
const [toggling, setToggling] = useState<string | null>(null);
const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
```

Tambahkan tiga baris baru setelah baris terakhir state:
```ts
const [upcomingBlocksMap, setUpcomingBlocksMap] = useState<Record<string, string[]>>({});
const [activeSheet, setActiveSheet] = useState<BarberRow | null>(null);
const [sheetActionLoading, setSheetActionLoading] = useState(false);
```

- [ ] **Step 2: Tambah fetch upcoming blocks di `loadBarbers`, parallel dengan `bookingData`**

Temukan bagian ini di `loadBarbers` (sekitar baris 263–274):
```ts
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
```

Ganti dengan:
```ts
const ids = barberData.map((b) => b.id);

const [{ data: bookingData }, { data: blocksData }] = await Promise.all([
  supabase
    .from('bookings')
    .select('barber_id')
    .eq('date', today)
    .neq('status', 'cancelled')
    .in('barber_id', ids),
  supabase
    .from('barber_date_overrides')
    .select('barber_id, date')
    .in('barber_id', ids)
    .gte('date', today)
    .eq('is_off', true)
    .order('date', { ascending: true }),
]);

const countMap: Record<string, number> = {};
for (const bk of bookingData ?? []) {
  if (bk.barber_id) countMap[bk.barber_id] = (countMap[bk.barber_id] ?? 0) + 1;
}

const blocksMap: Record<string, string[]> = {};
for (const b of blocksData ?? []) {
  if (!blocksMap[b.barber_id]) blocksMap[b.barber_id] = [];
  blocksMap[b.barber_id].push(b.date);
}
setUpcomingBlocksMap(blocksMap);

setBarbers(barberData.map((b) => ({ ...b, today_count: countMap[b.id] ?? 0 })));
```

- [ ] **Step 3: Reset `upcomingBlocksMap` saat load ulang**

Temukan baris `setOffTodaySet(new Set());` di awal `loadBarbers` (sekitar baris 236), tambahkan satu baris setelahnya:
```ts
setOffTodaySet(new Set());
setUpcomingBlocksMap({});
```

- [ ] **Step 4: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "barbers/page"
```

Expected: tidak ada output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(barbers): fetch upcoming date blocks parallel di loadBarbers"
```

---

## Task 4: Update `BarberCard` — tambah ⋮ button, long-press, badge

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

- [ ] **Step 1: Tambah `useRef` ke import React dan `MoreVertical` ke import lucide**

Baris 2–8 saat ini:
```ts
import { useEffect, useState, useCallback } from 'react';
...
import { Scissors, RefreshCw, Calendar } from 'lucide-react';
```

Ubah menjadi:
```ts
import { useEffect, useState, useCallback, useRef } from 'react';
...
import { Scissors, RefreshCw, Calendar, MoreVertical } from 'lucide-react';
```

- [ ] **Step 2: Tambah props baru ke `BarberCard`**

Temukan interface props `BarberCard` (baris 76–82):
```ts
function BarberCard({ barber, isOffToday, onToggle, toggling, index }: {
  barber: BarberRow;
  isOffToday: boolean;
  onToggle: (id: string, available: boolean) => void;
  toggling: boolean;
  index: number;
}) {
```

Ganti dengan:
```ts
function BarberCard({ barber, isOffToday, onToggle, toggling, index, upcomingCount, onOpenSheet }: {
  barber: BarberRow;
  isOffToday: boolean;
  onToggle: (id: string, available: boolean) => void;
  toggling: boolean;
  index: number;
  upcomingCount: number;
  onOpenSheet: () => void;
}) {
```

- [ ] **Step 3: Tambah long-press ref dan handlers di dalam `BarberCard` (setelah baris `const isPermanentlyInactive`)**

```ts
const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

const handlePointerDown = () => {
  pressTimer.current = setTimeout(() => onOpenSheet(), 500);
};
const handlePointerUp = () => {
  if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
};
```

- [ ] **Step 4: Tambah props long-press ke `motion.div` root card**

Temukan `<motion.div` root card (baris ~99):
```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
  layout
  className="rounded-2xl overflow-hidden"
  style={{ background: bgColor, border: `1px solid ${borderColor}` }}
>
```

Tambahkan event handlers:
```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
  layout
  className="rounded-2xl overflow-hidden"
  style={{ background: bgColor, border: `1px solid ${borderColor}` }}
  onPointerDown={handlePointerDown}
  onPointerUp={handlePointerUp}
  onPointerLeave={handlePointerUp}
>
```

- [ ] **Step 5: Tambah badge upcoming blocks di avatar**

Temukan blok `{/* Status dot */}` di dalam avatar div (baris ~131–135):
```tsx
{/* Status dot */}
<div
  className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
  style={{ background: dotColor, border: '2px solid #070508' }}
/>
```

Tambahkan badge di atasnya (setelah closing `</div>` avatar image/initials, sebelum status dot):
```tsx
{/* Upcoming blocks badge */}
{upcomingCount > 0 && (
  <div
    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
    style={{ background: '#C72820', color: 'white', border: '1.5px solid #070508' }}
  >
    {upcomingCount}
  </div>
)}

{/* Status dot */}
<div
  className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
  style={{ background: dotColor, border: '2px solid #070508' }}
/>
```

- [ ] **Step 6: Tambah baris "N hari libur terjadwal" di bawah nama (di dalam blok `{/* Info */}`)**

Temukan blok `{barber.today_count > 0 && ...}` (baris ~147–154) dan tambahkan setelahnya:
```tsx
{upcomingCount > 0 && (
  <span
    className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
    style={{ background: 'rgba(199,40,32,0.10)', color: '#C72820' }}
  >
    {upcomingCount} libur terjadwal
  </span>
)}
```

- [ ] **Step 7: Tambah tombol ⋮ di sebelah toggle**

Temukan blok `{/* Toggle */}` (baris ~187–200) dan ubah menjadi:
```tsx
{/* Toggle + sheet trigger */}
<div className="flex items-center gap-2 flex-shrink-0">
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onOpenSheet(); }}
    className="flex items-center justify-center rounded-lg cursor-pointer"
    style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#6B5A5E' }}
  >
    <MoreVertical size={14} />
  </button>
  <div className="flex flex-col items-center gap-1.5">
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
```

- [ ] **Step 8: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "barbers/page"
```

Expected: tidak ada output.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(barbers): BarberCard tambah tombol titik-tiga, long-press, badge libur terjadwal"
```

---

## Task 5: Tambah komponen `BarberSheet`

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

- [ ] **Step 1: Tambah komponen `BarberSheet` setelah komponen `Skeleton` (sekitar baris 218)**

Sisipkan sebelum `// ─── Page ───`:

```tsx
// ─── BarberSheet ────────────────────────────────────────────────────────────────

function BarberSheet({ barber, isOffToday, upcomingBlocks, onAction, onClose, actionLoading }: {
  barber: BarberRow;
  isOffToday: boolean;
  upcomingBlocks: string[];
  onAction: (date: string, available: boolean) => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  const [date, setDate] = useState(todayStr());

  return (
    <>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      />
      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl"
        style={{ background: '#1f1215', border: '1px solid rgba(255,255,255,0.07)', maxHeight: '80vh', overflowY: 'auto' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-3 pb-4">
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden"
            style={{ background: '#1a0e11' }}
          >
            {barber.img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={barber.img} alt={barber.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ color: '#E87068' }}>
                {barber.name.trim().slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="font-semibold text-[14px] capitalize" style={{ color: '#F0EAEB' }}>{barber.name}</p>
            <p className="text-[10px]" style={{ color: isOffToday ? '#C72820' : '#4ade80' }}>
              {isOffToday ? '● Libur hari ini' : '● Aktif hari ini'}
            </p>
          </div>
        </div>

        {/* Date picker section */}
        <div className="px-5 pb-4">
          <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-3" style={{ color: '#6B5A5E' }}>Pilih Tanggal</p>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{ background: '#2a1a1e', border: '1px solid rgba(255,255,255,0.1)', color: '#F0EAEB', colorScheme: 'dark' }}
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                disabled={actionLoading || !date}
                onClick={() => onAction(date, false)}
                className="flex-1 rounded-xl py-2.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: '#C72820', color: 'white' }}
              >
                {actionLoading ? '…' : 'Set Libur'}
              </button>
              <button
                type="button"
                disabled={actionLoading || !date}
                onClick={() => onAction(date, true)}
                className="flex-1 rounded-xl py-2.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}
              >
                {actionLoading ? '…' : 'Buka Lagi'}
              </button>
            </div>
          </div>
        </div>

        {/* Upcoming blocks list */}
        <div className="px-5 pb-8">
          <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#6B5A5E' }}>Libur Terjadwal</p>
          {upcomingBlocks.length === 0 ? (
            <p className="text-[11px] text-center py-3" style={{ color: '#3D2E32' }}>Tidak ada jadwal libur ke depan</p>
          ) : (
            <div className="space-y-2">
              {upcomingBlocks.map(d => (
                <div
                  key={d}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'rgba(199,40,32,0.06)', border: '1px solid rgba(199,40,32,0.15)' }}
                >
                  <Calendar size={13} style={{ color: '#C72820', flexShrink: 0 }} />
                  <span className="flex-1 text-[12px]" style={{ color: '#F0EAEB' }}>
                    {new Date(d + 'T12:00:00').toLocaleDateString('id-ID', {
                      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => onAction(d, true)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-[11px] disabled:opacity-40 cursor-pointer"
                    style={{ background: 'rgba(199,40,32,0.15)', border: '1px solid rgba(199,40,32,0.2)', color: '#C72820' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
```

- [ ] **Step 2: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "barbers/page"
```

Expected: tidak ada output.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(barbers): tambah komponen BarberSheet (bottom sheet jadwal libur)"
```

---

## Task 6: Wire up — handler, props ke `BarberCard`, render `BarberSheet`

**Files:**
- Modify: `frontend/src/app/admin/barbers/page.tsx`

- [ ] **Step 1: Tambah `handleBlockAction` di `BarbersPageInner` (setelah `handleToggle`)**

Temukan fungsi `handleToggle` (sekitar baris 285) dan tambahkan sesudahnya:

```ts
async function handleBlockAction(barberId: string, date: string, available: boolean) {
  setSheetActionLoading(true);
  const res = await toggleBarberTodayOverride(barberId, available, date).catch(() => null);
  if (res?.success) {
    setUpcomingBlocksMap(prev => {
      const dates = prev[barberId] ?? [];
      const next = available
        ? dates.filter(d => d !== date)
        : [...dates, date].sort();
      return { ...prev, [barberId]: next };
    });
    if (date === todayStr()) {
      setOffTodaySet(prev => {
        const next = new Set(prev);
        available ? next.delete(barberId) : next.add(barberId);
        return next;
      });
    }
  }
  setSheetActionLoading(false);
}
```

- [ ] **Step 2: Pass props baru ke `BarberCard` di render list (sekitar baris 393–401)**

Temukan:
```tsx
<BarberCard
  key={b.id}
  barber={b}
  isOffToday={offTodaySet.has(b.id)}
  onToggle={handleToggle}
  toggling={toggling === b.id}
  index={i}
/>
```

Ganti dengan:
```tsx
<BarberCard
  key={b.id}
  barber={b}
  isOffToday={offTodaySet.has(b.id)}
  onToggle={handleToggle}
  toggling={toggling === b.id}
  index={i}
  upcomingCount={upcomingBlocksMap[b.id]?.length ?? 0}
  onOpenSheet={() => setActiveSheet(b)}
/>
```

- [ ] **Step 3: Render `BarberSheet` di dalam `return` dari `BarbersPageInner`**

Temukan closing `</div>` paling luar dari return (tepat sebelum `);` penutup fungsi), tambahkan `AnimatePresence` + sheet sebelum closing div:

```tsx
      {/* Bottom sheet jadwal libur */}
      <AnimatePresence>
        {activeSheet && (
          <BarberSheet
            barber={activeSheet}
            isOffToday={offTodaySet.has(activeSheet.id)}
            upcomingBlocks={upcomingBlocksMap[activeSheet.id] ?? []}
            onAction={(date, available) => handleBlockAction(activeSheet.id, date, available)}
            onClose={() => setActiveSheet(null)}
            actionLoading={sheetActionLoading}
          />
        )}
      </AnimatePresence>
    </div>
```

Perhatikan: `<AnimatePresence>` ini **bersarang di dalam** `<div className="px-4 pt-4 pb-8 space-y-4">` yang sudah ada — tempatkan tepat sebelum `</div>` penutup div tersebut.

- [ ] **Step 4: Verifikasi TypeScript tidak error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "barbers/page"
```

Expected: tidak ada output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/barbers/page.tsx
git commit -m "feat(barbers): wire up handleBlockAction dan render BarberSheet di halaman kapster"
```

---

## Task 7: Build check + smoke test manual

- [ ] **Step 1: Build frontend**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` atau `Route (app)` table tanpa error merah.

- [ ] **Step 2: Jalankan dev server**

```bash
cd frontend && npm run dev
```

Buka `http://localhost:3000/admin/barbers?branch=csb` (atau branch yang tersedia).

- [ ] **Step 3: Smoke test — badge**

Kalau ada kapster yang sudah punya `barber_date_overrides` dengan `is_off=true` dan `date >= hari ini`, badge merah harus muncul di avatar-nya dengan angka yang benar.

- [ ] **Step 4: Smoke test — buka sheet via tombol ⋮**

Tap tombol ⋮ di salah satu kartu kapster → bottom sheet harus muncul dari bawah dengan animasi spring. Sheet menampilkan nama kapster, status hari ini, date picker (default hari ini), dan list libur terjadwal.

- [ ] **Step 5: Smoke test — buka sheet via long-press**

Long-press (tahan 0.5 detik) pada card kapster → sheet yang sama harus terbuka.

- [ ] **Step 6: Smoke test — set libur tanggal besok**

1. Buka sheet kapster mana saja
2. Pilih tanggal besok di date picker
3. Tap "Set Libur" → tombol loading sebentar → tanggal besok muncul di list "Libur Terjadwal"
4. Badge di avatar kapster bertambah 1
5. Cek di Supabase dashboard: `barber_date_overrides` harus punya row baru dengan `is_off=true`

- [ ] **Step 7: Smoke test — hapus libur dari list**

1. Buka sheet kapster yang punya jadwal libur
2. Tap ✕ di samping salah satu tanggal
3. Tanggal tersebut hilang dari list
4. Badge berkurang
5. Cek Supabase: row `is_off` harus berubah ke `false` (atau baris baru dengan `is_off=false`)

- [ ] **Step 8: Smoke test — sync dengan toggle hari ini**

1. Set libur untuk hari ini via sheet
2. Tutup sheet → kartu kapster harus berubah merah (LIBUR) — toggle ikut off
3. Buka sheet lagi → tap "Buka Lagi" untuk tanggal hari ini
4. Tutup sheet → kartu kembali hijau (AKTIF)

- [ ] **Step 9: Push ke GitHub**

```bash
git push https://adhit24:<TOKEN>@github.com/adhit24/RedBox-Barbershop.git main
```

Ganti `<TOKEN>` dengan Personal Access Token yang valid. Vercel akan auto-deploy.
