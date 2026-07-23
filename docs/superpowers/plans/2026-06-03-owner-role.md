# Owner Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan role `owner` yang bisa lihat data revenue Moka + Web semua cabang sekaligus di `admin.redboxbarbershop.com/owner/*`, dengan read-only drill-down ke admin view per cabang.

**Architecture:** Owner layout terpisah dari admin (`/owner/*`), dua backend endpoint baru di `adminCrm.js`, admin pages tetap tapi tambah `readonly` mode via URL param `?readonly=true`. Data revenue dari `schedules` (source=moka) dan `transactions` (source=web).

**Tech Stack:** Next.js 16 App Router, Express, Supabase, Framer Motion, Lucide React, Recharts

---

## File Map

**Create:**
- `server/routes/adminCrm.js` — tambah 2 endpoint (owner-overview, owner-revenue)
- `frontend/src/app/api/admin/crm/owner-overview/route.ts` — proxy
- `frontend/src/app/api/admin/crm/owner-revenue/route.ts` — proxy
- `frontend/src/lib/adminCrmTypes.ts` — tambah OwnerOverviewData, OwnerRevenueData
- `frontend/src/lib/adminCrmApi.ts` — tambah fetchOwnerOverview, fetchOwnerRevenue
- `frontend/src/components/OwnerNav.tsx` — 3-tab bottom nav
- `frontend/src/app/owner/layout.tsx` — guard + OwnerNav
- `frontend/src/app/owner/dashboard/page.tsx` — cross-branch overview
- `frontend/src/app/owner/revenue/page.tsx` — revenue dashboard + Recharts
- `frontend/src/app/owner/profile/page.tsx` — profil owner

**Modify:**
- `frontend/src/app/admin/layout.tsx` — readonly mode: back button + pass readonly
- `frontend/src/app/admin/dashboard/page.tsx` — disable Home Service advance button
- `frontend/src/app/admin/bookings/page.tsx` — disable Walk-in/Confirm/Cancel/Reassign
- `frontend/src/app/admin/barbers/page.tsx` — disable status buttons
- `frontend/src/app/admin/schedule/page.tsx` — disable toggle block
- `frontend/src/app/admin/broadcast/page.tsx` — hide compose form

---

## Task 1: Backend — `owner-overview` endpoint

**Files:**
- Modify: `server/routes/adminCrm.js` (append before closing `return router`)

- [ ] **Step 1: Tambah endpoint di adminCrm.js**

Buka `server/routes/adminCrm.js`. Cari baris `return router;` di bagian paling bawah. Tambahkan sebelum baris itu:

