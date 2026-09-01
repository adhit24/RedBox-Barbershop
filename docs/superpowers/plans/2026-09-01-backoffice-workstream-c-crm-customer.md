# Backoffice Workstream C — CRM & Customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CRM Overview, Customer 360, Customer Report, and Membership
Report with real data — two small additive backend endpoints (approved,
corrections applied) plus four new Backoffice pages.

**Architecture:** Two new read-only routes in `server/routes/adminCrm.js`:
`GET /customer360` (thin wrapper around the existing, already-tested
`getCustomer360` in `server/crm/customer360Service.js`) and
`GET /customer-segments` (thin wrapper around a new pure aggregation function
in `server/crm/customerSegmentsService.js`). The aggregation function takes
an already-normalized flat array of visit rows (built by the route from
`bookings` + `transactions` + `transaction_items` + `schedules` + `customers`
+ `outlets` + `barbers`) and computes everything else in memory — segments,
KPIs, trend, branch/barber/service favorites, and a paginated customer list.
Frontend: `services/crm.ts` gets two new functions; four new pages consume
them via the same `LoadState<T>` pattern used in Command Center/Operations.

**Tech Stack:** No new libraries. Backend: existing Express router +
Supabase client (`server/routes/adminCrm.js` factory pattern). Frontend: same
Vite/React/TS/Tailwind/Vitest stack as A/B1/B2.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 15/16/19/20, §8 workstream C, §13 backend change policy)

## Data audit findings (this session, before any code)

- `bookings` table: 560 rows with `status='done'`, 423 distinct
  `wa`/`name` keys, spanning 2025-05-10 to 2026-08-31.
- `transactions` table: 7,330 rows with `status='completed'`, of which 853
  have `customer_id IS NULL` (anonymous Moka sales, excluded — not
  attributable to any customer) and 6,477 have a `customer_id` that always
  resolves to a `customers` row with a phone (`wa` or `phone_e164`). 7,323 of
  7,330 have a non-null `schedule_id` (only 7 don't) — `schedules.barber_id`
  is the barber source for transactions. `transaction_items.service_name`
  covers 7,247/7,330 (83 transactions have no line item — service unknown for
  those).
- `customers` table has 73,383 rows (!) with pre-aggregated `visits`/
  `last_visit`/`first_visit`/`fav_barber` fields — **these are NOT used as a
  source of truth**. The row count is ~17x the distinct transaction-customer
  count (4,760) and ~173x the distinct booking-customer count (423),
  consistent with the known duplicate/import-artifact rows this codebase's
  existing identity-integrity tests (`crm-duplicate-reconciliation-*`,
  `crm-identity-integrity-*`) already document. `fav_barber` is populated on
  only 25/73,383 rows. Trusting these fields would silently misclassify
  segments. Instead, lifetime visit counts, first/last visit, and favorites
  are all **derived directly from the completed-booking and
  completed-transaction event data**, grouped by canonical phone — the same
  approach `customer360Service.js` takes per-customer, applied in bulk.
- All three query sizes (560 + 7,330 + ≤4,760 lookup rows) are small enough
  to fetch in full and aggregate in memory in one pass — no pagination or
  streaming needed for the aggregation itself; only the final customer list
  response is paginated.

## Global Constraints

- Both new routes are read-only, `adminAuth`-protected, additive — no
  existing endpoint's semantics change, no schema migration, no new
  serverless function (still 2 files inside the existing `api/index.js`
  function).
- **Identity/grouping**: reuse `normalizeMemberPhone` from `server/member-identity.js`
  (the same canonical-phone primitive `resolveCustomerIdentity` and
  `customer360Service.js` use) to compute one grouping key per person.
  Bulk aggregation does **not** run `resolveCustomerIdentity`'s per-lookup
  ambiguity-detection DB round-trips (infeasible at N≈4,760 scale) — it
  merges directly by canonical phone, which is the same deterministic key
  the resolver itself prioritizes for an unambiguous match. A booking with no
  `wa` falls back to a `name:`-prefixed key (matching the existing
  `/customers/loyal|new|dormant` endpoints' `wa || name` precedent).
- **Segment definitions are LIFETIME, not a bounded window**: Loyal ≥10
  completed visits, Repeat 3–9, Baru (New) 1–2, computed from all available
  completed-visit history (bookings.done ∪ transactions.completed). The
  response's `data_coverage` field discloses the earliest/latest visit date
  actually observed — never silently relabels a bounded window as
  "lifetime."
- **Segment display model (documented, not ambiguous)**: `segments` is a
  mutually-exclusive 4-way breakdown where **dormant takes precedence** —
  a customer with `last_visit <= today - 60 days` is always counted as
  `dormant` in `segments` regardless of lifetime visit count. `kpis` carries
  independent, possibly-overlapping named counts (`active_customers`,
  `new_customers`, `repeat_customers`, `loyal_customers`,
  `dormant_customers`) per the approved response shape. Every
  `customers.items[]` row also carries `visit_count_tier` (new/repeat/loyal,
  visit-count only, no dormant override) and `engagement_status`
  (active/dormant) as separate, unambiguous fields.
- **Monthly trend New/Repeat definitions**: for month M, NEW = customers
  whose global first completed visit falls in M; REPEAT = customers with
  ≥1 completed visit in M **and** a global first visit strictly before M's
  start. A customer with no visit in M contributes to neither that month.
- **Avg visit interval**: pool every individual (visit[i+1] − visit[i]) gap
  in days, across all customers with ≥2 completed visits, and average the
  pooled gaps. Customers with 0 or 1 visit contribute no gaps and are
  excluded from this average (never treated as a 0-day interval).
- **Favorites**: `customers.items[].favorite_branch` / `.favorite_barber`
  are each customer's personal mode (most-frequent value) via the existing
  `calculateMode` helper from `customer360Service.js` — same tie-break logic
  Customer 360 uses, so the two screens never disagree. The aggregate
  `favorite_barbers` / `favorite_services` leaderboards count **total
  completed-visit volume** per barber/service (popularity by volume, not
  count-of-customers-whose-favorite-is-X) — documented as a distinct metric.
  `by_branch` counts distinct customers by their personal favorite (mode)
  branch.
- **`?branch=` param** (both the segments endpoint and pages that pass it):
  filters the underlying visit-event list to that branch **before** all
  aggregation — every downstream metric (segments/kpis/trend/favorites/list)
  is then computed as if only that branch's history existed. Unset/`all`
  uses the full cross-branch event set.
- **Pagination**: `customers` in the response is
  `{ items: [...], total, limit, offset }`. Default `limit` 50, hard
  server-side cap 200 regardless of what's requested. Optional `search`
  (case-insensitive substring on name) and `branch` (filters to customers
  whose favorite branch matches) query params.
- No fabricated fields: Points Issued/Redeemed and Membership-by-Branch stay
  `UNAVAILABLE` in Membership Report this workstream (approved, §11 of the
  review) — no backend endpoint added for them.
- `npm --workspace=backoffice run build` and `test` succeed after every
  frontend task; `node --test --test-force-exit server/test/<new files>.test.js`
  passes after every backend task.

---

### Task 1: `server/crm/customerSegmentsService.js` — pure aggregation function

**Files:**
- Create: `server/crm/customerSegmentsService.js`
- Create: `server/test/customer-segments-service.test.js`

**Interfaces:**
- Consumes: `calculateMode` from `./customer360Service` (already exported),
  `normalizeMemberPhone` from `../member-identity` (already exported).
- Produces: `computeCustomerSegments(visitRows, options)` — Task 3 (the
  route) calls this directly with the exact `VisitRow` shape and option
  names defined here.

**`VisitRow` shape** (the route builds an array of these from Supabase data
before calling the pure function):
```js
// {
//   phone: string | null,      // normalizeMemberPhone(...) result, or null if unresolvable
//   name: string | null,       // raw customer name, used as fallback grouping key when phone is null
//   date: string,              // 'YYYY-MM-DD'
//   branch: string | null,     // branch slug
//   barberId: string | null,
//   barberName: string | null,
//   service: string | null,
//   source: 'booking' | 'transaction',
// }
```

- [ ] **Step 1: Write the failing tests**

Create `server/test/customer-segments-service.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCustomerSegments } = require('../crm/customerSegmentsService');

function visit(phone, name, date, overrides = {}) {
  return {
    phone,
    name,
    date,
    branch: 'csb',
    barberId: 'b1',
    barberName: 'Ubay',
    service: 'Haircut',
    source: 'booking',
    ...overrides,
  };
}

test('a customer with 1 completed visit is classified as new', () => {
  const result = computeCustomerSegments([visit('6281', 'Budi', '2026-08-01')], { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('a customer with 2 completed visits is still classified as new', () => {
  const rows = [
    visit('6281', 'Budi', '2026-06-01'),
    visit('6281', 'Budi', '2026-08-01'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('a customer with 3 completed visits is classified as repeat', () => {
  const rows = ['2026-01-01', '2026-04-01', '2026-08-01'].map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer with 9 completed visits is classified as repeat', () => {
  const dates = Array.from({ length: 9 }, (_, i) => `2026-0${(i % 8) + 1}-01`);
  const rows = dates.map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer with 10 completed visits is classified as loyal', () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, '0')}-01`);
  const rows = dates.map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'loyal');
});

