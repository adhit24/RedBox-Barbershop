# Stockist Inventory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track RedBox retail products (pomade, parfum, facewash, etc.) from arrival at the central warehouse through distribution to the 5 existing barbershop branches, with a fully auditable inventory ledger.

**Architecture:** Express backend (`server/`) owns all writes via a service-role Supabase client and a single `apply_inventory_movement` Postgres function that makes every stock change atomic and ledgered; a thin Next.js proxy layer (`frontend/src/app/api/stockist/*`) authenticates the browser session and forwards a signed session assertion to the backend, exactly like the existing membership module. New admin UI pages live under `/admin/stockist/*` inside the existing admin portal — no new app, no new auth system.

**Tech Stack:** Next.js (App Router) + Supabase (Postgres) + Express (`server/index.js` monolith with `server/routes/*.js` router modules) + `node:test` (the project's only test runner, run via `npm test` = `node --test server/test/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-08-15-stockist-inventory-foundation-design.md`

## Global Constraints

- No new roles. Only `owner` and `branch_admin` (existing `users.role` values) get access; `barber` gets none.
- `branch_admin` access is always scoped to their own `users.branch` value, enforced server-side (never trust a client-supplied branch/location).
- `purchase_price` must never appear in any API response reaching a `branch_admin` — stripped at the backend serialization layer, not hidden in the UI.
- Every stock quantity change (warehouse receive, transfer send, transfer receive, adjustment) must go through `apply_inventory_movement` and produce exactly one `inventory_ledger` row. No code path may write to `inventory_balances` directly.
- Stock may never go negative — `apply_inventory_movement` rejects any change that would make a balance negative.
- Auth pattern: mirror `server/routes/adminCrm.js`'s `getVerifiedMembershipAdmin`/`resolveMembershipActivationBranch` shape and `frontend/src/app/api/admin/crm/membership/_auth.ts`/`_policy.ts` shape — this repo's proven pattern for signed-session, role/branch-scoped admin access. Reuse `frontend/src/app/api/admin/crm/membership/_proxySecret.ts` directly (it is already generic and already cross-imported from `server/test/`) rather than duplicating it.
- Tests: use `node:test` + `node:assert/strict`, one `*.test.js` file per new backend module, following the `withServer()` fake-Supabase-client pattern from `server/test/admin-crm-membership-activation.test.js`. This repo has no frontend test runner (no jest/vitest configured) and no DB-integration test harness — frontend pages and the SQL migration are verified manually (steps included per task), matching how every other feature in this repo has shipped.

---

## File Structure

```
server/
  migrations/2026-08-15-stockist-inventory-foundation.sql   [new]
  services/stockistAccess.js                                [new] role/branch authorization
  services/stockistInventory.js                              [new] movement + price-stripping helpers
  routes/stockist.js                                          [new] Express router, all /api/stockist/* endpoints
  index.js                                                    [modify] mount the new router
  test/stockist-access.test.js                                [new]
  test/stockist-inventory-service.test.js                     [new]
  test/stockist-routes-products.test.js                       [new]
  test/stockist-routes-warehouse.test.js                      [new]
  test/stockist-routes-transfers.test.js                      [new]
  test/stockist-routes-adjustment.test.js                     [new]

frontend/src/app/api/stockist/
  _auth.ts                [new] session -> role/branch, mirrors membership/_auth.ts
  _policy.ts               [new] authorizeStockistAdmin, mirrors membership/_policy.ts
  products/route.ts        [new]
  inventory/summary/route.ts   [new]
  inventory/ledger/route.ts    [new]
  inventory/adjustment/route.ts [new]
  warehouse/receive/route.ts   [new]
  transfers/route.ts           [new]
  transfers/[id]/route.ts         [new] transfer detail incl. items, added in Task 12
  transfers/[id]/receive/route.ts [new]

frontend/src/app/admin/stockist/
  layout.tsx                [new] role gate + redirect (owner -> warehouse, branch_admin -> branch-stock)
  products/page.tsx         [new]
  warehouse/page.tsx        [new]
  transfers/page.tsx        [new]
  transfers/new/page.tsx    [new]
  transfers/[id]/page.tsx   [new]
  branch-stock/page.tsx     [new]

frontend/src/components/AdminNav.tsx   [modify] add Stockist nav entry
frontend/src/lib/stockistApi.ts        [new] typed fetch helpers for the /api/stockist/* proxy routes
```

Each backend file has one responsibility: `stockistAccess.js` decides *who can act*, `stockistInventory.js` decides *how a movement is applied and how a product is redacted*, `stockist.js` wires HTTP to those two. This mirrors how `adminCrm.js` (routing) stays separate from `membership-policy.js`/`membership-benefits.js` (business rules) in the existing codebase.

---

### Task 1: Database migration — schema, ledger function, locations

**Files:**
- Create: `server/migrations/2026-08-15-stockist-inventory-foundation.sql`

**Interfaces:**
- Produces: tables `products`, `inventory_locations`, `inventory_balances`, `inventory_ledger`, `stock_transfers`, `stock_transfer_items`; function `apply_inventory_movement(p_product_id uuid, p_location_id uuid, p_quantity_delta integer, p_movement_type text, p_performed_by uuid, p_reference_type text DEFAULT NULL, p_reference_id uuid DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS inventory_ledger`. Every later backend task calls this function by name via `supabase.rpc('apply_inventory_movement', {...})`.

This task has no `node:test` coverage (SQL migrations in this repo aren't unit tested — see `server/migrations/*.sql` for precedent, none have accompanying tests). It's verified by applying it and running a manual smoke check.

- [ ] **Step 1: Write the migration file**

```sql
-- server/migrations/2026-08-15-stockist-inventory-foundation.sql
-- Stockist inventory foundation: products, warehouse/branch stock, ledger, transfers.
-- Safe to re-run (idempotent).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: products — retail goods (pomade, parfum, facewash...),
-- distinct from `services` (haircut services).
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku              TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT,
  brand            TEXT,
  unit             TEXT NOT NULL DEFAULT 'pcs',
  barcode          TEXT,
  purchase_price   INTEGER,
  retail_price     INTEGER,
  minimum_stock    INTEGER NOT NULL DEFAULT 0,
  reorder_point    INTEGER NOT NULL DEFAULT 0,
  moka_item_id     TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: inventory_locations — 1 warehouse (singleton) + 5 branch
-- rows pointing at the existing `outlets` table. Kept separate from
-- `outlets` because a warehouse has no barbers and no booking-sync
-- Moka token — bolting it onto `outlets` would mix domains.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL CHECK (type IN ('warehouse', 'branch')),
  outlet_id   UUID REFERENCES outlets(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_branch_has_outlet CHECK (
    (type = 'branch' AND outlet_id IS NOT NULL) OR
    (type = 'warehouse' AND outlet_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_locations_outlet
  ON inventory_locations (outlet_id) WHERE outlet_id IS NOT NULL;

-- Singleton warehouse row (only inserted if none exists yet).
INSERT INTO inventory_locations (type, outlet_id)
SELECT 'warehouse', NULL
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE type = 'warehouse');

-- One branch row per existing outlet.
INSERT INTO inventory_locations (type, outlet_id)
SELECT 'branch', o.id
FROM outlets o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_locations il WHERE il.outlet_id = o.id
);

-- ============================================================
-- TABLE: inventory_balances — derived read-cache, never written
-- directly outside apply_inventory_movement().
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_balances (
  product_id   UUID NOT NULL REFERENCES products(id),
  location_id  UUID NOT NULL REFERENCES inventory_locations(id),
  quantity     INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, location_id)
);

-- ============================================================
-- TABLE: inventory_ledger — append-only audit trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id        UUID NOT NULL REFERENCES products(id),
  location_id       UUID NOT NULL REFERENCES inventory_locations(id),
  movement_type     TEXT NOT NULL CHECK (movement_type IN (
                       'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'
                     )),
  quantity_delta    INTEGER NOT NULL,
  quantity_before   INTEGER NOT NULL,
  quantity_after    INTEGER NOT NULL,
  reference_type    TEXT,
  reference_id      UUID,
  performed_by      UUID NOT NULL REFERENCES users(id),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_location
  ON inventory_ledger (product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_reference
  ON inventory_ledger (reference_type, reference_id) WHERE reference_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_created
  ON inventory_ledger (created_at DESC);

-- ============================================================
-- TABLE: stock_transfers / stock_transfer_items — pusat -> cabang
-- distribution, two-phase (SENT, then RECEIVED with confirmed qty).
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number           TEXT UNIQUE NOT NULL,
  source_location_id        UUID NOT NULL REFERENCES inventory_locations(id),
  destination_location_id   UUID NOT NULL REFERENCES inventory_locations(id),
  status                    TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'RECEIVED')),
  sent_by                   UUID NOT NULL REFERENCES users(id),
  sent_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by               UUID REFERENCES users(id),
  received_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination
  ON stock_transfers (destination_location_id, status);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  quantity_sent     INTEGER NOT NULL CHECK (quantity_sent > 0),
  quantity_received INTEGER CHECK (quantity_received IS NULL OR quantity_received >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer
  ON stock_transfer_items (stock_transfer_id);

-- ============================================================
-- FUNCTION: apply_inventory_movement — the ONLY way balances change.
-- Row-locks the balance row (creating it at 0 first if missing) so
-- concurrent movements against the same product+location serialize
-- instead of racing past the negative-stock check.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_inventory_movement(
  p_product_id     UUID,
  p_location_id    UUID,
  p_quantity_delta INTEGER,
  p_movement_type  TEXT,
  p_performed_by   UUID,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   UUID DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL
)
RETURNS inventory_ledger AS $$
DECLARE
  v_current INTEGER;
  v_new     INTEGER;
  v_ledger  inventory_ledger;
BEGIN
  INSERT INTO inventory_balances (product_id, location_id, quantity)
  VALUES (p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT quantity INTO v_current
  FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  v_new := v_current + p_quantity_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient stock: product % at location % has % available, delta % requested',
      p_product_id, p_location_id, v_current, p_quantity_delta
      USING ERRCODE = '23514';
  END IF;

  UPDATE inventory_balances
  SET quantity = v_new, updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id;

  INSERT INTO inventory_ledger (
    product_id, location_id, movement_type, quantity_delta,
    quantity_before, quantity_after, reference_type, reference_id,
    performed_by, reason
  ) VALUES (
    p_product_id, p_location_id, p_movement_type, p_quantity_delta,
    v_current, v_new, p_reference_type, p_reference_id,
    p_performed_by, p_reason
  )
  RETURNING * INTO v_ledger;

  RETURN v_ledger;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Access: these tables are only ever touched by the Express backend
-- using the service-role key (which bypasses RLS). No browser client
-- should ever query them directly, so deny by default rather than
-- crafting per-branch RLS policies that would never be exercised.
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE products, inventory_locations, inventory_balances,
  inventory_ledger, stock_transfers, stock_transfer_items
  FROM anon, authenticated;

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool (available in this environment) with the file contents above, or paste the file into the Supabase SQL Editor and run it. Do not use `server/run-migration.js` — that script is hardcoded to `moka_integration_schema.sql` specifically.

- [ ] **Step 3: Manual smoke check**

Run this in the Supabase SQL Editor and confirm it returns 6 rows (1 warehouse + 5 branches) and the function exists:

```sql
SELECT type, outlet_id FROM inventory_locations ORDER BY type;
SELECT proname FROM pg_proc WHERE proname = 'apply_inventory_movement';
```

- [ ] **Step 4: Commit**

```bash
git add server/migrations/2026-08-15-stockist-inventory-foundation.sql
git commit -m "feat(stockist): add inventory foundation schema and ledger function"
```

---

### Task 2: Backend access policy (`stockistAccess.js`)

**Files:**
- Create: `server/services/stockistAccess.js`
- Test: `server/test/stockist-access.test.js`

**Interfaces:**
- Consumes: `req.adminAuth` shape set by the existing `adminAuth` middleware in `server/index.js` (`{ staffId, role, branch, sessionVerified }`) — same shape `adminCrm.js` already relies on.
- Produces (used by every later route task):
  - `getVerifiedStockistAccess(req)` → `{ role: 'owner' | 'branch_admin', branch: string | null, staffId: string } | null`
  - `resolveStockistLocationScope(access, requestedLocationType, requestedBranchSlug)` → `{ ok: true, branch: string | null } | { ok: false, status: number, error: string }`
  - `STOCKIST_BRANCHES` — `Set` of the 5 valid branch slugs.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-access.test.js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getVerifiedStockistAccess,
  resolveStockistLocationScope,
} = require('../services/stockistAccess');

test('getVerifiedStockistAccess accepts a verified owner session', () => {
  const req = { adminAuth: { staffId: 'owner-1', role: 'owner', branch: null, sessionVerified: true } };
  assert.deepEqual(getVerifiedStockistAccess(req), { role: 'owner', branch: null, staffId: 'owner-1' });
});

test('getVerifiedStockistAccess accepts a verified branch_admin session with a valid branch', () => {
  const req = { adminAuth: { staffId: 'admin-csb', role: 'branch_admin', branch: 'csb', sessionVerified: true } };
  assert.deepEqual(getVerifiedStockistAccess(req), { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' });
});

test('getVerifiedStockistAccess rejects unverified sessions, unknown roles, barbers, and bad branches', () => {
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'owner', branch: null, sessionVerified: false } }), null);
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'barber', branch: null, sessionVerified: true } }), null);
  assert.equal(getVerifiedStockistAccess({ adminAuth: { staffId: 'x', role: 'branch_admin', branch: 'not-a-branch', sessionVerified: true } }), null);
  assert.equal(getVerifiedStockistAccess({}), null);
});

test('resolveStockistLocationScope: owner may act on the warehouse or any branch', () => {
  const owner = { role: 'owner', branch: null, staffId: 'owner-1' };
  assert.deepEqual(resolveStockistLocationScope(owner, 'warehouse', null), { ok: true, branch: null });
  assert.deepEqual(resolveStockistLocationScope(owner, 'branch', 'tegal'), { ok: true, branch: 'tegal' });
});

test('resolveStockistLocationScope: owner rejects an invalid branch slug', () => {
  const owner = { role: 'owner', branch: null, staffId: 'owner-1' };
  assert.deepEqual(resolveStockistLocationScope(owner, 'branch', 'nowhere'), { ok: false, status: 400, error: 'invalid branch' });
});

test('resolveStockistLocationScope: branch_admin may only act on their own branch, never the warehouse', () => {
  const csbAdmin = { role: 'branch_admin', branch: 'csb', staffId: 'admin-csb' };
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'branch', 'csb'), { ok: true, branch: 'csb' });
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'branch', 'tegal'), { ok: false, status: 403, error: 'branch access denied' });
  assert.deepEqual(resolveStockistLocationScope(csbAdmin, 'warehouse', null), { ok: false, status: 403, error: 'branch access denied' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-access.test.js`
Expected: FAIL — `Cannot find module '../services/stockistAccess'`

- [ ] **Step 3: Write the implementation**

```javascript
// server/services/stockistAccess.js
'use strict';

const STOCKIST_BRANCHES = new Set(['bypass', 'sumber', 'samadikun', 'csb', 'tegal']);

function getVerifiedStockistAccess(req) {
  const auth = req.adminAuth;
  if (!auth?.sessionVerified || !['owner', 'branch_admin'].includes(auth.role)) return null;
  if (auth.role === 'owner') {
    return { role: 'owner', branch: null, staffId: auth.staffId };
  }
  const branch = typeof auth.branch === 'string' ? auth.branch.trim().toLowerCase() : '';
  if (!STOCKIST_BRANCHES.has(branch)) return null;
  return { role: 'branch_admin', branch, staffId: auth.staffId };
}

function resolveStockistLocationScope(access, requestedLocationType, requestedBranchSlug) {
  if (access.role === 'branch_admin') {
    const branch = typeof requestedBranchSlug === 'string' ? requestedBranchSlug.trim().toLowerCase() : '';
    if (requestedLocationType !== 'branch' || branch !== access.branch) {
      return { ok: false, status: 403, error: 'branch access denied' };
    }
    return { ok: true, branch: access.branch };
  }

  // owner
  if (requestedLocationType === 'warehouse') {
    return { ok: true, branch: null };
  }
  const branch = typeof requestedBranchSlug === 'string' ? requestedBranchSlug.trim().toLowerCase() : '';
  if (!STOCKIST_BRANCHES.has(branch)) {
    return { ok: false, status: 400, error: 'invalid branch' };
  }
  return { ok: true, branch };
}

module.exports = { STOCKIST_BRANCHES, getVerifiedStockistAccess, resolveStockistLocationScope };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-access.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/stockistAccess.js server/test/stockist-access.test.js
git commit -m "feat(stockist): add role/branch access policy"
```

---

### Task 3: Backend inventory service (`stockistInventory.js`)

**Files:**
- Create: `server/services/stockistInventory.js`
- Test: `server/test/stockist-inventory-service.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions plus one thin Supabase RPC wrapper).
- Produces (used by every route task):
  - `applyInventoryMovement(supabase, params)` → calls `supabase.rpc('apply_inventory_movement', {...})`, throws `Error` with the Postgres message on failure, returns the ledger row on success.
  - `stripPurchasePrice(product, role)` → returns a shallow copy of `product` with `purchase_price` deleted when `role !== 'owner'`.
  - `calculateTransferDiscrepancy(items)` → `boolean`, true if any item's `quantity_received !== quantity_sent` (ignoring items where `quantity_received` is still `null`).
  - `validateAdjustmentReason(reason)` → throws `Error('reason is required for manual adjustments')` if blank/missing.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-inventory-service.test.js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
} = require('../services/stockistInventory');

test('applyInventoryMovement calls the RPC with the given params and returns the ledger row', async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: 'ledger-1', quantity_after: 5 }, error: null };
    },
  };
  const result = await applyInventoryMovement(supabase, {
    productId: 'p1', locationId: 'l1', quantityDelta: 5, movementType: 'WAREHOUSE_RECEIVE',
    performedBy: 'u1', referenceType: null, referenceId: null, reason: 'invoice #123',
  });
  assert.deepEqual(calls, [{
    name: 'apply_inventory_movement',
    args: {
      p_product_id: 'p1', p_location_id: 'l1', p_quantity_delta: 5, p_movement_type: 'WAREHOUSE_RECEIVE',
      p_performed_by: 'u1', p_reference_type: null, p_reference_id: null, p_reason: 'invoice #123',
    },
  }]);
  assert.deepEqual(result, { id: 'ledger-1', quantity_after: 5 });
});

test('applyInventoryMovement throws the Postgres error message on failure', async () => {
  const supabase = { async rpc() { return { data: null, error: { message: 'insufficient stock: ...' } }; } };
  await assert.rejects(
    () => applyInventoryMovement(supabase, {
      productId: 'p1', locationId: 'l1', quantityDelta: -5, movementType: 'TRANSFER_OUT', performedBy: 'u1',
    }),
    /insufficient stock/,
  );
});

test('stripPurchasePrice removes purchase_price for non-owner roles only', () => {
  const product = { id: 'p1', name: 'Pomade', purchase_price: 12000, retail_price: 25000 };
  assert.deepEqual(stripPurchasePrice(product, 'owner'), product);
  assert.deepEqual(stripPurchasePrice(product, 'branch_admin'), { id: 'p1', name: 'Pomade', retail_price: 25000 });
});

test('calculateTransferDiscrepancy detects any mismatched received quantity', () => {
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: 10 }]), false);
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: 8 }]), true);
  assert.equal(calculateTransferDiscrepancy([{ quantity_sent: 10, quantity_received: null }]), false);
  assert.equal(calculateTransferDiscrepancy([
    { quantity_sent: 10, quantity_received: 10 },
    { quantity_sent: 5, quantity_received: 4 },
  ]), true);
});

test('validateAdjustmentReason rejects blank or missing reasons', () => {
  assert.throws(() => validateAdjustmentReason(''), /reason is required/);
  assert.throws(() => validateAdjustmentReason('   '), /reason is required/);
  assert.throws(() => validateAdjustmentReason(undefined), /reason is required/);
  assert.doesNotThrow(() => validateAdjustmentReason('koreksi salah input qty'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-inventory-service.test.js`
Expected: FAIL — `Cannot find module '../services/stockistInventory'`

- [ ] **Step 3: Write the implementation**

```javascript
// server/services/stockistInventory.js
'use strict';

async function applyInventoryMovement(supabase, {
  productId, locationId, quantityDelta, movementType, performedBy,
  referenceType = null, referenceId = null, reason = null,
}) {
  const { data, error } = await supabase.rpc('apply_inventory_movement', {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity_delta: quantityDelta,
    p_movement_type: movementType,
    p_performed_by: performedBy,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || 'inventory movement failed');
  return data;
}

function stripPurchasePrice(product, role) {
  if (role === 'owner') return product;
  const { purchase_price, ...rest } = product;
  return rest;
}

function calculateTransferDiscrepancy(items) {
  return items.some((item) => item.quantity_received != null && item.quantity_received !== item.quantity_sent);
}

function validateAdjustmentReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reason is required for manual adjustments');
  }
}

module.exports = {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-inventory-service.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/stockistInventory.js server/test/stockist-inventory-service.test.js
git commit -m "feat(stockist): add movement RPC wrapper and price-stripping helpers"
```

---

### Task 4: Products routes + router wiring

**Files:**
- Create: `server/routes/stockist.js`
- Modify: `server/index.js` (mount the router near the other `app.use('/api/...', create...Routes(...))` calls, around line 3458)
- Test: `server/test/stockist-routes-products.test.js`

**Interfaces:**
- Consumes: `getVerifiedStockistAccess` (Task 2), `stripPurchasePrice` (Task 3).
- Produces: `createStockistRoutes(supabase, adminAuth)` → `express.Router`, exported as the sole export of `server/routes/stockist.js`. Endpoints so far: `GET /products`, `POST /products`. Later tasks add more `router.*` calls to this same file/router — this task creates the file and the router-creation shape every subsequent task extends.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-routes-products.test.js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function fakeSupabase({ products = [] } = {}) {
  const state = { products: structuredClone(products), inserted: [] };
  return {
    state,
    from(table) {
      if (table !== 'products') throw new Error(`unexpected table ${table}`);
      const query = {
        _order: null,
        select() { return query; },
        order(column, opts) { query._order = { column, ascending: opts?.ascending !== false }; return query; },
        insert(row) {
          const record = { id: `product-${state.inserted.length + 1}`, is_active: true, ...row };
          state.inserted.push(record);
          state.products.push(record);
          return { select() { return { single: async () => ({ data: record, error: null }) }; } };
        },
        then(resolve, reject) {
          let rows = structuredClone(state.products);
          if (query._order) {
            const { column, ascending } = query._order;
            rows.sort((a, b) => (ascending ? 1 : -1) * String(a[column]).localeCompare(String(b[column])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('GET /products returns full product data for owner', async () => {
  const supabase = fakeSupabase({ products: [{ id: 'p1', sku: 'RB-POM-001', name: 'Pomade Matte', purchase_price: 12000, retail_price: 25000 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.products[0].purchase_price, 12000);
  }, { role: 'owner' });
});

test('GET /products strips purchase_price for branch_admin', async () => {
  const supabase = fakeSupabase({ products: [{ id: 'p1', sku: 'RB-POM-001', name: 'Pomade Matte', purchase_price: 12000, retail_price: 25000 }] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal('purchase_price' in body.products[0], false);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /products creates a product for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'RB-FW-001', name: 'Facewash 100ml', unit: 'pcs', purchase_price: 8000, retail_price: 20000 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.product.sku, 'RB-FW-001');
    assert.equal(supabase.state.inserted.length, 1);
  }, { role: 'owner' });
});

test('POST /products is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'RB-FW-001', name: 'Facewash 100ml' }),
    });
    assert.equal(res.status, 403);
    assert.equal(supabase.state.inserted.length, 0);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /products requires sku and name', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  }, { role: 'owner' });
});

test('all /products endpoints reject unverified sessions', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/products`);
    assert.equal(res.status, 403);
  }, { sessionVerified: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-routes-products.test.js`
Expected: FAIL — `Cannot find module '../routes/stockist'`

- [ ] **Step 3: Write the implementation**

```javascript
// server/routes/stockist.js
'use strict';

const express = require('express');
const { getVerifiedStockistAccess } = require('../services/stockistAccess');
const { stripPurchasePrice } = require('../services/stockistInventory');

function createStockistRoutes(supabase, adminAuth) {
  const router = express.Router();

  function requireAccess(req, res) {
    const access = getVerifiedStockistAccess(req);
    if (!access) {
      res.status(403).json({ error: 'stockist access required' });
      return null;
    }
    return access;
  }

  // ─── PRODUCTS ────────────────────────────────────────────────
  router.get('/products', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data, error } = await supabase.from('products').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const products = (data || []).map((p) => stripPurchasePrice(p, access.role));
    return res.json({ products });
  });

  router.post('/products', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create products' });
    }

    const { sku, name, category, brand, unit, barcode, purchase_price, retail_price, minimum_stock, reorder_point } = req.body || {};
    if (typeof sku !== 'string' || !sku.trim() || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'sku and name are required' });
    }

    const { data, error } = await supabase.from('products').insert({
      sku: sku.trim(),
      name: name.trim(),
      category: category || null,
      brand: brand || null,
      unit: unit || 'pcs',
      barcode: barcode || null,
      purchase_price: purchase_price ?? null,
      retail_price: retail_price ?? null,
      minimum_stock: minimum_stock ?? 0,
      reorder_point: reorder_point ?? 0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ product: data });
  });

  return router;
}

module.exports = { createStockistRoutes };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-routes-products.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Mount the router in `server/index.js`**

Find the existing block (around line 3458, next to `createAdminCrmRoutes`):

```javascript
app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
```

Add immediately after it:

```javascript
const { createStockistRoutes } = require('./routes/stockist');
app.use('/api/stockist', createStockistRoutes(supabase, adminAuth));
```

- [ ] **Step 6: Run the full suite to check nothing else broke**

Run: `npm test`
Expected: PASS (all existing tests plus the new ones)

- [ ] **Step 7: Commit**

```bash
git add server/routes/stockist.js server/test/stockist-routes-products.test.js server/index.js
git commit -m "feat(stockist): add products endpoints and mount stockist router"
```

---

### Task 5: Warehouse receive + inventory summary + ledger routes

**Files:**
- Modify: `server/routes/stockist.js` (add routes to the existing router)
- Test: `server/test/stockist-routes-warehouse.test.js`

**Interfaces:**
- Consumes: `applyInventoryMovement`, `stripPurchasePrice` (Task 3), `getVerifiedStockistAccess`, `resolveStockistLocationScope` (Task 2), `STOCKIST_BRANCHES` (Task 2).
- Produces: `POST /warehouse/receive`, `GET /inventory/summary`, `GET /inventory/ledger`.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-routes-warehouse.test.js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = await new Promise((resolve) => app.listen(0, '127.0.0.1', () => resolve(app.listen)));
  const actualServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => actualServer.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${actualServer.address().port}`);
  } finally {
    await new Promise((resolve, reject) => actualServer.close((err) => err ? reject(err) : resolve()));
  }
}

function fakeSupabase({ locations = [], balances = [] } = {}) {
  const state = { locations, balances, rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(col, val) { query._filters.push((row) => row[col] === val); return query; },
          then(resolve, reject) {
            const rows = state.locations.filter((row) => query._filters.every((f) => f(row)));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      if (table === 'inventory_balances') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(col, val) { query._filters.push((row) => row[col] === val); return query; },
          then(resolve, reject) {
            const rows = state.balances.filter((row) => query._filters.every((f) => f(row)));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: { id: 'ledger-1', quantity_after: (args.p_quantity_delta || 0) }, error: null };
    },
  };
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };

test('POST /warehouse/receive applies a WAREHOUSE_RECEIVE movement for owner', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 50, reason: 'invoice #INV-001' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'WAREHOUSE_RECEIVE');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, 50);
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-warehouse');
    assert.equal(body.ledger.quantity_after, 50);
  }, { role: 'owner' });
});

