# Owner Portal Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri role owner dua halaman hub (`/owner/branches`, `/owner/kapster`) yang saat diklik membawa owner masuk ke role Admin (per cabang) dan role Kapster (per orang) dengan kontrol penuh read-write, plus jalur kembali ke area owner.

**Architecture:** Pakai sesi asli — owner masuk admin via halaman `/admin/*` yang di-scope `?branch=`, dan masuk kapster via impersonate (cetak `redbox_barber_session` cookie). Tidak ada duplikasi UI. Guard layout admin diubah agar mengizinkan owner; halaman admin membaca cabang dari URL; portal kapster sudah digerakkan cookie sehingga impersonate langsung memberi kontrol penuh.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Tailwind 4, Framer Motion, Lucide React, `@supabase/ssr`, Express backend (sudah ada endpoint impersonate).

**Spec:** `docs/superpowers/specs/2026-06-14-owner-portal-hub-design.md`

**Verifikasi:** Project frontend tidak punya test runner. Verifikasi tiap task = `npx next build` (atau `npx tsc --noEmit`) + cek alur manual di localhost, mengikuti pola plan yang sudah ada di repo ini.

---

## File Map

**Create:**
- `frontend/src/lib/branches.ts` — konstanta daftar cabang (slug + label) dipakai bersama
- `frontend/src/app/owner/branches/page.tsx` — daftar cabang → masuk admin
- `frontend/src/app/owner/kapster/page.tsx` — daftar kapster per cabang → impersonate
- `frontend/src/app/api/owner/impersonate-barber/route.ts` — proxy POST, verifikasi owner, set cookie

**Modify:**
- `frontend/src/components/OwnerNav.tsx` — tambah 2 tab (Branches, Kapster)
- `frontend/src/components/AdminNav.tsx` — bawa `?branch=` di tiap link
- `frontend/src/app/admin/layout.tsx` — izinkan owner; header owner-mode (back + badge, sembunyikan Keluar)
- `frontend/src/app/admin/dashboard/page.tsx` — branch dari URL
- `frontend/src/app/admin/bookings/page.tsx` — branch dari URL
- `frontend/src/app/admin/barbers/page.tsx` — branch dari URL
- `frontend/src/app/admin/customers/page.tsx` — branch dari URL
- `frontend/src/app/admin/leaderboard/page.tsx` — branch dari URL
- `frontend/src/app/admin/membership/page.tsx` — branch dari URL
- `frontend/src/app/barber/layout.tsx` — banner "Mode Owner" + exit saat impersonating
- `frontend/src/app/api/barber/auth/logout/route.ts` — hapus marker cookie

---

## Task 1: Konstanta cabang bersama

**Files:**
- Create: `frontend/src/lib/branches.ts`

- [ ] **Step 1: Buat file konstanta**

```ts
// frontend/src/lib/branches.ts
export interface BranchDef {
  slug: string;
  label: string;
}

// Slug HARUS sama dengan kolom barbers.branch / outlets.slug
export const BRANCHES: BranchDef[] = [
  { slug: 'bypass',    label: 'Bypass' },
  { slug: 'sumber',    label: 'Sumber' },
  { slug: 'samadikun', label: 'Samadikun' },
  { slug: 'csb',       label: 'CSB Mall' },
  { slug: 'tegal',     label: 'Tegal' },
];

export function branchLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return BRANCHES.find(b => b.slug === slug)?.label ?? slug;
}
```

- [ ] **Step 2: Verifikasi typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: tidak ada error baru terkait `branches.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/branches.ts
git commit -m "feat(owner): konstanta daftar cabang bersama"
```

---

## Task 2: OwnerNav — tambah tab Branches & Kapster

**Files:**
- Modify: `frontend/src/components/OwnerNav.tsx`

- [ ] **Step 1: Ganti array NAV_ITEMS dan import ikon**

Ganti baris import ikon (baris 4) menjadi:
```ts
import { LayoutDashboard, TrendingUp, User, CreditCard, Building2, Scissors } from 'lucide-react';
```