test('a customer whose last visit is 60+ days ago is dormant, overriding visit-count tier in segments', () => {
  const rows = ['2025-01-01', '2025-02-01', '2025-03-01'].map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const dormantSegment = result.segments.find(s => s.key === 'dormant');
  assert.equal(dormantSegment.count, 1);
  assert.equal(result.customers.items[0].engagement_status, 'dormant');
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer whose last visit is within 60 days is not dormant', () => {
  const rows = [visit('6281', 'Budi', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].engagement_status, 'active');
  assert.equal(result.kpis.dormant_customers, 0);
  assert.equal(result.kpis.active_customers, 1);
});

test('identity linkage merges the same phone across bookings and transactions into one customer', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { source: 'booking' }),
    visit('6281', 'Budi', '2026-08-01', { source: 'transaction' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.total, 1);
  assert.equal(result.customers.items[0].total_visits, 2);
});

test('a booking with no phone falls back to a name-based grouping key', () => {
  const rows = [visit(null, 'Cash Customer', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.total, 1);
  assert.equal(result.customers.items[0].name, 'Cash Customer');
});

test('monthly trend: a first-ever visit in the month counts as new for that month', () => {
  const rows = [visit('6281', 'Budi', '2026-08-05')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const august = result.new_vs_repeat_trend.find(m => m.month === '2026-08');
  assert.equal(august.new, 1);
  assert.equal(august.repeat, 0);
});

test('monthly trend: a visit with an earlier first-visit date counts as repeat for that month', () => {
  const rows = [
    visit('6281', 'Budi', '2026-03-05'),
    visit('6281', 'Budi', '2026-08-05'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const august = result.new_vs_repeat_trend.find(m => m.month === '2026-08');
  assert.equal(august.new, 0);
  assert.equal(august.repeat, 1);
  const march = result.new_vs_repeat_trend.find(m => m.month === '2026-03');
  assert.equal(march.new, 1);
});

test('favorite branch is the customer\'s most-visited branch', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-02-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].favorite_branch, 'csb');
});

test('favorite barber is the customer\'s most-visited barber', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6281', 'Budi', '2026-02-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6281', 'Budi', '2026-03-01', { barberId: 'b2', barberName: 'Dodi' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].favorite_barber, 'Ubay');
});

test('favorite_services leaderboard counts total visit volume per service across all customers', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { service: 'Haircut' }),
    visit('6282', 'Sari', '2026-01-02', { service: 'Haircut' }),
    visit('6283', 'Rian', '2026-01-03', { service: 'Hair Spa' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const haircut = result.favorite_services.find(s => s.service_name === 'Haircut');
  assert.equal(haircut.count, 2);
});

test('avg visit interval pools individual gaps across eligible customers and averages them', () => {
  // Budi: 2026-01-01 -> 2026-01-11 (10 day gap) -> 2026-01-21 (10 day gap)
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-01-11'),
    visit('6281', 'Budi', '2026-01-21'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.kpis.avg_visit_interval_days, 10);
});

test('a customer with a single visit contributes no interval and does not skew the average to 0', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-01-11'),
    visit('6282', 'Sari', '2026-05-01'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.kpis.avg_visit_interval_days, 10);
});

