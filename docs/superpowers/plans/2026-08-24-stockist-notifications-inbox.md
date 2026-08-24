# Stockist Notifications Inbox (Plan 4 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the RedBox Stockist app a real, persisted in-app notification inbox (the mockup's "Notifikasi" screen — category filters, read/unread state) instead of today's fire-and-forget push notifications that leave no record a user can browse later. Per the user's explicit choice: build the backend properly (new table + API), not a derived-from-existing-data shortcut.

**Architecture:** A new Supabase table (`stockist_notifications`) stores one row per notification per recipient. The existing push-notification service (`server/services/stockistNotifications.js`) already computes exactly the right `{ title, body, url }` payload and recipient user-id list for every event that matters (stock requests, transfers, returns, opname, low stock) — this plan makes it *also* persist a row alongside every push it already sends, by extending the one shared `notifyUsers` helper all 9 existing notify functions funnel through, plus adds one genuinely new trigger (`notifyTransferCreated`, sent to a branch when a transfer is dispatched to them — the mockup's flagship notification example, "kiriman baru menunggu konfirmasi", which no existing code path currently fires). New Express routes expose list/mark-read; new Next.js proxy routes follow the codebase's existing thin-proxy pattern exactly; a new frontend page and a header unread-indicator consume them.

**Tech Stack:** PostgreSQL/Supabase migration, Express (`server/routes/stockist.js`, `server/services/stockistNotifications.js`), Next.js Route Handlers (`frontend/src/app/api/stockist/notifications/*`), React/TypeScript (`frontend/src/lib/stockistApi.ts`, `frontend/src/app/admin/stockist/notifications/page.tsx`).

**Spec:** The Claude Design mockup's `isNotif` screen (category chips: Semua/Stok/Transfer/Pengiriman/Sistem/Pengumuman; unread rows visually distinct; sample `NOTIFS` data read earlier this session) plus the existing `server/services/stockistNotifications.js` (every current trigger point and its exact payload shape) and `server/routes/stockist.js` (existing route/access-control conventions, `requireAccess`/`adminAuth` pattern).

## Global Constraints

- This plan DOES touch the database (new table, new migration) and the Express backend — unlike the pure-frontend plans before it, this is the explicit point of this plan, confirmed by the user choosing "backend penuh" over a derived-from-existing-data shortcut.
- No change to any EXISTING table, column, or API contract — this is additive only (one new table, new endpoints; zero modifications to `stock_alert_state`, `users`, or any existing stockist route's request/response shape).
- No change to auth/session/role logic — every new endpoint uses the exact same `requireStockistSession`/`authorizeStockistAdmin`/`adminAuth`/`requireAccess` chain every existing stockist endpoint already uses, scoped to `access.staffId` for the recipient.
- Every existing push-notification call site keeps sending its push exactly as today — this plan is purely additive (persist alongside, never replace or suppress a push).
- No fabricated data — every persisted notification traces to a real triggering event (an actual stock request, transfer, return, opname, or low-stock dip). The mockup's "Pengumuman" (announcement) category has no real trigger in this codebase and gets NO synthetic notification generator in this plan — it stays a valid category value (for a possible future manual/broadcast feature) but nothing in this plan writes rows with it.
- No frontend test framework — verification is `npx tsc --noEmit` / `npm run lint` / `npm run build` / manual `curl`/`psql`-style checks where applicable, matching prior plans in this sequence.

---

### Task 1: Database migration — `stockist_notifications` table

**Files:**
- Create: `server/migrations/2026-08-24-stockist-notifications-inbox.sql`

**Interfaces:**
- Produces: table `stockist_notifications(id, user_id, category, title, body, url, is_read, created_at)`, an index on `(user_id, created_at DESC)` for the list query, RLS enabled with all client access revoked (server-only access via the service-role key, matching `stock_alert_state`'s existing security posture from `server/migrations/2026-08-17-stockist-notifications.sql`).

- [ ] **Step 1: Write the migration**

```sql
-- server/migrations/2026-08-24-stockist-notifications-inbox.sql
-- Persisted in-app notification inbox — one row per notification per
-- recipient, written alongside the existing push-notification sends in
-- server/services/stockistNotifications.js so users can browse history,
-- not just receive a transient push. Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS stockist_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('Stok', 'Transfer', 'Pengiriman', 'Sistem', 'Pengumuman')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stockist_notifications_user_created
  ON stockist_notifications (user_id, created_at DESC);

ALTER TABLE stockist_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stockist_notifications FROM anon, authenticated;

COMMIT;
```

- [ ] **Step 2: Apply the migration and verify**

Run the project's existing migration-apply mechanism (check `server/` for a migration runner script/README first — do not guess; if one exists, e.g. `npm run migrate` or a `psql -f` convention already used for the sibling `2026-08-17-stockist-notifications.sql`/other recent migrations in this repo, use that exact same mechanism). Verify with a read-only query afterward: confirm `stockist_notifications` exists with the expected columns (e.g. `\d stockist_notifications` in `psql`, or the equivalent via whatever DB access this environment provides — Supabase MCP tools if available, otherwise document that the migration file is ready but not yet applied if there's no way to apply it from this environment, and flag this clearly rather than silently skipping).

- [ ] **Step 3: Commit**

```bash
git add server/migrations/2026-08-24-stockist-notifications-inbox.sql
git commit -m "$(cat <<'EOF'
feat(stockist): add stockist_notifications table for the in-app inbox

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Persist a notification row alongside every existing push send, plus a new transfer-created trigger

**Files:**
- Modify: `server/services/stockistNotifications.js` (full file)

**Interfaces:**
- Consumes: the new `stockist_notifications` table (Task 1).
- Produces: `notifyUsers(supabase, userIds, payload, category)` gains a required 4th parameter `category`. Every existing exported function's call to `notifyUsers` is updated to pass one of `'Stok' | 'Transfer' | 'Pengiriman' | 'Sistem'`. A new exported function `notifyTransferCreated(supabase, { transfer, destinationBranchSlug })` is added, following the exact same shape as the other transfer/shipment notifiers.

- [ ] **Step 1: Replace the full file**

```js
// server/services/stockistNotifications.js
'use strict';

const { sendPushToUser } = require('./webPush');

// A product stays under the same low-stock alert for at most this long
// before it's allowed to re-notify — prevents spamming on every movement
// while a branch just hasn't acted on the first alert yet.
const LOW_STOCK_COOLDOWN_MS = 12 * 60 * 60 * 1000;

async function findOwnerUserIds(supabase) {
  const { data } = await supabase.from('users').select('id').eq('role', 'owner');
  return (data || []).map((u) => u.id);
}

async function findBranchAdminUserIds(supabase, branchSlug) {
  const { data } = await supabase.from('users').select('id').eq('role', 'branch_admin').eq('branch', branchSlug);
  return (data || []).map((u) => u.id);
}

// Persists one inbox row per recipient alongside the push send below. Never
// allowed to break the caller — a failure here is logged and swallowed,
// same best-effort posture as the push send itself.
async function recordNotifications(supabase, userIds, category, { title, body, url }) {
  if (!userIds.length) return;
  const rows = userIds.map((userId) => ({ user_id: userId, category, title, body, url: url || null }));
  const { error } = await supabase.from('stockist_notifications').insert(rows);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[stockistNotifications] failed to persist notification row(s):', error.message);
  }
}

// Push failures must never take down the caller's main transaction — each
// send is best-effort and independently swallowed. Persisting to the inbox
// is likewise best-effort and never throws back to the caller.
async function notifyUsers(supabase, userIds, payload, category) {
  await Promise.allSettled(userIds.map((id) => sendPushToUser(supabase, id, payload)));
  await recordNotifications(supabase, userIds, category, payload);
}

async function notifyStockRequestSubmitted(supabase, { request, branchName, itemCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Permintaan Stok Baru',
    body: `${branchName} mengajukan ${itemCount} produk untuk direstock.`,
    url: `/admin/stockist/requests/${request.id}`,
  }, 'Stok');
}

