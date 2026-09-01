# Backoffice Workstream D — Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Reports Overview, Branch Performance, and Barber Performance
with real data — one shared-fetch refactor, one small additive extension to
`customer-segments`, and one new barber-grouped aggregation endpoint
(approved, both per spec §13 sign-off).

**Architecture:** Extract the visit-row fetch/normalize logic already inline
in `/customer-segments` into a shared `fetchVisitRows(supabase)` helper in
`server/crm/customerSegmentsService.js`, so `/barber-performance` reuses it
instead of duplicating the query. Add `total_customers`/`repeat_customers`
fields to each `by_branch` entry (additive, no existing field changes). New
pure function `computeBarberPerformance` mirrors `computeCustomerSegments`'s
structure, grouped by barber instead of customer. Reports Overview needs no
backend at all — it's a static navigation directory.

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 13/14/17, §8 workstream D, §13 backend change policy)

## Data audit findings (this session)

- `/api/admin/crm/leaderboard` (existing) only gives a **current-month**
  Moka-customer-count per branch, no repeat rate, no lifetime totals, no
  cross-branch view — insufficient for Barber Performance's design, which
  needs lifetime customers-served/repeat-rate/completed-services.
- The design's Barber Performance mockup shows an **"Estimasi Komisi Bulan
  Ini"** card (Rp 5.640.000) — this is a fabricated commission estimate and
  violates the standing rule "never assume a barber commission percentage."
  **Omitted, not built.**
- The design's per-barber "Attendance: 21/22" stat and Branch Performance's
  "Attendance Issue" column both depend on `barber_attendance`, already
  classified DEMO/PARTIAL in spec §5 (only 2 rows exist in production).
  **Omitted from both pages.**
