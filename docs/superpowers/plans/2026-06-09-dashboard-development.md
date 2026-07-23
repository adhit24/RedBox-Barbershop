# Member Dashboard Development — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan Smart Upsell Banner, tab "Benefits & Rewards" (mengganti "Rewards"), dan tab "Shop" di `member-dashboard.html`.

**Architecture:** Semua fitur diimplementasikan sebagai vanilla HTML/CSS/JS. HTML berisi struktur statis, `dashboard.js` menambah fungsi render dinamis, `dashboard.css` menerima class baru. Tidak ada framework — ikuti pola existing di file tersebut.

**Tech Stack:** Vanilla HTML5, CSS3, JavaScript (ES6+), Supabase REST (existing), localStorage state

**Design reference (approved mockups):**
- Banner: `.superpowers/brainstorm/.../content/design-banner.html`
- Benefits tab: `.superpowers/brainstorm/.../content/design-benefits-tab.html`
- Shop tab: `.superpowers/brainstorm/.../content/design-shop-tab-v6.html`

---

## File Map

| File | Perubahan |
|------|-----------|
| `member-dashboard.html` | Add banner HTML, rename rewards→benefits tab, add benefit tracker + redeem history sections, add shop tab |
| `js/dashboard.js` | Add `BENEFITS` array, `renderUpsellBanner()`, `renderBenefitTracker()`, `renderRedeemHistory()`, `renderShop()`, update tab name references |
| `css/dashboard.css` | Add styles: `.upsell-banner`, `.benefit-tracker`, `.redeem-history-table`, `.shop-panel` |

---

## Task 1: Smart Upsell Banner — HTML + CSS

**Files:**
- Modify: `member-dashboard.html` (tambah banner setelah tier section)
- Modify: `css/dashboard.css` (tambah banner styles)

- [ ] **Step 1: Temukan insertion point di HTML**

Di `member-dashboard.html`, cari `<!-- Tab: Rewards -->` atau section tier/points. Banner disisipkan tepat **sebelum** `<div class="dash-nav">` (tab bar). Contoh saat ini:
```html
<!-- cari section ini -->
<aside class="dash-sidebar">
 <nav class="dash-nav">
```
Banner masuk DI ATAS `<nav class="dash-nav">` tapi DI DALAM `.dash-sidebar`, atau di luar sidebar sebelum tab area. Cek pola layout dengan buka file dan cari `dash-content` atau area utama panel.

- [ ] **Step 2: Tambah banner HTML**

Cari area `<div class="dash-content">` atau setelah breadcrumb section. Sisipkan tepat sebelum `<aside class="dash-sidebar">`:

```html
<!-- ========== SMART UPSELL BANNER ========== -->
<div class="upsell-banner" id="upsellBanner" style="display:none">
 <div class="ub-left">
 <div class="ub-icon" id="ubIcon"></div>
 <div class="ub-text">
 <strong id="ubTitle"></strong>
 <span id="ubDesc"></span>
 <div class="ub-progress-wrap" id="ubProgressWrap">
 <div class="ub-progress-bar"><div class="ub-progress-fill" id="ubProgressFill"></div></div>
 <span class="ub-progress-label" id="ubProgressLabel"></span>
 </div>
 </div>
 </div>
 <div class="ub-actions" id="ubActions"></div>
</div>
```

- [ ] **Step 3: Tambah CSS banner di `css/dashboard.css`**

Append ke akhir file:

```css
/* ── Smart Upsell Banner ── */
.upsell-banner {
 display: flex; align-items: center; justify-content: space-between;
 gap: 14px; flex-wrap: wrap;
 border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
}
.upsell-banner.tier-bronze { background: linear-gradient(135deg, #1a1008 0%, #0d0a06 100%); border: 1px solid rgba(205,127,50,0.25); }
.upsell-banner.tier-silver { background: linear-gradient(135deg, #111418 0%, #0a0c10 100%); border: 1px solid rgba(192,192,192,0.20); }
.upsell-banner.tier-gold { background: linear-gradient(135deg, #12100a 0%, #0a0905 100%); border: 1px solid rgba(255,215,0,0.22); }
.upsell-banner.tier-platinum { background: linear-gradient(135deg, #0d0818 0%, #070510 100%); border: 1px solid rgba(185,242,255,0.18); }
.ub-left { display: flex; align-items: flex-start; gap: 14px; flex: 1; min-width: 0; }
.ub-icon svg { flex-shrink: 0; }
.ub-text { min-width: 0; }
.ub-text strong { display: block; font-size: 0.9rem; font-weight: 700; color: #e5e7eb; margin-bottom: 3px; }
.ub-text span { display: block; font-size: 0.75rem; color: #9ca3af; line-height: 1.5; }
.ub-progress-wrap { margin-top: 8px; }
.ub-progress-bar { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; width: 200px; max-width: 100%; }
.ub-progress-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }
.ub-progress-label { font-size: 0.65rem; color: #6b7280; margin-top: 4px; display: block; }
.ub-actions { display: flex; flex-shrink: 0; }
.ub-btn {
 background: #c1121f; color: #fff; border: none;
 padding: 9px 16px; border-radius: 8px; font-size: 0.78rem; font-weight: 700;
 cursor: pointer; white-space: nowrap;
}
.ub-btn:hover { opacity: 0.88; }
.ub-btn.plat { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
@media (max-width: 640px) {
 .upsell-banner { flex-direction: column; align-items: flex-start; }
}
```

- [ ] **Step 4: Verifikasi HTML valid**

Buka `member-dashboard.html` di browser → pastikan tidak ada elemen yang tumpang tindih. Banner `display:none` jadi tidak terlihat dulu — tidak apa.

