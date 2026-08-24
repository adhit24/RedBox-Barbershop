# RedBox Stockist Product Lists Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Produk (both roles), Gudang Pusat, and Stok Cabang each independently match the design handoff's shared product-list pattern (always-visible search+scan+status-chip row, status-dot cards linking to product detail) — three separately-maintained pages restyled/restructured to look and behave consistently, not merged into one shared component.

**Architecture:** Five tasks. Task 1 is a one-line routing bugfix. Tasks 2-5 each restructure one page: Gudang Pusat, Produk (branch_admin path), Produk (Owner path — rewritten from a cross-branch drill-down to a flat single-branch list), and Stok Cabang (its category→brand drill-down removed, reverting to an always-filterable flat list). Every restructured page gets the same visual card pattern (adapted to that page's own data/variable names — these stay 3 separate files, not a shared component) and gets the `BarcodeScannerSheet` (already built) wired into its search bar.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4.

**Spec:** `design_handoff_stockist_mobile/README.md` §5-7 "Produk / Gudang Pusat / Stok Cabang" and `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md`.

## Global Constraints

- **The shared card pattern** (every task below adapts this to its own page's variable names — do not invent a different shape per page):
  ```tsx
  <Link href={<detail href>} className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3 hover:border-primary-container/40 active:scale-[0.98] transition-all">
    <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
      <img src={<image url>} alt={<name>} className="h-full w-full object-cover" />
      <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[status]}`} />
    </div>
    <div className="min-w-0 flex-1">
      <h4 className="truncate text-[13.5px] font-bold text-text-primary">{<name>}</h4>
      <span className="block text-[10px] font-mono text-text-muted">{<sku>}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="rounded border border-border-base bg-surface-container px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary">{<category>}</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
      </div>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[status]}`}>{<qty>}</span>
      <span className="text-[9px] text-text-muted">{<unit>}</span>
    </div>
    <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
  </Link>
  ```
- **The shared status derivation and class lookups** (every task defines its own local copy of these — a small top-level helper + 4 `Record` lookups in each file, not imported from a shared module, consistent with these staying 3 separate files):
  ```ts
  type StockStatus = 'AMAN' | 'MENIPIS' | 'HABIS';

  function stockStatusFor(qty: number, minimumStock: number): StockStatus {
    if (qty === 0) return 'HABIS';
    if (qty <= minimumStock) return 'MENIPIS';
    return 'AMAN';
  }

  const STATUS_DOT: Record<StockStatus, string> = { AMAN: 'bg-success', MENIPIS: 'bg-status-menipis', HABIS: 'bg-danger' };
  const STATUS_BADGE: Record<StockStatus, string> = { AMAN: 'bg-tint-success text-success', MENIPIS: 'bg-tint-warning text-status-menipis', HABIS: 'bg-tint-danger text-danger' };
  const STATUS_TEXT: Record<StockStatus, string> = { AMAN: 'text-text-primary', MENIPIS: 'text-status-menipis', HABIS: 'text-danger' };
  const STATUS_LABEL: Record<StockStatus, string> = { AMAN: 'Aman', MENIPIS: 'Menipis', HABIS: 'Habis' };
  ```
  Uses `minimum_stock` only for the threshold (not `reorder_point`) — matches the one existing correct reference implementation in this codebase (`branch-stock/all/page.tsx`'s own status derivation) and avoids the still-open, unrelated gap-audit question of whether `reorder_point` should always equal `minimum_stock + 4`.
- **The shared status-chip row** (every task adds this near its search bar, always visible — never hidden inside a `BottomSheet` or a `<select>`):
  ```tsx
  <div className="sc flex gap-2 overflow-x-auto pb-1">
    {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
      <button
        key={value}
        type="button"
        onClick={() => <set filter state to value>}
        className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
          <filter state> === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
        }`}
      >
        {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
      </button>
    ))}
  </div>
  ```
- **The shared scan-icon search bar pattern** (every task adds this to its existing search input):
  ```tsx
  <div className="relative">
    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
    <input
      /* ...existing props unchanged... */
      className="w-full rounded-lg border border-border-base bg-surface-container-lowest py-2 pl-9 pr-10 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
    />
    <button
      type="button"
      onClick={() => setScannerOpen(true)}
      aria-label="Scan barcode produk"
      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
    >
      <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
    </button>
  </div>
  <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
  ```
  Every task's `handleScan(code: string)` matches the scanned code against `barcode` (never `sku`) on that page's already-loaded product list, then sets the page's own search-query state to the matched product's `sku` (surfacing it through the existing search filter — no new lookup UI). On no match, shows an inline error using the same pattern already used elsewhere on that page (a `bg-danger/10 border border-danger text-danger` banner) reading "Produk dengan barcode ini tidak ditemukan."
- `EmptyState`'s existing `action?: { label: string; onClick: () => void }` prop (already built in an earlier plan) gets used everywhere a "Reset filter" action makes sense — passing `action={{ label: 'Reset filter', onClick: () => { <clear search+chip state> } }}`.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` for every task.