- Branch Performance's "Alert" traffic-light column (Baik/Ramai/Perlu
  Perhatian) has no consistent formula even in the mockup's own example
  numbers (Ramai vs Baik doesn't track completion rate; Perlu Perhatian
  seems to track attendance issues, which aren't reliably available). This
  is exactly the "operational alert / branch health status" signal the
  standing rule forbids inventing without a real, disclosed, deterministic
  rule. **Omitted.**

## Global Constraints

- No commission figures anywhere in Barber Performance.
- No attendance-derived stats anywhere in this workstream (both pages) —
  `barber_attendance` stays DEMO/PARTIAL per spec §5, not silently upgraded.
- No fabricated branch health/alert status.
- Both new/extended endpoints stay read-only, `adminAuth`-protected,
  additive — no existing field's meaning changes, no schema migration, no
  new serverless function (still 12).
- Identity/grouping reuses the same canonical-phone approach already shipped
  in Workstream C — no second identity algorithm.
- `npm --workspace=backoffice run build` / `test` succeed after every
  frontend task; `node --test --test-force-exit server/test/<new files>`
  passes after every backend task.

---

### Task 1: Extract `fetchVisitRows`, extend `by_branch`

**Files:**
- Modify: `server/crm/customerSegmentsService.js`
- Modify: `server/routes/adminCrm.js`
- Modify: `server/test/customer-segments-service.test.js`
- Modify: `server/test/admin-crm-customer-segments-route.test.js`

**Interfaces:**
- Produces: `fetchVisitRows(supabase)` (async, returns `VisitRow[]`) — Task 3
  (the new barber-performance route) calls this directly. `by_branch` entries
  gain `total_customers`/`repeat_customers` fields — Task 6 (Branch
  Performance page) consumes these.

- [ ] **Step 1: Write the failing test for the extended `by_branch` shape**

Add to `server/test/customer-segments-service.test.js`:

```js
test('by_branch reports total and repeat customer counts per branch, not just the raw favorite-branch count', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-02-01', { branch: 'csb' }),
    visit('6282', 'Sari', '2026-01-01', { branch: 'csb' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const csb = result.by_branch.find(b => b.branch === 'csb');
  assert.equal(csb.count, 2);
  assert.equal(csb.total_customers, 2);
  assert.equal(csb.repeat_customers, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/customer-segments-service.test.js`
Expected: FAIL — `total_customers`/`repeat_customers` undefined.

- [ ] **Step 3: Implement the `by_branch` extension**

In `server/crm/customerSegmentsService.js`, replace the `by_branch`
construction (the `branchModeCounts` map is still the primary "favorite
branch" tally driving `count`; add two parallel maps for the new fields):

```js
  const branchModeCounts = new Map();
  const branchTotalCustomers = new Map();
  const branchRepeatCustomers = new Map();
```

Inside the per-group loop, right after the existing
`if (favoriteBranch) branchModeCounts.set(...)` line, add:

```js
    if (favoriteBranch) {
      branchTotalCustomers.set(favoriteBranch, (branchTotalCustomers.get(favoriteBranch) || 0) + 1);
      if (totalVisits >= 2) {
        branchRepeatCustomers.set(favoriteBranch, (branchRepeatCustomers.get(favoriteBranch) || 0) + 1);
      }
    }
```

(`totalVisits` is already computed earlier in the same loop iteration.)

Then update the `by_branch` construction near the bottom of the function:

```js
  const by_branch = [...branchModeCounts.entries()]
    .map(([branch, count]) => ({
      branch,
      count,
      total_customers: branchTotalCustomers.get(branch) || 0,
      repeat_customers: branchRepeatCustomers.get(branch) || 0,
    }))
    .sort((a, b) => b.count - a.count);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/customer-segments-service.test.js`
Expected: 21 tests pass (20 existing + this one).

- [ ] **Step 5: Extract `fetchVisitRows` in the same file**

Append to `server/crm/customerSegmentsService.js` (after
`computeCustomerSegments`, before `module.exports`):

```js
async function fetchVisitRows(supabase) {
  const [bookingsRes, transactionsRes, barbersRes, outletsRes] = await Promise.all([
    supabase.from('bookings').select('wa, name, customer_id, barber_id, service, location, date').eq('status', 'done'),
    supabase.from('transactions').select('id, customer_id, outlet_id, schedule_id, created_at').eq('status', 'completed').not('customer_id', 'is', null),
    supabase.from('barbers').select('id, name'),
    supabase.from('outlets').select('id, slug, name'),
  ]);

  const bookings = bookingsRes.data || [];
  const transactions = transactionsRes.data || [];
  const barbers = barbersRes.data || [];
  const outlets = outletsRes.data || [];
  const barberNameById = new Map(barbers.map(b => [b.id, b.name]));
  const outletSlugById = new Map(outlets.map(o => [o.id, o.slug]));

  const customerIds = [...new Set(transactions.map(t => t.customer_id).filter(Boolean))];
  const scheduleIds = [...new Set(transactions.map(t => t.schedule_id).filter(Boolean))];
  const transactionIds = transactions.map(t => t.id);

  const [customersRes, schedulesRes, itemsRes] = await Promise.all([
    customerIds.length ? supabase.from('customers').select('id, wa, phone_e164, name').in('id', customerIds) : Promise.resolve({ data: [] }),
    scheduleIds.length ? supabase.from('schedules').select('id, barber_id').in('id', scheduleIds) : Promise.resolve({ data: [] }),
    transactionIds.length ? supabase.from('transaction_items').select('transaction_id, service_name').in('transaction_id', transactionIds) : Promise.resolve({ data: [] }),
  ]);

  const customerById = new Map((customersRes.data || []).map(c => [c.id, c]));
  const barberIdByScheduleId = new Map((schedulesRes.data || []).map(s => [s.id, s.barber_id]));
  const serviceByTransactionId = new Map((itemsRes.data || []).map(i => [i.transaction_id, i.service_name]));

  const visitRows = [];
  for (const b of bookings) {
    visitRows.push({
      phone: b.wa || null,
      name: b.name || null,
      date: b.date,
      branch: b.location || null,
      barberId: b.barber_id || null,
      barberName: b.barber_id ? barberNameById.get(b.barber_id) || null : null,
      service: b.service || null,
      source: 'booking',
    });
  }
  for (const t of transactions) {
    const customer = customerById.get(t.customer_id);
    const barberId = t.schedule_id ? barberIdByScheduleId.get(t.schedule_id) : null;
    visitRows.push({
      phone: customer?.wa || customer?.phone_e164 || null,
      name: customer?.name || null,
      date: String(t.created_at || '').slice(0, 10),
      branch: t.outlet_id ? outletSlugById.get(t.outlet_id) || null : null,
      barberId: barberId || null,
      barberName: barberId ? barberNameById.get(barberId) || null : null,
      service: serviceByTransactionId.get(t.id) || null,
      source: 'transaction',
    });
  }
  return visitRows;
}
```

Update `module.exports` to `module.exports = { computeCustomerSegments, fetchVisitRows };`.

- [ ] **Step 6: Replace the inline fetch in the route with the shared helper**

In `server/routes/adminCrm.js`, replace the entire body of the
`/customer-segments` handler from `const [bookingsRes, ...` down through
`const result = computeCustomerSegments(visitRows, ...)` with:

```js
    const visitRows = await fetchVisitRows(supabase);
    const result = computeCustomerSegments(visitRows, { branch, limit, offset, search });
```

Update the import line to `const { computeCustomerSegments, fetchVisitRows } = require('../crm/customerSegmentsService');`.

- [ ] **Step 7: Run the full route test suite to confirm no regression**

Run: `node --test --test-force-exit server/test/admin-crm-customer-segments-route.test.js`
Expected: all 6 tests still pass — this proves the refactor didn't change
the route's externally observable behavior.

- [ ] **Step 8: Commit**

```bash
git add server/crm/customerSegmentsService.js server/routes/adminCrm.js server/test/customer-segments-service.test.js
git commit -m "refactor(crm): extract fetchVisitRows, extend by_branch with total/repeat customer counts"
```

---

### Task 2: `server/crm/barberPerformanceService.js` — pure aggregation function

**Files:**
- Create: `server/crm/barberPerformanceService.js`
- Create: `server/test/barber-performance-service.test.js`

**Interfaces:**
- Consumes: nothing external (pure function over `VisitRow[]`, same shape
  Task 1 already defines).
- Produces: `computeBarberPerformance(visitRows, options)` — Task 3 calls
  this directly.

- [ ] **Step 1: Write the failing tests**

Create `server/test/barber-performance-service.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeBarberPerformance } = require('../crm/barberPerformanceService');

function visit(phone, name, date, overrides = {}) {
  return {
    phone, name, date,
    branch: 'csb', barberId: 'b1', barberName: 'Ubay', service: 'Haircut', source: 'booking',
    ...overrides,
  };
}

test('counts distinct customers served per barber, not total visits', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-02-01'),
    visit('6282', 'Sari', '2026-01-01'),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 2);
  assert.equal(ubay.completed_services, 3);
});

test('a barber with no repeat customers has a 0% repeat rate', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01'), visit('6282', 'Sari', '2026-01-02')];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.repeat_rate, 0);
});

test('a barber where every customer returned has a 100% repeat rate', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-02-01'),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.repeat_rate, 100);
});

test('rows with no barberId are excluded from any barber\'s totals', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01', { barberId: null, barberName: null })];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  assert.deepEqual(result.barbers, []);
});

test('branch is the barber\'s most-visited branch', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6282', 'Sari', '2026-02-01', { branch: 'csb' }),
    visit('6283', 'Rian', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.branch, 'csb');
});

test('leaderboard is sorted by customers_served descending', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6282', 'Sari', '2026-01-02', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6283', 'Rian', '2026-01-03', { barberId: 'b2', barberName: 'Dodi' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  assert.equal(result.barbers[0].barber_id, 'b1');
  assert.equal(result.barbers[1].barber_id, 'b2');
});

test('branch filter scopes barber performance to only that branch\'s visits', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb', barberId: 'b1', barberName: 'Ubay' }),
    visit('6282', 'Sari', '2026-02-01', { branch: 'bypass', barberId: 'b1', barberName: 'Ubay' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15', branch: 'csb' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 1);
});

test('an empty dataset returns an empty barbers list, not an error', () => {
  const result = computeBarberPerformance([], { today: '2026-08-15' });
  assert.deepEqual(result.barbers, []);
});

test('no commission or attendance field is ever present on a barber entry', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01')];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const allowedKeys = ['barber_id', 'name', 'branch', 'customers_served', 'completed_services', 'repeat_rate'];
  for (const key of Object.keys(result.barbers[0])) {
    assert.ok(allowedKeys.includes(key), `unexpected field on barber entry: ${key}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/barber-performance-service.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `barberPerformanceService.js`**

Create `server/crm/barberPerformanceService.js`:

```js
'use strict';

const { calculateMode } = require('./customer360Service');

function computeBarberPerformance(visitRows = [], options = {}) {
  const branchFilter = options.branch && options.branch !== 'all' ? options.branch : null;
  const scopedRows = branchFilter ? visitRows.filter(r => r.branch === branchFilter) : visitRows;

  const byBarber = new Map();
  for (const row of scopedRows) {
    if (!row.barberId) continue;
    if (!byBarber.has(row.barberId)) {
      byBarber.set(row.barberId, { barberId: row.barberId, name: row.barberName || 'Tidak diketahui', visits: [] });
    }
    byBarber.get(row.barberId).visits.push(row);
  }

  const customersByBarber = new Map();
  for (const [barberId, entry] of byBarber.entries()) {
    const customerVisitCounts = new Map();
    for (const v of entry.visits) {
      const key = v.phone ? `phone:${v.phone}` : `name:${(v.name || 'unknown').toLowerCase()}`;
      customerVisitCounts.set(key, (customerVisitCounts.get(key) || 0) + 1);
    }
    customersByBarber.set(barberId, customerVisitCounts);
  }

  const barbers = [...byBarber.entries()].map(([barberId, entry]) => {
    const customerVisitCounts = customersByBarber.get(barberId);
    const customersServed = customerVisitCounts.size;
    const repeatCustomers = [...customerVisitCounts.values()].filter(c => c >= 2).length;
    const repeatRate = customersServed > 0 ? Math.round((repeatCustomers / customersServed) * 100) : 0;
    const branch = calculateMode(
      entry.visits.map(v => v.branch).filter(Boolean),
      entry.visits.map(v => v.branch).filter(Boolean).reverse()
    );

    return {
      barber_id: barberId,
      name: entry.name,
      branch,
      customers_served: customersServed,
      completed_services: entry.visits.length,
      repeat_rate: repeatRate,
    };
  }).sort((a, b) => b.customers_served - a.customers_served);

  return { barbers };
}

module.exports = { computeBarberPerformance };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/barber-performance-service.test.js`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/crm/barberPerformanceService.js server/test/barber-performance-service.test.js
git commit -m "feat(crm): add pure barber-performance aggregation function, no commission/attendance fields"
```

---

### Task 3: `GET /api/admin/crm/barber-performance` route

**Files:**
- Modify: `server/routes/adminCrm.js`
- Create: `server/test/admin-crm-barber-performance-route.test.js`

**Interfaces:**
- Consumes: `fetchVisitRows` (Task 1), `computeBarberPerformance` (Task 2).
- Produces: `GET /api/admin/crm/barber-performance?branch=` — Task 4 calls
  this exact path/params.

- [ ] **Step 1: Write the failing tests**

Create `server/test/admin-crm-barber-performance-route.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

function buildApp(supabase) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = { staffId: 'test', role: null, branch: null, sessionVerified: false };
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function fakeSupabase({ bookings = [], transactions = [], transactionItems = [], schedules = [], customers = [], outlets = [], barbers = [] } = {}) {
  const tables = { bookings, transactions, transaction_items: transactionItems, schedules, customers, outlets, barbers };
  return {
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _rows: rows,
        select() { return chain; },
        eq(field, value) { chain._rows = chain._rows.filter(r => r[field] === value); return chain; },
        in(field, values) { chain._rows = chain._rows.filter(r => values.includes(r[field])); return chain; },
        not(field) { chain._rows = chain._rows.filter(r => r[field] !== null && r[field] !== undefined); return chain; },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /barber-performance with an empty dataset returns an empty list, not an error', async () => {
  const app = buildApp(fakeSupabase());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.barbers, []);
  server.close();
});

test('GET /barber-performance returns real per-barber customers served and completed services', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6282', name: 'Sari', status: 'done', date: '2026-01-02', location: 'csb', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance`);
  const body = await res.json();
  const ubay = body.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 2);
  assert.equal(ubay.completed_services, 2);
  server.close();
});

