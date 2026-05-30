# Home Service Extended Hours & Anti-Korupsi System
**Tanggal:** 2026-05-30  
**Status:** Approved — siap implementasi  
**Scope:** Jam operasional home service 06:00–23:00 WIB + lifecycle tracking + anti-korupsi

---

## 1. Latar Belakang & Tujuan

RedBox Barbershop ingin membuka layanan **home service** di luar jam operasional outlet (saat ini 10:00–20:00/21:00 WIB), dengan window 06:00–23:00 WIB. Tujuan utama:

1. **Menjangkau pelanggan di luar jam outlet** tanpa menambah kapster baru
2. **Meminimalkan korupsi** — semua transaksi harus melalui sistem, kapster tidak bisa buat kesepakatan di luar RedBox
3. **Audit trail lengkap** — setiap langkah tercatat dengan timestamp, terhubung ke Moka sebagai sumber kebenaran laporan keuangan

---

## 2. Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Jam operasional home service | 06:00 – 23:00 WIB |
| Kapster | Kapster outlet yang sama; konflik jadwal dicek otomatis |
| Pembayaran | Di muka via sistem (transfer/QRIS) sebelum booking dikonfirmasi |
| Pemilihan kapster | Pelanggan pilih sendiri; hanya kapster `home_service_enabled = TRUE` tampil |
| Konfirmasi pekerjaan | Double verification: kapster (`BERANGKAT`, `SELESAI`) + pelanggan (`YA`) via WhatsApp |
| Laporan keuangan | Moka adalah sumber kebenaran; setiap job push ke Moka sebagai online order |
| Komisi | Belum diimplementasi; cukup rekap transaksi per kapster dari Moka |
| Pembatalan | Reschedule only — gratis jika H-1 atau lebih awal, diblokir jika H-0 (< 24 jam) |
| Deteksi no-show | Auto-flag via cron tiap 15 menit, notif ke admin |

---

## 3. Arsitektur

```
[ Booking Form (booking.js) ]
        ↓  type=home_service, jam 06:00–23:00
[ Slot Engine (slotEngine.js) ]
        ↓  cek konflik jadwal outlet kapster + filter home_service_enabled
[ API Booking (routes.js) ]
        ↓  insert schedules (type=home_service) + insert home_service_jobs
        ↓  push ke Moka sebagai online order (outlet = outlet asal kapster)
[ WhatsApp Bot (wa/webhook.js) ]
        ↓  notif kapster saat booking → BERANGKAT → SELESAI
        ↓  notif pelanggan → konfirmasi YA
[ Lifecycle Engine ]
        ↓  update status home_service_jobs + update Moka order status
[ Auto-flag Cron (tiap 15 menit) ]
        ↓  deteksi no-show kapster & pelanggan tidak konfirmasi → notif admin
[ Admin Rekap ]
        ↓  rekap transaksi dari Moka; flag log dari home_service_jobs
```

---

## 4. Database Schema

### 4.1 Tabel Baru: `home_service_jobs`

```sql
CREATE TABLE home_service_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           UUID REFERENCES schedules(id) ON DELETE CASCADE,
  status                TEXT DEFAULT 'confirmed',
  -- confirmed | on_the_way | done_barber | completed | flagged
  address               TEXT NOT NULL,
  reschedule_count      INT DEFAULT 0,
  barber_enroute_at     TIMESTAMPTZ,   -- kapster balas BERANGKAT
  barber_done_at        TIMESTAMPTZ,   -- kapster balas SELESAI
  customer_confirmed_at TIMESTAMPTZ,   -- pelanggan balas YA
  flagged_at            TIMESTAMPTZ,
  flag_reason           TEXT,          -- 'barber_no_show' | 'customer_no_confirm'
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_home_service_jobs_schedule_id ON home_service_jobs(schedule_id);
CREATE INDEX idx_home_service_jobs_status ON home_service_jobs(status);
```

### 4.2 Perubahan Tabel `schedules`

```sql
ALTER TABLE schedules
  ADD COLUMN type TEXT DEFAULT 'outlet';
  -- 'outlet' | 'home_service'
```

### 4.3 Perubahan Tabel `barbers`

```sql
ALTER TABLE barbers
  ADD COLUMN home_service_enabled BOOLEAN DEFAULT FALSE;
```

Admin toggle per kapster. Hanya kapster `home_service_enabled = TRUE` yang muncul di booking form home service.

### 4.4 GRANT (Supabase RLS — wajib)

```sql
GRANT SELECT, INSERT, UPDATE ON home_service_jobs TO anon, authenticated;
```

> **Catatan:** Setiap tabel baru di Supabase wajib diikuti GRANT ke `anon` dan `authenticated`, atau PostgREST akan error `permission denied`.

---

## 5. Slot Engine

**File:** `server/moka/slotEngine.js`

Tambah parameter `type` pada request availability:

```
GET /api/availability?outletId=bypass&date=2026-06-02
  &durationMinutes=60&barberId=xxx&type=home_service
```

**Logika perubahan:**
- Jika `type === 'home_service'`: gunakan window **06:00–23:00 WIB** sebagai pengganti jam outlet
- Tetap load existing `schedules` kapster untuk hari tersebut — slot yang sudah terisi (baik outlet maupun home service lain) otomatis diblokir
- Filter barber: hanya tampilkan yang `home_service_enabled = TRUE`
- Interval slot tetap 30 menit; durasi home service fixed 60 menit

**Hasil:** pelanggan melihat slot kosong kapster di window 06:00–23:00, minus jadwal outlet yang sudah ada.

---

## 6. WhatsApp Lifecycle Flow

