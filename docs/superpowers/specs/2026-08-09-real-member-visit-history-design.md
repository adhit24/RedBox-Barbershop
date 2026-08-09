# Real Member Visit/Points History from Moka

## Problem

`GET /api/member/history` and the dashboard's Riwayat Kunjungan/Riwayat Poin tabs currently show real per-visit data only for the site's own online booking flow (`bookings` table) — nothing from actual in-person Moka POS visits, which are the vast majority of real activity. When no real rows exist, the endpoint and the client both fall back to synthesizing a single "Kunjungan tercatat dari RedBox" / "Saldo poin tersinkronisasi" summary row from the member's aggregate `total_visits`/`total_points` counters (see `2026-08-09-tiered-membership-ui-redesign-design.md`'s unrelated tier work, and the `[History]`-tagged fix commits from tonight). That fallback correctly stops the tabs from looking broken, but it isn't real history — a member can't see which visit earned what, or when.

## Root cause / opportunity

`POST /api/member/sync` (`server/index.js`) already does the hard part: on every member login, it calls `MokaClient.getTransactionPage()` (Moka's `/v3/outlets/{id}/reports/get_latest_transactions` report API), which — per the client's own docstring — embeds `customer_phone`/`customer_name`/`customer_email` in every payment. The sync loop already paginates through **all** of a member's matching transactions across all outlets (bounded only by a time budget, not by "since last sync"), filters by normalized phone, and accumulates `totalVisits`/`totalSpent`/`lastVisit`/`firstVisit` — then **discards every individual transaction**, keeping only the sums.

This means the reliable, customer-linked data source already exists and is already being read in full on every login. The gap is purely that nothing persists the individual transactions.

(The separate 5-minute cron job, `server/moka/txSync.js`, writes to `moka_transactions`/`moka_barber_services` via a *different* Moka endpoint — `getPaidTransactionsPage`, `/integrations/mokapos/.../reporting/transactions` — built for barber revenue-share attribution. Confirmed via live schema query: that table has no customer-identity column, and the endpoint's response shape isn't documented to include one. Out of scope for this feature; not touched.)

## Design

### 1. New table: `member_visit_history`

```sql
CREATE TABLE member_visit_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key        text NOT NULL,
  receipt_number  text NOT NULL,
  outlet_slug     text,
  visit_date      date NOT NULL,
  visit_time      text,
  service_summary text,
  amount          integer NOT NULL DEFAULT 0,
  points_earned   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_number)
);
CREATE INDEX member_visit_history_user_key_idx ON member_visit_history (user_key, visit_date DESC);
```

`receipt_number` is globally unique per the Moka side (confirmed by `txSync.js`'s existing `onConflict: 'receipt_number'` usage on a different table) — a transaction cannot recur with the same receipt, so it's the natural idempotency key for repeated syncs.

### 2. `/api/member/sync` writes real rows during the existing matching loop

In `server/index.js`'s `POST /api/member/sync`, inside the `for (const p of payments)` loop where a payment is currently matched to the target phone (`if (norm !== targetNorm) continue;`), after incrementing `totalVisits`/`totalSpent`:

- Extract `receiptNumber` from the payment (mirroring the field-probing pattern already used in `server/moka/txSync.js`: `p.receipt_number || p.receipt_no || p.id`).
- Extract a service/item summary if the payment shape includes one (best-effort; `null` if not present — this endpoint's exact item-field name isn't yet confirmed the way `txSync.js`'s is, so this is additive, not required).
- Collect matched payments into an array instead of only summing them.

After the matching loop completes (all outlets/pages processed, same place `totalVisits`/`totalSpent`/`lastVisit`/`firstVisit` are finalized):

- `UPSERT` the collected rows into `member_visit_history` with `onConflict: 'receipt_number', ignoreDuplicates: true` — a single batched upsert, not one query per row.
- Write matching rows into `member_point_transactions`, one per matched payment, `points: POINTS_PER_VISIT` (50, the existing constant), `activity: 'Kunjungan Moka'`, `notes: `moka-visit:${receiptNumber}`` — `member_point_transactions` has no unique constraint to upsert against (same reason `recordPointLedgerDelta` already does a lookup-before-insert in this file), so dedup is done with a **single batched query** before the insert loop: `SELECT notes FROM member_point_transactions WHERE user_key = $1 AND notes LIKE 'moka-visit:%'`, built into a `Set`, then only payments whose `moka-visit:${receiptNumber}` isn't already in that set get inserted. This avoids one dedup query per matched payment.
- The existing `recordPointLedgerDelta` call (which writes one lump "Sinkronisasi poin Moka" delta row) is **removed** — per-transaction rows now cover what it was approximating in aggregate. `total_points`/`total_visits` continue being written exactly as today (`Math.max` against existing, never downgrading), unchanged.

Because this loop already re-walks a member's **entire** matching transaction history (not incremental-since-last-sync), the first login after this ships populates their full real history in one pass. Every login after that only inserts rows for genuinely new receipts (the `ignoreDuplicates`/notes-lookup guards make repeat syncs cheap no-ops for already-known transactions).

### 3. `/api/member/history` reads real visit rows

In `GET /api/member/history` (`server/index.js`), alongside the existing `bookings` query, add a `member_visit_history` query (by `user_key`, ordered by `visit_date DESC`, limited to 100) and merge its rows into the `bookings` array returned to the client, mapped into the same shape `renderBookingsHistory` already expects (`date`, `time`, `status: 'done'`, `service` from `service_summary`, `price` from `amount`, `location` from `outlet_slug`). The existing single-row aggregate-fallback logic (both server-side and the client's `renderMemberHistoryFallback`) is untouched — it now only ever activates for the (shrinking, eventually near-zero) window of a member's history that predates their first login under this change.

`points` in the same response already reads `member_point_transactions` — no query change needed there, it will now return real per-visit rows automatically once step 2 starts writing them.

### 4. Not in scope

- The Google/email-login sync path (`js/dashboard.js`'s Supabase-direct block) has no equivalent live Moka pull today and isn't gaining one here — it continues reading whatever `member_point_transactions`/`bookings` rows exist (which will include real Moka-sourced rows once an OTP-login member has synced, since both login methods key off the same `user_key`/phone identity where linked) plus the aggregate fallback.
- Bulk cron sync (`/api/moka/sync-member-points`, `server/moka/routes.js`) is not being changed to also write detail rows — per the approved design, only the login-triggered `/api/member/sync` path does, keeping this change small and scoped to one call site.
- Historical backfill for members who never log in again is out of scope — their history stays on the aggregate-fallback summary row indefinitely, which is the existing, already-shipped behavior.

## Testing

- Unit test: the receipt-number extraction/dedup logic, isolated from the network loop.
- Contract test (existing convention): `server/index.js` contains the `member_visit_history` upsert inside the sync route, with `onConflict: 'receipt_number'`.
- Contract test: `/api/member/history`'s query includes `member_visit_history`.
- Manual verification: log in as a member with known Moka history, confirm Riwayat Kunjungan shows individual real visits (not the single aggregate row) after first sync; log in again, confirm no duplicate rows.