test('GET /barber-performance?branch=csb scopes results to that branch', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6282', name: 'Sari', status: 'done', date: '2026-02-01', location: 'bypass', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/barber-performance?branch=csb`);
  const body = await res.json();
  const ubay = body.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 1);
  server.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/admin-crm-barber-performance-route.test.js`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

In `server/routes/adminCrm.js`, add directly after the `/customer-segments`
route:

```js
  router.get('/barber-performance', adminAuth, async (req, res) => {
    const branch = req.query.branch || 'all';
    const visitRows = await fetchVisitRows(supabase);
    const result = computeBarberPerformance(visitRows, { branch });
    return res.json(result);
  });
```

Update the import line to include `computeBarberPerformance`:

```js
const { computeBarberPerformance } = require('../crm/barberPerformanceService');
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/admin-crm-barber-performance-route.test.js`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminCrm.js server/test/admin-crm-barber-performance-route.test.js
git commit -m "feat(crm): expose GET /api/admin/crm/barber-performance"
```

---

### Task 4: `backoffice/src/services/crm.ts` — add `getBarberPerformance`, extend `by_branch` type

**Files:**
- Modify: `backoffice/src/services/crm.ts`
- Modify: `backoffice/src/services/__tests__/crm.test.ts`

**Interfaces:**
- Produces: `getBarberPerformance(params)`, type `BarberPerformanceResult` —
  Task 7 (Barber Performance page) imports these. `CustomerSegmentBranchCount`
  gains `total_customers`/`repeat_customers` fields — Task 6 (Branch
  Performance page) imports the updated type.

