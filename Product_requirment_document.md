# Product Requirement Document (PRD)
## Website — Redbox Barbershop

---

## 1. Objective

Membangun website yang:
- Meningkatkan trust
- Mencerminkan brand premium
- Mengarahkan user ke booking / visit
- Mengelola reservasi secara terstruktur melalui sistem CRM
- Terintegrasi dengan sistem POS yang sudah digunakan

---

## 2. Target User

- Pria 17–35 tahun
- Datang dari Instagram
- Mencari:
  - referensi
  - harga
  - lokasi
  - kemudahan booking

---

## 3. Key Goals

- Increase conversion (visit / booking)
- Reduce waiting time di lokasi
- Meningkatkan efisiensi operasional barber
- Membangun database customer (CRM)
- Sinkronisasi data antara booking dan transaksi (POS)

---

## 4. Core Pages

### 1. Homepage
- Hero visual
- Tagline
- CTA: Book Now

### 2. Services Page
- List layanan
- Harga

### 3. Gallery / Lookbook
- Hasil haircut
- Before/after

### 4. About
- Story & value

### 5. Contact / Location
- Maps
- Jam operasional
- CTA WhatsApp

### 6. Booking Page
- Pilih barber
- Pilih tanggal
- Pilih jam
- Form customer

---

## 5. CRM & Reservation System (CORE FEATURE)

### Overview

Sistem CRM terintegrasi untuk:
- Mengelola booking
- Mengatur jadwal barber
- Menyimpan data customer
- Menghindari overbooking

---

### Booking Rules

- 1 Barber = 1 Customer
- 1 Slot = 1 Jam
- Tidak boleh double booking

---

### Booking Flow (User)

1. Pilih barber
2. Pilih tanggal
3. Pilih jam
4. Isi data (nama & WhatsApp)
5. Konfirmasi booking
6. Notifikasi dikirim

---

### CRM Dashboard (Admin)

**Calendar View**
- Jadwal barber per jam

**Barber Management**
- Atur jadwal kerja

**Booking Management**
- Edit / reschedule / cancel

**Customer Database**
- Data customer
- Riwayat kunjungan

---

### Slot System

| Jam        | Status      |
|------------|------------|
| 10:00–11:00 | Available  |
| 11:00–12:00 | Booked     |

---

### Benefits

Customer:
- Tidak perlu antri
- Waktu lebih pasti

Owner:
- Operasional rapi
- Data terkumpul

---

## 6. POS Integration (NEW — CRITICAL SYSTEM)

### Overview

Sistem CRM & booking terintegrasi dengan POS yang sudah digunakan oleh Redbox, sehingga data customer dan transaksi saling terhubung.

---

### Integration Goals

- Menghindari input data ganda
- Menyatukan data booking dan transaksi
- Membentuk customer database yang lengkap

---

### Data Sync

Data yang terhubung:

**Dari Booking System → POS**
- Nama customer
- Nomor WhatsApp
- Jadwal booking
- Barber yang dipilih

**Dari POS → CRM**
- Riwayat transaksi
- Layanan yang diambil
- Frekuensi kunjungan
- Total spending (optional)

---

### Use Case Flow

1. Customer booking via website  
2. Data masuk ke CRM  
3. Saat customer datang → data muncul di POS  
4. Setelah transaksi → data tersimpan sebagai history  
5. CRM update customer profile  

---

### Benefits

**Untuk Owner:**
- Bisa lihat customer paling loyal
- Bisa tahu layanan paling laku
- Bisa bikin promo berbasis data

**Untuk Operasional:**
- Tidak perlu input ulang data
- Minim kesalahan manual

---

### Technical Note (High-Level)

- Integrasi via API (jika POS support)
- Alternatif:
  - Export/import data
  - Middleware (bridge system)

---

## 7. Key Features

- Mobile-first design
- Fast loading
- WhatsApp integration
- Booking system (CRM)
- POS integration

---

## 8. UX Principles

- Booking < 1 menit
- Simple & jelas
- Visual driven
- CTA kuat

---

## 9. Design Direction

- Dark theme
- High contrast
- Masculine layout
- Premium feel

---

## 10. Conversion Strategy

- CTA “Book Now” di semua halaman
- Highlight kemudahan reservasi
- Tampilkan slot availability

---

## 11. Success Metrics

- Jumlah booking per hari
- Pengurangan waiting time
- Repeat customer rate
- Data customer terkumpul
- Sinkronisasi data dengan POS

---

## 12. Future Enhancement

- Membership system
- Loyalty program
- WhatsApp reminder otomatis
- Promo berbasis data customer

---