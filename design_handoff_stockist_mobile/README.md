# Handoff: RedBox Stockist — Mobile App

## Overview

Aplikasi mobile untuk operasional stok RedBox Barbershop Indonesia: satu gudang pusat dan lima cabang (Bypass, Samadikun, CSB Mall, Sumber, Tegal). Aplikasi menutup siklus stok end-to-end — barang masuk ke gudang, dikirim ke cabang, dikonfirmasi fisik oleh cabang, selisih dilaporkan, dan seluruh pergerakan tercatat di inventory ledger.

Tiga peran, dengan hak akses berbeda:

| Peran | Hak akses |
|---|---|
| **Owner** | Semua lokasi, harga beli, edit produk, buat transfer, terima barang, nonaktifkan produk, setujui adjustment |
| **Manager** | Sama seperti Owner **minus** nonaktifkan produk. Tambahan: mengonfirmasi penerimaan kiriman |
| **Admin Cabang** | Hanya cabangnya. Terima kiriman + konfirmasi selisih, stock opname, minta stok, catat retur & pemakaian. Harga beli disembunyikan |

## About the Design Files

File di dalam `prototype/` adalah **referensi desain yang dibuat dalam HTML** — prototipe yang menunjukkan tampilan dan perilaku yang diinginkan, **bukan production code untuk disalin langsung**. `RedBox Stockist.dc.html` memakai runtime prototyping internal (`support.js`, tag `<x-dc>`, `<sc-for>`, `<sc-if>`) yang tidak ada di codebase Anda; jangan mencoba mengintegrasikan runtime itu.

Tugas implementasi: **membangun ulang desain ini di codebase yang sudah ada** — repo `Website RedBox` (Next.js App Router + Tailwind CSS 4 + TypeScript, Capacitor untuk build Android) — dengan pola dan library yang sudah dipakai di sana. Rute stockist yang sudah ada berada di `frontend/src/app/admin/stockist/`, dengan komponen di `frontend/src/components/stockist/`. Ikuti konvensi file, data-fetching, dan auth yang sudah berjalan di repo, bukan struktur file prototipe.

Cara membaca prototipe: buka `prototype/RedBox Stockist.dc.html` di browser. Semua layar bisa diklik. Tombol **Ganti peran** di atas frame memutar Owner → Manager → Admin Cabang; tombol **Mode gelap** membalik tema; deret pintasan di bawah frame melompat langsung ke layar mana pun.

## Fidelity

**High-fidelity.** Warna, tipografi, spacing, radius, dan interaksi sudah final. Recreate pixel-perfect memakai library dan pola yang ada di codebase. Semua nilai eksak ada di bagian **Design Tokens** di bawah — ambil dari situ, jangan mengukur dari screenshot.

Catatan penting: prototipe ini **light theme sebagai default dengan dark mode sebagai opsi**, sedangkan aplikasi live saat ini dark-only (`--background: #151313` di `frontend/src/app/globals.css`). Kedua palet lengkap disediakan di bawah. Implementasikan sebagai theme switch, bukan mengganti salah satu.

---

## Design Tokens

### Warna — light theme (default)

| Token | Hex | Pemakaian |
|---|---|---|
| `bg` | `#F7F7F5` | Latar layar |
| `surface` | `#FFFFFF` | Card, input, bottom nav |
| `surface-2` | `#F1F1EF` | Track progress bar, isi card bersarang, hover row |
| `border` | `#E4E0DE` | Semua border 1px |
| `text-1` | `#1F1A1A` | Judul, angka |
| `text-2` | `#6F6666` | Body, label |
| `text-3` | `#9D9494` | Metadata, caption, ikon nonaktif |
| `red` | `#C72820` | Aksen utama: CTA, tab aktif, badge |
| `red-hover` | `#E33A32` | Hover CTA merah |
| `red-soft` | `#F26A61` | Border hover card |
| `tint-red` | `#FDECEC` | Latar badge / card merah lembut |
| `ok` | `#36B56B` | Status aman, delta positif |
| `warn` | `#E3A43B` | Status menipis, selisih |
| `info` | `#5FA8D3` | Info netral |
| `tint-blue` | `#EAF6FD` | Latar card info |
| `tint-green` | `#EAF8F0` | Latar card sukses |
| `tint-yellow` | `#FFF7E8` | Latar card peringatan |
| `img-bg` | `#F5F4F2` | Placeholder foto produk saat loading |

