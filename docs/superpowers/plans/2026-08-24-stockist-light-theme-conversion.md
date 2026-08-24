# Stockist Light Theme Conversion (Plan 2 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the RedBox Stockist app a real, working light/dark theme toggle — light as the default (matching the user's Claude Design mockup screenshots, which are authoritative now, not the dark-only "premium" interpretation from an earlier written brief), dark preserved and selectable via a toggle button that persists the user's choice — without breaking the ~40 already-shipped buttons/pages across the app that implicitly depend on the current (soon to be non-default) dark values, and without touching the three other Next.js modules (`admin_portal`, `owner`, `barber`) that turned out to share one of this plan's underlying files.

**Architecture:** `frontend/src/app/globals.css`'s `:root` custom properties become the **light** theme (today's dark values move into a new `[data-theme="dark"]` override block, verbatim — nothing is lost, only reorganized), matching the mockup's own CSS structure exactly (`:root{...light...}` + `[data-theme="dark"]{...dark overrides...}`). A new `useStockistTheme` hook holds the active theme in state, persists it to `localStorage`, and a wrapping `<div data-theme={theme}>` inside `app/admin/stockist/layout.tsx` (covering BOTH its authenticated and unauthenticated/login render paths) makes the CSS overrides apply. Confirmed by prior research that nothing outside `app/admin/stockist/*` and `components/stockist/*` consumes these tokens — other modules use hardcoded hex literals instead — so this stays fully scoped to stockist. The one shared file, `components/auth/PremiumLoginTransition.tsx` (also used by `app/admin/(admin_portal)/layout.tsx` and `app/owner/layout.tsx`), gets an optional `theme` prop defaulting to `'dark'` so those two other modules are completely unaffected; only the stockist call site passes the live toggle state.

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript, Tailwind v4 (CSS-first `@theme`).

**Spec:** The Claude Design mockup `RedBox Stockist.dc.html` (Claude Design project `11fcf1aa-7a9b-4d30-bec3-7955f5b2a815`), specifically its **light-theme** `:root` block (`--bg:#F7F7F5;--sf:#FFFFFF;--sf2:#F1F1EF;--bd:#E4E0DE;--t1:#1F1A1A;--t2:#6F6666;--t3:#9D9494;--red:#C72820;--red2:#E33A32;--red3:#F26A61;--tred:#FDECEC;--ok:#36B56B;--warn:#E3A43B;--info:#5FA8D3;--tblue:#EAF6FD;--tgreen:#EAF8F0;--tyellow:#FFF7E8;--tpeach:#FDF0EA;--shadow:0 2px 14px rgba(31,26,26,.06);--shadow2:0 8px 26px rgba(31,26,26,.12);--desk:#EDEBE7;--imgbg:#F5F4F2`) plus its `statusOf()`/`kindStyle()`/`chipStyle()` JS functions (which resolve `Habis`→`--red`, `Menipis`→`--warn`, `Aman`→`--ok`, and the four `kindStyle` categories to `{ok:--ok/--tgreen, bad:--red/--tred, warn:--warn/--tyellow, info:--info/--tblue}`) — read via the DesignSync/Claude Design MCP tool earlier this session and saved locally. The user has explicitly stated the mockup (not the older written dark-theme brief `RedBox_Stockist_Premium_UI_UX_Redesign.md`) is authoritative going forward for anything the two conflict on.

## Global Constraints

