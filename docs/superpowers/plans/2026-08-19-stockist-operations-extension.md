# Stockist Operations Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Stockist foundation with product classification, service-use accountability, stronger stock opname controls, and an owner-only financial/inventory dashboard.

**Architecture:** Add the smallest database and service boundaries needed around the existing `stockist.js` routes and `apply_inventory_movement()` RPC. Keep all quantity changes append-only through the inventory movement contract; aggregate owner metrics server-side from balances and ledger rows, with role/location scoping applied before serialization.

**Tech Stack:** Node.js 24, Express, Supabase/Postgres SQL migrations, Next.js/React/TypeScript frontend, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-19-stockist-operations-extension-design.md`

## Global Constraints

- Use existing roles `owner`, `branch_admin`, and `barber`; do not add a Stockist role or login.
- Existing products default to `RETAIL`.
- All quantity changes call `apply_inventory_movement()` and create exactly one ledger row.
- `purchase_price` and owner financial metrics are owner-only.
- Preserve unrelated untracked files and do not reset, delete, commit, or push them.
- Follow TDD: write one focused failing test, run it and observe the expected failure, implement the minimum, run the focused test, then run the relevant regression suite.

---

### Task 1: Add product classification and movement-type database contract

**Files:**
- Create: `server/migrations/2026-08-19-stockist-operations-extension.sql`
- Modify: `server/services/stockistInventory.js`
- Modify: `server/routes/stockist.js`
- Test: `server/test/stockist-inventory-service.test.js`
- Test: `server/test/stockist-routes-products.test.js`

**Interfaces:**
- Produces `products.product_type` with values `RETAIL` and `SERVICE`, default `RETAIL`.
- Produces accepted ledger movement types `SALE_RETAIL`, `SERVICE_USE`, `STOCK_OPNAME_GAIN`, `STOCK_OPNAME_LOSS`, `DAMAGE`, and `LOST`.
- Produces `validateProductType(productType)` and `assertProductType(product, expectedType)` from `stockistInventory.js`.

- [ ] **Step 1: Write the failing service tests**

Add tests to `server/test/stockist-inventory-service.test.js`:

```js
test('validateProductType accepts only RETAIL and SERVICE', () => {
  assert.doesNotThrow(() => validateProductType('RETAIL'));
  assert.doesNotThrow(() => validateProductType('SERVICE'));
  assert.throws(() => validateProductType('WHOLESALE'), /product type/);
});