- [ ] **Step 1: Write the failing test**

Add to `backoffice/src/services/__tests__/crm.test.ts`:

```ts
  it('getBarberPerformance defaults to branch=all', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ barbers: [] }), { status: 200 })
    );
    await getBarberPerformance({});
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/barber-performance?branch=all');
  });

  it('getBarberPerformance passes through an explicit branch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ barbers: [] }), { status: 200 })
    );
    await getBarberPerformance({ branch: 'csb' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/barber-performance?branch=csb');
  });
```

Add `getBarberPerformance` to the import list at the top of the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: FAIL — not exported yet.

- [ ] **Step 3: Implement it**

In `backoffice/src/services/crm.ts`, update the `CustomerSegmentBranchCount`
interface:

```ts
export interface CustomerSegmentBranchCount {
  branch: string;
  count: number;
  total_customers: number;
  repeat_customers: number;
}
```

Append at the end of the file:

```ts
export interface BarberPerformanceEntry {
  barber_id: string;
  name: string;
  branch: string | null;
  customers_served: number;
  completed_services: number;
  repeat_rate: number;
}

export interface BarberPerformanceResult {
  barbers: BarberPerformanceEntry[];
}

export function getBarberPerformance(params: { branch?: string }): Promise<BarberPerformanceResult> {
  const query = new URLSearchParams({ branch: params.branch ?? 'all' });
  return apiClient.get<BarberPerformanceResult>(`/api/admin/crm/barber-performance?${query.toString()}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: 11 tests pass (9 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/crm.ts backoffice/src/services/__tests__/crm.test.ts
git commit -m "feat(backoffice): add getBarberPerformance to crm service, extend by_branch type"
```

---

### Task 5: Reports Overview page

**Files:**
- Create: `backoffice/src/pages/ReportsOverview.tsx`
- Create: `backoffice/src/pages/__tests__/ReportsOverview.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/reports`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: nothing (pure navigation directory, no data fetching).
- Produces: the `ReportsOverview` page, routed at `/reports`.

- [ ] **Step 1: Update the route-table test** (17 → 16 remaining
      placeholders), same pattern as prior workstreams.

- [ ] **Step 2: Run to verify it fails, remove `/reports` from `routes.ts`, re-run to verify it passes.**

- [ ] **Step 3: Write the failing page test**

Create `backoffice/src/pages/__tests__/ReportsOverview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsOverview } from '../ReportsOverview';

