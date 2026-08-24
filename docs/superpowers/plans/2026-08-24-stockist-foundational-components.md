# RedBox Stockist Foundational Shared Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared components and fix the shared systems (motion, toast) that the design handoff's gap audit found missing or broken — foundation for every screen-rebuild plan that follows.

**Architecture:** Six independent, small deliverables: a `Stepper` component, a module-level toast store + host component (mirrors the existing `useTheme`/`useUnreadNotifications` `useSyncExternalStore` pattern), two CSS animation fixes in `globals.css`, a restyle of the two existing States components (`EmptyState`, `SkeletonCard`), a new shared `ValidationErrorBanner`, and three new States components (`OfflineBanner`, `SessionExpiredScreen`, `NoAccessScreen`). This plan builds and self-verifies each component in isolation — wiring them into individual screens (e.g. adding the Stepper to Terima Barang, migrating existing inline error banners to `ValidationErrorBanner`) is explicitly out of scope, tracked separately per the gap-audit doc's suggested execution order.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (CSS-first `@theme`), Material Symbols Outlined icons.

**Spec:** `design_handoff_stockist_mobile/README.md` (Design Tokens, Interactions & Behavior → Toast/Motion, §24 States, §28 Empty States, §29 Loading States sections) and `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md` (foundational items 2, 3, 5, 6).

## Global Constraints

- Every color used in new/modified components must be a CSS custom property token already defined in `frontend/src/app/globals.css` (`--color-*`) — never a hardcoded hex, so components work correctly across the light/dark theme toggle.
- `EmptyState`'s prop signature change must stay backward compatible — it has 9 existing call sites across the codebase (`branch-stock/all/page.tsx`, `branch-stock/page.tsx`, `insights/page.tsx` ×2, `ledger/page.tsx`, `notifications/page.tsx`, `page.tsx` ×3), none of which currently pass an `action` prop. New props must be optional.
- `rbup` motion spec (exact, from the README): `opacity 0 → 1` + `translateY(8px → 0)`, duration 240–300ms, ease-out.
- `rbshim` motion spec (exact): `background-position -200% → 200%`, 1.6s infinite linear, gradient `surface-2` 25% → `border` 50% → `surface-2` 75%, `background-size: 200% 100%`.
- Toast spec (exact): dark pill using `text-1` token as background and `bg` token as text color, floats 96px from the bottom, `check_circle` icon, auto-dismiss after 2200ms.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` for every task. No backend files are touched in this plan, so no `node -c` is needed.
- This plan does NOT wire any of these components into their eventual consumer screens (Stepper into Terima Barang, ValidationErrorBanner replacing existing inline banners, etc.) — that is deliberately out of scope, tracked in the gap-audit doc.

---

### Task 1: `Stepper` component

**Files:**
- Create: `frontend/src/components/stockist/Stepper.tsx`

**Interfaces:**
- Produces: `<Stepper value={number} onChange={(next: number) => void} min={number} max={number} size?: 'sm' | 'lg' />` — `size` defaults to `'lg'` (46px buttons, matching the README's stepper spec for Terima Barang/§9) since `'sm'` (40px) is only needed by later screens (Konfirmasi Penerimaan/§13, Stock Opname/§15) that this plan doesn't build yet, but the prop is included now so those later tasks don't need to modify this component.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/Stepper.tsx
'use client';

interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'lg';
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 0, max = Infinity, size = 'lg', disabled = false }: StepperProps) {
  const buttonSize = size === 'lg' ? 'h-[46px] w-[46px]' : 'h-10 w-10';
  const numberSize = size === 'lg' ? 'text-[26px]' : 'text-[19px]';

  function decrement() {
    if (disabled) return;
    onChange(Math.max(min, value - 1));
  }

  function increment() {
    if (disabled) return;
    onChange(Math.min(max, value + 1));
  }

  return (
    <div className="flex items-center justify-center gap-4 rounded-2xl border border-border-base bg-surface-container-lowest p-2">
      <button
        type="button"
        onClick={decrement}
        disabled={disabled || value <= min}
        aria-label="Kurangi"
        className={`flex shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-primary disabled:opacity-40 active:scale-95 transition-transform ${buttonSize}`}
      >
        <span className="material-symbols-outlined text-[20px]">remove</span>
      </button>
      <span className={`min-w-[2ch] text-center font-bold text-text-primary font-display tabular-nums ${numberSize}`}>
        {value}
      </span>
      <button
        type="button"
        onClick={increment}
        disabled={disabled || value >= max}
        aria-label="Tambah"
        className={`flex shrink-0 items-center justify-center rounded-xl bg-primary-container text-white disabled:opacity-40 active:scale-95 transition-transform ${buttonSize}`}
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/Stepper.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add reusable Stepper component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Toast component, store, and mount point

**Files:**
- Create: `frontend/src/lib/stockist/useToast.ts`
- Create: `frontend/src/components/stockist/ToastHost.tsx`
- Modify: `frontend/src/app/admin/stockist/layout.tsx`

**Interfaces:**
- Consumes: `frontend/src/lib/stockist/useTheme.ts` (for the established `useSyncExternalStore` module-store pattern this task mirrors — read it first for the exact convention, don't reinvent it).
- Produces: `showToast(message: string): void` (importable from `@/lib/stockist/useToast`, callable from anywhere — future tasks that wire up "Simpan Draft"-style actions will call this) and `<ToastHost />` (mounted once, already done by this task).

- [ ] **Step 1: Re-read the existing store pattern**

Read `frontend/src/lib/stockist/useTheme.ts` in full to confirm the exact `useSyncExternalStore` shape (module-level variable, `Set` of listeners, `subscribe`/`getSnapshot`/`getServerSnapshot`) this task's store must follow.

- [ ] **Step 2: Write the toast store**

```ts
// frontend/src/lib/stockist/useToast.ts
'use client';

