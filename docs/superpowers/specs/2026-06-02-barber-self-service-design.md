# Barber Self-Service App — Design Spec
**Date:** 2026-06-02
**Project:** RedBox Barbershop
**Scope:** Aplikasi self-service untuk kapster supaya bisa lihat history, performance, progress kedepan, dan termotivasi via gamification ringan.

---

## 1. Tujuan

Semua kapster (~25 orang di 5 cabang) bisa onboarding sendiri lewat WA OTP, lalu pakai PWA-nya untuk:
- Lihat jadwal hari ini + preview booking & home service kedepan (reminder)
- Track performance pribadi (customer, revenue, jam kerja, rating)
- Termotivasi via streak, badges, missions, personal best, leaderboard tier
- Akses history customer lengkap

Sistem otomatis mengenali kapster dari nomor HP yang sudah terdaftar di tabel `barbers`.

---

## 2. Stack & Integrasi

| Layer | Pilihan |
|---|---|
| Frontend | Next.js 16 (existing PWA, halaman baru di `/barber/*`) |
| Backend | Express.js (existing, tambah endpoint `/api/barber/*`) |
| Auth | Custom phone OTP via Fonnte WA (extend infrastruktur OTP yang sudah jalan untuk customer) |
| Storage avatar | Supabase Storage bucket baru `barber-avatars` |
| Push notification | Web Push existing (`server/services/webPush.js`) |
| Realtime | Supabase Realtime (sudah jalan untuk schedule page) |
| **Cron jobs** | **cron-job.org** (bukan Vercel — Hobby plan 12-function limit habis) |

---

## 3. Auth & Enrollment Flow

### Onboarding via WA OTP (zero admin work)

```
1. Buka /barber/login
2. Input nomor HP (contoh: 08123...)
3. Server normalisasi → 6281...
   Cek di tabel barbers WHERE phone = ?
   ├─ Tidak ada → "Nomor tidak terdaftar, hubungi admin"
   └─ Ada → Generate OTP 6 digit → kirim via Fonnte WA
4. Kapster input OTP
5. Server verify OTP →
   - Cek apakah ada row di `barber_users` (tabel baru)
   - Kalau belum: auto-enroll (insert)
   - Issue session token → set cookie HttpOnly `redbox_barber_session` (30 hari)
6. Cek `setup_completed`:
   - false → redirect ke /barber/setup
   - true  → redirect ke /barber/home
```

### Dual auth system

`useUser` hook diperluas untuk membaca dua jenis session:
- Cookie `sb-*` (Supabase Auth) → role owner/branch_admin
- Cookie `redbox_barber_session` (custom OTP) → role barber

Backend middleware:
- `adminAuth` (existing) — admin token via header
- `supabaseAuth` (existing untuk owner/branch_admin)
- `barberAuth` (BARU) — validasi `barber_sessions.token`, attach `req.barber`

---

## 4. First-Time Setup

### Halaman `/barber/setup` (wajib, tidak bisa dilewati)

3 field yang harus diisi:

1. **Foto profil** — upload ke Supabase Storage bucket `barber-avatars` path `{barber_id}/avatar.jpg`, max 2MB, auto-resize ke 400×400 di client
2. **Target harian** — angka customer per hari (default hint: 10)
3. **Target bulanan** — angka customer per bulan (default hint: 250)

Setelah save: `setup_completed = true`, redirect ke `/barber/home`.

Bisa diubah lagi kapan saja dari `/barber/profile`.

---

## 5. Struktur Halaman (4 Tab)

```
Bottom Nav: [ 🏠 Home ] [ 📅 Jadwal ] [ 📊 Progress ] [ 👤 Saya ]
```

### Tab 1: `/barber/home` — Dashboard Personal

Fokus: **apa yang akan terjadi & momentum hari ini**.

