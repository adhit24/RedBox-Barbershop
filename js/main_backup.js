// ================================================
// REDBOX BARBERSHOP — MAIN JAVASCRIPT
// ================================================

document.addEventListener('DOMContentLoaded', () => {

  // ---- NAVBAR SCROLL ----
  const navbar = document.getElementById('navbar');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('section[id]');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    updateActiveNav();
  }, { passive: true });

  function updateActiveNav() {
    let current = '';
    sections.forEach(section => {
      const top = section.offsetTop - 100;
      if (window.scrollY >= top) current = section.getAttribute('id');
    });
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) link.classList.add('active');
    });
  }

  // ---- HAMBURGER MENU ----
  const hamburger = document.getElementById('hamburger');
  const navLinksContainer = document.getElementById('navLinks');

  hamburger?.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navLinksContainer.classList.toggle('open');
    document.body.style.overflow = navLinksContainer.classList.contains('open') ? 'hidden' : '';
  });

  navLinksContainer?.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      navLinksContainer.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // ---- SMOOTH SCROLL ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ---- SCROLL REVEAL ----
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  // Auto-add reveal to major sections
  const revealTargets = document.querySelectorAll(
    '.service-card, .pro-card, .gallery-item, .branch, .testi-card, .section-header, .qb-step'
  );
  revealTargets.forEach((el, i) => {
    el.classList.add('reveal');
    if (i % 3 === 1) el.classList.add('reveal-delay-1');
    if (i % 3 === 2) el.classList.add('reveal-delay-2');
    revealObserver.observe(el);
  });

  // ---- TESTIMONIALS SLIDER ----
  const testiTrack = document.getElementById('testiTrack');
  const testiDots = document.getElementById('testiDots');
  const testiPrev = document.getElementById('testiPrev');
  const testiNext = document.getElementById('testiNext');

  if (testiTrack) {
    const cards = testiTrack.querySelectorAll('.testi-card');
    let currentTesti = 0;
    let itemsVisible = getVisibleCount();

    function getVisibleCount() {
      if (window.innerWidth >= 1024) return 3;
      if (window.innerWidth >= 640)  return 2;
      return 1;
    }

    function buildDots() {
      testiDots.innerHTML = '';
      const total = Math.ceil(cards.length / itemsVisible);
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('button');
        dot.className = `testi-dot${i === 0 ? ' active' : ''}`;
        dot.addEventListener('click', () => goTo(i));
        testiDots.appendChild(dot);
      }
    }

    function goTo(index) {
      itemsVisible = getVisibleCount();
      const total = Math.ceil(cards.length / itemsVisible);
      currentTesti = Math.max(0, Math.min(index, total - 1));
      const cardWidth = testiTrack.querySelector('.testi-card').offsetWidth + 24;
      testiTrack.style.transform = `translateX(-${currentTesti * itemsVisible * cardWidth}px)`;
      testiDots.querySelectorAll('.testi-dot').forEach((d, i) => {
        d.classList.toggle('active', i === currentTesti);
      });
    }

    testiPrev?.addEventListener('click', () => goTo(currentTesti - 1));
    testiNext?.addEventListener('click', () => goTo(currentTesti + 1));

    buildDots();

    // Auto-play
    let autoPlay = setInterval(() => goTo(currentTesti + 1 < Math.ceil(cards.length / itemsVisible) ? currentTesti + 1 : 0), 5000);
    testiTrack.addEventListener('mouseenter', () => clearInterval(autoPlay));
    testiTrack.addEventListener('mouseleave', () => {
      autoPlay = setInterval(() => goTo(currentTesti + 1 < Math.ceil(cards.length / itemsVisible) ? currentTesti + 1 : 0), 5000);
    });

    window.addEventListener('resize', () => {
      itemsVisible = getVisibleCount();
      buildDots();
      goTo(0);
    }, { passive: true });
  }

  // ---- COUNTER ANIMATION ----
  function animateCounter(el, target, suffix = '') {
    let start = 0;
    const duration = 2000;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        el.textContent = target + suffix;
        clearInterval(timer);
      } else {
        el.textContent = Math.floor(start) + suffix;
      }
    }, 16);
  }

  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const statNums = entry.target.querySelectorAll('.stat-num');
        statNums.forEach(num => {
          const text = num.textContent;
          const match = text.match(/[\d.]+/);
          if (match) {
            const val = parseFloat(match[0]);
            const suffix = text.replace(match[0], '');
            num.textContent = '0' + suffix;
            animateCounter(num, val, suffix);
          }
        });
        statObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  const heroStats = document.querySelector('.hero-stats');
  if (heroStats) statObserver.observe(heroStats);

  // ---- HERO PHOTO SLIDESHOW ----
  const heroSlides = document.querySelectorAll('.hero-slide');
  const heroSlideDots = document.querySelectorAll('.hsd');
  let heroCurrentSlide = 0;
  let heroSlideTimer;

  function goToHeroSlide(n) {
    heroSlides.forEach(s => s.classList.remove('active'));
    heroSlideDots.forEach(d => d.classList.remove('active'));
    heroCurrentSlide = (n + heroSlides.length) % heroSlides.length;
    heroSlides[heroCurrentSlide]?.classList.add('active');
    heroSlideDots[heroCurrentSlide]?.classList.add('active');
  }

  function startHeroSlideshow() {
    heroSlideTimer = setInterval(() => {
      goToHeroSlide(heroCurrentSlide + 1);
    }, 5000);
  }

  heroSlideDots.forEach(dot => {
    dot.addEventListener('click', () => {
      clearInterval(heroSlideTimer);
      goToHeroSlide(parseInt(dot.dataset.slide));
      startHeroSlideshow();
    });
  });

  if (heroSlides.length > 0) startHeroSlideshow();

  // ---- PARALLAX HERO ----
  window.addEventListener('scroll', () => {
    // subtle parallax on the active slide
    if (window.scrollY < window.innerHeight) {
      const activeSlide = document.querySelector('.hero-slide.active');
      if (activeSlide) {
        activeSlide.style.transform = `scale(1.08) translateY(${window.scrollY * 0.15}px)`;
      }
    }
  }, { passive: true });

  // ---- GALLERY LIGHTBOX ----
  const galleryItems = document.querySelectorAll('.gallery-item');
  galleryItems.forEach(item => {
    item.addEventListener('click', () => {
      const img = item.querySelector('img');
      if (!img) return;

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed; inset:0; z-index:9999;
        background:rgba(0,0,0,0.95);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; animation:fadeIn 0.2s ease;
      `;
      const style = document.createElement('style');
      style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}';
      document.head.appendChild(style);

      const image = document.createElement('img');
      image.src = img.src;
      image.alt = img.alt;
      image.style.cssText = 'max-width:90vw; max-height:90vh; object-fit:contain; border-radius:8px;';

      const close = document.createElement('button');
      close.textContent = '×';
      close.style.cssText = `
        position:absolute; top:24px; right:32px;
        background:none; border:1px solid rgba(255,255,255,0.3); color:#fff;
        width:44px; height:44px; border-radius:50%; font-size:1.5rem;
        cursor:pointer; display:flex; align-items:center; justify-content:center;
      `;

      overlay.appendChild(image);
      overlay.appendChild(close);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      const closeLightbox = () => {
        overlay.remove();
        document.body.style.overflow = '';
      };
      overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); });
      close.addEventListener('click', closeLightbox);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); }, { once: true });
    });
  });

  // ---- SERVICES SLIDER ----
  const servicesTrack = document.getElementById('servicesTrack');
  const servicesPrev  = document.getElementById('servicesPrev');
  const servicesNext  = document.getElementById('servicesNext');
  const servicesDots  = document.getElementById('servicesDots');

  if (servicesTrack) {
    const svcCards = servicesTrack.querySelectorAll('.service-card');
    let svcCurrent = 0;
    let svcTimer;

    function svcVisible() {
      if (window.innerWidth <= 768) return 1;
      if (window.innerWidth <= 1200) return 2;
      return 3;
    }
    function svcMax() { return Math.max(0, svcCards.length - svcVisible()); }

    function buildSvcDots() {
      if (!servicesDots) return;
      servicesDots.innerHTML = '';
      const pages = svcMax() + 1;
      for (let i = 0; i < pages; i++) {
        const dot = document.createElement('button');
        dot.className = 'slider-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Layanan ${i + 1}`);
        dot.addEventListener('click', () => { clearInterval(svcTimer); goSvc(i); startSvcAuto(); });
        servicesDots.appendChild(dot);
      }
    }

    function goSvc(n) {
      svcCurrent = Math.max(0, Math.min(n, svcMax()));
      const gap = 24;
      // calculate card width from container
      const container = servicesTrack.closest('.services-slider');
      const containerWidth = container ? container.offsetWidth : 900;
      const vis = svcVisible();
      const cardWidth = (containerWidth - gap * (vis - 1)) / vis;
      servicesTrack.style.transform = `translateX(-${svcCurrent * (cardWidth + gap)}px)`;
      // set each card width
      svcCards.forEach(c => { c.style.width = cardWidth + 'px'; });
      // update dots
      servicesDots?.querySelectorAll('.slider-dot').forEach((d, i) =>
        d.classList.toggle('active', i === svcCurrent)
      );
    }

    function startSvcAuto() {
      clearInterval(svcTimer);
      svcTimer = setInterval(() => goSvc(svcCurrent < svcMax() ? svcCurrent + 1 : 0), 4000);
    }

    servicesPrev?.addEventListener('click', () => { clearInterval(svcTimer); goSvc(svcCurrent - 1); startSvcAuto(); });
    servicesNext?.addEventListener('click', () => { clearInterval(svcTimer); goSvc(svcCurrent + 1); startSvcAuto(); });

    // pause on hover
    servicesTrack.addEventListener('mouseenter', () => clearInterval(svcTimer));
    servicesTrack.addEventListener('mouseleave', () => startSvcAuto());

    buildSvcDots();
    goSvc(0);
    startSvcAuto();
    window.addEventListener('resize', () => { buildSvcDots(); goSvc(0); }, { passive: true });
  }

  // ---- BRANCH SELECTOR ----
  const branches = document.querySelectorAll('.branch');
  branches.forEach(branch => {
    branch.addEventListener('click', () => {
      branches.forEach(b => b.classList.remove('active-branch'));
      branch.classList.add('active-branch');
    });
  });

  console.log('%c🔴 RedBox Barbershop', 'color:#C1121F;font-size:24px;font-weight:bold;');
  console.log('%cDon\'t just cut, DOMINATE.', 'color:#E63946;font-size:14px;');
});
