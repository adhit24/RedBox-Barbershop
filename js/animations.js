import { animate, inView } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

// Respect prefers-reduced-motion
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── SCROLL PROGRESS BAR ─────────────────────────────────
const progressBar = document.querySelector('.rb-progress');
if (progressBar) {
  const updateBar = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  };
  window.addEventListener('scroll', updateBar, { passive: true });
}

if (!prefersReduced) {
  // ── HERO ENTRANCE STAGGER ─────────────────────────────
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) {
    const targets = [
      '.hero-eyebrow',
      '.hero-line1',
      '.hero-line2',
      '.hero-sub',
      '.hero-btn',
    ].map(s => heroContent.querySelector(s)).filter(Boolean);

    targets.forEach(el => Object.assign(el.style, { opacity: '0', transform: 'translateY(30px)' }));

    const runHeroAnim = () => {
      targets.forEach((el, i) => {
        animate(el,
          { opacity: [0, 1], y: [30, 0] },
          { delay: 0.08 + i * 0.13, duration: 0.75, ease: [0.22, 1, 0.36, 1] }
        );
      });
    };

    if (document.readyState === 'complete') {
      runHeroAnim();
    } else {
      window.addEventListener('load', runHeroAnim, { once: true });
    }
  }

  // ── HERO ORB PARALLAX ─────────────────────────────────
  const orb1 = document.querySelector('.rb-orb-1');
  const orb2 = document.querySelector('.rb-orb-2');
  const orb3 = document.querySelector('.rb-orb-3');
  if (orb1 || orb2 || orb3) {
    let ticking = false;
    window.addEventListener('mousemove', (e) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;
        if (orb1) animate(orb1, { x: dx * 22, y: dy * 16 }, { duration: 1.6, ease: 'ease-out' });
        if (orb2) animate(orb2, { x: dx * -16, y: dy * -10 }, { duration: 1.9, ease: 'ease-out' });
        if (orb3) animate(orb3, { x: dx * 10, y: dy * 8 },  { duration: 1.3, ease: 'ease-out' });
        ticking = false;
      });
    }, { passive: true });
  }

  // ── SECTION TITLE LINE REVEAL ────────────────────────
  document.querySelectorAll('.rb-title-line').forEach(line => {
    line.style.width = '0px';
    inView(line, () => {
      animate(line, { width: '42px' }, { duration: 0.65, delay: 0.25, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.5 });
  });

  // ── SECTION HEADER REVEAL ────────────────────────────
  document.querySelectorAll('.section-header').forEach(header => {
    Object.assign(header.style, { opacity: '0', transform: 'translateY(22px)' });
    inView(header, () => {
      animate(header, { opacity: [0, 1], y: [22, 0] }, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.2 });
  });

  // ── GALLERY ITEMS ─────────────────────────────────────
  document.querySelectorAll('.gallery-item').forEach((el, i) => {
    Object.assign(el.style, { opacity: '0', transform: 'translateY(20px) scale(0.97)' });
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [20, 0], scale: [0.97, 1] },
        { delay: i * 0.065, duration: 0.6, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.15 });
  });

  // ── REVIEW CARDS ─────────────────────────────────────
  document.querySelectorAll('.review-card').forEach((el, i) => {
    Object.assign(el.style, { opacity: '0', transform: 'translateY(26px)' });
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [26, 0] },
        { delay: i * 0.1, duration: 0.65, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.2 });
  });

  // ── LOCATION CARDS ───────────────────────────────────
  document.querySelectorAll('.loc-card').forEach((el, i) => {
    Object.assign(el.style, { opacity: '0', transform: 'translateY(22px)' });
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [22, 0] },
        { delay: i * 0.09, duration: 0.6, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.15 });
  });

  // ── DYNAMIC SERVICE CARDS (MutationObserver) ─────────
  function revealSvcCards(grid) {
    grid.querySelectorAll('.service-card:not([data-rb-anim])').forEach((card, i) => {
      card.dataset.rbAnim = '1';
      Object.assign(card.style, { opacity: '0', transform: 'translateY(18px)' });
      animate(card, { opacity: [0, 1], y: [18, 0] },
        { delay: i * 0.055, duration: 0.5, ease: [0.22, 1, 0.36, 1] });
    });
  }
  const svcGrid = document.getElementById('svcGrid');
  if (svcGrid) {
    new MutationObserver(() => revealSvcCards(svcGrid)).observe(svcGrid, { childList: true });
  }

  // ── DYNAMIC PRO CARDS (MutationObserver) ─────────────
  function revealProCards(grid) {
    grid.querySelectorAll('.pro-card:not([data-rb-anim])').forEach((card, i) => {
      card.dataset.rbAnim = '1';
      Object.assign(card.style, { opacity: '0', transform: 'translateY(18px)' });
      animate(card, { opacity: [0, 1], y: [18, 0] },
        { delay: i * 0.065, duration: 0.5, ease: [0.22, 1, 0.36, 1] });
    });
  }
  const proGrid = document.getElementById('proGridDesktop');
  if (proGrid) {
    new MutationObserver(() => revealProCards(proGrid)).observe(proGrid, { childList: true });
  }

  // ── BUTTON PRESS SCALE ────────────────────────────────
  document.querySelectorAll('.btn-primary, .btn-outline, .btn-book-nav').forEach(btn => {
    btn.addEventListener('pointerdown',  () => animate(btn, { scale: 0.95 }, { duration: 0.1 }));
    btn.addEventListener('pointerup',    () => animate(btn, { scale: 1 },    { duration: 0.25, ease: [0.22, 1, 0.36, 1] }));
    btn.addEventListener('pointerleave', () => animate(btn, { scale: 1 },    { duration: 0.2 }));
  });

  // ── WA FLOAT ENTRANCE ─────────────────────────────────
  const waFloat = document.querySelector('.wa-float');
  if (waFloat) {
    Object.assign(waFloat.style, { opacity: '0', transform: 'scale(0.5) translateY(12px)' });
    setTimeout(() => {
      animate(waFloat,
        { opacity: [0, 1], scale: [0.5, 1], y: [12, 0] },
        { duration: 0.55, delay: 1.4, ease: [0.34, 1.56, 0.64, 1] }
      );
    }, 50);
  }

  // ── BOOKING FORM FIELDS ───────────────────────────────
  document.querySelectorAll('.form-group, .step-card').forEach((el, i) => {
    Object.assign(el.style, { opacity: '0', transform: 'translateY(16px)' });
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [16, 0] },
        { delay: i * 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.1 });
  });

  // ── PRODUCT ITEMS ─────────────────────────────────────
  document.querySelectorAll('.product-item').forEach((el, i) => {
    Object.assign(el.style, { opacity: '0', transform: 'translateY(20px)' });
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [20, 0] },
        { delay: i * 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.1 });
  });

  // ── HOME SERVICE SECTION REVEAL ───────────────────────
  // NOTE: elements stay visible at all times — Motion animates FROM the
  // initial values, so content is never hidden if inView doesn't fire.
  const hsBanner = document.querySelector('.hs-banner');
  if (hsBanner) {
    const badgeWrap  = hsBanner.querySelector('.hs-badge-wrap');
    const title      = hsBanner.querySelector('.hs-title');
    const desc       = hsBanner.querySelector('.hs-desc');
    const actions    = hsBanner.querySelector('.hs-actions');
    const highlights = [...hsBanner.querySelectorAll('.hs-highlight-item')];

    inView(hsBanner, () => {
      [badgeWrap, title, desc].filter(Boolean).forEach((el, i) =>
        animate(el, { opacity: [0, 1], y: [20, 0] },
          { delay: i * 0.13, duration: 0.65, ease: [0.22, 1, 0.36, 1] })
      );
      highlights.forEach((el, i) =>
        animate(el, { opacity: [0, 1], y: [14, 0] },
          { delay: 0.28 + i * 0.09, duration: 0.55, ease: [0.22, 1, 0.36, 1] })
      );
      if (actions)
        animate(actions, { opacity: [0, 1], y: [20, 0] },
          { delay: 0.65, duration: 0.55, ease: [0.22, 1, 0.36, 1] });
    }, { amount: 0.12 });
  }
}

