# Booking Calendar Tab — Design Spec

**Date:** 2026-06-05  
**Status:** Approved  
**Feature:** Kalender booking bulanan sebagai tab di halaman `/admin/bookings`, + hapus Broadcast dan Schedule

---

## Overview

Tambah tab "Tabel | Kalender" di halaman Booking admin. Tab Kalender menampilkan grid bulan dengan navigasi, filter kapster, dan day-detail panel yang load booking per-klik. Halaman broadcast dan schedule dihapus beserta entri nav-nya.

---

## Perubahan File

| Action | Path | Keterangan |
|--------|------|-----------|
| **Hapus** | `frontend/src/app/admin/broadcast/page.tsx` | Fitur broadcast dihilangkan |
| **Hapus** | `frontend/src/app/admin/schedule/page.tsx` | Digantikan oleh Calendar tab |
| **Modifikasi** | `frontend/src/components/AdminNav.tsx` | Hapus item Broadcast dari NAV_ITEMS |
| **Modifikasi** | `frontend/src/app/admin/bookings/page.tsx` | Tambah tab state + switcher + render CalendarView |
| **Buat** | `frontend/src/app/admin/bookings/CalendarView.tsx` | Komponen kalender bulanan |

---

## UI Design

### Tab Switcher

Di bawah header "Booking Control", sebelum filter:

```
[📋 Tabel]  [📅 Kalender]
```

- Aktif: background merah tipis `#C72820/15`, teks `#E87068`, border `#C72820/30`
- Nonaktif: background transparan, teks abu `#4A3E40`
- Saat tab berubah, scroll ke atas halaman

### Tampilan Tab Tabel

Tidak berubah dari implementasi sekarang (date input, filter status/tipe, list kartu booking, walk-in sheet, reassign sheet).

### Tampilan Tab Kalender

**Sub-header:**
```
‹  Juni 2026  ›        [dropdown: Semua Kapster ▾]
```

**Grid bulan:**
- Header baris: Min Sen Sel Rab Kam Jum Sab
- Sel hari: kompak, cocok di mobile (min-width cukup untuk 7 kolom)
- Hari luar bulan: angka abu sangat gelap, tidak bisa diklik
- Hari dalam bulan biasa: angka abu `#4A3E40`, bisa diklik
- Hari dengan booking: angka putih terang `#F0EAEB` + dot merah kecil `#C72820` di bawah angka
- Hari ini: lingkaran background merah `#C72820`, teks putih
- Hari dipilih (bukan hari ini): border `1px solid #F0EAEB`

> **Dot per hari**: untuk menampilkan dot, gunakan data dari day-detail yang sudah pernah di-load (cache sederhana di state `Map<string, booking[]>`). Hari yang belum pernah diklik tidak menampilkan dot (tidak ada prefetch bulan).

**Day Detail Panel** (di bawah grid, muncul saat hari diklik):

```
Sabtu, 7 Juni 2026
─────────────────────────────
[skeleton loading]
```

Setelah load:
```
08:00  Andi Santoso   Potong Rambut   [Confirmed]
09:30  Budi Pratama   Cuci + Potong   [Pending]
...
```

- Style kartu identik dengan tab Tabel (nama · jam · service · StatusBadge)
- Filter kapster pada sub-header memfilter kartu di panel ini secara client-side
- Empty state: "Tidak ada booking di hari ini"
- Panel tidak tampil jika belum ada hari yang diklik

---

## Data Flow

### Fetch Booking

Endpoint yang digunakan (sama dengan tabel view):
```
GET /api/bookings?location={branch}&date={YYYY-MM-DD}
```

**Saat tab Kalender dibuka pertama kali:**
1. Auto-pilih hari ini
2. Fetch booking hari ini
3. Simpan hasil ke cache `Map<string, booking[]>` dengan key = tanggal

**Saat klik hari:**
1. Cek cache — jika ada, pakai langsung (tidak fetch ulang)
2. Jika tidak ada di cache, fetch dan simpan ke cache
3. Tampilkan day detail panel

**Saat ganti bulan:**
1. Reset selected day ke `null`
2. Sembunyikan day detail panel
3. Cache tetap ada (tidak di-reset)

**Filter kapster:**
- Dilakukan client-side dari data cache
- Tidak trigger fetch ulang

### Barbers

Barbers sudah di-fetch di parent `bookings/page.tsx` (`/api/admin/barbers?branch={branch}`). Data ini di-pass sebagai prop ke `<CalendarView>`.

---

## Props Interface: CalendarView

```typescript
interface CalendarViewProps {
  branch: string;
  barbers: { id: string; name: string }[];
  readonly?: boolean;
}
```

CalendarView manages its own state internally: `currentMonth`, `selectedDate`, `dayCache`, `barberFilter`, `loadingDate`.

---

## Out of Scope

- Prefetch booking seluruh bulan (tidak ada backend change)
- Export CSV dari calendar view
- Add/Edit booking dari calendar (gunakan tab Tabel untuk walk-in)
- Dot indikator untuk hari yang belum pernah diklik
