# Admin & Barber PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun PWA internal RedBox Barbershop untuk admin (monitor semua cabang) dan barber (jadwal pribadi + push notifikasi) di atas Next.js yang sudah ada.

**Architecture:** PWA berbasis Next.js App Router di atas backend Express + Supabase yang tidak diubah. Auth via Supabase Auth + tabel `users` untuk role. Admin calls ke backend diproxy lewat Next.js API routes (menyembunyikan ADMIN_TOKEN). Web Push via service worker untuk notifikasi internal barber.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS 4, Supabase (Auth + Realtime), Web Push API, `web-push` npm package (server), TypeScript

**Spec:** `docs/superpowers/specs/2026-06-01-admin-barber-pwa-design.md`

---

## File Map

### Baru (frontend)
```
frontend/public/
 manifest.json ← PWA manifest
 sw.js ← Service worker (push + offline)
 icons/icon-192.png ← Salin dari Brand_assets/RedBox Logo.png (resize)
 icons/icon-512.png ← Salin dari Brand_assets/RedBox Logo.png (resize)

frontend/src/
 lib/
 api.ts ← Typed fetch wrappers ke Express API
 constants.ts ← BRANCHES, STATUS_LABELS, SERVICE_PRICES
 hooks/
 useUser.ts ← Current user + role dari Supabase
 usePush.ts ← Subscribe/unsubscribe Web Push
 components/
 BranchFilter.tsx ← Tab filter cabang (Semua|Bypass|Samadikun|...)
 StatusBadge.tsx ← Badge warna per booking status
 BookingCard.tsx ← Card satu booking (dipakai di admin & barber)
 BottomNav.tsx ← Navigasi bawah (PWA style)
 app/
 login/page.tsx ← Halaman login email+password
 admin/layout.tsx ← Shell admin (nav + auth guard)
 admin/dashboard/page.tsx ← Dashboard semua cabang
 admin/bookings/page.tsx ← List booking + filter + ubah status
 admin/barbers/page.tsx ← Kelola barber (toggle, override)
 barber/layout.tsx ← Shell barber (nav + auth guard)
 barber/schedule/page.tsx ← Jadwal pribadi + realtime
 barber/home-service/page.tsx ← Job home service aktif
 barber/notifications/page.tsx ← Log notifikasi
 api/
 admin/booking-status/route.ts ← Proxy POST /api/booking-status
 admin/barber-toggle/[id]/route.ts ← Proxy POST /api/barbers/:id/toggle-active
 admin/barber-override/[id]/route.ts ← Proxy POST /api/barbers/:id/today-override
 push/subscribe/route.ts ← Proxy POST /api/push/subscribe
```

### Modifikasi (frontend)
```
frontend/src/app/layout.tsx ← Tambah PWA meta tags + SW registration
frontend/src/middleware.ts ← Role-based redirect setelah auth
frontend/next.config.ts ← Tambah env vars + headers SW
```

### Baru (server)
```
server/services/webPush.js ← Kirim Web Push notification
server/migrations/004_users_push.sql ← Tabel users + push_subscriptions
```

### Modifikasi (server)
```
server/index.js ← Tambah POST /api/push/subscribe + /send
 Panggil webPush.js saat booking baru
```

---

## Task 1: Database Migrations

**Files:**
- Create: `server/migrations/004_users_push.sql`
- Apply: Supabase SQL editor

- [ ] **Step 1: Tulis migration SQL**

Buat file `server/migrations/004_users_push.sql`:

```sql
-- Tabel profil user (extend Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('owner', 'branch_admin', 'barber')),
 branch TEXT, -- NULL untuk owner; 'bypass'|'samadikun'|'csb'|'sumber'|'tegal' untuk lainnya
 barber_id TEXT, -- diisi untuk role 'barber', referensi ke barbers.id
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRANT wajib (Supabase policy project)
GRANT SELECT, INSERT, UPDATE ON users TO anon, authenticated;

-- Tabel push subscription token per device
CREATE TABLE IF NOT EXISTS push_subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRANT wajib
GRANT SELECT, INSERT, DELETE ON push_subscriptions TO anon, authenticated;
```

- [ ] **Step 2: Jalankan di Supabase**

Buka Supabase Dashboard → SQL Editor → paste isi file → Run.

Verifikasi:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
 AND table_name IN ('users', 'push_subscriptions');
-- Expected: 2 rows
```

- [ ] **Step 3: Seed satu akun owner untuk testing**

Buat user di Supabase Authentication → Users → Add User (email: `owner@redbox.id`, password bebas).
Catat UUID-nya, lalu jalankan:

```sql
INSERT INTO users (id, name, role, branch, barber_id)
VALUES ('<UUID-dari-auth>', 'Owner RedBox', 'owner', NULL, NULL);
```

- [ ] **Step 4: Commit migration file**

```bash
git add server/migrations/004_users_push.sql
git commit -m "feat: add users and push_subscriptions tables"
```

---

## Task 2: Konstanta, Tipe, dan API Client

**Files:**
- Create: `frontend/src/lib/constants.ts`
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Tulis konstanta**

Buat `frontend/src/lib/constants.ts`:

```typescript
export const BRANCHES = [
 { key: 'all', label: 'Semua' },
 { key: 'bypass', label: 'Bypass' },
 { key: 'samadikun', label: 'Samadikun' },
 { key: 'csb', label: 'CSB' },
 { key: 'sumber', label: 'Sumber' },
 { key: 'tegal', label: 'Tegal' },
] as const;

export type BranchKey = typeof BRANCHES[number]['key'];

export const BOOKING_STATUSES = ['pending', 'confirmed', 'done', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];

export const STATUS_LABELS: Record<BookingStatus, string> = {
 pending: 'Pending',
 confirmed: 'Konfirmasi',
 done: 'Selesai',
 cancelled: 'Batal',
};

export const STATUS_COLORS: Record<BookingStatus, string> = {
 pending: 'bg-yellow-100 text-yellow-800',
 confirmed: 'bg-blue-100 text-blue-800',
 done: 'bg-green-100 text-green-800',
 cancelled: 'bg-red-100 text-red-800',
};

// Harga default per service (Rp) — dipakai estimasi revenue jika booking.price kosong
export const SERVICE_PRICES: Record<string, number> = {
 'Gunting': 45000,
 'Gunting + Cuci': 55000,
 'Full Service': 85000,
 'Fade Cut': 55000,
 'Hair Tattoo': 65000,
 'Cukur Jenggot': 35000,
 'Traditional Shave': 45000,
 'Creambath': 75000,
 'Hair Color': 120000,
 'Smoothing': 250000,
};
```

- [ ] **Step 2: Tulis tipe booking dan barber**

Tambahkan ke `frontend/src/lib/constants.ts`:

```typescript
export interface Booking {
 id: string;
 date: string; // YYYY-MM-DD
 time: string; // HH:MM
 customer_name: string;
 customer_phone: string;
 barber_id: string | null;
 barber_name: string | null;
 service: string;
 location: string;
 status: BookingStatus;
 price: number | null;
 address: string | null; // home service
 type: string | null; // 'home_service' | null
}

