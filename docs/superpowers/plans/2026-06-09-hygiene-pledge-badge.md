# Hygiene Pledge Badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menampilkan badge komitmen kebersihan "1 Kip · 1 Handuk · 1 Orang" secara inline di 3 halaman (Homepage, Booking, Packages) menggunakan static HTML snippet dan shared CSS.

**Architecture:** Satu set CSS class `.hygiene-pledge` ditambahkan ke `css/style.css`. HTML badge yang identik di-copy ke 3 halaman di titik paling relevan per halaman — setelah hero di homepage, sebelum service list di booking, dan setelah intro di packages. Tidak ada JS dependency.

**Tech Stack:** HTML5, CSS3 (CSS custom properties), brand asset PNG images (`Brand_assets/kip.png`, `Brand_assets/towel.png`, `Brand_assets/barbercut.png`)

---

## File Map

| File | Aksi | Detail |
|---|---|---|
| `css/style.css` | Modify | Tambah section `/* ---- HYGIENE PLEDGE ---- */` dengan semua classes |
| `index.html` | Modify | Insert badge setelah `<hr class="rb-divider" aria-hidden="true">` (~baris 114) |
| `booking.html` | Modify | Insert badge di dalam `#step1`, setelah `.step-head`, sebelum `#groupSelector` |
| `packages.html` | Modify | Insert badge setelah `</div>` penutup `.intro` (~baris 1005), sebelum `<div class="orn">` |

---

## Task 1: CSS — Tambah `.hygiene-pledge` ke `css/style.css`

**Files:**
- Modify: `css/style.css`

- [ ] **Step 1: Cari titik akhir file style.css untuk insert section baru**

Buka `css/style.css`. Cari baris terakhir yang berisi konten (bukan komentar penutup). Section baru akan ditambahkan di bagian bawah file, sebelum media queries mobile jika ada, atau di paling akhir jika tidak ada.

- [ ] **Step 2: Tambahkan CSS section baru di `css/style.css`**

Tambahkan blok berikut di akhir `css/style.css` (sebelum closing media query jika ada, atau di baris paling akhir):

```css
/* ---- HYGIENE PLEDGE ---- */
.hygiene-pledge {
 background: var(--bg-2);
 border: 1px solid rgba(193,18,31,.2);
 border-radius: var(--radius);
 padding: 20px 24px;
 position: relative;
 overflow: hidden;
}
.hygiene-pledge::before {
 content: '';
 position: absolute;
 top: 0; left: 0; right: 0;
 height: 2px;
 background: linear-gradient(90deg, var(--red) 0%, transparent 100%);
}
.hp-header {
 display: flex;
 align-items: center;
 gap: 10px;
 margin-bottom: 16px;
}
.hp-icon-wrap {
 width: 32px; height: 32px;
 background: var(--red-10);
 border: 1px solid rgba(193,18,31,.25);
 border-radius: 8px;
 display: flex; align-items: center; justify-content: center;
 flex-shrink: 0;
}
.hp-icon-wrap svg {
 width: 16px; height: 16px;
 stroke: var(--red); fill: none;
 stroke-width: 2;
 stroke-linecap: round; stroke-linejoin: round;
}
.hp-eyebrow {
 font-size: .58rem; font-weight: 700;
 letter-spacing: .14em; text-transform: uppercase;
 color: var(--red); opacity: .8;
}
.hp-title {
 font-size: .8rem; font-weight: 600;
 color: var(--w90); margin-top: 1px;
}
.hp-items {
 display: grid;
 grid-template-columns: repeat(3, 1fr);
 gap: 8px;
}
.hp-item {
 background: var(--bg-3);
 border: 1px solid var(--w05);
 border-radius: var(--radius-sm);
 padding: 12px 10px;
 display: flex; flex-direction: column; align-items: center;
 gap: 6px;
 position: relative; overflow: hidden;
}
.hp-item::after {
 content: '';
 position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
 width: 20px; height: 2px;
 background: var(--red); border-radius: 1px;
 opacity: .6;
}
.hp-item-icon {
 width: 40px; height: 40px;
 background: var(--bg-4);
 border-radius: 8px;
 display: flex; align-items: center; justify-content: center;
 overflow: hidden;
}
.hp-item-img {
 width: 100%; height: 100%;
 object-fit: contain;
 padding: 4px;
}
.hp-item-img--kip {
 filter: invert(1) brightness(0.85);
}
.hp-item-num {
 font-family: var(--font-accent);
 font-size: 1.2rem;
 color: var(--red);
 line-height: 1;
}
.hp-item-label {
 font-size: .58rem; font-weight: 700;
 letter-spacing: .08em; text-transform: uppercase;
 color: var(--w70); text-align: center; line-height: 1.3;
}
.hp-item-sub {
 font-size: .52rem;
 color: var(--w30);
 text-align: center; line-height: 1.4;
}
.hp-footer {
 margin-top: 12px;
 padding-top: 12px;
 border-top: 1px solid var(--w05);
 font-size: .6rem; color: var(--w30);
 font-style: italic;
 letter-spacing: .02em;
}

/* Hygiene Pledge — responsive */
@media (max-width: 480px) {
 .hygiene-pledge { padding: 14px 16px; }
 .hp-items { gap: 6px; }
 .hp-item { padding: 8px 6px; gap: 4px; }
 .hp-item-icon { width: 32px; height: 32px; }
 .hp-item-num { font-size: 1rem; }
 .hp-item-sub { display: none; }
}
```

