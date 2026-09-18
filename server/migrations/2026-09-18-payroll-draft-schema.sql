-- Task 2.3: Kapster Payroll Draft Schema + Immutable Commission Snapshot
-- Additive canonical migration creating:
--   1. public.payroll_runs
--   2. public.payroll_barber_items
--   3. public.payroll_barber_commission_items (resolved payable commission lines)
--   4. public.payroll_review_items (unresolved audit snapshot: missing rates, missing barbers, review items)
--   5. public.payroll_adjustments (justified manual bonuses / deductions)
--   6. public.payroll_source_claims (double-pay prevention across LOCKED runs)
--   7. Header immutability trigger on payroll_runs
--   8. Child immutability trigger on child tables
--   9. Atomic lock function: public.lock_payroll_run()
--   10. RLS enabled and locked to service_role only

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

-- 3. Table: payroll_barber_commission_items (Resolved payable lines)
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

-- 4. Table: payroll_review_items (Unresolved items audit snapshot)
CREATE TABLE IF NOT EXISTS public.payroll_review_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    source_moka_transaction_item_id UUID REFERENCES public.moka_transaction_items(id),
    receipt_number TEXT NOT NULL,
    tx_date DATE NOT NULL,
    item_name_snapshot TEXT NOT NULL,
    classification_snapshot TEXT NOT NULL,
    barber_id TEXT REFERENCES public.barbers(id),
    barber_name_snapshot TEXT,
    branch_snapshot TEXT,
    gross_amount NUMERIC NOT NULL DEFAULT 0,
    discount_amount NUMERIC NOT NULL DEFAULT 0,
    net_amount NUMERIC NOT NULL DEFAULT 0,
    reason_code TEXT NOT NULL CHECK (reason_code IN ('MISSING_RATE', 'MISSING_BARBER', 'REVIEW_REQUIRED_ITEM', 'DUPLICATE_SOURCE', 'REFUND_REVIEW', 'SOURCE_DATA_INVALID')),
    blocking BOOLEAN NOT NULL DEFAULT true,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_review_run_source_item UNIQUE (payroll_run_id, source_moka_transaction_item_id)
);

CREATE INDEX IF NOT EXISTS idx_pri_run_id ON public.payroll_review_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pri_barber_id ON public.payroll_review_items (barber_id);
CREATE INDEX IF NOT EXISTS idx_pri_blocking ON public.payroll_review_items (payroll_run_id, blocking);

-- 5. Table: payroll_adjustments (Manual adjustments)
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

-- 6. Table: payroll_source_claims (Double-pay prevention across LOCKED runs)
CREATE TABLE IF NOT EXISTS public.payroll_source_claims (
    source_moka_transaction_item_id UUID PRIMARY KEY REFERENCES public.moka_transaction_items(id),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_psc_run_id ON public.payroll_source_claims (payroll_run_id);

-- 7. Immutability Trigger for payroll_runs header
CREATE OR REPLACE FUNCTION public.check_payroll_run_header_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- Reject deletion of a LOCKED run
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'LOCKED' THEN
            RAISE EXCEPTION 'Cannot delete payroll run %: run is LOCKED', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- On UPDATE:
    IF OLD.status = 'LOCKED' THEN
        RAISE EXCEPTION 'Cannot modify payroll run %: run is LOCKED and immutable', OLD.id;
    END IF;

    -- Transition from DRAFT -> LOCKED:
    IF OLD.status = 'DRAFT' AND NEW.status = 'LOCKED' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.payroll_type IS DISTINCT FROM OLD.payroll_type
           OR NEW.business_unit IS DISTINCT FROM OLD.business_unit
           OR NEW.period_start IS DISTINCT FROM OLD.period_start
           OR NEW.period_end IS DISTINCT FROM OLD.period_end
           OR NEW.generated_at IS DISTINCT FROM OLD.generated_at
           OR NEW.generated_by IS DISTINCT FROM OLD.generated_by
           OR NEW.calculation_version IS DISTINCT FROM OLD.calculation_version
           OR NEW.summary IS DISTINCT FROM OLD.summary
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'Cannot alter historical fields when locking payroll run %', OLD.id;
        END IF;
    END IF;

    -- Reject invalid status transition (e.g. LOCKED -> DRAFT)
    IF OLD.status <> NEW.status AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'LOCKED') THEN
        RAISE EXCEPTION 'Invalid status transition from % to % for payroll run %', OLD.status, NEW.status, OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_payroll_runs_immutability ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_immutability
BEFORE UPDATE OR DELETE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_header_immutability();

-- 8. Immutability Trigger for child tables (pbi, pbci, pri, pa)
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_locked()
RETURNS TRIGGER AS $$
DECLARE
    v_status TEXT;
    v_run_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_run_id := OLD.payroll_run_id;
    ELSE
        v_run_id := NEW.payroll_run_id;
    END IF;

    SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
    IF v_status = 'LOCKED' THEN
        RAISE EXCEPTION 'Cannot modify payroll data: payroll run % is LOCKED', v_run_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_pbi_immutability ON public.payroll_barber_items;
CREATE TRIGGER trg_pbi_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_barber_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

DROP TRIGGER IF EXISTS trg_pbci_immutability ON public.payroll_barber_commission_items;
CREATE TRIGGER trg_pbci_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_barber_commission_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