// ── GALLERY SCROLL EXPAND CIRCLE ─────────────────────
const galleryScroll = document.querySelector('.rb-gallery-scroll');
if (galleryScroll) {
  const photos = [...galleryScroll.querySelectorAll('.rgb-photo')];
  const ring1 = galleryScroll.querySelector('.rgb-ring-1');
  const ring2 = galleryScroll.querySelector('.rgb-ring-2');
  const centerText = galleryScroll.querySelector('.rgb-center-text');

  // 8 angles, starting top and going clockwise
  const ANGLES = [-90, -45, 0, 45, 90, 135, 180, -135].map(d => d * Math.PI / 180);

  const applyProgress = (progress) => {
    const maxRadius = Math.min(window.innerWidth * 0.29, window.innerHeight * 0.27, 195);
    const radius = progress * maxRadius;
    photos.forEach((photo, i) => {
      const a = ANGLES[i];
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      photo.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    });
    const r1o = Math.min(1, progress * 4);
    const r2o = Math.min(1, Math.max(0, progress - 0.12) * 4);
    const cto = Math.min(1, Math.max(0, progress - 0.38) * 4);
    if (ring1) ring1.style.opacity = r1o;
    if (ring2) ring2.style.opacity = r2o;
    if (centerText) centerText.style.opacity = cto;
  };

  if (prefersReduced) {
    applyProgress(1);
  } else {
    let rafPending = false;
    const onScroll = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        const sectionTop = galleryScroll.getBoundingClientRect().top + window.scrollY;
        const scrolled = Math.max(0, window.scrollY - sectionTop);
        const range = galleryScroll.offsetHeight - window.innerHeight;
        applyProgress(range > 0 ? Math.min(1, scrolled / range) : 0);
        rafPending = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }
}
