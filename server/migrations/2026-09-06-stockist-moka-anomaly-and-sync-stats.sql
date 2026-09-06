-- Moka -> Stockist sales bridge: anomaly queue + per-run sync stats.
-- Closes gaps left by 2026-08-20-stockist-moka-sales.sql:
--   - unmapped items and negative-stock-risk sales were fail-closed but
--     left no queryable trail for a human to act on
--   - moka_stockist_sync_state existed but nothing ever wrote to it
-- Safe to re-run. Does not touch inventory_ledger, inventory_balances,
-- stock_opnames, or any existing movement_type/processing_status values.

BEGIN;

CREATE TABLE IF NOT EXISTS moka_stockist_anomalies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID REFERENCES outlets(id),
  sale_id UUID REFERENCES moka_stockist_sales(id) ON DELETE CASCADE,
  sale_item_id UUID REFERENCES moka_stockist_sale_items(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN (
    'UNMAPPED_PRODUCT', 'UNKNOWN_VARIANT', 'UNKNOWN_OUTLET', 'NEGATIVE_STOCK_RISK'
  )),
  moka_item_id TEXT,
  moka_variant_id TEXT,
  product_id UUID REFERENCES products(id),
  requested_quantity INTEGER,
  available_quantity INTEGER,
  detail JSONB,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moka_stockist_anomalies_open
  ON moka_stockist_anomalies (outlet_id, status, created_at DESC);

REVOKE ALL ON TABLE moka_stockist_anomalies FROM anon, authenticated;

-- Per-outlet snapshot of the most recent sync run, for the Owner Dashboard
-- "Moka Sync Status" card and for reconciliation. Not a history log —
-- deep history is already queryable from moka_stockist_sales/sale_items.
ALTER TABLE moka_stockist_sync_state
  ADD COLUMN IF NOT EXISTS last_run_stats JSONB;

COMMIT;
