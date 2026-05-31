// ================================================
// REDBOX BARBERSHOP — MAIN JS
// Homepage interactions
// ================================================
document.addEventListener('DOMContentLoaded', () => {

  // ---- AUTH MODAL — Premium Polish with Spring Animations ----
  const modalOverlay = document.getElementById('loginModal');
  const memberBtn = document.getElementById('memberBtn');
  const modalClose = document.getElementById('modalClose');
  const loginForm = document.getElementById('loginForm');
  const loginFormContainer = document.getElementById('loginFormContainer');
  const signupSuccess = document.getElementById('signupSuccess');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const successCtaBtn = document.getElementById('successCtaBtn');
  const confettiContainer = document.getElementById('confettiContainer');
  const loginModeBtn = document.getElementById('loginModeBtn');
  const signupModeBtn = document.getElementById('signupModeBtn');
  const authTitle = document.getElementById('authTitle');
  const nameField = document.getElementById('nameField');
  const benefitsList = document.getElementById('benefitsList');
  const googleBtnText = document.getElementById('googleBtnText');
  const submitBtnText = document.getElementById('submitBtnText');
  const authIcon = document.getElementById('authIcon');

  let currentMode = 'login';

  // ---- Staggered entrance animation for modal body children ----
  function animateBodyEntrance(container) {
    if (!container) return;
    const children = container.querySelectorAll('.modal-body > *');
    children.forEach((child, i) => {
      child.style.opacity = '0';
      child.style.transform = 'translateY(12px)';
      child.style.transition = 'none';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          child.style.transition = `opacity .4s cubic-bezier(.4,0,.2,1) ${i * 0.06}s, transform .4s cubic-bezier(.175,.885,.32,1.275) ${i * 0.06}s`;
          child.style.opacity = '1';
          child.style.transform = 'translateY(0)';
        });
      });
    });
  }

  // ---- Re-trigger CSS animations on header (icon pop, title slide) ----
  function retriggerHeaderAnimations() {
    if (authIcon) {
      authIcon.style.animation = 'none';
      authIcon.offsetHeight;
      authIcon.style.animation = 'iconPop .5s cubic-bezier(.175,.885,.32,1.275) .15s both';
    }
    if (authTitle) {
      authTitle.style.animation = 'none';
      authTitle.offsetHeight;
      authTitle.style.animation = 'titleSlide .4s cubic-bezier(.4,0,.2,1) .2s both';
    }
  }

  // ---- Toggle Login / Signup Mode ----
  function setAuthMode(mode) {
    currentMode = mode;
    if (loginModeBtn && signupModeBtn) {
      loginModeBtn.classList.toggle('active', mode === 'login');
      signupModeBtn.classList.toggle('active', mode === 'signup');
    }
    if (authTitle) {
      authTitle.textContent = mode === 'login' ? 'MASUK' : 'DAFTAR';
      authTitle.style.animation = 'none';
      authTitle.offsetHeight;
      authTitle.style.animation = 'titleSlide .3s cubic-bezier(.4,0,.2,1) both';
    }
    if (googleBtnText) googleBtnText.textContent = mode === 'login' ? 'Login dengan Google' : 'Daftar dengan Google';
    if (submitBtnText) submitBtnText.textContent = mode === 'login' ? 'Masuk Sekarang' : 'Daftar & Gabung';
    if (nameField) nameField.classList.toggle('show', mode === 'signup');
    if (benefitsList) benefitsList.style.display = mode === 'signup' ? '' : 'none';
    const userNameInput = document.getElementById('userName');
    if (userNameInput) userNameInput.required = mode === 'signup';
  }

  if (loginModeBtn) loginModeBtn.addEventListener('click', () => setAuthMode('login'));
  if (signupModeBtn) signupModeBtn.addEventListener('click', () => setAuthMode('signup'));

  // ---- Open Modal ----
  if (memberBtn && modalOverlay) {
    memberBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetModalState();
      modalOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      retriggerHeaderAnimations();
      setTimeout(() => animateBodyEntrance(loginFormContainer), 100);
    });
  }

  // ---- Close Modal (with ESC key support) ----
  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(resetModalState, 400);
  }
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('active')) closeModal();
  });

  // ---- Reset State ----
  function resetModalState() {
    if (loginFormContainer) loginFormContainer.style.display = '';
    if (signupSuccess) signupSuccess.style.display = 'none';
    if (confettiContainer) confettiContainer.style.display = 'none';
    if (loginForm) loginForm.reset();
    setAuthMode('login');
  }

  // ---- Confetti — multi-burst celebration ----
  function triggerConfetti() {
    if (typeof window.confetti === 'function') {
      const colors = ['#C1121F', '#FBBF24', '#CD7F32', '#9CA3AF', '#FFFFFF'];
      // Initial big burst
      window.confetti({ particleCount: 80, spread: 100, origin: { y: 0.55 }, colors, startVelocity: 45 });
      // Side streams
      const end = Date.now() + 2500;
      (function frame() {
        window.confetti({ particleCount: 3, angle: 60, spread: 50, origin: { x: 0, y: 0.6 }, colors, startVelocity: 35 });
        window.confetti({ particleCount: 3, angle: 120, spread: 50, origin: { x: 1, y: 0.6 }, colors, startVelocity: 35 });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
      // Delayed secondary burst
      setTimeout(() => {
        window.confetti({ particleCount: 50, spread: 120, origin: { y: 0.7 }, colors, startVelocity: 30 });
      }, 800);
    } else {
      if (!confettiContainer) return;
      confettiContainer.style.display = 'block';
      const confettis = confettiContainer.querySelectorAll('.confetti');
      confettis.forEach((c, i) => {
        c.style.animation = 'none';
        c.offsetHeight;
        c.style.animation = 'confetti-fall 3s ease-out forwards';
        c.style.animationDelay = `${i * 0.1}s`;
      });
      setTimeout(() => { confettiContainer.style.display = 'none'; }, 3500);
    }
  }

  // ---- Show Success with staggered animation ----
  function showSignupSuccess(email, userName) {
    if (loginFormContainer) loginFormContainer.style.display = 'none';
    if (signupSuccess) {
      signupSuccess.style.display = '';
      const emailEl = document.getElementById('successUserEmail');
      const nameEl = document.getElementById('successUserName');
      if (emailEl) emailEl.textContent = email || 'member@redbox.com';
      if (nameEl) {
        const displayName = userName || (email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Member');
        nameEl.textContent = currentMode === 'signup' ? `Selamat ${displayName}!` : `Selamat Datang ${displayName}!`;
      }
    }
    setTimeout(triggerConfetti, 200);
  }

  // ---- Form Submit ----
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail')?.value || 'member@redbox.com';
      const userName = document.getElementById('userName')?.value || '';
      showSignupSuccess(email, userName);
    });
  }

  // ---- Google OAuth — Real Integration ----
  const GOOGLE_CLIENT_ID = '759053243482-n8jnskp5utahfdclhjhnvkjhrc4p2tun.apps.googleusercontent.com';

  // Decode JWT payload (no library needed)
  function decodeJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')));
    } catch (e) { return null; }
  }

  // Handle Google credential response
  function handleGoogleCredential(response) {
    const user = decodeJwt(response.credential);
    if (user) {
      // Save to localStorage
      localStorage.setItem('redbox_user', JSON.stringify({
        name: user.name,
        email: user.email,
        picture: user.picture,
        loggedIn: true,
        loginTime: Date.now()
      }));
      showSignupSuccess(user.email, user.given_name || user.name);
    }
  }

  // Initialize Google Identity Services when library loads
  function initGoogleSignIn() {
    if (typeof google === 'undefined' || !google.accounts) return;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
  }

  // Wait for GIS library to load, then initialize
  if (typeof google !== 'undefined' && google.accounts) {
    initGoogleSignIn();
  } else {
    window.addEventListener('load', () => {
      setTimeout(initGoogleSignIn, 500);
    });
  }

  // Custom Google button → trigger Google One Tap / popup
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
      if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // Fallback: use token client for popup consent
            const tokenClient = google.accounts.oauth2.initTokenClient({
              client_id: GOOGLE_CLIENT_ID,
              scope: 'email profile',
              callback: (tokenResponse) => {
                if (tokenResponse.access_token) {
                  // Fetch user info with access token
                  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
                  })
                  .then(res => res.json())
                  .then(user => {
                    localStorage.setItem('redbox_user', JSON.stringify({
                      name: user.name,
                      email: user.email,
                      picture: user.picture,
                      loggedIn: true,
                      loginTime: Date.now()
                    }));
                    showSignupSuccess(user.email, user.given_name || user.name);
                  })
                  .catch(() => showSignupSuccess('member@redbox.com', ''));
                }
              }
            });
            tokenClient.requestAccessToken();
          }
        });
      } else {
        alert('Google Sign-In belum siap. Coba refresh halaman.');
      }
    });
  }

  // ---- Success CTA → Member Dashboard ----
  if (successCtaBtn) {
    successCtaBtn.addEventListener('click', () => {
      window.location.href = 'member-dashboard.html';
    });
  }

  // ---- If already logged in, update Member button ----
  const existingUser = JSON.parse(localStorage.getItem('redbox_user') || 'null');
  if (existingUser && existingUser.loggedIn && memberBtn) {
    const btnSpan = memberBtn.querySelector('span');
    if (btnSpan) btnSpan.textContent = existingUser.name ? existingUser.name.split(' ')[0] : 'Dashboard';
    memberBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = 'member-dashboard.html';
    }, true);
  }

  // ---- GLOBAL UTILS ----
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  // ---- NAVBAR SCROLL ----
  const navbar = document.getElementById('navbar');
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  function updateNavPill() {
    const activeLink = document.querySelector('#navPillWrapper .nav-link.active');
    const track = document.getElementById('navPillTrack');
    const wrapper = document.getElementById('navPillWrapper');
    if (!activeLink || !track || !wrapper) return;
    const wRect = wrapper.getBoundingClientRect();
    const lRect = activeLink.getBoundingClientRect();
    track.style.left   = (lRect.left - wRect.left) + 'px';
    track.style.top    = (lRect.top  - wRect.top)  + 'px';
    track.style.width  = lRect.width  + 'px';
    track.style.height = lRect.height + 'px';
  }

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
    // Active nav link
    let current = '';
    sections.forEach(s => {
      if (window.scrollY >= s.offsetTop - 120) current = s.getAttribute('id');
    });
    navLinks.forEach(l => {
      l.classList.toggle('active', l.getAttribute('href') === '#' + current);
    });
    updateNavPill();
  }, { passive: true });

  updateNavPill();
  window.addEventListener('load', updateNavPill);
  window.addEventListener('resize', updateNavPill);

  // ---- HAMBURGER ----
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

  // ---- SMOOTH SCROLL ----
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function(e) {
      const t = document.querySelector(this.getAttribute('href'));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  // ---- HERO SLIDESHOW ----
  const heroSlides = document.querySelectorAll('.hero-slide');
  if (heroSlides.length > 1) {
    let idx = 0;
    setInterval(() => {
      heroSlides[idx].classList.remove('active');
      idx = (idx + 1) % heroSlides.length;
      heroSlides[idx].classList.add('active');
    }, 5000);
  }

  // ---- SERVICES SECTION (Categorized & Paginated) ----
  const svcGrid = document.getElementById('svcGrid');
  const svcPagination = document.getElementById('svcPagination');
  const svcFilterBtns = document.querySelectorAll('.svc-filter-btn');

  if (svcGrid && typeof REDBOX_SERVICES !== 'undefined') {
    let currentCategory = 'haircut';
    let currentPage = 1;
    
    // Dynamic items per page: 6 for desktop (3x2), 4 for mobile (2x2)
    const getItemsPerPage = () => window.innerWidth > 768 ? 6 : 4;
    let itemsPerPage = getItemsPerPage();

    const fmt = n => 'Rp ' + Number(n).toLocaleString('id-ID');

    function renderServices() {
      itemsPerPage = getItemsPerPage(); // Re-calculate in case of resize
      // Filter by category
      const filtered = REDBOX_SERVICES.filter(s => s.category === currentCategory);

      // Pagination
      const totalPages = Math.ceil(filtered.length / itemsPerPage);
      const start = (currentPage - 1) * itemsPerPage;
      const paginatedItems = filtered.slice(start, start + itemsPerPage);

      // Render Grid - Entire card is clickable
      svcGrid.innerHTML = paginatedItems.map(svc => {
        const csbNote = (svc.csbPrice && svc.csbPrice !== svc.price)
          ? `<span class="svc-card-csb-price" title="Harga Cabang CSB Mall">CSB Mall: ${fmt(svc.csbPrice)}</span>`
          : '';
        return `
        <div class="svc-card reveal">
          <a href="booking.html?service=${svc.id}" class="svc-card-img-link" aria-label="Reservasi ${svc.name}">
            <div class="svc-card-img">
              <img src="${svc.img || ''}" alt="${svc.name}" style="width:100%;height:100%;object-fit:cover;" />
              ${svc.badge ? `<span class="svc-card-badge">${svc.badge}</span>` : ''}
            </div>
          </a>
          <div class="svc-card-body">
            <h3>${svc.name}</h3>
            <div class="svc-card-meta">
              <span class="svc-card-duration">${svc.duration}</span>
              <span class="svc-card-price">${fmt(svc.price)}</span>
            </div>
            ${csbNote}
            <p class="svc-card-desc">${svc.desc}</p>
          </div>
        </div>`;
      }).join('');

      // Render Pagination Numbers
      if (totalPages > 1) {
        let paginationHTML = '';
        for (let i = 1; i <= totalPages; i++) {
          paginationHTML += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        svcPagination.innerHTML = paginationHTML;

        // Add events to page buttons
        svcPagination.querySelectorAll('.page-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            currentPage = parseInt(btn.dataset.page);
            renderServices();
            svcGrid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });
      } else {
        svcPagination.innerHTML = '';
      }

      // Re-apply reveal animation
      if (typeof revealObs !== 'undefined') {
        svcGrid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
      }
    }

    // Filter Button Events
    svcFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.category === 'package') { window.location.href = 'packages.html'; return; }
        svcFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.category;
        currentPage = 1;
        renderServices();
      });
    });

    renderServices();

    // Listen for resize to update grid layout
    window.addEventListener('resize', () => {
      const newItemsPerPage = getItemsPerPage();
      if (newItemsPerPage !== itemsPerPage) {
        itemsPerPage = newItemsPerPage;
        currentPage = 1; // Reset to first page on layout change
        renderServices();
      }
    });
  }

  // ---- PROFESSIONALS SECTION ----
  const API_URL = (() => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001/api';
    }
    return `${window.location.protocol}//${window.location.host}/api`;
  })();

  const proGrid = document.getElementById('proGridDesktop');
  const proSwiper = document.getElementById('proSwiper');
  const proDots = document.getElementById('proDots');
  const filterBtns = document.querySelectorAll('.filter-btn');

  let allBarbers = [];

  const FALLBACK_BARBERS = [
    { id:'bypass-bob',        name:'Bob',          role:'Haircut;Fade;Coloring;Beard Trim',                      img:'https://lh3.googleusercontent.com/d/1q8jZWo5lHXb6PhxoFkVMQ9BsyO7hh87Z=w800',  branch:'bypass' },
    { id:'bypass-kaji-dodi',  name:'Dodi',         role:'Haircut',                                               img:'https://lh3.googleusercontent.com/d/1Oiu0LB7qtC0Hq1vsBXHp94uBDFKJ3GMs=w800',  branch:'bypass' },
    { id:'bypass-ari',        name:'Ari',           role:'Haircut;Fade',                                          img:'https://lh3.googleusercontent.com/d/1O8Ze8nBCbFwMS4z7Zxi3048wWHTGSo-E=w800',  branch:'bypass' },
    { id:'bypass-onoy',       name:'Onoy',          role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim',          img:'https://lh3.googleusercontent.com/d/1-KjMqpgGqACn-zvtIxjmMQRlGEjPbaFj=w800',  branch:'bypass' },
    { id:'bypass-abdul-dul',  name:'Abdul',        role:'Haircut;Fade',                                          img:'https://lh3.googleusercontent.com/d/11rOyCrW-eTP63f0v7Q9f9PPrrw9DRUF_=w800',  branch:'bypass' },
    { id:'samadikun-khamami', name:'Khamami',       role:'Haircut;Fade;Coloring;Beard Trim',                      img:'https://lh3.googleusercontent.com/d/1Xkdg9j7Wl1vNKo9qT983dmP4sMlERiLz=w800',  branch:'samadikun' },
    { id:'samadikun-opan',    name:'Opan',          role:'Fade',                                                  img:'https://lh3.googleusercontent.com/d/132eu8d4LQ0Nx3F6aTFc25XFv6MLekTpS=w800',  branch:'samadikun' },
    { id:'samadikun-sofyan',  name:'Sofyan',        role:'Haircut;Fade;Coloring;Beard Trim',                      img:'https://lh3.googleusercontent.com/d/10jANuN1FlftSZlYQ3CgXXJlQXYTeoDMs=w800', branch:'samadikun' },
    { id:'samadikun-aden',    name:'Aden',          role:'Haircut',                                               img:'https://lh3.googleusercontent.com/d/1_1kdLWc0RkYoQeYRUwgGIZTlOE1aBXOF=w800',  branch:'samadikun' },
    { id:'samadikun-miftah',  name:'Miftah',        role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim;Perming',  img:'https://lh3.googleusercontent.com/d/1hY0OyEuhawUXVMrr1hKPZfzv9byNPtca=w800',  branch:'samadikun' },
    { id:'csb-syarif',        name:'Syarif',        role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim',          img:'https://lh3.googleusercontent.com/d/1m_2_-mcpzJJdCOahUNK6Q-gMkF7qKsK2=w800',  branch:'csb' },
    { id:'csb-ubay',          name:'Ubay',          role:'Haircut;Fade;Coloring',                                 img:'https://lh3.googleusercontent.com/d/15jk6PqmgvbRQQSV-JQFKPiVB9D66sKO1=w800',  branch:'csb' },
    { id:'csb-ragil',         name:'Ragil',         role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim',          img:'https://lh3.googleusercontent.com/d/1Lz5w34dGpf_T8vVuzbWlvlNtk0-7OuPa=w800',  branch:'csb' },
    { id:'csb-ega',           name:'Ega',           role:'Haircut;Coloring;Hair Tattoo;Beard Trim',               img:'https://lh3.googleusercontent.com/d/1Wid4-crVovOne-aMSbdLXkPv3lHyVtN4=w800',  branch:'csb' },
    { id:'csb-husen',         name:'Husen',         role:'Haircut;Fade;Coloring;Perming',                         img:'https://lh3.googleusercontent.com/d/1mukcy-FFh9PdlLf7VskiaBjFShvW8gOR=w800',  branch:'csb' },
    { id:'csb-yudha',         name:'Yudha',         role:'Haircut;Fade',                                          img:'https://lh3.googleusercontent.com/d/1mJmagHtgfC2lmI7YiECA-QQ4ZscPCWds=w800',  branch:'csb' },
    { id:'sumber-prima',      name:'Prima',         role:'Haircut',                                               img:'https://lh3.googleusercontent.com/d/1gGTM8a6Rrlw3SgfJOvZEzAcZkIm_2ysl=w800',  branch:'sumber' },
    { id:'sumber-sigit',      name:'Sigit',         role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim;Chemical', img:'https://lh3.googleusercontent.com/d/19Tp5LCEoNqkDU4iRUGzT--xqmRqkIue_=w800',  branch:'sumber' },
    { id:'sumber-didi',       name:'Didi',          role:'Haircut;Fade;Coloring;Hair Tattoo;Beard Trim',          img:'https://lh3.googleusercontent.com/d/1_WCEC6tHVlVqFeKrcbZZ0NEe-BDr03cI=w800',  branch:'sumber' },
    { id:'tegal-faiz',        name:'Faiz',          role:'Haircut;Fade;Coloring;Beard Trim',                      img:'https://lh3.googleusercontent.com/d/1p9CMGJAodrr6aaxljTUtiqlelgk5rJbA=w800',  branch:'tegal' },
    { id:'tegal-yafi',        name:'Yafi',          role:'Haircut;Fade;Coloring;Creambath',                       img:'https://lh3.googleusercontent.com/d/1vMxXb0bir4tnncM1Hk-62PPRG6FXA80T=w800',  branch:'tegal' },
    { id:'tegal-epik',        name:'Epik',          role:'Haircut;Fade;Long trim',                                img:'https://lh3.googleusercontent.com/d/10A9IZpNmmCFb13tu6OigSxEF_wTS1s9j=w800',  branch:'tegal' },
    { id:'tegal-wawan',       name:'Wawan',         role:'Haircut;Fade;Coloring',                                 img:'https://lh3.googleusercontent.com/d/1G4Smy7D5oZrlKjrl0W05_ktJnCIB4Lgo=w800',  branch:'tegal' },
    { id:'tegal-ahmad',       name:'Ahmad',         role:'Haircut;Fade;Coloring;Creambath',                       img:'/Brand_assets/Kapster2.jpg', branch:'tegal' },
    { id:'tegal-sephril',     name:'Sephril',       role:'Haircut;Fade;Coloring;Creambath',                       img:'/Brand_assets/Kapster4.jpg', branch:'tegal' }
  ];

  async function fetchBarbers() {
    try {
      const res = await fetch(`${API_URL}/barbers`);
      const json = await res.json();
      allBarbers = (json.data && json.data.length) ? json.data : FALLBACK_BARBERS;
      renderBarbers('bypass'); // Default to bypass
    } catch (err) {
      console.error('Failed to fetch barbers, using fallback data:', err);
      allBarbers = FALLBACK_BARBERS;
      renderBarbers('bypass');
    }
  }

  function renderBarbers(branchFilter) {
    if (!proGrid || !proSwiper) return;

    const filtered = (branchFilter === 'all'
      ? allBarbers
      : allBarbers.filter(b => b.branch === branchFilter))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'));

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

    const VISIBLE_SKILLS = 4;

    function renderSkills(role) {
      const skills = String(role || '').split(',').map(s => s.trim()).filter(Boolean);
      if (skills.length <= 1) {
        return `<span class="pro-role">${skills[0] || ''}</span>`;
      }
      const visible = skills.slice(0, VISIBLE_SKILLS);
      const hidden  = skills.slice(VISIBLE_SKILLS);
      const visibleHTML = visible.map(s => `<span class="pro-skill-tag">${s}</span>`).join('');
      const hiddenHTML  = hidden.map(s => `<span class="pro-skill-tag">${s}</span>`).join('');
      const moreHTML = hidden.length
        ? `<details class="pro-skills-more"><summary>+${hidden.length} more</summary><span class="pro-skills-extra">${hiddenHTML}</span></details>`
        : '';
      return `<div class="pro-skills">${visibleHTML}${moreHTML}</div>`;
    }

    function proImgHtml(b) {
      const img = String(b.img || '').trim();
      if (!img) {
        const ini = getInitials(b.name);
        return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-4);color:var(--white);font-weight:800;font-size:1.25rem;letter-spacing:.06em;">${ini}</div>`;
      }
      const pos = String(b.id) === 'tegal-yafi' ? 'object-fit:cover;object-position:80% center;' : '';
      const styleAttr = pos ? ` style="${pos}"` : '';
      return `<img src="${img}" alt="${b.name}" loading="lazy" referrerpolicy="no-referrer"${styleAttr} onerror="this.onerror=null;this.src='/Brand_assets/Kapster1.jpg';" />`;
    }

    // Render Desktop
    proGrid.innerHTML = filtered.map(b => `
      <div class="pro-card reveal">
        <a href="booking.html?barber=${b.id}" class="pro-img-link" aria-label="Reservasi dengan ${b.name}">
          <div class="pro-img">
            ${proImgHtml(b)}
          </div>
        </a>
        <div class="pro-info">
          <h3>${b.name}</h3>
          ${renderSkills(b.role)}
          <div class="pro-meta">
            <span class="pro-services">${serviceCount(b.role)} Services</span>
            <span class="pro-branch-tag">${formatBranchName(b.branch)}</span>
          </div>
        </div>
      </div>
    `).join('');

    proSwiper.innerHTML = `
      <div class="pro-mgrid">
        ${filtered.map(b => `
          <div class="pro-card pro-card-mini">
            <a href="booking.html?barber=${b.id}" class="pro-img-link" aria-label="Reservasi dengan ${b.name}">
              <div class="pro-img">
                ${proImgHtml(b)}
              </div>
            </a>
            <div class="pro-info">
              <h3>${b.name}</h3>
              ${renderSkills(b.role)}
              <div class="pro-meta">
                <span class="pro-services">${serviceCount(b.role)} Services</span>
                <span class="pro-branch-tag">${formatBranchName(b.branch)}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
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

    if (proDots) proDots.innerHTML = '';
    
    // Re-apply reveal animation
    initReveal();
  }

  function initSwiperLogic(count) {
    const slides = document.querySelectorAll('.pro-slide');
    const dots = document.querySelectorAll('.pro-dot');
    let current = 0;

    function goToSlide(n) {
      if (!slides.length) return;
      slides[current].classList.remove('active');
      dots[current]?.classList.remove('active');
      current = (n + slides.length) % slides.length;
      slides[current].classList.add('active');
      dots[current]?.classList.add('active');
    }

    // Clear old listeners by cloning buttons
    const prevBtn = document.getElementById('proArrowPrev');
    const nextBtn = document.getElementById('proArrowNext');
    
    if (prevBtn) {
      const newPrev = prevBtn.cloneNode(true);
      prevBtn.parentNode.replaceChild(newPrev, prevBtn);
      newPrev.addEventListener('click', () => goToSlide(current - 1));
    }
    if (nextBtn) {
      const newNext = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNext, nextBtn);
      newNext.addEventListener('click', () => goToSlide(current + 1));
    }

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => goToSlide(i));
    });

    // Touch swipe
    let startX = 0;
    proSwiper?.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    proSwiper?.addEventListener('touchend', e => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) goToSlide(diff > 0 ? current + 1 : current - 1);
    });
  }

  function initReveal() {
    const reveals = document.querySelectorAll('.pro-card.reveal');
    reveals.forEach((el, i) => {
      const d = i % 4;
      if (d === 1) el.classList.add('reveal-d1');
      if (d === 2) el.classList.add('reveal-d2');
      if (d === 3) el.classList.add('reveal-d3');
      revealObs.observe(el);
    });
  }

  // Filter Buttons Event Listeners
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBarbers(btn.dataset.branch);
    });
  });

  fetchBarbers();

  function initLocationBranches() {
    const filter = document.getElementById('locBranchFilter');
    const frame = document.getElementById('locMapFrame');
    const addrMain = document.getElementById('locAddressMain');
    const addrSub = document.getElementById('locAddressSub');
    const mapLink = document.getElementById('locMapLink');
    if (!filter || !frame || !addrMain || !addrSub || !mapLink) return;

    const btns = Array.from(filter.querySelectorAll('.loc-branch-btn'));
    if (!btns.length) return;

    const hoursVal = document.getElementById('locHoursValue');
    const waLink = document.getElementById('locWaLink');
    const waNumber = document.getElementById('locWaNumber');
    const waFloat = document.getElementById('waFloat');

    const setActive = btn => {
      btns.forEach(b => b.classList.toggle('active', b === btn));
      const q = btn.dataset.query || '';
      const src = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      frame.src = src;
      addrMain.textContent = btn.dataset.main || '';
      addrSub.textContent = btn.dataset.sub || '';
      const share = btn.dataset.share || '';
      mapLink.href = share || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
      if (hoursVal) {
        hoursVal.textContent = btn.dataset.branch === 'csb' ? '10:00 — 21:30' : '10:00 — 21:00';
      }

      // Update WhatsApp numbers
      const waData = btn.dataset.wa;
      const waFormat = btn.dataset.waFormat;
      if (waData && waFormat) {
        if (waLink) {
          waLink.href = `https://wa.me/${waData}?text=Hi%20Redbox%20Barbershop%2C%20I%27d%20like%20to%20book%20an%20appointment`;
        }
        if (waNumber) {
          waNumber.textContent = waFormat;
        }
        if (waFloat) {
          waFloat.href = `https://wa.me/${waData}?text=Halo%20Redbox,%20saya%20ingin%20booking`;
        }
      }
    };

    btns.forEach(btn => btn.addEventListener('click', () => setActive(btn)));
    setActive(btns.find(b => b.classList.contains('active')) || btns[0]);
  }

  function initReviewsCarousel() {
    const grid = document.querySelector('.reviews-grid');
    const dotsWrap = document.getElementById('reviewsDots');
    if (!grid || !dotsWrap) return;

    const mm = window.matchMedia('(max-width: 768px)');
    const cards = Array.from(grid.querySelectorAll('.review-card'));
    const perPage = 2;
    const pages = Math.ceil(cards.length / perPage);
    if (pages <= 1) {
      dotsWrap.innerHTML = '';
      return;
    }

    dotsWrap.innerHTML = Array.from({ length: pages })
      .map((_, i) => `<button class="review-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" aria-label="Slide ${i + 1}"></button>`)
      .join('');

    const dots = Array.from(dotsWrap.querySelectorAll('.review-dot'));
    let current = 0;
    let intervalId = null;
    let resumeTimer = null;

    const pageWidth = () => grid.clientWidth || 1;

    const setActive = idx => {
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    };

    const goTo = (idx, smooth = true) => {
      current = (idx + pages) % pages;
      grid.scrollTo({ left: current * pageWidth(), behavior: smooth ? 'smooth' : 'auto' });
      setActive(current);
    };

    const stop = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = null;
    };

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (!mm.matches) return;
        goTo(current + 1, true);
      }, 2000);
    };

    const pauseAndResume = () => {
      stop();
      resumeTimer = setTimeout(() => start(), 2400);
    };

    let raf = 0;
    grid.addEventListener('scroll', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!mm.matches) return;
        const idx = Math.round(grid.scrollLeft / pageWidth());
        const bounded = Math.max(0, Math.min(pages - 1, idx));
        if (bounded !== current) {
          current = bounded;
          setActive(current);
        }
      });
    }, { passive: true });

    grid.addEventListener('touchstart', stop, { passive: true });
    grid.addEventListener('touchend', pauseAndResume, { passive: true });
    grid.addEventListener('mousedown', stop);
    grid.addEventListener('mouseup', pauseAndResume);

    dotsWrap.addEventListener('click', e => {
      const btn = e.target.closest('.review-dot');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!Number.isFinite(idx)) return;
      goTo(idx, true);
      pauseAndResume();
    });

    window.addEventListener('resize', () => {
      if (!mm.matches) {
        stop();
        return;
      }
      goTo(current, false);
      start();
    }, { passive: true });

    goTo(0, false);
    start();
  }

  initReviewsCarousel();
  initLocationBranches();

  // ---- SCROLL REVEAL (Existing for other sections) ----
  document.querySelectorAll(
    '.svc-card, .gallery-item, .review-card, .htb-step, .loc-card, .section-header'
  ).forEach((el, i) => {
    el.classList.add('reveal');
    const d = i % 4;
    if (d === 1) el.classList.add('reveal-d1');
    if (d === 2) el.classList.add('reveal-d2');
    if (d === 3) el.classList.add('reveal-d3');
    revealObs.observe(el);
  });

  // ---- LOGO TRANSPARENCY (strip black background at runtime) ----
  function applyTransparentLogo() {
    document.querySelectorAll('.nav-logo img, .footer-logo-img').forEach(img => {
      function process(src) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const tmp = new Image();
        tmp.crossOrigin = 'anonymous';
        tmp.onload = function() {
          canvas.width = tmp.naturalWidth;
          canvas.height = tmp.naturalHeight;
          ctx.drawImage(tmp, 0, 0);
          try {
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < d.data.length; i += 4) {
              if (d.data[i] < 40 && d.data[i+1] < 40 && d.data[i+2] < 40) d.data[i+3] = 0;
            }
            ctx.putImageData(d, 0, 0);
            img.src = canvas.toDataURL('image/png');
          } catch(e) {}
        };
        tmp.src = src;
      }
      img.complete ? process(img.src) : img.addEventListener('load', () => process(img.src), { once: true });
    });
  }
  applyTransparentLogo();

  // ---- GALLERY LIGHTBOX ----
  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      const img = item.querySelector('img');
      if (!img) return;
      const overlay = document.createElement('div');
      overlay.className = 'lightbox-overlay';
      const image = document.createElement('img');
      image.src = img.src; image.alt = img.alt;
      const close = document.createElement('button');
      close.className = 'lightbox-close'; close.innerHTML = '&times;';
      overlay.appendChild(image);
      overlay.appendChild(close);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      const closeLB = () => { overlay.remove(); document.body.style.overflow = ''; };
      overlay.addEventListener('click', e => { if (e.target === overlay) closeLB(); });
      close.addEventListener('click', closeLB);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLB(); }, { once: true });
    });
  });

});
