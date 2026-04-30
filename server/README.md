# Redbox CRM — Backend Setup Guide

## Stack
- **Node.js** + Express (API server)
- **MySQL** (XAMPP / Local) — *Recommended for local use*
- **Supabase** (PostgreSQL cloud database, alternative)
- **Airtable** (Cloud sync integration)

---

## Step 1: Setup Database (MySQL XAMPP)

1. Jalankan **XAMPP Control Panel**, start **Apache** dan **MySQL**.
2. Buka **phpMyAdmin** (http://localhost/phpmyadmin).
3. Klik tab **SQL**.
4. Copy seluruh isi file `server/mysql_schema.sql` dan klik **Go**.
5. Database `redbox_db` akan otomatis terbuat.

*Atau jika ingin tetap pakai Supabase, ikuti langkah di bawah:*
[... existing Supabase steps ...]

---

## Step 2: Setup Airtable

1. Buat Base di Airtable.
2. Buat tabel bernama **Bookings** dengan kolom berikut (Case Sensitive):
   - `Booking ID` (Single line text)
   - `Name` (Single line text)
   - `WhatsApp` (Single line text)
   - `Service` (Single line text)
   - `Price` (Number)
   - `Barber` (Single line text)
   - `Date` (Date)
   - `Time` (Single line text)
   - `Status` (Single line text)
   - `Notes` (Long text)
3. Buat tabel kedua bernama **Barbers** untuk data kapster dengan kolom berikut:
   - `Barber ID` atau `id` (Single line text)
   - `Name` atau `Nama Kapster` (Single line text)
   - `Role` atau `Keahlian` (Single line text)
   - `Branch` atau `Cabang` (Single line text)
   - `Work Days` atau `Hari Kerja` (Long text / multiple select)
   - `Image` atau `Foto` (Attachment atau URL)
   - `Is Active` atau `Status` (Checkbox / text)
4. Ambil **API Key / Personal Access Token**, **Base ID**, dan nama kedua tabel di `.env`.

---

## Step 3: Setup .env

Edit file `.env`:
```
# Database Type (mysql atau supabase)
DATABASE_TYPE=mysql

# MySQL (XAMPP)
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=redbox_db

# Airtable bookings
AIRTABLE_API_KEY=your_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=Bookings

# Airtable kapster
AIRTABLE_BARBERS_TABLE_NAME=Barbers

PORT=3001
ADMIN_PASSWORD=redbox_admin_2024
```

---

## Step 4: Install & Jalankan Server

Buka terminal di folder `server/`:

```bash
# Install dependencies
npm install

# Jalankan server
npm start
```

Server berjalan di: **http://localhost:3001**

Test: buka http://localhost:3001/api/health

---

## Step 6: Set Admin Token di CRM

1. Buka browser, buka DevTools → Console
2. Ketik:
   ```js
   localStorage.setItem('rb_admin_token', 'redbox_admin_2024')
   ```
3. Refresh halaman `crm.html`
4. Badge di topbar berubah jadi **🟢 PostgreSQL (Supabase)**

---

## API Endpoints

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | `/api/health` | Health check |
| GET | `/api/bookings` | List semua booking |
| POST | `/api/bookings` | Buat booking baru |
| PATCH | `/api/bookings/:id` | Update booking |
| DELETE | `/api/bookings/:id` | Hapus booking (admin) |
| GET | `/api/customers` | List semua customer |
| GET | `/api/customers/:id` | Detail + riwayat |
| GET | `/api/barbers` | List barber |
| GET | `/api/barbers/:id/availability?date=` | Slot tersedia |
| GET | `/api/stats` | Statistik overview |

---

## Notes

- Endpoint `/api/barbers` sekarang memprioritaskan Airtable untuk data kapster. Jika Airtable belum diset, server akan fallback ke database lokal.
- `POST /api/admin/sync-barbers` akan sync data kapster dari Airtable ke database lokal. Google Sheets tetap tersedia hanya sebagai fallback legacy.
- CRM dashboard otomatis detect mode: jika server aktif → pakai PostgreSQL/MySQL, jika tidak → fallback ke localStorage
- Booking dari website (`booking.html`) tersimpan ke localStorage, lalu bisa di-sync manual atau via API jika server berjalan
- Anti double-booking enforced di level database (UNIQUE INDEX) dan API