- [ ] **Step 5: Commit**

```bash
git add member-dashboard.html css/dashboard.css
git commit -m "feat(dashboard): add smart upsell banner HTML + CSS structure"
```

---

## Task 2: Smart Upsell Banner — JS Render

**Files:**
- Modify: `js/dashboard.js` (tambah `renderUpsellBanner()` setelah tier detection)

- [ ] **Step 1: Tambah fungsi `renderUpsellBanner` di `dashboard.js`**

Cari section `// MEMBERSHIP STATUS UI` (sekitar baris 157). Sisipkan fungsi baru tepat SETELAH baris `const tier = getCurrentTier(displayPoints);`:

```js
// ============================================================
// SMART UPSELL BANNER
// ============================================================
function renderUpsellBanner(tier) {
 const banner = document.getElementById('upsellBanner');
 if (!banner) return;

 const tierIdx = tier.level - 1; // 0=Bronze, 1=Silver, 2=Gold, 3=Platinum
 const nextTier = TIERS[tierIdx + 1] || null;

 // Tier progress within current band
 const rangeWidth = tier.max === Infinity ? 1 : (tier.max - tier.min + 1);
 const inRange = displayPoints - tier.min;
 const progress = Math.min(Math.round((inRange / rangeWidth) * 100), 100);

 // Banner config per tier
 const configs = {
 bronze: { title:'Aktivasi Member — Mulai Kumpul Poin', desc:'Bergabunglah dan mulai dapatkan keuntungan eksklusif Redbox.', cta:'Aktivasi Sekarang', ctaClass:'' },
 silver: { title:'Upgrade ke Gold — Unlock Benefit Lebih', desc:'Diskon 10% semua layanan, cashback eksklusif, dan lebih banyak reward.', cta:'Upgrade ke Gold', ctaClass:'' },
 gold: { title:'Upgrade ke Platinum — Benefit Terlengkap', desc:'Free grooming, iced americano, dan birthday gratis di semua cabang.', cta:'Upgrade ke Platinum', ctaClass:'plat' },
 platinum: { title:'Kamu di Tingkat Tertinggi', desc:'Nikmati semua benefit eksklusif Redbox Platinum.', cta:null, ctaClass:'' },
 };
 const cfg = configs[tier.class] || configs.bronze;

 // Tier accent colors for progress bar
 const progressColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#B9F2FF' };
 const accentColor = progressColors[tier.class] || '#c1121f';

 // Tier SVG icons (24×24 stroke)
 const tierIcons = {
 bronze: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#CD7F32" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
 silver: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C0C0C0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
 gold: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
 platinum: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B9F2FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l10-6 10 6v8l-10 6L2 16V8z"/><polyline points="2 8 12 14 22 8"/><line x1="12" y1="14" x2="12" y2="20"/></svg>`,
 };

 // Inject content
 const ubIcon = document.getElementById('ubIcon');
 const ubTitle = document.getElementById('ubTitle');
 const ubDesc = document.getElementById('ubDesc');
 const ubProgressWrap = document.getElementById('ubProgressWrap');
 const ubProgressFill = document.getElementById('ubProgressFill');
 const ubProgressLabel= document.getElementById('ubProgressLabel');
 const ubActions = document.getElementById('ubActions');

 if (ubIcon) ubIcon.innerHTML = tierIcons[tier.class] || '';
 if (ubTitle) ubTitle.textContent = cfg.title;
 if (ubDesc) ubDesc.textContent = cfg.desc;

 // Progress bar — show for non-Platinum
 if (ubProgressWrap) {
 ubProgressWrap.style.display = tier.class === 'platinum' ? 'none' : 'block';
 if (ubProgressFill) { ubProgressFill.style.width = progress + '%'; ubProgressFill.style.background = accentColor; }
 if (ubProgressLabel && nextTier) ubProgressLabel.textContent = `${displayPoints.toLocaleString('id-ID')} / ${tier.max.toLocaleString('id-ID')} poin — ${tier.max - displayPoints} lagi ke ${nextTier.name}`;
 }

 // CTA button
 if (ubActions) {
 ubActions.innerHTML = cfg.cta
 ? `<button class="ub-btn ${cfg.ctaClass}" onclick="window.location.href='membership.html'">${cfg.cta}</button>`
 : '';
 }

 // Show banner + apply tier class
 banner.className = `upsell-banner tier-${tier.class}`;
 banner.style.display = 'flex';
}

// Call after tier is determined
renderUpsellBanner(tier);
```

- [ ] **Step 2: Verifikasi di browser**

1. Buka `member-dashboard.html`
2. Buka DevTools → Console, jalankan: `localStorage.setItem('redbox_member', JSON.stringify({points:1600, membership_status:'ACTIVE', visits:5, reviews:0, pointsHistory:[], joinDate:new Date().toISOString()}))` lalu reload
3. Banner harus muncul dengan warna Gold, judul "Upgrade ke Platinum", progress bar terisi
4. Test tier lain: ganti `points` ke `300` (Bronze), `800` (Silver), `3500` (Platinum)
5. Platinum: tidak ada tombol CTA, progress bar tersembunyi

- [ ] **Step 3: Commit**

```bash
git add js/dashboard.js
git commit -m "feat(dashboard): smart upsell banner — dynamic tier-aware render"
```

---

## Task 3: Rename Tab Rewards → Benefits & Rewards

**Files:**
- Modify: `member-dashboard.html` (rename nav item + panel)
- Modify: `js/dashboard.js` (update referensi panel ID)

- [ ] **Step 1: Rename nav item**

Di `member-dashboard.html`, cari:
```html
<button class="dash-nav-item" data-tab="rewards">
 ...
 <span>Rewards</span>
