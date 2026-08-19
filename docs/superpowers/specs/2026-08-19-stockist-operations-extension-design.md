# Stockist Operations Extension — Design Spec

**Date:** 2026-08-19
**Status:** Draft for review

## Goal

Memperluas fondasi Stockist existing dengan Dashboard Aset Stok yang dapat diaudit, pemisahan barang retail dan layanan, serta stock opname yang akuntabel tanpa membuat role/login baru atau mengubah kontrak ledger immutable.

## Scope and constraints

- Menggunakan role existing: `owner`, `branch_admin`, dan `barber`.
- `barber` tidak mendapat akses administrasi inventory; PIC layanan hanya dapat dipakai untuk pencatatan penggunaan yang diizinkan server.
- Semua perubahan quantity wajib melalui `apply_inventory_movement()` dan menghasilkan satu baris `inventory_ledger`.
- `purchase_price` hanya boleh dikirim ke `owner`.
- Tidak ada direct balance edit dari frontend atau endpoint biasa.
- Tidak ada perubahan production database langsung dalam pekerjaan lokal ini.
- Perubahan harus incremental terhadap route/service/page Stockist existing.

## Existing foundation

Implementasi existing sudah memiliki route `/api/stockist`, dashboard service, product master, transfer, adjustment, stock opname, request, return, serta test backend. File utama yang menjadi extension points:

- `server/routes/stockist.js`
- `server/services/stockistDashboard.js`
- `server/services/stockistInventory.js`
- `server/services/stockistOpname.js`
- `server/services/stockistAccess.js`
- `frontend/src/app/admin/stockist/page.tsx`
- `frontend/src/app/admin/stockist/products/page.tsx`
- `frontend/src/app/admin/stockist/stock-opname/page.tsx`
- `frontend/src/app/admin/stockist/stock-opname/[id]/page.tsx`
- `server/test/stockist-*.test.js`

## Architecture

### 1. Product classification

Tambahkan `product_type` pada produk dengan nilai enum `RETAIL` atau `SERVICE`. Nilai default untuk produk existing adalah `RETAIL` agar migrasi tidak mengubah perilaku lama secara diam-diam.

- `RETAIL`: hanya dapat dikurangi melalui penjualan retail atau adjustment yang disetujui.
- `SERVICE`: tidak dijual melalui alur retail; pengurangan operasional menggunakan service-use lifecycle.

Server memvalidasi `product_type` pada setiap endpoint yang memicu movement. Frontend hanya menampilkan action yang sesuai, tetapi bukan sumber otoritas.

### 2. Service-use lifecycle

Buat tabel penggunaan layanan yang merekam satu sesi pemakaian produk di satu lokasi:

```text
service_usage
  id, product_id, location_id, pic_user_id,
  status, opened_at, assigned_at, consumed_at,
  replenishment_requested_at, note, created_by, created_at
```

Status yang diizinkan:

```text
OPEN → IN_USE → CONSUMED → REPLENISHMENT_REQUESTED
```

Aturan:

- `OPEN` harus memiliki produk `SERVICE` dan lokasi yang berada dalam scope user.
- `ASSIGN` wajib memiliki PIC dan hanya boleh dilakukan pada status `OPEN`.
- `IN_USE` tidak dapat dibuka dua kali untuk sesi yang sama.
- `CONSUMED` hanya dapat dilakukan satu kali dan membuat satu `SERVICE_USE` movement dengan delta negatif.
- `REPLENISHMENT_REQUESTED` hanya boleh dilakukan setelah `CONSUMED`.
- Request tambahan mereferensikan `service_usage.id`; request tidak mengurangi stok sampai transfer/fulfillment yang memang sudah ada menyelesaikannya.
- Retail product ditolak pada semua endpoint service-use dengan status `400` dan error code stabil `SERVICE_PRODUCT_REQUIRED`.

### 3. Movement types

Pertahankan movement existing dan tambahkan tipe eksplisit berikut:

