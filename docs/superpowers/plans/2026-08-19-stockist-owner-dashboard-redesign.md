# Stockist Owner Dashboard Redesign (Phase 1 + 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Stockist Owner Dashboard a premium, motion-aware, drill-downable redesign, backed by a small reusable component set and formal motion/design tokens — the benchmark for later Stockist redesign phases.

**Architecture:** Pure frontend change. New presentational components live in `frontend/src/components/stockist/`; a new motion-constants module lives in `frontend/src/lib/stockist/motion.ts`; `globals.css` gains motion duration/easing tokens and two keyframes. `OwnerCommandCenter` in `frontend/src/app/admin/stockist/page.tsx` is rebuilt on top of these, still sourced entirely from the existing `getAssetDashboard()` payload plus (for the location drill-down only) the existing `listProducts()`/`getInventorySummary()` calls. No API, schema, or route changes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (CSS-first `@theme`), `framer-motion` v12 (already a dependency), `recharts` v3 (already a dependency, not yet used anywhere in Stockist).

**Spec:** `docs/superpowers/specs/2026-08-19-stockist-owner-dashboard-redesign-design.md`

## Global Constraints

- No API contract, database schema, or route changes (spec §Overview, source doc section 46).
- No new npm dependencies — `framer-motion` and `recharts` already exist in `frontend/package.json`.
- No fabricated/dummy data: skip anything the current API doesn't provide (per-product value chart, historical trend chart, period-over-period delta) rather than fake it (spec §Overview reframing).
- `BranchAdminDashboard` in the same file, and the owner/branch_admin role gate in `layout.tsx`, are **not touched**.
- Animate only `transform`/`opacity` (source doc section 43) — no animating `width`/`height`/`top`/`left`.
- **No frontend test framework exists in this repo** (`frontend/package.json` has no test runner). Do not add one as part of this plan — that's a separate decision. Verification per task is `npx tsc --noEmit` (run from `frontend/`) for type safety, plus a final manual QA pass against a running dev server (Task 13). This replaces the usual write-test-first loop for this plan only.
- All UI copy is Indonesian, matching the existing Stockist pages.
- Colors/spacing/radius reuse existing Tailwind utility classes and CSS custom properties already defined in `globals.css` (`bg-surface-elevated`, `border-border-base`, `text-danger`, `rounded-xl`, etc.) — no new color tokens.

---

### Task 1: Motion & keyframe design tokens

**Files:**
- Modify: `frontend/src/app/globals.css:20` (end of `:root` brand tokens) and `frontend/src/app/globals.css:122` (end of file, after the existing `.animate-shimmer` block)

**Interfaces:**
- Produces: CSS custom properties `--motion-micro`, `--motion-card`, `--motion-content`, `--motion-sheet`, `--motion-ease` (consumed conceptually by Task 2's JS mirror — CSS vars aren't readable by framer-motion directly, so Task 2 defines matching JS constants); keyframes `fade-slide-in` and `sheet-slide-up` plus utility classes `.animate-fade-slide-in` and `.animate-sheet-slide-up` (available for any plain-CSS use, though Tasks 4-11 mostly use framer-motion directly).

- [ ] **Step 1: Add motion custom properties to `:root`**

In `frontend/src/app/globals.css`, after line 20 (`--rb-text-faint: #4A3E40;`) and before the blank line that precedes `/* Stitch custom theme tokens */`, insert:

```css

 /* Motion tokens */
 --motion-micro: 150ms;
 --motion-card: 200ms;
 --motion-content: 260ms;
 --motion-sheet: 250ms;
 --motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
```

- [ ] **Step 2: Add keyframes and utility classes at the end of the file**

After the existing block:

```css
.animate-shimmer {
  background: linear-gradient(90deg, rgba(30, 41, 59, 0.4) 25%, rgba(51, 65, 85, 0.6) 50%, rgba(30, 41, 59, 0.4) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite linear;
}
```

append:

```css

@keyframes fade-slide-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-slide-in {
  animation: fade-slide-in var(--motion-content) var(--motion-ease) both;
}

@keyframes sheet-slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.animate-sheet-slide-up {
  animation: sheet-slide-up var(--motion-sheet) var(--motion-ease) both;
}
```