### Warna — dark theme

| Token | Hex |
|---|---|
| `bg` | `#151313` |
| `surface` | `#1E1A1B` |
| `surface-2` | `#241F20` |
| `border` | `#302728` |
| `text-1` | `#F5EEEE` |
| `text-2` | `#B8AAAC` |
| `text-3` | `#786D6F` |
| `red` | `#E33A32` (dinaikkan agar kontras cukup di latar gelap) |
| `red-soft` | `#F26A61` |
| `tint-red` | `#2A1A19` |
| `tint-blue` | `#161F26` |
| `tint-green` | `#152420` |
| `tint-yellow` | `#251F14` |
| `info` | `#8A9BA8` |
| `img-bg` | `#241F20` |

`ok` dan `warn` tidak berubah antar tema.

### Tipografi

Satu family: **Plus Jakarta Sans** (Google Fonts, weight 400/500/600/700/800). Tidak ada font kedua.

| Peran | Size / weight / line-height | Contoh |
|---|---|---|
| Angka hero | 32px / 800 / 1.0 | "Rp 412.850.000" |
| Judul layar | 19px / 700 / 1.2 | "Konfirmasi Penerimaan" |
| Angka metrik besar | 21–26px / 800 / 1.0 | Angka kartu metrik, stepper |
| Angka kartu produk | 17–19px / 800 / 1.0 | Qty di kanan product card |
| Judul card | 14–16px / 700 / 1.25 | Nama produk di detail |
| Nama produk di list | 13–13.5px / 700 / 1.25 | |
| Body / label | 12px / 500–600 / 1.4 | Label field, key baris data |
| Metadata | 10–11px / 500 / 1.3 | SKU, tanggal, "23 Agu 2026 · 10:24 WIB" |
| Badge status | 9–9.5px / 700 / uppercase / letter-spacing .05em | "MENIPIS", "ADA SELISIH" |
| Label bottom nav | 10px / 700 | |
| Overline | 11px / 600 / uppercase / letter-spacing .08em–.09em | "ASET STOK REDBOX" |

Semua angka (qty, Rupiah, tanggal, nomor dokumen) memakai `font-variant-numeric: tabular-nums` supaya kolom angka tidak bergeser.

### Spacing

Skala: **2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22**. Padding horizontal konten layar `16px`. Jarak antar blok di beranda `20px`. Jarak antar card dalam satu list `10px`. Padding dalam card `12–18px` (12 untuk row list, 14 untuk card sedang, 16–18 untuk panel).

### Border radius

| Nilai | Pemakaian |
|---|---|
| `11–13px` | Tombol stepper kecil, ikon kotak, chip di dalam card |
| `12px` | Ikon header, tombol sekunder kecil |
| `14px` | Input, tombol aksi cepat, CTA utama |
| `16px` | Card metrik, notifikasi, ledger row |
| `18px` | Panel, card produk di list, card transfer |
| `20px` | Hero card aset, card detail produk |
| `999px` | Chip filter, badge status, avatar dot |
| `38px` | Frame device (khusus prototipe, tidak perlu diimplementasi) |

### Shadow

- `shadow` (card): `0 2px 14px rgba(31,26,26,.06)` — light; `0 2px 14px rgba(0,0,0,.4)` — dark
- `shadow-2` (toast, elevated): `0 8px 26px rgba(31,26,26,.12)` — light; `0 8px 26px rgba(0,0,0,.55)` — dark
- Hero merah: `0 10px 26px rgba(199,40,32,.22)`
- Logo login: `0 10px 24px rgba(23,21,20,.28)`

### Ikon

**Material Symbols Outlined** (sudah dipakai di codebase live). Ukuran: 15px (status bar), 18–20px (inline & header), 21–23px (bottom nav), 30–52px (empty state & scanner). State aktif di bottom nav memakai `font-variation-settings: 'FILL' 1`.

### Motion

- `rbup`: `opacity 0 → 1` + `translateY(8px → 0)`, durasi 240–300ms ease-out. Dipakai saat masuk layar baru.
- `rbshim`: shimmer skeleton, `background-position -200% → 200%`, 1.6s infinite linear, gradient `surface-2 25% → border 50% → surface-2 75%` dengan `background-size: 200% 100%`.
- Toast masuk dengan `rbup` 220ms, hilang otomatis setelah **2200ms**.
- Tidak ada transisi halaman, scale, atau bounce.

### Hit target