---

### Task 1: Fix the header's search button routing for Admin Cabang

**Files:**
- Modify: `frontend/src/app/admin/stockist/layout.tsx:124`

**Interfaces:**
- Produces: nothing new — a one-line routing fix.

- [ ] **Step 1: Fix `searchHref`**

Re-read `frontend/src/app/admin/stockist/layout.tsx` around line 124 to confirm it still reads:

```tsx
  const searchHref = isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock';
```

Change to:

```tsx
  const searchHref = isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock/all';
```

(The header's search button was routing branch_admin to `/admin/stockist/branch-stock`, a stats dashboard with no search field — not `/admin/stockist/branch-stock/all`, the actual searchable product list.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/layout.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): route Admin Cabang's header search button to the actual product list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Restructure Gudang Pusat

**Files:**
- Modify: `frontend/src/app/admin/stockist/warehouse/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>` (`frontend/src/components/stockist/BarcodeScannerSheet.tsx`, already built — props `{ open, onClose, onScan }`).
- Produces: no new exports.

Do NOT touch the inline "Terima Barang" form (lines ~182-248) — only the search section (~250-262) and the product-list section (~264-329) change. Do NOT touch the Bento Metric Grid's top two tiles (Total Produk/Total Pcs Fisik, lines ~120-141) — only the "Stok Menipis" and "Filter Reset/Overview" tiles' filtering role is replaced by the new chip row.

- [ ] **Step 1: Re-read the current file in full**

Re-read `frontend/src/app/admin/stockist/warehouse/page.tsx` in full to confirm the brief's assumed line numbers/content for the search section, the product-list section, the metric-tile filter tiles, and the `filterType` state/predicate still match — this file was last touched by an earlier task in a different plan (added `useSearchParams`/Suspense wrapping for a `?filter=` param) and may have shifted since.

- [ ] **Step 2: Add the imports**

Add to the top-level imports:

```ts
import Link from 'next/link';
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

- [ ] **Step 3: Add the status-derivation helpers and `StockStatus` type**

Add near the top of the file (after the `BRANCH_NAMES`-style constants, before the component function):

```ts
type StockStatus = 'AMAN' | 'MENIPIS' | 'HABIS';

function stockStatusFor(qty: number, minimumStock: number): StockStatus {
  if (qty === 0) return 'HABIS';
  if (qty <= minimumStock) return 'MENIPIS';
  return 'AMAN';
}

const STATUS_DOT: Record<StockStatus, string> = { AMAN: 'bg-success', MENIPIS: 'bg-status-menipis', HABIS: 'bg-danger' };
const STATUS_BADGE: Record<StockStatus, string> = { AMAN: 'bg-tint-success text-success', MENIPIS: 'bg-tint-warning text-status-menipis', HABIS: 'bg-tint-danger text-danger' };
const STATUS_TEXT: Record<StockStatus, string> = { AMAN: 'text-text-primary', MENIPIS: 'text-status-menipis', HABIS: 'text-danger' };
const STATUS_LABEL: Record<StockStatus, string> = { AMAN: 'Aman', MENIPIS: 'Menipis', HABIS: 'Habis' };
```

- [ ] **Step 4: Widen `filterType` to a real 4-state chip filter and fix the status derivation**

Change the `filterType` type and its initializer (currently `useState<'ALL' | 'LOW' | 'SAFE'>(...)`) to:

```tsx
  const initialFilter = searchParams?.get('filter');
  const [filterType, setFilterType] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>(
    initialFilter === 'AMAN' || initialFilter === 'MENIPIS' || initialFilter === 'HABIS' ? initialFilter : 'ALL'
  );
```

(Kept reading the same `?filter=` param name for backward compatibility with the "Perlu Perhatian" stat card on Beranda Owner, which already links here with `?filter=LOW` — that value no longer matches any of the new 3 states, so it'll just fall through to `'ALL'`. This is acceptable: fixing that link is out of scope for this task, and falling back to `'ALL'` rather than crashing or matching nothing is the safe default. Note this for the final review to flag as a possible follow-up, not something to fix here.)

Change `productStats`'s derivation (currently `const isLow = qty <= p.minimum_stock;`) to:

```tsx
  const productStats = products.map(p => {
    const qty = quantityByProduct.get(p.id) ?? 0;
    const status = stockStatusFor(qty, p.minimum_stock);
    return { ...p, qty, status };
  });
```

Change the filter predicate (currently referencing `p.isLow`) to:

```tsx
  const filteredProducts = productStats.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'ALL' || p.status === filterType;
    return matchesSearch && matchesFilter;
  });
