-- server/migrations/2026-08-15-stockist-inventory-foundation.sql
-- Stockist inventory foundation: products, warehouse/branch stock, ledger, transfers.
-- Safe to re-run (idempotent).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: products — retail goods (pomade, parfum, facewash...),
-- distinct from `services` (haircut services).
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku              TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT,
  brand            TEXT,
  unit             TEXT NOT NULL DEFAULT 'pcs',
  barcode          TEXT,
  purchase_price   INTEGER,
  retail_price     INTEGER,
  minimum_stock    INTEGER NOT NULL DEFAULT 0,
  reorder_point    INTEGER NOT NULL DEFAULT 0,
  moka_item_id     TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: inventory_locations — 1 warehouse (singleton) + 5 branch
-- rows pointing at the existing `outlets` table. Kept separate from
-- `outlets` because a warehouse has no barbers and no booking-sync
-- Moka token — bolting it onto `outlets` would mix domains.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL CHECK (type IN ('warehouse', 'branch')),
  outlet_id   UUID REFERENCES outlets(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_branch_has_outlet CHECK (
    (type = 'branch' AND outlet_id IS NOT NULL) OR
    (type = 'warehouse' AND outlet_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_locations_outlet
  ON inventory_locations (outlet_id) WHERE outlet_id IS NOT NULL;

-- Singleton warehouse row (only inserted if none exists yet).
INSERT INTO inventory_locations (type, outlet_id)
SELECT 'warehouse', NULL
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE type = 'warehouse');

-- One branch row per existing outlet.
INSERT INTO inventory_locations (type, outlet_id)
SELECT 'branch', o.id
FROM outlets o
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_locations il WHERE il.outlet_id = o.id
);

-- ============================================================
-- TABLE: inventory_balances — derived read-cache, never written
-- directly outside apply_inventory_movement().
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_balances (
  product_id   UUID NOT NULL REFERENCES products(id),
  location_id  UUID NOT NULL REFERENCES inventory_locations(id),
  quantity     INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, location_id)
);

-- ============================================================
-- TABLE: inventory_ledger — append-only audit trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id        UUID NOT NULL REFERENCES products(id),
  location_id       UUID NOT NULL REFERENCES inventory_locations(id),
  movement_type     TEXT NOT NULL CHECK (movement_type IN (
                       'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'
                     )),
  quantity_delta    INTEGER NOT NULL,
  quantity_before   INTEGER NOT NULL,
  quantity_after    INTEGER NOT NULL,
  reference_type    TEXT,
  reference_id      UUID,
  performed_by      UUID NOT NULL REFERENCES users(id),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_location
  ON inventory_ledger (product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_reference
  ON inventory_ledger (reference_type, reference_id) WHERE reference_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_created
  ON inventory_ledger (created_at DESC);

-- ============================================================
-- TABLE: stock_transfers / stock_transfer_items — pusat -> cabang
-- distribution, two-phase (SENT, then RECEIVED with confirmed qty).
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number           TEXT UNIQUE NOT NULL,
  source_location_id        UUID NOT NULL REFERENCES inventory_locations(id),
  destination_location_id   UUID NOT NULL REFERENCES inventory_locations(id),
  status                    TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'RECEIVED')),
  sent_by                   UUID NOT NULL REFERENCES users(id),
  sent_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by               UUID REFERENCES users(id),
  received_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination
  ON stock_transfers (destination_location_id, status);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  quantity_sent     INTEGER NOT NULL CHECK (quantity_sent > 0),
  quantity_received INTEGER CHECK (quantity_received IS NULL OR quantity_received >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer
  ON stock_transfer_items (stock_transfer_id);

-- ============================================================
-- FUNCTION: apply_inventory_movement — the ONLY way balances change.
-- Row-locks the balance row (creating it at 0 first if missing) so
-- concurrent movements against the same product+location serialize
-- instead of racing past the negative-stock check.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_inventory_movement(
  p_product_id     UUID,
  p_location_id    UUID,
  p_quantity_delta INTEGER,
  p_movement_type  TEXT,
  p_performed_by   UUID,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   UUID DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL
)
RETURNS inventory_ledger AS $$
DECLARE
  v_current INTEGER;
  v_new     INTEGER;
  v_ledger  inventory_ledger;
BEGIN
  INSERT INTO inventory_balances (product_id, location_id, quantity)
  VALUES (p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT quantity INTO v_current
  FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  v_new := v_current + p_quantity_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient stock: product % at location % has % available, delta % requested',
      p_product_id, p_location_id, v_current, p_quantity_delta
      USING ERRCODE = '23514';
  END IF;

  UPDATE inventory_balances
  SET quantity = v_new, updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id;

  INSERT INTO inventory_ledger (
    product_id, location_id, movement_type, quantity_delta,
    quantity_before, quantity_after, reference_type, reference_id,
    performed_by, reason
  ) VALUES (
    p_product_id, p_location_id, p_movement_type, p_quantity_delta,
    v_current, v_new, p_reference_type, p_reference_id,
    p_performed_by, p_reason
  )
  RETURNING * INTO v_ledger;

  RETURN v_ledger;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Access: these tables are only ever touched by the Express backend
-- using the service-role key (which bypasses RLS). No browser client
-- should ever query them directly, so deny by default rather than
-- crafting per-branch RLS policies that would never be exercised.
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE products, inventory_locations, inventory_balances,
  inventory_ledger, stock_transfers, stock_transfer_items
  FROM anon, authenticated;

COMMIT;
