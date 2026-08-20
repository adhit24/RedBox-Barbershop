# Stockist UI Redesign + Bottom Navbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Branch Admin's "Stok Saya" from a catalog-first page into an operational dashboard, add a reusable route-aware bottom navbar, and add a branch-scoped Riwayat (ledger) view — without touching auth, roles, or the movement contract.

**Architecture:** Add the smallest backend surface needed (one new `product_type` enum value, one existing route opened up with server-side location scoping) and rebuild three Stockist frontend routes around existing components (`StatCard`, `BottomSheet`, `EmptyState`, `SkeletonCard`) and a new reusable `BottomNavBar` in `components/ui`. No new aggregate endpoints — dashboard cards are computed client-side from data the app already fetches.

**Tech Stack:** Node.js 24, Express, Supabase/Postgres SQL migrations, Next.js 16/React 19/TypeScript, lucide-react + framer-motion (already installed), Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-stockist-ui-navbar-design.md`

## Global Constraints

- Existing roles only (`owner`, `branch_admin`); no new role/login/auth.
- All quantity changes continue to go through `apply_inventory_movement()` — this plan adds zero new movement types and zero new mutation endpoints.
- `branch_admin` location scope is always resolved server-side from the verified session (`getVerifiedStockistAccess`), never trusted from a request parameter.
- No new aggregate/dashboard endpoints — summary cards are computed client-side from `listProducts`, `getInventorySummary`, `getServiceUsage`, `listTransfers`.
- Replace "Buka Barang" wording with "Mulai Pakai" everywhere it appears in Stockist UI.
- Preserve existing visual language: Tailwind tokens from `frontend/src/app/globals.css` (`primary-container`, `surface-elevated`, `border-base`, `text-primary`, `text-secondary`, `text-muted`, `danger`, `status-menipis`, etc.) — no new hex literals.
- Do not touch `frontend/src/app/admin/stockist/page.tsx` (Beranda), the Owner Command Center, `products/page.tsx`, `stock-opname/*`, or any file not listed in a task below.
- Backend test command: `node --test server/test/<file>.test.js` for focused runs, `npm test` (repo root, runs `node --test server/test/*.test.js`) for the full suite.
- Frontend has no component test framework — verify frontend deliverables with the contract-test pattern already used in this repo (`server/test/stockist-frontend-contract.test.js`, reading page source via `fs.readFileSync`) plus `npm run lint` / `npm run build` inside `frontend/`.

---

### Task 1: Add `CONSUMABLE` product type

**Files:**
- Create: `server/migrations/2026-08-20-stockist-consumable-product-type.sql`
- Modify: `server/services/stockistInventory.js`
- Test: `server/test/stockist-inventory-service.test.js`

**Interfaces:**
- Produces: `validateProductType('CONSUMABLE')` does not throw. `isServiceConsumable('CONSUMABLE')` returns `false`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/stockist-inventory-service.test.js`. First update the import at the top of the file to also pull in `isServiceConsumable`:

```js
const {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
  validateProductType,
  assertProductType,
  isServiceConsumable,
} = require('../services/stockistInventory');
```

Then append this test at the end of the file:

```js
test('validateProductType accepts CONSUMABLE and isServiceConsumable treats it as non-service', () => {
  assert.doesNotThrow(() => validateProductType('CONSUMABLE'));
  assert.equal(isServiceConsumable('CONSUMABLE'), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-inventory-service.test.js`

Expected: FAIL — `validateProductType('CONSUMABLE')` throws because `CONSUMABLE` is not yet in `VALID_PRODUCT_TYPES`.

- [ ] **Step 3: Add the migration**

Create `server/migrations/2026-08-20-stockist-consumable-product-type.sql`:

```sql
-- Add CONSUMABLE product type for non-service supplies (paper bag, cup,
-- packaging) that must be filterable separately from RETAIL and from the
-- SERVICE/SERVICE_CONSUMABLE/BOTH service-use lifecycle.
-- Safe to re-run after 2026-08-19-stockist-service-consumables.sql.

BEGIN;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('RETAIL', 'SERVICE', 'SERVICE_CONSUMABLE', 'BOTH', 'CONSUMABLE'));

COMMIT;
```

- [ ] **Step 4: Update the validator**

In `server/services/stockistInventory.js`, change:

```js
const VALID_PRODUCT_TYPES = new Set(['RETAIL', 'SERVICE', 'SERVICE_CONSUMABLE', 'BOTH']);
```

to:

```js
const VALID_PRODUCT_TYPES = new Set(['RETAIL', 'SERVICE', 'SERVICE_CONSUMABLE', 'BOTH', 'CONSUMABLE']);
```

`isServiceConsumable` stays unchanged — it only returns `true` for `SERVICE`/`SERVICE_CONSUMABLE`/`BOTH`, so `CONSUMABLE` correctly falls through to `false` with no further edit.

- [ ] **Step 5: Run the test and verify PASS**

Run: `node --test server/test/stockist-inventory-service.test.js`

Expected: PASS, all tests in the file green.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/2026-08-20-stockist-consumable-product-type.sql server/services/stockistInventory.js server/test/stockist-inventory-service.test.js
git commit -m "feat(stockist): add CONSUMABLE product type"
```

---

### Task 2: Branch-scoped ledger endpoint

**Files:**
- Modify: `server/routes/stockist.js:294-311` (the `GET /inventory/ledger` handler)
- Modify: `frontend/src/lib/stockistApi.ts`
- Test: `server/test/stockist-routes-ledger.test.js` (create)

**Interfaces:**
- Produces: `GET /api/stockist/inventory/ledger` — `owner` behavior unchanged (all locations). `branch_admin` now gets `200` (not `403`) with rows filtered to `location_id` resolved from their own verified `access.branch` via the existing `findLocation('branch', branchSlug)` helper already defined earlier in the same file.
- Produces frontend: `getInventoryLedger(): Promise<{ ledger: InventoryLedgerEntry[] }>` in `stockistApi.ts`, consumed by Task 7.

- [ ] **Step 1: Write the failing route test**

Create `server/test/stockist-routes-ledger.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'admin-csb', role = 'branch_admin', branch = 'csb' } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified: true };
    next();
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}

function fakeSupabase() {
  const outlets = [
    { id: 'outlet-csb', slug: 'csb', name: 'CSB Mall' },
    { id: 'outlet-samadikun', slug: 'samadikun', name: 'Samadikun' },
  ];
  const locations = [
    { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' },
    { id: 'loc-samadikun', type: 'branch', outlet_id: 'outlet-samadikun' },
  ];
  const ledger = [
    { id: 'ledger-1', product_id: 'p1', location_id: 'loc-csb', movement_type: 'SALE_RETAIL', quantity_delta: -1, created_at: '2026-08-20T01:00:00Z' },
    { id: 'ledger-2', product_id: 'p2', location_id: 'loc-samadikun', movement_type: 'TRANSFER_IN', quantity_delta: 5, created_at: '2026-08-20T02:00:00Z' },
    { id: 'ledger-3', product_id: 'p1', location_id: 'loc-csb', movement_type: 'ADJUSTMENT', quantity_delta: 2, created_at: '2026-08-20T03:00:00Z' },
  ];
  const tables = { outlets, inventory_locations: locations, inventory_ledger: ledger };

  function query(table) {
    const state = { filters: [], order: null };
    const q = {
      select() { return q; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return q; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return q; },
      order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return q; },
      single: async () => {
        const rows = evaluate();
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: evaluate(), error: null }).then(resolve, reject); },
    };
    function evaluate() {
      let rows = tables[table] || [];
      rows = rows.filter((row) => state.filters.every((filter) => filter(row)));
      if (state.order) rows = [...rows].sort((a, b) => (state.order.ascending ? 1 : -1) * String(a[state.order.column]).localeCompare(String(b[state.order.column])));
      return rows;
    }
    return q;
  }

  return { from: query };
}

test('GET /inventory/ledger returns every location for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ledger.length, 3);
  }, { role: 'owner', branch: null, staffId: 'owner-1' });
});

test('GET /inventory/ledger scopes branch_admin to their own location only', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ledger.length, 2);
    assert.ok(body.ledger.every((row) => row.location_id === 'loc-csb'));
  }, { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});

test('GET /inventory/ledger ignores any client-supplied location for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/ledger?location_id=loc-samadikun`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.ledger.every((row) => row.location_id === 'loc-csb'));
  }, { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-routes-ledger.test.js`

Expected: FAIL — the two `branch_admin` tests get `403` from the current handler, not `200`.

- [ ] **Step 3: Update the route**

In `server/routes/stockist.js`, replace the `GET /inventory/ledger` handler (lines 294-311):

```js
  router.get('/inventory/ledger', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    // Full ledger browsing is an owner capability in this spec; branch_admin
    // sees their own branch history via /inventory/summary + transfer detail.
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can browse the full ledger' });
    }

    let query = supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false });
    if (typeof req.query.product_id === 'string' && req.query.product_id) {
      query = query.eq('product_id', req.query.product_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ledger: data || [] });
  });
```

with:

```js
  router.get('/inventory/ledger', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false });
    if (typeof req.query.product_id === 'string' && req.query.product_id) {
      query = query.eq('product_id', req.query.product_id);
    }

    if (access.role === 'branch_admin') {
      // branch_admin reads only their own branch history. Location is
      // resolved from the verified session, never from the request, so a
      // manipulated query param cannot leak another branch's ledger.
      const location = await findLocation('branch', access.branch);
      if (!location) return res.status(404).json({ error: `location not found for ${access.branch}` });
      query = query.eq('location_id', location.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ledger: data || [] });
  });
```

- [ ] **Step 4: Run the test and verify PASS**

Run: `node --test server/test/stockist-routes-ledger.test.js`

Expected: PASS.

- [ ] **Step 5: Run the wider route regression**

Run: `node --test server/test/stockist-routes-warehouse.test.js server/test/stockist-routes-transfers.test.js`

Expected: PASS (unrelated routes untouched).

- [ ] **Step 6: Add the frontend client function**

In `frontend/src/lib/stockistApi.ts`, append after `getAssetDashboard` at the end of the file:

```ts
export interface InventoryLedgerEntry {
  id: string;
  product_id: string;
  location_id: string;
  movement_type: string;
  quantity_delta: number;
  quantity_before?: number;
  quantity_after?: number;
  reference_type?: string | null;
  reference_id?: string | null;
  performed_by?: string;
  reason?: string | null;
  created_at: string;
}

export const getInventoryLedger = () =>
  req<{ ledger: InventoryLedgerEntry[] }>('/api/stockist/inventory/ledger');
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/stockist.js server/test/stockist-routes-ledger.test.js frontend/src/lib/stockistApi.ts
git commit -m "feat(stockist): scope inventory ledger to branch_admin's own location"
```

---

### Task 3: `BottomNavBar` reusable component

**Files:**
- Create: `frontend/src/components/ui/bottom-nav-bar.tsx`
- Test: `server/test/stockist-frontend-contract.test.js` (create)

**Interfaces:**
- Produces: `export type BottomNavItem = { label: string; href: string; icon: LucideIcon }`, `export type BottomNavBarProps = { items: BottomNavItem[]; className?: string; stickyBottom?: boolean }`, `export function BottomNavBar(props: BottomNavBarProps)`. Consumed by Task 4.

This repo has no frontend component test runner. Frontend deliverables are verified with a "contract test" — a backend-side `node:test` file that reads the frontend source as text and asserts on structure/strings, the same pattern already used in `docs/superpowers/plans/2026-08-19-stockist-operations-extension.md` Task 5. This file is created here and extended by Tasks 4-7.

- [ ] **Step 1: Write the failing contract test**

Create `server/test/stockist-frontend-contract.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readFrontend(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', relativePath), 'utf8');
}

test('BottomNavBar is a reusable, route-aware component with the expected API', () => {
  const source = readFrontend('components/ui/bottom-nav-bar.tsx');
  assert.match(source, /usePathname/);
  assert.match(source, /from ['"]next\/link['"]/);
  assert.match(source, /from ['"]lucide-react['"]/);
  assert.match(source, /from ['"]framer-motion['"]/);
  assert.match(source, /export function BottomNavBar/);
  assert.match(source, /items:\s*BottomNavItem\[\]/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL — `ENOENT`, `frontend/src/components/ui/bottom-nav-bar.tsx` does not exist yet.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/ui/bottom-nav-bar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type BottomNavBarProps = {
  items: BottomNavItem[];
  className?: string;
  stickyBottom?: boolean;
};

export function BottomNavBar({ items, className = '', stickyBottom = true }: BottomNavBarProps) {
  const pathname = usePathname() || '';

  return (
    <nav
      className={`${stickyBottom ? 'fixed bottom-0 left-1/2 -translate-x-1/2' : ''} w-full max-w-[430px] bg-surface-container-highest border-t border-border-base rounded-t-xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)] flex justify-around items-center px-2 py-2 z-50 ${className}`}
    >
      {items.map((item) => {
        // Exact match for the root Stockist route so it doesn't stay "active"
        // on every deeper page (which all start with the same prefix).
        const active = item.href === '/admin/stockist'
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] px-2 py-1 rounded-xl"
          >
            {active && (
              <motion.div
                layoutId="stockist-bottom-nav-indicator"
                className="absolute inset-0 rounded-xl bg-primary-container/10"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <Icon
              size={20}
              className={`relative transition-colors duration-200 ${active ? 'text-primary-container' : 'text-text-secondary'}`}
              strokeWidth={active ? 2.4 : 2}
            />
            <span className={`relative text-[10px] tracking-tight transition-colors duration-200 ${active ? 'text-primary-container font-bold' : 'text-text-secondary font-medium'}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test and verify PASS**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Lint the new file**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/bottom-nav-bar.tsx server/test/stockist-frontend-contract.test.js
git commit -m "feat(stockist): add reusable route-aware BottomNavBar component"
```

---

### Task 4: Wire `BottomNavBar` into the Stockist layout

**Files:**
- Modify: `frontend/src/app/admin/stockist/layout.tsx`
- Modify: `server/test/stockist-frontend-contract.test.js`

**Interfaces:**
- Consumes: `BottomNavBar`, `BottomNavItem` from Task 3.
- Produces: Branch Admin sees 5 tabs (Beranda/Stok/Barang Masuk/Permintaan/Riwayat); Owner keeps 1 tab (Command Center), behavior unchanged.

- [ ] **Step 1: Write the failing contract test**

Append to `server/test/stockist-frontend-contract.test.js`:

```js
test('Stockist layout wires BottomNavBar with 5 branch-admin tabs including Permintaan and Riwayat', () => {
  const source = readFrontend('app/admin/stockist/layout.tsx');
  assert.match(source, /from ['"]@\/components\/ui\/bottom-nav-bar['"]/);
  assert.match(source, /<BottomNavBar/);
  assert.match(source, /href:\s*['"]\/admin\/stockist['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/branch-stock['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/transfers['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/requests['"]/);
  assert.match(source, /href:\s*['"]\/admin\/stockist\/ledger['"]/);
  const branchAdminTabsBlock = source.slice(source.indexOf('branchAdminTabs'), source.indexOf('branchAdminTabs') + 500);
  const hrefCount = (branchAdminTabsBlock.match(/href:/g) || []).length;
  assert.equal(hrefCount, 5);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL — `layout.tsx` doesn't import `BottomNavBar` and has no `/ledger` route yet.

- [ ] **Step 3: Update imports**

In `frontend/src/app/admin/stockist/layout.tsx`, replace lines 1-6:

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import Link from 'next/link';
import { MotionConfig } from 'framer-motion';
```

with:

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, PackageCheck, ClipboardList, History, ArrowLeft } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';
```

(`Link` is dropped here — it was only used inside the old inline nav block, which `BottomNavBar` now owns internally.)

- [ ] **Step 4: Replace the tabs computation**

Replace the block from `const ownerTabs = [` through `const tabs = isOwner ? ownerTabs : branchAdminTabs;` (original lines 42-78) with:

```tsx
  const ownerTabs: BottomNavItem[] = [
    { label: 'Command Center', href: '/admin/stockist', icon: isCommandCenterHome ? Home : ArrowLeft }
  ];

  const branchAdminTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/branch-stock', icon: Boxes },
    { label: 'Barang Masuk', href: '/admin/stockist/transfers', icon: PackageCheck },
    { label: 'Permintaan', href: '/admin/stockist/requests', icon: ClipboardList },
    { label: 'Riwayat', href: '/admin/stockist/ledger', icon: History }
  ];
```

- [ ] **Step 5: Replace the nav JSX**

Replace the entire `{/* BottomNavBar */}` block (original lines 120-157, the `<nav>...</nav>` with the owner-vs-tabs conditional rendering) with:

```tsx
      {/* BottomNavBar */}
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
```

- [ ] **Step 6: Run the test and verify PASS**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: PASS.

- [ ] **Step 7: Lint**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0 (confirms the dropped `Link` import isn't flagged as unused elsewhere and no other import broke).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/admin/stockist/layout.tsx server/test/stockist-frontend-contract.test.js
git commit -m "feat(stockist): wire BottomNavBar into Stockist layout with 5 branch-admin tabs"
```

