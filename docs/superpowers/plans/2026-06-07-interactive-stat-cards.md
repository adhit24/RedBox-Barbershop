# Interactive Stat Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buat 6 stat card di admin dashboard bisa diklik — menampilkan bottom sheet dengan data detail relevan dan aksi langsung (konfirmasi/batalkan) untuk card Pending, plus Supabase Realtime agar data booking live.

**Architecture:** Semua perubahan di satu file `dashboard/page.tsx`. `StatCard` ditambah props click + active visual. `StatDetailSheet` adalah komponen baru yang render sebagai fixed bottom sheet via `framer-motion`. Supabase Realtime subscribe ke tabel `bookings` per branch, memanggil `load(true)` saat INSERT/UPDATE.

**Tech Stack:** Next.js App Router, React, framer-motion (sudah ada), Supabase Realtime (`@supabase/supabase-js`), Tailwind CSS.

---

## File Structure

Hanya satu file yang diubah:

| File | Perubahan |
|---|---|
| `frontend/src/app/admin/dashboard/page.tsx` | Update `StatCard`, tambah `StatDetailSheet`, tambah state `activeCard` + `live`, wiring onClick, tambah Supabase Realtime subscription |

---

### Task 1: Update StatCard — tambah click + active visual

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx:57-69`

- [ ] **Step 1: Ganti definisi `StatCard` dengan versi yang support click + active state**

Cari blok ini (baris ~57):
```tsx
function StatCard({ label, value, color, index }: { label: string; value: number; color: string; index: number }) {
 return (
 <motion.div
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl p-3 text-center"
 >
 <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
 <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{label}</p>
 </motion.div>
 );
}
```

Ganti dengan:
```tsx
function StatCard({
 label, value, color, index, onClick, isActive, accentColor,
}: {
 label: string; value: number; color: string; index: number;
 onClick?: () => void; isActive?: boolean; accentColor?: string;
}) {
 return (
 <motion.div
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
 onClick={onClick}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl p-3 text-center relative cursor-pointer active:scale-95 transition-all select-none"
 style={{ borderColor: isActive && accentColor ? accentColor : undefined }}
 >
 <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
 <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{label}</p>
 {isActive && accentColor && (
 <span
 className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full"
 style={{ background: accentColor }}
 />
 )}
 </motion.div>
 );
}
```

- [ ] **Step 2: Verify tidak ada TypeScript error**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep dashboard
```
Expected: tidak ada output (tidak ada error di dashboard).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx
git commit -m "feat(dashboard): StatCard support click + active visual state"
```

---

### Task 2: Tambah activeCard state + update stats array + wire clicks

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx` (bagian state + stats array + grid render)

- [ ] **Step 1: Tambah import `useRef` dan `createClient`**

Cari baris import paling atas:
```tsx
import { useEffect, useState, useCallback } from 'react';
```
Ganti dengan:
```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
```

Tambahkan setelah semua import yang ada (sebelum `const STATUS_META`):
```tsx
import { createClient } from '@/utils/supabase/client';
```

- [ ] **Step 2: Tambah state `activeCard` dan `live` di `CommandCenterPageInner`**

Cari baris (dalam `CommandCenterPageInner`):
```tsx
 const [refreshing, setRefreshing] = useState(false);
 const branch = user?.branch || '';
```
Ganti dengan:
```tsx
 const [refreshing, setRefreshing] = useState(false);
 const [activeCard, setActiveCard] = useState<string | null>(null);
 const [live, setLive] = useState(false);
 const loadRef = useRef<(silent?: boolean) => void>(() => {});
 const branch = user?.branch || '';
```

- [ ] **Step 3: Tambah loadRef sync + handleCardClick setelah fungsi `load`**

Cari (dalam `CommandCenterPageInner`):
```tsx
 useEffect(() => {
 load();
 const iv = setInterval(() => load(true), 30000);
 return () => clearInterval(iv);
 }, [load]);
```
Tambahkan DI ATAS useEffect tersebut:
```tsx
 useEffect(() => { loadRef.current = load; }, [load]);

 function handleCardClick(type: string) {
 setActiveCard(prev => prev === type ? null : type);
 }
```

- [ ] **Step 4: Update stats array — tambah `type` dan `accentColor`**