async function notifyStockRequestReviewed(supabase, { request }) {
  const isRejected = request.status === 'REJECTED';
  const isFull = request.status === 'APPROVED';
  await notifyUsers(supabase, [request.requested_by], {
    title: isRejected ? 'Permintaan Stok Ditolak' : 'Permintaan Stok Disetujui',
    body: isRejected
      ? `Permintaan ${request.request_number} ditolak: ${request.rejection_reason}`
      : `Permintaan ${request.request_number} ${isFull ? 'disetujui penuh' : 'disetujui sebagian'}.`,
    url: `/admin/stockist/requests/${request.id}`,
  }, 'Stok');
}

async function notifyStockRequestFulfilled(supabase, { request }) {
  await notifyUsers(supabase, [request.requested_by], {
    title: 'Barang Sedang Dikirim',
    body: `Permintaan ${request.request_number} sedang dikirim dari Gudang Pusat.`,
    url: `/admin/stockist/transfers/${request.fulfilling_transfer_id}`,
  }, 'Transfer');
}

// NEW: fired when a transfer is created and dispatched to a branch — the
// mockup's own flagship notification example ("kiriman baru menunggu
// konfirmasi") had no corresponding trigger anywhere in this codebase
// before this task.
async function notifyTransferCreated(supabase, { transfer, destinationBranchSlug }) {
  const branchAdminIds = await findBranchAdminUserIds(supabase, destinationBranchSlug);
  await notifyUsers(supabase, branchAdminIds, {
    title: 'Kiriman Baru Menunggu Konfirmasi',
    body: `${transfer.transfer_number} sedang dikirim dari Gudang Pusat.`,
    url: `/admin/stockist/transfers/${transfer.id}`,
  }, 'Transfer');
}