```js
// ─── OWNER OVERVIEW ──────────────────────────────────────────
router.get('/owner-overview', adminAuth, async (req, res) => {
 const today = localDateStr();
 const dayStart = today + 'T00:00:00+07:00';
 const dayEnd = today + 'T23:59:59+07:00';

 const { data: outlets } = await supabase
 .from('outlets')
 .select('id, name, slug');

 const branches = await Promise.all((outlets || []).map(async (outlet) => {
 const { data: barbers } = await supabase
 .from('barbers').select('id').eq('is_active', true).eq('branch', outlet.slug);
 const barberIds = (barbers || []).map(b => b.id);

 const [attRows, mokaSch, webTx, goshow, pendingBk] = await Promise.all([
 supabase.from('barber_attendance').select('barber_id, status')
 .in('barber_id', barberIds).eq('date', today),
 supabase.from('schedules').select('price')
 .eq('outlet_id', outlet.id).eq('source', 'moka').eq('status', 'completed')
 .gte('start_time', dayStart).lte('start_time', dayEnd),
 supabase.from('transactions').select('total_amount')
 .eq('outlet_id', outlet.id).eq('source', 'web')
 .gte('created_at', dayStart).lte('created_at', dayEnd),
 supabase.from('schedules').select('id')
 .eq('outlet_id', outlet.id).eq('source', 'moka').eq('status', 'reserved')
 .gte('start_time', dayStart).lte('start_time', dayEnd),
 supabase.from('bookings').select('id')
 .eq('location', outlet.slug).eq('status', 'pending').eq('date', today),
 ]);

 const hadirSet = new Set(
 (attRows.data || []).filter(a => ['hadir','terlambat'].includes(a.status)).map(a => a.barber_id)
 );
 const revenue_moka = (mokaSch.data || []).reduce((s, r) => s + (r.price || 0), 0);
 const revenue_web = (webTx.data || []).reduce((s, r) => s + (r.total_amount || 0), 0);

 return {
 slug: outlet.slug,
 name: outlet.name,
 revenue_moka,
 tx_moka: (mokaSch.data || []).length,
 revenue_web,
 tx_web: (webTx.data || []).length,
 hadir: hadirSet.size,
 total_barbers: barberIds.length,
 goshow: (goshow.data || []).length,
 pending_bookings: (pendingBk.data || []).length,
 };
 }));

 const totals = branches.reduce((acc, b) => ({
 revenue_moka: acc.revenue_moka + b.revenue_moka,
 revenue_web: acc.revenue_web + b.revenue_web,
 tx_total: acc.tx_total + b.tx_moka + b.tx_web,
 hadir: acc.hadir + b.hadir,
 goshow: acc.goshow + b.goshow,
 pending: acc.pending + b.pending_bookings,
 }), { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 0 });

 return res.json({ today, branches, totals });
});

// ─── OWNER REVENUE ────────────────────────────────────────────
router.get('/owner-revenue', adminAuth, async (req, res) => {
 const { branch = 'all', period = '7d' } = req.query;

 const now = new Date();
 let startDate;
 if (period === 'today') {
 startDate = new Date(now); startDate.setHours(0,0,0,0);
 } else if (period === '7d') {
 startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0,0,0,0);
 } else if (period === '30d') {
 startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0,0,0,0);
 } else if (period === 'month') {
 startDate = new Date(now.getFullYear(), now.getMonth(), 1);
 } else {
 startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0,0,0,0);
 }
 const startIso = startDate.toISOString();

 // Resolve outlet filter
 let outletIds = null;
 if (branch !== 'all') {
 const { data: outlet } = await supabase.from('outlets').select('id').eq('slug', branch).maybeSingle();
 outletIds = outlet ? [outlet.id] : [];
 }

 // Fetch moka schedules & web transactions in parallel
 let mokaQ = supabase.from('schedules').select('outlet_id, barber_id, service_name, price, start_time')
 .eq('source', 'moka').eq('status', 'completed').gte('start_time', startIso);
 let webQ = supabase.from('transactions').select('outlet_id, total_amount, created_at')
 .eq('source', 'web').gte('created_at', startIso);
 if (outletIds) {
 mokaQ = mokaQ.in('outlet_id', outletIds);
 webQ = webQ.in('outlet_id', outletIds);
 }

 const [mokaRes, webRes, outletRes, barberRes] = await Promise.all([
 mokaQ, webQ,
 supabase.from('outlets').select('id, name, slug'),
 supabase.from('barbers').select('id, name, branch').eq('is_active', true),
 ]);

 const mokaRows = mokaRes.data || [];
 const webRows = webRes.data || [];
 const outlets = outletRes.data || [];
 const barbers = barberRes.data || [];

 // Summary
 const revenue_moka = mokaRows.reduce((s, r) => s + (r.price || 0), 0);
 const revenue_web = webRows.reduce((s, r) => s + (r.total_amount || 0), 0);
 const tx_total = mokaRows.length + webRows.length;
 const avg_tx = tx_total ? Math.round((revenue_moka + revenue_web) / tx_total) : 0;

 // Daily trend — group by WIB date
 const dailyMap = {};
 for (const r of mokaRows) {
 const d = new Date(r.start_time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
 if (!dailyMap[d]) dailyMap[d] = { date: d, moka: 0, web: 0 };
 dailyMap[d].moka += r.price || 0;
 }
 for (const r of webRows) {
 const d = new Date(r.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
 if (!dailyMap[d]) dailyMap[d] = { date: d, moka: 0, web: 0 };
 dailyMap[d].web += r.total_amount || 0;
 }
 const daily_trend = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

 // Branch compare
 const outletMap = {};
 for (const o of outlets) outletMap[o.id] = { slug: o.slug, name: o.name, revenue_moka: 0, revenue_web: 0, tx_total: 0 };
 for (const r of mokaRows) {
 if (outletMap[r.outlet_id]) { outletMap[r.outlet_id].revenue_moka += r.price || 0; outletMap[r.outlet_id].tx_total++; }
 }
 for (const r of webRows) {
 if (outletMap[r.outlet_id]) { outletMap[r.outlet_id].revenue_web += r.total_amount || 0; outletMap[r.outlet_id].tx_total++; }
 }
 const branch_compare = Object.values(outletMap).sort((a, b) => (b.revenue_moka + b.revenue_web) - (a.revenue_moka + a.revenue_web));

 // Top barbers
 const barberMap = {};
 for (const r of mokaRows) {
 if (!r.barber_id) continue;
 if (!barberMap[r.barber_id]) barberMap[r.barber_id] = { barber_id: r.barber_id, name: '', branch: '', tx_count: 0, revenue: 0 };
 barberMap[r.barber_id].tx_count++;
 barberMap[r.barber_id].revenue += r.price || 0;
 }
 for (const b of barbers) {
 if (barberMap[b.id]) { barberMap[b.id].name = b.name; barberMap[b.id].branch = b.branch; }
 }
 const top_barbers = Object.values(barberMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

 // Top services
 const svcMap = {};
 for (const r of mokaRows) {
 const svc = r.service_name || 'Unknown';
 if (!svcMap[svc]) svcMap[svc] = { service_name: svc, count: 0, revenue: 0 };
 svcMap[svc].count++;
 svcMap[svc].revenue += r.price || 0;
 }
 const top_services = Object.values(svcMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

 return res.json({ summary: { revenue_moka, revenue_web, tx_total, avg_tx }, daily_trend, branch_compare, top_barbers, top_services });
});
```

- [ ] **Step 2: Test endpoint di localhost**

