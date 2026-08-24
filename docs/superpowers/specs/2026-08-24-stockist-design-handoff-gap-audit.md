# RedBox Stockist — Design Handoff Gap Audit

**Date:** 2026-08-24
**Source of truth audited against:** `design_handoff_stockist_mobile/README.md` (24 screens + design tokens + interactions/state-management rules)
**Method:** 4 parallel read-only research agents — screens 1-8, screens 9-15, screens 16-24, and cross-cutting (tokens/interactions/role-gating). Full agent reports are not reproduced verbatim here; this is the synthesized, prioritized version. The raw findings live in this session's transcript if deeper citation detail is needed later.

This document is the master backlog for closing RedBox Stockist's remaining gap against the design handoff. It supersedes ad-hoc screenshot-driven work.

---

## Already fixed (2026-08-24, commit 764b1ce)

Dark-theme color tokens: `--color-surface-elevated` (#1E1A1B), `--color-surface-container` (#241F20), `--color-primary-container` dark override (#E33A32, was inheriting light's less-contrasty value). Light theme was already an exact match, no changes needed.

**Open question, not yet resolved:** `--color-danger`/`--color-status-habis` (dark) = `#E0504B`, but light theme's `--color-danger` exactly equals light's primary red — by the same pattern dark's danger probably should equal dark's primary red (`#E33A32`) too, but the handoff has no separate "danger" token to confirm this against directly. Needs a decision, not a guess.

---

## Foundational / shared work (do these first — many screens depend on them)

1. **Manager role does not exist at any layer.** Server: `server/services/stockistAccess.js` hardcodes `['owner','branch_admin']`. Frontend: `layout.tsx`, `stockistRole.ts`, and ~15 individual page-level `isOwner`/`access.role` gates are all binary. This blocks Beranda (Owner&Manager variant), Detail Transfer's confirm-receipt CTA, and the entire Manager beranda/flow. **Needs a dedicated plan.** See "Decisions needed" below — several specific permissions beyond the 2 the README names explicitly aren't decided yet.
2. **No shared `Stepper` component** (`−`/qty/`+`, 40-46px buttons). Needed by Terima Barang, Buat Transfer, Konfirmasi Penerimaan, Stock Opname — 4 screens currently all use plain `<input type="number">` instead. Build once in `components/stockist/`, reuse everywhere.
3. **No toast component.** Spec: dark pill, `check_circle` icon, floats 96px from bottom, auto-dismiss 2200ms, used for actions with no destination screen (e.g. future "Simpan Draft"). Currently zero toast implementation anywhere in the stockist app — `confirm()` dialogs and inline banners are used instead, which are semantically different (blocking vs. transient).
4. **No offline-first infrastructure.** Required explicitly by the spec for Konfirmasi Penerimaan and Stock Opname (save locally, sync when online, offline banner). Zero `navigator.onLine` usage, zero localStorage draft persistence anywhere in the stockist tree. The one registered service worker explicitly does no request interception ("caching caused errors").
5. **Motion system is broken in two ways**: (a) `animate-fade-in` — the class used across 21 files for screen-entrance animation — is not defined anywhere (no keyframe, no Tailwind v4 `@theme` token), so it's a silent no-op on ~23 of 24 screens; the one real match (`fadeSlideItem` in `lib/stockist/motion.ts`, timing correctly matches spec's `rbup`) is wired up on only the Beranda screen. (b) `rbshim` shimmer is correctly timed but uses hardcoded slate colors instead of theme tokens (won't adapt to light/dark) and is never actually used — real skeletons use Tailwind's default `animate-pulse` instead. (c) Spec explicitly says "no scale or lift," but `cardHover`/`active:scale-95` are used in several places (StatCard, LocationCard, bottom nav, buttons).
6. **States components don't match spec shape, 3 of 6 don't exist at all.** Existing-but-wrong: validation-error banners (correct semantics, copy-pasted per page instead of a shared component), loading skeleton (`SkeletonCard` uses `animate-pulse` not `rbshim`, wrong shape — no 60px block placeholder), empty state (solid border not dashed, wrong icon size, hardcoded green tint regardless of context, no action-button slot so it can't support "Reset filter"). Missing entirely: offline banner, session-expired screen, no-access screen.
7. **4 "Layar Sukses" (Success) screens don't exist at all.** None of the triggering flows (Terima Barang, Kirim Transfer, Konfirmasi Penerimaan, Kirim Opname) navigate to a dedicated success screen — they show inline banners and stay on the same page. Needs the shared success-screen component plus 4 call sites.
8. **Stock status derivation is correct but duplicated ~8 times** with no shared utility — works today, but a latent bug risk (a future rule change would need updating in 8 places).
9. **Reorder point is stored, not computed.** Spec: `min + 4`, always derived. Live: a freestanding editable DB column, never computed from `minimum_stock`. This is a data-model decision, not just a UI fix — needs product confirmation before changing (does existing data get migrated/recomputed, or does the column just get removed and always derived?).

---

## Per-screen gaps (grouped, high-signal only — see audit agents' full findings in-session for file:line detail on every item)

**Screens 1-8:**
- Login: cosmetic gaps only (logo size, copy, missing footer disclaimer) — real auth vs. spec's prototype-auth divergence is correct and expected.
- Beranda Owner & Manager: hero trend pill missing (no backend delta available), 2 of 4 metric-grid cards are inert (no navigation), "Perlu perhatian" row drops SKU, "Aset per lokasi" duplicates a Recharts bar chart + a separately-colored LocationCard list instead of spec's single per-location-tinted bar panel.
- Beranda Admin Cabang: **missing the entire top "kartu kiriman" hero banner** (pending-transfer alert card) — the single most visible element of this screen per the mockup. Wrong metric cards, wrong quick-actions set (no "Konfirmasi Kiriman"/"Lihat Stok"), row metadata missing "min N pcs".
- Stok hub: essentially matches (1 copy nit, 1 sizing nit).
- Produk / Gudang Pusat / Stok Cabang: spec wants ONE 3-mode list component; live has 3 unrelated bespoke pages, none with the scanner icon, none fully matching the card/status-dot/chip pattern. Branch-admin's Produk view shows no stock quantity at all. Owner's header search button routes to a non-searchable stats page instead of the actual searchable list.
- Detail Produk: no price fields shown for ANY role (not just gated wrong — absent), no cross-location distribution panel, zero action buttons (Edit/Terima Barang/Nonaktifkan all missing).

**Screens 9-15:**
- Terima Barang: no carousel (plain dropdown), no stepper, no live preview panel (current→+N→after), no Batal button.
- Transfer list: missing Draft/Ada Selisih filter states (the underlying data model only has SENT/RECEIVED — no DRAFT status, no transfer-level discrepancy flag), title doesn't change per role.
- Buat Transfer: no step indicator, destination is a dropdown not chips, **qty not capped by warehouse stock at all** (page doesn't even fetch warehouse balances), **no transfer-value calculation** (purchase_price never referenced), no review panel, wrong stepper minimum (1 not 0).
- Detail Transfer / Konfirmasi Penerimaan: merged into one file with no role gating on who can confirm (currently anyone, spec wants Manager+Admin Cabang only, explicitly excluding Owner). **Mandatory reason-for-discrepancy is not in the API request type at all** — `receiveTransfer()` only accepts `{item_id, quantity_received}`, no `reason` field exists anywhere in the payload. No SESUAI/SELISIH badges, no reason-chip UI, no photo upload, no aggregate total panel, not offline-first.
- Inventory Ledger: no filter chips at all, no per-type icon/tint, missing location and operator fields (both exist in the data type, just never rendered).
- Stock Opname: confirmed — no progress card, no scan button, plain inputs not stepper, no COCOK/LEBIH/KURANG badges, not offline-first. Also: the live app has an extra DRAFT→SUBMITTED→APPROVED owner-approval workflow the spec doesn't describe at all — **this is a real product-behavior question, not a UI gap:** does opname submission require owner approval before stock adjusts, or should it apply directly like the spec implies?

**Screens 16-24:**
- Requests/Returns: row structure missing a middle "detail" line; Returns' CTA copy is wrong ("Ajukan Retur" should be "Buat Retur").
- Stok Pemakaian / Insight: both are functionally richer than the spec's generic document list (real open/close usage lifecycle; a live computed decision-support dashboard) but structurally unrelated to spec. **Product decision needed:** keep the richer live UX and treat spec as superseded, or restyle to match spec's plainer list.
- **Notifikasi has a live bug**: category→tint color mapping doesn't work — every category renders the same blue tint regardless of Stok/Transfer/Pengiriman/Sistem, even though the icon glyph does vary correctly. Quick, precise fix (`notifications/page.tsx:110-111`).
- Profil: avatar is circular/solid-red/white-text; spec wants square-radius-18/tint-red/red-text. Missing rows: Hak akses, Ganti password, Bantuan. Missing version footer.
- Scan Barcode: confirmed nothing pre-existing conflicts with the in-progress `BarcodeScannerSheet` work.
- Success screens (4 variants): confirmed missing, see foundational item 7.
- States: confirmed gaps, see foundational item 6.

**Cross-cutting:**
- Bottom nav: binary role split (blocks Manager), wrong icon system (lucide-react instead of Material Symbols, no FILL-1 active state) — though sub-route "stays active" behavior works by accident of prefix-matching.
- Header: role-aware titles not implemented (Transfer screen keeps "Transfer" title for Admin Cabang instead of spec's "Barang Masuk"), back button shows on every non-root route instead of being genuinely stack-aware (shows even on bottom-nav tab roots, which per spec should never show back).

---

## Decisions — resolved 2026-08-24

1. **Manager's permission boundary — RESOLVED.** Manager gets inventory-adjustment approval, and approve/reject on Permintaan Stok / Retur / Stock Opname — all "same as Owner," consistent with the README's "Manager = Owner minus deactivate-product, plus confirm-receipt" framing (these approvals aren't in the 2 named exceptions, so they default to Owner-equivalent). Still open, not yet asked: reactivate-product, Terima Barang (warehouse receiving), Insight dashboard access, per-branch detail view access — treat these the same way (default to Owner-equivalent) unless a reason to exclude Manager surfaces during implementation.
2. **Stock Opname approval step — RESOLVED: keep it.** The DRAFT→SUBMITTED→APPROVED workflow stays (do not remove it to match the mockup's implied direct-submit flow). Approval authority extends to both Owner and Manager (per decision #1) — the existing `canApprove`/owner-only gate on the opname approve action needs to become `role === 'owner' || role === 'manager'`, not removed.
3. **Insight and Stok Pemakaian — RESOLVED: simplify to match the mockup.** Restyle both to the spec's generic document-list pattern (row: title/number + badge, detail line, meta line; CTA "Ekspor Insight" / "Catat Pemakaian"). Interpretation to apply when implementing: this is a **visual/structural restyle**, not a mandate to delete working functionality — Stok Pemakaian's real open/close usage lifecycle (`openServiceUsage`/`finishServiceUsage`, PIC assignment, stock deduction) and Insight's real computed decision-support data should still work, just presented through the spec's list-row shape instead of the current bespoke dashboard layout. If this interpretation turns out wrong once in progress (i.e. the user actually wants the underlying capability removed, not just restyled), stop and confirm before deleting anything — restyling is reversible, deleting working mutations is not.

## Still open — not yet asked, revisit when reached

4. **Reorder point**: derive as `minimum_stock + 4` everywhere, or keep as an independently-set value with the formula as just a default? Ask when this item is reached in the execution order.
5. **`--color-danger`/`--color-status-habis` dark-mode value** — align to `#E33A32` (matching the light-theme pattern) or leave as `#E0504B`? Ask when reached.
6. **Beranda Owner's "Perlu Perhatian"/"Transfer Berjalan" cards** open an in-place `BottomSheet` drill-down instead of navigating to a filtered Gudang Pusat page like the spec describes. This is the same category of question as the Insight/Stok Pemakaian decision — the live BottomSheet approach may well be better UX than the mockup's plain navigation, but it's a real product call, not something to decide alone. Ask when reached.
7. **Beranda Owner's "Aset per lokasi" panel** duplicates the same per-location asset-value data in two visualizations (a `HorizontalBarChart` using Recharts with every bar hardcoded to the same red, plus a separate `LocationCard` list whose progress bar is also always `bg-primary-container` regardless of location) — spec wants ONE panel with per-location semantic-color bars (Gudang Pusat=red, Bypass=red-soft, CSB Mall=info, Samadikun=warn, Sumber=ok, Tegal=text-3). `LocationCard` is already richer than spec (SKU count, low-stock count, click-to-drill-down) so the fix is likely: drop the redundant `HorizontalBarChart`, keep `LocationCard`'s list, add per-location-id color mapping to its progress bar. Deferred (not done autonomously) because it needs the real `location_id` slug values verified and a properly reviewed implementation, not a rushed one.
8. **Beranda Owner's "Perlu perhatian" row drops the product SKU** (spec wants it, per the shared row format used elsewhere: name + SKU + location). Found during the same audit pass, but fixing it requires a **backend change** — `GET /api/stockist/dashboard/assets`'s `attention_items` array (`stockistApi.ts:328-336`) doesn't include `product_sku` at all, only `product_id`/`product_name`. Deferred, not done autonomously, since even a small additive backend field change should get the user's active review rather than landing silently.

(Items 6-8 found and scoped during an autonomous session tick on 2026-08-24, while executing the already-established Beranda Owner rebuild item in the suggested order below. The one safe, unambiguous, zero-decision fix from that same screen — making the inert "Total Produk"/"Total Stok" cards navigable to `/admin/stockist/products` and `/admin/stockist/warehouse` per spec — was made directly, commit `3b58f92`, PR pending.)

---

## Suggested execution order

1. Foundational items 2, 3, 5, 6 (Stepper, toast, motion system fix, States components) — small, shared, unblock multiple screens each, no open product decisions.
2. Notifikasi category-tint bug fix — tiny, isolated, already scoped.
3. Beranda Admin Cabang rebuild (missing hero banner is the most visible live gap).
4. Beranda Owner & Manager rebuild.
5. Product Master / Gudang Pusat / Stok Cabang consolidation into the spec's 3-mode list pattern (largest single item — touches routing/architecture, not just visuals).
6. Terima Barang, Buat Transfer, Konfirmasi Penerimaan rebuilds (each needs the Stepper from #1 first; Konfirmasi Penerimaan additionally needs the reason-for-discrepancy API change and offline-first infra).
7. Stock Opname rebuild (needs Stepper + offline-first infra).
8. Success screens (4 variants) + remaining States wiring into each flow.
9. Profil fixes, Ledger filter chips, Detail Produk rebuild, Requests/Returns row-structure fixes.
10. Manager role implementation (server access layer, frontend gates, nav, Beranda) — sequenced last only because it depends on the "Decisions needed" §1 answers; the technical checklist itself is otherwise fully ready to execute in parallel with the above once those decisions land.

This ordering is a recommendation, not a constraint — items 1-9 have no dependency on the Manager-role decisions and can be resequenced freely.
