-- Service consumable accountability lifecycle.
-- Safe to re-run after 2026-08-19-stockist-operations-extension.sql.

BEGIN;

-- Make this migration safe even when the earlier product-classification
-- migration was not applied yet.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'RETAIL';

UPDATE products
SET product_type = 'RETAIL'
WHERE product_type IS NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN ('RETAIL', 'SERVICE', 'SERVICE_CONSUMABLE', 'BOTH'));

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_check;
ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_ledger_movement_type;
ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_ledger_movement_type CHECK (movement_type IN (
  'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT',
  'RETURN_TO_CENTER', 'SALE_RETAIL', 'SERVICE_USE', 'SERVICE_OPEN',
  'SERVICE_FINISHED', 'STOCK_OPNAME_GAIN', 'STOCK_OPNAME_LOSS', 'DAMAGE', 'LOST'
));

CREATE TABLE IF NOT EXISTS inventory_service_usage (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id),
  location_id   UUID NOT NULL REFERENCES inventory_locations(id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  status        TEXT NOT NULL DEFAULT 'IN_USE' CHECK (status IN ('IN_USE', 'FINISHED')),
  pic_user_id   UUID REFERENCES users(id),
  pic_name      TEXT NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_by     UUID NOT NULL REFERENCES users(id),
  finished_at   TIMESTAMPTZ,
  finished_by   UUID REFERENCES users(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_service_usage_finished_fields CHECK (
    (status = 'IN_USE' AND finished_at IS NULL AND finished_by IS NULL)
    OR (status = 'FINISHED' AND finished_at IS NOT NULL AND finished_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_service_usage_location_status
  ON inventory_service_usage (location_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_usage_product
  ON inventory_service_usage (product_id, status);

ALTER TABLE inventory_service_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_service_usage FROM anon, authenticated;

ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS in_use_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS total_accounted_quantity INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION open_service_usage(
  p_product_id UUID,
  p_location_id UUID,
  p_quantity INTEGER,
  p_pic_user_id UUID,
  p_pic_name TEXT,
  p_opened_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS inventory_service_usage AS $$
DECLARE
  v_product products;
  v_usage inventory_service_usage;
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF v_product.product_type NOT IN ('SERVICE', 'SERVICE_CONSUMABLE', 'BOTH') THEN
    RAISE EXCEPTION 'product is not a service consumable';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  IF p_pic_name IS NULL OR btrim(p_pic_name) = '' THEN RAISE EXCEPTION 'PIC is required'; END IF;

  INSERT INTO inventory_balances (product_id, location_id, quantity)
  VALUES (p_product_id, p_location_id, 0) ON CONFLICT (product_id, location_id) DO NOTHING;
  SELECT quantity INTO v_current FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
  v_new := v_current - p_quantity;
  IF v_new < 0 THEN RAISE EXCEPTION 'insufficient stock: available %', v_current; END IF;
  UPDATE inventory_balances SET quantity = v_new, updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id;

  INSERT INTO inventory_service_usage
    (product_id, location_id, quantity, pic_user_id, pic_name, opened_by, notes)
  VALUES (p_product_id, p_location_id, p_quantity, p_pic_user_id, btrim(p_pic_name), p_opened_by, p_notes)
  RETURNING * INTO v_usage;

  INSERT INTO inventory_ledger
    (product_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
     reference_type, reference_id, performed_by, reason)
  VALUES (p_product_id, p_location_id, 'SERVICE_OPEN', -p_quantity, v_current, v_new,
          'inventory_service_usage', v_usage.id, p_opened_by, p_notes);
  RETURN v_usage;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finish_service_usage(
  p_usage_id UUID,
  p_finished_by UUID
)
RETURNS inventory_service_usage AS $$
DECLARE
  v_usage inventory_service_usage;
  v_balance INTEGER;
BEGIN
  SELECT * INTO v_usage FROM inventory_service_usage WHERE id = p_usage_id FOR UPDATE;
  IF v_usage.id IS NULL THEN RAISE EXCEPTION 'service usage not found'; END IF;
  IF v_usage.status <> 'IN_USE' THEN RAISE EXCEPTION 'service usage is already finished'; END IF;

  UPDATE inventory_service_usage
  SET status = 'FINISHED', finished_at = NOW(), finished_by = p_finished_by, updated_at = NOW()
  WHERE id = p_usage_id RETURNING * INTO v_usage;
  SELECT quantity INTO v_balance FROM inventory_balances
  WHERE product_id = v_usage.product_id AND location_id = v_usage.location_id;
  INSERT INTO inventory_ledger
    (product_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
     reference_type, reference_id, performed_by, reason)
  VALUES (v_usage.product_id, v_usage.location_id, 'SERVICE_FINISHED', 0, v_balance, v_balance,
          'inventory_service_usage', v_usage.id, p_finished_by, v_usage.notes);
  RETURN v_usage;
END;
$$ LANGUAGE plpgsql;

COMMIT;
