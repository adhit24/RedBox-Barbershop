# Booking Calendar Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah tab "Tabel | Kalender" di halaman `/admin/bookings`, hapus halaman broadcast dan schedule, dan hapus item Broadcast dari nav.

**Architecture:** CalendarView dibuat sebagai komponen terpisah di `bookings/CalendarView.tsx` agar `bookings/page.tsx` tidak terlalu besar. Parent page mengelola tab state dan meneruskan `branch` + `barbers` sebagai props ke CalendarView. CalendarView memiliki internal cache (`Map<string, BookingRow[]>`) untuk menyimpan hasil fetch per-hari sehingga tidak fetch ulang saat hari yang sama diklik kembali.

**Tech Stack:** Next.js App Router, TypeScript, Framer Motion, Tailwind CSS, `next/navigation`

---

## File Structure

| Action | Path | Tanggung jawab |
|--------|------|----------------|
| **Hapus** | `frontend/src/app/admin/broadcast/page.tsx` | Fitur broadcast dihilangkan |
| **Hapus** | `frontend/src/app/admin/schedule/page.tsx` | Digantikan Calendar tab |
| **Modifikasi** | `frontend/src/components/AdminNav.tsx` | Hapus Broadcast dari NAV_ITEMS |
| **Buat** | `frontend/src/app/admin/bookings/CalendarView.tsx` | Komponen kalender bulanan |
| **Modifikasi** | `frontend/src/app/admin/bookings/page.tsx` | Tab state + switcher + render CalendarView |

---

### Task 1: Hapus halaman broadcast & schedule, update nav

**Files:**
- Delete: `frontend/src/app/admin/broadcast/page.tsx`
- Delete: `frontend/src/app/admin/schedule/page.tsx`
- Modify: `frontend/src/components/AdminNav.tsx`

- [ ] **Hapus kedua file**

```bash
rm "frontend/src/app/admin/broadcast/page.tsx"
rm "frontend/src/app/admin/schedule/page.tsx"
```

- [ ] **Buka `frontend/src/components/AdminNav.tsx` dan ganti seluruh isi file dengan:**

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, Scissors, Trophy, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
 { href: '/admin/dashboard', label: 'Command', Icon: LayoutDashboard },
 { href: '/admin/bookings', label: 'Booking', Icon: CalendarCheck },
 { href: '/admin/barbers', label: 'Kapster', Icon: Scissors },
 { href: '/admin/leaderboard', label: 'Ranking', Icon: Trophy },
 { href: '/admin/membership', label: 'Member', Icon: CreditCard },
];

export function AdminNav() {
 const pathname = usePathname();

 return (
 <nav
 className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md border-t"
 style={{ background: 'rgba(8,5,9,0.97)', borderColor: '#201618' }}
 >
 <div className="flex overflow-x-auto scrollbar-none">
 {NAV_ITEMS.map(({ href, label, Icon }) => {
 const active = pathname.startsWith(href);
 return (
 <Link
 key={href}
 href={href}
 className="flex-shrink-0 flex-1 flex flex-col items-center justify-center py-2.5 min-w-[52px] relative"
 >
 {active && (
 <motion.div
 layoutId="admin-nav-indicator"
 className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full"
 style={{ background: '#C72820' }}
 transition={{ type: 'spring', stiffness: 500, damping: 30 }}
 />
 )}
 <Icon
 size={20}
 style={{ color: active ? '#E87068' : '#4A3E40' }}
 className="transition-colors duration-200"
 />
 <span
 className="text-[10px] mt-0.5 font-medium transition-colors duration-200"
 style={{ color: active ? '#E87068' : '#4A3E40' }}
 >
 {label}
 </span>
 </Link>
 );
 })}
 </div>
 </nav>
 );
}
```

- [ ] **Commit**

```bash
git add -A
git commit -m "feat(admin): remove broadcast & schedule, update nav"
```

---

### Task 2: Buat CalendarView component

**Files:**
- Create: `frontend/src/app/admin/bookings/CalendarView.tsx`

- [ ] **Buat file `frontend/src/app/admin/bookings/CalendarView.tsx` dengan isi berikut:**

```tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarViewProps {
 branch: string;
 barbers: { id: string; name: string }[];
 readonly?: boolean;
}

