# RedBox Stockist Beranda Admin Cabang Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `BranchAdminDashboard` (the Beranda/home screen for the `branch_admin` role) to match the design handoff's §3 spec — most notably adding the pending-transfer hero banner that's currently missing entirely, the most visible gap on this screen.

**Architecture:** Two tasks against the same function, `BranchAdminDashboard` in `frontend/src/app/admin/stockist/page.tsx:342-606`. Task 1 adds a new self-contained hero banner section (a new state + effect + JSX block, doesn't touch existing sections). Task 2 restructures the existing metric cards, quick actions, low-stock list metadata, and Stok Pemakaian card styling to match spec exactly.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4.

**Spec:** `design_handoff_stockist_mobile/README.md` §3 "Beranda — Admin Cabang" and `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md`.

## Global Constraints

- Exact spec component order for this screen (top to bottom): (1) kartu kiriman hero banner (only when a pending transfer exists), (2) two metric cards — "Stok cabang (unit)" tint-green, "Perlu restock" tint-yellow, (3) "Aksi cepat" 2×2 grid — exactly Konfirmasi Kiriman/Lihat Stok/Stock Opname/Minta Stok, (4) "Stok menipis di cabang" list with row metadata `SKU · min N pcs`, (5) Stok Pemakaian card, outline style.
- No backend/database change. `getTransfer(id)` (used by Task 1) already exists in `frontend/src/lib/stockistApi.ts:141-142` and already returns `{ transfer, items }` — this plan only calls an existing client function, it does not add or modify any API route.
- `listTransfers()` is already scoped server-side to the branch_admin's own destination branch (confirmed comment at `page.tsx:109-112` in the sibling `branch-stock/page.tsx` file, same underlying endpoint) — no additional branch filtering is needed in this plan's code.
- Dropping "Riwayat Permintaan" and "Retur Barang" from this screen's quick actions (per the spec's exact 4-item list) does not strand branch_admin users — both remain reachable via the Profil page's "Menu lainnya" section (`frontend/src/app/admin/stockist/profile/page.tsx`), already built in an earlier plan.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` for every task.

---

### Task 1: Add the pending-transfer hero banner

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx` (inside `BranchAdminDashboard`, and its top-level import block)

**Interfaces:**
- Consumes: `getTransfer(id: string): Promise<{ transfer: StockTransfer; items: StockTransferItem[] }>` (already exists in `stockistApi.ts:141-142`), the existing `transfers` state (already fetched via `listTransfers()` in this same component).
- Produces: no new exports — a new `pendingTransfer`/`pendingItems` state pair and a new JSX section, both local to `BranchAdminDashboard`.

- [ ] **Step 1: Add `StockTransferItem` and `getTransfer` to the existing import**

In `frontend/src/app/admin/stockist/page.tsx`, change the `@/lib/stockistApi` import block (lines 8-19) from:

```ts
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
```

to:

```ts
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getTransfer,
  getAssetDashboard,
  getServiceUsage,
  type InventoryBalance,
  type StockTransfer,
  type StockTransferItem,
  type StockistAssetDashboard,
  type AssetLocationSummary,
  type ServiceUsage
} from '@/lib/stockistApi';
```

- [ ] **Step 2: Add the pending-transfer state and effect**

Inside `BranchAdminDashboard`, alongside the other `useState` calls (after `const [activeUsages, setActiveUsages] = useState<ServiceUsage[]>([]);`), add:

```ts
  const [pendingTransfer, setPendingTransfer] = useState<StockTransfer | null>(null);
  const [pendingItems, setPendingItems] = useState<StockTransferItem[]>([]);
```

After the existing `useEffect` that fetches `products`/`balances`/`transfers`/`activeUsages` (the one with dependency array `[branch]`), add a new effect:

```ts
  useEffect(() => {
    const sent = transfers
      .filter((t) => t.status === 'SENT')
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    const latest = sent[0] ?? null;
    setPendingTransfer(latest);
    if (!latest) {
      setPendingItems([]);
      return;
    }
    getTransfer(latest.id)
      .then(({ items }) => setPendingItems(items))
      .catch(() => setPendingItems([]));
  }, [transfers]);