Cari blok (dalam `CommandCenterPageInner`):
```tsx
 const stats = [
 { label: 'Hadir', value: data.stats.hadir, color: 'text-green-400' },
 { label: 'Tdk Hadir', value: data.stats.tidak_hadir, color: 'text-red-400' },
 { label: 'Blm Check-in', value: data.stats.belum_check_in, color: 'text-amber-400' },
 { label: 'Booking', value: data.stats.booking_today, color: 'text-blue-400' },
 { label: 'Pending', value: data.stats.pending, color: 'text-orange-400' },
 { label: 'GoShow', value: data.stats.moka_open_bills ?? 0, color: 'text-teal-400' },
 ];
```
Ganti dengan:
```tsx
 const stats = [
 { label: 'Hadir', value: data.stats.hadir, color: 'text-green-400', type: 'hadir', accentColor: '#4ade80' },
 { label: 'Tdk Hadir', value: data.stats.tidak_hadir, color: 'text-red-400', type: 'tidak_hadir', accentColor: '#f87171' },
 { label: 'Blm Check-in', value: data.stats.belum_check_in, color: 'text-amber-400', type: 'belum_checkin', accentColor: '#fbbf24' },
 { label: 'Booking', value: data.stats.booking_today, color: 'text-blue-400', type: 'booking', accentColor: '#60a5fa' },
 { label: 'Pending', value: data.stats.pending, color: 'text-orange-400', type: 'pending', accentColor: '#fb923c' },
 { label: 'GoShow', value: data.stats.moka_open_bills ?? 0, color: 'text-teal-400', type: 'goshow', accentColor: '#2dd4bf' },
 ];
```

- [ ] **Step 5: Wire onClick ke grid StatCard**

Cari:
```tsx
 {/* Stats */}
 <div className="grid grid-cols-3 gap-2">
 {stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
 </div>
```
Ganti dengan:
```tsx
 {/* Stats */}
 <div className="grid grid-cols-3 gap-2">
 {stats.map((s, i) => (
 <StatCard
 key={s.label}
 {...s}
 index={i}
 isActive={activeCard === s.type}
 onClick={() => handleCardClick(s.type)}
 />
 ))}
 </div>
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep dashboard
```
Expected: tidak ada output.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx
git commit -m "feat(dashboard): tambah activeCard state + wire click ke 6 stat cards"
```

---

### Task 3: Tambah StatDetailSheet component + render di page

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Tambah type alias `SheetType` dan komponen `StatDetailSheet` sebelum fungsi `CommandCenterPageInner`**

Tambahkan blok berikut tepat sebelum baris `function CommandCenterPageInner()`:

```tsx
type SheetType = 'hadir' | 'tidak_hadir' | 'belum_checkin' | 'booking' | 'pending' | 'goshow';

const SHEET_TITLES: Record<SheetType, string> = {
 hadir: 'Kapster Hadir',
 tidak_hadir: 'Tidak Hadir',
 belum_checkin: 'Belum Check-in',
 booking: 'Booking Hari Ini',
 pending: 'Menunggu Konfirmasi',
 goshow: 'GoShow Moka',
};

