# Moka Open Bill Sync - Status & Testing Guide

## ✅ Barber ID Mapping - COMPLETE

| Cabang | Total | Mapped | Missing | Status |
|--------|-------|--------|---------|--------|
| **Bypass** | 4 | 4 | 0 | ✅ |
| **CSB** | 7 | 6 | Yudha* | ✅ |
| **Samadikun** | 5 | 5 | 0 | ✅ |
| **Sumber** | 4 | 4 | 0 | ✅ |
| **Tegal** | 6 | 6 | 0 | ✅ |

*Yudha (CSB): Tidak ditemukan di Item Library - perlu setup manual di Moka POS

---

## 🔧 API Endpoints Created

### 1. Update Tegal Barber IDs
```
GET /api/moka/update-barber-ids?secret=YOUR_ADMIN_PASSWORD
```
**Purpose**: Update moka_employee_id untuk semua barber Tegal dari CSV data

### 2. Test Sync Status
```
GET /api/moka/test-sync?outlet=bypass&secret=YOUR_ADMIN_PASSWORD
```
**Purpose**: Cek status outlet - token, barber mapping, dan schedules hari ini

### 3. Cron Sync (Auto-run every 5 min)
```
GET /api/moka/cron-sync
```
**Purpose**: Sync open bills dari Moka ke Supabase schedules

---

## 🚀 Testing Steps

### Step 1: Update Tegal Barber IDs (Jika Belum)
```bash
# Setelah deploy, call:
curl "https://your-domain.vercel.app/api/moka/update-barber-ids?secret=YOUR_ADMIN_PASSWORD"
```

### Step 2: Test Outlet Status
```bash
# Check Bypass
curl "https://your-domain.vercel.app/api/moka/test-sync?outlet=bypass&secret=YOUR_ADMIN_PASSWORD"

# Check CSB
curl "https://your-domain.vercel.app/api/moka/test-sync?outlet=csb&secret=YOUR_ADMIN_PASSWORD"
```

### Step 3: Create Test Open Bill
1. Buka Moka POS di outlet (misal: Bypass)
2. Buat open bill untuk barber (misal: Abdul) jam 14:00
3. Biarkan bill tetap "Open" (jangan checkout)

### Step 4: Trigger Manual Sync
```bash
curl "https://your-domain.vercel.app/api/moka/cron-sync?secret=YOUR_ADMIN_PASSWORD"
```

### Step 5: Verify Web Booking
1. Buka website booking
2. Pilih outlet Bypass
3. Pilih tanggal hari ini
4. Pilih barber Abdul
5. **Verifikasi**: Slot jam 14:00 harusnya terblokir/coret

### Step 6: Check Test Endpoint
```bash
curl "https://your-domain.vercel.app/api/moka/test-sync?outlet=bypass&secret=YOUR_ADMIN_PASSWORD"
```
Response harus menunjukkan `moka_open_bills: 1` atau lebih

---

## ⚠️ Notes

1. **Yudha (CSB)**: Perlu ditambahkan ke Item Library Moka POS, atau buat open bill manual dengan nama "Yudha" agar ID muncul

2. **Cron Job**: Sudah terkonfigurasi di `vercel.json` untuk jalan setiap 5 menit:
   ```json
   { "path": "/api/moka/cron-sync", "schedule": "*/5 * * * *" }
   ```

3. **Token Expired**: Jika token expired, perlu re-autentikasi via Moka dashboard untuk outlet yang bersangkutan

4. **Barber Mapping**: Jika open bill tidak memblokir slot, cek:
   - Barber sudah punya `moka_employee_id` (gunakan test-sync endpoint)
   - Nama barber di Moka sama dengan `Items Name` di Item Library

---

## 🔍 Debug Commands

```bash
# Check all outlets
curl "https://your-domain.vercel.app/api/moka/debug-bills?secret=YOUR_ADMIN_PASSWORD"

# Force sync specific outlet
curl "https://your-domain.vercel.app/api/moka/sync-barber-ids?outlet=bypass&secret=YOUR_ADMIN_PASSWORD"
```

---

## 📋 Barber IDs Reference

### Bypass
- Abdul (Dul): 31396411
- Ari: 31396363
- Bob: 31396315
- Kaji dodi: 31396331

### CSB
- Anggi: 136355699
- Ega: 47727447
- Husen: 44083420
- Ragil: 44084943
- Syarif: 37476435
- Ubay: 25654316

### Samadikun
- Aden: 23004384
- Khamami: 11553097
- Miftah: 23004421
- Opan: 41637084
- Sofyan: 23004441

### Sumber
- Didi: 94015772
- Prima: 82158673
- Putra: 31396299
- Sigit: 82158687

### Tegal
- Ahmad: 147463715
- Epik: 147465521
- Faiz: 147468093
- Sephril: 147470666
- Wawan: 147470744
- Yafi: 147470745