Ganti `NAV_ITEMS` (baris 7-12) menjadi:
```ts
const NAV_ITEMS = [
  { href: '/owner/dashboard', label: 'Overview',  Icon: LayoutDashboard },
  { href: '/owner/branches',  label: 'Cabang',    Icon: Building2 },
  { href: '/owner/kapster',   label: 'Kapster',   Icon: Scissors },
  { href: '/owner/revenue',   label: 'Revenue',   Icon: TrendingUp },
  { href: '/owner/payment',   label: 'Payment',   Icon: CreditCard },
  { href: '/owner/profile',   label: 'Profil',    Icon: User },
];
```

- [ ] **Step 2: Aktifkan scroll horizontal (nav jadi 6 item)**

Ganti `<div className="flex">` (baris 21) menjadi:
```tsx
      <div className="flex overflow-x-auto scrollbar-none">
```

Dan pada `<Link>` (baris 25-26) ganti `className` menjadi:
```tsx
            <Link key={href} href={href}
              className="flex-shrink-0 flex-1 flex flex-col items-center justify-center py-2.5 min-w-[52px] relative">
```

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OwnerNav.tsx
git commit -m "feat(owner): tambah tab Cabang & Kapster di OwnerNav"
```

---

## Task 3: Halaman `/owner/branches`

**Files:**
- Create: `frontend/src/app/owner/branches/page.tsx`

- [ ] **Step 1: Buat halaman daftar cabang**

```tsx
// frontend/src/app/owner/branches/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Building2, ChevronRight } from 'lucide-react';
import { BRANCHES } from '@/lib/branches';

