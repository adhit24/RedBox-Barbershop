# Owner Portal Hub — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design phase)

## Goal

Beri role **owner** dua halaman hub baru yang, saat diklik, membawa owner masuk ke **role Admin** (per cabang) dan **role Kapster** (per orang) dengan **kontrol penuh (read-write)** — bukan read-only. Owner bisa beroperasi persis seperti admin cabang atau kapster asli, lalu kembali ke area owner.

## Context (yang sudah ada)

- **Auth:** Supabase Auth + tabel `users` dengan kolom `role` (`owner` | `branch_admin` | `barber`), `branch`, `barber_id`. Owner login via `/login?role=owner` → `/owner/dashboard`.
- **Owner area:** `/owner/dashboard`, `/owner/revenue`, `/owner/payment`, `/owner/profile` dengan bottom nav `OwnerNav` (`frontend/src/components/OwnerNav.tsx`).
- **Admin area:** `/admin/{dashboard,bookings,barbers,customers,leaderboard,schedule,broadcast}`. Tiap halaman branch-scoped, mengambil cabang dari `user?.branch`. Data diambil lewat proxy `/api/admin/crm/*` yang menyuntik `x-admin-token: ADMIN_PASSWORD` di server.
- **Kapster area:** `/barber/*`. Digerakkan **sepenuhnya oleh cookie** `redbox_barber_session` (via `useBarberSession` → `/api/barber/me`), tidak bergantung pada Supabase role.
- **Impersonate (sudah ada):** backend `GET /api/admin/crm/impersonate-barber?name=X` (adminAuth) membuat `barber_sessions` row by fuzzy name match, mengembalikan token. Frontend route `GET /api/admin/impersonate-barber?name=X&pw=ADMIN_PASSWORD` men-set cookie lalu redirect ke `/barber/home`. **Masalah:** `pw` (admin password) bocor ke URL/history browser.

## Pilihan arsitektur

**Dipilih — pakai sesi asli, reuse infra.** Owner masuk admin dengan menavigasi ke halaman `/admin/*` asli yang di-scope `?branch=`, dan masuk kapster dengan mencetak sesi barber asli (impersonate). Tidak ada duplikasi UI; owner dapat kontrol penuh karena memakai halaman/sesi role yang sebenarnya.

**Ditolak:** (B) menduplikasi seluruh layar admin/kapster sebagai versi owner — duplikasi besar; (C) iframe — masalah cookie/auth.

---

## Komponen

### 1. Dua halaman owner baru + nav

`OwnerNav` ditambah 2 tab → total: Dashboard, Revenue, **Branches**, **Kapster**, Payment, Profile (urutan final saat implementasi; ikon Lucide).

- **`/owner/branches`** — daftar 5 cabang sebagai kartu. Tap → `router.push('/admin/dashboard?branch=<slug>')`. Sumber cabang: tabel `outlets` (slug, name) atau daftar statis 5 cabang (`bypass, sumber, samadikun, csb, tegal`).
- **`/owner/kapster`** — daftar kapster aktif dikelompokkan per cabang (dari `/api/barbers?include_inactive=false` atau endpoint barbers yang ada). Tap kartu kapster → panggil impersonate proxy (lihat §3) → redirect `/barber/home`.

### 2. Owner → Admin (kontrol penuh)

1. **Guard layout admin** (`frontend/src/app/admin/layout.tsx`): saat ini me-redirect `role === 'owner'` ke `/owner/dashboard`. Ubah: izinkan owner masuk. Jika owner **tanpa** `?branch`, redirect ke `/owner/branches` (owner harus memilih cabang dulu).
2. **Resolusi cabang:** ganti `const branch = user?.branch || ''` menjadi `const branch = searchParams.get('branch') ?? user?.branch ?? ''` di 7 halaman admin (dashboard, bookings, barbers, customers, leaderboard, schedule, broadcast).
3. **AdminNav** (`frontend/src/components/AdminNav.tsx`): tiap link tab harus membawa `?branch=<slug>` saat aktif (owner mode) agar scope cabang tidak hilang antar tab. Saat user adalah branch_admin biasa (punya `user.branch`), param opsional.
4. **Header owner mode:** bila `role === 'owner'`, tampilkan tombol "← Owner" (ke `/owner/branches`) + badge cabang aktif; **sembunyikan tombol "Keluar"** (signOut mengakhiri seluruh sesi Supabase owner — tidak diinginkan saat menjelajah). Deteksi owner mode: `user?.role === 'owner'` (bukan `?readonly`).

