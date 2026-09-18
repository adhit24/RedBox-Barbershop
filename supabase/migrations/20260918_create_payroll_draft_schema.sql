-- Task 2.3: Kapster Payroll Draft Schema
-- Additive migration creating payroll_runs, payroll_barber_items, payroll_barber_commission_items, and payroll_adjustments.
-- RLS enabled and locked to service_role only (Redbox backend-only security pattern).

BEGIN;

-- 1. Table: payroll_runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_type TEXT NOT NULL DEFAULT 'BARBER_REVENUE_SHARE',
    business_unit TEXT NOT NULL DEFAULT 'Redbox',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'LOCKED')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_by TEXT NOT NULL,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    calculation_version TEXT NOT NULL DEFAULT 'v2.3',
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_run_period CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON public.payroll_runs (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON public.payroll_runs (status);

-- 2. Table: payroll_barber_items
CREATE TABLE IF NOT EXISTS public.payroll_barber_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    barber_id TEXT NOT NULL REFERENCES public.barbers(id),
    barber_name_snapshot TEXT NOT NULL,
    branch_snapshot TEXT NOT NULL,
    service_item_count INTEGER NOT NULL DEFAULT 0,
    receipt_count INTEGER NOT NULL DEFAULT 0,
    gross_service_revenue NUMERIC NOT NULL DEFAULT 0,
    discount_total NUMERIC NOT NULL DEFAULT 0,
    net_service_revenue NUMERIC NOT NULL DEFAULT 0,
    commission_amount NUMERIC NOT NULL DEFAULT 0,
    manual_adjustment_total NUMERIC NOT NULL DEFAULT 0,
    payable_amount NUMERIC NOT NULL DEFAULT 0,
    review_required_count INTEGER NOT NULL DEFAULT 0,
    missing_rate_count INTEGER NOT NULL DEFAULT 0,
    attendance_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'MISSING_RATE', 'REVIEW_REQUIRED', 'BLOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_run_barber UNIQUE (payroll_run_id, barber_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_run_id ON public.payroll_barber_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pbi_barber_id ON public.payroll_barber_items (barber_id);

-- 3. Table: payroll_barber_commission_items
CREATE TABLE IF NOT EXISTS public.payroll_barber_commission_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    payroll_barber_item_id UUID NOT NULL REFERENCES public.payroll_barber_items(id) ON DELETE CASCADE,
    source_moka_transaction_item_id UUID NOT NULL REFERENCES public.moka_transaction_items(id),
    receipt_number TEXT NOT NULL,
    tx_date DATE NOT NULL,
    service_name_snapshot TEXT NOT NULL,
    gross_amount NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    net_amount NUMERIC NOT NULL DEFAULT 0,
    commission_rate_used NUMERIC NOT NULL CHECK (commission_rate_used >= 0 AND commission_rate_used <= 1),
    commission_amount NUMERIC NOT NULL DEFAULT 0,
    rate_source TEXT NOT NULL DEFAULT 'barber_commission_rates',
    rate_effective_from DATE,
    barber_id_snapshot TEXT NOT NULL,
    branch_snapshot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_run_source_item UNIQUE (payroll_run_id, source_moka_transaction_item_id)
);

CREATE INDEX IF NOT EXISTS idx_pbci_run_id ON public.payroll_barber_commission_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pbci_barber_item ON public.payroll_barber_commission_items (payroll_barber_item_id);
CREATE INDEX IF NOT EXISTS idx_pbci_source_item ON public.payroll_barber_commission_items (source_moka_transaction_item_id);

-- 4. Table: payroll_adjustments
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    payroll_barber_item_id UUID NOT NULL REFERENCES public.payroll_barber_items(id) ON DELETE CASCADE,
    barber_id TEXT NOT NULL REFERENCES public.barbers(id),
    amount NUMERIC NOT NULL CHECK (amount != 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    note TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_run_id ON public.payroll_adjustments (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pa_barber_id ON public.payroll_adjustments (barber_id);

-- 5. Immutability trigger: prevent mutations on child tables if payroll_run is LOCKED
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_locked()
RETURNS TRIGGER AS $$
DECLARE
    v_status TEXT;
    v_run_id UUID;
BEGIN
    v_run_id := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
    SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
    IF v_status = 'LOCKED' THEN
        RAISE EXCEPTION 'Cannot modify payroll data: payroll run % is LOCKED', v_run_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pbi_immutability ON public.payroll_barber_items;
CREATE TRIGGER trg_pbi_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_barber_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

DROP TRIGGER IF EXISTS trg_pbci_immutability ON public.payroll_barber_commission_items;
CREATE TRIGGER trg_pbci_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_barber_commission_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

DROP TRIGGER IF EXISTS trg_pa_immutability ON public.payroll_adjustments;
CREATE TRIGGER trg_pa_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

-- 6. Enable RLS and lock down to service_role only
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_runs TO service_role;

ALTER TABLE public.payroll_barber_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_barber_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_barber_items TO service_role;

ALTER TABLE public.payroll_barber_commission_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_barber_commission_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_barber_commission_items TO service_role;

ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_adjustments TO service_role;

COMMIT;
