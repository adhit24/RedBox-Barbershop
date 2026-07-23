# Hygiene Pledge Badge — Design Spec
**Date:** 2026-06-09
**Status:** Approved

---

## Overview

Menampilkan informasi penting kepada pelanggan bahwa Redbox Barbershop menerapkan standar kebersihan **1 kip, 1 handuk, 1 orang** — setiap pelanggan mendapat alat yang diganti baru setiap kunjungan.

**Tone:** Komitmen kepercayaan — janji personal, bukan sekadar label kebijakan.

---

## Komponen: `.hygiene-pledge`

Satu komponen HTML/CSS statis yang di-copy ke masing-masing halaman. Tidak ada JS dependency.

### Struktur HTML

```html
<div class="hygiene-pledge">
 <!-- Header: shield icon + eyebrow + title -->
 <div class="hp-header">
 <div class="hp-icon-wrap">
 <!-- SVG shield icon -->
 </div>
 <div class="hp-header-text">
 <div class="hp-eyebrow">Janji Kami</div>
 <div class="hp-title">Standar Kebersihan Redbox</div>
 </div>
 </div>

 <!-- Icon Trio: 3 card berdampingan -->
 <div class="hp-items">
 <div class="hp-item">
 <div class="hp-item-icon">
 <img src="Brand_assets/kip.png" alt="Kip" class="hp-item-img hp-item-img--kip" />
 </div>
 <div class="hp-item-num">1</div>
 <div class="hp-item-label">Kip</div>
 <div class="hp-item-sub">Satu kip bersih per pelanggan</div>
 </div>
 <div class="hp-item">
 <div class="hp-item-icon">
 <img src="Brand_assets/towel.png" alt="Handuk" class="hp-item-img" />
 </div>
 <div class="hp-item-num">1</div>
 <div class="hp-item-label">Handuk</div>
 <div class="hp-item-sub">Satu handuk segar per kunjungan</div>
 </div>
 <div class="hp-item">
 <div class="hp-item-icon">
 <img src="Brand_assets/barbercut.png" alt="Per Orang" class="hp-item-img" />
 </div>
 <div class="hp-item-num">1</div>
 <div class="hp-item-label">Orang</div>
 <div class="hp-item-sub">Diganti setiap sesi, tanpa terkecuali</div>
 </div>
 </div>

 <!-- Footer: brand commitment quote -->
 <div class="hp-footer">
 "Kami tidak kompromi soal kebersihan. Setiap duduk di kursi kami, semua alat baru untuk kamu."
 </div>
</div>
```

### Visual Design

| Property | Value |
|---|---|
| Background | `#111111` (`--bg-2`) |
| Border | `1px solid rgba(193,18,31,.2)` |
| Top accent line | `2px gradient` dari `--red` ke transparent |
| Border radius | `12px` (`--radius`) |
| Padding | `20px 24px` |
| Icon wrap | `32×32px`, background `--red-10`, border merah 25% |
| Item cards | Background `--bg-3`, border `--w05`, bottom accent `2px red` |
| Number | Font `Bebas Neue`, `1.2rem`, warna `--red` |
| Label | `0.58rem`, weight 700, uppercase, `--w70` |
| Sub | `0.52rem`, `--w30`, italic nuance |
| Footer | `0.6rem`, italic, `--w30`, border-top `--w05` |

### CSS File
Semua CSS masuk ke `css/style.css` di bawah section `/* ---- HYGIENE PLEDGE ---- */`.

---

## Copywriting

| Element | Copy |
|---|---|
| Eyebrow | Janji Kami |
| Title | Standar Kebersihan Redbox |
| Item 1 label | Kip |
| Item 1 sub | Satu kip bersih per pelanggan |
| Item 2 label | Handuk |
| Item 2 sub | Satu handuk segar per kunjungan |
| Item 3 label | Orang |
| Item 3 sub | Diganti setiap sesi, tanpa terkecuali |
| Footer quote | "Kami tidak kompromi soal kebersihan. Setiap duduk di kursi kami, semua alat baru untuk kamu." |

---

## Penempatan per Halaman

### 1. `index.html` — Homepage
- **Posisi:** Setelah `<hr class="rb-divider" aria-hidden="true">` di baris ~114 (antara hero section dan `.ai-grooming` section)
- **Konteks:** Pelanggan baru landing — perkenalkan komitmen kebersihan sebelum mereka scroll ke services

### 2. `booking.html` — Booking Page
- **Posisi:** Di dalam `#step1` (`<div class="book-step active" id="step1">`), setelah `.step-head` dan sebelum `#groupSelector`
- **Konteks:** Tepat sebelum pelanggan mulai pilih service — momen yang paling relevan untuk meyakinkan

### 3. `packages.html` — Packages Page
- **Posisi:** Setelah section heading packages, sebelum grid/list paket
- **Konteks:** Pelanggan sedang evaluasi pilihan — badge memperkuat value proposition

---

## Asset

| File | Digunakan untuk | Catatan |
|---|---|---|
| `Brand_assets/kip.png` | Icon item "Kip" | Black & white line art — gunakan `filter: invert(1) brightness(0.85)` agar terlihat di dark background |
| `Brand_assets/towel.png` | Icon item "Handuk" | Illustrated, warna maroon/putih — tidak perlu filter |
| `Brand_assets/barbercut.png` | Icon item "Orang" | Flat design colorful — tidak perlu filter |
| `Brand_assets/Hot Towel Shavet.jpg` | Tidak digunakan di badge | Tersedia sebagai background accent jika diperlukan iterasi berikutnya |

CSS untuk icon gambar:
```css
.hp-item-img {
 width: 100%;
 height: 100%;
 object-fit: contain;
}
.hp-item-img--kip {
 filter: invert(1) brightness(0.85);
}
```

---

## Responsive
- Desktop: 3 item dalam satu baris (`grid-template-columns: repeat(3, 1fr)`)
- Mobile (< 480px): 3 item tetap dalam satu baris dengan padding lebih kecil, atau stack 1 kolom jika terlalu sempit
- Padding badge dikurangi di mobile: `14px 16px`

---

## Implementation Approach

**Pendekatan A — Static HTML snippet**
- Copy-paste satu blok HTML ke masing-masing 3 halaman
- CSS satu kali di `css/style.css`
- Tidak ada JS dependency
- Update teks → edit 3 file (acceptable karena badge ini jarang berubah)

---

## Files yang Akan Dimodifikasi

| File | Perubahan |
|---|---|
| `css/style.css` | Tambah CSS class `.hygiene-pledge` dan semua sub-classes |
| `index.html` | Insert badge HTML setelah `<hr class="rb-divider">` pertama |
| `booking.html` | Insert badge HTML di dalam `#step1`, setelah `.step-head` |
| `packages.html` | Insert badge HTML setelah section heading, sebelum packages grid |

---

## Out of Scope
- Halaman lain (review.html, products.html, membership.html) — tidak dalam scope ini
- Animasi masuk/keluar
- Dismissable behavior
- Server-side / JS injection