async function notifyTransferDiscrepancy(supabase, { transfer }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Selisih Penerimaan Barang',
    body: `Transfer ${transfer.transfer_number} diterima dengan selisih jumlah.`,
    url: `/admin/stockist/transfers/${transfer.id}`,
  }, 'Pengiriman');
}

async function notifyStockOpnameSubmitted(supabase, { opname, locationName, discrepancyCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Stock Opname Menunggu Persetujuan',
    body: discrepancyCount > 0
      ? `${locationName} — ${opname.opname_number} punya ${discrepancyCount} produk dengan selisih.`
      : `${locationName} — ${opname.opname_number} siap disetujui, tidak ada selisih.`,
    url: `/admin/stockist/stock-opname/${opname.id}`,
  }, 'Sistem');
}

async function notifyStockOpnameApproved(supabase, { opname }) {
  await notifyUsers(supabase, [opname.created_by], {
    title: 'Stock Opname Disetujui',
    body: `${opname.opname_number} telah disetujui dan stok telah disesuaikan.`,
    url: `/admin/stockist/stock-opname/${opname.id}`,
  }, 'Sistem');
}

async function notifyStockReturnSubmitted(supabase, { stockReturn, branchName, itemCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Retur Barang Baru',
    body: `${branchName} mengajukan retur ${itemCount} produk.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  }, 'Stok');
}

async function notifyStockReturnReviewed(supabase, { stockReturn }) {
  const isRejected = stockReturn.status === 'REJECTED';
  await notifyUsers(supabase, [stockReturn.requested_by], {
    title: isRejected ? 'Retur Ditolak' : 'Retur Disetujui',
    body: isRejected
      ? `Retur ${stockReturn.return_number} ditolak: ${stockReturn.rejection_reason}`
      : `Retur ${stockReturn.return_number} disetujui, siap dikirim ke gudang.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  }, 'Stok');
}