function StatDetailSheet({
 type, data, onAction, onClose,
}: {
 type: SheetType;
 data: CommandCenterData;
 onAction: (id: string, status: string) => Promise<void>;
 onClose: () => void;
}) {
 const [acting, setActing] = useState<string | null>(null);

 async function handleAction(id: string, status: string) {
 setActing(id + status);
 await onAction(id, status);
 setActing(null);
 }

 function getRows(): unknown[] {
 switch (type) {
 case 'hadir':
 return data.barbers.filter(b => b.attendance_status === 'hadir' || b.attendance_status === 'terlambat');
 case 'tidak_hadir':
 return data.barbers.filter(b => b.attendance_status && b.attendance_status !== 'hadir' && b.attendance_status !== 'terlambat');
 case 'belum_checkin':
 return data.barbers.filter(b => !b.attendance_status);
 case 'booking':
 return data.booking_feed;
 case 'pending':
 return data.booking_feed.filter(b => b.status === 'pending');
 case 'goshow':
 return data.moka_open_bills;
 }
 }

 const rows = getRows();

 function renderRow(row: unknown, i: number) {
 if (type === 'hadir' || type === 'tidak_hadir' || type === 'belum_checkin') {
 const b = row as import('@/lib/adminCrmTypes').BarberWithStatus;
 const badge =
 b.attendance_status === 'hadir' ? { label: 'Hadir', cls: 'bg-green-500/15 text-green-400 border-green-500/30' } :
 b.attendance_status === 'terlambat' ? { label: 'Terlambat', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' } :
 b.attendance_status ? { label: b.attendance_status, cls: 'bg-red-500/15 text-red-400 border-red-500/30' } :
 { label: 'Menunggu', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
 return (
 <div key={b.id} className={`flex items-center justify-between py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
 <div>
 <p className="text-sm font-semibold text-white">{b.name}</p>
 <p className="text-xs text-slate-500 mt-0.5">
 {b.attendance_status ? `Check-in · ${b.today_count} customer` : 'Shift hari ini, belum absen'}
 </p>
 </div>
 <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>{badge.label}</span>
 </div>
 );
 }

 if (type === 'booking' || type === 'pending') {
 const bk = row as import('@/lib/adminCrmTypes').BookingRow;
 const isPending = bk.status === 'pending';
 return (
 <div key={bk.id} className={`py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <p className="text-sm font-semibold text-white truncate">{bk.name}</p>
 <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
 </div>
 <StatusBadge status={bk.status} />
 </div>
 {isPending && (
 <div className="flex gap-2 mt-2">
 <button
 onClick={() => handleAction(bk.id, 'confirmed')}
 disabled={acting !== null}
 className="flex-1 h-8 text-xs font-bold bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl hover:bg-green-500/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
 >
 {acting === bk.id + 'confirmed' ? '...' : ' Konfirmasi'}
 </button>
 <button
 onClick={() => handleAction(bk.id, 'cancelled')}
 disabled={acting !== null}
 className="flex-1 h-8 text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
 >
 {acting === bk.id + 'cancelled' ? '...' : ' Batalkan'}
 </button>
 </div>
 )}
 </div>
 );
 }

 if (type === 'goshow') {
 const bill = row as import('@/lib/adminCrmTypes').MokaOpenBill;
 return (
 <div key={bill.id} className={`flex items-center justify-between py-2.5 ${i > 0 ? 'border-t border-slate-800/60' : ''}`}>
 <div className="min-w-0">
 <p className="text-sm font-semibold text-white truncate">{bill.service_name}</p>
 <p className="text-xs text-slate-500 mt-0.5">{bill.time} · {bill.barber_name}</p>
 </div>
 {bill.unassigned
 ? <span className="text-[11px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Unassigned</span>
 : <span className="text-[11px] bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Open</span>
 }
 </div>
 );
 }

 return null;
 }

 return (
 <>
 {/* Backdrop */}
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.25 }}
 className="fixed inset-0 bg-black/50 z-40"
 onClick={onClose}
 />
 {/* Sheet */}
 <motion.div
 initial={{ y: '100%' }}
 animate={{ y: 0 }}
 exit={{ y: '100%' }}
 transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
 className="fixed bottom-0 left-0 right-0 z-50 bg-[#111827] border-t-2 border-slate-800 rounded-t-2xl max-h-[70vh] flex flex-col"
 >
 {/* Drag handle — tap to close */}
 <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer" onClick={onClose}>
 <div className="w-8 h-1 rounded-full bg-slate-700" />
 </div>
 {/* Title */}
 <div className="px-4 pt-1 pb-2 flex-shrink-0">
 <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
 {SHEET_TITLES[type]} ({rows.length})
 </p>
 </div>
 {/* Rows */}
 <div className="overflow-y-auto px-4 pb-8">
 {rows.length === 0
 ? <p className="text-slate-600 text-sm text-center py-10">Belum ada data</p>
 : rows.map((row, i) => renderRow(row, i))
 }
 </div>
 </motion.div>
 </>
 );
}
```

- [ ] **Step 2: Tambah `StatusBadge` import dari bookingStatus**

Cek apakah `StatusBadge` sudah diimport di dashboard. Kalau tidak ada, tambahkan definisi lokal `StatusBadge` yang sudah ada di baris 35–43 pada file (sudah ada — tidak perlu import).

Setelah menambahkan `StatDetailSheet`, pastikan `STATUS_META` dan `StatusBadge` sudah ada di atas `StatDetailSheet` dalam file. Urutan yang benar:
1. `STATUS_META` (baris ~17)
2. `StatusBadge` (baris ~35)
3. `Skeleton` (baris ~45)
4. `StatCard` (baris ~57)
5. `BookingCard` (baris ~73)
6. `HomeServiceCard` (baris ~114)
7. `MokaCard` (baris ~153)
8. `SheetType` type alias ← **tambah di sini**
9. `SHEET_TITLES` ← **tambah di sini**
10. `StatDetailSheet` ← **tambah di sini**
11. `CommandCenterPageInner` (baris ~179)

- [ ] **Step 3: Render `StatDetailSheet` di dalam `CommandCenterPageInner`**

Cari di bagian return dari `CommandCenterPageInner`:
```tsx
 </div>
 );
}

