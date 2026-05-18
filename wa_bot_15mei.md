# WA Bot RedBox Barbershop — Sesi 15 Mei 2026

## Ringkasan Pekerjaan

Menghubungkan WhatsApp AI Bot RedBox Barbershop menggunakan **Fonnte** sebagai gateway WA dan **OpenAI GPT-4o-mini** sebagai AI engine, di-deploy via **Vercel Serverless**.

---

## 1. Setup Awal Fonnte

**Masalah:** Token Fonnte lama perlu diganti.

**Solusi:**
- Update `FONNTE_TOKEN=wA3B7ETLk3Y4PoxetvnC` di `server/.env`
- Set env var di Vercel Dashboard → Environment Variables
- Endpoint aktif: `https://www.redboxbarbershop.com/api/wa/webhook`

**File terkait:**
- `api/wa/webhook.js` — webhook handler utama (Fonnte)
- `server/services/fonnte.js` — service kirim pesan via Fonnte API

---

## 2. Transfer Knowledge ke AI

Sistem prompt AI (bot bernama "Reddy") dilengkapi dengan data bisnis lengkap:

### Outlet & Kontak WA
| Outlet | Lokasi | Jam | WA |
|---|---|---|---|
| Bypass (pusat) | Jl. Bypass Kedawung, Cirebon | 10.00–22.00 | 0818-202-569 |
| Samadikun | Jl. Samadikun, Cirebon | 10.00–21.00 | 0818-202-589 |
| CSB Mall | Inside CSB Mall Lt.1, Cirebon | 10.00–21.00 | 0818-202-889 |
| Sumber | Jl. Raya Sumber, Cirebon | 10.00–21.00 | 0818-202-599 |
| Tegal | Jl. Raya Tegal | 10.00–21.00 | 0818-268-883 |

### Layanan Lengkap (26 layanan)

**Hair:**
- Gentleman Grooming — Rp 95.000 / Rp 120.000 CSB (45 menit)
- Hair Tattoo Single Side — Rp 45.000 / Rp 55.000 CSB (15 menit)
- Hair Tattoo Double Side — Rp 75.000 / Rp 85.000 CSB (30 menit)
- Hair Color — Rp 135.000 / Rp 160.000 CSB (45 menit)
- Hair Bleaching — Rp 360.000 / Rp 370.000 CSB (3 jam)
- Hair Highlighting — Rp 310.000 / Rp 320.000 CSB (3 jam)
- Hair Curly — Rp 310.000 / Rp 320.000 CSB (90 menit)
- Hair Smoothing — Rp 360.000 / Rp 370.000 CSB (90 menit)
- Hair Spa — Rp 110.000 / Rp 120.000 CSB (30 menit)
- Down Perm / Root Lift — Rp 175.000 / Rp 185.000 CSB (60 menit)

**Shave:**
- Shaving — Rp 40.000 / Rp 50.000 CSB (20 menit)
- Traditional Shaving — Rp 70.000 / Rp 80.000 CSB (30 menit)
- Premium Head Shave — Rp 130.000 / Rp 140.000 CSB (45 menit)

**Other Services:**
- Men Massage Service — Rp 145.000 / Rp 155.000 CSB (45 menit)
- Nose Wax — Rp 70.000 / Rp 80.000 CSB (25 menit)
- Ear Wax — Rp 70.000 / Rp 80.000 CSB (25 menit)
- Ear Singeing — Rp 75.000 / Rp 85.000 CSB (20 menit)
- Charcoal Deep Cleansing — Rp 105.000 / Rp 115.000 CSB (45 menit)
- Ear Candle — Rp 40.000 / Rp 50.000 CSB (25 menit)
- Charcoal Nose Cleansing Strip — Rp 65.000 / Rp 75.000 CSB (30 menit)

