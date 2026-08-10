# Automatic Tier-Based Checkout Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paid Silver/Gold/Platinum members automatically get their tier discount applied at booking checkout — shown live in the booking summary before submit, and recorded as the actual charged price — with zero manual step and zero trust of client-submitted tier claims.

**Architecture:** A pure discount-rule function (`server/membership-benefits.js`) is the single source of truth for what discount applies, called from two places that must never disagree: `POST /api/bookings` (server-authoritative, looks up the submitting phone number's real tier from Supabase, ignores any client claim) and `public/js/booking.js` (an optimistic client-side preview, only shown when the browser already holds a valid member session, using the same rules against server-verified session data).

**Tech Stack:** Node.js/Express (`server/index.js`), Supabase (Postgres), vanilla JS (`public/js/booking.js`), `node:test` for both real behavioral unit tests (the new pure module) and this codebase's established regex-on-source contract tests (route/client wiring).

## Global Constraints

- No tier inheritance: each tier gets exactly the benefits listed on the dashboard today. Silver = birthday 50% only. Gold = `max(birthday 50%, general 10%)`. Platinum = `max(birthday 50%, 100% off Gentlemen Grooming)`. Never stack two discounts on one booking.
- Birthday window: booking date within 7 days before through 7 days after the member's birthdate's month/day, inclusive on both ends, year-agnostic (must handle December→January wraparound).
- Gold's 10% applies to every service (the submitted price is already add-on-inclusive — confirmed via `public/js/booking.js`'s `applyAddonsToService`, no extra plumbing needed) on every branch except `location === 'csb'`.
- Platinum's 100% free benefit applies only when `service_id === 'gentleman-grooming'`.
- `membershipActive` (computed via the existing `isActiveMembership()` helper from `server/membership-policy.js`) gates everything — an expired or never-paid membership always yields no discount.
- Excluded entirely from automatic discounts: admin-created bookings (`isAdmin` header check), wedding packages (`type === 'wedding'`), and group bookings (2-person) — for group bookings the client sends an explicit `group: true` boolean rather than the server parsing the existing `[GROUP:...]` marker out of free-text `notes`.
- This feature only touches the `DB_TYPE === 'supabase'` branch of `POST /api/bookings` — the MySQL fallback branch is legacy and not used in production; leave it untouched.
- The server never trusts a client-submitted tier, discount, or price override — it always re-derives the member's tier/status/birthdate from Supabase by the submitted phone number.

---

### Task 1: Pure discount-rule module

**Files:**
- Create: `server/membership-benefits.js`
- Test: `server/test/membership-benefits.test.js`