describe('ReportsOverview', () => {
  it('renders links to Branch Performance, Barber Performance, Customer Report, and Membership Report', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: /Branch Performance/i }).getAttribute('href')).toBe('/reports/branches');
    expect(screen.getByRole('link', { name: /Barber Performance/i }).getAttribute('href')).toBe('/reports/barbers');
    expect(screen.getByRole('link', { name: /Customer Report/i }).getAttribute('href')).toBe('/reports/customers');
    expect(screen.getByRole('link', { name: /Membership Report/i }).getAttribute('href')).toBe('/reports/membership');
  });
});
```

- [ ] **Step 4: Run to verify it fails**, then implement.

Create `backoffice/src/pages/ReportsOverview.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';

const REPORTS = [
  { title: 'Branch Performance', desc: 'Perbandingan booking, omset, dan customer antar cabang.', href: '/reports/branches', tint: 'bg-rb-red-tint-bg text-rb-red-tint-fg' },
  { title: 'Barber Performance', desc: 'Customer dilayani, repeat rate, dan layanan selesai per barber.', href: '/reports/barbers', tint: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg' },
  { title: 'Customer Report', desc: 'Retensi, segmentasi, dan peluang reaktivasi pelanggan.', href: '/reports/customers', tint: 'bg-rb-blue-tint-bg text-rb-blue-tint-fg' },
  { title: 'Membership Report', desc: 'Pertumbuhan member, poin, dan distribusi tier.', href: '/reports/membership', tint: 'bg-rb-teal-tint-bg text-rb-teal-tint-fg' },
];

export function ReportsOverview() {
  return (
    <>
      <PageHeader title="Reports" subtitle="Business intelligence operasional Redbox" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            to={r.href}
            className="block rounded-rb-card border border-rb-border bg-rb-surface p-5 no-underline transition hover:shadow-[0_4px_24px_rgba(30,25,20,0.06)]"
          >
            <div className={`mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] text-sm font-semibold ${r.tint}`}>
              {r.title.charAt(0)}
            </div>
            <div className="mb-1 text-[15px] font-semibold text-rb-text">{r.title}</div>
            <div className="text-xs leading-relaxed text-rb-text-muted">{r.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- ReportsOverview.test.tsx`
Expected: 1 test passes.

- [ ] **Step 6: Wire the route, commit.**

```bash
git add backoffice/src/pages/ReportsOverview.tsx backoffice/src/pages/__tests__/ReportsOverview.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Reports Overview navigation directory"
```

---

### Task 6: Branch Performance page

**Files:**
- Create: `backoffice/src/pages/BranchPerformance.tsx`
- Create: `backoffice/src/pages/__tests__/BranchPerformance.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/reports/branches`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getOwnerRevenue` (B1, for `branch_compare` tx totals),
  `getCustomerSegments` (Task 4's extended `by_branch`).
- Produces: the `BranchPerformance` page, routed at `/reports/branches`.

- [ ] **Step 1: Update route table** (16 → 15).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/BranchPerformance.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BranchPerformance } from '../BranchPerformance';

const OWNER_REVENUE = {
  summary: { revenue_moka: 0, revenue_web: 0, tx_total: 0, avg_tx: 0 },
  daily_trend: [],
  branch_compare: [{ slug: 'csb', name: 'CSB', revenue_moka: 2000000, revenue_web: 400000, tx_total: 28 }],
  top_barbers: [],
  top_services: [],
};

const SEGMENTS = {
  data_coverage: { from: null, to: null, classification_basis: 'test' },
  kpis: { active_customers: 0, new_customers: 0, repeat_customers: 0, loyal_customers: 0, dormant_customers: 0, avg_visit_interval_days: null },
  segments: [],
  new_vs_repeat_trend: [],
  by_branch: [{ branch: 'csb', count: 412, total_customers: 412, repeat_customers: 240 }],
  favorite_barbers: [],
  favorite_services: [],
  customers: { items: [], total: 0, limit: 50, offset: 0 },
};

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-revenue')) return Promise.resolve(new Response(JSON.stringify(OWNER_REVENUE), { status: 200 }));
    if (url.includes('customer-segments')) return Promise.resolve(new Response(JSON.stringify(SEGMENTS), { status: 200 }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('BranchPerformance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a row per branch with real customer and transaction counts', async () => {
    mockFetch();
    render(<BranchPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('does not render an Attendance Issue or Alert column', async () => {
    mockFetch();
    render(<BranchPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Attendance Issue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alert/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/BranchPerformance.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getOwnerRevenue, getCustomerSegments } from '../services/crm';

interface BranchRow {
  slug: string;
  name: string;
  customers: number;
  repeatCustomers: number;
  transactions: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: BranchRow[] };

export function BranchPerformance() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([getOwnerRevenue({ branch: 'all', period: 'month' }), getCustomerSegments({ limit: 1 })])
      .then(([revenue, segments]) => {
        const byBranchMap = new Map(segments.by_branch.map((b) => [b.branch, b]));
        const rows: BranchRow[] = revenue.branch_compare.map((b) => {
          const seg = byBranchMap.get(b.slug);
          return {
            slug: b.slug,
            name: b.name,
            customers: seg?.total_customers ?? 0,
            repeatCustomers: seg?.repeat_customers ?? 0,
            transactions: b.tx_total,
          };
        });
        setState({ status: 'ready', rows });
      })
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat branch performance.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Branch Performance" />

      {state.status === 'loading' && <LoadingState label="Memuat branch performance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="grid grid-cols-4 gap-2 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted border-b border-rb-divider">
            <div>Cabang</div><div>Customer</div><div>Transaksi</div><div>Repeat</div>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {state.rows.map((r) => (
              <div key={r.slug} className="grid grid-cols-4 items-center gap-2 px-4 py-3 text-sm">
                <div className="font-semibold text-rb-text">{r.name}</div>
                <div className="text-rb-text-secondary">{r.customers}</div>
                <div className="text-rb-text-secondary">{r.transactions}</div>
                <div className="text-rb-text-secondary">{r.customers > 0 ? `${Math.round((r.repeatCustomers / r.customers) * 100)}%` : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- BranchPerformance.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/BranchPerformance.tsx backoffice/src/pages/__tests__/BranchPerformance.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Branch Performance to real cross-branch data, no fabricated alert status"
```

---

### Task 7: Barber Performance page

**Files:**
- Create: `backoffice/src/pages/BarberPerformance.tsx`
- Create: `backoffice/src/pages/__tests__/BarberPerformance.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/reports/barbers`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getBarberPerformance` (Task 4).
- Produces: the `BarberPerformance` page, routed at `/reports/barbers`.

- [ ] **Step 1: Update route table** (15 → 14).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/BarberPerformance.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BarberPerformance } from '../BarberPerformance';

const RESULT = {
  barbers: [
    { barber_id: 'b1', name: 'Ubay Santoso', branch: 'samadikun', customers_served: 612, completed_services: 584, repeat_rate: 58 },
    { barber_id: 'b2', name: 'Dodi Iskandar', branch: 'csb', customers_served: 540, completed_services: 512, repeat_rate: 52 },
  ],
};

describe('BarberPerformance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the leaderboard with real customers-served and repeat-rate figures', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />);
    await waitFor(() => {
      expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    });
    expect(screen.getByText('612')).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();
  });

  it('never renders a commission or attendance figure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />);
    await waitFor(() => {
      expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    });
    expect(screen.queryByText(/komisi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attendance/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/BarberPerformance.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getBarberPerformance, type BarberPerformanceEntry } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; barbers: BarberPerformanceEntry[] };

export function BarberPerformance() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getBarberPerformance({})
      .then((data) => setState({ status: 'ready', barbers: data.barbers }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat barber performance.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Barber Performance" />

      {state.status === 'loading' && <LoadingState label="Memuat barber performance..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Leaderboard Barber
          </div>
          <div className="grid grid-cols-5 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
            <div>Barber</div><div>Cabang</div><div>Customer</div><div>Repeat</div><div>Layanan Selesai</div>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {state.barbers.map((b) => (
              <div key={b.barber_id} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-sm">
                <div className="font-semibold text-rb-text">{b.name}</div>
                <div className="text-rb-text-secondary">{b.branch ?? '—'}</div>
                <div className="text-rb-text-secondary">{b.customers_served}</div>
                <div className="text-rb-text-secondary">{b.repeat_rate}%</div>
                <div className="text-rb-text-secondary">{b.completed_services}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- BarberPerformance.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/BarberPerformance.tsx backoffice/src/pages/__tests__/BarberPerformance.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Barber Performance to real leaderboard data, no commission/attendance"
```

---

### Task 8: Full verification and design-fidelity review

**Files:** none.

- [ ] **Step 1:** Run all new backend tests together; expect all pass.
- [ ] **Step 2:** Run the full root server suite; expect the same 24
      pre-existing/unrelated failures, no new ones.
- [ ] **Step 3:** Run the full backoffice test suite; expect all pass.
- [ ] **Step 4:** Build; expect success.
- [ ] **Step 5:** Verify `vercel.json`'s `functions` map still has exactly
      12 entries.
- [ ] **Step 6:** Design-fidelity review against the three `.dc.html` files;
      document deviations (expected: Barber Performance's commission card
      and attendance stat omitted; Branch Performance's Attendance Issue and
      Alert columns omitted; Reports Overview's "Booking Performance",
      "Attendance Report", "Inventory Report" cards point to future/other
      workstreams' pages, not built in this workstream).
- [ ] **Step 7:** Commit the plan with review notes appended.

## Definition of done for this workstream

- [ ] All new backend tests pass
- [ ] Root server suite shows only the same 24 pre-existing/unrelated failures
- [ ] Full backoffice test suite passes
- [ ] `npm --workspace=backoffice run build` succeeds
- [ ] Serverless function count unchanged at 12
- [ ] No commission or unreliable-attendance figures shipped anywhere
- [ ] No fabricated branch health/alert status shipped
- [ ] Design-fidelity review written into the plan/completion report
- [ ] No stop condition was hit — proceed directly into Workstream E per
      standing instruction
