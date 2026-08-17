-- server/migrations/2026-08-17-stockist-stock-requests.sql
-- Branch → warehouse stock requests, with a reservation mechanism so an
-- approved-but-not-yet-shipped request can't be double-allocated to another
-- branch's request for the same product.
-- Safe to re-run (idempotent).

BEGIN;

-- ============================================================
-- reserved_quantity: portion of `quantity` held for approved stock
-- requests that haven't shipped yet. available = quantity - reserved_quantity.
-- Every negative movement through apply_inventory_movement() is guarded so
-- it can never eat into another request's reservation (see redefinition
-- below).
-- ============================================================
ALTER TABLE inventory_balances
  ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reserved_not_negative'
  ) THEN
    ALTER TABLE inventory_balances
      ADD CONSTRAINT chk_reserved_not_negative CHECK (reserved_quantity >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reserved_not_exceed_quantity'
  ) THEN
    ALTER TABLE inventory_balances
      ADD CONSTRAINT chk_reserved_not_exceed_quantity CHECK (reserved_quantity <= quantity);
  END IF;
END $$;

-- ============================================================
-- TABLE: stock_requests / stock_request_items — branch_admin asks the
-- warehouse for products; owner approves (full/partial) or rejects.
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_requests (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number         TEXT UNIQUE NOT NULL,
  branch_location_id     UUID NOT NULL REFERENCES inventory_locations(id),
  status                 TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                            'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED',
                            'REJECTED', 'CANCELLED', 'FULFILLED'
                          )),
  requested_by           UUID NOT NULL REFERENCES users(id),
  reason                 TEXT,
  reviewed_by            UUID REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ,
  rejection_reason       TEXT,
  fulfilling_transfer_id UUID REFERENCES stock_transfers(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_requests_branch_status
  ON stock_requests (branch_location_id, status);

CREATE TABLE IF NOT EXISTS stock_request_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_request_id   UUID NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id),
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_approved  INTEGER CHECK (quantity_approved IS NULL OR quantity_approved >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_request_items_request
  ON stock_request_items (stock_request_id);

CREATE OR REPLACE TRIGGER trg_stock_requests_updated
  BEFORE UPDATE ON stock_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: apply_inventory_movement — redefined to additionally guard
-- against any negative movement (ad-hoc transfer, adjustment, ...) cutting
-- into stock already reserved for an approved request. Positive movements
-- are unaffected. Existing callers are unchanged; this is purely an extra
-- guard on top of the original insufficient-stock check.
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
  v_current  INTEGER;
  v_reserved INTEGER;
  v_new      INTEGER;
  v_ledger   inventory_ledger;
BEGIN
  INSERT INTO inventory_balances (product_id, location_id, quantity, reserved_quantity)
  VALUES (p_product_id, p_location_id, 0, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT quantity, reserved_quantity INTO v_current, v_reserved
  FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  v_new := v_current + p_quantity_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient stock: product % at location % has % available, delta % requested',
      p_product_id, p_location_id, v_current, p_quantity_delta
      USING ERRCODE = '23514';
  END IF;
  IF v_new < v_reserved THEN
    RAISE EXCEPTION 'insufficient available stock: product % at location % has % reserved for approved requests, delta % would leave only %',
      p_product_id, p_location_id, v_reserved, p_quantity_delta, v_new
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

-- ============================================================
-- FUNCTION: reserve_inventory_stock — holds `p_quantity` against future
-- fulfillment without any physical movement or ledger entry. Row-locks the
-- balance so two concurrent approvals against the same product can't both
-- reserve more than what's actually available.
-- ============================================================
CREATE OR REPLACE FUNCTION reserve_inventory_stock(
  p_product_id  UUID,
  p_location_id UUID,
  p_quantity    INTEGER
)
RETURNS inventory_balances AS $$
DECLARE
  v_balance inventory_balances;
BEGIN
  INSERT INTO inventory_balances (product_id, location_id, quantity, reserved_quantity)
  VALUES (p_product_id, p_location_id, 0, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT * INTO v_balance FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  IF (v_balance.quantity - v_balance.reserved_quantity) < p_quantity THEN
    RAISE EXCEPTION 'insufficient available stock: product % at location % has % available (% reserved), % requested',
      p_product_id, p_location_id, (v_balance.quantity - v_balance.reserved_quantity), v_balance.reserved_quantity, p_quantity
      USING ERRCODE = '23514';
  END IF;

  UPDATE inventory_balances
  SET reserved_quantity = reserved_quantity + p_quantity, updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id
  RETURNING * INTO v_balance;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: release_inventory_reservation — releases a hold with no
-- physical movement (reject-after-approve, cancel-after-approve).
-- ============================================================
CREATE OR REPLACE FUNCTION release_inventory_reservation(
  p_product_id  UUID,
  p_location_id UUID,
  p_quantity    INTEGER
)
RETURNS inventory_balances AS $$
DECLARE
  v_balance inventory_balances;
BEGIN
  UPDATE inventory_balances
  SET reserved_quantity = GREATEST(reserved_quantity - p_quantity, 0), updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id
  RETURNING * INTO v_balance;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: fulfill_reserved_transfer_out — the ONLY way an approved
-- (reserved) request turns into an actual TRANSFER_OUT movement. Releases
-- the hold and decrements physical quantity atomically in the same row
-- lock, so there is never a window where the reservation is gone but the
-- stock hasn't moved (or vice versa).
-- ============================================================
CREATE OR REPLACE FUNCTION fulfill_reserved_transfer_out(
  p_product_id     UUID,
  p_location_id    UUID,
  p_quantity       INTEGER,
  p_performed_by   UUID,
  p_reference_type TEXT,
  p_reference_id   UUID
)
RETURNS inventory_ledger AS $$
DECLARE
  v_current INTEGER;
  v_new     INTEGER;
  v_ledger  inventory_ledger;
BEGIN
  UPDATE inventory_balances
  SET reserved_quantity = GREATEST(reserved_quantity - p_quantity, 0)
  WHERE product_id = p_product_id AND location_id = p_location_id;

  SELECT quantity INTO v_current
  FROM inventory_balances
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  v_new := v_current - p_quantity;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient stock: product % at location % has % available, % requested',
      p_product_id, p_location_id, v_current, p_quantity
      USING ERRCODE = '23514';
  END IF;

  UPDATE inventory_balances
  SET quantity = v_new, updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_location_id;

  INSERT INTO inventory_ledger (
    product_id, location_id, movement_type, quantity_delta,
    quantity_before, quantity_after, reference_type, reference_id, performed_by
  ) VALUES (
    p_product_id, p_location_id, 'TRANSFER_OUT', -p_quantity,
    v_current, v_new, p_reference_type, p_reference_id, p_performed_by
  )
  RETURNING * INTO v_ledger;

  RETURN v_ledger;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_request_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE stock_requests, stock_request_items FROM anon, authenticated;

COMMIT;