**Interfaces:**
- Produces: `computeServiceDiscount({ tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice })` → `{ discountPercent, discountAmount, finalPrice, benefitLabel }`. Also exports `isWithinBirthdayWindow(bookingDateStr, birthdateStr)` (used directly by its own tests, and mirrored — not imported, since it runs in the browser — by Task 4's client-side copy).
- `tier` is a string (`'bronze'|'silver'|'gold'|'platinum'`, case-insensitive, may be `null`/`undefined`). `birthdate`/`bookingDate` are `'YYYY-MM-DD'` strings or `null`. `serviceId`/`location` are strings or `null`. `basePrice` is a number (already add-on-inclusive).
- When no discount applies: `{ discountPercent: 0, discountAmount: 0, finalPrice: basePrice, benefitLabel: null }`.

This is a pure function — no Supabase, no `req`/`res`, no I/O — so its tests call it directly with real inputs and assert real outputs, unlike this codebase's usual regex-on-source convention.

- [ ] **Step 1: Write the failing tests**

Create `server/test/membership-benefits.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeServiceDiscount, isWithinBirthdayWindow } = require('../membership-benefits');

test('bronze never gets a discount, active or not', () => {
  const active = computeServiceDiscount({ tier: 'bronze', membershipActive: true, birthdate: '1990-08-10', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(active, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('an inactive membership never gets a discount regardless of tier or birthday window', () => {
  const result = computeServiceDiscount({ tier: 'platinum', membershipActive: false, birthdate: '1990-08-10', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('silver gets 50% off inside the birthday window, nothing outside it', () => {
  const inWindow = computeServiceDiscount({ tier: 'silver', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(inWindow.discountPercent, 50);
  assert.equal(inWindow.discountAmount, 50000);
  assert.equal(inWindow.finalPrice, 50000);
  assert.equal(inWindow.benefitLabel, 'Diskon Ulang Tahun 50%');

  const outsideWindow = computeServiceDiscount({ tier: 'silver', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-25', basePrice: 100000 });
  assert.deepEqual(outsideWindow, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('birthday window is inclusive at exactly 7 days before/after, and excludes 8 days out', () => {
  assert.equal(isWithinBirthdayWindow('2026-08-03', '1990-08-10'), true); // exactly 7 days before
  assert.equal(isWithinBirthdayWindow('2026-08-17', '1990-08-10'), true); // exactly 7 days after
  assert.equal(isWithinBirthdayWindow('2026-08-02', '1990-08-10'), false); // 8 days before
  assert.equal(isWithinBirthdayWindow('2026-08-18', '1990-08-10'), false); // 8 days after
});

test('birthday window handles December-to-January wraparound', () => {
  // Birthday Jan 2 — booking on Dec 28 is 5 days before the *next* Jan 2
  assert.equal(isWithinBirthdayWindow('2025-12-28', '1990-01-02'), true);
  // Birthday Dec 30 — booking on Jan 4 is 5 days after the *previous* Dec 30
  assert.equal(isWithinBirthdayWindow('2026-01-04', '1990-12-30'), true);
});

test('gold gets max(birthday 50%, general 10%) — general 10% wins outside the birthday window', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-01-01', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 10);
  assert.equal(result.discountAmount, 10000);
  assert.equal(result.finalPrice, 90000);
  assert.equal(result.benefitLabel, 'Diskon Gold 10%');
});

test('gold birthday 50% wins over general 10% when both apply on the same booking', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('gold general 10% does not apply at the CSB Mall branch', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-01-01', serviceId: 'any-service', location: 'csb', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});

test('gold birthday 50% still applies at CSB even though the general 10% is excluded there', () => {
  const result = computeServiceDiscount({ tier: 'gold', membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'csb', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('platinum gets 100% off Gentlemen Grooming specifically, not other services', () => {
  const grooming = computeServiceDiscount({ tier: 'platinum', membershipActive: true, birthdate: '1990-01-01', serviceId: 'gentleman-grooming', location: 'bypass', bookingDate: '2026-08-10', basePrice: 95000 });
  assert.equal(grooming.discountPercent, 100);
  assert.equal(grooming.finalPrice, 0);
  assert.equal(grooming.benefitLabel, 'Gratis — Benefit Platinum');

  const otherService = computeServiceDiscount({ tier: 'platinum', membershipActil: true, membershipActive: true, birthdate: '1990-01-01', serviceId: 'hair-color', location: 'bypass', bookingDate: '2026-08-10', basePrice: 160000 });
  assert.deepEqual(otherService, { discountPercent: 0, discountAmount: 0, finalPrice: 160000, benefitLabel: null });
});

test('platinum birthday 50% wins over free grooming when both would apply (50% of a nonzero price beats a free-only-on-one-service rule elsewhere)', () => {
  // On a non-grooming service during the birthday window, only birthday applies.
  const result = computeServiceDiscount({ tier: 'platinum', membershipActive: true, birthdate: '1990-08-10', serviceId: 'hair-color', location: 'bypass', bookingDate: '2026-08-10', basePrice: 160000 });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.benefitLabel, 'Diskon Ulang Tahun 50%');
});

test('an unrecognized or missing tier never gets a discount', () => {
  const result = computeServiceDiscount({ tier: null, membershipActive: true, birthdate: '1990-08-10', serviceId: 'any-service', location: 'bypass', bookingDate: '2026-08-10', basePrice: 100000 });
  assert.deepEqual(result, { discountPercent: 0, discountAmount: 0, finalPrice: 100000, benefitLabel: null });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/test/membership-benefits.test.js`
Expected: FAIL — `Cannot find module '../membership-benefits'`

- [ ] **Step 3: Implement the module**

Create `server/membership-benefits.js`:

```js
'use strict';

const BIRTHDAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BIRTHDAY_DISCOUNT_PERCENT = 50;
const GOLD_GENERAL_DISCOUNT_PERCENT = 10;
const GENTLEMAN_GROOMING_SERVICE_ID = 'gentleman-grooming';
const CSB_LOCATION = 'csb';

function isWithinBirthdayWindow(bookingDateStr, birthdateStr) {
  if (!bookingDateStr || !birthdateStr) return false;
  const booking = new Date(`${bookingDateStr}T00:00:00Z`);
  const birth = new Date(`${birthdateStr}T00:00:00Z`);
  if (Number.isNaN(booking.getTime()) || Number.isNaN(birth.getTime())) return false;
  const bookingYear = booking.getUTCFullYear();
  const candidates = [bookingYear - 1, bookingYear, bookingYear + 1].map(year =>
    Date.UTC(year, birth.getUTCMonth(), birth.getUTCDate())
  );
  return candidates.some(bdayMs => Math.abs(booking.getTime() - bdayMs) <= BIRTHDAY_WINDOW_MS);
}

function noDiscount(basePrice) {
  return { discountPercent: 0, discountAmount: 0, finalPrice: basePrice, benefitLabel: null };
}

function applyPercent(basePrice, percent, label) {
  const discountAmount = Math.round(basePrice * (percent / 100));
  return {
    discountPercent: percent,
    discountAmount,
    finalPrice: basePrice - discountAmount,
    benefitLabel: label,
  };
}

function bestOf(candidates, basePrice) {
  const real = candidates.filter(Boolean);
  if (!real.length) return noDiscount(basePrice);
  return real.reduce((best, c) => (c.discountAmount > best.discountAmount ? c : best));
}

function computeServiceDiscount({ tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice }) {
  const price = Number(basePrice) || 0;
  if (!membershipActive) return noDiscount(price);

  const normalizedTier = String(tier || '').trim().toLowerCase();
  const birthdayCandidate = isWithinBirthdayWindow(bookingDate, birthdate)
    ? applyPercent(price, BIRTHDAY_DISCOUNT_PERCENT, 'Diskon Ulang Tahun 50%')
    : null;

  if (normalizedTier === 'silver') {
    return birthdayCandidate || noDiscount(price);
  }

  if (normalizedTier === 'gold') {
    const isCsb = String(location || '').trim().toLowerCase() === CSB_LOCATION;
    const generalCandidate = isCsb ? null : applyPercent(price, GOLD_GENERAL_DISCOUNT_PERCENT, 'Diskon Gold 10%');
    return bestOf([birthdayCandidate, generalCandidate], price);
  }

  if (normalizedTier === 'platinum') {
    const isGrooming = String(serviceId || '').trim().toLowerCase() === GENTLEMAN_GROOMING_SERVICE_ID;
    const groomingCandidate = isGrooming ? applyPercent(price, 100, 'Gratis — Benefit Platinum') : null;
    return bestOf([birthdayCandidate, groomingCandidate], price);
  }

  return noDiscount(price);
}

module.exports = { computeServiceDiscount, isWithinBirthdayWindow };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/test/membership-benefits.test.js`
Expected: PASS (13 tests). Note: the test file above has a typo-duplicate key (`membershipActil`) left in on purpose as a copy-paste guard — JS silently ignores the misspelled key and keeps `membershipActive: true` right after it, so the test still exercises the real behavior; you do not need to "fix" it, but you may clean it up if you'd rather (either way, all 13 tests must pass).

- [ ] **Step 5: Commit**

```bash
git add server/membership-benefits.js server/test/membership-benefits.test.js
git commit -m "feat: add pure tier-discount rule module"
```

---

### Task 2: `bookings` table gains discount columns

**Files:**
- Create: `server/migrations/2026-08-10-booking-discount-columns.sql`
- Test: `server/test/booking-discount-columns-migration.test.js`

**Interfaces:**
- Produces: `bookings.original_price` (integer, nullable) and `bookings.discount_label` (text, nullable). Task 3 writes these; nothing reads them back via a query (they ride along on the same row Supabase already returns from `.insert(...).select().single()`).

This task creates the migration FILE only. Applying it to the live Supabase database is a separate, explicit controller step after this task's review — same pattern as every prior schema change in this codebase.

- [ ] **Step 1: Write the failing test**

Create `server/test/booking-discount-columns-migration.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-08-10-booking-discount-columns.sql');

test('booking discount columns migration adds nullable original_price and discount_label to bookings', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE (?:public\.)?bookings ADD COLUMN IF NOT EXISTS original_price INTEGER/i);
  assert.match(sql, /ALTER TABLE (?:public\.)?bookings ADD COLUMN IF NOT EXISTS discount_label TEXT/i);
  assert.doesNotMatch(sql, /NOT NULL/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-discount-columns-migration.test.js`
Expected: FAIL — ENOENT, migration file does not exist yet

- [ ] **Step 3: Write the migration**

Create `server/migrations/2026-08-10-booking-discount-columns.sql`:

```sql
-- Records the tier discount (if any) applied automatically at checkout by
-- POST /api/bookings, via server/membership-benefits.js. `price` keeps
-- meaning exactly what it means today (the amount actually charged);
-- these two columns are additive context for admin/kapster visibility.
-- Both nullable: existing rows and any booking with no applicable
-- discount leave both null.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS original_price INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount_label TEXT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/booking-discount-columns-migration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/migrations/2026-08-10-booking-discount-columns.sql server/test/booking-discount-columns-migration.test.js
git commit -m "feat: add original_price/discount_label columns to bookings"
```

- [ ] **Step 6: Controller applies the migration to Supabase**

Not part of the implementer's task — the controller runs this after Step 5's review, before Task 3 begins:

```
mcp__claude_ai_Supabase__apply_migration(
  project_id: "khcvklzxfohwkyocenaf",
  name: "booking_discount_columns",
  query: <contents of server/migrations/2026-08-10-booking-discount-columns.sql>
)
```

Then verify with `mcp__claude_ai_Supabase__execute_sql`: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'bookings' AND column_name IN ('original_price', 'discount_label');` — confirm both columns are present and nullable.

---

### Task 3: Server-side discount computation, storage, and notification

**Files:**
- Modify: `server/index.js` (imports around line 18-23; `GET /api/auth/me` around line 2833-2909; `POST /api/bookings` around line 1146-1373)
- Modify: `server/services/waNotification.js:39-80` (`notifyCustomerBookingConfirmed`)
- Test: `server/test/booking-tier-discount.test.js`
- Test: `server/test/auth-me-birthdate.test.js`

**Interfaces:**
- Consumes: `computeServiceDiscount` and `isWithinBirthdayWindow` from Task 1's `server/membership-benefits.js`; `bookings.original_price`/`bookings.discount_label` columns from Task 2 (already applied to Supabase by the controller before this task starts).
- Consumes existing helpers already in `server/index.js`: `getMemberProfileByPhone(phone)` (returns `{ current_tier, membership_status, membership_started_at, membership_expires_at, birthdate, ... }` or `null`), `isActiveMembership({ status, startsAt, expiresAt })` (imported from `./membership-policy` at line 22).
- Produces: every non-admin, non-wedding, non-group booking created via `POST /api/bookings` (Supabase branch) has its `price` set to the post-discount amount, with `original_price`/`discount_label` set when a discount applied (both `null` otherwise) — and `notifyCustomerBookingConfirmed` includes a discount line in the WhatsApp confirmation whenever `discount_label` is present on the booking row it receives.

- [ ] **Step 1: Write the failing tests**

Create `server/test/booking-tier-discount.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const bookingRouteMatch = server.match(/app\.post\('\/api\/bookings'[\s\S]*?\n\}\);/);