test('assertProductType rejects retail products in service flow', () => {
  assert.throws(
    () => assertProductType({ id: 'p1', product_type: 'RETAIL' }, 'SERVICE'),
    (error) => error.code === 'SERVICE_PRODUCT_REQUIRED'
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test server/test/stockist-inventory-service.test.js`

Expected: FAIL because the validators are not exported yet.

- [ ] **Step 3: Write the failing route test for product type persistence**

Extend `server/test/stockist-routes-products.test.js` so product creation with `{ product_type: 'SERVICE' }` asserts the inserted row contains `product_type: 'SERVICE'`, and product update with `{ product_type: 'WHOLESALE' }` returns `400` with `error_code: 'INVALID_PRODUCT_TYPE'`.

- [ ] **Step 4: Run the product route test and verify RED**

Run: `node --test server/test/stockist-routes-products.test.js`

Expected: FAIL because the route currently ignores or does not validate `product_type`.

- [ ] **Step 5: Add the migration and minimal validators**

In `server/migrations/2026-08-19-stockist-operations-extension.sql`:

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'RETAIL';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('RETAIL', 'SERVICE'));

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_ledger_movement_type;
ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_ledger_movement_type
  CHECK (movement_type IN (
    'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT',
    'SALE_MOKA', 'SALE_RETAIL', 'SERVICE_USE', 'STOCK_OPNAME_GAIN',
    'STOCK_OPNAME_LOSS', 'DAMAGE', 'LOST'
  ));
```

In `server/services/stockistInventory.js`, implement the two validators and preserve the existing `Error` shape for unrelated callers.

- [ ] **Step 6: Update product create/update allowlists**

In `server/routes/stockist.js`, validate `product_type` when supplied, default create requests to `RETAIL`, and include it in the existing owner-only product insert/update patch. Return `{ error_code: 'INVALID_PRODUCT_TYPE', error: 'product type must be RETAIL or SERVICE' }` for invalid values.

- [ ] **Step 7: Run focused tests and existing inventory regression tests**

Run: `node --test server/test/stockist-inventory-service.test.js server/test/stockist-routes-products.test.js server/test/stockist-routes-transfers.test.js server/test/stockist-routes-warehouse.test.js`

Expected: PASS with no unrelated failures.

- [ ] **Step 8: Review the migration diff**

Run: `git diff --check -- server/migrations/2026-08-19-stockist-operations-extension.sql server/services/stockistInventory.js server/routes/stockist.js`

Expected: exit code 0.

### Task 2: Implement service-use lifecycle and replenishment gate

**Files:**
- Modify: `server/migrations/2026-08-19-stockist-operations-extension.sql`
- Create: `server/services/stockistServiceUsage.js`
- Modify: `server/routes/stockist.js`
- Create: `server/test/stockist-service-usage.test.js`
- Create: `server/test/stockist-routes-service-usage.test.js`

**Interfaces:**
- `createServiceUsage(supabase, input)` creates an `OPEN` service usage only for `SERVICE` products.
- `transitionServiceUsage(current, nextStatus)` returns the next state or throws a coded transition error.
- Routes expose `POST /service-usage`, `PATCH /service-usage/:id/assign`, `PATCH /service-usage/:id/start`, `PATCH /service-usage/:id/consume`, and `POST /service-usage/:id/replenishment-request`.

- [ ] **Step 1: Write failing lifecycle tests**

Create `server/test/stockist-service-usage.test.js`:

```js
test('service usage permits only OPEN to IN_USE to CONSUMED to REPLENISHMENT_REQUESTED', () => {
  assert.equal(transitionServiceUsage({ status: 'OPEN' }, 'IN_USE').status, 'IN_USE');
  assert.equal(transitionServiceUsage({ status: 'IN_USE' }, 'CONSUMED').status, 'CONSUMED');
  assert.equal(transitionServiceUsage({ status: 'CONSUMED' }, 'REPLENISHMENT_REQUESTED').status, 'REPLENISHMENT_REQUESTED');
  assert.throws(() => transitionServiceUsage({ status: 'OPEN' }, 'CONSUMED'), /invalid service usage transition/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-service-usage.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Write failing route tests**

Create `server/test/stockist-routes-service-usage.test.js` with a fake Supabase state covering:

```text
POST /service-usage for RETAIL -> 400 SERVICE_PRODUCT_REQUIRED
POST /service-usage for SERVICE -> 201 OPEN
PATCH /:id/assign -> IN_USE with PIC
PATCH /:id/consume -> one SERVICE_USE RPC call and CONSUMED
second consume -> 409 and no second RPC call
replenishment before CONSUMED -> 409
replenishment after CONSUMED -> REPLENISHMENT_REQUESTED
branch_admin using another location -> 403
```

- [ ] **Step 4: Run the route tests and verify RED**

Run: `node --test server/test/stockist-routes-service-usage.test.js`

Expected: FAIL because the routes and table contract are not present.

- [ ] **Step 5: Add the service usage schema**

Append to the migration:

```sql
CREATE TABLE IF NOT EXISTS service_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  location_id uuid NOT NULL REFERENCES inventory_locations(id),
  pic_user_id uuid,
  status text NOT NULL DEFAULT 'OPEN',
  opened_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  consumed_at timestamptz,
  replenishment_requested_at timestamptz,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_usage_status_check CHECK (status IN ('OPEN', 'IN_USE', 'CONSUMED', 'REPLENISHMENT_REQUESTED'))
);

CREATE INDEX IF NOT EXISTS idx_service_usage_location_status
  ON service_usage (location_id, status);
```

- [ ] **Step 6: Implement the state machine service**

In `server/services/stockistServiceUsage.js`, implement explicit allowed transitions, required PIC on `IN_USE`, and coded errors `SERVICE_PRODUCT_REQUIRED`, `INVALID_SERVICE_USAGE_TRANSITION`, `PIC_REQUIRED`, and `SERVICE_USAGE_ALREADY_CONSUMED`.

- [ ] **Step 7: Implement routes with server-side scope and movement**

In `server/routes/stockist.js`, reuse `getVerifiedStockistAccess` and `resolveStockistLocationScope`. Load the product before creation and assert `SERVICE`. On consume, update the row only after checking status and call:

```js
await applyInventoryMovement(supabase, {
  productId: usage.product_id,
  locationId: usage.location_id,
  quantityDelta: -1,
  movementType: 'SERVICE_USE',
  performedBy: access.staffId,
  referenceType: 'service_usage',
  referenceId: usage.id,
  reason: usage.note || 'service product consumed',
});
```

Use the existing database/RPC transaction boundary or an idempotency guard so a repeated consume cannot create a second movement.

- [ ] **Step 8: Run service-use tests and relevant route regressions**

Run: `node --test server/test/stockist-service-usage.test.js server/test/stockist-routes-service-usage.test.js server/test/stockist-routes-requests.test.js server/test/stockist-routes-transfers.test.js`

Expected: PASS.

### Task 3: Harden stock opname accountability and movement semantics

**Files:**
- Modify: `server/migrations/2026-08-19-stockist-operations-extension.sql`
- Modify: `server/services/stockistOpname.js`
- Modify: `server/routes/stockist.js`
- Modify: `server/test/stockist-opname-service.test.js`
- Modify: `server/test/stockist-routes-opname.test.js`

**Interfaces:**
- `getOpnameMovementType(difference)` returns `STOCK_OPNAME_GAIN`, `STOCK_OPNAME_LOSS`, or `null` for zero.
- Existing submit/approve routes preserve response shape while returning stable `error_code` values.

- [ ] **Step 1: Write failing movement-type tests**

Add to `server/test/stockist-opname-service.test.js`:

```js
test('opname difference maps to explicit gain/loss movement types', () => {
  assert.equal(getOpnameMovementType(3), 'STOCK_OPNAME_GAIN');
  assert.equal(getOpnameMovementType(-2), 'STOCK_OPNAME_LOSS');
  assert.equal(getOpnameMovementType(0), null);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test server/test/stockist-opname-service.test.js`

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Write failing approval/idempotency tests**

Extend `server/test/stockist-routes-opname.test.js` to assert:

```text
negative difference calls STOCK_OPNAME_LOSS
positive difference calls STOCK_OPNAME_GAIN
approved opname approve request does not call RPC again
nonzero difference without evidence returns 400 OPNAME_EVIDENCE_REQUIRED when policy is active
only owner can approve
```

- [ ] **Step 4: Run the route tests and verify RED**

Run: `node --test server/test/stockist-routes-opname.test.js`

Expected: FAIL on movement type and duplicate approval assertions.

- [ ] **Step 5: Add opname accountability columns and evidence policy**

Append migration statements using `ADD COLUMN IF NOT EXISTS` for `scheduled_for`, `evidence_url`, `approved_by`, and `approved_at` on `stock_opnames`, and `evidence_url` on `stock_opname_items` if those columns are absent. Add an index for active opname location status if not already present.

- [ ] **Step 6: Implement movement helper and validation**

Add `getOpnameMovementType` to `server/services/stockistOpname.js`. Extend `validateOpnameSubmission(items, options)` so each nonzero item requires a nonblank reason and, when evidence policy is enabled, a nonblank evidence URL.

- [ ] **Step 7: Make approval idempotent and use explicit movement types**

In `server/routes/stockist.js`, return the existing approved record without calling movement when status is `APPROVED`. For each nonzero item, pass `getOpnameMovementType(item.difference)` to `applyInventoryMovement`. Preserve the current compensation behavior for partial failures, or replace it with the existing RPC transaction boundary if the migration exposes one.

- [ ] **Step 8: Run all opname and inventory tests**

Run: `node --test server/test/stockist-opname-service.test.js server/test/stockist-routes-opname.test.js server/test/stockist-routes-adjustment.test.js server/test/stockist-routes-warehouse.test.js`

Expected: PASS.

### Task 4: Add owner dashboard metrics and drill-down contract

**Files:**
- Modify: `server/services/stockistDashboard.js`
- Modify: `server/routes/stockist.js`
- Modify: `server/test/stockist-dashboard-service.test.js`
- Modify: `server/test/stockist-routes-dashboard.test.js`

**Interfaces:**
- `buildOwnerDashboard({ products, balances, ledger, locations, from, to, locationId, productType })` returns `cash_outflow`, `inventory_value`, `low_stock`, `fast_moving`, `branch_consumption`, and `ledger_summary`.
- `GET /api/stockist/dashboard/owner` returns the owner dashboard and accepts `from`, `to`, `location_id`, and `product_type`.

- [ ] **Step 1: Write failing dashboard service tests**

Add a fixture with two products, two locations, purchase prices, balances, and ledger rows. Assert:

```js
const result = buildOwnerDashboard(fixture);
assert.equal(result.cash_outflow, 500000);
assert.equal(result.inventory_value, 350000);
assert.equal(result.fast_moving[0].product_id, 'p-service');
assert.equal(result.branch_consumption[0].location_id, 'loc-branch');
assert.equal(result.ledger_summary.SERVICE_USE.quantity_delta, -2);
```

Use ledger rows whose expected values are explicit in the fixture so the test verifies movement filtering rather than array length.

- [ ] **Step 2: Run the dashboard service test and verify RED**

Run: `node --test server/test/stockist-dashboard-service.test.js`

Expected: FAIL because `buildOwnerDashboard` is not present.

- [ ] **Step 3: Write failing dashboard route tests**

Extend `server/test/stockist-routes-dashboard.test.js` to assert owner receives the six dashboard sections and purchase-price-derived values, while `branch_admin` receives `403`. Add a regression assertion that no non-owner response contains `purchase_price`.

- [ ] **Step 4: Run the route test and verify RED**

Run: `node --test server/test/stockist-routes-dashboard.test.js`

Expected: FAIL because the new endpoint/sections are not present.

- [ ] **Step 5: Implement pure dashboard aggregation**

In `server/services/stockistDashboard.js`, implement `buildOwnerDashboard` with these exact rules:

```text
cash_outflow: WAREHOUSE_RECEIVE positive quantity * purchase_price
inventory_value: balance quantity * purchase_price for active products
low_stock: balance quantity <= minimum_stock/reorder point grouped by location
fast_moving: most negative SALE_RETAIL + SERVICE_USE quantity_delta
branch_consumption: SALE_RETAIL + SERVICE_USE + DAMAGE + LOST cost by branch
ledger_summary: count and quantity_delta grouped by movement_type
```

Apply date, location, and product-type filters before calculating totals. Exclude warehouse from branch ranking.

- [ ] **Step 6: Implement owner route and preserve existing overview**

Add `GET /dashboard/owner` after the existing owner guard. Load products, balances, locations, and filtered ledger rows server-side; pass them to `buildOwnerDashboard`; serialize purchase price only for owner. Leave `/dashboard/overview` response compatible for the existing frontend until the new page is wired.

- [ ] **Step 7: Run dashboard tests and route regressions**

Run: `node --test server/test/stockist-dashboard-service.test.js server/test/stockist-routes-dashboard.test.js server/test/stockist-routes-products.test.js server/test/stockist-routes-opname.test.js`

Expected: PASS.

### Task 5: Wire the Stockist frontend workflows

**Files:**
- Modify: `frontend/src/app/admin/stockist/page.tsx`
- Modify: `frontend/src/app/admin/stockist/products/page.tsx`
- Create: `frontend/src/app/admin/stockist/service-usage/page.tsx`
- Modify: `frontend/src/app/admin/stockist/stock-opname/page.tsx`
- Modify: `frontend/src/app/admin/stockist/stock-opname/[id]/page.tsx`
- Test: `server/test/stockist-frontend-contract.test.js` or the existing frontend test location discovered during implementation

**Interfaces:**
- Dashboard calls `/api/stockist/dashboard/owner` only when the authenticated role is `owner`.
- Product form sends `product_type` and labels the two workflows in Indonesian.
- Service usage UI exposes only valid next actions and never treats a successful button render as stock mutation.
- Opname UI requires reason/evidence before submit and shows owner approval status.

- [ ] **Step 1: Write failing contract tests for request payloads**

Add a contract test that reads the page source or extracted request helpers and asserts the new endpoint strings and payload fields exist: `product_type`, `/service-usage`, `SERVICE_USE`, `/dashboard/owner`, `evidence_url`, and `reason`.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test server/test/stockist-frontend-contract.test.js`

Expected: FAIL because the new UI contract is not wired.

- [ ] **Step 3: Add dashboard sections and filters**

Update the existing page with Indonesian labels for uang keluar, nilai stok, stok menipis, produk cepat bergerak, cabang paling boros, and ringkasan ledger. Include loading, error, empty, permission-denied, and stale-data states. Keep purchase price hidden unless the server response is owner-authorized.

- [ ] **Step 4: Add product type controls**

Add a required product-type selector to the owner product form, show a `Retail`/`Layanan` badge in product rows, and hide service-use actions for retail products.

- [ ] **Step 5: Add service-use page**

Implement the lifecycle actions with explicit Indonesian statuses: `Buka barang`, `Assign PIC`, `Sedang dipakai`, `Tandai habis`, and `Request tambah`. Disable invalid actions based on server state and display coded server errors in user-readable form.

- [ ] **Step 6: Update opname pages**

Add schedule/date display, evidence upload field, required reason for differences, review-owner status, and explicit gain/loss movement labels. Preserve existing mobile-first Stockist visual language and all existing loading/error states.

- [ ] **Step 7: Run frontend verification**

Run the frontend package scripts discovered from `frontend/package.json` for lint, typecheck, and build. Expected: exit code 0 for each available command; if a command is unavailable, record the exact package script error and continue with the available checks.

### Task 6: Full verification and handoff audit

**Files:**
- Modify only files required by earlier tasks.
- Test: all Stockist tests under `server/test/stockist-*.test.js`.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test`

Expected: exit code 0 and zero failed tests.

- [ ] **Step 2: Run migration and contract checks**

Run: `rg -n "product_type|SERVICE_USE|STOCK_OPNAME_GAIN|STOCK_OPNAME_LOSS|dashboard/owner|service-usage" server frontend server/migrations/2026-08-19-stockist-operations-extension.sql`

Expected: all required contracts appear in the intended files; no unrelated module is changed.

- [ ] **Step 3: Inspect the final diff and worktree**

Run: `git diff --stat` and `git status --short`.

Expected: only intended Stockist source, migration, tests, and documentation files are changed; existing untracked assets remain untouched.

- [ ] **Step 4: Perform manual acceptance checks**

Verify locally:

```text
owner sees dashboard metrics and drill-down data
branch_admin cannot see purchase price or another branch
retail product cannot be opened in service-use
service product consumes exactly one unit at CONSUMED
replenishment is unavailable before CONSUMED
stock opname requires reason/evidence and owner approval
repeated approval does not duplicate ledger
```

- [ ] **Step 5: Report evidence and remaining deployment work**

Report exact test/build commands and exit results. Clearly separate local verification from migration application, staging verification, production deployment, and live visual QA. Do not claim production readiness until the migration is applied and the deployed Stockist domain is checked.