export interface Barber {
 id: string;
 name: string;
 branch: string;
 is_active: boolean;
 today_override: boolean | null;
 phone: string | null;
}

export interface StatsResponse {
 today: number;
 done: number;
 pending: number;
 customers: number;
}

export interface RevenueResponse {
 total: number;
 count: number;
 period: { from: string; to: string };
 by_branch: Array<{ name: string; revenue: number }>;
 by_barber: Array<{ name: string; revenue: number }>;
 by_date: Array<{ date: string; revenue: number }>;
}
```

- [ ] **Step 3: Tulis API client**

Buat `frontend/src/lib/api.ts`:

```typescript
import type { Booking, Barber, StatsResponse, RevenueResponse } from './constants';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
 const res = await fetch(`${BASE}${path}`, {
 headers: { 'Content-Type': 'application/json', ...init?.headers },
 ...init,
 });
 if (!res.ok) {
 const text = await res.text().catch(() => '');
 throw new Error(`API ${path} → ${res.status}: ${text}`);
 }
 return res.json() as Promise<T>;
}

// ─── Bookings ────────────────────────────────────────────────
export function fetchBookings(params: {
 date?: string;
 location?: string;
 barber_id?: string;
 status?: string;
}) {
 const q = new URLSearchParams();
 if (params.date) q.set('date', params.date);
 if (params.location && params.location !== 'all') q.set('location', params.location);
 if (params.barber_id) q.set('barber_id', params.barber_id);
 if (params.status) q.set('status', params.status);
 return fetchJSON<Booking[]>(`/api/bookings?${q}`);
}

// ─── Barbers ─────────────────────────────────────────────────
export function fetchBarbers(includeInactive = true) {
 return fetchJSON<Barber[]>(`/api/barbers${includeInactive ? '?include_inactive=1' : ''}`);
}

// ─── Stats & Revenue ─────────────────────────────────────────
export function fetchStats() {
 return fetchJSON<StatsResponse>('/api/stats');
}

export function fetchRevenue(period: 'week' | 'month' = 'month', branch?: string) {
 const q = new URLSearchParams({ period });
 if (branch && branch !== 'all') q.set('branch', branch);
 return fetchJSON<RevenueResponse>(`/api/revenue?${q}`);
}
```

- [ ] **Step 4: Tambah NEXT_PUBLIC_API_URL ke env**

Buka/buat `frontend/.env.local`, tambahkan:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Untuk production di Vercel, tambah env var `NEXT_PUBLIC_API_URL` yang mengarah ke URL Express server yang di-deploy.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/constants.ts frontend/src/lib/api.ts frontend/.env.local
git commit -m "feat: add api client, types, and constants"
```

---

## Task 3: Komponen Shared

**Files:**
- Create: `frontend/src/components/BranchFilter.tsx`
- Create: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/components/BookingCard.tsx`
- Create: `frontend/src/components/BottomNav.tsx`

- [ ] **Step 1: BranchFilter**

Buat `frontend/src/components/BranchFilter.tsx`:

```typescript
'use client';
import { BRANCHES, type BranchKey } from '@/lib/constants';

interface Props {
 value: BranchKey;
 onChange: (branch: BranchKey) => void;
}