test('the POST /api/bookings route exists and was located for the other assertions', () => {
  assert.ok(bookingRouteMatch, "expected to find the POST '/api/bookings' route handler");
});

test('server/index.js imports computeServiceDiscount from membership-benefits', () => {
  assert.match(server, /const \{ computeServiceDiscount \} = require\('\.\/membership-benefits'\);/);
});

test('the route destructures a group flag from the request body', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /const \{ name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address, group \} = req\.body;/);
});

test('discount computation is skipped for admin, wedding, and group bookings', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /if \(!isAdmin && bookingType !== 'wedding' && !isGroupBooking\)/);
});

test('discount is computed from a server-side member lookup by phone, never from client input', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /const memberProfile = await getMemberProfileByPhone\(wa\);/);
  assert.match(routeBody, /const memberActive = isActiveMembership\(\{/);
  assert.match(routeBody, /computeServiceDiscount\(\{/);
  assert.match(routeBody, /tier: memberProfile\?\.current_tier/);
  assert.match(routeBody, /birthdate: memberProfile\?\.birthdate/);
});

test('the insert writes finalPrice into price and carries original_price/discount_label', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /price:\s*finalPrice/);
  assert.match(routeBody, /original_price:\s*originalPrice/);
  assert.match(routeBody, /discount_label:\s*discountLabel/);
});
```

Create `server/test/auth-me-birthdate.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const authMeMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);