</button>
```
Ganti `data-tab="rewards"` → `data-tab="benefits"` dan teks `Rewards` → `Benefits & Rewards`:
```html
<button class="dash-nav-item" data-tab="benefits">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
 <span>Benefits &amp; Rewards</span>
</button>
```

- [ ] **Step 2: Rename panel ID**

Cari `<div class="dash-panel" id="panel-rewards">` → ganti menjadi `id="panel-benefits"`.

- [ ] **Step 3: Tidak ada perubahan JS** — tab switching code membaca `data-tab` secara dinamis sehingga otomatis bekerja: `if (p.id === 'panel-'+tab)`. Tidak ada hardcode "rewards" di tab switcher.

- [ ] **Step 4: Verifikasi**

Buka di browser → klik tab "Benefits & Rewards" → panel rewards lama harus terbuka (konten belum berubah, hanya nama tab).

- [ ] **Step 5: Commit**

```bash
git add member-dashboard.html
git commit -m "feat(dashboard): rename Rewards tab → Benefits & Rewards"
```

---

## Task 4: Benefit Tracker — Data + HTML

**Files:**
- Modify: `js/dashboard.js` (tambah `BENEFITS` array)
- Modify: `member-dashboard.html` (tambah section benefit tracker di dalam `panel-benefits`)

- [ ] **Step 1: Tambah `BENEFITS` array di `dashboard.js`**

Letakkan setelah konstanta `REWARDS` (sekitar baris 56):

```js
const BENEFITS = [
 // Bronze
 { tier:'bronze', name:'Akses dashboard member', desc:'Lihat riwayat kunjungan, poin, dan profil.', auto:true },
 { tier:'bronze', name:'Kode referral', desc:'Bagikan kode, dapat bonus poin tiap teman daftar.', auto:true },
 { tier:'bronze', name:'Riwayat kunjungan & poin', desc:'Pantau semua aktivitas membership kamu.', auto:true },
 // Silver
 { tier:'silver', name:'Poin multiplier ×1.2', desc:'Setiap kunjungan menghasilkan lebih banyak poin.', auto:true },
 { tier:'silver', name:'Cashback 50% Haircut Regular', desc:'Tersedia di katalog rewards untuk diredeem.', auto:false },
 { tier:'silver', name:'Akses Katalog Produk', desc:'Beli produk Redbox langsung dari dashboard.', auto:true },
 // Gold
 { tier:'gold', name:'Poin multiplier ×1.5', desc:'Setiap kunjungan menghasilkan poin lebih banyak lagi.', auto:true },
 { tier:'gold', name:'Diskon 10% semua layanan', desc:'Berlaku di semua cabang Redbox.', auto:true },
 { tier:'gold', name:'Cashback 50% Haircut Premium CSB', desc:'Tersedia di katalog rewards untuk diredeem.', auto:false },
 // Platinum
 { tier:'platinum', name:'Poin multiplier ×2.0', desc:'Poin terbanyak per kunjungan.', auto:true },
 { tier:'platinum', name:'Free Gentlemen Grooming', desc:'Layanan grooming gratis tiap kunjungan.', auto:true },
 { tier:'platinum', name:'Free Iced Americano', desc:'Kopi gratis tiap kunjungan ke Redbox.', auto:true },
 { tier:'platinum', name:'Birthday gratis penuh', desc:'Layanan gratis saat hari ulang tahunmu.', auto:true },
 { tier:'platinum', name:'Priority semua cabang', desc:'Akses priority booking di seluruh cabang Redbox.', auto:true },
];
```

- [ ] **Step 2: Tambah HTML section Benefit Tracker di `panel-benefits`**

Di `member-dashboard.html`, di dalam `<div class="dash-panel" id="panel-benefits">`, tambah SEBELUM `<div class="rewards-panel-header">`:

```html
<!-- Section A: Benefit Tracker -->
<div class="benefit-tracker" id="benefitTracker"></div>
<hr class="section-divider" style="border:none;border-top:1px solid #1f1f1f;margin:24px 0;"/>
```

- [ ] **Step 3: Commit**

```bash
git add member-dashboard.html js/dashboard.js
git commit -m "feat(dashboard): add BENEFITS array + benefit tracker placeholder HTML"
```

---

## Task 5: Benefit Tracker — JS Render + CSS

**Files:**
- Modify: `js/dashboard.js` (tambah `renderBenefitTracker()`)
- Modify: `css/dashboard.css` (tambah benefit tracker styles)

- [ ] **Step 1: Tambah `renderBenefitTracker` di `dashboard.js`**

Tambah di section REWARDS RENDER (setelah baris 276 — setelah tutup rewardsGrid block):

```js
// ============================================================
// BENEFIT TRACKER
// ============================================================
function renderBenefitTracker() {
 const container = document.getElementById('benefitTracker');
 if (!container) return;

 const tierNames = ['Bronze','Silver','Gold','Platinum'];
 const tierColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#B9F2FF' };
 const userTierIdx = tier.level - 1;

 let html = `<h3 class="benefit-tracker-title">Benefit Kamu</h3>`;

 tierNames.forEach((tName, ti) => {
 const tClass = tName.toLowerCase();
 const tBenefits = BENEFITS.filter(b => b.tier === tClass);
 const unlocked = ACTIVE && userTierIdx >= ti;
 const isCurrent = userTierIdx === ti;

 const statusLabel = !ACTIVE
 ? '<span class="bt-status inactive">Tidak aktif</span>'
 : unlocked
 ? `<span class="bt-status active">${isCurrent ? 'Tier saat ini' : 'Unlocked'}</span>`
 : `<span class="bt-status locked">Locked</span>`;

 html += `
 <div class="bt-tier-group">
 <div class="bt-tier-header">
 <span class="bt-tier-dot" style="background:${tierColors[tClass]}"></span>
 <span class="bt-tier-name" style="color:${tierColors[tClass]}">${tName}</span>
 ${statusLabel}
 </div>
 <div class="bt-rows">
 ${tBenefits.map(b => {
 const state = ACTIVE && userTierIdx >= ti ? 'unlocked' : (ti === userTierIdx + 1 ? 'locked-next' : 'locked-far');
 const icon = state === 'unlocked'
 ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
 : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
 return `
 <div class="bt-row ${state}">
 <span class="bt-icon">${icon}</span>
 <div class="bt-text">
 <span class="bt-name">${b.name}</span>
 <span class="bt-desc">${b.desc}</span>
 </div>
 ${state !== 'unlocked' ? `<span class="bt-lock-label">${tName}+</span>` : ''}
 </div>`;
 }).join('')}
 </div>
 </div>`;
 });

 container.innerHTML = html;
}

