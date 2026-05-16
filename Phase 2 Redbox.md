# Phase 2 Redbox — Struktur Pengembangan Fitur AI & Automation

> Dokumentasi fitur yang telah dibangun pada Phase 2 RedBox Barbershop.
> Terakhir diperbarui: 16 Mei 2026

---

## 🤖 1. WA Bot AI — `api/wa/webhook.js`

**Engine:** OpenAI GPT-4o-mini + Fonnte WhatsApp API

| Komponen | Detail |
|---|---|
| **Karakter AI** | "Reddy" — asisten virtual RedBox, bahasa casual-profesional Indonesia |
| **Konversasi** | Multi-turn memory (12 pesan terakhir), disimpan di Supabase (`wa_conversations`) |
| **Cross-instance** | Memory persist lintas Vercel serverless instance via DB |
| **Dedup** | Cegah pesan diproses 2x saat Fonnte retry (TTL 5 menit) |
| **Fallback** | Keyword-based reply otomatis kalau OpenAI timeout/error |
| **Knowledge base** | Daftar harga semua layanan, outlet, jam, FAQ, cara jawab pertanyaan kapster |
| **Timeout** | 8 detik untuk OpenAI call, hindari Lambda hang |
| **Endpoint** | `POST /api/wa/webhook` — Fonnte callback |

---

## 🧠 2. AI Face & Hair Analysis — `api/ai/analyze.js`

**Engine:** OpenAI GPT-4o Vision

| Komponen | Detail |
|---|---|
| **Input** | Upload ID foto dari Supabase Storage |
| **Output JSON** | Analisis wajah (bentuk, kulit, rambut), rekomendasi gaya potong, kacamata, skincare |
| **Data** | Skor per rekomendasi (0–100), confidence level, alasan match |
| **Penyimpanan** | Hasil analisis disimpan ke Supabase untuk ditampilkan di dashboard |

---

## 💇 3. AI Hairstyle Simulation — `api/ai/hairstyle.js`

**Engine:** OpenAI GPT-Image-2 (images.edit)

| Komponen | Detail |
|---|---|
| **Input** | Upload ID foto + nama gaya rambut yang dipilih |
| **Output** | Gambar simulasi tampilan rambut baru di foto customer |
| **Caching** | Hasil disimpan di Supabase Storage — tidak generate ulang kalau sudah ada |
| **Timeout** | 300 detik (Vercel long-running function) |

---

## 🎨 4. AI Image Generator — `api/ai/generate-image.js`

**Engine:** OpenAI GPT-Image-2 (text-to-image)

| Komponen | Detail |
|---|---|
| **Input** | Text prompt + cacheKey opsional |
| **Output** | Gambar dari prompt (promo, konten, dll) |
| **Caching** | Simpan ke Supabase Storage via `cacheKey` — tidak generate ulang |

---

## 📁 5. Upload Handler — `api/ai/upload.js`

| Komponen | Detail |
|---|---|
| **Fungsi** | Upload foto customer ke Supabase Storage untuk diproses AI |
| **Output** | Upload ID yang dipakai oleh `analyze.js` dan `hairstyle.js` |

---

## 📅 6. WA Reminder H-1 — `api/cron/reminders.js`

**Jadwal:** `0 3 * * *` UTC = jam 10:00 WIB setiap hari

| Komponen | Detail |
|---|---|
| **Trigger** | Vercel Cron otomatis |
| **Fungsi** | Cari semua booking besok, kirim reminder ke nomor WA customer |
| **Pesan** | 3 variasi pesan random (natural, tidak repetitif) |
| **Isi pesan** | Nama, hari, tanggal, jam, layanan + link reschedule |

---

## 🎂 7. WA Ucapan Ulang Tahun — `api/cron/birthday.js`

**Jadwal:** `0 1 * * *` UTC = jam 08:00 WIB setiap hari

| Komponen | Detail |
|---|---|
| **Trigger** | Vercel Cron otomatis |
| **Fungsi** | Cek kolom `birthday` di tabel customers (format MM-DD), kirim ucapan |
| **Promo** | Tawaran FREE HAIRCUT gratis hari ulang tahun (tunjuk pesan ke kasir) |
| **Pesan** | 3 variasi random, personal pakai nama customer |

---

## ⚡ 8. WA Reminder 1 Jam — `api/cron/remind-soon.js`

**Jadwal:** Setiap jam (auto Vercel Cron)

| Komponen | Detail |
|---|---|
| **Fungsi** | Cek booking yang mulai 1 jam lagi (jam berikutnya WIB) |
| **Pesan** | 4 variasi "1 jam lagi!" reminder |
| **Logic** | Skip kalau next hour >= 24:00 (hindari false match tengah malam) |

---

## 🔄 9. Moka POS Customer Sync — `api/moka/sync-customers.js`

**Jadwal:** `0 20 * * *` UTC = jam 03:00 WIB (cron harian) + bisa trigger manual

| Komponen | Detail |
|---|---|
| **Fungsi** | Pull semua customer dari Moka POS → upsert ke Supabase `customers` |
| **Sumber data** | Moka v3 Transaction API (extract customer dari setiap payment record) |
| **Output** | Nama, phone (format E.164), email, moka_customer_id |
| **Batch** | 50 customer per batch upsert |
| **Dry run** | `?dry_run=1` — hitung saja tanpa simpan |
| **Link** | Cocokkan customer Moka dengan customer web berdasarkan `phone_e164` |
| **Auth** | Terima `CRON_SECRET` atau `ADMIN_PASSWORD` |

---

## 📊 Ringkasan Tech Stack AI & Automation

| Layer | Teknologi |
|---|---|
| AI Vision/Chat | OpenAI GPT-4o + GPT-4o-mini |
| AI Image | OpenAI GPT-Image-2 |
| WA Gateway | Fonnte API |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage (foto, hasil AI) |
| Cron/Scheduler | Vercel Cron Jobs |
| Hosting | Vercel Serverless Functions |
| POS Integration | Moka POS OAuth 2.0 |

---

## 📋 Changelog Harga (16 Mei 2026)

| Service | Harga Lama | Harga Baru | File yang Diupdate |
|---|---|---|---|
| Hair Color (Standard) | Rp 135.000 | Rp 160.000 | `js/services-data.js`, `api/wa/webhook.js` |
| Hair Color (CSB) | Rp 160.000 | Rp 160.000 | Tidak berubah |