Semua elemen interaktif minimum **44px**. Tombol stepper 40–46px. CTA utama 52px. Baris bottom nav 52px dengan padding bawah 22px untuk home indicator.

---

## Screens / Views

19 layar unik, 24 tampilan bila varian dihitung.

### 1. Login

**Purpose** — masuk dan memilih peran.

**Layout** — kolom tunggal, padding atas 40px, gap 28px. Blok logo terpusat (logo 92px, radius 26px, latar `#171514`, padding 8px, isi `logo_transparant.png` object-fit contain), judul 24px/800 "RedBox Stockist", subteks dua baris "Operasional stok gudang & cabang / RedBox Barbershop Indonesia".

**Components** — dua field display-only (Email `owner@redbox.id`, Password `••••••••` letter-spacing .18em, tinggi 50px, radius 14px, ikon `mail`/`lock` di kiri, `visibility` di kanan). Lalu overline "MASUK SEBAGAI" dan tiga tombol peran bertumpuk gap 10px, radius 16px, padding 14px, layout `[ikon 22px] [judul 14/700 + subteks 11/500] [arrow_forward]`:

- **Owner** — solid `red`, teks putih, ikon `admin_panel_settings`, subteks "Semua cabang, gudang pusat, ledger"
- **Manager** — outline, ikon `manage_accounts` warna red, subteks "Baca, edit, buat & konfirmasi kiriman"
- **Admin Cabang** — outline, ikon `storefront` warna red, subteks "Cabang Bypass · stok & penerimaan"

Footer 11px `text-3`: "Akses ditentukan peran akun. Admin cabang hanya melihat data cabangnya."

Header dan bottom nav **disembunyikan** di layar ini.

### 2. Beranda — Owner & Manager

**Purpose** — ringkasan nilai aset dan titik masuk ke semua aksi.

**Layout** — kolom, gap 20px.

**Components, urut dari atas:**

1. *(Manager saja)* Banner konfirmasi — latar `tint-yellow`, border `warn`, radius 16px, padding 13px, ikon `pending_actions`, teks "1 kiriman menunggu konfirmasi Anda" + "TRF-20260823-001 · Cabang Bypass · 40 pcs", chevron kanan. Klik → Detail Transfer.
2. Hero aset — latar `red`, radius 20px, padding 18px. Overline "ASET STOK REDBOX" + pill `+4,2%` (latar `#ffffff26`, ikon `trending_up`). Angka 32px/800 "Rp 412.850.000". Tiga mini-stat sejajar (latar `#ffffff1f`, radius 12px): 6 Lokasi / 7 SKU aktif / 1.284 Unit.
3. Grid metrik 2×2, gap 10px, radius 16px, padding 14px, masing-masing `[ikon 20px] [angka 22/800] [label 11/600]`:
   - Total Produk `7` — `tint-blue`, ikon `category`, → Produk
   - Total Stok `1.284` — `tint-green`, ikon `inventory_2`, → Gudang Pusat
   - Produk Menipis `2` — `tint-yellow`, ikon `warning`, → Gudang Pusat dengan filter "Menipis" ter-preset
   - Transfer Berjalan `2` — `tint-red`, ikon `local_shipping`, → Transfer
4. "Aksi cepat" — grid 2×2 tombol outline tinggi 48px: Terima Barang (`move_to_inbox`), Buat Transfer (`send`), Lihat Ledger (`receipt_long`), Stok Cabang (`storefront`). Hover: border dan teks jadi `red`.
5. "Perlu perhatian" + link "Lihat semua" — list produk dengan `wh <= min`. Row: foto 56px radius 12px, nama, `SKU · lokasi`, badge status, qty besar berwarna status + unit.
6. "Aset per lokasi" — panel dengan 6 baris: nama lokasi + nilai Rupiah, di bawahnya bar 7px radius 999px pada track `surface-2`. Lebar dan warna bar: Gudang Pusat 100% `red`, Bypass 62% `red-soft`, CSB Mall 48% `info`, Samadikun 35% `warn`, Sumber 21% `ok`, Tegal 12% `text-3`.

### 3. Beranda — Admin Cabang

**Purpose** — kerja harian cabang: konfirmasi kiriman, pantau stok menipis.

**Components:**