test('POST /warehouse/receive is rejected for branch_admin', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 50 }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /warehouse/receive rejects zero or negative quantity', async () => {
  const supabase = fakeSupabase({ locations: [WAREHOUSE] });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/warehouse/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', quantity: 0 }),
    });
    assert.equal(res.status, 400);
  }, { role: 'owner' });
});

test('GET /inventory/summary?location=warehouse works for owner only', async () => {
  const supabase = fakeSupabase({
    locations: [WAREHOUSE],
    balances: [{ product_id: 'p1', location_id: 'loc-warehouse', quantity: 40 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=warehouse`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.balances[0].quantity, 40);
  }, { role: 'owner' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=warehouse`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('GET /inventory/summary?location=<branch> is scoped to the caller branch', async () => {
  const csbLocation = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };
  const supabase = fakeSupabase({
    locations: [WAREHOUSE, csbLocation],
    balances: [{ product_id: 'p1', location_id: 'loc-csb', quantity: 12 }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/summary?location=csb`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-routes-warehouse.test.js`
Expected: FAIL — 404s from the router (routes don't exist yet)

- [ ] **Step 3: Add the routes to `server/routes/stockist.js`**

Add these `require`s near the top (alongside the existing ones):

```javascript
const { applyInventoryMovement, stripPurchasePrice } = require('../services/stockistInventory');
const { getVerifiedStockistAccess, resolveStockistLocationScope, STOCKIST_BRANCHES } = require('../services/stockistAccess');
```

(`stripPurchasePrice` is already required from Task 4 — just add `applyInventoryMovement` to that line, and add the new `stockistAccess` line since Task 4 only imported `getVerifiedStockistAccess`.)

Add a small location-lookup helper and the three routes, inside `createStockistRoutes`, after the products routes:

```javascript
  async function findLocation(type, branchSlug) {
    let query = supabase.from('inventory_locations').select('*').eq('type', type);
    if (type === 'warehouse') {
      const { data } = await query;
      return (data || [])[0] || null;
    }
    const { data: outlets } = await supabase.from('outlets').select('id').eq('slug', branchSlug).single();
    if (!outlets) return null;
    const { data } = await query.eq('outlet_id', outlets.id);
    return (data || [])[0] || null;
  }

  // ─── WAREHOUSE ───────────────────────────────────────────────
  router.post('/warehouse/receive', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can receive warehouse stock' });
    }

    const { product_id, quantity, reason } = req.body || {};
    if (typeof product_id !== 'string' || !product_id) {
      return res.status(400).json({ error: 'product_id required' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    const warehouse = await findLocation('warehouse', null);
    if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });

    try {
      const ledger = await applyInventoryMovement(supabase, {
        productId: product_id, locationId: warehouse.id, quantityDelta: quantity,
        movementType: 'WAREHOUSE_RECEIVE', performedBy: access.staffId, reason: reason || null,
      });
      return res.json({ ledger });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ─── INVENTORY ───────────────────────────────────────────────
  router.get('/inventory/summary', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const locationParam = req.query.location;
    if (typeof locationParam !== 'string' || !locationParam) {
      return res.status(400).json({ error: 'location query param required' });
    }
    const type = locationParam === 'warehouse' ? 'warehouse' : 'branch';
    const branchSlug = type === 'branch' ? locationParam : null;

    const scope = resolveStockistLocationScope(access, type, branchSlug);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

    const location = await findLocation(type, branchSlug);
    if (!location) return res.status(404).json({ error: 'location not found' });

    const { data, error } = await supabase.from('inventory_balances').select('*').eq('location_id', location.id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ balances: data || [] });
  });

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-routes-warehouse.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/stockist.js server/test/stockist-routes-warehouse.test.js
git commit -m "feat(stockist): add warehouse receive and inventory summary/ledger endpoints"
```

---

### Task 6: Transfers routes (create/send, list, receive)

**Files:**
- Modify: `server/routes/stockist.js`
- Test: `server/test/stockist-routes-transfers.test.js`

**Interfaces:**
- Consumes: `applyInventoryMovement`, `calculateTransferDiscrepancy` (Task 3), `getVerifiedStockistAccess`, `resolveStockistLocationScope` (Task 2), `findLocation` (Task 5, same file — reused directly, not re-implemented).
- Produces: `POST /transfers`, `GET /transfers`, `PATCH /transfers/:id/receive`.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-routes-transfers.test.js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase({ locations = [WAREHOUSE, CSB], outlets = [{ id: 'outlet-csb', slug: 'csb' }], transfers = [], items = [] } = {}) {
  const state = { locations, outlets, transfers: structuredClone(transfers), items: structuredClone(items), rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: state.locations.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'outlets') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          single: async () => ({ data: state.outlets.find((r) => query._filters.every((f) => f(r))) || null, error: null }) };
        return query;
      }
      if (table === 'stock_transfers') {
        const query = {
          _filters: [], _patch: null,
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          insert(row) {
            const record = { id: `transfer-${state.transfers.length + 1}`, status: 'SENT', created_at: new Date().toISOString(), ...row };
            state.transfers.push(record);
            return { select() { return { single: async () => ({ data: record, error: null }) }; } };
          },
          update(patch) { query._patch = patch; return query; },
          then(res, rej) {
            if (query._patch) {
              const matched = state.transfers.filter((r) => query._filters.every((f) => f(r)));
              for (const row of matched) Object.assign(row, query._patch);
              return Promise.resolve({ data: matched, error: null }).then(res, rej);
            }
            return Promise.resolve({ data: state.transfers.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej);
          },
        };
        return query;
      }
      if (table === 'stock_transfer_items') {
        const query = {
          _filters: [],
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          insert(rows) {
            const list = Array.isArray(rows) ? rows : [rows];
            const records = list.map((row, i) => ({ id: `item-${state.items.length + i + 1}`, quantity_received: null, ...row }));
            state.items.push(...records);
            return Promise.resolve({ data: records, error: null });
          },
          update(patch) {
            const target = query;
            target._patch = patch;
            return target;
          },
          then(res, rej) {
            const matched = state.items.filter((r) => query._filters.every((f) => f(r)));
            if (query._patch) { for (const row of matched) Object.assign(row, query._patch); }
            return Promise.resolve({ data: matched, error: null }).then(res, rej);
          },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: { id: `ledger-${state.rpcCalls.length}`, quantity_after: 0 }, error: null };
    },
  };
}

test('POST /transfers creates a SENT transfer and decrements warehouse stock for owner', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.transfer.status, 'SENT');
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'TRANSFER_OUT');
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-warehouse');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, -10);
  }, { role: 'owner' });
});

test('POST /transfers is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_branch: 'csb', items: [{ product_id: 'p1', quantity: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive lets the destination branch_admin confirm quantities and flags discrepancy', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 8 }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.transfer.status, 'RECEIVED');
    assert.equal(body.has_discrepancy, true);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'TRANSFER_IN');
    assert.equal(supabase.state.rpcCalls[0].args.p_location_id, 'loc-csb');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, 8);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive rejects a branch_admin from a different branch', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 10 }] }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-routes-transfers.test.js`
Expected: FAIL — 404s (routes don't exist yet)

- [ ] **Step 3: Add the routes to `server/routes/stockist.js`**

Add `calculateTransferDiscrepancy` to the existing `stockistInventory` require line, and `randomUUID` for transfer numbers:

```javascript
const { randomUUID } = require('crypto');
const { applyInventoryMovement, stripPurchasePrice, calculateTransferDiscrepancy } = require('../services/stockistInventory');
```

Add the routes after the inventory routes:

```javascript
  // ─── TRANSFERS ───────────────────────────────────────────────
  router.post('/transfers', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create transfers' });
    }

    const { destination_branch, items } = req.body || {};
    if (!STOCKIST_BRANCHES.has(destination_branch)) {
      return res.status(400).json({ error: 'destination_branch invalid' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.product_id || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { product_id, quantity > 0 }' });
    }

    const warehouse = await findLocation('warehouse', null);
    const destination = await findLocation('branch', destination_branch);
    if (!warehouse || !destination) return res.status(500).json({ error: 'location not configured' });

    const { data: transfer, error: transferError } = await supabase.from('stock_transfers').insert({
      transfer_number: `TRF-${Date.now()}-${randomUUID().slice(0, 6)}`,
      source_location_id: warehouse.id,
      destination_location_id: destination.id,
      status: 'SENT',
      sent_by: access.staffId,
    }).select().single();
    if (transferError) return res.status(500).json({ error: transferError.message });

    try {
      for (const item of items) {
        await applyInventoryMovement(supabase, {
          productId: item.product_id, locationId: warehouse.id, quantityDelta: -item.quantity,
          movementType: 'TRANSFER_OUT', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await supabase.from('stock_transfer_items').insert(
      items.map((i) => ({ stock_transfer_id: transfer.id, product_id: i.product_id, quantity_sent: i.quantity, quantity_received: null }))
    );

    return res.json({ transfer });
  });

  router.get('/transfers', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('stock_transfers').select('*');
    if (access.role === 'branch_admin') {
      const location = await findLocation('branch', access.branch);
      if (!location) return res.status(500).json({ error: 'location not configured' });
      query = query.eq('destination_location_id', location.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ transfers: data || [] });
  });

  router.patch('/transfers/:id/receive', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: transfers, error: transferError } = await supabase.from('stock_transfers').select('*').eq('id', req.params.id);
    if (transferError) return res.status(500).json({ error: transferError.message });
    const transfer = (transfers || [])[0];
    if (!transfer) return res.status(404).json({ error: 'transfer not found' });

    if (access.role === 'branch_admin') {
      const ownBranchLocation = await findLocation('branch', access.branch);
      if (!ownBranchLocation || ownBranchLocation.id !== transfer.destination_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.item_id || !Number.isInteger(i.quantity_received) || i.quantity_received < 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { item_id, quantity_received >= 0 }' });
    }

    const { data: transferItems, error: itemsError } = await supabase.from('stock_transfer_items').select('*').eq('stock_transfer_id', transfer.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const byId = new Map((transferItems || []).map((i) => [i.id, i]));
    try {
      for (const submitted of items) {
        const existing = byId.get(submitted.item_id);
        if (!existing) throw new Error(`unknown transfer item ${submitted.item_id}`);
        await applyInventoryMovement(supabase, {
          productId: existing.product_id, locationId: transfer.destination_location_id, quantityDelta: submitted.quantity_received,
          movementType: 'TRANSFER_IN', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
        await supabase.from('stock_transfer_items').update({ quantity_received: submitted.quantity_received }).eq('id', submitted.item_id);
        existing.quantity_received = submitted.quantity_received;
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { data: updatedTransfers } = await supabase.from('stock_transfers').update({
      status: 'RECEIVED', received_by: access.staffId, received_at: new Date().toISOString(),
    }).eq('id', transfer.id);
    const updatedTransfer = (updatedTransfers || [])[0] || { ...transfer, status: 'RECEIVED' };

    return res.json({ transfer: updatedTransfer, has_discrepancy: calculateTransferDiscrepancy([...byId.values()]) });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-routes-transfers.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/stockist.js server/test/stockist-routes-transfers.test.js
git commit -m "feat(stockist): add transfer create/list/receive endpoints"
```

---

### Task 7: Manual adjustment route

**Files:**
- Modify: `server/routes/stockist.js`
- Test: `server/test/stockist-routes-adjustment.test.js`

**Interfaces:**
- Consumes: `applyInventoryMovement`, `validateAdjustmentReason` (Task 3), `findLocation` (Task 5, same file).
- Produces: `POST /inventory/adjustment`.

- [ ] **Step 1: Write the failing tests**

```javascript
// server/test/stockist-routes-adjustment.test.js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createStockistRoutes } = require('../routes/stockist');

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null, sessionVerified = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/stockist', createStockistRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified };
    next();
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

const WAREHOUSE = { id: 'loc-warehouse', type: 'warehouse', outlet_id: null };
const CSB = { id: 'loc-csb', type: 'branch', outlet_id: 'outlet-csb' };

function fakeSupabase() {
  const state = { rpcCalls: [] };
  return {
    state,
    from(table) {
      if (table === 'inventory_locations') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: [WAREHOUSE, CSB].filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'outlets') {
        return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { id: 'outlet-csb' }, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) { state.rpcCalls.push({ name, args }); return { data: { id: 'ledger-1' }, error: null }; },
  };
}

test('POST /inventory/adjustment applies an ADJUSTMENT movement for owner with a reason', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'warehouse', quantity_delta: -2, reason: 'koreksi salah input' }),
    });
    assert.equal(res.status, 200);
    assert.equal(supabase.state.rpcCalls[0].args.p_movement_type, 'ADJUSTMENT');
    assert.equal(supabase.state.rpcCalls[0].args.p_quantity_delta, -2);
  }, { role: 'owner' });
});

test('POST /inventory/adjustment rejects a missing reason', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'warehouse', quantity_delta: -2 }),
    });
    assert.equal(res.status, 400);
    assert.equal(supabase.state.rpcCalls.length, 0);
  }, { role: 'owner' });
});

test('POST /inventory/adjustment is rejected for branch_admin', async () => {
  const supabase = fakeSupabase();
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/inventory/adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'p1', location_type: 'branch', location_branch: 'csb', quantity_delta: 2, reason: 'koreksi' }),
    });
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'csb' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/test/stockist-routes-adjustment.test.js`
Expected: FAIL — route does not exist yet

- [ ] **Step 3: Add the route to `server/routes/stockist.js`**

Add `validateAdjustmentReason` to the existing `stockistInventory` require line. Add the route after the transfers routes:

```javascript
  // ─── MANUAL ADJUSTMENT ───────────────────────────────────────
  router.post('/inventory/adjustment', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can perform manual adjustments' });
    }

    const { product_id, location_type, location_branch, quantity_delta, reason } = req.body || {};
    try {
      validateAdjustmentReason(reason);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (typeof product_id !== 'string' || !product_id) {
      return res.status(400).json({ error: 'product_id required' });
    }
    if (!Number.isInteger(quantity_delta) || quantity_delta === 0) {
      return res.status(400).json({ error: 'quantity_delta must be a non-zero integer' });
    }
    if (location_type !== 'warehouse' && location_type !== 'branch') {
      return res.status(400).json({ error: 'location_type must be warehouse or branch' });
    }

    const location = await findLocation(location_type, location_type === 'branch' ? location_branch : null);
    if (!location) return res.status(404).json({ error: 'location not found' });

    try {
      const ledger = await applyInventoryMovement(supabase, {
        productId: product_id, locationId: location.id, quantityDelta: quantity_delta,
        movementType: 'ADJUSTMENT', performedBy: access.staffId, reason,
      });
      return res.json({ ledger });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/stockist-routes-adjustment.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — this is the last backend route task, so also confirm the full `server/routes/stockist.js` file reads cleanly top to bottom (no leftover duplicate requires from Tasks 4-7).

- [ ] **Step 6: Commit**

```bash
git add server/routes/stockist.js server/test/stockist-routes-adjustment.test.js
git commit -m "feat(stockist): add manual inventory adjustment endpoint"
```

---

### Task 8: Frontend proxy layer

**Files:**
- Create: `frontend/src/app/api/stockist/_auth.ts`
- Create: `frontend/src/app/api/stockist/_policy.ts`
- Create: `frontend/src/app/api/stockist/products/route.ts`
- Create: `frontend/src/app/api/stockist/inventory/summary/route.ts`
- Create: `frontend/src/app/api/stockist/inventory/ledger/route.ts`
- Create: `frontend/src/app/api/stockist/inventory/adjustment/route.ts`
- Create: `frontend/src/app/api/stockist/warehouse/receive/route.ts`
- Create: `frontend/src/app/api/stockist/transfers/route.ts`
- Create: `frontend/src/app/api/stockist/transfers/[id]/receive/route.ts`

**Interfaces:**
- Consumes: `requireAdminSessionProxySecret` from `frontend/src/app/api/admin/crm/membership/_proxySecret.ts` (reused directly, not duplicated), `createClient` from `frontend/src/utils/supabase/server.ts`.
- Produces: `requireStockistSession()` → `{ ok: true, session } | { ok: false, response }`; `createStockistProxyHeaders(session)` → `Record<string, string>`. Every `route.ts` file in this task uses these two functions the same way `frontend/src/app/api/admin/crm/membership/*/route.ts` already uses their membership equivalents.

No `node:test` coverage for this task — Next.js API routes aren't covered by the `server/test/*.test.js` suite anywhere else in this repo either (the membership ones aren't tested individually; only the shared crypto in `_proxySecret.ts` is, via cross-import from `server/test/admin-session-assertion.test.js`, which already exercises this exact file). Verified manually in Task 12 once the UI can drive it end to end.

- [ ] **Step 1: Write `_policy.ts`**

```typescript
// frontend/src/app/api/stockist/_policy.ts
export const STOCKIST_BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'] as const;

export type StockistBranch = (typeof STOCKIST_BRANCHES)[number];
export type StockistRole = 'owner' | 'branch_admin';

export type StockistSession = {
  userId: string;
  role: StockistRole;
  branch: StockistBranch | null;
};

type AuthUser = { id?: string | null } | null | undefined;
type UserProfile = { id?: string | null; role?: string | null; branch?: string | null } | null | undefined;

type PolicyFailure = { ok: false; status: 401 | 403; error: string };
type PolicySuccess<T> = { ok: true; value: T };

function isStockistBranch(value: string): value is StockistBranch {
  return (STOCKIST_BRANCHES as readonly string[]).includes(value);
}

export function authorizeStockistAdmin(
  user: AuthUser,
  profile: UserProfile,
): PolicyFailure | PolicySuccess<StockistSession> {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };

  if (!profile || profile.id !== userId || !['owner', 'branch_admin'].includes(profile.role || '')) {
    return { ok: false, status: 403, error: 'Stockist access required' };
  }

  if (profile.role === 'owner') {
    return { ok: true, value: { userId, role: 'owner', branch: null } };
  }

  const branch = typeof profile.branch === 'string' ? profile.branch.trim().toLowerCase() : '';
  if (!isStockistBranch(branch)) {
    return { ok: false, status: 403, error: 'Admin branch is not configured' };
  }
  return { ok: true, value: { userId, role: 'branch_admin', branch } };
}
```

- [ ] **Step 2: Write `_auth.ts`**

```typescript
// frontend/src/app/api/stockist/_auth.ts
import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { authorizeStockistAdmin, type StockistSession } from './_policy';
import { requireAdminSessionProxySecret } from '../admin/crm/membership/_proxySecret';

type SessionResult =
  | { ok: true; session: StockistSession }
  | { ok: false; response: NextResponse };

export async function requireStockistSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id,role,branch')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, response: NextResponse.json({ error: 'Unable to verify stockist access' }, { status: 500 }) };
  }

  const decision = authorizeStockistAdmin(user, profile);
  if (!decision.ok) {
    return { ok: false, response: NextResponse.json({ error: decision.error }, { status: decision.status }) };
  }

  return { ok: true, session: decision.value };
}

export function createStockistProxyHeaders(session: StockistSession): Record<string, string> {
  const token = process.env.ADMIN_PASSWORD ?? '';
  const signingSecret = requireAdminSessionProxySecret(process.env);
  if (!token) throw new Error('stockist admin proxy is not configured securely');

  const payload = Buffer.from(JSON.stringify({
    sub: session.userId,
    role: session.role,
    branch: session.branch,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(payload).digest('base64url');

  return {
    'x-admin-token': token,
    'x-redbox-admin-session': `${payload}.${signature}`,
  };
}
```

- [ ] **Step 3: Write the route handlers**

```typescript
// frontend/src/app/api/stockist/products/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET() {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const res = await fetch(`${API_URL}/api/stockist/products`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/products`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/inventory/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const res = await fetch(`${API_URL}/api/stockist/inventory/summary?${searchParams.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/inventory/ledger/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const res = await fetch(`${API_URL}/api/stockist/inventory/ledger?${searchParams.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/inventory/adjustment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/inventory/adjustment`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/warehouse/receive/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/warehouse/receive`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/transfers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET() {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const res = await fetch(`${API_URL}/api/stockist/transfers`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/transfers`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

```typescript
// frontend/src/app/api/stockist/transfers/[id]/receive/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stockist/transfers/${id}/receive`, {
    method: 'PATCH', signal: AbortSignal.timeout(10_000),
    headers: { ...createStockistProxyHeaders(auth.session), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from the `api/stockist/*` files. (This repo's Next.js version is unusual per `frontend/AGENTS.md` — if `tsc --noEmit` surfaces unrelated pre-existing errors, confirm they also exist on `main` before treating them as this task's problem.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/stockist
git commit -m "feat(stockist): add Next.js proxy routes mirroring the membership auth pattern"
```

---

### Task 9: Typed API client (`stockistApi.ts`)

**Files:**
- Create: `frontend/src/lib/stockistApi.ts`

**Interfaces:**
- Consumes: the `/api/stockist/*` routes from Task 8.
- Produces: `StockistProduct`, `InventoryBalance`, `StockTransfer`, `StockTransferItem` types, and functions `listProducts()`, `createProduct(input)`, `getInventorySummary(location)`, `receiveWarehouseStock(input)`, `createTransfer(input)`, `listTransfers()`, `receiveTransfer(id, items)` — all thin `fetch` wrappers used by every page in Tasks 10-12.

- [ ] **Step 1: Write the client**

```typescript
// frontend/src/lib/stockistApi.ts
export interface StockistProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  purchase_price: number | null;
  retail_price: number | null;
  minimum_stock: number;
  reorder_point: number;
  is_active: boolean;
}

export interface InventoryBalance {
  product_id: string;
  location_id: string;
  quantity: number;
  updated_at: string;
}

export interface StockTransferItem {
  id: string;
  product_id: string;
  quantity_sent: number;
  quantity_received: number | null;
}

export interface StockTransfer {
  id: string;
  transfer_number: string;
  source_location_id: string;
  destination_location_id: string;
  status: 'SENT' | 'RECEIVED';
  sent_by: string;
  sent_at: string;
  received_by: string | null;
  received_at: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `request failed: ${res.status}`);
  return body as T;
}

export const listProducts = () => req<{ products: StockistProduct[] }>('/api/stockist/products');

export const createProduct = (input: Partial<StockistProduct>) =>
  req<{ product: StockistProduct }>('/api/stockist/products', { method: 'POST', body: JSON.stringify(input) });

export const getInventorySummary = (location: string) =>
  req<{ balances: InventoryBalance[] }>(`/api/stockist/inventory/summary?location=${encodeURIComponent(location)}`);

export const receiveWarehouseStock = (input: { product_id: string; quantity: number; reason?: string }) =>
  req<{ ledger: unknown }>('/api/stockist/warehouse/receive', { method: 'POST', body: JSON.stringify(input) });

export const createTransfer = (input: { destination_branch: string; items: { product_id: string; quantity: number }[] }) =>
  req<{ transfer: StockTransfer }>('/api/stockist/transfers', { method: 'POST', body: JSON.stringify(input) });

export const listTransfers = () => req<{ transfers: StockTransfer[] }>('/api/stockist/transfers');

export const receiveTransfer = (id: string, items: { item_id: string; quantity_received: number }[]) =>
  req<{ transfer: StockTransfer; has_discrepancy: boolean }>(`/api/stockist/transfers/${id}/receive`, {
    method: 'PATCH', body: JSON.stringify({ items }),
  });
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/stockistApi.ts
git commit -m "feat(stockist): add typed API client for stockist proxy routes"
```

---

### Task 10: Admin layout + products page

**Files:**
- Create: `frontend/src/app/admin/stockist/layout.tsx`
- Create: `frontend/src/app/admin/stockist/products/page.tsx`

**Interfaces:**
- Consumes: `useUser` (existing hook), `listProducts`/`createProduct` (Task 9).
- Produces: role-gated layout wrapping every `/admin/stockist/*` page; a working products list + create form for `owner`.

- [ ] **Step 1: Write the layout**

```tsx
// frontend/src/app/admin/stockist/layout.tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="min-h-dvh pb-20" style={{ background: '#070508', color: '#F0EAEB' }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2.5"
        style={{ background: 'rgba(8,5,9,0.96)', borderColor: '#201618' }}
      >
        <h1 className="font-bold text-[13px] tracking-widest uppercase" style={{ color: '#F0EAEB' }}>
          RedBox Stockist
        </h1>
        {user.role === 'branch_admin' && (
          <p className="text-[10px] capitalize font-medium" style={{ color: '#C72820' }}>{user.branch}</p>
        )}
      </header>
      <main className="px-4 py-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write the products page**

```tsx
// frontend/src/app/admin/stockist/products/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { listProducts, createProduct, type StockistProduct } from '@/lib/stockistApi';

export default function ProductsPage() {
  const { user } = useUser();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', unit: 'pcs', purchase_price: '', retail_price: '' });

  async function refresh() {
    try {
      const { products } = await listProducts();
      setProducts(products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load products');
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProduct({
        sku: form.sku, name: form.name, unit: form.unit,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        retail_price: form.retail_price ? Number(form.retail_price) : null,
      });
      setForm({ sku: '', name: '', unit: 'pcs', purchase_price: '', retail_price: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create product');
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Produk</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {user?.role === 'owner' && (
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 mb-6 text-sm">
          <input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="col-span-1 p-2 rounded bg-black/40 border border-white/10" required />
          <input placeholder="Nama produk" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-1 p-2 rounded bg-black/40 border border-white/10" required />
          <input placeholder="Harga beli" type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          <input placeholder="Harga jual" type="number" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          <button type="submit" className="col-span-2 p-2 rounded font-medium" style={{ background: '#C72820' }}>Tambah Produk</button>
        </form>
      )}

      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id} className="p-3 rounded border border-white/10 text-sm flex justify-between">
            <span>{p.name} <span className="opacity-50">({p.sku})</span></span>
            {p.retail_price != null && <span>Rp{p.retail_price.toLocaleString('id-ID')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run dev`
Then, logged in as an `owner` account, visit `/admin/stockist/products`, add a product with a unique SKU, and confirm it appears in the list with the price shown. Log in as a `branch_admin` account and confirm the create form is hidden.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/layout.tsx frontend/src/app/admin/stockist/products
git commit -m "feat(stockist): add stockist layout and products admin page"
```

---

### Task 11: Warehouse page + branch stock page

**Files:**
- Create: `frontend/src/app/admin/stockist/warehouse/page.tsx`
- Create: `frontend/src/app/admin/stockist/branch-stock/page.tsx`

**Interfaces:**
- Consumes: `listProducts`, `getInventorySummary`, `receiveWarehouseStock` (Task 9), `useUser`.
- Produces: owner-only warehouse stock view + "Terima Barang" form; branch-scoped stock view for `branch_admin` (and owner via `?branch=`).

- [ ] **Step 1: Write the warehouse page**

```tsx
// frontend/src/app/admin/stockist/warehouse/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { listProducts, getInventorySummary, receiveWarehouseStock, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export default function WarehousePage() {
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [form, setForm] = useState({ product_id: '', quantity: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [{ products }, { balances }] = await Promise.all([listProducts(), getInventorySummary('warehouse')]);
    setProducts(products);
    setBalances(balances);
  }

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, []);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await receiveWarehouseStock({ product_id: form.product_id, quantity: Number(form.quantity), reason: form.reason || undefined });
      setForm({ product_id: '', quantity: '', reason: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to receive stock');
    }
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Stok Pusat</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <form onSubmit={handleReceive} className="grid grid-cols-2 gap-2 mb-6 text-sm">
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="col-span-2 p-2 rounded bg-black/40 border border-white/10" required>
          <option value="">Pilih produk</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </select>
        <input placeholder="Qty diterima" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" required />
        <input placeholder="Catatan (no. invoice)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
        <button type="submit" className="col-span-2 p-2 rounded font-medium" style={{ background: '#C72820' }}>Terima Barang</button>
      </form>

      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id} className="p-3 rounded border border-white/10 text-sm flex justify-between">
            <span>{p.name}</span>
            <span>{quantityByProduct.get(p.id) ?? 0} {p.unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write the branch stock page**

```tsx
// frontend/src/app/admin/stockist/branch-stock/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { listProducts, getInventorySummary, type StockistProduct, type InventoryBalance } from '@/lib/stockistApi';

export default function BranchStockPage() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const branch = user?.role === 'owner' ? (searchParams.get('branch') || '') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branch) return;
    Promise.all([listProducts(), getInventorySummary(branch)])
      .then(([{ products }, { balances }]) => { setProducts(products); setBalances(balances); })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load stock'));
  }, [branch]);

  if (!branch) return <p className="text-sm opacity-70">Pilih cabang lewat parameter ?branch=</p>;

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  return (
    <div>
      <h2 className="text-lg font-bold mb-3 capitalize">Stok Cabang: {branch}</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <ul className="space-y-2">
        {products.map((p) => {
          const qty = quantityByProduct.get(p.id) ?? 0;
          const low = qty <= p.minimum_stock;
          return (
            <li key={p.id} className="p-3 rounded border text-sm flex justify-between" style={{ borderColor: low ? '#C72820' : 'rgba(255,255,255,0.1)' }}>
              <span>{p.name}</span>
              <span>{qty} {p.unit}{low && <span className="ml-2 text-red-400">low</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

As `owner`, visit `/admin/stockist/warehouse`, submit a "Terima Barang" entry, and confirm the quantity shown updates. Visit `/admin/stockist/branch-stock?branch=csb` and confirm it loads that branch's (initially empty) balances. As a `branch_admin` for `csb`, visit `/admin/stockist/branch-stock` (no query param) and confirm it shows the same data without needing the param.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/warehouse frontend/src/app/admin/stockist/branch-stock
git commit -m "feat(stockist): add warehouse and branch stock admin pages"
```

---

### Task 12: Transfer pages + AdminNav integration

**Files:**
- Create: `frontend/src/app/admin/stockist/transfers/page.tsx`
- Create: `frontend/src/app/admin/stockist/transfers/new/page.tsx`
- Create: `frontend/src/app/admin/stockist/transfers/[id]/page.tsx`
- Create: `frontend/src/app/admin/stockist/page.tsx`
- Create: `frontend/src/app/api/stockist/transfers/[id]/route.ts`
- Modify: `server/routes/stockist.js` (add `GET /transfers/:id`)
- Modify: `server/test/stockist-routes-transfers.test.js`
- Modify: `frontend/src/lib/stockistApi.ts` (add `getTransfer`)
- Modify: `frontend/src/components/AdminNav.tsx`

**Interfaces:**
- Consumes: `listTransfers`, `createTransfer`, `receiveTransfer`, `listProducts` (Task 9), `useUser`, `findLocation`/`requireAccess` (Task 5, same router file).
- Produces: the three remaining UI pages, the `GET /transfers/:id` endpoint + `getTransfer` client function this page needs (discovered as a gap while planning the page, not in the original spec's endpoint list — added here rather than deferred since the receive flow is unusable without it), and a working nav entry point into the whole module.

- [ ] **Step 1: Write the transfers list page**

```tsx
// frontend/src/app/admin/stockist/transfers/page.tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { listTransfers, type StockTransfer } from '@/lib/stockistApi';

export default function TransfersPage() {
  const { user } = useUser();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTransfers().then(({ transfers }) => setTransfers(transfers)).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-bold">Pengiriman</h2>
        {user?.role === 'owner' && (
          <Link href="/admin/stockist/transfers/new" className="text-sm px-3 py-1.5 rounded font-medium" style={{ background: '#C72820' }}>
            Buat Transfer
          </Link>
        )}
      </div>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <ul className="space-y-2">
        {transfers.map((t) => (
          <li key={t.id}>
            <Link href={`/admin/stockist/transfers/${t.id}`} className="block p-3 rounded border border-white/10 text-sm flex justify-between">
              <span>{t.transfer_number}</span>
              <span className="uppercase text-xs opacity-70">{t.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write the new transfer page**

```tsx
// frontend/src/app/admin/stockist/transfers/new/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listProducts, createTransfer, type StockistProduct } from '@/lib/stockistApi';

const BRANCHES = ['bypass', 'sumber', 'samadikun', 'csb', 'tegal'];

export default function NewTransferPage() {
  const router = useRouter();
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState([{ product_id: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listProducts().then(({ products }) => setProducts(products)); }, []);

  function updateLine(i: number, patch: Partial<{ product_id: string; quantity: string }>) {
    setLines((prev) => prev.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { transfer } = await createTransfer({
        destination_branch: destination,
        items: lines.filter((l) => l.product_id && l.quantity).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
      });
      router.push(`/admin/stockist/transfers/${transfer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create transfer');
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Buat Transfer</h2>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-3 text-sm">
        <select value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full p-2 rounded bg-black/40 border border-white/10" required>
          <option value="">Pilih cabang tujuan</option>
          {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <select value={line.product_id} onChange={(e) => updateLine(i, { product_id: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10">
              <option value="">Pilih produk</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" min={1} placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="p-2 rounded bg-black/40 border border-white/10" />
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { product_id: '', quantity: '' }])} className="text-xs underline opacity-70">
          + tambah produk
        </button>

        <button type="submit" className="w-full p-2 rounded font-medium" style={{ background: '#C72820' }}>Kirim</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Add a transfer detail endpoint (backend)**

`GET /transfers` (Task 6) returns transfer headers only, never `stock_transfer_items` — the receive page needs individual item rows (with their `id`s) to confirm quantities against. Add a dedicated detail endpoint before writing the page.

In `server/routes/stockist.js`, add after the existing `GET /transfers` route:

```javascript
  router.get('/transfers/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: transfers, error: transferError } = await supabase.from('stock_transfers').select('*').eq('id', req.params.id);
    if (transferError) return res.status(500).json({ error: transferError.message });
    const transfer = (transfers || [])[0];
    if (!transfer) return res.status(404).json({ error: 'transfer not found' });

    if (access.role === 'branch_admin') {
      const ownBranchLocation = await findLocation('branch', access.branch);
      if (!ownBranchLocation || ownBranchLocation.id !== transfer.destination_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { data: items, error: itemsError } = await supabase.from('stock_transfer_items').select('*').eq('stock_transfer_id', transfer.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    return res.json({ transfer, items: items || [] });
  });
```

Add a matching test to `server/test/stockist-routes-transfers.test.js`:

```javascript
test('GET /transfers/:id returns transfer with items, scoped to destination branch_admin', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items[0].quantity_sent, 10);
  }, { role: 'branch_admin', branch: 'csb' });

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1`);
    assert.equal(res.status, 403);
  }, { role: 'branch_admin', branch: 'tegal' });
});
```

Run: `node --test server/test/stockist-routes-transfers.test.js` — expect PASS (now 6 tests).

- [ ] **Step 4: Add the Next.js proxy route, client function, and the transfer detail page**

```typescript
// frontend/src/app/api/stockist/transfers/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/stockist/transfers/${id}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Add the client function to `frontend/src/lib/stockistApi.ts`:

```typescript
export const getTransfer = (id: string) =>
  req<{ transfer: StockTransfer; items: StockTransferItem[] }>(`/api/stockist/transfers/${id}`);
```

Then write the page that consumes them:

```tsx
// frontend/src/app/admin/stockist/transfers/[id]/page.tsx
'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { getTransfer, receiveTransfer, type StockTransfer, type StockTransferItem } from '@/lib/stockistApi';

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});

  async function refresh() {
    const { transfer, items } = await getTransfer(id);
    setTransfer(transfer);
    setItems(items);
    setReceivedQty(Object.fromEntries(items.map((i) => [i.id, String(i.quantity_received ?? i.quantity_sent)])));
  }

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, [id]);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const payload = items.map((item) => ({ item_id: item.id, quantity_received: Number(receivedQty[item.id] ?? item.quantity_sent) }));
      const { has_discrepancy } = await receiveTransfer(id, payload);
      setSuccess(has_discrepancy ? 'Diterima — ada selisih jumlah, cek dashboard owner.' : 'Diterima sesuai jumlah kirim.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to confirm receipt');
    }
  }

  if (!transfer) return <p className="text-sm opacity-70">Memuat...</p>;

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">{transfer.transfer_number}</h2>
      <p className="text-xs uppercase opacity-70 mb-3">{transfer.status}</p>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {success && <p className="text-green-400 text-sm mb-3">{success}</p>}

      <form onSubmit={handleReceive} className="space-y-2 text-sm">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between items-center gap-2">
            <span>Dikirim: {item.quantity_sent}</span>
            <input
              type="number" min={0} disabled={transfer.status === 'RECEIVED'}
              value={receivedQty[item.id] ?? ''}
              onChange={(e) => setReceivedQty({ ...receivedQty, [item.id]: e.target.value })}
              className="w-24 p-2 rounded bg-black/40 border border-white/10"
            />
          </div>
        ))}
        {transfer.status === 'SENT' && (
          <button type="submit" className="w-full p-2 rounded font-medium" style={{ background: '#C72820' }}>
            Konfirmasi Diterima
          </button>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Add the AdminNav entry**

Read `frontend/src/components/AdminNav.tsx` first to match its existing item shape and role-gating convention exactly, then add a "Stockist" entry pointing to `/admin/stockist` visible to `owner` and `branch_admin`.

- [ ] **Step 6: Add the `/admin/stockist` redirect page**

```tsx
// frontend/src/app/admin/stockist/page.tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';

export default function StockistIndexPage() {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(user.role === 'owner' ? '/admin/stockist/warehouse' : '/admin/stockist/branch-stock');
  }, [user, loading, router]);

  return null;
}
```

- [ ] **Step 7: Manual verification**

As `owner`: create a transfer to `csb` from `/admin/stockist/transfers/new`, confirm it lands on the detail page in `SENT` status. As `branch_admin` for `csb`: open the same transfer, submit a received quantity lower than sent, confirm the success message reports a discrepancy and `/admin/stockist/branch-stock` reflects the received quantity. As `branch_admin` for a different branch: confirm visiting that transfer's URL directly returns a 403 (via the browser network tab or by checking the page shows the auth error).

- [ ] **Step 8: Run the full backend suite one more time**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/admin/stockist frontend/src/app/api/stockist/transfers/[id] frontend/src/lib/stockistApi.ts frontend/src/components/AdminNav.tsx server/routes/stockist.js server/test/stockist-routes-transfers.test.js
git commit -m "feat(stockist): add transfer detail/receive flow, transfer detail endpoint, and nav entry"
```

---

### Task 13: End-to-end verification against the spec's Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: PASS, including all `stockist-*.test.js` files added in Tasks 2-7 and 12.

- [ ] **Step 2: Walk through the spec's Definition of Done manually**

Using two browser sessions (or one + incognito) — one logged in as `owner`, one as a `csb` `branch_admin` — confirm each line from `docs/superpowers/specs/2026-08-15-stockist-inventory-foundation-design.md` §8:

1. Create a product with a unique SKU (`/admin/stockist/products`) — confirm it fails with a clear error on a duplicate SKU.
2. Receive stock at the warehouse (`/admin/stockist/warehouse`) — confirm the balance increases.
3. Create a transfer from warehouse to `csb` for less than the received quantity — confirm it succeeds; attempt one for *more* than available — confirm it's rejected with an "insufficient stock" message, not silently clamped.
4. As the `csb` branch_admin, confirm the received quantity on that transfer, entering a lower number than sent — confirm branch stock increases by the received amount (not the sent amount) and the UI reports a discrepancy.
5. As `owner`, use the adjustment endpoint (via `fetch` in the browser console, since Task 12 didn't build adjustment UI — reasonable since the spec doesn't require an adjustment page, only the capability) to correct a quantity and confirm a `reason` is required — try submitting without one and confirm it's rejected.
6. Confirm every action above produced a distinct `inventory_ledger` row: query it directly in Supabase (`select * from inventory_ledger order by created_at desc`) and check `performed_by` and `reason` are populated as expected.
7. Confirm stock never went negative at any point above.
8. As the `csb` branch_admin, confirm `/admin/stockist/products` never shows `purchase_price` in the rendered page *and* confirm it's absent from the raw `/api/stockist/products` JSON response (check via browser devtools network tab, not just the UI) — this is the check that catches a UI-only hide instead of a real API-level strip.
9. As the `csb` branch_admin, attempt to visit `/admin/stockist/branch-stock?branch=tegal` and confirm the data shown is still `csb`'s own (the page ignores the query param for non-owners) — and separately hit `GET /api/stockist/inventory/summary?location=tegal` directly and confirm it 403s.

- [ ] **Step 3: Note any gaps found for a follow-up task**

If any DoD item fails, that's a real bug to fix before calling this done — not a note for later. If everything passes, this plan is complete; the "Next Specs" section of the design doc (Moka sync, stock opname, returns, notifications) becomes the brainstorming input for the next spec.
