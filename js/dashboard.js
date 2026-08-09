// ================================================
// MEMBER DASHBOARD v2 - Redbox Barbershop
// Full membership status + point system logic
// ================================================

// Membership data consolidated to PRIMARY Supabase (was on separate project
// 'adhit24's Project' that was deleted 2026-05-28).
const SUPABASE_URL = 'https://khcvklzxfohwkyocenaf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoY3ZrbHp4Zm9od2t5b2NlbmFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTE0ODksImV4cCI6MjA5Mjg2NzQ4OX0.YlqcppDA7xB4ZpOstzjFsnt_0v4nPf09kRXdLf1bCAk';

window.toggleMemberNav = function (button) {
 const navLinks = document.getElementById('navLinks');
 if (!navLinks) return;
 const isOpen = !navLinks.classList.contains('open');
 button.classList.toggle('active', isOpen);
 navLinks.classList.toggle('open', isOpen);
 button.setAttribute('aria-expanded', String(isOpen));
 document.body.style.overflow = isOpen ? 'hidden' : '';
};

async function sbFetch(path, opts = {}) {
 const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
 ...opts,
 headers: {
 'apikey': SUPABASE_ANON,
 'Authorization': 'Bearer ' + SUPABASE_ANON,
 'Content-Type': 'application/json',
 'Prefer': opts.prefer || 'return=representation',
 ...(opts.headers || {})
 }
 });
 if (!res.ok && res.status !== 406) return null;
 return res.json().catch(() => null);
}

