-- Attach the imported location-scoped costs to existing Stockist products.
-- Existing balances are deliberately untouched; this only makes the owner
-- asset valuation use the verified Moka cost for matching legacy/Moka SKUs.

BEGIN;

INSERT INTO inventory_purchase_prices (
  location_id, product_id, purchase_price, retail_price,
  source, source_moka_variant_id, source_margin_pct
)
SELECT target_location.id,
       target_product.id,
       source_price.purchase_price,
       source_price.retail_price,
       'MOKA_ITEM_LIBRARY_BACKFILL',
       source_price.source_moka_variant_id,
       source_price.source_margin_pct
FROM inventory_purchase_prices source_price
JOIN products source_product ON source_product.id = source_price.product_id
JOIN inventory_locations target_location ON target_location.id = source_price.location_id
JOIN products target_product ON target_product.is_active = TRUE
  AND (
    target_product.name = source_product.name
    OR target_product.name = regexp_replace(source_product.name, '^Redbox Pomade - ', '')
  )
WHERE target_product.id <> source_product.id
ON CONFLICT (location_id, product_id) DO UPDATE SET
  purchase_price = EXCLUDED.purchase_price,
  retail_price = EXCLUDED.retail_price,
  source = EXCLUDED.source,
  source_moka_variant_id = EXCLUDED.source_moka_variant_id,
  source_margin_pct = EXCLUDED.source_margin_pct,
  updated_at = NOW();

COMMIT;
