# Stockist Mockup Visual Refresh — Login + Owner Dashboard (Plan 1 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the already-implemented Stockist Owner Dashboard and Login screen visually in line with the new high-fidelity mockup imported from Claude Design (`claude.ai/design` project `11fcf1aa-7a9b-4d30-bec3-7955f5b2a815`, file `RedBox Stockist.dc.html`) — colored KPI tiles, a red-gradient hero asset card, an explicit "Aksi cepat" quick-action grid, product-photo attention rows, and per-location progress bars — while keeping every existing data source, route, and permission check unchanged.

**Architecture:** Pure frontend visual change, additive to the component set already shipped by `docs/superpowers/plans/2026-08-19-stockist-owner-dashboard-redesign.md` (confirmed live in the codebase as of 2026-08-23 — `StatCard`, `ListRow`, `LocationCard`, `BottomSheet`, `SkeletonCard`, `EmptyState`, `AnimatedNumber`, `HorizontalBarChart`, `LocationDrillDownContent`, `lib/stockist/motion.ts` all exist and match that plan's output almost verbatim). This plan extends `StatCard` and `LocationCard` with new optional props, adds two new small presentational components (`QuickActionGrid`, `ProductAttentionRow`), adds new CSS design tokens, and rebuilds only the `OwnerCommandCenter` JSX inside `frontend/src/app/admin/stockist/page.tsx` plus the login page's JSX. `BranchAdminDashboard`, all API calls, `useUser`/`stockistRole.ts`, and `layout.tsx`'s route guard are untouched.

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript, Tailwind v4 (CSS-first `@theme`), `framer-motion` (already a dependency), `recharts` (already a dependency, already used by `HorizontalBarChart`).

**Spec:** Design source is the Claude Design mockup `RedBox Stockist.dc.html` (screens `isLogin` lines 61-95 and `isOwnerHome` lines 97-181, bottom-nav `navDefs` lines 1030-1034) plus `RedBox_Stockist_Premium_UI_UX_Redesign.md` (repo root) for the written brief. There is no separate spec markdown for this plan — the mockup file itself, read via the `DesignSync`/Claude Design MCP tool, is the source of truth for visual detail; this plan's task descriptions quote the relevant mockup values inline instead of pointing to a spec doc.

## Global Constraints

- No API contract, database schema, route, or auth/session change (brief §46, prior plan's Global Constraints — still binding).
- No new npm dependencies.
- **No fabricated/dummy data.** The mockup's hero card shows a static `+4,2%` trend badge and per-product photos for every SKU — the real API (`getAssetDashboard()`) has no period-over-period delta field, so the trend badge is omitted entirely (not faked) when no real trend exists. Product photos use the existing `getKnownProductImage()` helper, which only returns real RedBox product photos for a known handful of SKUs and returns `null` otherwise — unmatched products fall back to a neutral icon placeholder, never a guessed/generic stock photo.
- **`BranchAdminDashboard`** (same file, lines ~254 onward) and **`layout.tsx`'s route guard / nav tab lists** are not touched by this plan, except that `layout.tsx`'s pre-existing `text-accent-soft` class (lines 87, 92) starts resolving correctly as a side effect of Task 1 adding the token it was always missing — no code line in `layout.tsx` itself changes.
- **No light/dark theme toggle.** The mockup file includes a theme toggle button because Claude Design prototypes always ship both a light and dark preview theme — the written brief (`RedBox_Stockist_Premium_UI_UX_Redesign.md`) is explicit that the target is a single "premium dark" identity, and the app has no light theme today. This plan does not add one.
- **No frontend test framework exists in this repo** (`frontend/package.json` has no test runner, confirmed 2026-08-23). Verification per task is `cd frontend && npx tsc --noEmit` for type safety, `cd frontend && npm run lint` where noted, plus a final manual QA pass (Task 8) against a running dev server. This replaces the write-test-first loop for this plan only, matching the precedent set by the prior Owner Dashboard plan.
- Animate only `transform`/`opacity` — no animating `width`/`height`/`top`/`left` (brief §43). The one exception already in the codebase, `LocationCard`'s upcoming progress-bar `width` transition (Task 5), is a static render (no animated width transition), only the initial paint — so it doesn't violate this.
- All UI copy is Indonesian, matching the existing Stockist pages and the mockup's own copy.
- Design-decision callout (read before Task 6): the mockup's owner KPI row has 4 tiles — Total Produk / Total Stok / Produk Menipis / Transfer Berjalan — where "Produk Menipis" is a single number. The current app instead splits that into two tiles, "Produk Menipis" (`LOW_STOCK` only) and "Produk Habis" (`OUT_OF_STOCK` only). Task 6 merges these into one "Produk Menipis" tile counting all `attention_items` (both reasons combined) to match the mockup's 4-tile layout — the Habis/Menipis distinction is not lost, it's still visible one tap away in the attention drill-down sheet and inline in the "Perlu perhatian" list (each row carries its own `statusLabel` badge, "Habis" or "Menipis"). Flag this to the user during review if the merged framing reads as a regression rather than a simplification.

---

### Task 1: Design tokens — tint backgrounds, accent-soft, display fonts

**Files:**
- Modify: `frontend/src/app/globals.css:53` (end of `:root` Stitch tokens block, right after `--color-status-menipis: #E3A43B;`) and `frontend/src/app/globals.css:86` (end of the `@theme inline` block, right after `--color-inverse-primary: var(--color-inverse-primary);`)

**Interfaces:**
- Produces: new CSS custom properties `--color-tint-info`, `--color-tint-success`, `--color-tint-warning`, `--color-tint-danger`, `--color-accent-soft`, `--font-display`, `--font-body-secondary`, each mapped into `@theme inline` so Tailwind v4 generates `bg-tint-info`/`text-accent-soft`/`font-display`/`font-body-secondary` utility classes. Consumed by Task 2 (`StatCard`), Task 4 (`ProductAttentionRow`), and the pre-existing (already-shipped, currently-broken) `text-accent-soft` usage in `frontend/src/app/admin/stockist/layout.tsx:87,92` and the pre-existing `font-display`/`font-body-secondary` usage in `page.tsx:143,146` and `StatCard.tsx:26` (before Task 2's rewrite).

- [ ] **Step 1: Add the new custom properties to `:root`**

In `frontend/src/app/globals.css`, immediately after line 53 (`--color-status-menipis: #E3A43B;`) and before the closing `}` on line 54, insert:

```css

 /* Tint backgrounds for categorized KPI tiles — dark-theme values taken
    directly from the Claude Design mockup's dark-mode tokens (tblue/
    tgreen/tyellow/tred) for visual parity with the approved design. */
 --color-tint-info: #161F26;
 --color-tint-success: #152420;
 --color-tint-warning: #251F14;
 --color-tint-danger: #2A1A19;

 /* Lighter red accent for small badges/labels (mockup's --red3). */
 --color-accent-soft: #F26A61;

 /* Display/body-secondary font stacks — Plus Jakarta Sans and Inter are
    already loaded via <link> in the root layout; these just give the
    `font-display`/`font-body-secondary` Tailwind classes (already used in
    page.tsx and StatCard.tsx before this change, but previously undefined
    here) something real to resolve to. */
 --font-display: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
 --font-body-secondary: 'Inter', ui-sans-serif, system-ui, sans-serif;
```

- [ ] **Step 2: Map the new properties into `@theme inline`**

Immediately after line 86 (`--color-inverse-primary: var(--color-inverse-primary);`) and before the blank line that precedes `--color-status-habis: var(--color-status-habis);`, insert:

```css

 --color-tint-info: var(--color-tint-info);
 --color-tint-success: var(--color-tint-success);
 --color-tint-warning: var(--color-tint-warning);
 --color-tint-danger: var(--color-tint-danger);
 --color-accent-soft: var(--color-accent-soft);
 --font-display: var(--font-display);
 --font-body-secondary: var(--font-body-secondary);
```

- [ ] **Step 3: Verify the file is valid CSS and the build compiles**

Run: `cd frontend && npx tsc --noEmit` (should still pass, unaffected by CSS) then `cd frontend && npm run build`
Expected: build succeeds. Next.js fails the build on invalid CSS syntax, so a clean build confirms the tokens parse.

- [ ] **Step 4: Visually confirm the pre-existing `text-accent-soft` bug is fixed**

Run: `cd frontend && npm run dev`, log in as owner, look at the top app bar's "Owner" role badge (`frontend/src/app/admin/stockist/layout.tsx:87`). Before this change it rendered in an undefined/inherited color; after this change it should render in the soft red `#F26A61`. No code change needed in `layout.tsx` itself — this is a side effect of the token now existing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(stockist): add tint, accent-soft, and display-font design tokens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extend `StatCard` with icon, tint, and a red-gradient hero variant

**Files:**
- Modify: `frontend/src/components/stockist/StatCard.tsx` (full-file rewrite, 74 lines → ~110 lines)

**Interfaces:**
- Consumes: `--color-tint-*` tokens (Task 1), existing `--color-primary-container`/`--color-inverse-primary` tokens (already defined, used for the hero gradient), existing `AnimatedNumber` and `cardHover`.
- Produces: `StatCardProps` gains four new **optional** fields — `icon?: string` (Material Symbols name shown next to the label on non-hero variants), `tint?: 'info' | 'success' | 'warning' | 'danger'` (colored KPI tile background), `heroTrend?: string` (hero-only trend pill, omitted entirely when not passed — see Global Constraints on fabricated data), `heroStats?: { label: string; value: string }[]` (hero-only 3-box mini-stat row). All four are backward compatible: every existing call site across the codebase (checked via `grep -rn "<StatCard" frontend/src` in Step 1) that doesn't pass them keeps its current visual output for `variant="default"` and `variant="danger"`; only `variant="hero"` changes visually (from a plain surface card to a red gradient card), and there is exactly one `variant="hero"` call site in the whole codebase today (`page.tsx`, updated in Task 6 of this same plan).

- [ ] **Step 1: Confirm there's only one `variant="hero"` call site before changing its visual meaning**

Run: `grep -rn 'variant="hero"' frontend/src` — expected: exactly one match, inside `OwnerCommandCenter` in `frontend/src/app/admin/stockist/page.tsx`. If there's a second match anywhere (e.g. added by a commit after 2026-08-23), stop and check whether that call site also wants the new gradient look before proceeding — if not, this task needs a new variant name instead of repurposing `'hero'`.

- [ ] **Step 2: Replace the full file**

```tsx
// frontend/src/components/stockist/StatCard.tsx
'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { AnimatedNumber } from './AnimatedNumber';
import { cardHover } from '@/lib/stockist/motion';

export interface StatCardProps {
  label: string;
  value: number;
  formatter?: (n: number) => string;
  hint?: string;
  variant?: 'default' | 'hero' | 'danger';
  href?: string;
  onClick?: () => void;
  trailingBadge?: string;
  icon?: string;
  tint?: 'info' | 'success' | 'warning' | 'danger';
  heroTrend?: string;
  heroStats?: { label: string; value: string }[];
}

const TINT_BG: Record<NonNullable<StatCardProps['tint']>, string> = {
  info: 'bg-tint-info border-info/20',
  success: 'bg-tint-success border-success/20',
  warning: 'bg-tint-warning border-warning/20',
  danger: 'bg-tint-danger border-danger/20',
};

const TINT_ICON: Record<NonNullable<StatCardProps['tint']>, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

function StatCardBody(props: Omit<StatCardProps, 'href' | 'onClick'>) {
  const { label, value, formatter, hint, variant = 'default', trailingBadge, icon, tint, heroTrend, heroStats } = props;
  const isHero = variant === 'hero';
  const isDanger = variant === 'danger';

  if (isHero) {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-white/80 uppercase tracking-wide">{label}</span>
          {heroTrend && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-white bg-white/15 px-2 py-1 rounded-full shrink-0">
              <span className="material-symbols-outlined text-[13px]">trending_up</span>
              {heroTrend}
            </span>
          )}
        </div>
        <div className="font-display tabular-nums mt-2 text-[30px] font-bold text-white truncate">
          <AnimatedNumber value={value} formatter={formatter} />
        </div>
        {hint && <span className="text-[10px] text-white/70 mt-1 block">{hint}</span>}
        {heroStats && heroStats.length > 0 && (
          <div className="flex gap-2 mt-3">
            {heroStats.map((stat) => (
              <div key={stat.label} className="flex-1 bg-white/10 rounded-xl px-2.5 py-2 flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] font-bold text-white tabular-nums truncate">{stat.value}</span>
                <span className="text-[10px] text-white/75 truncate">{stat.label}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className={`material-symbols-outlined text-[18px] ${tint ? TINT_ICON[tint] : isDanger ? 'text-danger' : 'text-text-muted'}`}>
            {icon}
          </span>
        )}
        <span className={`text-[11px] font-semibold ${isDanger ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
      </div>
      <div
        className={`font-display tabular-nums mt-2 flex items-baseline gap-2 truncate text-[19px] font-bold ${
          isDanger ? 'text-danger' : 'text-text-primary'
        }`}
      >
        <AnimatedNumber value={value} formatter={formatter} />
        {trailingBadge && (
          <span className="text-[10px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
            {trailingBadge}
          </span>
        )}
      </div>
      {hint && <span className="text-[10px] text-text-muted mt-1 block">{hint}</span>}
    </>
  );
}

export function StatCard(props: StatCardProps) {
  const { href, onClick, variant = 'default', tint } = props;
  const isDanger = variant === 'danger';
  const isHero = variant === 'hero';

  const className = isHero
    ? 'flex flex-col text-left rounded-xl min-h-[92px] w-full p-5 border border-transparent bg-gradient-to-br from-primary-container to-inverse-primary shadow-[0_10px_26px_rgba(199,40,32,0.22)]'
    : `flex flex-col text-left border rounded-xl min-h-[92px] w-full p-4 ${
        tint ? TINT_BG[tint] : isDanger ? 'bg-surface-elevated border-danger/30' : 'bg-surface-elevated border-border-base'
      }`;

  if (href) {
    return (
      <Link href={href} className="block">
        <motion.div {...cardHover} className={className}>
          <StatCardBody {...props} />
        </motion.div>
      </Link>
    );
  }

  if (onClick) {
    return (
      <motion.button type="button" onClick={onClick} className={className} {...cardHover}>
        <StatCardBody {...props} />
      </motion.button>
    );
  }

  return (
    <div className={className}>
      <StatCardBody {...props} />
    </div>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/StatCard.tsx` or any of its call sites (there will be pre-existing errors in `page.tsx` only after Task 6 changes it to pass the new props — until Task 6 runs, `page.tsx`'s current calls remain valid since all new props are optional).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/StatCard.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): extend StatCard with icon, tint, and gradient hero variant

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `QuickActionGrid` component

**Files:**
- Create: `frontend/src/components/stockist/QuickActionGrid.tsx`

**Interfaces:**
- Consumes: `next/link` only.
- Produces: `QuickAction` type `{ key: string; href: string; icon: string; label: string }` and `QuickActionGrid` component, props `{ actions: QuickAction[] }`, rendering a `grid-cols-2` grid of link buttons. Consumed by Task 6 (`page.tsx`).

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/QuickActionGrid.tsx
'use client';

import Link from 'next/link';

export interface QuickAction {
  key: string;
  href: string;
  icon: string;
  label: string;
}

export function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action) => (
        <Link
          key={action.key}
          href={action.href}
          className="min-h-[48px] flex items-center gap-2.5 p-3 rounded-xl border border-border-base bg-surface-elevated text-text-primary text-[12px] font-bold hover:border-primary-container hover:text-primary-container active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-primary-container text-[19px]">{action.icon}</span>
          {action.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/QuickActionGrid.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/QuickActionGrid.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add QuickActionGrid component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ProductAttentionRow` component

**Files:**
- Create: `frontend/src/components/stockist/ProductAttentionRow.tsx`

**Interfaces:**
- Consumes: `getKnownProductImage(name: string): string | null` from `@/lib/stockist/productImage` (already exists, already used by `BranchAdminDashboard` in `page.tsx`), `--color-tint-*` tokens (Task 1).
- Produces: `ProductAttentionRowData` type `{ key: string; name: string; meta: string; statusLabel: string; severity: 'danger' | 'warning'; trailing: string; trailingUnit: string; href?: string; onClick?: () => void }` and `ProductAttentionRow` component. Consumed by Task 6 (`page.tsx`) for the Owner Home "Perlu perhatian" preview list.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/ProductAttentionRow.tsx
'use client';

import Link from 'next/link';
import { getKnownProductImage } from '@/lib/stockist/productImage';

export interface ProductAttentionRowData {
  key: string;
  name: string;
  meta: string;
  statusLabel: string;
  severity: 'danger' | 'warning';
  trailing: string;
  trailingUnit: string;
  href?: string;
  onClick?: () => void;
}

const SEVERITY_BADGE: Record<ProductAttentionRowData['severity'], string> = {
  danger: 'bg-tint-danger text-danger',
  warning: 'bg-tint-warning text-warning',
};

const SEVERITY_TEXT: Record<ProductAttentionRowData['severity'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
};

function ProductAttentionRowBody({ row }: { row: ProductAttentionRowData }) {
  const image = getKnownProductImage(row.name);
  return (
    <>
      <span
        className="w-14 h-14 shrink-0 rounded-xl bg-surface-container-high border border-border-base bg-cover bg-center flex items-center justify-center"
        style={image ? { backgroundImage: `url(${image})` } : undefined}
        role="img"
        aria-label={row.name}
      >
        {!image && <span className="material-symbols-outlined text-text-muted text-[22px]">inventory_2</span>}
      </span>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-[13px] font-bold text-text-primary leading-tight truncate">{row.name}</span>
        <span className="text-[10px] text-text-muted tabular-nums truncate">{row.meta}</span>
        <span className={`self-start text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${SEVERITY_BADGE[row.severity]}`}>
          {row.statusLabel}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={`text-[17px] font-extrabold tabular-nums leading-none ${SEVERITY_TEXT[row.severity]}`}>{row.trailing}</span>
        <span className="text-[9px] font-bold text-text-muted uppercase">{row.trailingUnit}</span>
      </div>
    </>
  );
}

export function ProductAttentionRow({ row }: { row: ProductAttentionRowData }) {
  const className =
    'w-full flex items-center gap-3 p-3 rounded-2xl border border-border-base bg-surface-elevated hover:border-danger/40 transition-colors text-left';
  if (row.href) {
    return (
      <Link href={row.href} className={className}>
        <ProductAttentionRowBody row={row} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={row.onClick} className={className}>
      <ProductAttentionRowBody row={row} />
    </button>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/ProductAttentionRow.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/ProductAttentionRow.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add ProductAttentionRow component with product photos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add an inline progress bar to `LocationCard`

**Files:**
- Modify: `frontend/src/components/stockist/LocationCard.tsx` (full-file rewrite, 39 lines → ~46 lines)
- Modify: `frontend/src/app/admin/stockist/page.tsx` — this task only touches `LocationCard`'s own file; the one call site (`page.tsx:204`) is updated together with the rest of `OwnerCommandCenter` in Task 6, since it sits inside the block Task 6 replaces wholesale. **Do not edit `page.tsx` in this task** — `LocationCard` gains a new *required* prop (`maxValue`), so `page.tsx` will fail to typecheck between this task and Task 6; that's expected and resolved by Task 6 in the same work session.

**Interfaces:**
- Consumes: nothing new.
- Produces: `LocationCardProps` gains a new required field `maxValue: number` (the highest `total_asset_value` across all locations being listed, used to compute this row's progress-bar percentage). This is a **breaking** prop-signature change to the one existing consumer, deliberately — see the note above.

- [ ] **Step 1: Replace the full file**

```tsx
// frontend/src/components/stockist/LocationCard.tsx
'use client';

import { motion } from 'framer-motion';
import { cardHover } from '@/lib/stockist/motion';
import type { AssetLocationSummary } from '@/lib/stockistApi';

export interface LocationCardProps {
  location: AssetLocationSummary;
  onSelect: () => void;
  formatValue: (value: number | null) => string;
  maxValue: number;
}

export function LocationCard({ location, onSelect, formatValue, maxValue }: LocationCardProps) {
  const pct = maxValue > 0 ? Math.max(4, Math.round(((location.total_asset_value ?? 0) / maxValue) * 100)) : 0;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      {...cardHover}
      className="w-full flex flex-col gap-2 p-3 hover:bg-surface-container-high text-left"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-text-muted text-[18px]">
            {location.type === 'warehouse' ? 'warehouse' : 'storefront'}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary truncate">{location.location_name}</div>
            <div className="text-[10px] text-text-muted">
              {location.sku_count} SKU · {location.low_stock_count} perlu perhatian
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-bold text-text-primary tabular-nums">{formatValue(location.total_asset_value)}</div>
          <div className="text-[10px] text-text-muted">{location.total_quantity.toLocaleString('id-ID')} unit</div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div className="h-full rounded-full bg-primary-container" style={{ width: `${pct}%` }} />
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 2: Verify types (expect a pre-existing-caller error until Task 6)**

Run: `cd frontend && npx tsc --noEmit`
Expected: exactly one new error, in `frontend/src/app/admin/stockist/page.tsx`, about `LocationCard` being called without the required `maxValue` prop. This is expected and will be resolved by Task 6, which is part of the same work session before this plan's Task 8 QA pass — do not treat it as a regression to fix here.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/LocationCard.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add value progress bar to LocationCard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rebuild the Owner Home screen in `page.tsx`

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx:7-29` (import block) and `frontend/src/app/admin/stockist/page.tsx:93-248` (from the `toAttentionRows` helper through the end of `OwnerCommandCenter`)

**Interfaces:**
- Consumes: `StatCard` (Task 2, new `icon`/`tint`/`heroTrend`/`heroStats` props), `QuickActionGrid` (Task 3), `ProductAttentionRow`/`ProductAttentionRowData` (Task 4), `LocationCard` (Task 5, new `maxValue` prop) — plus everything already imported today (`ListRow`, `BottomSheet`, `SkeletonCard`, `EmptyState`, `HorizontalBarChart`, `LocationDrillDownContent`, `staggerContainer`/`fadeSlideItem`, `formatCurrency`, `getAssetDashboard`, `listProducts`, and the existing types).
- Produces: unchanged public shape — `StockistDashboard` default export still renders `OwnerCommandCenter` for `role === 'owner'` and the untouched `BranchAdminDashboard` otherwise. The three `BottomSheet`s (location drill-down, full attention list, full transfers list) keep their exact current behavior — only the always-visible page content above them changes.

- [ ] **Step 1: Re-read the file immediately before editing**

Run: `grep -n "OwnerCommandCenter\|BranchAdminDashboard" frontend/src/app/admin/stockist/page.tsx` and re-read lines 1-250 in full — this file has been touched by several commits since 2026-08-19 (most recently for the "Semua Stok" category/brand navigation feature, a different page), so confirm the line ranges below still match before pasting. If they've shifted, adjust the line numbers, not the code content.

- [ ] **Step 2: Update the import block (current lines 7-29)**

Replace the import block:

```tsx
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getAssetDashboard,
  getServiceUsage,
  type InventoryBalance,
  type StockTransfer,
  type StockistAssetDashboard,
  type AssetLocationSummary,
  type ServiceUsage
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { LocationCard } from '@/components/stockist/LocationCard';
import { ListRow, type ListRowData } from '@/components/stockist/ListRow';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';
import { HorizontalBarChart } from '@/components/stockist/HorizontalBarChart';
import { LocationDrillDownContent } from '@/components/stockist/LocationDrillDownContent';
import { staggerContainer, fadeSlideItem } from '@/lib/stockist/motion';
import { formatCurrency } from '@/lib/stockist/format';
import { getKnownProductImage } from '@/lib/stockist/productImage';
```

with:

```tsx
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getAssetDashboard,
  getServiceUsage,
  type InventoryBalance,
  type StockTransfer,
  type StockistAssetDashboard,
  type AssetLocationSummary,
  type ServiceUsage
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { LocationCard } from '@/components/stockist/LocationCard';
import { ListRow, type ListRowData } from '@/components/stockist/ListRow';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';
import { HorizontalBarChart } from '@/components/stockist/HorizontalBarChart';
import { LocationDrillDownContent } from '@/components/stockist/LocationDrillDownContent';
import { QuickActionGrid } from '@/components/stockist/QuickActionGrid';
import { ProductAttentionRow, type ProductAttentionRowData } from '@/components/stockist/ProductAttentionRow';
import { staggerContainer, fadeSlideItem } from '@/lib/stockist/motion';
import { formatCurrency } from '@/lib/stockist/format';
import { getKnownProductImage } from '@/lib/stockist/productImage';
```

(Only two new lines added: the `QuickActionGrid` and `ProductAttentionRow` imports. `getKnownProductImage` stays — it's still used by `BranchAdminDashboard` further down the file, untouched by this plan.)

- [ ] **Step 3: Replace `toAttentionRows` through the end of `OwnerCommandCenter` (current lines 93-248)**

Replace everything from:

```tsx
// Compact adapter for the 2-up KPI grid cards, where full-notation IDR risks
// overflowing the card's ~106-161px content box at the app's 430px width cap.
function toAttentionRows(items: StockistAssetDashboard['attention_items']): ListRowData[] {
```

through the closing `}` of `OwnerCommandCenter` (the line right before `// ---... Branch admin: Beranda (unchanged from prior behavior) ...---`), with:

```tsx
function toAttentionRows(items: StockistAssetDashboard['attention_items']): ListRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    href: '/admin/stockist/products',
    icon: item.reason === 'OUT_OF_STOCK' ? 'error' : 'inventory_2',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    title: item.product_name,
    subtitle: item.location_name,
    trailing: item.reason === 'OUT_OF_STOCK' ? 'Habis' : `${item.quantity} tersisa`,
  }));
}

function toProductAttentionRows(items: StockistAssetDashboard['attention_items']): ProductAttentionRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    name: item.product_name,
    meta: item.location_name,
    statusLabel: item.reason === 'OUT_OF_STOCK' ? 'Habis' : 'Menipis',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    trailing: String(item.quantity),
    trailingUnit: 'pcs',
    href: '/admin/stockist/products',
  }));
}

function toTransferRows(transfers: StockTransfer[]): ListRowData[] {
  return transfers.map((t) => ({
    key: t.id,
    href: `/admin/stockist/transfers/${t.id}`,
    icon: 'local_shipping',
    severity: 'neutral',
    title: t.transfer_number,
    subtitle: `${t.source_name ?? t.source_location_id} → ${t.destination_name ?? t.destination_location_id}`,
    trailing: t.status === 'SENT' ? 'Dikirim' : 'Diterima',
  }));
}

function OwnerCommandCenter({ user }: { user: AppUser }) {
  const [assets, setAssets] = useState<StockistAssetDashboard | null>(null);
  const [activeProductCount, setActiveProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getAssetDashboard(), listProducts()])
      .then(([assetData, productData]) => {
        setAssets(assetData);
        setActiveProductCount(productData.products.filter((product) => product.is_active).length);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat command center');
      })
      .finally(() => setLoading(false));
  }, []);

  const totalStockUnits = assets ? assets.asset_by_location.reduce((sum, l) => sum + l.total_quantity, 0) : 0;
  const maxLocationValue = assets ? Math.max(0, ...assets.asset_by_location.map((l) => l.total_asset_value ?? 0)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="text-[22px] font-bold text-text-primary leading-tight font-display">
          {getGreeting()}, {user.name}
        </h2>
        <div className="flex items-center gap-3 text-text-muted text-[12px] font-medium font-body-secondary">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">apartment</span>
            Dashboard Aset Stok · Semua lokasi
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </section>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <SkeletonCard className="min-h-[120px]" />
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonCard className="min-h-[220px]" />
        </div>
      ) : assets ? (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="flex flex-col gap-6">
          <motion.div variants={fadeSlideItem}>
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

          <motion.div variants={fadeSlideItem} className="grid grid-cols-2 gap-3">
            <StatCard label="Total Produk" value={activeProductCount} icon="category" tint="info" hint="SKU aktif" />
            <StatCard label="Total Stok" value={totalStockUnits} icon="inventory_2" tint="success" hint="unit di semua lokasi" />
            <StatCard
              label="Produk Menipis"
              value={assets.attention_items.length}
              icon="warning"
              tint="warning"
              hint="perlu restock"
              onClick={() => setDrillDown({ type: 'attention' })}
            />
            <StatCard
              label="Transfer Berjalan"
              value={assets.active_transfers.length}
              icon="local_shipping"
              tint="danger"
              hint="belum diterima"
              onClick={() => setDrillDown({ type: 'transfers' })}
            />
          </motion.div>

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <h3 className="text-[13px] font-bold text-text-primary px-1">Aksi cepat</h3>
            <QuickActionGrid
              actions={[
                { key: 'receive', href: '/admin/stockist/warehouse', icon: 'move_to_inbox', label: 'Terima Barang' },
                { key: 'transfer', href: '/admin/stockist/transfers/new', icon: 'send', label: 'Buat Transfer' },
                { key: 'ledger', href: '/admin/stockist/ledger', icon: 'receipt_long', label: 'Lihat Ledger' },
                { key: 'branch-stock', href: '/admin/stockist/branch-stock', icon: 'storefront', label: 'Stok Cabang' },
              ]}
            />
          </motion.section>

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-[13px] font-bold text-text-primary">Perlu perhatian</h3>
              {assets.attention_items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDrillDown({ type: 'attention' })}
                  className="text-[11px] font-semibold text-primary-container"
                >
                  Lihat semua
                </button>
              )}
            </div>
            {assets.attention_items.length === 0 ? (
              <EmptyState icon="check_circle" title="Semua terkendali" subtitle="Tidak ada yang perlu ditindaklanjuti sekarang." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {toProductAttentionRows(assets.attention_items.slice(0, 3)).map((row) => (
                  <ProductAttentionRow key={row.key} row={row} />
                ))}
              </div>
            )}
          </motion.section>

          {assets.asset_by_location.length > 0 ? (
            <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[13px] font-bold text-text-primary">Aset per lokasi</h3>
                <span className="text-[10px] text-text-muted">{assets.asset_by_location.length} lokasi</span>
              </div>
              <div className="bg-surface-elevated border border-border-base rounded-xl p-3">
                <HorizontalBarChart
                  data={assets.asset_by_location.map((location) => ({ name: location.location_name, value: location.total_asset_value ?? 0 }))}
                />
                <div className="mt-3 border-t border-border-base pt-1 divide-y divide-border-base">
                  {assets.asset_by_location.map((location) => (
                    <LocationCard
                      key={location.location_id}
                      location={location}
                      formatValue={formatCurrency}
                      maxValue={maxLocationValue}
                      onSelect={() => setDrillDown({ type: 'location', location })}
                    />
                  ))}
                </div>
              </div>
            </motion.section>
          ) : null}
        </motion.div>
      ) : null}

      <BottomSheet
        open={drillDown?.type === 'location'}
        onClose={() => setDrillDown(null)}
        title={drillDown?.type === 'location' ? drillDown.location.location_name : ''}
      >
        {drillDown?.type === 'location' && (
          <LocationDrillDownContent locationId={drillDown.location.location_id} locationName={drillDown.location.location_name} />
        )}
      </BottomSheet>

      <BottomSheet open={drillDown?.type === 'attention'} onClose={() => setDrillDown(null)} title="Barang Perlu Perhatian">
        {assets && assets.attention_items.length > 0 ? (
          <div className="flex flex-col divide-y divide-border-base -m-4">
            {toAttentionRows(assets.attention_items).map((row) => (
              <ListRow key={row.key} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check_circle" title="Semua terkendali" subtitle="Tidak ada yang perlu ditindaklanjuti sekarang." />
        )}
      </BottomSheet>

      <BottomSheet open={drillDown?.type === 'transfers'} onClose={() => setDrillDown(null)} title="Transfer Berjalan">
        {assets && assets.active_transfers.length > 0 ? (
          <div className="flex flex-col divide-y divide-border-base -m-4">
            {toTransferRows(assets.active_transfers).map((row) => (
              <ListRow key={row.key} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check_circle" title="Belum ada transfer berjalan" subtitle="Semua transfer sudah selesai." />
        )}
      </BottomSheet>
    </div>
  );
}
```

Everything from `// ---... Branch admin: Beranda (unchanged from prior behavior) ...---` onward stays exactly as it is today — do not touch it.

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. The `LocationCard` `maxValue` error from Task 5 should now be gone (it's passed at line with `maxValue={maxLocationValue}`). Confirm no leftover reference to a removed identifier — there shouldn't be any, since this task is a pure addition on top of the current shipped code.

- [ ] **Step 5: Verify lint**

Run: `cd frontend && npm run lint`
Expected: no new errors in `page.tsx` or the four component files touched/added in Tasks 2-5.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): align Owner Home with the Claude Design mockup

Adds the red-gradient hero card with location/SKU/unit mini-stats, tinted
2x2 KPI tiles, an "Aksi cepat" quick-action grid, a product-photo "Perlu
perhatian" preview list, and per-location progress bars — matching the
imported Claude Design mockup while keeping every existing data source,
drill-down sheet, and BranchAdminDashboard behavior unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Restyle the login page to match the mockup's logo treatment

**Files:**
- Modify: `frontend/src/app/admin/stockist/login/page.tsx` (full-file rewrite of the JSX portion, lines 68-152; `handleSubmit`/state/effects at lines 1-66 are untouched — this is a visual-only change)

**Interfaces:**
- Consumes: nothing new. No prop/type/API changes — same `useState`, `useUser`, `supabase.auth.signInWithPassword`, `resolveStockistRole`, `sessionStorage`/`window.dispatchEvent` flow as today.
- Produces: same component, same behavior, different JSX/classes only.

- [ ] **Step 1: Replace the JSX return block (current lines 68-152)**

Replace:

```tsx
  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden bg-surface-container-lowest text-text-primary max-w-[430px] mx-auto border-x border-border-base shadow-[0_4px_24px_rgba(0,0,0,0.6)]">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary-container/10 via-transparent to-transparent"></div>
      
      <div className="w-full relative z-10 flex flex-col gap-6 p-6 rounded-2xl bg-surface-elevated border border-border-base shadow-lg">
        {/* Header */}
        <div className="text-center flex flex-col gap-1">
          <div className="relative mx-auto h-[68px] w-[68px]">
            <Image src="/Brand_assets/logo_transparant.png" alt="RedBox" fill priority className="object-contain" sizes="68px" />
          </div>
          <div className="relative mx-auto mt-3 h-[42px] w-full max-w-[320px]">
            <Image src="/Brand_assets/logo_font.png" alt="RedBox Barbershop" fill priority className="object-contain" sizes="320px" />
          </div>
          <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-text-primary">Selamat datang kembali</h1>
          <p className="mt-1 text-[11px] text-text-muted">Masuk untuk melanjutkan ke Stockist RedBox.</p>
        </div>
```

with:

```tsx
  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden bg-surface-container-lowest text-text-primary max-w-[430px] mx-auto border-x border-border-base shadow-[0_4px_24px_rgba(0,0,0,0.6)]">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary-container/10 via-transparent to-transparent"></div>

      <div className="w-full relative z-10 flex flex-col gap-6 p-6 rounded-2xl bg-surface-elevated border border-border-base shadow-lg">
        {/* Header */}
        <div className="text-center flex flex-col gap-1">
          <div className="relative mx-auto h-[84px] w-[84px] rounded-[22px] bg-[#171514] shadow-[0_10px_24px_rgba(23,21,20,0.28)] flex items-center justify-center p-3.5 box-border">
            <Image src="/Brand_assets/logo_transparant.png" alt="RedBox" fill priority className="object-contain p-3.5" sizes="84px" />
          </div>
          <div className="relative mx-auto mt-4 h-[42px] w-full max-w-[320px]">
            <Image src="/Brand_assets/logo_font.png" alt="RedBox Barbershop" fill priority className="object-contain" sizes="320px" />
          </div>
          <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-text-primary">Selamat datang kembali</h1>
          <p className="mt-1 text-[11px] text-text-muted">Masuk untuk melanjutkan ke Stockist RedBox.</p>
        </div>
```

(The dark rounded-square icon badge — `84px`, `rounded-[22px]`, `bg-[#171514]` — reproduces the mockup's login logo treatment (`RedBox Stockist.dc.html` line 64: `width:92px;height:92px;border-radius:26px;background:#171514`, scaled down slightly to fit this card's tighter padding). `#171514` is the mockup's own literal value for this one element — it doesn't correspond to any existing token, and introducing a `--color-logo-badge` token for a single one-off use isn't warranted; leave it as a scoped hardcoded value here, consistent with how the mockup itself defines it as a one-off outside its token system.)

- [ ] **Step 2: Replace the two hardcoded input background colors and the button's hardcoded border**

Replace (email input, current line 104):

```tsx
                className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
```

with:

```tsx
                className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
```

Replace (password input, current line 120):

```tsx
                className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
```

with:

```tsx
                className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
```

Replace (submit button, current line 139):

```tsx
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728] mt-2"
```

with:

```tsx
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-border-base mt-2"
```

(`bg-surface-container-lowest` is `#100e0e`, already defined and mapped — visually near-identical to the removed `#171415` literal, distinct enough from the card's `bg-surface-elevated` background to keep the inputs legible. `border-border-base` is `#302728`, the exact value the removed literal already had — pure token cleanup, zero visual change on the button.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `app/admin/stockist/login/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/login/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): match login logo treatment to the mockup, drop hardcoded hex

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Manual QA pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm install` (if `node_modules` isn't present yet) then `cd frontend && npm run dev`

- [ ] **Step 2: Verify the login screen**

Navigate to `/admin/stockist/login`. Confirm: dark rounded-square badge around the icon mark, wordmark below it, real email/password inputs still work (type into them), submit still authenticates (test with a real owner or branch_admin account), error banner still renders on wrong credentials, show/hide password toggle still works.

- [ ] **Step 3: Verify the Owner Home hero + KPI grid**

Log in as an owner (`adhit24@gmail.com` or another `STOCKIST_OWNER_EMAILS` account). Confirm: hero card renders with a red gradient background (not the old flat surface color), white text, animated count-up on the asset value, and the three mini-stat boxes (Lokasi/SKU aktif/Unit) below it. Confirm no fake trend badge appears (there's no real trend data — the badge should be entirely absent, not a fabricated placeholder). Confirm the 2x2 grid below shows four tinted tiles (blue/green/yellow/red backgrounds) each with a leading icon.

- [ ] **Step 4: Verify "Aksi cepat"**

Confirm all four quick-action buttons are present (Terima Barang, Buat Transfer, Lihat Ledger, Stok Cabang) and each navigates to the correct page: `/admin/stockist/warehouse`, `/admin/stockist/transfers/new`, `/admin/stockist/ledger`, `/admin/stockist/branch-stock`.

- [ ] **Step 5: Verify "Perlu perhatian"**

Confirm up to 3 product rows render with a rounded thumbnail (real photo if the product name matches `getKnownProductImage`'s known SKUs — e.g. anything with "clay"/"pomade"/"oil"/"water"/"spray"/"shave"/"cream" in the name — otherwise a neutral `inventory_2` icon placeholder, never a wrong/fake photo), a status pill reading "Habis" or "Menipis", and a quantity. If there are more than 3 attention items, confirm "Lihat semua" opens the existing full-list bottom sheet unchanged from before this plan.

- [ ] **Step 6: Verify "Aset per lokasi"**

Confirm the bar chart still renders above the location list (unchanged from before), and each `LocationCard` row now shows a thin progress bar beneath it, proportional to that location's share of the highest-value location. Click a row → drill-down sheet still opens with the per-SKU breakdown (unchanged from before), including the second-open-is-cached behavior.

- [ ] **Step 7: Verify responsive layout**

Using browser devtools device toolbar, check 320px, 360px, 390px, 430px, 768px, and 1280px+: no horizontal scroll, KPI grid stays 2 columns, quick-action grid stays 2 columns, hero mini-stats row doesn't overflow or wrap awkwardly at 320px (shrink text if it does — this is a visual nit to fix inline during QA, not a separate task).

- [ ] **Step 8: Verify `BranchAdminDashboard` and role gating are unaffected**

Log in as a `branch_admin` user and confirm `/admin/stockist` still renders the existing branch dashboard exactly as before this plan (low stock alert card, stats grid, quick actions, usage panel) — none of that JSX was touched. Confirm a user who is neither owner nor branch_admin is still redirected to `/admin/stockist/login` (this plan never touched `layout.tsx`'s guard logic).

- [ ] **Step 9: Stop the dev server**

Kill the `npm run dev` process once QA is complete.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as a follow-up commit against the relevant task's file before considering this plan done.

---

## What this plan deliberately does not cover

This is Plan 1 of the full 19-screen mockup (`RedBox Stockist.dc.html` screens: `isLogin`, `isOwnerHome`, `isBranchHome`, `isStokHub`, `isList`, `isProductDetail`, `isOwner`, `isReceive`, `isSuccess`, `isTransfers`, `isTransferNew`, `isTransferDetail`, `isConfirm`, `isLedger`, `isOpname`, `isDocs`, `isNotif`, `isProfile`, `isScan`, `isStates`). Per the written brief's phased rollout and the writing-plans scope-check guidance, the remaining screens — starting with `BranchAdminDashboard` (the mockup's `isBranchHome`), then Products/Warehouse/Transfers/Ledger, then the empty/loading/error/offline states gallery — each get their own follow-up plan once this one is reviewed and approved, reusing the token/component foundation this plan establishes (`StatCard`, `ListRow`, `LocationCard`, `BottomSheet`, `QuickActionGrid`, `ProductAttentionRow`, the tint/accent-soft/display-font tokens) rather than re-deriving them.