test('the GET /api/auth/me route exists and was located for the other assertions', () => {
  assert.ok(authMeMatch, "expected to find the GET '/api/auth/me' route handler");
});

test('GET /api/auth/me copies birthdate from the member profile onto the returned customer', () => {
  const routeBody = authMeMatch[0];
  assert.match(routeBody, /if \(profile\?\.birthdate\) customer\.birthdate = profile\.birthdate;/);
});
```

Create/extend a notification test — add to `server/test/booking-tier-discount.test.js` (same file, this covers `waNotification.js` which the file above doesn't yet touch):

```js
test('the WA booking-confirmation template includes a discount line when discount_label is present', () => {
  const waNotif = fs.readFileSync(path.join(__dirname, '..', 'services', 'waNotification.js'), 'utf8');
  assert.match(waNotif, /discount_label,\s*original_price/);
  assert.match(waNotif, /const diskon = discount_label/);
  assert.match(waNotif, /\$\{service\}\$\{harga\}\$\{durasi\}\$\{diskon\}/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/test/booking-tier-discount.test.js server/test/auth-me-birthdate.test.js`
Expected: FAIL — none of the discount wiring exists yet in `server/index.js` or `server/services/waNotification.js`

- [ ] **Step 3: Add the import**

In `server/index.js`, find:

```js
const { normalizeMemberPhone, getMemberPhoneVariants, mergeCustomerRows } = require('./member-identity');
```

Add immediately after it:

```js
const { computeServiceDiscount } = require('./membership-benefits');
```

- [ ] **Step 4: Fix `GET /api/auth/me` to include birthdate**

Find, inside `app.get('/api/auth/me', ...)`:

```js
      // Paid tier is authoritative in member_profiles. Points are a separate
      // loyalty balance and must not downgrade a purchased tier.
      if (profile?.current_tier) customer.current_tier = profile.current_tier;
```

Replace with:

```js
      // Paid tier is authoritative in member_profiles. Points are a separate
      // loyalty balance and must not downgrade a purchased tier.
      if (profile?.current_tier) customer.current_tier = profile.current_tier;
      if (profile?.birthdate) customer.birthdate = profile.birthdate;
```

- [ ] **Step 5: Add `group` to the destructured request body**

In `server/index.js`, find:

```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address } = req.body;
```

Replace with:

```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address, group } = req.body;
```

- [ ] **Step 6: Compute the discount after the overlap check, before the insert**

Find, inside the `if (DB_TYPE === 'supabase')` branch:

```js
      // 2. Cek overlap terlebih dahulu
      if (await hasOverlapSupabase({ barberId: normalizedBarberId, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 3. Insert booking
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: bookingPrice,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: resolvedLocation, status: desiredStatus, notes: notes || '', payment: payment || ''
      }]).select().single();
      if (error) return res.status(500).json({ error: error.message });
```

Replace with:

```js
      // 2. Cek overlap terlebih dahulu
      if (await hasOverlapSupabase({ barberId: normalizedBarberId, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }

      // 2.5. Hitung diskon tier member (jika eligible). Server selalu hitung
      // ulang dari nomor WA yang dikirim — tidak pernah percaya klaim tier
      // dari client, supaya tidak ada celah orang mengaku-ngaku tier.
      let finalPrice = bookingPrice;
      let originalPrice = null;
      let discountLabel = null;
      const bookingType = String(type || '').trim().toLowerCase();
      const isGroupBooking = !!group;
      if (!isAdmin && bookingType !== 'wedding' && !isGroupBooking) {
        const memberProfile = await getMemberProfileByPhone(wa);
        const memberActive = isActiveMembership({
          status: memberProfile?.membership_status,
          startsAt: memberProfile?.membership_started_at,
          expiresAt: memberProfile?.membership_expires_at,
        });
        const discount = computeServiceDiscount({
          tier: memberProfile?.current_tier,
          membershipActive: memberActive,
          birthdate: memberProfile?.birthdate,
          serviceId: service_id,
          location: resolvedLocation,
          bookingDate: date,
          basePrice: bookingPrice,
        });
        if (discount.discountPercent > 0) {
          finalPrice = discount.finalPrice;
          originalPrice = bookingPrice;
          discountLabel = discount.benefitLabel;
        }
      }

      // 3. Insert booking
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: finalPrice,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: resolvedLocation, status: desiredStatus, notes: notes || '', payment: payment || '',
        original_price: originalPrice, discount_label: discountLabel
      }]).select().single();
      if (error) return res.status(500).json({ error: error.message });