export default function OwnerBranchesPage() {
  const router = useRouter();

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Building2 size={16} style={{ color: '#5A4E50' }} />
        <h2 className="font-bold text-base" style={{ color: '#F0EAEB' }}>Cabang</h2>
      </div>
      <p className="text-[11px]" style={{ color: '#5A4E50' }}>
        Pilih cabang untuk masuk ke panel admin dengan kontrol penuh.
      </p>

      <div className="space-y-2.5">
        {BRANCHES.map((b, i) => (
          <motion.button
            key={b.slug}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            onClick={() => router.push(`/admin/dashboard?branch=${b.slug}`)}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-4 text-left active:scale-[0.98] transition-all cursor-pointer"
            style={{ background: '#130E10', border: '1px solid #261E20' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(199,40,32,0.13)' }}
              >
                <Building2 size={18} style={{ color: '#E87068' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: '#F0EAEB' }}>{b.label}</p>
                <p className="text-[11px]" style={{ color: '#5A4E50' }}>Panel admin cabang</p>
              </div>
            </div>
            <ChevronRight size={16} style={{ color: '#4A3E40' }} />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: route `/owner/branches` muncul di output, `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/owner/branches/page.tsx
git commit -m "feat(owner): halaman /owner/branches — masuk panel admin per cabang"
```

---

## Task 4: Proxy impersonate owner-aman

**Files:**
- Create: `frontend/src/app/api/owner/impersonate-barber/route.ts`

- [ ] **Step 1: Buat proxy POST yang verifikasi owner via Supabase**

```ts
// frontend/src/app/api/owner/impersonate-barber/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_PASSWORD ?? '';

export async function POST(req: NextRequest) {
  // 1. Verifikasi pemanggil adalah owner
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Hanya owner yang boleh impersonate' }, { status: 403 });
  }

  // 2. Ambil nama kapster dari body
  const body = await req.json().catch(() => ({}));
  const name = (body?.name || '').toString().trim();
  if (!name) {
    return NextResponse.json({ error: 'name wajib diisi' }, { status: 400 });
  }

  // 3. Panggil backend impersonate (token disuntik di server, tidak di URL klien)
  const res = await fetch(
    `${API_URL}/api/admin/crm/impersonate-barber?name=${encodeURIComponent(name)}`,
    { headers: { 'x-admin-token': ADMIN_TOKEN }, signal: AbortSignal.timeout(10_000) },
  );
  const data = await res.json();
  if (!res.ok || !data?.token) {
    return NextResponse.json(data, { status: res.status || 500 });
  }

  // 4. Set cookie sesi kapster + marker impersonator
  const response = NextResponse.json({ ok: true, barber: data.barber });
  response.cookies.set('redbox_barber_session', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  // marker non-httpOnly agar barber layout (client) bisa membacanya untuk banner
  response.cookies.set('redbox_impersonator', 'owner', {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}
```

- [ ] **Step 2: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: route `/api/owner/impersonate-barber` muncul, `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/owner/impersonate-barber/route.ts
git commit -m "feat(owner): proxy impersonate-barber aman (verifikasi owner, tanpa pw di URL)"
```

---

## Task 5: Halaman `/owner/kapster`

**Files:**
- Create: `frontend/src/app/owner/kapster/page.tsx`

- [ ] **Step 1: Buat halaman daftar kapster per cabang**

Halaman ini ambil kapster aktif dari proxy `/api/admin/barbers` (mengembalikan array barber `{ id, name, branch }`), kelompokkan per cabang pakai `BRANCHES`, lalu tap → POST ke `/api/owner/impersonate-barber` → `window.location.href = '/barber/home'`.

```tsx
// frontend/src/app/owner/kapster/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Scissors, ChevronRight, Loader2 } from 'lucide-react';
import { BRANCHES } from '@/lib/branches';

interface Barber { id: string; name: string; branch: string }

export default function OwnerKapsterPage() {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/barbers');
      const data = await res.json();
      const list: Barber[] = Array.isArray(data) ? data : (data.barbers ?? []);
      setBarbers(list.filter(b => b && b.name));
    } catch {
      setError('Gagal memuat daftar kapster');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function enterKapster(name: string) {
    setEntering(name);
    setError('');
    try {
      const res = await fetch('/api/owner/impersonate-barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Gagal masuk sebagai kapster');
      }
      window.location.href = '/barber/home';
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal masuk');
      setEntering(null);
    }
  }

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Scissors size={16} style={{ color: '#5A4E50' }} />
        <h2 className="font-bold text-base" style={{ color: '#F0EAEB' }}>Kapster</h2>
      </div>
      <p className="text-[11px]" style={{ color: '#5A4E50' }}>
        Pilih kapster untuk masuk ke portal kapster dengan kontrol penuh.
      </p>

      {error && (
        <p className="text-xs font-medium rounded-lg px-3.5 py-2.5"
          style={{ background: 'rgba(199,40,32,0.12)', border: '1px solid rgba(199,40,32,0.25)', color: '#F07068' }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <motion.div key={i} animate={{ opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="h-12 rounded-2xl" style={{ background: '#1C1416' }} />
          ))}
        </div>
      ) : (
        BRANCHES.map(branch => {
          const group = barbers.filter(b => b.branch === branch.slug);
          if (group.length === 0) return null;
          return (
            <div key={branch.slug} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#5A4E50' }}>
                {branch.label}
              </p>
              <div className="space-y-2">
                {group.map((b, i) => (
                  <motion.button
                    key={b.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    disabled={entering !== null}
                    onClick={() => enterKapster(b.name)}
                    className="w-full flex items-center justify-between rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                    style={{ background: '#130E10', border: '1px solid #261E20' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068' }}>
                        {b.name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <p className="font-semibold text-sm" style={{ color: '#F0EAEB' }}>{b.name}</p>
                    </div>
                    {entering === b.name
                      ? <Loader2 size={16} className="animate-spin" style={{ color: '#E87068' }} />
                      : <ChevronRight size={16} style={{ color: '#4A3E40' }} />}
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: route `/owner/kapster` muncul, `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/owner/kapster/page.tsx
git commit -m "feat(owner): halaman /owner/kapster — impersonate kapster per cabang"
```

---

## Task 6: Admin layout — izinkan owner + header owner-mode

**Files:**
- Modify: `frontend/src/app/admin/layout.tsx`

- [ ] **Step 1: Ubah guard agar owner tidak ditendang**

Di `AdminLayout` (sekitar baris 91-95), ganti blok `useEffect`:
```tsx
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!loading && user && user.role === 'owner') router.replace('/owner/dashboard');
    if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
  }, [user, loading, router]);
```
menjadi:
```tsx
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
  }, [user, loading, router]);
```

> Owner kini diizinkan render. Jika owner tanpa `?branch`, redirect ke pemilih cabang ditangani di `AdminShell` (Step 2) karena di situ `useSearchParams` tersedia.

- [ ] **Step 2: AdminShell — deteksi owner-mode, redirect bila tanpa branch, header back/badge**

Di dalam `AdminShell`, setelah baris `const readonly = searchParams.get('readonly') === 'true';` (baris 19) tambahkan:
```tsx
  const branchParam = searchParams.get('branch');
  const isOwner = user?.role === 'owner';
  const ownerMode = isOwner && !readonly;

  useEffect(() => {
    if (isOwner && !branchParam && !readonly) {
      router.replace('/owner/branches');
    }
  }, [isOwner, branchParam, readonly, router]);
```

Tambah `useEffect` ke import React di baris 2:
```tsx
import { useEffect, Suspense } from 'react';
```

- [ ] **Step 3: Header — tampilkan back+badge owner, sembunyikan Keluar saat ownerMode**

Ganti blok back-button readonly (baris 28-37) agar muncul juga saat ownerMode, arahkan ke `/owner/branches`:
```tsx
          {(readonly || ownerMode) && (
            <button
              onClick={() => router.push(ownerMode ? '/owner/branches' : '/owner/dashboard')}
              className="p-1.5 -ml-1.5 rounded-xl transition-all active:scale-95 cursor-pointer"
              style={{ color: '#5A4E50' }}
              aria-label="Kembali ke Owner"
            >
              <ChevronLeft size={18} />
            </button>
          )}
```

Ganti badge cabang di header (baris 48-52) agar pakai param branch saat ownerMode:
```tsx
          {(branchParam || user?.branch) && (
            <p className="text-[10px] capitalize font-medium" style={{ color: '#C72820' }}>
              {branchParam || user?.branch}
            </p>
          )}
```

Ganti blok tombol kanan (baris 56-78) — saat readonly ATAU ownerMode tampilkan badge, jangan tampilkan Keluar:
```tsx
        {(readonly || ownerMode) ? (
          <span
            className="text-[10px] px-2.5 py-1 rounded-full font-medium"
            style={{ background: '#1C1416', color: '#5A4E50', border: '1px solid #261E20' }}
          >
            {ownerMode ? 'Owner' : 'Read-only'}
          </span>
        ) : (
          <button
            onClick={signOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            style={{ color: signingOut ? '#C72820' : '#4A3E40' }}
            aria-label="Keluar"
          >
            {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
            <span className="text-xs font-medium">{signingOut ? 'Keluar...' : 'Keluar'}</span>
          </button>
        )}
```

- [ ] **Step 4: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/layout.tsx
git commit -m "feat(owner): admin layout izinkan owner + header owner-mode (back + badge)"
```

---

## Task 7: Admin pages — resolusi cabang dari URL

**Files:**
- Modify: `frontend/src/app/admin/dashboard/page.tsx:369`
- Modify: `frontend/src/app/admin/bookings/page.tsx:44`
- Modify: `frontend/src/app/admin/barbers/page.tsx:222`
- Modify: `frontend/src/app/admin/customers/page.tsx:41`
- Modify: `frontend/src/app/admin/leaderboard/page.tsx:35`
- Modify: `frontend/src/app/admin/membership/page.tsx:58`

Pola sama untuk tiap file: pastikan `useSearchParams` di-import dari `next/navigation`, lalu ganti penentuan `branch` agar URL param menang atas `user?.branch`.

- [ ] **Step 1: dashboard/page.tsx**

File ini sudah `import { useSearchParams } from 'next/navigation';` (baris 12). Di komponen yang punya `const branch = user?.branch || '';` (baris 369), tambahkan tepat di atasnya:
```tsx
  const searchParams = useSearchParams();
```
lalu ganti baris branch menjadi:
```tsx
  const branch = searchParams.get('branch') || user?.branch || '';
```

> Catatan: jika `useSearchParams` sudah dipanggil di komponen itu, jangan deklarasi ganda — cukup ganti baris `branch`.

- [ ] **Step 2: bookings/page.tsx**

Pastikan ada import:
```tsx
import { useSearchParams } from 'next/navigation';
```
Di komponen, tambahkan (jika belum ada) `const searchParams = useSearchParams();` di dekat `const { user } = useUser();`, lalu ganti baris 44:
```tsx
  const branch = searchParams.get('branch') || user?.branch || '';
```

- [ ] **Step 3: barbers/page.tsx**

Pastikan import `useSearchParams` ada. Tambah `const searchParams = useSearchParams();` di dekat `const { user } = useUser();`, lalu ganti baris 222:
```tsx
  const branch = searchParams.get('branch') ?? user?.branch ?? '';
```

- [ ] **Step 4: customers/page.tsx**

Pastikan import `useSearchParams` ada. Tambah `const searchParams = useSearchParams();` di dekat `const { user } = useUser();`, lalu ganti baris 41:
```tsx
  const branch = searchParams.get('branch') || user?.branch || '';
```

- [ ] **Step 5: leaderboard/page.tsx**

Pastikan import `useSearchParams` ada. Tambah `const searchParams = useSearchParams();` di dekat `const { user } = useUser();`, lalu ganti baris 35:
```tsx
  const branch = searchParams.get('branch') || user?.branch || '';
```

- [ ] **Step 6: membership/page.tsx**

Pastikan import `useSearchParams` ada. Tambah `const searchParams = useSearchParams();` di dekat `const { user } = useUser();`, lalu ganti baris 58:
```tsx
  const branch = searchParams.get('branch') || user?.branch || '';
```

- [ ] **Step 7: Cek tidak ada halaman branch-scoped lain yang terlewat**

Run: `cd frontend && npx grep -rn "user?.branch" src/app/admin` (atau gunakan ripgrep `rg "user\?\.branch" src/app/admin`).
Expected: hanya `layout.tsx` (badge, sudah ditangani Task 6) yang masih memakai `user?.branch` langsung tanpa fallback URL. Jika ada halaman lain dengan `const branch = user?.branch`, terapkan pola Step 1 yang sama.

- [ ] **Step 8: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/admin/dashboard/page.tsx \
        frontend/src/app/admin/bookings/page.tsx \
        frontend/src/app/admin/barbers/page.tsx \
        frontend/src/app/admin/customers/page.tsx \
        frontend/src/app/admin/leaderboard/page.tsx \
        frontend/src/app/admin/membership/page.tsx
git commit -m "feat(owner): admin pages baca cabang dari URL param (owner scope)"
```

---

## Task 8: AdminNav — bawa `?branch=` antar tab

**Files:**
- Modify: `frontend/src/components/AdminNav.tsx`

- [ ] **Step 1: Baca branch dari URL dan tempelkan ke href**

Ganti import (baris 3) menjadi:
```tsx
import { usePathname, useSearchParams } from 'next/navigation';
```

Di dalam `AdminNav`, ganti `const pathname = usePathname();` (baris 16) menjadi:
```tsx
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const branch = searchParams.get('branch');
  const suffix = branch ? `?branch=${branch}` : '';
```

Lalu ganti `href={href}` pada `<Link>` (baris 29) menjadi:
```tsx
              href={`${href}${suffix}`}
```

- [ ] **Step 2: Pastikan AdminNav berada dalam Suspense**

`AdminNav` dipakai di `AdminShell`, dan `AdminShell` sudah dibungkus `<Suspense>` di `AdminLayout` (baris 119-125). `useSearchParams` aman. Tidak ada perubahan tambahan.

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AdminNav.tsx
git commit -m "feat(owner): AdminNav pertahankan ?branch antar tab"
```

---

## Task 9: Barber layout — banner "Mode Owner" + exit

**Files:**
- Modify: `frontend/src/app/barber/layout.tsx`
- Modify: `frontend/src/app/api/barber/auth/logout/route.ts`

- [ ] **Step 1: Logout proxy hapus marker impersonator**

Di `frontend/src/app/api/barber/auth/logout/route.ts`, setelah `response.cookies.delete('redbox_barber_session');` tambahkan:
```ts
  response.cookies.delete('redbox_impersonator');
```

- [ ] **Step 2: Barber layout — deteksi marker, tampilkan banner, exit ke owner**

Di `frontend/src/app/barber/layout.tsx`, ubah import baris 2 agar ada `useState`:
```tsx
import { useEffect, useState } from 'react';
```
Tambah import ikon di baris 6:
```tsx
import { LogOut, ArrowLeft } from 'lucide-react';
```

Di dalam `BarberLayout`, setelah `const pathname = usePathname();` (baris 21) tambahkan:
```tsx
  const [impersonating, setImpersonating] = useState(false);
  useEffect(() => {
    setImpersonating(document.cookie.split('; ').some(c => c.startsWith('redbox_impersonator=owner')));
  }, []);

  async function exitImpersonation() {
    await fetch('/api/barber/auth/logout', { method: 'POST' }).catch(() => {});
    // marker non-httpOnly: hapus juga dari client untuk jaga-jaga
    document.cookie = 'redbox_impersonator=; Max-Age=0; path=/';
    window.location.href = '/owner/kapster';
  }
```

Tepat sebelum `<header ...>` (baris 68), di dalam div pembungkus, sisipkan banner:
```tsx
      {impersonating && (
        <button
          onClick={exitImpersonation}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold cursor-pointer"
          style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068', borderBottom: '1px solid rgba(199,40,32,0.25)' }}
        >
          <ArrowLeft size={13} />
          Mode Owner — Kembali ke Owner
        </button>
      )}
```

> Catatan: tombol "Keluar" bawaan tetap ada. Jika owner menekan "Keluar", `useBarberSession.signOut()` memanggil logout (yang kini juga menghapus marker) lalu ke `/barber/login` — tetap konsisten.

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/barber/layout.tsx frontend/src/app/api/barber/auth/logout/route.ts
git commit -m "feat(owner): banner Mode Owner di portal kapster + bersihkan marker saat logout"
```

---

## Task 10: Verifikasi end-to-end di localhost

**Prasyarat:** backend `:3001` dan frontend `:3000` jalan. Dari root repo: `npm run dev:all`. Login sebagai user `role='owner'` (set via Supabase bila perlu: `UPDATE users SET role='owner', branch=null WHERE email='<owner>';`).

- [ ] **Step 1: Build final**

Run: `cd frontend && npx next build`
Expected: `✓ Compiled successfully`, route baru `/owner/branches`, `/owner/kapster`, `/api/owner/impersonate-barber` tampil.

- [ ] **Step 2: Owner → Admin (kontrol penuh)**

1. Login owner → `/owner/dashboard`.
2. Tap tab **Cabang** → `/owner/branches` → 5 cabang tampil.
3. Tap "Bypass" → mendarat di `/admin/dashboard?branch=bypass`, data cabang Bypass tampil, badge "Owner" + tombol back muncul, tombol "Keluar" tidak ada.
4. Lakukan aksi nyata (mis. confirm 1 booking pending) → berhasil (read-write).
5. Pindah ke tab Booking/Kapster di AdminNav → URL tetap membawa `?branch=bypass`, data tetap cabang Bypass.
6. Tap back "←" → kembali ke `/owner/branches`.
7. Buka `/admin/dashboard` tanpa `?branch` langsung → ter-redirect ke `/owner/branches`.

- [ ] **Step 3: Owner → Kapster (kontrol penuh)**

1. Tap tab **Kapster** → `/owner/kapster` → kapster tampil dikelompokkan per cabang.
2. Tap salah satu kapster (mis. "Onoy") → loading → mendarat di `/barber/home` sebagai kapster itu.
3. Banner merah "Mode Owner — Kembali ke Owner" muncul di atas.
4. Fitur kapster berfungsi (buka jadwal/profil).
5. Tap banner → cookie bersih → kembali ke `/owner/kapster`.

- [ ] **Step 4: Regresi & keamanan**

1. Login kapster normal via OTP (`/barber/login`) → TIDAK ada banner "Mode Owner".
2. branch_admin biasa login → `/admin/dashboard` tetap pakai cabangnya sendiri (tanpa `?branch`), tombol "Keluar" tetap ada, tidak ada badge "Owner".
3. Tanpa login owner, `POST /api/owner/impersonate-barber` (mis. via curl tanpa cookie) → balas `401`.

```bash
curl -i -X POST http://localhost:3000/api/owner/impersonate-barber \
  -H "Content-Type: application/json" -d '{"name":"Onoy"}'
```
Expected: `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 5: Commit catatan verifikasi (opsional) & selesai**

Jika semua lulus, tidak ada perubahan kode tambahan. Branch `feat/owner-portal-hub` siap untuk PR/merge.
```bash
git log --oneline feat/owner-portal-hub ^main
```
Expected: daftar commit Task 1-9.
```