```

Change `lowStockCount` (currently `productStats.filter(p => p.isLow).length`, which — per the old buggy `isLow`'s `<=` — counted both Menipis and Habis together) to count only Menipis, matching the metric tile's own label "Stok Menipis":

```tsx
  const lowStockCount = productStats.filter(p => p.status === 'MENIPIS').length;
```

- [ ] **Step 5: Replace the "Stok Menipis"/"Filter Reset" tiles' onClick with the new chip row**

The two metric tiles that currently toggle `filterType` (the "Low Stock Items" tile and the "Filter Reset / Overview" tile) keep their existing display role (showing counts) but their `onClick` handlers should be simplified to just reset/set the filter consistent with the new 3-state type — change:

```tsx
            onClick={() => setFilterType(filterType === 'LOW' ? 'ALL' : 'LOW')}
```

to:

```tsx
            onClick={() => setFilterType(filterType === 'MENIPIS' ? 'ALL' : 'MENIPIS')}
```

and the reset tile's `onClick={() => setFilterType('ALL')}` stays as-is (already correct for the new type).

- [ ] **Step 6: Add the status chip row and scan-enabled search bar**

Add `scannerOpen` state near the other `useState` calls:

```tsx
  const [scannerOpen, setScannerOpen] = useState(false);
```

Add the scan handler, near `handleReceive`:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

Change the search `<section>` (currently just the search input, no chip row) from:

```tsx
      {/* Search Bar */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nama atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
      </section>
```

to:

```tsx
      {/* Search Bar */}
      <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-sm">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nama atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterType(value)}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                filterType === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </section>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

- [ ] **Step 7: Replace the product-list cards with the shared status-dot pattern, linked to detail**

Change the product-list map (currently non-`<Link>` `<div>`s, exact block shown in Global Constraints' context) from:

```tsx
            filteredProducts.map((p) => (
              <div 
                key={p.id} 
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3 hover:bg-surface-container transition-colors"
              >
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg bg-surface-container-lowest border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                  <img 
                    className="w-full h-full object-cover opacity-85 mix-blend-luminosity" 
                    src={getProductImage(p.sku, p.name)} 
                    alt={p.name} 
                  />
                </div>

                {/* Core Info */}
                <div className="flex-1 flex flex-col justify-center min-h-[48px]">
                  <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{p.name}</h4>
                  <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {p.sku}</span>
                </div>

                {/* Balance & Status */}
                <div className="flex flex-col items-end justify-center min-h-[48px]">
                  <p className="text-[18px] font-bold text-text-primary font-display tabular-nums leading-tight">
                    {p.qty}
                  </p>
                  <span className={`text-[10px] font-semibold mt-1 flex items-center gap-1.5 ${
                    p.isLow ? 'text-status-menipis' : 'text-status-aman'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      p.isLow ? 'bg-status-menipis animate-pulse' : 'bg-status-aman'
                    }`}></span>
                    {p.isLow ? 'Menipis' : 'Aman'}
                  </span>
                </div>
              </div>
            ))
```

to:

```tsx
            filteredProducts.map((p) => (
              <Link
                key={p.id}
                href={`/admin/stockist/branch-stock/all/${p.id}?branch=warehouse`}
                className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3 hover:border-primary-container/40 active:scale-[0.98] transition-all"
              >
                <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                  <img
                    className="h-full w-full object-cover opacity-85 mix-blend-luminosity"
                    src={getProductImage(p.sku, p.name)}
                    alt={p.name}
                  />
                  <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[p.status]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13.5px] font-bold text-text-primary">{p.name}</h4>
                  <span className="block text-[10px] font-mono text-text-muted">{p.sku}</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {p.category && (
                      <span className="rounded border border-border-base bg-surface-container px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary">{p.category}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[p.status]}`}>{p.qty}</span>
                  <span className="text-[9px] text-text-muted">{p.unit}</span>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
              </Link>
            ))
