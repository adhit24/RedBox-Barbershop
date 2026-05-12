// ================================================
// MEMBER DASHBOARD v2 — Redbox Barbershop
// Full membership status + point system logic
// ================================================

const SUPABASE_URL = 'https://gtiggsilfcivuzowaexq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0aWdnc2lsZmNpdnV6b3dhZXhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzA1OTMsImV4cCI6MjA5MjM0NjU5M30.GKq79uI5i_B31vi4McEGuqRZEJjPIrY5QKyK0LQEA4o';

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

  // ---- Check login state ----
  const userData = JSON.parse(localStorage.getItem('redbox_user') || 'null');
  if (!userData || !userData.loggedIn) {
    window.location.href = 'index.html';
    return;
  }

  // ============================================================
  // CONSTANTS
  // ============================================================
  const TIERS = [
    { name:'Bronze',   min:0,    max:499,      class:'bronze',   color:'#CD7F32', glow:'rgba(205,127,50,.5)',  multiplier:1.0, label:'Level 1' },
    { name:'Silver',   min:500,  max:1499,     class:'silver',   color:'#C0C0C0', glow:'rgba(192,192,192,.5)', multiplier:1.2, label:'Level 2' },
    { name:'Gold',     min:1500, max:2999,     class:'gold',     color:'#FFD700', glow:'rgba(255,215,0,.5)',   multiplier:1.5, label:'Level 3' },
    { name:'Platinum', min:3000, max:Infinity, class:'platinum', color:'#B9F2FF', glow:'rgba(185,242,255,.5)', multiplier:2.0, label:'Level 4' }
  ];

  const REWARDS = [
    { id:'r1', tier:'bronze',   name:'Mug Redbox For Free',              desc:'Dapatkan mug eksklusif Redbox secara gratis.',                          cost:75,  icon:'☕', type:'redeem' },
    { id:'r2', tier:'bronze',   name:'Free Redbox Oilbased Mini',        desc:'Dapatkan produk oilbased mini eksklusif Redbox secara gratis.',         cost:75,  icon:'🧴', type:'redeem' },
    { id:'r3', tier:'silver',   name:'Free Baileys Coffee',              desc:'Nikmati segelas Baileys Coffee gratis dari Redbox.',                    cost:100, icon:'🍵', type:'redeem' },
    { id:'r4', tier:'silver',   name:'Free Express Cleaning (All Varians)', desc:'Layanan express cleaning untuk semua varian secara gratis.',         cost:100, icon:'✨', type:'redeem' },
    { id:'r5', tier:'silver',   name:'Cashback 50% Haircut Regular',     desc:'Dapatkan cashback 50% untuk layanan Haircut Regular.',                  cost:100, icon:'✂️', type:'redeem' },
    { id:'r6', tier:'gold',     name:'Cashback 50% Haircut Premium (CSB)', desc:'Dapatkan cashback 50% untuk layanan Haircut Premium Classic Style Barber.', cost:125, icon:'💈', type:'redeem' },
    { id:'r7', tier:'gold',     name:'Free Haircut / Fadecut',           desc:'Haircut atau Fadecut gratis pilihan kamu.',                             cost:200, icon:'🏆', type:'redeem' },
    { id:'r8', tier:'platinum', name:'Free Gentlemen Grooming',          desc:'Layanan Gentlemen Grooming lengkap gratis untukmu.',                    cost:250, icon:'👑', type:'redeem' },
    { id:'r9', tier:'platinum', name:'Free Fadecut Grooming',            desc:'Layanan Fadecut Grooming eksklusif gratis untukmu.',                    cost:250, icon:'💎', type:'redeem' },
  ];

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
    membership_activated_at: null,
    pointsHistory: []
  };

  const memberData = Object.assign({}, defaultMember,
    JSON.parse(localStorage.getItem('redbox_member') || 'null') || {});

  if (!memberData.membership_status) memberData.membership_status = 'INACTIVE';

  // ── KEY LOGIC: gate everything behind membership status ──
  const ACTIVE = memberData.membership_status === 'ACTIVE';
  const point_system = ACTIVE;

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
  const profileName    = document.getElementById('profileName');
  const profileSince   = document.getElementById('profileSince');
  const avatarInitials = document.getElementById('avatarInitials');
  const avatarImage    = document.getElementById('avatarImage');
  const statVisits     = document.getElementById('statVisits');
  const statReviews    = document.getElementById('statReviews');
  const statPoints     = document.getElementById('statPoints');

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
  animateCount(statVisits,  memberData.visits,  800);
  animateCount(statReviews, memberData.reviews, 800);
  animateCount(statPoints,  displayPoints, 1200);

  // cardTier still referenced below for tier label text
  const cardTier = document.getElementById('cardTier');

  // ============================================================
  // MEMBERSHIP STATUS UI
  // ============================================================
  const activationBanner  = document.getElementById('activationBanner');
  const tierLockOverlay   = document.getElementById('tierLockOverlay');
  const memberStatusBadge = document.getElementById('memberStatusBadge');
  const tierBadge         = document.getElementById('profileTierBadge');
  const tierBadgeText     = document.getElementById('tierBadgeText');

  const tier = getCurrentTier(displayPoints);

  if (tierBadge)     tierBadge.className = 'profile-tier-badge ' + (ACTIVE ? tier.class : 'inactive');
  if (tierBadgeText) tierBadgeText.textContent = ACTIVE ? `${tier.label} — ${tier.name}` : 'Membership Belum Aktif';
  if (cardTier)      cardTier.textContent = ACTIVE ? tier.name.toUpperCase() + ' MEMBER' : 'INACTIVE';

  const activationBannerTop = document.getElementById('activationBannerTop');
  const physCardWrap        = document.getElementById('physCardWrap');
  const physCardHint        = document.getElementById('physCardHint');

  if (!ACTIVE) {
    if (activationBanner)    activationBanner.style.display    = 'block';
    if (activationBannerTop) activationBannerTop.style.display = 'block';
    if (tierLockOverlay)     tierLockOverlay.style.display     = 'flex';
    if (memberStatusBadge) { memberStatusBadge.textContent = 'Membership Belum Aktif'; memberStatusBadge.className = 'member-status-badge inactive'; }
    if (physCardWrap)        physCardWrap.classList.add('inactive');
    if (physCardHint)        physCardHint.textContent = 'Aktivasi untuk dapatkan kartu fisik eksklusif ini';
    document.querySelectorAll('.requires-active').forEach(el => {
      el.classList.add('locked-feature');
    });
  } else {
    if (activationBanner)  activationBanner.style.display = 'none';
    if (tierLockOverlay)   tierLockOverlay.style.display  = 'none';
    if (memberStatusBadge) { memberStatusBadge.textContent = '✓ Membership Aktif'; memberStatusBadge.className = 'member-status-badge active'; }
    if (physCardWrap)        physCardWrap.classList.remove('inactive');
    if (physCardHint)        physCardHint.textContent = '✓ Kartu fisik kamu sudah aktif';
    // Apply tier glow to tier card
    const tierCard = document.querySelector('.tier-card');
    if (tierCard) tierCard.style.boxShadow = `0 0 40px ${tier.glow}, inset 0 0 60px ${tier.glow.replace('.5','0.04')}`;
  }

  // ============================================================
  // TIER PROGRESS
  // ============================================================
  const tierMessage = document.getElementById('tierMessage');

  if (ACTIVE) {
    const tierNodes = document.querySelectorAll('.tier-node');
    tierNodes.forEach((node, i) => {
      if (i < tier.level)     node.classList.add('completed');
      if (i === tier.level-1) node.classList.add('active');
    });
    setTimeout(() => {
      [[0,0,500],[1,500,1500],[2,1500,3000]].forEach(([i,start,end]) => {
        const fill = document.getElementById('tierFill' + (i+1));
        if (!fill) return;
        const pct = memberData.points >= end ? 100
          : memberData.points > start ? ((memberData.points-start)/(end-start))*100 : 0;
        fill.style.width = Math.min(pct,100) + '%';
      });
    }, 400);
    if (tierMessage) {
      const next = TIERS[tier.level] || null;
      tierMessage.innerHTML = next
        ? `<p>Sedikit lagi naik ke <strong>${next.name}</strong>! Butuh <strong>${(next.min - memberData.points).toLocaleString('id-ID')} poin</strong> lagi. Keep grinding. 💪</p>`
        : `<p>🎉 Kamu sudah di level tertinggi <strong>Platinum</strong>. Nikmati semua keistimewaan VIP Redbox!</p>`;
    }
  } else {
    if (tierMessage) tierMessage.innerHTML = `<p>Aktivasi membership untuk mulai mengumpulkan poin dan naik tier. <a href="#" id="tierActivateCta" style="color:var(--red);font-weight:600;">Aktivasi sekarang →</a></p>`;
    setTimeout(() => {
      document.getElementById('tierActivateCta')?.addEventListener('click', (e) => { e.preventDefault(); showActivationModal(); });
    }, 100);
  }

  // ============================================================
  // REWARDS RENDER
  // ============================================================
  // Update rewards points display
  const rewardsPointsDisplay = document.getElementById('rewardsPointsDisplay');
  if (rewardsPointsDisplay) rewardsPointsDisplay.textContent = ACTIVE ? `${memberData.points.toLocaleString('id-ID')} Poin tersedia` : 'Aktivasi untuk mulai';

  const rewardsGrid = document.getElementById('rewardsGrid');
  if (rewardsGrid) {
    rewardsGrid.innerHTML = REWARDS.map(r => {
      const rTierIdx  = tierLevelOf(r.tier);
      const userTierIdx = tier.level - 1;
      const unlocked  = ACTIVE && userTierIdx >= rTierIdx;
      const tierInfo  = TIERS[rTierIdx];
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
            ? `<button class="reward-btn ${unlocked ? '' : 'disabled'}" data-id="${r.id}" data-cost="${r.cost}" ${!unlocked ? 'disabled' : ''}>${unlocked ? `Tukar ${r.cost} Poin` : `🔒 ${tierInfo.name}+`}</button>`
            : `<span class="reward-badge-auto">${unlocked ? 'Aktif Otomatis' : `🔒 ${tierInfo.name}+`}</span>`
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
  // TAB SWITCHING
  // ============================================================
  const navItems = document.querySelectorAll('.dash-nav-item[data-tab]');
  const panels   = document.querySelectorAll('.dash-panel');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      panels.forEach(p => { p.classList.remove('active'); if (p.id === 'panel-'+tab) p.classList.add('active'); });
    });
  });

  // ============================================================
  // ACCOUNT FORM
  // ============================================================
  const accName    = document.getElementById('accName');
  const accPhone   = document.getElementById('accPhone');
  const accEmail   = document.getElementById('accEmail');
  const accBirth   = document.getElementById('accBirth');
  const accAddr    = document.getElementById('accAddr');
  const accBarber  = document.getElementById('accFavBarber');
  const accountForm= document.getElementById('accountForm');

  if (accName)   accName.value   = userData.name || '';
  if (accPhone)  accPhone.value  = memberData.phone || '';
  if (accEmail)  accEmail.value  = userData.email || '';
  if (accBirth)  accBirth.value  = memberData.birthdate || '';
  if (accAddr)   accAddr.value   = memberData.address || '';
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
    bypass   : 'Cabang Bypass',
    samadikun: 'Cabang Samadikun',
    tegal    : 'Cabang Tegal',
    csb      : 'Cabang CSB',
    sumber   : 'Cabang Sumber'
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

    sel.innerHTML = '<option value="">— Pilih barber favorit —</option>';
    Object.keys(groups).sort().forEach(prefix => {
      const label = BRANCH_LABELS[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
      const grp = document.createElement('optgroup');
      grp.label = label;
      groups[prefix].forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name + (b.role ? '  ·  ' + b.role.replace(/;/g, ', ') : '');
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
      memberData.phone     = accPhone?.value || '';
      memberData.birthdate = accBirth?.value || '';
      memberData.address   = accAddr?.value  || '';
      memberData.favBarber = accBarber?.value|| '';
      if (accName?.value) { userData.name = accName.value; localStorage.setItem('redbox_user', JSON.stringify(userData)); if (profileName) profileName.textContent = accName.value; }
      save();
      // Supabase sync
      const key = userData.email || userData.sub;
      if (key) {
        await sbFetch(`member_profiles?user_key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: JSON.stringify({ full_name: userData.name, phone: memberData.phone, birthdate: memberData.birthdate, address: memberData.address, fav_barber: memberData.favBarber })
        });
      }
      const btn = accountForm.querySelector('.btn-save-account');
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ Tersimpan!'; btn.style.background = '#22c55e'; setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000); }
    });
  }

  // ============================================================
  // POINTS HISTORY
  // ============================================================
  function renderPointsHistory() {
    const bal  = document.getElementById('pointsBalance');
    const body = document.getElementById('pointsTableBody');
    if (bal) animateCount(bal, ACTIVE ? memberData.points : 0, 600);
    if (!body) return;
    const history = ACTIVE ? memberData.pointsHistory : [];
    body.innerHTML = history.length
      ? history.map(e => `<div class="points-row"><span class="pts-date">${e.date}</span><span class="pts-activity">${e.activity}</span><span class="pts-amount ${e.amount>=0?'positive':'negative'}">${e.amount>=0?'+':''}${e.amount}</span></div>`).join('')
      : `<div class="points-row points-row-empty"><span class="pts-activity" style="grid-column:1/-1;color:var(--w30);text-align:center;">${ACTIVE ? 'Belum ada aktivitas poin' : '🔒 Aktivasi membership untuk mulai mengumpulkan poin'}</span></div>`;
  }
  renderPointsHistory();

  // ============================================================
  // REFERRAL
  // ============================================================
  const refCodeEl   = document.getElementById('referralCode');
  const copyRefBtn  = document.getElementById('copyReferralBtn');
  const refCount    = document.getElementById('refCount');
  const refPoints   = document.getElementById('refPoints');
  const refLockNote = document.getElementById('refLockNote');

  if (refCodeEl) refCodeEl.textContent = memberData.referralCode;
  if (refCount)  refCount.textContent  = memberData.referralCount || 0;
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

  document.getElementById('btnActivate')?.addEventListener('click', showActivationModal);
  document.getElementById('btnActivateBanner')?.addEventListener('click', showActivationModal);
  document.getElementById('btnActivateTop')?.addEventListener('click', showActivationModal);
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
    localStorage.removeItem('redbox_user');
    window.location.href = 'index.html';
  }
  document.getElementById('logoutBtn')?.addEventListener('click', doLogout);
  document.getElementById('mobileLogoutBtn')?.addEventListener('click', doLogout);

  // ============================================================
  // HAMBURGER (mobile)
  // ============================================================
  const hamburger = document.getElementById('hamburger');
  const navLinksEl = document.getElementById('navLinks');
  if (hamburger && navLinksEl) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinksEl.classList.toggle('open');
      document.body.style.overflow = navLinksEl.classList.contains('open') ? 'hidden' : '';
    });
  }

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
  const changePwdBtn  = document.getElementById('changePasswordBtn');
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
      addAddrBtn.textContent = '✓ Tersimpan!';
      addAddrBtn.style.background = '#22c55e';
      setTimeout(() => { addAddrBtn.textContent = orig; addAddrBtn.style.background = ''; }, 2000);
    });
  }

  // ============================================================
  // SUPABASE FULL SYNC (initial load — remote is source of truth)
  // ============================================================
  (async () => {
    const key = userData.email || userData.sub;
    if (!key) return;

    // ─── Load profile ───
    const rows = await sbFetch(`member_profiles?user_key=eq.${encodeURIComponent(key)}&select=*`);
    if (rows && rows.length > 0) {
      const r = rows[0];
      const changed =
        r.membership_status !== memberData.membership_status ||
        r.total_points       !== memberData.points;

      // Remote ACTIVE always wins; remote INACTIVE never downgrades local ACTIVE
      if (r.membership_status === 'ACTIVE') {
        memberData.membership_status = 'ACTIVE';
      } else if (memberData.membership_status !== 'ACTIVE') {
        memberData.membership_status = r.membership_status || 'INACTIVE';
      }
      memberData.points                 = r.total_points           ?? memberData.points;
      memberData.visits                 = r.total_visits           ?? memberData.visits;
      memberData.membership_activated_at= r.membership_activated_at|| memberData.membership_activated_at;
      memberData.phone                  = r.phone     || memberData.phone;
      memberData.birthdate              = r.birthdate || memberData.birthdate;
      memberData.gender                 = r.gender    || memberData.gender;
      memberData.address                = r.address   || memberData.address;
      memberData.favBarber              = r.fav_barber|| memberData.favBarber;
      if (r.referral_code)              memberData.referralCode = r.referral_code;
      if (r.full_name && r.full_name !== userData.name) {
        userData.name = r.full_name;
        localStorage.setItem('redbox_user', JSON.stringify(userData));
      }
      save();

      // Re-render affected UI elements
      if (profileName) profileName.textContent = userData.name || 'Member Redbox';
      const isACTIVE = memberData.membership_status === 'ACTIVE';
      const pts = isACTIVE ? memberData.points : 0;
      animateCount(statPoints, pts, 800);
      animateCount(statVisits, memberData.visits, 600);
      const t2 = getCurrentTier(pts);
      if (tierBadge)     tierBadge.className = 'profile-tier-badge ' + (isACTIVE ? t2.class : 'inactive');
      if (tierBadgeText) tierBadgeText.textContent = isACTIVE ? `${t2.label} — ${t2.name}` : 'Membership Belum Aktif';
      if (cardTier)      cardTier.textContent = isACTIVE ? t2.name.toUpperCase() + ' MEMBER' : 'INACTIVE';
      if (memberStatusBadge) {
        memberStatusBadge.textContent = isACTIVE ? '✓ Membership Aktif' : 'Membership Belum Aktif';
        memberStatusBadge.className = 'member-status-badge ' + (isACTIVE ? 'active' : 'inactive');
      }
      if (physCardWrap) {
        physCardWrap.classList.toggle('inactive', !isACTIVE);
        if (physCardHint) physCardHint.textContent = isACTIVE ? '✓ Kartu fisik kamu sudah aktif' : 'Aktivasi untuk dapatkan kartu fisik eksklusif ini';
      }
      // Refresh form fields
      if (accName)   accName.value   = userData.name || '';
      if (accPhone)  accPhone.value  = memberData.phone || '';
      if (accAddr)   accAddr.value   = memberData.address || '';
      if (accBirth)  accBirth.value  = memberData.birthdate || '';
      if (accBarber && memberData.favBarber) accBarber.value = memberData.favBarber;
      if (refCodeEl) refCodeEl.textContent = memberData.referralCode;
      document.querySelectorAll('.gender-btn').forEach(b => b.classList.toggle('active', b.dataset.gender === memberData.gender));

      if (changed) {
        // Refresh banners visibility
        const isNowActive = memberData.membership_status === 'ACTIVE';
        if (activationBanner)    activationBanner.style.display    = isNowActive ? 'none' : 'block';
        if (activationBannerTop) activationBannerTop.style.display = isNowActive ? 'none' : 'block';
        if (tierLockOverlay)     tierLockOverlay.style.display     = isNowActive ? 'none' : 'flex';
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
        date    : new Date(tx.created_at).toLocaleDateString('id-ID'),
        activity: tx.activity,
        amount  : tx.points
      }));
      save();
      renderPointsHistory();
      // Refresh rewards points display
      const rpd = document.getElementById('rewardsPointsDisplay');
      if (rpd) {
        const isACTIVE = memberData.membership_status === 'ACTIVE';
        rpd.textContent = isACTIVE ? `${memberData.points.toLocaleString('id-ID')} Poin tersedia` : 'Aktivasi untuk mulai';
      }
    }
  })();

  window.addEventListener('beforeunload', save);

});
