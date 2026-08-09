(function exposeTierTheme(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxTierTheme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTierTheme() {
  const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];

  const TOKENS = {
    bronze: {
      primary: '#CD7F32',
      primarySoft: 'rgba(205,127,50,.15)',
      glow: 'rgba(205,127,50,.5)',
      particleDensity: 0,
      tiltMaxDeg: 0,
      chime: null,
      confettiColors: ['#CD7F32', '#8C5A24'],
    },
    silver: {
      primary: '#C0C0C0',
      primarySoft: 'rgba(192,192,192,.15)',
      glow: 'rgba(192,192,192,.5)',
      particleDensity: 0,
      tiltMaxDeg: 4,
      chime: 'Brand_assets/audio/tier-chime-silver.mp3',
      confettiColors: ['#C0C0C0', '#9CA3AF'],
    },
    gold: {
      primary: '#FFD700',
      primarySoft: 'rgba(255,215,0,.15)',
      glow: 'rgba(255,215,0,.5)',
      particleDensity: 12,
      tiltMaxDeg: 7,
      chime: 'Brand_assets/audio/tier-chime-gold.mp3',
      confettiColors: ['#FFD700', '#B45309'],
    },
    platinum: {
      primary: '#C4B5FD',
      primarySoft: 'rgba(196,181,253,.15)',
      glow: 'rgba(196,181,253,.5)',
      particleDensity: 18,
      tiltMaxDeg: 10,
      chime: 'Brand_assets/audio/tier-chime-platinum.mp3',
      confettiColors: ['#C4B5FD', '#E2E8F0'],
    },
  };

  function getTierIndex(tierClass) {
    return TIER_ORDER.indexOf(String(tierClass || '').toLowerCase());
  }

  function getTierTokens(tierClass) {
    return TOKENS[String(tierClass || '').toLowerCase()] || TOKENS.bronze;
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isMobileViewport() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 768px)').matches;
  }

  function getParticleCount(tierClass, opts = {}) {
    if (opts.reducedMotion) return 0;
    const base = getTierTokens(tierClass).particleDensity;
    return opts.isMobile ? Math.round(base / 2) : base;
  }

  function applyTierTheme(tierClass, el) {
    const target = el || (typeof document !== 'undefined' ? document.body : null);
    if (!target) return;
    target.dataset.tier = String(tierClass || '').toLowerCase();
  }

  function isChimeMuted() {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('redbox_tier_chime_muted') === 'true';
  }

  function setChimeMuted(muted) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('redbox_tier_chime_muted', muted ? 'true' : 'false');
  }

  return {
    TIER_ORDER,
    TOKENS,
    getTierIndex,
    getTierTokens,
    prefersReducedMotion,
    isMobileViewport,
    getParticleCount,
    applyTierTheme,
    isChimeMuted,
    setChimeMuted,
  };
});
