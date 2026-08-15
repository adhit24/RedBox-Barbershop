# Membership Points Recalculation Design

## Goal

Make Redbox loyalty points follow the real business rule: **1 point for every Rp10,000 of eligible transaction value**, rounded down per receipt. Paid membership purchases (Silver, Gold, Platinum) do **not** earn points.

## Source of truth

- Paid membership tier comes from `member_activations` / `member_profiles.current_tier` and is independent of points.
- Loyalty points come from completed Moka receipts.
- Receipt/payment ID is the idempotency key so the same transaction cannot be credited twice.
- Points are computed from eligible line items, not visit count and not a flat points-per-visit constant.

## Eligible amount rule

For each completed, non-refunded Moka receipt:

1. Read the receipt line items/checkouts.
2. Exclude membership-purchase items. At minimum this includes variants/items that represent paid membership tiers such as `Member Silver`, `Member Gold`, and `Member Platinum`, including equivalent membership-category records.
3. Sum the remaining eligible item value after item-level discounts/refunds represented by the Moka payload.
4. Calculate `points_earned = floor(eligible_amount / 10000)`.
5. If `eligible_amount < 10000`, award 0 points.

Example: Sugiono's Rp1,800,000 receipt contains two Baron Grooming items at Rp150,000 each plus Member Platinum Rp1,500,000. Eligible amount is Rp300,000, therefore the receipt earns 30 points.

## Data flow

The Moka transaction-sync path remains responsible for importing completed receipts. A focused loyalty-points component will derive the eligible amount and points from each receipt and persist one visit-history row plus one point-ledger row per receipt. The write must be idempotent by receipt number/payment ID.

`member_profiles.total_points` and `customers.points` must be reconciled from authoritative point-ledger totals after sync/recalculation rather than from `visits * 50`.

## Historical recalculation

Existing members whose balances were produced by the legacy flat `50 points per visit` logic must be recalculated from available completed Moka transaction history. Recalculation must:

- preserve paid membership tier, activation period, and payment audit rows;
- exclude paid membership purchases from eligible spend;
- ignore refunded/deleted transactions;
- rebuild or reconcile per-receipt point-ledger rows without duplicates;
- update aggregate point balances only after the per-receipt calculation succeeds;
- produce an auditable before/after result for Sugiono before changing his production balance.

## Sugiono acceptance criteria

For customer `+6281395830888`:

- Platinum remains ACTIVE for the existing paid period.
- The Rp1,500,000 Member Platinum line earns 0 points.
- The two Rp150,000 Baron Grooming lines on the Rp1,800,000 receipt contribute Rp300,000 eligible spend and 30 points.
- Historical total points are recalculated from all available completed eligible Moka receipts rather than `18 visits * 50`.
- `member_profiles.total_points`, `customers.points`, `member_point_transactions`, and `member_visit_history` agree after reconciliation.

## Error handling and safety

- Never mutate membership tier or membership activation audit data during points recalculation.
- Never credit a receipt twice.
- Never replace a valid balance with a partial calculation if Moka history retrieval is incomplete or errors.
- Recalculation must run in an auditable sequence: calculate -> compare -> persist ledger/history -> update aggregates -> verify.
- If receipt line-item data is insufficient to determine eligible spend safely, mark the receipt unresolved and do not guess.

## Tests

Tests must cover:

- Rp95,000 eligible receipt -> 9 points.
- Rp100,000 eligible receipt -> 10 points.
- Rp1,800,000 Sugiono-style receipt with Rp1,500,000 Member Platinum + Rp300,000 services -> 30 points.
- membership-only receipt -> 0 points.
- duplicate receipt -> no second credit.
- refunded/deleted receipt -> 0 credit.
- paid Platinum tier remains Platinum regardless of recalculated point balance.
- aggregate balance equals the sum of authoritative point-ledger rows after reconciliation.