async function notifyStockReturnReceived(supabase, { stockReturn }) {
  await notifyUsers(supabase, [stockReturn.requested_by], {
    title: 'Retur Diterima Gudang',
    body: `Retur ${stockReturn.return_number} telah diterima dan diproses gudang.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  }, 'Pengiriman');
}

// Called after any movement that can reduce a branch's balance. Decides
// whether this particular dip deserves a fresh push, using stock_alert_state
// as the anti-spam ledger: always notify on a NORMAL->LOW transition, and
// re-notify on a LOW->LOW transition only once the cooldown has elapsed.
async function checkAndNotifyLowStock(supabase, {
  productId, locationId, branchSlug, productName, newQuantity, minimumStock,
}) {
  const { data: stateRows } = await supabase.from('stock_alert_state').select('*').eq('product_id', productId).eq('location_id', locationId);
  const state = (stateRows || [])[0] || null;

  if (newQuantity > minimumStock) {
    if (state && state.last_status !== 'NORMAL') {
      await supabase.from('stock_alert_state').upsert({ product_id: productId, location_id: locationId, last_status: 'NORMAL', last_alerted_at: null });
    }
    return;
  }

  const wasNormal = !state || state.last_status === 'NORMAL';
  const cooldownElapsed = !state?.last_alerted_at || (Date.now() - new Date(state.last_alerted_at).getTime()) > LOW_STOCK_COOLDOWN_MS;
  if (!wasNormal && !cooldownElapsed) return;

  await supabase.from('stock_alert_state').upsert({
    product_id: productId, location_id: locationId, last_status: 'LOW', last_alerted_at: new Date().toISOString(),
  });

  const branchAdminIds = await findBranchAdminUserIds(supabase, branchSlug);
  await notifyUsers(supabase, branchAdminIds, {
    title: 'Stok Menipis',
    body: `${productName} tersisa ${newQuantity} — di bawah batas minimum ${minimumStock}.`,
    url: '/admin/stockist/branch-stock',
  }, 'Stok');
}

module.exports = {
  notifyStockRequestSubmitted,
  notifyStockRequestReviewed,
  notifyStockRequestFulfilled,
  notifyTransferCreated,
  notifyTransferDiscrepancy,
  checkAndNotifyLowStock,
  notifyStockOpnameSubmitted,
  notifyStockOpnameApproved,
  notifyStockReturnSubmitted,
  notifyStockReturnReviewed,
  notifyStockReturnReceived,
};
```

- [ ] **Step 2: Wire the new `notifyTransferCreated` call into the transfer-creation route**

In `server/routes/stockist.js`, find the `router.post('/transfers', adminAuth, async (req, res) => { ... })` handler (confirmed to exist around line 453 as of this plan's writing — re-locate it fresh, since this file may have shifted). After the transfer row is successfully created (find where the handler returns the created transfer, typically a `res.status(201).json({ transfer })` or similar success response) and BEFORE that response is sent, insert a call:
```js
await notifyBestEffort(() => notifications.notifyTransferCreated(supabase, { transfer: createdTransfer, destinationBranchSlug: <the destination branch slug variable already in scope in this handler> }));
```
Use the exact variable names already in scope in that handler for the created transfer row and the destination branch (read the handler's actual code first — do not guess the variable names). This mirrors the exact `notifyBestEffort(() => notifications.notifyXxx(...))` pattern already used at every other notify call site in this same file (e.g. line ~658's `notifyTransferDiscrepancy` call).

- [ ] **Step 3: Sanity-check the file for syntax errors**

Run: `node -c server/routes/stockist.js && node -c server/services/stockistNotifications.js`
Expected: no output (both files parse as valid JavaScript). This repo's backend has no TypeScript/build step for `server/`, so `node -c` (syntax check only, doesn't execute) is the available verification.

- [ ] **Step 4: Commit**

```bash
git add server/services/stockistNotifications.js server/routes/stockist.js
git commit -m "$(cat <<'EOF'
feat(stockist): persist notifications alongside pushes, add transfer-created

Every existing push-notification call now also writes a row to the new
stockist_notifications table via a category param threaded through the
shared notifyUsers() helper. Adds notifyTransferCreated, fired when a
transfer is dispatched to a branch — the mockup's own flagship
notification example had no existing trigger for it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Express routes — list, mark-one-read, mark-all-read

**Files:**
- Modify: `server/routes/stockist.js` (add 3 new routes; re-read the file first to find the right insertion point and confirm the exact `requireAccess`/`access.staffId` shape before writing)

**Interfaces:**
- Consumes: `stockist_notifications` table (Task 1), `access.staffId` (already produced by `requireAccess()`, confirmed via the earlier Manager-role research: `getVerifiedStockistAccess` returns `{ role, branch, staffId }` for both roles).
- Produces: `GET /api/stockist/notifications` (optional `?category=` query param; returns `{ notifications: [...] }` sorted newest-first, scoped to the caller's own `user_id`), `PATCH /api/stockist/notifications/:id/read` (returns `{ notification }`), `POST /api/stockist/notifications/read-all` (returns `{ updated: <count> }`).

- [ ] **Step 1: Re-read the file's routing conventions before adding new routes**

Re-read `server/routes/stockist.js` around its existing `router.get('/inventory/ledger', ...)` handler (a simple list-with-optional-filter GET) and any existing `router.patch('/:id/...', ...)` handler (for the mark-read pattern) to confirm the exact `requireAccess(req, res)` early-return convention and response shape conventions (e.g. error responses always `{ error: string }`) are still as documented here — adapt if the file has drifted.

- [ ] **Step 2: Add the three routes**

Add near the other read-oriented routes (e.g. right after the `/inventory/ledger` route):

```js
  // ─── NOTIFICATIONS ────────────────────────────────────────────
  router.get('/notifications', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase
      .from('stockist_notifications')
      .select('*')
      .eq('user_id', access.staffId)
      .order('created_at', { ascending: false })
      .limit(100);

    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ notifications: data || [] });
  });

  router.patch('/notifications/:id/read', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data, error } = await supabase
      .from('stockist_notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', access.staffId)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'notification not found' });

    return res.json({ notification: data });
  });

  router.post('/notifications/read-all', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data, error } = await supabase
      .from('stockist_notifications')
      .update({ is_read: true })
      .eq('user_id', access.staffId)
      .eq('is_read', false)
      .select('id');

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ updated: (data || []).length });
  });
