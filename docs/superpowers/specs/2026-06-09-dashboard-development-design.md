# Design Spec: Member Dashboard Development
**Date:** 2026-06-09 
**Status:** Approved — ready for implementation 
**Affected file:** `member-dashboard.html`, `js/dashboard.js`

---

## Overview

Pengembangan halaman `member-dashboard.html` dengan tiga tambahan utama:
1. **Smart Upsell Banner** — banner dinamis berdasarkan tier member saat ini
2. **Tab "Benefits & Rewards"** — menggantikan tab "Rewards", berisi benefit tracker + riwayat redeem + katalog rewards
3. **Tab "Shop"** — tab baru untuk upsell produk & layanan premium

Tab akhir setelah perubahan (6 total):
| # | Nama Tab | Keterangan |
|---|----------|------------|
| 1 | Pengaturan Akun | Existing, tidak berubah |
| 2 | Riwayat Kunjungan | Existing, tidak berubah |
| 3 | Riwayat Poin | Existing, tidak berubah |
| 4 | **Benefits & Rewards** | Menggantikan tab "Rewards" |
| 5 | **Shop** | Tab baru |
| 6 | Kode Referral | Existing, tidak berubah |

---

## 1. Smart Upsell Banner

**Posisi:** Di antara section tier progress dan tab bar.

**Behaviour:** Banner auto-render berdasarkan `currentTier.name` dari `memberData.points`. 
Sistem tier upgrade kini **berbayar** (bukan akumulasi poin), sehingga CTA banner mengarah ke halaman/flow upgrade berbayar.

### 4 States

| Tier Saat Ini | Headline | Sub-copy | CTA |
|---|---|---|---|
| **Bronze** | "Aktivasi Member — Mulai Kumpul Poin" | "Bergabunglah dan mulai dapatkan keuntungan eksklusif." | "Aktivasi Sekarang" |
| **Silver** | "Upgrade ke Gold — Unlock Benefit Lebih" | "Diskon 10% semua layanan, cashback eksklusif, dan lainnya." | "Upgrade ke Gold" |
| **Gold** | "Upgrade ke Platinum — Benefit Terlengkap" | "Free grooming, iced americano, dan birthday gratis di semua cabang." | "Upgrade ke Platinum" |
| **Platinum** | "Kamu di Tingkat Tertinggi" | "Nikmati semua benefit eksklusif Redbox Platinum." | — (no CTA) |

**Visual:**
- Background gradient gelap sesuai warna tier (Bronze: amber-dim, Silver: slate-dim, Gold: yellow-dim, Platinum: purple-dim)
- SVG icon sesuai tier (no emoji)
- Progress bar mini: `pointsInCurrentTier / rangeWidth` — tetap ditampilkan untuk Bronze–Gold (info informatif, bukan untuk trigger upgrade)
- Platinum: tidak ada progress bar, tidak ada CTA, hanya celebratory state

---

## 2. Tab "Benefits & Rewards"

Mengganti tab "Rewards" yang lama. Berisi tiga section berurutan:

### Section A: Benefit Tracker

Daftar benefit yang dimiliki/belum dimiliki, dikelompokkan per tier.

**Data source:** Array `BENEFITS` baru (defined di `dashboard.js`), bukan `REWARDS` — karena benefits adalah entitlement tier, bukan reward berbayar poin.

```
BENEFITS (per tier, hardcoded):
Bronze: - Akses dashboard member
 - Kode referral
 - Riwayat kunjungan & poin
Silver: - Poin multiplier ×1.2
 - Cashback 50% Haircut Regular (via rewards redeem)
 - Akses Katalog Produk
Gold: - Poin multiplier ×1.5
 - Diskon 10% semua layanan
 - Cashback 50% Haircut Premium CSB (via rewards redeem)
Platinum: - Poin multiplier ×2.0
 - Free Gentlemen Grooming tiap kunjungan
 - Free Iced Americano tiap kunjungan
 - Birthday gratis penuh
 - Akses ke semua cabang priority
```

**State per row:**
- `unlocked` — hijau, centang, teks normal
- `locked-next` — merah-dim, lock icon, teks faded, label "Unlock di [tier]"
- `locked-far` — abu-abu gelap, lock icon, teks sangat faded

### Section B: Riwayat Redeem

Tabel riwayat penukaran reward menggunakan poin.

**Data source:** `memberData.pointsHistory` difilter dengan `type === 'redeem'` atau field baru `redeemHistory[]` di Supabase `member_profiles`.

**Kolom:** Tanggal · Nama Reward · Poin Terpakai · Status (Pending / Used / Expired)

**Empty state:** "Belum ada riwayat redeem — tukar poin kamu di bawah"

### Section C: Katalog Rewards

Grid rewards yang bisa diredeem dengan poin. Data dari `REWARDS` array di `dashboard.js` (9 items, sudah ada).

**Filter:** Hanya tampilkan rewards yang tiernya ≤ currentTier (rewards tier lebih tinggi tetap tampil tapi di-lock/greyed out).