export function BranchFilter({ value, onChange }: Props) {
 return (
 <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
 {BRANCHES.map((b) => (
 <button
 key={b.key}
 onClick={() => onChange(b.key)}
 className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
 value === b.key
 ? 'bg-red-600 text-white'
 : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
 }`}
 >
 {b.label}
 </button>
 ))}
 </div>
 );
}
```

- [ ] **Step 2: StatusBadge**

Buat `frontend/src/components/StatusBadge.tsx`:

```typescript
import { STATUS_LABELS, STATUS_COLORS, type BookingStatus } from '@/lib/constants';

export function StatusBadge({ status }: { status: BookingStatus }) {
 return (
 <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}>
 {STATUS_LABELS[status]}
 </span>
 );
}
```

- [ ] **Step 3: BookingCard**

Buat `frontend/src/components/BookingCard.tsx`:

```typescript
import { type Booking } from '@/lib/constants';
import { StatusBadge } from './StatusBadge';

interface Props {
 booking: Booking;
 onStatusChange?: (id: string, status: string) => void;
 showBranch?: boolean;
}

export function BookingCard({ booking, onStatusChange, showBranch = false }: Props) {
 return (
 <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <div className="flex justify-between items-start mb-2">
 <div>
 <p className="font-semibold text-gray-900">{booking.customer_name}</p>
 <p className="text-sm text-gray-500">{booking.time} · {booking.service}</p>
 {showBranch && (
 <p className="text-xs text-gray-400 mt-0.5 capitalize">{booking.location}</p>
 )}
 {booking.type === 'home_service' && (
 <span className="inline-block mt-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
 Home Service
 </span>
 )}
 </div>
 <StatusBadge status={booking.status} />
 </div>
 {booking.barber_name && (
 <p className="text-sm text-gray-600"> {booking.barber_name}</p>
 )}
 {onStatusChange && booking.status !== 'done' && booking.status !== 'cancelled' && (
 <div className="flex gap-2 mt-3">
 {booking.status === 'pending' && (
 <button
 onClick={() => onStatusChange(booking.id, 'confirmed')}
 className="flex-1 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
 >
 Konfirmasi
 </button>
 )}
 {booking.status !== 'done' && (
 <button
 onClick={() => onStatusChange(booking.id, 'done')}
 className="flex-1 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
 >
 Selesai
 </button>
 )}
 <button
 onClick={() => onStatusChange(booking.id, 'cancelled')}
 className="py-1.5 px-3 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
 >
 Batal
 </button>
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 4: BottomNav**

Buat `frontend/src/components/BottomNav.tsx`:

```typescript
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
 href: string;
 label: string;
 icon: string;
}

interface Props {
 items: NavItem[];
}

export function BottomNav({ items }: Props) {
 const pathname = usePathname();
 return (
 <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex safe-area-inset-bottom">
 {items.map((item) => {
 const active = pathname.startsWith(item.href);
 return (
 <Link
 key={item.href}
 href={item.href}
 className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
 active ? 'text-red-600' : 'text-gray-500'
 }`}
 >
 <span className="text-xl mb-0.5">{item.icon}</span>
 {item.label}
 </Link>
 );
 })}
 </nav>
 );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add shared UI components (BranchFilter, StatusBadge, BookingCard, BottomNav)"
```

---

## Task 4: Auth — Login Page, useUser Hook, Middleware

**Files:**
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/hooks/useUser.ts`
- Modify: `frontend/src/middleware.ts`

- [ ] **Step 1: Hook useUser**

Buat `frontend/src/hooks/useUser.ts`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export interface AppUser {
 id: string;
 email: string;
 name: string;
 role: 'owner' | 'branch_admin' | 'barber';
 branch: string | null;
 barber_id: string | null;
}

export function useUser() {
 const [user, setUser] = useState<AppUser | null>(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const supabase = createClient();

 async function load() {
 const { data: { user: authUser } } = await supabase.auth.getUser();
 if (!authUser) { setUser(null); setLoading(false); return; }

 const { data } = await supabase
 .from('users')
 .select('name, role, branch, barber_id')
 .eq('id', authUser.id)
 .single();

 if (data) {
 setUser({
 id: authUser.id,
 email: authUser.email ?? '',
 name: data.name,
 role: data.role,
 branch: data.branch,
 barber_id: data.barber_id,
 });
 }
 setLoading(false);
 }

 load();

 const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load());
 return () => subscription.unsubscribe();
 }, []);

 async function signOut() {
 await createClient().auth.signOut();
 window.location.href = '/login';
 }

 return { user, loading, signOut };
}
```

- [ ] **Step 2: Login page**

Buat `frontend/src/app/login/page.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
 const router = useRouter();
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 setError('');
 setLoading(true);

 const supabase = createClient();
 const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
 if (authError) {
 setError('Email atau password salah');
 setLoading(false);
 return;
 }

 // Ambil role untuk redirect
 const { data: { user } } = await supabase.auth.getUser();
 if (!user) { setError('Login gagal'); setLoading(false); return; }

 const { data: profile } = await supabase
 .from('users')
 .select('role')
 .eq('id', user.id)
 .single();

 if (profile?.role === 'barber') {
 router.push('/barber/schedule');
 } else {
 router.push('/admin/dashboard');
 }
 }

 return (
 <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
 <div className="w-full max-w-sm">
 <div className="text-center mb-8">
 <div className="text-4xl mb-2"></div>
 <h1 className="text-2xl font-bold text-white">RedBox Staff</h1>
 <p className="text-gray-400 text-sm mt-1">Masuk ke akun Anda</p>
 </div>

 <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-6 space-y-4">
 <div>
 <label className="block text-sm text-gray-300 mb-1">Email</label>
 <input
 type="email"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 required
 className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
 placeholder="email@redbox.id"
 />
 </div>
 <div>
 <label className="block text-sm text-gray-300 mb-1">Password</label>
 <input
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 required
 className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
 placeholder="••••••••"
 />
 </div>
 {error && <p className="text-red-400 text-sm">{error}</p>}
 <button
 type="submit"
 disabled={loading}
 className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
 >
 {loading ? 'Masuk...' : 'Masuk'}
 </button>
 </form>
 </div>
 </div>
 );
}
```

- [ ] **Step 3: Update middleware untuk role-based redirect**

Ganti seluruh isi `frontend/src/middleware.ts`:

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function middleware(request: NextRequest) {
 const { pathname } = request.nextUrl;

 // Public routes — tidak perlu auth
 if (
 pathname.startsWith('/login') ||
 pathname.startsWith('/ai-hairstyle') ||
 pathname.startsWith('/api/ai-hairstyle') ||
 pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json)$/)
 ) {
 return NextResponse.next();
 }

 if (!supabaseUrl || !supabaseKey) return NextResponse.next();

 let response = NextResponse.next({ request: { headers: request.headers } });

 const supabase = createServerClient(supabaseUrl, supabaseKey, {
 cookies: {
 getAll: () => request.cookies.getAll(),
 setAll: (cookies) => {
 cookies.forEach(({ name, value }) => request.cookies.set(name, value));
 response = NextResponse.next({ request });
 cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
 },
 },
 });

 const { data: { user } } = await supabase.auth.getUser();

 // Tidak login → redirect ke /login
 if (!user) {
 return NextResponse.redirect(new URL('/login', request.url));
 }

 // Root redirect ke dashboard sesuai role
 if (pathname === '/') {
 const { data: profile } = await supabase
 .from('users')
 .select('role')
 .eq('id', user.id)
 .single();

 const dest = profile?.role === 'barber' ? '/barber/schedule' : '/admin/dashboard';
 return NextResponse.redirect(new URL(dest, request.url));
 }

 return response;
}

export const config = {
 matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Verifikasi login flow**

```bash
cd frontend && npm run dev
```

Buka `http://localhost:3000/login` → isi email+password akun owner yang dibuat di Task 1 → pastikan redirect ke `/admin/dashboard` (halaman 404 dulu, tapi redirect harus terjadi).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/login/ frontend/src/hooks/useUser.ts frontend/src/middleware.ts
git commit -m "feat: auth login page, useUser hook, role-based middleware"
```

---

## Task 5: Admin Layout Shell

**Files:**
- Create: `frontend/src/app/admin/layout.tsx`

- [ ] **Step 1: Tulis admin layout**

Buat `frontend/src/app/admin/layout.tsx`:

```typescript
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { BottomNav } from '@/components/BottomNav';

const ADMIN_NAV = [
 { href: '/admin/dashboard', label: 'Dashboard', icon: '' },
 { href: '/admin/bookings', label: 'Booking', icon: '' },
 { href: '/admin/barbers', label: 'Barber', icon: '' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
 const { user, loading, signOut } = useUser();
 const router = useRouter();

 useEffect(() => {
 if (!loading && !user) router.replace('/login');
 if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
 }, [user, loading, router]);

 if (loading) {
 return (
 <div className="min-h-screen bg-gray-50 flex items-center justify-center">
 <div className="text-gray-400">Memuat...</div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gray-50 pb-20">
 <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-10">
 <div>
 <h1 className="font-bold text-gray-900">RedBox Staff</h1>
 {user?.branch && (
 <p className="text-xs text-gray-500 capitalize">{user.branch}</p>
 )}
 </div>
 <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-700">
 Keluar
 </button>
 </header>
 <main>{children}</main>
 <BottomNav items={ADMIN_NAV} />
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/admin/layout.tsx
git commit -m "feat: admin layout shell with bottom nav"
```

---

## Task 6: Admin Dashboard

**Files:**
- Create: `frontend/src/app/admin/dashboard/page.tsx`
- Modify: `frontend/src/lib/api.ts` — tambah fetchBarbers with branch filter

- [ ] **Step 1: Tambah fetchBarbersByBranch ke api.ts**

Buka `frontend/src/lib/api.ts`, tambahkan di bawah `fetchBarbers`:

```typescript
export async function fetchBookingsByBranch(date: string, location: string) {
 return fetchBookings({ date, location });
}
```

- [ ] **Step 2: Tulis Dashboard page**

Buat `frontend/src/app/admin/dashboard/page.tsx`:

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { fetchBookings, fetchBarbers, fetchStats, fetchRevenue } from '@/lib/api';
import { type BranchKey, type Booking, type Barber } from '@/lib/constants';

function rupiah(n: number) {
 return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function DashboardPage() {
 const { user } = useUser();
 const [branch, setBranch] = useState<BranchKey>('all');
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [barbers, setBarbers] = useState<Barber[]>([]);
 const [revenue, setRevenue] = useState(0);
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 setLoading(true);
 try {
 const [bks, brs, rev] = await Promise.all([
 fetchBookings({ date: todayStr(), location: branch }),
 fetchBarbers(true),
 fetchRevenue('month', branch),
 ]);
 setBookings(bks);
 setBarbers(brs.filter(b => branch === 'all' || b.branch === branch));
 setRevenue(rev.total);
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }, [branch]);

 useEffect(() => { load(); }, [load]);

 // Auto-refresh tiap 60 detik
 useEffect(() => {
 const t = setInterval(load, 60_000);
 return () => clearInterval(t);
 }, [load]);

 // Filter branch_admin ke cabang mereka saja
 const effectiveBranch = user?.role === 'branch_admin' ? (user.branch as BranchKey ?? 'all') : branch;

 const done = bookings.filter(b => b.status === 'done').length;
 const pending = bookings.filter(b => b.status === 'pending' || b.status === 'confirmed').length;
 const activeBarbers = barbers.filter(b => b.is_active && !b.today_override).length;
 const inactiveBarbers = barbers.filter(b => !b.is_active || b.today_override).length;

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Dashboard</h2>

 {user?.role === 'owner' && (
 <BranchFilter value={branch} onChange={setBranch} />
 )}

 {loading ? (
 <div className="text-center py-10 text-gray-400">Memuat data...</div>
 ) : (
 <>
 {/* Booking Card */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
 <p className="text-sm text-gray-500 mb-3"> Booking Hari Ini</p>
 <p className="text-3xl font-bold text-gray-900">{bookings.length}</p>
 <div className="flex gap-4 mt-3">
 <div>
 <p className="text-2xl font-semibold text-green-600">{done}</p>
 <p className="text-xs text-gray-500">Selesai</p>
 </div>
 <div>
 <p className="text-2xl font-semibold text-yellow-600">{pending}</p>
 <p className="text-xs text-gray-500">Proses</p>
 </div>
 <div>
 <p className="text-2xl font-semibold text-red-500">
 {bookings.filter(b => b.status === 'cancelled').length}
 </p>
 <p className="text-xs text-gray-500">Batal</p>
 </div>
 </div>
 </div>

 {/* Barber Card */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
 <p className="text-sm text-gray-500 mb-3"> Status Barber</p>
 <div className="flex gap-4">
 <div>
 <p className="text-2xl font-semibold text-green-600">{activeBarbers}</p>
 <p className="text-xs text-gray-500">Aktif</p>
 </div>
 <div>
 <p className="text-2xl font-semibold text-red-500">{inactiveBarbers}</p>
 <p className="text-xs text-gray-500">Tidak Aktif</p>
 </div>
 </div>
 {inactiveBarbers > 0 && (
 <div className="mt-3 space-y-1">
 {barbers
 .filter(b => !b.is_active || b.today_override)
 .map(b => (
 <p key={b.id} className="text-sm text-red-500">
 {b.name} <span className="text-gray-400 text-xs capitalize">({b.branch})</span>
 </p>
 ))}
 </div>
 )}
 </div>

 {/* Revenue Card */}
 <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
 <p className="text-sm text-gray-500 mb-1"> Estimasi Revenue (30 hari)</p>
 <p className="text-2xl font-bold text-gray-900">{rupiah(revenue)}</p>
 <p className="text-xs text-gray-400 mt-1">Dari {bookings.filter(b=>b.status==='done').length} booking selesai hari ini</p>
 </div>
 </>
 )}
 </div>
 );
}
```

- [ ] **Step 3: Test dashboard**

```bash
cd frontend && npm run dev
```

Login sebagai owner → pastikan redirect ke `/admin/dashboard` → cek 3 card muncul → cek filter cabang berfungsi.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/dashboard/ frontend/src/lib/api.ts
git commit -m "feat: admin dashboard with booking stats, barber status, revenue"
```

---

## Task 7: Admin Bookings

**Files:**
- Create: `frontend/src/app/admin/bookings/page.tsx`
- Create: `frontend/src/app/api/admin/booking-status/route.ts`

- [ ] **Step 1: Next.js API route proxy untuk booking-status**

Buat `frontend/src/app/api/admin/booking-status/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/booking-status`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'x-admin-token': ADMIN_TOKEN,
 },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

Tambahkan ke `frontend/.env.local`:
```
API_URL=http://localhost:3001
ADMIN_TOKEN=isi_dengan_ADMIN_PASSWORD_dari_server_.env
```

- [ ] **Step 2: Tulis Bookings page**

Buat `frontend/src/app/admin/bookings/page.tsx`:

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { BOOKING_STATUSES, type BranchKey, type Booking, type BookingStatus } from '@/lib/constants';

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function BookingsPage() {
 const { user } = useUser();
 const [branch, setBranch] = useState<BranchKey>('all');
 const [date, setDate] = useState(todayStr());
 const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 setLoading(true);
 try {
 const data = await fetchBookings({
 date,
 location: branch,
 status: statusFilter !== 'all' ? statusFilter : undefined,
 });
 setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }, [branch, date, statusFilter]);

 useEffect(() => { load(); }, [load]);

 async function handleStatusChange(id: string, status: string) {
 try {
 await fetch('/api/admin/booking-status', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ booking_id: id, status }),
 });
 load();
 } catch (e) {
 console.error(e);
 }
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Booking</h2>

 {user?.role === 'owner' && (
 <BranchFilter value={branch} onChange={setBranch} />
 )}

 <div className="flex gap-2 items-center">
 <input
 type="date"
 value={date}
 onChange={(e) => setDate(e.target.value)}
 className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
 />
 <select
 value={statusFilter}
 onChange={(e) => setStatusFilter(e.target.value as BookingStatus | 'all')}
 className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
 >
 <option value="all">Semua Status</option>
 {BOOKING_STATUSES.map(s => (
 <option key={s} value={s}>{s}</option>
 ))}
 </select>
 </div>

 {loading ? (
 <div className="text-center py-10 text-gray-400">Memuat...</div>
 ) : bookings.length === 0 ? (
 <div className="text-center py-10 text-gray-400">Tidak ada booking</div>
 ) : (
 <div className="space-y-3">
 {bookings.map(b => (
 <BookingCard
 key={b.id}
 booking={b}
 onStatusChange={handleStatusChange}
 showBranch={branch === 'all'}
 />
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 3: Test**

Login sebagai owner → `/admin/bookings` → ganti tanggal → pastikan booking muncul → coba ubah status satu booking → pastikan perubahan terefleksi.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/bookings/ frontend/src/app/api/admin/booking-status/
git commit -m "feat: admin bookings page with filter and status change"
```

---

## Task 8: Admin Barbers

**Files:**
- Create: `frontend/src/app/admin/barbers/page.tsx`
- Create: `frontend/src/app/api/admin/barber-toggle/[id]/route.ts`
- Create: `frontend/src/app/api/admin/barber-override/[id]/route.ts`

- [ ] **Step 1: Proxy routes untuk barber actions**

Buat `frontend/src/app/api/admin/barber-toggle/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 const res = await fetch(`${API_URL}/api/barbers/${id}/toggle-active`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

Buat `frontend/src/app/api/admin/barber-override/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/barbers/${id}/today-override`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Tulis Barbers page**

Buat `frontend/src/app/admin/barbers/page.tsx`:

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { BranchFilter } from '@/components/BranchFilter';
import { fetchBarbers } from '@/lib/api';
import { type BranchKey, type Barber } from '@/lib/constants';

export default function BarbersPage() {
 const { user } = useUser();
 const [branch, setBranch] = useState<BranchKey>('all');
 const [barbers, setBarbers] = useState<Barber[]>([]);
 const [loading, setLoading] = useState(true);

 const load = useCallback(async () => {
 setLoading(true);
 try {
 const data = await fetchBarbers(true);
 setBarbers(data);
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => { load(); }, [load]);

 const filtered = barbers.filter(b => branch === 'all' || b.branch === branch);

 async function toggleActive(barber: Barber) {
 try {
 await fetch(`/api/admin/barber-toggle/${barber.id}`, { method: 'POST' });
 load();
 } catch (e) { console.error(e); }
 }

 async function toggleOverride(barber: Barber) {
 try {
 await fetch(`/api/admin/barber-override/${barber.id}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ override: !barber.today_override }),
 });
 load();
 } catch (e) { console.error(e); }
 }

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Barber</h2>

 {user?.role === 'owner' && (
 <BranchFilter value={branch} onChange={setBranch} />
 )}

 {loading ? (
 <div className="text-center py-10 text-gray-400">Memuat...</div>
 ) : (
 <div className="space-y-3">
 {filtered.map(barber => {
 const isOff = !barber.is_active || !!barber.today_override;
 return (
 <div key={barber.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
 <div className="flex justify-between items-center">
 <div>
 <p className="font-semibold text-gray-900">{barber.name}</p>
 <p className="text-sm text-gray-500 capitalize">{barber.branch}</p>
 </div>
 <span className={`text-sm font-medium ${isOff ? 'text-red-500' : 'text-green-600'}`}>
 {isOff ? ' Nonaktif' : '🟢 Aktif'}
 </span>
 </div>
 <div className="flex gap-2 mt-3">
 <button
 onClick={() => toggleActive(barber)}
 className="flex-1 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
 >
 {barber.is_active ? 'Nonaktifkan' : 'Aktifkan'}
 </button>
 <button
 onClick={() => toggleOverride(barber)}
 className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
 barber.today_override
 ? 'bg-orange-50 text-orange-700 border border-orange-200'
 : 'border border-gray-200 hover:bg-gray-50'
 }`}
 >
 {barber.today_override ? 'Batal Libur' : 'Libur Hari Ini'}
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 3: Test**

Login sebagai owner → `/admin/barbers` → coba toggle satu barber → refresh → pastikan status berubah.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/barbers/ frontend/src/app/api/admin/
git commit -m "feat: admin barbers page with toggle active and today-override"
```

---

## Task 9: Barber Layout + Schedule

**Files:**
- Create: `frontend/src/app/barber/layout.tsx`
- Create: `frontend/src/app/barber/schedule/page.tsx`

- [ ] **Step 1: Barber layout**

Buat `frontend/src/app/barber/layout.tsx`:

```typescript
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { BottomNav } from '@/components/BottomNav';

const BARBER_NAV = [
 { href: '/barber/schedule', label: 'Jadwal', icon: '' },
 { href: '/barber/home-service', label: 'Home Svc', icon: '' },
 { href: '/barber/notifications', label: 'Notifikasi', icon: '' },
];

export default function BarberLayout({ children }: { children: React.ReactNode }) {
 const { user, loading, signOut } = useUser();
 const router = useRouter();

 useEffect(() => {
 if (!loading && !user) router.replace('/login');
 if (!loading && user && user.role !== 'barber') router.replace('/admin/dashboard');
 }, [user, loading, router]);

 if (loading) {
 return (
 <div className="min-h-screen bg-gray-50 flex items-center justify-center">
 <div className="text-gray-400">Memuat...</div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gray-50 pb-20">
 <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-10">
 <div>
 <h1 className="font-bold text-gray-900">{user?.name ?? 'Barber'}</h1>
 <p className="text-xs text-gray-500 capitalize">{user?.branch}</p>
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

- [ ] **Step 2: Barber schedule page dengan Supabase Realtime**

Buat `frontend/src/app/barber/schedule/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { BookingCard } from '@/components/BookingCard';
import { fetchBookings } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { type Booking } from '@/lib/constants';

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayLabel() {
 return new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function SchedulePage() {
 const { user } = useUser();
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [loading, setLoading] = useState(true);

 async function load(barberId: string) {
 try {
 const data = await fetchBookings({ date: todayStr(), barber_id: barberId });
 setBookings(data.sort((a, b) => a.time.localeCompare(b.time)));
 } catch (e) {
 console.error(e);
 } finally {
 setLoading(false);
 }
 }

 useEffect(() => {
 if (!user?.barber_id) return;
 load(user.barber_id);

 // Subscribe Supabase Realtime — booking baru atau perubahan status
 const supabase = createClient();
 const channel = supabase
 .channel('barber-schedule')
 .on(
 'postgres_changes',
 {
 event: '*',
 schema: 'public',
 table: 'bookings',
 filter: `barber_id=eq.${user.barber_id}`,
 },
 () => load(user.barber_id!)
 )
 .subscribe();

 return () => { supabase.removeChannel(channel); };
 }, [user?.barber_id]);

 if (loading) {
 return <div className="p-4 text-center py-10 text-gray-400">Memuat jadwal...</div>;
 }

 return (
 <div className="p-4 space-y-4">
 <div>
 <h2 className="text-lg font-bold text-gray-900">Jadwal Saya</h2>
 <p className="text-sm text-gray-500">{todayLabel()}</p>
 </div>

 {bookings.length === 0 ? (
 <div className="text-center py-16">
 <p className="text-4xl mb-3"></p>
 <p className="text-gray-500">Belum ada jadwal hari ini</p>
 </div>
 ) : (
 <div className="space-y-3">
 {bookings.map(b => (
 <BookingCard key={b.id} booking={b} />
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 3: Test realtime**

Login sebagai barber → buka `/barber/schedule` → dari Supabase dashboard, insert atau update satu booking dengan barber_id yang sesuai → pastikan jadwal update otomatis tanpa refresh.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/barber/
git commit -m "feat: barber layout and schedule page with realtime updates"
```

---

## Task 10: Barber Home Service & Notifications

**Files:**
- Create: `frontend/src/app/barber/home-service/page.tsx`
- Create: `frontend/src/app/barber/notifications/page.tsx`

- [ ] **Step 1: Home Service page**

Buat `frontend/src/app/barber/home-service/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchBookings } from '@/lib/api';
import { type Booking } from '@/lib/constants';

function todayStr() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function HomeServicePage() {
 const { user } = useUser();
 const [jobs, setJobs] = useState<Booking[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!user?.barber_id) return;
 fetchBookings({ date: todayStr(), barber_id: user.barber_id })
 .then(data => {
 setJobs(data.filter(b => b.type === 'home_service' && b.status !== 'cancelled'));
 })
 .catch(console.error)
 .finally(() => setLoading(false));
 }, [user?.barber_id]);

 if (loading) return <div className="p-4 text-center py-10 text-gray-400">Memuat...</div>;

 return (
 <div className="p-4 space-y-4">
 <h2 className="text-lg font-bold text-gray-900">Home Service</h2>

 {jobs.length === 0 ? (
 <div className="text-center py-16">
 <p className="text-4xl mb-3"></p>
 <p className="text-gray-500">Tidak ada job home service hari ini</p>
 </div>
 ) : (
 <div className="space-y-3">
 {jobs.map(job => (
 <div key={job.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
 <div className="flex justify-between items-start">
 <div>
 <p className="font-bold text-gray-900">{job.customer_name}</p>
 <p className="text-sm text-gray-500"> {job.time} · {job.service}</p>
 </div>
 <span className={`text-xs px-2 py-1 rounded-full font-medium ${
 job.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
 }`}>
 {job.status === 'done' ? 'Selesai' : 'Aktif'}
 </span>
 </div>

 {job.address && (
 <div className="bg-gray-50 rounded-xl p-3">
 <p className="text-xs text-gray-500 mb-1"> Alamat</p>
 <p className="text-sm text-gray-900">{job.address}</p>
 </div>
 )}

 <div className="flex gap-2">
 {job.address && (
 <a
 href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
 target="_blank"
 rel="noopener noreferrer"
 className="flex-1 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl text-center hover:bg-blue-700 transition-colors"
 >
 Buka Maps
 </a>
 )}
 {job.customer_phone && (
 <a
 href={`https://wa.me/${job.customer_phone.replace(/\D/g, '')}`}
 target="_blank"
 rel="noopener noreferrer"
 className="flex-1 py-2.5 text-sm font-medium bg-green-600 text-white rounded-xl text-center hover:bg-green-700 transition-colors"
 >
 WA Customer
 </a>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Notifications page**

Buat `frontend/src/app/barber/notifications/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useUser } from '@/hooks/useUser';

interface Notif {
 id: string;
 title: string;
 body: string;
 created_at: string;
 read: boolean;
}

export default function NotificationsPage() {
 const { user } = useUser();
 const [notifs, setNotifs] = useState<Notif[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 if (!user?.id) return;
 const supabase = createClient();
 supabase
 .from('notifications')
 .select('*')
 .eq('user_id', user.id)
 .order('created_at', { ascending: false })
 .limit(50)
 .then(({ data }) => {
 setNotifs((data ?? []) as Notif[]);
 setLoading(false);

 // Tandai semua sebagai sudah dibaca
 const unreadIds = (data ?? []).filter((n: Notif) => !n.read).map((n: Notif) => n.id);
 if (unreadIds.length > 0) {
 supabase.from('notifications').update({ read: true }).in('id', unreadIds);
 }
 })
 .catch(() => setLoading(false));
 }, [user?.id]);

 if (loading) return <div className="p-4 text-center py-10 text-gray-400">Memuat...</div>;

 return (
 <div className="p-4 space-y-3">
 <h2 className="text-lg font-bold text-gray-900">Notifikasi</h2>

 {notifs.length === 0 ? (
 <div className="text-center py-16">
 <p className="text-4xl mb-3"></p>
 <p className="text-gray-500">Belum ada notifikasi</p>
 </div>
 ) : (
 notifs.map(n => (
 <div key={n.id} className={`rounded-xl p-4 border ${n.read ? 'bg-white border-gray-100' : 'bg-blue-50 border-blue-100'}`}>
 <div className="flex justify-between items-start">
 <p className={`text-sm font-semibold ${n.read ? 'text-gray-900' : 'text-blue-900'}`}>{n.title}</p>
 {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full mt-1 flex-shrink-0"></span>}
 </div>
 <p className="text-sm text-gray-600 mt-1">{n.body}</p>
 <p className="text-xs text-gray-400 mt-2">
 {new Date(n.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
 </p>
 </div>
 ))
 )}
 </div>
 );
}
```

**Catatan:** Halaman notifikasi membaca dari tabel `notifications` di Supabase. Tambahkan tabel ini:

```sql
CREATE TABLE IF NOT EXISTS notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 read BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON notifications TO anon, authenticated;
```

Jalankan SQL ini di Supabase sebelum test.

- [ ] **Step 3: Test**

Login sebagai barber → cek `/barber/home-service` (kosong kalau belum ada booking home service) → cek `/barber/notifications` (kosong dulu, akan terisi setelah Task 12 selesai).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/barber/home-service/ frontend/src/app/barber/notifications/
git commit -m "feat: barber home-service and notifications pages"
```

---

## Task 11: Backend Web Push

**Files:**
- Create: `server/services/webPush.js`
- Modify: `server/index.js` — tambah endpoint push + panggil saat booking baru

- [ ] **Step 1: Install web-push package**

```bash
cd server && npm install web-push
```

- [ ] **Step 2: Generate VAPID keys**

```bash
cd server && node -e "const wp = require('web-push'); const k = wp.generateVAPIDKeys(); console.log('PUBLIC:', k.publicKey, '\nPRIVATE:', k.privateKey);"
```

Salin output-nya. Tambahkan ke `server/.env`:
```
VAPID_PUBLIC_KEY=<publicKey dari output>
VAPID_PRIVATE_KEY=<privateKey dari output>
VAPID_MAILTO=mailto:admin@redbox.id
```

Tambahkan juga ke `frontend/.env.local`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey yang sama>
```

- [ ] **Step 3: Tulis webPush service**

Buat `server/services/webPush.js`:

```javascript
const webpush = require('web-push');

webpush.setVapidDetails(
 process.env.VAPID_MAILTO || 'mailto:admin@redbox.id',
 process.env.VAPID_PUBLIC_KEY,
 process.env.VAPID_PRIVATE_KEY,
);

/**
 * Kirim Web Push ke satu subscription
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub
 * @param {{ title: string, body: string, url?: string }} payload
 */
async function sendPush(sub, payload) {
 const pushSubscription = {
 endpoint: sub.endpoint,
 keys: { p256dh: sub.p256dh, auth: sub.auth },
 };
 await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
}

/**
 * Kirim Web Push ke semua subscription milik satu user
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{ title: string, body: string, url?: string }} payload
 */
async function sendPushToUser(supabase, userId, payload) {
 const { data: subs } = await supabase
 .from('push_subscriptions')
 .select('endpoint, p256dh, auth')
 .eq('user_id', userId);

 if (!subs || subs.length === 0) return;

 await Promise.allSettled(subs.map(sub => sendPush(sub, payload)));
}

/**
 * Kirim Web Push ke semua barber di cabang tertentu
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} branch cabang, e.g. 'bypass'
 * @param {{ title: string, body: string, url?: string }} payload
 */
async function sendPushToBranch(supabase, branch, payload) {
 const { data: users } = await supabase
 .from('users')
 .select('id')
 .eq('branch', branch)
 .eq('role', 'barber');

 if (!users) return;
 await Promise.allSettled(users.map(u => sendPushToUser(supabase, u.id, payload)));
}

module.exports = { sendPush, sendPushToUser, sendPushToBranch };
```

- [ ] **Step 4: Tambah endpoint push di server/index.js**

Tambahkan setelah baris `require('./services/waNotification')` di bagian atas `server/index.js`:

```javascript
const { sendPushToUser, sendPushToBranch } = require('./services/webPush');
```

Tambahkan endpoint baru sebelum baris `app.listen`:

```javascript
// POST /api/push/subscribe — simpan push subscription token
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

// POST /api/push/send — kirim push ke user atau cabang (internal only)
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
```

- [ ] **Step 5: Integrasikan push saat booking baru**

Di `server/index.js`, cari fungsi/route handler `POST /api/bookings` (sekitar baris 992). Setelah booking berhasil dibuat dan `notifyAdminNewBooking` dipanggil, tambahkan:

```javascript
// Kirim Web Push ke barber yang bersangkutan
if (bookingData.barber_id && bookingData.location) {
 // Cari user dengan barber_id ini
 supabase
 .from('users')
 .select('id')
 .eq('barber_id', bookingData.barber_id)
 .eq('role', 'barber')
 .single()
 .then(({ data: barberUser }) => {
 if (!barberUser) return;
 sendPushToUser(supabase, barberUser.id, {
 title: ' Booking Baru!',
 body: `${bookingData.customer_name} — ${bookingData.service} jam ${bookingData.time}`,
 url: '/barber/schedule',
 }).catch(() => {});
 })
 .catch(() => {});
}
```

- [ ] **Step 6: Test endpoint push**

```bash
cd server && npm run dev
# Di terminal lain:
curl -X POST http://localhost:3001/api/push/send \
 -H "Content-Type: application/json" \
 -H "x-admin-token: <ADMIN_PASSWORD>" \
 -d '{"branch":"bypass","title":"Test","body":"Push berhasil!"}'
# Expected: {"ok":true}
```

- [ ] **Step 7: Commit**

```bash
git add server/services/webPush.js server/index.js server/package.json server/package-lock.json
git commit -m "feat: web push notifications (subscribe + send endpoints, booking integration)"
```

---

## Task 12: Frontend Push Subscription + PWA Config

**Files:**
- Create: `frontend/src/hooks/usePush.ts`
- Create: `frontend/public/manifest.json`
- Create: `frontend/public/sw.js`
- Create: `frontend/src/app/api/push/subscribe/route.ts`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/next.config.ts`

- [ ] **Step 1: Salin ikon PWA**

Salin `Brand_assets/RedBox Logo.png` ke `frontend/public/icons/`. Buat folder dulu:

```bash
mkdir -p "frontend/public/icons"
copy "Brand_assets\RedBox Logo.png" "frontend\public\icons\icon-512.png"
copy "Brand_assets\RedBox Logo.png" "frontend\public\icons\icon-192.png"
```

(Idealnya resize ke 192×192 dan 512×512 menggunakan tools seperti Sharp atau tool online. Untuk v1.0, menggunakan file yang sama sudah cukup untuk PWA installability.)

- [ ] **Step 2: Tulis manifest.json**

Buat `frontend/public/manifest.json`:

```json
{
 "name": "RedBox Staff",
 "short_name": "RedBox",
 "description": "Internal app untuk admin dan barber RedBox Barbershop",
 "start_url": "/",
 "display": "standalone",
 "background_color": "#0a0a0a",
 "theme_color": "#dc2626",
 "orientation": "portrait",
 "icons": [
 {
 "src": "/icons/icon-192.png",
 "sizes": "192x192",
 "type": "image/png",
 "purpose": "any maskable"
 },
 {
 "src": "/icons/icon-512.png",
 "sizes": "512x512",
 "type": "image/png",
 "purpose": "any maskable"
 }
 ]
}
```

- [ ] **Step 3: Tulis service worker**

Buat `frontend/public/sw.js`:

```javascript
const CACHE_NAME = 'redbox-staff-v1';
const SHELL = ['/', '/login', '/admin/dashboard', '/barber/schedule'];

self.addEventListener('install', (event) => {
 event.waitUntil(
 caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
 );
});

self.addEventListener('activate', (event) => {
 event.waitUntil(
 caches.keys().then(keys =>
 Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
 ).then(() => self.clients.claim())
 );
});

self.addEventListener('fetch', (event) => {
 // Network first untuk API, cache first untuk shell
 if (event.request.url.includes('/api/')) return;
 event.respondWith(
 fetch(event.request).catch(() => caches.match(event.request))
 );
});

// Handle Web Push notification
self.addEventListener('push', (event) => {
 if (!event.data) return;
 const { title, body, url } = event.data.json();
 event.waitUntil(
 self.registration.showNotification(title, {
 body,
 icon: '/icons/icon-192.png',
 badge: '/icons/icon-192.png',
 data: { url: url || '/' },
 vibrate: [200, 100, 200],
 })
 );
});

// Klik notifikasi → buka app
self.addEventListener('notificationclick', (event) => {
 event.notification.close();
 const url = event.notification.data?.url || '/';
 event.waitUntil(
 clients.matchAll({ type: 'window' }).then(clientList => {
 for (const client of clientList) {
 if (client.url.includes(self.location.origin) && 'focus' in client) {
 client.navigate(url);
 return client.focus();
 }
 }
 return clients.openWindow(url);
 })
 );
});
```

- [ ] **Step 4: usePush hook**

Buat `frontend/src/hooks/usePush.ts`:

```typescript
'use client';
import { useEffect } from 'react';
import { useUser } from './useUser';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string) {
 const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
 const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
 const rawData = window.atob(base64);
 return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export function usePush() {
 const { user } = useUser();

 useEffect(() => {
 if (!user || user.role !== 'barber') return;
 if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
 if (!VAPID_PUBLIC_KEY) return;

 async function subscribe() {
 try {
 const registration = await navigator.serviceWorker.ready;
 const existing = await registration.pushManager.getSubscription();
 if (existing) {
 // Sudah subscribe, cukup pastikan token tersimpan di server
 await saveSubscription(user!.id, existing);
 return;
 }

 const permission = await Notification.requestPermission();
 if (permission !== 'granted') return;

 const subscription = await registration.pushManager.subscribe({
 userVisibleOnly: true,
 applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
 });

 await saveSubscription(user!.id, subscription);
 } catch (e) {
 console.error('Push subscribe error:', e);
 }
 }

 subscribe();
 }, [user]);
}

async function saveSubscription(userId: string, subscription: PushSubscription) {
 const { endpoint, keys } = subscription.toJSON() as {
 endpoint: string;
 keys: { p256dh: string; auth: string };
 };

 await fetch('/api/push/subscribe', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth }),
 });
}
```

- [ ] **Step 5: Next.js API route proxy push/subscribe**

Buat `frontend/src/app/api/push/subscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
 const body = await req.json();
 const res = await fetch(`${API_URL}/api/push/subscribe`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 6: Update layout.tsx — PWA meta + SW registration**

Ganti isi `frontend/src/app/layout.tsx`:

```typescript
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
 title: 'RedBox Staff',
 description: 'Internal app untuk admin dan barber RedBox Barbershop',
 manifest: '/manifest.json',
 appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'RedBox Staff' },
};

export const viewport: Viewport = {
 themeColor: '#dc2626',
 width: 'device-width',
 initialScale: 1,
 maximumScale: 1,
 userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="id" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
 <head>
 <link rel="apple-touch-icon" href="/icons/icon-192.png" />
 </head>
 <body className="min-h-full flex flex-col bg-gray-50">
 {children}
 <script
 dangerouslySetInnerHTML={{
 __html: `
 if ('serviceWorker' in navigator) {
 window.addEventListener('load', () => {
 navigator.serviceWorker.register('/sw.js').catch(() => {});
 });
 }
 `,
 }}
 />
 </body>
 </html>
 );
}
```

- [ ] **Step 7: Update next.config.ts untuk headers SW**

Ganti isi `frontend/next.config.ts`:

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
 async headers() {
 return [
 {
 source: '/sw.js',
 headers: [
 { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
 { key: 'Service-Worker-Allowed', value: '/' },
 ],
 },
 ];
 },
};

export default nextConfig;
```

- [ ] **Step 8: Tambah usePush ke barber layout**

Buka `frontend/src/app/barber/layout.tsx`, tambahkan import dan panggilan:

```typescript
import { usePush } from '@/hooks/usePush';
// Di dalam BarberLayout function, tambahkan:
usePush();
```

- [ ] **Step 9: Test PWA installability**

```bash
cd frontend && npm run build && npm start
```

Buka Chrome di Android (atau Chrome DevTools mobile mode) → `http://localhost:3000` → DevTools → Application → Manifest → pastikan tidak ada error → pastikan banner "Install App" muncul.

- [ ] **Step 10: Commit**

```bash
git add frontend/public/ frontend/src/hooks/usePush.ts frontend/src/app/layout.tsx frontend/next.config.ts frontend/src/app/api/push/ frontend/src/app/barber/layout.tsx
git commit -m "feat: PWA config (manifest, service worker, Web Push subscription)"
```

---

## Task 13: Final Testing & Deploy Check

- [ ] **Step 1: Test full flow sebagai owner**

1. Buka `http://localhost:3000` → redirect ke `/login`
2. Login sebagai owner → redirect ke `/admin/dashboard`
3. Cek 3 card (booking, barber, revenue) terisi
4. Filter cabang → data berubah
5. Buka `/admin/bookings` → filter tanggal & status → ubah status booking
6. Buka `/admin/barbers` → toggle satu barber → refresh → status berubah
7. Logout → redirect ke `/login`

- [ ] **Step 2: Test full flow sebagai barber**

1. Buat akun barber di Supabase Auth → insert ke tabel `users` dengan role `barber` dan `barber_id` yang valid
2. Login sebagai barber → redirect ke `/barber/schedule`
3. Cek jadwal hari ini muncul
4. Buka tab Home Service → pastikan muncul jika ada booking home service
5. Buka tab Notifikasi

- [ ] **Step 3: Test push notification end-to-end**

1. Login sebagai barber di Chrome Android (atau Chrome DevTools → mobile + `https://`)
2. Buka `/barber/schedule` → izinkan notifikasi ketika diminta
3. Dari terminal server, buat booking baru untuk barber ini
4. Pastikan notifikasi muncul di HP barber (atau browser)

- [ ] **Step 4: Verifikasi PWA di Android**

Buka Chrome di HP Android → URL production → tap menu (⋮) → "Tambahkan ke layar utama" → konfirmasi → buka dari layar utama → pastikan muncul full screen tanpa address bar.

- [ ] **Step 5: Tambah env vars ke Vercel**

Di Vercel dashboard → Project Settings → Environment Variables, tambahkan:
```
API_URL = <URL server Express yang di-deploy>
ADMIN_TOKEN = <nilai ADMIN_PASSWORD dari server>
NEXT_PUBLIC_VAPID_PUBLIC_KEY = <VAPID public key>
NEXT_PUBLIC_API_URL = <URL server Express yang di-deploy>
```

- [ ] **Step 6: Deploy**

```bash
git add -A
git commit -m "chore: final adjustments before deploy"
# Push ke main → Vercel auto-deploy
git push origin main
```

---

## Ringkasan File yang Dibuat/Dimodifikasi

| File | Aksi |
|---|---|
| `server/migrations/004_users_push.sql` | Baru |
| `server/services/webPush.js` | Baru |
| `server/index.js` | Modifikasi |
| `frontend/public/manifest.json` | Baru |
| `frontend/public/sw.js` | Baru |
| `frontend/public/icons/icon-*.png` | Baru (salin dari Brand_assets) |
| `frontend/src/lib/constants.ts` | Baru |
| `frontend/src/lib/api.ts` | Baru |
| `frontend/src/hooks/useUser.ts` | Baru |
| `frontend/src/hooks/usePush.ts` | Baru |
| `frontend/src/components/BranchFilter.tsx` | Baru |
| `frontend/src/components/StatusBadge.tsx` | Baru |
| `frontend/src/components/BookingCard.tsx` | Baru |
| `frontend/src/components/BottomNav.tsx` | Baru |
| `frontend/src/app/layout.tsx` | Modifikasi |
| `frontend/src/middleware.ts` | Modifikasi |
| `frontend/next.config.ts` | Modifikasi |
| `frontend/src/app/login/page.tsx` | Baru |
| `frontend/src/app/admin/layout.tsx` | Baru |
| `frontend/src/app/admin/dashboard/page.tsx` | Baru |
| `frontend/src/app/admin/bookings/page.tsx` | Baru |
| `frontend/src/app/admin/barbers/page.tsx` | Baru |
| `frontend/src/app/barber/layout.tsx` | Baru |
| `frontend/src/app/barber/schedule/page.tsx` | Baru |
| `frontend/src/app/barber/home-service/page.tsx` | Baru |
| `frontend/src/app/barber/notifications/page.tsx` | Baru |
| `frontend/src/app/api/admin/booking-status/route.ts` | Baru |
| `frontend/src/app/api/admin/barber-toggle/[id]/route.ts` | Baru |
| `frontend/src/app/api/admin/barber-override/[id]/route.ts` | Baru |
| `frontend/src/app/api/push/subscribe/route.ts` | Baru |