```bash
curl "http://localhost:3001/api/admin/crm/owner-overview" \
 -H "x-admin-token: redbox_admin_2024" | python -m json.tool | head -40
```

Expected: JSON dengan array `branches` (5 cabang) dan `totals`.

```bash
curl "http://localhost:3001/api/admin/crm/owner-revenue?period=7d" \
 -H "x-admin-token: redbox_admin_2024" | python -m json.tool | head -40
```

Expected: JSON dengan `summary`, `daily_trend`, `branch_compare`, `top_barbers`, `top_services`.

- [ ] **Step 3: Commit**

```bash
git add server/routes/adminCrm.js
git commit -m "feat(owner): tambah endpoint owner-overview + owner-revenue di adminCrm.js"
```

---

## Task 2: Proxy Routes + TypeScript Types + API helpers

**Files:**
- Create: `frontend/src/app/api/admin/crm/owner-overview/route.ts`
- Create: `frontend/src/app/api/admin/crm/owner-revenue/route.ts`
- Modify: `frontend/src/lib/adminCrmTypes.ts`
- Modify: `frontend/src/lib/adminCrmApi.ts`

- [ ] **Step 1: Buat proxy owner-overview**

```ts
// frontend/src/app/api/admin/crm/owner-overview/route.ts
import { NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET() {
 const res = await fetch(`${API_URL}/api/admin/crm/owner-overview`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 2: Buat proxy owner-revenue**

```ts
// frontend/src/app/api/admin/crm/owner-revenue/route.ts
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const TOKEN = process.env.ADMIN_PASSWORD ?? '';
export async function GET(req: NextRequest) {
 const qs = req.nextUrl.search;
 const res = await fetch(`${API_URL}/api/admin/crm/owner-revenue${qs}`,
 { headers: { 'x-admin-token': TOKEN } });
 return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 3: Tambah TypeScript types di adminCrmTypes.ts**

Append ke akhir file `frontend/src/lib/adminCrmTypes.ts`:

```ts
export interface OwnerBranchSummary {
 slug: string;
 name: string;
 revenue_moka: number;
 tx_moka: number;
 revenue_web: number;
 tx_web: number;
 hadir: number;
 total_barbers: number;
 goshow: number;
 pending_bookings: number;
}

export interface OwnerOverviewData {
 today: string;
 branches: OwnerBranchSummary[];
 totals: {
 revenue_moka: number;
 revenue_web: number;
 tx_total: number;
 hadir: number;
 goshow: number;
 pending: number;
 };
}

export interface OwnerRevenueData {
 summary: {
 revenue_moka: number;
 revenue_web: number;
 tx_total: number;
 avg_tx: number;
 };
 daily_trend: { date: string; moka: number; web: number }[];
 branch_compare: { slug: string; name: string; revenue_moka: number; revenue_web: number; tx_total: number }[];
 top_barbers: { barber_id: string; name: string; branch: string; tx_count: number; revenue: number }[];
 top_services: { service_name: string; count: number; revenue: number }[];
}
```

- [ ] **Step 4: Tambah fetch helpers di adminCrmApi.ts**

Append ke akhir file `frontend/src/lib/adminCrmApi.ts`:

```ts
export async function fetchOwnerOverview(): Promise<OwnerOverviewData> {
 const res = await fetch('/api/admin/crm/owner-overview');
 if (!res.ok) throw new Error('owner-overview failed');
 return res.json();
}

export async function fetchOwnerRevenue(branch: string, period: string): Promise<OwnerRevenueData> {
 const res = await fetch(`/api/admin/crm/owner-revenue?branch=${branch}&period=${period}`);
 if (!res.ok) throw new Error('owner-revenue failed');
 return res.json();
}
```

Tambahkan juga import types di bagian atas `adminCrmApi.ts`:
```ts
import type { OwnerOverviewData, OwnerRevenueData } from './adminCrmTypes';
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/admin/crm/owner-overview/route.ts \
 frontend/src/app/api/admin/crm/owner-revenue/route.ts \
 frontend/src/lib/adminCrmTypes.ts \
 frontend/src/lib/adminCrmApi.ts
git commit -m "feat(owner): proxy routes + TypeScript types + API helpers"
```

---

## Task 3: OwnerNav Component + Owner Layout

**Files:**
- Create: `frontend/src/components/OwnerNav.tsx`
- Create: `frontend/src/app/owner/layout.tsx`

- [ ] **Step 1: Buat OwnerNav**

```tsx
// frontend/src/components/OwnerNav.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, User } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
 { href: '/owner/dashboard', label: 'Overview', Icon: LayoutDashboard },
 { href: '/owner/revenue', label: 'Revenue', Icon: TrendingUp },
 { href: '/owner/profile', label: 'Profil', Icon: User },
];

export function OwnerNav() {
 const pathname = usePathname();
 return (
 <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0F1E]/95 backdrop-blur-md border-t border-slate-800">
 <div className="flex">
 {NAV_ITEMS.map(({ href, label, Icon }) => {
 const active = pathname.startsWith(href);
 return (
 <Link key={href} href={href}
 className="flex-1 flex flex-col items-center justify-center py-2.5 relative">
 {active && (
 <motion.div layoutId="owner-nav-indicator"
 className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-green-400"
 transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
 )}
 <Icon size={20} className={`transition-colors duration-200 ${active ? 'text-green-400' : 'text-slate-500'}`} />
 <span className={`text-[10px] mt-0.5 font-medium transition-colors duration-200 ${active ? 'text-green-400' : 'text-slate-500'}`}>
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

- [ ] **Step 2: Buat Owner Layout**

```tsx
// frontend/src/app/owner/layout.tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { OwnerNav } from '@/components/OwnerNav';
import { LogOut } from 'lucide-react';
import { motion } from 'framer-motion';

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
 const { user, loading, signOut } = useUser();
 const router = useRouter();

 useEffect(() => {
 if (!loading && !user) router.replace('/login');
 if (!loading && user && user.role !== 'owner') router.replace('/login');
 }, [user, loading, router]);

 if (loading) {
 return (
 <div className="min-h-dvh bg-[#020617] flex items-center justify-center">
 <motion.div animate={{ opacity: [0.3, 1, 0.3] }}
 transition={{ duration: 1.5, repeat: Infinity }}
 className="text-slate-500 text-sm">Memuat...</motion.div>
 </div>
 );
 }

 return (
 <div className="min-h-dvh bg-[#020617] pb-20">
 <header className="bg-[#0A0F1E]/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
 <div>
 <h1 className="font-bold text-white text-sm tracking-wide">REDBOX OWNER</h1>
 <p className="text-[11px] text-green-400 font-medium">{user?.name}</p>
 </div>
 <button onClick={signOut}
 className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
 <LogOut size={16} />
 <span className="text-xs">Keluar</span>
 </button>
 </header>
 <main>{children}</main>
 <OwnerNav />
 </div>
 );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/OwnerNav.tsx frontend/src/app/owner/layout.tsx
git commit -m "feat(owner): OwnerNav component + owner layout dengan role guard"
```

---

## Task 4: Owner Dashboard Page

**Files:**
- Create: `frontend/src/app/owner/dashboard/page.tsx`

- [ ] **Step 1: Install Recharts (dibutuhkan juga Task 5)**

```bash
cd frontend && npm install recharts
```

- [ ] **Step 2: Buat owner dashboard page**

```tsx
// frontend/src/app/owner/dashboard/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchOwnerOverview } from '@/lib/adminCrmApi';
import type { OwnerOverviewData, OwnerBranchSummary } from '@/lib/adminCrmTypes';
import { motion } from 'framer-motion';
import { RefreshCw, TrendingUp, ChevronRight, Users, ShoppingBag, CalendarCheck, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

function fmt(n: number) {
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
 if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
 return `${n}`;
}

function Skeleton({ className }: { className?: string }) {
 return (
 <motion.div animate={{ opacity: [0.4, 0.7, 0.4] }}
 transition={{ duration: 1.4, repeat: Infinity }}
 className={`bg-slate-800 rounded-lg ${className}`} />
 );
}

function TotalBar({ totals }: { totals: OwnerOverviewData['totals'] }) {
 const items = [
 { label: 'Moka', value: fmt(totals.revenue_moka), color: 'text-teal-400' },
 { label: 'Web', value: fmt(totals.revenue_web), color: 'text-blue-400' },
 { label: 'Tx', value: String(totals.tx_total), color: 'text-slate-300' },
 { label: 'Hadir', value: String(totals.hadir), color: 'text-green-400' },
 { label: 'GoShow', value: String(totals.goshow), color: 'text-amber-400' },
 { label: 'Pending', value: String(totals.pending), color: 'text-orange-400' },
 ];
 return (
 <div className="grid grid-cols-3 gap-2">
 {items.map((item, i) => (
 <motion.div key={item.label}
 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.05 }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl px-3 py-2.5 text-center">
 <p className={`text-base font-bold tabular-nums ${item.color}`}>{item.value}</p>
 <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
 </motion.div>
 ))}
 </div>
 );
}

function BranchCard({ branch, index, onClick }: { branch: OwnerBranchSummary; index: number; onClick: () => void }) {
 const totalRevenue = branch.revenue_moka + branch.revenue_web;
 return (
 <motion.div
 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.07, duration: 0.25 }}
 onClick={onClick}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3.5 cursor-pointer active:scale-[0.98] transition-all"
 >
 <div className="flex items-center justify-between mb-3">
 <p className="font-bold text-white text-sm capitalize">{branch.name.replace('RedBox ', '')}</p>
 <div className="flex items-center gap-1 text-slate-500">
 <span className="text-xs font-semibold text-slate-300">Rp {fmt(totalRevenue)}</span>
 <ChevronRight size={14} />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
 <div className="flex items-center gap-1.5">
 <ShoppingBag size={11} className="text-teal-500" />
 <span className="text-[11px] text-slate-400">Moka: <span className="text-teal-400 font-semibold">Rp {fmt(branch.revenue_moka)}</span> ({branch.tx_moka}tx)</span>
 </div>
 <div className="flex items-center gap-1.5">
 <CalendarCheck size={11} className="text-blue-500" />
 <span className="text-[11px] text-slate-400">Web: <span className="text-blue-400 font-semibold">Rp {fmt(branch.revenue_web)}</span> ({branch.tx_web}tx)</span>
 </div>
 <div className="flex items-center gap-1.5">
 <Users size={11} className="text-green-500" />
 <span className="text-[11px] text-slate-400">Hadir: <span className="text-green-400 font-semibold">{branch.hadir}/{branch.total_barbers}</span></span>
 </div>
 <div className="flex items-center gap-1.5">
 <AlertCircle size={11} className="text-amber-500" />
 <span className="text-[11px] text-slate-400">GoShow: <span className="text-amber-400 font-semibold">{branch.goshow}</span> · Pending: <span className="text-orange-400 font-semibold">{branch.pending_bookings}</span></span>
 </div>
 </div>
 </motion.div>
 );
}