```

(If there are multiple pending transfers, this shows only the single most recently sent one — matching the spec's singular "1 kiriman menunggu konfirmasi" copy. `pendingItems` fetch failures are swallowed to an empty array rather than surfaced as a page-level error, since the banner degrades gracefully to showing "0 item · 0 pcs" rather than blocking the rest of the dashboard.)

- [ ] **Step 3: Add the hero banner JSX**

Add a helper function above the `BranchAdminDashboard` function definition (after the existing `getGreeting`/`daysActive`/`usageEstimateStatus` helpers if present in this file, or immediately before `function BranchAdminDashboard`):

```ts
function formatTransferSentAt(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart} WIB`;
}
```

Inside the component's return statement, immediately after the opening `<div className="flex flex-col gap-6 animate-fade-in">` and its `{/* Greeting Section */}` block (i.e. right after the closing `</section>` of the greeting, before the `{error && (...)}` block), add:

```tsx
      {!loading && pendingTransfer && (
        <Link
          href={`/admin/stockist/transfers/${pendingTransfer.id}`}
          className="flex flex-col gap-3 rounded-[20px] bg-primary-container p-4 text-white active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">local_shipping</span>
            <span className="flex-1 text-[14px] font-semibold">1 kiriman menunggu konfirmasi</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl bg-white/[0.12] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-bold">{pendingTransfer.transfer_number}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">Dikirim</span>
            </div>
            <span className="text-[12px] text-white/90">
              {pendingTransfer.source_name || 'Gudang Pusat'} → {pendingTransfer.destination_name || BRANCH_NAMES[branch] || branch} · {pendingItems.length} item · {pendingItems.reduce((sum, item) => sum + item.quantity_sent, 0)} pcs
            </span>
            <span className="text-[11px] text-white/70">
              Dikirim {formatTransferSentAt(pendingTransfer.sent_at)}
            </span>
          </div>
        </Link>
      )}
```

(This renders nothing when there's no pending transfer, and nothing during the initial `loading` state — matching the existing pattern in this component where the whole dashboard body is gated behind `{loading ? (...) : (<>...</>)}` a few lines below. Placing the banner condition as `!loading && pendingTransfer` outside that existing ternary, right after the greeting, matches the spec's exact top-of-screen placement while reusing the same loading-state discipline as the rest of the screen.)

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add pending-transfer hero banner to Beranda Admin Cabang

The most visible gap flagged by the design-handoff audit — the
mockup's top-of-screen "1 kiriman menunggu konfirmasi" banner was
entirely absent from the live Branch Admin home screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Restructure metric cards, quick actions, low-stock metadata, and the Stok Pemakaian card

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx` (inside `BranchAdminDashboard`, and its top-level import block)

**Interfaces:**
- Consumes: `<QuickActionGrid actions={QuickAction[]} />` (already exists, `frontend/src/components/stockist/QuickActionGrid.tsx` — `{ key, href, icon, label }` per action, already imported at the top of this file for another section — reuse the same import, don't add a duplicate one).
- Produces: no new exports.

- [ ] **Step 1: Replace the two metric cards**

Change the "Stats Grid" section (the `<section className="grid grid-cols-2 gap-3">...</section>` block showing "Total Stok" and "Transfer Aktif") from:

```tsx
          <section className="grid grid-cols-2 gap-3">
            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-muted text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                Total Stok
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalStock.toLocaleString('id-ID')}
              </div>
            </div>

            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-muted text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                Transfer Aktif
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2 flex items-baseline gap-2">
                {activeTransfersCount}
                <span className="text-[10px] text-warning font-semibold bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
                  Kirim
                </span>
              </div>
            </div>
          </section>