Semua pesan via Fonnte. Lookup job berdasarkan **nomor HP pengirim** — tidak perlu kode booking.

### 6.1 Notif Kapster — Booking Baru (otomatis saat booking dikonfirmasi)

```
🔔 [HOME SERVICE] Booking Baru

Pelanggan : Budi Santoso
Tanggal   : Senin, 2 Jun 2026 | 07:00 WIB
Alamat    : Jl. Melati No.12, Cirebon
Layanan   : Gentleman Grooming (60 menit)
Harga     : Rp 250.000

Balas BERANGKAT saat berangkat ke lokasi.
Balas SELESAI setelah pekerjaan selesai.
```

### 6.2 Kapster Balas `BERANGKAT`

- Sistem: `status → on_the_way`, catat `barber_enroute_at`
- Lookup: cari `home_service_jobs` dengan barber phone = pengirim, `status = confirmed`, jam booking paling dekat
- Jika ada >1 job aktif dengan status sama: ambil yang paling awal (chronological)
- Notif pelanggan: *"Kapster [nama] sedang dalam perjalanan ke lokasi Anda."*

### 6.3 Kapster Balas `SELESAI`

- Sistem: `status → done_barber`, catat `barber_done_at`
- Lookup: status = `on_the_way` untuk nomor kapster tersebut
- Notif pelanggan:
  ```
  ✅ Kapster [nama] melaporkan pekerjaan selesai.
  Sudah menerima layanan? Balas YA untuk konfirmasi.
  ```

### 6.4 Pelanggan Balas `YA`

- Sistem: `status → completed`, catat `customer_confirmed_at`
- Lookup: cari job dengan customer phone = pengirim, `status = done_barber`
- Update Moka order → completed/paid
- Notif kapster: *"Pekerjaan Anda telah dikonfirmasi selesai oleh pelanggan. Terima kasih!"*

### 6.5 Fallback — Nomor Tidak Dikenali

Jika tidak ada job aktif yang cocok untuk nomor pengirim:
> *"Tidak ada pekerjaan home service aktif yang ditemukan untuk nomor Anda."*

---

## 7. Auto-flag Cron

**File baru:** `api/cron/home-service-flag.js`  
**Jadwal:** Tiap 15 menit (Vercel Cron)

```
Cek 1 — Barber No-Show:
  Query: home_service_jobs WHERE status = 'confirmed'
    AND schedules.start_time < NOW() - interval '30 minutes'
    AND barber_enroute_at IS NULL
  Aksi: set status = 'flagged', flag_reason = 'barber_no_show', flagged_at = NOW()
  Notif: WhatsApp ke WA_ADMIN_NUMBER

Cek 2 — Pelanggan Tidak Konfirmasi:
  Query: home_service_jobs WHERE status = 'done_barber'
    AND barber_done_at < NOW() - interval '45 minutes'
    AND customer_confirmed_at IS NULL
  Aksi: set status = 'flagged', flag_reason = 'customer_no_confirm', flagged_at = NOW()
  Notif: WhatsApp ke WA_ADMIN_NUMBER
```

Format notif admin:
```
⚠️ FLAG HOME SERVICE

Job    : HS-[id singkat]
Kapster: [nama]
Alasan : Kapster tidak berangkat / Pelanggan tidak konfirmasi
Waktu  : [start_time]
Alamat : [address]
```

---

## 8. Reschedule

**Endpoint baru:** `POST /api/home-service/reschedule`

```
Request body:
{
  "jobId": "uuid",
  "newStartTime": "2026-06-05T08:00:00+07:00"
}

Validasi:
1. Job harus status = 'confirmed'
2. schedules.start_time > NOW() + 24 jam  (H-1 check)
3. Slot baru tersedia (cek availability endpoint)

Jika lolos:
- schedules: set status = 'cancelled' pada schedule lama
- Insert schedule baru (type = 'home_service')
- home_service_jobs: update schedule_id, increment reschedule_count
- Push update ke Moka (batalkan order lama, buat order baru)
- Notif WhatsApp ke kapster & pelanggan dengan jadwal baru

Jika gagal (H-0):
HTTP 400: "Reschedule tidak dapat dilakukan kurang dari 24 jam sebelum jadwal."
```

---

## 9. File yang Diubah / Ditambah

| File | Tipe | Perubahan |
|---|---|---|
| `server/moka/slotEngine.js` | Ubah | Terima param `type`; gunakan jam 06:00–23:00 untuk home_service; filter `home_service_enabled` |
| `server/moka/routes.js` | Ubah | Setelah insert schedule, insert `home_service_jobs`; push Moka dengan outlet = barber's outlet |
| `js/booking.js` | Ubah | Kirim `type=home_service` ke availability API |
| `server/whatsapp-ai/services/` | Ubah | Tambah handler `BERANGKAT`, `SELESAI`, `YA` dengan phone-based lookup |
| `server/services/waNotification.js` | Ubah | Tambah `notifyBarberNewHomeServiceJob()` |
| `api/cron/home-service-flag.js` | Baru | Auto-flag cron tiap 15 menit |
| `server/home-service/reschedule.js` | Baru | Endpoint reschedule dengan H-1 validation |
| `vercel.json` | Ubah | Tambah cron entry untuk home-service-flag |
| Supabase migration | Baru | CREATE TABLE home_service_jobs + ALTER schedules + ALTER barbers + GRANT |

---

## 10. Out of Scope (untuk versi ini)

- Sistem komisi per kapster (akan didesain terpisah setelah sistem ini stabil)
- Dashboard admin web untuk monitoring flag (saat ini via WhatsApp notif ke admin)
- GPS check-in/check-out kapster
- Rating/review pelanggan setelah job selesai
