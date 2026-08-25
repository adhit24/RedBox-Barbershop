# Stockist Transfer Plan B: Konfirmasi Penerimaan + Offline-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Detail Transfer from its embedded receive form, build a dedicated Konfirmasi Penerimaan screen with mandatory reason-for-discrepancy and optional evidence photo, and add the scoped-down offline-first behavior (draft persistence + connectivity banner + submit-blocking) the design handoff requires for this flow.

**Architecture:** A schema migration adds two nullable columns to `stock_transfer_items`. A new Supabase Storage bucket + upload endpoint handles evidence photos. `receiveTransfer`'s payload and the `PATCH /transfers/:id/receive` route both extend to carry/validate `reason`/`photo_url` per item and to exclude Owner from confirming receipt. The frontend splits the current merged Detail Transfer + receive-form page into a pure detail view and a new confirm route, reusing Plan A's `useDraftPersistence` and `SuccessScreen`.

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript, Tailwind v4, Express + Supabase (`server/routes/stockist.js`), `node:test` for backend tests.

**Spec:** `docs/superpowers/specs/2026-08-25-stockist-transfer-flow-rebuild-design.md` (read the "Plan B" sections — migration, evidence photo storage, `receiveTransfer` API + role change, and the Detail Transfer / Konfirmasi Penerimaan split).

**Depends on:** Plan A (`docs/superpowers/plans/2026-08-25-stockist-transfer-plan-a-receive-create.md`) must be merged first — this plan imports `useDraftPersistence` (`frontend/src/hooks/useDraftPersistence.ts`) and `SuccessScreen` (`frontend/src/components/stockist/SuccessScreen.tsx`) from it verbatim, and does not redefine either.

## Global Constraints

- Supabase project id for direct MCP queries/migrations: `khcvklzxfohwkyocenaf`.
- Backend changes need real automated tests — `server/test/stockist-routes-transfers.test.js` already exists with a `fakeSupabase`/`withServer` harness (uses `node:test` + `node:assert/strict`, an in-memory fake Supabase client, and real HTTP requests via `fetch` against a locally-listening Express app). Follow that exact pattern for every new/changed backend behavior in this plan — do not skip tests because "there's no test suite" (there is one, for the backend).
- Run backend tests with: `node --test server/test/*.test.js` (from repo root) or narrower: `node --test server/test/stockist-routes-transfers.test.js`.
- No fabricated data, exact spec copy strings — same as Plan A.
- `OfflineBanner` (`frontend/src/components/stockist/OfflineBanner.tsx`) already exists, takes no props, renders the exact spec §24 offline copy. Do not rewrite it — just render it conditionally.
- `Stepper` size `'sm'` = 40px buttons (matches Konfirmasi Penerimaan's spec exactly) — already exists after Plan A, no changes needed to it in this plan.
- `getKnownProductImage`/`Package` fallback pattern — same convention as Plan A, Global Constraints.
- **Production database change:** the migration in Task 1 modifies the live `stock_transfer_items` table and creates a live Storage bucket. Per this session's standing practice, the person running this plan (the controller orchestrating SDD, not a dispatched implementer subagent) applies Task 1's SQL directly via the `mcp__claude_ai_Supabase__execute_sql` MCP tool — Task 1's steps are written assuming whoever executes them has that tool. If a dispatched implementer subagent lacks it, it should write the migration file, report `DONE_WITH_CONCERNS` noting the SQL was not applied, and the controller applies it manually before marking the task complete.

---

### Task 1: Migration + evidence bucket

**Files:**
- Create: `server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql`

**Interfaces:**
- Produces: two new nullable columns on `stock_transfer_items` (`discrepancy_reason text`, `discrepancy_photo_url text`) and a new public Storage bucket `stockist-evidence`, both consumed by Task 2 (photo upload endpoint) and Task 3 (receive route changes).

- [ ] **Step 1: Write the migration file**

```sql
-- server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql
alter table stock_transfer_items
  add column if not exists discrepancy_reason text null,
  add column if not exists discrepancy_photo_url text null;

insert into storage.buckets (id, name, public)
values ('stockist-evidence', 'stockist-evidence', true)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply it to the production database**

Using the `mcp__claude_ai_Supabase__execute_sql` tool with `project_id: "khcvklzxfohwkyocenaf"`, run the exact SQL from Step 1.

- [ ] **Step 3: Verify**

Run this query with the same MCP tool to confirm both changes landed:

```sql
select column_name from information_schema.columns where table_name = 'stock_transfer_items' and column_name in ('discrepancy_reason', 'discrepancy_photo_url');
select id, public from storage.buckets where id = 'stockist-evidence';
```

Expected: both columns listed, and one bucket row with `public = true`.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql
git commit -m "$(cat <<'EOF'
feat(stockist): add discrepancy reason/photo columns + evidence bucket

stock_transfer_items gains discrepancy_reason and discrepancy_photo_url
(both nullable) for Konfirmasi Penerimaan's mandatory-reason-on-
discrepancy requirement (spec §13). New public Storage bucket
stockist-evidence for the optional evidence photo upload, following
the same public-bucket convention as the existing ai-images and
member-avatars buckets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Photo upload endpoint

**Files:**
- Modify: `server/routes/stockist.js`
- Test: `server/test/stockist-routes-transfers.test.js`

**Interfaces:**
- Consumes: `stockist-evidence` bucket (Task 1), `requireAccess`/`findLocation` (existing, same file).
- Produces: `POST /api/stockist/transfers/:id/items/:itemId/photo` — request body `{ data_url: string }` (a `data:image/...;base64,...` string), response `{ photo_url: string }` on success. Task 3's frontend confirm page calls this.

- [ ] **Step 1: Find the request body size limit**

`server/index.js:816` has `app.use(express.json());` with no `limit` option — Express's default JSON body limit is 100kb, too small for a base64-encoded photo (a 1MB photo becomes ~1.35MB base64). Change that line to:

```js
app.use(express.json({ limit: '6mb' }));
```

6MB accommodates a base64-encoded photo up to roughly 4.4MB raw, generous for a phone camera JPEG while still bounding worst-case payload size.

- [ ] **Step 2: Add the upload endpoint**

In `server/routes/stockist.js`, add this route directly after the existing `router.patch('/transfers/:id/receive', ...)` block (after its closing `});`, before the `// ─── MANUAL ADJUSTMENT ───` comment):

