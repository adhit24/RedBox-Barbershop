# Branch Operations Center — Design Spec

**Date:** 2026-06-03
**Scope:** Branch Admin (branch_admin role) + Owner
**Approach:** Upgrade halaman admin yang sudah ada di Next.js (`/admin/*`)

---

## Filosofi

Bukan alat laporan — Moka POS sudah handle itu.
Ini adalah **pusat aksi operasional** untuk melancarkan sistem booking website.
Sistem bekerja untuk admin, bukan admin yang bekerja untuk sistem.

---

## Constraints

- **No revenue** — admin hanya lihat count, status, dan aksi. Nominal transaksi = manager/owner only.
- **Branch-scoped** — branch_admin hanya lihat data cabangnya. Owner lihat semua cabang.
- **Mobile-first** — admin pakai HP di lapangan.
- **Existing auth** — `useUser()` + `users` table (role: `branch_admin` | `owner`).

---

## Fitur yang TIDAK dibangun (sengaja dihilangkan)

- Slot per kursi fisik (tidak relevan untuk barbershop)
- GPS + selfie check-in (distrust, behavioral change terlalu besar)
- Incident ticketing dengan foto + PIC (terlalu formal)
- Daily task checklist (lebih efektif manual di tempat)
- Barber Workload Balancer otomatis (data tidak selalu akurat)
- Waiting list management (kompleksitas tinggi, nilai rendah)
- Semua laporan keuangan / rekap penjualan

---

## Navigation

```
📊 Command Center     ← rename dari Dashboard
📋 Booking Control
💈 Attendance
👥 Customers
🏆 Leaderboard
📅 Schedule
📣 Broadcast
```

---

## Halaman 1: Command Center (`/admin/dashboard`) — Upgrade

Admin tahu kondisi cabang dalam 5 detik.

### Status Cards

| Card | Isi |
|------|-----|
| 🟢 Barber Hadir | Count barber hadir hari ini |
| 🔴 Tidak Hadir | Count izin/sakit/cuti |
| 📋 Booking Hari Ini | Total booking hari ini |
| ⏳ Pending | Booking belum di-confirm |
| 🏠 Home Service Aktif | Home service sedang berjalan |

### Smart Alerts (otomatis, muncul kalau ada masalah)

| Kondisi | Alert |
|---------|-------|
| Barber belum check-in jam > 10:00 | ⚠️ [Nama] belum hadir — ada booking jam [X] |
| Booking pending > 1 jam | ⚠️ Booking [nama customer] jam [X] belum di-confirm |
| Home service belum `departed` 30 menit sebelum jadwal | ⚠️ [Barber] belum berangkat untuk home service jam [X] |
| Customer dengan visit ≥ 10x booking hari ini | ⭐ Customer VIP [nama] booking hari ini |

Alert hanya muncul kalau ada kondisi bermasalah. Kalau semua oke, tidak ada alert.

### Home Service Tracker

Card per booking home service/wedding hari ini.

Status pipeline:
```
🟡 Terjadwal → 🔵 Berangkat → 🟢 Sampai → 🔄 Dikerjakan → ✅ Selesai
```

Admin tap tombol untuk advance status. Tersimpan ke `bookings.status`: `departed`, `arrived`, `in_progress`.

### Booking Feed

List booking masuk hari ini — admin bisa **Confirm** / **Cancel** inline.

---

## Halaman 2: Booking Control (`/admin/bookings`) — Upgrade

### Filter Bar
- **Periode:** Hari ini / Minggu ini / Bulan ini
- **Status:** Semua / Pending / Confirmed / Done / Cancelled / No-show
- **Type:** Semua / Online / Walk-in / Home Service / Wedding

### Tabel Booking
Kolom: Waktu · Customer · No HP · Kapster · Service · Type badge · Status badge · Aksi

### Actions Per Row

| Aksi | Kondisi |
|------|---------|
| Confirm | pending |
| Cancel | pending / confirmed |
| Done | confirmed |
| No-show | confirmed, lewat jadwal |
| Reassign Barber | pending / confirmed → pilih barber lain |
| Reschedule | pending / confirmed → pilih tanggal + waktu baru |
| Convert Walk-in | pending → ubah jadi walk-in, status done langsung |
| Tandai Berangkat | home_service/wedding, confirmed |
| Tandai Sampai | home_service/wedding, departed |

### Smart Reassignment
Saat admin klik Reassign, sistem tampilkan daftar barber tersedia hari itu diurutkan berdasarkan:
1. Sudah hadir hari ini
2. Jumlah booking hari ini (terkecil ke terbesar — load balancing manual)
3. Skill match (kalau data tersedia)

Admin tetap yang memilih — sistem hanya membantu urutan rekomendasi.

### Walk-in Entry
Tombol **"+ Walk-in"** — form: nama customer (opsional) · kapster · service → create booking type `walk_in`, status `done`.