```

(The detail route is `branch-stock/all/[id]/page.tsx`, the one existing, working product-detail route in this app — confirmed it reads `branch` from `?branch=` for an owner viewer; `warehouse` is a valid location slug for it since the route treats `branch` as a generic location parameter for `getInventorySummary`.)

- [ ] **Step 8: Migrate the empty state to the shared `EmptyState` component**

Find where `filteredProducts.length === 0` currently renders (a plain `<p>`), and replace it with:

```tsx
import { EmptyState } from '@/components/stockist/EmptyState';
```

(add to imports), then:

```tsx
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon="inventory_2"
              title="Tidak ada produk"
              subtitle="Coba ubah kata kunci pencarian atau filter status."
              action={{ label: 'Reset filter', onClick: () => { setSearchQuery(''); setFilterType('ALL'); } }}
            />
          ) : (
```

(replacing whatever the current plain-paragraph empty-state JSX is — re-read the file to find its exact current form before this edit, since the brief text above only shows the target, not a verbatim current-state quote for this specific spot.)

- [ ] **Step 9: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/admin/stockist/warehouse/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): restructure Gudang Pusat to match the shared product-list pattern

Always-visible status chips (replacing tile-click filtering), scan
icon wired to BarcodeScannerSheet, status-dot cards linking to
product detail (replacing non-interactive rows), reset-filter empty
state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Restructure Produk (Admin Cabang path)

**Files:**
- Modify: `frontend/src/app/admin/stockist/products/page.tsx` (the default-exported `ProductsPage` function only — NOT `OwnerInventoryView`, that's Task 4)

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>`, `getInventorySummary` (already exported from `stockistApi.ts`, not yet called in this component).
- Produces: no new exports.

This branch_admin view currently fetches no stock quantity at all — this task adds a `getInventorySummary(user.branch)` call. The existing Edit/Deactivate buttons and inline edit form must stay working — the card's clickable `<Link>` wraps only the identity/display portion (photo, name, SKU, badges, qty), NOT the action buttons or the inline edit form, which render as a separate block below/outside the `Link`. A `<button>` nested inside a `<Link>`/`<a>` is invalid HTML and breaks click handling — do not nest them.

- [ ] **Step 1: Re-read the current file in full**

Re-read `frontend/src/app/admin/stockist/products/page.tsx` in full (665 lines — both the default-exported branch_admin view and `OwnerInventoryView` further down; this task only touches the former) to confirm the brief's assumed structure for the search input, the status/category chip rows, the card block (identity + Edit/Deactivate buttons + inline edit `<form>`), and `refresh()`/data state still match.

- [ ] **Step 2: Add the imports and fetch stock balances**

Add to imports:

```ts
import { getInventorySummary } from '@/lib/stockistApi';
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

(`getInventorySummary` may already be imported if `stockistApi.ts`'s import line already lists other functions — add it to that existing import statement rather than a duplicate one; re-read the current import block to confirm.)

Add a `balances` state near the other `useState` calls:

```ts
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
```

(add `InventoryBalance` to the `stockistApi.ts` type imports if not already present.)

Change `refresh()` to also fetch balances for the user's own branch:

```tsx
  async function refresh() {
    setLoading(true);
    try {
      const [{ products }, { balances }] = await Promise.all([
        listProducts(),
        getInventorySummary(user?.branch || ''),
      ]);
      setProducts(products);
      setBalances(balances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat produk');
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 3: Add status derivation and a `qtyByProduct` map**

Add near the top of the file (module scope, before the component function):

```ts
type StockStatus = 'AMAN' | 'MENIPIS' | 'HABIS';

function stockStatusFor(qty: number, minimumStock: number): StockStatus {
  if (qty === 0) return 'HABIS';
  if (qty <= minimumStock) return 'MENIPIS';
  return 'AMAN';
}

const STATUS_DOT: Record<StockStatus, string> = { AMAN: 'bg-success', MENIPIS: 'bg-status-menipis', HABIS: 'bg-danger' };
const STATUS_BADGE: Record<StockStatus, string> = { AMAN: 'bg-tint-success text-success', MENIPIS: 'bg-tint-warning text-status-menipis', HABIS: 'bg-tint-danger text-danger' };
const STATUS_TEXT: Record<StockStatus, string> = { AMAN: 'text-text-primary', MENIPIS: 'text-status-menipis', HABIS: 'text-danger' };
const STATUS_LABEL: Record<StockStatus, string> = { AMAN: 'Aman', MENIPIS: 'Menipis', HABIS: 'Habis' };
```

Inside the component, before the `filteredProducts` computation, add:

```ts
  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
```

- [ ] **Step 4: Replace the `ACTIVE/INACTIVE/ALL` status chip row's filtering role — add a real stock-status chip row alongside it**

The existing `Aktif`/`Nonaktif`/`Semua Status` chip row (product active/inactive state) is a DIFFERENT concept from stock status — keep it as-is, do not remove or rename it. Add a NEW, second chip row for stock status. Add `stockFilter` state near the other filter state:

```ts
  const [stockFilter, setStockFilter] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>('ALL');
```

Add `scannerOpen` state:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
```

Add the scan handler near `handleCreate`:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

Update the `filteredProducts` predicate to also check `stockFilter` (using each product's derived status via `qtyByProduct`):

```tsx
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || p.category === selectedCategory;
    const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? p.is_active : !p.is_active);
    const qty = qtyByProduct.get(p.id) ?? 0;
    const stockStatus = stockStatusFor(qty, p.minimum_stock);
    const matchesStock = stockFilter === 'ALL' || stockStatus === stockFilter;
    return matchesSearch && matchesCategory && matchesStatus && matchesStock;
  });
```

(Re-read the current predicate first — the variable names above, e.g. `statusFilter`, must match whatever the live file actually calls its existing active/inactive filter state; adjust names to match reality, not this brief's guess, if they differ.)

Add the scan icon to the existing search input (same pattern as Task 2 Step 6 — add `pr-10` and the scan button, add `<BarcodeScannerSheet>`), and add the new stock-status chip row directly below the existing `Aktif/Nonaktif/Semua Status` row:

```tsx
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStockFilter(value)}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
```

- [ ] **Step 5: Restructure the product card — identity area becomes a `Link`, actions stay outside it**

Re-read the current card block (currently a plain `<div>` containing: thumbnail+name+SKU+is_active-badge, a "Kategori & Unit"/"Harga Jual" grid, then conditionally the Edit/Deactivate buttons or the inline edit form). Restructure it to this shape — an outer plain `<div>` (unchanged, keeps the card's border/padding/key), with a `<Link>` wrapping only the top identity section, and the details grid + actions + inline form staying as siblings after the `Link`, not inside it:

```tsx
              <div 
                key={p.id} 
                className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 hover:bg-surface-container transition-colors"
              >
                <Link href={`/admin/stockist/branch-stock/all/${p.id}?branch=${user?.branch || ''}`} className="flex items-center gap-3">
                  <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                    <img
                      className="h-full w-full object-cover opacity-85 mix-blend-luminosity"
                      src={getProductImage(p.sku, p.name)}
                      alt={p.name}
                    />
                    <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13.5px] font-bold text-text-primary">{p.name}</h3>
                    <span className="block text-[10px] font-mono text-text-muted">{p.sku}</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border ${
                        p.is_active
                          ? 'bg-success/10 border-success/30 text-success'
                          : 'bg-danger/10 border-danger/30 text-danger'
                      }`}>
                        {p.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`}>
                        {STATUS_LABEL[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[stockStatusFor(qtyByProduct.get(p.id) ?? 0, p.minimum_stock)]}`}>
                      {qtyByProduct.get(p.id) ?? 0}
                    </span>
                    <span className="text-[9px] text-text-muted">{p.unit}</span>
                  </div>
                  <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
                </Link>

                {/* existing "Kategori & Unit" / "Harga Jual" details grid, Edit/Deactivate buttons, and inline edit form
                    stay exactly as they are today, unindented as siblings after the Link above — do not move them
                    inside the Link, do not delete them, do not change their own internal logic */}
              </div>
```

(Re-read the file to find the exact current details-grid/actions/inline-form JSX and keep it verbatim as a sibling block after the new `Link` — only the identity row above it changes.)

- [ ] **Step 6: Migrate the empty state**

Find the current bare-paragraph empty state (`products.length === 0` / `filteredProducts.length === 0` — re-read to confirm which) and replace it with `<EmptyState>` (import it if not already), following the same pattern as Task 2 Step 8, with an `action` resetting `searchQuery`, `selectedCategory`/whatever the existing category filter state is called, `statusFilter`, and the new `stockFilter`.

- [ ] **Step 7: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/admin/stockist/products/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): restructure Produk (Admin Cabang) to match the shared product-list pattern