1. Kartu kiriman (tombol penuh) — latar `red`, radius 20px, padding 16px. Baris atas: ikon `local_shipping`, "1 kiriman menunggu konfirmasi", `arrow_forward`. Di dalamnya panel `#ffffff1f` radius 14px: nomor `TRF-20260823-001` + pill "Dikirim", "Gudang Pusat → Cabang Bypass · 3 item · 40 pcs", "Dikirim 23 Agu 2026 · 10:24 WIB". Klik → Detail Transfer.
2. Dua kartu metrik sejajar: Stok cabang (unit) `218` — `tint-green`; Perlu restock `4` — `tint-yellow`.
3. "Aksi cepat" grid 2×2: Konfirmasi Kiriman (`task_alt`), Lihat Stok (`boxes`), Stock Opname (`checklist`), Minta Stok (`add_shopping_cart`).
4. "Stok menipis di cabang" — list produk dengan `br <= min`, format row sama seperti Perlu perhatian tetapi metadata "SKU · min N pcs".
5. Kartu Stok pemakaian — outline, ikon `timelapse`, "3 produk sedang dipakai · 1 perlu dicek" warna `warn`.

### 4. Stok (hub)

**Purpose** — daftar pintu masuk untuk Owner & Manager.

**Layout** — list vertikal gap 10px. Row: kotak ikon 42px radius 13px berlatar tint, judul 14/700, deskripsi 11/500, chevron.

| Item | Ikon | Tint | Deskripsi |
|---|---|---|---|
| Produk | `category` | blue | Master produk, harga, stok minimum |
| Gudang Pusat | `warehouse` | green | Stok pusat & penerimaan barang |
| Stok Cabang | `storefront` | yellow | 5 cabang · sebaran per produk |
| Inventory Ledger | `receipt_long` | red | Semua pergerakan stok |
| Permintaan Stok | `add_shopping_cart` | blue | Pengajuan dari cabang |
| Retur Barang | `keyboard_return` | yellow | Pengembalian & barang rusak |
| Insight | `lightbulb` | green | Sinyal distribusi & restock |

### 5–7. Produk / Gudang Pusat / Stok Cabang

Satu komponen list dengan tiga mode. Mode `warehouse` menampilkan qty gudang; mode `branch` menampilkan qty cabang dan mengganti label lokasi jadi "Cabang Bypass".

**Layout** — search bar (tinggi 46px, radius 14px, ikon `search` kiri, ikon `qr_code_scanner` warna red kanan → Scanner) → baris chip filter horizontal-scroll (`Semua`, `Aman`, `Menipis`, `Habis`; chip aktif solid `red` teks putih, nonaktif outline) → baris meta "N produk · Gudang Pusat" dan "Urut: nama" → list produk.

**Product card** — radius 18px, padding 12px, shadow card, hover border `red-soft`. Isi: foto 66px radius 14px dengan dot status 12px (border 2.5px warna `surface`) di sudut kiri bawah; nama 13.5/700; SKU 10/500; dua badge (kategori pada `surface-2`, status pada tint); qty 19px/800 berwarna status + unit uppercase + chevron.

**Aturan status** — `qty === 0` → **Habis** (red / tint-red); `qty <= min` → **Menipis** (warn / tint-yellow); selain itu → **Aman** (ok / tint-green).

**Search** — filter case-insensitive pada nama **dan** SKU. **Empty state** — card border dashed, ikon `inventory_2` 34px, "Tidak ada produk", body, tombol "Reset filter" yang mengosongkan chip dan query.

### 8. Detail Produk

1. Card identitas — foto 104px radius 16px + nama 16/700, SKU, badge status, harga jual 15/700.
2. Tiga stat sejajar: Gudang / Cabang / Stok min.
3. Panel "Distribusi stok" — 6 baris (Gudang Pusat + 5 cabang), tiap baris radius 12px berlatar tint sesuai statusnya, qty berwarna status.
4. Panel "Data master" — key–value dengan pembatas 1px: Kategori, Satuan, Harga jual, Harga beli, Stok minimum, Reorder point (`min + 4`), Status. **Harga beli hanya untuk Owner & Manager**; Admin Cabang melihat "Khusus pusat".
5. Aksi — Owner & Manager: "Edit Produk" (outline) dan "Terima Barang" (solid red). "Nonaktifkan Produk" (outline red) **hanya Owner**.

### 9. Terima Barang

**Purpose** — mencatat barang masuk ke gudang pusat.

