# Stockist UI Redesign + Bottom Navbar — Design Spec

**Date:** 2026-08-20
**Status:** Draft for review
**Source brief:** `MASTER_PROMPT_REDBOX_STOCKIST_UI_NAVBAR.md`

## Goal

Redesain halaman "Stok Saya" milik Branch Admin dari katalog inventory menjadi operational
dashboard, dan ganti bottom navigation Stockist menjadi komponen reusable route-aware — tanpa
menghapus flow existing (Permintaan) dan tanpa membangun sistem/role/auth baru.

## Scope and constraints

- Tidak ada role, login, atau arsitektur admin portal baru.
- Owner tetap satu tujuan "Command Center" di nav (tidak dipaksa jadi 5 tab seperti Branch Admin).
- Semua perubahan quantity tetap lewat `apply_inventory_movement()` — spec ini tidak menyentuh
  contract movement, hanya menambah satu enum value baru (`CONSUMABLE`) dan membuka ledger
  read-only ke branch_admin dengan scope terbatas ke cabangnya sendiri.
- Tidak mengubah unrelated file/halaman (products, stock-opname, warehouse, dashboard owner) di
  luar yang disebutkan di sini.
- Preserve visual language existing: CSS custom properties (`--primary-container`, dst.),
  `MotionConfig reducedMotion="user"`, mobile-first max-width 430px shell.

## Existing foundation

- `frontend/src/app/admin/stockist/layout.tsx` — TopAppBar + bottom nav inline (Material
  Symbols), role-aware tabs, `usePathname()` untuk active state.
- `frontend/src/app/admin/stockist/page.tsx` — Beranda. Owner: `OwnerCommandCenter` (dashboard
  read-only, drill-down via `BottomSheet`). Branch Admin: `BranchAdminDashboard` (greeting, low
  stock card, stats grid, quick actions) — sudah dashboard-style, **tidak** direstruktur oleh spec
  ini.
- `frontend/src/app/admin/stockist/branch-stock/page.tsx` — halaman yang dilabeli "Stok Saya" di
  nav saat ini, tapi isinya catalog-first (search + 2 baris filter chip muncul duluan, list
  produk penuh) — ini target utama redesain.
- `frontend/src/components/stockist/*` — `BottomSheet`, `StatCard`, `ListRow`, `EmptyState`,
  `SkeletonCard`, `HorizontalBarChart`, `LocationCard`, `AnimatedNumber` — dipakai ulang, tidak
  dibuat ulang.
- `frontend/src/components/BottomNav.tsx` — komponen lucide-react + framer-motion generik yang
  sudah dipakai modul barber; jadi referensi pola animasi indikator aktif untuk `BottomNavBar`
  Stockist yang baru, bukan dipakai langsung (beda visual: top-line indicator vs. pill floating).
- `frontend/src/lib/stockistApi.ts` — client existing: `listProducts`, `getInventorySummary`,
  `getServiceUsage`, `getServiceUsagePicOptions`, `openServiceUsage`, `finishServiceUsage`,
  `listTransfers`. Semua dipakai ulang untuk data dashboard card, tidak ada endpoint agregat baru
  di sisi ini.
- `server/routes/stockist.js` — `GET /inventory/ledger` (baris ~294) saat ini menolak
  `branch_admin` tanpa syarat (`403`). `POST/PATCH /service-usage*` (baris ~314-450) sudah
  mengimplementasikan lifecycle `OPEN → IN_USE`, UI-nya memakai istilah "Buka Barang" yang
  bertentangan dengan istilah target ("Mulai Pakai").
- `server/services/stockistInventory.js` — `VALID_PRODUCT_TYPES = {RETAIL, SERVICE,
  SERVICE_CONSUMABLE, BOTH}`, `isServiceConsumable()`. Tidak ada tipe untuk perlengkapan
  (paper bag/cup/dll) hari ini — semua non-service default `RETAIL`.
- `server/services/stockistAccess.js` — `getVerifiedStockistAccess(req)` dan
  `resolveStockistLocationScope(access, type, branchSlug)`: pola existing untuk memaksa
  `branch_admin` hanya mengakses lokasinya sendiri. Ledger scoping baru mengikuti pola yang sama.

## Architecture

### 1. Product classification — tambah `CONSUMABLE`

- Migration baru (mengikuti pola `2026-08-19-stockist-service-consumables.sql`, **bukan**
  menimpa constraint dari plan lain yang membatasi ke `RETAIL`/`SERVICE` saja): tambahkan
  `'CONSUMABLE'` ke `products_product_type_check`.
- `VALID_PRODUCT_TYPES` di `stockistInventory.js` ditambah `CONSUMABLE`.
- `CONSUMABLE` diperlakukan sama seperti `RETAIL` untuk semua flow movement (bukan service-use);
  bedanya murni label/filter di UI ("Perlengkapan" vs "Retail").