- [ ] **Step 3: Verify the file is valid CSS**

Run: `cd frontend && npm run build`
Expected: build succeeds (Next.js will fail the build on invalid CSS syntax). Stop the build once the compile step passes — no need to wait for a full production build if `npm run dev` is faster to eyeball; either confirms CSS parses.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(stockist): add motion duration and keyframe design tokens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Motion constants module

**Files:**
- Create: `frontend/src/lib/stockist/motion.ts`

**Interfaces:**
- Consumes: nothing (mirrors the durations from Task 1's CSS tokens as JS numbers, since framer-motion transitions need numeric seconds, not CSS custom properties).
- Produces: `MOTION` (object with `micro`/`card`/`content`/`sheet` numbers in seconds), `EASE_OUT` (cubic-bezier array), `staggerContainer` and `fadeSlideItem` (framer-motion `Variants`), `cardHover` (object of `whileHover`/`whileTap` props to spread onto a `motion.*` element), `sheetBackdrop` and `sheetPanel` (framer-motion `Variants`). Consumed by Tasks 4, 6 (indirectly via StatCard), 8, 9, 10, 12.

- [ ] **Step 1: Write the module**

```ts
// frontend/src/lib/stockist/motion.ts
import type { Variants } from 'framer-motion';

export const MOTION = {
  micro: 0.15,
  card: 0.2,
  content: 0.26,
  sheet: 0.25,
} as const;

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

export const fadeSlideItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.content, ease: EASE_OUT } },
};

export const cardHover = {
  whileHover: { y: -2, transition: { duration: MOTION.card, ease: EASE_OUT } },
  whileTap: { scale: 0.98, transition: { duration: MOTION.micro, ease: EASE_OUT } },
};

export const sheetBackdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
};

export const sheetPanel: Variants = {
  hidden: { y: '100%' },
  show: { y: 0, transition: { duration: MOTION.sheet, ease: EASE_OUT } },
  exit: { y: '100%', transition: { duration: MOTION.sheet, ease: EASE_OUT } },
};
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `lib/stockist/motion.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/stockist/motion.ts
git commit -m "$(cat <<'EOF'
feat(stockist): add shared motion constants and variants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `AnimatedNumber` component

**Files:**
- Create: `frontend/src/components/stockist/AnimatedNumber.tsx`

**Interfaces:**
- Consumes: `framer-motion`'s `animate`/`useMotionValue` directly (no dependency on Task 2's module).
- Produces: `AnimatedNumber` component with props `{ value: number; formatter?: (n: number) => string; className?: string }`. Consumed by Task 4 (`StatCard`).

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/AnimatedNumber.tsx
'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'framer-motion';

export interface AnimatedNumberProps {
  value: number;
  formatter?: (n: number) => string;
  className?: string;
}

const defaultFormatter = (n: number) => Math.round(n).toLocaleString('id-ID');

export function AnimatedNumber({ value, formatter = defaultFormatter, className }: AnimatedNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        if (spanRef.current) {
          spanRef.current.textContent = formatter(latest);
        }
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, formatter]);

  return (
    <span ref={spanRef} className={className}>
      {formatter(0)}
    </span>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/AnimatedNumber.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/AnimatedNumber.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add AnimatedNumber count-up component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `StatCard` component

**Files:**
- Create: `frontend/src/components/stockist/StatCard.tsx`

**Interfaces:**
- Consumes: `AnimatedNumber` (Task 3), `cardHover` from `@/lib/stockist/motion` (Task 2).
- Produces: `StatCard` component, props `StatCardProps { label: string; value: number; formatter?: (n: number) => string; hint?: string; variant?: 'default' | 'hero' | 'danger'; href?: string; onClick?: () => void; trailingBadge?: string }`. Renders as a `Link` when `href` is set, otherwise a `<button>` (disabled/non-interactive look when neither `href` nor `onClick` is given). Consumed by Task 12 (`page.tsx`).

- [ ] **Step 1: Write the component**

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
}

