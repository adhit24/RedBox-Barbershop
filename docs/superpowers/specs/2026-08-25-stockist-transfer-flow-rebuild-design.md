# Stockist Transfer Flow Rebuild — Design Spec

**Status:** Approved 2026-08-25. Source of truth: `design_handoff_stockist_mobile/README.md` §8 (Detail Produk action), §9 (Terima Barang), §10 (Transfer list), §11 (Buat Transfer), §12 (Detail Transfer), §13 (Konfirmasi Penerimaan), §23 (Layar Sukses), §24 (States), and the "State Management" / "Perhitungan real-time" sections. Gap audit: `docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md`, item #6 in "Suggested execution order".

**Why this exists:** Item #6 in the gap audit's suggested execution order — the last major screen cluster before Stock Opname (#7), Success screens (#8), and everything else. Rebuilds the three screens the audit found most divergent from the design handoff: Terima Barang (missing carousel/stepper/preview), Buat Transfer (missing step indicator, no stock cap, no value calc, no review panel), and Konfirmasi Penerimaan (missing role gate, missing reason-for-discrepancy entirely — not even in the API — missing badges/photo/offline support).

## Decomposition: two plans

The gap audit already flagged this item as needing both the Stepper (built) and offline-first infra (not built) plus an API change. Splitting reduces blast radius per PR and keeps review scoped:

- **Plan A — Terima Barang + Buat Transfer.** Self-contained, no offline requirement, no schema change. Ships first.
- **Plan B — Detail Transfer split + Konfirmasi Penerimaan + offline-first.** Depends on nothing from Plan A except the `useDraftPersistence` hook (reused, not re-built) and the `SuccessScreen` component (reused for the discrepancy variant). Ships second.

Both plans are written and executed independently via `superpowers:subagent-driven-development`, each with its own PR and merge confirmation, matching every other plan this session.

## Shared components (built in Plan A, reused in Plan B)

### `SuccessScreen`