interface BookingRow {
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

const MONTHS_ID = [
 'Januari','Februari','Maret','April','Mei','Juni',
 'Juli','Agustus','September','Oktober','November','Desember',
];
const DAY_NAMES_LONG = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const DAY_HEADERS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
 pending: { label: 'Pending', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
 confirmed: { label: 'Confirmed', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-400' },
 done: { label: 'Selesai', color: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400' },
 cancelled: { label: 'Batal', color: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400' },
 no_show: { label: 'No-show', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' },
 departed: { label: 'Berangkat', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', dot: 'bg-indigo-400' },
 arrived: { label: 'Tiba', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', dot: 'bg-cyan-400' },
 in_progress: { label: 'Dikerjakan', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
};

function StatusBadge({ status }: { status: string }) {
 const m = STATUS_META[status] ?? {
 label: status,
 color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
 dot: 'bg-slate-400',
 };
 return (
 <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.color}`}>
 <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
 {m.label}
 </span>
 );
}

function toDateStr(d: Date): string {
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
 return toDateStr(new Date());
}

function getMonthDays(year: number, month: number): (Date | null)[] {
 const firstDay = new Date(year, month, 1);
 const lastDay = new Date(year, month + 1, 0);
 const startPad = firstDay.getDay(); // 0=Sun
 const days: (Date | null)[] = [];
 for (let i = 0; i < startPad; i++) days.push(null);
 for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
 while (days.length % 7 !== 0) days.push(null);
 return days;
}

export function CalendarView({ branch, barbers }: CalendarViewProps) {
 const today = todayStr();
 const todayDate = new Date();

 const [year, setYear] = useState(todayDate.getFullYear());
 const [month, setMonth] = useState(todayDate.getMonth());
 const [selectedDate, setSelectedDate] = useState<string | null>(today);
 const [barberFilter, setBarberFilter] = useState('all');
 const [loadingDate, setLoadingDate] = useState<string | null>(null);
 const [dayCache, setDayCache] = useState<Map<string, BookingRow[]>>(new Map());
 const detailRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 if (!branch) return;
 loadDay(today);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [branch]);

 async function loadDay(dateStr: string) {
 setSelectedDate(dateStr);
 if (dayCache.has(dateStr)) {
 setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
 return;
 }
 setLoadingDate(dateStr);
 try {
 const res = await fetch(`/api/bookings?location=${branch}&date=${dateStr}`);
 const data = await res.json();
 const bookings: BookingRow[] = Array.isArray(data?.bookings)
 ? data.bookings
 : Array.isArray(data) ? data : [];
 setDayCache(prev => new Map(prev).set(dateStr, bookings.sort((a, b) => a.time.localeCompare(b.time))));
 } catch {
 setDayCache(prev => new Map(prev).set(dateStr, []));
 } finally {
 setLoadingDate(null);
 setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
 }
 }

 function prevMonth() {
 if (month === 0) { setYear(y => y - 1); setMonth(11); }
 else setMonth(m => m - 1);
 setSelectedDate(null);
 }

 function nextMonth() {
 if (month === 11) { setYear(y => y + 1); setMonth(0); }
 else setMonth(m => m + 1);
 setSelectedDate(null);
 }

 const days = getMonthDays(year, month);

 const selectedBookings = selectedDate ? (dayCache.get(selectedDate) ?? null) : null;
 const filteredBookings = selectedBookings === null
 ? null
 : barberFilter === 'all'
 ? selectedBookings
 : selectedBookings.filter(b => b.barber_id === barberFilter);

 function formatDetailTitle(dateStr: string): string {
 const d = new Date(dateStr + 'T00:00:00');
 return `${DAY_NAMES_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
 }

 return (
 <div className="space-y-3">

 {/* Sub-header: month nav + barber filter */}
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-1">
 <button
 onClick={prevMonth}
 className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
 >
 <ChevronLeft size={16} />
 </button>
 <span className="text-sm font-semibold text-slate-200 min-w-[110px] text-center">
 {MONTHS_ID[month]} {year}
 </span>
 <button
 onClick={nextMonth}
 className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
 >
 <ChevronRight size={16} />
 </button>
 </div>

 <select
 value={barberFilter}
 onChange={e => setBarberFilter(e.target.value)}
 className="h-8 rounded-xl px-3 text-xs font-medium focus:outline-none cursor-pointer [color-scheme:dark]"
 style={{
 background: '#0F0A0D',
 border: '1px solid rgba(255,255,255,0.08)',
 color: barberFilter === 'all' ? '#6B5A5E' : '#F0EAEB',
 }}
 >
 <option value="all">Semua Kapster</option>
 {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
 </select>
 </div>

 {/* Calendar grid */}
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl overflow-hidden">
 {/* Day headers */}
 <div className="grid grid-cols-7 border-b border-slate-800">
 {DAY_HEADERS.map(d => (
 <div key={d} className="py-2 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
 {d}
 </div>
 ))}
 </div>

 {/* Day cells */}
 <div className="grid grid-cols-7">
 {days.map((day, idx) => {
 if (!day) {
 return <div key={`pad-${idx}`} className="aspect-square" />;
 }
 const dateStr = toDateStr(day);
 const isToday = dateStr === today;
 const isSelected = dateStr === selectedDate && !isToday;
 const cached = dayCache.get(dateStr);
 const hasBookings = cached && cached.length > 0;

 return (
 <button
 key={dateStr}
 onClick={() => loadDay(dateStr)}
 className="aspect-square flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 cursor-pointer"
 >
 <span
 className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-all ${
 isToday
 ? 'bg-[#C72820] text-white'
 : isSelected
 ? 'border border-white/50 text-white'
 : 'text-slate-400 hover:text-white'
 }`}
 >
 {day.getDate()}
 </span>
 {/* Dot indicator — only for cached days with bookings */}
 <span className={`w-1 h-1 rounded-full transition-all ${hasBookings && !isToday ? 'bg-[#C72820]' : 'bg-transparent'}`} />
 </button>
 );
 })}
 </div>
 </div>

 {/* Day detail panel */}
 <AnimatePresence mode="wait">
 {selectedDate && (
 <motion.div
 ref={detailRef}
 key={selectedDate}
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-3"
 >
 <p className="text-sm font-semibold text-white">
 {formatDetailTitle(selectedDate)}
 </p>

 {loadingDate === selectedDate ? (
 <div className="space-y-2">
 {[1, 2, 3].map(i => (
 <motion.div
 key={i}
 animate={{ opacity: [0.4, 0.7, 0.4] }}
 transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
 className="h-14 bg-slate-800 rounded-xl"
 />
 ))}
 </div>
 ) : !filteredBookings || filteredBookings.length === 0 ? (
 <p className="text-slate-500 text-sm text-center py-4">Tidak ada booking</p>
 ) : (
 <div className="space-y-2">
 {filteredBookings.map(bk => {
 const barberName = barbers.find(b => b.id === bk.barber_id)?.name;
 return (
 <div
 key={bk.id}
 className="flex items-start justify-between gap-2 bg-slate-800/50 rounded-xl px-3 py-2.5"
 >
 <div className="min-w-0">
 <p className="font-semibold text-white text-sm truncate">{bk.name || '—'}</p>
 <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
 {barberName && (
 <p className="text-xs text-slate-600 mt-0.5">{barberName}</p>
 )}
 </div>
 <StatusBadge status={bk.status} />
 </div>
 );
 })}
 </div>
 )}
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 );
}
```

- [ ] **Commit**

```bash
git add frontend/src/app/admin/bookings/CalendarView.tsx
git commit -m "feat(admin): add CalendarView component"
```

---

### Task 3: Integrasikan CalendarView ke halaman Bookings

**Files:**
- Modify: `frontend/src/app/admin/bookings/page.tsx`

Tiga perubahan di `BookingControlPageInner`:

**Perubahan 1** — Tambah import CalendarView di bagian paling atas file (setelah import yang sudah ada):

```typescript
import { CalendarView } from './CalendarView';
```

**Perubahan 2** — Tambah state `tab` di dalam `BookingControlPageInner`, setelah state yang sudah ada:

```typescript
const [tab, setTab] = useState<'tabel' | 'kalender'>('tabel');
```

**Perubahan 3** — Ganti seluruh `return (...)` dari `BookingControlPageInner` dengan:

```tsx
 return (
 <div className="p-4 space-y-4 pb-6">

 {/* Header */}
 <div className="flex items-center justify-between">
 <h2 className="text-white font-bold text-base">Booking Control</h2>
 {!readonly && tab === 'tabel' && (
 <button
 onClick={() => setWalkinOpen(true)}
 className="flex items-center gap-1.5 h-9 px-3 bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
 >
 <Plus size={14} />
 Walk-in
 </button>
 )}
 </div>

 {/* Tab Switcher */}
 <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
 {(['tabel', 'kalender'] as const).map(t => (
 <button
 key={t}
 onClick={() => setTab(t)}
 className="flex-1 h-8 rounded-lg text-xs font-semibold transition-all cursor-pointer"
 style={tab === t
 ? { background: 'rgba(199,40,32,0.15)', color: '#E87068', border: '1px solid rgba(199,40,32,0.3)' }
 : { background: 'transparent', color: '#4A3E40', border: '1px solid transparent' }
 }
 >
 {t === 'tabel' ? ' Tabel' : ' Kalender'}
 </button>
 ))}
 </div>

 {tab === 'kalender' ? (
 <CalendarView branch={branch} barbers={branchBarbers} readonly={readonly} />
 ) : (
 <>
 {/* Date */}
 <input
 type="date" value={dateFilter}
 onChange={e => setDateFilter(e.target.value)}
 className="w-full h-10 bg-[#0F172A] border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500"
 />

 {/* Filters */}
 <div className="grid grid-cols-2 gap-2">
 <select
 value={statusFilter}
 onChange={e => setStatusFilter(e.target.value)}
 className="h-9 rounded-xl px-3 text-xs font-medium focus:outline-none cursor-pointer [color-scheme:dark]"
 style={{ background: '#0F0A0D', border: '1px solid rgba(255,255,255,0.08)', color: statusFilter === 'all' ? '#6B5A5E' : '#F0EAEB' }}
 >
 <option value="all">Semua Status</option>
 <option value="pending">Pending</option>
 <option value="confirmed">Confirmed</option>
 <option value="done">Done</option>
 <option value="cancelled">Cancelled</option>
 <option value="no_show">No-show</option>
 </select>

 <select
 value={typeFilter}
 onChange={e => setTypeFilter(e.target.value)}
 className="h-9 rounded-xl px-3 text-xs font-medium focus:outline-none cursor-pointer [color-scheme:dark]"
 style={{ background: '#0F0A0D', border: '1px solid rgba(255,255,255,0.08)', color: typeFilter === 'all' ? '#6B5A5E' : '#F0EAEB' }}
 >
 <option value="all">Semua Tipe</option>
 <option value="online">Online</option>
 <option value="home_service">Home Service</option>
 <option value="wedding">Wedding</option>
 <option value="walk_in">Walk-in</option>
 </select>
 </div>

 {/* Booking list */}
 {loading ? (
 <div className="space-y-2">
 {[1,2,3].map(i => (
 <motion.div key={i} animate={{ opacity: [0.4,0.7,0.4] }} transition={{ duration:1.4, repeat:Infinity, delay: i*0.2 }}
 className="h-20 bg-slate-800 rounded-2xl" />
 ))}
 </div>
 ) : bookings.length === 0 ? (
 <p className="text-center text-slate-500 text-sm py-10">Tidak ada booking</p>
 ) : (
 <div className="space-y-2">
 {bookings.map((bk: any, i: number) => (
 <motion.div key={bk.id}
 initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
 transition={{ delay: i*0.04, duration:0.2 }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
 >
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <p className="font-semibold text-white text-sm truncate">{bk.name}</p>
 {isHS(bk) && <Home size={12} className="text-purple-400 flex-shrink-0" />}
 </div>
 <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
 {bk.wa && bk.wa !== '-' && <p className="text-xs text-slate-600">{bk.wa}</p>}
 </div>
 <StatusBadge status={bk.status} />
 </div>

 {!readonly && (
 <div className="flex gap-1.5 flex-wrap">
 {bk.status === 'pending' && <>
 <ActionBtn color="green" icon={<Check size={12}/>} label="Konfirmasi" onClick={() => updateStatus(bk.id,'confirmed')} />
 <ActionBtn color="red" icon={<X size={12}/>} label="Batalkan" onClick={() => updateStatus(bk.id,'cancelled')} />
 <ActionBtn color="slate" icon={<Shuffle size={12}/>} label="Reassign" onClick={() => setReassignId(bk.id)} />
 </>}
 {bk.status === 'confirmed' && <>
 <ActionBtn color="green" icon={<Check size={12}/>} label="Done" onClick={() => updateStatus(bk.id,'done')} />
 <ActionBtn color="slate" icon={<UserX size={12}/>} label="No-show" onClick={() => updateStatus(bk.id,'no_show')} />
 <ActionBtn color="red" icon={<X size={12}/>} label="Batalkan" onClick={() => updateStatus(bk.id,'cancelled')} />
 {isHS(bk) && <ActionBtn color="indigo" icon={<ChevronRight size={12}/>} label="Berangkat" onClick={() => updateStatus(bk.id,'departed')} />}
 </>}
 {bk.status === 'departed' && <ActionBtn color="cyan" icon={<ChevronRight size={12}/>} label="Sampai" onClick={() => updateStatus(bk.id,'arrived')} />}
 {bk.status === 'arrived' && <ActionBtn color="purple" icon={<ChevronRight size={12}/>} label="Dikerjakan" onClick={() => updateStatus(bk.id,'in_progress')} />}
 {bk.status === 'in_progress' && <ActionBtn color="green" icon={<Check size={12}/>} label="Selesai" onClick={() => updateStatus(bk.id,'done')} />}
 </div>
 )}
 </motion.div>
 ))}
 </div>
 )}

 {/* Walk-in Bottom Sheet */}
 <AnimatePresence>
 {walkinOpen && (
 <Sheet onClose={() => setWalkinOpen(false)} title="Walk-in Customer">
 <Input placeholder="Nama (opsional)" value={walkinData.name}
 onChange={e => setWalkinData(d => ({ ...d, name: e.target.value }))} />
 <Input placeholder="No HP (opsional)" value={walkinData.wa}
 onChange={e => setWalkinData(d => ({ ...d, wa: e.target.value }))} />
 <select value={walkinData.barber_id}
 onChange={e => setWalkinData(d => ({ ...d, barber_id: e.target.value }))}
 className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500">
 <option value="">Pilih Kapster</option>
 {branchBarbers.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
 </select>
 <Input placeholder="Service (contoh: Potong Rambut)" value={walkinData.service}
 onChange={e => setWalkinData(d => ({ ...d, service: e.target.value }))} />
 <div className="flex gap-2 pt-1">
 <button onClick={() => setWalkinOpen(false)}
 className="flex-1 h-11 border border-slate-700 rounded-xl text-sm text-slate-400 cursor-pointer active:scale-95 transition-all">
 Batal
 </button>
 <button onClick={submitWalkIn}
 className="flex-1 h-11 bg-green-500 text-white rounded-xl text-sm font-semibold cursor-pointer active:scale-95 transition-all">
 Catat
 </button>
 </div>
 </Sheet>
 )}
 </AnimatePresence>

 {/* Reassign Bottom Sheet */}
 <AnimatePresence>
 {reassignId && (
 <Sheet onClose={() => setReassignId(null)} title="Pilih Kapster Pengganti">
 <div className="space-y-1.5 max-h-60 overflow-y-auto">
 {branchBarbers.map((b: any) => (
 <button key={b.id} onClick={() => doReassign(b.id)}
 className="w-full h-11 text-left px-4 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium text-slate-200 cursor-pointer active:scale-[0.98] transition-all">
 {b.name}
 </button>
 ))}
 </div>
 </Sheet>
 )}
 </AnimatePresence>
 </>
 )}
 </div>
 );
```

- [ ] **Commit**

```bash
git add frontend/src/app/admin/bookings/page.tsx
git commit -m "feat(admin): add Tabel/Kalender tab toggle to bookings page"
```

---

### Task 4: Verifikasi dan deploy

- [ ] **Jalankan dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Verifikasi manual — buka `http://localhost:3000/admin/bookings` (login dulu):**

| Skenario | Expected |
|----------|----------|
| Buka halaman Booking | Tab " Tabel" aktif secara default |
| Bottom nav | Tidak ada item "Broadcast" lagi (5 item: Command, Booking, Kapster, Ranking, Member) |
| Klik tab " Kalender" | Grid bulan muncul, hari ini otomatis dipilih dan booking hari ini di-load |
| Klik hari lain di grid | Day detail panel update dengan booking hari tersebut |
| Filter "Semua Kapster" | Dropdown berisi nama kapster, pilih satu → day detail difilter |
| Navigasi bulan ‹ › | Grid bulan berubah, selected day di-reset |
| Kembali ke tab Tabel | View list normal kembali, Walk-in button muncul |
| Akses `/admin/broadcast` | 404 (halaman dihapus) |
| Akses `/admin/schedule` | 404 (halaman dihapus) |

- [ ] **Push dan deploy**

```bash
git push origin main
```

Monitor di Vercel dashboard, lalu verifikasi di `admin.redboxbarbershop.com/bookings`.