function StatCardBody({ label, value, formatter, hint, variant = 'default', trailingBadge }: Omit<StatCardProps, 'href' | 'onClick'>) {
  const isHero = variant === 'hero';
  const isDanger = variant === 'danger';
  return (
    <>
      <span className={`text-[11px] font-semibold ${isDanger ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
      <div
        className={`font-display tabular-nums mt-2 flex items-baseline gap-2 ${
          isHero ? 'text-[30px] font-bold' : 'text-[19px] font-bold'
        } ${isDanger ? 'text-danger' : 'text-text-primary'}`}
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
  const { href, onClick, variant = 'default' } = props;
  const isDanger = variant === 'danger';
  const isHero = variant === 'hero';
  const className = `flex flex-col text-left bg-surface-elevated border rounded-xl min-h-[92px] w-full ${
    isHero ? 'p-5' : 'p-4'
  } ${isDanger ? 'border-danger/30' : 'border-border-base'}`;

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

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/StatCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/StatCard.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add StatCard KPI component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `SkeletonCard` and `EmptyState` components

**Files:**
- Create: `frontend/src/components/stockist/SkeletonCard.tsx`
- Create: `frontend/src/components/stockist/EmptyState.tsx`

**Interfaces:**
- Consumes: nothing beyond Tailwind's built-in `animate-pulse`.
- Produces: `SkeletonCard` (props `{ className?: string }`) and `EmptyState` (props `EmptyStateProps { icon: string; title: string; subtitle: string }`). Both consumed by Task 12 (`page.tsx`).

- [ ] **Step 1: Write `SkeletonCard`**

```tsx
// frontend/src/components/stockist/SkeletonCard.tsx
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-surface-elevated border border-border-base rounded-xl p-4 min-h-[92px] animate-pulse flex flex-col gap-3 ${className}`}>
      <div className="h-3 w-2/3 bg-surface-container-high rounded" />
      <div className="h-6 w-1/2 bg-surface-container-high rounded" />
    </div>
  );
}
```

- [ ] **Step 2: Write `EmptyState`**

```tsx
// frontend/src/components/stockist/EmptyState.tsx
export interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle: string;
}

export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3">
      <span className="material-symbols-outlined text-success text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        <span className="text-[11px] text-text-muted">{subtitle}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing either new file.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/SkeletonCard.tsx frontend/src/components/stockist/EmptyState.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add SkeletonCard and EmptyState components

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `HorizontalBarChart` component

**Files:**
- Create: `frontend/src/components/stockist/HorizontalBarChart.tsx`

**Interfaces:**
- Consumes: `recharts` (`BarChart`, `Bar`, `XAxis`, `YAxis`, `Cell`, `ResponsiveContainer`, `Tooltip`) — already in `package.json`, first use in Stockist.
- Produces: `HorizontalBarChart` component, props `{ data: HorizontalBarChartDatum[] }` where `HorizontalBarChartDatum = { name: string; value: number }`. Consumed by Task 12 (`page.tsx`) for "Nilai Stok per Lokasi".

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/HorizontalBarChart.tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export interface HorizontalBarChartDatum {
  name: string;
  value: number;
}

const formatCurrencyCompact = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    notation: 'compact',
  }).format(value);

export function HorizontalBarChart({ data }: { data: HorizontalBarChartDatum[] }) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={92} tick={{ fill: '#B8AAAC', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number) => formatCurrencyCompact(value)}
            contentStyle={{ background: '#211B1C', border: '1px solid #302728', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#F5EEEE' }}
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

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/HorizontalBarChart.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/HorizontalBarChart.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add HorizontalBarChart component using recharts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `BottomSheet` component

**Files:**
- Create: `frontend/src/components/stockist/BottomSheet.tsx`

**Interfaces:**
- Consumes: `sheetBackdrop`, `sheetPanel` from `@/lib/stockist/motion` (Task 2).
- Produces: `BottomSheet` component, props `BottomSheetProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode }`. Renders nothing when `open` is false (children unmount on close, so any lazy-fetching child re-fetches per mount unless it has its own cache — see Task 11). Consumed by Task 12 (`page.tsx`).

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/BottomSheet.tsx
'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sheetBackdrop, sheetPanel } from '@/lib/stockist/motion';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
          variants={sheetBackdrop}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="w-full sm:max-w-[420px] sm:rounded-2xl rounded-t-2xl bg-surface-elevated border border-border-base max-h-[80vh] overflow-y-auto"
            variants={sheetPanel}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-base sticky top-0 bg-surface-elevated">
              <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
              <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Tutup">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/BottomSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/BottomSheet.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add BottomSheet drill-down container

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `LocationCard` component

**Files:**
- Create: `frontend/src/components/stockist/LocationCard.tsx`

**Interfaces:**
- Consumes: `cardHover` from `@/lib/stockist/motion` (Task 2), `AssetLocationSummary` type from `@/lib/stockistApi` (already exists: `{ location_id, location_name, type: 'warehouse' | 'branch', total_quantity, total_asset_value, sku_count, low_stock_count }`).
- Produces: `LocationCard` component, props `LocationCardProps { location: AssetLocationSummary; onSelect: () => void; formatValue: (value: number | null) => string }`. Consumed by Task 12 (`page.tsx`).

- [ ] **Step 1: Write the component**

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
}

export function LocationCard({ location, onSelect, formatValue }: LocationCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      {...cardHover}
      className="w-full flex items-center justify-between gap-3 p-3 hover:bg-surface-container-high text-left"
    >
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
    </motion.button>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/LocationCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/LocationCard.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add LocationCard component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `ListRow` component

**Files:**
- Create: `frontend/src/components/stockist/ListRow.tsx`

**Interfaces:**
- Consumes: nothing beyond `next/link`. This extracts the exact existing row markup from `page.tsx`'s current `AttentionPanel` (see current `frontend/src/app/admin/stockist/page.tsx:266-288`) so the visual result for the always-visible attention list is unchanged — only its container changes in Task 12.
- Produces: `ListRow` component and `ListRowData` type: `{ key: string; href?: string; onClick?: () => void; icon: string; severity: 'danger' | 'warning' | 'neutral'; title: string; subtitle: string; trailing?: string }`. Renders as a `Link` when `href` is set, otherwise a `<button>`. Consumed by Task 12 (`page.tsx`) for both the always-visible attention preview and the drill-down sheets (attention full list, transfers list).

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/ListRow.tsx
'use client';

import Link from 'next/link';

export interface ListRowData {
  key: string;
  href?: string;
  onClick?: () => void;
  icon: string;
  severity: 'danger' | 'warning' | 'neutral';
  title: string;
  subtitle: string;
  trailing?: string;
}

const severityIconClasses: Record<ListRowData['severity'], string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-surface-container-high text-text-muted',
};

const severityTrailingClasses: Record<ListRowData['severity'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  neutral: 'text-text-primary',
};

function ListRowBody({ row }: { row: ListRowData }) {
  return (
    <>
      <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${severityIconClasses[row.severity]}`}>
        <span className="material-symbols-outlined text-[18px]">{row.icon}</span>
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-semibold text-text-primary leading-tight truncate">{row.title}</span>
        <span className="text-[11px] text-text-muted mt-0.5 truncate">{row.subtitle}</span>
      </div>
      {row.trailing && (
        <span className={`text-[13px] font-bold tabular-nums shrink-0 ${severityTrailingClasses[row.severity]}`}>{row.trailing}</span>
      )}
      <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
    </>
  );
}

