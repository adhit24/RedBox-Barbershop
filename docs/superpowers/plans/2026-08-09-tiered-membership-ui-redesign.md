# Tiered Membership UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each membership tier (Bronze/Silver/Gold/Platinum) a visibly escalating identity — color, motion, and sound — across `member-dashboard.html` and `membership.html`, driven by one shared token system, so paying members feel a tangible difference between tiers.

**Architecture:** A new `js/tier-theme.js` module centralizes tier metadata (colors, particle density, tilt intensity, chime paths) as plain JS objects, following the existing `window.RedboxMembership` UMD-lite convention (`js/membership-access.js`). A new `css/tier-tokens.css` centralizes the matching CSS custom properties, dual-scoped so both the dashboard's `data-tier` attribute convention and `membership.html`'s existing `.tier-silver/.tier-gold/.tier-platinum` class convention resolve to the same values. Ambient effects (breathing glow, particle drift, gradient shift) are pure CSS `@keyframes` gated by `prefers-reduced-motion` — the codebase already does this for `.phys-card-glow` (`cardPulse` in `css/dashboard.css`). One-time viewport-entrance shimmer and celebratory tier-up reveal use the `motion` library (Motion One / Framer Motion's framework-agnostic core), which the codebase already loads via ESM CDN import in `js/animations.js` — a new `js/tier-motion.js` follows that exact pattern. Pointer tilt-tracking is plain vanilla JS, mirroring the existing orb-parallax `mousemove` handler in `js/animations.js`.

**Tech Stack:** Vanilla HTML/CSS/JS (no bundler, no framework). `motion@11` via `https://cdn.jsdelivr.net/npm/motion@11/+esm` (module script). `canvas-confetti` (already loaded on both target pages). Tests use Node's built-in test runner (`node --test`) with `node:assert/strict`, matching the existing convention in `server/test/*.test.js` — no new test dependency is introduced.

## Global Constraints

- Do not restructure `membership.html`'s `.ms-tier` markup or `.ms-table` — only its CSS token source and one added viewport-entrance effect (per spec).
- Every tier color/motion value must trace back to `js/tier-theme.js` (JS) or `css/tier-tokens.css` (CSS) — no new hardcoded tier hex literals anywhere else.
- All new animation must use only `transform` and `opacity` (never `width`/`height`/`top`/`left`) and must be fully disabled under `prefers-reduced-motion: reduce`.
- Audio chime files (`Brand_assets/audio/tier-chime-*.mp3`) are external binary assets **outside the scope of this plan** — code must treat a missing/404 file as a silent no-op (`try/catch` around `.play()`, an `error` listener that no-ops), never throw or block the UI.
- Follow the existing UMD-lite export pattern (`js/membership-access.js`) for any new shared JS module so it is both `require()`-able from `node:test` and usable as a plain global script (`window.RedboxX`).
- Tests are content/contract tests in the style of `server/test/member-dashboard-benefits.test.js` (regex/string assertions on file contents) plus real unit tests for pure functions (style of `server/test/client-membership-access.test.js`) — there is no jsdom/Playwright in this repo, so DOM-rendering behavior is verified manually in a browser per task, not automated.
- Run tests with `node --test server/test/<file>.test.js` (or `server/test/*.test.js` for the full suite) from the repo root.

---

### Task 1: `js/tier-theme.js` — tier token registry & pure helpers

**Files:**
- Create: `js/tier-theme.js`
- Test: `server/test/tier-theme.test.js`

**Interfaces:**
- Produces: `window.RedboxTierTheme` (and CommonJS export) with:
  - `TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']`
  - `TOKENS` — object keyed by tier class, each entry: `{ primary, primarySoft, glow, particleDensity, tiltMaxDeg, chime, confettiColors }`
  - `getTierIndex(tierClass: string): number` (returns `-1` if unknown)
  - `getTierTokens(tierClass: string): object` (falls back to `bronze` tokens if unknown)
  - `prefersReducedMotion(): boolean`
  - `isMobileViewport(): boolean`
  - `getParticleCount(tierClass: string, opts?: { isMobile?: boolean, reducedMotion?: boolean }): number`
  - `applyTierTheme(tierClass: string, el?: Element): void` — sets `el.dataset.tier = tierClass` (defaults `el` to `document.body`)
  - `isChimeMuted(): boolean` / `setChimeMuted(muted: boolean): void` — wrap `localStorage['redbox_tier_chime_muted']`

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-theme.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { TIER_ORDER, TOKENS, getTierIndex, getTierTokens, getParticleCount } =
  require('../../js/tier-theme');

test('TIER_ORDER lists all four tiers low to high', () => {
  assert.deepEqual(TIER_ORDER, ['bronze', 'silver', 'gold', 'platinum']);
});

test('every tier has a complete token set', () => {
  for (const tier of TIER_ORDER) {
    const t = TOKENS[tier];
    assert.ok(t, `missing tokens for ${tier}`);
    assert.match(t.primary, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(typeof t.particleDensity, 'number');
    assert.equal(typeof t.tiltMaxDeg, 'number');
    assert.ok(Array.isArray(t.confettiColors) && t.confettiColors.length > 0);
  }
});

test('getTierIndex ranks tiers in ascending order, -1 for unknown', () => {
  assert.equal(getTierIndex('bronze'), 0);
  assert.equal(getTierIndex('silver'), 1);
  assert.equal(getTierIndex('gold'), 2);
  assert.equal(getTierIndex('platinum'), 3);
  assert.equal(getTierIndex('nonsense'), -1);
});

test('getTierTokens falls back to bronze for an unknown tier', () => {
  assert.equal(getTierTokens('nonsense'), TOKENS.bronze);
  assert.equal(getTierTokens('gold'), TOKENS.gold);
});

test('bronze and silver never emit particles; gold and platinum do, and mobile halves the count', () => {
  assert.equal(getParticleCount('bronze', {}), 0);
  assert.equal(getParticleCount('silver', {}), 0);
  const goldDesktop = getParticleCount('gold', { isMobile: false });
  const goldMobile = getParticleCount('gold', { isMobile: true });
  assert.ok(goldDesktop > 0);
  assert.equal(goldMobile, Math.round(goldDesktop / 2));
  const platDesktop = getParticleCount('platinum', { isMobile: false });
  assert.ok(platDesktop > goldDesktop, 'platinum must be denser than gold');
});

test('getParticleCount returns 0 for any tier when reducedMotion is true', () => {
  assert.equal(getParticleCount('platinum', { reducedMotion: true }), 0);
  assert.equal(getParticleCount('gold', { isMobile: true, reducedMotion: true }), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-theme.test.js`
Expected: FAIL — `Cannot find module '../../js/tier-theme'`

- [ ] **Step 3: Write the implementation**

Create `js/tier-theme.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/tier-theme.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add js/tier-theme.js server/test/tier-theme.test.js
git commit -m "feat: add tier token registry (js/tier-theme.js)"
```

---

### Task 2: `css/tier-tokens.css` — shared CSS tokens, wired into both pages

**Files:**
- Create: `css/tier-tokens.css`
- Modify: `member-dashboard.html:13-14`
- Modify: `membership.html:13, 319-354`
- Test: `server/test/tier-tokens-css.test.js`

**Interfaces:**
- Consumes: hex values from `js/tier-theme.js` `TOKENS` (Task 1) — must stay numerically identical for `bronze`/`silver`/`platinum` `primary` (Gold intentionally keeps two different canonical values, see below).
- Produces: CSS custom properties `--tier-primary`, `--tier-primary-soft`, `--tier-glow`, `--tier-gradient` scoped under `[data-tier="bronze|silver|gold|platinum"]` (read by `member-dashboard.html`) and `.tier-silver/.tier-gold/.tier-platinum` (read by `membership.html`'s existing card markup — unchanged selectors, just relocated declarations).

**Note on Gold:** `membership.html`'s `.tier-gold` block uses `#FBBF24` extensively, including the shared "featured" ribbon/CTA gradient (`.ms-tier.featured .featured-badge`, `.ms-tier.featured .tier-cta`) which is not itself tier-scoped. Retargeting Gold to the dashboard's `#FFD700` would require touching that shared ribbon styling too, which is out of the committed spec (only Platinum's mismatch was called out). This task relocates `.tier-gold` as-is (`#FBBF24`) and keeps the dashboard's `[data-tier="gold"]` as `#FFD700` — two intentionally distinct scopes, both preserved from their pre-existing values.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-tokens-css.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-tokens.css defines dashboard (data-tier) scope for all four tiers', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /\[data-tier="bronze"\]\s*{[^}]*--tier-primary:\s*#CD7F32/);
  assert.match(css, /\[data-tier="silver"\]\s*{[^}]*--tier-primary:\s*#C0C0C0/);
  assert.match(css, /\[data-tier="gold"\]\s*{[^}]*--tier-primary:\s*#FFD700/);
  assert.match(css, /\[data-tier="platinum"\]\s*{[^}]*--tier-primary:\s*#C4B5FD/);
});

test('tier-tokens.css relocates the membership.html marketing card colors unchanged', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /\.tier-silver \.tier-name\s*{\s*color:\s*#9CA3AF/);
  assert.match(css, /\.tier-gold \.tier-name\s*{\s*color:\s*#FBBF24/);
  assert.match(css, /linear-gradient\(90deg,\s*#C4B5FD,\s*#E2E8F0,\s*#C4B5FD\)/);
});

test('membership.html no longer defines its own TIER COLORS block', () => {
  const html = source('membership.html');
  assert.doesNotMatch(html, /\/\* TIER COLORS \*\//);
});

test('both pages load tier-tokens.css before their own stylesheet', () => {
  const dashboardHtml = source('member-dashboard.html');
  const membershipHtml = source('membership.html');
  assert.ok(dashboardHtml.indexOf('css/tier-tokens.css') > -1);
  assert.ok(dashboardHtml.indexOf('css/tier-tokens.css') < dashboardHtml.indexOf('css/dashboard.css'));
  assert.ok(membershipHtml.indexOf('css/tier-tokens.css') > -1);
  assert.ok(membershipHtml.indexOf('css/tier-tokens.css') < membershipHtml.indexOf('<style>'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-tokens-css.test.js`
Expected: FAIL — `css/tier-tokens.css` does not exist (ENOENT)

- [ ] **Step 3: Create `css/tier-tokens.css`**

```css
/* ================================================
   TIER TOKENS - shared across membership.html and
   member-dashboard.html. Values must match
   js/tier-theme.js TOKENS for JS-driven effects
   (confetti, chime) to stay visually consistent.
   ================================================ */

/* ---- Dashboard scope: <body data-tier="..."> ---- */
[data-tier="bronze"] {
  --tier-primary: #CD7F32;
  --tier-primary-soft: rgba(205,127,50,.15);
  --tier-glow: rgba(205,127,50,.5);
  --tier-gradient: linear-gradient(135deg, #CD7F32, #8C5A24);
}
[data-tier="silver"] {
  --tier-primary: #C0C0C0;
  --tier-primary-soft: rgba(192,192,192,.15);
  --tier-glow: rgba(192,192,192,.5);
  --tier-gradient: linear-gradient(135deg, #C0C0C0, #9CA3AF);
}
[data-tier="gold"] {
  --tier-primary: #FFD700;
  --tier-primary-soft: rgba(255,215,0,.15);
  --tier-glow: rgba(255,215,0,.5);
  --tier-gradient: linear-gradient(135deg, #FFD700, #B45309);
}
[data-tier="platinum"] {
  --tier-primary: #C4B5FD;
  --tier-primary-soft: rgba(196,181,253,.15);
  --tier-glow: rgba(196,181,253,.5);
  --tier-gradient: linear-gradient(90deg, #C4B5FD, #E2E8F0, #C4B5FD);
}

/* ---- Marketing scope: membership.html .ms-tier.tier-x cards ----
   Relocated from membership.html's inline <style> unchanged, so the
   existing .ms-tier markup keeps working without restructuring. */
.tier-silver .tier-header { background: linear-gradient(160deg, #1A1F29 0%, #111520 100%); }
.tier-silver .tier-icon { background: rgba(156,163,175,.12); }
.tier-silver .tier-name { color: #9CA3AF; }
.tier-silver .tier-discount { color: #9CA3AF; }

.tier-gold .tier-header { background: linear-gradient(160deg, #1C1000 0%, #140B00 100%); }
.tier-gold .tier-icon { background: rgba(251,191,36,.15); }
.tier-gold .tier-name { color: #FBBF24; }
.tier-gold .tier-discount { color: #FBBF24; }

.tier-platinum .tier-header {
  background: linear-gradient(160deg, #0F1520 0%, #080D17 100%);
  position: relative;
  overflow: hidden;
}
.tier-platinum .tier-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 40%, rgba(196,181,253,.06) 100%);
  pointer-events: none;
}
.tier-platinum .tier-icon { background: rgba(196,181,253,.1); }
.tier-platinum .tier-name {
  background: linear-gradient(90deg, #C4B5FD, #E2E8F0, #C4B5FD);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.tier-platinum .tier-discount {
  background: linear-gradient(90deg, #C4B5FD, #E2E8F0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

- [ ] **Step 4: Remove the relocated block from `membership.html`**

In `membership.html`, delete lines 319-354 (the `/* TIER COLORS */` block, from `.tier-silver .tier-header { background: ...` through the closing `}` of `.tier-platinum .tier-discount`) — the content now lives in `css/tier-tokens.css`.

- [ ] **Step 5: Wire the stylesheet into both pages**

In `member-dashboard.html`, after line 13 (`<link rel="stylesheet" href="css/style.css" />`):

```html
<link rel="stylesheet" href="css/style.css" />
<link rel="stylesheet" href="css/tier-tokens.css" />
<link rel="stylesheet" href="css/dashboard.css?v=20260807" />
```

In `membership.html`, after line 13 (`<link rel="stylesheet" href="css/style.css" />`):

```html
<link rel="stylesheet" href="css/style.css" />
<link rel="stylesheet" href="css/tier-tokens.css" />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/tier-tokens-css.test.js`
Expected: PASS (4 tests)

- [ ] **Step 7: Manual verification**

Open `membership.html` in a browser. The three tier cards must render identically to before this change (same colors, same "PALING POPULER" ribbon on Gold) — this task only relocates CSS, it does not change any rendered value on this page yet.

- [ ] **Step 8: Commit**

```bash
git add css/tier-tokens.css member-dashboard.html membership.html server/test/tier-tokens-css.test.js
git commit -m "feat: centralize tier CSS tokens in css/tier-tokens.css"
```

---

### Task 3: Unify Platinum color and wire `data-tier` into the dashboard

**Files:**
- Modify: `js/dashboard.js:66, 261-262, 265-269, 397-424`
- Modify: `css/dashboard.css:72, 391-392, 705`
- Modify: `member-dashboard.html:621-623`
- Test: `server/test/tier-theme-wiring.test.js`

**Interfaces:**
- Consumes: `window.RedboxTierTheme.applyTierTheme` (Task 1), `--tier-primary`/`--tier-glow` custom properties (Task 2).
- Produces: `document.body.dataset.tier` is kept in sync with the member's current tier at every point `dashboard.js` already re-renders tier-dependent UI.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-theme-wiring.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('member-dashboard.html loads tier-theme.js before dashboard.js', () => {
  const html = source('member-dashboard.html');
  assert.ok(html.indexOf('js/tier-theme.js') > -1);
  assert.ok(html.indexOf('js/tier-theme.js') < html.indexOf('js/dashboard.js'));
});

test('dashboard.js no longer hardcodes the old icy-blue platinum color', () => {
  const js = source('js/dashboard.js');
  assert.doesNotMatch(js, /#B9F2FF/);
  assert.doesNotMatch(js, /185,\s*242,\s*255/);
});

test('css/dashboard.css no longer hardcodes the old icy-blue platinum color', () => {
  const css = source('css/dashboard.css');
  assert.doesNotMatch(css, /#B9F2FF/);
  assert.doesNotMatch(css, /185,\s*242,\s*255/);
});

test('dashboard.js applies the tier theme attribute at every tier render point', () => {
  const js = source('js/dashboard.js');
  const matches = js.match(/RedboxTierTheme\.applyTierTheme\(/g) || [];
  assert.ok(matches.length >= 3, `expected at least 3 call sites, found ${matches.length}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-theme-wiring.test.js`
Expected: FAIL — script order assertion fails (`tier-theme.js` not loaded) and the two "no longer hardcodes" tests fail because `#B9F2FF` is still present.

- [ ] **Step 3: Load `tier-theme.js` in `member-dashboard.html`**

At `member-dashboard.html:621-623`, insert the new script before `dashboard.js`:

```html
<script src="js/main.js"></script>
<script src="js/membership-access.js?v=20260808"></script>
<script src="js/tier-theme.js?v=20260809"></script>
<script src="js/dashboard.js?v=20260807"></script>
```

- [ ] **Step 4: Replace the Platinum hex literal in `js/dashboard.js`**

At line 66 (`TIERS` array), replace:

```js
{ name:'Platinum', min:3000, max:Infinity, class:'platinum', color:'#B9F2FF', glow:'rgba(185,242,255,.5)', label:'Level 4' }
```

with:

```js
{ name:'Platinum', min:3000, max:Infinity, class:'platinum', color:'#C4B5FD', glow:'rgba(196,181,253,.5)', label:'Level 4' }
```

At lines 261-262 (`renderUpsellBanner`'s `progressColors`), replace:

```js
const progressColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#B9F2FF' };
```

with:

```js
const progressColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#C4B5FD' };
```

At line 268 (platinum SVG icon `stroke`), replace `stroke="#B9F2FF"` with `stroke="#C4B5FD"`.

At line 402 (`renderBenefitTracker`'s `tierColors`), replace:

```js
const tierColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#B9F2FF' };
```

with:

```js
const tierColors = { bronze:'#CD7F32', silver:'#C0C0C0', gold:'#FFD700', platinum:'#C4B5FD' };
```

- [ ] **Step 5: Replace the Platinum hex literal in `css/dashboard.css`**

At line 72:

```css
.profile-tier-badge.platinum{background:rgba(185,242,255,.15);color:#B9F2FF;border-color:rgba(185,242,255,.3)}
```

replace with:

```css
.profile-tier-badge.platinum{background:rgba(196,181,253,.15);color:#C4B5FD;border-color:rgba(196,181,253,.3)}
```

At lines 391-392:

```css
.tier-platinum{border-color:rgba(185,242,255,.2)}
.tier-platinum:hover{border-color:rgba(185,242,255,.5);box-shadow:0 8px 24px rgba(185,242,255,.1)}
```

replace with:

```css
.tier-platinum{border-color:rgba(196,181,253,.2)}
.tier-platinum:hover{border-color:rgba(196,181,253,.5);box-shadow:0 8px 24px rgba(196,181,253,.1)}
```

At line 705:

```css
.reward-card.tier-platinum.unlocked{border-color:rgba(185,242,255,.2)}
```

replace with:

```css
.reward-card.tier-platinum.unlocked{border-color:rgba(196,181,253,.2)}
```

- [ ] **Step 6: Call `applyTierTheme` at every tier render point in `js/dashboard.js`**

Immediately after line 244 (`const tier = getDisplayTier(displayPoints);`), add:

```js
const tier = getDisplayTier(displayPoints);
window.RedboxTierTheme.applyTierTheme(ACTIVE ? tier.class : 'bronze');
```

Immediately after line 942 (`const t2 = getDisplayTier(pts);` inside the OTP re-sync block), add:

```js
const t2 = getDisplayTier(pts);
window.RedboxTierTheme.applyTierTheme(isACTIVE ? t2.class : 'bronze');
```

Immediately after line 1011 (`const t2 = getDisplayTier(pts);` inside the Supabase re-sync block), add:

```js
const t2 = getDisplayTier(pts);
window.RedboxTierTheme.applyTierTheme(isACTIVE ? t2.class : 'bronze');
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test server/test/tier-theme-wiring.test.js`
Expected: PASS (4 tests)

- [ ] **Step 8: Manual verification**

Open `member-dashboard.html` in a browser with dev tools open, inspect `<body>`, confirm it carries `data-tier="bronze"` (or whatever `localStorage.redbox_member.current_tier` holds). Confirm the Platinum badge/border colors now render as lavender, not icy blue, in every place they previously appeared (profile badge, reward card borders, upsell banner icon).

- [ ] **Step 9: Commit**

```bash
git add js/dashboard.js css/dashboard.css member-dashboard.html server/test/tier-theme-wiring.test.js
git commit -m "fix: unify Platinum color and wire data-tier attribute into dashboard"
```

---

### Task 4: Replace the points-based "tier progress" with a purchase-based "tier map"

**Files:**
- Modify: `member-dashboard.html:134-188`
- Modify: `js/dashboard.js:244-247` (call site), append new `renderTierMap` function near `renderBenefitTracker` (after line 447)
- Modify: `css/dashboard.css:116-158`
- Test: `server/test/tier-map.test.js`

**Interfaces:**
- Consumes: `TIERS` array, `tierLevelOf`, `ACTIVE`, `tier` (all already defined earlier in `js/dashboard.js`'s `DOMContentLoaded` closure).
- Produces: `renderTierMap(tier)` function, called once after `renderBenefitTracker()`; renders into `#tierMapContainer`.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-map.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('the dashboard no longer claims points drive tier level-up', () => {
  const html = source('member-dashboard.html');
  const js = source('js/dashboard.js');
  assert.doesNotMatch(html, /Kumpulkan poin setiap kunjungan untuk naik level/);
  assert.doesNotMatch(js, /tierFill1|tierFill2/);
});

test('member-dashboard.html has a tier map container and no static progress nodes', () => {
  const html = source('member-dashboard.html');
  assert.match(html, /id="tierMapContainer"/);
  assert.doesNotMatch(html, /tier-connector-fill/);
});

test('dashboard.js renders the tier map with an upgrade CTA to member-register.html', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /function renderTierMap/);
  assert.match(js, /renderTierMap\(tier\)/);
  assert.match(js, /member-register\.html\?tier=/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-map.test.js`
Expected: FAIL — no `tierMapContainer`, no `renderTierMap`, old copy still present.

- [ ] **Step 3: Replace the static markup in `member-dashboard.html`**

This section currently has three consecutive blocks: `.tier-progress-track` (lines 145-175), `.tier-lock-overlay` (lines 176-182, keep untouched), and `.tier-message` (lines 183-185, delete). Make two separate edits:

**3a.** Replace the entire `<div class="tier-progress-track">...</div>` block (lines 145-175) with a single line:

```html
 <div class="tier-map" id="tierMapContainer"></div>
```

**3b.** Delete the trailing `<div class="tier-message" id="tierMessage">...</div>` block (lines 183-185) entirely — do not replace it with anything. Its copy moves into `renderTierMap`'s rendered output in Step 5.

Do **not** touch the `.tier-lock-overlay` block in between — it stays exactly where it is, now sandwiched between the new `#tierMapContainer` div and whatever follows after the deleted `.tier-message` block. The final structure should read:

```html
 <div class="tier-map" id="tierMapContainer"></div>
 <!-- Lock Overlay (shown when INACTIVE) -->
 <div class="tier-lock-overlay" id="tierLockOverlay" style="display:none">
 <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd"/></svg>
 <h3>Tier Terkunci</h3>
 <p>Aktivasi membership untuk membuka sistem tier dan mulai kumpulkan poin eksklusif.</p>
 <button class="btn-tier-unlock" id="btnActivate">Aktivasi Membership Sekarang</button>
 </div>
```

`js/dashboard.js` still writes into `#tierMessage` at two spots (the "POINT REWARD PURPOSE" section) — Step 5b below deletes that JS code, since `renderTierMap` now owns that copy.

- [ ] **Step 4: Replace the progress-track CSS in `css/dashboard.css`**

Replace lines 116-164 (`/* Progress Track */` through `.tier-message p{...}`) with:

```css
/* Tier Map */
.tier-map{display:flex;flex-direction:column;gap:10px;margin-bottom:24px}
.tier-map-row{
 display:flex;align-items:center;gap:14px;
 background:var(--bg-3);border:1px solid var(--w10);border-radius:14px;
 padding:14px 18px;transition:border-color .3s ease;
}
.tier-map-row.current{border-color:var(--tier-primary,var(--red));box-shadow:0 0 0 1px var(--tier-primary,transparent) inset}
.tier-map-dot{
 width:36px;height:36px;border-radius:50%;flex-shrink:0;
 background:var(--bg-4);border:2.5px solid var(--w20);
 display:flex;align-items:center;justify-content:center;color:transparent;
}
.tier-map-row.current .tier-map-dot,
.tier-map-row.unlocked .tier-map-dot{
 background:var(--tier-primary,var(--red));border-color:var(--tier-primary,var(--red));color:#000;
}
.tier-map-info{flex:1;min-width:0}
.tier-map-name{
 font-family:var(--font-accent);font-size:.9rem;letter-spacing:.05em;
 color:var(--white);display:block;
}
.tier-map-benefit{font-size:.76rem;color:var(--w50);display:block;margin-top:2px}
.tier-map-status{
 font-size:.66rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
 padding:4px 10px;border-radius:100px;flex-shrink:0;
}
.tier-map-status.current{background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.25)}
.tier-map-status.unlocked{background:var(--w05);color:var(--w70)}
.tier-map-upgrade{
 font-size:.72rem;font-weight:700;letter-spacing:.04em;color:var(--red);
 padding:8px 14px;border-radius:10px;border:1.5px solid var(--red);
 transition:all .25s ease;flex-shrink:0;
}
.tier-map-upgrade:hover{background:var(--red);color:#fff}
```

- [ ] **Step 5: Write `renderTierMap` in `js/dashboard.js`**

**5a.** Add the function right after `renderBenefitTracker`'s closing brace (after line 447, before the `renderBenefitTracker();` call on line 449):

```js
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
```

**5b.** Remove the now-duplicated `tierMessage` logic: delete the `const tierMessage = document.getElementById('tierMessage');` line and the `if (ACTIVE) { ... } else { ... }` block that follows it (originally lines 336-342 — the "POINT REWARD PURPOSE" section), since `renderTierMap` now owns that copy.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/tier-map.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Manual verification**

Open `member-dashboard.html` in a browser (with a fake `redbox_member` in `localStorage` if needed to simulate an active Gold member — set `current_tier: 'gold'`, `membership_status: 'ACTIVE'`, valid `membership_expires_at` in the future). Confirm: Bronze/Silver row show "Unlocked", Gold row shows "Tier saat ini", Platinum row shows an "Upgrade" link pointing to `member-register.html?tier=platinum`. Confirm an inactive member sees no "current"/"unlocked" rows and the headline prompts activation.

- [ ] **Step 8: Commit**

```bash
git add member-dashboard.html js/dashboard.js css/dashboard.css server/test/tier-map.test.js
git commit -m "feat: replace points-based tier progress with purchase-based tier map"
```

---

### Task 5: Ambient per-tier CSS motion (breathing glow, particle drift, gradient shift)

**Files:**
- Modify: `css/tier-tokens.css` (append keyframes + per-tier animation rules)
- Test: `server/test/tier-ambient-motion.test.js`

**Interfaces:**
- Consumes: `--tier-primary`/`--tier-glow` (Task 2), the `[data-tier="x"]` scoping already established.
- Produces: `.tier-badge-emblem` breathing glow (all tiers, intensity varies), `.tier-particle` drift keyframe (used by Task 6's JS-injected particle elements), `[data-tier="platinum"] .phys-card-inner` background gradient shift.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-ambient-motion.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('ambient tier animations are defined and gated by reduced-motion', () => {
  const css = source('css/tier-tokens.css');
  assert.match(css, /@keyframes tierBreathe/);
  assert.match(css, /@keyframes tierParticleDrift/);
  assert.match(css, /@keyframes tierGradientShift/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('reduced-motion block disables all three tier keyframe animations', () => {
  const css = source('css/tier-tokens.css');
  const reducedBlockMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)}\s*}/);
  assert.ok(reducedBlockMatch, 'expected a reduced-motion block');
  const block = reducedBlockMatch[1];
  assert.match(block, /animation:\s*none/);
});

test('only gold and platinum get the particle-drift animation', () => {
  const css = source('css/tier-tokens.css');
  assert.doesNotMatch(css, /\[data-tier="bronze"\][^{]*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="gold"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
  assert.match(css, /\[data-tier="platinum"\]\s*\.tier-particle\s*{[^}]*animation:\s*tierParticleDrift/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-ambient-motion.test.js`
Expected: FAIL — none of the keyframes exist yet.

- [ ] **Step 3: Append the ambient motion rules to `css/tier-tokens.css`**

```css
/* ================================================
   AMBIENT TIER MOTION
   All keyframes animate only transform/opacity/background-position.
   ================================================ */
@keyframes tierBreathe {
  from { opacity: .4; }
  to   { opacity: .7; }
}
@keyframes tierParticleDrift {
  0%   { transform: translateY(0) translateX(0); opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateY(-60px) translateX(var(--particle-drift-x, 6px)); opacity: 0; }
}
@keyframes tierGradientShift {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.tier-badge-emblem {
  animation: tierBreathe 3s ease-in-out infinite alternate;
}
[data-tier="bronze"] .tier-badge-emblem { animation-duration: 3s; }
[data-tier="silver"] .tier-badge-emblem { animation-duration: 2.4s; }
[data-tier="gold"] .tier-badge-emblem { animation-duration: 2s; }
[data-tier="platinum"] .tier-badge-emblem { animation-duration: 1.6s; }

.tier-particle {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
[data-tier="gold"] .tier-particle {
  background: var(--tier-primary);
  animation: tierParticleDrift 4s ease-in infinite;
}
[data-tier="platinum"] .tier-particle {
  background: var(--tier-primary);
  animation: tierParticleDrift 3.4s ease-in infinite;
}

[data-tier="platinum"] .phys-card-inner {
  background: var(--tier-gradient);
  background-size: 200% 200%;
  animation: tierGradientShift 8s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .tier-badge-emblem,
  .tier-particle,
  [data-tier="platinum"] .phys-card-inner {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/tier-ambient-motion.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Manual verification**

Note: `.tier-badge-emblem` and `.tier-particle` elements don't exist in the markup yet (Task 6 adds them) — this task only proves the CSS rules are correct in isolation. Verify with dev tools by temporarily adding `<span class="tier-badge-emblem" style="display:inline-block;width:20px;height:20px;background:red">` to any tier-scoped page and toggling OS-level "reduce motion" to confirm the animation stops.

- [ ] **Step 6: Commit**

```bash
git add css/tier-tokens.css server/test/tier-ambient-motion.test.js
git commit -m "feat: add reduced-motion-aware ambient tier animations"
```

---

### Task 6: `js/tier-motion.js` — viewport-entrance shimmer + particle injection

**Files:**
- Create: `js/tier-motion.js`
- Modify: `member-dashboard.html:622` (add script tag after `dashboard.js`)
- Modify: `membership.html` (add script tag near end of `<body>`)
- Test: `server/test/tier-motion-shimmer.test.js`

**Interfaces:**
- Consumes: `motion` (`animate`, `inView`) via the same CDN ESM import `js/animations.js` already uses; `window.RedboxTierTheme.getParticleCount`/`prefersReducedMotion`/`isMobileViewport` (Task 1).
- Produces: shimmer sweep (`animate()`, once per card, triggered by `inView()`) on `.ms-tier` cards (`membership.html`) and on `.phys-card-inner`/`.tier-badge-emblem` (dashboard); particle `<span class="tier-particle">` elements injected into Gold/Platinum contexts, count from `getParticleCount`.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-motion-shimmer.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-motion.js imports motion the same way js/animations.js does', () => {
  const animations = source('js/animations.js');
  const tierMotion = source('js/tier-motion.js');
  const importLine = animations.match(/^import .+ from ["'][^"']+["'];?$/m)[0];
  assert.ok(tierMotion.includes(importLine.replace(/^import \{[^}]+\}/, 'import {')),
    'tier-motion.js should import from the same motion CDN URL as animations.js');
  assert.match(tierMotion, /from ["']https:\/\/cdn\.jsdelivr\.net\/npm\/motion@11\/\+esm["']/);
});

test('tier-motion.js waits for DOMContentLoaded before touching the DOM', () => {
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /addEventListener\(['"]DOMContentLoaded['"]/);
});

test('tier-motion.js checks prefers-reduced-motion before animating', () => {
  const tierMotion = source('js/tier-motion.js');
  assert.match(tierMotion, /RedboxTierTheme\.prefersReducedMotion\(\)/);
});

test('both pages load tier-motion.js as a module script after dashboard-specific scripts', () => {
  const dashboardHtml = source('member-dashboard.html');
  const membershipHtml = source('membership.html');
  assert.match(dashboardHtml, /<script[^>]+type="module"[^>]+src="js\/tier-motion\.js/);
  assert.ok(dashboardHtml.indexOf('js/dashboard.js') < dashboardHtml.indexOf('js/tier-motion.js'));
  assert.match(membershipHtml, /<script[^>]+type="module"[^>]+src="js\/tier-motion\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-motion-shimmer.test.js`
Expected: FAIL — `js/tier-motion.js` does not exist; script tags absent.

- [ ] **Step 3: Create `js/tier-motion.js`**

```js
import { animate, inView } from "https://cdn.jsdelivr.net/npm/motion@11/+esm";

document.addEventListener('DOMContentLoaded', () => {
  const theme = window.RedboxTierTheme;
  if (!theme || theme.prefersReducedMotion()) return;

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
    }
  }
});
```

- [ ] **Step 4: Attach `.tier-badge-emblem` to the profile badge so Task 5's breathing-glow CSS has something to animate**

`css/tier-tokens.css` (Task 5) defines `.tier-badge-emblem` styling, but nothing in the markup carries that class yet. In `js/dashboard.js`, the profile tier badge's `className` is assigned in three places (all already touched by Task 3 Step 6, right next to each `applyTierTheme` call). Update each to include the new class:

At line 304 (initial render):

```js
if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (ACTIVE ? tier.class : 'inactive');
```

At the OTP re-sync block's equivalent line:

```js
if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (isACTIVE ? t2.class : 'inactive');
```

At the Supabase re-sync block's equivalent line:

```js
if (tierBadge) tierBadge.className = 'profile-tier-badge tier-badge-emblem ' + (isACTIVE ? t2.class : 'inactive');
```

Add one assertion to `server/test/tier-motion-shimmer.test.js` (Step 1) before moving on — append this test to the file:

```js
test('the profile tier badge carries the breathing-glow class at every render point', () => {
  const js = source('js/dashboard.js');
  const matches = js.match(/tierBadge\.className\s*=\s*'profile-tier-badge tier-badge-emblem /g) || [];
  assert.ok(matches.length >= 3, `expected the class on all 3 render points, found ${matches.length}`);
});
```

- [ ] **Step 5: Wire the module script into both pages**

At the end of `member-dashboard.html`'s script block (after line 622, the `dashboard.js` tag):

```html
<script src="js/dashboard.js?v=20260807"></script>
<script type="module" src="js/tier-motion.js?v=20260809"></script>
```

Placing it **after** `dashboard.js` matters: `dashboard.js` is a classic (non-deferred) script whose `DOMContentLoaded` listener is registered while parsing reaches its `<script>` tag, before `tier-motion.js` (a deferred module) even executes. Module scripts execute after HTML parsing completes but before `DOMContentLoaded` fires, so `tier-motion.js` registers its own `DOMContentLoaded` listener slightly later — meaning `dashboard.js`'s handler (which sets `document.body.dataset.tier`) is guaranteed to run before `tier-motion.js`'s handler when the event fires, in registration order.

Near the end of `membership.html`'s `<body>` (alongside its other scripts, e.g. after the `canvas-confetti` script tag in `<head>` or before `</body>` — add at the very end of `<body>`, mirroring where other page scripts sit):

```html
<script type="module" src="js/tier-motion.js?v=20260809"></script>
```

(`membership.html` has no `tier-theme.js`/`data-tier` dependency for this task — the shimmer code path for `.ms-tier` cards reads only the card's existing `tier-*` class, not `document.body.dataset.tier` — so ordering relative to other scripts on that page is not load-bearing there.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/tier-motion-shimmer.test.js`
Expected: PASS (5 tests, including the badge-emblem assertion added in Step 4)

- [ ] **Step 7: Manual verification**

Open `membership.html`, scroll the tier cards into view — each should show one diagonal light sweep the first time it enters the viewport, never repeating on subsequent scroll. Open `member-dashboard.html` as a Gold/Platinum member (via the `localStorage` fixture from Task 4) — confirm small drifting dots appear behind the physical card, and confirm a Silver/Bronze member sees none. Confirm the profile tier badge has a slow pulsing glow (fastest/most visible for Platinum, slowest for Bronze). Toggle OS reduce-motion and reload both pages — confirm no shimmer/particles/glow-pulse appear at all.

- [ ] **Step 8: Commit**

```bash
git add js/tier-motion.js member-dashboard.html membership.html server/test/tier-motion-shimmer.test.js
git commit -m "feat: add viewport-entrance shimmer and tier particles via motion library"
```

---

### Task 7: Foil-sheen pointer tilt-tracking on the physical card

**Files:**
- Modify: `js/tier-motion.js` (append tilt-tracking logic)
- Modify: `css/dashboard.css:467-478` (`.phys-card-inner` — remove the static hover-tilt rule in favor of JS-driven tilt when JS is active)
- Test: `server/test/tier-card-tilt.test.js`

**Interfaces:**
- Consumes: `window.RedboxTierTheme.getTierTokens(tierClass).tiltMaxDeg` (Task 1), `motion`'s `animate` (already imported in Task 6).
- Produces: real-time pointer-following tilt + radial foil-sheen highlight on `.phys-card-inner`, intensity scaled by `tiltMaxDeg`; falls back to the existing CSS hover-tilt when JS/`motion` is unavailable or reduced-motion is on.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-card-tilt.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('tier-motion.js reads tiltMaxDeg from the shared token registry', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /getTierTokens\([^)]*\)\.tiltMaxDeg/);
});

test('tier-motion.js only attaches pointer tracking when tiltMaxDeg > 0', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /tiltMaxDeg\s*[<=]=?\s*0/);
});

test('tier-motion.js removes tracking listeners on pointerleave to reset the card', () => {
  const js = source('js/tier-motion.js');
  assert.match(js, /addEventListener\(['"]pointerleave['"]/);
  assert.match(js, /addEventListener\(['"]pointermove['"]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-card-tilt.test.js`
Expected: FAIL — no pointer-tracking code exists yet.

- [ ] **Step 3: Append tilt-tracking to `js/tier-motion.js`**

Inside the existing `document.addEventListener('DOMContentLoaded', () => { ... })` block, after the `injectParticles(physCard, tierClass);` line added in Task 6, add:

```js
      const tokens = theme.getTierTokens(tierClass);
      if (tokens.tiltMaxDeg > 0) {
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
```

- [ ] **Step 4: Add the foil-sheen background layer in `css/dashboard.css`**

At `css/dashboard.css:467-478`, the existing `.phys-card-inner` rule has a CSS-only `transform: rotateZ(-4deg) rotateY(6deg) rotateX(3deg)` hover-tilt. Since Task 3's JS tilt now drives `rotateX`/`rotateY` directly via `animate()` (inline `transform` set on the element), keep the CSS rule for the no-JS/reduced-motion fallback but remove the conflicting `:hover` transform override so JS and CSS don't fight over the same property:

Replace:

```css
.phys-card-wrap:hover .phys-card-inner{
 transform:rotateZ(0deg) rotateY(0deg) rotateX(0deg);
 box-shadow:
 0 24px 70px rgba(0,0,0,.65),
 0 0 0 1px rgba(193,18,31,.3),
 0 0 80px rgba(193,18,31,.3);
}
```

with:

```css
.phys-card-wrap:hover .phys-card-inner{
 box-shadow:
 0 24px 70px rgba(0,0,0,.65),
 0 0 0 1px rgba(193,18,31,.3),
 0 0 80px rgba(193,18,31,.3);
}
.phys-card-inner{
 --sheen-pos: 50% 50%;
}
.phys-card-inner::after{
 content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
 background:radial-gradient(circle at var(--sheen-pos), rgba(255,255,255,.22), transparent 55%);
 opacity:0;transition:opacity .3s ease;
}
.phys-card-wrap:hover .phys-card-inner::after{opacity:1}
```

(The base `.phys-card-inner{ transform:rotateZ(-4deg) rotateY(6deg) rotateX(3deg); ... }` rule at line 469 stays unchanged — it's still the correct resting-state tilt and the no-JS fallback.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/tier-card-tilt.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Manual verification**

Open `member-dashboard.html` as an active Gold or Platinum member. Move the pointer across the physical card — it should tilt smoothly following the pointer (more pronounced for Platinum than Gold) with a soft light patch following the pointer. Move the pointer off the card — it should ease back to resting tilt. Confirm a Bronze member (tiltMaxDeg 0) sees no pointer-tracking (only the pre-existing CSS hover behavior). Toggle reduce-motion — confirm no `pointermove` animation runs (the `prefersReducedMotion()` early-return at the top of the `DOMContentLoaded` handler already covers this, since it exits before any listener is attached).

- [ ] **Step 7: Commit**

```bash
git add js/tier-motion.js css/dashboard.css server/test/tier-card-tilt.test.js
git commit -m "feat: add pointer tilt-tracking and foil-sheen to the physical membership card"
```

---

### Task 8: Celebratory tier-up moment (overlay, confetti, chime, mute toggle)

**Files:**
- Modify: `member-dashboard.html` (add overlay markup + mute button)
- Modify: `js/dashboard.js` (tier-change detection in both re-sync blocks + overlay trigger wiring)
- Modify: `css/dashboard.css` (overlay + mute button styles)
- Test: `server/test/tier-up-celebration.test.js`

**Interfaces:**
- Consumes: `window.RedboxTierTheme.getTierTokens(tierClass).{chime, confettiColors}`, `isChimeMuted`/`setChimeMuted` (Task 1); `window.confetti` (already loaded via `<script src=".../canvas-confetti@1.9.3/...">` in `member-dashboard.html`'s `<head>`); `motion`'s `animate` (already imported by `js/tier-motion.js` in Task 6 — this task's overlay logic lives in `js/dashboard.js`, so it calls `window.RedboxTierTheme` only, and does its own scale reveal with a plain CSS animation to avoid importing `motion` into a non-module script).
- Produces: a dismissible "tier baru!" banner shown only when the synced tier differs from the last-seen tier in `localStorage`; clicking its button reveals the celebration overlay (confetti + chime + emblem), and only then updates the last-seen tier so it won't repeat.

- [ ] **Step 1: Write the failing test**

Create `server/test/tier-up-celebration.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('member-dashboard.html has tier-up overlay markup and a mute toggle button', () => {
  const html = source('member-dashboard.html');
  assert.match(html, /id="tierUpOverlay"/);
  assert.match(html, /id="tierUpBanner"/);
  assert.match(html, /id="btnViewNewCard"/);
  assert.match(html, /id="chimeMuteToggle"/);
});

test('dashboard.js never autoplays the chime outside a click handler', () => {
  const js = source('js/dashboard.js');
  const playCalls = js.match(/\.play\(\)/g) || [];
  assert.ok(playCalls.length >= 1, 'expected at least one .play() call for the chime');
  // The .play() call must sit inside a click listener callback, not at top level of DOMContentLoaded.
  assert.match(js, /addEventListener\(['"]click['"][\s\S]{0,400}\.play\(\)/);
});

test('dashboard.js guards chime playback against a missing audio file', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /\.play\(\)\.catch/);
});

test('dashboard.js persists the last-seen tier and the mute preference', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /redbox_last_seen_tier/);
  assert.match(js, /RedboxTierTheme\.isChimeMuted/);
  assert.match(js, /RedboxTierTheme\.setChimeMuted/);
});

test('dashboard.js fires confetti with tier-specific colors on reveal', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /window\.confetti\(/);
  assert.match(js, /getTierTokens\([^)]*\)\.confettiColors/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/tier-up-celebration.test.js`
Expected: FAIL — no overlay markup, no tier-change detection logic.

- [ ] **Step 3: Add overlay + banner + mute button markup to `member-dashboard.html`**

Right before the closing `</body>` tag (after the `<div class="dash-toast" ...>` element and before the `<footer>`), add:

```html
 <!-- Tier-up banner (shown once when a synced tier differs from last-seen tier) -->
 <div class="tier-up-banner" id="tierUpBanner" style="display:none">
 <span>Tier kamu baru saja naik!</span>
 <button type="button" id="btnViewNewCard">Lihat Kartu Baru</button>
 </div>

 <!-- Tier-up celebration overlay -->
 <div class="tier-up-overlay" id="tierUpOverlay" style="display:none">
 <div class="tier-up-emblem" id="tierUpEmblem"></div>
 <p id="tierUpText"></p>
 <button type="button" class="tier-up-close" id="tierUpClose">Tutup</button>
 </div>

 <!-- Persistent chime mute toggle -->
 <button type="button" class="chime-mute-toggle" id="chimeMuteToggle" aria-label="Bisukan efek suara tier">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14l-1.41-1.41a8 8 0 0 0 0-11.32l1.41-1.41z"/></svg>
 </button>
```

- [ ] **Step 4: Add overlay/banner/mute-button CSS to `css/dashboard.css`**

Append:

```css
/* ---- Tier-up banner ---- */
.tier-up-banner{
 display:flex;align-items:center;gap:14px;justify-content:center;
 position:fixed;left:50%;bottom:20px;transform:translateX(-50%);
 background:var(--bg-2);border:1px solid var(--tier-primary,var(--red));
 border-radius:100px;padding:10px 10px 10px 20px;z-index:950;
 box-shadow:0 12px 32px rgba(0,0,0,.5);
}
.tier-up-banner span{font-size:.85rem;color:var(--white)}
.tier-up-banner button{
 padding:8px 18px;border-radius:100px;border:none;cursor:pointer;
 background:var(--tier-primary,var(--red));color:#000;font-weight:700;font-size:.78rem;
}

/* ---- Tier-up celebration overlay ---- */
.tier-up-overlay{
 position:fixed;inset:0;z-index:9999;
 background:rgba(0,0,0,.85);backdrop-filter:blur(10px);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
 padding:32px;text-align:center;
}
.tier-up-emblem{
 width:96px;height:96px;border-radius:50%;
 background:var(--tier-gradient,var(--red));
 animation:tierUpReveal .5s cubic-bezier(.34,1.56,.64,1);
}
@keyframes tierUpReveal{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}
.tier-up-overlay p{color:var(--white);font-size:1.1rem;max-width:360px}
.tier-up-close{
 padding:10px 24px;border-radius:100px;border:1.5px solid var(--w20);
 background:transparent;color:var(--white);cursor:pointer;
}
@media (prefers-reduced-motion: reduce){
 .tier-up-emblem{animation:none}
}

/* ---- Chime mute toggle ---- */
.chime-mute-toggle{
 position:fixed;right:16px;bottom:16px;z-index:900;
 width:40px;height:40px;border-radius:50%;
 background:var(--bg-3);border:1px solid var(--w10);color:var(--w50);
 display:flex;align-items:center;justify-content:center;cursor:pointer;
}
.chime-mute-toggle.muted{color:var(--red);border-color:var(--red)}
```

- [ ] **Step 5: Wire tier-change detection and the overlay in `js/dashboard.js`**

**5a.** Near the end of the `DOMContentLoaded` closure, after the `renderTierMap(tier);` call added in Task 4, add the shared celebration wiring (this must run regardless of which sync path fires, so it lives once at top level, not duplicated in both sync blocks):

```js
 // ============================================================
 // TIER-UP CELEBRATION
 // ============================================================
 function maybeShowTierUpBanner(newTierClass) {
 if (!newTierClass) return;
 const lastSeen = localStorage.getItem('redbox_last_seen_tier');
 if (lastSeen === null) {
 // First time we've ever recorded a tier for this browser: don't celebrate, just remember it.
 localStorage.setItem('redbox_last_seen_tier', newTierClass);
 return;
 }
 const order = window.RedboxTierTheme.TIER_ORDER;
 if (order.indexOf(newTierClass) > order.indexOf(lastSeen)) {
 const banner = document.getElementById('tierUpBanner');
 if (banner) banner.style.display = 'flex';
 }
 }

 function playTierChime(tierClass) {
 if (window.RedboxTierTheme.isChimeMuted()) return;
 const chimePath = window.RedboxTierTheme.getTierTokens(tierClass).chime;
 if (!chimePath) return;
 const audio = new Audio(chimePath);
 audio.preload = 'metadata';
 audio.play().catch(() => {}); // missing/blocked audio must never break the UI
 }

 function revealTierUp(tierClass) {
 const overlay = document.getElementById('tierUpOverlay');
 const emblem = document.getElementById('tierUpEmblem');
 const text = document.getElementById('tierUpText');
 const tokens = window.RedboxTierTheme.getTierTokens(tierClass);
 if (text) text.textContent = `Selamat! Kamu sekarang member ${tierClass.charAt(0).toUpperCase() + tierClass.slice(1)}.`;
 if (overlay) overlay.style.display = 'flex';
 if (window.confetti) {
 window.confetti({ particleCount: 90, spread: 100, origin: { y: 0.5 }, colors: tokens.confettiColors, startVelocity: 45 });
 }
 playTierChime(tierClass);
 localStorage.setItem('redbox_last_seen_tier', tierClass);
 const banner = document.getElementById('tierUpBanner');
 if (banner) banner.style.display = 'none';
 }

 document.getElementById('btnViewNewCard')?.addEventListener('click', () => {
 revealTierUp(document.body.dataset.tier || 'bronze');
 });
 document.getElementById('tierUpClose')?.addEventListener('click', () => {
 const overlay = document.getElementById('tierUpOverlay');
 if (overlay) overlay.style.display = 'none';
 });

 const muteBtn = document.getElementById('chimeMuteToggle');
 if (muteBtn) {
 muteBtn.classList.toggle('muted', window.RedboxTierTheme.isChimeMuted());
 muteBtn.addEventListener('click', () => {
 const nowMuted = !window.RedboxTierTheme.isChimeMuted();
 window.RedboxTierTheme.setChimeMuted(nowMuted);
 muteBtn.classList.toggle('muted', nowMuted);
 });
 }

 if (ACTIVE) maybeShowTierUpBanner(tier.class);
```

**5b.** In the OTP re-sync block, right after the `applyTierTheme` call added in Task 3 Step 6 (inside the `if (c) { ... }` block, after `const t2 = getDisplayTier(pts);` / `applyTierTheme`), add:

```js
 if (isACTIVE) maybeShowTierUpBanner(t2.class);
```

**5c.** In the Supabase re-sync block, right after the equivalent `applyTierTheme` call, add the same:

```js
 if (isACTIVE) maybeShowTierUpBanner(t2.class);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/tier-up-celebration.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Manual verification**

In a browser, set `localStorage.redbox_last_seen_tier = 'silver'` and a `redbox_member` fixture with `current_tier: 'gold'`, `membership_status: 'ACTIVE'`, valid dates. Reload `member-dashboard.html` — the "Tier kamu baru saja naik!" banner should appear (no autoplay of sound or confetti yet). Click "Lihat Kartu Baru" — overlay should reveal with a spring scale-in, confetti should burst in Gold's colors, and (if `Brand_assets/audio/tier-chime-gold.mp3` exists) a chime should play; if the file doesn't exist, confirm no console-breaking error occurs and the visual celebration still completes. Reload again — the banner should not reappear (last-seen tier is now `gold`). Click the mute icon, confirm it toggles state and persists across reload, and confirm muting suppresses the chime on a subsequent tier-up test.

- [ ] **Step 8: Commit**

```bash
git add member-dashboard.html js/dashboard.js css/dashboard.css server/test/tier-up-celebration.test.js
git commit -m "feat: add celebratory tier-up overlay with confetti, chime, and mute toggle"
```

---

## Post-plan note: audio assets

This plan wires `Brand_assets/audio/tier-chime-{silver,gold,platinum}.mp3` paths (Task 1) and plays them defensively (Task 8) but does not — and cannot — create the actual audio files, since generating binary media assets is outside an implementation plan's scope. Before this feature is fully realized in production, source three short (<1s) chime sounds and place them at those exact paths; until then, the chime silently no-ops and every other part of the celebration (confetti, overlay, banner) still works.