```

(The `.eq('user_id', access.staffId)` filter on the mark-read routes is load-bearing, not decorative — it's what stops a user from marking or reading someone else's notification by guessing an id, since the row's `user_id` is checked against the verified session's `staffId`, never a client-supplied value.)

- [ ] **Step 3: Sanity-check syntax**

Run: `node -c server/routes/stockist.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/routes/stockist.js
git commit -m "$(cat <<'EOF'
feat(stockist): add notifications list/mark-read Express routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Next.js proxy routes

**Files:**
- Create: `frontend/src/app/api/stockist/notifications/route.ts`
- Create: `frontend/src/app/api/stockist/notifications/[id]/read/route.ts`
- Create: `frontend/src/app/api/stockist/notifications/read-all/route.ts`

**Interfaces:**
- Consumes: `requireStockistSession`/`createStockistProxyHeaders` from `../_auth` (already exist, already used identically by every sibling route file — e.g. `frontend/src/app/api/stockist/requests/route.ts`).
- Produces: three Next.js Route Handlers forwarding to the three Task 3 Express routes.

- [ ] **Step 1: Write the list route**

```ts
// frontend/src/app/api/stockist/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const res = await fetch(`${API_URL}/api/stockist/notifications${qs ? `?${qs}` : ''}`, {
    signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 2: Write the mark-one-read route**

```ts
// frontend/src/app/api/stockist/notifications/[id]/read/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/stockist/notifications/${id}/read`, {
    method: 'PATCH', signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

(Confirm the exact Next.js 16 dynamic-route `params` typing convention — `Promise<{ id: string }>` awaited inside the handler — by checking one existing sibling dynamic route file first, e.g. `frontend/src/app/api/stockist/requests/[id]/route.ts` if it exists, or any other `[id]/route.ts` under `frontend/src/app/api/stockist/`; adjust this file's `params` type/usage to match whatever convention that sibling file actually uses if it differs from what's shown here.)

- [ ] **Step 3: Write the mark-all-read route**

