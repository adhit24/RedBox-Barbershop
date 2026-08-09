import { animate, inView } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

document.addEventListener('DOMContentLoaded', () => {
  const theme = window.RedboxTierTheme;
  if (!theme || window.RedboxTierTheme.prefersReducedMotion()) return;

  // x percentages on a motion animate() are relative to the element's own
  // width, so a full left-to-right sweep across the card needs the layer to
  // start off-screen-left (left:-40%) and travel past off-screen-right
  // (0% -> 350%, i.e. 100% + 250% = 350% of the layer's own 40%-wide box).
  const SHIMMER_KEYFRAMES = { opacity: [0, 1, 0], x: ['0%', '350%'] };
  const SHIMMER_OPTS = { duration: 1.1, ease: [0.22, 1, 0.36, 1] };

  function addShimmerLayer(card) {
    const layer = document.createElement('div');
    layer.className = 'tier-shimmer-layer';
    Object.assign(layer.style, {
      position: 'absolute', top: '0', bottom: '0', left: '-40%', width: '40%',
      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)',
      pointerEvents: 'none', opacity: '0',
    });
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.style.overflow = card.style.overflow || 'hidden';
    card.appendChild(layer);
    return layer;
  }

  function injectParticles(host, tierClass) {
    const isMobile = theme.isMobileViewport();
    const count = theme.getParticleCount(tierClass, { isMobile, reducedMotion: false });
    if (count <= 0) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'tier-particle';
      p.style.left = `${Math.random() * 90 + 5}%`;
      p.style.bottom = `${Math.random() * 20}%`;
      p.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
      p.style.setProperty('--particle-drift-x', `${(Math.random() * 16 - 8).toFixed(1)}px`);
      host.appendChild(p);
    }
  }

  // ── membership.html: marketing tier cards ──
  document.querySelectorAll('.ms-tier[class*="tier-"]').forEach((card) => {
    const shimmer = addShimmerLayer(card);
    let played = false;
    inView(card, () => {
      if (played) return;
      played = true;
      animate(shimmer, SHIMMER_KEYFRAMES, SHIMMER_OPTS);
    }, { amount: 0.4 });
  });

  // ── member-dashboard.html: profile badge + physical card ──
  const tierCardEl = document.querySelector('.tier-card');
  if (tierCardEl) {
    const physCard = document.querySelector('.phys-card-inner');
    const wrap = document.querySelector('.phys-card-wrap');
    let shimmerPlayed = false;
    // Re-entrant pointer-tracking teardown: dashboard.js re-applies the
    // member's tier asynchronously (after the OTP/Supabase re-sync resolves,
    // which can land a *different* tier than what was cached in localStorage
    // at page load). Each re-init must detach the previous tier's listeners
    // before attaching new ones for the new tier's tiltMaxDeg — otherwise a
    // member who upgrades/downgrades mid-session keeps the stale tier's
    // pointer-tilt behavior (and stale particle count) until they reload.
    let tiltController = null;

    if (physCard) {
      const shimmer = addShimmerLayer(physCard);
      inView(physCard, () => {
        if (shimmerPlayed) return;
        shimmerPlayed = true;
        animate(shimmer, SHIMMER_KEYFRAMES, SHIMMER_OPTS);
      }, { amount: 0.4 });
    }

    function initTierMotion(tierClass) {
      if (!physCard) return;
      physCard.querySelectorAll('.tier-particle').forEach((p) => p.remove());
      injectParticles(physCard, tierClass);

      if (tiltController) {
        tiltController.abort();
        tiltController = null;
      }
      const tokens = theme.getTierTokens(tierClass);
      // Bronze (tiltMaxDeg 0) gets no pointer listeners; CSS-only hover remains.
      if (tokens.tiltMaxDeg <= 0 || !wrap) return;
      tiltController = new AbortController();
      const { signal } = tiltController;
      wrap.addEventListener('pointermove', (e) => {
        const rect = wrap.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        animate(physCard, {
          rotateZ: -4,
          rotateY: px * tokens.tiltMaxDeg,
          rotateX: -py * tokens.tiltMaxDeg,
        }, { duration: 0.4, ease: 'ease-out' });
        const sheenX = 50 + px * 60;
        const sheenY = 50 + py * 60;
        physCard.style.setProperty('--sheen-pos', `${sheenX}% ${sheenY}%`);
      }, { signal });
      wrap.addEventListener('pointerleave', () => {
        animate(physCard, { rotateZ: -4, rotateY: 0, rotateX: 0 }, { duration: 0.5, ease: 'ease-out' });
      }, { signal });
    }

    initTierMotion(document.body.dataset.tier || 'bronze');
    // Exposed so dashboard.js can re-run this after an async tier re-sync
    // changes document.body.dataset.tier mid-session (see applyTierTheme
    // call sites in js/dashboard.js). Optional-chained there since this
    // global is never defined when prefers-reduced-motion is on.
    window.RedboxTierMotion = { refresh: initTierMotion };
  }
});
