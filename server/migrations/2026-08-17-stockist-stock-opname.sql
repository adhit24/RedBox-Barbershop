-- server/migrations/2026-08-17-stockist-stock-opname.sql
-- Physical stock count sessions: snapshot system quantity, record physical
-- count, compute difference, and (on owner approval) turn each nonzero
-- difference into an ADJUSTMENT ledger movement referencing the opname.
-- Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS stock_opnames (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opname_number TEXT UNIQUE NOT NULL,
  location_id   UUID NOT NULL REFERENCES inventory_locations(id),
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED')),
  created_by    UUID NOT NULL REFERENCES users(id),
  submitted_at  TIMESTAMPTZ,
  approved_by   UUID REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_opnames_location_status
  ON stock_opnames (location_id, status);

-- Only one open (DRAFT/SUBMITTED) count session per location at a time —
-- prevents two overlapping physical counts from racing each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_opname_open_location
  ON stock_opnames (location_id) WHERE status IN ('DRAFT', 'SUBMITTED');

CREATE TABLE IF NOT EXISTS stock_opname_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_opname_id   UUID NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  system_quantity   INTEGER NOT NULL,
  physical_quantity INTEGER,
  difference        INTEGER,
  reason            TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_opname_items_opname
  ON stock_opname_items (stock_opname_id);

CREATE OR REPLACE TRIGGER trg_stock_opnames_updated
  BEFORE UPDATE ON stock_opnames FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_opnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_opname_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stock_opnames, stock_opname_items FROM anon, authenticated;

COMMIT;