1. Pemilih produk — carousel horizontal, tile 112px, foto 70px, nama 11/700 (tinggi tetap 29px, overflow hidden), SKU. Tile terpilih: border 1.5px `red`, latar `tint-red`.
2. Stepper qty — panel radius 16px; tombol `−` 46px outline, angka 26px/800 di tengah, tombol `+` 46px solid red. Nilai awal 24, tidak bisa di bawah 0.
3. Field catatan / nomor invoice — placeholder `INV/2026/08/1183`.
4. Panel pratinjau (`tint-green`) — Stok saat ini, Quantity diterima (`+N`, warna ok), pembatas, "Stok setelah diterima" dengan angka 20px/800. **Semua dihitung real-time.**
5. CTA "Terima Barang" 52px solid red + "Batal" outline.

### 10. Transfer

Judul berubah per peran: "Transfer" (Owner/Manager) vs "Barang Masuk" (Cabang).

Chip filter: `Semua`, `Draft`, `Dikirim`, `Diterima`, `Ada Selisih`. Admin Cabang hanya melihat transfer yang tujuannya cabangnya.

**Transfer card** — radius 18px padding 14px. Baris 1: nomor 13/700 + badge status. Baris 2: `asal → tujuan` dengan ikon `arrow_forward` merah di tengah. Baris 3: `tanggal · N item · N pcs` + chevron.

**Warna status** — Diterima → ok/tint-green; Ada Selisih → red/tint-red; Dikirim → warn/tint-yellow; Draft → info/tint-blue.

CTA "Buat Transfer Baru" muncul untuk Owner & Manager.

### 11. Buat Transfer

1. Step indicator — tiga kolom, bar 4px + label 10/600. Step selesai `red`, belum `border`/`text-3`.
2. "Cabang tujuan" — chip pill tinggi 38px untuk 5 cabang, single-select.
3. "Produk dikirim" + counter "N item · N pcs". Row keranjang: foto 56px, nama, "Gudang: N pcs", stepper `− qty +` (tombol 34px). **Qty dibatasi stok gudang produk itu**; minimum 0.
4. Tombol "Tambah Produk" — border dashed.
5. Panel "Review transfer" — Asal (Gudang Pusat), Tujuan, Total unit, Nilai perkiraan (`Σ qty × harga beli`, format Rupiah id-ID).
6. CTA "Kirim Transfer" + "Simpan Draft".

### 12. Detail Transfer

1. Card ringkasan — nomor 15/700 + badge status; panel asal→tujuan (latar `surface-2`, radius 14px, tujuan rata kanan); baris Dikirim (`tanggal · waktu`) dan Pengirim.
2. "Rincian produk" — per produk: foto 52px + nama + SKU, lalu grid tiga stat (Dikirim / Diterima / Selisih), masing-masing radius 11px. Sel Selisih berwarna red bila tidak nol. Saat status masih "Dikirim", Diterima dan Selisih menampilkan `—`.
3. Panel "Timeline" — titik 11px + garis penghubung 1.5px `border`, judul 12/700 + meta 10.5/500. Tiga event: dibuat (dot ok), dikirim (dot red), menunggu konfirmasi (dot border).
4. CTA "Konfirmasi Penerimaan" — **hanya muncul untuk Manager & Admin Cabang, dan hanya saat status = Dikirim.**

### 13. Konfirmasi Penerimaan

**Purpose** — hitung fisik, catat selisih, lapor alasan.

1. Banner info (`tint-blue`, ikon `info`): "Hitung fisik barang dulu, lalu isi quantity yang benar-benar diterima. Selisih wajib diberi alasan."
2. Row per produk — border 1.5px. Saat qty diterima = qty dikirim: latar `surface`, border `border`, badge "SESUAI" (ok). Saat berbeda: latar `tint-yellow`, border `warn`, badge "SELISIH" (warn).
   Isi row: foto 54px + nama + "Dikirim N pcs" + badge; lalu label "Diterima fisik" dengan stepper (tombol 40px, angka 19/800).
3. **Blok alasan muncul otomatis** saat ada selisih — panel `tint-yellow` border `warn`: "Selisih N pcs · wajib beri alasan", tiga chip pilihan (Kurang kirim / Rusak di jalan / Salah hitung, single-select per produk), dan tombol dashed "Unggah foto bukti" (ikon `photo_camera`).
4. Panel ringkasan — Total dikirim, Total diterima, pembatas, Selisih 20px/800 (ok bila 0, warn bila tidak).
5. CTA "Konfirmasi Penerimaan" + "Simpan Draft".