- Header: Halo + tanggal hari ini
- Card: 🎯 Target hari ini (progress bar, X/Y customer, revenue terkumpul)
- Card: ⏰ Berikutnya (booking dalam 30 menit, sisa waktu countdown)
- Card: 🏠 Home service hari ini (list singkat dengan tombol Maps + WA)
- Card: 📅 Besok (preview booking + home service besok)
- Card: 🔥 Streak indicator (lihat Bagian 7.1)

### Tab 2: `/barber/schedule` — Jadwal Lengkap

Halaman existing (Task 9 build sebelumnya), tambahkan **tab filter**:
- Hari Ini (default — yang sudah ada)
- Besok
- Minggu Ini

Tetap pakai Supabase Realtime untuk auto-update.

### Tab 3: `/barber/progress` — Performance, History, Motivation

- Filter periode: Hari / Minggu / Bulan / Tahun
- Stats card grid (4 grid): 👥 Customer · 💰 Revenue · ⏱️ Jam kerja · ⭐ Rating
- 🏆 Tier indicator (lihat Bagian 7.10) + link ke leaderboard
- 🔥 Streak card (current + longest)
- 🏅 Badge grid (badge earned + progress badge belum di-unlock)
- 🎯 Misi minggu ini (3 mission dengan progress bar)
- 📊 Personal best card
- 🤝 Customer setia (top 5 repeat customer)
- 🌟 Highlight review positif (kutipan review 5⭐ terbaru)
- 📜 History customer (list, scroll, filter by date)

### Tab 4: `/barber/profile` — Saya

- Header: foto + nama + cabang
- Section: ubah target harian/bulanan
- Section: ganti foto profil
- Section: toggle notifikasi push
- Tombol: 🚪 Logout (destroy session)

### Halaman tambahan: `/barber/leaderboard`

Akses dari Tab 3.

Tier system (bukan ranking absolut, sesuai preferensi user):
- 👑 LEGEND (top 10%)
- 💎 ELITE (top 30%)
- ⭐ ADVANCED (middle)
- 🌱 RISING (bottom)

Highlight tier kapster yang login, tampilkan butuh berapa customer lagi untuk naik tier.

---

## 6. Database Schema (Tabel Baru)

### Auth & profil

```sql
-- Profil + setup status kapster
CREATE TABLE barber_users (
  barber_id      TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
  phone          TEXT NOT NULL,             -- normalized 62...
  avatar_url     TEXT,
  target_daily   INT,
  target_monthly INT,
  setup_completed BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON barber_users TO anon, authenticated;

-- Session token untuk kapster (custom OTP, tidak via Supabase Auth)
CREATE TABLE barber_sessions (
  token      TEXT PRIMARY KEY,
  barber_id  TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_barber_sessions_barber_id ON barber_sessions(barber_id);
GRANT SELECT, INSERT, DELETE ON barber_sessions TO anon, authenticated;
```

### Gamification

```sql
-- Badge yang sudah didapat
CREATE TABLE barber_achievements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id  TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  badge_key  TEXT NOT NULL,                 -- 'hair_cut_master', 'color_expert', ...
  earned_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (barber_id, badge_key)
);
CREATE INDEX idx_barber_achievements_barber_id ON barber_achievements(barber_id);
GRANT SELECT, INSERT ON barber_achievements TO anon, authenticated;

-- Streak harian
CREATE TABLE barber_streaks (
  barber_id       TEXT PRIMARY KEY REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  current_streak  INT DEFAULT 0,
  longest_streak  INT DEFAULT 0,
  last_hit_date   DATE
);
GRANT SELECT, INSERT, UPDATE ON barber_streaks TO anon, authenticated;

-- Personal records (cached, di-update saat trigger)
CREATE TABLE barber_records (
  barber_id                 TEXT PRIMARY KEY REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  best_customer_per_day     INT DEFAULT 0,
  best_customer_per_day_at  DATE,
  best_revenue_per_month    BIGINT DEFAULT 0,
  best_revenue_per_month_at TEXT,           -- 'YYYY-MM'
  best_rating_per_month     NUMERIC(3,2) DEFAULT 0,
  best_rating_per_month_at  TEXT,
  longest_streak_at         DATE
);
GRANT SELECT, INSERT, UPDATE ON barber_records TO anon, authenticated;

-- Mission mingguan
CREATE TABLE barber_missions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id    TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,               -- Senin minggu ini
  mission_key  TEXT NOT NULL,               -- 'serve_50_customer', 'no_cancel', ...
  target       INT NOT NULL,
  progress     INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  UNIQUE (barber_id, week_start, mission_key)
);
CREATE INDEX idx_barber_missions_barber_week ON barber_missions(barber_id, week_start);
GRANT SELECT, INSERT, UPDATE ON barber_missions TO anon, authenticated;
```