```text
SALE_RETAIL
SERVICE_USE
STOCK_OPNAME_GAIN
STOCK_OPNAME_LOSS
DAMAGE
LOST
```

`STOCK_OPNAME_GAIN` memakai delta positif dan `STOCK_OPNAME_LOSS` memakai delta negatif. Movement opname harus membawa `reference_type = stock_opname`, `reference_id`, alasan, actor, dan timestamp.

### 4. Stock opname accountability

Pertahankan tabel dan route opname existing, dengan penguatan berikut:

- Tambahkan `scheduled_for`, `submitted_at`, `approved_at`, `approved_by`, dan `evidence_url` bila kolom belum tersedia.
- Sistem menolak lebih dari satu opname aktif pada lokasi yang sama.
- Item dengan selisih nonzero wajib memiliki alasan.
- Foto bukti diwajibkan untuk selisih di atas threshold yang ditetapkan konfigurasi server; default MVP: setiap selisih nonzero.
- Hanya `owner` yang dapat approve.
- Approve bersifat idempotent: status `APPROVED` mengembalikan hasil existing dan tidak membuat movement baru.
- Reject mengembalikan ke status yang dapat diperbaiki tanpa menghapus histori.
- Approval satu opname harus memproses seluruh item secara atomik atau tidak menghasilkan movement sama sekali.

### 5. Dashboard Aset Stok

#### Background

Dashboard owner lama terlalu teknis dan menonjolkan angka mentah seperti total barang `2.275 pcs`. Angka tersebut tidak cukup membantu owner memahami nilai bisnis, konsentrasi aset, risiko stok, atau tindakan yang perlu diambil.

#### Objective

Ubah dashboard menjadi **Dashboard Aset Stok** yang berfokus pada insight bisnis, bukan sekadar jumlah fisik. Dashboard harus read-only, berbasis nilai aset, dan dapat dipahami owner dalam lima sampai sepuluh detik pertama.

#### Prinsip desain

- Read-only: dashboard tidak menjadi tempat mutasi stok; aksi operasional tetap berada di halaman khususnya.
- Berbasis nilai: tampilkan nilai rupiah dan konteks bisnis sebagai informasi utama.
- Ringkas: prioritaskan sinyal yang membantu owner mengambil keputusan cepat.
- Drill-down: setiap ringkasan penting dapat dibuka ke detail yang dapat diaudit.
- Jangan tampilkan angka total tanpa breakdown. Setiap total wajib disertai sumber lokasi, kategori, status, atau komponen perhitungannya.
- Gunakan bahasa bisnis yang mudah dipahami, bukan istilah teknis ledger sebagai label utama.

#### Kartu wajib

Dashboard owner wajib menampilkan lima kartu berikut di area paling atas:

1. **Total Nilai Aset Stok** — rumus: `Σ (saldo stok per produk per lokasi × purchase_price produk)`. Breakdown minimal: Gudang Pusat dan seluruh cabang.
2. **Nilai Stok Gudang Pusat** — rumus: `Σ (saldo stok produk di Gudang Pusat × purchase_price produk)`. Klik membuka rincian produk, kuantitas, nilai, dan status stok.
3. **Nilai Stok Semua Cabang** — rumus: `Σ (saldo stok produk di seluruh cabang × purchase_price produk)`. Wajib memiliki breakdown per cabang.
4. **Barang Perlu Perhatian** — stok di bawah/sama dengan reorder point, stok kosong, selisih opname, kerusakan, atau kehilangan yang belum ditindaklanjuti; tampilkan alasan dan lokasi.
5. **Transfer Berjalan** — transfer aktif seperti `SENT` atau penerimaan yang belum selesai; tampilkan asal, tujuan, jumlah item, umur transfer, dan indikator selisih.

#### Aset per lokasi

Sediakan section **Aset per Lokasi** setelah kartu utama, dengan kelompok **Gudang Pusat** dan **Cabang**. Masing-masing menampilkan nilai aset, jumlah SKU aktif, item perlu perhatian, serta transfer berjalan.

