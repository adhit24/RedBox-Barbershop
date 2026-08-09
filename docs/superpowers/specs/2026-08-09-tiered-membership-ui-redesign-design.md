# Redesain UI/UX Membership per Tier (Bronze/Silver/Gold/Platinum)

## Tujuan

Sejak membership berbayar (Silver/Gold/Platinum, lihat [2026-08-08-paid-tier-membership-design.md](2026-08-08-paid-tier-membership-design.md)) berjalan, tampilan member perlu terasa berbeda secara nyata per tier sehingga pelanggan yang membayar lebih mahal merasakan pengalaman yang lebih eksklusif — bukan sekadar label warna berbeda.

Fokus utama: **dashboard member aktif** (`member-dashboard.html`). Halaman marketing (`membership.html`) ikut disesuaikan untuk konsistensi tapi bukan prioritas utama.

## Cakupan halaman

- `member-dashboard.html` + `css/dashboard.css` + `js/dashboard.js` — prioritas utama.
- `membership.html` — disesuaikan untuk konsistensi token warna & efek, tidak direstrukturisasi.
- File baru: `css/tier-tokens.css` — sumber tunggal token visual per tier, dipakai kedua halaman.

Di luar cakupan: halaman admin CRM (`frontend/src/app/admin/membership`), alur bisnis pendaftaran/aktivasi (sudah didefinisikan di spec 2026-08-08).

## Keputusan desain

### 1. Status tier Bronze

Bronze dipertahankan sebagai **tier gratis/entry otomatis** — setiap akun member baru mendapat Bronze tanpa bayar, dengan benefit dasar (akses dashboard, kode referral, riwayat). Upgrade ke Silver/Gold/Platinum tetap mengikuti alur berbayar di spec 2026-08-08. Ini konsisten dengan struktur `TIERS`, `BENEFITS`, dan `REWARDS` yang sudah ada di `js/dashboard.js`.

> Catatan: keputusan ini diambil dalam sesi desain berdasarkan konfirmasi user, bukan berdasarkan dokumen bisnis tertulis. Jika bisnis nantinya memutuskan Bronze dihapus, hanya token & copy yang perlu berubah — arsitektur token di bawah ini tidak terpengaruh.

### 2. Reinterpretasi "tier progress" menjadi "tier map"

`js/dashboard.js` sudah menyatakan poin tidak lagi menentukan kenaikan tier ("Poin tidak lagi menjadi progres kenaikan tier. Tier ditentukan saat pembelian"), tapi UI `.tier-progress-track` (node yang menyala bertahap ala progress bar) masih menyiratkan tier dicapai dengan mengumpulkan poin — ini bertentangan dengan model bisnis berbayar.

**Perubahan**: section ini menjadi **tier map** — menampilkan tier saat ini (emblem menyala) dan tier di atasnya (benefit kunci + CTA "Upgrade" yang mengarah ke alur pembelian tier, bukan progress poin). Poin tetap ditampilkan terpisah, murni untuk ditukar reward di katalog (`REWARDS`), tidak memengaruhi tier.

### 3. Penyatuan warna Platinum

`membership.html` mendefinisikan Platinum sebagai gradient ungu-perak (`#C4B5FD → #E2E8F0 → #C4B5FD`), sementara `css/dashboard.css` memakai biru es (`#B9F2FF`). Gradient ungu-perak dipilih sebagai standar (lebih premium & distinctive), diterapkan ke kedua halaman lewat token bersama.

## Arsitektur: Tier Theming Engine

Satu sistem token CSS di-scope lewat atribut `data-tier="bronze|silver|gold|platinum"` pada `<body>` (dashboard) atau wrapper card (`membership.html`). `js/dashboard.js` menetapkan `document.body.dataset.tier` berdasarkan `tier.class` yang sudah dihitung oleh `getDisplayTier()`.

File baru `css/tier-tokens.css` mendefinisikan, per tier:

| Token | Fungsi |
|---|---|
| `--tier-primary`, `--tier-primary-soft` | warna identitas & varian lembut |
| `--tier-gradient` | gradient untuk header/background/kartu |
| `--tier-glow` | warna & intensitas box-shadow ambient |
| `--tier-motion-speed` | pengali durasi animasi (Bronze paling lambat/statis) |
| `--tier-particle-density` | 0 (Bronze) → tinggi (Platinum) |
| `--tier-chime` | path file audio pendek untuk momen tier-up |

Semua komponen (profile header, kartu member, tier map, reward grid, upsell banner) membaca token yang sama, bukan CSS class per-tier yang terduplikasi — perubahan desain di masa depan cukup mengubah `tier-tokens.css`.

## Identitas visual per tier