**Grooming Packages:**
- Royal Grooming — Rp 305.000 / Rp 315.000 CSB (90 menit) — Haircut + Face&Back Massage + Charcoal Cleansing + Traditional Shaving + Waxing Nose&Ear
- Duxe Grooming — Rp 250.000 / Rp 260.000 CSB (90 menit) — Haircut + Charcoal Deep Cleansing + Face Scrub + Hair Spa
- Earl Grooming — Rp 185.000 / Rp 195.000 CSB (90 menit) — Haircut + Face&Back Massage + Hair Spa
- Baron Grooming — Rp 150.000 / Rp 190.000 CSB (90 menit) — Gentleman Grooming
- Noble Grooming — Rp 140.000 / Rp 150.000 CSB (90 menit) — Haircut + Face&Back Massage + Ear Singeing

---

## 3. Konfigurasi Gaya Bahasa AI

- **Tone:** Casual tapi profesional (bukan kaku, bukan terlalu santai)
- **Sapaan pembuka standar:**
  ```
  Welcome to Redbox Barbershop ✂️
  Silakan informasikan kebutuhan Kakak ya — reservation, konsultasi hairstyle, atau info layanan lainnya 👌
  ```
- **Larangan:** Tidak boleh pakai format markdown `[teks](url)` — kirim URL plain text
- **Larangan:** Tidak tanya "mau ngapain?"
- **Kapster:** Arahkan ke halaman booking, jangan karang nama kapster

---

## 4. Pemahaman Bahasa Natural Customer

AI diajarkan memetakan kata sehari-hari ke layanan:

| Kata Customer | Layanan |
|---|---|
| cukur rambut / potong / pangkas | Hair Cut |
| fade / undercut / degradasi | Hair and Fade Cut |
| cat rambut / semir / coloring | Hair Color |
| bleaching / putihin rambut | Hair Bleaching |
| keriting / curl / perm | Hair Curly |
| rebonding / smoothing / lurusin | Hair Smoothing |
| creambath / spa rambut / treatment | Hair Spa (creambath tidak ada, alternatif Hair Spa) |
| cukur kumis / jenggot / brewok | Shaving |
| botak / gundul / head shave | Premium Head Shave |
| bersihin muka / facial / masker | Charcoal Deep Cleansing |
| pijat / massage / relaksasi | Men Massage Service |
| paket lengkap / paling komplit | Royal Grooming |
| paket hemat / murah | Noble Grooming |

---

## 5. Bug Fixes & Reliability

### Bug 1: Bot balas ke dirinya sendiri
**Sebab:** Fonnte kirim webhook untuk pesan KELUAR (outgoing) dari bot.
**Fix:** Filter `isFromMe`, `fromMe`, `is_from_me`, dan `sender === device`.

### Bug 2: Fonnte timeout, pesan tidak diproses
**Sebab:** Bot menunggu OpenAI selesai dulu baru kirim 200 ke Fonnte.
**Fix:** `res.status(200).json()` dikirim DULU, baru `await handleMessage(...)`.

### Bug 3: Vercel freeze sebelum proses selesai
**Sebab:** Setelah `res.json()`, promise chain tidak di-await sehingga Lambda bisa freeze.
**Fix:** Tetap gunakan `await handleMessage(...)` setelah `res.json()` agar Lambda tetap hidup.

### Bug 4: Dedup / double processing
**Fix:** Tambah `processedIds` Set berdasarkan message ID dari Fonnte (TTL 5 menit).

### Bug 5: OpenAI timeout tidak berfungsi (55 detik!)
**Sebab:** `AbortController` tidak reliable di Vercel Lambda — OpenAI bisa tetap jalan.
**Fix:** Ganti ke `Promise.race([openaiCall, timeoutAfter7s])`.
**Tambahan:** `max_tokens` dikurangi 400 → 250 untuk respons lebih cepat.
**Tambahan:** `maxDuration` webhook dinaikkan 30 → 60 detik.

### Bug 6: URL markdown di WhatsApp
**Sebab:** AI mengirim `[teks](url)` yang tidak dirender WhatsApp.
**Fix:** Instruksi di system prompt: kirim URL plain text saja.

