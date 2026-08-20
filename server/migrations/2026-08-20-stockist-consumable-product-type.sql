-- Add CONSUMABLE product type for non-service supplies (paper bag, cup,
-- packaging) that must be filterable separately from RETAIL and from the
-- SERVICE/SERVICE_CONSUMABLE/BOTH service-use lifecycle.
-- Safe to re-run after 2026-08-19-stockist-service-consumables.sql.

BEGIN;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('RETAIL', 'SERVICE', 'SERVICE_CONSUMABLE', 'BOTH', 'CONSUMABLE'));

COMMIT;
