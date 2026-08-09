import { animate, inView } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

document.addEventListener('DOMContentLoaded', () => {
  const theme = window.RedboxTierTheme;
  if (!theme || window.RedboxTierTheme.prefersReducedMotion()) return;

  const SHIMMER_KEYFRAMES = { opacity: [0, 1, 0], x: ['-20%', '120%'] };
  const SHIMMER_OPTS = { duration: 1.1, ease: [0.22, 1, 0.36, 1] };

  function addShimmerLayer(card) {
    const layer = document.createElement('div');
    layer.className = 'tier-shimmer-layer';
    Object.assign(layer.style, {
      position: 'absolute', top: '0', bottom: '0', width: '40%',
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
    const tierClass = document.body.dataset.tier || 'bronze';
    const physCard = document.querySelector('.phys-card-inner');
    if (physCard) {
      const shimmer = addShimmerLayer(physCard);
      let played = false;
      inView(physCard, () => {
        if (played) return;
        played = true;
        animate(shimmer, SHIMMER_KEYFRAMES, SHIMMER_OPTS);
      }, { amount: 0.4 });
      injectParticles(physCard, tierClass);

      // Bronze (tiltMaxDeg 0) gets no pointer listeners; CSS-only hover remains.
      if (theme.getTierTokens(tierClass).tiltMaxDeg <= 0) return;
      const tokens = theme.getTierTokens(tierClass);
      const wrap = document.querySelector('.phys-card-wrap');
      if (wrap) {
        wrap.addEventListener('pointermove', (e) => {
          const rect = wrap.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width - 0.5;
          const py = (e.clientY - rect.top) / rect.height - 0.5;
          animate(physCard, {
            rotateY: px * tokens.tiltMaxDeg,
            rotateX: -py * tokens.tiltMaxDeg,
          }, { duration: 0.4, ease: 'ease-out' });
          const sheenX = 50 + px * 60;
          const sheenY = 50 + py * 60;
          physCard.style.setProperty('--sheen-pos', `${sheenX}% ${sheenY}%`);
        });
        wrap.addEventListener('pointerleave', () => {
          animate(physCard, { rotateY: 0, rotateX: 0 }, { duration: 0.5, ease: 'ease-out' });
        });
      }
    }
  }
});