`frontend/src/components/stockist/SuccessScreen.tsx`. Generic, spec §23: header and bottom nav hidden, centered layout, top padding 56px, 88px full-radius disc (`tint-green` bg, `ok` border, `check_circle` icon 44px), title 20/800, body 13/500 max-width 280px, a key-value summary panel, two CTAs — "Kembali ke Beranda" (solid red, always `/admin/stockist`) and a second button whose label/href is passed as a prop (spec calls it "Lihat di Ledger" for Terima Barang/Konfirmasi flows, but the exact label and destination vary per caller — pass both explicitly, don't hardcode "Ledger").

Props: `{ title: string; body: string; summary: Array<{ label: string; value: string }>; secondaryAction: { label: string; href: string } }`.

This plan wires it into 3 of the design's 4 trigger points (Terima Barang, Kirim Transfer in Plan A; Konfirmasi Penerimaan in Plan B — both the SESUAI and SELISIH copy variants from the §23 table). The 4th (Kirim Opname) is out of scope — wired in later by the Stock Opname rebuild (gap audit item #7), which reuses this same component rather than building its own.

### `useDraftPersistence<T>`

`frontend/src/hooks/useDraftPersistence.ts`. A small `useState`-backed hook that mirrors its value to `localStorage` under a caller-provided key, hydrating from storage on mount (SSR-safe: returns the initial value until mounted, matching the existing `useTheme`/`useUnreadNotifications` pattern of guarding `window`/`localStorage` access). Signature: `useDraftPersistence<T>(key: string, initialValue: T): [T, (next: T) => void, () => void]` — the third return value clears the draft (called after successful submit).

This is deliberately NOT the full offline-first infrastructure — it is the lighter "draft survives a refresh/back-navigation" requirement the state-management table lists for Buat Transfer's `dest`/`cart` (marked "perlu persist" but not "(offline-first)"). Plan B's Konfirmasi Penerimaan reuses this same hook for its `confirm`/`reasons` state, which the table does mark "(offline-first)" — the offline-specific behavior (banner, submit-blocking) is added on top in Plan B via `useOnlineStatus`, not inside this hook.

### `Stepper` — new `'xs'` size

`frontend/src/components/stockist/Stepper.tsx` currently supports `'sm'` (40px buttons, matches Konfirmasi Penerimaan's spec) and `'lg'` (46px, matches Terima Barang's spec). Buat Transfer's cart-row stepper spec's exact size (34px) has no match — add a third `size='xs'` variant (34px buttons, keep the existing proportional number size logic) rather than reusing `'sm'` at the wrong size, per the standing project rule that shared visual elements must match exactly.

## Plan A: Terima Barang

**Route:** `frontend/src/app/admin/stockist/warehouse/receive/page.tsx` (new). Accepts optional `?product=<id>` search param to preselect a product — not consumed yet (Detail Produk's "Terima Barang" action button doesn't exist until that screen's own later rebuild, gap audit item #9), but the param is honored now so that future link-in requires no changes here.

**Entry point:** Gudang Pusat's existing "Terima" button (`frontend/src/app/admin/stockist/warehouse/page.tsx:139-147`) currently toggles an inline form (`showForm`) in place. Change it to a `<Link href="/admin/stockist/warehouse/receive">` instead, and delete the inline form block (lines ~208-275) along with the now-unused `showForm`/`form`/`submitting`/`formError` state and `handleReceive` function — `receiveWarehouseStock` moves to the new page.

**Layout (spec §9):**
1. Horizontal carousel of product tiles (112px, photo 70px, name 11/700 fixed-height 29px with overflow hidden, SKU). Selected tile: 1.5px `red` border, `tint-red` background. Only active products (`is_active`) are selectable, matching the existing inline form's filter.
2. `Stepper` size `'lg'` (46px), initial value 24, min 0, no max (warehouse receiving has no upper cap — unlike Buat Transfer, which is capped by existing stock; receiving stock has no such ceiling).
3. Note/invoice field, placeholder `INV/2026/08/1183` (exact spec placeholder).
4. Live preview panel (`tint-green` bg): current stock (from `getInventorySummary('warehouse')` filtered to the selected product), `+N` in `ok` color, a divider, "Stok setelah diterima" at 20px/800 — `current + N`, recomputed on every stepper change, no calculate button.
5. CTA "Terima Barang" (52px, solid red) + "Batal" (outline) — Batal navigates back to Gudang Pusat.

**Submit:** calls existing `receiveWarehouseStock({ product_id, quantity, reason: note || undefined })` — no API change needed here. On success, navigate to `SuccessScreen` with the §23 "Terima Barang" row set: Produk (name), Quantity (`+N`), Stok akhir (computed), Referensi (the note field, or "-" if empty).

**Role:** unchanged from today — the inline form only ever showed for `isOwner`. Per the resolved decision to default Manager to Owner-equivalent unless a reason to exclude surfaces, gate the new page/link on `role === 'owner' || role === 'manager'` instead of `isOwner` alone (forward-compatible; Manager can't reach it for real until the separate Manager-role-implementation item fixes `stockistAccess.js`, but the check is already correct once that lands).

## Plan A: Buat Transfer

**File:** `frontend/src/app/admin/stockist/transfers/new/page.tsx` (full rewrite of the existing dropdown-based form).

**Layout (spec §11):**
1. Step indicator — 3 columns (Tujuan / Produk / Review), 4px bar + 10/600 label, completed steps `red`, pending `border`/`text-3`. This is a presentational stepper only (all 3 sections render on one scrollable page, as the current single-page form already does) — the indicator reflects how far the user has filled the form (destination chosen → at least one product added → ready to review), it does not gate navigation between steps. Simpler than a true multi-page wizard and matches how the current single-page form already behaves; a true wizard isn't asked for anywhere in the spec text.
2. "Cabang tujuan" — 5 branch chips (pill, 38px height, single-select), replacing the `<select>`.
3. "Produk dikirim" + `N item · N pcs` counter. Cart rows: 56px photo, name, "Gudang: N pcs" (real warehouse balance — fetch `getInventorySummary('warehouse')` on mount, something the current page never does at all), `Stepper` size `'xs'`, qty capped `max={warehouseBalance}`, min 0. A row at qty 0 stays in the cart (visible, capped) rather than disappearing — removal is explicit via a delete action, matching the existing line-based UX.
4. "Tambah Produk" — dashed border button, opens product selection (reuse the existing `<select>`-per-line pattern for choosing which product a new cart row represents, since the spec doesn't specify a distinct product-picker UI here beyond "add a line").
5. Review panel: Asal (fixed "Gudang Pusat"), Tujuan (selected branch), Total unit (Σ qty), Nilai perkiraan (`Σ qty × purchase_price`, formatted `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' })`). Products missing a `purchase_price` (nullable in `StockistProduct`) contribute 0 to the value sum, not `NaN` — flagged with a small note if any cart product lacks one, so the review total isn't silently wrong.
6. CTA "Kirim Transfer" (submits via existing `createTransfer`) + "Simpan Draft" (see below).

**Draft persistence:** `dest` and `cart` (represented as the existing `lines` array, or an equivalent `Record<product_id, qty>` — implementer's choice, whichever fits the cart-row rendering better) go through `useDraftPersistence('stockist-transfer-draft', ...)`. "Simpan Draft" is an explicit button that (a) is already continuously auto-persisted by the hook on every change, so the button's actual job is just showing a confirmation toast ("Draft tersimpan") via the existing `useToast` — no separate server call, no new draft status. Draft clears automatically after a successful "Kirim Transfer" submit.

**Backend role change:** `server/routes/stockist.js:510-515` — `POST /transfers` currently 403s anyone but `owner`. Change the check to `access.role !== 'owner' && access.role !== 'manager'`. This is additive and inert until Manager accounts can authenticate (separate item); it does not change behavior for `owner` or `branch_admin` today.

**Frontend gating to match:** `transfers/page.tsx`'s "Buat Transfer" CTA (`isOwner` check, line 70) and `warehouse/page.tsx`'s (new) receive-page gating both become `role === 'owner' || role === 'manager'`.

**Submit → SuccessScreen:** §23 "Kirim Transfer" row set: Nomor (`transfer.transfer_number`), Tujuan (destination branch name), Total unit (Σ qty), Status ("Dikirim").

## Plan B: Migration

New file `server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql`:

```sql
alter table stock_transfer_items
  add column if not exists discrepancy_reason text null,
  add column if not exists discrepancy_photo_url text null;
```

Confirmed via direct query against the production schema (`information_schema.columns`) that `stock_transfer_items` currently has only `id, stock_transfer_id, product_id, quantity_sent, quantity_received` — neither column exists today.

## Plan B: Evidence photo storage

No Supabase Storage integration exists anywhere in this codebase today (confirmed by grep — zero `storage.from(` calls server-side). Two existing public buckets (`ai-images`, `member-avatars`) establish the project's convention: public buckets, server-side upload using the service-role client already in use everywhere else in `server/routes/stockist.js`.

**New bucket:** `stockist-evidence` (public, created via `supabase.storage.createBucket` in a one-off setup script or the Supabase dashboard — implementer's choice, document whichever is used).

**New endpoint:** `POST /api/stockist/transfers/:id/items/:itemId/photo` — accepts a base64-encoded image in the JSON body (`{ data_url: string }`, matching the simplest client-side `<input type="file">` → `FileReader.readAsDataURL` flow with no new client dependency), server decodes and uploads to `stockist-evidence/{transferId}/{itemId}.jpg`, returns `{ photo_url }`. Same role gate as receive (Manager + Admin Cabang matching destination branch, never Owner), and only allowed while the transfer is still `SENT`. This endpoint does exactly one thing — store a file, return its URL — and nothing else; it does not touch `stock_transfer_items` itself. The client calls it when the user picks a photo, holds the returned `photo_url` in local state alongside that row's chosen reason, and sends both together as part of the same item entry in the final `receiveTransfer` submit (see below), which is where the URL actually gets persisted to the item.

## Plan B: `receiveTransfer` API + role change

`frontend/src/lib/stockistApi.ts:144` — `receiveTransfer`'s `items` array gains two optional fields: `reason?: string; photo_url?: string`.

`server/routes/stockist.js`'s `PATCH /transfers/:id/receive` (line 652 on):
- Validation (line 673) extends: when `quantity_received !== quantity_sent` for an item, `reason` becomes required in the request body for that item (400 if missing) — server-side enforcement of the spec's "wajib beri alasan", not just a client-side UI nicety.
- The update at line 704 (`supabase.from('stock_transfer_items').update({ quantity_received: ... })`) extends to also set `discrepancy_reason`/`discrepancy_photo_url` when present.
- **Role gate change (spec-mandated, not a Manager-role question):** the existing check only restricts `branch_admin` to their own destination branch (line 661-666); `owner` currently falls through with full access. Add an explicit check: `if (access.role === 'owner') return res.status(403).json({ error: 'owner cannot confirm receipt' });` — Owner is excluded from this action by the design regardless of whether Manager exists yet. Combined with the branch_admin destination check already in place, and a manager check added the same forward-compatible way as Buat Transfer's (no branch restriction for manager, matching Owner's current unrestricted-by-branch pattern minus the receive permission itself), the effective post-change rule is: `branch_admin` (own branch only) or `manager` may receive; `owner` may not.

## Plan B: Detail Transfer / Konfirmasi Penerimaan split

**`frontend/src/app/admin/stockist/transfers/[id]/page.tsx`** (rewrite): becomes pure Detail Transfer per spec §12 — summary card (number + status badge), asal→tujuan panel (`surface-2` bg, 14px radius, destination right-aligned), Dikirim date/time + Pengirim row, "Rincian produk" (per product: 52px photo + name + SKU, then a 3-stat grid Dikirim/Diterima/Selisih each in an 11px-radius cell, Selisih cell colored `red` when non-zero; while status is still `SENT`, Diterima and Selisih both render `—` instead of a receive form — the receive form itself moves entirely to the new confirm route), Timeline panel (11px dots, 1.5px connector, 3 events: dibuat `ok` dot, dikirim `red` dot, menunggu konfirmasi `border` dot — today's file only has 2 events; add the 3rd), and a "Konfirmasi Penerimaan" CTA that only renders when `transfer.status === 'SENT'` AND the viewer's role is `manager` or `branch_admin` (never `owner`) — linking to the new confirm route.

**`frontend/src/app/admin/stockist/transfers/[id]/confirm/page.tsx`** (new): Konfirmasi Penerimaan per spec §13.
1. Info banner (`tint-blue`, `info` icon): exact copy "Hitung fisik barang dulu, lalu isi quantity yang benar-benar diterima. Selisih wajib diberi alasan."
2. Per-product row (1.5px border): default state `surface` bg / `border` border / "SESUAI" badge (`ok`) when the current stepper value equals `quantity_sent`; the moment it differs, the row switches live to `tint-yellow` bg / `warn` border / "SELISIH" badge (`warn`) — computed per-row on every stepper change, no submit needed to see the state flip. Row contents: 54px photo, name, "Dikirim N pcs", the badge, then "Diterima fisik" label with `Stepper` size `'sm'` (40px).
3. Reason block — appears/disappears automatically per-row the instant that row's diff is non-zero (spec: "muncul otomatis"): `tint-yellow` panel, `warn` border, "Selisih N pcs · wajib beri alasan", 3 single-select chips (Kurang kirim / Rusak di jalan / Salah hitung), and a dashed "Unggah foto bukti" button (`photo_camera` icon) that opens a file picker, uploads via the new endpoint, and shows a thumbnail once uploaded. Chip selection is required before submit is enabled for any row currently showing a discrepancy (client-side gate backing the server-side 400).
4. Summary panel: Total dikirim, Total diterima, divider, Selisih at 20px/800 (`ok` color if the aggregate is 0, `warn` otherwise).
5. CTA "Konfirmasi Penerimaan" + "Simpan Draft" — same pattern as Buat Transfer: the per-product `confirm`/`reasons` state is continuously auto-persisted via `useDraftPersistence`, "Simpan Draft" just toasts confirmation. Draft clears on successful submit.

**Offline behavior:** `useOnlineStatus()` (new hook, `navigator.onLine` plus `window.addEventListener('online'/'offline', ...)`, SSR-guarded like the draft hook) drives the already-built-but-unused `OfflineBanner` component at the top of this page, and disables the submit CTA with a tooltip/inline note while offline — matching spec §24's Offline state copy ("Koneksi sedang bermasalah." / "Data terakhir masih ditampilkan.") rather than attempting a background sync queue. The draft persisting locally means no data is lost while offline; the user simply cannot submit until connectivity returns, which they're told directly.

**Submit → SuccessScreen:** two copy variants per §23's table, chosen by whether the aggregate discrepancy is 0:
- No discrepancy: title "Penerimaan dikonfirmasi", rows Transfer/Dikirim/Diterima/Selisih (Selisih = "0").
- Discrepancy: title "Diterima dengan selisih", same rows, Selisih = `"N pcs"`.

## Out of scope (explicitly deferred, not silently dropped)

- Transfer list's Draft/Ada Selisih filter chips (spec §10) — the underlying data model has no transfer-level DRAFT status (this plan's "Simpan Draft" is local-only, never touches the server) and no transfer-level discrepancy flag. Adding those would mean inventing new transfer states beyond SENT/RECEIVED, which is its own product decision, not implied by anything asked for here. Left for a future pass if the user wants it.
- Detail Produk's "Terima Barang" action button (spec §8) — Detail Produk itself is gap-audit item #9, not yet rebuilt. The new Terima Barang route accepts a `?product=` param so wiring it in later is a one-line change, not a redesign.
- Kirim Opname's SuccessScreen call site — belongs to the Stock Opname rebuild (item #7), which will reuse the `SuccessScreen` component built here.
- True background sync / request replay queue for offline submissions — spec's States section only describes the passive banner-and-block behavior; a real queue (retry, conflict handling, dedup) is a materially larger project the spec text doesn't call for.