| Tier | Mood | Warna inti | Motion/particle | Chime |
|---|---|---|---|---|
| Bronze | Tenang, titik awal yang layak | Copper `#CD7F32` | Breathing glow badge saja (opacity 0.4↔0.6, 3s loop), tanpa particle, tanpa tilt-tracking kartu | Tidak ada |
| Silver | Presisi, clean, profesional | Brushed steel `#C0C0C0` → `#9CA3AF` | Shimmer sweep sekali saat masuk viewport; tilt-tracking kartu halus (maks 4°) | Chime pendek 1 nada |
| Gold | Hangat, mewah, diakui | Amber `#FBBF24` → `#B45309` | Shimmer sweep + gold-dust particle (10-15 titik, transform+opacity); tilt-tracking maks 7° | Chime hangat 2 nada |
| Platinum | Eksklusif, dramatis, langka | Iridescent ungu-perak `#C4B5FD → #E2E8F0 → #C4B5FD` | Semua efek Gold + gradient background bergeser pelan terus-menerus (`background-position`, 8s linear infinite); particle lebih padat; tilt-tracking maks 10° | Chime signature 3 nada |

Bronze sengaja paling minim efek agar eskalasi ke tier berikutnya terasa jelas, bukan efek acak yang rata di semua tier (menghindari "excessive motion" — maksimal 1-2 elemen animasi aktif per view, sesuai kaidah UX motion standar).

## Redesain komponen dashboard

- **Profile header**: badge tier bergaya emblem (bukan pill teks polos); ambient wash `--tier-gradient` halus di background section.
- **Kartu member digital**: foil-sheen mengikuti posisi pointer (`mousemove` → radial-gradient bergeser), intensitas ikut `--tier-particle-density`; nonaktif otomatis saat `prefers-reduced-motion`.
- **Tier map** (redesain dari `.tier-progress-track`): lihat keputusan desain #2 di atas.
- **Reward/benefit grid**: layout tetap grid card yang sama untuk semua tier; border-glow & unlock-state pakai `--tier-glow`; hover pada card unlocked memberi lift halus (translateY -2px + shadow).
- **Upsell banner**: `upsell-banner.tier-*` yang sudah ada disamakan ke token system, ditambah shimmer pass tipis di border untuk Gold/Platinum.

## Momen tier-up (celebratory)

Trigger sekali, hanya lewat interaksi user (tombol "Lihat Kartu Baru" setelah staff mengaktifkan/upgrade membership di CRM — bukan autoplay saat halaman dimuat, agar tidak melanggar kebijakan autoplay browser):

1. Overlay emblem tier baru muncul dengan scale spring overshoot (`cubic-bezier(.34,1.56,.64,1)`, 0.8→1).
2. `canvas-confetti` (sudah tersedia di codebase) meletus dengan warna sesuai `--tier-primary`.
3. Chime `--tier-chime` diputar bersamaan.

Ikon mute persisten (tersimpan di `localStorage`, default ON) tersedia di pojok dashboard untuk menonaktifkan chime kapan pun, termasuk di momen tier-up berikutnya.

## Catatan teknis: motion tanpa React

`member-dashboard.html` dan `membership.html` adalah situs statis vanilla HTML/CSS/JS (bukan React) — library Framer Motion tidak dapat dipasang langsung. Efek "spring motion" direplikasi dengan:

- CSS `@keyframes` + transition dengan cubic-bezier yang mendekati kurva spring.
- Web Animations API untuk animasi yang perlu dikontrol dari JS (mis. overlay tier-up).
- `mousemove` listener vanilla JS untuk tilt-tracking & foil-sheen kartu.

Semua animasi hanya memakai `transform` dan `opacity` (tidak pernah `width`/`height`/`top`/`left`) untuk menghindari layout thrashing.

## Konsistensi di `membership.html`

- Warna tier (termasuk Platinum) mengikuti `tier-tokens.css` yang sama dengan dashboard.
- Struktur `.ms-tier` dan tabel perbandingan (`.ms-table`) tidak direstrukturisasi.
- Ditambahkan shimmer sweep sekali saat card masuk viewport (Silver ke atas), konsisten dengan efek dashboard, agar calon member sudah merasakan "preview" identitas tier sebelum mendaftar.

## Aksesibilitas & performa

- Kontras teks di atas gradient/glow dicek manual ≥4.5:1, khususnya teks di atas gradient Platinum yang terang.
- Semua animasi partikel/shimmer/gradient-shift dimatikan total saat `prefers-reduced-motion: reduce`; yang tersisa hanya warna tier statis + fade sederhana (150ms). Chime tetap boleh diputar (bukan termasuk motion) tapi tombol mute tetap tersedia.
- Jumlah particle Platinum diturunkan di viewport mobile (`matchMedia('(max-width: 768px)')`) untuk menjaga frame rate.
- File audio chime pendek (<1 detik), `preload="metadata"`, tidak pernah autoplay di luar interaksi user eksplisit.

## Testing

- Verifikasi visual tiap tier (Bronze/Silver/Gold/Platinum) di `member-dashboard.html` dan `membership.html`, desktop & mobile (375px, 768px, 1024px+).
- Verifikasi `prefers-reduced-motion: reduce` mematikan semua particle/shimmer/gradient-shift tanpa merusak layout.
- Verifikasi kontras warna teks di atas tiap gradient tier (khususnya Platinum) ≥4.5:1.
- Verifikasi chime tidak autoplay saat load halaman, hanya saat interaksi eksplisit (tier-up reveal), dan toggle mute berfungsi & tersimpan across reload.
- Verifikasi tier map menampilkan CTA upgrade yang benar (bukan progress poin) untuk tiap kombinasi tier aktif.