- [ ] **Step 3: Commit CSS**

```bash
git add css/style.css
git commit -m "feat(hygiene-pledge): add .hygiene-pledge CSS component to style.css"
```

---

## Task 2: HTML — Insert badge di `index.html`

**Files:**
- Modify: `index.html`

**Konteks:** Badge masuk tepat setelah `<hr class="rb-divider" aria-hidden="true">` yang ada di antara section `hero` dan section `ai-grooming` (sekitar baris 114). Ini titik pertama yang dilihat pelanggan setelah membaca hero.

- [ ] **Step 1: Temukan insertion point di `index.html`**

Cari baris yang mengandung:
```html
<hr class="rb-divider" aria-hidden="true">
```
Tepat setelahnya, sisipkan blok badge.

- [ ] **Step 2: Insert HTML badge**

Setelah baris `<hr class="rb-divider" aria-hidden="true">`, tambahkan:

```html
 <!-- ========== HYGIENE PLEDGE ========== -->
 <section class="container" style="padding-top:32px;padding-bottom:0">
 <div class="hygiene-pledge">
 <div class="hp-header">
 <div class="hp-icon-wrap">
 <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
 </div>
 <div class="hp-header-text">
 <div class="hp-eyebrow">Janji Kami</div>
 <div class="hp-title">Standar Kebersihan Redbox</div>
 </div>
 </div>
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
 <div class="hp-footer">
 "Kami tidak kompromi soal kebersihan. Setiap duduk di kursi kami, semua alat baru untuk kamu."
 </div>
 </div>
 </section>
 <!-- ========== END HYGIENE PLEDGE ========== -->
```

- [ ] **Step 3: Verifikasi visual di browser**

Buka `index.html` di browser. Scroll sedikit setelah hero — badge harus tampil dengan:
- Background dark (`#111`)
- Top accent merah tipis di atas border
- 3 card berdampingan: kip.png (tampil putih/inverted), towel.png, barbercut.png
- Quote footer italic di bawah

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(hygiene-pledge): insert hygiene pledge badge on homepage (after hero)"
```

---

## Task 3: HTML — Insert badge di `booking.html`

**Files:**
- Modify: `booking.html`

**Konteks:** Badge masuk di dalam `<div class="book-step active" id="step1">`, setelah `<div class="step-head">` block dan sebelum `<div class="group-selector" id="groupSelector">`. Ini titik paling relevan — tepat sebelum pelanggan mulai pilih service.

- [ ] **Step 1: Temukan insertion point di `booking.html`**

Cari:
```html
 <!-- GROUP SIZE SELECTOR -->
 <div class="group-selector" id="groupSelector">
```
Badge disisipkan tepat sebelum baris tersebut, masih di dalam `#step1`.

- [ ] **Step 2: Insert HTML badge**

Sebelum `<!-- GROUP SIZE SELECTOR -->`, tambahkan:

```html
 <!-- HYGIENE PLEDGE -->
 <div class="hygiene-pledge" style="margin-bottom:20px">
 <div class="hp-header">
 <div class="hp-icon-wrap">
 <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
 </div>
 <div class="hp-header-text">
 <div class="hp-eyebrow">Janji Kami</div>
 <div class="hp-title">Standar Kebersihan Redbox</div>
 </div>
 </div>
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
 <div class="hp-footer">
 "Kami tidak kompromi soal kebersihan. Setiap duduk di kursi kami, semua alat baru untuk kamu."
 </div>
 </div>
 <!-- END HYGIENE PLEDGE -->
```

- [ ] **Step 3: Verifikasi visual di browser**

