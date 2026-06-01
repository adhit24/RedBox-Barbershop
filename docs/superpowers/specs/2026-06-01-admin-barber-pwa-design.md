# Admin & Barber PWA — Design Spec
**Date:** 2026-06-01  
**Project:** RedBox Barbershop  
**Scope:** Internal app untuk admin (owner) dan barber, dibangun sebagai PWA di atas Next.js yang sudah ada.

---

## 1. Tujuan

Admin/owner dapat memonitor semua cabang (booking, barber aktif, revenue) dari satu tempat. Barber dapat melihat jadwal pribadi dan menerima notifikasi booking baru, reminder, dan home service dispatch — langsung di HP mereka.

---

## 2. Stack & Deployment

| Layer | Teknologi |
|---|---|
| Frontend | Next.js (existing) + PWA manifest + Service Worker |
| Backend | Express.js + Supabase (tidak diubah) |
| Auth | Supabase Auth (email + password) |
| Push Notification | Web Push API via Service Worker |
| Realtime | Supabase Realtime (subscribe tabel bookings) |
| Hosting | Vercel (existing) |

Platform target: **Android dulu** (Chrome). iOS Safari mendukung PWA install tapi Web Push baru support di iOS 16.4+.

---

## 3. Role & Akses

| Role | Cara Login | Akses |
|---|---|---|
| `owner` | Akun pribadi | Semua cabang, semua fitur |
| `branch_admin` | Akun cabang (untuk tablet) | 1 cabang saja |
| `barber` | Akun pribadi | Jadwal pribadi + notifikasi |

Routing diproteksi via Next.js middleware — redirect ke `/login` kalau belum auth, redirect ke route yang sesuai role setelah login.

---

## 4. Struktur Route

```
/login                    ← semua user
/admin/dashboard          ← owner & branch_admin
/admin/bookings           ← list booking, filter cabang/tanggal
/admin/barbers            ← kelola barber (toggle aktif, override)
/barber/schedule          ← jadwal pribadi hari ini
/barber/home-service      ← detail job home service aktif
/barber/notifications     ← log notifikasi masuk
```

---

## 5. Fitur Per Screen

### /admin/dashboard
- Filter cabang: Bypass | Samadikun | CSB | Sumber | Tegal | Semua
- Card: Total booking hari ini (done / pending / cancel)
- Card: Barber aktif vs nonaktif per cabang
- Card: Estimasi revenue (booking done × tarif per service)
- Refresh otomatis setiap 60 detik atau via Supabase Realtime

### /admin/bookings
- List booking semua cabang, sortir by waktu
- Filter: cabang, tanggal, status (pending/confirmed/done/cancel)
- Tap booking → detail (customer, barber, layanan, waktu)
- Aksi: ubah status (confirm / done / cancel)

### /admin/barbers
- List semua barber + status aktif/nonaktif per cabang
- Toggle aktif/nonaktif langsung dari list
- Set today-override (barber libur mendadak hari ini)

### /barber/schedule
- Jadwal pribadi hari ini, urutkan by jam
- Setiap slot: nama customer, layanan, jam, status
- Update realtime via Supabase Realtime
- Kalau tidak ada jadwal: tampilkan pesan kosong

### /barber/home-service
- Muncul card khusus jika ada job home service aktif
- Info: nama customer, alamat, jam, nomor WA customer
- Tombol "Buka Google Maps" → deep link ke maps dengan alamat prefill
- Status job: on the way / arrived / done

### /barber/notifications
- Log semua notif: booking baru, reminder, dispatch
- Tandai sudah dibaca
- Tidak ada hapus — hanya read-only history

---

## 6. PWA Config

- `manifest.json`: nama "RedBox Staff", ikon RedBox, theme merah, display: standalone
- Service Worker: cache shell app untuk offline fallback, handle Web Push
- Android Chrome: banner install otomatis muncul setelah kriteria PWA terpenuhi
- Setelah install: buka full screen tanpa address bar, ikon di home screen

---

## 7. Push Notification

### Flow
1. Barber buka app → browser minta izin notifikasi
2. Jika diizinkan → generate push subscription token
3. Simpan token ke tabel `push_subscriptions`
4. Backend kirim Web Push saat: booking baru masuk, reminder 30 menit sebelum jadwal, home service dispatch

### Paralel dengan Fonnte (WA)
Web Push tidak menggantikan WA Fonnte. Keduanya berjalan paralel:
- WA Fonnte: notif ke customer + admin WA
- Web Push: notif internal ke barber di dalam app

---

## 8. Perubahan Database

### Tabel `users` (baru — atau extend Supabase Auth metadata)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'branch_admin', 'barber')),
  branch TEXT,           -- NULL untuk owner, diisi untuk branch_admin & barber
  barber_id TEXT,        -- foreign key ke tabel barbers (untuk role barber)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabel `push_subscriptions` (baru)
```sql
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRANT wajib (sesuai policy project)
GRANT SELECT, INSERT, DELETE ON push_subscriptions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON users TO anon, authenticated;
```

---

## 9. Integrasi API (Existing Endpoints)

Semua endpoint existing dipakai langsung tanpa modifikasi:

| Endpoint | Dipakai oleh |
|---|---|
| `GET /api/bookings?date=&location=` | Admin dashboard & booking list |
| `PATCH /api/bookings/:id` | Admin ubah status |
| `GET /api/barbers` | Admin barber list & dashboard |
| `POST /api/barbers/:id/toggle-active` | Admin toggle barber |
| `POST /api/barbers/:id/today-override` | Admin set libur mendadak |
| `GET /api/bookings?date=&barber_id=` | Barber jadwal pribadi |

Endpoint baru yang perlu ditambah:
- `POST /api/push/subscribe` — simpan push subscription token
- `POST /api/push/send` — kirim Web Push (dipanggil internal oleh server saat ada booking baru)

---

## 10. Estimasi Revenue (Dashboard Admin)

Karena tidak ada tabel harga service di codebase saat ini, gunakan pendekatan sederhana:
- Tambah kolom `price` ke tabel `bookings` (diisi saat booking dibuat)
- Atau hardcode mapping service → harga di frontend sebagai v1
- Revenue = SUM(price) dari booking dengan status `done` hari ini

---

## 11. Migrasi ke React Native (Masa Depan)

PWA ini dirancang sebagai **v1.0**. Jika nanti perlu migrasi ke React Native (Expo):
- Semua API endpoint tetap sama (tidak ada yang berubah)
- Logic auth Supabase bisa dipindah langsung
- UI perlu di-rebuild (React Native pakai View/Text, bukan div/p)
- Push notification diganti Expo Push Notifications (lebih reliable di iOS)

---

## 12. Out of Scope (v1.0)

- Laporan/analitik historis (minggu/bulan)
- Manajemen jadwal shift barber
- Chat internal antar barber
- Pembayaran in-app
- iOS App Store / Google Play Store listing
