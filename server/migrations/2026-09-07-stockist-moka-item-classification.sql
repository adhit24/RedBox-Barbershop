-- Moka -> Stockist product classification layer.
--
-- Root cause this fixes: a 2026-08-20 bulk import created 236 "MOKA-<hash>"
-- SKU products (and 457 active moka_item_mappings rows across all 5
-- outlets) directly from Moka's full item catalog, with NO filtering for
-- services/food/drink/packaging. Every one of those rows was marked
-- product_type=RETAIL and is_active=true, meaning any of them being sold
-- would silently deduct "Stockist inventory" for things like coffee, tea,
-- snacks, ice cream, and packaging. Two ice cream flavors already did so
-- (see the 2026-09-07 production canary audit). Meanwhile 119 genuinely
-- non-stock items (haircuts, grooming packages, drinks, tips, custom
-- amounts, membership tiers) were correctly left unmapped but had no way
-- to be marked "intentionally irrelevant" and would keep re-appearing as
-- UNMAPPED_PRODUCT anomalies forever.
--
-- Reuses the existing moka_item_mappings table (per the design brief's own
-- "do not create a new table if an existing structure can safely support
-- this") rather than adding a parallel classification table.
--
-- Safe to re-run. Does not touch inventory_ledger, inventory_balances, or
-- any existing SALE_MOKA row.

BEGIN;

ALTER TABLE moka_item_mappings ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE moka_item_mappings
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'STOCK_PRODUCT'
    CHECK (classification IN ('STOCK_PRODUCT', 'NON_STOCK_SERVICE', 'NON_STOCK_MISC', 'REVIEW_REQUIRED'));
ALTER TABLE moka_item_mappings
  ADD COLUMN IF NOT EXISTS classification_reason TEXT;

-- A row can only be used to deduct Stockist inventory if it is both
-- classified as a real stock product AND actually points at one.
ALTER TABLE moka_item_mappings DROP CONSTRAINT IF EXISTS chk_moka_item_mapping_stock_requires_product;
ALTER TABLE moka_item_mappings
  ADD CONSTRAINT chk_moka_item_mapping_stock_requires_product
  CHECK (classification != 'STOCK_PRODUCT' OR product_id IS NOT NULL);

COMMIT;