- Produk existing tidak berubah default-nya; hanya opsi baru di form produk owner.

### 2. Ledger scoped ke cabang untuk Branch Admin

- `GET /api/stockist/inventory/ledger` di-extend, bukan diduplikasi:
  - `owner`: behavior tidak berubah (semua lokasi, semua produk).
  - `branch_admin`: diizinkan akses, tapi query dipaksa `location_id` = lokasi milik
    `access.branch` (resolusi branch→location_id memakai pola lookup yang sudah dipakai di route
    lain, mis. `/service-usage`). `branch_admin` tidak bisa mengirim `location_id`/`branch` lain
    untuk override scope-nya sendiri — permintaan semacam itu tetap discope paksa, tidak ditolak
    (konsisten dengan pola `resolveStockistLocationScope`).
- Tidak ada perubahan pada shape response (`{ ledger: [...] }`), supaya konsumen existing (kalau
  ada) tidak pecah.

### 3. `BottomNavBar` component

Target file: `frontend/src/components/ui/bottom-nav-bar.tsx`.

```tsx
type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type BottomNavBarProps = {
  items: BottomNavItem[];
  className?: string;
  stickyBottom?: boolean;
};
```

- `"use client"`, baca `usePathname()` internal untuk active state (refresh-safe, deep-link-safe,
  back/forward-safe) — bukan `useState(defaultIndex)`.
- Navigasi lewat `next/link` (`<Link href>`), bukan tombol yang hanya ubah state.
- Icon lucide-react: `Home` (Beranda), `Boxes` (Stok), `PackageCheck` (Barang Masuk),
  `ClipboardList` (Permintaan), `History` (Riwayat).
- Animasi indikator aktif pakai `framer-motion` `layoutId` + spring transition, pola sama dengan
  indikator di `BottomNav.tsx` existing.
- Warna dari CSS custom properties existing (`--primary-container`, `--surface-container-highest`,
  `--text-secondary`, `--border-base`, dst.) — bukan hex literal baru dari master prompt, supaya
  tetap satu sumber kebenaran tema dengan seluruh Stockist.
- Touch target minimum 44px, safe-area aware, tidak overflow di 320px.

`layout.tsx` diupdate untuk memakai komponen ini:

- Owner: tetap satu tab "Command Center" (perilaku tidak berubah, hanya migrasi ke komponen
  baru).
- Branch Admin — 5 tab:

  | Label | Icon | Route |
  | --- | --- | --- |
  | Beranda | `Home` | `/admin/stockist` |
  | Stok | `Boxes` | `/admin/stockist/branch-stock` |
  | Barang Masuk | `PackageCheck` | `/admin/stockist/transfers` |
  | Permintaan | `ClipboardList` | `/admin/stockist/requests` |
  | Riwayat | `History` | `/admin/stockist/ledger` |

  (Menyimpang dari 4-tab literal di master prompt secara sengaja — approved: mempertahankan flow
  Permintaan yang sudah operasional, sambil menambah Riwayat.)

### 4. "Stok Saya" → dashboard, "Semua Stok" → halaman terpisah

`branch-stock/page.tsx` dipecah jadi dua route:

**a. `/admin/stockist/branch-stock` (Stok Saya, dashboard)**

Header: nama halaman + nama cabang dari session (Branch Admin) atau branch-selector (Owner,
perilaku existing dipertahankan). Tidak ada search/filter di halaman ini.

Lima card, dihitung dari data yang sudah di-fetch (`listProducts`, `getInventorySummary`,
`getServiceUsage`, `listTransfers`) — tidak perlu endpoint agregat baru:

1. **Stok Habis** — count produk dengan qty 0. CTA "Lihat Produk" → Semua Stok terfilter `OUT`.
2. **Stok Menipis** — count qty > 0 dan <= minimum_stock, diurutkan paling kritis dulu. CTA
   "Lihat Produk" → Semua Stok terfilter `LOW`.
3. **Barang Masuk** — count transfer status `SENT` ke cabang ini. CTA "Periksa Barang" →
   `/admin/stockist/transfers` (existing receive flow, tidak dibuat ulang). Empty state kalau 0.
4. **Barang Pemakaian** — count service usage aktif (`IN_USE`) untuk produk
   `SERVICE`/`SERVICE_CONSUMABLE`/`BOTH` di cabang ini. CTA "Kelola Pemakaian" membuka
   `BottomSheet` (pola sama dengan drill-down di `OwnerCommandCenter`) berisi list produk
   pemakaian aktif — nama, qty tertutup, qty sedang digunakan, PIC — dengan aksi "Mulai Pakai"
   dan "Tandai Habis" langsung di situ, tanpa pindah halaman. Tidak menambah route baru.
