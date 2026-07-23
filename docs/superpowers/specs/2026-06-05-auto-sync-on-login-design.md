# Auto-Sync Moka on Member Login — Design Spec

**Date:** 2026-06-05 
**Status:** Approved 

## Problem

When a returning member (e.g. Pandu with 26 visits) logs in via OTP, their membership dashboard may show stale or incorrect data — wrong visit count, wrong points, wrong "Bergabung sejak" date. Admin cannot realistically sync each member manually one by one.

## Goal

Automatically pull fresh data from Moka whenever a returning member logs in, with a polished barbershop-themed loading experience between OTP success and the dashboard.

---

## UX Flow

```
1. Member login via OTP
2. OTP verify sukses → simpan rb_member_token + redbox_member ke localStorage
3. Redirect ke member-loading.html (BUKAN langsung ke member-dashboard.html)
4. member-loading.html tampil:
 - "Selamat datang, [Nama]!" (diambil dari localStorage)
 - Spinner barber pole (merah-putih, dark background)
 - Cycling copy barbershop (ganti tiap 2.5 detik):
 1. "Sedang mempersiapkan kursi hangat untukmu..."
 2. "Kapster lagi ngasihin minyak rambut dulu..."
 3. "Sebentar ya, sisirnya lagi dicuci..."
 4. "Data kamu hampir siap, sabar dulu bang!"
5. Secara bersamaan: POST /api/member/sync (auth: rb_member_token)
6. Minimum tampil: 2.5 detik (supaya tidak flash)
7. Setelah sync selesai (dan min 2.5s tercapai):
 - Simpan data fresh ke localStorage (redbox_member)
 - Redirect ke member-dashboard.html
8. Jika sync gagal/timeout (>8s): redirect tetap jalan, data lama dipakai
```

---

## Architecture

### Files Changed / Added

| File | Action | Keterangan |
|------|--------|------------|
| `member-loading.html` | **New** | Halaman loading dengan animasi + cycling copy |
| `js/member-loading.js` | **New** | Logic: panggil sync, timing, redirect |
| `server/index.js` | **Modified** | Tambah endpoint `POST /api/member/sync` |
| `member-login.html` | **Modified** | Ganti redirect target: `member-dashboard.html` → `member-loading.html` |

### Endpoint Baru: `POST /api/member/sync`

**Auth:** `Authorization: Bearer {rb_member_token}` — divalidasi via tabel `member_sessions` (pattern yang sudah ada di server/index.js untuk `/api/auth/me`)

**Logic server:**
1. Validasi token → ambil `wa` dari session
2. Normalize phone → panggil Moka API (loop semua outlets)
3. Hitung totalVisits, totalSpent, lastVisit, firstVisit, newPoints, newTier
4. Update `customers` table: visits, points, total_spent, last_visit, first_visit
5. Upsert `member_profiles`: total_points, total_visits, current_tier
6. Return: `{ success: true, full_name, visits, points, tier, last_visit, first_visit, total_spent }`

**Timeout / Error:**
- Moka timeout > 8s → return `{ success: false, error: "timeout" }`
- Token invalid → 401
- Member tidak ditemukan → `{ success: false, error: "not_found" }`

**Reuse:** Logic sync-nya identik dengan `POST /admin/crm/membership/sync-moka` yang sudah ada. Ekstrak ke helper function `runMokaSync(wa)` yang bisa dipakai keduanya.

---

## member-loading.html

**Visual:**
- Background: `#0a0a0a` (hitam)
- Spinner: CSS border animation, merah (`#ef4444`) + putih (`#f5f5f5`)
- Nama pelanggan: dari `localStorage.getItem('redbox_member')` → parse JSON → `.full_name`
- Teks "Selamat datang, [Nama]! "
- Cycling copy: 4 kalimat, ganti tiap 2.5s via `setInterval`

**Timing logic (js/member-loading.js):**
```
const MIN_DISPLAY = 2500 // ms

const syncPromise = fetch('/api/member/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
const minWaitPromise = new Promise(resolve => setTimeout(resolve, MIN_DISPLAY))

Promise.all([syncPromise, minWaitPromise]).then(([res]) => {
 if (res.ok) {
 const fresh = await res.json()
 // merge fresh data ke localStorage redbox_member
 localStorage.setItem('redbox_member', JSON.stringify({ ...existing, ...fresh }))
 }
 // redirect regardless of success/failure
 window.location.href = 'member-dashboard.html'
})
```

**Fallback:**
- Jika `rb_member_token` tidak ada di localStorage → redirect ke `member-login.html`
- Jika sudah di `member-dashboard.html` (back button) → tidak re-trigger sync

---

## member-login.html Change

Satu baris: ganti `window.location.href = 'member-dashboard.html'` → `window.location.href = 'member-loading.html'`

---

## Error Handling

| Skenario | Behavior |
|----------|----------|
| Moka API timeout | Redirect ke dashboard dengan data lama (tidak ada toast) |
| Token expired | Redirect ke member-login.html |
| Network error | Redirect ke dashboard dengan data lama |
| Sync berhasil | Data fresh tersimpan, redirect ke dashboard |

---

## Out of Scope

- Caching: tidak ada "skip sync kalau sudah sync hari ini" — selalu sync setiap login
- Push notification setelah sync
- Animasi transisi antara loading → dashboard