Data awal prototipe: dikirim `{p1:20, p4:12, p6:8}`, diterima `{p1:20, p4:10, p6:8}` — jadi satu produk sengaja berselisih `−2` untuk mendemokan blok alasan.

### 14. Inventory Ledger

Chip filter jenis: `Semua`, `Penerimaan Gudang`, `Transfer Keluar`, `Transfer Masuk`, `Adjustment`.

Row radius 16px padding 13px: kotak ikon 38px berlatar tint (`south_west` untuk masuk, `north_east` untuk keluar, `tune` untuk adjustment); nama produk 12.5/700; `jenis · lokasi`; `tanggal · operator · referensi`; di kanan delta 15px/800 (`+N` hijau / `−N` merah) dan `before → after` 10px.

### 15. Stock Opname

1. Card progress — "Opname 23 Agu 2026" + "N/7 produk", bar 8px, catatan "Draft tersimpan otomatis. Anda bisa lanjut nanti."
2. Tombol "Scan barcode produk" (ikon `qr_code_scanner`) → Scanner.
3. Row per produk — border 1.5px, foto 50px, nama, "Sistem N pcs", badge hasil: "COCOK" (ok) / "LEBIH N" / "KURANG N" (warn). Di bawahnya label "Stok fisik" + stepper 40px.
4. CTA "Kirim Hasil Opname" + "Simpan Draft".

### 16–19. Permintaan Stok / Retur / Stok Pemakaian / Insight

Satu komponen dokumen dengan empat dataset. Row radius 18px padding 14px: judul/nomor 12.5/700 + badge status di kanan, baris detail 11.5/500, baris meta 10.5/500. CTA bawah berubah per jenis: "Ajukan Permintaan" / "Buat Retur" / "Catat Pemakaian" / "Ekspor Insight".

Pemetaan warna badge: `ok` → hijau, `warn` → kuning, `bad` → merah, `info` → biru.

### 20. Notifikasi

Chip kategori: `Semua`, `Stok`, `Transfer`, `Pengiriman`, `Sistem`, `Pengumuman`. Row radius 16px: kotak ikon 36px berlatar tint per kategori (Stok → warn, Transfer → red, Pengiriman → ok, lainnya → info), judul + body + waktu, dan **dot merah 8px bila belum dibaca**. Item terbaca memakai latar `surface-2` dan border sewarna latar (efektif tanpa border).

### 21. Profil

1. Card identitas — avatar kotak 58px radius 18px berlatar `tint-red` dengan inisial 20/800 warna red, nama 15/700, email, badge peran.
   Owner: `AW` / Ardi Wijaya / owner@redbox.id. Manager: `SN` / Sinta Nurhaliza / manager@redbox.id. Cabang: `AP` / Andi Prakoso / bypass@redbox.id.
2. List pengaturan — panel radius 18px overflow hidden, setiap row punya ikon, label, value, chevron, pembatas 1px, hover `surface-2`: Organisasi/Cabang, **Hak akses** (isinya berbeda per peran), Status akun, Ganti password, Bantuan, States & komponen.
3. Tombol "Keluar" — outline `red-soft`, teks red, hover latar `tint-red`.
4. Versi: "RedBox Stockist v2.0 · Build 2026.08.23".

### 22. Scan Barcode

Viewport 320px radius 20px latar gelap `#17141480`, di tengahnya kotak 210px radius 22px border dashed 2px `#ffffff66` dengan ikon `qr_code_2` 52px. Caption bawah "Arahkan kamera ke barcode produk". Di bawah viewport: card hint "Barcode tidak terbaca? Masukkan SKU manual lewat pencarian." dan tombol "Tutup Scanner". **Bottom nav disembunyikan** di layar ini.

### 23. Layar Sukses (4 varian)

Header dan bottom nav disembunyikan. Layout terpusat, padding atas 56px: cakram 88px radius penuh `tint-green` border `ok` dengan ikon `check_circle` 44px; judul 20/800; body 13/500 max-width 280px; panel key–value; CTA "Kembali ke Beranda" (solid red) + "Lihat di Ledger" (outline).

| Dipicu oleh | Judul | Baris ringkasan |
|---|---|---|
| Terima Barang | Barang berhasil diterima | Produk, Quantity, Stok akhir, Referensi |
| Kirim Transfer | Transfer terkirim | Nomor, Tujuan, Total unit, Status |
| Konfirmasi (selisih 0) | Penerimaan dikonfirmasi | Transfer, Dikirim, Diterima, Selisih |
| Konfirmasi (ada selisih) | Diterima dengan selisih | idem, Selisih = "N pcs" |
| Kirim Opname | Opname terkirim | Cabang, Produk dihitung, Produk berselisih |

