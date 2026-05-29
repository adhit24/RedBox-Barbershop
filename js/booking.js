// ================================================
// REDBOX BARBERSHOP — BOOKING JS
// Dynamic category-grouped services + show more/less
// ================================================
// ── API CONFIG ─────────────────────────────
const API_URL = (() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001/api';
  }
  return `${window.location.protocol}//${window.location.host}/api`;
})();
let USE_API = true; // API selalu aktif — live site selalu punya server
let apiBookings = []; // Cache for server-side bookings to detect conflicts (legacy fallback)
let mokaAvailableSlots = []; // Slots from /api/availability (includes Moka walk-ins)
let mokaAvailabilityActive = false; // true when new availability API responded successfully
let fallbackBusyRanges = []; // Used when /api/availability fails: blocks from /api/schedules

async function detectApiMode() {
  try {
    const res = await fetch(API_URL + '/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) USE_API = true;
  } catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
  await detectApiMode();

  // ── STATE ───────────────────────────────────

  const state = {
    service: null,
    barber: null,
    date: null,
    time: null,
    location: null,
    name: '',
    wa: '',
    notes: '',
    payment: null,
    address: '',
    currentStep: 1,
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
  };

  const fmt = n => 'Rp ' + Number(n).toLocaleString('id-ID');
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  let activeLoadSeq = 0;

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function currentLocalMins() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function formatDate(str) {
    const d = new Date(str + 'T12:00:00');
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ── URL PARAMS ──────────────────────────────
  const params = new URLSearchParams(window.location.search);
  // Creambath tidak tersedia, redirect ke Hair Spa
  const rawService = params.get('service');
  const preService = rawService === 'creambath' ? 'hair-spa' : rawService;
  const preBarber = params.get('barber');
  const isHomeService = params.get('type') === 'homeservice' || params.get('mode') === 'home-service';
  // Home Service package: 'family' = Rp 200.000/orang (min 2), default 'single' = Rp 250.000/orang
  const hsPackage = (params.get('pkg') || '').toLowerCase() === 'family' ? 'family' : 'single';
  const HS_PRICE_SINGLE = 250000;
  const HS_PRICE_FAMILY = 200000;

  // ── GROUP BOOKING STATE ────────────────────────
  // groupSize: 1 = solo (default), 2 = booking untuk 2 orang paralel di cabang sama
  // activePerson: tab yang sedang aktif di step 1 (service) atau step 2 (barber)
  state.groupSize = 1;
  state.activePerson = 1;
  state.person2 = null; // { name, service, barber } — diisi saat groupSize===2

  function isGroup() { return state.groupSize === 2; }

  // helper: get/set current person's service/barber (active tab when group)
  function getActiveService() {
    if (isGroup() && state.activePerson === 2) return state.person2?.service || null;
    return state.service;
  }
  function setActiveService(svc) {
    if (isGroup() && state.activePerson === 2) {
      state.person2 = state.person2 || { name: '', service: null, barber: null };
      state.person2.service = svc;
    } else {
      state.service = svc;
    }
  }
  function getActiveBarber() {
    if (isGroup() && state.activePerson === 2) return state.person2?.barber || null;
    return state.barber;
  }
  function setActiveBarber(b) {
    if (isGroup() && state.activePerson === 2) {
      state.person2 = state.person2 || { name: '', service: null, barber: null };
      state.person2.barber = b;
    } else {
      state.barber = b;
    }
  }

  // Update person-tab UI status text + filled checkmark
  function refreshPersonTabs() {
    document.querySelectorAll('.person-tabs').forEach(tabs => {
      const isBarberStep = tabs.id === 'personTabsBarber';
      tabs.querySelectorAll('.person-tab').forEach(t => {
        const p = parseInt(t.dataset.person, 10);
        const filled = isBarberStep
          ? (p === 1 ? !!state.barber : !!state.person2?.barber)
          : (p === 1 ? !!state.service : !!state.person2?.service);
        t.classList.toggle('filled', filled);
        const statusEl = t.querySelector('.person-tab-status');
        if (statusEl) {
          if (filled) {
            const name = isBarberStep
              ? (p === 1 ? state.barber?.name : state.person2?.barber?.name)
              : (p === 1 ? state.service?.name : state.person2?.service?.name);
            statusEl.textContent = name || (isBarberStep ? 'Dipilih' : 'Dipilih');
          } else {
            statusEl.textContent = isBarberStep ? 'Pilih kapster' : 'Pilih service';
          }
        }
        t.classList.toggle('active', state.activePerson === p);
      });
    });
  }

  // Update svc-list "selected" highlight to match active person's service
  function refreshSvcListSelection() {
    const activeSvc = getActiveService();
    document.querySelectorAll('.svc-item').forEach(i => {
      i.classList.toggle('selected', !!activeSvc && i.dataset.service === activeSvc.id);
    });
  }
  // Update barber-card highlight to match active person's barber
  function refreshBarberCardSelection() {
    const activeB = getActiveBarber();
    document.querySelectorAll('.barber-card').forEach(c => {
      c.classList.toggle('selected', !!activeB && String(c.dataset.barber) === String(activeB.id));
    });
  }

  // Are step-1 / step-2 requirements satisfied for current group size?
  function step1Ready() {
    if (!isGroup()) return !!state.service;
    return !!state.service && !!state.person2?.service;
  }
  function step2Ready() {
    if (!isGroup()) return !!state.barber;
    if (!state.barber || !state.person2?.barber) return false;
    // must be different kapster
    if (String(state.barber.id) === String(state.person2.barber.id)) return false;
    // must be same branch (paralel di 1 cabang)
    if (state.barber.branch !== state.person2.barber.branch) return false;
    return true;
  }

  function updateStep1Cta() {
    const ready = step1Ready();
    const btn = document.getElementById('step1Next');
    if (btn) btn.disabled = !ready;
    const mCont = document.getElementById('mobileContinue');
    if (mCont) {
      if (ready) { mCont.disabled = false; mCont.classList.add('visible'); }
      else { mCont.disabled = true; mCont.classList.remove('visible'); }
    }
    const sc = document.getElementById('selectedCount');
    if (sc) {
      if (!ready) sc.textContent = '';
      else if (!isGroup()) sc.textContent = '— ' + state.service.name + ' selected';
      else sc.textContent = '— ' + state.service.name + ' + ' + state.person2.service.name;
    }
  }

  function updateStep2Cta() {
    const btn = document.getElementById('step2Next');
    if (btn) btn.disabled = !step2Ready();
  }

  // ── GROUP SELECTOR & PERSON-TAB EVENT WIRING ──
  const groupSelector = document.getElementById('groupSelector');
  const groupBanner = document.getElementById('groupBanner');
  const personTabsService = document.getElementById('personTabsService');
  const personTabsBarber = document.getElementById('personTabsBarber');
  const svcListWrap = document.getElementById('svcList');

  function setGroupSize(n) {
    state.groupSize = n;
    // pills
    groupSelector?.querySelectorAll('.group-pill').forEach(p => {
      p.classList.toggle('active', parseInt(p.dataset.size, 10) === n);
    });
    // 3+ banner: hide service list & person tabs
    if (n === 3) {
      if (groupBanner) groupBanner.style.display = '';
      if (personTabsService) personTabsService.style.display = 'none';
      if (personTabsBarber) personTabsBarber.style.display = 'none';
      if (svcListWrap) svcListWrap.style.display = 'none';
      document.getElementById('step1Next').disabled = true;
      const mCont = document.getElementById('mobileContinue');
      if (mCont) { mCont.disabled = true; mCont.classList.remove('visible'); }
      const sc = document.getElementById('selectedCount');
      if (sc) sc.textContent = '— hubungi WhatsApp kami';
      return;
    }
    // 1 or 2 orang
    if (groupBanner) groupBanner.style.display = 'none';
    if (svcListWrap) svcListWrap.style.display = '';
    const showTabs = (n === 2);
    if (personTabsService) personTabsService.style.display = showTabs ? '' : 'none';
    if (personTabsBarber) personTabsBarber.style.display = showTabs ? '' : 'none';
    // Reset person2 when switching back to 1
    if (n === 1) {
      state.person2 = null;
      state.activePerson = 1;
    } else {
      state.person2 = state.person2 || { name: '', service: null, barber: null };
    }
    // Toggle 2nd name field & relabel 1st name
    const name2Group = document.getElementById('custName2Group');
    const nameLabel = document.getElementById('custNameLabel');
    if (name2Group) name2Group.style.display = showTabs ? '' : 'none';
    if (nameLabel) nameLabel.textContent = showTabs ? 'Nama Orang 1 (Kontak Utama)' : 'Full Name';

    refreshPersonTabs();
    refreshSvcListSelection();
    refreshBarberCardSelection();
    updateStep1Cta();
    updateStep2Cta();
    updateSidebar();
  }

  groupSelector?.querySelectorAll('.group-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const n = parseInt(pill.dataset.size, 10);
      setGroupSize(n);
      state.activePerson = 1;
    });
  });

  // Person-tab click → switch active person
  document.querySelectorAll('.person-tabs').forEach(tabs => {
    tabs.addEventListener('click', e => {
      const tab = e.target.closest('.person-tab');
      if (!tab) return;
      state.activePerson = parseInt(tab.dataset.person, 10);
      refreshPersonTabs();
      refreshSvcListSelection();
      refreshBarberCardSelection();
    });
  });

  // ── ADD-ON HELPERS ─────────────────────────────
  // REDBOX_ADDONS comes from services-data.js — keyed by service id
  function getAddonsFor(svcId) {
    return (typeof REDBOX_ADDONS !== 'undefined' && REDBOX_ADDONS[svcId]) || null;
  }

  // Apply CSB-specific pricing to a service object (handles both: with-addons and plain).
  function applyCsbPricingTo(svc) {
    if (!svc) return;
    if (svc.addons && svc.addons.length) {
      recalcServiceWithAddons(svc);
      return;
    }
    // Plain service: switch between base & CSB price
    if (!svc.basePrice) svc.basePrice = svc.price;
    const effective = (state.location === 'csb' && svc.csbPrice)
      ? svc.csbPrice
      : svc.basePrice;
    svc.price = effective;
  }

  // Apply currently-selected addons to a service object (re-computes price + duration).
  // Respects CSB pricing when state.location === 'csb'. Mutates the passed svc in place.
  function recalcServiceWithAddons(svcRef) {
    const svc = svcRef || state.service;
    if (!svc) return;
    const useCsb = state.location === 'csb';
    const basePrice = useCsb && svc.baseCsbPrice
      ? svc.baseCsbPrice
      : (svc.basePrice || 0);
    const baseMins = svc.baseDurationMins || 0;
    const addons = svc.addons || [];
    let addonPriceSum = 0;
    let addonMinsSum = 0;
    addons.forEach(a => {
      addonPriceSum += (useCsb && a.csbPrice) ? a.csbPrice : a.price;
      addonMinsSum += a.durationMins || 0;
    });
    svc.price = basePrice + addonPriceSum;
    svc.duration = (baseMins + addonMinsSum) + ' menit';
  }

  // ── ADD-ON MODAL CONTROLLER ───────────────────
  const addonOverlay = document.getElementById('addonOverlay');
  const addonListEl = document.getElementById('addonList');
  const addonTitle = document.getElementById('addonTitle');
  const addonBaseDur = document.getElementById('addonBaseDuration');
  const addonBasePrice = document.getElementById('addonBasePrice');
  const addonTotalDur = document.getElementById('addonTotalDur');
  const addonTotalPrice = document.getElementById('addonTotalPrice');
  const addonCloseBtn = document.getElementById('addonClose');
  const addonConfirmBtn = document.getElementById('addonConfirm');

  // Modal-local state (committed to state.service only after confirm)
  let _addonModalCtx = null; // { svcData, baseMins, basePrice, addons:[], selected:Set<id> }

  function _renderAddonTotals() {
    if (!_addonModalCtx) return;
    let mins = _addonModalCtx.baseMins;
    let price = _addonModalCtx.basePrice;
    _addonModalCtx.addons.forEach(a => {
      if (_addonModalCtx.selected.has(a.id)) {
        mins += a.durationMins || 0;
        price += a.price; // modal always shows non-CSB price (cabang baru dipilih di step 2)
      }
    });
    if (addonTotalDur) addonTotalDur.textContent = mins + ' menit';
    if (addonTotalPrice) addonTotalPrice.textContent = fmt(price);
  }

  function openAddonModal(svcData) {
    const addons = getAddonsFor(svcData.id);
    if (!addons || !addons.length) return false;
    _addonModalCtx = {
      svcData,
      baseMins: _parseDurToMins(svcData.duration),
      basePrice: svcData.price,
      addons,
      selected: new Set()
    };
    if (addonTitle) addonTitle.textContent = svcData.name;
    if (addonBaseDur) addonBaseDur.textContent = svcData.duration;
    if (addonBasePrice) addonBasePrice.textContent = fmt(svcData.price);

    // build list
    if (addonListEl) {
      addonListEl.innerHTML = addons.map(a => `
        <div class="addon-item" data-addon="${a.id}">
          <div class="addon-item-left">
            <div class="addon-checkbox">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="addon-item-info">
              <div class="addon-item-name"><span class="addon-item-icon">${a.icon || ''}</span><span>${a.name}</span></div>
              <div class="addon-item-dur">+${a.durationMins} menit</div>
            </div>
          </div>
          <div class="addon-item-right">
            <span class="addon-item-price">+${fmt(a.price)}</span>
            ${a.csbPrice && a.csbPrice !== a.price ? `<span class="addon-item-csb">CSB +${fmt(a.csbPrice)}</span>` : ''}
          </div>
        </div>
      `).join('');
    }
    _renderAddonTotals();

    // open with animation (next frame so transition runs)
    addonOverlay.style.visibility = 'visible';
    requestAnimationFrame(() => addonOverlay.classList.add('open'));
    addonOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    return true;
  }

  function closeAddonModal() {
    if (!addonOverlay) return;
    addonOverlay.classList.remove('open');
    addonOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // wait for transition before clearing list & visibility
    setTimeout(() => {
      if (!addonOverlay.classList.contains('open')) {
        addonOverlay.style.visibility = 'hidden';
        if (addonListEl) addonListEl.innerHTML = '';
      }
    }, 320);
    _addonModalCtx = null;
  }

  // Toggle addon item selection
  addonListEl?.addEventListener('click', e => {
    const item = e.target.closest('.addon-item');
    if (!item || !_addonModalCtx) return;
    const id = item.dataset.addon;
    if (_addonModalCtx.selected.has(id)) {
      _addonModalCtx.selected.delete(id);
      item.classList.remove('selected');
    } else {
      _addonModalCtx.selected.add(id);
      item.classList.add('selected');
    }
    _renderAddonTotals();
  });

  addonCloseBtn?.addEventListener('click', closeAddonModal);
  addonOverlay?.addEventListener('click', e => {
    if (e.target === addonOverlay) closeAddonModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && addonOverlay?.classList.contains('open')) closeAddonModal();
  });

  // Confirm — apply addons to active person's service & continue
  addonConfirmBtn?.addEventListener('click', () => {
    if (!_addonModalCtx) { closeAddonModal(); return; }
    const ctx = _addonModalCtx;
    const selectedAddons = ctx.addons
      .filter(a => ctx.selected.has(a.id))
      .map(a => ({ id: a.id, name: a.name, price: a.price, csbPrice: a.csbPrice, durationMins: a.durationMins }));

    const newSvc = {
      id: ctx.svcData.id,
      name: ctx.svcData.name,
      basePrice: ctx.svcData.price,
      baseCsbPrice: ctx.svcData.csbPrice || null,
      price: ctx.svcData.price,
      csbPrice: ctx.svcData.csbPrice || null,
      baseDuration: ctx.svcData.duration,
      baseDurationMins: ctx.baseMins,
      duration: ctx.svcData.duration,
      addons: selectedAddons
    };
    setActiveService(newSvc);
    recalcServiceWithAddons(newSvc);
    refreshSvcListSelection();

    // Group mode: auto-switch ke person 2 jika belum dipilih
    if (isGroup() && state.activePerson === 1 && !state.person2?.service) {
      state.activePerson = 2;
      refreshSvcListSelection();
    }
    refreshPersonTabs();
    updateStep1Cta();

    closeAddonModal();
    updateSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── BUILD SERVICE LIST (category grouped + show more/less) ──
  const svcList = document.getElementById('svcList');
  const VISIBLE_PER_CAT = 3; // show first N items, rest hidden behind "Show More"

  const CATEGORY_LABELS = {
    'haircut': { label: 'Hair', icon: '✂️' },
    'shave': { label: 'Shave', icon: '🪒' },
    'other': { label: 'Other Services', icon: '💆‍♂️' },
    'package': { label: 'Grooming Packages', icon: '👑' }
  };

  if (svcList && typeof REDBOX_SERVICES !== 'undefined') {
    // Group by category
    const groups = {};
    const catOrder = [];
    REDBOX_SERVICES.forEach(svc => {
      if (!groups[svc.category]) {
        const catInfo = CATEGORY_LABELS[svc.category] || { label: svc.category, icon: '🏷️' };
        groups[svc.category] = { label: catInfo.label, icon: catInfo.icon, items: [] };
        catOrder.push(svc.category);
      }
      groups[svc.category].items.push(svc);
    });

    catOrder.forEach(catKey => {
      const group = groups[catKey];
      const catEl = document.createElement('div');
      catEl.className = 'cat-group';
      catEl.dataset.cat = catKey;

      const hasMore = group.items.length > VISIBLE_PER_CAT;

      // Header
      catEl.innerHTML = `
        <div class="cat-header">
          <span class="cat-icon">${group.icon}</span>
          <h3>${group.label.toUpperCase()}</h3>
          <span class="cat-count">${group.items.length} services</span>
          <span class="cat-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </div>
      `;

      // Body
      const body = document.createElement('div');
      body.className = 'cat-body';

      group.items.forEach((svc, idx) => {
        const item = document.createElement('div');
        item.className = 'svc-item' + (idx >= VISIBLE_PER_CAT ? ' svc-hidden' : '');
        item.dataset.service = svc.id;
        item.dataset.name = svc.name;
        item.dataset.price = svc.price;
        item.dataset.csbPrice = svc.csbPrice || '';
        item.dataset.duration = svc.duration;
        item.dataset.cat = svc.category;

        const badgeHTML = svc.badge
          ? `<span class="svc-badge${svc.category === 'vip' ? ' vip' : ''}">${svc.badge}</span>`
          : '';

        item.innerHTML = `
          <div class="svc-left">
            <div class="svc-radio"></div>
            <div class="svc-info">
              <div class="svc-name-row">
                <strong>${svc.name}</strong>
                ${badgeHTML}
              </div>
              <div class="svc-duration">${svc.duration}</div>
              <p class="svc-desc">${svc.desc}</p>
            </div>
          </div>
          <div class="svc-price">${fmt(svc.price)}</div>
        `;
        body.appendChild(item);
      });

      catEl.appendChild(body);

      // Show More / Show Less toggle button for category
      if (hasMore) {
        const toggleWrap = document.createElement('div');
        toggleWrap.className = 'cat-toggle-wrap';
        const remaining = group.items.length - VISIBLE_PER_CAT;
        toggleWrap.innerHTML = `<button class="cat-toggle-btn" data-expanded="false">Show ${remaining} more</button>`;
        catEl.appendChild(toggleWrap);
      }

      svcList.appendChild(catEl);
    });

    // ── SERVICE ITEM INTERACTIONS ──
    svcList.addEventListener('click', e => {
      // 1) Category header collapse/expand
      const catHeader = e.target.closest('.cat-header');
      if (catHeader) {
        catHeader.closest('.cat-group').classList.toggle('collapsed');
        return;
      }

      // 2) Show more / Show less per category
      const catToggle = e.target.closest('.cat-toggle-btn');
      if (catToggle) {
        e.stopPropagation();
        const catGroup = catToggle.closest('.cat-group');
        const expanded = catToggle.dataset.expanded === 'true';
        const allItems = catGroup.querySelectorAll('.svc-item');

        if (!expanded) {
          // Show all
          allItems.forEach(i => i.classList.remove('svc-hidden'));
          catToggle.dataset.expanded = 'true';
          catToggle.textContent = 'Show less';
        } else {
          // Hide items beyond VISIBLE_PER_CAT
          allItems.forEach((item, idx) => {
            if (idx >= VISIBLE_PER_CAT) item.classList.add('svc-hidden');
          });
          catToggle.dataset.expanded = 'false';
          const remaining = allItems.length - VISIBLE_PER_CAT;
          catToggle.textContent = `Show ${remaining} more`;
        }
        return;
      }

      // 3) Select service
      const svcItem = e.target.closest('.svc-item');
      if (svcItem) {
        const svcData = {
          id: svcItem.dataset.service,
          name: svcItem.dataset.name,
          price: parseInt(svcItem.dataset.price),
          csbPrice: svcItem.dataset.csbPrice ? parseInt(svcItem.dataset.csbPrice) : null,
          duration: svcItem.dataset.duration,
        };

        // If service has add-ons → open popup; commit happens on confirm
        if (getAddonsFor(svcData.id)) {
          openAddonModal(svcData);
          return;
        }

        setActiveService(svcData);
        refreshSvcListSelection();

        // Group mode: auto-switch ke tab person 2 supaya alur intuitif
        if (isGroup() && state.activePerson === 1 && !state.person2?.service) {
          state.activePerson = 2;
          refreshPersonTabs();
          refreshSvcListSelection();
        } else {
          refreshPersonTabs();
        }

        updateStep1Cta();
        updateSidebar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // Pre-select from URL - Go directly to Step 2 (Professional) since service is pre-selected from homepage
    if (preService) {
      const preItem = svcList.querySelector('[data-service="' + preService + '"]');
      if (preItem) {
        // Make sure it's visible (expand category if needed)
        if (preItem.classList.contains('svc-hidden')) {
          const catGroup = preItem.closest('.cat-group');
          const btn = catGroup?.querySelector('.cat-toggle-btn');
          if (btn) btn.click();
        }
        const preSvcData = {
          id: preItem.dataset.service,
          name: preItem.dataset.name,
          price: parseInt(preItem.dataset.price),
          csbPrice: preItem.dataset.csbPrice ? parseInt(preItem.dataset.csbPrice) : null,
          duration: preItem.dataset.duration,
        };

        // Service with add-ons: show modal first so customer can pick add-ons.
        // Modal confirm wires up state + selected style. After confirm, jump to step 2.
        if (getAddonsFor(preSvcData.id)) {
          setTimeout(() => {
            openAddonModal(preSvcData);
            const origConfirm = addonConfirmBtn;
            const onceHandler = () => {
              origConfirm?.removeEventListener('click', onceHandler);
              setTimeout(() => goToStep(2), 60);
            };
            origConfirm?.addEventListener('click', onceHandler);
          }, 200);
        } else {
          setTimeout(() => {
            state.service = preSvcData;
            preItem.classList.add('selected');
            document.getElementById('step1Next').disabled = false;
            updateSidebar();
            goToStep(2);
          }, 150);
        }
      }
    }
  }

  // ── STEP NAVIGATION ─────────────────────────
  function goToStep(n) {
    // Logic: Skip step 2 (Professional) if barber pre-selected from URL
    // Step 2 = Professional, Step 3 = Date & Time
    if (n === 2 && preBarber && state.barber) {
      goToStep(3);
      return;
    }

    document.querySelectorAll('.book-step').forEach(s => {
      s.classList.remove('active');
      s.style.display = '';
    });
    const stepEl = document.getElementById('step' + n);
    if (stepEl) {
      stepEl.classList.add('active');
      stepEl.style.display = '';
    }

    // Show/hide mobile floating continue button
    const mCont = document.getElementById('mobileContinue');
    if (mCont) {
      if (n === 1 && state.service) {
        mCont.disabled = false;
        mCont.classList.add('visible');
      } else {
        mCont.classList.remove('visible');
      }
    }

    // Update sidebar active step
    state.currentStep = n;
    document.querySelectorAll('.sum-row').forEach(r => r.classList.remove('current'));
    const curRow = document.querySelector('.sum-row[data-step="' + n + '"]');
    if (curRow) curRow.classList.add('current');

    // Update steps bar
    document.querySelectorAll('.bstep').forEach(s => {
      const sn = parseInt(s.dataset.step);
      s.classList.toggle('active', sn === n);
      s.classList.toggle('done', sn < n);
    });

    if (n === 2) {
      // Step 2: Professional - fetch and render barbers
      fetchAndRenderBarbers();
      document.getElementById('step2Next').disabled = !step2Ready();
      updateSidebar();
    }

    if (n === 3) {
      // Step 3: Date & Time - build calendar with barber-specific availability
      if (!state.date) {
        state.date = todayStr();
      }
      // Clear old data to prevent stale displays
      fallbackBusyRanges = [];
      mokaAvailabilityActive = false;
      mokaAvailableSlots = [];
      buildCalendar();
      buildTimeGrid([]); // Pass empty initially, will load on date click
      const ts = document.getElementById('timeSection');
      if (ts) ts.style.display = '';
      document.getElementById('step3Next').disabled = !(state.date && state.time);
      updateSidebar();
      
      // Check if selected barber is off duty on the selected date
      checkBarberOffDuty();

      if (state.date) {
        loadAndRenderDate(state.date);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadAndRenderDate(dateStr, dayEl = null) {
    const seq = ++activeLoadSeq;

    state.date = dateStr;
    state.time = null;
    mokaAvailabilityActive = false;
    mokaAvailableSlots = [];
    fallbackBusyRanges = [];

    const timeSection = document.getElementById('timeSection');
    const timeGrid = document.getElementById('timeGrid');
    if (timeSection) timeSection.style.display = '';
    if (timeGrid) {
      timeGrid.innerHTML = '<div class="time-grid-loading">Memuat jadwal...</div>';
    }
    document.getElementById('step3Next').disabled = true;

    const dayEls = document.querySelectorAll('.cal-day');
    dayEls.forEach(d => d.classList.remove('loading'));
    const selectedEl = dayEl || Array.from(dayEls).find(e => e.classList.contains('selected'));
    if (selectedEl) selectedEl.classList.add('loading');

    await new Promise(resolve => requestAnimationFrame(resolve));

    if (USE_API) {
      const durMins = _parseDurToMins(state.service?.duration);
      const outletIdFixed = state.location || 'bypass';
      const barberIdFixed = state.barber?.id || null;
      const promises = [];

      promises.push((async () => {
        try {
          const params = new URLSearchParams({
            outletId: outletIdFixed,
            date: dateStr,
            durationMinutes: durMins,
          });
          if (barberIdFixed) params.set('barberId', barberIdFixed);
          const res = await fetch(`${API_URL}/availability?${params}`, { signal: AbortSignal.timeout(12000) });
          if (res.ok) {
            const json = await res.json();
            mokaAvailableSlots = json.slots || [];
            mokaAvailabilityActive = true;
          }
        } catch (e) {
          console.warn('[Availability] Moka slot API unavailable', e.message);
        }
      })());

      if (barberIdFixed) {
        promises.push((async () => {
          try {
            const sRes = await fetch(
              `${API_URL}/schedules?outletId=${outletIdFixed}&date=${dateStr}&barberId=${barberIdFixed}`,
              { signal: AbortSignal.timeout(25000) }
            );
            if (sRes.ok) {
              const sJson = await sRes.json();
              if (sJson.schedules && sJson.schedules.length > 0) {
                fallbackBusyRanges = sJson.schedules
                  .map(s => {
                    const start = _parseDateTimeToMs(s.start_time);
                    const end = _parseDateTimeToMs(s.end_time);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                    return { start, end };
                  })
                  .filter(Boolean);
              } else {
                fallbackBusyRanges = [];
              }
            }
          } catch (e) {
            console.warn('[Schedules] Fetch error:', e.message);
          }
        })());
      }

      await Promise.all(promises);

      const isToday = dateStr === todayStr();
      const shouldPollToday = isToday && barberIdFixed && barberIdFixed !== 'any';
      if (shouldPollToday) {
        const startedAt = Date.now();
        const maxMs = 30_000;
        const pollOnce = async () => {
          if (seq !== activeLoadSeq) return;
          if (Date.now() - startedAt > maxMs) return;
          try {
            const sRes = await fetch(
              `${API_URL}/schedules?outletId=${outletIdFixed}&date=${dateStr}&barberId=${barberIdFixed}&_t=${Date.now()}`,
              { signal: AbortSignal.timeout(25000) }
            );
            if (!sRes.ok) {
              setTimeout(pollOnce, 2200);
              return;
            }

            const sJson = await sRes.json();
            const nextRanges = (sJson.schedules || [])
              .map(s => {
                const start = _parseDateTimeToMs(s.start_time);
                const end = _parseDateTimeToMs(s.end_time);
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                return { start, end };
              })
              .filter(Boolean);

            if (seq !== activeLoadSeq) return;
            if (nextRanges.length > 0) {
              const prevLen = fallbackBusyRanges ? fallbackBusyRanges.length : 0;
              fallbackBusyRanges = nextRanges;
              if (prevLen !== nextRanges.length) {
                requestAnimationFrame(() => {
                  if (seq !== activeLoadSeq) return;
                  buildTimeGrid([...fallbackBusyRanges]);
                  updateSidebar();
                });
              }
              return;
            }
          } catch {}

          setTimeout(pollOnce, 2200);
        };

        const needsImmediatePoll = !fallbackBusyRanges || fallbackBusyRanges.length === 0;
        if (needsImmediatePoll) {
          setTimeout(pollOnce, 900);
        }
      }
    }

    if (seq !== activeLoadSeq) return;

    if (selectedEl) selectedEl.classList.remove('loading');

    requestAnimationFrame(() => {
      if (seq !== activeLoadSeq) return;
      const currentBusyRanges = fallbackBusyRanges && fallbackBusyRanges.length > 0
        ? [...fallbackBusyRanges]
        : [];
      buildCalendar();
      buildTimeGrid(currentBusyRanges);
      updateSidebar();
    });

    checkBarberOffDuty();
  }

  // ── SIDEBAR ─────────────────────────────────
  function updateSidebar() {
    const hasAny = state.service || state.barber || state.date;
    const hint = document.getElementById('sidebarHint');
    const rows = document.getElementById('sidebarRows');
    if (!hasAny) { hint.style.display = ''; rows.style.display = 'none'; return; }
    hint.style.display = 'none';
    rows.style.display = '';

    const sumServiceEl = document.getElementById('sumService');
    const sumAddonsEl = document.getElementById('sumAddons');

    if (isGroup()) {
      // Group mode: render 2 stacked blocks (Orang 1 + Orang 2)
      if (sumServiceEl) sumServiceEl.innerHTML = '';
      if (sumAddonsEl) {
        const useCsb = state.location === 'csb';
        const blocks = [
          { tag: 'Orang 1', svc: state.service, barber: state.barber },
          { tag: 'Orang 2', svc: state.person2?.service, barber: state.person2?.barber }
        ].map(p => {
          if (!p.svc && !p.barber) {
            return `<div class="sb-group-block"><span class="sb-group-tag">${p.tag}</span><span class="sb-group-line">—</span></div>`;
          }
          const addons = p.svc?.addons || [];
          const addonsHtml = addons.map(a => {
            const ap = (useCsb && a.csbPrice) ? a.csbPrice : a.price;
            return `<span class="sb-group-sub">+ ${a.name} — ${fmt(ap)}</span>`;
          }).join('');
          return `<div class="sb-group-block">
            <span class="sb-group-tag">${p.tag}</span>
            <span class="sb-group-line">${p.svc ? p.svc.name + ' — ' + p.svc.duration : 'Pilih service'}</span>
            ${addonsHtml}
            ${p.barber ? `<span class="sb-group-sub">👤 ${p.barber.name}</span>` : ''}
          </div>`;
        }).join('');
        sumAddonsEl.innerHTML = blocks;
        sumAddonsEl.style.display = '';
      }
      document.getElementById('sumBarber').textContent = (state.barber && state.person2?.barber)
        ? state.barber.name + ' + ' + state.person2.barber.name
        : (state.barber ? state.barber.name : '—');
    } else {
      // Solo mode (default)
      if (sumServiceEl) sumServiceEl.textContent = state.service ? state.service.name + ' — ' + state.service.duration : '—';
      if (sumAddonsEl) {
        const addons = state.service?.addons || [];
        if (addons.length) {
          const useCsb = state.location === 'csb';
          sumAddonsEl.innerHTML = addons.map(a => {
            const p = (useCsb && a.csbPrice) ? a.csbPrice : a.price;
            return `<div class="sum-addon-line"><span class="sum-addon-name">+ ${a.name}</span><span class="sum-addon-price">${fmt(p)}</span></div>`;
          }).join('');
          sumAddonsEl.style.display = '';
        } else {
          sumAddonsEl.innerHTML = '';
          sumAddonsEl.style.display = 'none';
        }
      }
      document.getElementById('sumBarber').textContent = state.barber ? state.barber.name : '—';
    }

    document.getElementById('sumDatetime').textContent =
      (state.date && state.time) ? formatDate(state.date) + ', ' + state.time
      : state.date ? formatDate(state.date) : '—';
    const locSel = document.getElementById('custLocation');
    document.getElementById('sumLocation').textContent = state.location
      ? (locSel?.querySelector('[value="' + state.location + '"]')?.textContent || state.location)
      : '—';

    // Total = person1 + person2 price (when group)
    const total = (state.service?.price || 0) + (isGroup() ? (state.person2?.service?.price || 0) : 0);
    document.getElementById('sumTotal').textContent = total ? fmt(total) : '—';
  }

  // ── STEP 1 NEXT ─────────────────────────────
  document.getElementById('step1Next')?.addEventListener('click', () => {
    if (step1Ready()) goToStep(2);
  });

  // ── MOBILE FLOATING CONTINUE ─────────────────
  document.getElementById('mobileContinue')?.addEventListener('click', () => {
    if (step1Ready()) {
      document.getElementById('mobileContinue')?.classList.remove('visible');
      goToStep(2);
    }
  });

  // ── STEP 3: PROFESSIONAL (Dynamic Rendering) ──
  const proPickGrid = document.getElementById('proPickGrid');
  const proBranchFilter = document.getElementById('proBranchFilter');
  let allBarbers = [];
  let barberOffToday = new Map(); // barber_id → true jika libur hari ini
  let currentBranchFilter = 'bypass';

  function setBranchActive(branch) {
    if (!proBranchFilter) return;
    proBranchFilter.querySelectorAll('.branch-btn').forEach(b => b.classList.toggle('active', b.dataset.branch === branch));
  }

  async function fetchAndRenderBarbers() {
    if (!proPickGrid) return;
    try {
      const res = await fetch(`${API_URL}/barbers?_nocache=1&_t=${Date.now()}`);
      const json = await res.json();
      allBarbers = (json.data || []).filter(b => b.is_active !== false);

      // Fetch today's off-duty status untuk semua barber
      try {
        const tsRes = await fetch(`${API_URL}/barbers/today-status?date=${todayStr()}`);
        if (tsRes.ok) {
          const tsJson = await tsRes.json();
          barberOffToday = new Map();
          for (const bs of tsJson.barbers || []) {
            if (!bs.isWorking) barberOffToday.set(bs.id, true);
          }
        }
      } catch {}

      if (preBarber) {
        const found = allBarbers.find(b => String(b.id) === String(preBarber));
        if (found && found.is_active === false) {
          console.warn('[Booking] Barber preselected from URL is inactive, ignoring.');
        } else if (found?.branch) {
          currentBranchFilter = found.branch;
        }
      }

      setBranchActive(currentBranchFilter);
      renderBarberCards();

      // Branch Filter Click Events
      if (proBranchFilter) {
        proBranchFilter.querySelectorAll('.branch-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            currentBranchFilter = btn.dataset.branch;
            setBranchActive(currentBranchFilter);
            renderBarberCards();
          });
        });
      }

    } catch (err) {
      console.error('Failed to fetch barbers:', err);
      proPickGrid.innerHTML = '<p class="error">Failed to load professionals. Please try again.</p>';
    }
  }

  function renderBarberCards() {
    const filtered = allBarbers.filter(b => b.branch === currentBranchFilter && b.is_active !== false);

    function getInitials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      const a = parts[0]?.[0] || '';
      const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : (parts[0]?.[1] || '');
      return (a + b).toUpperCase() || 'RB';
    }

    function serviceCount(role) {
      const list = String(role || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      return list.length || 0;
    }

    function roleList(role) {
      const list = String(role || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      return list.join(', ');
    }

    function proImgHtml(b) {
      const img = String(b.img || '').trim();
      if (!img) {
        const ini = getInitials(b.name);
        return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-4);color:var(--white);font-weight:800;font-size:1.2rem;letter-spacing:.06em;">${ini}</div>`;
      }
      const _posMap = { 'tegal-yafi': '80% center', 'tegal-wawan': 'center top' };
      const pos = _posMap[String(b.id)] ? `object-fit:cover;object-position:${_posMap[String(b.id)]};` : '';
      const styleAttr = pos ? ` style="${pos}"` : '';
      return `<img src="${img}" alt="${b.name}" loading="lazy" referrerpolicy="no-referrer"${styleAttr} onerror="this.onerror=null;this.src='Brand_assets/Kapster1.jpg';" />`;
    }

    const emptyCard = `
      <div class="pro-pick-card" data-barber="none" style="cursor:default;opacity:.75">
        <div class="pro-pick-img"><div class="pro-pick-icon">ℹ️</div></div>
        <div class="pro-pick-info">
          <h4>Belum ada kapster</h4>
          <span>Coba pilih cabang lain</span>
        </div>
      </div>
    `;

    proPickGrid.innerHTML = `
      ${(filtered.length ? filtered : [{ __empty: true }]).map(b => {
        if (b.__empty) return emptyCard;
        const isOff = barberOffToday.has(b.id);
        return `
          <div class="pro-pick-card ${state.barber?.id === b.id && !isOff ? 'selected' : ''} ${isOff ? 'barber-off' : ''}" data-barber="${b.id}" data-barber-name="${b.name}" data-branch="${b.branch}">
            ${isOff ? '<div class="barber-status-badge off-duty"><span class="status-dot"></span>Libur Hari Ini</div>' : ''}
            <div class="pro-pick-img">${proImgHtml(b)}</div>
            <div class="pro-pick-info">
              <h4>${b.name}</h4>
              <div class="pro-pick-meta">
                <span class="pro-pick-svc">${serviceCount(b.role)} Services</span>
                <span class="pro-pick-branch">${formatBranchName(b.branch)}</span>
              </div>
              <div class="pro-pick-skills" title="${roleList(b.role)}">${roleList(b.role) || '—'}</div>
            </div>
          </div>
        `;
      }).join('')}
      `;

      function formatBranchName(branch) {
        const names = {
          'bypass': 'Bypass',
          'samadikun': 'Samadikun',
          'csb': 'Csb Mall',
          'sumber': 'Sumber',
          'tegal': 'Tegal'
        };
        return names[branch] || branch;
      }

    // Re-attach listeners
    proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => {
      card.addEventListener('click', () => {
        if (card.dataset.barber === 'none' || card.classList.contains('barber-off')) return;

        const barberData = { id: card.dataset.barber, name: card.dataset.barberName, branch: card.dataset.branch };

        // Group mode: prevent picking same kapster for both persons
        if (isGroup()) {
          const otherBarber = state.activePerson === 1 ? state.person2?.barber : state.barber;
          if (otherBarber && String(otherBarber.id) === String(barberData.id)) {
            alert('Kapster ini sudah dipilih untuk orang yang lain. Pilih kapster berbeda agar bisa paralel di waktu yang sama.');
            return;
          }
        }

        setActiveBarber(barberData);
        refreshBarberCardSelection();
        mokaAvailabilityActive = false;
        mokaAvailableSlots = [];
        fallbackBusyRanges = [];

        // Auto-select branch if available (di-share antar person — cabang sama)
        if (card.dataset.branch && card.dataset.branch !== 'any') {
          state.location = card.dataset.branch;
          const locSel = document.getElementById('custLocation');
          if (locSel) locSel.value = state.location;
        }

        // Apply CSB-specific pricing when CSB branch is selected — untuk SEMUA service person
        applyCsbPricingTo(state.service);
        if (isGroup()) applyCsbPricingTo(state.person2?.service);

        // Group mode: auto-switch ke tab person 2 jika belum dipilih
        if (isGroup() && state.activePerson === 1 && !state.person2?.barber) {
          state.activePerson = 2;
          refreshBarberCardSelection();
        }
        refreshPersonTabs();
        updateStep2Cta();
        updateSidebar();
      });
    });

    // Handle pre-selected barber from URL (only once on initial load)
    if (preBarber) {
      const preBarberData = allBarbers.find(b => String(b.id) === String(preBarber));
      if (preBarberData && preBarberData.is_active === false) {
        // Barber nonaktif — jangan auto-select, biarkan user pilih sendiri
        console.warn('[Booking] Barber from URL is inactive, not auto-selecting.');
      } else {
        const preCard = proPickGrid.querySelector(`[data-barber="${preBarber}"]`);
        if (preCard) {
          preCard.click();
          if (state.service && state.barber) {
            setTimeout(() => {
              goToStep(3);
            }, 100);
          }
        }
      }
    }
  }

  fetchAndRenderBarbers();

  // ── STEP 2 NEXT ─────────────────────────────
  document.getElementById('step2Next')?.addEventListener('click', () => {
    if (step2Ready()) goToStep(3);
  });

  // ── BACK BUTTON LOGIC (Handling Skip) ────────
  document.querySelectorAll('.step-back').forEach(btn => {
    btn.addEventListener('click', () => {
      let target = parseInt(btn.dataset.target);
      if (isHomeService && target === 1) {
        window.location.href = 'home-service.html';
        return;
      }
      goToStep(target);
    });
  });

  // ── STEP 3: CALENDAR ───────────────────────
  function buildCalendar() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMonthYear');
    if (!grid || !label) return;

    const today = new Date();
    const y = state.calYear, m = state.calMonth;
    label.textContent = MONTHS[m] + ' ' + y;

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    grid.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const el = document.createElement('div');
      el.className = 'cal-day';
      el.textContent = d;
      const dateObj = new Date(y, m, d);
      const dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      if (dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
        el.classList.add('disabled');
      } else {
        if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) el.classList.add('today');
        if (state.date === dateStr) el.classList.add('selected');
        el.addEventListener('click', async () => {
          if (el.classList.contains('loading')) return;
          
          loadAndRenderDate(dateStr, el);
        });
      }
      grid.appendChild(el);
    }
  }

  function timeToMins(t) {
    if(!t) return 0;
    const [h,m] = t.split(':');
    return parseInt(h)*60 + parseInt(m);
  }

  function parseDuration(durStr) {
    if (!durStr) return 60;
    const s = durStr.toLowerCase();
    let mins = 60;
    if (s.includes('menit')) {
      const m = parseInt(s);
      if (!isNaN(m)) mins = m;
    } else if (s.includes('jam')) {
      const m = parseFloat(s);
      if (!isNaN(m)) mins = m * 60;
    }
    return mins;
  }

  function _parseDateTimeToMs(value) {
    if (value == null) return NaN;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();

    const raw = String(value).trim();
    if (!raw) return NaN;

    let ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return ms;

    let s = raw;
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
      s = s.replace(' ', 'T');
    }
    if (/[+-]\d{2}$/.test(s)) {
      s = `${s}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
      s = `${s}+07:00`;
    }

    ms = new Date(s).getTime();
    return ms;
  }

  // Convert service duration string ("45 menit", "1.5 jam") → integer minutes
  function _parseDurToMins(durStr) {
    if (!durStr) return 30;
    const s = String(durStr).toLowerCase();
    if (s.includes('jam')) return Math.round((parseFloat(s) || 1) * 60);
    const m = parseInt(s, 10);
    return (Number.isFinite(m) && m > 0) ? m : 30;
  }

  function hasConflict(barberId, dateStr, timeStr, durationStr = '60 menit') {
    if (!barberId || barberId === 'any') return false;
    try {
      const bookings = JSON.parse(localStorage.getItem('rb_bookings') || '[]');
      const newStart = timeToMins(timeStr);
      const newEnd = newStart + parseDuration(durationStr);

      const localMatch = bookings.some(b => {
        const bBarber = b.barber_id || b.barber;
        const bDate = String(b.date || '').slice(0, 10);
        const bTime = String(b.time || '').slice(0, 5);
        if (bBarber !== barberId || bDate !== dateStr || b.status === 'cancelled') return false;
        const bStart = timeToMins(bTime);
        const bEnd = bStart + parseDuration(b.duration);
        return (newStart < bEnd) && (bStart < newEnd);
      });

      if (localMatch) return true;

      // Check API-synced bookings (cached in apiBookings)
      return apiBookings.some(b => {
        const bDate = String(b.date || '').slice(0, 10);
        const bTime = String(b.time || '').slice(0, 5);
        if (b.barber_id !== barberId || bDate !== dateStr || b.status === 'cancelled') return false;
        const bStart = timeToMins(bTime);
        const bEnd = bStart + parseDuration(b.duration);
        return (newStart < bEnd) && (bStart < newEnd);
      });
    } catch(e) {
      return false;
    }
  }

  // ── Check if selected barber is off duty on selected date ──
  async function checkBarberOffDuty() {
    const warningEl = document.getElementById('barberOffWarning');
    const barberNameEl = document.getElementById('offDutyBarberName');
    if (!warningEl || !state.barber?.id || !state.date) return;

    try {
      const res = await fetch(`${API_URL}/barbers/today-status?date=${state.date}`);
      if (!res.ok) {
        warningEl.style.display = 'none';
        return;
      }
      const json = await res.json();
      const barberStatus = json.barbers?.find(b => String(b.id) === String(state.barber.id));
      
      if (barberStatus && !barberStatus.isWorking) {
        // Barber is off duty - show warning
        barberNameEl.textContent = state.barber.name;
        warningEl.style.display = 'block';
        // Optionally disable continue button
        document.getElementById('step3Next').disabled = true;
      } else {
        // Barber is working - hide warning
        warningEl.style.display = 'none';
      }
    } catch (e) {
      console.warn('[Off Duty Check] Failed to check barber status:', e.message);
      warningEl.style.display = 'none';
    }
  }

  // Cache for API responses to avoid redundant calls
  const apiCache = new Map();
  const CACHE_TTL = 30000; // 30 seconds

  function getCached(key) {
    const cached = apiCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      apiCache.delete(key);
      return null;
    }
    return cached.data;
  }

  function setCached(key, data) {
    apiCache.set(key, { data, timestamp: Date.now() });
  }

  function buildTimeGrid(busyRanges = fallbackBusyRanges) {
    const grid = document.getElementById('timeGrid');
    if (!grid) return;
    
    const slotsDefault = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
    const slotsCsb     = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
    const slots = state.location === 'csb' ? slotsCsb : slotsDefault;
    const today = todayStr();
    const isToday = state.date === today;
    const floorHourMins = Math.floor(currentLocalMins() / 60) * 60;
    const visibleSlots = isToday ? slots.filter(s => timeToMins(s) > floorHourMins) : slots;
    
    // Use DocumentFragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    
    if (!visibleSlots.length) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'grid-column:1/-1;color:var(--w50);font-size:.85rem;padding:8px 2px';
      emptyMsg.textContent = 'Tidak ada jam tersedia untuk hari ini. Silakan pilih tanggal lain.';
      fragment.appendChild(emptyMsg);
      grid.innerHTML = '';
      grid.appendChild(fragment);
      return;
    }
    
    // Pre-calculate: Build Set of available slot start-times from Moka API
    const mokaFreeSet = new Set();
    if (mokaAvailabilityActive) {
      for (const s of mokaAvailableSlots) {
        const d = new Date(s.start);
        const wibH = String((d.getUTCHours() + 7) % 24).padStart(2, '0');
        const wibM = String(d.getUTCMinutes()).padStart(2, '0');
        mokaFreeSet.add(`${wibH}:${wibM}`);
      }
    }
    
    // Pre-calculate busy ranges check (avoid creating Date objects in loop)
    const hasBusyRanges = state.barber?.id && state.barber.id !== 'any' && busyRanges && busyRanges.length;
    const durMins = hasBusyRanges ? _parseDurToMins(state.service?.duration) : 0;
    
    console.log('[TimeGrid] Building for', state.barber?.name, 'on', state.date);
    console.log('[TimeGrid] hasBusyRanges:', hasBusyRanges, 'busyRanges:', busyRanges);

    let availableCount = 0;
    
    // Batch create all slot elements
    visibleSlots.forEach(slot => {
      const el = document.createElement('div');
      el.className = 'time-slot';
      el.textContent = slot;

      // Optimized isBooked check
      let isBooked = false;
      
      if (hasBusyRanges) {
        // Pre-calculate slot timestamps once
        const slotStartMs = new Date(`${state.date}T${slot}:00+07:00`).getTime();
        const slotEndMs = slotStartMs + durMins * 60_000;
        // Check against busy ranges
        for (let i = 0; i < busyRanges.length; i++) {
          const b = busyRanges[i];
          if (slotStartMs < b.end && slotEndMs > b.start) {
            isBooked = true;
            break;
          }
        }
      }
      
      if (!isBooked && mokaAvailabilityActive) {
        isBooked = !mokaFreeSet.has(slot);
      }
      
      if (!isBooked && !mokaAvailabilityActive) {
        isBooked = hasConflict(state.barber?.id, state.date, slot, state.service?.duration);
        // Group mode: slot juga harus available untuk barber person 2
        if (!isBooked && isGroup() && state.person2?.barber) {
          isBooked = hasConflict(state.person2.barber.id, state.date, slot, state.person2.service?.duration);
        }
      }

      if (isBooked) {
        el.classList.add('unavailable');
      } else {
        availableCount++;
        if (state.time === slot) el.classList.add('selected');
        
        // Use delegated event handling for better performance
        el.dataset.slot = slot;
      }
      
      fragment.appendChild(el);
    });
    
    // Single DOM write for all slots
    grid.innerHTML = '';
    grid.appendChild(fragment);
    
    // Add single delegated click handler
    if (!grid.dataset.rbClickBound) {
      grid.dataset.rbClickBound = '1';
      grid.addEventListener('click', function timeSlotClickHandler(e) {
        const slotEl = e.target.closest('.time-slot:not(.unavailable)');
        if (!slotEl) return;
        
        const slot = slotEl.dataset.slot;
        if (!slot) return;
        
        state.time = slot;
        grid.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
        slotEl.classList.add('selected');
        document.getElementById('step3Next').disabled = false;
        updateSidebar();
      });
    }
    
    // Show message if no slots available
    if (isToday && availableCount === 0) {
      const note = document.createElement('div');
      note.style.cssText = 'grid-column:1/-1;color:var(--w50);font-size:.85rem;padding:8px 2px';
      note.textContent = 'Semua slot hari ini sudah booked. Silakan pilih tanggal lain.';
      grid.appendChild(note);
      document.getElementById('step3Next').disabled = true;
    }
  }

  document.getElementById('calPrev')?.addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    buildCalendar();
  });
  document.getElementById('calNext')?.addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    buildCalendar();
  });
  document.getElementById('step3Next')?.addEventListener('click', () => {
    if (state.date && state.time) goToStep(4);
  });

  // ── STEP 4: DETAILS ────────────────────────
  document.getElementById('step4Next')?.addEventListener('click', () => {
    const custName = document.getElementById('custName');
    const custName2 = document.getElementById('custName2');
    const custWa = document.getElementById('custWa');
    const custLoc = document.getElementById('custLocation');
    let valid = true;
    const custAddr = document.getElementById('custAddress');
    [custName, custName2, custWa, custLoc].forEach(el => el?.closest('.form-group')?.classList.remove('has-error'));
    if (isHomeService) custAddr?.closest('.form-group')?.classList.remove('has-error');

    if (!custName?.value.trim()) { custName.closest('.form-group').classList.add('has-error'); valid = false; }
    if (isGroup() && !custName2?.value.trim()) { custName2.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!custWa?.value.trim() || custWa.value.replace(/\D/g, '').length < 8) { custWa.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!custLoc?.value) { custLoc.closest('.form-group').classList.add('has-error'); valid = false; }
    if (isHomeService && !custAddr?.value.trim()) { custAddr.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!valid) return;

    state.name = custName.value.trim();
    if (isGroup()) {
      state.person2 = state.person2 || {};
      state.person2.name = custName2.value.trim();
    }
    state.wa = custWa.value.trim();
    state.location = custLoc.value;
    state.address = isHomeService ? (custAddr?.value.trim() || '') : '';
    state.notes = document.getElementById('custNotes')?.value.trim() || '';
    updateSidebar();
    buildConfirmSummary();
    goToStep(5);
  });

  // ── STEP 5: CONFIRM ────────────────────────
  function buildConfirmSummary() {
    const box = document.getElementById('confirmSummary');
    if (!box) return;
    const locLabel = document.querySelector('#custLocation [value="' + state.location + '"]')?.textContent || state.location;
    const useCsb = state.location === 'csb';

    // Build per-person service rows (handles both solo & group)
    function personRows(label, svc, barber, name) {
      const addons = svc?.addons || [];
      const baseSvcPrice = svc?.basePrice
        ? (useCsb && svc.baseCsbPrice ? svc.baseCsbPrice : svc.basePrice)
        : (svc?.price || 0);
      const addonRows = addons.map(a => {
        const p = (useCsb && a.csbPrice) ? a.csbPrice : a.price;
        return `<div class="confirm-row addon-row"><span class="cr-label">${a.name}</span><span class="cr-val">${fmt(p)}</span></div>`;
      }).join('');
      return `
        ${label ? `<div class="confirm-row group-header"><span class="cr-label">${label}${name ? ' — ' + name : ''}</span><span class="cr-val">${barber?.name || '—'}</span></div>` : ''}
        <div class="confirm-row"><span class="cr-label">Service</span><span class="cr-val">${svc?.name || '—'}${addons.length ? ' — ' + fmt(baseSvcPrice) : ''}</span></div>
        ${addonRows}
        <div class="confirm-row"><span class="cr-label">Duration</span><span class="cr-val">${svc?.duration || '—'}</span></div>
        ${label ? '' : `<div class="confirm-row"><span class="cr-label">Professional</span><span class="cr-val">${barber?.name || '—'}</span></div>`}
      `;
    }

    const groupRows = isGroup()
      ? personRows('Orang 1', state.service, state.barber, state.name) +
        personRows('Orang 2', state.person2?.service, state.person2?.barber, state.person2?.name)
      : personRows('', state.service, state.barber);

    const total = (state.service?.price || 0) + (isGroup() ? (state.person2?.service?.price || 0) : 0);

    box.innerHTML = `
      ${groupRows}
      <div class="confirm-row"><span class="cr-label">Date</span><span class="cr-val">${state.date ? formatDate(state.date) : '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Time</span><span class="cr-val">${state.time || '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Location</span><span class="cr-val">${locLabel}</span></div>
      ${isHomeService && state.address ? `<div class="confirm-row"><span class="cr-label">Alamat</span><span class="cr-val">${state.address}</span></div>` : ''}
      <div class="confirm-row"><span class="cr-label">${isGroup() ? 'Kontak Utama' : 'Name'}</span><span class="cr-val">${state.name}</span></div>
      <div class="confirm-row"><span class="cr-label">WhatsApp</span><span class="cr-val">+62 ${state.wa}</span></div>
      ${state.notes ? `<div class="confirm-row"><span class="cr-label">Notes</span><span class="cr-val">${state.notes}</span></div>` : ''}
      <div class="confirm-row total-confirm"><span class="cr-label">Total</span><span class="cr-val">${fmt(total)}</span></div>
    `;
  }

  const PAY_INFO = {
    qris: '✅ <strong>QRIS dipilih</strong> — Unduh atau screenshot QR Code di atas, lalu bayar via e-wallet / mobile banking sebelum sesi dimulai.',
    gopay: '✅ <strong>GoPay dipilih</strong> — Pembayaran instan via GoPay. Anda akan diarahkan ke aplikasi GoPay untuk menyelesaikan pembayaran.',
    ovo: '✅ <strong>OVO dipilih</strong> — Pembayaran instan via OVO. Anda akan diarahkan ke aplikasi OVO untuk menyelesaikan pembayaran.',
    dana: '✅ <strong>DANA dipilih</strong> — Pembayaran instan via DANA. Anda akan diarahkan ke aplikasi DANA untuk menyelesaikan pembayaran.',
    shopeepay: '✅ <strong>ShopeePay dipilih</strong> — Pembayaran instan via ShopeePay. Anda akan diarahkan ke aplikasi ShopeePay untuk menyelesaikan pembayaran.',
    card: '✅ <strong>Kartu Kredit/Debit dipilih</strong> — Pembayaran aman via Visa, Mastercard, atau JCB. Anda akan diarahkan ke halaman pembayaran yang aman.',
    cash: '✅ <strong>Bayar di Tempat dipilih</strong> — Siapkan pembayaran cash atau non-cash saat tiba di barber shop.',
  };

  document.querySelectorAll('.pay-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.pay-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.payment = { method: card.dataset.method, name: card.dataset.name };
      const detail = document.getElementById('payDetail');
      if (detail) { detail.innerHTML = PAY_INFO[card.dataset.method] || ''; detail.classList.add('visible'); }
      document.getElementById('finalBookBtn').disabled = false;
    });
  });

  document.getElementById('finalBookBtn')?.addEventListener('click', async () => {
    if (hasConflict(state.barber?.id, state.date, state.time, state.service?.duration)) {
      alert('Mohon maaf, kapster ' + state.barber?.name + ' baru saja di-booking pada jam tersebut. Silakan pilih jadwal lain.');
      goToStep(3); // Go back to Date & Time step
      return;
    }
    if (isGroup() && state.person2?.barber && hasConflict(state.person2.barber.id, state.date, state.time, state.person2.service?.duration)) {
      alert('Mohon maaf, kapster ' + state.person2.barber.name + ' (orang 2) baru saja di-booking pada jam tersebut. Silakan pilih jadwal lain.');
      goToStep(3);
      return;
    }

    const locLabel = document.querySelector('#custLocation [value="' + state.location + '"]')?.textContent || state.location;
    const _useCsbWa = state.location === 'csb';

    // Build group-aware WA blocks
    function _waBlockFor(label, name, svc, barber) {
      const addons = svc?.addons || [];
      const addonLines = addons.map(a => {
        const p = (_useCsbWa && a.csbPrice) ? a.csbPrice : a.price;
        return '  ➕ ' + a.name + ' — ' + fmt(p);
      });
      return [
        label ? '*' + label + (name ? ' — ' + name : '') + '*' : '',
        '✂️ Service: ' + (svc?.name || '—'),
        ...(addonLines.length ? ['🧩 Add-On:', ...addonLines] : []),
        '⏱️ Duration: ' + (svc?.duration || '—'),
        '👤 Kapster: ' + (barber?.name || '—'),
        '💰 Subtotal: ' + fmt(svc?.price || 0),
      ].filter(Boolean);
    }

    const totalPrice = (state.service?.price || 0) + (isGroup() ? (state.person2?.service?.price || 0) : 0);
    const headerLine = isGroup()
      ? '👥 *BOOKING GRUP (2 ORANG) — REDBOX BARBERSHOP*'
      : (isHomeService ? '🏠 *BOOKING HOME SERVICE — REDBOX BARBERSHOP*' : '🔴 *BOOKING REDBOX BARBERSHOP*');

    const msg = [
      headerLine, '',
      ...(isGroup()
        ? [
            ..._waBlockFor('ORANG 1', state.name, state.service, state.barber), '',
            ..._waBlockFor('ORANG 2', state.person2?.name, state.person2?.service, state.person2?.barber), '',
          ]
        : _waBlockFor('', '', state.service, state.barber)),
      '📅 *Jadwal:* ' + (state.date ? formatDate(state.date) : '—') + ' at ' + state.time,
      '📍 *Cabang Terdekat:* ' + locLabel,
      isHomeService && state.address ? '🏠 *Alamat Kamu:* ' + state.address : '',
      '👤 *' + (isGroup() ? 'Kontak Utama' : 'Nama') + ':* ' + state.name,
      '📱 *WhatsApp:* +62' + state.wa,
      state.notes ? '📝 *Catatan:* ' + state.notes : '',
      '💳 *Pembayaran:* ' + state.payment?.name,
      '', '💰 *Total:* ' + fmt(totalPrice),
      '', isHomeService ? '_Tim Redbox akan konfirmasi via WhatsApp_ 🔴' : '_Sharp Cuts, Bold Style_ 🔴',
    ].filter(Boolean).join('\n');

    const branchPhones = {
      'csb': '62818202889',
      'sumber': '62818202599',
      'samadikun': '62818202589',
      'tegal': '62818268883',
      'bypass': '62818202569',
      'default': '62818202569'
    };
    const targetPhone = branchPhones[state.location] || branchPhones['default'];
    const waUrl = 'https://wa.me/' + targetPhone + '?text=' + encodeURIComponent(msg);

    // ── Save to CRM (localStorage + API) ──
    // Generate group_id for linking when 2 orang
    const groupId = isGroup() ? 'GRP-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase() : null;

    function _buildPayloadFor(personIdx, name, svc, barber) {
      const addons = svc?.addons || [];
      const addonNote = addons.length ? '[ADD-ON: ' + addons.map(a => a.name).join(', ') + ']' : '';
      const noteParts = [];
      if (groupId) noteParts.push('[GROUP:' + groupId + ', ' + personIdx + '/2]');
      if (isHomeService && state.address) noteParts.push('[HOME SERVICE] Alamat: ' + state.address);
      if (addonNote) noteParts.push(addonNote);
      if (state.notes) noteParts.push(state.notes);
      const serviceFull = addons.length
        ? svc.name + ' + ' + addons.map(a => a.name).join(' + ')
        : (svc?.name || '');
      return {
        name: name || state.name,
        wa: state.wa,
        service_id: svc?.id || '',
        service: serviceFull,
        price: svc?.price || 0,
        duration: svc?.duration || '',
        barber_id: barber?.id || 'any',
        date: state.date,
        time: state.time,
        location: state.location,
        notes: noteParts.join('\n'),
        payment: state.payment?.name || '',
        status: 'pending'
      };
    }

    const payloads = isGroup()
      ? [
          _buildPayloadFor(1, state.name, state.service, state.barber),
          _buildPayloadFor(2, state.person2?.name, state.person2?.service, state.person2?.barber),
        ]
      : [_buildPayloadFor(1, state.name, state.service, state.barber)];

    let savedToApi = false;

    if (USE_API) {
      try {
        // POST sequentially so conflicts on the 2nd booking can be detected per-row
        for (let i = 0; i < payloads.length; i++) {
          const res = await fetch(API_URL + '/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloads[i])
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            if (res.status === 409) {
              alert('Mohon maaf' + (isGroup() ? ' (booking orang ' + (i + 1) + ')' : '') + ': ' + (errData.error || 'slot bentrok'));
              goToStep(3);
              return;
            }
            alert('Booking gagal disimpan ke server: ' + (errData.error || 'Server error'));
            return;
          }
        }
        console.log('Booking synced to Supabase');
        savedToApi = true;
      } catch(e) {
        console.warn('API sync failed', e);
      }

      if (!savedToApi) {
        alert('Koneksi ke server gagal. Silakan cek koneksi internet dan coba lagi.');
        return;
      }
    }

    // Local fallback hanya untuk mode offline / dev (USE_API = false)
    if (!USE_API) {
      try {
        const existing = JSON.parse(localStorage.getItem('rb_bookings') || '[]');
        payloads.forEach((p, i) => {
          existing.push({
            id: 'bk_' + Date.now() + '_' + i,
            ...p,
            createdAt: new Date().toISOString()
          });
        });
        localStorage.setItem('rb_bookings', JSON.stringify(existing));
      } catch(e) { console.warn('Local storage sync failed', e); }
    }

    document.querySelectorAll('.book-step').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
    const stepSuccess = document.getElementById('stepSuccess');
    stepSuccess.style.display = '';
    stepSuccess.classList.add('active');

    const successBox = document.getElementById('successDetails');
    if (successBox) {
      const _useCsbS = state.location === 'csb';
      function _successPerson(label, name, svc, barber) {
        const addons = svc?.addons || [];
        const addonRows = addons.map(a => {
          const p = (_useCsbS && a.csbPrice) ? a.csbPrice : a.price;
          return `<div class="confirm-row addon-row"><span class="cr-label">${a.name}</span><span class="cr-val">${fmt(p)}</span></div>`;
        }).join('');
        return `
          ${label ? `<div class="confirm-row group-header"><span class="cr-label">${label}${name ? ' — ' + name : ''}</span><span class="cr-val">${barber?.name || '—'}</span></div>` : ''}
          <div class="confirm-row"><span class="cr-label">Service</span><span class="cr-val">${svc?.name || '—'}</span></div>
          ${addonRows}
          ${label ? '' : `<div class="confirm-row"><span class="cr-label">Professional</span><span class="cr-val">${barber?.name || '—'}</span></div>`}
        `;
      }
      const personBlocks = isGroup()
        ? _successPerson('Orang 1', state.name, state.service, state.barber) +
          _successPerson('Orang 2', state.person2?.name, state.person2?.service, state.person2?.barber)
        : _successPerson('', '', state.service, state.barber);
      successBox.innerHTML = `
        ${personBlocks}
        <div class="confirm-row"><span class="cr-label">Schedule</span><span class="cr-val">${formatDate(state.date)}, ${state.time}</span></div>
        <div class="confirm-row"><span class="cr-label">Location</span><span class="cr-val">${locLabel}</span></div>
        <div class="confirm-row total-confirm"><span class="cr-label">Total</span><span class="cr-val">${fmt(totalPrice)}</span></div>
      `;
    }
    const waBtn = document.getElementById('shareWaBtn');
    if (waBtn) waBtn.href = waUrl;

    document.querySelectorAll('.bstep').forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
      const num = el.querySelector('.bstep-num');
      if (num) num.textContent = '✓';
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Show celebration popup with confetti
    if (typeof window.showBookingSuccess === 'function') {
      window.showBookingSuccess();
    }
  });

  // ── HAMBURGER (booking page) ────────────────
  const hamburger = document.getElementById('hamburger');
  const navLinksEl = document.getElementById('navLinks');
  if (hamburger && navLinksEl) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinksEl.classList.toggle('open');
      document.body.style.overflow = navLinksEl.classList.contains('open') ? 'hidden' : '';
    });
    navLinksEl.querySelectorAll('.nav-link').forEach(l => {
      l.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinksEl.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // ── INIT ────────────────────────────────────
  buildCalendar();
  updateSidebar();
  goToStep(1);

  // ── HOME SERVICE MODE ────────────────────────
  if (isHomeService) {
    const hsPrice = hsPackage === 'family' ? HS_PRICE_FAMILY : HS_PRICE_SINGLE;
    const hsLabel = hsPackage === 'family' ? 'Family' : 'Single';
    state.service = {
      id: 'gentleman-grooming',
      name: 'Gentleman Grooming (Home Service ' + hsLabel + ')',
      price: hsPrice,
      basePrice: hsPrice,
      csbPrice: null,
      duration: '60 menit',
    };
    state.hsPackage = hsPackage;

    // Family package = minimum 2 orang → otomatis aktifkan mode group booking
    if (hsPackage === 'family') {
      state.groupSize = 2;
    }

    // Show address field in step 4
    const hsAddr = document.getElementById('hsAddressGroup');
    if (hsAddr) hsAddr.style.display = '';

    // Style: hide step 1 from bar, mark body for CSS
    document.body.classList.add('hs-mode');

    // Update sidebar hint
    const hint = document.getElementById('sidebarHint');
    if (hint) {
      hint.textContent = hsPackage === 'family'
        ? 'Paket Family — pilih kapster untuk 2 orang'
        : 'Pilih kapster untuk memulai';
    }

    // Update page title
    document.title = (hsPackage === 'family' ? 'Home Service Family' : 'Home Service Single') + ' Booking — Redbox Barbershop';

    // Update step 2 heading
    const step2Head = document.querySelector('#step2 .step-head h2');
    const step2Sub  = document.querySelector('#step2 .step-head p');
    if (step2Head) step2Head.textContent = 'Pilih Kapster';
    if (step2Sub) {
      step2Sub.textContent = hsPackage === 'family'
        ? 'Pilih kapster favorit yang akan datang untuk 2 orang ke rumah kamu.'
        : 'Pilih kapster favorit yang akan datang ke rumah kamu.';
    }

    // Jump directly to step 2 (skip service selection)
    updateSidebar();
    goToStep(2);
  }
});
