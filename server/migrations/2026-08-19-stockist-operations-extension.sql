-- server/migrations/2026-08-19-stockist-operations-extension.sql
-- Task 1: product classification contract + expanded movement types.
-- Safe to re-run (idempotent).

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'RETAIL';

UPDATE products
SET product_type = 'RETAIL'
WHERE product_type IS NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_product_type_check;

ALTER TABLE products
  ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('RETAIL', 'SERVICE'));

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_check;
ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_ledger_movement_type;
ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_ledger_movement_type CHECK (movement_type IN (
  'WAREHOUSE_RECEIVE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
  'RETURN_TO_CENTER',
  'SALE_RETAIL',
  'SERVICE_USE',
  'STOCK_OPNAME_GAIN',
  'STOCK_OPNAME_LOSS',
  'DAMAGE',
  'LOST'
));

COMMIT;
