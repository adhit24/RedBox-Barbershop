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
        document.querySelectorAll('.svc-item').forEach(i => i.classList.remove('selected'));
        svcItem.classList.add('selected');
        state.service = {
          id: svcItem.dataset.service,
          name: svcItem.dataset.name,
          price: parseInt(svcItem.dataset.price),
          csbPrice: svcItem.dataset.csbPrice ? parseInt(svcItem.dataset.csbPrice) : null,
          duration: svcItem.dataset.duration,
        };
        document.getElementById('step1Next').disabled = false;
        const mCont = document.getElementById('mobileContinue');
        if (mCont) { mCont.disabled = false; mCont.classList.add('visible'); }
        const sc = document.getElementById('selectedCount');
        if (sc) sc.textContent = '— ' + state.service.name + ' selected';
        updateSidebar();

        // Show floating continue on mobile (no need to scroll)
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
        setTimeout(() => {
          // Set state directly without triggering click handler (avoid double goToStep)
          state.service = {
            id: preItem.dataset.service,
            name: preItem.dataset.name,
            price: parseInt(preItem.dataset.price),
            csbPrice: preItem.dataset.csbPrice ? parseInt(preItem.dataset.csbPrice) : null,
            duration: preItem.dataset.duration,
          };
          preItem.classList.add('selected');
          document.getElementById('step1Next').disabled = false;
          updateSidebar();

          // Go directly to Step 2 (Professional) - skip showing service selection
          goToStep(2);
        }, 150);
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
      document.getElementById('step2Next').disabled = !state.barber;
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
      const promises = [];

      promises.push((async () => {
        try {
          const params = new URLSearchParams({
            outletId: state.location || 'bypass',
            date: dateStr,
            durationMinutes: durMins,
            barberId: state.barber?.id,
          });
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

      if (state.barber?.id) {
        promises.push((async () => {
          try {
            const outletId = state.location || 'bypass';
            const sRes = await fetch(
              `${API_URL}/schedules?outletId=${outletId}&date=${dateStr}&barberId=${state.barber.id}`,
              { signal: AbortSignal.timeout(8000) }
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

    document.getElementById('sumService').textContent = state.service ? state.service.name + ' — ' + state.service.duration : '—';
    document.getElementById('sumBarber').textContent = state.barber ? state.barber.name : '—';
    document.getElementById('sumDatetime').textContent =
      (state.date && state.time) ? formatDate(state.date) + ', ' + state.time
      : state.date ? formatDate(state.date) : '—';
    const locSel = document.getElementById('custLocation');
    document.getElementById('sumLocation').textContent = state.location
      ? (locSel?.querySelector('[value="' + state.location + '"]')?.textContent || state.location)
      : '—';
    document.getElementById('sumTotal').textContent = state.service ? fmt(state.service.price) : '—';
  }

  // ── STEP 1 NEXT ─────────────────────────────
  document.getElementById('step1Next')?.addEventListener('click', () => {
    if (state.service) goToStep(2);
  });

  // ── MOBILE FLOATING CONTINUE ─────────────────
  document.getElementById('mobileContinue')?.addEventListener('click', () => {
    if (state.service) {
      document.getElementById('mobileContinue')?.classList.remove('visible');
      goToStep(2);
    }
  });

  // ── STEP 3: PROFESSIONAL (Dynamic Rendering) ──
  const proPickGrid = document.getElementById('proPickGrid');
  const proBranchFilter = document.getElementById('proBranchFilter');
  let allBarbers = [];
  let currentBranchFilter = 'bypass';

  function setBranchActive(branch) {
    if (!proBranchFilter) return;
    proBranchFilter.querySelectorAll('.branch-btn').forEach(b => b.classList.toggle('active', b.dataset.branch === branch));
  }

  async function fetchAndRenderBarbers() {
    if (!proPickGrid) return;
    try {
      const res = await fetch(`${API_URL}/barbers`);
      const json = await res.json();
      allBarbers = json.data || [];

      if (preBarber) {
        const found = allBarbers.find(b => String(b.id) === String(preBarber));
        if (found?.branch) currentBranchFilter = found.branch;
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
    const filtered = allBarbers.filter(b => b.branch === currentBranchFilter);

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
      ${(filtered.length ? filtered : [{ __empty: true }]).map(b => b.__empty ? emptyCard : `
          <div class="pro-pick-card ${state.barber?.id === b.id ? 'selected' : ''}" data-barber="${b.id}" data-barber-name="${b.name}" data-branch="${b.branch}">
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
        `).join('')}
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
        if (card.dataset.barber === 'none') return;
        proPickGrid.querySelectorAll('.pro-pick-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.barber = { id: card.dataset.barber, name: card.dataset.barberName, branch: card.dataset.branch };
        mokaAvailabilityActive = false;
        mokaAvailableSlots = [];
        fallbackBusyRanges = [];

        // Auto-select branch if available
        if (card.dataset.branch && card.dataset.branch !== 'any') {
          state.location = card.dataset.branch;
          const locSel = document.getElementById('custLocation');
          if (locSel) locSel.value = state.location;
        }

        // Apply CSB-specific pricing when CSB branch is selected
        if (state.service) {
          const effectivePrice = (state.location === 'csb' && state.service.csbPrice)
            ? state.service.csbPrice
            : (state.service.basePrice || state.service.price);
          if (!state.service.basePrice) state.service.basePrice = state.service.price;
          state.service.price = effectivePrice;
        }

        document.getElementById('step2Next').disabled = false;
        updateSidebar();
      });
    });

    // Handle pre-selected barber from URL (only once on initial load)
    if (preBarber) {
      const preCard = proPickGrid.querySelector(`[data-barber="${preBarber}"]`);
      if (preCard) {
        preCard.click();
        
        // Auto-advance to Step 3 (Date & Time) if service is already selected
        // This happens when user comes from homepage with both service and barber pre-selected
        if (state.service && state.barber) {
          setTimeout(() => {
            goToStep(3);
          }, 100);
        }
      }
    }
  }

  fetchAndRenderBarbers();

  // ── STEP 2 NEXT ─────────────────────────────
  document.getElementById('step2Next')?.addEventListener('click', () => {
    if (state.barber) goToStep(3);
  });

  // ── BACK BUTTON LOGIC (Handling Skip) ────────
  document.querySelectorAll('.step-back').forEach(btn => {
    btn.addEventListener('click', () => {
      let target = parseInt(btn.dataset.target);
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
    const slotsCsb     = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];
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
    const custWa = document.getElementById('custWa');
    const custLoc = document.getElementById('custLocation');
    let valid = true;
    [custName, custWa, custLoc].forEach(el => el?.closest('.form-group')?.classList.remove('has-error'));

    if (!custName?.value.trim()) { custName.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!custWa?.value.trim() || custWa.value.replace(/\D/g, '').length < 8) { custWa.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!custLoc?.value) { custLoc.closest('.form-group').classList.add('has-error'); valid = false; }
    if (!valid) return;

    state.name = custName.value.trim();
    state.wa = custWa.value.trim();
    state.location = custLoc.value;
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
    box.innerHTML = `
      <div class="confirm-row"><span class="cr-label">Service</span><span class="cr-val">${state.service?.name || '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Duration</span><span class="cr-val">${state.service?.duration || '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Professional</span><span class="cr-val">${state.barber?.name || '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Date</span><span class="cr-val">${state.date ? formatDate(state.date) : '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Time</span><span class="cr-val">${state.time || '—'}</span></div>
      <div class="confirm-row"><span class="cr-label">Location</span><span class="cr-val">${locLabel}</span></div>
      <div class="confirm-row"><span class="cr-label">Name</span><span class="cr-val">${state.name}</span></div>
      <div class="confirm-row"><span class="cr-label">WhatsApp</span><span class="cr-val">+62 ${state.wa}</span></div>
      ${state.notes ? `<div class="confirm-row"><span class="cr-label">Notes</span><span class="cr-val">${state.notes}</span></div>` : ''}
      <div class="confirm-row total-confirm"><span class="cr-label">Total</span><span class="cr-val">${fmt(state.service?.price || 0)}</span></div>
    `;
  }

  const PAY_INFO = {
    qris: '✅ <strong>QRIS dipilih</strong> — Unduh atau screenshot QR Code di atas, lalu bayar via e-wallet / mobile banking sebelum sesi dimulai.',
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

    const locLabel = document.querySelector('#custLocation [value="' + state.location + '"]')?.textContent || state.location;
    const msg = [
      '🔴 *BOOKING REDBOX BARBERSHOP*', '',
      '✂️ *Service:* ' + state.service?.name,
      '⏱️ *Duration:* ' + state.service?.duration,
      '👤 *Professional:* ' + state.barber?.name,
      '📅 *Schedule:* ' + (state.date ? formatDate(state.date) : '—') + ' at ' + state.time,
      '📍 *Location:* ' + locLabel,
      '👤 *Name:* ' + state.name,
      '📱 *WhatsApp:* +62' + state.wa,
      state.notes ? '📝 *Notes:* ' + state.notes : '',
      '💳 *Payment:* ' + state.payment?.name,
      '', '💰 *Total:* ' + fmt(state.service?.price || 0),
      '', '_Sharp Cuts, Bold Style_ 🔴',
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
    const payload = {
      name: state.name,
      wa: state.wa,
      service_id: state.service?.id || '',
      service: state.service?.name || '',
      price: state.service?.price || 0,
      duration: state.service?.duration || '',
      barber_id: state.barber?.id || 'any',
      date: state.date,
      time: state.time,
      location: state.location,
      notes: state.notes,
      payment: state.payment?.name || '',
      status: 'pending'
    };

    let savedToApi = false;

    if (USE_API) {
      try {
        const res = await fetch(API_URL + '/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
          const errData = await res.json();
          if (res.status === 409) {
            alert('Mohon maaf: ' + errData.error);
            goToStep(3); // Go back to Date & Time
            return;
          }
          alert('Booking gagal disimpan ke server: ' + (errData.error || 'Server error'));
          return;
        }
        console.log('Booking synced to Supabase');
        savedToApi = true;
      } catch(e) {
        console.warn('API sync failed, checking offline fallback', e);
      }
    }

    // Local fallback hanya untuk mode offline / server tidak terjangkau
    if (!USE_API || !savedToApi) {
      try {
        const existing = JSON.parse(localStorage.getItem('rb_bookings') || '[]');
        existing.push({
          id: 'bk_' + Date.now(),
          ...payload,
          createdAt: new Date().toISOString()
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
      successBox.innerHTML = `
        <div class="confirm-row"><span class="cr-label">Service</span><span class="cr-val">${state.service?.name}</span></div>
        <div class="confirm-row"><span class="cr-label">Professional</span><span class="cr-val">${state.barber?.name}</span></div>
        <div class="confirm-row"><span class="cr-label">Schedule</span><span class="cr-val">${formatDate(state.date)}, ${state.time}</span></div>
        <div class="confirm-row"><span class="cr-label">Location</span><span class="cr-val">${locLabel}</span></div>
        <div class="confirm-row total-confirm"><span class="cr-label">Total</span><span class="cr-val">${fmt(state.service?.price || 0)}</span></div>
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
});