> Catatan: mode `?readonly=true` lama tetap ada dan tidak diubah; fitur ini memakai jalur full-control terpisah (tanpa `readonly`).

### 3. Owner → Kapster (kontrol penuh) + jalur kembali

1. **Proxy baru `POST /api/owner/impersonate-barber`** (`frontend/src/app/api/owner/impersonate-barber/route.ts`):
   - Verifikasi sesi pemanggil via Supabase server client (`@supabase/ssr`) → pastikan `users.role === 'owner'`. Kalau bukan → 403.
   - Body `{ name }` (atau `barber_id`). Panggil backend `GET /api/admin/crm/impersonate-barber?name=<name>` dengan header `x-admin-token: ADMIN_PASSWORD` (disuntik di server — **tidak ada pw di URL**).
   - Set cookie `redbox_barber_session` (httpOnly, sama seperti verify OTP) **dan** cookie marker `redbox_impersonator=owner` (httpOnly, path `/`).
   - Return `{ ok: true }`; halaman owner `/owner/kapster` lalu `window.location.href = '/barber/home'`.
2. Portal kapster berjalan penuh dari cookie → owner langsung punya kontrol penuh.
3. **Jalur kembali:** `frontend/src/app/barber/layout.tsx` membaca marker `redbox_impersonator`. Jika ada, tampilkan banner tipis di atas: "Mode Owner — Kembali ke Owner". Tap → hapus `redbox_barber_session` + `redbox_impersonator`, redirect `/owner/kapster`. Tanpa marker, perilaku login/keluar kapster normal tidak berubah.
   - Marker dibaca di client: karena cookie marker perlu dibaca komponen, set sebagai cookie **non-httpOnly** (atau sediakan field di `/api/barber/me`). Keputusan: marker non-httpOnly `redbox_impersonator=owner` (hanya penanda UI, bukan kredensial).

## Alur data

```
Owner (Supabase session, role=owner)
 ├─ /owner/branches ──tap cabang──> /admin/dashboard?branch=<slug>
 │     guard admin: owner diizinkan; AdminNav bawa ?branch; aksi pakai proxy /api/admin/crm/* (token server)
 │     ← tombol "Owner" kembali ke /owner/branches
 └─ /owner/kapster ──tap kapster──> POST /api/owner/impersonate-barber {name}
       verifikasi role=owner (ssr) → backend impersonate (token server)
       set cookie redbox_barber_session + redbox_impersonator
       → /barber/home (kontrol penuh via cookie)
       ← banner "Mode Owner" hapus cookie → /owner/kapster
```

## Error handling

- Impersonate gagal (barber tak ketemu / 404): proxy teruskan status + pesan; `/owner/kapster` tampilkan toast/error inline.
- Bukan owner memanggil proxy impersonate: 403.
- Owner buka `/admin/*` tanpa `?branch`: redirect `/owner/branches`.
- Cabang slug tidak valid di `?branch`: halaman admin tampil kosong/empty-state (perilaku existing) — opsional validasi slug terhadap daftar cabang.

## Testing / verifikasi

1. Owner login → buka `/owner/branches` → 5 cabang tampil → tap → masuk `/admin/dashboard?branch=bypass`, data cabang benar, tombol aksi (confirm booking, absensi, broadcast) **berfungsi**.
2. Pindah antar tab admin → `?branch` tetap terbawa.
3. Tombol "← Owner" kembali ke `/owner/branches`.
4. Owner buka `/owner/kapster` → daftar kapster per cabang → tap → masuk `/barber/home` sebagai kapster itu, fitur kapster berfungsi penuh.
5. Banner "Mode Owner" muncul; tap → cookie bersih → kembali `/owner/kapster`.
6. Logout kapster normal (login OTP) tidak menampilkan banner owner.
7. Non-owner (branch_admin/anon) `POST /api/owner/impersonate-barber` → 403.
8. `npx next build` sukses.

## Out of scope

- Tidak mengubah mode `?readonly=true` lama.
- Tidak menambah audit-log impersonasi (bisa menyusul).
- Tidak mengubah alur login kapster OTP maupun login admin/owner.