renderBenefitTracker();
```

- [ ] **Step 2: Tambah CSS benefit tracker di `dashboard.css`**

```css
/* ── Benefit Tracker ── */
.benefit-tracker-title { font-size:0.65rem; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#c1121f; margin-bottom:16px; }
.bt-tier-group { margin-bottom:18px; }
.bt-tier-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.bt-tier-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.bt-tier-name { font-size:0.78rem; font-weight:700; letter-spacing:0.06em; }
.bt-status { font-size:0.62rem; padding:2px 7px; border-radius:4px; font-weight:600; margin-left:auto; }
.bt-status.active { background:rgba(74,222,128,0.12); color:#4ade80; }
.bt-status.locked { background:rgba(255,255,255,0.05); color:#6b7280; }
.bt-status.inactive { background:rgba(193,18,31,0.1); color:#c1121f; }
.bt-rows { display:flex; flex-direction:column; gap:5px; }
.bt-row { display:flex; align-items:center; gap:9px; padding:8px 11px; border-radius:8px; }
.bt-row.unlocked { background:rgba(74,222,128,0.06); border:1px solid rgba(74,222,128,0.12); }
.bt-row.locked-next { background:rgba(193,18,31,0.06); border:1px solid rgba(193,18,31,0.15); }
.bt-row.locked-far { background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); }
.bt-icon { flex-shrink:0; color:#6b7280; }
.bt-text { flex:1; min-width:0; }
.bt-name { display:block; font-size:0.8rem; font-weight:600; color:#e5e7eb; }
.bt-row.locked-next .bt-name, .bt-row.locked-far .bt-name { color:#6b7280; }
.bt-desc { display:block; font-size:0.68rem; color:#4b5563; margin-top:1px; }
.bt-lock-label { font-size:0.6rem; color:#4b5563; flex-shrink:0; white-space:nowrap; }
```

- [ ] **Step 3: Verifikasi**

Buka di browser → klik tab "Benefits & Rewards":
- Bronze benefits hijau (unlocked) untuk user Gold, Silver unlocked, Gold = current, Platinum locked-far
- Test dengan Platinum user: semua rows hijau
- Test dengan INACTIVE: semua status "tidak aktif", semua rows locked-far

- [ ] **Step 4: Commit**

```bash
git add js/dashboard.js css/dashboard.css
git commit -m "feat(dashboard): benefit tracker — per-tier benefit rows with lock/unlock states"
```

---

## Task 6: Redeem History Section

**Files:**
- Modify: `member-dashboard.html` (tambah section redeem history di panel-benefits)
- Modify: `js/dashboard.js` (tambah `renderRedeemHistory()`)
- Modify: `css/dashboard.css` (tambah table styles)

- [ ] **Step 1: Tambah HTML section di `panel-benefits`**

Di `member-dashboard.html`, di dalam `panel-benefits`, tambah SETELAH divider dan SEBELUM `<div class="rewards-panel-header">`:

```html
<!-- Section B: Redeem History -->
<div class="redeem-history-section">
 <div class="section-label-sm">Riwayat Redeem</div>
 <div id="redeemHistory"></div>
</div>
<hr class="section-divider" style="border:none;border-top:1px solid #1f1f1f;margin:24px 0;"/>
```

- [ ] **Step 2: Tambah `renderRedeemHistory` di `dashboard.js`**

Tambah setelah `renderBenefitTracker()`:

```js
// ============================================================
// REDEEM HISTORY
// ============================================================
function renderRedeemHistory() {
 const container = document.getElementById('redeemHistory');
 if (!container) return;

 // Filter pointsHistory untuk transaksi redeem (amount negatif)
 const redeems = (memberData.pointsHistory || [])
 .filter(h => h.amount < 0 && (h.activity || '').toLowerCase().includes('redeem'));

 if (!redeems.length) {
 container.innerHTML = `
 <div class="redeem-empty">
 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
 <span>Belum ada riwayat redeem — tukar poin kamu di katalog bawah</span>
 </div>`;
 return;
 }

 container.innerHTML = `
 <table class="redeem-table">
 <thead><tr>
 <th>Tanggal</th><th>Reward</th><th>Poin</th><th>Status</th>
 </tr></thead>
 <tbody>
 ${redeems.map(h => `<tr>
 <td>${h.date}</td>
 <td>${(h.activity||'').replace('Redeem reward: ','')}</td>
 <td style="color:#c1121f">-${Math.abs(h.amount)}</td>
 <td><span class="rd-status used">Digunakan</span></td>
 </tr>`).join('')}
 </tbody>
 </table>`;
}

renderRedeemHistory();
```

- [ ] **Step 3: Tambah CSS di `dashboard.css`**

```css
/* ── Redeem History ── */
.section-label-sm { font-size:0.62rem; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#c1121f; margin-bottom:12px; }
.redeem-history-section { margin-bottom:0; }
.redeem-empty { display:flex; align-items:center; gap:10px; color:#4b5563; font-size:0.75rem; padding:12px 0; }
.redeem-table { width:100%; border-collapse:collapse; font-size:0.75rem; }
.redeem-table th { text-align:left; padding:6px 8px; color:#6b7280; font-weight:600; border-bottom:1px solid #1f1f1f; }
.redeem-table td { padding:8px 8px; color:#9ca3af; border-bottom:1px solid #111; }
.rd-status { font-size:0.6rem; padding:2px 7px; border-radius:3px; font-weight:700; }
.rd-status.used { background:rgba(74,222,128,0.1); color:#4ade80; }
.rd-status.pending { background:rgba(251,191,36,0.1); color:#fbbf24; }
.rd-status.expired { background:rgba(239,68,68,0.1); color:#ef4444; }
```

- [ ] **Step 4: Verifikasi**

Test redeem reward dari katalog, lalu cek tab Benefits & Rewards → Riwayat Redeem harus tampil transaksi tersebut.

- [ ] **Step 5: Update judul panel**

Di `member-dashboard.html`, ganti `<h2 class="panel-title">Rewards &amp; Redeem</h2>` → `<h2 class="panel-title">Katalog Rewards</h2>` agar lebih jelas.

- [ ] **Step 6: Commit**

```bash
git add member-dashboard.html js/dashboard.js css/dashboard.css
git commit -m "feat(dashboard): redeem history section in Benefits & Rewards tab"
```

---

## Task 7: Shop Tab — HTML + Nav Entry

**Files:**
- Modify: `member-dashboard.html` (tambah nav item + panel shop)

- [ ] **Step 1: Tambah nav item Shop**

Di `member-dashboard.html`, cari nav item `Kode Referral`. Sisipkan SEBELUM-nya:

```html
<button class="dash-nav-item" data-tab="shop">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
 <span>Shop</span>
</button>
```

- [ ] **Step 2: Tambah panel Shop**

Di `member-dashboard.html`, tambah SEBELUM `<!-- Tab: Referral -->`:

```html
<!-- Tab: Shop -->
<div class="dash-panel" id="panel-shop">
 <h2 class="panel-title">Shop</h2>
 <p class="panel-subtitle" id="shopSubtitle">Rekomendasi dipersonalisasi untuk member</p>

 <!-- Section A: Curated -->
 <div class="shop-section-label">
 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
 Rekomendasi Untukmu
 <span class="shop-tier-label" id="shopTierLabel"></span>
 </div>
 <div class="shop-grid shop-grid-3" id="shopCurated"></div>

 <!-- Section B: All Products -->
 <div class="shop-section-label" style="margin-top:24px">
 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
 Semua Produk Redbox
 <a href="products.html" class="shop-see-all">Lihat semua →</a>
 </div>
 <div class="shop-grid shop-grid-3" id="shopAllProducts"></div>

 <!-- Section C: Services -->
 <div class="shop-section-label" style="margin-top:24px">
 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
 Tingkatkan Pengalamanmu
 </div>
 <div class="shop-grid shop-grid-2" id="shopServices"></div>

 <!-- Section D: Upgrade CTA -->
 <div class="shop-upgrade-cta" id="shopUpgradeCta" style="display:none"></div>
</div>
```

- [ ] **Step 3: Verifikasi**

Klik tab "Shop" di browser → panel kosong muncul dengan judul "Shop". Tidak ada error di console.

- [ ] **Step 4: Commit**

```bash
git add member-dashboard.html
git commit -m "feat(dashboard): add Shop tab nav + empty panel skeleton"
```

---

## Task 8: Shop Tab — CSS

**Files:**
- Modify: `css/dashboard.css`

- [ ] **Step 1: Tambah shop CSS**

Append ke akhir `css/dashboard.css`:

```css
/* ── Shop Panel ── */
.panel-subtitle { font-size:0.75rem; color:#6b7280; margin-bottom:20px; margin-top:-8px; }
.shop-section-label {
 display:flex; align-items:center; gap:6px; flex-wrap:wrap;
 font-size:0.6rem; font-weight:700; letter-spacing:0.15em; text-transform:uppercase;
 color:#c1121f; margin-bottom:12px;
}
.shop-tier-label { font-size:0.6rem; color:#4b5563; font-weight:400; letter-spacing:0; margin-left:auto; }
.shop-see-all { font-size:0.68rem; color:#4b5563; font-weight:400; letter-spacing:0; margin-left:auto; text-decoration:none; }
.shop-see-all:hover { color:#9ca3af; }

.shop-grid { display:grid; gap:9px; }
.shop-grid-3 { grid-template-columns:repeat(3,1fr); }
.shop-grid-2 { grid-template-columns:repeat(2,1fr); }
@media (max-width:480px) {
 .shop-grid-3 { grid-template-columns:repeat(2,1fr); }
 .shop-grid-2 { grid-template-columns:repeat(2,1fr); }
}

.shop-card {
 background:#161616; border:1px solid #1f1f1f; border-radius:10px;
 overflow:hidden; display:flex; flex-direction:column;
 cursor:pointer; transition:border-color 0.18s;
}
.shop-card:hover { border-color:#2a2a2a; }
.shop-card.hot { border-color:rgba(193,18,31,0.30); }
.shop-card.hot:hover { border-color:rgba(193,18,31,0.55); }
.shop-card.plat { border-color:rgba(185,242,255,0.18); }
.shop-card.plat:hover { border-color:rgba(185,242,255,0.35); }

.shop-card-img {
 height:110px; overflow:hidden; position:relative;
 background:#1a1a1a; flex-shrink:0;
}
.shop-card-img img {
 width:100%; height:100%; object-fit:cover; object-position:center;
 display:block; transition:transform 0.35s ease;
}
.shop-card:hover .shop-card-img img { transform:scale(1.07); }
.shop-card.plat .shop-card-img::after {
 content:''; position:absolute; inset:0;
 background:linear-gradient(180deg,transparent 30%,rgba(10,5,20,0.5) 100%);
}
.shop-card-badge {
 position:absolute; top:7px; left:7px; z-index:1;
 font-size:0.54rem; font-weight:800; padding:2px 7px; border-radius:3px;
 letter-spacing:0.07em; text-transform:uppercase;
}
.badge-hot { background:rgba(193,18,31,0.92); color:#fff; }
.badge-top { background:rgba(251,191,36,0.92); color:rgba(69,26,3,1); }
.badge-new { background:rgba(74,222,128,0.9); color:rgba(5,46,22,1); }
.badge-lock { background:rgba(185,242,255,0.12); color:#B9F2FF; border:1px solid rgba(185,242,255,0.22); display:flex; align-items:center; gap:3px; }

.shop-card-body { padding:10px 11px 12px; flex:1; display:flex; flex-direction:column; }
.shop-card-name { font-size:0.82rem; font-weight:700; color:#e5e7eb; margin-bottom:2px; line-height:1.3; }
.shop-card-sub { font-size:0.67rem; color:#6b7280; margin-bottom:7px; flex:1; line-height:1.4; }
.shop-card-tag { display:inline-flex; align-items:center; gap:4px; font-size:0.58rem; font-weight:700; padding:2px 7px; border-radius:3px; margin-bottom:8px; }
.tag-price { background:rgba(255,255,255,0.05); color:#9ca3af; }
.tag-disc { background:rgba(193,18,31,0.12); color:#c1121f; }
.tag-lock { background:rgba(185,242,255,0.10); color:#B9F2FF; }

.shop-card-btn {
 width:100%; padding:7px 10px; border-radius:6px; border:none;
 font-size:0.67rem; font-weight:700; cursor:pointer;
 display:flex; align-items:center; justify-content:center; gap:5px;
 margin-top:auto; transition:opacity 0.15s;
}
.btn-shop-red { background:#c1121f; color:#fff; }
.btn-shop-ghost { background:transparent; border:1px solid #2a2a2a; color:#6b7280; }
.btn-shop-plat { background:rgba(185,242,255,0.10); border:1px solid rgba(185,242,255,0.20); color:#B9F2FF; }
.shop-card-btn:hover { opacity:0.82; }

.shop-more-card {
 display:flex; align-items:center; justify-content:center; flex-direction:column;
 gap:8px; min-height:160px;
 border:1px dashed #222; border-radius:10px; cursor:pointer;
 color:#374151; text-decoration:none; transition:border-color 0.2s, color 0.2s;
}
.shop-more-card:hover { border-color:#333; color:#6b7280; }
.shop-more-card span { font-size:0.67rem; text-align:center; line-height:1.5; }

.shop-upgrade-cta {
 margin-top:22px; background:rgba(13,8,30,1);
 border:1px solid rgba(185,242,255,0.18); border-radius:10px;
 padding:16px 18px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
}
.suc-info { flex:1; }
.suc-title {
 font-size:0.88rem; font-weight:700; color:#B9F2FF; margin-bottom:5px;
 display:flex; align-items:center; gap:7px;
}
.suc-desc { font-size:0.72rem; color:#6b7280; line-height:1.55; }
.suc-perks { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }
.suc-perk { display:inline-flex; align-items:center; gap:4px; font-size:0.58rem; background:rgba(185,242,255,0.08); color:#B9F2FF; padding:2px 7px; border-radius:3px; }
.suc-btn {
 background:linear-gradient(135deg,#7c3aed,#5b21b6); color:#fff; border:none;
 padding:10px 16px; border-radius:7px; font-size:0.75rem; font-weight:700;
 cursor:pointer; flex-shrink:0; white-space:nowrap; display:flex; align-items:center; gap:6px;
}
.suc-btn:hover { opacity:0.88; }
```

- [ ] **Step 2: Commit**

```bash
git add css/dashboard.css
git commit -m "feat(dashboard): shop tab CSS — cards, grid, badge, CTA styles"
```

---

## Task 9: Shop Tab — JS Render

**Files:**
- Modify: `js/dashboard.js` (tambah `renderShop()`)

- [ ] **Step 1: Tambah konstanta produk & servis**

Tambah setelah konstanta `BENEFITS`:

```js
const PRODUCTS = [
 { id:'p1', name:'Redbox Clay', sub:'Styling clay natural finish', img:'Brand_assets/product/clay.jpeg', price:'Rp 100.000', badge:'Populer', badgeClass:'badge-hot' },
 { id:'p2', name:'Pomade Waterbased',sub:'Hold kuat, mudah dicuci', img:'Brand_assets/product/water_base.jpeg', price:'Rp 100–150k', badge:'Top Pick', badgeClass:'badge-top' },
 { id:'p3', name:'Pomade Oil Based', sub:'Shine tinggi, tahan lama', img:'Brand_assets/product/oil_base.jpeg', price:'Rp 100–150k', badge:'Baru', badgeClass:'badge-new' },
 { id:'p4', name:'Parfum Eleftheree',sub:'Extrait de Parfum — aroma eksklusif', img:'Brand_assets/product/IMG_6532.JPG.jpeg', price:'Rp 150.000', badge:null, badgeClass:'' },
 { id:'p5', name:'Parfum Psyhi', sub:'Extrait de Parfum — woody & intense', img:'Brand_assets/product/psyi.jpeg', price:'Rp 150.000', badge:null, badgeClass:'' },
];

const SERVICES_SHOP = [
 { id:'s1', name:'Gentlemen Grooming', sub:'Haircut · fade · shaving lengkap', img:'Brand_assets/Services/Shaving.jpg', tier:'gold', badgeLabel:'Gold disc 10%', badgeClass:'badge-hot', discount:true },
 { id:'s2', name:'Hairspa', sub:'Perawatan rambut & kulit kepala', img:'Brand_assets/Services/Creambath.jpg', tier:'gold', badgeLabel:'Gold disc 10%', badgeClass:'badge-hot', discount:true },
 { id:'s3', name:"Men's Massage", sub:'Premium service · gratis tiap kunjungan', img:'Brand_assets/Services/Men_Massage_Service.jpg', tier:'platinum', badgeLabel:'Platinum', badgeClass:'badge-lock', discount:false },
 { id:'s4', name:'Iced Americano', sub:'Kopi gratis tiap kunjungan Redbox', img:'https://images.unsplash.com/photo-1630184799082-05623dbdc7f7?w=400&q=75', tier:'platinum', badgeLabel:'Platinum', badgeClass:'badge-lock', discount:false },
];

// Curated product mapping per tier
const CURATED_MAP = {
 bronze: ['p1','p2','p3'],
 silver: ['p1','p2','p3'],
 gold: ['p1','p2','p4'],
 platinum: ['p4','p5','p1'],
};
```

- [ ] **Step 2: Tambah helper `shopCardHtml`**

```js
function shopCardHtml(p, btnLabel, btnClass, isPlat, tagHtml, imgPos) {
 const lockSvg = `<svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
 const arrowSvg = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
 return `
 <div class="shop-card ${isPlat ? 'plat' : (p.badgeClass === 'badge-hot' || p.badgeClass === 'badge-top' ? 'hot' : '')}">
 <div class="shop-card-img">
 <img src="${p.img}" alt="${p.name}" style="object-position:center ${imgPos||'center'}"/>
 ${p.badge || p.badgeLabel ? `<span class="shop-card-badge ${p.badgeClass || ''}">${isPlat ? lockSvg : ''}${p.badge || p.badgeLabel}</span>` : ''}
 </div>
 <div class="shop-card-body">
 <div class="shop-card-name">${p.name}</div>
 <div class="shop-card-sub">${p.sub}</div>
 ${tagHtml}
 <button class="shop-card-btn ${btnClass}">${btnLabel} ${arrowSvg}</button>
 </div>
 </div>`;
}
```

- [ ] **Step 3: Tambah `renderShop`**

```js
// ============================================================
// SHOP TAB
// ============================================================
function renderShop() {
 const userTierIdx = tier.level - 1;
 const waBase = 'https://wa.me/6281234567890?text=Halo%20Redbox%2C%20saya%20ingin%20memesan%20';

 // Subtitle
 const subtitle = document.getElementById('shopSubtitle');
 if (subtitle) subtitle.textContent = `Rekomendasi dipersonalisasi · Tier ${tier.name}`;
 const tierLabel = document.getElementById('shopTierLabel');
 if (tierLabel) tierLabel.textContent = `Tier ${tier.name}`;

 // Section A: Curated
 const curated = document.getElementById('shopCurated');
 if (curated) {
 const ids = CURATED_MAP[tier.class] || CURATED_MAP.bronze;
 curated.innerHTML = ids.map(id => {
 const p = PRODUCTS.find(x => x.id === id);
 if (!p) return '';
 return shopCardHtml(p,
 'Beli via WA', 'btn-shop-red', false,
 `<div class="shop-card-tag tag-price">${p.price}</div>`,
 '35%'
 );
 }).join('');
 // WA click handlers
 curated.querySelectorAll('.shop-card-btn').forEach((btn, i) => {
 const id = ids[i]; const p = PRODUCTS.find(x => x.id === id);
 if (p) btn.onclick = () => window.open(waBase + encodeURIComponent(p.name), '_blank');
 });
 }

 // Section B: All Products
 const allProd = document.getElementById('shopAllProducts');
 if (allProd) {
 const moreCard = `<a href="products.html" class="shop-more-card"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><span>Lihat semua<br/>produk</span></a>`;
 allProd.innerHTML = PRODUCTS.map(p =>
 shopCardHtml(p, 'Detail', 'btn-shop-ghost', false,
 `<div class="shop-card-tag tag-price">${p.price}</div>`, '20%')
 ).join('') + moreCard;
 }

 // Section C: Services
 const servicesEl = document.getElementById('shopServices');
 if (servicesEl) {
 servicesEl.innerHTML = SERVICES_SHOP.map(s => {
 const svcTierIdx = TIERS.findIndex(t => t.class === s.tier);
 const unlocked = ACTIVE && userTierIdx >= svcTierIdx;
 const isPlat = s.tier === 'platinum';
 const tagHtml = unlocked
 ? `<div class="shop-card-tag tag-disc"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>Diskon 10%</div>`
 : `<div class="shop-card-tag tag-lock"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Free — Khusus ${s.tier === 'platinum' ? 'Platinum' : 'Gold'}</div>`;
 const btnLabel = unlocked ? 'Book sekarang' : 'Upgrade ke Platinum';
 const btnClass = unlocked ? 'btn-shop-red' : 'btn-shop-plat';
 return shopCardHtml(s, btnLabel, btnClass, isPlat && !unlocked, tagHtml, '25%');
 }).join('');

 // Service button handlers
 servicesEl.querySelectorAll('.shop-card-btn').forEach((btn, i) => {
 const s = SERVICES_SHOP[i];
 const svcTierIdx = TIERS.findIndex(t => t.class === s.tier);
 const unlocked = ACTIVE && userTierIdx >= svcTierIdx;
 btn.onclick = () => window.location.href = unlocked ? 'booking.html' : 'membership.html';
 });
 }

 // Section D: Upgrade CTA — only if not Platinum
 const ctaEl = document.getElementById('shopUpgradeCta');
 if (ctaEl && userTierIdx < 3) {
 const nextTierObj = TIERS[userTierIdx + 1];
 ctaEl.style.display = 'flex';
 ctaEl.innerHTML = `
 <div class="suc-info">
 <div class="suc-title">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8l10-6 10 6v8l-10 6L2 16V8z"/><polyline points="2 8 12 14 22 8"/><line x1="12" y1="14" x2="12" y2="20"/></svg>
 Upgrade ke ${nextTierObj.name}
 </div>
 <div class="suc-desc">Upgrade tier berbayar — nikmati benefit eksklusif ${nextTierObj.name}: free service, diskon lebih besar, dan akses prioritas.</div>
 <div class="suc-perks">
 ${nextTierObj.class === 'platinum'
 ? ['Free Grooming','Free Americano','Birthday Gratis','Semua Cabang'].map(p => `<span class="suc-perk"><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>${p}</span>`).join('')
 : ['Multiplier Poin','Diskon Layanan','Cashback Rewards'].map(p => `<span class="suc-perk"><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>${p}</span>`).join('')
 }
 </div>
 </div>
 <button class="suc-btn" onclick="window.location.href='membership.html'">
 Upgrade Sekarang
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
 </button>`;
 }
}

renderShop();
```

- [ ] **Step 4: Verifikasi**

1. Klik tab "Shop"
2. Section A: 3 produk sesuai tier (Gold → Clay + Waterbased + Eleftheree)
3. Section B: 5 produk + card "Lihat semua"
4. Section C: Gentlemen Grooming + Hairspa dengan badge "Gold disc 10%", Men's Massage + Iced Americano locked untuk Platinum
5. Section D: CTA "Upgrade ke Platinum" terlihat untuk Gold user
6. Test Platinum user → service cards terbuka semua, CTA section tersembunyi

- [ ] **Step 5: Commit**

```bash
git add js/dashboard.js
git commit -m "feat(dashboard): shop tab — curated products, all products, service upsell, upgrade CTA"
```

---

## Task 10: Inactive Member Gate + Final Polish

**Files:**
- Modify: `js/dashboard.js` (gate Shop + Benefits tab untuk inactive member)
- Modify: `member-dashboard.html` (minor teks polish)

- [ ] **Step 1: Gate Shop tab untuk INACTIVE member**

Di `renderShop()`, tambahkan check di awal fungsi:

```js
function renderShop() {
 if (!ACTIVE) {
 // Show activation prompt instead
 const shopPanel = document.getElementById('panel-shop');
 if (shopPanel) shopPanel.innerHTML = `
 <h2 class="panel-title">Shop</h2>
 <div class="inactive-gate">
 <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c1121f" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
 <h3>Aktifkan Membership</h3>
 <p>Aktivasi membership untuk mengakses Shop, rekomendasi produk, dan upsell layanan premium.</p>
 <a href="membership.html" class="ub-btn" style="text-decoration:none;display:inline-block;margin-top:12px">Aktivasi Sekarang</a>
 </div>`;
 return;
 }
 // ... sisa kode renderShop ...
```

- [ ] **Step 2: Tambah CSS inactive gate**

```css
/* ── Inactive Gate ── */
.inactive-gate { text-align:center; padding:48px 24px; color:#4b5563; }
.inactive-gate svg { margin-bottom:16px; }
.inactive-gate h3 { font-size:1rem; font-weight:700; color:#e5e7eb; margin-bottom:8px; }
.inactive-gate p { font-size:0.78rem; line-height:1.6; max-width:320px; margin:0 auto; }
```

- [ ] **Step 3: Verifikasi full flow**

Test dengan 3 state berbeda via DevTools console:

**Inactive:**
```js
localStorage.setItem('redbox_member', JSON.stringify({points:0, membership_status:'INACTIVE', visits:0, reviews:0, pointsHistory:[], joinDate:new Date().toISOString()}))
```

**Gold Active:**
```js
localStorage.setItem('redbox_member', JSON.stringify({points:1800, membership_status:'ACTIVE', visits:12, reviews:3, pointsHistory:[], joinDate:new Date().toISOString()}))
```

**Platinum Active:**
```js
localStorage.setItem('redbox_member', JSON.stringify({points:3500, membership_status:'ACTIVE', visits:30, reviews:8, pointsHistory:[], joinDate:new Date().toISOString()}))
```

Untuk setiap state, verifikasi:
- [ ] Banner muncul dengan warna + teks sesuai tier
- [ ] Tab Benefits & Rewards: benefit tracker menampilkan unlock/lock states benar
- [ ] Tab Shop: konten sesuai tier, atau gate "Aktivasi" jika INACTIVE
- [ ] Service cards Gold: tombol "Book sekarang", Platinum: locked dengan "Upgrade ke Platinum"
- [ ] CTA block tersembunyi untuk Platinum user
- [ ] Tidak ada error di browser console

- [ ] **Step 4: Final commit**

```bash
git add member-dashboard.html js/dashboard.js css/dashboard.css
git commit -m "feat(dashboard): inactive gate for shop tab + final polish

- Gate shop tab dengan activation prompt untuk INACTIVE member
- Gate benefit tracker menampilkan state tidak aktif
- Smart banner, Benefits & Rewards tab, Shop tab semua terhubung ke tier system"
```
