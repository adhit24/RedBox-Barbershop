-- server/migrations/2026-08-17-stockist-returns.sql
-- Branch -> warehouse product returns (damaged, wrong item, excess,
-- expired, other). SUBMITTED -> APPROVED/REJECTED -> SHIPPED -> RECEIVED,
-- or CANCELLED before shipping. Stock only moves at SHIP (branch loses the
-- physical item) and RECEIVE (warehouse only regains sellable stock for
-- non-damaged categories — damaged/expired returns are removed from the
-- branch but never re-enter sellable warehouse stock).
-- Safe to re-run (idempotent).

BEGIN;

-- inventory_ledger.movement_type was CHECK-constrained to a fixed list at
-- creation; extend it with RETURN_TO_CENTER for the branch-side decrement.
-- The warehouse-side increment on a sellable return reuses WAREHOUSE_RECEIVE
-- (it genuinely is stock re-entering sellable warehouse inventory).
ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_check;
ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_ledger_movement_type;
ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_ledger_movement_type CHECK (movement_type IN (
  'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN_TO_CENTER'
));

CREATE TABLE IF NOT EXISTS stock_returns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_number       TEXT UNIQUE NOT NULL,
  branch_location_id  UUID NOT NULL REFERENCES inventory_locations(id),
  category            TEXT NOT NULL CHECK (category IN ('RUSAK', 'KEDALUWARSA', 'SALAH_KIRIM', 'KELEBIHAN', 'LAINNYA')),
  status              TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                         'SUBMITTED', 'APPROVED', 'REJECTED', 'SHIPPED', 'RECEIVED', 'CANCELLED'
                       )),
  reason              TEXT,
  requested_by        UUID NOT NULL REFERENCES users(id),
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  shipped_by          UUID REFERENCES users(id),
  shipped_at          TIMESTAMPTZ,
  received_by         UUID REFERENCES users(id),
  received_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_returns_branch_status
  ON stock_returns (branch_location_id, status);

CREATE TABLE IF NOT EXISTS stock_return_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_return_items_return
  ON stock_return_items (stock_return_id);

CREATE OR REPLACE TRIGGER trg_stock_returns_updated
  BEFORE UPDATE ON stock_returns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_return_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stock_returns, stock_return_items FROM anon, authenticated;

COMMIT;