### Supabase Storage

```
Bucket: barber-avatars
Public: yes (read)
Auth required: yes (write, by barber)
Path pattern: {barber_id}/avatar.jpg
Max file size: 2MB
```

---

## 7. Sistem Motivasi (Detail Mekanika)

### 7.1 🔥 Streak

- **Hitung:** Saat cron malam jam 23:55 WIB
- **Logic:**
  - Jika hari ini count(booking done) ≥ target_daily → `current_streak++`, update `last_hit_date`
  - Jika tidak → `current_streak = 0`
  - Update `longest_streak` jika `current_streak > longest_streak`
- **Notifikasi push:**
  - Hit target → "🔥 Streak {n} hari! Mantap"
  - Tidak hit + streak putus → "Yah, streak {n} hari putus. Mulai lagi besok!"
  - Tidak hit + tidak ada streak → silent
- **Reminder real-time:** Saat sore (17:00) jika sisa ≤ 2 customer untuk hit target, kirim push.

### 7.2 🏅 Achievements / Badges

| Badge | Trigger |
|---|---|
| ✂️ Hair Cut Master | 500 booking done dengan service mengandung "Gunting" |
| 🎨 Color Expert | 100 booking done dengan service mengandung "Color" |
| 👑 Loyal Magnet | 50 unique repeat customer (≥3x visits) |
| 🏠 Home Service Hero | 25 booking done dengan type='home_service' |
| ⭐ Five Star Streak | 20 review 5⭐ berturut-turut |
| 🔥 Streak Master | longest_streak ≥ 30 |
| 🌅 Early Bird | 10 booking done dengan time < 10:00 |
| 🌙 Night Owl | 10 booking done dengan time ≥ 20:00 |
| 💎 Diamond Hand | 1000 total booking done |

**Check trigger:** Setiap booking status berubah ke `done` di endpoint `/api/booking-status`, panggil `checkAchievements(barber_id)`.
**Saat unlock:** insert ke `barber_achievements` + push notif celebratory.

### 7.3 🎯 Personal Records

- Best customer/hari, best revenue/bulan, best rating/bulan, longest streak
- Update otomatis saat melebihi rekor lama
- Saat pecahkan rekor → push notif: "🏆 PERSONAL BEST! ..."

### 7.4 💡 Mission Mingguan

- Generate tiap Senin 06:00 WIB (cron)
- 3 mission per kapster:
  1. **Volume:** "Layani {N} customer minggu ini" — N = avg minggu lalu × 1.1, min 30
  2. **Quality:** "Dapat {N} review 5⭐" — N = 10
  3. **Consistency:** "0 cancel/no-show" — target boolean
- Progress di-update real-time saat booking event
- Selesai semua → badge "Weekly Champion" + streak +2

### 7.5 🤝 Customer Favorite

Query repeat customer (≥3x visit):
```sql
SELECT name, COUNT(*) AS visits, MAX(date) AS last_visit, service
FROM bookings WHERE barber_id = ? AND status = 'done'
GROUP BY name HAVING COUNT(*) >= 3
ORDER BY visits DESC, last_visit DESC LIMIT 5;
```
Tampilkan dengan layanan favoritnya (most frequent service).

### 7.6 📈 Pace Prediction