document.addEventListener('DOMContentLoaded', () => {

 // ---- Mobile navbar must be wired before member data initialization ----
 const hamburger = document.getElementById('hamburger');
 const navLinksEl = document.getElementById('navLinks');
 if (hamburger && navLinksEl) {
  const closeMobileMenu = () => {
   hamburger.classList.remove('active');
   navLinksEl.classList.remove('open');
   hamburger.setAttribute('aria-expanded', 'false');
   document.body.style.overflow = '';
  };
  navLinksEl.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMobileMenu));
 }

 // ---- Check login state ----
 const userData = JSON.parse(localStorage.getItem('redbox_user') || 'null');
 const rbToken = localStorage.getItem('rb_member_token');
 if (!rbToken && (!userData || !userData.loggedIn)) {
 window.location.href = 'member-login.html';
 return;
 }

 // ============================================================
 // CONSTANTS
 // ============================================================
 const TIERS = [
 { name:'Bronze', min:0, max:499, class:'bronze', color:'#CD7F32', glow:'rgba(205,127,50,.5)', label:'Level 1' },
 { name:'Silver', min:500, max:1499, class:'silver', color:'#C0C0C0', glow:'rgba(192,192,192,.5)', label:'Level 2' },
 { name:'Gold', min:1500, max:2999, class:'gold', color:'#FFD700', glow:'rgba(255,215,0,.5)', label:'Level 3' },
 { name:'Platinum', min:3000, max:Infinity, class:'platinum', color:'#C4B5FD', glow:'rgba(196,181,253,.5)', label:'Level 4' }
 ];

 const REWARDS = [
 { id:'r1', tier:'bronze', name:'Mug Redbox For Free', desc:'Dapatkan mug eksklusif Redbox secara gratis.', cost:75, icon:'', type:'redeem' },
 { id:'r2', tier:'bronze', name:'Free Redbox Oilbased Mini', desc:'Dapatkan produk oilbased mini eksklusif Redbox secara gratis.', cost:75, icon:'', type:'redeem' },
 { id:'r3', tier:'silver', name:'Free Baileys Coffee', desc:'Nikmati segelas Baileys Coffee gratis dari Redbox.', cost:100, icon:'', type:'redeem' },
 { id:'r4', tier:'silver', name:'Free Express Cleaning (All Varians)', desc:'Layanan express cleaning untuk semua varian secara gratis.', cost:100, icon:'', type:'redeem' },
 { id:'r7', tier:'gold', name:'Free Haircut / Fadecut', desc:'Haircut atau Fadecut gratis pilihan kamu.', cost:200, icon:'', type:'redeem' },
 { id:'r8', tier:'platinum', name:'Free Gentlemen Grooming', desc:'Layanan Gentlemen Grooming lengkap gratis untukmu.', cost:250, icon:'', type:'redeem' },
 { id:'r9', tier:'platinum', name:'Free Fadecut Grooming', desc:'Layanan Fadecut Grooming eksklusif gratis untukmu.', cost:250, icon:'', type:'redeem' },
 ];

 const BENEFITS = [
 // Bronze (3)
 { tier:'bronze', name:'Akses dashboard member', desc:'Lihat riwayat kunjungan, poin, dan profil.', auto:true },
 { tier:'bronze', name:'Kode referral', desc:'Bagikan kode, dapat bonus poin tiap teman daftar.', auto:true },
 { tier:'bronze', name:'Riwayat kunjungan & poin', desc:'Pantau semua aktivitas membership kamu.', auto:true },
 // Silver (2)
 { tier:'silver', name:'Diskon 50% saat birthday', desc:'Berlaku 7 hari sebelum sampai 7 hari sesudah tanggal ulang tahun.', auto:true },
 { tier:'silver', name:'Akses Katalog Produk', desc:'Beli produk Redbox langsung dari dashboard.', auto:true },
 // Gold (2)
 { tier:'gold', name:'Diskon 50% saat birthday', desc:'Berlaku 7 hari sebelum sampai 7 hari sesudah tanggal ulang tahun.', auto:true },
 { tier:'gold', name:'Diskon 10% layanan', desc:'Berlaku di semua cabang kecuali CSB Mall.', auto:true },
 // Platinum (5)
 { tier:'platinum', name:'Diskon 50% saat birthday', desc:'Berlaku 7 hari sebelum sampai 7 hari sesudah tanggal ulang tahun.', auto:true },
 { tier:'platinum', name:'Free Gentlemen Grooming', desc:'Layanan grooming gratis tiap kunjungan.', auto:true },
 { tier:'platinum', name:'Free Iced Americano', desc:'Kopi gratis tiap kunjungan ke Redbox.', auto:true },
 { tier:'platinum', name:'Priority semua cabang', desc:'Akses priority booking di seluruh cabang Redbox.', auto:true },
 ];

 const PRODUCTS = [
 { id:'clay', name:'Redbox Clay', sub:'Styling clay natural finish', price:'Rp 100.000', img:'Brand_assets/product/clay.jpeg', badge:'Populer' },
 { id:'water', name:'Pomade Waterbased', sub:'Formula water-based rinse', price:'Rp 100.000-150.000',img:'Brand_assets/product/water_base.jpeg', badge:null },
 { id:'oil', name:'Pomade Oil Based', sub:'Hold kuat tahan lama', price:'Rp 100.000-150.000',img:'Brand_assets/product/oil_base.jpeg', badge:null },
 { id:'elfree', name:'Parfum Eleftheree', sub:'Aroma segar maskulin', price:'Rp 150.000', img:'Brand_assets/product/IMG_6532.JPG.jpeg', badge:null },
 { id:'psyhi', name:'Parfum Psyhi', sub:'Aroma woody premium', price:'Rp 150.000', img:'Brand_assets/product/psyi.jpeg', badge:null },
 ];

 const SERVICES_SHOP = [
 { id:'grooming', name:'Gentlemen Grooming', sub:'Cukur + styling presisi', img:'Brand_assets/Services/Shaving.jpg', tier:'gold', discount:'Disc 10%*' },
 { id:'hairspa', name:'Hairspa', sub:'Perawatan kulit kepala', img:'Brand_assets/Services/Creambath.jpg', tier:'gold', discount:'Disc 10%*' },
 { id:'massage', name:"Men's Massage", sub:'Pijat relaksasi premium', img:'Brand_assets/Services/Men_Massage_Service.jpg', tier:'platinum', discount:null },
 { id:'americano',name:'Iced Americano', sub:'Free tiap kunjungan Platinum', img:'https://images.unsplash.com/photo-1630184799082-05623dbdc7f7?w=400&q=75', tier:'platinum', discount:null },
 ];

 // Curated recommendations by tier (product IDs)
 const CURATED_MAP = {
 bronze: ['clay','water','oil'],
 silver: ['clay','water','oil'],
 gold: ['clay','water','elfree'],
 platinum: ['elfree','psyhi','clay'],
 };

 const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

 // ============================================================
 // STATE
 // ============================================================
 const defaultMember = {
 points: 0, visits: 0, reviews: 0,
 phone: '', birthdate: '', gender: 'male',
 address: '', favBarber: '',
 referralCode: '', referralCount: 0, referralPoints: 0,
 joinDate: new Date().toISOString(),
 membership_status: 'INACTIVE',
 current_tier: 'bronze',
 membership_activated_at: null,
 membership_started_at: null,
 membership_expires_at: null,
 pointsHistory: []
 };

 const memberData = Object.assign({}, defaultMember,
 JSON.parse(localStorage.getItem('redbox_member') || 'null') || {});

 if (!memberData.membership_status) memberData.membership_status = 'INACTIVE';

 // ── KEY LOGIC: paid access requires an unexpired period; undated legacy ACTIVE stays compatible ──
 function memberHasActiveAccess(record = memberData) {
 return window.RedboxMembership.isActiveMembership(record);
 }
 let ACTIVE = memberHasActiveAccess();
 // Legacy members keep their historical points and may redeem base rewards.
 // Paid tier benefits remain gated by ACTIVE paid-period access.
 let point_system = true;
 function refreshMembershipAccess() {
 ACTIVE = memberHasActiveAccess();
 point_system = true;
 return ACTIVE;
 }

 // Referral code
 if (!memberData.referralCode) {
 const n = (userData.name||'MBR').replace(/\s/g,'').substring(0,4).toUpperCase();
 memberData.referralCode = 'RBX-' + n + Math.floor(Math.random()*9000+1000);
 save();
 }

 function save() { localStorage.setItem('redbox_member', JSON.stringify(memberData)); }

 // ============================================================
 // UTILITIES
 // ============================================================
 function animateCount(el, target, duration) {
 if (!el) return;
 const startTime = performance.now();
 function step(now) {
 const p = Math.min((now - startTime) / duration, 1);
 const e = 1 - Math.pow(1 - p, 3);
 el.textContent = Math.floor(e * target).toLocaleString('id-ID');
 if (p < 1) requestAnimationFrame(step);
 }
 requestAnimationFrame(step);
 }

 function getCurrentTier(pts) {
 for (let i = TIERS.length - 1; i >= 0; i--)
 if (pts >= TIERS[i].min) return { ...TIERS[i], level: i + 1 };
 return { ...TIERS[0], level: 1 };
 }

 function getDisplayTier(pts) {
 const configured = String(memberData.current_tier || '').toLowerCase();
 return TIERS.find(t => t.class === configured) || getCurrentTier(pts);
 }

 function tierLevelOf(tierClass) {
 const idx = TIERS.findIndex(t => t.class === tierClass);
 return idx >= 0 ? idx : 0;
 }

 function fmtDate(iso) {
 const d = new Date(iso);
 return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
 }

 // ============================================================
 // PROFILE POPULATION
 // ============================================================
 const profileName = document.getElementById('profileName');
 const profileSince = document.getElementById('profileSince');
 const avatarInitials = document.getElementById('avatarInitials');
 const avatarImage = document.getElementById('avatarImage');
 const statVisits = document.getElementById('statVisits');
 const statReviews = document.getElementById('statReviews');
 const statPoints = document.getElementById('statPoints');

 if (profileName) profileName.textContent = userData.name || 'Member Redbox';
 if (profileSince) {
 const d = new Date(memberData.joinDate);
 profileSince.textContent = `Bergabung sejak ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
 }
 if (userData.picture && avatarImage) {
 avatarImage.src = userData.picture; avatarImage.style.display = 'block';
 if (avatarInitials) avatarInitials.style.display = 'none';
 } else if (avatarInitials && userData.name) {
 const parts = userData.name.split(' ');
 avatarInitials.textContent = (parts[0]?.[0]||'') + (parts[1]?.[0]||'');
 }

 const displayPoints = ACTIVE ? memberData.points : 0;
 animateCount(statVisits, memberData.visits, 800);
 animateCount(statReviews, memberData.reviews, 800);
 animateCount(statPoints, displayPoints, 1200);

 // cardTier still referenced below for tier label text
 const cardTier = document.getElementById('cardTier');

 // ============================================================
 // MEMBERSHIP STATUS UI
 // ============================================================
 const activationBanner = document.getElementById('activationBanner');
 const tierLockOverlay = document.getElementById('tierLockOverlay');
 const memberStatusBadge = document.getElementById('memberStatusBadge');
 const tierBadge = document.getElementById('profileTierBadge');
 const tierBadgeText = document.getElementById('tierBadgeText');

 const tier = getDisplayTier(displayPoints);
 window.RedboxTierTheme.applyTierTheme(ACTIVE ? tier.class : 'bronze');

 // ============================================================
 // SMART UPSELL BANNER
 // ============================================================
 function renderUpsellBanner(tier) {
 const banner = document.getElementById('upsellBanner');
 if (!banner) return;

 const configs = {
 silver: { title:'Silver Member - Kumpulkan Poin Reward', desc:'Poin dapat ditukar dengan produk dan layanan Redbox sesuai katalog rewards.', cta:'Lihat Katalog Rewards', ctaClass:'' },
 gold: { title:'Gold Member - Kumpulkan Poin Reward', desc:'Gunakan poinmu untuk redeem produk dan layanan Redbox yang tersedia.', cta:'Lihat Katalog Rewards', ctaClass:'' },
 platinum: { title:'Platinum Member - Kumpulkan Poin Reward', desc:'Nikmati benefit Platinum dan tukarkan poin dengan produk atau layanan pilihanmu.', cta:'Lihat Katalog Rewards', ctaClass:'plat' },
 };
 const cfg = configs[tier.class] || configs.silver;

 // Tier accent colors for progress bar
 const progressColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#C4B5FD' };
 const accentColor = progressColors[tier.class] || '#c1121f';

 // Tier SVG icons (24×24 stroke)
 const tierIcons = {
 silver: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C0C0C0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
 gold: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
 platinum: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l10-6 10 6v8l-10 6L2 16V8z"/><polyline points="2 8 12 14 22 8"/><line x1="12" y1="14" x2="12" y2="20"/></svg>`,
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

 // Poin tidak lagi menjadi progres kenaikan tier. Tier ditentukan saat pembelian.
 if (ubProgressWrap) {
 ubProgressWrap.style.display = 'none';
 }

 // CTA button
 if (ubActions) {
 ubActions.innerHTML = cfg.cta
 ? `<button class="ub-btn ${cfg.ctaClass}" onclick="document.querySelector('.dash-nav-item[data-tab=\\'benefits\\']')?.click()">${cfg.cta}</button>`
 : '';
 }

 // Show banner + apply tier class
 banner.className = `upsell-banner tier-${tier.class}`;
 banner.style.display = 'flex';
 }

 // Call after tier is determined
 renderUpsellBanner(tier);

 if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (ACTIVE ? tier.class : 'inactive');
 if (tierBadgeText) tierBadgeText.textContent = ACTIVE ? `${tier.label} - ${tier.name}` : 'Membership Belum Aktif';
 if (cardTier) cardTier.textContent = ACTIVE ? tier.name.toUpperCase() + ' MEMBER' : 'INACTIVE';

 const activationBannerTop = document.getElementById('activationBannerTop');
 const physCardWrap = document.getElementById('physCardWrap');
 const physCardHint = document.getElementById('physCardHint');

 if (!ACTIVE) {
 if (activationBanner) activationBanner.style.display = 'none';
 if (activationBannerTop) activationBannerTop.style.display = 'block';
 if (tierLockOverlay) tierLockOverlay.style.display = 'flex';
 if (memberStatusBadge) { memberStatusBadge.textContent = 'Membership Belum Aktif'; memberStatusBadge.className = 'member-status-badge inactive'; }
 if (physCardWrap) physCardWrap.classList.add('inactive');
 if (physCardHint) physCardHint.textContent = 'Aktivasi untuk dapatkan kartu fisik eksklusif ini';
 document.querySelectorAll('.requires-active').forEach(el => {
 el.classList.add('locked-feature');
 });
 } else {
 if (activationBanner) activationBanner.style.display = 'none';
 if (tierLockOverlay) tierLockOverlay.style.display = 'none';
 if (memberStatusBadge) { memberStatusBadge.textContent = ' Membership Aktif'; memberStatusBadge.className = 'member-status-badge active'; }
 if (physCardWrap) physCardWrap.classList.remove('inactive');
 if (physCardHint) physCardHint.textContent = ' Kartu fisik kamu sudah aktif';
 // Apply tier glow to tier card
 const tierCard = document.querySelector('.tier-card');
 if (tierCard) tierCard.style.boxShadow = `0 0 40px ${tier.glow}, inset 0 0 60px ${tier.glow.replace('.5','0.04')}`;
 }

 // ============================================================
 // REWARDS RENDER
 // ============================================================
 // Update rewards points display
 const rewardsPointsDisplay = document.getElementById('rewardsPointsDisplay');
 if (rewardsPointsDisplay) rewardsPointsDisplay.textContent = `${memberData.points.toLocaleString('id-ID')} Poin tersedia`;

 const rewardsGrid = document.getElementById('rewardsGrid');
 if (rewardsGrid) {
 rewardsGrid.innerHTML = REWARDS.map(r => {
 const rTierIdx = tierLevelOf(r.tier);
 const userTierIdx = tier.level - 1;
 const unlocked = rTierIdx === 0 || (ACTIVE && userTierIdx >= rTierIdx);
 const tierInfo = TIERS[rTierIdx];
 return `
 <div class="reward-card ${unlocked ? 'unlocked' : 'locked'} tier-${r.tier}">
 ${!unlocked ? '<div class="reward-lock-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11H5V21H19V11ZM17 9V7A5 5 0 0 0 7 7V9H17ZM12 14A2 2 0 1 0 12 18 2 2 0 0 0 12 14Z"/></svg></div>' : ''}
 <div class="reward-icon">${r.icon}</div>
 <div class="reward-meta">
 <span class="reward-tier-label">${tierInfo.name}</span>
 <h4 class="reward-name">${r.name}</h4>
 <p class="reward-desc">${r.desc}</p>
 </div>
 ${r.type === 'redeem' && r.cost > 0
 ? `<button class="reward-btn ${unlocked ? '' : 'disabled'}" data-id="${r.id}" data-cost="${r.cost}" ${!unlocked ? 'disabled' : ''}>${unlocked ? `Tukar ${r.cost} Poin` : ` ${tierInfo.name}+`}</button>`
 : `<span class="reward-badge-auto">${unlocked ? 'Aktif Otomatis' : ` ${tierInfo.name}+`}</span>`
 }
 </div>`;
 }).join('');

 // Redeem handler
 rewardsGrid.querySelectorAll('.reward-btn:not(.disabled)').forEach(btn => {
 btn.addEventListener('click', () => {
 const cost = parseInt(btn.dataset.cost);
 if (!point_system) return;
 if (memberData.points < cost) {
 showToast(`Poin tidak cukup. Butuh ${cost} poin.`, 'error'); return;
 }
 if (!confirm(`Tukar ${cost} poin untuk reward ini?`)) return;
 memberData.points -= cost;
 memberData.pointsHistory.unshift({ date: new Date().toLocaleDateString('id-ID'), activity: 'Redeem reward: ' + btn.closest('.reward-card').querySelector('.reward-name').textContent, amount: -cost });
 save();
 animateCount(statPoints, memberData.points, 600);
 animateCount(document.getElementById('pointsBalance'), memberData.points, 600);
 renderPointsHistory();
 showToast('Reward berhasil ditukar! Tunjukkan ke staff Redbox.', 'success');
 });
 });
 }

 // ============================================================
 // BENEFIT TRACKER
 // ============================================================
 function renderBenefitTracker() {
 const container = document.getElementById('benefitTracker');
 if (!container) return;

 const tierNames = ['Bronze','Silver','Gold','Platinum'];
 const tierColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#C4B5FD' };
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

 // ============================================================
 // TIER MAP
 // ============================================================
 function renderTierMap(tier) {
 const container = document.getElementById('tierMapContainer');
 if (!container) return;

 const headline = ACTIVE
 ? `Poin kamu: <strong>${(memberData.points||0).toLocaleString('id-ID')}</strong>. Tukarkan di Katalog Rewards.`
 : 'Aktivasi membership untuk membuka tier dan mulai kumpulkan poin.';

 const userIdx = ACTIVE ? tierLevelOf(tier.class) : -1;

 const rows = TIERS.map((t, idx) => {
 const isCurrent = ACTIVE && idx === userIdx;
 const isBelowCurrent = ACTIVE && idx < userIdx;
 const rowClass = isCurrent ? 'current' : (isBelowCurrent ? 'unlocked' : '');
 const statusHtml = isCurrent
 ? '<span class="tier-map-status current">Tier saat ini</span>'
 : isBelowCurrent
 ? '<span class="tier-map-status unlocked">Unlocked</span>'
 : t.class === 'bronze'
 ? '<span class="tier-map-status unlocked">Otomatis</span>'
 : `<a class="tier-map-upgrade" href="member-register.html?tier=${t.class}">Upgrade</a>`;
 return `
 <div class="tier-map-row ${rowClass}" data-tier="${t.class}">
 <div class="tier-map-dot"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>
 <div class="tier-map-info">
 <span class="tier-map-name">${t.name}</span>
 <span class="tier-map-benefit">${t.label}</span>
 </div>
 ${statusHtml}
 </div>`;
 }).join('');

 container.innerHTML = `${rows}<div class="tier-message"><p>${headline}</p></div>`;
 }

 renderTierMap(tier);

 // ============================================================
 // REDEEM HISTORY
 // ============================================================
 function renderRedeemHistory() {
 const container = document.getElementById('redeemHistory');
 if (!container) return;

 // Filter pointsHistory for redeem transactions (negative amount)
 const redeems = (memberData.pointsHistory || [])
 .filter(h => h.amount < 0 && (h.activity || '').toLowerCase().includes('redeem'));

 if (!redeems.length) {
 container.innerHTML = `
 <div class="redeem-empty">
 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
 <span>Belum ada riwayat redeem - tukar poin kamu di katalog bawah</span>
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

 // ============================================================
 // SHOP
 // ============================================================
 function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

 function shopCardHtml(p) {
 if (!p) return '';
 const badgeHtml = p.badge
 ? `<span class="shop-badge badge-${p.badge==='New'?'new':'red'}">${esc(p.badge)}</span>` : '';
 return `
 <div class="shop-card red">
 <div class="shop-card-img">
 <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy"/>
 ${badgeHtml}
 </div>
 <div class="shop-card-body">
 <div class="shop-card-name">${esc(p.name)}</div>
 <div class="shop-card-sub">${esc(p.sub)}</div>
 <span class="shop-tag tag-price">${esc(p.price)}</span>
 <button class="shop-btn shop-btn-red" onclick="window.open('https://wa.me/6289635379441?text=Halo%20Redbox%2C%20saya%20ingin%20memesan%20${encodeURIComponent(p.name)}','_blank')">
 <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.555 4.13 1.535 5.875L.057 23.857c-.072.267.162.501.43.43l6.062-1.476A11.965 11.965 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.98 0-3.849-.576-5.42-1.566l-.39-.23-3.6.876.893-3.51-.253-.4A9.962 9.962 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
 Beli via WA
 </button>
 </div>
 </div>`;
 }

 function renderShop() {
 const curatedEl = document.getElementById('shopCurated');
 const productsEl = document.getElementById('shopProducts');
 const servicesEl = document.getElementById('shopServices');
 const ctaEl = document.getElementById('shopUpgradeCta');
 if (!curatedEl || !productsEl || !servicesEl) return;

 if (!ACTIVE) {
 const inactiveSvg = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
 const inactiveHtml = `
 <div style="text-align:center;padding:40px 20px;color:#4b5563;">
 ${inactiveSvg}
 <p style="margin-top:12px;font-size:0.8rem;">Aktivasi membership untuk mengakses Shop.</p>
 <p style="margin-top:14px;font-size:0.75rem;">Gunakan tombol aktivasi di bagian atas halaman.</p>
 </div>`;
 curatedEl.closest('#panel-shop').innerHTML = inactiveHtml;
 return;
 }

 const tierKey = ACTIVE ? tier.class : 'bronze';
 const tierIdx = ACTIVE ? (tier.level - 1) : 0;
 const isGold = tierIdx >= 2;
 const isPlat = tierIdx >= 3;

 // Section A: Curated
 const curatedIds = CURATED_MAP[tierKey] || CURATED_MAP.bronze;
 curatedEl.innerHTML = curatedIds
 .map(id => { const p = PRODUCTS.find(x => x.id === id); return p ? shopCardHtml(p) : ''; })
 .join('');

 // Section B: All products (5 + "Lihat semua" card)
 productsEl.innerHTML = PRODUCTS.map(shopCardHtml).join('') + `
 <a href="products.html" class="shop-more-card">
 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
 <span>Lihat semua<br>produk →</span>
 </a>`;

 // Section C: Service upsell cards
 servicesEl.innerHTML = SERVICES_SHOP.map(s => {
 const locked = s.tier === 'platinum' ? !isPlat : !isGold;
 const cardClass = s.tier === 'platinum' ? 'plat' : 'red';
 const badgeHtml = locked
 ? `<span class="shop-badge badge-lock"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>${s.tier==='platinum'?'Platinum':'Gold'}+</span>`
 : s.discount
 ? `<span class="shop-badge badge-gold">${s.discount}</span>`
 : '';
 const tagHtml = locked
 ? `<span class="shop-tag tag-lock">${s.tier==='platinum'?' Platinum':' Gold+'}</span>`
 : s.discount
 ? `<span class="shop-tag tag-disc">${s.discount} untuk kamu</span>`
 : '';
 const btnHtml = locked
 ? `<span class="shop-tag tag-lock">Tersedia untuk ${s.tier === 'platinum' ? 'Platinum' : 'Gold'}</span>`
 : `<button class="shop-btn shop-btn-red" onclick="location.href='booking.html'">Book sekarang</button>`;
 return `
 <div class="shop-card ${cardClass}">
 <div class="shop-card-img">
 <img src="${esc(s.img)}" alt="${esc(s.name)}" loading="lazy"/>
 ${badgeHtml}
 </div>
 <div class="shop-card-body">
 <div class="shop-card-name">${esc(s.name)}</div>
 <div class="shop-card-sub">${esc(s.sub)}</div>
 ${tagHtml}
 ${btnHtml}
 </div>
 </div>`;
 }).join('');

 // Section D: higher tiers are purchased during registration, not with points.
 if (!ctaEl) return;
 ctaEl.innerHTML = '';
 }

 renderShop();

 // ============================================================
 // MOBILE NAV HAMBURGER
 // ============================================================
 const dashSidebar = document.getElementById('dashSidebar');
 const dashNavToggle = document.getElementById('dashNavToggle');
 const dashNavBackdrop = document.getElementById('dashNavBackdrop');

 function openNav() { dashSidebar.classList.add('open'); dashNavBackdrop.classList.add('open'); }
 function closeNav() { dashSidebar.classList.remove('open'); dashNavBackdrop.classList.remove('open'); }

 if (dashNavToggle) dashNavToggle.addEventListener('click', openNav);
 if (dashNavBackdrop) dashNavBackdrop.addEventListener('click', closeNav);

 // ============================================================
 // TAB SWITCHING
 // ============================================================
 const navItems = document.querySelectorAll('.dash-nav-item[data-tab]');
 const panels = document.querySelectorAll('.dash-panel');
 navItems.forEach(item => {
 item.addEventListener('click', () => {
 const tab = item.dataset.tab;
 navItems.forEach(n => n.classList.remove('active'));
 item.classList.add('active');
 panels.forEach(p => { p.classList.remove('active'); if (p.id === 'panel-'+tab) p.classList.add('active'); });
 closeNav(); // close sidebar drawer after selecting tab on mobile
 });
 });

 // ============================================================
 // ACCOUNT FORM
 // ============================================================
 const accName = document.getElementById('accName');
 const accPhone = document.getElementById('accPhone');
 const accEmail = document.getElementById('accEmail');
 const accBirth = document.getElementById('accBirth');
 const accAddr = document.getElementById('accAddr');
 const accBarber = document.getElementById('accFavBarber');
 const accountForm= document.getElementById('accountForm');

 if (accName) accName.value = userData.name || '';
 if (accPhone) accPhone.value = memberData.phone || '';
 if (accEmail) accEmail.value = userData.email || '';
 if (accBirth) accBirth.value = memberData.birthdate || '';
 if (accAddr) accAddr.value = memberData.address || '';
 if (accBarber) accBarber.value = memberData.favBarber || '';

 document.querySelectorAll('.gender-btn').forEach(btn => {
 if (btn.dataset.gender === memberData.gender) btn.classList.add('active');
 btn.addEventListener('click', () => {
 document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
 btn.classList.add('active');
 memberData.gender = btn.dataset.gender;
 });
 });

 // ============================================================
 // LOAD BARBERS FROM SUPABASE → populate select
 // ============================================================
 const BRANCH_LABELS = {
 bypass : 'Cabang Bypass',
 samadikun: 'Cabang Samadikun',
 tegal : 'Cabang Tegal',
 csb : 'Cabang CSB',
 sumber : 'Cabang Sumber'
 };

 (async () => {
 const sel = document.getElementById('accFavBarber');
 if (!sel) return;

 const barbers = await sbFetch('barbers?is_active=eq.true&select=id,name,role&order=name');
 if (!barbers || !barbers.length) {
 sel.innerHTML = '<option value="">Pilih barber favorit</option>';
 return;
 }

 // Group by branch prefix (first segment of id before first hyphen match in BRANCH_LABELS)
 const groups = {};
 barbers.forEach(b => {
 const prefix = Object.keys(BRANCH_LABELS).find(k => b.id.startsWith(k)) || 'lainnya';
 if (!groups[prefix]) groups[prefix] = [];
 groups[prefix].push(b);
 });

 sel.innerHTML = '<option value="">- Pilih barber favorit -</option>';
 Object.keys(groups).sort().forEach(prefix => {
 const label = BRANCH_LABELS[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
 const grp = document.createElement('optgroup');
 grp.label = label;
 groups[prefix].forEach(b => {
 const opt = document.createElement('option');
 opt.value = b.name;
 opt.textContent = b.name + (b.role ? ' · ' + b.role.replace(/;/g, ', ') : '');
 if (b.name === memberData.favBarber) opt.selected = true;
 grp.appendChild(opt);
 });
 sel.appendChild(grp);
 });

 // If saved value not yet selected (loaded before sync), re-apply after sync
 if (memberData.favBarber && !sel.value) sel.value = memberData.favBarber;
 })();

 if (accountForm) {
 accountForm.addEventListener('submit', async (e) => {
 e.preventDefault();
 memberData.phone = accPhone?.value || '';
 memberData.birthdate = accBirth?.value || '';
 memberData.address = accAddr?.value || '';
 memberData.favBarber = accBarber?.value|| '';
 if (accName?.value) { userData.name = accName.value; localStorage.setItem('redbox_user', JSON.stringify(userData)); if (profileName) profileName.textContent = accName.value; }
 save();
 const tok = localStorage.getItem('rb_member_token');
 if (tok) {
 // OTP member: save via server API
 await fetch('/api/auth/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
 body: JSON.stringify({
 name: userData.name,
 email: memberData.email || '',
 birth_date: memberData.birthdate || '',
 gender: memberData.gender || 'male',
 address: memberData.address || '',
 fav_barber: memberData.favBarber || ''
 })
 }).catch(err => console.error('[Auth] Save profile error:', err.message));
 } else {
 // Google/email member: save via Supabase direct
 const key = userData.email || userData.sub;
 if (key) {
 await sbFetch(`member_profiles?user_key=eq.${encodeURIComponent(key)}`, {
 method: 'PATCH', prefer: 'return=minimal',
 body: JSON.stringify({ full_name: userData.name, phone: memberData.phone, birthdate: memberData.birthdate, address: memberData.address, fav_barber: memberData.favBarber })
 });
 }
 }
 const btn = accountForm.querySelector('.btn-save-account');
 if (btn) { const orig = btn.textContent; btn.textContent = ' Tersimpan!'; btn.style.background = '#22c55e'; setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000); }
 });
 }

 // ============================================================
 // POINTS HISTORY
 // ============================================================
 function renderPointsHistory() {
 const bal = document.getElementById('pointsBalance');
 const body = document.getElementById('pointsTableBody');
 if (bal) animateCount(bal, memberData.points, 600);
 if (!body) return;
 const history = memberData.pointsHistory || [];
 body.innerHTML = history.length
 ? history.map(e => `<div class="points-row"><span class="pts-date">${e.date}</span><span class="pts-activity">${e.activity}</span><span class="pts-amount ${e.amount>=0?'positive':'negative'}">${e.amount>=0?'+':''}${e.amount}</span></div>`).join('')
 : `<div class="points-row points-row-empty"><span class="pts-activity" style="grid-column:1/-1;color:var(--w30);text-align:center;">${ACTIVE ? 'Belum ada aktivitas poin' : ' Aktivasi membership untuk mulai mengumpulkan poin'}</span></div>`;
 }
 renderPointsHistory();

 // ============================================================
 // REFERRAL
 // ============================================================
 const refCodeEl = document.getElementById('referralCode');
 const copyRefBtn = document.getElementById('copyReferralBtn');
 const refCount = document.getElementById('refCount');
 const refPoints = document.getElementById('refPoints');
 const refLockNote = document.getElementById('refLockNote');

 if (refCodeEl) refCodeEl.textContent = memberData.referralCode;
 if (refCount) refCount.textContent = memberData.referralCount || 0;
 if (refPoints) refPoints.textContent = memberData.referralPoints || 0;
 if (refLockNote) refLockNote.style.display = ACTIVE ? 'none' : 'flex';

 if (copyRefBtn) {
 copyRefBtn.addEventListener('click', () => {
 if (!ACTIVE) { showToast('Aktivasi membership untuk menggunakan kode referral.', 'error'); return; }
 navigator.clipboard.writeText(memberData.referralCode).then(() => {
 const orig = copyRefBtn.innerHTML;
 copyRefBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copied!';
 setTimeout(() => { copyRefBtn.innerHTML = orig; }, 2000);
 });
 });
 }

 // ============================================================
 // ACTIVATION FLOW
 // ============================================================
 function showActivationModal() {
 const modal = document.getElementById('activationModal');
 if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
 }
 function hideActivationModal() {
 const modal = document.getElementById('activationModal');
 if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
 }

 const membershipRegistrationUrl = 'member-register.html?tier=silver';
 const goToMembershipRegistration = () => { window.location.href = membershipRegistrationUrl; };
 document.getElementById('btnActivate')?.addEventListener('click', goToMembershipRegistration);
 document.getElementById('btnActivateBanner')?.addEventListener('click', goToMembershipRegistration);
 document.getElementById('btnActivateTop')?.addEventListener('click', goToMembershipRegistration);
 document.getElementById('modalClose')?.addEventListener('click', hideActivationModal);
 document.getElementById('activationModal')?.addEventListener('click', (e) => {
 if (e.target === e.currentTarget) hideActivationModal();
 });

 // "Mengerti" button just closes the modal (activation only via CRM/admin)
 document.getElementById('confirmActivateBtn')?.addEventListener('click', hideActivationModal);

 // ============================================================
 // TOAST
 // ============================================================
 function showToast(msg, type='success') {
 let el = document.getElementById('dashToast');
 if (!el) { el = document.createElement('div'); el.id = 'dashToast'; document.body.appendChild(el); }
 el.className = 'dash-toast ' + type;
 el.textContent = msg;
 el.style.display = 'block';
 setTimeout(() => { el.style.display = 'none'; }, 3500);
 }

 // ============================================================
 // LOGOUT
 // ============================================================
 function doLogout() {
 const tok = localStorage.getItem('rb_member_token');
 if (tok) {
 fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).catch(() => {});
 localStorage.removeItem('rb_member_token');
 localStorage.removeItem('redbox_user');
 localStorage.removeItem('redbox_member');
 window.location.href = 'member-login.html';
 } else {
 localStorage.removeItem('redbox_user');
 window.location.href = 'index.html';
 }
 }
 document.getElementById('logoutBtn')?.addEventListener('click', doLogout);
 document.getElementById('mobileLogoutBtn')?.addEventListener('click', doLogout);

 // Pill
 function updateNavPill() {
 const a = document.querySelector('#navPillWrapper .nav-link.active');
 const t = document.getElementById('navPillTrack');
 const w = document.getElementById('navPillWrapper');
 if (!a||!t||!w) return;
 const wr = w.getBoundingClientRect(), lr = a.getBoundingClientRect();
 t.style.left = (lr.left-wr.left)+'px'; t.style.top = (lr.top-wr.top)+'px';
 t.style.width = lr.width+'px'; t.style.height = lr.height+'px';
 }
 window.addEventListener('load', updateNavPill);
 window.addEventListener('resize', updateNavPill);

 // ============================================================
 // CHANGE PASSWORD
 // ============================================================
 const changePwdBtn = document.getElementById('changePasswordBtn');
 const changePwdInfo = document.getElementById('changePwdInfo');

 if (changePwdBtn) {
 changePwdBtn.addEventListener('click', () => {
 const isGoogle = !!(userData.picture || userData.loginMethod === 'google');
 if (isGoogle) {
 if (changePwdInfo) {
 changePwdInfo.textContent = 'Password kamu dikelola melalui akun Google. Untuk mengganti, lakukan di pengaturan akun Google kamu.';
 changePwdInfo.style.display = 'flex';
 setTimeout(() => { changePwdInfo.style.display = 'none'; }, 5000);
 } else {
 showToast('Password dikelola melalui akun Google.', 'error');
 }
 return;
 }
 showToast('Fitur ganti password email akan segera hadir.', 'error');
 });
 }

 // ============================================================
 // ADD ADDRESS (standalone save button)
 // ============================================================
 const addAddrBtn = document.getElementById('addAddressBtn');
 if (addAddrBtn) {
 addAddrBtn.addEventListener('click', async () => {
 const val = accAddr?.value?.trim();
 if (!val) { accAddr?.focus(); showToast('Masukkan alamat terlebih dahulu.', 'error'); return; }
 memberData.address = val;
 save();
 const key = userData.email || userData.sub;
 if (key) {
 await sbFetch(`member_profiles?user_key=eq.${encodeURIComponent(key)}`, {
 method: 'PATCH', prefer: 'return=minimal',
 body: JSON.stringify({ address: val })
 }).catch(() => {});
 }
 const orig = addAddrBtn.textContent;
 addAddrBtn.textContent = ' Tersimpan!';
 addAddrBtn.style.background = '#22c55e';
 setTimeout(() => { addAddrBtn.textContent = orig; addAddrBtn.style.background = ''; }, 2000);
 });
 }

 // ============================================================
 // SUPABASE FULL SYNC (initial load - remote is source of truth)
 // ============================================================
 (async () => {
 const tok = localStorage.getItem('rb_member_token');

 if (tok) {
 // ── OTP session: validate token + refresh data from server ──
 try {
 const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + tok } });
 if (res.status === 401) {
 localStorage.removeItem('rb_member_token');
 localStorage.removeItem('redbox_user');
 localStorage.removeItem('redbox_member');
 window.location.href = 'member-login.html';
 return;
 }
 if (res.ok) {
 const { customer: c } = await res.json();
 if (c) {
 userData.name = c.name || userData.name;
 localStorage.setItem('redbox_user', JSON.stringify(userData));

 memberData.points = c.points ?? memberData.points;
 memberData.visits = c.visits ?? memberData.visits;
 memberData.phone = c.wa || memberData.phone;
 memberData.birthdate = c.birth_date || memberData.birthdate;
 memberData.gender = c.gender || memberData.gender;
 memberData.address = c.address || memberData.address;
 memberData.favBarber = c.fav_barber || memberData.favBarber;
 memberData.email = c.email || memberData.email || '';
 memberData.membership_status = c.membership_status || 'INACTIVE';
 memberData.current_tier = c.current_tier || memberData.current_tier || 'bronze';
 memberData.membership_activated_at = c.membership_activated_at || null;
 memberData.membership_started_at = c.membership_started_at ?? null;
 memberData.membership_expires_at = c.membership_expires_at ?? null;
 refreshMembershipAccess();
 // first_visit = tanggal transaksi Moka paling awal - sumber kebenaran "Bergabung sejak"
 if (c.first_visit) memberData.joinDate = c.first_visit;
 if (c.referral_code) memberData.referralCode = c.referral_code;
 save();

 // Re-render UI with fresh data
 if (profileName) profileName.textContent = userData.name || 'Member Redbox';
 if (profileSince && memberData.joinDate) {
 const dj = new Date(memberData.joinDate);
 profileSince.textContent = `Bergabung sejak ${MONTHS[dj.getMonth()]} ${dj.getFullYear()}`;
 }
 const isACTIVE = memberHasActiveAccess();
 const pts = isACTIVE ? memberData.points : 0;
 animateCount(statPoints, pts, 800);
 animateCount(statVisits, memberData.visits, 600);
 const t2 = getDisplayTier(pts);
 window.RedboxTierTheme.applyTierTheme(isACTIVE ? t2.class : 'bronze');
 if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (isACTIVE ? t2.class : 'inactive');
 if (tierBadgeText) tierBadgeText.textContent = isACTIVE ? `${t2.label} - ${t2.name}` : 'Membership Belum Aktif';
 if (cardTier) cardTier.textContent = isACTIVE ? t2.name.toUpperCase() + ' MEMBER' : 'INACTIVE';
 if (memberStatusBadge) {
 memberStatusBadge.textContent = isACTIVE ? ' Membership Aktif' : 'Membership Belum Aktif';
 memberStatusBadge.className = 'member-status-badge ' + (isACTIVE ? 'active' : 'inactive');
 }
 if (physCardWrap) {
 physCardWrap.classList.toggle('inactive', !isACTIVE);
 if (physCardHint) physCardHint.textContent = isACTIVE ? ' Kartu fisik kamu sudah aktif' : 'Aktivasi untuk dapatkan kartu fisik eksklusif ini';
 }
 if (accName) accName.value = userData.name || '';
 if (accPhone) accPhone.value = memberData.phone || '';
 if (accEmail) accEmail.value = memberData.email || '';
 if (accAddr) accAddr.value = memberData.address|| '';
 if (accBirth) accBirth.value = memberData.birthdate || '';
 if (accBarber && memberData.favBarber) accBarber.value = memberData.favBarber;
 if (refCodeEl) refCodeEl.textContent = memberData.referralCode;
 document.querySelectorAll('.gender-btn').forEach(b => b.classList.toggle('active', b.dataset.gender === memberData.gender));
 }
 }
 } catch (err) {
 console.warn('[Auth] Token validation error:', err.message);
 }
 return; // OTP members skip Supabase direct path
 }

 // ── Google/email members: Supabase direct sync ──
 const key = userData.email || userData.sub;
 if (!key) return;

 // ─── Load profile ───
 const rows = await sbFetch(`member_profiles?user_key=eq.${encodeURIComponent(key)}&select=*`);
 if (rows && rows.length > 0) {
 const r = rows[0];
 const changed =
 r.membership_status !== memberData.membership_status ||
 r.membership_started_at !== memberData.membership_started_at ||
 r.membership_expires_at !== memberData.membership_expires_at ||
 r.total_points !== memberData.points;

 // Remote profile is authoritative. Access is then normalized through the shared policy.
 memberData.membership_status = r.membership_status || 'INACTIVE';
 memberData.current_tier = r.current_tier || memberData.current_tier || 'bronze';
 memberData.membership_started_at = r.membership_started_at ?? null;
 memberData.membership_expires_at = r.membership_expires_at ?? null;
 refreshMembershipAccess();
 memberData.points = r.total_points ?? memberData.points;
 memberData.visits = r.total_visits ?? memberData.visits;
 memberData.membership_activated_at= r.membership_activated_at|| memberData.membership_activated_at;
 memberData.phone = r.phone || memberData.phone;
 memberData.birthdate = r.birthdate || memberData.birthdate;
 memberData.gender = r.gender || memberData.gender;
 memberData.address = r.address || memberData.address;
 memberData.favBarber = r.fav_barber|| memberData.favBarber;
 if (r.referral_code) memberData.referralCode = r.referral_code;
 if (r.full_name && r.full_name !== userData.name) {
 userData.name = r.full_name;
 localStorage.setItem('redbox_user', JSON.stringify(userData));
 }
 save();

 // Re-render affected UI elements
 if (profileName) profileName.textContent = userData.name || 'Member Redbox';
 const isACTIVE = memberHasActiveAccess();
 const pts = isACTIVE ? memberData.points : 0;
 animateCount(statPoints, pts, 800);
 animateCount(statVisits, memberData.visits, 600);
 const t2 = getDisplayTier(pts);
 window.RedboxTierTheme.applyTierTheme(isACTIVE ? t2.class : 'bronze');
 if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (isACTIVE ? t2.class : 'inactive');
 if (tierBadgeText) tierBadgeText.textContent = isACTIVE ? `${t2.label} - ${t2.name}` : 'Membership Belum Aktif';
 if (cardTier) cardTier.textContent = isACTIVE ? t2.name.toUpperCase() + ' MEMBER' : 'INACTIVE';
 if (memberStatusBadge) {
 memberStatusBadge.textContent = isACTIVE ? ' Membership Aktif' : 'Membership Belum Aktif';
 memberStatusBadge.className = 'member-status-badge ' + (isACTIVE ? 'active' : 'inactive');
 }
 if (physCardWrap) {
 physCardWrap.classList.toggle('inactive', !isACTIVE);
 if (physCardHint) physCardHint.textContent = isACTIVE ? ' Kartu fisik kamu sudah aktif' : 'Aktivasi untuk dapatkan kartu fisik eksklusif ini';
 }
 // Refresh form fields
 if (accName) accName.value = userData.name || '';
 if (accPhone) accPhone.value = memberData.phone || '';
 if (accAddr) accAddr.value = memberData.address || '';
 if (accBirth) accBirth.value = memberData.birthdate || '';
 if (accBarber && memberData.favBarber) accBarber.value = memberData.favBarber;
 if (refCodeEl) refCodeEl.textContent = memberData.referralCode;
 document.querySelectorAll('.gender-btn').forEach(b => b.classList.toggle('active', b.dataset.gender === memberData.gender));

 if (changed) {
 // Refresh banners visibility
 const isNowActive = memberHasActiveAccess();
 if (activationBanner) activationBanner.style.display = 'none';
 if (activationBannerTop) activationBannerTop.style.display = isNowActive ? 'none' : 'block';
 if (tierLockOverlay) tierLockOverlay.style.display = isNowActive ? 'none' : 'flex';
 }
 } else {
 // UPSERT profile row for new user (merge-duplicates handles race on double-load)
 await sbFetch('member_profiles', {
 method: 'POST',
 prefer: 'return=minimal',
 headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
 body: JSON.stringify({ user_key: key, email: key, full_name: userData.name || '', referral_code: memberData.referralCode, membership_status: 'INACTIVE', total_points: 0 })
 }).catch(() => {});
 }

 // ─── Load point transactions ───
 const txRows = await sbFetch(
 `member_point_transactions?user_key=eq.${encodeURIComponent(key)}&order=created_at.desc&limit=50&select=*`
 );
 if (txRows && txRows.length > 0) {
 memberData.pointsHistory = txRows.map(tx => ({
 date : new Date(tx.created_at).toLocaleDateString('id-ID'),
 activity: tx.activity,
 amount : tx.points
 }));
 save();
 renderPointsHistory();
 renderRedeemHistory();
 // Refresh rewards points display
 const rpd = document.getElementById('rewardsPointsDisplay');
 if (rpd) {
 const isACTIVE = memberHasActiveAccess();
 rpd.textContent = `${memberData.points.toLocaleString('id-ID')} Poin tersedia`;
 }
 }
 })();

 window.addEventListener('beforeunload', save);

});