---

## Halaman 3: Attendance (`/admin/barbers`) — Upgrade

### Tab 1: Hari Ini
List semua barber cabang + status kehadiran hari ini.

Status: **Hadir** / **Terlambat** / **Izin** / **Sakit** / **Cuti** / **Belum Check-in**

Admin bisa:
- Update status kehadiran manual
- Lihat jumlah customer hari ini per barber
- Toggle aktif/nonaktif (existing)

Jika barber ditandai izin/sakit → sistem otomatis blokir slot barber tersebut hari ini.

### Tab 2: Riwayat Absensi
Kalender + log kehadiran per barber. Filter per bulan.
Ringkasan: hadir X hari, izin Y hari, sakit Z hari bulan ini.

**DB baru:** `barber_attendance(barber_id, date, status, note, updated_by)`

---

## Halaman 4: Customers (`/admin/customers`) — BARU

Fokus: identifikasi customer yang butuh follow-up, bukan analitik.

### 3 Tab

**🔥 Loyal**
Booking ≥ 5x all-time di cabang ini.
Kolom: Nama · No HP · Total kunjungan · Kapster favorit · Terakhir datang

**🆕 Baru**
Pertama kali booking di cabang ini (bulan ini).
Kolom: Nama · No HP · Tanggal pertama · Kapster · Service

**😴 Dormant**
Tidak balik > 30 hari (pernah datang sebelumnya).
Kolom: Nama · No HP · Terakhir datang · Total kunjungan

### Aksi WA (1 klik)
Buka `wa.me/62xxx` dengan template pre-filled:
- Loyal: *"Makasih udah setia ke RedBox [cabang]! Kapster favoritmu siap melayani 😊"*
- Baru: *"Halo [nama], senang kamu coba RedBox [cabang]! Gimana pengalamannya? 😊"*
- Dormant: *"Halo [nama], sudah lama nih! Yuk balik ke RedBox [cabang] 😊"*

---

## Halaman 5: Leaderboard (`/admin/leaderboard`) — BARU

Visibility admin terhadap performa tim — non-finansial.

### Tab Kategori

| Tab | Metric | Data |
|-----|--------|------|
| 👥 Customer | Count bulan ini | `barber_daily_counts` |
| 🔥 Streak | Hari aktif berturut | `barber_streaks` |
| 🏠 Home Service | Count home service bulan ini | `bookings` |

Tampilan: Rank · Nama · Count · Badge Tier · Level XP

Branch_admin: kapster cabangnya saja.
Owner: semua cabang + filter dropdown.

---

## Halaman 6: Schedule (`/admin/schedule`) — BARU

Kontrol availability kapster dan slot.

- Kalender mingguan per kapster
- Set libur/cuti per kapster → blokir slot otomatis
- Blokir slot range (tutup cabang, event, dll)
- Update `schedules` table yang sudah ada

---

## Halaman 7: Broadcast (`/admin/broadcast`) — BARU

Kirim pengumuman ke kapster cabang.

- **Target:** Semua kapster cabang / pilih kapster tertentu
- **Channel:** Push notification (existing) + WA via Fonnte (opsional)
- **Pesan:** Teks bebas, max 300 karakter
- **Log:** Riwayat broadcast yang pernah dikirim

---

## Booking Status — Extended

```
pending → confirmed → departed → arrived → in_progress → done
                   ↘ cancelled
                   ↘ no_show
```

`departed`, `arrived`, `in_progress` hanya untuk `home_service` dan `wedding`.

---

## DB Baru

```sql
-- Absensi harian barber
CREATE TABLE barber_attendance (
  barber_id   TEXT NOT NULL REFERENCES barbers(id),
  date        DATE NOT NULL,
  status      TEXT NOT NULL, -- hadir | terlambat | izin | sakit | cuti
  note        TEXT,
  updated_by  UUID REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (barber_id, date)
);
```

---

## Data Flow

```
Frontend /admin/* pages
  → /app/api/admin/* proxy routes (Next.js)
    → Express server/routes/adminCrm.js (BARU)
      → Supabase (branch-scoped queries)
```

---

## File Map

### Backend (server/)
- `routes/adminCrm.js` — BARU: semua endpoint CRM

### Frontend (frontend/src/)
- `app/admin/dashboard/page.tsx` — MODIFY: Command Center
- `app/admin/bookings/page.tsx` — MODIFY: Booking Control
- `app/admin/barbers/page.tsx` — MODIFY: Attendance tabs
- `app/admin/customers/page.tsx` — BARU
- `app/admin/leaderboard/page.tsx` — BARU
- `app/admin/schedule/page.tsx` — BARU
- `app/admin/broadcast/page.tsx` — BARU
- `app/admin/layout.tsx` — MODIFY: nav updated