export default function OwnerDashboardPage() {
 const { user } = useUser();
 const router = useRouter();
 const [data, setData] = useState<OwnerOverviewData | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);

 const load = useCallback(async (isRefresh = false) => {
 if (isRefresh) setRefreshing(true); else setLoading(true);
 const d = await fetchOwnerOverview().catch(() => null);
 if (d) setData(d);
 setLoading(false);
 setRefreshing(false);
 }, []);

 useEffect(() => { load(); }, [load]);
 useEffect(() => {
 const id = setInterval(() => load(true), 60_000);
 return () => clearInterval(id);
 }, [load]);

 return (
 <div className="p-4 space-y-4 pb-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-[11px] text-slate-500">{data?.today ?? '...'}</p>
 <p className="text-xs text-slate-600 mt-0.5">Semua Cabang</p>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={() => router.push('/owner/revenue')}
 className="flex items-center gap-1.5 bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95 transition-all cursor-pointer">
 <TrendingUp size={13} />
 Revenue
 </button>
 <button onClick={() => load(true)}
 className="p-2 rounded-xl bg-slate-800 text-slate-400 active:scale-95 transition-all cursor-pointer">
 <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
 </button>
 </div>
 </div>

 {loading ? (
 <div className="space-y-3">
 <div className="grid grid-cols-3 gap-2">{Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-14" />)}</div>
 {Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-28" />)}
 </div>
 ) : !data ? (
 <p className="text-center text-slate-500 text-sm py-12">Gagal memuat data</p>
 ) : (
 <>
 <TotalBar totals={data.totals} />
 <div className="space-y-2.5">
 <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Per Cabang</p>
 {data.branches.map((b, i) => (
 <BranchCard key={b.slug} branch={b} index={i}
 onClick={() => router.push(`/admin/dashboard?branch=${b.slug}&readonly=true`)} />
 ))}
 </div>
 </>
 )}
 </div>
 );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/owner/dashboard/page.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(owner): owner dashboard page — cross-branch overview + branch cards"
```

---

## Task 5: Owner Revenue Page

**Files:**
- Create: `frontend/src/app/owner/revenue/page.tsx`

- [ ] **Step 1: Buat revenue page**

```tsx
// frontend/src/app/owner/revenue/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchOwnerRevenue } from '@/lib/adminCrmApi';
import type { OwnerRevenueData } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Scissors, ShoppingBag } from 'lucide-react';

const BRANCHES = [
 { key: 'all', label: 'Semua' },
 { key: 'bypass', label: 'Bypass' },
 { key: 'samadikun', label: 'Samadikun' },
 { key: 'csb', label: 'CSB' },
 { key: 'sumber', label: 'Sumber' },
 { key: 'tegal', label: 'Tegal' },
];

const PERIODS = [
 { key: 'today', label: 'Hari ini' },
 { key: '7d', label: '7 Hari' },
 { key: '30d', label: '30 Hari' },
 { key: 'month', label: 'Bulan ini' },
];

function fmt(n: number) {
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
 if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
 return `${n}`;
}

function Skeleton({ className }: { className?: string }) {
 return (
 <motion.div animate={{ opacity: [0.4, 0.7, 0.4] }}
 transition={{ duration: 1.4, repeat: Infinity }}
 className={`bg-slate-800 rounded-lg ${className}`} />
 );
}

const CustomTooltip = ({ active, payload, label }: any) => {
 if (!active || !payload?.length) return null;
 return (
 <div className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 text-xs">
 <p className="text-slate-400 mb-1">{label}</p>
 {payload.map((p: any) => (
 <p key={p.name} style={{ color: p.color }}>
 {p.name === 'moka' ? 'Moka' : 'Web'}: Rp {fmt(p.value)}
 </p>
 ))}
 </div>
 );
};

export default function OwnerRevenuePage() {
 const [branch, setBranch] = useState('all');
 const [period, setPeriod] = useState('7d');
 const [data, setData] = useState<OwnerRevenueData | null>(null);
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 setLoading(true);
 const d = await fetchOwnerRevenue(branch, period).catch(() => null);
 if (d) setData(d);
 setLoading(false);
 }, [branch, period]);

 useEffect(() => { load(); }, [load]);

 // Max revenue for branch bar widths
 const maxBranchRev = data ? Math.max(...data.branch_compare.map(b => b.revenue_moka + b.revenue_web), 1) : 1;

 return (
 <div className="p-4 space-y-4 pb-6">
 <div className="flex items-center gap-2">
 <TrendingUp size={16} className="text-slate-500" />
 <h2 className="text-white font-bold text-base">Revenue</h2>
 </div>

 {/* Branch filter */}
 <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
 {BRANCHES.map(b => (
 <button key={b.key} onClick={() => setBranch(b.key)}
 className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
 branch === b.key ? 'bg-slate-700 text-white border-slate-600' : 'bg-transparent text-slate-500 border-slate-800'
 }`}>
 {b.label}
 </button>
 ))}
 </div>

 {/* Period filter */}
 <div className="flex gap-1.5 bg-slate-900 p-1 rounded-2xl">
 {PERIODS.map(p => (
 <button key={p.key} onClick={() => setPeriod(p.key)}
 className={`flex-1 py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
 period === p.key ? 'bg-slate-700 text-white' : 'text-slate-500'
 }`}>
 {p.label}
 </button>
 ))}
 </div>

 {loading ? (
 <div className="space-y-3">
 <Skeleton className="h-20" />
 <Skeleton className="h-48" />
 <Skeleton className="h-32" />
 </div>
 ) : !data ? (
 <p className="text-center text-slate-500 text-sm py-12">Gagal memuat</p>
 ) : (
 <AnimatePresence mode="wait">
 <motion.div key={`${branch}-${period}`}
 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
 className="space-y-4">

 {/* Summary */}
 <div className="grid grid-cols-2 gap-2">
 {[
 { label: 'Moka', value: `Rp ${fmt(data.summary.revenue_moka)}`, color: 'text-teal-400' },
 { label: 'Web', value: `Rp ${fmt(data.summary.revenue_web)}`, color: 'text-blue-400' },
 { label: 'Total Tx', value: String(data.summary.tx_total), color: 'text-slate-300' },
 { label: 'Avg Tx', value: `Rp ${fmt(data.summary.avg_tx)}`, color: 'text-green-400' },
 ].map((s, i) => (
 <motion.div key={s.label}
 initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.05 }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl px-3 py-2.5">
 <p className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</p>
 <p className="text-[10px] text-slate-500">{s.label}</p>
 </motion.div>
 ))}
 </div>

 {/* Daily trend chart */}
 {data.daily_trend.length > 1 && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
 <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Tren Harian</p>
 <ResponsiveContainer width="100%" height={160}>
 <BarChart data={data.daily_trend} barSize={8} barGap={2}>
 <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={d => d.slice(5)} />
 <YAxis hide />
 <Tooltip content={<CustomTooltip />} />
 <Bar dataKey="moka" fill="#2dd4bf" radius={[4,4,0,0]} />
 <Bar dataKey="web" fill="#60a5fa" radius={[4,4,0,0]} />
 </BarChart>
 </ResponsiveContainer>
 <div className="flex gap-3 mt-2">
 <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block"/>Moka</span>
 <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block"/>Web</span>
 </div>
 </div>
 )}

 {/* Branch compare */}
 {branch === 'all' && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2.5">
 <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Perbandingan Cabang</p>
 {data.branch_compare.map((b, i) => {
 const total = b.revenue_moka + b.revenue_web;
 const pct = Math.round((total / maxBranchRev) * 100);
 return (
 <motion.div key={b.slug}
 initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.06 }}
 className="space-y-1">
 <div className="flex justify-between text-xs">
 <span className="text-slate-300 capitalize">{b.name.replace('RedBox ','')}</span>
 <span className="text-slate-400 tabular-nums">Rp {fmt(total)}</span>
 </div>
 <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
 <motion.div
 initial={{ width: 0 }} animate={{ width: `${pct}%` }}
 transition={{ delay: i * 0.06 + 0.1, duration: 0.5 }}
 className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full" />
 </div>
 </motion.div>
 );
 })}
 </div>
 )}

 {/* Top Barbers */}
 {data.top_barbers.length > 0 && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2">
 <div className="flex items-center gap-1.5">
 <Scissors size={12} className="text-slate-500" />
 <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Top Kapster</p>
 </div>
 {data.top_barbers.map((b, i) => (
 <motion.div key={b.barber_id}
 initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.04 }}
 className="flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <span className="text-[11px] text-slate-600 w-4 tabular-nums">#{i+1}</span>
 <div>
 <p className="text-sm text-slate-200 font-medium">{b.name || b.barber_id}</p>
 <p className="text-[10px] text-slate-500 capitalize">{b.branch} · {b.tx_count}tx</p>
 </div>
 </div>
 <span className="text-sm font-bold text-teal-400 tabular-nums">Rp {fmt(b.revenue)}</span>
 </motion.div>
 ))}
 </div>
 )}

 {/* Top Services */}
 {data.top_services.length > 0 && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-2">
 <div className="flex items-center gap-1.5">
 <ShoppingBag size={12} className="text-slate-500" />
 <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Top Services</p>
 </div>
 {data.top_services.map((s, i) => (
 <motion.div key={s.service_name}
 initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.04 }}
 className="flex items-center justify-between">
 <div>
 <p className="text-sm text-slate-200 font-medium truncate max-w-[180px]">{s.service_name}</p>
 <p className="text-[10px] text-slate-500">{s.count}x</p>
 </div>
 <span className="text-sm font-bold text-slate-300 tabular-nums">Rp {fmt(s.revenue)}</span>
 </motion.div>
 ))}
 </div>
 )}
 </motion.div>
 </AnimatePresence>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/owner/revenue/page.tsx
git commit -m "feat(owner): revenue dashboard — tren harian, perbandingan cabang, top kapster/services"
```

---

## Task 6: Owner Profile Page

**Files:**
- Create: `frontend/src/app/owner/profile/page.tsx`

- [ ] **Step 1: Buat profile page**

```tsx
// frontend/src/app/owner/profile/page.tsx
'use client';
import { useUser } from '@/hooks/useUser';
import { motion } from 'framer-motion';
import { User, Mail, Shield } from 'lucide-react';

export default function OwnerProfilePage() {
 const { user, signOut } = useUser();

 return (
 <div className="p-4 space-y-4 pb-6">
 <div className="flex items-center gap-2">
 <User size={16} className="text-slate-500" />
 <h2 className="text-white font-bold text-base">Profil</h2>
 </div>

 <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
 className="bg-[#0F172A] border border-slate-800 rounded-2xl p-5 space-y-4">
 <div className="flex items-center gap-3">
 <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
 <User size={22} className="text-slate-400" />
 </div>
 <div>
 <p className="font-bold text-white">{user?.name}</p>
 <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] bg-green-500/15 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">
 <Shield size={9} /> Owner
 </span>
 </div>
 </div>
 <div className="border-t border-slate-800 pt-3 space-y-2.5">
 <div className="flex items-center gap-2.5">
 <Mail size={13} className="text-slate-500" />
 <p className="text-sm text-slate-300">{user?.email}</p>
 </div>
 </div>
 </motion.div>

 <button onClick={signOut}
 className="w-full py-3 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-semibold active:scale-95 transition-all cursor-pointer">
 Keluar
 </button>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/owner/profile/page.tsx
git commit -m "feat(owner): owner profile page"
```

---

## Task 7: Admin Layout — Read-only Mode

**Files:**
- Modify: `frontend/src/app/admin/layout.tsx`

- [ ] **Step 1: Update admin layout untuk terima searchParams dan tampilkan back button**

Ganti seluruh isi `frontend/src/app/admin/layout.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { AdminNav } from '@/components/AdminNav';
import { LogOut, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
 const { user, loading, signOut } = useUser();
 const router = useRouter();
 const searchParams = useSearchParams();
 const readonly = searchParams.get('readonly') === 'true';

 useEffect(() => {
 if (!loading && !user) router.replace('/login');
 if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
 }, [user, loading, router]);

 if (loading) {
 return (
 <div className="min-h-dvh bg-[#020617] flex items-center justify-center">
 <motion.div animate={{ opacity: [0.3, 1, 0.3] }}
 transition={{ duration: 1.5, repeat: Infinity }}
 className="text-slate-500 text-sm">Memuat...</motion.div>
 </div>
 );
 }

 return (
 <div className="min-h-dvh bg-[#020617] pb-20">
 <header className="bg-[#0A0F1E]/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
 <div className="flex items-center gap-2">
 {readonly && (
 <button onClick={() => router.push('/owner/dashboard')}
 className="p-1.5 -ml-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer active:scale-95">
 <ChevronLeft size={18} />
 </button>
 )}
 <div>
 <h1 className="font-bold text-white text-sm tracking-wide">REDBOX STAFF</h1>
 {user?.branch && (
 <p className="text-[11px] text-green-400 capitalize font-medium">{user.branch}</p>
 )}
 </div>
 </div>
 {readonly ? (
 <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
 Read-only
 </span>
 ) : (
 <button onClick={signOut}
 className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
 <LogOut size={16} />
 <span className="text-xs">Keluar</span>
 </button>
 )}
 </header>
 <main>{children}</main>
 {!readonly && <AdminNav />}
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/layout.tsx
git commit -m "feat(owner): admin layout readonly mode — back button + hide nav + read-only badge"
```

---

## Task 8: Admin Pages — Read-only Disable Actions

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx`
- Modify: `frontend/src/app/admin/bookings/page.tsx`
- Modify: `frontend/src/app/admin/barbers/page.tsx`
- Modify: `frontend/src/app/admin/schedule/page.tsx`
- Modify: `frontend/src/app/admin/broadcast/page.tsx`

Semua pages baca `readonly` dari URL param yang sama: `useSearchParams().get('readonly') === 'true'`.

- [ ] **Step 1: dashboard/page.tsx — disable Home Service advance button**

Tambah di awal fungsi `OwnerDashboardPage` (setelah `const router`):
```tsx
const searchParams = useSearchParams();
const readonly = searchParams.get('readonly') === 'true';
```

Di `HomeServiceCard`, tambah prop `readonly` dan kondisikan tombol:
```tsx
function HomeServiceCard({ hs, onAdvance, index, readonly }: {
 hs: BookingRow; onAdvance: (id: string, next: string) => void; index: number; readonly?: boolean;
}) {
 const next = HS_NEXT[hs.status];
 return (
 <motion.div ...>
 ...
 {next && !readonly && (
 <button onClick={() => onAdvance(hs.id, next)} ...>
 ...
 </button>
 )}
 </motion.div>
 );
}
```

Pass `readonly` saat render: `<HomeServiceCard ... readonly={readonly} />`

Tambah import di atas: `import { useSearchParams } from 'next/navigation';`

- [ ] **Step 2: bookings/page.tsx — disable Walk-in + action buttons**

Tambah di awal komponen page:
```tsx
const searchParams = useSearchParams();
const readonly = searchParams.get('readonly') === 'true';
```

Kondisikan tombol Walk-in di header:
```tsx
{!readonly && (
 <button onClick={() => setShowWalkIn(true)} ...>+ Walk-in</button>
)}
```

Di `ActionBtn` atau di setiap `<ActionBtn>` call, wrap dengan `{!readonly && <ActionBtn ... />}` untuk semua action buttons (Confirm, Cancel, Done, Reassign, No-show).

Tambah import: `import { useSearchParams } from 'next/navigation';`

- [ ] **Step 3: barbers/page.tsx — disable status buttons**

Tambah di awal komponen page:
```tsx
const searchParams = useSearchParams();
const readonly = searchParams.get('readonly') === 'true';
```

Pada render tombol status, tambah kondisi `disabled`:
```tsx
<button key={s}
 disabled={updating === b.id || readonly}
 onClick={() => !readonly && setStatus(b.id, s)}
 className={`... ${readonly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
 {s}
</button>
```

Tambah import: `import { useSearchParams } from 'next/navigation';`

- [ ] **Step 4: schedule/page.tsx — disable toggle block**

Tambah di awal komponen page:
```tsx
const searchParams = useSearchParams();
const readonly = searchParams.get('readonly') === 'true';
```

Di tombol day cell:
```tsx
<button key={day}
 onClick={() => !readonly && toggleBlock(barber.id, day, isBlocked)}
 disabled={isToggling || readonly}
 className={`... ${readonly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer active:scale-95'}`}>
 {DAY_LABELS[idx]}
</button>
```

Tambah import: `import { useSearchParams } from 'next/navigation';`

- [ ] **Step 5: broadcast/page.tsx — hide compose form**

Tambah di awal komponen page:
```tsx
const searchParams = useSearchParams();
const readonly = searchParams.get('readonly') === 'true';
```

Wrap seluruh compose card dengan `{!readonly && (...)}`:
```tsx
{!readonly && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-3">
 <textarea .../>
 ...
 </div>
)}
{readonly && (
 <div className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 text-center">
 <p className="text-slate-500 text-sm">Mode read-only — tidak bisa kirim broadcast</p>
 </div>
)}
```

Tambah import: `import { useSearchParams } from 'next/navigation';`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx \
 frontend/src/app/admin/bookings/page.tsx \
 frontend/src/app/admin/barbers/page.tsx \
 frontend/src/app/admin/schedule/page.tsx \
 frontend/src/app/admin/broadcast/page.tsx
git commit -m "feat(owner): admin pages readonly mode — disable semua action buttons"
```

---

## Task 9: Deploy + Verifikasi

- [ ] **Step 1: Build check di localhost**

```bash
cd frontend && npx next build 2>&1 | grep -E "Error|error||" | head -20
```

Expected: ` Compiled successfully`

- [ ] **Step 2: Test owner flow di localhost**

1. Login sebagai user dengan `role = 'owner'` di Supabase (set manual via Supabase dashboard jika belum ada: update `users` set `role='owner'` where email = owner email)
2. Buka `http://localhost:3000/owner/dashboard` → harus tampil 5 branch cards
3. Tap branch → harus redirect ke `/admin/dashboard?branch=bypass&readonly=true` dengan back button
4. Buka `http://localhost:3000/owner/revenue` → harus tampil chart + top barbers
5. Verifikasi tombol aksi di booking/absensi/jadwal/broadcast semua disabled

- [ ] **Step 3: Deploy ke Vercel**

```bash
cd frontend && vercel deploy --prod --token "TOKEN_DARI_ENV" --yes
```

- [ ] **Step 4: Set owner user di production Supabase**

Via Supabase SQL editor di `https://supabase.com/dashboard/project/khcvklzxfohwkyocenaf`:
```sql
UPDATE users SET role = 'owner', branch = null
WHERE email = 'EMAIL_OWNER_DISINI';
```

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(owner): owner role complete — overview, revenue dashboard, readonly admin view"
git push
```