```js
  router.post('/transfers/:id/items/:itemId/photo', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: transfers, error: transferError } = await supabase.from('stock_transfers').select('*').eq('id', req.params.id);
    if (transferError) return res.status(500).json({ error: transferError.message });
    const transfer = (transfers || [])[0];
    if (!transfer) return res.status(404).json({ error: 'transfer not found' });

    if (access.role === 'owner') {
      return res.status(403).json({ error: 'owner cannot confirm receipt' });
    }
    if (access.role === 'branch_admin') {
      const ownBranchLocation = await findLocation('branch', access.branch);
      if (!ownBranchLocation || ownBranchLocation.id !== transfer.destination_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }
    if (transfer.status !== 'SENT') {
      return res.status(409).json({ error: 'transfer already received' });
    }

    const { data_url } = req.body || {};
    const match = typeof data_url === 'string' ? data_url.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/) : null;
    if (!match) {
      return res.status(400).json({ error: 'data_url must be a base64 image/jpeg, image/png, or image/webp data URL' });
    }
    const [, ext, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    const path = `${transfer.id}/${req.params.itemId}.${ext === 'jpeg' ? 'jpg' : ext}`;

    const { error: uploadError } = await supabase.storage.from('stockist-evidence').upload(path, buffer, {
      contentType: `image/${ext}`,
      upsert: true,
    });
    if (uploadError) return res.status(500).json({ error: uploadError.message });

    const { data: publicUrlData } = supabase.storage.from('stockist-evidence').getPublicUrl(path);
    return res.json({ photo_url: publicUrlData.publicUrl });
  });

```

This endpoint stores a file and returns its URL — it does not itself write to `stock_transfer_items`; Task 3's receive endpoint change is where the URL gets persisted, once the client includes it in that item's payload entry.

- [ ] **Step 3: Add a test double for `storage.from(...)` in the test file**

`server/test/stockist-routes-transfers.test.js`'s `fakeSupabase()` function only implements `.from(table)` for Postgres tables and `.rpc(...)` — it has no `.storage` at all. Add a minimal in-memory fake alongside the existing `state` object. Edit the `fakeSupabase` function's returned object (currently ends with the `async rpc(name, args) { ... }` method) to add a `storage` property as a sibling of `from` and `rpc`:

```js
    storage: {
      from(bucket) {
        return {
          async upload(path, _buffer, _opts) {
            state.uploadedPaths = state.uploadedPaths || [];
            state.uploadedPaths.push(`${bucket}/${path}`);
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://fake-storage.test/${bucket}/${path}` } };
          },
        };
      },
    },
```

(Add a trailing comma after the existing `async rpc(...) { ... }` method to keep this a valid object literal.)

- [ ] **Step 4: Write tests**

Add to `server/test/stockist-routes-transfers.test.js`:

```js
test('POST /transfers/:id/items/:itemId/photo uploads and returns a public URL', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: `data:image/png;base64,${tinyPngBase64}` }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.photo_url, /^https:\/\/fake-storage\.test\/stockist-evidence\/transfer-1\/item-1\.png$/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('POST /transfers/:id/items/:itemId/photo is rejected for owner', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'data:image/png;base64,aGVsbG8=' }),
    });
    assert.equal(res.status, 403);
  }, { role: 'owner' });
});