export function ListRow({ row }: { row: ListRowData }) {
  const className = 'flex items-center gap-3 p-3 hover:bg-surface-container-high active:bg-surface-container transition-colors';
  if (row.href) {
    return (
      <Link href={row.href} className={className}>
        <ListRowBody row={row} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={row.onClick} className={`${className} w-full text-left`}>
      <ListRowBody row={row} />
    </button>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/ListRow.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/ListRow.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add ListRow component for alert/transfer lists

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `LocationDrillDownContent` component

**Files:**
- Create: `frontend/src/components/stockist/LocationDrillDownContent.tsx`

**Interfaces:**
- Consumes: `listProducts()`, `getInventorySummary(location)` from `@/lib/stockistApi` (both already exist, already used by `BranchAdminDashboard`).
- Produces: `LocationDrillDownContent` component, props `{ locationId: string; locationName: string }`. Renders inside a `BottomSheet` (Task 7). Maintains a module-scoped `Map<string, SkuRow[]>` cache keyed by `locationId` so reopening the same location's sheet doesn't re-fetch (per spec §Regression Risks). Consumed by Task 12 (`page.tsx`).

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/LocationDrillDownContent.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listProducts, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export interface LocationDrillDownContentProps {
  locationId: string;
  locationName: string;
}

interface SkuRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
}

const cache = new Map<string, SkuRow[]>();

export function LocationDrillDownContent({ locationId, locationName }: LocationDrillDownContentProps) {
  const [rows, setRows] = useState<SkuRow[] | null>(cache.get(locationId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache.has(locationId)) {
      setRows(cache.get(locationId)!);
      return;
    }
    let cancelled = false;
    setRows(null);
    setError(null);
    Promise.all([listProducts(), getInventorySummary(locationId)])
      .then(([{ products }, { balances }]) => {
        if (cancelled) return;
        const productById = new Map<string, StockistProduct>(products.map((p) => [p.id, p]));
        const merged: SkuRow[] = balances
          .filter((b: InventoryBalance) => b.quantity > 0)
          .map((b: InventoryBalance) => {
            const product = productById.get(b.product_id);
            return {
              productId: b.product_id,
              name: product?.name ?? 'Produk tidak dikenal',
              sku: product?.sku ?? '-',
              quantity: b.quantity,
            };
          })
          .sort((a, b) => b.quantity - a.quantity);
        cache.set(locationId, merged);
        setRows(merged);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat rincian lokasi');
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-danger text-[12px]">{error}</p>}
      {!rows && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-text-muted text-[12px]">Tidak ada stok aktif di lokasi ini.</p>}
      {rows && rows.length > 0 && (
        <div className="flex flex-col divide-y divide-border-base">
          {rows.slice(0, 8).map((row) => (
            <div key={row.productId} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] text-text-primary truncate">{row.name}</span>
                <span className="text-[10px] text-text-muted font-mono">{row.sku}</span>
              </div>
              <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{row.quantity} pcs</span>
            </div>
          ))}
        </div>
      )}
      <Link
        href={`/admin/stockist/branch-stock?location=${locationId}`}
        className="mt-1 text-center text-[12px] font-semibold text-primary-container hover:underline"
      >
        Lihat semua stok di {locationName}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `components/stockist/LocationDrillDownContent.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/LocationDrillDownContent.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add per-location SKU drill-down content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rebuild `OwnerCommandCenter` in `page.tsx`

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx:1-364` (everything from the top import block through the end of the current `TopRequestedPanel` function — i.e. up to, but not including, the `// Branch admin: Beranda (unchanged from prior behavior)` comment header that precedes `BranchAdminDashboard`)

**Interfaces:**
- Consumes: `StatCard` (Task 4), `SkeletonCard`/`EmptyState` (Task 5), `HorizontalBarChart` (Task 6), `BottomSheet` (Task 7), `LocationCard` (Task 8), `ListRow`/`ListRowData` (Task 9), `LocationDrillDownContent` (Task 10), `staggerContainer`/`fadeSlideItem` (Task 2), plus existing `getAssetDashboard`, `StockistAssetDashboard`, `AssetLocationSummary`, `StockTransfer`, `listProducts`, `getInventorySummary`, `listTransfers`, `InventoryBalance` from `@/lib/stockistApi`.
- Produces: unchanged public shape — `StockistDashboard` default export still renders `OwnerCommandCenter` for `role === 'owner'` and `BranchAdminDashboard` (untouched, below this range) otherwise.

This task removes the currently-dead `AttentionRow` type, `AttentionPanel`, `LocationSnapshot`, and `TopRequestedPanel` functions (defined in the file today but never called — `OwnerCommandCenter` only renders `AssetDashboardPanel`) since they're being fully superseded, and drops the now-unused `DashboardOverview` type import.

- [ ] **Step 1: Confirm the dead code assumption before deleting anything**

Run: `cd frontend && npx tsc --noEmit` (baseline, should already pass) and re-read `frontend/src/app/admin/stockist/page.tsx` in full immediately before editing — recent commits have touched this exact file 5 times in the last week, so confirm `AttentionPanel`, `LocationSnapshot`, and `TopRequestedPanel` are still unreferenced (`grep -n "AttentionPanel\|LocationSnapshot\|TopRequestedPanel" frontend/src/app/admin/stockist/page.tsx` should show only their own definitions, no call sites) before proceeding. If a newer commit has started calling one of them, stop and re-scope this task instead of silently dropping functionality.

- [ ] **Step 2: Replace lines 1-364 with the redesigned implementation**

Replace everything from the file's first line through the end of the current `TopRequestedPanel` function with:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@/hooks/useUser';
import type { AppUser } from '@/hooks/useUser';
import Link from 'next/link';
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getAssetDashboard,
  type InventoryBalance,
  type StockTransfer,
  type StockistAssetDashboard,
  type AssetLocationSummary
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

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

const getGreeting = () => {
  const hr = new Date().getHours();
  if (hr < 12) return 'Selamat pagi';
  if (hr < 17) return 'Selamat siang';
  return 'Selamat malam';
};

export default function StockistDashboard() {
  const { user } = useUser();
  if (!user) return null;
  return user.role === 'owner' ? <OwnerCommandCenter user={user} /> : <BranchAdminDashboard user={user} />;
}

// ---------------------------------------------------------------------------
// Owner: Command Center
//
// Read-only, company-wide, primarily link-out — the owner nav collapsed to
// a single tab (see layout.tsx), so this screen is the sole hub for reaching
// every other stockist page. It never mutates data itself. KPI drill-down
// (location SKU breakdown, full attention list, full transfer list) opens
// in a BottomSheet for a quick look; every sheet still offers a link-out to
// the full page for taking action. Sourced entirely from the company-wide
// `assets` endpoint — never mixes warehouse and branch figures into one
// number, and never scopes to a single "selected" location the way the old
// per-branch dropdown did.
// ---------------------------------------------------------------------------

type DrillDown =
  | { type: 'location'; location: AssetLocationSummary }
  | { type: 'attention' }
  | { type: 'transfers' }
  | null;

function formatAssetValue(value: number | null) {
  if (value === null) return 'Tidak tersedia';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0,
  }).format(value);
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  useEffect(() => {
    setLoading(true);
    getAssetDashboard()
      .then((assetData) => {
        setAssets(assetData);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat command center');
      })
      .finally(() => setLoading(false));
  }, []);

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
              formatter={formatAssetValue}
              variant="hero"
              hint="Total nilai stok aktif di seluruh jaringan RedBox."
            />
          </motion.div>

          <motion.div variants={fadeSlideItem} className="grid grid-cols-2 gap-3">
            <StatCard label="Nilai Gudang Pusat" value={assets.warehouse_asset_value ?? 0} formatter={formatAssetValue} />
            <StatCard label="Nilai Stok Cabang" value={assets.branch_asset_value ?? 0} formatter={formatAssetValue} />
            <StatCard
              label="Barang Perlu Perhatian"
              value={assets.attention_items.length}
              variant="danger"
              hint="stok kosong atau di bawah reorder point"
              onClick={() => setDrillDown({ type: 'attention' })}
            />
            <StatCard
              label="Transfer Berjalan"
              value={assets.active_transfers.length}
              hint="belum selesai diterima"
              onClick={() => setDrillDown({ type: 'transfers' })}
            />
          </motion.div>

          {assets.asset_by_location.length > 0 && (
            <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
              <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Nilai Stok per Lokasi</h3>
              <div className="bg-surface-elevated border border-border-base rounded-xl p-3">
                <HorizontalBarChart
                  data={[...assets.asset_by_location]
                    .sort((a, b) => (b.total_asset_value ?? 0) - (a.total_asset_value ?? 0))
                    .map((l) => ({ name: l.location_name, value: l.total_asset_value ?? 0 }))}
                />
              </div>
            </motion.section>
          )}

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Aset per Lokasi</h3>
              <span className="text-[10px] text-text-muted">{assets.asset_by_location.length} lokasi</span>
            </div>
            <div className="bg-surface-elevated border border-border-base rounded-xl divide-y divide-border-base overflow-hidden">
              {assets.asset_by_location.map((location) => (
                <LocationCard
                  key={location.location_id}
                  location={location}
                  formatValue={formatAssetValue}
                  onSelect={() => setDrillDown({ type: 'location', location })}
                />
              ))}
            </div>
          </motion.section>

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Perlu Perhatian</h3>
            {assets.attention_items.length === 0 ? (
              <EmptyState icon="check_circle" title="Semua terkendali" subtitle="Tidak ada yang perlu ditindaklanjuti sekarang." />
            ) : (
              <div className="bg-surface-elevated border border-border-base rounded-xl divide-y divide-border-base overflow-hidden">
                {toAttentionRows(assets.attention_items.slice(0, 4)).map((row) => (
                  <ListRow key={row.key} row={row} />
                ))}
              </div>
            )}
          </motion.section>
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

Immediately followed by the existing `// ---... Branch admin: Beranda (unchanged from prior behavior) ...---` comment and the rest of the file (`BranchAdminDashboard` and everything after it) — leave that part exactly as it is today.

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. Pay particular attention to any leftover reference to the deleted `DashboardOverview` type, `AttentionRow` type, `AttentionPanel`, `LocationSnapshot`, or `TopRequestedPanel` — none should remain anywhere in the file.

- [ ] **Step 4: Verify lint**

Run: `cd frontend && npm run lint`
Expected: no new errors in `frontend/src/app/admin/stockist/page.tsx` or the new `components/stockist/*` files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): redesign Owner Command Center with drill-down and motion

Rebuilds OwnerCommandCenter on the new StatCard/LocationCard/ListRow/
BottomSheet component set: hero KPI with animated count-up, a real
value-per-location bar chart, and KPI drill-down sheets for locations,
attention items, and active transfers. BranchAdminDashboard is untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Manual QA pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Log in as an owner and open the dashboard**

Navigate to `/admin/stockist` authenticated as a user whose email is in `STOCKIST_OWNER_EMAILS` (`frontend/src/app/admin/stockist/stockistRole.ts`) — `adhit24@gmail.com` is already allow-listed.

- [ ] **Step 3: Verify loading and error states**

Throttle network (browser devtools) to confirm the `SkeletonCard` grid renders during load, matching the final layout's shape (hero + 2x2 KPI grid + chart-sized block). Temporarily break the fetch (e.g. stop the backend) to confirm the existing red error banner still renders with a human-readable message.

- [ ] **Step 4: Verify the hero, KPI grid, and chart**

Confirm: hero card shows the animated `total_asset_value` counting up once on load (not on every re-render); the 2x2 grid shows Nilai Gudang Pusat, Nilai Stok Cabang, Barang Perlu Perhatian (red variant), Transfer Berjalan; the horizontal bar chart renders one bar per location sorted by value descending, with a tooltip on hover.

- [ ] **Step 5: Verify drill-down sheets**

- Click a location row in "Aset per Lokasi" → sheet opens with a slide-up animation, shows a brief skeleton, then a per-SKU list (or "Tidak ada stok aktif di lokasi ini." if empty), plus a working "Lihat semua stok di [lokasi]" link. Close via the X button, via clicking the backdrop, and via Escape — all three must close it.
- Reopen the same location's sheet a second time → SKU list appears immediately (no skeleton), confirming the cache works.
- Click "Barang Perlu Perhatian" stat card → sheet opens with the full attention list (not capped at 4).
- Click "Transfer Berjalan" stat card → sheet opens with the full active-transfers list, each row linking to its transfer detail page.

- [ ] **Step 6: Verify hover/press motion**

On desktop viewport, hover a `StatCard`/`LocationCard` and confirm a subtle upward shift; on a touch-emulated mobile viewport, tap-and-hold and confirm a slight scale-down.

- [ ] **Step 7: Verify responsive layout**

Using browser devtools device toolbar, check 320px, 360px, 390px, 430px, 768px, and a desktop width (1280px+): no horizontal scroll, KPI grid stays legible (2 columns), bottom sheet is a full-width sheet from the bottom on narrow widths and a centered panel on wide widths.

- [ ] **Step 8: Verify `BranchAdminDashboard` is unaffected**

Log in as a `branch_admin` user and confirm `/admin/stockist` still renders the existing branch dashboard exactly as before (low stock alert card, stats grid, quick actions) — this file's other half was not touched.

- [ ] **Step 9: Stop the dev server**

Kill the `npm run dev` process once QA is complete.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as a follow-up commit against the relevant task's file before considering the plan done.
