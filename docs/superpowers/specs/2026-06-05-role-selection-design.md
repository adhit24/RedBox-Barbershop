# Role Selection Screen — Design Spec

**Date:** 2026-06-05 
**Status:** Approved 
**Feature:** Role picker sebelum login di `admin.redboxbarbershop.com`

---

## Overview

Saat pengguna membuka `admin.redboxbarbershop.com`, mereka melihat halaman pemilihan role sebelum login. Setelah memilih role, mereka diarahkan ke halaman login yang sesuai.

---

## Flow

```
admin.redboxbarbershop.com
 │
 ▼
 middleware
 │
 ├── sudah login? → dashboard masing-masing (tidak berubah)
 │
 └── belum login? → / (role picker)
 │
 ├── [1] OWNER → /login
 ├── [2] KASIR/ADMIN → /login
 └── [3] KAPSTER → /barber/login
```

- `/login` (email + password) dan `/barber/login` (OTP nomor HP) tidak diubah.
- Setelah login sukses, middleware mengarahkan ke dashboard sesuai role seperti biasa.
- Role yang dipilih **tidak disimpan** — role picker ditampilkan setiap kali pengguna belum login.

---

## Architecture

### File baru
- `frontend/src/app/page.tsx` — Role picker page (menggantikan redirect default)

### File diubah
- `frontend/src/middleware.ts` — dua perubahan:
 1. Tambah `/` ke daftar public routes
 2. Redirect unauthenticated dari `/login` → `/`

---

## UI Design

**Style:** Minimal typographic, dark theme konsisten dengan halaman login yang ada.

**Layout:**
- Background: `#070508`
- Logo teks: **RED**`BOX` (WHITE + RED), centered
- Subtitle: `SIAPAKAH ANDA?` — uppercase, spasi lebar, warna abu-abu `#777`
- 3 tombol full-width, border tipis `#2a2a2a`, dengan nomor lingkaran di kiri:
 - `1 OWNER`
 - `2 KASIR / ADMIN`
 - `3 KAPSTER`
- Hover state: border `#C72820`, teks `#fff`
- Animasi: Framer Motion fade-in + slide-up saat halaman dimuat (konsisten dengan `/login`)

**Behavior per tombol:**
| Tombol | Navigasi ke |
|--------|-------------|
| OWNER | `/login` |
| KASIR / ADMIN | `/login` |
| KAPSTER | `/barber/login` |

---

## Middleware Changes

File: `frontend/src/middleware.ts`

Tiga perubahan:

1. **Tambah `/` ke public routes** — supaya unauthenticated user bisa mengakses role picker tanpa redirect loop.

2. **Ganti redirect unauthenticated** — unauthenticated user yang mengakses halaman private diarahkan ke `/` (bukan `/login`).

3. **Tambah redirect untuk authenticated user di `/`** — di awal middleware, jika user sudah login dan mengakses `/`, langsung redirect ke dashboard mereka (sama seperti perilaku existing untuk route lain). Ini mencegah user yang sudah login melihat role picker.

```typescript
// (1) Authenticated user mengakses '/' → redirect ke dashboard
if (pathname === '/' && user) {
 const role = ...; // ambil dari session/cookie
 return NextResponse.redirect(new URL(dashboardFor(role), req.url));
}

// (2) Public routes (termasuk '/') → let through
const publicRoutes = ['/', '/login', '/barber/login', '/signage'];

// (3) Unauthenticated + private route → redirect ke '/'
return NextResponse.redirect(new URL('/', req.url));
```

---

## Out of Scope

- Menyimpan pilihan role di localStorage/cookie
- Animasi transisi ke halaman login berikutnya (hanya navigasi biasa)
- Perubahan pada `/login` atau `/barber/login`
- Backend changes