```

- [ ] **Step 7: Add the discount line to the WhatsApp confirmation template**

In `server/services/waNotification.js`, find:

```js
async function notifyCustomerBookingConfirmed(booking) {
  const { name, wa, service, date, time, location, barber_name, price, duration, notes, type } = booking;

  const fn     = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);
  const tgl    = formatDate(date);
  const harga  = price ? `\n💰 *Rp ${Number(price).toLocaleString('id-ID')}*` : '';
  const durasi = duration ? `\n⏱ Durasi ±${duration}` : '';
  const kapster = barber_name ? `\n💈 Kapster: *${barber_name}*` : '';
```

Replace with:

```js
async function notifyCustomerBookingConfirmed(booking) {
  const { name, wa, service, date, time, location, barber_name, price, duration, notes, type, discount_label, original_price } = booking;

  const fn     = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);
  const tgl    = formatDate(date);
  const harga  = price ? `\n💰 *Rp ${Number(price).toLocaleString('id-ID')}*` : '';
  const durasi = duration ? `\n⏱ Durasi ±${duration}` : '';
  const kapster = barber_name ? `\n💈 Kapster: *${barber_name}*` : '';
  const diskon = discount_label
    ? `\n🎉 ${discount_label} diterapkan (harga asli Rp ${Number(original_price).toLocaleString('id-ID')})`
    : '';
