# Admin CRM Dashboard — Design Spec

**Date:** 2026-06-03
**Scope:** Branch Admin (branch_admin role) + Owner
**Approach:** Opsi A — upgrade halaman admin yang sudah ada di Next.js (`/admin/*`)

---

## Filosofi

Dashboard ini bukan alat laporan — Moka POS sudah handle itu. Dashboard ini adalah **pusat aksi operasional** untuk melancarkan sistem booking website yang sudah berjalan. Admin fokus pada: memastikan booking berjalan lancar, kapster hadir, customer terlayani.

---

## Constraints

- **No revenue / nominal transaksi** — Moka POS yang handle keuangan. Admin hanya lihat count dan status.
- **Branch-scoped** — branch_admin hanya lihat data cabangnya sendiri (`user.branch`). Owner lihat semua cabang.
- **Existing auth** — pakai `useUser()` + `users` table (role: `branch_admin` | `owner`).

---

## User Roles

| Role | Akses |
|------|-------|
| `owner` | Semua cabang, semua fitur |
| `branch_admin` | Cabang sendiri saja |

---

## Navigation (Updated)

```
📊 Dashboard
📋 Bookings
💈 Barbers
👥 Customers
🏆 Leaderboard
📅 Schedule
📣 Broadcast
```

7 halaman — hapus Laporan (Moka handles).

---

## Halaman 1: Dashboard (`/admin/dashboard`) — Upgrade

Pusat komando harian. Semua yang admin perlu tahu sekilas pandang.

### Stat Cards (atas)
- Booking Hari Ini · Pending · Selesai · Total Customer cabang (all-time)

### Home Service Tracker
Section khusus — card per barber yang punya booking home service/wedding hari ini.

**Status pipeline:**
```
🟡 Terjadwal → 🔵 Berangkat → 🟢 Sampai → ✅ Selesai
```

Admin tap tombol untuk advance status. Tersimpan ke `bookings.status` dengan nilai: `departed`, `arrived`.

### Booking Feed
List booking masuk hari ini — admin bisa **Confirm** / **Cancel** inline langsung dari feed tanpa pindah halaman.

### Kapster On-Duty
Siapa yang hadir hari ini + jumlah customer masing-masing saat ini. Kapster yang izin/sakit ditampilkan terpisah dengan badge merah.

---

## Halaman 2: Bookings (`/admin/bookings`) — Upgrade

### Filter Bar
- **Periode:** Hari ini / Minggu ini / Bulan ini
- **Status:** Semua / Pending / Confirmed / Done / Cancelled
- **Type:** Semua / Online / Walk-in / Home Service / Wedding

### Tabel Booking
Kolom: Waktu · Customer · No HP · Kapster · Service · Type badge · Status badge · Aksi

### Actions Per Row
| Aksi | Kondisi |
|------|---------|
| Confirm | Status = pending |
| Cancel | Status = pending / confirmed |
| Done | Status = confirmed |
| Tandai Berangkat | Type = home_service/wedding, status = confirmed |
| Tandai Sampai | Type = home_service/wedding, status = departed |

### Walk-in Entry
Tombol **"+ Walk-in"** — form cepat: nama customer (opsional), kapster, service → create booking type `walk_in`, status `done` langsung.

---

## Halaman 3: Barbers (`/admin/barbers`) — Upgrade

### Tab 1: Kapster
List kapster aktif cabang:
- Jumlah customer bulan ini + hari ini
- Streak aktif
- Status kehadiran hari ini (Hadir / Izin / Sakit)

**Aksi per kapster:**
- Toggle aktif/nonaktif (existing)
- Tandai izin/sakit hari ini → otomatis blokir semua slot hari ini

### Tab 2: Absensi
Log kehadiran per hari. Admin input status harian: Hadir / Izin / Sakit / Cuti.
Tersimpan ke tabel `barber_attendance` (baru).

---

## Halaman 4: Customers (`/admin/customers`) — BARU

