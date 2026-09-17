-- Task 2.1C: Canonical Moka Line Items Schema
-- Persist structured Moka line-item data with deterministic service classification.
-- Also drop NOT NULL on moka_barber_services.revenue_share to allow null commission writes (Task 2.1B architectural decision).

BEGIN;

-- 1. Create moka_transaction_items table
CREATE TABLE IF NOT EXISTS public.moka_transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number TEXT NOT NULL,
    source_line_key TEXT NOT NULL,
    outlet_id UUID REFERENCES public.outlets(id),
    outlet_slug TEXT NOT NULL,
    tx_date DATE NOT NULL,
    tx_time TEXT,
    source_item_id TEXT,
    source_variant_id TEXT,
    item_name TEXT NOT NULL,
    variant_name TEXT,
    category_name TEXT,
    quantity NUMERIC NOT NULL DEFAULT 1,
    gross_amount NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    net_amount NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC NOT NULL DEFAULT 0,
    gratuity_amount NUMERIC NOT NULL DEFAULT 0,
    classification TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    classification_reason TEXT,
    barber_id TEXT REFERENCES public.barbers(id),
    barber_name_raw TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    refunded_quantity NUMERIC NOT NULL DEFAULT 0,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT moka_transaction_items_idempotency_key UNIQUE (outlet_id, receipt_number, source_line_key)
);

CREATE INDEX IF NOT EXISTS idx_mti_outlet_date ON public.moka_transaction_items (outlet_slug, tx_date);
CREATE INDEX IF NOT EXISTS idx_mti_receipt ON public.moka_transaction_items (receipt_number);
CREATE INDEX IF NOT EXISTS idx_mti_barber ON public.moka_transaction_items (barber_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_mti_classification ON public.moka_transaction_items (classification);

-- 2. Allow NULL on moka_barber_services.revenue_share (Task 2.1B single-writer remediation)
ALTER TABLE IF EXISTS public.moka_barber_services ALTER COLUMN revenue_share DROP NOT NULL;

COMMIT;