### 24. States

Halaman referensi berisi semua state pinggiran, semuanya perlu diimplementasi di layar yang relevan:

- **Offline** — `tint-yellow` / border warn / ikon `wifi_off`: "Koneksi sedang bermasalah." + "Data terakhir masih ditampilkan."
- **Error validasi** — `tint-red` / border `red-soft` / ikon `error`: "Stok gudang tidak mencukupi." + "Kurangi quantity transfer atau terima barang dulu."
- **No access** — `surface` / ikon `lock`: "Anda tidak memiliki akses ke data ini." + "Hubungi owner untuk membuka akses."
- **Loading skeleton** — tiga row: blok 60px + dua bar (70% dan 45%), animasi `rbshim`.
- **Empty** — border dashed, ikon 32px, judul, body.
- **Sesi berakhir** — ikon `schedule`, "Sesi Anda berakhir", "Masuk kembali untuk melanjutkan pekerjaan. Data form tersimpan.", tombol "Masuk Lagi".

---

## Interactions & Behavior

### Navigasi

Model **navigation stack** sederhana: `{ screen, stack: [] }`. Setiap `push(screen)` menyimpan layar sekarang ke stack; tombol back mem-`pop`. Tombol back di header **hanya muncul bila stack tidak kosong**. Menekan item bottom nav **mereset stack** (`stack: []`), sehingga back tidak bisa keluar dari root tab. Di codebase Next.js, ini paling wajar dipetakan ke rute nyata di bawah `/admin/stockist/` plus `router.back()`; jangan mereplikasi state stack manual.

### Bottom nav

Empat tab, teks label + ikon, tab aktif berwarna `red` dengan ikon FILL 1, nonaktif `text-3`.

- Owner & Manager: Beranda / Stok / Transfer / Profil
- Admin Cabang: Beranda / Stok / Masuk / Profil

Tab Transfer dianggap aktif juga saat berada di Detail Transfer, Buat Transfer, dan Konfirmasi.

### Header

Judul + subjudul berubah per layar dan per peran. Di kanan selalu ada tombol search (→ layar list produk sesuai peran) dan notifikasi (dengan dot merah bila ada yang belum dibaca). Header disembunyikan di Login dan Sukses.

### Perhitungan real-time

Semua stepper langsung memperbarui turunannya tanpa tombol "hitung": pratinjau Terima Barang, nilai Rupiah di Buat Transfer, total & selisih di Konfirmasi, dan badge Cocok/Lebih/Kurang di Opname. Deteksi selisih di Konfirmasi juga **memunculkan/menyembunyikan blok alasan** secara langsung.

### Toast

Aksi yang belum punya layar tujuan memunculkan toast: pill gelap (`text-1` sebagai latar, `bg` sebagai teks) melayang 96px dari bawah, ikon `check_circle`, hilang setelah 2200ms. Contoh: Simpan Draft, Edit Produk, baris di Profil.

### Hover

Card dan tombol outline: border berubah jadi `red` atau `red-soft`, teks ikut `red`. Tombol solid: latar jadi `red-hover`. Row list di Profil: latar jadi `surface-2`. Tidak ada scale atau lift.

### Theme

Toggle light/dark mengganti seluruh set token via atribut `data-theme` pada root. Semua warna diakses lewat CSS variable — tidak ada hex hardcoded di komponen kecuali overlay putih transparan di dalam hero merah (`#ffffff1f`, `#ffffff26`, `#ffffffcc`, `#ffffffd9`).

### Kontrol prototipe (jangan diimplementasi)

Frame device 390×844, tombol "Ganti peran", tombol "Mode gelap", dan deret pintasan layar di bawah frame hanya alat demo. Toggle tema **tetap** perlu, tapi tempatnya di Profil atau pengaturan, bukan di luar frame.

---

## State Management

State prototipe (semua lokal; di produksi sebagian jadi server state):