5. **Semua Stok** — card netral, count total produk aktif di cabang. CTA "Lihat Semua" →
   `/admin/stockist/branch-stock/all`.

**b. `/admin/stockist/branch-stock/all` (Semua Stok)**

- Search bar + `BottomSheet` filter (dipindah dari halaman lama, komponen `BottomSheet` di-reuse):
  - Status Stok: Semua / Aman / Menipis / Habis.
  - Jenis Barang: Semua / Retail / Barang Pemakaian / Perlengkapan (`CONSUMABLE` dari unit 1).
- Product card ringkas (nama, SKU, qty, status) — metadata detail dan aksi Mulai Pakai/Tandai
  Habis pindah ke product detail / modal existing, tidak semua field tampil di list.
- Query param awal (mis. `?status=OUT`) didukung supaya CTA dari dashboard card bisa langsung
  membuka state terfilter yang relevan.

### 5. Riwayat (ledger) untuk Branch Admin

- Halaman baru `frontend/src/app/admin/stockist/ledger/page.tsx`.
- Memanggil endpoint yang di-extend di unit 2 (`GET /inventory/ledger`), otomatis scoped ke
  cabang milik user — tidak ada branch selector untuk Branch Admin.
- Filter dasar: rentang tanggal, movement type. List item: tanggal, produk, movement type
  (label Indonesia), delta quantity, referensi (transfer/opname/service usage bila ada).
- Loading/empty/error state mengikuti pola `SkeletonCard`/`EmptyState` existing.

### 6. Wording & interaction states

- "Buka Barang" → "**Mulai Pakai**" di semua tempat: tombol di card produk, tombol di modal,
  judul modal, dan confirmation copy — mengikuti field target di
  `branch-stock/page.tsx` (`handleOpenService`, modal `openProduct`).
- Confirmation copy disamakan dengan master prompt: "Mulai gunakan barang ini? 1 {unit} akan
  dipindahkan dari stok tertutup menjadi barang yang sedang digunakan." Tombol: "Batal" / "Ya,
  Mulai Pakai".
- "Tandai Habis" (nama sudah sesuai target, tidak berubah) tetap dipertahankan; confirmation copy
  disamakan dengan master prompt bila berbeda.
- Aksi mutasi yang belum eksplisit menangani failure (mis. gagal submit karena network/timeout)
  diberi state eksplisit: default/pressed/loading/success/error, dan **tidak menghapus data form
  yang sudah diisi user** saat gagal — pola sama dengan yang sudah dipakai di `actionBusy` +
  `setError` pada `branch-stock/page.tsx`, diperluas ke halaman baru.

## API design

Endpoint baru/extension:

```text
GET  /api/stockist/inventory/ledger      (extended: branch_admin diizinkan, auto-scoped)
```

Tidak ada endpoint POST/PATCH baru — semua mutasi di redesign ini memakai endpoint service-usage
dan transfer yang sudah ada.

Migration baru:

```text
ALTER TABLE products ... CHECK (product_type IN ('RETAIL','SERVICE','SERVICE_CONSUMABLE','BOTH','CONSUMABLE'))
```

## Data flow

```text
Dashboard "Stok Saya"
    ↓ (client-side aggregate, no new endpoint)
listProducts + getInventorySummary + getServiceUsage + listTransfers
    ↓
5 summary cards (Stok Habis / Menipis / Barang Masuk / Barang Pemakaian / Semua Stok)
    ↓ CTA
"Semua Stok" (search + BottomSheet filter, incl. CONSUMABLE) → product detail / existing modals
```

```text
Branch Admin → GET /inventory/ledger (scoped by access.branch)
    ↓
Halaman Riwayat (read-only, filter tanggal/movement type)
```

Tidak ada jalur baru yang menulis stok; semua mutasi tetap lewat endpoint existing
(`openServiceUsage`, `finishServiceUsage`, transfer receive, dst.).

## Error handling and security

- Scope lokasi ledger untuk `branch_admin` dihitung dari `getVerifiedStockistAccess(req)`, bukan
  dari query param — pola sama seperti route lain, mencegah branch admin membaca cabang lain
  lewat manipulasi request.
- `CONSUMABLE` tidak boleh lolos ke jalur service-use (`isServiceConsumable` tetap `false` untuk
  tipe ini) — mencegah produk perlengkapan salah masuk ke lifecycle pemakaian.
- Card "Barang Masuk"/"Barang Pemakaian" di dashboard read-only murni link-out; tidak ada mutasi
  dari card itu sendiri (konsisten dengan prinsip Command Center owner yang sudah ada).
- State loading/error pada Mulai Pakai/Tandai Habis mencegah duplicate submit (disable tombol
  saat `actionBusy`, pola existing dipertahankan).