---

### Task 5: "Stok Saya" dashboard (rewrite `branch-stock/page.tsx`)

**Files:**
- Modify: `frontend/src/app/admin/stockist/branch-stock/page.tsx` (full rewrite)
- Modify: `server/test/stockist-frontend-contract.test.js`

**Interfaces:**
- Consumes: `StatCard`, `BottomSheet`, `SkeletonCard`, `EmptyState` (existing), `listProducts`, `getInventorySummary`, `getServiceUsage`, `getServiceUsagePicOptions`, `openServiceUsage`, `finishServiceUsage`, `listTransfers` (existing, from `stockistApi.ts`).
- Produces: `/admin/stockist/branch-stock` renders 5 summary cards instead of a full catalog; wording "Mulai Pakai" replaces "Buka Barang".

Note on the "Barang Masuk" card for Owner: `GET /transfers` is server-scoped to `destination_location_id` for `branch_admin` only (verified in `server/routes/stockist.js:536-541`); for `owner` it returns transfers for every branch with no client-resolvable branch slug → location_id mapping available in this task's scope (adding one would mean a new endpoint, which is out of scope per the spec). So for Owner this card intentionally counts all active (`SENT`) transfers system-wide, not just the selected branch — call this out in the PR description, don't silently misrepresent it as branch-scoped.