export default function CommandCenterPage() {
```

Tepat sebelum `</div>` penutup terakhir (setelah section Kapster), tambahkan:
```tsx
 {/* Bottom Sheet */}
 <AnimatePresence>
 {activeCard && data && (
 <StatDetailSheet
 type={activeCard as SheetType}
 data={data}
 onAction={async (id, status) => {
 await fetch('/api/admin/booking-status', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id, status }),
 });
 load(true);
 }}
 onClose={() => setActiveCard(null)}
 />
 )}
 </AnimatePresence>
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep dashboard
```
Expected: tidak ada output.

- [ ] **Step 5: Test manual di browser**

```bash
cd frontend && npm run dev
```

Buka `http://localhost:3000/admin/dashboard`.
- Klik card **Booking** → sheet muncul dari bawah 
- Klik card yang sama → sheet tutup 
- Klik card lain → konten berganti 
- Tap backdrop → sheet tutup 
- Card count 0 → sheet tampil "Belum ada data" 

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx
git commit -m "feat(dashboard): tambah StatDetailSheet — bottom sheet untuk 6 stat cards"
```

---

### Task 4: Tambah Supabase Realtime + indikator LIVE

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Tambah Supabase Realtime subscription setelah useEffect polling**

Cari (dalam `CommandCenterPageInner`):
```tsx
 useEffect(() => {
 load();
 const iv = setInterval(() => load(true), 30000);
 return () => clearInterval(iv);
 }, [load]);
```

Tambahkan tepat setelah blok tersebut:
```tsx
 // Supabase Realtime — booking INSERT/UPDATE per branch
 useEffect(() => {
 if (!branch) return;
 const supabase = createClient();
 const ch = supabase
 .channel(`dashboard-bookings-${branch}`)
 .on('postgres_changes',
 { event: 'INSERT', schema: 'public', table: 'bookings', filter: `location=eq.${branch}` },
 () => loadRef.current(true)
 )
 .on('postgres_changes',
 { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `location=eq.${branch}` },
 () => loadRef.current(true)
 )
 .subscribe(status => setLive(status === 'SUBSCRIBED'));
 return () => { supabase.removeChannel(ch); };
 }, [branch]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Tambah indikator LIVE di title row**

Cari blok title row:
```tsx
 {/* Title row */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-white font-bold text-base capitalize">{branch}</h2>
 <p className="text-[11px] text-slate-500">{data.today}</p>
 </div>
 <button
 onClick={() => load(true)}
 className="p-2 rounded-xl bg-slate-800 text-slate-400 active:scale-95 transition-all cursor-pointer"
 aria-label="Refresh"
 >
 <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
 </button>
 </div>
```

Ganti dengan:
```tsx
 {/* Title row */}
 <div className="flex items-center justify-between">
 <div>
 <div className="flex items-center gap-2">
 <h2 className="text-white font-bold text-base capitalize">{branch}</h2>
 {live && (
 <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400">
 <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
 LIVE
 </span>
 )}
 </div>
 <p className="text-[11px] text-slate-500">{data.today}</p>
 </div>
 <button
 onClick={() => load(true)}
 className="p-2 rounded-xl bg-slate-800 text-slate-400 active:scale-95 transition-all cursor-pointer"
 aria-label="Refresh"
 >
 <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
 </button>
 </div>
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep dashboard
```
Expected: tidak ada output.

- [ ] **Step 4: Test Realtime di browser**

1. Buka `http://localhost:3000/admin/dashboard`
2. Pastikan indikator `● LIVE` muncul di header dalam ~2 detik
3. Dari tab lain, buat booking baru ke Supabase (atau gunakan Supabase table editor untuk insert row ke `bookings` dengan `location` yang sama)
4. Pastikan angka card Booking dan Pending update otomatis tanpa refresh manual

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx
git commit -m "feat(dashboard): Supabase Realtime booking + indikator LIVE di header"
```

---

### Task 5: Deploy ke Vercel

**Files:**
- Push ke GitHub main branch

- [ ] **Step 1: Push ke GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Verify deployment**

Buka Vercel dashboard → project `redbox-frontend` → deployment terbaru status `READY`.

- [ ] **Step 3: Smoke test di production**

Buka `https://admin.redboxbarbershop.com/admin/dashboard` di HP.
- Pastikan semua 6 card bisa diklik
- Pastikan bottom sheet muncul smooth
- Pastikan indikator `● LIVE` muncul
- Pastikan card Pending menampilkan tombol Konfirmasi/Batalkan