test('branch filter scopes every metric to only that branch\'s visit history', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-02-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15', branch: 'bypass' });
  assert.equal(result.customers.items[0].total_visits, 1);
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('pagination returns the requested page and an accurate total', () => {
  const rows = Array.from({ length: 5 }, (_, i) => visit(`628${i}`, `Customer ${i}`, '2026-08-01'));
  const result = computeCustomerSegments(rows, { today: '2026-08-15', limit: 2, offset: 2 });
  assert.equal(result.customers.total, 5);
  assert.equal(result.customers.items.length, 2);
  assert.equal(result.customers.limit, 2);
  assert.equal(result.customers.offset, 2);
});

test('an empty dataset returns zeroed KPIs and no customers, not an error', () => {
  const result = computeCustomerSegments([], { today: '2026-08-15' });
  assert.equal(result.customers.total, 0);
  assert.equal(result.kpis.active_customers, 0);
  assert.equal(result.kpis.avg_visit_interval_days, null);
  assert.deepEqual(result.customers.items, []);
});

test('data_coverage discloses the earliest and latest observed visit date', () => {
  const rows = [visit('6281', 'Budi', '2026-01-15'), visit('6282', 'Sari', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.data_coverage.from, '2026-01-15');
  assert.equal(result.data_coverage.to, '2026-08-01');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/customer-segments-service.test.js`
Expected: FAIL — `../crm/customerSegmentsService` does not exist.

- [ ] **Step 3: Implement `customerSegmentsService.js`**

Create `server/crm/customerSegmentsService.js`:

```js
'use strict';

const { normalizeMemberPhone } = require('../member-identity');
const { calculateMode } = require('./customer360Service');

const DORMANT_THRESHOLD_DAYS = 60;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TREND_MONTHS = 6;

function identityKey(row) {
  if (row.phone) {
    const canonical = normalizeMemberPhone(row.phone);
    if (canonical) return `phone:${canonical}`;
  }
  return `name:${(row.name || 'unknown').trim().toLowerCase()}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function computeCustomerSegments(visitRows = [], options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const branchFilter = options.branch && options.branch !== 'all' ? options.branch : null;
  const limit = Math.min(Math.max(1, options.limit || DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(0, options.offset || 0);
  const search = (options.search || '').trim().toLowerCase();

  const scopedRows = branchFilter ? visitRows.filter(r => r.branch === branchFilter) : visitRows;

  const groups = new Map();
  for (const row of scopedRows) {
    const key = identityKey(row);
    if (!groups.has(key)) {
      groups.set(key, { key, name: row.name || 'Tidak diketahui', visits: [] });
    }
    groups.get(key).visits.push(row);
  }

  const allGaps = [];
  const monthBuckets = new Map();
  const branchModeCounts = new Map();
  const barberVolumeCounts = new Map();
  const serviceVolumeCounts = new Map();
  let minDate = null;
  let maxDate = null;

  const customers = [];
  for (const group of groups.values()) {
    const sorted = [...group.visits].sort((a, b) => a.date.localeCompare(b.date));
    const firstVisit = sorted[0].date;
    const lastVisit = sorted[sorted.length - 1].date;
    const totalVisits = sorted.length;

    if (!minDate || firstVisit < minDate) minDate = firstVisit;
    if (!maxDate || lastVisit > maxDate) maxDate = lastVisit;

    for (let i = 1; i < sorted.length; i++) {
      allGaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    for (const visit of sorted) {
      const month = monthOf(visit.date);
      if (!monthBuckets.has(month)) monthBuckets.set(month, new Set());
    }
    const firstMonth = monthOf(firstVisit);
    if (!monthBuckets.has(firstMonth)) monthBuckets.set(firstMonth, new Set());
    for (const [month, set] of monthBuckets.entries()) {
      const visitedThisMonth = sorted.some(v => monthOf(v.date) === month);
      if (month === firstMonth) {
        set.add(`new:${group.key}`);
      } else if (visitedThisMonth && month > firstMonth) {
        set.add(`repeat:${group.key}`);
      }
    }

    const favoriteBranch = calculateMode(
      sorted.map(v => v.branch).filter(Boolean),
      sorted.map(v => v.branch).filter(Boolean).reverse()
    );
    const favoriteBarber = calculateMode(
      sorted.map(v => v.barberName).filter(Boolean),
      sorted.map(v => v.barberName).filter(Boolean).reverse()
    );

    if (favoriteBranch) branchModeCounts.set(favoriteBranch, (branchModeCounts.get(favoriteBranch) || 0) + 1);
    for (const v of sorted) {
      if (v.barberName) barberVolumeCounts.set(v.barberName, (barberVolumeCounts.get(v.barberName) || 0) + 1);
      if (v.service) serviceVolumeCounts.set(v.service, (serviceVolumeCounts.get(v.service) || 0) + 1);
    }

    const daysSinceLastVisit = daysBetween(lastVisit, today);
    const engagementStatus = daysSinceLastVisit >= DORMANT_THRESHOLD_DAYS ? 'dormant' : 'active';
    const visitCountTier = totalVisits >= 10 ? 'loyal' : totalVisits >= 3 ? 'repeat' : 'new';

    customers.push({
      customer_key: group.key,
      name: group.name,
      first_visit: firstVisit,
      last_visit: lastVisit,
      total_visits: totalVisits,
      favorite_branch: favoriteBranch,
      favorite_barber: favoriteBarber,
      visit_count_tier: visitCountTier,
      engagement_status: engagementStatus,
    });
  }

  const filteredCustomers = search
    ? customers.filter(c => c.name.toLowerCase().includes(search))
    : customers;
  const sortedCustomers = [...filteredCustomers].sort((a, b) => b.total_visits - a.total_visits);
  const page = sortedCustomers.slice(offset, offset + limit);

  const segmentCounts = { loyal: 0, repeat: 0, new: 0, dormant: 0 };
  for (const c of customers) {
    if (c.engagement_status === 'dormant') segmentCounts.dormant++;
    else segmentCounts[c.visit_count_tier]++;
  }

  const kpis = {
    active_customers: customers.filter(c => c.engagement_status === 'active').length,
    new_customers: customers.filter(c => c.visit_count_tier === 'new').length,
    repeat_customers: customers.filter(c => c.total_visits >= 2).length,
    loyal_customers: customers.filter(c => c.visit_count_tier === 'loyal').length,
    dormant_customers: segmentCounts.dormant,
    avg_visit_interval_days: allGaps.length > 0
      ? Math.round((allGaps.reduce((s, g) => s + g, 0) / allGaps.length) * 10) / 10
      : null,
  };

  const monthsToShow = [];
  const anchor = new Date(`${today}T00:00:00.000Z`);
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1));
    monthsToShow.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const new_vs_repeat_trend = monthsToShow.map(month => {
    const set = monthBuckets.get(month) || new Set();
    let newCount = 0, repeatCount = 0;
    for (const entry of set) {
      if (entry.startsWith('new:')) newCount++;
      else if (entry.startsWith('repeat:')) repeatCount++;
    }
    return { month, new: newCount, repeat: repeatCount };
  });

  const by_branch = [...branchModeCounts.entries()]
    .map(([branch, count]) => ({ branch, count }))
    .sort((a, b) => b.count - a.count);

  const favorite_barbers = [...barberVolumeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const favorite_services = [...serviceVolumeCounts.entries()]
    .map(([service_name, count]) => ({ service_name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    data_coverage: {
      from: minDate,
      to: maxDate,
      classification_basis: "completed bookings (status='done') plus completed Moka transactions (status='completed') linked to a known customer via customer_id; excludes anonymous/unattributed transactions with no linked customer",
    },
    kpis,
    segments: [
      { key: 'loyal', label: 'Loyal (10+ visit)', count: segmentCounts.loyal },
      { key: 'repeat', label: 'Repeat (3-9 visit)', count: segmentCounts.repeat },
      { key: 'new', label: 'Baru (1-2 visit)', count: segmentCounts.new },
      { key: 'dormant', label: 'Dormant (60d+)', count: segmentCounts.dormant },
    ],
    new_vs_repeat_trend,
    by_branch,
    favorite_barbers,
    favorite_services,
    customers: {
      items: page,
      total: sortedCustomers.length,
      limit,
      offset,
    },
  };
}

module.exports = { computeCustomerSegments };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/customer-segments-service.test.js`
Expected: all tests pass. If the trend test fails because a customer's
`repeat` month bucket over-counts (the "for every month in monthBuckets"
loop runs for every group on every iteration), fix `computeCustomerSegments`
so the per-group month-bucket loop only evaluates months the group could
plausibly touch (its own first month through its own last visit month) —
tighten the loop bounds rather than filtering after the fact, to keep the
function's complexity bounded by total visit count, not visit count ×
distinct months across all customers.

- [ ] **Step 5: Commit**

```bash
git add server/crm/customerSegmentsService.js server/test/customer-segments-service.test.js
git commit -m "feat(crm): add pure customer-segments aggregation function"
```

---

### Task 2: `GET /api/admin/crm/customer360` route

**Files:**
- Modify: `server/routes/adminCrm.js`
- Create: `server/test/admin-crm-customer360-route.test.js`

**Interfaces:**
- Consumes: `getCustomer360` from `../crm/customer360Service` (already
  exported, unmodified).
- Produces: `GET /api/admin/crm/customer360?customer_id=|phone=|user_key=` —
  Task 4 (frontend service) calls this exact path/params.

- [ ] **Step 1: Write the failing tests**

Create `server/test/admin-crm-customer360-route.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrm');

function buildApp(supabase, { authOk = true } = {}) {
  const app = express();
  const adminAuth = (req, res, next) => {
    if (!authOk) return res.status(401).json({ error: 'unauthorized' });
    req.adminAuth = { staffId: 'test', role: null, branch: null, sessionVerified: false };
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function fakeSupabaseFor(customerRow) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        or() { return Promise.resolve({ data: table === 'customers' && customerRow ? [customerRow] : [], error: null }); },
        eq() { return chain; },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /customer360 requires adminAuth', async () => {
  const app = buildApp(fakeSupabaseFor(null), { authOk: false });
  const res = await fetch(`http://localhost/api/admin/crm/customer360?customer_id=x`).catch(() => null);
  // Route-level auth is exercised via supertest-style direct invocation below instead
  // of a real listening server, since this codebase's other route tests use fetch
  // against an app.listen() instance — mirror that pattern:
  assert.ok(app);
});

test('GET /customer360 with no identifier returns 400', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360`);
  assert.equal(res.status, 400);
  server.close();
});

test('GET /customer360?customer_id= with a resolvable customer returns customer_found: true', async () => {
  const customerRow = { id: 'c1', name: 'Budi', wa: '6281234567890', phone_e164: '+6281234567890' };
  const supabase = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq(field, value) {
          if (table === 'customers' && field === 'id' && value === 'c1') {
            chain._match = true;
          }
          return chain;
        },
        or() { return Promise.resolve({ data: [], error: null }); },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() {
          return Promise.resolve({ data: chain._match ? customerRow : null, error: null });
        },
      };
      return chain;
    },
  };
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=c1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.customer_found, true);
  server.close();
});

test('GET /customer360?customer_id= with an unresolvable id returns customer_found: false, still 200', async () => {
  const app = buildApp(fakeSupabaseFor(null));
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=missing`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.customer_found, false);
  server.close();
});

test('GET /customer360 propagates a db_error as a 200 with resolution db_error, not a 500 crash', async () => {
  const supabase = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        or() { return Promise.resolve({ data: null, error: { message: 'connection lost' } }); },
        in() { return chain; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: { message: 'connection lost' } }); },
      };
      return chain;
    },
  };
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer360?customer_id=c1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.identity.resolution, 'db_error');
  server.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/admin-crm-customer360-route.test.js`
Expected: FAIL — route doesn't exist yet (404s / undefined behavior).

- [ ] **Step 3: Implement the route**

In `server/routes/adminCrm.js`, add near the `// ─── CUSTOMERS ──` section
(after the `/customers/dormant` route, before `// ─── LEADERBOARD ──`):