## Testing strategy

### Backend

- `validateProductType` menerima `CONSUMABLE`; `isServiceConsumable('CONSUMABLE')` tetap `false`.
- `GET /inventory/ledger`: owner tidak berubah perilakunya (regression); branch_admin sekarang
  `200` dan hanya menerima baris dengan `location_id` miliknya sendiri, bukan `403`.
- branch_admin mengirim `location_id`/parameter lain untuk lokasi berbeda tetap discope paksa ke
  lokasinya sendiri (tidak bocor data cabang lain).

### Frontend

- `BottomNavBar`: active state benar untuk setiap route Branch Admin (5 tab) dan Owner (1 tab)
  termasuk saat refresh/deep link (test lewat pathname yang di-mock, atau manual QA karena
  `usePathname` browser-only).
- Dashboard "Stok Saya": lima card tampil dengan angka yang sesuai fixture data, CTA mengarah ke
  route/filter yang benar, empty state saat masing-masing kategori kosong.
- "Semua Stok": filter Jenis Barang menampilkan opsi Perlengkapan dan memfilter produk
  `CONSUMABLE` dengan benar.
- Wording "Mulai Pakai" muncul menggantikan "Buka Barang" di semua tempat yang relevan.
- Halaman Riwayat: render list dari ledger scoped, empty state saat kosong, tidak ada branch
  selector untuk branch_admin.

### Verification

- `npm test` (backend) untuk regression ledger/product_type.
- Frontend lint/typecheck/build yang tersedia di `frontend/package.json`.
- Manual QA: 320/360/390/430px, role owner vs branch_admin, refresh & deep link tiap tab nav,
  empty state tiap card, filter Perlengkapan, Riwayat branch-scoped.
- `git diff --stat` / `git status --short` untuk memastikan hanya file yang disebutkan di
  **File targets** yang berubah.

## Out of scope

- Redesain halaman Beranda (`page.tsx`) — sudah dashboard-style, tidak disentuh.
- Redesain Owner Command Center atau dashboard aset (sudah dicakup spec
  `2026-08-19-stockist-operations-extension-design.md`).
- Endpoint agregat baru untuk dashboard card (dihitung client-side dari data existing).
- Perubahan movement contract, RPC `apply_inventory_movement`, atau tabel `service_usage`.
- Marketplace, payment, role/login baru, atau restrukturisasi arsitektur admin portal.
- Penghapusan/reset file untracked existing di working tree.

## File targets

```text
server/migrations/2026-08-20-stockist-consumable-product-type.sql   (create)
server/services/stockistInventory.js                                (modify)
server/routes/stockist.js                                           (modify: ledger scope)
server/test/stockist-inventory-service.test.js                      (modify)
server/test/stockist-routes-ledger.test.js                          (create or modify)

frontend/src/components/ui/bottom-nav-bar.tsx                       (create)
frontend/src/app/admin/stockist/layout.tsx                          (modify)
frontend/src/app/admin/stockist/branch-stock/page.tsx               (modify: becomes dashboard)
frontend/src/app/admin/stockist/branch-stock/all/page.tsx           (create)
frontend/src/app/admin/stockist/ledger/page.tsx                     (create)
frontend/src/lib/stockistApi.ts                                     (modify: ledger client fn)
```

## Acceptance criteria

1. Branch Admin membuka `/admin/stockist/branch-stock` dan langsung melihat lima card ringkasan,
   bukan search bar + daftar produk penuh.
2. Setiap card CTA mengarah ke `Semua Stok` dengan filter yang sesuai, atau ke halaman existing
   yang relevan (transfer, service usage).
3. `Semua Stok` menampilkan search, filter status stok, dan filter jenis barang (Retail / Barang
   Pemakaian / Perlengkapan) lewat bottom sheet — bukan chip dua baris.
4. Bottom navbar Branch Admin menampilkan 5 tab (Beranda/Stok/Barang Masuk/Permintaan/Riwayat)
   memakai `BottomNavBar` reusable, route-aware lewat `usePathname`, benar saat refresh/deep
   link/back-forward.
5. Owner tetap satu tab Command Center, tidak berubah perilaku.
6. Halaman Riwayat menampilkan ledger yang otomatis discope ke cabang Branch Admin; tidak ada
   cara memilih cabang lain.
7. Tidak ada lagi teks "Buka Barang" di UI Stockist; diganti "Mulai Pakai" dengan confirmation
   copy sesuai target.
8. Produk `CONSUMABLE` bisa dibuat lewat form produk owner, muncul di filter "Perlengkapan", dan
   tidak bisa masuk ke flow service-use.
9. Tidak ada halaman/file di luar **File targets** yang berubah.
10. Test regression backend (`npm test`) dan frontend lint/typecheck/build lulus.
