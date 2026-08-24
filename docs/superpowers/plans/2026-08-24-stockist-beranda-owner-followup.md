# RedBox Stockist Beranda Owner Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Beranda Owner (`OwnerCommandCenter`) gaps found in the design-handoff audit, per 3 explicit user decisions: navigate instead of BottomSheet on 2 stat cards, add product SKU to the "Perlu perhatian" rows (needs a small backend addition), and consolidate the duplicated "Aset per lokasi" visualization into one per-location-tinted panel.

**Architecture:** Four tasks. Task 1 is the one approved backend change (adds `product_sku` to an existing dashboard endpoint's response). Tasks 2-4 are frontend: URL-param filter support on the Gudang Pusat page, the stat-card navigation + SKU display change, and the Aset-per-lokasi consolidation.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Express/Supabase.

**Spec:** `design_handoff_stockist_mobile/README.md` §2 "Beranda — Owner & Manager" and `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md` items 6-8 (all 3 explicitly approved by the user on 2026-08-24).

## Global Constraints

- Task 1 is an **explicitly-approved exception** to this effort's usual frontend-only default — the user confirmed adding `product_sku` to the dashboard assets endpoint (an additive field on an existing response, no schema/migration change).
- The real `location_id` values in this system are Postgres UUIDs (verified directly against the production database), NOT human-readable slugs — do not build any lookup keyed on assumed slug strings like `'bypass'`/`'warehouse'`. The only stable, available-without-a-second-backend-change signal for identifying which physical location a row represents is `location.type` (`'warehouse' | 'branch'`) combined with the human-readable `location_name` string, which is confirmed (queried directly from production) to always take the form `"RedBox <Branch>"` for branches (e.g. `"RedBox Bypass"`, `"RedBox CSB Mall"`, `"RedBox Samadikun"`, `"RedBox Sumber"`, `"RedBox Tegal"`) and `null`/absent for the warehouse (which instead gets the display name `"Gudang Pusat"` assigned server-side).
- This repo has no automated test suite for the frontend. The backend has some test files (`server/test/*.test.js`) but no confirmed runnable command in this session — verification for Task 1 is `node -c` (syntax) plus manual reasoning about the change being a pure additive field; verification for Tasks 2-4 is `npx tsc --noEmit`.
- Only change the 2 stat cards' click behavior in Task 3 (`Perlu Perhatian`, `Transfer Berjalan`) — do NOT touch the separate "Perlu perhatian" list section further down `OwnerCommandCenter` (its own "Lihat semua" button opens the same BottomSheet and is explicitly out of scope, per the user's decision being narrowly about the stat cards).

---

### Task 1: Add `product_sku` to the attention-items dashboard response

**Files:**
- Modify: `server/services/stockistDashboard.js:117-135` (`buildAttentionItems`)
- Modify: `frontend/src/lib/stockistApi.ts` (the `StockistAssetDashboard['attention_items']` element type, around line 328-336)

**Interfaces:**
- Produces: `attention_items[].product_sku: string` — Task 3 consumes this to build its row metadata.

- [ ] **Step 1: Add the field to the backend function**

In `server/services/stockistDashboard.js`, change the `buildAttentionItems` function's return object from:

```js
    return [{
      product_id: product.id,
      product_name: product.name,
      location_id: balance.location_id,
      location_name: locationNames[balance.location_id] || balance.location_id,
      quantity,
      reorder_point: threshold,
      reason: quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
    }];
```

to:

```js
    return [{
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      location_id: balance.location_id,
      location_name: locationNames[balance.location_id] || balance.location_id,
      quantity,
      reorder_point: threshold,
      reason: quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
    }];
```

(`product` is already the full row from `supabase.from('products').select('*')` — per `server/routes/stockist.js:1747` — so `product.sku` is already in scope and populated; this is a pure additive field, no new query.)

- [ ] **Step 2: Update the frontend type**

In `frontend/src/lib/stockistApi.ts`, find the `attention_items` array element type inside `StockistAssetDashboard` (around line 328-336):

```ts
  attention_items: Array<{
    product_id: string;
    product_name: string;
    location_id: string;
    location_name: string;
    quantity: number;
    reorder_point: number;
    reason: 'OUT_OF_STOCK' | 'LOW_STOCK';
  }>;
```

Change it to:

```ts
  attention_items: Array<{
    product_id: string;
    product_name: string;
    product_sku: string;
    location_id: string;
    location_name: string;
    quantity: number;
    reorder_point: number;
    reason: 'OUT_OF_STOCK' | 'LOW_STOCK';
  }>;
```

- [ ] **Step 3: Verify**

Run: `node -c server/services/stockistDashboard.js`
Expected: no output (syntax valid).

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/stockistDashboard.js frontend/src/lib/stockistApi.ts
git commit -m "$(cat <<'EOF'
feat(stockist): add product_sku to the attention-items dashboard response

Explicitly approved backend addition (additive field only, no schema
change) so the Owner Beranda's "Perlu perhatian" rows can show SKU
alongside location, matching the shared row format used elsewhere.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add URL-param filter support to Gudang Pusat