Di Home tab, hitung:
```
days_passed_in_month = today's day number
days_remaining = days_in_month - days_passed_in_month
current_count = count done bulan ini
current_pace = current_count / days_passed_in_month
predicted_end = current_count + (current_pace × days_remaining)
needed_per_day = (target_monthly - current_count) / days_remaining
```
Tampilkan status: `predicted_end >= target_monthly ? "✅ On track" : "💪 Tambah {needed_per_day - current_pace} customer/hari"`.

### 7.7 🎁 Reward Trigger

Flag eligible reward saat:
- Hit target bulanan + streak ≥ 20 hari
- Top 1 leaderboard bulanan di cabang
- Unlock badge tier (Diamond Hand, dll)

Endpoint `GET /api/admin/rewards` baru → owner lihat dashboard kapster eligible reward. Reward fisiknya tetap di-handle offline.

### 7.8 🌟 Review Highlight

Tampilkan 2-3 kutipan review 5⭐ terbaru milik kapster. Source: tabel `reviews` (existing) yang sudah connect ke `booking_id`.

### 7.9 ⚡ Smart Notifications (3 cron)

| Jam | Cron | Konten |
|---|---|---|
| 07:00 | `/api/cron/barber-reminder-morning` | "Selamat pagi! Hari ini X booking + Y home service. Streak {n} hari menanti 💪" |
| 17:00 | (di-trigger inline saat booking done) | "Sisa {n} customer lagi untuk hit target hari ini!" |
| 23:55 | `/api/cron/barber-streak-daily` | Streak update + celebrate / encourage |
| Senin 06:00 | `/api/cron/barber-mission-weekly` | "🎯 Misi minggu ini sudah siap!" |

### 7.10 🏆 Tier System (bukan ranking absolut)

Hitung berbasis count customer bulan berjalan, per cabang:
- Sort kapster cabang itu by count
- Top 10% → 👑 LEGEND
- Top 11-30% → 💎 ELITE
- Middle 31-70% → ⭐ ADVANCED
- Bottom 70-100% → 🌱 RISING

Endpoint return tier + "butuh +N customer untuk naik ke tier berikutnya".

---

## 8. Backend Endpoint Baru

### Auth (custom OTP for barber)

```
POST /api/barber/auth/otp/send       { phone }              → { ok: true }
POST /api/barber/auth/otp/verify     { phone, code }        → set cookie + { barber, setup_completed }
POST /api/barber/auth/logout                                → clear cookie
```

### Setup

```
POST /api/barber/setup               { target_daily, target_monthly }
POST /api/barber/avatar/upload       (multipart)           → { avatar_url }
```

### Data

```
GET  /api/barber/me                                         → { profile, setup_completed }
GET  /api/barber/stats?period=day|week|month|year           → { count, revenue, hours, rating }
GET  /api/barber/upcoming                                   → { next: {...}, today: [...], tomorrow: [...] }
GET  /api/barber/history?period=...&offset=&limit=          → { items: [...] }
GET  /api/barber/achievements                               → { earned: [...], in_progress: [...] }
GET  /api/barber/records                                    → barber_records row
GET  /api/barber/missions                                   → mission minggu ini + progress
GET  /api/barber/streak                                     → { current, longest, last_hit_date }
GET  /api/barber/leaderboard                                → { tier, position_pct, next_tier_needed }
GET  /api/barber/favorites                                  → repeat customers
GET  /api/barber/reviews                                    → review 5⭐ highlights
PUT  /api/barber/target                  { daily, monthly }  → update target
PUT  /api/barber/notifications-toggle    { enabled }
```

### Cron (admin token, dipanggil dari cron-job.org)

```
POST /api/cron/barber-streak-daily          jadwal: 23:55 WIB tiap hari
POST /api/cron/barber-mission-weekly        jadwal: Senin 06:00 WIB
POST /api/cron/barber-reminder-morning      jadwal: 07:00 WIB tiap hari
```

**Penting (Vercel function limit):**
Sekarang ada 12 fungsi Hobby plan terpakai. 3 cron baru ini **TIDAK boleh** ditambahkan sebagai Vercel cron — harus di-trigger dari **cron-job.org** seperti pola existing di `cronjoborg_homeservice.md`. Setiap endpoint cron memvalidasi `x-admin-token` header.

