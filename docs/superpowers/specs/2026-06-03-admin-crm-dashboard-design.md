# Admin CRM Dashboard — Design Spec

**Date:** 2026-06-03
**Scope:** Branch Admin (branch_admin role) + Owner
**Approach:** Opsi A — upgrade halaman admin yang sudah ada di Next.js (`/admin/*`)

---

## Constraints

- **No revenue / nominal transaksi** — hanya manager/owner yang boleh lihat angka keuangan. Admin cabang hanya lihat count, service, dan status.
- **Branch-scoped** — branch_admin hanya lihat data cabangnya sendiri (`user.branch`). Owner lihat semua + filter per cabang.
- **Existing auth** — pakai `useUser()` + `users` table (role: `branch_admin` | `owner`).

---

## User Roles

| Role | Akses |
|------|-------|
| `owner` | Semua cabang, semua fitur, lihat revenue (existing) |
| `branch_admin` | Cabang sendiri saja, semua fitur kecuali revenue |

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
📝 Laporan
```

---

## Halaman 1: Dashboard (`/admin/dashboard`) — Upgrade

### Stat Cards (atas)
- Booking Hari Ini
- Pending
- Selesai
- Total Customer cabang

### Home Service Tracker
Section khusus — card per barber yang punya booking home service/wedding hari ini.

**Status pipeline:**
```
🟡 Terjadwal → 🔵 Berangkat → 🟢 Sampai → ✅ Selesai
```

Admin bisa update status langsung dari card (tap tombol next status). Status tersimpan ke kolom `status` di tabel `bookings` dengan nilai baru: `departed`, `arrived`.

### Booking Feed (real-time)
List booking masuk hari ini — bisa **Confirm** / **Cancel** inline tanpa pindah halaman.

### Kapster On-Duty
Siapa yang hadir hari ini + jumlah customer masing-masing saat ini.

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

### Walk-in Entry
Tombol **"+ Walk-in"** — form cepat: nama customer (opsional), kapster, service → langsung create booking dengan type `walk_in` dan status `done`.

---

## Halaman 3: Barbers (`/admin/barbers`) — Upgrade

### Tab 1: Kapster
List kapster aktif cabang + performa bulan ini:
- Jumlah customer bulan ini
- Jumlah customer hari ini
- Streak hari ini
- Status kehadiran (hadir / izin / sakit)

**Aksi per kapster:**
- Toggle aktif/nonaktif (existing)
- Tandai izin/sakit hari ini → otomatis blokir slot hari ini

### Tab 2: Absensi
Log kehadiran kapster per hari. Admin bisa input kehadiran harian (hadir/izin/sakit/cuti).

---

## Halaman 4: Customers (`/admin/customers`) — BARU

### 3 Tab

**🔥 Frequent**
Customer yang booking ≥3x di cabang ini bulan ini.
Kolom: Nama · No HP · Kunjungan bulan ini · Kapster favorit · Terakhir datang

**🆕 Baru**
Customer yang baru pertama kali booking di cabang ini (bulan ini atau all-time first visit).
Kolom: Nama · No HP · Tanggal pertama · Kapster · Service

**😴 Dormant**
Customer yang tidak balik sejak >30 hari (pernah datang sebelumnya).
Kolom: Nama · No HP · Terakhir datang · Kapster dulu · Jumlah kunjungan total

### Aksi per Customer
- **WA** — buka `wa.me/62xxx` dengan template pesan (misal: "Halo [nama], sudah lama nih! Yuk balik ke RedBox Bypass 😊")

---

## Halaman 5: Leaderboard (`/admin/leaderboard`) — BARU

### Tab Kategori
| Tab | Metric | Sumber Data |
|-----|--------|-------------|
| 👥 Customer | Count bulan ini | `barber_daily_counts` |
| 🔥 Streak | Hari berturut aktif | `barber_streaks` |
| 🏠 Home Service | Count home service bulan ini | `bookings` type=home_service |

### Tampilan
- Ranking kapster cabang
- Badge tier: Legend 👑 / Elite 💎 / Advanced ⭐ / Rising 🌱
- Level XP dari `barber_xp`
- Branch_admin: hanya kapster cabangnya
- Owner: semua cabang + filter dropdown per cabang

---

## Halaman 6: Schedule (`/admin/schedule`) — BARU

Manajemen jadwal kerja kapster:

- Tampilan kalender mingguan per kapster
- Admin bisa set **hari libur / cuti** per kapster
- Admin bisa **blokir slot** tertentu (tutup cabang, event khusus)
- Perubahan langsung update `schedules` table + blokir slot booking

---

## Halaman 7: Broadcast (`/admin/broadcast`) — BARU

Kirim pengumuman ke kapster cabang:

- **Target:** Semua kapster cabang / kapster tertentu
- **Channel:** Push notification (existing web push) + opsional WA via Fonnte
- **Pesan:** Teks bebas, max 300 karakter
- **Log:** History broadcast yang pernah dikirim

---

## Halaman 8: Laporan (`/admin/laporan`) — BARU

Rekap tanpa nominal transaksi:

### Rekap Harian
- Total customer hari ini vs kemarin vs rata-rata 7 hari
- Kapster terbaik hari ini (by count)
- Booking: online vs walk-in ratio
- Home service count

### Rekap Bulanan
- Trend customer per hari (chart sederhana)
- Top 3 kapster bulan ini
- Customer baru vs returning ratio
- Service paling populer (by count)

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
- `frontend/src/app/admin/laporan/page.tsx`

**File dimodifikasi:**
- `frontend/src/app/admin/dashboard/page.tsx`
- `frontend/src/app/admin/bookings/page.tsx`
- `frontend/src/app/admin/barbers/page.tsx`
- `frontend/src/app/admin/layout.tsx`

---

## Booking Status — Tambahan untuk Home Service

Status baru yang perlu ditambahkan ke flow:

```
pending → confirmed → departed → arrived → done
                   ↘ cancelled
```

`departed` dan `arrived` hanya berlaku untuk type `home_service` dan `wedding`.

---

## Out of Scope (fase ini)

- Inventory / stok produk
- Point of sale / kasir
- Rating & review management (fase berikutnya)
- Payroll kapster