DROP TRIGGER IF EXISTS trg_pri_immutability ON public.payroll_review_items;
CREATE TRIGGER trg_pri_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_review_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

DROP TRIGGER IF EXISTS trg_pa_immutability ON public.payroll_adjustments;
CREATE TRIGGER trg_pa_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

-- 8b. Immutability Trigger for payroll_source_claims
CREATE OR REPLACE FUNCTION public.check_payroll_source_claims_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_status TEXT;
    v_run_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT status INTO v_status FROM public.payroll_runs WHERE id = OLD.payroll_run_id;
        IF v_status = 'LOCKED' THEN
            RAISE EXCEPTION 'Cannot modify source claim: payroll run % is LOCKED and claims are immutable', OLD.payroll_run_id;
        END IF;
        v_run_id := NEW.payroll_run_id;
    ELSIF TG_OP = 'DELETE' THEN
        v_run_id := OLD.payroll_run_id;
    ELSE
        v_run_id := NEW.payroll_run_id;
    END IF;

    SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
    IF v_status = 'LOCKED' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cannot delete source claim: payroll run % is LOCKED and claims are permanent', v_run_id;
        ELSIF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'Cannot add source claim: payroll run % is already LOCKED', v_run_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_psc_immutability ON public.payroll_source_claims;
CREATE TRIGGER trg_psc_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_source_claims
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_source_claims_immutability();

-- 9. Atomic Lock Function (Single Transaction Lock & Claim)
CREATE OR REPLACE FUNCTION public.lock_payroll_run(
    p_run_id UUID,
    p_user_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run RECORD;
    v_blocking_count INTEGER;
    v_barber_rec RECORD;
    v_line_sum RECORD;
    v_claim_count INTEGER;
BEGIN
    -- 1. Lock and verify run exists and is DRAFT
    SELECT * INTO v_run
    FROM public.payroll_runs
    WHERE id = p_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;

    IF v_run.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot lock payroll run %: current status is % (must be DRAFT)', p_run_id, v_run.status;
    END IF;

    -- 2. Verify 0 blocking review items
    SELECT COUNT(*) INTO v_blocking_count
    FROM public.payroll_review_items
    WHERE payroll_run_id = p_run_id
      AND blocking = true;

    IF v_blocking_count > 0 THEN
        RAISE EXCEPTION 'Cannot lock payroll run %: % blocking review items remain unresolved', p_run_id, v_blocking_count;
    END IF;

    -- 3. Verify exact mathematical reconciliation per barber
    FOR v_barber_rec IN
        SELECT id, barber_id, barber_name_snapshot, net_service_revenue, commission_amount
        FROM public.payroll_barber_items
        WHERE payroll_run_id = p_run_id
    LOOP
        SELECT
            COALESCE(SUM(net_amount), 0) AS sum_net,
            COALESCE(SUM(commission_amount), 0) AS sum_comm
        INTO v_line_sum
        FROM public.payroll_barber_commission_items
        WHERE payroll_barber_item_id = v_barber_rec.id;

        IF v_line_sum.sum_net <> v_barber_rec.net_service_revenue THEN
            RAISE EXCEPTION 'Reconciliation failed for barber %: commission lines net sum (%) <> barber net revenue (%)',
                v_barber_rec.barber_name_snapshot, v_line_sum.sum_net, v_barber_rec.net_service_revenue;
        END IF;

        IF v_line_sum.sum_comm <> v_barber_rec.commission_amount THEN
            RAISE EXCEPTION 'Reconciliation failed for barber %: commission lines comm sum (%) <> barber commission (%)',
                v_barber_rec.barber_name_snapshot, v_line_sum.sum_comm, v_barber_rec.commission_amount;
        END IF;
    END LOOP;

    -- 4. Claim source items into payroll_source_claims
    -- Since source_moka_transaction_item_id is PRIMARY KEY, any duplicate claim across locked runs fails atomically!
    INSERT INTO public.payroll_source_claims (
        source_moka_transaction_item_id,
        payroll_run_id,
        claimed_at,
        claimed_by
    )
    SELECT
        source_moka_transaction_item_id,
        p_run_id,
        now(),
        p_user_email
    FROM public.payroll_barber_commission_items
    WHERE payroll_run_id = p_run_id;

    GET DIAGNOSTICS v_claim_count = ROW_COUNT;

    -- 5. Mark run as LOCKED
    UPDATE public.payroll_runs
    SET
        status = 'LOCKED',
        locked_at = now(),
        locked_by = p_user_email,
        updated_at = now()
    WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'status', 'LOCKED',
        'locked_by', p_user_email,
        'claims_created', v_claim_count
    );
END;
$$;

-- Revoke execute from public/anon/authenticated, grant to service_role only
REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role;

-- 10. Enable RLS and lock down to service_role only
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_runs TO service_role;

ALTER TABLE public.payroll_barber_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_barber_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_barber_items TO service_role;

ALTER TABLE public.payroll_barber_commission_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_barber_commission_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_barber_commission_items TO service_role;

ALTER TABLE public.payroll_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_review_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_review_items TO service_role;

ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_adjustments TO service_role;

ALTER TABLE public.payroll_source_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_source_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_source_claims TO service_role;

COMMIT;