- [ ] **Step 1: Write the failing contract test**

Append to `server/test/stockist-frontend-contract.test.js`:

```js
test('Stok Saya dashboard replaces the catalog-first layout with summary cards', () => {
  const source = readFrontend('app/admin/stockist/branch-stock/page.tsx');
  assert.match(source, /Stok Habis/);
  assert.match(source, /Stok Menipis/);
  assert.match(source, /Barang Masuk/);
  assert.match(source, /Barang Pemakaian/);
  assert.match(source, /Semua Stok/);
  assert.match(source, /Mulai Pakai/);
  assert.doesNotMatch(source, /Buka Barang/);
  assert.doesNotMatch(source, /Cari produk atau SKU/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL — the current page still has the search bar (`Cari produk atau SKU...`) and the "Buka Barang" button, and has no "Stok Habis" card.

- [ ] **Step 3: Rewrite the page**

Replace the entire contents of `frontend/src/app/admin/stockist/branch-stock/page.tsx` with:

```tsx
'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  listProducts, getInventorySummary, getServiceUsage, getServiceUsagePicOptions,
  openServiceUsage, finishServiceUsage, listTransfers,
  type StockistProduct, type InventoryBalance, type ServiceUsage, type ServiceUsageItem, type StockTransfer,
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

function BranchStockDashboard() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [serviceItems, setServiceItems] = useState<ServiceUsageItem[]>([]);
  const [serviceUsages, setServiceUsages] = useState<ServiceUsage[]>([]);
  const [picOptions, setPicOptions] = useState<Array<{ id: string; name: string; role: 'branch_admin' | 'barber'; branch: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageSheetOpen, setUsageSheetOpen] = useState(false);
  const [openProduct, setOpenProduct] = useState<ServiceUsageItem | null>(null);
  const [openQuantity, setOpenQuantity] = useState(1);
  const [openPic, setOpenPic] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    if (!branch) return;
    setLoading(true);
    try {
      const [{ products }, { balances }, serviceData, picData, { transfers }] = await Promise.all([
        listProducts(),
        getInventorySummary(branch),
        getServiceUsage(isOwner ? undefined : branch),
        getServiceUsagePicOptions(branch),
        listTransfers(),
      ]);
      setProducts(products);
      setBalances(balances);
      setServiceItems(serviceData.items);
      setServiceUsages(serviceData.usages);
      setPicOptions(picData.people);
      setOpenPic(picData.people[0]?.id || '');
      setTransfers(transfers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [branch]);

  if (!branch) {
    return (
      <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted">
        Pilih cabang terlebih dahulu.
      </div>
    );
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const activeProducts = products.filter((p) => p.is_active);
  const outOfStock = activeProducts.filter((p) => (quantityByProduct.get(p.id) ?? 0) === 0);
  const lowStock = activeProducts
    .filter((p) => {
      const qty = quantityByProduct.get(p.id) ?? 0;
      return qty > 0 && qty <= p.minimum_stock;
    })
    .sort((a, b) => (quantityByProduct.get(a.id) ?? 0) - (quantityByProduct.get(b.id) ?? 0));

  // branch_admin's /transfers response is already scoped server-side to their
  // own destination_location_id. Owner's is not scoped per-branch (no
  // client-resolvable branch->location_id map without a new endpoint), so
  // for Owner this counts every active transfer system-wide.
  const incomingTransfers = transfers.filter((t) => t.status === 'SENT');

  const serviceItemsForBranch = serviceItems.filter((item) => item.branch === branch);
  const activeUsageCount = serviceItemsForBranch.filter((item) => item.in_use_quantity > 0).length;
  const activeUsagesForBranch = serviceUsages.filter((usage) => usage.status === 'IN_USE' && (isOwner || usage.branch === branch));

  async function handleMulaiPakai() {
    if (!openProduct) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await openServiceUsage({ product_id: openProduct.id, quantity: openQuantity, pic_user_id: openPic || undefined, notes: openNotes || undefined });
      setOpenProduct(null);
      setOpenQuantity(1);
      setOpenNotes('');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memulai pemakaian barang');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleTandaiHabis(usage: ServiceUsage) {
    setActionBusy(true);
    setActionError(null);
    try {
      await finishServiceUsage(usage.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menandai barang sebagai habis');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">
            {isOwner ? 'Stok Cabang' : 'Stok Saya'}
          </h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
          </p>
        </div>
      </div>

      {isOwner && (
        <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2 shadow-sm">
          <label className="text-[12px] font-semibold text-text-secondary">Pilih Cabang</label>
          <select
            value={branch}
            onChange={(e) => router.push(`/admin/stockist/branch-stock?branch=${encodeURIComponent(e.target.value)}`)}
            className="w-full bg-[#171415] border border-border-base rounded-lg text-text-primary px-3 py-2.5 text-sm focus:outline-none focus:border-primary-container"
          >
            <option value="bypass">Cabang Bypass</option>
            <option value="sumber">Cabang Sumber</option>
            <option value="samadikun">Cabang Samadikun</option>
            <option value="csb">Cabang CSB Mall</option>
            <option value="tegal">Cabang Tegal</option>
          </select>
        </section>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Stok Habis"
            value={outOfStock.length}
            variant={outOfStock.length > 0 ? 'danger' : 'default'}
            hint="Perlu ditindaklanjuti."
            href={`/admin/stockist/branch-stock/all?status=OUT${isOwner ? `&branch=${branch}` : ''}`}
          />
          <StatCard
            label="Stok Menipis"
            value={lowStock.length}
            hint="Segera cek kebutuhan stok."
            href={`/admin/stockist/branch-stock/all?status=LOW${isOwner ? `&branch=${branch}` : ''}`}
          />
          <StatCard
            label="Barang Masuk"
            value={incomingTransfers.length}
            hint={incomingTransfers.length > 0 ? 'Menunggu pemeriksaan dan konfirmasi.' : 'Tidak ada barang masuk'}
            href="/admin/stockist/transfers"
          />
          <StatCard
            label="Barang Pemakaian"
            value={activeUsageCount}
            hint="Produk yang sedang digunakan di cabang."
            onClick={() => setUsageSheetOpen(true)}
          />
        </div>
      )}

      {!loading && (
        <StatCard
          label="Semua Stok"
          value={activeProducts.length}
          hint="Lihat seluruh inventory cabang."
          href={`/admin/stockist/branch-stock/all${isOwner ? `?branch=${branch}` : ''}`}
        />
      )}

      <BottomSheet open={usageSheetOpen} onClose={() => setUsageSheetOpen(false)} title="Barang Pemakaian">
        {actionError && (
          <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-2 mb-3">{actionError}</div>
        )}
        {serviceItemsForBranch.length === 0 ? (
          <EmptyState icon="check_circle" title="Tidak ada barang aktif" subtitle="Belum ada barang pemakaian yang sedang digunakan." />
        ) : (
          <div className="flex flex-col gap-3">
            {serviceItemsForBranch.map((item) => (
              <div key={item.id} className="rounded-lg border border-border-base bg-surface-container-low p-3 flex flex-col gap-2 text-[11px]">
                <span className="font-semibold text-text-primary text-[13px]">{item.name}</span>
                <div className="flex justify-between text-text-secondary"><span>Stok tertutup</span><strong className="text-text-primary">{item.available_quantity} {item.unit}</strong></div>
                <div className="flex justify-between text-text-secondary"><span>Sedang digunakan</span><strong className="text-primary-container">{item.in_use_quantity} {item.unit}</strong></div>
                {!isOwner && item.available_quantity > 0 && (
                  <button onClick={() => { setOpenProduct(item); setOpenQuantity(1); }} className="rounded-lg bg-primary-container text-text-primary py-2 font-semibold">Mulai Pakai</button>
                )}
                {activeUsagesForBranch.filter((usage) => usage.product_id === item.id).map((usage) => (
                  <div key={usage.id} className="flex justify-between items-center border-t border-border-base pt-2">
                    <span className="text-text-muted">{usage.quantity} {usage.product_unit} &middot; PIC {usage.pic_name}</span>
                    {!isOwner && (
                      <button onClick={() => void handleTandaiHabis(usage)} disabled={actionBusy} className="rounded-lg border border-border-base text-text-secondary px-3 py-1.5 font-semibold">Tandai Habis</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      {openProduct && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-end justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[430px] bg-surface-elevated border border-border-base rounded-2xl p-4 flex flex-col gap-4">
            <div>
              <h3 className="text-[16px] font-bold text-text-primary">Mulai Pakai</h3>
              <p className="text-[12px] text-text-muted mt-1">
                Mulai gunakan barang ini? {openQuantity} {openProduct.unit} akan dipindahkan dari stok tertutup menjadi barang yang sedang digunakan.
              </p>
            </div>
            <label className="text-[12px] text-text-secondary">Quantity
              <input type="number" min={1} max={openProduct.available_quantity || 1} value={openQuantity} onChange={(e) => setOpenQuantity(Math.max(1, Number(e.target.value)))} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" />
            </label>
            <label className="text-[12px] text-text-secondary">PIC / Penanggung Jawab
              <select value={openPic} onChange={(e) => setOpenPic(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary">
                <option value="">Pilih PIC</option>
                {picOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-text-secondary">Catatan opsional
              <textarea value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" rows={2} />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setOpenProduct(null)} disabled={actionBusy} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary">Batal</button>
              <button onClick={() => void handleMulaiPakai()} disabled={actionBusy || !openPic} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">{actionBusy ? 'Menyimpan...' : 'Ya, Mulai Pakai'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BranchStockPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <BranchStockDashboard />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run the test and verify PASS**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Lint**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/branch-stock/page.tsx server/test/stockist-frontend-contract.test.js
git commit -m "feat(stockist): turn Stok Saya into a 5-card operational dashboard"
```

---

### Task 6: "Semua Stok" page

**Files:**
- Create: `frontend/src/app/admin/stockist/branch-stock/all/page.tsx`
- Modify: `frontend/src/lib/stockistApi.ts` (widen `product_type` union)
- Modify: `server/test/stockist-frontend-contract.test.js`

**Interfaces:**
- Consumes: `listProducts`, `getInventorySummary`, `BottomSheet`, `EmptyState` (existing).
- Produces: `/admin/stockist/branch-stock/all?status=OUT|LOW|ALL&branch=<slug>` — search + bottom-sheet filter (status stok, jenis barang incl. Perlengkapan/`CONSUMABLE`) + product list. This is the link target for every "Lihat Produk"/"Lihat Semua" CTA added in Task 5.

- [ ] **Step 1: Write the failing contract test**

Append to `server/test/stockist-frontend-contract.test.js`:

```js
test('Semua Stok page has search, bottom-sheet filter, and a Perlengkapan (CONSUMABLE) option', () => {
  const source = readFrontend('app/admin/stockist/branch-stock/all/page.tsx');
  assert.match(source, /Cari produk atau SKU/);
  assert.match(source, /Perlengkapan/);
  assert.match(source, /CONSUMABLE/);
  assert.match(source, /Terapkan Filter/);
  assert.match(source, /from ['"]@\/components\/stockist\/BottomSheet['"]/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL — `ENOENT`, the file doesn't exist yet.

- [ ] **Step 3: Widen the `StockistProduct.product_type` union**

In `frontend/src/lib/stockistApi.ts`, change:

```ts
  product_type?: 'RETAIL' | 'SERVICE' | 'SERVICE_CONSUMABLE' | 'BOTH';
```

to:

```ts
  product_type?: 'RETAIL' | 'SERVICE' | 'SERVICE_CONSUMABLE' | 'BOTH' | 'CONSUMABLE';
```

- [ ] **Step 4: Create the page**

Create `frontend/src/app/admin/stockist/branch-stock/all/page.tsx`:

```tsx
'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  listProducts, getInventorySummary,
  type StockistProduct, type InventoryBalance,
} from '@/lib/stockistApi';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { EmptyState } from '@/components/stockist/EmptyState';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

type StockFilter = 'ALL' | 'SAFE' | 'LOW' | 'OUT';
type TypeFilter = 'ALL' | 'RETAIL' | 'SERVICE' | 'CONSUMABLE';

function isValidStockFilter(value: string | null): value is StockFilter {
  return value === 'SAFE' || value === 'LOW' || value === 'OUT' || value === 'ALL';
}

function SemuaStokContent() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const initialStatus = searchParams.get('status');
  const [stockFilter, setStockFilter] = useState<StockFilter>(isValidStockFilter(initialStatus) ? initialStatus : 'ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => {
        setProducts(products);
        setBalances(balances);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang'))
      .finally(() => setLoading(false));
  }, [branch]);

  if (!branch) {
    return (
      <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted">
        Pilih cabang terlebih dahulu.
      </div>
    );
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const isServiceProduct = (product: StockistProduct) => ['SERVICE', 'SERVICE_CONSUMABLE', 'BOTH'].includes(product.product_type || '');
  const isConsumableProduct = (product: StockistProduct) => product.product_type === 'CONSUMABLE';

  const enrichedProducts = products
    .filter((p) => p.is_active)
    .map((p) => {
      const qty = quantityByProduct.get(p.id) ?? 0;
      const isOut = qty === 0;
      const isLow = qty > 0 && qty <= p.minimum_stock;
      let status: 'SAFE' | 'LOW' | 'OUT' = 'SAFE';
      if (isOut) status = 'OUT';
      else if (isLow) status = 'LOW';
      return { ...p, qty, status };
    });

  const filteredProducts = enrichedProducts.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'ALL'
      || (typeFilter === 'SERVICE' && isServiceProduct(p))
      || (typeFilter === 'CONSUMABLE' && isConsumableProduct(p))
      || (typeFilter === 'RETAIL' && !isServiceProduct(p) && !isConsumableProduct(p));
    const matchesStock = stockFilter === 'ALL' || p.status === stockFilter;
    return matchesSearch && matchesType && matchesStock;
  });

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Semua Stok</h2>
        <p className="text-[12px] text-text-muted mt-1">
          {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
        </p>
      </div>

      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
        <button
          onClick={() => setFilterSheetOpen(true)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-base text-text-secondary text-[13px] font-semibold"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Filter
        </button>
      </section>

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
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Stok</h3>
            <span className="text-[11px] text-text-muted">{filteredProducts.length} Produk</span>
          </div>
          {filteredProducts.length === 0 ? (
            <EmptyState icon="search_off" title="Tidak ada stok yang sesuai" subtitle="Coba ubah kata kunci pencarian atau filter." />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredProducts.map((p) => (
                <div key={p.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 flex flex-col min-w-0">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight truncate">{p.name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU {p.sku}</span>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <p className={`text-[16px] font-bold font-display tabular-nums leading-tight ${p.status === 'OUT' ? 'text-danger' : p.status === 'LOW' ? 'text-status-menipis' : 'text-text-primary'}`}>{p.qty} {p.unit}</p>
                    <span className="text-[10px] font-semibold mt-1 text-text-muted">{p.status === 'SAFE' ? 'Aman' : p.status === 'LOW' ? 'Menipis' : 'Habis'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter">
        <div className="flex flex-col gap-4">
          <div>
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Status Stok</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['SAFE', 'Aman'], ['LOW', 'Menipis'], ['OUT', 'Habis']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setStockFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${stockFilter === value ? 'bg-primary-container border-primary-container text-text-primary' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-[12px] font-semibold text-text-secondary mb-2">Jenis Barang</h4>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Semua'], ['RETAIL', 'Retail'], ['SERVICE', 'Barang Pemakaian'], ['CONSUMABLE', 'Perlengkapan']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${typeFilter === value ? 'bg-primary-container border-primary-container text-text-primary' : 'bg-surface-container-low border-border-base text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => { setStockFilter('ALL'); setTypeFilter('ALL'); }} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary font-semibold">Reset</button>
            <button onClick={() => setFilterSheetOpen(false)} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">Terapkan Filter</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default function SemuaStokPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <SemuaStokContent />
    </Suspense>
  );
}
```

- [ ] **Step 5: Run the test and verify PASS**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: PASS.

- [ ] **Step 6: Lint**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/admin/stockist/branch-stock/all/page.tsx frontend/src/lib/stockistApi.ts server/test/stockist-frontend-contract.test.js
git commit -m "feat(stockist): add Semua Stok page with search, filter sheet, and Perlengkapan filter"
```

---

### Task 7: "Riwayat" page

**Files:**
- Create: `frontend/src/app/admin/stockist/ledger/page.tsx`
- Modify: `server/test/stockist-frontend-contract.test.js`

**Interfaces:**
- Consumes: `getInventoryLedger`, `InventoryLedgerEntry` (Task 2), `SkeletonCard`, `EmptyState` (existing).
- Produces: `/admin/stockist/ledger` — read-only, branch-scoped for `branch_admin` via the endpoint from Task 2, no branch selector.

- [ ] **Step 1: Write the failing contract test**

Append to `server/test/stockist-frontend-contract.test.js`:

```js
test('Riwayat page renders scoped ledger entries without a branch selector', () => {
  const source = readFrontend('app/admin/stockist/ledger/page.tsx');
  assert.match(source, /getInventoryLedger/);
  assert.doesNotMatch(source, /Pilih Cabang/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL — `ENOENT`, the file doesn't exist yet.

- [ ] **Step 3: Create the page**

Create `frontend/src/app/admin/stockist/ledger/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { getInventoryLedger, type InventoryLedgerEntry } from '@/lib/stockistApi';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';

const MOVEMENT_LABELS: Record<string, string> = {
  WAREHOUSE_RECEIVE: 'Barang Masuk Gudang',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
  ADJUSTMENT: 'Penyesuaian',
  RETURN_TO_CENTER: 'Retur ke Pusat',
  SALE_MOKA: 'Penjualan (Moka)',
  SALE_RETAIL: 'Penjualan Retail',
  SERVICE_OPEN: 'Mulai Pakai',
  SERVICE_FINISHED: 'Barang Ditandai Habis',
  STOCK_OPNAME_GAIN: 'Selisih Opname (Lebih)',
  STOCK_OPNAME_LOSS: 'Selisih Opname (Kurang)',
  DAMAGE: 'Kerusakan',
  LOST: 'Kehilangan',
};

export default function RiwayatPage() {
  const { user } = useUser();
  const [ledger, setLedger] = useState<InventoryLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getInventoryLedger()
      .then(({ ledger }) => {
        setLedger(ledger);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat riwayat'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">Riwayat</h2>
        <p className="text-[12px] text-text-muted mt-1">
          {user?.role === 'owner' ? 'Seluruh pergerakan stok' : 'Pergerakan stok cabang Anda'}
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} className="min-h-[64px]" />)}
        </div>
      ) : ledger.length === 0 ? (
        <EmptyState icon="history" title="Belum ada riwayat" subtitle="Pergerakan stok akan muncul di sini." />
      ) : (
        <div className="flex flex-col gap-2">
          {ledger.map((entry) => (
            <div key={entry.id} className="bg-surface-elevated border border-border-base rounded-xl p-3 flex justify-between items-center gap-3">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-text-primary truncate">{MOVEMENT_LABELS[entry.movement_type] || entry.movement_type}</span>
                <span className="text-[11px] text-text-muted mt-0.5">{new Date(entry.created_at).toLocaleString('id-ID')}</span>
              </div>
              <span className={`text-[14px] font-bold tabular-nums shrink-0 ${entry.quantity_delta < 0 ? 'text-danger' : 'text-success'}`}>
                {entry.quantity_delta > 0 ? '+' : ''}{entry.quantity_delta}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify PASS**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Lint**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/ledger/page.tsx server/test/stockist-frontend-contract.test.js
git commit -m "feat(stockist): add branch-scoped Riwayat (ledger) page"
```

---

### Task 8: Full verification and handoff audit

**Files:**
- Modify only files touched by Tasks 1-7.
- Test: all `server/test/stockist-*.test.js`.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test`

Expected: exit code 0, zero failed tests.

- [ ] **Step 2: Run the frontend build**

Run (from `frontend/`): `npm run build`

Expected: exit code 0 (this also type-checks every file touched — there is no separate `tsc` script in this project).

- [ ] **Step 3: Run the frontend lint one more time on the full tree**

Run (from `frontend/`): `npm run lint`

Expected: exit code 0.

- [ ] **Step 4: Grep for contract regressions**

Run: `rg -n "CONSUMABLE|Mulai Pakai|Buka Barang|bottom-nav-bar|getInventoryLedger" server frontend/src`

Expected: `CONSUMABLE` and `Mulai Pakai` and `bottom-nav-bar` and `getInventoryLedger` appear in the intended files (from Tasks 1-7); `Buka Barang` returns **no matches** anywhere under `frontend/src`.

- [ ] **Step 5: Inspect the final diff and worktree**

Run: `git diff --stat` and `git status --short`

Expected: only the files listed across Tasks 1-7's **Files** sections changed; no unrelated file (Beranda, Owner Command Center, products, stock-opname, warehouse, etc.) touched; pre-existing untracked files in the working tree remain untouched.

- [ ] **Step 6: Manual acceptance checklist**

Verify locally (start backend + frontend, log in as each role):

```text
Branch Admin opens /admin/stockist/branch-stock and sees 5 summary cards, not a product list.
Each card's CTA navigates to the correct filtered Semua Stok view or existing page.
Semua Stok shows search + Filter button; bottom sheet has Status Stok and Jenis Barang
  (incl. Perlengkapan) sections with Reset/Terapkan Filter.
Bottom navbar for Branch Admin shows 5 tabs (Beranda/Stok/Barang Masuk/Permintaan/Riwayat),
  correct tab highlights on refresh, deep link, and browser back/forward.
Owner still sees a single Command Center tab, behavior unchanged.
Riwayat page for Branch Admin shows only their own branch's ledger rows, no branch selector.
"Buka Barang" text is gone; "Mulai Pakai" flow works end to end and updates the dashboard
  card count after confirming.
"Tandai Habis" still works from the Barang Pemakaian bottom sheet.
Empty states render for: zero stok habis, zero stok menipis, zero barang masuk, zero barang
  pemakaian aktif, zero ledger entries.
320px, 360px, 390px, 430px: bottom navbar stays readable, no horizontal overflow, minimum
  44px touch targets.
```

- [ ] **Step 7: Report evidence and remaining deployment work**

Report exact test/build commands and exit codes. Separate local verification from migration application (the `CONSUMABLE` migration must still be run against the real database) and from production deployment — do not claim production readiness until the migration is applied and the deployed Stockist domain has had live visual QA.