```ts
// frontend/src/app/api/stockist/notifications/read-all/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireStockistSession, createStockistProxyHeaders } from '../_auth';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(_req: NextRequest) {
  const auth = await requireStockistSession();
  if (!auth.ok) return auth.response;
  const res = await fetch(`${API_URL}/api/stockist/notifications/read-all`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: createStockistProxyHeaders(auth.session),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/stockist/notifications
git commit -m "$(cat <<'EOF'
feat(stockist): add Next.js proxy routes for the notifications API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `stockistApi.ts` client functions

**Files:**
- Modify: `frontend/src/lib/stockistApi.ts` (append new type/functions; do not touch any existing export)

**Interfaces:**
- Consumes: the `req<T>` helper already defined at the top of this file (confirmed in earlier research: `async function req<T>(path: string, init?: RequestInit): Promise<T>`, used by every existing exported function in this file).
- Produces: `StockistNotification` type, `listNotifications(category?: string)`, `markNotificationRead(id: string)`, `markAllNotificationsRead()`.

- [ ] **Step 1: Re-read the file's existing patterns first**

Re-read `frontend/src/lib/stockistApi.ts` in full to confirm the exact `req<T>` signature and the exact style every other exported function follows (e.g. `export const listTransfers = () => req<{ transfers: StockTransfer[] }>('/api/stockist/transfers');`), so the additions below match the file's established conventions exactly rather than introducing a new style.

- [ ] **Step 2: Append the new type and functions**

At the end of the file (or grouped near the other domain sections, matching the file's existing section-comment convention if one exists), add:

```ts
export interface StockistNotification {
  id: string;
  user_id: string;
  category: 'Stok' | 'Transfer' | 'Pengiriman' | 'Sistem' | 'Pengumuman';
  title: string;
  body: string;
  url: string | null;
  is_read: boolean;
  created_at: string;
}

export const listNotifications = (category?: string) =>
  req<{ notifications: StockistNotification[] }>(`/api/stockist/notifications${category ? `?category=${encodeURIComponent(category)}` : ''}`);

