-- Deterministic, idempotent backfill for moka_item_mappings.classification.
--
-- Companion to 2026-09-07-stockist-moka-item-classification.sql, which
-- changed the column default to REVIEW_REQUIRED (safe) instead of
-- STOCK_PRODUCT (unsafe). That default alone leaves existing rows
-- unclassified on any environment that already has the 2026-08-20
-- bulk-imported Moka catalog. This migration re-derives the SAME
-- classification decisions from stable, git-tracked rules — Moka category
-- names on `products`, and known non-stock item names surfaced as real
-- UNMAPPED_PRODUCT anomalies — rather than relying on ad-hoc production
-- mutations that exist outside git history.
--
-- Safe to re-run on any environment:
--   - the two UPDATEs are idempotent (IS DISTINCT FROM guards — a second
--     run touches zero rows once classification already matches)
--   - the INSERT is idempotent via the pre-existing
--     uq_moka_item_mapping_scope unique index (ON CONFLICT DO NOTHING)
-- On an environment with no bulk-imported products or anomalies yet
-- (e.g. a fresh install), every statement here simply affects 0 rows —
-- the REVIEW_REQUIRED default from the companion migration is what keeps
-- any future occurrence of these items safe until this backfill (or a
-- human) classifies them.
--
-- Does not touch inventory_ledger, inventory_balances, or any SALE_MOKA
-- row.

BEGIN;

-- 1. Genuine RedBox retail/merchandise categories from the 2026-08-20
--    bulk import — verified against actual product names in that audit
--    (Pomade/Parfum/Hair* = haircare retail; Accessories = "Sisir Rambut"
--    combs; Merchandise = keychains/mugs/tumblers), not assumed from the
--    category label alone.
UPDATE moka_item_mappings m
SET classification = 'STOCK_PRODUCT',
    classification_reason = 'Backfilled 2026-09-07: Moka category "' || p.category || '" matches verified RedBox Stockist retail/merchandise (product name evidence recorded in the 2026-09-07 mapping audit).',
    updated_at = now()
FROM products p
WHERE m.product_id = p.id
  AND p.sku LIKE 'MOKA-%'
  AND p.category IN (
    'Pomade', 'Parfum', 'Hair Product', 'Hair Treatment', 'Treathment',
    'Hair Styling', 'Hair System', 'Accessories', 'Merchandise'
  )
  AND m.classification IS DISTINCT FROM 'STOCK_PRODUCT';

-- 2. Confirmed non-stock food/drink/packaging/misc categories from the
--    same import — verified against actual product names (e.g.
--    "Uncategorized" contains "Kacang Goreng" / packaging supplies, not
--    haircare retail).
UPDATE moka_item_mappings m
SET classification = 'NON_STOCK_MISC',
    classification_reason = 'Backfilled 2026-09-07: Moka category "' || p.category || '" is food/drink/packaging, not RedBox Stockist retail. Was wrongly auto-mapped as RETAIL by the 2026-08-20 bulk import.',
    is_active = false,
    updated_at = now()
FROM products p
WHERE m.product_id = p.id
  AND p.sku LIKE 'MOKA-%'
  AND p.category IN (
    'Coffee', 'Tea Base', 'Snack', 'Drink', 'Dessert', 'Non Coffee', 'Soft Drink',
    'Tea', 'Food', 'Topping', 'CoffeeShop', 'Beverage', 'Barang Pakai', 'Ice Cream', 'Uncategorized'
  )
  AND m.classification IS DISTINCT FROM 'NON_STOCK_MISC';

-- 3. Known non-stock service/drink/administrative items, re-derived from
--    real UNMAPPED_PRODUCT anomaly evidence (haircuts, grooming packages,
--    coffee/drinks, tips, membership tiers, custom amounts). Inserted as
--    classification-only rows (product_id NULL) scoped to the exact
--    outlet + Moka item/variant IDs the anomaly was seen on, so they can
--    never be mistaken for a different, unrelated item at another outlet.
INSERT INTO moka_item_mappings (moka_item_id, moka_variant_id, product_id, outlet_id, is_active, classification, classification_reason)
SELECT DISTINCT
  a.moka_item_id,
  a.moka_variant_id,
  NULL::uuid,
  a.outlet_id,
  false,
  CASE
    WHEN trim(a.detail->>'name') IN (
      'Hair Cut', 'Hair Cut with Fade', 'Hair Cut+', 'Hair Cut Long Trim', 'Hair Colouring',
      'Hair Curly', 'Hair Spa', 'Beard & Mustache', 'Shave', 'Charcoal Deep Cleansing',
      'Deep Clean White', 'Redbox Baron Grooming', 'Redbox Baron Grooming +',
      'Redbox Gentleman Grooming', 'Redbox Gentleman Grooming+', 'Redbox Gentlemen Grooming',
      'Redbox Noble Grooming', 'Redbox Earl Grooming', 'Redbox Duke Grooming'
    ) THEN 'NON_STOCK_SERVICE'
    ELSE 'NON_STOCK_MISC'
  END,
  'Backfilled 2026-09-07 from real production anomaly evidence: "' || trim(a.detail->>'name') || '" is not a RedBox Stockist retail product (haircut/grooming service, drink/food, or POS administrative line item such as Custom Amount/TIPS/membership tier).'
FROM moka_stockist_anomalies a
WHERE a.anomaly_type = 'UNMAPPED_PRODUCT'
  AND a.detail->>'name' IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
