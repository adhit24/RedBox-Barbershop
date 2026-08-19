# Stockist Premium UI/UX Redesign — Phase 1 & 2 (Design Tokens, Shared Components, Motion, Owner Dashboard) — Design Spec
**Date:** 2026-08-19
**Status:** Draft

## Overview

Sumber requirement: `RedBox_Stockist_Premium_UI_UX_Redesign.md` (51-section spec di root repo). Dokumen itu terlalu besar untuk satu implementation plan — mencakup design tokens, motion system, dan redesign 5+ halaman berbeda (Owner Dashboard, Branch Dashboard, Products, Warehouse, Transfer, Ledger, Service Consumables).

Spec ini men-scope **Phase 1 + Phase 2 saja**, sesuai urutan yang diusulkan dokumen sumber (section 47-48):
- **Phase 1** — Design tokens, shared component library, motion system.
- **Phase 2** — Owner Dashboard redesign, dipakai sebagai *benchmark* kualitas untuk fase berikutnya.

Fase 3-5 (Branch Dashboard, Service Consumables, Products/Warehouse/Transfer/Ledger, empty/loading/error states) sengaja ditunda ke spec terpisah setelah Phase 1+2 disetujui dan terbukti bagus — lihat [Out of Scope](#out-of-scope).

Redesign ini **murni frontend**. Tidak ada perubahan API contract, database schema, atau routing produksi (section 46 dokumen sumber). Semua data yang ditampilkan berasal dari endpoint yang sudah ada.

### Reframing dari dokumen sumber

Eksplorasi codebase sebelum brainstorming menemukan tiga hal yang membuat sebagian requirement literal di dokumen sumber tidak bisa dipenuhi apa adanya tanpa mengarang data:

1. **Owner Command Center saat ini sengaja "link-out only"** (commit `a9ddab1 feat(stockist): owner dashboard jadi Command Center tunggal`). Dokumen sumber section 15 minta KPI drill-down inline (modal/sheet). Keputusan: tambahkan drill-down via bottom sheet sebagai **tambahan**, bukan pengganti — link-out untuk aksi (transfer, dsb) tetap ada. Lihat §4.
2. **`getAssetDashboard()` tidak punya breakdown per-SKU per lokasi** — hanya agregat (`sku_count`, `total_quantity`, `total_asset_value`). Drill-down section 15 tetap bisa dibangun tanpa ubah backend: sheet lazy-fetch `listProducts()` + `getInventorySummary(locationId)`, endpoint yang sama yang sudah dipakai `BranchAdminDashboard`.
3. **Tidak ada data nilai per-produk lintas lokasi atau data historis.** Dokumen sumber section 17 minta 3 chart: "Nilai Stok per Lokasi" (buildable — data ada di `asset_by_location`), "Top Aset Produk by value" (**tidak buildable** — tidak ada field nilai per produk di API manapun), "Pergerakan Nilai Stok" (**tidak buildable** — tidak ada data historis, dan dokumen sumber sendiri bilang "jangan membuat chart dummy"). Keputusan: hanya Chart 1 yang dibangun di spec ini; Chart 2 & 3 dicatat sebagai follow-up backend, tidak dibuat dengan data palsu.
4. **Tidak ada baseline periode sebelumnya.** Section 13 mockup hero menunjukkan delta "↓4.2% dibanding periode sebelumnya" — tidak ada data pembanding. Hero akan menampilkan angka aset saat ini tanpa delta yang dikarang.

---

## Scope

### In Scope
- Design tokens: motion duration/easing, radius scale, keyframes (`globals.css`).
- Shared component set di `frontend/src/components/stockist/` — dibangun sesuai kebutuhan Owner Dashboard, bukan seluruh katalog 20 komponen section 38 secara spekulatif (YAGNI).
- Motion system pakai `framer-motion` (sudah jadi dependency, v12) — staggered entrance, card hover/press, animated number, sheet transition.
- Redesign `OwnerCommandCenter` (`frontend/src/app/admin/stockist/page.tsx`) memakai token & komponen baru.
- KPI drill-down via bottom sheet (lokasi → breakdown SKU, "Perlu Perhatian" → detail list, "Transfer Berjalan" → detail list).
- 1 chart baru: "Nilai Stok per Lokasi" (horizontal bar, custom SVG/CSS, tanpa dependency baru).
- Skeleton loading menggantikan spinner full-area yang ada sekarang.
- Responsive check di breakpoint 320/360/390/430/768/desktop.

### Out of Scope
Didaftarkan eksplisit supaya tidak diam-diam masuk scope creep. Masing-masing jadi spec sendiri setelah Phase 1+2 disetujui dan dipakai sebagai benchmark:
- **Branch Admin Dashboard redesign** (Phase 3, dokumen sumber section 19).
- **Service Consumable Management UI** (Phase 3, section 20-25) — juga sedang dikerjakan terpisah di plan `2026-08-19-stockist-operations-extension.md`.
- **Products / Warehouse / Transfer / Ledger page redesign** (Phase 4).
- **Empty / error / offline / permission states formal pass** (Phase 5) — Owner Dashboard di spec ini akan dapat skeleton & error state yang layak, tapi bukan audit menyeluruh semua halaman.
- **Chart "Top Aset Produk" (by value)** — butuh field nilai per-produk baru di `getAssetDashboard()` atau endpoint baru. Dicatat sebagai follow-up backend, bukan dibangun sekarang.
- **Chart "Pergerakan Nilai Stok" (historical trend)** — butuh snapshot historis nilai aset (mis. materialized daily). Dicatat sebagai follow-up backend.
- **Hero delta vs periode sebelumnya** — sama seperti di atas, butuh baseline historis.
- **Full 20-component catalog** dari section 38 (Modal, Tabs, FilterChip, SearchField, Toast, Tooltip, dst.) — hanya komponen yang benar-benar dipakai Owner Dashboard yang dibangun sekarang; sisanya dibangun saat halaman yang membutuhkannya di-redesign.

### Role & akses
Tidak berubah. Redesign ini murni presentasi di atas data yang sudah di-scope server-side (`getVerifiedStockistAccess`). Owner tetap lihat semua lokasi; branch_admin tidak tersentuh spec ini (dashboard branch_admin-nya tidak diubah).

---

## 1. Design Tokens (`frontend/src/app/globals.css`)

Palet warna sudah sangat dekat dengan target dokumen sumber (`--rb-red: #C72820`, background gelap, dst.) — **tidak ada repaint warna**. Yang benar-benar hilang:

```css
/* Motion */
--motion-micro: 150ms;      /* hover, press, focus */
--motion-card: 200ms;       /* card transition */
--motion-content: 260ms;    /* page/content entrance */
--motion-sheet: 250ms;      /* bottom sheet / modal */
--motion-ease: cubic-bezier(0.22, 1, 0.36, 1); /* subtle spring-like ease-out */
```

```css
@keyframes fade-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
```

Catatan: `animate-fade-in` sudah dipakai di `page.tsx` sekarang tapi **tidak pernah didefinisikan** di `globals.css` — class mati, tidak melakukan apa-apa. Token di atas menggantikannya dengan definisi nyata.

Radius sudah konsisten pakai Tailwind default (`rounded-lg`/`rounded-xl` ≈ 8-12px) di seluruh Stockist — tidak diformalkan jadi custom token baru di fase ini, cukup didokumentasikan sebagai konvensi: `rounded-lg` (10px-ish) untuk elemen kecil (badge, button), `rounded-xl` untuk card, `rounded-2xl` untuk bottom sheet.

---

## 2. Shared Components (`frontend/src/components/stockist/`)

Baru semua — Stockist saat ini tidak punya component library sendiri (setiap halaman hand-roll Tailwind inline). Dibangun sebagai bagian dari redesign Owner Dashboard, bukan pre-built terpisah:

| Komponen | Tanggung jawab | Menggantikan |
|---|---|---|
| `StatCard` | KPI card + animated count-up (framer-motion `animate()`), tabular nums | Grid `<div>` inline di §115-137 `page.tsx` |
| `LocationCard` | Row lokasi di "Aset per Lokasi", clickable → buka drill-down sheet | Blok `Link` di §157-171 |
| `AttentionRow` | Satu baris alert (dipakai di dashboard list & di dalam sheet) | `AttentionPanel` rows §266-288 |
| `BottomSheet` | Container drill-down: mobile full-width sheet dari bawah, desktop side panel/dialog. Fokus-trap dasar, close on backdrop/escape. | — (belum ada) |
| `SkeletonCard` | Skeleton berbentuk StatCard/LocationCard, dipakai saat loading | Spinner `<div className="animate-spin">` §94-97 |
| `HorizontalBarChart` | Bar chart custom SVG/CSS untuk "Nilai Stok per Lokasi" — tanpa dependency baru | — (belum ada) |
| `EmptyState` | Empty state generik (icon + title + subtitle) | Blok "Semua terkendali" inline §256-263 |

Semua komponen presentational — terima props, tidak fetch data sendiri (kecuali `BottomSheet`'s drill-down content variant yang lazy-fetch saat dibuka, lihat §4).

---

## 3. Motion System

`framer-motion` v12 sudah terpasang, tidak perlu dependency baru.

- **Staggered entrance**: `motion.section` dengan `variants` (parent stagger ~60ms) untuk urutan Header → Hero KPI → Secondary KPI → Chart → Aset per Lokasi → Perlu Perhatian, pakai token `--motion-content` (260ms) dan `fade-slide-in` shape (opacity 0→1, translateY 8px→0).
- **Card hover** (desktop, `whileHover`): `translateY(-2px)`, border sedikit lebih terang — `--motion-card` (200ms).
- **Card press** (mobile, `whileTap`): `scale(0.98)` — `--motion-micro` (150ms).
- **Animated number**: `useMotionValue` + `animate()` dari 0 (atau nilai sebelumnya) ke nilai baru saat data masuk, durasi ~600-800ms (lebih lama dari micro-interaction karena ini "data reveal", bukan feedback aksi — tetap di bawah batas 500ms per-tick tidak relevan karena ini count-up kontinu, bukan interaksi diskrit).
- **Bottom sheet**: slide-up + backdrop fade, `--motion-sheet` (250ms), `AnimatePresence` untuk exit animation.

Semua animasi pakai `transform`/`opacity` saja (section 43 dokumen sumber) — tidak animate `width`/`height`/`top`/`left`.

---

## 4. Owner Dashboard Redesign

File: `frontend/src/app/admin/stockist/page.tsx` (fungsi `OwnerCommandCenter`, `AssetDashboardPanel`, dan helper terkait).

**Hero**: Greeting + label "Aset Stok RedBox" + `total_asset_value` sebagai angka besar animated (StatCard varian hero, lebih besar dari KPI card biasa). Tanpa delta periode sebelumnya (lihat reframing #4).

**Primary KPI row** (`StatCard` × 3): Total Nilai Aset, Nilai Gudang Pusat, Nilai Stok Cabang — data sama seperti sekarang (`total_asset_value`, `warehouse_asset_value`, `branch_asset_value`), styling baru.

**Secondary KPI** (`StatCard` × 2, tetap actionable): Barang Perlu Perhatian (`attention_items.length`), Transfer Berjalan (`active_transfers.length`) — klik membuka **drill-down sheet** (bukan langsung navigasi); sheet punya tombol "Lihat semua di [halaman]" untuk link-out ke aksi penuh.

**Chart 1 — Nilai Stok per Lokasi**: `HorizontalBarChart` dari `asset_by_location`, diurutkan value descending.

**Aset per Lokasi** (`LocationCard` list): sama seperti `AssetDashboardPanel` sekarang, tapi setiap card clickable → buka `BottomSheet` drill-down. Sheet content: lazy-fetch `listProducts()` + `getInventorySummary(location_id)` saat sheet dibuka pertama kali (cached di state, tidak re-fetch tiap buka), render top SKU by quantity (sesuai contoh section 15 dokumen sumber: "Pomade Classic 420 pcs"), plus link "Lihat semua stok di [lokasi]" → `/admin/stockist/branch-stock?location=...`.

**Perlu Perhatian** (`AttentionRow` list): tetap tampil di dashboard (bukan hanya di dalam sheet) — dokumen sumber section 18 eksplisit minta ini selalu visible, bukan disembunyikan di belakang klik.

**Loading**: `SkeletonCard` menggantikan spinner, bentuk mengikuti layout final (hero + KPI grid + location list).

**Error**: pesan tetap human-readable ("Data belum berhasil dimuat...") — sudah cukup baik di kode sekarang, dipertahankan.

---

## 5. Regression Risks

- `OwnerCommandCenter` adalah halaman yang paling sering diubah baru-baru ini (5 commit dalam seminggu terakhir menyentuh area ini). Perlu baca commit terbaru sebelum mulai implementasi untuk memastikan tidak ada in-flight change yang belum ter-capture eksplorasi ini.
- `BranchAdminDashboard` di file yang sama **tidak disentuh** — pastikan refactor tidak memecah shared helper (`getGreeting`, `BRANCH_NAMES`, `formatAssetValue`) yang dipakai kedua komponen.
- `listProducts()` + `getInventorySummary()` dipanggil dari drill-down sheet — pastikan tidak memicu N+1 request kalau owner buka banyak lokasi berturut-turut (cache per-lokasi di state komponen).
- Role gate (`layout.tsx` redirect kalau bukan `owner`/`branch_admin`) tidak disentuh.

---

## 6. Testing Plan

- Manual QA di breakpoint 320/360/390/430/768/desktop (section 50 dokumen sumber).
- Verifikasi: loading skeleton, error state, empty state ("Perlu Perhatian" kosong), drill-down sheet buka/tutup (klik backdrop, Escape), animated number tidak infinite-loop re-render, hover/press states desktop & mobile.
- Tidak ada perubahan ke backend/test suite Express (`server/test/stockist-*.test.js`) — di luar scope.

---

## Future Work (dicatat, bukan dibangun sekarang)

- Backend: tambah field nilai per-produk agregat di `getAssetDashboard()` (atau endpoint baru) untuk Chart 2 "Top Aset Produk by value".
- Backend: snapshot historis nilai aset (job harian?) untuk Chart 3 "Pergerakan Nilai Stok" dan hero delta.
- Phase 3: Branch Dashboard + Service Consumable UI (koordinasi dengan plan `2026-08-19-stockist-operations-extension.md`).
- Phase 4: Products / Warehouse / Transfer / Ledger redesign.
- Phase 5: Formal empty/loading/error/offline/permission state audit lintas semua halaman Stockist.