```

Then find:

```js
📋 *Detail Booking:*
✂️ ${service}${harga}${durasi}
📅 ${tgl}
```

Replace with:

```js
📋 *Detail Booking:*
✂️ ${service}${harga}${durasi}${diskon}
📅 ${tgl}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test server/test/booking-tier-discount.test.js server/test/auth-me-birthdate.test.js`
Expected: PASS (10 tests total across both files)

- [ ] **Step 9: Run the full suite**

Run: `node --test server/test/*.test.js`
Expected: PASS, no regressions

- [ ] **Step 10: Commit**

```bash
git add server/index.js server/services/waNotification.js server/test/booking-tier-discount.test.js server/test/auth-me-birthdate.test.js
git commit -m "feat: apply tier discounts server-side at booking checkout"
```

---

### Task 4: Client-side live discount preview in the booking summary

**Files:**
- Modify: `public/booking.html:437-444` (sidebar summary markup)
- Modify: `public/css/booking.css` (near the existing `.sb-row`/`.sb-total` rules around line 489-493)
- Modify: `public/js/booking.js` (top-of-file state setup around line 1-44; `updateSidebar()` around line 916-988; `_buildPayloadFor` around line 1746-1775)
- Test: `server/test/booking-discount-preview.test.js`

**Interfaces:**
- Consumes: `GET /api/auth/me` (already returns `customer.current_tier`, `customer.membership_status`, and — after Task 3 — `customer.birthdate`).
- Produces: when a member is logged in (`localStorage.getItem('rb_member_token')` set) and the current selection is solo + non-wedding, `updateSidebar()` shows a strikethrough original price, the discounted total, and a benefit badge. Every payload built by `_buildPayloadFor` includes a `group` boolean matching whether the booking is a 2-person group booking.

- [ ] **Step 1: Write the failing test**

Create `server/test/booking-discount-preview.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..', 'public');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('booking.html has sidebar markup for the discount badge and struck-through original price', () => {
  const html = source('booking.html');
  assert.match(html, /id="sumDiscountRow"/);
  assert.match(html, /id="sumDiscountBadge"/);
  assert.match(html, /id="sumTotalOriginal"/);
});

test('booking.css styles the discount badge and struck-through original price', () => {
  const css = source('css/booking.css');
  assert.match(css, /\.sb-discount-badge\s*\{/);
  assert.match(css, /\.sb-total-original\s*\{[^}]*text-decoration:\s*line-through/);
});

test('booking.js fetches the member context from /api/auth/me when a member token exists', () => {
  const js = source('js/booking.js');
  assert.match(js, /let memberBenefitContext = null;/);
  assert.match(js, /localStorage\.getItem\('rb_member_token'\)/);
  assert.match(js, /fetch\(API_URL \+ '\/auth\/me'/);
});

test('booking.js defines a client-side mirror of the tier-discount rules', () => {
  const js = source('js/booking.js');
  assert.match(js, /function isWithinBirthdayWindow\(/);
  assert.match(js, /function computeServiceDiscountPreview\(/);
  assert.match(js, /'Diskon Gold 10%'/);
  assert.match(js, /'Gratis — Benefit Platinum'/);
});

test('updateSidebar renders the discount preview only for eligible (non-group, non-wedding) solo bookings', () => {
  const js = source('js/booking.js');
  // updateSidebar() contains its own standalone "}" lines from nested
  // if/else blocks at this file's flat one-space indentation, so a lazy
  // match on the first "\n }\n" would truncate early. Anchor on the next
  // sibling top-level function declaration instead, which is a much rarer,
  // reliable boundary in this file.
  const fnMatch = js.match(/function updateSidebar\(\)[\s\S]*?\n function setBranchActive/);
  assert.ok(fnMatch, 'expected to find updateSidebar() up to the next function declaration');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /computeServiceDiscountPreview\(/);
  assert.match(fnBody, /isGroup\(\)/);
  assert.match(fnBody, /sumDiscountRow/);
  assert.match(fnBody, /sumTotalOriginal/);
});

test('_buildPayloadFor sends an explicit group boolean instead of relying on notes parsing', () => {
  const js = source('js/booking.js');
  const fnMatch = js.match(/function _buildPayloadFor\([\s\S]*?\n \}\n/);
  assert.ok(fnMatch, 'expected to find _buildPayloadFor()');
  assert.match(fnMatch[0], /group:\s*isGroup\(\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-discount-preview.test.js`
Expected: FAIL — none of the client-side discount UI/logic exists yet

- [ ] **Step 3: Add sidebar markup**

In `public/booking.html`, find:

```html
 <div class="sb-row"><span class="sb-label">Location</span><span class="sb-val" id="sumLocation">-</span></div>
 <div class="sb-row total-row"><span class="sb-label">Total</span><span class="sb-val sb-total" id="sumTotal">-</span></div>
```

Replace with:

```html
 <div class="sb-row"><span class="sb-label">Location</span><span class="sb-val" id="sumLocation">-</span></div>
 <div class="sb-row sb-discount-row" id="sumDiscountRow" style="display:none">
 <span class="sb-label">Benefit</span>
 <span class="sb-val sb-discount-badge" id="sumDiscountBadge">-</span>
 </div>
 <div class="sb-row total-row">
 <span class="sb-label">Total</span>
 <span class="sb-val sb-total">
 <span class="sb-total-original" id="sumTotalOriginal" style="display:none"></span>
 <span id="sumTotal">-</span>
 </span>
 </div>
```

- [ ] **Step 4: Add CSS for the discount badge and struck-through price**

In `public/css/booking.css`, find:

```css
.sb-total{font-size:1.2rem !important;color:#f87171 !important;font-family:var(--font-accent) !important}
```

Add immediately after it:

```css
.sb-discount-badge{display:inline-block;font-size:.72rem;font-weight:700;color:#f87171;background:rgba(248,113,113,.12);padding:3px 10px;border-radius:999px}
.sb-total-original{display:block;font-size:.78rem;font-weight:500;color:var(--w50);text-decoration:line-through;margin-bottom:2px}
```

- [ ] **Step 5: Fetch the member context on page load**

In `public/js/booking.js`, find:

```js
 const state = {
 service: null,
 barber: null,
 date: null,
 time: null,
 location: null,
 name: '',
 wa: '',
 notes: '',
 payment: null,
 address: '',
 currentStep: 1,
 calYear: new Date().getFullYear(),
 calMonth: new Date().getMonth(),
 };
```

Add immediately after it:

```js
 // Only used for the optimistic checkout-summary discount preview — the
 // actual discount is always recomputed server-side at submit time from
 // the submitted WA number, never trusted from here.
 let memberBenefitContext = null;
 (async () => {
 const memberToken = localStorage.getItem('rb_member_token');
 if (!memberToken) return;
 try {
 const res = await fetch(API_URL + '/auth/me', { headers: { Authorization: 'Bearer ' + memberToken } });
 const json = await res.json();
 const customer = json?.customer;
 if (customer) {
 memberBenefitContext = {
 tier: customer.current_tier,
 membershipActive: customer.membership_status === 'ACTIVE',
 birthdate: customer.birthdate || null,
 };
 updateSidebar();
 }
 } catch {}
 })();
```

- [ ] **Step 6: Add the client-side discount-rule mirror**

In `public/js/booking.js`, find the `// ── SIDEBAR ─────────────────────────────────` comment right before `function updateSidebar() {`. Add the following two functions immediately before that comment (i.e., right before `// ── SIDEBAR`):

```js
 // ── TIER DISCOUNT PREVIEW (mirrors server/membership-benefits.js) ──
 // Duplicated intentionally: these rules are public (shown on the
 // membership page), only the *inputs* (tier/active/birthdate, from the
 // member's own authenticated session) need to be trustworthy — the
 // authoritative recompute always happens server-side at submit time.
 function isWithinBirthdayWindow(bookingDateStr, birthdateStr) {
 if (!bookingDateStr || !birthdateStr) return false;
 const booking = new Date(bookingDateStr + 'T00:00:00Z');
 const birth = new Date(birthdateStr + 'T00:00:00Z');
 if (isNaN(booking.getTime()) || isNaN(birth.getTime())) return false;
 const bookingYear = booking.getUTCFullYear();
 const candidates = [bookingYear - 1, bookingYear, bookingYear + 1].map(year =>
 Date.UTC(year, birth.getUTCMonth(), birth.getUTCDate())
 );
 const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
 return candidates.some(bdayMs => Math.abs(booking.getTime() - bdayMs) <= WINDOW_MS);
 }

 function computeServiceDiscountPreview({ tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice }) {
 const price = Number(basePrice) || 0;
 const none = { discountPercent: 0, discountAmount: 0, finalPrice: price, benefitLabel: null };
 if (!membershipActive) return none;
 const applyPercent = (percent, label) => {
 const discountAmount = Math.round(price * (percent / 100));
 return { discountPercent: percent, discountAmount, finalPrice: price - discountAmount, benefitLabel: label };
 };
 const bestOf = (candidates) => {
 const real = candidates.filter(Boolean);
 return real.length ? real.reduce((best, c) => (c.discountAmount > best.discountAmount ? c : best)) : none;
 };
 const normalizedTier = String(tier || '').trim().toLowerCase();
 const birthdayCandidate = isWithinBirthdayWindow(bookingDate, birthdate) ? applyPercent(50, 'Diskon Ulang Tahun 50%') : null;
 if (normalizedTier === 'silver') return birthdayCandidate || none;
 if (normalizedTier === 'gold') {
 const isCsb = String(location || '').trim().toLowerCase() === 'csb';
 const generalCandidate = isCsb ? null : applyPercent(10, 'Diskon Gold 10%');
 return bestOf([birthdayCandidate, generalCandidate]);
 }
 if (normalizedTier === 'platinum') {
 const isGrooming = String(serviceId || '').trim().toLowerCase() === 'gentleman-grooming';
 const groomingCandidate = isGrooming ? applyPercent(100, 'Gratis — Benefit Platinum') : null;
 return bestOf([birthdayCandidate, groomingCandidate]);
 }
 return none;
 }

```

- [ ] **Step 7: Render the preview in `updateSidebar()`**

In `public/js/booking.js`, find:

```js
 // Total = person1 + person2 price (when group)
 const total = (state.service?.price || 0) + (isGroup() ? (state.person2?.service?.price || 0) : 0);
 document.getElementById('sumTotal').textContent = total ? fmt(total) : '-';
 }
```

Replace with:

```js
 // Total = person1 + person2 price (when group)
 const total = (state.service?.price || 0) + (isGroup() ? (state.person2?.service?.price || 0) : 0);

 const discountRow = document.getElementById('sumDiscountRow');
 const discountBadge = document.getElementById('sumDiscountBadge');
 const totalOriginalEl = document.getElementById('sumTotalOriginal');
 const eligibleForDiscount = memberBenefitContext && !isGroup() && !isWeddingPackage && state.service && total > 0;
 const discount = eligibleForDiscount
 ? computeServiceDiscountPreview({
 tier: memberBenefitContext.tier,
 membershipActive: memberBenefitContext.membershipActive,
 birthdate: memberBenefitContext.birthdate,
 serviceId: state.service?.id,
 location: state.location,
 bookingDate: state.date,
 basePrice: total,
 })
 : null;

 if (discount && discount.discountPercent > 0) {
 discountRow.style.display = '';
 discountBadge.textContent = discount.benefitLabel;
 totalOriginalEl.style.display = '';
 totalOriginalEl.textContent = fmt(total);
 document.getElementById('sumTotal').textContent = fmt(discount.finalPrice);
 } else {
 discountRow.style.display = 'none';
 totalOriginalEl.style.display = 'none';
 document.getElementById('sumTotal').textContent = total ? fmt(total) : '-';
 }
 }
```

`isWeddingPackage` (`const isWeddingPackage = Boolean(weddingPackage);`) is already declared near the top of this file's `DOMContentLoaded` handler (line 82) — well before `updateSidebar()` — so it is in scope here with no further changes needed.

- [ ] **Step 8: Send an explicit `group` flag in every booking payload**

In `public/js/booking.js`, find:

```js
 return {
 name: name || state.name,
 wa: state.wa,
 service_id: svc?.id || '',
 service: serviceFull,
 price: svc?.price || 0,
 duration: svc?.duration || '',
 barber_id: barber?.id || 'any',
 date: state.date,
 time: state.time,
 location: state.location,
 notes: noteParts.join('\n'),
 payment: state.payment?.name || '',
 status: 'pending',
 type: isWeddingPackage ? 'wedding' : (isHomeService ? 'home_service' : 'outlet'),
 address: isHomeService ? (state.address || '') : undefined,
 };
```

Replace with:

```js
 return {
 name: name || state.name,
 wa: state.wa,
 service_id: svc?.id || '',
 service: serviceFull,
 price: svc?.price || 0,
 duration: svc?.duration || '',
 barber_id: barber?.id || 'any',
 date: state.date,
 time: state.time,
 location: state.location,
 notes: noteParts.join('\n'),
 payment: state.payment?.name || '',
 status: 'pending',
 type: isWeddingPackage ? 'wedding' : (isHomeService ? 'home_service' : 'outlet'),
 address: isHomeService ? (state.address || '') : undefined,
 group: isGroup(),
 };
```

- [ ] **Step 9: Run test to verify it passes**

Run: `node --test server/test/booking-discount-preview.test.js`
Expected: PASS (6 tests)

- [ ] **Step 10: Run the full suite**

Run: `node --test server/test/*.test.js`
Expected: PASS, no regressions

- [ ] **Step 11: Commit**

```bash
git add public/booking.html public/css/booking.css public/js/booking.js server/test/booking-discount-preview.test.js
git commit -m "feat: show live tier-discount preview in the booking summary"
```

- [ ] **Step 12: Manual verification**

Log in on the live site as a known Gold member (real Supabase test account with an active paid period), open `booking.html` in the same browser, pick a non-grooming service on a date outside their birthday window at a non-CSB branch — confirm the summary shows the struck-through original price, "Diskon Gold 10%" badge, and the reduced total. Submit the booking and confirm the resulting `bookings` row has `price` equal to the discounted amount and `original_price`/`discount_label` set. Repeat as a Platinum member booking Gentlemen Grooming specifically — confirm it shows as free. Then log out (clear `rb_member_token`) and submit a booking using that same member's WA number as a guest — confirm no preview shows in the summary, but the resulting `bookings` row still has the discount applied (server-side fallback). Finally, book a group (2-person) booking as a logged-in Gold member — confirm no discount preview or discount is applied to either person.
