-- Moka -> Stockist sales bridge.
-- Safe to re-run. Apply only after reviewing outlet/item mappings.

BEGIN;

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_check;
ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_ledger_movement_type;
ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_ledger_movement_type CHECK (movement_type IN (
  'WAREHOUSE_RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT',
  'RETURN_TO_CENTER', 'SALE_MOKA', 'SALE_RETAIL', 'SERVICE_USE',
  'SERVICE_OPEN', 'SERVICE_FINISHED', 'STOCK_OPNAME_GAIN',
  'STOCK_OPNAME_LOSS', 'DAMAGE', 'LOST'
));

CREATE TABLE IF NOT EXISTS moka_item_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moka_item_id TEXT NOT NULL,
  moka_variant_id TEXT,
  product_id UUID NOT NULL REFERENCES products(id),
  outlet_id UUID REFERENCES outlets(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_moka_item_mapping_scope
  ON moka_item_mappings (moka_item_id, COALESCE(moka_variant_id, ''), COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_moka_item_mappings_product
  ON moka_item_mappings (product_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS moka_stockist_raw_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'sale',
  payload JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (outlet_id, external_id, event_type)
);

CREATE TABLE IF NOT EXISTS moka_stockist_sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id UUID NOT NULL REFERENCES outlets(id),
  location_id UUID NOT NULL REFERENCES inventory_locations(id),
  raw_event_id UUID REFERENCES moka_stockist_raw_events(id),
  external_transaction_id TEXT NOT NULL,
  receipt_number TEXT,
  transaction_status TEXT NOT NULL DEFAULT 'PAID',
  processing_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (processing_status IN ('PENDING', 'PROCESSED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  error_message TEXT,
  occurred_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, external_transaction_id)
);

CREATE TABLE IF NOT EXISTS moka_stockist_sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES moka_stockist_sales(id) ON DELETE CASCADE,
  moka_item_id TEXT,
  moka_variant_id TEXT,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'MAPPED', 'PROCESSED', 'UNMAPPED', 'SKIPPED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moka_stockist_sales_status
  ON moka_stockist_sales (processing_status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_moka_stockist_sale_items_sale
  ON moka_stockist_sale_items (sale_id);

-- The sale row is the idempotency key used as ledger reference_id. This
-- protects against two workers racing after the same transaction is fetched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_moka_sale
  ON inventory_ledger (reference_type, reference_id, movement_type)
  WHERE reference_type = 'moka_stockist_sale_item' AND movement_type = 'SALE_MOKA';

CREATE TABLE IF NOT EXISTS moka_stockist_sync_state (
  outlet_id UUID PRIMARY KEY REFERENCES outlets(id),
  cursor_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE moka_item_mappings, moka_stockist_raw_events,
  moka_stockist_sales, moka_stockist_sale_items, moka_stockist_sync_state
  FROM anon, authenticated;

COMMIT;