### Owner reward dashboard

```
GET  /api/admin/rewards                                     → kapster eligible reward bulan ini
```

---

## 9. Frontend Files Baru

```
src/app/barber/
├── login/page.tsx              [BARU] phone input + OTP input
├── setup/page.tsx              [BARU] avatar + target form
├── home/page.tsx               [BARU] dashboard pribadi
├── progress/page.tsx           [BARU] full performance + history
├── leaderboard/page.tsx        [BARU] tier system
├── profile/page.tsx            [BARU] settings + logout

src/app/barber/schedule/page.tsx  [MODIFY] tambah tab today/tomorrow/week

src/components/barber/
├── TargetProgressBar.tsx       [BARU]
├── StreakBadge.tsx             [BARU]
├── UpcomingBookingCard.tsx     [BARU]
├── BadgeGrid.tsx               [BARU]
├── MissionList.tsx             [BARU]
├── TierIndicator.tsx           [BARU]
├── ReviewQuoteCard.tsx         [BARU]
├── PaceCard.tsx                [BARU]
├── FavoriteCustomerList.tsx    [BARU]

src/hooks/
├── useBarberSession.ts         [BARU] cookie-based session
├── useBarberStats.ts           [BARU] data fetcher

src/lib/
├── barberApi.ts                [BARU] typed wrappers ke /api/barber/*
├── achievementDefs.ts          [BARU] badge label + threshold
```

### `useUser` hook

Diperluas untuk return role barber dari custom session, supaya `<BarberLayout>` (existing) tetap berfungsi tanpa perubahan besar.

---

## 10. Data Flow Saat Booking Status → `done`

```
Admin tandai booking done
       ↓
POST /api/booking-status (existing)
       ↓
Setelah update Supabase, panggil:
       ↓
onBookingCompleted(booking)
   ├─ Update streak progress (cek apakah hit target hari ini)
   ├─ Update personal records (best customer/hari)
   ├─ Update mission progress (volume + consistency)
   ├─ checkAchievements(barber_id)
   ├─ Push notif kalau ada milestone
   └─ Push notif kalau sisa ≤ 2 customer dari target
```

Semua ini **fire-and-forget** (Promise tanpa await) supaya tidak block response endpoint.

---

## 11. Out of Scope (v1)

- Tip jar / customer appreciation in-app (butuh integrasi payment)
- Cash flow harian (yang dikoordinasi POS, bukan PWA)
- Chat antar kapster
- Manajemen shift / cuti
- Foto progress kerja (before/after potong) — bisa future

---

## 12. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Nomor HP barber tidak terdaftar di tabel `barbers` | Endpoint clear error message; admin sync barbers dulu via `/admin/sync-barbers` |
| Format phone tidak konsisten (08xx vs 62xx) | Normalisasi via `normalizeWa()` yang sudah ada |
| OTP delay (Fonnte rate limit) | Reuse rate limit policy existing (max 3 OTP per 10 menit per phone) |
| Vercel function limit (12) terlampaui | Wajib pakai cron-job.org untuk semua cron baru |
| Storage quota Supabase Storage | 25 kapster × 400KB = 10MB, jauh di bawah free tier 1GB |
| Achievement check expensive saat booking done | Cek ringan: hanya hitung delta (count last X hours), bukan full re-count |

---

## 13. Dependencies Antar Tabel

```
barbers (existing)
  ↓ (FK barber_id)
barber_users
  ↓ (FK barber_id, ON DELETE CASCADE)
├── barber_sessions
├── barber_achievements
├── barber_streaks
├── barber_records
└── barber_missions
```

Urutan create table di migration: `barber_users` dulu, baru sisanya.

---

## 14. Migration File

Akan dibuat: `server/migrations/005_barber_users.sql`

Berisi semua DDL Bagian 6 + GRANT statement (sesuai policy project).
