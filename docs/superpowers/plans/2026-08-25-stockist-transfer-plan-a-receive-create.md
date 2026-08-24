# Stockist Transfer Plan A: Terima Barang + Buat Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Terima Barang (warehouse receiving) and Buat Transfer (create stock transfer) to match the design handoff exactly, and build the two shared components (`SuccessScreen`, `useDraftPersistence`) both this plan and Plan B need.

**Architecture:** Two new full-page routes replace an inline form and a dropdown-based form respectively. Both reuse the existing `Stepper` component (extended with one new size), the existing `stockistApi.ts` functions (no backend logic changes except one additive role check), and a new shared `SuccessScreen` component for the terminal confirmation state both flows land on.

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript, Tailwind v4, Express + Supabase (`server/routes/stockist.js`).

**Spec:** `docs/superpowers/specs/2026-08-25-stockist-transfer-flow-rebuild-design.md` (read the "Shared components", "Plan A: Terima Barang", and "Plan A: Buat Transfer" sections — this plan implements exactly those three sections, nothing from "Plan B").

## Global Constraints

- No fabricated data — every number shown (current stock, transfer value, etc.) comes from a real API response, never a placeholder or derived guess.
- Exact copy strings from the spec are non-negotiable: button labels, placeholder text, panel titles — copy them verbatim, do not paraphrase.
- `Stepper` (`frontend/src/components/stockist/Stepper.tsx`) currently has `size?: 'sm' | 'lg'` (`'sm'` = 40px buttons/19px number, `'lg'` = 46px buttons/26px number). This plan adds `'xs'` = 34px buttons — keep the existing proportional number-size pattern (`'xs'` should use a number size smaller than `'sm'`'s 19px; use `text-[16px]`).
- `showToast(message: string)` from `frontend/src/lib/stockist/useToast.ts` is the only toast API — it's an imported function, not a hook (no `useToast()` call needed to trigger one; `ToastHost` in the layout renders whatever's currently shown).
- Product photo lookup: use `getKnownProductImage(name: string): string | null` from `frontend/src/lib/stockist/productImage.ts` — NOT the older per-file duplicated `getProductImage` pattern still present in some existing files (`warehouse/page.tsx`, `transfers/new/page.tsx`, `transfers/[id]/page.tsx`). When it returns `null`, render a `Package` icon (from `lucide-react`, already a project dependency) as a fallback, matching the pattern already used in `frontend/src/app/admin/stockist/branch-stock/all/page.tsx`.
- `AppUser['role']` (`frontend/src/hooks/useUser.ts:10`) is currently typed `'owner' | 'branch_admin' | 'barber'` — no `'manager'`. This plan widens that union to include `'manager'` (a type-only change; `resolveStockistRole` already passes through whatever string is in the `users.role` DB column verbatim when it isn't a recognized owner email, so no runtime logic changes) so that `role === 'owner' || role === 'manager'` checks type-check. A real Manager account still can't reach these screens until the separate "Manager role implementation" backlog item updates `server/services/stockistAccess.js` (out of scope here) — this change only makes the frontend code already-correct for when that lands.
- `getInventorySummary(location: string)` returns `{ balances: InventoryBalance[] }` where `InventoryBalance = { product_id, location_id, quantity, updated_at }` — call with `'warehouse'` for central warehouse stock (existing convention, see `frontend/src/app/admin/stockist/warehouse/page.tsx:51`).
- `StockistProduct.purchase_price` is `number | null | undefined` — always guard against null/undefined when computing money values; never let a missing price silently become `NaN` in a sum.

---

### Task 1: `useDraftPersistence` hook

**Files:**
- Create: `frontend/src/hooks/useDraftPersistence.ts`
- Test: manual (see Step 3 — this repo has no automated test suite; verification is `tsc --noEmit` plus the manual check described)

**Interfaces:**
- Produces: `useDraftPersistence<T>(key: string, initialValue: T): [T, (next: T) => void, () => void]` — `[value, setValue, clear]`. `clear()` resets in-memory state to `initialValue` and removes the localStorage entry. Plan A's Buat Transfer task and Plan B's Konfirmasi Penerimaan both import this.

- [ ] **Step 1: Write the hook**

```tsx
// frontend/src/hooks/useDraftPersistence.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

export function useDraftPersistence<T>(key: string, initialValue: T): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        setValue(JSON.parse(stored) as T);
      }
    } catch {
      // localStorage unavailable or the stored value isn't valid JSON — start fresh.
    } finally {
      setHydrated(true);
    }
    // Only run once per mount for this key — re-running on `initialValue` identity
    // changes would clobber a just-hydrated draft with the caller's default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore — draft still works for this session even if it can't persist
    }
  }, [key]);

  const clear = useCallback(() => {
    setValue(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [hydrated ? value : initialValue, persist, clear];
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification note**

This hook has no automated test (no test suite in this repo). It will be exercised for real once Task 4 (Buat Transfer) wires it in — verify then: fill the Buat Transfer form partway, refresh the page, confirm the destination/cart survive. Don't skip that check when you reach Task 4's manual verification step.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useDraftPersistence.ts
git commit -m "$(cat <<'EOF'
feat(stockist): add useDraftPersistence hook

Small localStorage-backed draft hook, SSR-safe (hydrates after mount,
matches the existing useStockistTheme guard pattern). Used by Buat
Transfer's destination+cart draft in this same plan, and by Konfirmasi
Penerimaan's confirm+reasons draft in the follow-up offline-first plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `Stepper` `'xs'` size + `SuccessScreen` component

**Files:**
- Modify: `frontend/src/components/stockist/Stepper.tsx`
- Create: `frontend/src/components/stockist/SuccessScreen.tsx`

**Interfaces:**
- Modifies: `Stepper`'s `size` prop from `'sm' | 'lg'` to `'sm' | 'lg' | 'xs'`.
- Produces: `SuccessScreen(props: SuccessScreenProps)` where
  ```ts
  interface SuccessScreenProps {
    title: string;
    body: string;
    summary: Array<{ label: string; value: string }>;
    secondaryAction: { label: string; href: string };
  }
  ```
  Task 3 (Terima Barang) and Task 4 (Buat Transfer) both render this. It is a full-page component (assumes it's the only thing on the page — callers render it in place of their normal page content after a successful submit, not inside a dialog/sheet).

- [ ] **Step 1: Add the `'xs'` Stepper size**

Edit `frontend/src/components/stockist/Stepper.tsx`. Change the type and the two size-lookup lines:

```tsx
interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'xs' | 'sm' | 'lg';
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 0, max = Infinity, size = 'lg', disabled = false }: StepperProps) {
  const buttonSize = size === 'lg' ? 'h-[46px] w-[46px]' : size === 'sm' ? 'h-10 w-10' : 'h-[34px] w-[34px]';
  const numberSize = size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-[19px]' : 'text-[16px]';
```

Leave every other line in the file unchanged.

- [ ] **Step 2: Write `SuccessScreen`**

```tsx
// frontend/src/components/stockist/SuccessScreen.tsx
import Link from 'next/link';

export interface SuccessScreenProps {
  title: string;
  body: string;
  summary: Array<{ label: string; value: string }>;
  secondaryAction: { label: string; href: string };
}

export function SuccessScreen({ title, body, summary, secondaryAction }: SuccessScreenProps) {
  return (
    <div className="flex flex-col items-center pt-14 px-4 text-center">
      <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-success bg-tint-success">
        <span className="material-symbols-outlined text-success text-[44px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          check_circle
        </span>
      </div>
      <h2 className="mt-5 text-[20px] font-extrabold text-text-primary font-display">{title}</h2>
      <p className="mt-2 max-w-[280px] text-[13px] font-medium text-text-secondary">{body}</p>

      <div className="mt-6 w-full max-w-[320px] rounded-xl border border-border-base bg-surface-elevated divide-y divide-border-base">
        {summary.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2.5 text-[12.5px]">
            <span className="text-text-muted">{row.label}</span>
            <span className="font-semibold text-text-primary">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2.5">
        <Link
          href="/admin/stockist"
          className="flex h-[48px] items-center justify-center rounded-xl bg-primary-container text-[13px] font-bold text-white active:scale-95 transition-transform"
        >
          Kembali ke Beranda
        </Link>
        <Link
          href={secondaryAction.href}
          className="flex h-[48px] items-center justify-center rounded-xl border border-border-base text-[13px] font-bold text-text-primary active:scale-95 transition-transform"
        >
          {secondaryAction.label}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/Stepper.tsx frontend/src/components/stockist/SuccessScreen.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add Stepper xs size and SuccessScreen component

Stepper gets a 34px 'xs' variant for Buat Transfer's cart rows (spec
§11), matching the two existing sizes' proportional pattern.
SuccessScreen is the shared §23 terminal-state component: disc icon,
title, body, key-value summary panel, two CTAs. Wired into Terima
Barang and Buat Transfer next in this same plan; Konfirmasi Penerimaan
reuses it in the follow-up plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Terima Barang screen

**Files:**
- Create: `frontend/src/app/admin/stockist/warehouse/receive/page.tsx`
- Modify: `frontend/src/app/admin/stockist/warehouse/page.tsx`
- Modify: `frontend/src/hooks/useUser.ts` (type widening moved from Task 4 so Task 3 type-checks)

**Interfaces:**
- Consumes: `Stepper` (Task 2, `size='lg'`), `SuccessScreen` (Task 2), `getKnownProductImage` (existing, `frontend/src/lib/stockist/productImage.ts`), `receiveWarehouseStock`/`listProducts`/`getInventorySummary` (existing, `frontend/src/lib/stockistApi.ts` — exact signatures: `receiveWarehouseStock(input: { product_id: string; quantity: number; reason?: string }): Promise<{ ledger: unknown }>`, `listProducts(): Promise<{ products: StockistProduct[] }>`, `getInventorySummary(location: string): Promise<{ balances: InventoryBalance[] }>`), `useUser` (existing, `frontend/src/hooks/useUser.ts`).
- Produces: route `/admin/stockist/warehouse/receive?product=<id>` (query param optional, unused for now — just don't crash if absent or unknown).

- [ ] **Step 1: Widen `AppUser['role']`**

Edit `frontend/src/hooks/useUser.ts` line 10:

```ts
  role: 'owner' | 'branch_admin' | 'barber' | 'manager';
```

- [ ] **Step 2: Write the new page**

```tsx
// frontend/src/app/admin/stockist/warehouse/receive/page.tsx
'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package } from 'lucide-react';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';

function ReceiveStockContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectId = searchParams?.get('product') ?? '';

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [currentStock, setCurrentStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [qty, setQty] = useState(24);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ productName: string; qty: number; after: number; note: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([listProducts(), getInventorySummary('warehouse')])
      .then(([{ products }, { balances }]) => {
        if (!mounted) return;
        const active = products.filter((p) => p.is_active);
        setProducts(active);
        setCurrentStock(Object.fromEntries(balances.map((b) => [b.product_id, b.quantity])));
        if (preselectId && active.some((p) => p.id === preselectId)) {
          setSelectedId(preselectId);
        } else if (active.length > 0) {
          setSelectedId(active[0].id);
        }
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat produk'))
      .finally(() => setLoading(false));
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = products.find((p) => p.id === selectedId);
  const before = selected ? (currentStock[selected.id] ?? 0) : 0;
  const after = before + qty;

  async function handleSubmit() {
    if (!selected) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await receiveWarehouseStock({ product_id: selected.id, quantity: qty, reason: note || undefined });
      setResult({ productName: selected.name, qty, after, note: note || '-' });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menerima barang');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <SuccessScreen
        title="Barang berhasil diterima"
        body="Stok gudang pusat sudah diperbarui."
        summary={[
          { label: 'Produk', value: result.productName },
          { label: 'Quantity', value: `+${result.qty}` },
          { label: 'Stok akhir', value: String(result.after) },
          { label: 'Referensi', value: result.note },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push('/admin/stockist/warehouse')}
          className="w-10 h-10 flex items-center justify-center text-text-primary hover:bg-surface-elevated active:scale-95 transition-transform rounded-full -ml-2"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div>
          <h2 className="text-[20px] font-bold text-text-primary font-display">Terima Barang</h2>
          <p className="text-[12px] text-text-muted">Catat barang masuk ke gudang pusat.</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1">
            {products.map((p) => {
              const image = getKnownProductImage(p.name);
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-[112px] shrink-0 flex-col items-center gap-1.5 rounded-xl border p-2.5 transition-colors ${
                    isSelected ? 'border-[1.5px] border-primary-container bg-tint-red' : 'border-border-base bg-surface-elevated'
                  }`}
                >
                  <div className="flex h-[70px] w-[70px] items-center justify-center overflow-hidden rounded-lg bg-surface-container-lowest">
                    {image ? (
                      <img src={image} alt={p.name} className="h-full w-full object-contain p-1" />
                    ) : (
                      <Package size={28} className="text-text-muted" aria-hidden />
                    )}
                  </div>
                  <span className="h-[29px] w-full overflow-hidden text-[11px] font-bold leading-[14.5px] text-text-primary">
                    {p.name}
                  </span>
                  <span className="text-[9px] font-mono text-text-muted">{p.sku}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border-base bg-surface-elevated p-4">
            <span className="text-[11px] font-semibold text-text-muted">Quantity diterima</span>
            <Stepper value={qty} onChange={setQty} min={0} size="lg" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-secondary">Catatan / No. Invoice</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="INV/2026/08/1183"
              className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-primary-container"
            />
          </div>

          {selected && (
            <div className="flex flex-col gap-2 rounded-xl border border-success bg-tint-success p-4">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-secondary">Stok saat ini</span>
                <span className="font-semibold text-text-primary">{before}</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-text-secondary">Quantity diterima</span>
                <span className="font-semibold text-success">+{qty}</span>
              </div>
              <div className="h-[1px] bg-border-base/60" />
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-text-primary">Stok setelah diterima</span>
                <span className="text-[20px] font-extrabold font-display tabular-nums text-text-primary">{after}</span>
              </div>
            </div>
          )}

          {submitError && (
            <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !selected}
              className="h-[52px] rounded-xl bg-primary-container text-white text-[14px] font-bold active:scale-95 transition-transform disabled:opacity-50"
            >
              {submitting ? 'Memproses...' : 'Terima Barang'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/stockist/warehouse')}
              className="h-[48px] rounded-xl border border-border-base text-text-primary text-[14px] font-bold active:scale-95 transition-transform"
            >
              Batal
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReceiveStockPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <ReceiveStockContent />
    </Suspense>
  );
}
```

Note on this file: it does not self-gate by role. Gating who can navigate here happens at the link in `warehouse/page.tsx` (Step 2 below) — this page has no redirect-if-unauthorized logic, matching every sibling page in this codebase (none of them re-check role on the destination page; they rely on the triggering link/button simply not being shown, and the underlying `receiveWarehouseStock` API call is already server-role-checked independently). Do not import `useUser` here — it isn't needed.

- [ ] **Step 3: Wire up the entry point and remove the old inline form**

Edit `frontend/src/app/admin/stockist/warehouse/page.tsx`. Three changes:

1. Replace the `isOwner` button block (lines 139-147) with a role-inclusive link:

```tsx
        {(user?.role === 'owner' || user?.role === 'manager') && (
          <Link
            href="/admin/stockist/warehouse/receive"
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-container text-white text-[12px] font-semibold rounded-lg hover:bg-inverse-primary transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">call_received</span>
            Terima
          </Link>
        )}
```

2. Delete the entire "Receive Stock Form (Collapsible)" block (the `{isOwner && showForm && (...)}` section, originally lines 208-275 — locate it by its `<h3>...Terima Barang Masuk</h3>` heading and delete through its closing `)}`).

3. Remove now-unused state and the now-unused handler: delete the `showForm`/`form`/`submitting`/`formError` `useState` declarations, delete the `handleReceive` function, and remove `receiveWarehouseStock` from the import on line 6 (it's no longer called from this file). Also remove the now-unused `isOwner` constant (line 129) if nothing else in the file still reads it — check with a search for `isOwner` in the file before deleting; if the receive-link change above is the only place `isOwner` was used, delete the constant too and rely on `user?.role === 'owner' || user?.role === 'manager'` inline as written.

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev server (`cd frontend && npm run dev`), sign in as the owner test account, navigate to Gudang Pusat, click "Terima" — confirm it navigates to `/admin/stockist/warehouse/receive` (not an inline form anymore), the carousel shows real products, selecting a tile updates the preview panel's "Stok saat ini", changing the stepper updates "Stok setelah diterima" live, and submitting shows the new `SuccessScreen` with real values, not a redirect back to Gudang Pusat.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/warehouse/receive/page.tsx frontend/src/app/admin/stockist/warehouse/page.tsx frontend/src/hooks/useUser.ts
git commit -m "$(cat <<'EOF'
feat(stockist): rebuild Terima Barang as its own screen (spec §9)

Replaces Gudang Pusat's inline collapsible form with a dedicated
route: product carousel, Stepper (initial 24, min 0), live before/
after preview panel, and a proper Batal button. Entry point gating
widened from owner-only to owner-or-manager (manager still can't
authenticate for real until the separate stockistAccess.js fix
lands, but the check is already correct once it does). Submitting
now lands on the shared SuccessScreen instead of silently returning
to Gudang Pusat.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Buat Transfer screen

**Files:**
- Modify: `frontend/src/app/admin/stockist/transfers/new/page.tsx` (full rewrite of the body)
- Modify: `frontend/src/app/admin/stockist/transfers/page.tsx` (gating only)
- Modify: `server/routes/stockist.js` (one role-check line)

**Interfaces:**
- Consumes: `Stepper` (`size='xs'`), `SuccessScreen`, `useDraftPersistence` (Task 1), `getKnownProductImage`, `createTransfer`/`listProducts`/`getInventorySummary` (existing).
- Produces: nothing new consumed by later tasks — this is the last task in Plan A.

- [ ] **Step 1: Verify `AppUser['role']` widening**

Confirm `frontend/src/hooks/useUser.ts` line 10 already includes `'manager'` (performed in Task 3 Step 1):

```ts
  role: 'owner' | 'branch_admin' | 'barber' | 'manager';
```

- [ ] **Step 2: Backend role check for transfer creation**

Edit `server/routes/stockist.js`. Find:

```js
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create transfers' });
    }