test('POST /transfers/:id/items/:itemId/photo rejects a non-image data URL', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/items/item-1/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: 'not-a-data-url' }),
    });
    assert.equal(res.status, 400);
  }, { role: 'branch_admin', branch: 'csb' });
});
```

- [ ] **Step 5: Run the tests**

Run: `node --test server/test/stockist-routes-transfers.test.js`
Expected: all tests pass, including the 3 new ones and every pre-existing one in this file (nothing here should break an existing test — this task only adds a new route).

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/routes/stockist.js server/test/stockist-routes-transfers.test.js
git commit -m "$(cat <<'EOF'
feat(stockist): add discrepancy evidence photo upload endpoint

POST /api/stockist/transfers/:id/items/:itemId/photo accepts a
base64 image data URL, uploads to the new stockist-evidence bucket,
returns a public URL. Same role gate as receive (branch_admin on
own branch, never owner). Raised the global express.json() body
limit from Express's 100kb default to 6mb to fit a base64-encoded
phone photo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `receiveTransfer` reason/photo + owner exclusion

**Files:**
- Modify: `server/routes/stockist.js`
- Modify: `frontend/src/lib/stockistApi.ts`
- Test: `server/test/stockist-routes-transfers.test.js`

**Interfaces:**
- Modifies: `receiveTransfer(id: string, items: { item_id: string; quantity_received: number; reason?: string; photo_url?: string }[])` (was `{ item_id, quantity_received }` only) — Task 5's Konfirmasi Penerimaan page is the caller.
- Produces: server-side 400 when a discrepant item is submitted without a `reason`; server-side 403 when `access.role === 'owner'`.

- [ ] **Step 1: Extend the TypeScript signature**

Edit `frontend/src/lib/stockistApi.ts` line 144-147:

```ts
export const receiveTransfer = (id: string, items: { item_id: string; quantity_received: number; reason?: string; photo_url?: string }[]) =>
  req<{ transfer: StockTransfer; has_discrepancy: boolean }>(`/api/stockist/transfers/${id}/receive`, {
    method: 'PATCH', body: JSON.stringify({ items }),
  });
```

- [ ] **Step 2: Owner exclusion + reason validation on the backend**

Edit `server/routes/stockist.js`'s `router.patch('/transfers/:id/receive', ...)` (currently starting around line 652). Two changes:

First, add the owner exclusion right after the existing branch_admin check (after the `if (access.role === 'branch_admin') { ... }` block, before `if (transfer.status !== 'SENT')`):

```js
    if (access.role === 'owner') {
      return res.status(403).json({ error: 'owner cannot confirm receipt' });
    }