export const markNotificationRead = (id: string) =>
  req<{ notification: StockistNotification }>(`/api/stockist/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () =>
  req<{ updated: number }>('/api/stockist/notifications/read-all', { method: 'POST' });
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/stockistApi.ts
git commit -m "$(cat <<'EOF'
feat(stockist): add notifications client functions to stockistApi

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Notifikasi page

**Files:**
- Create: `frontend/src/app/admin/stockist/notifications/page.tsx`

**Interfaces:**
- Consumes: `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `StockistNotification` (Task 5).
- Produces: a page component at `/admin/stockist/notifications` — the route the header's bell icon (already wired since Plan 3) has been linking to.

- [ ] **Step 1: Write the page**

```tsx
// frontend/src/app/admin/stockist/notifications/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listNotifications, markNotificationRead, markAllNotificationsRead, type StockistNotification } from '@/lib/stockistApi';
import { EmptyState } from '@/components/stockist/EmptyState';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';

const CATEGORIES = ['Semua', 'Stok', 'Transfer', 'Pengiriman', 'Sistem', 'Pengumuman'] as const;

const CATEGORY_ICON: Record<StockistNotification['category'], string> = {
  Stok: 'inventory_2',
  Transfer: 'local_shipping',
  Pengiriman: 'task_alt',
  Sistem: 'sync_problem',
  Pengumuman: 'campaign',
};

export default function NotificationsPage() {
  const router = useRouter();
  const [chip, setChip] = useState<(typeof CATEGORIES)[number]>('Semua');
  const [items, setItems] = useState<StockistNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    setError(null);
    listNotifications(chip === 'Semua' ? undefined : chip)
      .then(({ notifications }) => setItems(notifications))
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat notifikasi'));
  }, [chip]);

  const unreadCount = items?.filter((n) => !n.is_read).length ?? 0;

  async function openNotification(n: StockistNotification) {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev?.map((row) => (row.id === n.id ? { ...row, is_read: true } : row)) ?? prev);
      } catch {
        // non-fatal — still navigate even if marking read failed
      }
    }
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev?.map((row) => ({ ...row, is_read: true })) ?? prev);
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-text-muted">{unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}</span>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-[11px] font-semibold text-primary-container">
            Tandai semua dibaca
          </button>
        )}
      </div>

      <div className="sc flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setChip(c)}
            className={`flex-none h-[34px] px-3.5 rounded-full text-[12px] font-bold border transition-colors ${
              chip === c ? 'bg-primary-container border-primary-container text-white' : 'bg-surface-elevated border-border-base text-text-secondary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger bg-danger/10 p-3 text-[12px] text-danger">{error}</div>
      )}

      {items === null && !error && (
        <div className="flex flex-col gap-2.5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState icon="notifications_off" title="Belum ada notifikasi" subtitle="Notifikasi baru akan muncul di sini." />
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => openNotification(n)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                n.is_read ? 'bg-surface-container border-surface-container' : 'bg-surface-elevated border-border-base'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint-info">
                <span className="material-symbols-outlined text-[19px] text-info">{CATEGORY_ICON[n.category]}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text-primary">{n.title}</span>
                  {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary-container" />}
                </div>
                <span className="text-[11px] text-text-secondary">{n.body}</span>
                <span className="text-[10px] text-text-muted">
                  {new Date(n.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} WIB
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

(Reuses the already-existing `EmptyState`/`SkeletonCard` components from `components/stockist/` rather than inventing new ones. The per-category icon tint is intentionally uniform `bg-tint-info`/`text-info` for simplicity — the mockup varies tint per notification's severity, which would require mapping each category AND urgency to a tint; that finer-grained mapping is a reasonable follow-up polish item, not required for this page to be functional and honest about real data.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/notifications/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add the Notifikasi page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire the header's notification bell to a real unread indicator

**Files:**
- Modify: `frontend/src/app/admin/stockist/layout.tsx`

**Interfaces:**
- Consumes: `listNotifications` (Task 5).
- Produces: no new exports — adds a `hasUnread: boolean` piece of state to the layout, fetched once when the authenticated shell mounts, rendering a small red dot on the notification bell icon when true. This is a lightweight, on-mount check, not real-time polling — documented as a scope boundary, not a defect (a user has to reload or re-navigate into the layout to see a NEW notification's dot appear; there's no websocket/SSE push-to-UI in this plan).

- [ ] **Step 1: Re-read the current live file first**

Re-read `frontend/src/app/admin/stockist/layout.tsx` in full — it's been touched by several tasks across two prior plans.

- [ ] **Step 2: Add the unread check**

Add near the top of `StockistLayout`, alongside the other `useState`/`useEffect` calls (after the existing ones, so it doesn't interfere with the route-guard/transition effects that must run first):

```tsx
  const [hasUnread, setHasUnread] = useState(false);
  useEffect(() => {
    if (loading || !user) return;
    listNotifications()
      .then(({ notifications }) => setHasUnread(notifications.some((n) => !n.is_read)))
      .catch(() => {
        // non-fatal — the bell just shows no dot if this fails
      });
  }, [loading, user]);
```

Add the import: `import { listNotifications } from '@/lib/stockistApi';`

Update the notification button's JSX to show the dot when `hasUnread` is true — change:
```tsx
        <button
          onClick={() => router.push('/admin/stockist/notifications')}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
        </button>
```
to:
```tsx
        <button
          onClick={() => router.push('/admin/stockist/notifications')}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
          {hasUnread && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary-container border border-surface-elevated" />}
        </button>
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/layout.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): show a real unread dot on the header notification bell

On-mount check, not real-time — documented scope boundary, not a defect.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verification pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full production build**

Run: `cd frontend && npm run build`
Expected: succeeds, all routes generated including `/admin/stockist/notifications`, zero TypeScript errors.

- [ ] **Step 2: Backend syntax check**

Run: `node -c server/routes/stockist.js && node -c server/services/stockistNotifications.js`
Expected: no output.

- [ ] **Step 3: Confirm the migration is either applied or clearly flagged as pending**

If Task 1 was able to apply the migration in this environment, confirm `stockist_notifications` exists in the actual database. If it could not be applied (no DB access from this environment), this MUST be flagged explicitly and loudly to the user — every endpoint in this plan will 500 at runtime until the migration is applied, and that's a real, user-facing gap, not an acceptable "known limitation" to bury in a QA note.

- [ ] **Step 4: Note remaining manual QA scope**

Full interactive QA (triggering a real stock request/transfer/return/opname event and confirming a notification row appears, clicking through category chips, confirming mark-read/mark-all-read work, confirming the header dot appears/disappears correctly) requires real Supabase credentials and a live backend — not available in this environment, same limitation as prior plans. Record this explicitly as open for the user.

No commit for this task — verification only.