---

## 6. Konfigurasi Fonnte Dashboard

**URL:** `md.fonnte.com` → Device `0818202569`

Setting yang benar:
| Setting | Nilai |
|---|---|
| Webhook URL | `https://www.redboxbarbershop.com/api/wa/webhook` |
| autoread | **ON** |
| Response Source | **Autoreply** (bukan Flow, bukan Aksita AI) |
| Personal | **ON** |
| Group | Off |

**Penting:** Jangan setup Flow di Fonnte — akan override webhook kita.

---

## 7. Debug Endpoint

Untuk diagnosa webhook Fonnte:
```
GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026
```
Returns 10 request terakhir yang diterima server.

---

## 8. Arsitektur Final

```
Customer WA
    ↓ (kirim pesan)
Fonnte Gateway (0818202569)
    ↓ (POST webhook)
Vercel Serverless: /api/wa/webhook
    ↓ (filter outgoing, dedup, media type)
OpenAI GPT-4o-mini (timeout 7s via Promise.race)
    ↓ (atau fallback keyword-based reply)
Fonnte API: api.fonnte.com/send
    ↓ (kirim balasan)
Customer WA ← bot menjawab
```

---

## 9. File Utama

| File | Fungsi |
|---|---|
| `api/wa/webhook.js` | Handler utama — terima webhook Fonnte, proses AI, kirim reply |
| `server/services/fonnte.js` | Service kirim pesan via Fonnte API |
| `vercel.json` | Config Vercel — maxDuration, includeFiles, routes |
| `server/.env` | Env vars lokal (FONNTE_TOKEN, OPENAI_API_KEY, dll) |

---

## 10. Environment Variables (Vercel Production)

| Var | Keterangan |
|---|---|
| `FONNTE_TOKEN` | Token device Fonnte — `wA3B7ETLk3Y4PoxetvnC` |
| `OPENAI_API_KEY` | OpenAI API key |
| `SUPABASE_URL` | Supabase database URL |
| `SUPABASE_SERVICE_KEY` | Supabase service key |

---

*Dokumentasi dibuat: 15 Mei 2026*

---

## 11. Sesi Lanjutan — Bot Tidak Merespon (15 Mei 2026)

### Gejala
- Customer kirim chat, tapi bot tidak selalu membalas.
- Debug endpoint sempat mengembalikan `{"received":[]}`.

### Temuan Utama
- Debug log sebelumnya bersifat **in-memory per serverless instance**. Jadi request POST bisa masuk ke instance A, sedangkan saat cek GET debug kebetulan masuk instance B → terlihat kosong.
- Pengiriman balasan ke Fonnte kadang terlihat sukses (`status:true`, `message in queue`), namun bot tetap perlu reliabilitas dan observabilitas lebih baik.
- Fonnte **API check message status** sudah deprecated → tracking status harus via **Webhook Update Message Status (webhookstatus)**.
- Webhook status dari Fonnte dapat datang dengan format yang berbeda (mis. `multipart/form-data`, atau field `data/payload` berupa JSON string).

### Perbaikan yang Diimplementasikan

#### A. Diagnostik serverless (biar debug tidak menipu)
- Debug endpoint menampilkan `instance_id` dan `boot_ts`.
- Tambah `ping` untuk memastikan debug log bertambah pada instance yang sedang dilihat.

Endpoint:
- Ping: `GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&ping=1`
- List log (per-instance): `GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026`

#### B. Timeout kirim pesan ke Fonnte (anti-hang)
- Request ke `https://api.fonnte.com/send` diberi timeout agar tidak menggantung dan menghambat alur.

File terkait:
- `server/services/fonnte.js`

