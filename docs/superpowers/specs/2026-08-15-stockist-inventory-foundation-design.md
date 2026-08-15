# Stockist Inventory Foundation — Design Spec
**Date:** 2026-08-15
**Status:** Draft

## Overview

RedBox mulai jual produk retail (pomade, parfum, facewash, dll — barang dari pabrik) di kelima cabang yang sudah ada (Bypass, Samadikun, CSB Mall, Sumber, Tegal). Sistem ini melacak barang dari saat tiba di pusat sampai didistribusikan dan diterima di cabang, dengan buku besar (ledger) yang auditable untuk setiap perubahan stok.

Ini adalah **sub-project pertama** dari rencana stockist logistics yang lebih besar (lihat `docs/stockist-logistics-system-plan.md`). Sinkronisasi penjualan MokaPOS, stock opname, retur, dan forecasting sengaja ditunda ke spec terpisah setelah fondasi ini stabil dipakai — lihat [Out of Scope](#out-of-scope-untuk-spec-ini).

### Reframing dari plan doc asli

Eksplorasi codebase sebelum brainstorming menemukan dua asumsi di `docs/stockist-logistics-system-plan.md` yang tidak sesuai kondisi nyata:

1. **Bukan jaringan reseller eksternal.** Plan doc awal mengasumsikan "stokist" adalah mitra bisnis independen dengan akun Moka sendiri, credit limit, dan payment terms. Kenyataannya ini murni distribusi internal RedBox ke 5 cabang miliknya sendiri — tidak ada purchase order komersial, tidak ada approval kredit.
2. **Role `branch_admin` sudah ada dan sudah scoped per cabang.** `users.role CHECK (role IN ('owner','branch_admin','barber'))` dengan kolom `branch` sudah persis mencakup 5 cabang yang sama (`bypass`, `samadikun`, `csb`, `sumber`, `tegal`). Plan doc menyarankan role baru `stockist` — ini tidak diperlukan; modul ini memakai role yang sudah ada.

---

## 1. Scope

### In Scope untuk spec ini
- Master data produk retail (terpisah dari `services`, yang isinya jasa potong rambut).
- Stok pusat (warehouse) dan stok per cabang, dengan ledger pergerakan yang immutable.
- Alur distribusi pusat → cabang: kirim → cabang konfirmasi terima (dua tahap, lihat §4).
- Halaman admin untuk kelola produk, terima barang dari pabrik, buat & pantau transfer, lihat stok.

### Out of Scope untuk spec ini
Didaftarkan eksplisit supaya tidak diam-diam masuk scope creep. Masing-masing jadi spec sendiri setelah fondasi ini jalan:
- **Sinkronisasi penjualan MokaPOS** (auto-kurangi stok saat produk terjual di kasir). Kolom `products.moka_item_id` disiapkan sebagai tempat mapping nanti, tapi job sync-nya tidak dibangun di spec ini.
- **Stock opname** (hitung fisik vs sistem, approval selisih).
- **Retur / barang rusak / hilang.**
- **Forecast restock, laporan margin, komisi.**
- **Notifikasi** (WA/push untuk stok rendah, transfer terkirim, dll).

### Role & akses
Tidak ada role baru. Memakai `owner` dan `branch_admin` yang sudah ada di `users`:

| Aksi | owner | branch_admin |
|---|---|---|
| Kelola master produk (create/edit) | ✅ | view-only, tanpa `purchase_price` |
| Terima barang dari pabrik ke pusat | ✅ | ❌ |
| Buat & kirim transfer ke cabang | ✅ | ❌ |
| Konfirmasi terima transfer | ✅ (bisa atas nama cabang manapun) | ✅, hanya untuk cabang miliknya (`users.branch`) |
| Lihat stok pusat | ✅ | ❌ |
| Lihat stok cabang | ✅ semua cabang | ✅ hanya cabangnya sendiri |
| Lihat `purchase_price` | ✅ | ❌ (di-strip di response API, bukan cuma disembunyikan di UI) |

`barber` tidak punya akses ke modul ini sama sekali.

---

## 2. Data Model

### `products` (baru)
```sql
CREATE TABLE products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku              TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT,
  brand            TEXT,
  unit             TEXT NOT NULL DEFAULT 'pcs',
  barcode          TEXT,
  purchase_price   INTEGER,            -- owner-only field
  retail_price     INTEGER,            -- harga jual di cabang, nullable
  minimum_stock    INTEGER NOT NULL DEFAULT 0,
  reorder_point    INTEGER NOT NULL DEFAULT 0,
  moka_item_id     TEXT,               -- disiapkan untuk sync fase berikutnya, belum dipakai
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Terpisah dari `services` — `services` tetap murni katalog jasa (haircut, shave, dll) yang sudah dipakai booking flow. Menggabungkan keduanya akan mencampur dua domain berbeda (jasa vs barang fisik).

### `inventory_locations` (baru)
```sql
CREATE TABLE inventory_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL CHECK (type IN ('warehouse', 'branch')),
  outlet_id   UUID REFERENCES outlets(id),   -- NULL untuk warehouse, wajib untuk branch
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_branch_has_outlet CHECK (
    (type = 'branch' AND outlet_id IS NOT NULL) OR
    (type = 'warehouse' AND outlet_id IS NULL)
  )
);
```
Sengaja **tidak** menaruh baris "pusat" langsung di tabel `outlets` yang sudah ada — `outlets` sudah terikat erat ke konsep booking (barbers.outlet_id, moka_tokens per outlet untuk sync booking). Gudang pusat bukan outlet booking dan tidak punya token Moka booking sendiri; memaksakannya ke tabel itu akan mencampur dua domain. `inventory_locations` jadi lapisan tipis di atas: 1 baris `warehouse` (singleton) + 5 baris `branch` yang masing-masing menunjuk ke `outlets` yang sudah ada, supaya nama cabang & data existing tetap bisa di-join.

### `inventory_balances` (baru)
```sql
CREATE TABLE inventory_balances (
  product_id   UUID NOT NULL REFERENCES products(id),
  location_id  UUID NOT NULL REFERENCES inventory_locations(id),
  quantity     INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, location_id)
);
```
Read-cache turunan dari ledger. **Tidak pernah diedit langsung oleh UI/API** — hanya diubah lewat fungsi yang juga menulis baris ledger di transaksi yang sama.

### `inventory_ledger` (baru)
```sql
CREATE TABLE inventory_ledger (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id        UUID NOT NULL REFERENCES products(id),
  location_id       UUID NOT NULL REFERENCES inventory_locations(id),
  movement_type     TEXT NOT NULL CHECK (movement_type IN (
                       'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'
                     )),
  quantity_delta    INTEGER NOT NULL,
  quantity_before   INTEGER NOT NULL,
  quantity_after    INTEGER NOT NULL,
  reference_type    TEXT,             -- 'stock_transfer'
  reference_id      UUID,
  performed_by      UUID NOT NULL REFERENCES users(id),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Append-only. Movement type lain (`SALE_MOKA`, `STOCK_OPNAME_GAIN/LOSS`, `RETURN_*`, `DAMAGE`, `LOST`) ditambahkan saat spec masing-masing dibangun — tidak didefinisikan di sini karena belum ada alur yang menghasilkannya.

### `stock_transfers` + `stock_transfer_items` (baru)
```sql
CREATE TABLE stock_transfers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number       TEXT UNIQUE NOT NULL,
  source_location_id    UUID NOT NULL REFERENCES inventory_locations(id),
  destination_location_id UUID NOT NULL REFERENCES inventory_locations(id),
  status                TEXT NOT NULL DEFAULT 'SENT'
                        CHECK (status IN ('SENT', 'RECEIVED')),
  sent_by               UUID NOT NULL REFERENCES users(id),
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by           UUID REFERENCES users(id),
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_transfer_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  quantity_sent     INTEGER NOT NULL,
  quantity_received INTEGER    -- NULL sampai dikonfirmasi cabang
);
```
Tidak ada status `DRAFT` — transfer dibuat langsung dalam status `SENT` karena submit form = kirim (tidak ada draft/approval terpisah di scope ini). `has_discrepancy` dihitung di query (`quantity_received IS NOT NULL AND quantity_received != quantity_sent`), bukan kolom tersimpan.

---

## 3. Prinsip Integritas Stok

- `inventory_balances.quantity` selalu turunan dari `inventory_ledger` — satu fungsi DB (`apply_inventory_movement`) yang menulis ledger row DAN update balance row dalam satu transaksi. Tidak ada jalur lain untuk mengubah balance.
- Setiap deduksi stok (kirim transfer) mengecek balance saat ini dulu dengan row lock (`SELECT ... FOR UPDATE`) sebelum insert ledger — mencegah dua transfer simultan sama-sama lolos validasi dan membuat stok negatif.
- Stok tidak boleh negatif. Request yang akan membuatnya negatif ditolak dengan pesan jelas, bukan diproses lalu jadi minus.
- `purchase_price` di-strip dari response API untuk role selain `owner` di layer serialisasi backend — bukan hanya disembunyikan di komponen UI, supaya panggilan API langsung oleh `branch_admin` tetap tidak bisa membacanya.

---

## 4. Alur Utama

### 4.1 Barang masuk dari pabrik (warehouse receive)
Owner → Stok Pusat → "Terima Barang" → pilih produk + qty + catatan referensi bebas (no. invoice pabrik, dll) → submit.
→ `apply_inventory_movement(product, warehouse_location, +qty, 'WAREHOUSE_RECEIVE', ...)` → ledger row + balance bertambah.
Tidak ada approval — aksi owner otomatis sah.

### 4.2 Kirim ke cabang (create + send transfer)
Owner → Pengiriman → "Buat Transfer" → pilih cabang tujuan + daftar produk & qty → submit.
- Validasi: tiap baris qty ≤ balance pusat produk itu saat ini. Gagal → ditolak, tidak ada partial silent.
- Insert `stock_transfers` (status `SENT`) + `stock_transfer_items` (`quantity_sent` terisi, `quantity_received` NULL).
- `apply_inventory_movement` per item: `TRANSFER_OUT` di lokasi pusat, qty berkurang. Stok cabang **belum** bertambah — barang berstatus "dalam perjalanan".

### 4.3 Cabang konfirmasi terima
`branch_admin` cabang tujuan (atau owner) buka transfer pending → isi qty aktual diterima per item (default = `quantity_sent`, bisa diubah) → submit.
- Update `quantity_received` per item, `stock_transfers.status → RECEIVED`, `received_by`/`received_at` terisi.
- `apply_inventory_movement` per item: `TRANSFER_IN` di lokasi cabang untuk qty **yang benar-benar diterima** (bukan qty yang dikirim).
- Jika `quantity_received != quantity_sent` pada baris manapun, transfer otomatis tampil sebagai "ada selisih" di dashboard owner — dihitung dari data yang sudah ada, tidak perlu tabel terpisah.

### 4.4 Lihat stok
- Owner: ringkasan stok pusat + tiap cabang, flag produk di bawah `minimum_stock`/`reorder_point`.
- `branch_admin`: sama, di-scope ke cabangnya sendiri saja (server-side, lihat §5).

### 4.5 Koreksi manual (adjustment)
Tanpa jalur ini, kesalahan input (misalnya salah ketik qty saat "Terima Barang") tidak bisa dibetulkan tanpa edit database langsung — melanggar prinsip "tidak ada perubahan stok tanpa ledger". Owner → pilih produk + lokasi (pusat atau cabang manapun) + qty koreksi (boleh positif/negatif) + `reason` **wajib diisi** (bukan opsional seperti movement lain) → submit.
→ `apply_inventory_movement(product, location, delta, 'ADJUSTMENT', reason)` → ledger row + balance ter-update. Owner-only; `branch_admin` tidak punya akses ke aksi ini di spec ini (mencegah cabang diam-diam "membetulkan" selisih tanpa jejak yang owner sadari — selisih transfer sudah tertangani otomatis lewat §4.3, jadi adjustment manual hanya untuk kasus di luar itu).

---

## 5. Auth Pattern

Mengikuti pola yang sudah ada di `frontend/src/app/api/admin/crm/membership/_auth.ts` (bukan pola baru):
1. Ambil session Supabase via `supabase.auth.getUser()`.
2. Lookup `users` table untuk `role` + `branch`.
3. Fungsi `authorizeStockistAccess(user, profile, requiredAction)` (baru, mirror dari `authorizeMembershipAdmin`) memutuskan izin per aksi berdasarkan tabel role di §1.
4. Endpoint yang scoped-per-cabang (mis. lihat stok, konfirmasi terima) selalu filter query dengan `location.outlet_id` yang cocok dengan `profile.branch` untuk `branch_admin` — bukan mengandalkan client mengirim `location_id` yang benar.

RLS Supabase ditambahkan sebagai lapisan kedua (defense in depth) pada `inventory_balances`, `inventory_ledger`, `stock_transfers`, mengikuti pola `users_read_own_profile` yang sudah ada — tapi enforcement utama tetap di API layer seperti pola existing di codebase ini.

---

## 6. Frontend Routes & Backend Endpoints

### Routes (menyatu ke admin portal existing, bukan app terpisah)
```
/admin/stockist                    -- redirect: owner → ringkasan pusat, branch_admin → stok cabangnya
/admin/stockist/products           -- master data produk
/admin/stockist/warehouse          -- stok pusat + "Terima Barang" (owner only)
/admin/stockist/transfers          -- daftar transfer (scoped by role)
/admin/stockist/transfers/new      -- buat transfer (owner only)
/admin/stockist/transfers/[id]     -- detail + "Konfirmasi Terima"
/admin/stockist/branch-stock       -- stok cabang (branch_admin; owner lewat ?branch= seperti pola /admin existing)
```
Menu item baru di `AdminNav`, gated by role dengan pola yang sama seperti item nav lain yang sudah ada.

### Endpoints
```
GET/POST   /api/stockist/products
GET        /api/stockist/inventory/summary?location=warehouse|<branch-slug>
GET        /api/stockist/inventory/ledger?product_id=&location_id=
POST       /api/stockist/warehouse/receive
GET/POST   /api/stockist/transfers
PATCH      /api/stockist/transfers/:id/receive
POST       /api/stockist/inventory/adjustment
```

---

## 7. Testing Strategy

**Unit:**
- `apply_inventory_movement`: quantity_before/after benar, balance ter-update konsisten dengan ledger.
- Penolakan transfer saat qty > stok pusat saat ini.
- `ADJUSTMENT` ditolak jika `reason` kosong; `branch_admin` ditolak mengakses endpoint adjustment.
- `purchase_price` ter-strip dari response untuk role `branch_admin`.
- Flag selisih (`quantity_received != quantity_sent`) terhitung benar termasuk kasus `quantity_received = 0`.

**Integration:**
- Alur penuh: terima di pusat → buat transfer → kirim → cabang konfirmasi sebagian → verifikasi balance pusat, balance cabang, dan seluruh ledger rows saling rekonsiliasi (total masuk dari pabrik = total di semua lokasi + total masih "dalam perjalanan" pada transfer yang belum `RECEIVED`).
- Dua transfer simultan dari stok pusat yang sama tidak boleh membuat balance negatif (race condition test dengan row lock).

**Security:**
- `branch_admin` cabang A tidak bisa baca stok/transfer cabang B lewat pemanggilan API langsung (bukan cuma UI ter-hide).
- `branch_admin` tidak bisa membuat warehouse receipt atau transfer (endpoint menolak di server, bukan cuma tombol disembunyikan).
- `branch_admin` tidak bisa melihat `purchase_price` lewat endpoint manapun.

---

## 8. Definition of Done

- Produk retail (pomade, parfum, facewash, dst.) bisa didaftarkan dengan SKU unik.
- Owner bisa mencatat barang masuk dari pabrik ke stok pusat, dengan ledger.
- Owner bisa membuat & mengirim transfer ke salah satu dari 5 cabang.
- Branch admin cabang tujuan bisa konfirmasi qty yang diterima (boleh berbeda dari qty dikirim), dan stok cabangnya bertambah sesuai qty yang benar-benar diterima.
- Selisih kirim vs terima terlihat otomatis tanpa proses tambahan.
- Semua perubahan stok — masuk, kirim, terima — punya baris ledger dengan `performed_by` dan timestamp, tidak bisa dihapus lewat API biasa.
- Stok tidak pernah negatif.
- `branch_admin` hanya bisa melihat & mengoperasikan cabangnya sendiri; `purchase_price` hanya terlihat oleh `owner`.

## 9. Next Specs (setelah ini stabil)

1. Sinkronisasi penjualan MokaPOS → auto `SALE_MOKA` ledger, exception queue untuk SKU/outlet belum ter-mapping.
2. Stock opname (snapshot, hitung fisik, approval selisih, lock period).
3. Retur & barang rusak/hilang.
4. Notifikasi (stok rendah, transfer terkirim/diterima) dan laporan/forecast.