- No API contract, database schema, route, or auth/session change.
- No new npm dependencies.
- **Do not change `app/admin/(admin_portal)/layout.tsx` or `app/owner/layout.tsx`, or their visual output.** Both import `PremiumLoginTransition` — Task 4 must keep their call sites' behavior byte-identical (no `theme` prop passed = today's dark look, unchanged).
- **Task 1 must land and be verified before Task 2** (the `:root`/`[data-theme="dark"]` restructure) — reversing this order means light becomes the default theme while ~40 red buttons across the app still have theme-coupled white-text-on-red styling that depends on the OLD (pre-restructure) dark-only values, which would make button labels unreadable across most of the app the moment light becomes default.
- **Task 2 must land before Task 3** (the toggle hook/UI) — the toggle is meaningless without both a `:root` (light) and `[data-theme="dark"]` block already existing to switch between.
- Default theme on first visit (no stored preference yet) is **light** — matches the mockup and the user's explicit direction that light is now the primary look; dark remains fully available via the toggle, it's just not the default.
- No frontend test framework exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` / `npm run build` / targeted `grep` checks only.
- No fabricated data — Task 6 restores real, non-fabricated numbers (`heroStats`) that were removed by an earlier (in retrospect overly cautious) fix-wave ruling; it does not restore or add the mockup's fabricated `+4,2%` trend badge, which stays omitted.
- This plan does not cover the missing "Stok" hub screen, the Produk/Gudang Pusat/Stok Cabang list restyle, the new "Manager" role, or any of the other ~15 mockup screens not yet touched — those are follow-up plans (see the end of this document).

---

### Task 1: Fix primary-red-button text/border coupling across the whole app (must land before Task 2)

**Files:** (all under `frontend/src/app/admin/stockist/` and none elsewhere — confirmed by the grep below)
- `warehouse/page.tsx` (lines 110, 237)
- `branch-stock/page.tsx` (lines 246, 288, 308)
- `products/page.tsx` (lines 203, 319, 350, 368, 564)
- `requests/[id]/page.tsx` (lines 280, 322)
- `page.tsx` (line 550 — inside `BranchAdminDashboard`, the "Ajukan Permintaan Stok" CTA)
- `login/page.tsx` (line 138)
- `requests/page.tsx` (lines 88, 124)
- `transfers/page.tsx` (lines 73, 100)
- `requests/new/page.tsx` (line 188)
- `transfers/[id]/page.tsx` (line 315)
- `transfers/new/page.tsx` (line 245)
- `branch-stock/all/page.tsx` (lines 196, 206, 221, 236, 564, 578, 587)
- `returns/new/page.tsx` (lines 114, 200)
- `returns/[id]/page.tsx` (lines 215, 256, 267)
- `stock-opname/page.tsx` (lines 94, 115)
- `stock-opname/[id]/page.tsx` (lines 303, 315)
- `returns/page.tsx` (lines 81, 102)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — this is a pure className-string edit repeated across the files above. After this task, every element whose `className` contains `bg-primary-container` (the solid red background, alone or with `hover:bg-inverse-primary`) must render white text via an explicit `text-white` class instead of the theme-relative `text-text-primary`, and must not carry a hardcoded dark border (`border border-[#302728]`) — the mockup's primary red buttons are borderless. This makes every affected button's visual output theme-independent (correct in both today's dark theme and the light theme Task 2 introduces).

- [ ] **Step 1: Confirm the exact scope with a fresh grep before editing**

Run:
```bash
grep -rn 'bg-primary-container[^"'"'"']*text-text-primary\|text-text-primary[^"'"'"']*bg-primary-container' frontend/src
```
Expected: the same ~37 matches across the 17 files listed above (exact count/lines may have shifted slightly since this plan was written if another commit touched these files — if so, adapt the edit list to match what's actually there, applying the same rule: `text-text-primary` → `text-white` wherever it co-occurs with `bg-primary-container` in the same className string).

- [ ] **Step 2: Apply the fix to every matched className string**

For each match, make exactly two changes within that one className string (leave every other class in the string untouched):
1. `text-text-primary` → `text-white`
2. If the same string also contains `border border-[#302728]` (a hardcoded dark border on a solid red button), remove `border border-[#302728]` entirely (delete the border, don't replace it with anything — the mockup's red CTAs are borderless). Do NOT remove borders that aren't `border-[#302728]` — e.g. leave `border-primary-container` (used on filter-chip "selected" states like `products/page.tsx:350`, `branch-stock/all/page.tsx:221`) exactly as-is; that one is intentional (same-color border-on-fill for a subtle chip edge) and isn't a dark-theme leftover.

Concrete worked examples (apply the same pattern to every other match):

`frontend/src/app/admin/stockist/login/page.tsx:138`, change:
```tsx
className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-border-base mt-2"
```
to:
```tsx
className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg mt-2"
```
(Note: this particular button already uses `border-border-base`, not the hardcoded `border-[#302728]` hex — still remove the whole `border border-border-base` fragment for the same reason: the mockup's login CTA is borderless.)

`frontend/src/app/admin/stockist/warehouse/page.tsx:110`, change:
```tsx
className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-text-primary text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95 border border-[#302728]"
```
to:
```tsx
className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-white text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95"
```

`frontend/src/app/admin/stockist/products/page.tsx:350` (ternary — a filter-chip selected state, NOT a solid CTA button — only the text color changes, the border is intentional and stays), change:
```tsx
? 'bg-primary-container border-primary-container text-text-primary'
```
to:
```tsx
? 'bg-primary-container border-primary-container text-white'
```

`frontend/src/app/admin/stockist/branch-stock/page.tsx:246`, change:
```tsx
className="rounded-lg bg-primary-container text-text-primary py-2 font-semibold"
```
to:
```tsx
className="rounded-lg bg-primary-container text-white py-2 font-semibold"
```
(no border to remove here)

Apply the equivalent `text-text-primary` → `text-white` swap to every remaining match, and additionally strip `border border-[#302728]` wherever it appears alongside a bare `bg-primary-container` solid-fill CTA (not the chip-selected ternaries, which keep their `border-primary-container`).

- [ ] **Step 2b: Also check `bg-inverse-primary` used alone (without `bg-primary-container` in the same string)**

Run: `grep -rn 'bg-inverse-primary' frontend/src/app/admin/stockist frontend/src/components/stockist` — every hit should already be part of a `hover:bg-inverse-primary` on a `bg-primary-container` base (covered by Step 2). If any standalone `bg-inverse-primary` (not a hover state, an actual default background) turns up with `text-text-primary` alongside it, apply the same `text-white` fix to it too.

- [ ] **Step 3: Verify with a clean re-grep**

Run:
```bash
grep -rn 'bg-primary-container[^"'"'"']*text-text-primary\|text-text-primary[^"'"'"']*bg-primary-container' frontend/src
```
Expected: zero matches.

Run:
```bash
grep -rn 'bg-primary-container[^"'"'"']*border-\[#302728\]\|border-\[#302728\][^"'"'"']*bg-primary-container' frontend/src
```
Expected: zero matches (every hardcoded dark border on a solid-red-fill button removed). It is fine and expected for `border-[#302728]` to still appear on buttons that do NOT have `bg-primary-container` (e.g. secondary/outline buttons) — those are untouched by this task.

- [ ] **Step 4: Verify types and lint**

Run: `cd frontend && npx tsc --noEmit` (expect zero errors — this task only edits string literals inside existing JSX, no type surface changes) and `cd frontend && npm run lint` (expect no new findings vs. baseline).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist
git commit -m "$(cat <<'EOF'
fix(stockist): decouple primary-red button text/border from theme tokens

Every button using bg-primary-container across the app relied on
text-text-primary happening to resolve to a light color under the
current dark-only theme, and several carried a hardcoded dark
border-[#302728]. Both are theme-coupling bugs that would make button
labels unreadable the moment the color tokens change (next task) —
fixed by hardcoding text-white and dropping the dark border on every
solid red CTA, matching the mockup's borderless white-on-red buttons
in both the current dark theme and the upcoming light theme.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Restructure `globals.css` into light-default + dark-override tokens

**Files:**
- Modify: `frontend/src/app/globals.css:4-73` (the `:root` block's color values become light) and insert a brand-new `[data-theme="dark"]` block immediately after `:root`'s closing `}` (currently line 73), preserving every one of today's dark values verbatim.

**Interfaces:**
- Consumes: nothing (value replacement in `:root` + one new block; no property renamed).
- Produces: the same `--color-*`/`--background`/`--foreground` property names as before, now resolving to **light** values by default. A new `[data-theme="dark"]` selector overrides the subset that actually differs between themes (surface/text/danger/info/tint tokens — success/warning/primary-container/status-aman/status-menipis/status-kritis/accent-soft are identical in both themes per the mockup, so they are NOT redeclared in the dark block; they simply keep inheriting from `:root`). Two brand-new theme-aware properties are added, `--shadow` and `--shadow2`, each with both a light (`:root`) and dark (`[data-theme="dark"]`) value — consumed by Task 7.

- [ ] **Step 1: Replace the `:root` block's color values with light values**

In `frontend/src/app/globals.css`, replace lines 4-5:
```css
 --background: #151313;
 --foreground: #e8e1e0;
```
with:
```css
 --background: #F7F7F5;
 --foreground: #1F1A1A;
```

Replace lines 31-53 (every `--color-*` value from `--color-surface-dim` through `--color-status-menipis`):
```css
 --color-surface-dim: #151313;
 --color-surface-bright: #3c3838;
 --color-surface-elevated: #211B1C;
 --color-surface-container: #221f1f;
 --color-surface-container-low: #1e1b1b;
 --color-surface-container-lowest: #100e0e;
 --color-surface-container-high: #2c2929;
 --color-surface-container-highest: #373434;
 --color-border-base: #302728;
 --color-text-primary: #F5EEEE;
 --color-text-secondary: #B8AAAC;
 --color-text-muted: #786D6F;
 --color-success: #36B56B;
 --color-warning: #E3A43B;
 --color-danger: #E0504B;
 --color-info: #8A9BA8;
 --color-primary-container: #c72820;
 --color-inverse-primary: #b91d18;

 --color-status-habis: #E0504B;
 --color-status-aman: #36B56B;
 --color-status-kritis: #E33A32;
 --color-status-menipis: #E3A43B;
```
with:
```css
 --color-surface-dim: #F7F7F5;
 --color-surface-bright: #FFFFFF;
 --color-surface-elevated: #FFFFFF;
 --color-surface-container: #F1F1EF;
 --color-surface-container-low: #F7F7F5;
 --color-surface-container-lowest: #EDEBE7;
 --color-surface-container-high: #F1F1EF;
 --color-surface-container-highest: #E4E0DE;
 --color-border-base: #E4E0DE;
 --color-text-primary: #1F1A1A;
 --color-text-secondary: #6F6666;
 --color-text-muted: #9D9494;
 --color-success: #36B56B;
 --color-warning: #E3A43B;
 --color-danger: #C72820;
 --color-info: #5FA8D3;
 --color-primary-container: #c72820;
 --color-inverse-primary: #E33A32;

 --color-status-habis: #C72820;
 --color-status-aman: #36B56B;
 --color-status-kritis: #E33A32;
 --color-status-menipis: #E3A43B;
```

Replace lines 58-61 (tint tokens — currently commented as "dark-theme values"):
```css
 --color-tint-info: #161F26;
 --color-tint-success: #152420;
 --color-tint-warning: #251F14;
 --color-tint-danger: #2A1A19;
```
with:
```css
 --color-tint-info: #EAF6FD;
 --color-tint-success: #EAF8F0;
 --color-tint-warning: #FFF7E8;
 --color-tint-danger: #FDECEC;
```
and update the comment directly above them to read "Tint backgrounds for categorized KPI tiles — light-theme (default) values taken directly from the Claude Design mockup's light-mode tokens (tblue/tgreen/tyellow/tred). Dark-mode overrides live in the `[data-theme=\"dark\"]` block below."

`--color-accent-soft: #F26A61;` is unchanged — identical in both mockup themes.

- [ ] **Step 2: Add `--shadow`/`--shadow2` light values to `:root`**

Immediately after `--color-accent-soft: #F26A61;` (and its comment) and before the font-stack block, insert:
```css

 /* Soft elevation shadows — light (default) values from the Claude
    Design mockup's light-theme tokens. Dark-mode values live in the
    [data-theme="dark"] block below. */
 --shadow: 0 2px 14px rgba(31, 26, 26, 0.06);
 --shadow2: 0 8px 26px rgba(31, 26, 26, 0.12);
```

- [ ] **Step 3: Insert the new `[data-theme="dark"]` override block**

Immediately after `:root`'s closing `}` (right before the `@theme inline {` block), insert an entirely new block:
```css

[data-theme="dark"] {
 --background: #151313;
 --foreground: #e8e1e0;

 --color-surface-dim: #151313;
 --color-surface-bright: #3c3838;
 --color-surface-elevated: #211B1C;
 --color-surface-container: #221f1f;
 --color-surface-container-low: #1e1b1b;
 --color-surface-container-lowest: #100e0e;
 --color-surface-container-high: #2c2929;
 --color-surface-container-highest: #373434;
 --color-border-base: #302728;
 --color-text-primary: #F5EEEE;
 --color-text-secondary: #B8AAAC;
 --color-text-muted: #786D6F;
 --color-danger: #E0504B;
 --color-info: #8A9BA8;
 --color-inverse-primary: #b91d18;

 --color-status-habis: #E0504B;

 --color-tint-info: #161F26;
 --color-tint-success: #152420;
 --color-tint-warning: #251F14;
 --color-tint-danger: #2A1A19;

 /* Dark-mode elevation shadows — from the Claude Design mockup's
    dark-theme tokens (heavier than the light-theme defaults above,
    since dark surfaces need more shadow to read as elevated). */
 --shadow: 0 2px 14px rgba(0, 0, 0, 0.4);
 --shadow2: 0 8px 26px rgba(0, 0, 0, 0.55);
}
```
(`--color-success`/`--color-warning`/`--color-primary-container`/`--color-status-aman`/`--color-status-menipis`/`--color-status-kritis`/`--color-accent-soft`/the motion tokens/the font tokens are NOT redeclared here — they're identical in both themes per the mockup, so they correctly fall through to their `:root` values via normal CSS custom property inheritance.)

- [ ] **Step 4: Map the two shadow tokens into `@theme inline`**

In the `@theme inline` block, immediately after `--font-body-secondary: var(--font-body-secondary);`, insert:
```css
 --shadow: var(--shadow);
 --shadow2: var(--shadow2);
```

- [ ] **Step 5: Verify the file is valid CSS and the whole app still builds**

Run: `cd frontend && npm run build`
Expected: build succeeds. This is also the first real signal of whether Task 1 actually caught every theme-coupled button under the new light default — a successful build only proves the CSS parses and TypeScript compiles, not that every button is legible; that's confirmed by Task 1's own grep checks (already done) plus Task 8's final QA.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(stockist): restructure color tokens into light-default + dark-override

:root now holds the Claude Design mockup's light-theme values (the
user's actual target and new default), and a new [data-theme="dark"]
block preserves every one of today's dark values verbatim, matching
the mockup's own :root + [data-theme="dark"] CSS structure exactly.
Nothing is lost — the app is still fully dark-capable, it's just no
longer the default. Confirmed via prior research that nothing outside
app/admin/stockist and components/stockist consumes these tokens, so
this stays scoped to the stockist module. Adds theme-aware
--shadow/--shadow2 tokens (light and dark values) for later use.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Build the theme toggle mechanism

**Files:**
- Create: `frontend/src/lib/stockist/useTheme.ts`
- Modify: `frontend/src/app/admin/stockist/layout.tsx` (full file, 124 lines — wraps every render path in a themed container and adds a toggle button)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useStockistTheme()` hook returning `{ theme: 'light' | 'dark', toggleTheme: () => void }`, persisted to `localStorage` under key `redbox-stockist-theme`, defaulting to `'light'` when nothing is stored. Consumed by Task 4 (passes the live `theme` value into `PremiumLoginTransition` instead of a hardcoded literal) and by every stockist page implicitly (via the `data-theme` attribute on the wrapping `<div>` this task adds, which the CSS from Task 2 responds to).

- [ ] **Step 1: Write the hook**

```ts
// frontend/src/lib/stockist/useTheme.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

export type StockistTheme = 'light' | 'dark';

const STORAGE_KEY = 'redbox-stockist-theme';

export function useStockistTheme() {
  const [theme, setTheme] = useState<StockistTheme>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // localStorage unavailable (e.g. private browsing) — stay on the light default.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: StockistTheme = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore — theme still switches for this session even if it can't persist
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
```

- [ ] **Step 2: Wire the hook and a `data-theme` wrapper into `layout.tsx`, covering every return path**

Replace the full file:
```tsx
// frontend/src/app/admin/stockist/layout.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, PackageCheck, ClipboardList, History, LayoutDashboard, Building2, Lightbulb } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';
import { PremiumLoginTransition, type PremiumRole } from '@/components/auth/PremiumLoginTransition';
import { useStockistTheme } from '@/lib/stockist/useTheme';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const { theme, toggleTheme } = useStockistTheme();
  const [transition, setTransition] = useState<{ role: PremiumRole; name?: string | null } | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/admin/stockist/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const readTransition = () => {
      try {
      const stored = sessionStorage.getItem('redbox:post-login-transition');
      if (stored) setTransition(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem('redbox:post-login-transition');
      }
    };
    readTransition();
    window.addEventListener('redbox:login-complete', readTransition);
    return () => window.removeEventListener('redbox:login-complete', readTransition);
  }, [user?.id, loading]);

  useEffect(() => {
    if (!transition || loading || !user) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem('redbox:post-login-transition');
      setTransition(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [transition, loading, user]);

  if (loading || !user) {
    return <div data-theme={theme}>{children}</div>;
  }

  if (transition) {
    return (
      <div data-theme={theme}>
        <PremiumLoginTransition role={transition.role} userName={transition.name || user.name} theme={theme} />
      </div>
    );
  }

  const isOwner = user.role === 'owner';

  const ownerTabs: BottomNavItem[] = [
    { label: 'Ringkasan', href: '/admin/stockist', icon: LayoutDashboard },
    { label: 'Cabang', href: '/admin/stockist/branch-stock', icon: Building2, activePrefixes: ['/admin/stockist/branch-stock', '/admin/stockist/branches'] },
    { label: 'Insight', href: '/admin/stockist/insights', icon: Lightbulb }
  ];

  const branchAdminTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/branch-stock', icon: Boxes },
    { label: 'Barang Masuk', href: '/admin/stockist/transfers', icon: PackageCheck },
    { label: 'Permintaan', href: '/admin/stockist/requests', icon: ClipboardList },
    { label: 'Riwayat', href: '/admin/stockist/ledger', icon: History }
  ];

  return (
    <div data-theme={theme}>
      <MotionConfig reducedMotion="user">
        <div className="bg-surface-container-lowest text-text-primary antialiased min-h-screen">
        {/* TopAppBar */}
        <header className="bg-surface-dim fixed top-0 w-full z-50 flex justify-between items-center px-4 h-[48px] shadow-[0_4px_24px_rgba(0,0,0,0.6)] max-w-[430px] left-1/2 -translate-x-1/2 border-b border-border-base">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary-container text-[20px] ml-1">inventory_2</span>
            <span className="font-bold text-[15px] tracking-wider uppercase text-text-primary">
              RedBox Stockist
            </span>
          </div>
          <div className="flex items-center gap-2">
            {user.role === 'owner' && (
              <span className="text-[9px] bg-primary-container/20 text-accent-soft px-2 py-0.5 rounded font-semibold tracking-wide uppercase border border-primary-container/30">
                Owner
              </span>
            )}
            {user.role === 'branch_admin' && (
              <span className="text-[9px] bg-primary-container/20 text-accent-soft px-2 py-0.5 rounded font-semibold tracking-wide uppercase border border-primary-container/30">
                {BRANCH_NAMES[user.branch || ''] || user.branch}
              </span>
            )}
            <button
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Ganti ke mode gelap' : 'Ganti ke mode terang'}
              className="text-text-muted hover:text-text-primary transition-colors flex items-center justify-center w-8 h-8 rounded-full"
            >
              <span className="material-symbols-outlined text-[20px]">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Keluar dari aplikasi?')) {
                  signOut();
                  router.replace('/admin/stockist/login');
                }
              }}
              className="text-text-muted hover:text-text-primary transition-colors flex items-center justify-center w-8 h-8 rounded-full"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        </header>

        {/* Main Container */}
        <main className="pt-[calc(48px+16px)] pb-[calc(70px+24px)] px-4 w-full max-w-[430px] mx-auto min-h-screen flex flex-col gap-4">
          {children}
        </main>

        {/* BottomNavBar */}
        <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
        </div>
      </MotionConfig>
    </div>
  );
}
```
(This is otherwise byte-identical to the current file — the only additions are the `useStockistTheme` import/call, the `data-theme={theme}` wrapper on all three return paths, `theme={theme}` passed into `PremiumLoginTransition` instead of a hardcoded literal, and the new toggle `<button>` in the header between the role badge and the logout button. The header's own `shadow-[0_4px_24px_rgba(0,0,0,0.6)]` is intentionally left as a hardcoded Tailwind arbitrary value here, not switched to `var(--shadow2)` — Task 7 only touches the login page's two shadows; leaving this one as-is is a deliberate scope boundary, not an oversight, since the header is a persistent chrome element across every authenticated page and changing its shadow is a separate, lower-priority visual nit outside what this plan set out to fix.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/stockist/useTheme.ts frontend/src/app/admin/stockist/layout.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add a working light/dark theme toggle

New useStockistTheme hook persists the choice to localStorage
(defaulting to light) and layout.tsx applies it via a data-theme
attribute that Task 2's CSS responds to, on every render path
(loading, post-login transition, and the full authenticated shell) so
the login screen and the dashboard both respect the same toggle. A new
icon button in the top app bar switches themes live.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Give `PremiumLoginTransition` a theme prop, default dark (unaffected callers), live toggle for stockist

**Files:**
- Modify: `frontend/src/components/auth/PremiumLoginTransition.tsx` (full file, 48 lines)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PremiumLoginTransition`'s props gain a new **optional** field `theme?: 'dark' | 'light'`, defaulting to `'dark'` — this is a backward-compatible addition. The two OTHER call sites of this component (`frontend/src/app/admin/(admin_portal)/layout.tsx` and `frontend/src/app/owner/layout.tsx`) must NOT be touched by this task and must continue calling it without a `theme` prop, so they keep today's dark look automatically via the default. The stockist call site (already updated by Task 3's full-file rewrite of `layout.tsx` to pass `theme={theme}`) now drives this prop from the live toggle state instead of a hardcoded literal.

- [ ] **Step 1: Confirm the other two call sites, so you know not to touch them**

Run: `grep -rn 'PremiumLoginTransition' frontend/src` — expect exactly 4 matches: the component's own definition/export, and three call sites (`app/admin/stockist/layout.tsx` — already updated by Task 3 — `app/admin/(admin_portal)/layout.tsx`, `app/owner/layout.tsx`). This task only touches the component file itself.

- [ ] **Step 2: Add the `theme` prop to the component**

Replace the full file:
```tsx
// frontend/src/components/auth/PremiumLoginTransition.tsx
'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { CoreSpinLoader } from '@/components/ui/core-spin-loader';

export type PremiumRole = 'owner' | 'manager' | 'branch_admin' | 'barber';

const THEME_STYLES = {
  dark: { background: '#090707', mutedText: '#786D6F' },
  light: { background: '#F7F7F5', mutedText: '#9D9494' },
} as const;

export function PremiumLoginTransition({
  role,
  userName,
  theme = 'dark',
}: {
  role: PremiumRole;
  userName?: string | null;
  theme?: 'dark' | 'light';
}) {
  const styles = THEME_STYLES[theme];
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-hidden px-6"
      style={{ background: styles.background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
      role="status"
      data-role={role}
      aria-live="polite"
      aria-label="Menyiapkan dashboard"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 35%, rgba(199,40,32,0.11), transparent 72%)' }} />
      <div className="relative flex w-full max-w-[320px] flex-col items-center text-center">
        <motion.div
          className="relative h-[118px] w-[118px] sm:h-[132px] sm:w-[132px]"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <Image src="/Brand_assets/logo_transparant.png" alt="RedBox" fill priority className="object-contain" sizes="132px" />
        </motion.div>
        <motion.div
          className="relative mt-5 h-[34px] w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.16 }}
        >
          <Image src="/Brand_assets/logo_font.png" alt="RedBox Barbershop" fill priority className="object-contain" sizes="320px" />
        </motion.div>
        <div className="mt-7 w-full">
          <CoreSpinLoader />
        </div>
        {userName && <p className="-mt-4 text-[11px]" style={{ color: styles.mutedText }}>Menyiapkan ruang kerja, {userName}...</p>}
      </div>
    </motion.div>
  );
}
```
(The radial red glow overlay and `CoreSpinLoader` are unchanged — both are theme-neutral: the glow is a low-opacity red radial that reads fine on either background, and `CoreSpinLoader` was already confirmed by earlier research to use its own `emerald-*`/`cyan-*` classes independent of these tokens. `PremiumRole` already includes `'manager'` from an earlier session — unrelated to this task, left as-is.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify the other two call sites are untouched**

Run: `git diff --stat` and confirm `app/admin/(admin_portal)/layout.tsx` and `app/owner/layout.tsx` do NOT appear in the list of changed files across this task's commit.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/auth/PremiumLoginTransition.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add theme prop to PremiumLoginTransition

Shared with the admin portal and owner modules, so this adds an
optional theme prop (defaulting to the existing dark look) rather than
flipping the component outright — only the stockist call site (wired
in Task 3) passes the live toggle state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Make `HorizontalBarChart` theme-aware

**Files:**
- Modify: `frontend/src/components/stockist/HorizontalBarChart.tsx` (full file, 34 lines)
- Modify: `frontend/src/app/admin/stockist/page.tsx` (the one call site, inside `OwnerCommandCenter`)

**Interfaces:**
- Consumes: `useStockistTheme` from Task 3.
- Produces: `HorizontalBarChart`'s props gain a new **required** field `theme: 'light' | 'dark'` — recharts renders to inline SVG styles it controls directly, so it cannot read CSS custom properties; it must be told which hex set to use explicitly, and re-render when the toggle changes.

- [ ] **Step 1: Replace the full file with a theme-aware version**

```tsx
// frontend/src/components/stockist/HorizontalBarChart.tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrencyCompact } from '@/lib/stockist/format';

export interface HorizontalBarChartDatum {
  name: string;
  value: number;
}

const THEME_COLORS = {
  light: { axisTick: '#6F6666', tooltipBg: '#FFFFFF', tooltipBorder: '#E4E0DE', tooltipText: '#1F1A1A' },
  dark: { axisTick: '#B8AAAC', tooltipBg: '#211B1C', tooltipBorder: '#302728', tooltipText: '#F5EEEE' },
} as const;

export function HorizontalBarChart({ data, theme }: { data: HorizontalBarChartDatum[]; theme: 'light' | 'dark' }) {
  const colors = THEME_COLORS[theme];
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ fill: colors.axisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value) => formatCurrencyCompact(value as number | undefined)}
            contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: colors.tooltipText }}
            cursor={{ fill: 'rgba(199,40,32,0.08)' }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={600} animationEasing="ease-out">
            {data.map((entry) => (
              <Cell key={entry.name} fill="#C72820" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```
(`cursor.fill` and the bar's `#C72820` fill are unchanged — both are the same red in both themes.)

- [ ] **Step 2: Update the one call site to pass the current theme**

`OwnerCommandCenter` in `frontend/src/app/admin/stockist/page.tsx` doesn't currently receive the theme — it needs it. `OwnerCommandCenter` is rendered by `StockistDashboard`, which is rendered inside `app/admin/stockist/layout.tsx`'s `{children}` slot, so the theme has to reach it via the same `useStockistTheme` hook called independently (calling a hook twice in two different components both reading/writing the same `localStorage` key is safe and simpler here than threading a prop or introducing a context, since both calls stay in sync on next read — but do NOT call `toggleTheme` from this second call site, only read `theme`).

At the top of `frontend/src/app/admin/stockist/page.tsx`, add the import:
```tsx
import { useStockistTheme } from '@/lib/stockist/useTheme';
```

Inside `OwnerCommandCenter`, immediately after its existing `useState` declarations, add:
```tsx
  const { theme } = useStockistTheme();
```

Then find the `<HorizontalBarChart data={...} />` call and add the new required prop:
```tsx
                <HorizontalBarChart
                  data={assets.asset_by_location.map((location) => ({ name: location.location_name, value: location.total_asset_value ?? 0 }))}
                  theme={theme}
                />
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/HorizontalBarChart.tsx frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): make HorizontalBarChart respond to the theme toggle

recharts renders inline SVG styles it controls directly and can't read
CSS custom properties, so it needs an explicit theme prop instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Restore the hero card's real (non-fabricated) mini-stats

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx:194-203` (the hero `<StatCard>` call inside `OwnerCommandCenter`)

**Interfaces:**
- Consumes: `activeProductCount`, `totalStockUnits`, `assets.asset_by_location.length` — all already computed/available in this exact function (unchanged from the previous plan).
- Produces: no new exports. Restores the `heroStats` prop on the existing hero `<StatCard>` call (this prop already exists on `StatCard` — it was added, used, then removed in the prior plan; this task re-adds the call-site usage only, no `StatCard.tsx` change needed).

Context: the mockup's hero card shows three real numbers (Lokasi/SKU aktif/Unit) as a glanceable summary row underneath the headline asset value — this is a deliberate, common dashboard pattern (hero summary + detail grid both showing related numbers is not a design flaw), and none of the three numbers are fabricated. A previous plan's final review flagged this as duplicating the KPI grid below and had it removed — the user has since made clear they want the mockup matched exactly, which includes this element. Restore it.

- [ ] **Step 1: Add `heroStats` back to the hero `<StatCard>` call**

Change:
```tsx
          <motion.div variants={fadeSlideItem}>
            {/* No heroTrend/heroStats here — the API has no period-over-period delta or
                duplicate breakdown data; the KPI grid below already covers Lokasi/SKU/Unit. */}
            <StatCard
              label="Aset Stok RedBox"
              value={assets.total_asset_value ?? 0}
              formatter={formatCurrency}
              variant="hero"
              hint="Total nilai stok aktif di seluruh jaringan RedBox."
            />
          </motion.div>
```
to:
```tsx
          <motion.div variants={fadeSlideItem}>
            {/* heroTrend intentionally omitted — the API has no period-over-period
                delta to show a real percentage; do not fabricate one if a future
                change reintroduces this prop. heroStats below are real, already-
                fetched numbers, not fabricated. */}
            <StatCard
              label="Aset Stok RedBox"
              value={assets.total_asset_value ?? 0}
              formatter={formatCurrency}
              variant="hero"
              hint="Total nilai stok aktif di seluruh jaringan RedBox."
              heroStats={[
                { label: 'Lokasi', value: String(assets.asset_by_location.length) },
                { label: 'SKU aktif', value: String(activeProductCount) },
                { label: 'Unit', value: totalStockUnits.toLocaleString('id-ID') },
              ]}
            />
          </motion.div>
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors — `heroStats` is an existing, already-typed `StatCardProps` field.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): restore hero card mini-stats to match the mockup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Make the login card shadows theme-aware

**Files:**
- Modify: `frontend/src/app/admin/stockist/login/page.tsx` (lines 68, 72 — two `shadow-[...]` arbitrary values become inline styles referencing the theme-aware tokens)

**Interfaces:**
- Consumes: `--shadow`/`--shadow2` tokens from Task 2 (each now has both a light and dark value, switching automatically based on the `data-theme` attribute Task 3 applies).
- Produces: no interface change — visual only.

Tailwind v4 arbitrary-value shadow classes (`shadow-[...]`) take a literal value, not a `var()` reference that would re-resolve on theme change reliably across Tailwind's build-time extraction — the safe, definitely-reactive way to consume a CSS custom property that changes at runtime is a plain inline `style` prop referencing `var(--shadow2)` directly, which the browser re-evaluates on every render against whatever `[data-theme]` is currently active.

- [ ] **Step 1: Replace the two hardcoded shadow classes with theme-aware inline styles**

Change:
```tsx
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden bg-surface-container-lowest text-text-primary max-w-[430px] mx-auto border-x border-border-base shadow-[0_4px_24px_rgba(0,0,0,0.6)]">
```
to:
```tsx
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden bg-surface-container-lowest text-text-primary max-w-[430px] mx-auto border-x border-border-base"
      style={{ boxShadow: 'var(--shadow2)' }}
    >
```

Change:
```tsx
      <div className="w-full relative z-10 flex flex-col gap-6 p-6 rounded-2xl bg-surface-elevated border border-border-base shadow-lg">
```
to:
```tsx
      <div
        className="w-full relative z-10 flex flex-col gap-6 p-6 rounded-2xl bg-surface-elevated border border-border-base"
        style={{ boxShadow: 'var(--shadow2)' }}
      >
```
(Both elements now use `--shadow2`, the larger/softer of the two tokens — the outer container previously had a much heavier one-off `rgba(0,0,0,0.6)` that doesn't correspond to either mockup token; `--shadow2` reads correctly in both themes and matches the inner card, which is an acceptable, deliberate simplification from two slightly different one-off shadows to one shared token.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/login/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): make login card shadows respond to the theme toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verification pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full production build**

Run: `cd frontend && npm run build`
Expected: succeeds, all routes generated, zero TypeScript errors.

- [ ] **Step 2: Re-confirm the Task 1 sweep is complete against the now-flipped default tokens**

Run:
```bash
grep -rn 'bg-primary-container[^"'"'"']*text-text-primary\|text-text-primary[^"'"'"']*bg-primary-container' frontend/src
```
Expected: zero matches (re-confirms Task 1 wasn't reverted or bypassed by a later task).

- [ ] **Step 3: Confirm the two other `PremiumLoginTransition` callers are unaffected**

Run: `git diff main --stat -- frontend/src/app/admin/\(admin_portal\)/layout.tsx frontend/src/app/owner/layout.tsx` (or the equivalent against this branch's base commit) — expect no output (no changes to either file across this entire plan).

- [ ] **Step 4: Start the dev server and smoke-test the login render, both themes**

Run: `cd frontend && npm run dev`, then:
```bash
curl -s -o /dev/null -w "login HTTP %{http_code}\n" http://localhost:3000/admin/stockist/login
curl -s http://localhost:3000/admin/stockist/login | grep -o "bg-surface-container-lowest" | head -1
```
Expected: HTTP 200, and the theme class is present in the rendered HTML. Note this only confirms the server-rendered shell — the toggle itself is client-state (`localStorage` + React state), so it can't be curl-tested; that's covered by Step 5. Stop the dev server afterward with a scoped kill of only the process(es) this command started — do not run a system-wide `taskkill /IM node.exe` or `pkill -f node`, which would also kill unrelated Node processes on the machine.

- [ ] **Step 5: Note remaining manual QA scope**

As with the prior plan, full interactive visual QA still requires real Supabase credentials not available in this environment. This QA pass now specifically needs, once credentials are available: (a) click the new theme-toggle icon button in the header and confirm the whole app — login screen included, by logging out and back in — switches between light and dark without a page reload glitch; (b) reload the page after toggling and confirm the choice persisted (reads back from `localStorage`); (c) eyeball every one of the ~17 files Task 1 touched in BOTH themes, since this plan's restructure is the first time their red buttons render under the new default (light) and the toggle makes dark reachable again too. Record this explicitly as open in the ledger for the user.

No commit for this task — verification only.

---

## What this plan deliberately does not cover

This plan (Plan 2) fixes the **color system** (now a real light/dark toggle, light default) and the two already-built screens (Login, Owner Home) so they render correctly in both themes, and prevents the restructure from visually breaking the ~15 other already-shipped stockist pages it didn't otherwise touch. It does **not** yet:
- Build the missing "Stok" hub screen (mockup's `isStokHub` — a 7-item icon list: Produk / Gudang Pusat / Stok Cabang / Inventory Ledger / Permintaan Stok / Retur Barang / Insight) or repoint the Owner bottom-nav "Stok" tab to it (today it goes straight to `branch-stock`).
- Restyle the Produk / Gudang Pusat / Stok Cabang list screens (mockup's `isList`, reused three ways) to match the mockup's search bar + `Semua/Aman/Menipis/Habis` filter chips + product-photo card layout exactly.
- Touch Product Detail, Receive Goods, Transfers (list/new/detail/confirm), Ledger, Stock Opname, the Docs hub (requests/returns/insights), Notifications, Profile, Scan, or the states/empty gallery.
- Implement the new "Manager" role (login flow, dashboard split, permission checks across ~10 frontend and backend files, plus a database migration) — this is a separate, security-sensitive change (touches auth/DB/API, which every prior plan in this sequence was explicitly told NOT to touch) and gets its own dedicated plan with its own review rigor, per the user's explicit choice to fully implement it.

These are follow-up plans, continuing immediately after this one per the user's explicit "make sure every page gets implemented" direction — each will get its own plan document in this same sequence, reusing the token foundation and the `StatCard`/`ListRow`/`LocationCard`/`ProductAttentionRow`/`QuickActionGrid` components this plan and its predecessor established.