Added stock-quantity data (previously never fetched here), a stock-
status chip row alongside the existing active/inactive one, status-
dot cards linking to product detail, scan icon. Edit/Deactivate
actions and the inline edit form stay outside the new Link so they
keep working exactly as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite Produk (Owner path) as a flat single-branch list

**Files:**
- Modify: `frontend/src/app/admin/stockist/products/page.tsx` (the `OwnerInventoryView` function only)

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>`, the same `stockStatusFor`/`STATUS_*` helpers Task 3 adds to this same file (reuse them, do not redefine).

Per an explicit product decision, this replaces `OwnerInventoryView`'s current cross-branch aggregation/expand-to-drill-down model with a flat, single-branch list — the owner picks one branch (a `<select>`, already exists in some form today) and sees that branch's products as status-dot cards, same shape as every other page in this plan, each clickable straight to product detail. The multi-branch-at-a-glance expand view is intentionally dropped.

- [ ] **Step 1: Re-read `OwnerInventoryView` in full**

Re-read `frontend/src/app/admin/stockist/products/page.tsx`'s `OwnerInventoryView` function (roughly lines 588-665, confirm current bounds) in full, including its `OWNER_BRANCHES` constant, its `useEffect` data-fetching (`Promise.all([listProducts(), ...OWNER_BRANCHES.map(([slug]) => getInventorySummary(slug))])`), its `rows`/`expandedId`/`visibleCount` state, and its current `query`/`status`/`branch` filter `<select>`s.

- [ ] **Step 2: Replace the data model — fetch one branch at a time**

Change the `useEffect` to fetch only the currently-selected branch's balances instead of all 5 in parallel, following the exact pattern already used correctly by `frontend/src/app/admin/stockist/branch-stock/all/page.tsx` (re-read that file's own `useEffect`/`branch` `useState` for the precise shape to mirror — it already does exactly this: `useState` for `branch` defaulting to `'bypass'`, an effect keyed on `[branch]` calling `Promise.all([listProducts(), getInventorySummary(branch)])`).

Rewrite `OwnerInventoryView`'s state and data-fetching to:

```tsx
function OwnerInventoryView() {
  const PAGE_SIZE = 8;
  const [branch, setBranch] = useState<string>('bypass');
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'AMAN' | 'MENIPIS' | 'HABIS'>('ALL');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => {
        setProducts(products.filter((product) => product.is_active));
        setBalances(balances);
        setVisibleCount(PAGE_SIZE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat produk cabang'))
      .finally(() => setLoading(false));
  }, [branch]);

  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }

  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const rows = products
    .map((product) => {
      const qty = qtyByProduct.get(product.id) ?? 0;
      return { product, qty, status: stockStatusFor(qty, product.minimum_stock) };
    })
    .filter((row) => {
      const text = `${row.product.name} ${row.product.sku}`.toLowerCase();
      return text.includes(query.toLowerCase()) && (stockFilter === 'ALL' || row.status === stockFilter);
    });
  const visibleRows = rows.slice(0, visibleCount);
  const hasMoreRows = visibleCount < rows.length;