```

(this is the first check inside `router.post('/transfers', ...)`, currently around line 513). Replace with:

```js
    if (access.role !== 'owner' && access.role !== 'manager') {
      return res.status(403).json({ error: 'only owner or manager can create transfers' });
    }
```

- [ ] **Step 3: Frontend gating on the transfer list page**

Edit `frontend/src/app/admin/stockist/transfers/page.tsx`. Find:

```tsx
  const isOwner = user?.role === 'owner';
```

Replace with:

```tsx
  const canCreateTransfer = user?.role === 'owner' || user?.role === 'manager';
```

And update the one place `isOwner` gates the "Buat Transfer" link (around line 70, `{isOwner && (`) to `{canCreateTransfer && (`.

- [ ] **Step 4: Rewrite Buat Transfer**

Replace the entire contents of `frontend/src/app/admin/stockist/transfers/new/page.tsx`:

```tsx
// frontend/src/app/admin/stockist/transfers/new/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { listProducts, getInventorySummary, createTransfer, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { showToast } from '@/lib/stockist/useToast';

const BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'];

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal',
};

interface TransferDraft {
  destination: string;
  cart: Record<string, number>;
}

const EMPTY_DRAFT: TransferDraft = { destination: '', cart: {} };

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

export default function NewTransferPage() {
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [warehouseStock, setWarehouseStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerProductId, setPickerProductId] = useState('');
  const [result, setResult] = useState<{ transferNumber: string; destination: string; totalUnits: number } | null>(null);

  const [draft, setDraft, clearDraft] = useDraftPersistence<TransferDraft>('stockist-transfer-draft', EMPTY_DRAFT);
  const { destination, cart } = draft;

  useEffect(() => {
    Promise.all([listProducts(), getInventorySummary('warehouse')])
      .then(([{ products }, { balances }]) => {
        setProducts(products.filter((p) => p.is_active));
        setWarehouseStock(Object.fromEntries(balances.map((b) => [b.product_id, b.quantity])));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Gagal memuat produk'))
      .finally(() => setLoading(false));
  }, []);

  const cartEntries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const totalUnits = cartEntries.reduce((sum, [, qty]) => sum + qty, 0);
  const totalValue = cartEntries.reduce((sum, [productId, qty]) => {
    const price = products.find((p) => p.id === productId)?.purchase_price;
    return sum + qty * (price ?? 0);
  }, 0);
  const hasProductWithoutPrice = cartEntries.some(([productId]) => {
    const price = products.find((p) => p.id === productId)?.purchase_price;
    return price == null;
  });

  function setDestination(next: string) {
    setDraft({ ...draft, destination: next });
  }

  function setCartQty(productId: string, qty: number) {
    setDraft({ ...draft, cart: { ...draft.cart, [productId]: qty } });
  }

  function addToCart(productId: string) {
    if (!productId || draft.cart[productId] !== undefined) return;
    setDraft({ ...draft, cart: { ...draft.cart, [productId]: 1 } });
    setPickerProductId('');
  }

  function removeFromCart(productId: string) {
    const next = { ...draft.cart };
    delete next[productId];
    setDraft({ ...draft, cart: next });
  }

  function saveDraft() {
    showToast('Draft tersimpan');
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!destination) {
      setSubmitError('Pilih cabang tujuan terlebih dahulu');
      return;
    }
    if (cartEntries.length === 0) {
      setSubmitError('Pilih setidaknya satu produk dan jumlahnya');
      return;
    }
    setSubmitting(true);
    try {
      const { transfer } = await createTransfer({
        destination_branch: destination,
        items: cartEntries.map(([product_id, quantity]) => ({ product_id, quantity })),
      });
      setResult({ transferNumber: transfer.transfer_number, destination: BRANCH_NAMES[destination] || destination, totalUnits });
      clearDraft();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal membuat transfer');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <SuccessScreen
        title="Transfer terkirim"
        body="Barang sedang dalam perjalanan ke cabang tujuan."
        summary={[
          { label: 'Nomor', value: result.transferNumber },
          { label: 'Tujuan', value: result.destination },
          { label: 'Total unit', value: String(result.totalUnits) },
          { label: 'Status', value: 'Dikirim' },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  const destinationStepDone = Boolean(destination);
  const productsStepDone = cartEntries.length > 0;

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-12">
      <h2 className="text-[20px] font-bold text-text-primary font-display">Buat Transfer Stok</h2>

      <div className="grid grid-cols-3 gap-2">
        {(['Tujuan', 'Produk', 'Review'] as const).map((label, i) => {
          const done = i === 0 ? destinationStepDone : i === 1 ? productsStepDone : destinationStepDone && productsStepDone;
          return (
            <div key={label} className="flex flex-col gap-1.5">
              <div className={`h-1 rounded-full ${done ? 'bg-danger' : 'bg-border-base'}`} />
              <span className={`text-[10px] font-semibold ${done ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
            </div>
          );
        })}
      </div>

      {loadError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-text-secondary">Cabang tujuan</h3>
            <div className="flex flex-wrap gap-2">
              {BRANCHES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setDestination(b)}
                  className={`h-[38px] rounded-full border px-4 text-[12px] font-bold transition-colors ${
                    destination === b ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
                  }`}
                >
                  {BRANCH_NAMES[b]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-text-secondary">Produk dikirim</h3>
              <span className="text-[11px] text-text-muted">{cartEntries.length} item · {totalUnits} pcs</span>
            </div>

            <div className="flex flex-col gap-2">
              {cartEntries.map(([productId, qty]) => {
                const product = products.find((p) => p.id === productId);
                if (!product) return null;
                const stock = warehouseStock[productId] ?? 0;
                const image = getKnownProductImage(product.name);
                return (
                  <div key={productId} className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-lowest">
                      {image ? (
                        <img src={image} alt={product.name} className="h-full w-full object-contain p-1" />
                      ) : (
                        <Package size={22} className="text-text-muted" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13px] font-bold text-text-primary">{product.name}</h4>
                      <span className="text-[10.5px] text-text-muted">Gudang: {stock} pcs</span>
                    </div>
                    <Stepper value={qty} onChange={(next) => setCartQty(productId, next)} min={0} max={stock} size="xs" />
                    <button
                      type="button"
                      onClick={() => removeFromCart(productId)}
                      className="text-text-muted hover:text-danger w-7 h-7 rounded-full flex items-center justify-center"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-base p-2.5">
              <select
                value={pickerProductId}
                onChange={(e) => setPickerProductId(e.target.value)}
                className="flex-1 bg-transparent text-[12.5px] text-text-primary focus:outline-none"
              >
                <option value="">-- Pilih produk untuk ditambahkan --</option>
                {products.filter((p) => draft.cart[p.id] === undefined).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addToCart(pickerProductId)}
                disabled={!pickerProductId}
                className="text-[12px] font-bold text-primary-container disabled:opacity-40"
              >
                Tambah Produk
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border-base bg-surface-elevated p-4">
            <h3 className="text-[13px] font-semibold text-text-secondary">Review transfer</h3>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Asal</span>
              <span className="font-semibold text-text-primary">Gudang Pusat</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Tujuan</span>
              <span className="font-semibold text-text-primary">{destination ? BRANCH_NAMES[destination] : '-'}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total unit</span>
              <span className="font-semibold text-text-primary">{totalUnits}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Nilai perkiraan</span>
              <span className="font-semibold text-text-primary">{formatRupiah(totalValue)}</span>
            </div>
            {hasProductWithoutPrice && (
              <p className="text-[10.5px] text-status-menipis">Beberapa produk belum punya harga beli — nilai perkiraan mungkin belum lengkap.</p>
            )}
          </div>

          {submitError && (
            <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="h-[46px] rounded-xl bg-primary-container text-white text-[13px] font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              {submitting ? 'Mengirim...' : 'Kirim Transfer'}
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[44px] rounded-xl border border-border-base text-text-primary text-[13px] font-bold active:scale-95 transition-transform"
            >
              Simpan Draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

With the dev server running: open Buat Transfer, pick a destination and add a product with quantity, refresh the page — confirm destination and cart survive (draft persistence working). Confirm the Stepper for a cart row cannot exceed that product's real warehouse stock (try setting it above the shown "Gudang: N pcs" value — the `+` button should stop incrementing at that ceiling). Submit — confirm it lands on `SuccessScreen` with the real transfer number, and that reopening Buat Transfer afterward shows an empty draft (cleared).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/admin/stockist/transfers/new/page.tsx frontend/src/app/admin/stockist/transfers/page.tsx frontend/src/hooks/useUser.ts server/routes/stockist.js
git commit -m "$(cat <<'EOF'
feat(stockist): rebuild Buat Transfer to match spec (§11)

Step indicator, destination chips (was a dropdown), cart rows capped
by real warehouse stock (was never fetched at all — qty could exceed
what the warehouse actually has), Rupiah value calc from
purchase_price, review panel, and a persisted draft so navigating
away doesn't lose progress. "Simpan Draft" is a local-only save +
toast, not a new server-side status — the backend still only has
SENT/RECEIVED. Submitting lands on SuccessScreen.

Also widens AppUser['role'] to include 'manager' and opens transfer
creation to owner-or-manager on both the frontend gate and the
backend check, per spec's "CTA muncul untuk Owner & Manager" — inert
until the separate stockistAccess.js fix lets Manager accounts
authenticate at all.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Notes for the Plan-Level Reviewer

- Cross-task risk to check: Task 3 and Task 4 both import `getKnownProductImage` and both render a photo tile/thumbnail with a `Package` fallback — confirm the two call sites use it consistently (same fallback icon size convention isn't required to match exactly between the two screens since their tile sizes differ by spec, but both should follow the "null → icon, not broken img tag" rule).
- Task 4's `useDraftPersistence` usage stores the entire `{ destination, cart }` object under one localStorage key — verify `clearDraft()` actually empties it after a successful submit (Step 6's manual check covers this, don't skip it).
- Confirm Task 3's new receive page does NOT import `useUser` (it shouldn't need it — gating lives entirely in the `warehouse/page.tsx` link) and that `npx tsc --noEmit` is clean at the end of Task 3.