Buka `booking.html`. Badge harus tampil di Step 1 ("Select Service"), di atas group size selector (tombol "1 orang / 2 orang / 3+ orang"). Badge tidak boleh menggeser step indicator bar.

- [ ] **Step 4: Commit**

```bash
git add booking.html
git commit -m "feat(hygiene-pledge): insert hygiene pledge badge on booking page (step 1)"
```

---

## Task 4: HTML — Insert badge di `packages.html`

**Files:**
- Modify: `packages.html`

**Konteks:** Badge masuk setelah closing `</div>` dari `.intro` section (~baris 1005) dan sebelum `<div class="orn" aria-hidden="true">` (~baris 1007). Dalam flow intro teks "Crafted for those who expect the finest", badge menambah layer kepercayaan sebelum pelanggan scroll ke package list.

- [ ] **Step 1: Temukan insertion point di `packages.html`**

Cari blok:
```html
 </div>

 <div class="orn" aria-hidden="true"><span class="orn-mark"></span></div>
```
(Ini adalah penutup `.intro` div diikuti ornament divider.)

Badge disisipkan antara `</div>` (penutup `.intro`) dan `<div class="orn">`.

- [ ] **Step 2: Insert HTML badge**

Ganti:
```html
 </div>

 <div class="orn" aria-hidden="true"><span class="orn-mark"></span></div>
```

Dengan:
```html
 </div>

 <div class="container" style="padding-top:24px;padding-bottom:0">
 <div class="hygiene-pledge">
 <div class="hp-header">
 <div class="hp-icon-wrap">
 <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
 </div>
 <div class="hp-header-text">
 <div class="hp-eyebrow">Janji Kami</div>
 <div class="hp-title">Standar Kebersihan Redbox</div>
 </div>
 </div>
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
 <div class="hp-footer">
 "Kami tidak kompromi soal kebersihan. Setiap duduk di kursi kami, semua alat baru untuk kamu."
 </div>
 </div>
 </div>

 <div class="orn" aria-hidden="true"><span class="orn-mark"></span></div>
```

- [ ] **Step 3: Verifikasi visual di browser**

Buka `packages.html`. Badge harus tampil setelah teks intro "Crafted for those who expect the finest", sebelum ornament `` dan branch toggle. Pastikan badge tidak memutus visual flow halaman yang premium.

- [ ] **Step 4: Commit**

```bash
git add packages.html
git commit -m "feat(hygiene-pledge): insert hygiene pledge badge on packages page (after intro)"
```

---

## Task 5: Cross-browser & mobile check

**Files:**
- Read: `index.html`, `booking.html`, `packages.html`

- [ ] **Step 1: Cek mobile layout (< 480px)**

Buka DevTools (F12) → toggle device toolbar → set width ke 375px (iPhone). Cek di ketiga halaman:
- 3 card harus tetap berdampingan (bukan stack)
- `.hp-item-sub` harus hilang (tersembunyi via CSS `display:none`)
- Badge tidak overflow horizontal

- [ ] **Step 2: Cek image rendering**

Pastikan:
- `kip.png` tampil putih/inverted (filter: invert(1)) di semua halaman
- `towel.png` dan `barbercut.png` tampil dengan warna aslinya
- Tidak ada broken image (src path benar relatif dari root)

- [ ] **Step 3: Cek `booking.html` mobile — badge tidak memblok CTA**

Di mobile, scroll ke booking step 1. Badge harus tampil, lalu group selector di bawahnya. Tidak ada overlap dengan tombol apapun.

- [ ] **Step 4: Final commit**

```bash
git add index.html booking.html packages.html css/style.css
git commit -m "feat(hygiene-pledge): final cross-browser & mobile verification complete"
```

---

## Checklist Spec Coverage

| Requirement | Task |
|---|---|
| Badge `.hygiene-pledge` dengan CSS dark theme | Task 1 |
| Top accent gradient merah | Task 1 (`.hygiene-pledge::before`) |
| Icon Trio — 3 card berdampingan | Task 1 (`.hp-items`, `.hp-item`) |
| Image: `kip.png` dengan filter invert | Task 1 (`.hp-item-img--kip`) |
| Image: `towel.png`, `barbercut.png` | Task 2/3/4 (HTML) |
| Eyebrow "Janji Kami" + title | Task 2/3/4 (HTML) |
| Footer quote italic | Task 1 CSS + Task 2/3/4 HTML |
| Placement homepage (setelah `<hr>`) | Task 2 |
| Placement booking (sebelum `#groupSelector`) | Task 3 |
| Placement packages (setelah `.intro`) | Task 4 |
| Responsive mobile (< 480px) | Task 1 + Task 5 |