```

(This drops `expandedId`, `distribution`, `productStatus` derived across all 5 branches, and the whole `OWNER_BRANCHES.map(...)` per-row aggregation — all specific to the old cross-branch view being replaced. `PAGE_SIZE`, pagination, `error`/`loading` states stay conceptually the same, just simplified to single-branch data.)

- [ ] **Step 3: Replace the render — branch selector, search+scan+chips, flat status-dot cards**

Replace the whole return statement's body (the header, the search/status/branch `<select>`s, and the `rows.map(...)` expand/collapse card block) with:

```tsx
  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <BackButton fallbackHref="/admin/stockist" />
      <header>
        <p className="text-[10px] uppercase tracking-[0.18em] text-primary-container font-semibold">Owner · Decision view</p>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Produk</h2>
        <p className="text-[12px] text-text-muted mt-1">{BRANCH_NAMES[branch] || branch}</p>
      </header>

      <div className="flex flex-col gap-2">
        <select
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          className="w-full rounded-lg border border-border-base bg-surface-container-lowest px-3 py-2.5 text-xs text-text-secondary"
        >
          {OWNER_BRANCHES.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
        </select>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder="Cari produk atau SKU"
            className="w-full rounded-lg border border-border-base bg-surface-container-lowest py-2.5 pl-9 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:border-primary-container focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'AMAN', 'MENIPIS', 'HABIS'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setStockFilter(value); setVisibleCount(PAGE_SIZE); }}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'AMAN' ? 'Aman' : value === 'MENIPIS' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </div>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      {error && <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-3">{error}</div>}
      {loading ? (
        <div className="py-12 text-center text-text-muted text-sm">Memuat produk…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title="Tidak ada produk"
          subtitle="Coba ubah kata kunci pencarian atau filter status."
          action={{ label: 'Reset filter', onClick: () => { setQuery(''); setStockFilter('ALL'); } }}
        />
      ) : (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wide">Produk</h3>
            <span className="text-[11px] text-text-muted">Menampilkan {visibleRows.length} dari {rows.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {visibleRows.map((row) => (
              <Link
                key={row.product.id}
                href={`/admin/stockist/branch-stock/all/${row.product.id}?branch=${branch}`}
                className="flex items-center gap-3 rounded-xl border border-border-base bg-surface-elevated p-3 hover:border-primary-container/40 active:scale-[0.98] transition-all"
              >
                <div className="relative h-[66px] w-[66px] shrink-0 overflow-hidden rounded-xl border border-border-base bg-surface-container-lowest">
                  {getKnownProductImage(row.product.name) ? (
                    <img src={getKnownProductImage(row.product.name) as string} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center material-symbols-outlined text-text-muted">inventory_2</span>
                  )}
                  <span className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${STATUS_DOT[row.status]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13.5px] font-bold text-text-primary">{row.product.name}</h4>
                  <span className="block text-[10px] font-mono text-text-muted">{row.product.sku}</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {row.product.category && (
                      <span className="rounded border border-border-base bg-surface-container px-1.5 py-0.5 text-[9px] font-semibold text-text-secondary">{row.product.category}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`text-[19px] font-bold font-display tabular-nums ${STATUS_TEXT[row.status]}`}>{row.qty}</span>
                  <span className="text-[9px] text-text-muted">{row.product.unit}</span>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
              </Link>
            ))}
          </div>
          {hasMoreRows && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="w-full min-h-[44px] rounded-xl border border-border-base bg-surface-elevated text-[12px] font-semibold text-text-secondary hover:border-primary-container hover:text-text-primary transition-colors"
            >
              Tampilkan {Math.min(PAGE_SIZE, rows.length - visibleCount)} produk berikutnya
            </button>
          )}
        </section>
      )}
    </div>
  );
}
```

(`OWNER_BRANCHES` — the existing module-level constant of `[slug, label]` pairs — stays, reused for the branch `<select>`'s options. `BRANCH_NAMES` — the file's other existing constant — is reused for the header subtitle. `getKnownProductImage` is already imported at the top of this file per Task 3's context. `EmptyState`, `BarcodeScannerSheet`, `Link` are already imported by this point if Task 3 ran first in the same file — re-read the current import block before adding anything, to avoid a duplicate import.)

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/products/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): rewrite Produk (Owner) as a flat single-branch list

Per explicit product decision, replaces the cross-branch aggregation/
expand-to-drill-down view with a flat list matching the shared
product-list pattern — branch selector, status chips, scan icon,
status-dot cards linking to product detail.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Restructure Stok Cabang — remove the category/brand drill-down

**Files:**
- Modify: `frontend/src/app/admin/stockist/branch-stock/all/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>`.
- Produces: no new exports.

Per explicit product decisions: the CATEGORY/FLAT view-mode toggle and its grouped/brand-drill-down rendering are removed entirely (the page always renders flat); the category pills row is also removed entirely (matching the mockup's single status-chip row, no separate category filter row); the status chips move from inside a `BottomSheet` to always-visible, directly under the search bar; the flat card gains the missing 12px status dot.

- [ ] **Step 1: Re-read the current file in full**

Re-read `frontend/src/app/admin/stockist/branch-stock/all/page.tsx` in full (605 lines) to confirm the brief's assumed line ranges for: the `viewMode` toggle buttons, the two CATEGORY-mode JSX blocks, the category pills slider, the search+Filter-button row, the `BottomSheet`'s status/type chip groups, and the FLAT-mode card block all still match.

- [ ] **Step 2: Remove the dead state, helpers, and imports**

Remove these state declarations entirely:
```ts
const [viewMode, setViewMode] = useState<'CATEGORY' | 'FLAT'>('CATEGORY');
const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({});
const [selectedCategory, setSelectedCategory] = useState<string>(initialCategoryParam || 'ALL');
```
(`selectedCategory` and its `initialCategoryParam`/`updateCategoryUrl` support are removed because the category pills row that consumed them is also being removed per Step 4 below — confirm nothing else in the file still reads `selectedCategory` before deleting; if something unexpected still depends on it, stop and report rather than guessing.)

Remove the `updateCategoryUrl` function and the `toggleBrandCollapse` function entirely.

Remove `categoryGroups` (`const categoryGroups = groupProductsByCategoryAndBrand(filteredProducts);`) and its import (`groupProductsByCategoryAndBrand`, `type CategoryGroup`) — keep `getCategoryForProduct`/`getBrandForProduct`/`type StandardCategory` since `inferredCategory`/`inferredBrand` per-product fields (used for search matching and card display) still exist independent of the grouped view.

Remove `Layers`, `Grid`, `ArrowLeft`, `ChevronDown`, `ChevronUp` from the `lucide-react` import — keep `Package` (still used by the flat card's image fallback).

Remove `matchesCategory` from the `filteredProducts` predicate (it referenced the now-removed `selectedCategory`) — the predicate becomes just `matchesSearch && matchesType && matchesStock`.

- [ ] **Step 3: Remove the dead JSX blocks**

Remove the `viewMode` toggle button pair (the `Layers`/`Grid` pill switch in the header row) entirely.

Remove the category pills slider section (the horizontally-scrolling row of category buttons with count badges) entirely.

Remove both CATEGORY-mode conditional JSX blocks — the "Overview of Categories" block and the "Focused Category View with Brands" block — entirely. The FLAT-mode rendering becomes the only rendering path (no `viewMode === 'FLAT' ? ... : ...` conditional needed anymore — just render the flat grid directly).

- [ ] **Step 4: Move the status/type chips out of the `BottomSheet`, remove the "Filter" button**

The `BottomSheet` currently holds both a `Semua/Aman/Menipis/Habis` status chip group and a separate `typeFilter` (Jenis Barang) chip group. Per this plan's shared pattern, the status chips become always-visible directly under the search bar (mirroring Tasks 2-4's identical chip row). The `typeFilter` group can stay inside a (now status-chip-free) `BottomSheet`, still opened by a "Filter" button — that's a different, unrelated filter dimension not covered by this plan's shared pattern, and removing it isn't part of any decision made for this plan.

Change the search `<section>` (currently a `flex gap-2` row with the search input + "Filter" button) from:

```tsx
      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
        <button
          onClick={() => setFilterSheetOpen(true)}
          className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[13px] font-semibold ${
            activeFilterCount > 0 ? 'border-primary-container text-primary-container bg-primary-container/10' : 'border-border-base text-text-secondary'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          {activeFilterCount > 0 ? `Filter · ${activeFilterCount}` : 'Filter'}
        </button>
      </section>
```

to:

```tsx
      <section className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
            <input
              type="text"
              placeholder="Cari produk atau SKU"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
              className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              aria-label="Scan barcode produk"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
            >
              <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
            </button>
          </div>
          <button
            onClick={() => setFilterSheetOpen(true)}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[13px] font-semibold ${
              typeFilter !== 'ALL' ? 'border-primary-container text-primary-container bg-primary-container/10' : 'border-border-base text-text-secondary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            {typeFilter !== 'ALL' ? 'Filter · 1' : 'Filter'}
          </button>
        </div>
        <div className="sc flex gap-2 overflow-x-auto pb-1">
          {(['ALL', 'SAFE', 'LOW', 'OUT'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setStockFilter(value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                stockFilter === value ? 'border-primary-container bg-primary-container text-white' : 'border-border-base bg-surface-elevated text-text-secondary'
              }`}
            >
              {value === 'ALL' ? 'Semua' : value === 'SAFE' ? 'Aman' : value === 'LOW' ? 'Menipis' : 'Habis'}
            </button>
          ))}
        </div>
      </section>
      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

(This file already has a correctly-typed `stockFilter: 'ALL' | 'SAFE' | 'LOW' | 'OUT'` state — reused as-is here, values kept exactly as they already are in this file, unlike Tasks 2-4 which introduce a fresh `'AMAN'|'MENIPIS'|'HABIS'` naming; do not rename this file's existing `SAFE`/`LOW`/`OUT` values, only change where the chip row lives. `activeFilterCount` — previously counting both `stockFilter !== 'ALL'` and `typeFilter !== 'ALL'` together for the Filter button's badge — is replaced by checking `typeFilter !== 'ALL'` alone, since stock-status is no longer inside that sheet; re-read the current `activeFilterCount` computation and simplify it to only reflect `typeFilter`, or remove the variable and inline the check as shown above if it's not used elsewhere.)

Add `scannerOpen` state and the scan handler, near this file's other `useState` calls:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
```

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
      setVisibleCount(PRODUCT_PAGE_SIZE);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

Add the import:

```ts
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

Remove the now-empty/redundant status-chip block from inside the `BottomSheet` (the `<h4>Status Stok</h4>` + chip-button-map block) — leave the `typeFilter` ("Jenis Barang") chip group and the Reset/Apply buttons inside the `BottomSheet` as they are.

- [ ] **Step 5: Add the missing 12px status dot to the flat card**

Change the flat card's photo container (currently `aspect-square` with an overlaid category-name badge chip, no status dot) — add a status dot in the same bottom-left-corner position and sizing used by Tasks 2-4's shared card pattern:

```tsx
  <div className="aspect-square bg-surface-container-low flex items-center justify-center overflow-hidden relative">
    {image ? (
      <img className="w-full h-full object-contain p-3 opacity-90" src={image} alt={p.name} />
    ) : (
      <Package size={32} className="text-text-muted" aria-hidden />
    )}
    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-surface-container-lowest/80 text-text-secondary border border-border-base backdrop-blur-sm">
      {p.inferredCategory}
    </span>
    <span className={`absolute bottom-2 left-2 h-3 w-3 rounded-full border-[2.5px] border-surface-elevated ${
      p.status === 'OUT' ? 'bg-danger' : p.status === 'LOW' ? 'bg-status-menipis' : 'bg-success'
    }`} />
  </div>
```

(Only the addition of the new `<span>` status dot at the end — the rest of this block, including the existing top-left category badge, stays unchanged. This file's own `p.status` values are already `'SAFE'|'LOW'|'OUT'`, matching what this dot's inline conditional expects — no new derivation needed here, this file already computes status correctly.)

- [ ] **Step 6: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. Pay particular attention to any leftover reference to `viewMode`, `selectedCategory`, `collapsedBrands`, `categoryGroups`, `updateCategoryUrl`, or `toggleBrandCollapse` that Step 2/3 might have missed — a leftover reference to a deleted variable is a real compile error here, not a silent runtime issue, so `tsc` will catch it directly.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/admin/stockist/branch-stock/all/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): remove Stok Cabang's category/brand drill-down, always-visible status chips

Per explicit product decision. Status chips move out of a BottomSheet
to always-visible under the search bar; category pills and the
category→brand grouped view are removed entirely; the flat card
gains the spec'd 12px status dot it was missing; scan icon wired in.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---