**Files:**
- Modify: `frontend/src/app/admin/stockist/warehouse/page.tsx`

**Interfaces:**
- Produces: the page now honors a `?filter=LOW` (or `SAFE`) query param to preset its stock-status filter on load. Task 3 links to `/admin/stockist/warehouse?filter=LOW`.

- [ ] **Step 1: Re-read the current file's imports and filter state**

Re-read `frontend/src/app/admin/stockist/warehouse/page.tsx` in full to confirm its current imports (it does not currently import anything from `next/navigation`) and the exact current declaration of `filterType` state (`const [filterType, setFilterType] = useState<'ALL' | 'LOW' | 'SAFE'>('ALL');`).

- [ ] **Step 2: Add `useSearchParams` and seed the initial filter from it**

Add to the import block:

```ts
import { useSearchParams } from 'next/navigation';
```

Change:

```ts
  const [filterType, setFilterType] = useState<'ALL' | 'LOW' | 'SAFE'>('ALL');
```

to:

```ts
  const searchParams = useSearchParams();
  const initialFilter = searchParams?.get('filter');
  const [filterType, setFilterType] = useState<'ALL' | 'LOW' | 'SAFE'>(
    initialFilter === 'LOW' || initialFilter === 'SAFE' ? initialFilter : 'ALL'
  );
```

(Mirrors the pattern already used in `frontend/src/app/admin/stockist/branch-stock/all/page.tsx` for its own `stockFilter` initial state — a validated read of a `searchParams` value, falling back to `'ALL'` for anything unrecognized. If this page component isn't already wrapped in a `<Suspense>` boundary at its call site, `useSearchParams()` in a client component still works in Next.js 16's App Router for a page that's already `'use client'` at the top — but if `npx tsc --noEmit` or a build step surfaces a missing-Suspense-boundary warning specific to this addition, wrap the component's default export in `<Suspense>` following whatever pattern `branch-stock/all/page.tsx` already uses for the same situation — check that file's bottom export if this comes up.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/warehouse/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): support a ?filter= query param on Gudang Pusat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Change the stat cards to navigate, and show SKU on attention rows

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx` (inside `OwnerCommandCenter` and `toProductAttentionRows`)

**Interfaces:**
- Consumes: `attention_items[].product_sku` (Task 1), the `?filter=` support on `/admin/stockist/warehouse` (Task 2).

- [ ] **Step 1: Re-read the current file's relevant sections**

Re-read `frontend/src/app/admin/stockist/page.tsx`, focusing on `toProductAttentionRows` (around line 110-121) and the stat-card grid inside `OwnerCommandCenter` (around line 218-237), to confirm the brief's target code still matches — this file has been touched by several prior plans this session.

- [ ] **Step 2: Add SKU to the attention row metadata**

Change `toProductAttentionRows`:

```ts
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
```

to:

```ts
function toProductAttentionRows(items: StockistAssetDashboard['attention_items']): ProductAttentionRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    name: item.product_name,
    meta: `${item.product_sku} · ${item.location_name}`,
    statusLabel: item.reason === 'OUT_OF_STOCK' ? 'Habis' : 'Menipis',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    trailing: String(item.quantity),
    trailingUnit: 'pcs',
    href: '/admin/stockist/products',
  }));
}
```

- [ ] **Step 3: Change the two stat cards from onClick to href**

Change:

```tsx
            <StatCard
              label="Perlu Perhatian"
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
```

to:

```tsx
            <StatCard
              label="Perlu Perhatian"
              value={assets.attention_items.length}
              icon="warning"
              tint="warning"
              hint="perlu restock"
              href="/admin/stockist/warehouse?filter=LOW"
            />
            <StatCard
              label="Transfer Berjalan"
              value={assets.active_transfers.length}
              icon="local_shipping"
              tint="danger"
              hint="belum diterima"
              href="/admin/stockist/transfers"
            />
```

(Do not remove the `drillDown` state, the `BottomSheet open={drillDown?.type === 'attention'}...` block, or the `BottomSheet open={drillDown?.type === 'transfers'}...` block below — those are still used by the separate "Lihat semua" button in the "Perlu perhatian" list section further down this same component, which is explicitly out of scope for this task.)

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): navigate instead of drill-down on Owner Beranda's stat cards, show SKU

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Consolidate the "Aset per lokasi" panel

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx` (inside `OwnerCommandCenter`)
- Modify: `frontend/src/components/stockist/LocationCard.tsx`

**Interfaces:**
- Produces: `LocationCard` gains a new required `barColorClass: string` prop — its progress bar renders in that class instead of the always-`bg-primary-container` it uses today. `HorizontalBarChart`'s import and usage are removed from `OwnerCommandCenter` (the component file itself is NOT deleted — confirmed via grep during plan-writing research that it has no other consumers in this codebase, but deleting unused files is out of scope for this task; only stop importing/rendering it here).

- [ ] **Step 1: Add the color-class prop to `LocationCard`**

Change `frontend/src/components/stockist/LocationCard.tsx` from:

```tsx
export interface LocationCardProps {
  location: AssetLocationSummary;
  onSelect: () => void;
  formatValue: (value: number | null) => string;
  maxValue: number;
}

export function LocationCard({ location, onSelect, formatValue, maxValue }: LocationCardProps) {
  const rawPct = maxValue > 0 ? ((location.total_asset_value ?? 0) / maxValue) * 100 : 0;
  const pct = rawPct > 0 ? Math.max(4, Math.round(rawPct)) : 0;
```

to:

```tsx
export interface LocationCardProps {
  location: AssetLocationSummary;
  onSelect: () => void;
  formatValue: (value: number | null) => string;
  maxValue: number;
  barColorClass: string;
}

export function LocationCard({ location, onSelect, formatValue, maxValue, barColorClass }: LocationCardProps) {
  const rawPct = maxValue > 0 ? ((location.total_asset_value ?? 0) / maxValue) * 100 : 0;
  const pct = rawPct > 0 ? Math.max(4, Math.round(rawPct)) : 0;
```

Then change the progress bar's `<div>`:

```tsx
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div className="h-full rounded-full bg-primary-container" style={{ width: `${pct}%` }} />
      </div>
```

to:

```tsx
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div className={`h-full rounded-full ${barColorClass}`} style={{ width: `${pct}%` }} />
      </div>
```

- [ ] **Step 2: Add the color-mapping helper and remove the chart from `OwnerCommandCenter`**

Re-read `frontend/src/app/admin/stockist/page.tsx`'s "Aset per lokasi" section (around lines 275-299) and the top-level `@/components/stockist/HorizontalBarChart` import to confirm they still match what's below before editing.

Add a helper function near `toProductAttentionRows` (same file, top-level, above `OwnerCommandCenter`):

```ts
function locationBarColorClass(location: AssetLocationSummary): string {
  if (location.type === 'warehouse') return 'bg-primary-container';
  const name = location.location_name;
  if (name.includes('Bypass')) return 'bg-accent-soft';
  if (name.includes('CSB')) return 'bg-info';
  if (name.includes('Samadikun')) return 'bg-warning';
  if (name.includes('Sumber')) return 'bg-success';
  if (name.includes('Tegal')) return 'bg-text-muted';
  return 'bg-primary-container';
}
```

(Colors verified against `design_handoff_stockist_mobile/README.md` §2.6: Gudang Pusat=red, Bypass=red-soft, CSB Mall=info, Samadikun=warn, Sumber=ok, Tegal=text-3. The name-substring match is used instead of `location_id` because `location_id` is a database UUID that varies per environment — `location_name` is confirmed, from a direct production-database query, to reliably take the form `"RedBox <Branch>"` for every branch outlet, and `"Gudang Pusat"` for the warehouse (which is instead caught by the `location.type === 'warehouse'` check, not name-matching).)

Remove the `HorizontalBarChart` import (find and delete the line `import { HorizontalBarChart } from '@/components/stockist/HorizontalBarChart';` from the top-level import block).

Change the "Aset per lokasi" section from:

```tsx
          {assets.asset_by_location.length > 0 ? (
            <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[13px] font-bold text-text-primary">Aset per lokasi</h3>
                <span className="text-[10px] text-text-muted">{assets.asset_by_location.length} lokasi</span>
              </div>
              <div className="bg-surface-elevated border border-border-base rounded-xl p-3">
                <HorizontalBarChart
                  data={assets.asset_by_location.map((location) => ({ name: location.location_name, value: location.total_asset_value ?? 0 }))}
                  theme={theme}
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
```

to:

```tsx
          {assets.asset_by_location.length > 0 ? (
            <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[13px] font-bold text-text-primary">Aset per lokasi</h3>
                <span className="text-[10px] text-text-muted">{assets.asset_by_location.length} lokasi</span>
              </div>
              <div className="bg-surface-elevated border border-border-base rounded-xl p-1 divide-y divide-border-base">
                {assets.asset_by_location.map((location) => (
                  <LocationCard
                    key={location.location_id}
                    location={location}
                    formatValue={formatCurrency}
                    maxValue={maxLocationValue}
                    barColorClass={locationBarColorClass(location)}
                    onSelect={() => setDrillDown({ type: 'location', location })}
                  />
                ))}
              </div>
            </motion.section>
          ) : null}
```

(The `theme` variable from `useStockistTheme()` may become unused if `HorizontalBarChart` was its only consumer in this file — check with a grep for `theme` after this edit; if `useStockistTheme()`'s `theme` value has no other reference left in `OwnerCommandCenter`, remove that unused destructure too. Leave the `useStockistTheme` import itself alone if `toggleTheme` or the hook is still needed elsewhere in the file.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. If Step 2's note about `theme` applies, confirm removing it doesn't leave an unused-variable error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx frontend/src/components/stockist/LocationCard.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): consolidate Owner Beranda's duplicated Aset per lokasi panel

Was rendering the same per-location data twice (a Recharts bar chart
with every bar hardcoded red, plus a separately-styled LocationCard
list also always red) instead of the design handoff's single panel
with per-location semantic colors.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---