| State | Tipe | Keterangan |
|---|---|---|
| `theme` | `'light' \| 'dark'` | Persist ke storage; ikuti pola tema yang sudah ada di repo |
| `role` | `'owner' \| 'manager' \| 'branch'` | **Di produksi berasal dari auth/session, bukan pilihan user** |
| `screen`, `stack` | string, string[] | Ganti dengan routing Next.js |
| `tab` | string | Turunan dari pathname |
| `selId` | string | Produk yang dibuka → jadi route param |
| `chip`, `query`, `listMode` | string | Filter list; kandidat untuk URL search params supaya bisa di-share |
| `recvId`, `recvQty`, `recvNote` | string, number, string | Form Terima Barang |
| `trfChip`, `ledgerChip`, `notifChip` | string | Filter |
| `trfId` | string | Transfer yang dibuka → route param |
| `dest`, `cart` | string, `Record<id, qty>` | Draft Buat Transfer; **perlu persist** agar draft tidak hilang |
| `confirm`, `reasons` | `Record<id, number>`, `Record<id, string>` | Form Konfirmasi; **perlu persist** (offline-first) |
| `opname` | `Record<id, number>` | Hitungan fisik; **auto-save draft** sesuai copy di layar |
| `toast`, `success`, `docs` | — | UI sementara |

### Aturan turunan yang harus ikut dipindah

- Status stok: `qty === 0 → Habis`, `qty <= min → Menipis`, selain itu `Aman`
- Reorder point: `min + 4`
- Nilai transfer: `Σ (qty × harga beli)`
- Selisih: `diterima − dikirim`; tidak nol → wajib alasan
- Qty transfer dibatasi stok gudang; semua stepper minimum 0
- Format angka: `toLocaleString('id-ID')` dengan prefiks `Rp `

### Data fetching

Prototipe memakai data statis in-file. Kebutuhan endpoint (samakan dengan API yang sudah ada di repo): daftar & detail produk dengan sebaran per lokasi, ringkasan nilai aset per lokasi, daftar & detail transfer, mutasi terima barang, mutasi buat transfer, mutasi konfirmasi penerimaan dengan selisih + alasan + lampiran foto, ledger dengan filter jenis, sesi opname, permintaan stok, retur, stok pemakaian, insight, dan notifikasi.

Karena aplikasi dipakai di lapangan (gudang, cabang) dengan koneksi tidak stabil, **form Konfirmasi dan Opname sebaiknya offline-first**: simpan lokal, kirim saat online, dan tampilkan banner offline yang ada di bagian States.

---

## Assets

Semuanya ada di `prototype/assets/`.

| File | Asal | Pemakaian |
|---|---|---|
| `logo_transparant.png` | Repo, `frontend/public/Brand_assets/` | Logo di layar Login. Sudah ada di codebase — pakai yang di repo, jangan duplikat |
| `prod-clay.jpeg` | Diunggah user | Clay Pomade Strong Hold |
| `prod-e.jpeg` | Diunggah user | Pomade Classic RedBox 100g |
| `prod-water.jpeg` | Diunggah user | Hair Tonic, Shampoo |
| `prod-psyi.jpeg` | Diunggah user | Hair Powder Matte |
| `prod-oil.jpeg` | Diunggah user | Beard Oil, Hair Serum |

Foto produk dipasang sebagai `background-image` dengan `background-size: cover`, bukan `<img>`, agar tidak ada layout shift saat gambar belum termuat; latar penampung memakai token `img-bg`. Di produksi, foto produk semestinya datang dari data produk, bukan aset statis.

Font: Plus Jakarta Sans dari Google Fonts. Ikon: Material Symbols Outlined, sudah dipakai di codebase.

---

## Files

```
design_handoff_stockist_mobile/
├── README.md                             ← dokumen ini, cukup dibaca ini saja
└── prototype/
    ├── RedBox Stockist.dc.html           ← prototipe, buka di browser untuk mencoba semua layar
    ├── support.js                        ← runtime prototyping; JANGAN diintegrasikan
    └── assets/                           ← foto produk + logo
```

Data contoh (7 produk dengan SKU, harga jual, harga beli, stok minimum, stok gudang, stok cabang; 5 transfer; 6 baris ledger; 5 notifikasi; dataset permintaan/retur/pemakaian/insight) ada di dalam blok logika `RedBox Stockist.dc.html` sebagai konstanta di bagian atas — pakai sebagai seed data atau fixture test.

## Belum didesain

Tiga layar belum ada dan perlu dikonfirmasi ke desainer sebelum diimplementasi: **form Tambah/Edit Produk**, **Adjustment Entry** (koreksi stok manual oleh Owner), dan **Splash screen**.