import { useSyncExternalStore } from 'react';

interface ToastState {
  id: number;
  message: string;
}

let toast: ToastState | null = null;
let nextId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toast;
}

function getServerSnapshot(): ToastState | null {
  return null;
}

export function showToast(message: string) {
  if (dismissTimer) clearTimeout(dismissTimer);
  nextId += 1;
  toast = { id: nextId, message };
  emit();
  dismissTimer = setTimeout(() => {
    toast = null;
    emit();
  }, 2200);
}

export function useToast() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 3: Write the host component**

```tsx
// frontend/src/components/stockist/ToastHost.tsx
'use client';

import { useToast } from '@/lib/stockist/useToast';

export function ToastHost() {
  const toast = useToast();
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      role="status"
      className="fixed left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-3 text-[13px] font-semibold shadow-lg animate-fade-in"
      style={{ bottom: '96px', background: 'var(--color-text-primary)', color: 'var(--background)' }}
    >
      <span className="material-symbols-outlined text-[18px]">check_circle</span>
      {toast.message}
    </div>
  );
}
```

(This uses the `animate-fade-in` class fixed in Task 3 of this plan — order doesn't matter for compilation since it's a plain CSS class name, but the animation won't visually apply correctly until Task 3 lands. `bottom: '96px'` and the `var(--color-text-primary)`/`var(--background)` tokens are inline styles because Tailwind's arbitrary-value bracket syntax can't reference CSS custom properties for these dynamic per-theme values as directly — matching the existing pattern already used for `boxShadow` in `frontend/src/app/admin/stockist/layout.tsx`.)

- [ ] **Step 4: Mount the host in the stockist layout**

In `frontend/src/app/admin/stockist/layout.tsx`, add the import:

```ts
import { ToastHost } from '@/components/stockist/ToastHost';
```

Mount it once inside the main authenticated-shell return path (the final `return` statement, after the `MotionConfig` closing structure), immediately before the closing `</div>` of the outer `data-theme` wrapper — i.e. change:

```tsx
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
      </div>
    </MotionConfig>
    </div>
  );
```

to:

```tsx
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
      </div>
    </MotionConfig>
    <ToastHost />
    </div>
  );
```

- [ ] **Step 5: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/stockist/useToast.ts frontend/src/components/stockist/ToastHost.tsx frontend/src/app/admin/stockist/layout.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add toast component, store, and mount point

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fix the motion system — `animate-fade-in`, `animate-slide-up`, `rbshim` colors

**Files:**
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces: working `animate-fade-in` and `animate-slide-up` CSS classes (currently used across ~24 files but never defined anywhere — a silent no-op today), and a theme-aware `animate-shimmer` (currently defined with hardcoded slate colors instead of theme tokens).

- [ ] **Step 1: Add the two missing entrance-animation classes**

In `frontend/src/app/globals.css`, immediately after the existing `@keyframes shimmer` / `.animate-shimmer` block (the one ending at the line `}` right after `animation: shimmer 1.6s infinite linear;`), add:

```css
@keyframes rb-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in,
.animate-slide-up {
  animation: rb-fade-in 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

(260ms sits inside the spec's 240–300ms window for `rbup`, and reuses the same ease-out bezier already used by `EASE_OUT` in `frontend/src/lib/stockist/motion.ts` for consistency between the CSS-class and framer-motion versions of this animation. The spec names only one entrance animation, `rbup` — `animate-slide-up`, used in 3 files for expanding sections, is treated as the same motion since the handoff doesn't define a visually distinct "slide up" animation.)

- [ ] **Step 2: Fix `animate-shimmer`'s colors to use theme tokens**

Change:

```css
.animate-shimmer {
  background: linear-gradient(90deg, rgba(30, 41, 59, 0.4) 25%, rgba(51, 65, 85, 0.6) 50%, rgba(30, 41, 59, 0.4) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite linear;
}
```

to:

```css
.animate-shimmer {
  background: linear-gradient(90deg, var(--color-surface-container) 25%, var(--color-border-base) 50%, var(--color-surface-container) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite linear;
}
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (this task only touches CSS, so this step just confirms the rest of the app hasn't broken — expect it to already be clean before this task, and stay clean after).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "$(cat <<'EOF'
fix(stockist): define missing entrance animations, theme-ify shimmer colors

animate-fade-in and animate-slide-up were used across ~24 files but
never defined anywhere — a silent no-op on every screen using them.
animate-shimmer used hardcoded slate colors that wouldn't adapt to
the light/dark theme toggle.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Restyle `EmptyState` and `SkeletonCard`

**Files:**
- Modify: `frontend/src/components/stockist/EmptyState.tsx`
- Modify: `frontend/src/components/stockist/SkeletonCard.tsx`

**Interfaces:**
- Produces: `<EmptyState icon title subtitle action?: { label: string; onClick: () => void } />` (new optional `action` prop, all existing props unchanged) and an `SkeletonCard` with the same `{ className? }` prop signature as before (visual-only change).

- [ ] **Step 1: Restyle `EmptyState`**

Replace the full contents of `frontend/src/components/stockist/EmptyState.tsx` with:

```tsx
// frontend/src/components/stockist/EmptyState.tsx
export interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-base p-6 text-center">
      <span className="material-symbols-outlined text-text-muted text-[32px]">
        {icon}
      </span>
      <span className="text-[13px] font-semibold text-text-primary">{title}</span>
      <span className="max-w-[240px] text-[11px] text-text-muted">{subtitle}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-lg border border-border-base px-3 py-1.5 text-[11px] font-semibold text-primary-container active:scale-95 transition-transform"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

(Dropped the previous hardcoded `text-success` icon color — an empty list isn't a "success," so a neutral `text-text-muted` is correct regardless of context. Layout changed from a horizontal icon+text row to a centered vertical block per the spec's "border dashed, ikon 32px, judul, body" description. The new `action` prop is optional so all 9 existing call sites keep compiling unchanged.)

- [ ] **Step 2: Restyle `SkeletonCard`**

Replace the full contents of `frontend/src/components/stockist/SkeletonCard.tsx` with:

```tsx
// frontend/src/components/stockist/SkeletonCard.tsx
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-border-base bg-surface-elevated p-4 ${className}`}>
      <div className="h-[60px] w-full animate-shimmer rounded-lg bg-surface-container" />
      <div className="h-3 w-[70%] animate-shimmer rounded bg-surface-container" />
      <div className="h-3 w-[45%] animate-shimmer rounded bg-surface-container" />
    </div>
  );
}
```

(Matches the spec's "tiga row: blok 60px + dua bar (70% dan 45%), animasi rbshim" exactly — a 60px block placeholder plus two bars at 70% and 45% width, using the now-theme-aware `animate-shimmer` from Task 3 instead of Tailwind's generic `animate-pulse`.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. All 9 `EmptyState` call sites and all `SkeletonCard` call sites must still compile with no changes needed on their end.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/EmptyState.tsx frontend/src/components/stockist/SkeletonCard.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): restyle EmptyState and SkeletonCard to match the design handoff

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ValidationErrorBanner` component

**Files:**
- Create: `frontend/src/components/stockist/ValidationErrorBanner.tsx`

**Interfaces:**
- Produces: `<ValidationErrorBanner message={string} />` — a componentized version of the inline `bg-danger/10 border border-danger ...` pattern already copy-pasted across ~20 files, matching the spec's exact color/icon treatment for this state.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/stockist/ValidationErrorBanner.tsx
export function ValidationErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent-soft bg-tint-danger p-3 text-sm text-danger">
      <span className="material-symbols-outlined text-[18px]">error</span>
      <span>{message}</span>
    </div>
  );
}
```

(Spec §24 "Error validasi": `tint-red` background / border `red-soft` / icon `error` — mapped to this codebase's tokens as `bg-tint-danger` / `border-accent-soft` / `text-danger`.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/stockist/ValidationErrorBanner.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add shared ValidationErrorBanner component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `OfflineBanner`, `SessionExpiredScreen`, `NoAccessScreen`

**Files:**
- Create: `frontend/src/components/stockist/OfflineBanner.tsx`
- Create: `frontend/src/components/stockist/SessionExpiredScreen.tsx`
- Create: `frontend/src/components/stockist/NoAccessScreen.tsx`

**Interfaces:**
- Produces: `<OfflineBanner />` (no props — static content per spec), `<SessionExpiredScreen onLoginAgain={() => void} />`, `<NoAccessScreen />` (no props — static content per spec).

- [ ] **Step 1: Write `OfflineBanner`**

```tsx
// frontend/src/components/stockist/OfflineBanner.tsx
export function OfflineBanner() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning bg-tint-warning p-3.5 text-warning">
      <span className="material-symbols-outlined text-[20px]">wifi_off</span>
      <div className="flex flex-col">
        <span className="text-[12px] font-semibold">Koneksi sedang bermasalah.</span>
        <span className="text-[11px] text-text-secondary">Data terakhir masih ditampilkan.</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `SessionExpiredScreen`**

```tsx
// frontend/src/components/stockist/SessionExpiredScreen.tsx
export function SessionExpiredScreen({ onLoginAgain }: { onLoginAgain: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="material-symbols-outlined text-text-muted text-[52px]">schedule</span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] font-bold text-text-primary">Sesi Anda berakhir</h2>
        <p className="max-w-[280px] text-[13px] text-text-secondary">
          Masuk kembali untuk melanjutkan pekerjaan. Data form tersimpan.
        </p>
      </div>
      <button
        type="button"
        onClick={onLoginAgain}
        className="mt-2 h-[52px] w-full max-w-[240px] rounded-2xl bg-primary-container font-bold text-white active:scale-95 transition-transform"
      >
        Masuk Lagi
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `NoAccessScreen`**

```tsx
// frontend/src/components/stockist/NoAccessScreen.tsx
export function NoAccessScreen() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-surface-elevated px-8 text-center">
      <span className="material-symbols-outlined text-text-muted text-[52px]">lock</span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] font-bold text-text-primary">Anda tidak memiliki akses ke data ini.</h2>
        <p className="max-w-[280px] text-[13px] text-text-secondary">
          Hubungi owner untuk membuka akses.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/stockist/OfflineBanner.tsx frontend/src/components/stockist/SessionExpiredScreen.tsx frontend/src/components/stockist/NoAccessScreen.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add OfflineBanner, SessionExpiredScreen, NoAccessScreen components

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Explicitly out of scope for this plan

- Wiring `Stepper` into Terima Barang / Buat Transfer / Konfirmasi Penerimaan / Stock Opname.
- Wiring `showToast()` into any actual action (e.g. a future "Simpan Draft" feature).
- Migrating any of the ~20 existing inline `bg-danger/10 ...` error banners to `ValidationErrorBanner`.
- Wiring `OfflineBanner` to real `navigator.onLine` detection, `SessionExpiredScreen` into the actual session-expiry redirect flow in `layout.tsx`, or `NoAccessScreen` into any real permission-denied path.
- Removing `scale`/`lift` hover interactions from `StatCard`/`LocationCard`/buttons (a separate, larger cross-cutting change per the gap-audit doc, not bundled here).

Each of these is tracked in `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md` and will be picked up as part of the screen-rebuild plans that actually need them.