Saat owner mengklik lokasi, tampilkan detail read-only: produk, saldo, `purchase_price`, nilai aset per produk, status stok, transfer terkait, dan tautan ke ledger sebagai bukti audit.

#### Grafik

Maksimal tiga grafik pada halaman depan: (1) distribusi nilai aset per lokasi, (2) komposisi barang perlu perhatian berdasarkan alasan/status, dan (3) tren nilai aset atau transfer berjalan. Grafik wajib memiliki label, satuan rupiah, periode, breakdown/detail pendamping, dan empty state.

#### Role visibility

| Role | Dashboard | Nilai aset / `purchase_price` | Scope lokasi | Ledger |
| --- | --- | --- | --- | --- |
| `owner` | Dashboard Aset Stok penuh | Ya | Gudang Pusat dan semua cabang | Detail audit |
| `branch_admin` | Ringkasan operasional cabang | Tidak | Hanya cabang dari session terverifikasi | Detail yang diizinkan |
| `barber` | Tidak mendapat akses administrasi inventory | Tidak | Tidak ada | Tidak ada |

Ledger tetap tersedia untuk audit dan operasi detail, tetapi bukan halaman depan dan bukan fokus utama dashboard.

Perluas service dashboard menjadi satu response server-side dengan bagian:

```text
cash_outflow
inventory_value
asset_by_location
low_stock
attention_items
active_transfers
fast_moving
branch_consumption
ledger_summary
```

Definisi MVP:

- `cash_outflow`: total `purchase_price * quantity` dari movement penerimaan gudang dalam rentang tanggal.
- `inventory_value`: saldo stok seluruh lokasi dikalikan `purchase_price` produk aktif; ditampilkan sebagai **Total Nilai Aset Stok**.
- `asset_by_location`: agregasi nilai aset Gudang Pusat dan setiap cabang, termasuk breakdown yang menjadi dasar total.
- `low_stock`: produk dengan available quantity <= reorder point, dikelompokkan per lokasi.
- `attention_items`: gabungan low stock, stok kosong, selisih opname, kerusakan, dan kehilangan yang memerlukan perhatian owner.
- `active_transfers`: transfer yang belum selesai, dikelompokkan berdasarkan asal, tujuan, umur, dan status penerimaan.
- `fast_moving`: produk dengan total delta negatif terbesar dari `SALE_RETAIL` dan `SERVICE_USE` dalam rentang tanggal.
- `branch_consumption`: total biaya konsumsi berdasarkan `purchase_price` dari movement `SALE_RETAIL`, `SERVICE_USE`, `DAMAGE`, dan `LOST` per lokasi cabang.
- `ledger_summary`: total count dan quantity delta per movement type.

Response hanya mengandung `purchase_price` dan nilai rupiah untuk owner. Branch admin tetap memakai summary scoped tanpa nilai beli.

Dashboard mendukung `from`, `to`, `location_id`, dan `product_type` sebagai filter. Setiap card memiliki endpoint/detail query yang menggunakan filter sama dan dapat menelusuri ledger.

## API design

Endpoint baru atau extension:

```text
GET  /api/stockist/dashboard/owner
POST /api/stockist/service-usage
PATCH /api/stockist/service-usage/:id/assign
PATCH /api/stockist/service-usage/:id/start
PATCH /api/stockist/service-usage/:id/consume
POST /api/stockist/service-usage/:id/replenishment-request
```

Endpoint opname existing diperketat, bukan digandakan:

```text
POST  /api/stockist/stock-opname
PATCH /api/stockist/stock-opname/:id/count
PATCH /api/stockist/stock-opname/:id/submit
PATCH /api/stockist/stock-opname/:id/approve
PATCH /api/stockist/stock-opname/:id/reject
```

Semua error baru memakai `error_code` stabil agar frontend tidak bergantung pada teks error.

## Data flow