**Card per reward:**
- Nama, deskripsi singkat, biaya poin
- State: Available (tombol "Redeem") | Locked (tombol "Upgrade Tier") | Not enough points (tombol disabled + "Butuh X poin lagi")

---

## 3. Tab "Shop"

Tab baru untuk upsell produk & layanan.

### Section A: Rekomendasi Untukmu (Curated)

3 produk rekomendasi berdasarkan tier — hardcoded mapping:

| Tier | Produk Rekomendasi |
|---|---|
| Bronze/Silver | Clay + Water Base + Oil Base |
| Gold | Clay + Water Base + Eleftheree |
| Platinum | Eleftheree + Psyhi + Clay |

**Card layout:** Foto (110px height) → Nama → Deskripsi singkat → Harga → Tombol "Beli via WA"

### Section B: Semua Produk

Grid 3-kolom semua produk. 5 produk + "Lihat semua →" card yang link ke `products.html`.

**Produk:**
| Nama | Foto | Harga |
|---|---|---|
| Redbox Clay | `Brand_assets/product/clay.jpeg` | Rp 100.000 |
| Pomade Waterbased | `Brand_assets/product/water_base.jpeg` | Rp 100.000–150.000 |
| Pomade Oil Based | `Brand_assets/product/oil_base.jpeg` | Rp 100.000–150.000 |
| Parfum Eleftheree | `Brand_assets/product/IMG_6532.JPG.jpeg` | Rp 150.000 |
| Parfum Psyhi | `Brand_assets/product/psyi.jpeg` | Rp 150.000 |

### Section C: Tingkatkan Pengalamanmu (Service Upsell)

Grid 2-kolom, 4 service cards. Layout sama dengan product card (foto atas, info bawah, button pinned ke bawah).

| Nama | Foto | State | Keterangan |
|---|---|---|---|
| Gentlemen Grooming | `Brand_assets/Services/Shaving.jpg` | Gold disc 10% | Aktif untuk Gold+ |
| Hairspa | `Brand_assets/Services/Creambath.jpg` | Gold disc 10% | Aktif untuk Gold+ |
| Men's Massage | `Brand_assets/Services/Men_Massage_Service.jpg` | Platinum locked | Gratis khusus Platinum |
| Iced Americano | Unsplash `photo-1630184799082-05623dbdc7f7` | Platinum locked | Gratis khusus Platinum |

**Service card behavior:**
- Gold disc → tombol "Book sekarang" (link ke booking.html)
- Platinum locked → overlay gelap, badge "Platinum", tombol "Upgrade ke Platinum"

### Section D: Upgrade CTA Block

Banner di bawah service cards — hanya tampil jika tier < Platinum.

- Judul: "Upgrade ke [tier berikutnya]"
- Teks: benefit yang unlock
- Tombol: "Upgrade Sekarang"
- **Catatan:** Upgrade tier bersifat **berbayar**, bukan akumulasi poin. CTA mengarah ke flow/halaman upgrade berbayar.

---

## 4. Data & Logic Notes

### Tier Detection (existing, tidak berubah)
```js
const tier = TIERS.slice().reverse().find(t => memberData.points >= t.min) || TIERS[0];
```

### ACTIVE gate
Semua konten tab Benefits & Rewards dan Shop di-gate dengan `membership_status === 'ACTIVE'`. 
Jika INACTIVE → tampilkan state "Aktivasi membership terlebih dahulu".

### Tier Upgrade System
Upgrade tier **berbayar** — tidak lagi berbasis akumulasi poin. Implikasi UI:
- Tidak ada teks "X poin lagi untuk naik tier" di CTA upgrade
- Progress bar di banner hanya informatif (menunjukkan posisi dalam rentang tier saat ini)
- Tombol upgrade selalu aktif dan mengarah ke flow pembayaran

### WA Order Flow
Produk dijual via WhatsApp. Tombol "Beli via WA" generate link: 
`https://wa.me/628XXX?text=Halo%20Redbox%2C%20saya%20ingin%20memesan%20[nama_produk]`

---

## 5. Assets

| Asset | Path di repo | Dipakai di |
|---|---|---|
| clay.jpeg | `Brand_assets/product/clay.jpeg` | Shop — produk |
| water_base.jpeg | `Brand_assets/product/water_base.jpeg` | Shop — produk |
| oil_base.jpeg | `Brand_assets/product/oil_base.jpeg` | Shop — produk |
| eleftheree.jpeg | `Brand_assets/product/IMG_6532.JPG.jpeg` | Shop — produk |
| psyhi.jpeg | `Brand_assets/product/psyi.jpeg` | Shop — produk |
| Shaving.jpg | `Brand_assets/Services/Shaving.jpg` | Shop — service Gentlemen Grooming |
| Creambath.jpg | `Brand_assets/Services/Creambath.jpg` | Shop — service Hairspa |
| Men_Massage_Service.jpg | `Brand_assets/Services/Men_Massage_Service.jpg` | Shop — service Men's Massage |
| Americano (Unsplash) | `https://images.unsplash.com/photo-1630184799082-05623dbdc7f7?w=400&q=75` | Shop — service Iced Americano |