```

to:

```tsx
          <section className="grid grid-cols-2 gap-3">
            <div className="bg-tint-success border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-secondary text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-success">inventory_2</span>
                Stok cabang (unit)
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalStock.toLocaleString('id-ID')}
              </div>
            </div>

            <div className="bg-tint-warning border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-secondary text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-warning">warning</span>
                Perlu restock
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {lowStockItems.length}
              </div>
            </div>
          </section>
```

(`activeTransfersCount` becomes unused after this change if nothing else in the file references it — check with a project-wide grep for `activeTransfersCount` after this edit; if it's only used here, remove its `const activeTransfersCount = transfers.filter(t => t.status === 'SENT').length;` declaration too, since an unused variable is dead code. If Task 1 or anything else in the file does still use it, leave the declaration in place.)

- [ ] **Step 2: Replace the quick actions section**

Change the whole "Quick Actions" section (from `{/* Quick Actions */}` through its closing `</section>`) from:

```tsx
          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>

            <div className="flex flex-col gap-2">
              <Link
                href="/admin/stockist/requests/new"
                className="bg-primary-container hover:bg-inverse-primary text-white font-bold text-[14px] h-[48px] rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg"
              >
                <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>add_shopping_cart</span>
                Ajukan Permintaan Stok
              </Link>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/admin/stockist/transfers"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">call_received</span>
                  Terima Transfer
                </Link>
                <Link
                  href="/admin/stockist/requests"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">list_alt</span>
                  Riwayat Permintaan
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/admin/stockist/stock-opname"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">checklist</span>
                  Stock Opname
                </Link>
                <Link
                  href="/admin/stockist/returns"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
                  Retur Barang
                </Link>
              </div>
            </div>
          </section>
```

to:

```tsx
          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>
            <QuickActionGrid
              actions={[
                { key: 'konfirmasi-kiriman', href: '/admin/stockist/transfers', icon: 'task_alt', label: 'Konfirmasi Kiriman' },
                { key: 'lihat-stok', href: '/admin/stockist/branch-stock', icon: 'boxes', label: 'Lihat Stok' },
                { key: 'stock-opname', href: '/admin/stockist/stock-opname', icon: 'checklist', label: 'Stock Opname' },
                { key: 'minta-stok', href: '/admin/stockist/requests/new', icon: 'add_shopping_cart', label: 'Minta Stok' },
              ]}
            />
          </section>
```

- [ ] **Step 3: Fix the low-stock list row metadata**

Change the low-stock item row's metadata line — find, inside the "Low Stock Alert Card" section:

```tsx
                        <span className="text-[10px] text-text-muted mt-0.5 font-mono">SKU: {item.sku}</span>
```

to:

```tsx
                        <span className="text-[10px] text-text-muted mt-0.5 font-mono">{item.sku} · min {item.minimum_stock} pcs</span>
```

- [ ] **Step 4: Restyle the Stok Pemakaian card as outline instead of shadowed**

Change the Stok Pemakaian `<Link>` wrapper's className from:

```tsx
            className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-lg active:scale-[0.99] transition-transform"
```

to:

```tsx
            className="border border-border-base rounded-xl p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform"
```

(Removed `bg-surface-elevated` and `shadow-lg` — an outline card per spec has no filled background or drop shadow, just the border.)

- [ ] **Step 5: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. If Step 1's note about `activeTransfersCount` applies (no other reference to it left in the file), confirm removing its declaration doesn't produce an "unused variable" situation elsewhere — TypeScript's `noUnusedLocals` (if enabled in this project's `tsconfig.json`) would fail the build on a leftover unused `const`, so removing it is required, not optional, if nothing else uses it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/page.tsx
git commit -m "$(cat <<'EOF'
fix(stockist): match Beranda Admin Cabang's metrics, quick actions, and card styles to the design handoff

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---