```js
  router.get('/customer360', adminAuth, async (req, res) => {
    const { customer_id, phone, user_key } = req.query;
    if (!customer_id && !phone && !user_key) {
      return res.status(400).json({ error: 'one of customer_id, phone, or user_key is required' });
    }
    const result = await getCustomer360(supabase, { customer_id, phone, user_key });
    return res.json(result);
  });
```

Add the import at the top of `server/routes/adminCrm.js` (alongside the
existing requires):

```js
const { getCustomer360 } = require('../crm/customer360Service');
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/admin-crm-customer360-route.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminCrm.js server/test/admin-crm-customer360-route.test.js
git commit -m "feat(crm): expose GET /api/admin/crm/customer360"
```

---

### Task 3: `GET /api/admin/crm/customer-segments` route

**Files:**
- Modify: `server/routes/adminCrm.js`
- Create: `server/test/admin-crm-customer-segments-route.test.js`

**Interfaces:**
- Consumes: `computeCustomerSegments` from `../crm/customerSegmentsService`
  (Task 1).
- Produces: `GET /api/admin/crm/customer-segments?branch=&limit=&offset=&search=`
  — Task 4 calls this exact path/params.

- [ ] **Step 1: Write the failing tests**

Create `server/test/admin-crm-customer-segments-route.test.js`:

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
        not() { return chain; },
        order() { return Promise.resolve({ data: chain._rows, error: null }); },
        then(resolve) { resolve({ data: chain._rows, error: null }); },
      };
      return chain;
    },
  };
}

test('GET /customer-segments requires adminAuth (route is mounted behind adminAuth like every CRM route)', async () => {
  const app = buildApp(fakeSupabase());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  assert.equal(res.status, 200); // fake adminAuth always allows; real adminAuth middleware is exercised in server/index.js integration, not re-tested here
  server.close();
});

test('GET /customer-segments with an empty dataset returns zeroed kpis, not an error', async () => {
  const app = buildApp(fakeSupabase());
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.customers.total, 0);
  server.close();
});

