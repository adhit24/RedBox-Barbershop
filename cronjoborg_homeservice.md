# Panduan Setup Cron-Job.org untuk Home Service RedBox

## Ringkasan Tugas
Memindahkan tugas-tugas home service (reminder kapster, flag no-show, flag customer tidak konfirmasi) dari Vercel Cron ke Cron-Job.org untuk frekuensi yang lebih tinggi.

## File yang Diubah
1. `api/cron/home-service-flag.js`: Digabungkan dengan logic home service reminder
2. File lama `api/home-service-reminder.js` dan `api/home-service-tasks.js` dihapus untuk stay di bawah Vercel Hobby Plan limit

## Langkah-Langkah Setup

### 1. Deploy Kode ke Vercel
Kode sudah di-commit dan di-push ke git, dengan pesan commit: "Merge home service reminder into home-service-flag"

Promote deployment yang benar ke Production:
- Di Vercel Dashboard → Deployments
- Cari deployment dengan pesan "Merge home service reminder into home-service-flag"
- Klik ⋯ → Promote to Production

### 2. Setup Cron-Job.org
Buat cron baru dengan detail:
- **Judul**: RedBox Home Service Tasks
- **URL**: `https://redbox-barbershop-13wpj8yuq-adh24s-projects.vercel.app/api/cron/home-service-flag` (ganti dengan URL Production kamu yang aktif)
- **Metode**: GET
- **Headers**:
 - Key: `Authorization`
 - Value: `Bearer <YOUR_CRON_SECRET>` (contoh: `Bearer h0zlXyGbA9bTy44CDYCk6SOdEPuymPGqS0E2ewfsId0=`)
- **Jadwal**: Setiap 5 menit
- **Opsi Lanjutan**: Centang "Perlakukan pengalihan dengan kode status HTTP 3xx sebagai keberhasilan"

### 3. Test Cron
- Klik ACTION → Run Now
- Lihat tab Riwayat, pastikan statusnya Berhasil (hijau)

## Detail Teknis
- Endpoint `/api/cron/home-service-flag` menjalankan 3 tugas sekaligus:
 1. `sendHomeServiceReminders()`: Mengirim reminder ke kapster 1 jam sebelum home service
 2. `flagNoShows()`: Menandai job sebagai flagged jika kapster tidak berangkat dalam 30 menit
 3. `flagCustomerNoConfirm()`: Menandai job sebagai flagged jika customer tidak konfirmasi dalam 45 menit
- Semua fungsi menggunakan Supabase Service Role Key dan Fonnte untuk mengirim WhatsApp

---
## Riwayat Percakapan Lengkap
...