```

The `items` shape-validation block (`const { items } = req.body || {}; if (!Array.isArray(items) || ...)`, right after the status check) stays exactly as-is — `reason`/`photo_url` are optional fields checked separately below, once each item's `quantity_sent` is available to compare against. Leave that block untouched and move to the per-item loop below it:

```js
    const byId = new Map((transferItems || []).map((i) => [i.id, i]));
    for (const submitted of items) {
      const existing = byId.get(submitted.item_id);
      if (!existing) return res.status(400).json({ error: `unknown transfer item ${submitted.item_id}` });
      if (existing.quantity_received != null) {
        // Already processed in a prior attempt (e.g. after a partial failure on a
        // previous request) — do not re-apply the movement.
        continue;
      }
```

Insert a discrepancy-reason check right after the `!existing` guard, before the `quantity_received != null` early-continue (a discrepant resubmission attempt should still be validated for a reason, even though the movement itself won't be reapplied):

```js
    const byId = new Map((transferItems || []).map((i) => [i.id, i]));
    for (const submitted of items) {
      const existing = byId.get(submitted.item_id);
      if (!existing) return res.status(400).json({ error: `unknown transfer item ${submitted.item_id}` });
      if (submitted.quantity_received !== existing.quantity_sent && (typeof submitted.reason !== 'string' || !submitted.reason.trim())) {
        return res.status(400).json({ error: `item ${submitted.item_id} has a discrepancy and requires a reason` });
      }
      if (existing.quantity_received != null) {
        // Already processed in a prior attempt (e.g. after a partial failure on a
        // previous request) — do not re-apply the movement.
        continue;
      }
```

Then extend the update call that persists `quantity_received` to also persist the reason/photo when present. Find:

```js
      const { error: itemUpdateError } = await supabase.from('stock_transfer_items').update({ quantity_received: submitted.quantity_received }).eq('id', submitted.item_id);
      if (itemUpdateError) return res.status(500).json({ error: itemUpdateError.message });
      existing.quantity_received = submitted.quantity_received;
```

Replace with:

```js
      const updatePayload = { quantity_received: submitted.quantity_received };
      if (typeof submitted.reason === 'string' && submitted.reason.trim()) updatePayload.discrepancy_reason = submitted.reason.trim();
      if (typeof submitted.photo_url === 'string' && submitted.photo_url.trim()) updatePayload.discrepancy_photo_url = submitted.photo_url.trim();
      const { error: itemUpdateError } = await supabase.from('stock_transfer_items').update(updatePayload).eq('id', submitted.item_id);
      if (itemUpdateError) return res.status(500).json({ error: itemUpdateError.message });
      existing.quantity_received = submitted.quantity_received;
```

- [ ] **Step 3: Update `fakeSupabase`'s `stock_transfer_items` insert defaults**

The existing fake in `server/test/stockist-routes-transfers.test.js` inserts items with `quantity_received: null, ...row` as defaults (line ~98) — no change needed there, `discrepancy_reason`/`discrepancy_photo_url` simply won't be present on fake rows unless a test sets them, which matches real Postgres row shape with nullable columns. No edit needed for this step; it's here to confirm you don't need to touch it.

- [ ] **Step 4: Write tests**

Add to `server/test/stockist-routes-transfers.test.js`:

```js
test('PATCH /transfers/:id/receive rejects a discrepant item with no reason', async () => {
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
    assert.equal(res.status, 400);
    assert.match(body.error, /requires a reason/);
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive accepts a discrepant item with a reason and persists it', async () => {
  const supabase = fakeSupabase({
    transfers: [{ id: 'transfer-1', status: 'SENT', destination_location_id: 'loc-csb', source_location_id: 'loc-warehouse' }],
    items: [{ id: 'item-1', stock_transfer_id: 'transfer-1', product_id: 'p1', quantity_sent: 10, quantity_received: null }],
  });
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/stockist/transfers/transfer-1/receive`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: 'item-1', quantity_received: 8, reason: 'Rusak di jalan', photo_url: 'https://fake-storage.test/x.jpg' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(supabase.state.items[0].discrepancy_reason, 'Rusak di jalan');
    assert.equal(supabase.state.items[0].discrepancy_photo_url, 'https://fake-storage.test/x.jpg');
  }, { role: 'branch_admin', branch: 'csb' });
});

test('PATCH /transfers/:id/receive is rejected for owner', async () => {
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
  }, { role: 'owner' });
});
```

- [ ] **Step 5: Run the tests**

Run: `node --test server/test/stockist-routes-transfers.test.js`
Expected: every test in the file passes, including the pre-existing `'PATCH /transfers/:id/receive lets the destination branch_admin confirm quantities and flags discrepancy'` test — check it still passes even though it submits `{ item_id: 'item-1', quantity_received: 8 }` against `quantity_sent: 10` (a discrepancy) with no `reason`. **If that pre-existing test now fails Step 5's new reason requirement, that's expected and correct** — update that pre-existing test to include a `reason` field in its request body (it's testing discrepancy-flagging behavior, not reason-validation, so giving it a reason keeps its original intent intact while satisfying the new requirement).

- [ ] **Step 6: Verify frontend types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (nothing yet calls `receiveTransfer` with the new fields — that's Task 5 — so this just confirms the signature change itself doesn't break the one existing caller, which will be rewritten in Task 4).

- [ ] **Step 7: Commit**

```bash
git add server/routes/stockist.js frontend/src/lib/stockistApi.ts server/test/stockist-routes-transfers.test.js
git commit -m "$(cat <<'EOF'
feat(stockist): require discrepancy reason, exclude owner from receive

PATCH /transfers/:id/receive now 400s a discrepant item with no
reason, persists discrepancy_reason/discrepancy_photo_url when
given, and 403s any owner attempting to confirm receipt at all —
per spec §12, only Manager and Admin Cabang may confirm. Owner was
previously unrestricted here, which was a real gap against the
design, not a Manager-role question. receiveTransfer()'s TS
signature widens to match.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Split Detail Transfer from the receive form

**Files:**
- Modify: `frontend/src/app/admin/stockist/transfers/[id]/page.tsx` (rewrite)

**Interfaces:**
- Consumes: `getTransfer`/`listProducts` (existing, unchanged signatures).
- Produces: a "Konfirmasi Penerimaan" link to `/admin/stockist/transfers/${id}/confirm` (Task 5's route — doesn't exist yet when this task ships, so the link will 404 until Task 5 lands; that's expected mid-plan, both tasks belong to the same PR/plan and ship together before merge).

- [ ] **Step 1: Rewrite the page as pure Detail Transfer**

Replace the entire contents of `frontend/src/app/admin/stockist/transfers/[id]/page.tsx`:

```tsx
// frontend/src/app/admin/stockist/transfers/[id]/page.tsx
'use client';
import { useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import { getTransfer, listProducts, type StockTransfer, type StockTransferItem, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { BackButton } from '@/components/stockist/BackButton';

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const { user } = useUser();

  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getTransfer(id), listProducts()])
      .then(([{ transfer, items }, { products }]) => {
        setTransfer(transfer);
        setItems(items);
        setProducts(products);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat detail transfer'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !transfer) {
    return (
      <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <span className="material-symbols-outlined">error</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!transfer) return null;

  const productMap = new Map(products.map((p) => [p.id, p]));
  const canConfirm = (user?.role === 'manager' || user?.role === 'branch_admin') && transfer.status === 'SENT';

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col gap-3 animate-fade-in pb-12">
      <BackButton fallbackHref="/admin/stockist/transfers" />
      <div>
        <h2 className="text-[20px] font-bold text-text-primary font-display">Detail Transfer</h2>
        <p className="text-[11px] text-text-muted font-mono">NO: {transfer.transfer_number}</p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      <section className="bg-surface-elevated rounded-xl p-4 border border-border-base flex flex-col gap-4 shadow-sm">
        <div className="flex justify-between items-center border-b border-border-base pb-3">
          <h3 className="text-[13px] font-bold text-text-primary font-display flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">local_shipping</span>
            Rute Pengiriman
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${
            transfer.status === 'SENT' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'
          }`}>
            {transfer.status === 'SENT' ? 'Dikirim' : 'Diterima'}
          </span>
        </div>

        <div className="flex justify-between items-center text-center">
          <div className="flex flex-col flex-1 items-start">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Pengirim</span>
            <span className="text-[13px] font-bold text-text-primary mt-1">{transfer.source_name || transfer.source_location_id}</span>
            <span className="text-[10px] text-text-muted mt-0.5 font-mono">{transfer.sent_by}</span>
          </div>
          <div className="flex flex-col px-3 justify-center items-center">
            <span className="material-symbols-outlined text-text-muted text-[20px] animate-pulse">arrow_forward</span>
            <span className="text-[8px] text-text-muted mt-1 uppercase font-semibold">Kurir</span>
          </div>
          <div className="flex flex-col flex-1 items-end">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Penerima</span>
            <span className="text-[13px] font-bold text-text-primary mt-1">{transfer.destination_name || transfer.destination_location_id}</span>
            <span className="text-[10px] text-text-muted mt-0.5 font-mono">{transfer.received_by || '-'}</span>
          </div>
        </div>

        <div className="h-[1px] w-full bg-border-base/50"></div>

        <div className="flex flex-col gap-4 pl-1">
          <div className="flex items-start gap-3 relative">
            <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[12px] font-semibold text-text-primary">Transfer Dibuat &amp; Dikirim</span>
              <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.sent_at)}</span>
            </div>
            <div className="absolute top-[18px] left-[9px] w-[1px] h-[22px] bg-border-base"></div>
          </div>

          <div className="flex items-start gap-3 relative">
            {transfer.status === 'RECEIVED' ? (
              <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            ) : (
              <div className="w-[18px] h-[18px] rounded-full bg-danger flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            )}
            <div className="flex flex-col text-left">
              <span className="text-[12px] font-semibold text-text-primary">Dikirim ke kurir</span>
              <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.sent_at)}</span>
            </div>
            {transfer.status !== 'RECEIVED' && <div className="absolute top-[18px] left-[9px] w-[1px] h-[22px] bg-border-base"></div>}
          </div>

          <div className="flex items-start gap-3 relative">
            {transfer.status === 'RECEIVED' ? (
              <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            ) : (
              <div className="w-[18px] h-[18px] rounded-full border-2 border-border-base bg-surface-container-lowest shrink-0"></div>
            )}
            <div className="flex flex-col text-left">
              <span className={`text-[12px] font-semibold ${transfer.status === 'RECEIVED' ? 'text-text-primary' : 'text-text-muted'}`}>
                {transfer.status === 'RECEIVED' ? `Diterima di ${transfer.destination_name || transfer.destination_location_id}` : 'Menunggu konfirmasi'}
              </span>
              {transfer.status === 'RECEIVED' && <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.received_at)}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Rincian produk</h3>
          <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">{items.length} Item</span>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const product = productMap.get(item.product_id);
            const name = product?.name || 'Produk Tidak Dikenal';
            const sku = product?.sku || 'UNKNOWN';
            const image = product ? getKnownProductImage(product.name) : null;
            const received = transfer.status === 'RECEIVED' ? item.quantity_received : null;
            const discrepancy = received != null ? received - item.quantity_sent : null;

            return (
              <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-[52px] h-[52px] rounded-lg bg-surface-container-lowest border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {image ? (
                      <img className="w-full h-full object-contain p-1" src={image} alt={name} />
                    ) : (
                      <Package size={20} className="text-text-muted" aria-hidden />
                    )}
                  </div>
                  <div className="flex-grow flex flex-col justify-center min-h-[48px]">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {sku}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[11px] bg-surface-container-lowest p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Dikirim</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums">{item.quantity_sent}</span>
                  </div>
                  <div className="rounded-[11px] bg-surface-container-lowest p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Diterima</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums">{received ?? '—'}</span>
                  </div>
                  <div className={`rounded-[11px] p-2.5 flex flex-col gap-0.5 ${discrepancy ? 'bg-danger/10' : 'bg-surface-container-lowest'}`}>
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Selisih</span>
                    <span className={`text-[14px] font-bold font-display tabular-nums ${discrepancy ? 'text-danger' : 'text-text-primary'}`}>
                      {discrepancy == null ? '—' : discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {canConfirm && (
        <Link
          href={`/admin/stockist/transfers/${id}/confirm`}
          className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg mt-3"
        >
          <span className="material-symbols-outlined text-[18px]">verified</span>
          Konfirmasi Penerimaan
        </Link>
      )}
    </div>
  );
}
```

Note what changed from the current file: the receive form (input fields, `handleReceive`, `receivedQty` state) is gone entirely — moved to Task 5's new route. The timeline gained its 3rd event ("Dikirim ke kurir") per spec §12's three-event description (created/sent/awaiting-confirmation) — the previous file only had 2. The CTA gates on `canConfirm = (role === 'manager' || role === 'branch_admin') && status === 'SENT'`, explicitly never `owner`, and links out instead of rendering a form inline.

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (The link to `/admin/stockist/transfers/${id}/confirm` pointing at a route that doesn't exist yet is a runtime 404 concern, not a type error — Next.js doesn't type-check that hrefs resolve to real routes.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/transfers/[id]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(stockist): split Detail Transfer from the receive form (§12)

Detail Transfer is now pure: route/status summary, 3-stat grid per
product (Dikirim/Diterima/Selisih, Selisih tinted red when nonzero),
a real 3-event timeline (was missing the "awaiting confirmation"
event). The inline receive form moves to a dedicated Konfirmasi
Penerimaan route (next commit) reached via a CTA that's gated
role==='manager'||'branch_admin' AND status==='SENT' — Owner is
never shown this action, per spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `useOnlineStatus` hook + Konfirmasi Penerimaan screen

**Files:**
- Create: `frontend/src/hooks/useOnlineStatus.ts`
- Create: `frontend/src/app/admin/stockist/transfers/[id]/confirm/page.tsx`

**Interfaces:**
- Consumes: `Stepper` (`size='sm'`), `SuccessScreen`, `useDraftPersistence`, `OfflineBanner` (all existing after Plan A / already in the repo), `getTransfer`/`listProducts`/`receiveTransfer` (existing, `receiveTransfer` extended in Task 3), a new `uploadDiscrepancyPhoto` API function (add to `stockistApi.ts` in this task).
- Produces: route `/admin/stockist/transfers/[id]/confirm`, linked from Task 4.

- [ ] **Step 1: `useOnlineStatus` hook**

```ts
// frontend/src/hooks/useOnlineStatus.ts
'use client';

import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
```

(Starts optimistic (`true`) so server-rendered/first-paint markup matches between server and client — the real value is read in `useEffect`, after mount, same SSR-safety reasoning as the other hooks in this plan.)

- [ ] **Step 2: Add `uploadDiscrepancyPhoto` to the API client**

Add to `frontend/src/lib/stockistApi.ts`, near `receiveTransfer`:

```ts
export const uploadDiscrepancyPhoto = (transferId: string, itemId: string, dataUrl: string) =>
  req<{ photo_url: string }>(`/api/stockist/transfers/${transferId}/items/${itemId}/photo`, {
    method: 'POST', body: JSON.stringify({ data_url: dataUrl }),
  });
```

- [ ] **Step 3: Write the Konfirmasi Penerimaan page**

```tsx
// frontend/src/app/admin/stockist/transfers/[id]/confirm/page.tsx
'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';
import { getTransfer, listProducts, receiveTransfer, uploadDiscrepancyPhoto, type StockTransfer, type StockTransferItem, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';
import { OfflineBanner } from '@/components/stockist/OfflineBanner';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { showToast } from '@/lib/stockist/useToast';
import { BackButton } from '@/components/stockist/BackButton';

const REASONS = ['Kurang kirim', 'Rusak di jalan', 'Salah hitung'] as const;

interface ConfirmDraft {
  received: Record<string, number>;
  reasons: Record<string, string>;
}

export default function ConfirmReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const online = useOnlineStatus();

  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ transferNumber: string; sent: number; received: number; discrepancy: number } | null>(null);

  // `draft.received` intentionally stays sparse — every read of it below falls
  // back to `?? item.quantity_sent`, so there's no need to eagerly pre-fill
  // defaults into the draft itself. Pre-filling in a useEffect would race
  // useDraftPersistence's own hydration effect (both are registered on the
  // same mount; the pre-fill effect's closure would see the pre-hydration
  // draft and could overwrite a just-restored one with defaults).
  const [draft, setDraft, clearDraft] = useDraftPersistence<ConfirmDraft>(`stockist-confirm-draft-${id}`, { received: {}, reasons: {} });

  useEffect(() => {
    Promise.all([getTransfer(id), listProducts()])
      .then(([{ transfer, items }, { products }]) => {
        setTransfer(transfer);
        setItems(items);
        setProducts(products);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Gagal memuat transfer'))
      .finally(() => setLoading(false));
  }, [id]);

  const productMap = new Map(products.map((p) => [p.id, p]));

  function setReceivedQty(itemId: string, qty: number) {
    setDraft({ ...draft, received: { ...draft.received, [itemId]: qty } });
  }

  function setReason(itemId: string, reason: string) {
    setDraft({ ...draft, reasons: { ...draft.reasons, [itemId]: reason } });
  }

  async function handlePhotoChange(itemId: string, file: File) {
    setUploadingFor(itemId);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { photo_url } = await uploadDiscrepancyPhoto(id, itemId, dataUrl);
      setPhotoUrls((prev) => ({ ...prev, [itemId]: photo_url }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal mengunggah foto');
    } finally {
      setUploadingFor(null);
    }
  }

  function saveDraft() {
    showToast('Draft tersimpan');
  }

  const totalSent = items.reduce((sum, i) => sum + i.quantity_sent, 0);
  const totalReceived = items.reduce((sum, i) => sum + (draft.received[i.id] ?? i.quantity_sent), 0);
  const aggregateDiscrepancy = totalReceived - totalSent;

  const discrepantItems = items.filter((i) => (draft.received[i.id] ?? i.quantity_sent) !== i.quantity_sent);
  const missingReasons = discrepantItems.filter((i) => !draft.reasons[i.id]);

  async function handleSubmit() {
    setSubmitError(null);
    if (missingReasons.length > 0) {
      setSubmitError('Semua produk dengan selisih wajib diberi alasan.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = items.map((item) => ({
        item_id: item.id,
        quantity_received: draft.received[item.id] ?? item.quantity_sent,
        reason: draft.reasons[item.id] || undefined,
        photo_url: photoUrls[item.id] || undefined,
      }));
      await receiveTransfer(id, payload);
      setResult({ transferNumber: transfer?.transfer_number ?? '', sent: totalSent, received: totalReceived, discrepancy: aggregateDiscrepancy });
      clearDraft();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal mengonfirmasi penerimaan');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const hasDiscrepancy = result.discrepancy !== 0;
    return (
      <SuccessScreen
        title={hasDiscrepancy ? 'Diterima dengan selisih' : 'Penerimaan dikonfirmasi'}
        body={hasDiscrepancy ? 'Selisih sudah dicatat beserta alasannya.' : 'Semua barang diterima sesuai jumlah pengiriman.'}
        summary={[
          { label: 'Transfer', value: result.transferNumber },
          { label: 'Dikirim', value: String(result.sent) },
          { label: 'Diterima', value: String(result.received) },
          { label: 'Selisih', value: hasDiscrepancy ? `${result.discrepancy} pcs` : '0' },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in pb-12">
      <BackButton fallbackHref={`/admin/stockist/transfers/${id}`} />
      <h2 className="text-[20px] font-bold text-text-primary font-display">Konfirmasi Penerimaan</h2>

      {!online && <OfflineBanner />}

      {loadError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-xl bg-tint-info p-3.5 text-info">
            <span className="material-symbols-outlined text-[18px] shrink-0">info</span>
            <p className="text-[11.5px] leading-snug">Hitung fisik barang dulu, lalu isi quantity yang benar-benar diterima. Selisih wajib diberi alasan.</p>
          </div>

          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const product = productMap.get(item.product_id);
              const name = product?.name || 'Produk Tidak Dikenal';
              const image = product ? getKnownProductImage(product.name) : null;
              const receivedQty = draft.received[item.id] ?? item.quantity_sent;
              const isDiscrepant = receivedQty !== item.quantity_sent;

              return (
                <div key={item.id} className={`flex flex-col gap-3 rounded-xl border-[1.5px] p-3.5 ${
                  isDiscrepant ? 'border-status-menipis bg-tint-warning' : 'border-border-base bg-surface-elevated'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className="w-[54px] h-[54px] rounded-lg bg-surface-container-lowest border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {image ? (
                        <img className="w-full h-full object-contain p-1" src={image} alt={name} />
                      ) : (
                        <Package size={20} className="text-text-muted" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13.5px] font-bold text-text-primary">{name}</h4>
                      <span className="text-[11px] text-text-muted">Dikirim {item.quantity_sent} pcs</span>
                    </div>
                    <span className={`rounded px-2 py-1 text-[10px] font-bold ${isDiscrepant ? 'bg-status-menipis text-white' : 'bg-tint-success text-success'}`}>
                      {isDiscrepant ? 'SELISIH' : 'SESUAI'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-secondary">Diterima fisik</span>
                    <Stepper value={receivedQty} onChange={(next) => setReceivedQty(item.id, next)} min={0} size="sm" />
                  </div>

                  {isDiscrepant && (
                    <div className="flex flex-col gap-2 rounded-lg border border-status-menipis bg-surface-elevated p-3">
                      <span className="text-[11px] font-semibold text-status-menipis">
                        Selisih {receivedQty - item.quantity_sent} pcs · wajib beri alasan
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {REASONS.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() => setReason(item.id, reason)}
                            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                              draft.reasons[item.id] === reason ? 'border-primary-container bg-primary-container text-white' : 'border-border-base text-text-secondary'
                            }`}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-base py-2 text-[11px] font-semibold text-text-secondary cursor-pointer">
                        <span className="material-symbols-outlined text-[16px]">photo_camera</span>
                        {uploadingFor === item.id ? 'Mengunggah...' : photoUrls[item.id] ? 'Foto terunggah' : 'Unggah foto bukti'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingFor === item.id || !online}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoChange(item.id, file);
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border-base bg-surface-elevated p-4">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total dikirim</span>
              <span className="font-semibold text-text-primary">{totalSent}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total diterima</span>
              <span className="font-semibold text-text-primary">{totalReceived}</span>
            </div>
            <div className="h-[1px] bg-border-base/60" />
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-text-primary">Selisih</span>
              <span className={`text-[20px] font-extrabold font-display tabular-nums ${aggregateDiscrepancy === 0 ? 'text-success' : 'text-status-menipis'}`}>
                {aggregateDiscrepancy}
              </span>
            </div>
          </div>

          {submitError && (
            <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !online}
              className="h-[48px] rounded-xl bg-primary-container text-white text-[14px] font-bold active:scale-95 transition-transform disabled:opacity-50"
            >
              {!online ? 'Menunggu koneksi...' : submitting ? 'Memproses...' : 'Konfirmasi Penerimaan'}
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[44px] rounded-xl border border-border-base text-text-primary text-[13px] font-bold active:scale-95 transition-transform"
            >
              Simpan Draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

With the dev server running and a `SENT` transfer to a branch destination in the database (create one via Buat Transfer from Plan A if none exists): sign in as that branch's admin, open Detail Transfer, confirm the "Konfirmasi Penerimaan" CTA appears (and does NOT appear when signed in as owner — check both). Open the confirm page: change one item's Diterima fisik stepper away from its Dikirim value, confirm the row switches to the SELISIH/yellow state live, confirm the reason chips and photo button appear, confirm submit is blocked with an inline error until a reason is picked. Submit with a valid reason — confirm it lands on the "Diterima dengan selisih" SuccessScreen variant. Separately, submit a transfer where every item's Diterima matches Dikirim exactly — confirm it lands on "Penerimaan dikonfirmasi" instead. Refresh the confirm page mid-edit (before submitting) — confirm the stepper values and any chosen reason survive (draft persistence). Turn off network access in devtools (or airplane mode) — confirm the `OfflineBanner` appears and the submit button becomes disabled with "Menunggu koneksi..." text.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useOnlineStatus.ts frontend/src/app/admin/stockist/transfers/[id]/confirm/page.tsx frontend/src/lib/stockistApi.ts
git commit -m "$(cat <<'EOF'
feat(stockist): build Konfirmasi Penerimaan screen (spec §13)

New route with per-product SESUAI/SELISIH badges computed live off
the stepper, an auto-appearing reason block (3 chips + photo upload)
the instant a row goes discrepant, an aggregate total/selisih panel,
and both success-screen copy variants from spec §23 depending on
whether the aggregate discrepancy is zero.

Offline-first scoped to what the spec actually describes: the
confirm/reasons draft persists locally (useDraftPersistence) so
nothing is lost on a refresh, a new useOnlineStatus hook drives the
existing (previously unused) OfflineBanner, and submit is disabled
while offline with a clear status instead of silently failing.
"Simpan Draft" stays local-only, matching Buat Transfer's pattern
from the previous plan — no new server-side draft status.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Notes for the Plan-Level Reviewer

- Cross-task risk: Task 4's Detail Transfer CTA links to Task 5's confirm route — after both tasks are committed, click through the full flow once end-to-end (Buat Transfer from Plan A → Detail Transfer → Konfirmasi Penerimaan → SuccessScreen) rather than trusting each task's isolated manual check alone.
- Confirm Task 3's reason-required validation doesn't accidentally block the **non-discrepant** path — the existing pre-Task-3 tests for exact-match receiving (no discrepancy) must still pass with no `reason` field at all.
- Confirm the pre-existing test `'PATCH /transfers/:id/receive lets the destination branch_admin confirm quantities and flags discrepancy'` was actually updated (Task 3 Step 5 calls this out) and not just left broken or silently deleted.
- Check that Task 4's new 3rd timeline event and Task 5's SESUAI/SELISIH badge colors are visually distinguishable in both light and dark theme (this codebase's tokens are theme-aware; nothing in either task hardcodes a color outside the existing `text-*`/`bg-*`/`border-*` token classes, so this should already hold — worth a quick look rather than an assumption).