```text
Product type
    ↓
Server validation
    ↓
Business lifecycle / opname approval
    ↓
apply_inventory_movement()
    ↓
inventory_ledger + balance update
    ↓
Owner dashboard aggregation
```

Dashboard tidak menjadi sumber stok. Ia membaca balance/ledger yang sudah tervalidasi.

## Error handling and security

- Scope lokasi selalu dihitung dari session server.
- `branch_admin` tidak dapat mengganti `location_id` ke cabang lain.
- `barber` tidak dapat approve opname, adjustment, atau melihat purchase price.
- Duplicate consume dan duplicate approve dikembalikan sebagai idempotent success atau `409` sesuai state transition.
- Insufficient stock ditolak sebelum movement.
- Product type mismatch ditolak sebelum movement.
- Upload bukti memakai mekanisme upload existing; URL disimpan pada record opname, bukan dipercaya dari client tanpa validasi.
- Partial failure pada approval harus memakai RPC/transaction boundary yang sama dengan movement contract existing.

## Testing strategy

### Unit/service tests

- Retail product ditolak pada service-use.
- Service product membuat `SERVICE_USE` tepat satu kali.
- Lifecycle menolak transition yang tidak berurutan.
- Opname nonzero wajib reason/evidence sesuai policy.
- Opname approve menghasilkan `STOCK_OPNAME_GAIN/LOSS` dengan delta benar.
- Approve ulang tidak menggandakan ledger.
- Dashboard menghitung cash outflow, inventory value, fast-moving, branch consumption, dan ledger summary dari movement yang benar.

### Route/integration tests

- Owner dapat membaca dashboard penuh.
- Branch admin hanya membaca dashboard scoped tanpa purchase price.
- Cross-branch service usage ditolak.
- Duplicate consume/approve aman.
- Insufficient stock tidak membuat ledger.
- Product type update divalidasi dan tidak mengubah histori movement.

### Verification

- Jalankan test targeted untuk setiap task.
- Jalankan `npm test` penuh.
- Jalankan frontend lint/typecheck/build yang tersedia.
- Review `git diff --stat` dan `git status --short` untuk memastikan file unrelated tidak ikut berubah.
- Visual QA pada halaman dashboard, service usage, dan opname setelah server/frontend dapat dijalankan.

## Out of scope

- Role/login baru.
- Moka sales sync otomatis.
- Forecast berbasis AI.
- Marketplace, payment, finance ledger, atau perubahan arsitektur portal admin.
- Penghapusan/reset file untracked existing.

## Acceptance criteria

1. Owner langsung melihat **Dashboard Aset Stok**, bukan dashboard angka mentah seperti total pcs tanpa konteks.
2. Lima kartu wajib tampil: Total Nilai Aset Stok dengan rumus, Nilai Stok Gudang Pusat, Nilai Stok Semua Cabang, Barang Perlu Perhatian, dan Transfer Berjalan.
3. Tidak ada angka total yang tampil tanpa breakdown lokasi, status, atau komponen yang relevan.
4. Owner dapat membuka Aset per Lokasi dan melakukan drill-down ke detail produk serta ledger.
5. Halaman depan menampilkan maksimal tiga grafik dan mudah dipahami dalam lima sampai sepuluh detik.
6. `branch_admin` tetap terbatas pada cabangnya dan tidak menerima `purchase_price` atau nilai aset owner.
7. Dashboard dan detail utamanya usable dengan pendekatan mobile-first.
8. Produk retail tidak dapat masuk service-use flow.
9. Produk service hanya mengurangi stok setelah status `CONSUMED`.
10. Request replenishment tidak tersedia sebelum produk ditandai habis.
11. Stock opname memerlukan alasan/bukti sesuai policy dan approval owner.
12. Approval opname hanya menghasilkan movement satu kali.
13. Semua perubahan quantity tetap melalui movement contract existing.
14. Test regression untuk permission, idempotency, product type, dan dashboard lulus.