#### C. Tracking status pengiriman via Supabase (anti-null, lintas instance)
Karena webhookstatus dari Fonnte tidak selalu dapat diandalkan (atau tidak selalu terdeteksi), sistem dibuat robust dengan 2 lapis:
- Lapis 1: Simpan status **awal** langsung saat `sendWA()` berhasil mengembalikan `id` dari Fonnte (mis. `process: pending/queued`).
- Lapis 2: Jika webhookstatus benar-benar masuk, update status menggunakan `upsert` berdasarkan `message_id`.

SQL (dibuat di Supabase SQL Editor):
```sql
create table if not exists wa_message_status (
  message_id text primary key,
  message_status text,
  target text,
  payload jsonb,
  updated_at timestamptz default now()
);
```

Endpoint untuk verifikasi DB:
- Test insert+fetch: `GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&db_test=1`
- Dump data terbaru: `GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&db_dump=1`
- Cek status per message_id: `GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&msg_status_id=<ID>`

File terkait:
- `api/wa/webhook.js`

#### D. Parser payload webhook yang lebih tahan format
- Mendukung `multipart/form-data` (boundary parsing).
- Mendukung `rawBody.data`/`rawBody.payload` yang berupa JSON string (di-parse menjadi object).
- Menerima format webhookstatus versi Fonnte: `id`, `status`, `stateid`, `state` (tanpa butuh `target`).

### Cara Test Manual (Recommended)

#### 1) Test kirim pesan dari server ke nomor target
```
GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&send_to=628xxxxxxxxxx&send_msg=Tes%20bot%20Redbox
```
Catatan: `send_to` harus nomor lengkap format `62...` (bukan placeholder pendek seperti `628`).

#### 2) Ambil `id` dari response, lalu cek status tersimpan
```
GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&msg_status_id=<ID>
```

#### 3) Cek apakah webhookstatus sudah update record
```
GET https://www.redboxbarbershop.com/api/wa/webhook?debug=redbox2026&db_dump=1
```

### Catatan Operasional
- Jika bot membalas tapi OpenAI sering timeout, bot akan fallback ke respon keyword-based. Ini normal sebagai mekanisme reliability.
- Jika ingin respon OpenAI lebih stabil, kurangi kompleksitas prompt atau optimasi timeout/latency OpenAI (tanpa mengorbankan reliabilitas webhook).

---

## 12. Fix Final — Bot AI Berhasil (15 Mei 2026, sesi lanjutan)

### Root Cause Ditemukan
Setelah investigasi mendalam via debug log, ditemukan bahwa:
- `processing_done` selalu menunjukkan `"used":"fallback"` dan `"error":"OpenAI timeout 18s"`
- `fonnte_result` selalu `{"status":false,"error":"This operation was aborted"}`
- **Root cause:** Setelah `res.status(200).json()` dikirim ke Fonnte, Vercel Lambda masuk ke state "post-response" di mana outgoing HTTPS connections (ke OpenAI maupun ke Fonnte API) di-throttle — akibatnya OpenAI timeout 18s dan sendWA timeout 8s secara konsisten.
- Bukti: endpoint `?test_msg=` (GET, synchronous) berhasil dalam 2.7s, sedangkan webhook POST (post-response) selalu gagal di 18s+.

### Fix yang Diterapkan (`api/wa/webhook.js`)

1. **Arsitektur sinkron** — proses getHistory + OpenAI + sendWA **sebelum** `res.json(200)`:
   - Lambda masih dalam state fresh/synchronous → network tidak di-throttle
   - `res.json(200)` dikirim ke Fonnte **setelah** semua proses selesai
   - Warm Lambda: ~4.5s total (di bawah timeout Fonnte ~5s)
   - Cold Lambda: ~6s (Fonnte mungkin timeout duluan, tapi customer tetap menerima balasan)

2. **Timeout Supabase `getHistory`**: 4s → 2s (fail faster pada cold start)

3. **Timeout OpenAI**: 18s → 8s (Lambda sinkron = koneksi lebih cepat, 8s cukup)

