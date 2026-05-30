# Design: Moka Member Auto-Provision via OTP Login

**Date:** 2026-05-30  
**Status:** Approved  
**Scope:** `server/index.js` — OTP send endpoint only

---

## Problem

Member yang sudah terdaftar di Moka POS tidak bisa login via OTP di website RedBox karena:

1. **RC-1 (CRITICAL):** `POST /api/auth/otp/send` hanya cek tabel `customers`. Member Moka yang belum pernah booking via website hanya ada di `member_profiles` → diblok 404.
2. **RC-2 (HIGH):** Format phone berbeda: `member_profiles.phone = "+628xxx"` vs `customers.wa = "628xxx"`.
3. **RC-3 (HIGH):** Walaupun member ada di kedua tabel, data poin/tier dari Moka tidak terbaca saat OTP verify.
4. **RC-4 (MEDIUM):** Cross-ref di `/api/auth/me` gagal jika `phone_e164` null di `customers` (kolom belum ada sebelum migration).

Fix sebelumnya di `/api/auth/me` hanya atasi RC-3 sebagian. RC-1 dan RC-2 belum tersentuh.

---

## Goal

Member yang terdaftar di Moka cukup masukkan nomor WA → login OTP → tampilan dashboard langsung menunjukkan nama, poin, tier, dan status membership dari Moka. Tidak perlu kunjungi outlet lagi. Tidak buat akun baru dari nol.

---

## Approach: Lazy Auto-Provision di OTP Send

Saat `otp/send` dipanggil dan nomor tidak ada di `customers`, server fallback ke `member_profiles`. Jika ditemukan, buat row baru di `customers` dengan data Moka (sekali saja). Selanjutnya data hidup di `customers` dan bisa diubah sendiri oleh member.

---

## Data Flow

```
POST /api/auth/otp/send { phone: "081234..." }
  │
  ├─ normalizeWa("081234...") → wa = "628xxx"
  │
  ├─ [1] customers.wa = wa ?
  │       ADA  → lanjut ke send OTP (existing flow)
  │       TIDAK ↓
  │
  ├─ [2] member_profiles.phone = "+628xxx" ?
  │       TIDAK → 404 "Nomor tidak terdaftar" (same as before)
  │       ADA  ↓
  │
  ├─ [3] Upsert ke customers (auto-provision, sekali saja)
  │       onConflict: 'wa' → aman dari race condition & double-call
  │
  └─ [4] Lanjut kirim OTP menggunakan customer yang baru dibuat

POST /api/auth/otp/verify — tidak ada perubahan
GET  /api/auth/me         — cross-ref sudah ada sebagai safety net
```

---

## Data Mapping: member_profiles → customers

| Field `member_profiles` | Field `customers` | Aturan |
|---|---|---|
| `full_name` | `name` | Copy as-is |
| *(normalized input)* | `wa` | `"628xxx"` tanpa `+` |
| `phone` | `phone_e164` | `"+628xxx"` dengan `+` |
| `email` | `email` | Skip jika format `moka_*@redbox.internal` |
| `membership_status` | `membership_status` | `'ACTIVE'` atau `'INACTIVE'` |
| `membership_activated_at` | `membership_activated_at` | Null-safe |
| `total_points` | `points` | Default 0 jika null |
| `total_visits` | `visits` | Default 0 jika null |
| `referral_code` | `referral_code` | Generate baru jika null di member_profiles |
| `birthdate` | `birth_date` | Nama kolom beda — mapping eksplisit |
| `gender` | `gender` | Null-safe |
| `address` | `address` | Null-safe |

---

## Error Handling

| Skenario | Perilaku |
|---|---|
| `member_profiles` query gagal | Log warning, lanjut ke 404 |
| Provisioning ke `customers` gagal | Tetap kirim OTP dengan data in-memory; provisioning dicoba lagi login berikutnya |
| Nomor ada di `customers` DAN `member_profiles` | Skip provisioning, pakai `customers` |
| `member_profiles.phone` non-standard | Coba lookup `'+' + wa` saja (format E.164) |
| Email sintetis `moka_*@redbox.internal` | Set `email = null` di `customers` |
| Race condition (2 request bersamaan) | Upsert `onConflict: 'wa'` handle native di Supabase |

---

## Files Changed

| File | Perubahan |
|---|---|
| `server/index.js` | Tambah fallback lookup + auto-provision di `POST /api/auth/otp/send` |
| `server/migrations/2026-05-30-customers-membership-fields.sql` | Sudah ada — tambah `membership_status`, `membership_activated_at` ke `customers` |

**Tidak ada perubahan di:** `otp/verify`, `auth/me`, dashboard JS, HTML.

---

## Out of Scope

- Sync balik dari `customers` ke `member_profiles`
- Auto-update data member saat login ke-2, ke-3, dst (hanya sekali saat provisioning)
- Registrasi member baru yang belum ada di Moka (tetap harus ke outlet)
- Perubahan UI/dashboard

---

## Success Criteria

1. Member Moka dengan nomor terdaftar di `member_profiles` bisa menerima OTP tanpa error 404
2. Setelah login, dashboard menampilkan nama, poin, tier, dan status membership dari Moka
3. Member yang sudah pernah login (ada di `customers`) tidak terpengaruh
4. Tidak ada duplikasi row di `customers` walau OTP dipanggil berulang