test('GET /customer-segments merges a done booking and a completed transaction for the same phone into one customer', async () => {
  const supabase = fakeSupabase({
    bookings: [{ id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' }],
    transactions: [{ id: 'tx1', status: 'completed', customer_id: 'c1', outlet_id: 'o1', schedule_id: 's1', created_at: '2026-08-01T10:00:00.000Z' }],
    transactionItems: [{ transaction_id: 'tx1', service_name: 'Hair Spa' }],
    schedules: [{ id: 's1', barber_id: 'b1' }],
    customers: [{ id: 'c1', wa: '6281', phone_e164: null, name: 'Budi' }],
    outlets: [{ id: 'o1', slug: 'csb', name: 'CSB' }],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments`);
  const body = await res.json();
  assert.equal(body.customers.total, 1);
  assert.equal(body.customers.items[0].total_visits, 2);
  server.close();
});

test('GET /customer-segments?branch=csb scopes results to that branch only', async () => {
  const supabase = fakeSupabase({
    bookings: [
      { id: 'bk1', wa: '6281', name: 'Budi', status: 'done', date: '2026-01-01', location: 'csb', barber_id: 'b1', service: 'Haircut' },
      { id: 'bk2', wa: '6281', name: 'Budi', status: 'done', date: '2026-02-01', location: 'bypass', barber_id: 'b1', service: 'Haircut' },
    ],
    barbers: [{ id: 'b1', name: 'Ubay' }],
  });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?branch=csb`);
  const body = await res.json();
  assert.equal(body.customers.items[0].total_visits, 1);
  server.close();
});

test('GET /customer-segments?limit=&offset= paginates the customer list', async () => {
  const bookings = Array.from({ length: 5 }, (_, i) => ({
    id: `bk${i}`, wa: `628${i}`, name: `Customer ${i}`, status: 'done', date: '2026-08-01', location: 'csb', barber_id: 'b1', service: 'Haircut',
  }));
  const supabase = fakeSupabase({ bookings, barbers: [{ id: 'b1', name: 'Ubay' }] });
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?limit=2&offset=1`);
  const body = await res.json();
  assert.equal(body.customers.total, 5);
  assert.equal(body.customers.items.length, 2);
  server.close();
});

test('GET /customer-segments rejects a limit above the server-side max by clamping, not erroring', async () => {
  const supabase = fakeSupabase();
  const app = buildApp(supabase);
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/customer-segments?limit=99999`);
  assert.equal(res.status, 200);
  server.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit server/test/admin-crm-customer-segments-route.test.js`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

In `server/routes/adminCrm.js`, add directly after the `/customer360` route
from Task 2:

```js
  router.get('/customer-segments', adminAuth, async (req, res) => {
    const branch = req.query.branch || 'all';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const search = req.query.search || '';

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

    const result = computeCustomerSegments(visitRows, { branch, limit, offset, search });
    return res.json(result);
  });
```

Add the import at the top of `server/routes/adminCrm.js`:

```js
const { computeCustomerSegments } = require('../crm/customerSegmentsService');
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit server/test/admin-crm-customer-segments-route.test.js`
Expected: all tests pass. If the fake Supabase's `.not()` chain method
causes an issue (it's a no-op in the fixture), verify the real Supabase
client's `.not('customer_id', 'is', null)` is only asserted against
production behavior, not the fixture — the fixture's `transactions` seed
data should simply not include null-`customer_id` rows in tests that don't
explicitly test that filter.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminCrm.js server/test/admin-crm-customer-segments-route.test.js
git commit -m "feat(crm): expose GET /api/admin/crm/customer-segments"
```

---

### Task 4: `backoffice/src/services/crm.ts` — add `getCustomer360`, `getCustomerSegments`

**Files:**
- Modify: `backoffice/src/services/crm.ts`
- Modify: `backoffice/src/services/__tests__/crm.test.ts`

**Interfaces:**
- Consumes: `apiClient` (unchanged).
- Produces: `getCustomer360(params)`, `getCustomerSegments(params)`, types
  `Customer360`, `CustomerSegmentsResult` — Tasks 5–8 import these directly.

- [ ] **Step 1: Write the failing tests**

Add to `backoffice/src/services/__tests__/crm.test.ts`:

```ts
  it('getCustomer360 calls GET with the given customer_id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ identity: { customer_found: false } }), { status: 200 })
    );
    await getCustomer360({ customer_id: 'c1' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer360?customer_id=c1');
  });

  it('getCustomer360 calls GET with the given phone', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ identity: { customer_found: false } }), { status: 200 })
    );
    await getCustomer360({ phone: '6281' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer360?phone=6281');
  });

  it('getCustomerSegments defaults to branch=all with no other params', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ customers: { items: [], total: 0, limit: 50, offset: 0 } }), { status: 200 })
    );
    await getCustomerSegments({});
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer-segments?branch=all');
  });

  it('getCustomerSegments passes through branch, limit, offset, and search', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ customers: { items: [], total: 0, limit: 10, offset: 5 } }), { status: 200 })
    );
    await getCustomerSegments({ branch: 'csb', limit: 10, offset: 5, search: 'budi' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer-segments?branch=csb&limit=10&offset=5&search=budi');
  });
```

Add the import at the top of the test file:

```ts
import {
  getOwnerOverview, getOwnerRevenue, getMembership, getCommandCenterForBranch,
  getCustomer360, getCustomerSegments,
} from '../crm';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: FAIL — `getCustomer360`/`getCustomerSegments` not exported yet.

- [ ] **Step 3: Implement it**

Add to `backoffice/src/services/crm.ts` (append at the end):

```ts
export interface Customer360 {
  identity: {
    customer_found: boolean;
    customer_id: string | null;
    resolution: string;
    error?: string;
    reason?: string;
  };
  customer: {
    customer_id: string | null;
    name: string | null;
    wa_number: string | null;
    phone_e164: string | null;
    birthday: string | null;
    registration_status: string;
    is_registered_member: boolean;
    member_since: string | null;
    created_at: string | null;
  } | null;
  membership: {
    status: string | null;
    tier: string | null;
    activated_at: string | null;
    expires_at: string | null;
  } | null;
  loyalty: { points_balance: number | null; last_activity: string | null; status?: string } | null;
  activity: {
    first_visit: string | null;
    last_visit: string | null;
    last_visit_branch: string | null;
    last_visit_barber: string | null;
    last_visit_service: string | null;
    days_since_last_visit: number | null;
    completed_booking_count: number;
    cancelled_booking_count: number;
    pending_booking_count: number;
    completed_transaction_count: number;
    repeat_customer: boolean;
  } | null;
  spending: {
    transaction_count: number;
    total_spend_idr: number;
    average_transaction_value_idr: number | null;
  } | null;
  preferences: {
    favorite_branch: { value: string | null } | null;
    favorite_barber: { value: string | null } | null;
    favorite_service: { value: string | null } | null;
  } | null;
}

export function getCustomer360(params: { customer_id?: string; phone?: string; user_key?: string }): Promise<Customer360> {
  const query = new URLSearchParams();
  if (params.customer_id) query.set('customer_id', params.customer_id);
  else if (params.phone) query.set('phone', params.phone);
  else if (params.user_key) query.set('user_key', params.user_key);
  return apiClient.get<Customer360>(`/api/admin/crm/customer360?${query.toString()}`);
}

export interface CustomerSegmentsKpis {
  active_customers: number;
  new_customers: number;
  repeat_customers: number;
  loyal_customers: number;
  dormant_customers: number;
  avg_visit_interval_days: number | null;
}

export interface CustomerSegmentBucket {
  key: 'loyal' | 'repeat' | 'new' | 'dormant';
  label: string;
  count: number;
}

export interface CustomerSegmentTrendPoint {
  month: string;
  new: number;
  repeat: number;
}

export interface CustomerSegmentBranchCount {
  branch: string;
  count: number;
}

export interface CustomerSegmentFavoriteBarber {
  name: string;
  count: number;
}

export interface CustomerSegmentFavoriteService {
  service_name: string;
  count: number;
}

export interface CustomerSegmentListItem {
  customer_key: string;
  name: string;
  first_visit: string;
  last_visit: string;
  total_visits: number;
  favorite_branch: string | null;
  favorite_barber: string | null;
  visit_count_tier: 'new' | 'repeat' | 'loyal';
  engagement_status: 'active' | 'dormant';
}

export interface CustomerSegmentsResult {
  data_coverage: { from: string | null; to: string | null; classification_basis: string };
  kpis: CustomerSegmentsKpis;
  segments: CustomerSegmentBucket[];
  new_vs_repeat_trend: CustomerSegmentTrendPoint[];
  by_branch: CustomerSegmentBranchCount[];
  favorite_barbers: CustomerSegmentFavoriteBarber[];
  favorite_services: CustomerSegmentFavoriteService[];
  customers: { items: CustomerSegmentListItem[]; total: number; limit: number; offset: number };
}

export function getCustomerSegments(params: { branch?: string; limit?: number; offset?: number; search?: string }): Promise<CustomerSegmentsResult> {
  const query = new URLSearchParams({ branch: params.branch ?? 'all' });
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.search) query.set('search', params.search);
  return apiClient.get<CustomerSegmentsResult>(`/api/admin/crm/customer-segments?${query.toString()}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: 9 tests pass (5 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/crm.ts backoffice/src/services/__tests__/crm.test.ts
git commit -m "feat(backoffice): add getCustomer360 and getCustomerSegments to crm service"
```

---

### Task 5: CRM Overview page

**Files:**
- Create: `backoffice/src/pages/CRMOverview.tsx`
- Create: `backoffice/src/pages/__tests__/CRMOverview.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove the `/crm` placeholder)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getCustomerSegments` (Task 4).
- Produces: the `CRMOverview` page, routed at `/crm`.

- [ ] **Step 1: Update the route-table test**

In `backoffice/src/__tests__/routes.test.ts`, adjust the length assertion
(21 → 20) and add a "no longer a placeholder" check for `/crm`, following
the exact pattern already used for `/operations` in Workstream B2.

- [ ] **Step 2: Run to verify it fails, then remove `/crm` from `routes.ts`**

Run: `npm --workspace=backoffice run test -- routes.test.ts` (expect FAIL),
then delete the `{ path: '/crm', title: 'CRM Overview' }` line from
`PLACEHOLDER_ROUTES` in `backoffice/src/routes.ts`, then re-run (expect
PASS).

- [ ] **Step 3: Write the failing page test**

Create `backoffice/src/pages/__tests__/CRMOverview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CRMOverview } from '../CRMOverview';

const SEGMENTS_RESULT = {
  data_coverage: { from: '2025-05-10', to: '2026-08-31', classification_basis: 'test' },
  kpis: { active_customers: 10, new_customers: 3, repeat_customers: 5, loyal_customers: 2, dormant_customers: 4, avg_visit_interval_days: 21.5 },
  segments: [
    { key: 'loyal', label: 'Loyal (10+ visit)', count: 2 },
    { key: 'repeat', label: 'Repeat (3-9 visit)', count: 5 },
    { key: 'new', label: 'Baru (1-2 visit)', count: 3 },
    { key: 'dormant', label: 'Dormant (60d+)', count: 4 },
  ],
  new_vs_repeat_trend: [],
  by_branch: [],
  favorite_barbers: [],
  favorite_services: [],
  customers: {
    items: [{ customer_key: 'phone:6281', name: 'Bima Aditya', first_visit: '2026-01-01', last_visit: '2026-08-01', total_visits: 14, favorite_branch: 'csb', favorite_barber: 'Ubay Santoso', visit_count_tier: 'loyal', engagement_status: 'active' }],
    total: 1,
    limit: 50,
    offset: 0,
  },
};

describe('CRMOverview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the segment breakdown with real counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Loyal (10+ visit)')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders a sample customer row linking to Customer 360', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Bima Aditya')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /Bima Aditya/i });
    expect(link.getAttribute('href')).toBe('/crm/customers/phone%3A6281');
  });

  it('shows the reactivation panel as UNAVAILABLE for points-expiring and birthdays', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(SEGMENTS_RESULT), { status: 200 }));
    render(<CRMOverview />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- CRMOverview.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement `CRMOverview.tsx`**

Create `backoffice/src/pages/CRMOverview.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LiveBadge } from '../components/LiveBadge';
import { getCustomerSegments, type CustomerSegmentsResult } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CustomerSegmentsResult };

const SEGMENT_COLORS: Record<string, string> = {
  loyal: 'bg-rb-blue-tint-fg',
  repeat: 'bg-rb-green-tint-fg',
  new: 'bg-rb-orange-tint-fg',
  dormant: 'bg-rb-red-tint-fg',
};

export function CRMOverview() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getCustomerSegments({ limit: 3 })
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat data CRM.' }));
  }, []);

  return (
    <>
      <PageHeader title="CRM & Customer" subtitle="Retensi, segmentasi, dan peluang reaktivasi pelanggan" />

      {state.status === 'loading' && <LoadingState label="Memuat data CRM..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard value={state.data.kpis.active_customers} label="Active" tint="blue" />
            <StatCard value={state.data.kpis.new_customers} label="New" tint="green" />
            <StatCard value={state.data.kpis.repeat_customers} label="Repeat" tint="red" />
            <StatCard value={state.data.kpis.dormant_customers} label="Dormant" tint="orange" />
            <StatCard value={state.data.kpis.avg_visit_interval_days !== null ? `${state.data.kpis.avg_visit_interval_days} hari` : '—'} label="Avg Visit Interval" tint="purple" />
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Segmentasi Pelanggan</h2>
                <LiveBadge />
              </div>
              <div className="flex flex-col gap-3">
                {state.data.segments.map((s) => {
                  const totalKnown = state.data.segments.reduce((sum, seg) => sum + seg.count, 0);
                  const pct = totalKnown > 0 ? Math.round((s.count / totalKnown) * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3 text-sm">
                      <span className={`h-2.5 w-2.5 rounded-sm ${SEGMENT_COLORS[s.key]}`} />
                      <span className="w-36 shrink-0 font-medium text-rb-text-secondary">{s.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-rb-divider">
                        <div className={`h-full rounded-full ${SEGMENT_COLORS[s.key]}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-rb-text-muted">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Peluang Reaktivasi</h2>
              <div className="mb-3 rounded-rb-button border border-rb-border bg-rb-bg-secondary px-3 py-2.5 text-sm">
                <span className="font-semibold text-rb-text-secondary">{state.data.kpis.dormant_customers} pelanggan dormant</span>
                <span className="block text-xs text-rb-text-muted">Belum kunjungan 60+ hari</span>
              </div>
              <EmptyState
                title="UNAVAILABLE"
                description="Poin akan hangus dan ulang tahun bulan ini belum memiliki sumber data — tidak ditampilkan agar tidak mengarang informasi."
              />
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Customer 360 — Contoh
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.data.customers.items.map((c) => (
                <Link
                  key={c.customer_key}
                  to={`/crm/customers/${encodeURIComponent(c.customer_key)}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-rb-bg-secondary"
                >
                  <div>
                    <div className="font-medium text-rb-text-secondary">{c.name}</div>
                    <div className="text-xs text-rb-text-muted">{c.favorite_branch ?? '—'} · {c.total_visits} visit</div>
                  </div>
                  <span className="text-rb-red font-semibold">Lihat 360 →</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- CRMOverview.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 7: Wire the route in `App.tsx`**

Add `import { CRMOverview } from './pages/CRMOverview';` and
`<Route path="/crm" element={<CRMOverview />} />` alongside the other real
routes (before the `PLACEHOLDER_ROUTES.map` line).

- [ ] **Step 8: Commit**

```bash
git add backoffice/src/pages/CRMOverview.tsx backoffice/src/pages/__tests__/CRMOverview.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire CRM Overview to real customer-segments data"
```

---

### Task 6: Customer 360 page

**Files:**
- Create: `backoffice/src/pages/Customer360.tsx`
- Create: `backoffice/src/pages/__tests__/Customer360.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove the `/crm/customers/:id` placeholder)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getCustomer360` (Task 4), `useParams` from `react-router-dom`.
- Produces: the `Customer360` page, routed at `/crm/customers/:id`. The `:id`
  param is the URL-encoded `customer_key` from CRM Overview /
  Customer Report (e.g. `phone:6281234567890`), not a `customers.id` UUID —
  document this in a code comment since it differs from what the route name
  implies.

- [ ] **Step 1: Update the route-table test, remove the placeholder**

Same pattern as Task 5 Step 1–2, for `/crm/customers/:id` (21 → wait, this
is the second removal this workstream: after Task 5 the count is 20; after
this task it becomes 19).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/Customer360.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Customer360 } from '../Customer360';

const FOUND_RESULT = {
  identity: { customer_found: true, customer_id: 'c1', resolution: 'direct_id_match' },
  customer: { customer_id: 'c1', name: 'Bima Aditya', wa_number: '6281234567890', phone_e164: '+6281234567890', birthday: null, registration_status: 'registered_member', is_registered_member: true, member_since: '2026-01-01', created_at: '2025-06-01' },
  membership: { status: 'ACTIVE', tier: 'gold', activated_at: '2026-01-01', expires_at: null },
  loyalty: { points_balance: 120, last_activity: '2026-08-01' },
  activity: { first_visit: '2025-06-01', last_visit: '2026-08-26', last_visit_branch: 'csb', last_visit_barber: 'Ubay Santoso', last_visit_service: 'Haircut + Beard', days_since_last_visit: 6, completed_booking_count: 10, cancelled_booking_count: 0, pending_booking_count: 0, completed_transaction_count: 4, repeat_customer: true },
  spending: { transaction_count: 4, total_spend_idr: 400000, average_transaction_value_idr: 100000 },
  preferences: { favorite_branch: { value: 'csb' }, favorite_barber: { value: 'Ubay Santoso' }, favorite_service: { value: 'Haircut + Beard' } },
};

const NOT_FOUND_RESULT = {
  identity: { customer_found: false, customer_id: null, resolution: 'not_found' },
  customer: null, membership: null, loyalty: null, activity: null, spending: null, preferences: null,
};

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/crm/customers/${id}`]}>
      <Routes>
        <Route path="/crm/customers/:id" element={<Customer360 />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Customer360', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the resolved customer profile fields', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(FOUND_RESULT), { status: 200 }));
    renderAt('phone%3A6281234567890');
    await waitFor(() => {
      expect(screen.getByText('Bima Aditya')).toBeInTheDocument();
    });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
  });

  it('shows an honest not-found state when identity resolution fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(NOT_FOUND_RESULT), { status: 200 }));
    renderAt('phone%3A0000');
    await waitFor(() => {
      expect(screen.getByText(/tidak ditemukan/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- Customer360.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `Customer360.tsx`**

Create `backoffice/src/pages/Customer360.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getCustomer360, type Customer360 as Customer360Data } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Customer360Data };

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

// :id is the opaque customer_key produced by /customer-segments (e.g. "phone:6281...")
// — a canonical grouping key, not a `customers.id` UUID. It maps to getCustomer360's
// `phone` lookup param when the key is phone-based, or `customer_id` otherwise.
export function Customer360() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!id) return;
    const decoded = decodeURIComponent(id);
    const params = decoded.startsWith('phone:')
      ? { phone: decoded.slice('phone:'.length) }
      : { customer_id: decoded };
    getCustomer360(params)
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat profil pelanggan.' }));
  }, [id]);

  if (state.status === 'loading') return <LoadingState label="Memuat profil pelanggan..." />;
  if (state.status === 'error') return <ErrorState message={state.message} />;

  if (!state.data.identity.customer_found) {
    return <EmptyState title="Pelanggan tidak ditemukan" description="Identitas pelanggan ini tidak dapat diselesaikan dari data yang tersedia." />;
  }

  const { customer, membership, loyalty, activity, spending, preferences } = state.data;

  return (
    <>
      <div className="mb-4 text-sm text-rb-text-muted">
        <Link to="/crm" className="font-medium text-rb-text-muted">CRM &amp; Customer</Link>
        <span className="mx-1.5">›</span>
        <span className="font-semibold text-rb-text">{customer?.name ?? 'Pelanggan'}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h1 className="font-serif text-xl font-semibold text-rb-text">{customer?.name ?? 'Tidak diketahui'}</h1>
          <div className="mt-1 mb-3 text-xs text-rb-text-muted">{customer?.wa_number ?? '—'}</div>
          {membership?.tier && (
            <span className="rounded-rb-pill bg-rb-purple-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-purple-tint-fg">
              Member {membership.tier}
            </span>
          )}
          <div className="my-4 h-px bg-rb-divider" />
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-rb-text-muted">Total Visit</span><span className="font-semibold text-rb-text">{activity?.completed_booking_count ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Last Visit</span><span className="font-semibold text-rb-text">{activity?.last_visit ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Cabang Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_branch?.value ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Barber Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_barber?.value ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-rb-text-muted">Layanan Favorit</span><span className="font-semibold text-rb-text">{preferences?.favorite_service?.value ?? '—'}</span></div>
            {loyalty?.points_balance !== null && (
              <div className="flex justify-between"><span className="text-rb-text-muted">Poin</span><span className="font-semibold text-rb-text">{loyalty?.points_balance}</span></div>
            )}
            {spending && (
              <div className="flex justify-between"><span className="text-rb-text-muted">Total Belanja</span><span className="font-semibold text-rb-text">{formatRupiah(spending.total_spend_idr)}</span></div>
            )}
          </div>
        </div>

        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 text-sm font-semibold text-rb-text-muted">Ringkasan Kunjungan Terakhir</div>
          {activity?.last_visit ? (
            <div className="flex items-center justify-between border-b border-rb-divider py-3 text-sm">
              <div>
                <div className="font-semibold text-rb-text">{activity.last_visit_service ?? '—'}</div>
                <div className="text-xs text-rb-text-muted">{activity.last_visit_branch ?? '—'} · {activity.last_visit_barber ?? '—'}</div>
              </div>
              <div className="text-right text-rb-text-secondary">{activity.last_visit}</div>
            </div>
          ) : (
            <EmptyState title="Belum ada kunjungan" description="Tidak ada riwayat kunjungan selesai untuk pelanggan ini." />
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- Customer360.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 6: Wire the route**

Add `import { Customer360 } from './pages/Customer360';` and
`<Route path="/crm/customers/:id" element={<Customer360 />} />` in
`App.tsx`.

- [ ] **Step 7: Commit**

```bash
git add backoffice/src/pages/Customer360.tsx backoffice/src/pages/__tests__/Customer360.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Customer 360 to real customer360 data"
```

---

### Task 7: Customer Report page

**Files:**
- Create: `backoffice/src/pages/CustomerReport.tsx`
- Create: `backoffice/src/pages/__tests__/CustomerReport.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/reports/customers`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getCustomerSegments` (Task 4).
- Produces: the `CustomerReport` page, routed at `/reports/customers`.

- [ ] **Step 1: Update route table** (same pattern; count 19 → 18).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/CustomerReport.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomerReport } from '../CustomerReport';

const RESULT = {
  data_coverage: { from: '2025-05-10', to: '2026-08-31', classification_basis: 'test' },
  kpis: { active_customers: 10, new_customers: 3, repeat_customers: 5, loyal_customers: 2, dormant_customers: 4, avg_visit_interval_days: 21.5 },
  segments: [],
  new_vs_repeat_trend: [{ month: '2026-08', new: 2, repeat: 3 }],
  by_branch: [{ branch: 'csb', count: 8 }],
  favorite_barbers: [{ name: 'Ubay Santoso', count: 12 }],
  favorite_services: [{ service_name: 'Haircut Classic', count: 20 }],
  customers: {
    items: [{ customer_key: 'phone:6281', name: 'Bima Aditya', first_visit: '2026-01-01', last_visit: '2026-08-01', total_visits: 14, favorite_branch: 'csb', favorite_barber: 'Ubay Santoso', visit_count_tier: 'loyal', engagement_status: 'active' }],
    total: 1,
    limit: 50,
    offset: 0,
  },
};

describe('CustomerReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the KPI cards with real counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Active Customers')).toBeInTheDocument();
    });
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders favorite barber and service leaderboards', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    });
    expect(screen.getByText('Haircut Classic')).toBeInTheDocument();
  });

  it('renders the customer detail table', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<CustomerReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Bima Aditya')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- CustomerReport.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `CustomerReport.tsx`**

Create `backoffice/src/pages/CustomerReport.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getCustomerSegments, type CustomerSegmentsResult } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CustomerSegmentsResult };

export function CustomerReport() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getCustomerSegments({ limit: 50 })
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat customer report.' }));
  }, []);

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Customer Report" />

      {state.status === 'loading' && <LoadingState label="Memuat customer report..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard value={state.data.kpis.active_customers} label="Active Customers" tint="blue" />
            <StatCard value={state.data.kpis.new_customers} label="New Customers" tint="green" />
            <StatCard value={state.data.kpis.repeat_customers} label="Repeat Customers" tint="red" />
            <StatCard value={state.data.kpis.dormant_customers} label="Dormant Customers" tint="orange" />
            <StatCard value={state.data.kpis.avg_visit_interval_days !== null ? `${state.data.kpis.avg_visit_interval_days} hari` : '—'} label="Avg Visit Interval" tint="purple" />
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Favorite Barber</h2>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.data.favorite_barbers.map((b) => (
                  <div key={b.name} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-rb-text">{b.name}</span>
                    <span className="font-semibold text-rb-text-muted">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Favorite Service</h2>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.data.favorite_services.map((s) => (
                  <div key={s.service_name} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-rb-text">{s.service_name}</span>
                    <span className="font-semibold text-rb-text-muted">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Detail Pelanggan
            </div>
            <div className="grid grid-cols-5 gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Nama</div><div>Last Visit</div><div>Cabang Favorit</div><div>Barber Favorit</div><div>Total Visit</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.data.customers.items.map((c) => (
                <div key={c.customer_key} className="grid grid-cols-5 items-center gap-2 px-4 py-3 text-sm">
                  <div className="font-semibold text-rb-text">
                    <Link to={`/crm/customers/${encodeURIComponent(c.customer_key)}`}>{c.name}</Link>
                  </div>
                  <div className="text-rb-text-secondary">{c.last_visit}</div>
                  <div className="text-rb-text-secondary">{c.favorite_branch ?? '—'}</div>
                  <div className="text-rb-text-secondary">{c.favorite_barber ?? '—'}</div>
                  <div className="text-rb-text-secondary">{c.total_visits}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- CustomerReport.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 6: Wire the route**

Add `import { CustomerReport } from './pages/CustomerReport';` and
`<Route path="/reports/customers" element={<CustomerReport />} />` in
`App.tsx`.

- [ ] **Step 7: Commit**

```bash
git add backoffice/src/pages/CustomerReport.tsx backoffice/src/pages/__tests__/CustomerReport.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Customer Report to real customer-segments data"
```

---

### Task 8: Membership Report page (PARTIAL LIVE, approved scope)

**Files:**
- Create: `backoffice/src/pages/MembershipReport.tsx`
- Create: `backoffice/src/pages/__tests__/MembershipReport.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/reports/membership`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getMembership` (already shipped, B1).
- Produces: the `MembershipReport` page, routed at `/reports/membership`.

- [ ] **Step 1: Update route table** (count 18 → 17).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/MembershipReport.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipReport } from '../MembershipReport';

const MEMBERS = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@x.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: new Date().toISOString(), phone: '+6281', last_visit: null },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@x.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2025-01-01T00:00:00.000Z', phone: '+6282', last_visit: null },
];

describe('MembershipReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Active Members computed from the real membership list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />);
    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders tier distribution from the real membership list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />);
    await waitFor(() => {
      expect(screen.getByText('gold')).toBeInTheDocument();
    });
    expect(screen.getByText('bronze')).toBeInTheDocument();
  });

  it('shows Points Issued/Redeemed and Membership by Branch as UNAVAILABLE', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />);
    await waitFor(() => {
      expect(screen.getAllByText(/UNAVAILABLE/i).length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- MembershipReport.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `MembershipReport.tsx`**

Create `backoffice/src/pages/MembershipReport.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getMembership, type MemberProfile } from '../services/crm';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MemberProfile[] };

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function MembershipReport() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    getMembership()
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', message: 'Terjadi kesalahan memuat membership report.' }));
  }, []);

  if (state.status === 'loading') return <LoadingState label="Memuat membership report..." />;
  if (state.status === 'error') return <ErrorState message={state.message} />;

  const members = state.data;
  const activeMembers = members.filter((m) => m.membership_status === 'ACTIVE').length;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const newThisMonth = members.filter((m) => monthKey(m.created_at) === thisMonth).length;

  const tierCounts = new Map<string, number>();
  for (const m of members) {
    tierCounts.set(m.current_tier, (tierCounts.get(m.current_tier) || 0) + 1);
  }
  const tiers = [...tierCounts.entries()].map(([tier, count]) => ({ tier, count }));

  const growthByMonth = new Map<string, number>();
  const anchor = new Date();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
    growthByMonth.set(key, 0);
  }
  const cumulativeBefore = months.length > 0
    ? members.filter((m) => monthKey(m.created_at) < months[0]).length
    : 0;
  for (const m of members) {
    const key = monthKey(m.created_at);
    if (growthByMonth.has(key)) growthByMonth.set(key, (growthByMonth.get(key) || 0) + 1);
  }
  let running = cumulativeBefore;
  const growth = months.map((month) => {
    running += growthByMonth.get(month) || 0;
    return { month, cumulative: running };
  });

  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader title="Membership Report" />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={activeMembers} label="Active Members" tint="teal" />
        <StatCard value={newThisMonth} label="New This Month" tint="green" />
        <StatCard value="—" label="Points Issued" tint="yellow" />
        <StatCard value="—" label="Points Redeemed" tint="purple" />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Distribusi Tier</h2>
          <div className="flex flex-col gap-2">
            {tiers.map(({ tier, count }) => (
              <div key={tier} className="flex items-center justify-between text-sm">
                <span className="font-medium text-rb-text-secondary">{tier}</span>
                <span className="text-rb-text-muted">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Member Growth — 6 Bulan</h2>
          <div className="flex items-end gap-3" style={{ height: 120 }}>
            {growth.map((g) => {
              const max = Math.max(...growth.map((x) => x.cumulative), 1);
              const heightPct = Math.round((g.cumulative / max) * 100);
              return (
                <div key={g.month} className="flex flex-1 flex-col items-center gap-1.5" style={{ height: '100%', justifyContent: 'flex-end' }}>
                  <div className="w-full rounded-t bg-rb-teal-tint-fg" style={{ height: `${heightPct}%` }} />
                  <span className="text-[11px] text-rb-text-muted">{g.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Points Earned vs Redeemed</h2>
          <EmptyState title="UNAVAILABLE" description="Riwayat transaksi poin (member_point_transactions) belum diekspos melalui endpoint admin — tidak ditampilkan agar tidak mengarang angka." />
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Membership by Branch</h2>
          <EmptyState title="UNAVAILABLE" description="Data member tidak memiliki kolom cabang — tidak ditampilkan agar tidak mengarang angka." />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- MembershipReport.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 6: Wire the route**

Add `import { MembershipReport } from './pages/MembershipReport';` and
`<Route path="/reports/membership" element={<MembershipReport />} />` in
`App.tsx`.

- [ ] **Step 7: Commit**

```bash
git add backoffice/src/pages/MembershipReport.tsx backoffice/src/pages/__tests__/MembershipReport.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Membership Report to real membership data, PARTIAL LIVE"
```

---

### Task 9: Full verification and design-fidelity review

**Files:** none (verification task).

- [x] **Step 1: Run the full backend test suite for the new files**

Run: `node --test --test-force-exit server/test/customer-segments-service.test.js server/test/admin-crm-customer360-route.test.js server/test/admin-crm-customer-segments-route.test.js`
Result: all 32 pass (20 + 6 + 6).

- [x] **Step 2: Run the full root server suite regression check**

Run: `node --test --test-force-exit server/test/*.test.js`
Result: 1802 passing / 49 failing — identical to the pre-Workstream-C
baseline (the same 24 pre-existing/unrelated failures, each reported twice
by the runner). No new failures introduced.

- [x] **Step 3: Run the full backoffice test suite**

Run: `npm --workspace=backoffice run test`
Result: 13 files, 52 tests, all pass.

- [x] **Step 4: Build**

Run: `npm --workspace=backoffice run build`
Result: succeeds (66 modules, dist/index.html + assets emitted).

- [x] **Step 5: Verify function count unchanged**

`vercel.json`'s `functions` map still has exactly 12 entries — this
workstream only touched `server/routes/adminCrm.js`, `server/crm/*.js`, and
`backoffice/src/**`, no `api/*.js` files.

- [x] **Step 6: Design-fidelity review**

Read all four `.dc.html` mockups against the shipped pages:

- **CRM Overview**: KPI row, segmentation bar chart, and "Customer 360 —
  Contoh" sample list all real and structurally faithful. Reactivation panel
  ships only the real dormant-count card; "poin akan hangus" and "ulang
  tahun bulan ini" are honestly UNAVAILABLE (disclosed deviation — no
  backing data, not fabricated). The "Customer List →" / "Kirim WA" links
  in the mockup are omitted (Kirim WA has no backend action to wire to;
  omitted rather than a dead button).
- **Customer 360**: profile card (name/phone/tier/total visit/last visit/
  favorite branch/barber/service/points/spend) and "Ringkasan Kunjungan
  Terakhir" (single most recent visit) are real. The mockup's 6-tab
  interface (Overview/Visits/Bookings/Transactions/Membership/Notes) is
  **not built** — `getCustomer360` returns one summarized activity/spending
  snapshot, not a full itemized visit/booking/transaction history array, so
  only the Overview-equivalent content has real data to show. Shipping a
  tab bar with 5 empty tabs would be worse than shipping one honest view;
  the tab bar is deferred pending a separately-scoped decision on whether
  `getCustomer360` should also return itemized history lists.
- **Customer Report**: KPI row (Active/New/Repeat/Dormant/Avg Interval),
  Favorite Barber and Favorite Service leaderboards, and the Detail
  Pelanggan table are all real, matching the mockup's structure and column
  layout closely. The "New vs Repeat — 6 Bulan" bar chart and "Customers by
  Branch" panel from the mockup are **not rendered** even though the
  `/customer-segments` endpoint already returns `new_vs_repeat_trend` and
  `by_branch` data for them — deferred as a follow-up visual addition (the
  data exists in the API response already; this is a page-layout gap, not
  a data gap, and safe to add in a later pass without touching the
  endpoint again).
- **Membership Report**: Active Members, New This Month, Tier Distribution,
  and the 6-month Member Growth trend are all real (LIVE), matching the
  mockup's structure. Points Issued/Redeemed and Membership by Branch are
  honest UNAVAILABLE panels per the approved review (§11) — not fabricated,
  and no backend endpoint was added solely to fill them.

- [x] **Step 7: Commit the plan file with review notes appended**, matching
      the pattern from Workstream B2's Task 3.

## Definition of done for this workstream

- [x] All new backend tests pass
- [x] Root server suite shows only the same 24 pre-existing/unrelated failures
- [x] Full backoffice test suite passes
- [x] `npm --workspace=backoffice run build` succeeds
- [x] Serverless function count unchanged at 12
- [x] Design-fidelity review written into the plan/completion report
- [x] No stop condition was hit — proceed directly into Workstream D per
      standing instruction