4. **Hapus outer AbortController** dari `handleMessage` — redundan, berpotensi interfere

5. **`saveHistoryToSupabase` fire-and-forget** — tidak block sync path, Lambda tetap hidup sebentar setelah `res.json` untuk menyelesaikan save

6. **`persistMessageStatus` fire-and-forget** — sama, tidak block

### Hasil Test
```
Pesan 1 (cold Lambda): 5.9s → OpenAI ✓, sendWA ✓, history saved ✓
Pesan 2 (warm Lambda): 4.5s → OpenAI ✓, conversation history diingat ✓
```

Contoh conversation history tersimpan di Supabase:
```json
[
  {"role":"user","content":"halo mau tanya harga potong"},
  {"role":"assistant","content":"Welcome to Redbox Barbershop ✂️\nSilakan informasikan kebutuhan Kakak ya..."},
  {"role":"user","content":"berapa harga hair cut"},
  {"role":"assistant","content":"Harga untuk Hair Cut adalah Rp 85.000 di semua cabang, kecuali CSB Mall Rp 120.000.\nMau langsung booking? redboxbarbershop.com/booking.html"}
]
```

### Deploy Final
- Deploy ID: `dpl_AScy8qrigxxhXvmc4XWFsvxMjPjE`
- Status: READY, aliased ke `https://www.redboxbarbershop.com`
- Tanggal: 15 Mei 2026

---

## 13. Masalah WA Notifikasi Reservasi (18 Mei 2026)

### 13.1 WA Konfirmasi Booking Tidak Terdeliver

**Gejala:** Setelah customer booking via website dan halaman "Booking Confirmed!" muncul, WA konfirmasi (ucapan terima kasih + detail booking) tidak pernah masuk ke HP customer.

**Root Cause: Fire-and-forget IIFE dikill Vercel serverless**

Kode lama menggunakan pola fire-and-forget `(async () => { ... })()` yang tidak di-await. Di Vercel serverless, begitu `res.end()` dipanggil (via `res.status(201).json(...)`), function bisa terminate sebelum IIFE selesai menjalankan HTTP call ke Fonnte.

```javascript
// KODE LAMA — tidak reliable di Vercel
(async () => {
  try {
    await notifyCustomerBookingConfirmed(...);
  } catch (e) { ... }
})(); // tidak di-await → dikill setelah res.end()

const r = await bridgeBookingToMoka(...);
return res.status(201).json(...); // ← Vercel terminate di sini
```

**Fix (`server/index.js` — commit `508db76`):**

Ganti ke awaited call sebelum `res.end()`:
```javascript
// KODE BARU — dijamin selesai sebelum response dikirim
if (desiredStatus === 'confirmed' && data.wa) {
  let barberName = null;
  if (data.barber_id) {
    try {
      const { data: b } = await supabase.from('barbers').select('name').eq('id', data.barber_id).single();
      barberName = b?.name || null;
    } catch (_) {}
  }
  try {
    await notifyCustomerBookingConfirmed({ ...data, barber_name: barberName });
  } catch (e) {
    console.warn('[WA Confirm] failed:', e.message);
  }
  notifyAdminNewBooking({ ...data, barber_name: barberName }).catch(() => {});
}
// baru lanjut ke Moka bridge → baru res.json()
```

---

### 13.2 WA Reminder & Konfirmasi Tidak Sampai — Nomor Tanpa Kode Negara

**Gejala:** Reminder H-1 jam dan WA konfirmasi booking tidak terdeliver ke customer.

**Root Cause: Nomor WA tersimpan tanpa kode negara, fonnte.js tidak menanganinya**

Customer mengisi form booking dengan format `81357662424` (tanpa leading `0` dan tanpa `62`). Kode normalisasi lama hanya menangani leading `0`:

```javascript
// KODE LAMA — hanya handle "0xxx" → "62xxx"
const number = String(to).replace(/\D/g, '').replace(/^0/, '62');
// "81357662424" → tetap "81357662424" ← SALAH, Fonnte tidak bisa route
```

