# Real Member Visit/Points History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist real per-transaction Moka visit/point rows during the member-login sync instead of only aggregating counts, so Riwayat Kunjungan/Riwayat Poin show a member's actual visit history instead of a single synthesized summary row.

**Architecture:** `POST /api/member/sync` already pulls a member's entire matching Moka transaction history on every login via `MokaClient.getTransactionPage()`, but only sums it into aggregate counters. A new `member_visit_history` table captures each matched transaction (keyed by `receipt_number`, Moka's natural unique ID), written idempotently on every sync. `member_point_transactions` moves from one lump "delta" row per sync to one real row per matched transaction. `GET /api/member/history` merges `member_visit_history` into its existing `bookings` response alongside the untouched online-booking and aggregate-fallback logic.

**Tech Stack:** Node.js/Express (`server/index.js`), Supabase (Postgres), `node:test` for content/contract tests (this repo's established convention — no integration test harness exists for these routes).

## Global Constraints

- `receipt_number` is the idempotency key for both new tables/rows — a transaction cannot recur with the same receipt (existing precedent: `server/moka/txSync.js`'s `onConflict: 'receipt_number'` usage on `moka_transactions`).
- `member_point_transactions` has no unique constraint to upsert against — dedup must be a **single batched query** (`notes LIKE 'moka-visit:%'`) before the insert loop, never one lookup per matched payment.
- `POINTS_PER_VISIT` stays 50 (the existing constant in this route) — do not introduce a second points-per-visit value.
- Only `POST /api/member/sync` gains detail-row writing. The bulk cron job (`server/moka/routes.js`) and the Google/email Supabase-direct sync path (`js/dashboard.js`) are explicitly out of scope — do not modify them.
- No historical backfill script. The existing sync loop already re-walks a member's full matching transaction history on every login (not incremental), so the first login after this ships is the backfill.
- New tables follow this codebase's RLS convention exactly (see `server/migrations/2026-08-08-paid-membership-registration.sql`): `ENABLE ROW LEVEL SECURITY`, then `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated`/`service_role`, then `GRANT` only what the Express server's `service_role` key needs.
- Do not remove or alter the existing single-row aggregate-fallback logic in `/api/member/history` or `js/dashboard.js`'s `renderMemberHistoryFallback` — it must keep working for the window of history that predates a member's first sync under this change.

---

### Task 1: `member_visit_history` table migration

**Files:**
- Create: `server/migrations/2026-08-09-member-visit-history.sql`
- Test: `server/test/member-visit-history-migration.test.js`

**Interfaces:**
- Produces: a `member_visit_history` table with columns `id uuid PK`, `user_key text NOT NULL`, `receipt_number text NOT NULL UNIQUE`, `outlet_slug text`, `visit_date date NOT NULL`, `visit_time text`, `service_summary text`, `amount integer NOT NULL DEFAULT 0`, `points_earned integer NOT NULL DEFAULT 0`, `created_at timestamptz NOT NULL DEFAULT now()`, plus an index on `(user_key, visit_date DESC)`. Task 2 upserts into this table by `receipt_number`; Task 3 selects from it by `user_key`.

**This task creates the migration FILE only.** Applying it to the live Supabase project is a separate, explicit step the controller performs directly (via the Supabase MCP `apply_migration` tool) after reviewing the file and before starting Task 2 — schema changes to production are not something an implementer subagent applies autonomously.

- [ ] **Step 1: Write the failing test**

Create `server/test/member-visit-history-migration.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-08-09-member-visit-history.sql');

test('member_visit_history migration defines the expected table shape', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS (?:public\.)?member_visit_history/i);
  assert.match(sql, /user_key\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /receipt_number\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  assert.match(sql, /outlet_slug\s+TEXT/i);
  assert.match(sql, /visit_date\s+DATE\s+NOT NULL/i);
  assert.match(sql, /visit_time\s+TEXT/i);
  assert.match(sql, /service_summary\s+TEXT/i);
  assert.match(sql, /amount\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i);
  assert.match(sql, /points_earned\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i);
  assert.match(sql, /CREATE INDEX.*member_visit_history.*user_key.*visit_date/is);
});

test('member_visit_history migration follows the codebase RLS convention', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE (?:public\.)?member_visit_history ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM PUBLIC/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM anon/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE (?:public\.)?member_visit_history FROM authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE (?:public\.)?member_visit_history TO service_role/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/member-visit-history-migration.test.js`
Expected: FAIL — `server/migrations/2026-08-09-member-visit-history.sql` does not exist (ENOENT)

- [ ] **Step 3: Write the migration**

Create `server/migrations/2026-08-09-member-visit-history.sql`:

```sql
-- Real per-transaction member visit history, populated from Moka data
-- POST /api/member/sync already pulls and previously discarded after
-- aggregating into total_visits/total_points.

CREATE TABLE IF NOT EXISTS public.member_visit_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key        TEXT NOT NULL,
  receipt_number  TEXT NOT NULL UNIQUE,
  outlet_slug     TEXT,
  visit_date      DATE NOT NULL,
  visit_time      TEXT,
  service_summary TEXT,
  amount          INTEGER NOT NULL DEFAULT 0,
  points_earned   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_visit_history_user_key_visit_date_idx
  ON public.member_visit_history (user_key, visit_date DESC);

-- This workflow is server-to-server only: every caller reaches this table
-- through the Express backend client configured with SUPABASE_SERVICE_KEY
-- (the database service_role), never from a browser key. Same pattern as
-- server/migrations/2026-08-08-paid-membership-registration.sql.
ALTER TABLE public.member_visit_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM service_role;
GRANT SELECT, INSERT ON TABLE public.member_visit_history TO service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/member-visit-history-migration.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/migrations/2026-08-09-member-visit-history.sql server/test/member-visit-history-migration.test.js
git commit -m "feat: add member_visit_history table migration"
```

- [ ] **Step 6: Controller applies the migration to Supabase**

Not part of the implementer's task — the controller runs this after Step 5's review, before Task 2 begins:

```
mcp__claude_ai_Supabase__apply_migration(
  project_id: "khcvklzxfohwkyocenaf",
  name: "member_visit_history",
  query: <contents of server/migrations/2026-08-09-member-visit-history.sql>
)
```

Then verify with `mcp__claude_ai_Supabase__execute_sql`: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'member_visit_history' ORDER BY ordinal_position;` — confirm all 9 columns are present.

---

### Task 2: `POST /api/member/sync` persists real visit/point rows

**Files:**
- Modify: `server/index.js:2988-3163` (the `POST /api/member/sync` route)
- Test: `server/test/member-sync-visit-history.test.js`

**Interfaces:**
- Consumes: `member_visit_history` table from Task 1 (must already be applied to Supabase before this task's manual verification step, though its automated tests only assert source-code shape and don't require a live DB).
- Produces: `persistVisitHistory(userKey, matchedPayments)` — an async function writing to `member_visit_history` and `member_point_transactions`, called from both the `existing`/upsert branches of the sync route in place of the removed `recordPointLedgerDelta`.

- [ ] **Step 1: Write the failing test**

Create `server/test/member-sync-visit-history.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const syncRouteMatch = server.match(/app\.post\('\/api\/member\/sync'[\s\S]*?\n  \}\);/);

test('the /api/member/sync route exists and was located for the other assertions', () => {
  assert.ok(syncRouteMatch, 'expected to find the POST /api/member/sync route handler');
});

test('matched payments are collected into an array during the transaction loop', () => {
  const routeBody = syncRouteMatch[0];
  assert.match(routeBody, /const matchedPayments = \[\];/);
  assert.match(routeBody, /matchedPayments\.push\(\{/);
  assert.match(routeBody, /receiptNumber:\s*String\(receiptNumber\)/);
});

test('persistVisitHistory upserts member_visit_history keyed by receipt_number', () => {
  const routeBody = syncRouteMatch[0];
  assert.match(routeBody, /const persistVisitHistory = async \(userKey, payments\) => \{/);
  assert.match(routeBody, /\.from\('member_visit_history'\)\s*\n\s*\.upsert\(visitRows, \{ onConflict: 'receipt_number', ignoreDuplicates: true \}\)/);
});

test('persistVisitHistory dedupes member_point_transactions with one batched query, not one per payment', () => {
  const routeBody = syncRouteMatch[0];
  const fnMatch = routeBody.match(/const persistVisitHistory = async[\s\S]*?\n\s{4}\};/);
  assert.ok(fnMatch, 'expected to find the persistVisitHistory function body');
  const fnBody = fnMatch[0];
  assert.match(fnBody, /\.select\('notes'\)/);
  assert.match(fnBody, /\.like\('notes', 'moka-visit:%'\)/);
  assert.match(fnBody, /new Set\(/);
  assert.match(fnBody, /notes: `moka-visit:\$\{p\.receiptNumber\}`/);
  // Only one .from('member_point_transactions') call inside persistVisitHistory — the
  // lookup and the insert share the same batched-query discipline, no per-row loop calling Supabase.
  const supabaseCalls = (fnBody.match(/\.from\('member_point_transactions'\)/g) || []).length;
  assert.equal(supabaseCalls, 2, `expected exactly 2 member_point_transactions calls (lookup + insert), found ${supabaseCalls}`);
});

test('the old recordPointLedgerDelta lump-sum ledger writer is gone', () => {
  const routeBody = syncRouteMatch[0];
  assert.doesNotMatch(routeBody, /recordPointLedgerDelta/);
  assert.doesNotMatch(routeBody, /Sinkronisasi poin Moka/);
});

test('both existing/new-profile branches call persistVisitHistory with the resolved userKey', () => {
  const routeBody = syncRouteMatch[0];
  const calls = routeBody.match(/await persistVisitHistory\([^)]+\)/g) || [];
  assert.equal(calls.length, 2, `expected 2 call sites (existing profile + new profile), found ${calls.length}`);
  assert.ok(calls.some(c => c.includes('existing.user_key')), 'expected the existing-profile branch to pass existing.user_key');
  assert.ok(calls.some(c => c.includes('userKey') && !c.includes('existing.user_key')), 'expected the new-profile branch to pass the freshly derived userKey');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/member-sync-visit-history.test.js`
Expected: FAIL — none of `matchedPayments`/`persistVisitHistory` exist yet; `recordPointLedgerDelta` is still present.

- [ ] **Step 3: Collect matched payments during the transaction loop**

In `server/index.js`, find:

```js
    let totalVisits = 0, totalSpent = 0, lastVisit = null, firstVisit = null;
    const startTime = Date.now();
```

Replace with:

```js
    let totalVisits = 0, totalSpent = 0, lastVisit = null, firstVisit = null;
    const matchedPayments = [];
    const startTime = Date.now();
```

Then find this block inside the `for (const p of payments)` loop:

```js
          for (const p of payments) {
            if (p.is_deleted || p.is_refunded) continue;
            const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
            if (norm !== targetNorm) continue;
            totalVisits++;
            totalSpent += Number(p.total_collected || p.total_transaction || 0);
            const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
            if (txDate && (!lastVisit  || txDate > lastVisit))  lastVisit  = txDate;
            if (txDate && (!firstVisit || txDate < firstVisit)) firstVisit = txDate;
          }
```

Replace with:

```js
          for (const p of payments) {
            if (p.is_deleted || p.is_refunded) continue;
            const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
            if (norm !== targetNorm) continue;
            totalVisits++;
            const amount = Number(p.total_collected || p.total_transaction || 0);
            totalSpent += amount;
            const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
            const txTime = (p.created_at || p.updated_at || '').slice(11, 19) || null;
            if (txDate && (!lastVisit  || txDate > lastVisit))  lastVisit  = txDate;
            if (txDate && (!firstVisit || txDate < firstVisit)) firstVisit = txDate;
            const receiptNumber = p.receipt_number || p.receipt_no || p.id;
            if (receiptNumber && txDate) {
              // service_summary is best-effort: this endpoint (v3 report API)
              // doesn't have a confirmed line-item field name the way
              // server/moka/txSync.js's different endpoint does. Falls back
              // to null rather than guessing wrong.
              const rawItems = p.item_details || p.items || p.order_items || p.line_items || '';
              const serviceSummary = Array.isArray(rawItems)
                ? (rawItems.map(i => i.name || i.item_name || i.service || '').filter(Boolean).join(', ') || null)
                : (typeof rawItems === 'string' && rawItems ? rawItems : null);
              matchedPayments.push({
                receiptNumber: String(receiptNumber),
                outletSlug: outlet.slug,
                visitDate: txDate,
                visitTime: txTime,
                serviceSummary,
                amount,
              });
            }
          }
```

- [ ] **Step 4: Replace `recordPointLedgerDelta` with `persistVisitHistory`**

Find:

```js
      const recordPointLedgerDelta = async (userKey, previousPoints, nextPoints) => {
        const delta = Math.max(0, Number(nextPoints || 0) - Number(previousPoints || 0));
        if (!userKey || delta <= 0) return;
        const marker = `moka-sync:${syncedFirstVisit || 'unknown'}:${syncedVisits}:${nextPoints}`;
        const { data: existingLedger, error: ledgerLookupError } = await supabase
          .from('member_point_transactions')
          .select('id')
          .eq('user_key', userKey)
          .eq('notes', marker)
          .limit(1);
        if (ledgerLookupError) {
          console.warn('[Member Sync] point ledger lookup skipped:', ledgerLookupError.message);
          return;
        }
        if (existingLedger?.length) return;
        const { error: ledgerError } = await supabase.from('member_point_transactions').insert({
          user_key: userKey,
          activity: 'Sinkronisasi poin Moka',
          points: delta,
          notes: marker,
        });
        if (ledgerError) console.warn('[Member Sync] point ledger write skipped:', ledgerError.message);
      };
```

Replace with:

```js
      const persistVisitHistory = async (userKey, payments) => {
        if (!userKey || !payments.length) return;

        const visitRows = payments.map(p => ({
          user_key: userKey,
          receipt_number: p.receiptNumber,
          outlet_slug: p.outletSlug,
          visit_date: p.visitDate,
          visit_time: p.visitTime,
          service_summary: p.serviceSummary,
          amount: p.amount,
          points_earned: POINTS_PER_VISIT,
        }));
        const { error: visitError } = await supabase.from('member_visit_history')
          .upsert(visitRows, { onConflict: 'receipt_number', ignoreDuplicates: true });
        if (visitError) console.warn('[Member Sync] visit history write skipped:', visitError.message);

        const { data: existingLedger, error: ledgerLookupError } = await supabase
          .from('member_point_transactions')
          .select('notes')
          .eq('user_key', userKey)
          .like('notes', 'moka-visit:%');
        if (ledgerLookupError) {
          console.warn('[Member Sync] point ledger lookup skipped:', ledgerLookupError.message);
          return;
        }
        const knownReceipts = new Set((existingLedger || []).map(row => row.notes));
        const newLedgerRows = payments
          .filter(p => !knownReceipts.has(`moka-visit:${p.receiptNumber}`))
          .map(p => ({
            user_key: userKey,
            activity: 'Kunjungan Moka',
            points: POINTS_PER_VISIT,
            notes: `moka-visit:${p.receiptNumber}`,
          }));
        if (!newLedgerRows.length) return;
        const { error: ledgerError } = await supabase.from('member_point_transactions').insert(newLedgerRows);
        if (ledgerError) console.warn('[Member Sync] point ledger write skipped:', ledgerError.message);
      };
```

- [ ] **Step 5: Update both call sites**

Find:

```js
        if (profErr) throw new Error(`member_profiles update failed: ${profErr.message}`);
        await recordPointLedgerDelta(existing.user_key, existing.total_points, nextPoints);
```

Replace with:

```js
        if (profErr) throw new Error(`member_profiles update failed: ${profErr.message}`);
        await persistVisitHistory(existing.user_key, matchedPayments);
```

Find:

```js
        if (upsertErr) throw new Error(`member_profiles upsert failed: ${upsertErr.message}`);
        await recordPointLedgerDelta(userKey, 0, syncedPoints);
```

Replace with:

```js
        if (upsertErr) throw new Error(`member_profiles upsert failed: ${upsertErr.message}`);
        await persistVisitHistory(userKey, matchedPayments);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/member-sync-visit-history.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Run the full suite**

Run: `node --test server/test/*.test.js`
Expected: PASS, no regressions (verify the count is the prior total + 8: 2 from Task 1 + 6 from this task)

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/test/member-sync-visit-history.test.js
git commit -m "feat: persist real per-transaction visit/point rows during member sync"
```

---

### Task 3: `GET /api/member/history` merges real visit rows into the response

**Files:**
- Modify: `server/index.js:2912-2985` (the `GET /api/member/history` route)
- Test: `server/test/member-history-visit-merge.test.js`

**Interfaces:**
- Consumes: `member_visit_history` table (Task 1), populated by `persistVisitHistory` (Task 2).
- Produces: the route's JSON response's `bookings` array now includes mapped `member_visit_history` rows alongside `bookings` table rows, sorted by date/time descending, capped at 100 total. Shape: `{ id, date, time, status: 'done', service, price, location }` — matches what `js/dashboard.js`'s `renderBookingsHistory` already expects (it does not read `name`/`wa`, so those are omitted here).

- [ ] **Step 1: Write the failing test**

Create `server/test/member-history-visit-merge.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const historyRouteMatch = server.match(/app\.get\('\/api\/member\/history'[\s\S]*?\n  \}\);/);

test('the /api/member/history route exists and was located for the other assertions', () => {
  assert.ok(historyRouteMatch, 'expected to find the GET /api/member/history route handler');
});

test('the route queries member_visit_history by the resolved profile user_key', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /\.from\('member_visit_history'\)/);
  assert.match(routeBody, /\.eq\('user_key', profile\.user_key\)/);
  assert.match(routeBody, /\.order\('visit_date', \{ ascending: false \}\)/);
});

test('mapped visit-history rows use the shape renderBookingsHistory already expects', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /status:\s*'done'/);
  assert.match(routeBody, /service:\s*row\.service_summary \|\| 'Kunjungan Moka'/);
  assert.match(routeBody, /price:\s*Number\(row\.amount\)\s*\|\|\s*0/);
  assert.match(routeBody, /location:\s*row\.outlet_slug \|\| 'RedBox Barbershop'/);
});

