-- server/migrations/2026-09-10-inventory-daily-movements.sql
-- Analytical summary table for daily inventory movements.
-- Aggregated daily by cron job from append-only inventory_ledger.
-- Read-only analytics cache, never modifies operational inventory balances.
-- Idempotent: safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS inventory_daily_movements (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date                  DATE NOT NULL,
  location_id           UUID NOT NULL REFERENCES inventory_locations(id),
  branch_id             UUID REFERENCES outlets(id),
  product_id            UUID NOT NULL REFERENCES products(id),
  opening_qty           INTEGER NOT NULL DEFAULT 0,
  received_qty          INTEGER NOT NULL DEFAULT 0,
  transfer_in_qty       INTEGER NOT NULL DEFAULT 0,
  transfer_out_qty      INTEGER NOT NULL DEFAULT 0,
  sales_qty             INTEGER NOT NULL DEFAULT 0,
  adjustment_plus_qty   INTEGER NOT NULL DEFAULT 0,
  adjustment_minus_qty  INTEGER NOT NULL DEFAULT 0,
  closing_qty           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_daily_movements UNIQUE (date, location_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_daily_movements_date
  ON inventory_daily_movements (date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_daily_movements_location_date
  ON inventory_daily_movements (location_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_daily_movements_product_date
  ON inventory_daily_movements (product_id, date DESC);

-- Enable RLS and revoke client direct access (touched only via backend service-role key)
ALTER TABLE inventory_daily_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_daily_movements FROM anon, authenticated;

COMMIT;