Ditemukan dari query Supabase langsung: kolom `wa` di tabel `bookings` menyimpan `"81357662424"` (tanpa prefix).

**Fix (`server/services/fonnte.js` — commit `7892c9b`):**

Handle semua format nomor Indonesia:
```javascript
let number = String(to).replace(/\D/g, '');
if (number.startsWith('0')) {
  number = '62' + number.slice(1);      // "08xxx" → "628xxx"
} else if (!number.startsWith('62')) {
  number = '62' + number;               // "8xxx"  → "628xxx"
}
// "628xxx" tetap tidak berubah ✓
// "+628xxx" → strip + → "628xxx" → tidak berubah ✓
```

Fix ini berlaku untuk **semua WA notifikasi**: konfirmasi booking, reminder H-1, remind-soon, admin notif — semua pakai `sendWA()` yang sama.

**Verifikasi:** Direct curl ke Fonnte API dengan nomor `6281357662424` → `{"status":true,"detail":"success! message in queue"}` ✓

---

### 13.3 Bot Tanya Cabang Dulu Padahal Harusnya Langsung Kasih Link Booking

**Gejala:** Customer kirim "booking" atau "mau booking" → bot balas "Kak, cabang mana yang ingin Kakak tuju?" alih-alih langsung kasih link.

**Root Cause:** System prompt memiliki aturan "tanya cabang dulu sebelum kasih link" di bagian `CARA MENJAWAB`, dan GPT memprioritaskan flow `DISPATCH BOOKING` yang juga meminta bot mengumpulkan info cabang/layanan/tanggal/jam.

**Fix (`api/wa/webhook.js` — commit `ee44d4e`):**

1. Tambah blok `⚠️ ATURAN BOOKING` di posisi tinggi dalam system prompt — eksplisit melarang tanya cabang, wajib langsung kasih link:
   ```
   ⚠️ ATURAN BOOKING — WAJIB IKUTI, TIDAK BOLEH DILANGGAR:
   Setiap kali customer menyebut niat booking → LANGSUNG balas dengan link,
   TIDAK PERLU tanya cabang, layanan, atau info apapun dulu.
   Contoh: "Yuk langsung booking di sini kak: redboxbarbershop.com/booking.html"
   ```

2. Batasi flow `DISPATCH BOOKING` — hanya aktif jika customer **eksplisit** minta dibantu via WA (contoh: "tolong daftarin saya"), bukan sekedar "mau booking":
   ```
   PERHATIAN: Flow dispatch HANYA berlaku jika customer eksplisit minta
   dibantu booking via WA DAN sudah sebut cabang. Kalau hanya "mau booking"
   → ABAIKAN flow ini, langsung kasih link.
   ```

---

### 13.4 Catatan Penting — Timing Deployment Vercel

Booking yang dibuat dalam waktu < 2 menit setelah `git push` bisa kena kode lama yang belum ter-deploy. Vercel butuh ~1-2 menit untuk build & propagate.

Jika WA konfirmasi tidak masuk setelah booking:
1. Tunggu 2 menit, lalu coba booking baru
2. Cek Vercel dashboard → Deployments → pastikan status **READY**
3. Verifikasi Fonnte bisa kirim: `GET /api/wa/webhook?debug=redbox2026&send_to=628xxx&send_msg=test`

---

### 13.5 Commits Relevan (18 Mei 2026)

| Commit | Deskripsi |
|---|---|
| `508db76` | fix(wa): await konfirmasi WA sebelum response (bukan fire-and-forget) |
| `7892c9b` | fix(fonnte): normalisasi nomor WA tanpa kode negara (8xxx → 628xxx) |
| `ee44d4e` | fix(wa-bot): langsung kasih link booking, batasi dispatch flow |
| `889cd36` | fix(wa-bot): rule booking langsung link (versi awal, diperkuat di ee44d4e) |