Fokus aksi: identifikasi customer yang perlu di-follow up.

### 3 Tab

**🔥 Frequent**
Customer booking ≥3x bulan ini di cabang ini.
Kolom: Nama · No HP · Kunjungan bulan ini · Kapster favorit · Terakhir datang · Aksi WA

**🆕 Baru**
Customer pertama kali booking di cabang ini bulan ini.
Kolom: Nama · No HP · Tanggal pertama · Kapster · Service · Aksi WA

**😴 Dormant**
Customer tidak balik >30 hari.
Kolom: Nama · No HP · Terakhir datang · Total kunjungan · Aksi WA

### Aksi WA per Customer
Buka `wa.me/62xxx` dengan template:
- Frequent: *"Makasih udah setia ke RedBox [cabang]! Slot favoritmu masih ada 😊"*
- Baru: *"Halo [nama], senang kamu coba RedBox [cabang]! Gimana pengalamannya?"*
- Dormant: *"Halo [nama], sudah lama nih! Yuk balik ke RedBox [cabang], ada kapster favoritmu 😊"*

---

## Halaman 5: Leaderboard (`/admin/leaderboard`) — BARU

Motivasi kapster + visibility admin terhadap performa tim.

### Tab Kategori
| Tab | Metric | Sumber Data |
|-----|--------|-------------|
| 👥 Customer | Count bulan ini | `barber_daily_counts` |
| 🔥 Streak | Hari berturut aktif | `barber_streaks` |
| 🏠 Home Service | Count home service bulan ini | `bookings` type=home_service |

### Tampilan
- Ranking kapster + nama + count + badge tier (Legend/Elite/Advanced/Rising) + XP level
- Branch_admin: hanya kapster cabangnya
- Owner: semua cabang + filter dropdown per cabang

---

## Halaman 6: Schedule (`/admin/schedule`) — BARU

Kontrol availability kapster dan slot booking.

- Kalender mingguan per kapster
- Set **libur / cuti** per kapster → blokir slot otomatis
- **Blokir slot** tertentu (tutup cabang, event khusus, maintenance)
- Perubahan langsung update `schedules` table yang sudah ada

---

## Halaman 7: Broadcast (`/admin/broadcast`) — BARU

Kirim pengumuman ke kapster cabang.

- **Target:** Semua kapster cabang / kapster tertentu
- **Channel:** Push notification (existing web push) + opsional WA via Fonnte
- **Pesan:** Teks bebas, max 300 karakter
- **Log:** History broadcast yang pernah dikirim (read-only)

---

## Data Flow

```
Frontend (Next.js)
  └── /app/admin/* pages
        └── fetch → /app/api/admin/* proxy routes
              └── → Express server (server/routes/adminCrm.js) BARU
                    └── Supabase queries (branch-scoped)
```

**File baru backend:**
- `server/routes/adminCrm.js` — semua endpoint CRM baru

**File baru frontend:**
- `frontend/src/app/admin/customers/page.tsx`
- `frontend/src/app/admin/leaderboard/page.tsx`
- `frontend/src/app/admin/schedule/page.tsx`
- `frontend/src/app/admin/broadcast/page.tsx`

**File dimodifikasi:**
- `frontend/src/app/admin/dashboard/page.tsx`
- `frontend/src/app/admin/bookings/page.tsx`
- `frontend/src/app/admin/barbers/page.tsx`
- `frontend/src/app/admin/layout.tsx`

---

## Booking Status — Tambahan untuk Home Service

```
pending → confirmed → departed → arrived → done
                   ↘ cancelled
```

`departed` dan `arrived` hanya untuk type `home_service` dan `wedding`.

---

## DB Baru

- `barber_attendance(barber_id, date, status)` — absensi harian kapster

---

## Out of Scope

- Laporan harian/bulanan (Moka POS handles)
- Revenue / nominal transaksi (manager only)
- Inventory / stok produk
- Payroll kapster
- Rating & review management