test('the merged bookings array is sorted by date/time descending and capped at 100', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /\.sort\(\(a, b\) => \{/);
  assert.match(routeBody, /\.slice\(0,\s*100\)/);
});

test('the existing aggregate-fallback synthesis is untouched', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /Legacy Moka visits are stored as aggregates/);
  assert.match(routeBody, /Kunjungan dari Moka/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/member-history-visit-merge.test.js`
Expected: FAIL — no `member_visit_history` query exists yet in this route.

- [ ] **Step 3: Query and merge visit history**

Find:

```js
    let pointRows = [];
    if (profile?.user_key) {
      const { data, error } = await supabase.from('member_point_transactions')
        .select('id,user_key,activity,points,notes,created_at')
        .eq('user_key', profile.user_key)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: `Riwayat poin gagal dimuat: ${error.message}` });
      pointRows = data || [];
    }

    const customer = await getMergedMemberCustomer(session.customer_wa);
    let historyBookings = bookings || [];
```

Replace with:

```js
    let pointRows = [];
    if (profile?.user_key) {
      const { data, error } = await supabase.from('member_point_transactions')
        .select('id,user_key,activity,points,notes,created_at')
        .eq('user_key', profile.user_key)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: `Riwayat poin gagal dimuat: ${error.message}` });
      pointRows = data || [];
    }

    let visitHistoryRows = [];
    if (profile?.user_key) {
      const { data, error } = await supabase.from('member_visit_history')
        .select('id,receipt_number,outlet_slug,visit_date,visit_time,service_summary,amount,created_at')
        .eq('user_key', profile.user_key)
        .order('visit_date', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: `Riwayat kunjungan gagal dimuat: ${error.message}` });
      visitHistoryRows = data || [];
    }
    const mappedVisitHistory = visitHistoryRows.map(row => ({
      id: `moka-visit-${row.receipt_number}`,
      date: row.visit_date,
      time: row.visit_time,
      status: 'done',
      service: row.service_summary || 'Kunjungan Moka',
      price: Number(row.amount) || 0,
      location: row.outlet_slug || 'RedBox Barbershop',
    }));

    const customer = await getMergedMemberCustomer(session.customer_wa);
    let historyBookings = [...(bookings || []), ...mappedVisitHistory]
      .sort((a, b) => {
        const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
        return dateCompare !== 0 ? dateCompare : String(b.time || '').localeCompare(String(a.time || ''));
      })
      .slice(0, 100);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/member-history-visit-merge.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite**

Run: `node --test server/test/*.test.js`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/test/member-history-visit-merge.test.js
git commit -m "feat: merge real visit history into GET /api/member/history"
```

- [ ] **Step 7: Manual verification**

Log in on the live site as a member with known Moka transaction history (an OTP-login account). Open DevTools → Network, confirm `/api/member/sync` returns `success: true`. Open Riwayat Kunjungan — confirm individual real visits appear (not the single "Kunjungan tercatat dari RedBox" aggregate row), each with a real date. Refresh/log in again — confirm the same visits appear without duplicates (check row count in Supabase: `SELECT COUNT(*) FROM member_visit_history WHERE user_key = '<their user_key>'` should not grow on a second sync of the same history).
