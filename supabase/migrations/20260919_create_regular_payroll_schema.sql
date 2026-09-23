-- Migration: Regular Payroll Schema (Redbox & Sundaze)
-- File: supabase/migrations/20260919_create_regular_payroll_schema.sql
-- Additive canonical migration creating:
--   1. Master compensation columns on public.employees (position_allowance, meal_allowance_rate)
--   2. public.payroll_regular_items (itemized calculation snapshot per regular employee)
--   3. Extension of public.payroll_adjustments to support regular employee adjustments (DEBT, BONUS, DEDUCTION, CORRECTION)
--   4. Immutability trigger for payroll_regular_items
--   5. Multi-type support in lock_payroll_run() for both REGULAR and BARBER_REVENUE_SHARE
--   6. RLS enabled and locked to service_role

BEGIN;

-- 1. Master compensation on public.employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS position_allowance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_allowance_rate NUMERIC DEFAULT 0;

-- 2. Table: payroll_regular_items
CREATE TABLE IF NOT EXISTS public.payroll_regular_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id),
    
    -- Immutable snapshots of employee metadata at calculation/lock time
    employee_name_snapshot TEXT NOT NULL,
    employee_nickname_snapshot TEXT,
    business_unit_snapshot TEXT NOT NULL,
    position_snapshot TEXT NOT NULL,
    branch_snapshot TEXT,
    
    -- Base salary and attendance days
    base_salary NUMERIC NOT NULL DEFAULT 0,
    daily_salary NUMERIC NOT NULL DEFAULT 0,
    salary_divisor NUMERIC NOT NULL DEFAULT 30,
    work_days NUMERIC NOT NULL DEFAULT 0,
    actual_salary NUMERIC NOT NULL DEFAULT 0,
    
    -- Meal allowance
    meal_allowance_days NUMERIC NOT NULL DEFAULT 0,
    meal_allowance_rate NUMERIC NOT NULL DEFAULT 0,
    meal_allowance_total NUMERIC NOT NULL DEFAULT 0,
    
    -- Allowances
    position_allowance NUMERIC NOT NULL DEFAULT 0,
    attendance_allowance NUMERIC NOT NULL DEFAULT 0,
    attendance_allowance_source TEXT NOT NULL DEFAULT 'POLICY_PENDING',
    
    -- Variables (Commissions & Overtime)
    product_commission NUMERIC NOT NULL DEFAULT 0,
    product_commission_source TEXT NOT NULL DEFAULT 'MANUAL',
    service_barber_amount NUMERIC NOT NULL DEFAULT 0,
    service_barber_source TEXT NOT NULL DEFAULT 'MANUAL',
    overtime_hours NUMERIC NOT NULL DEFAULT 0,
    overtime_rate NUMERIC NOT NULL DEFAULT 7500,
    overtime_amount NUMERIC NOT NULL DEFAULT 0,
    
    -- Deductions
    late_count NUMERIC NOT NULL DEFAULT 0,
    late_penalty_rate NUMERIC NOT NULL DEFAULT 15000,
    late_deduction NUMERIC NOT NULL DEFAULT 0,
    late_deduction_source TEXT NOT NULL DEFAULT 'ATTENDANCE + POLICY',
    debt_deduction NUMERIC NOT NULL DEFAULT 0,
    manual_deduction NUMERIC NOT NULL DEFAULT 0,
    
    -- Adjustments
    manual_bonus NUMERIC NOT NULL DEFAULT 0,
    adjustments_total NUMERIC NOT NULL DEFAULT 0,
    
    -- Totals
    gross_pay NUMERIC NOT NULL DEFAULT 0,
    total_deduction NUMERIC NOT NULL DEFAULT 0,
    take_home_pay NUMERIC NOT NULL DEFAULT 0,
    
    -- Audit & Context
    attendance_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'REVIEW_REQUIRED', 'MISSING_SALARY', 'MISSING_ATTENDANCE', 'LOCKED')),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_run_regular_emp UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pri_reg_run_id ON public.payroll_regular_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pri_reg_emp_id ON public.payroll_regular_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_pri_reg_status ON public.payroll_regular_items(payroll_run_id, status);

-- 3. Extend public.payroll_adjustments
ALTER TABLE public.payroll_adjustments
  ALTER COLUMN payroll_barber_item_id DROP NOT NULL,
  ALTER COLUMN barber_id DROP NOT NULL;

ALTER TABLE public.payroll_adjustments
  ADD COLUMN IF NOT EXISTS payroll_regular_item_id UUID REFERENCES public.payroll_regular_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'OTHER';

CREATE INDEX IF NOT EXISTS idx_pa_reg_item ON public.payroll_adjustments(payroll_regular_item_id);
CREATE INDEX IF NOT EXISTS idx_pa_emp_id ON public.payroll_adjustments(employee_id);

-- 4. Immutability trigger for payroll_regular_items
DROP TRIGGER IF EXISTS trg_pri_regular_immutability ON public.payroll_regular_items;
CREATE TRIGGER trg_pri_regular_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_regular_items
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_locked();

-- 5. Multi-type support in lock_payroll_run()
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
    v_claim_count INTEGER := 0;
    v_reg_item RECORD;
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

    -- 2. Handle based on payroll_type
    IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN
        -- Verify no blocking items (MISSING_SALARY)
        SELECT COUNT(*) INTO v_blocking_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id
          AND status = 'MISSING_SALARY';

        IF v_blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % employees have missing salary', p_run_id, v_blocking_count;
        END IF;

        -- Verify reconciliation for every item: gross_pay - total_deduction = take_home_pay
        FOR v_reg_item IN
            SELECT id, employee_name_snapshot, gross_pay, total_deduction, take_home_pay
            FROM public.payroll_regular_items
            WHERE payroll_run_id = p_run_id
        LOOP
            IF (v_reg_item.gross_pay - v_reg_item.total_deduction) <> v_reg_item.take_home_pay THEN
                RAISE EXCEPTION 'Reconciliation failed for %: gross (%) - deduction (%) <> take home (%)',
                    v_reg_item.employee_name_snapshot, v_reg_item.gross_pay, v_reg_item.total_deduction, v_reg_item.take_home_pay;
            END IF;
        END LOOP;

        -- Update items status to LOCKED
        UPDATE public.payroll_regular_items
        SET status = 'LOCKED', updated_at = now()
        WHERE payroll_run_id = p_run_id;

    ELSE
        -- Default: BARBER_REVENUE_SHARE
        SELECT COUNT(*) INTO v_blocking_count
        FROM public.payroll_review_items
        WHERE payroll_run_id = p_run_id
          AND blocking = true;

        IF v_blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock payroll run %: % blocking review items remain unresolved', p_run_id, v_blocking_count;
        END IF;

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

        -- Claim source items into payroll_source_claims
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
    END IF;

    -- 3. Mark run as LOCKED
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

REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role;

-- 6. Enable RLS and lock to service_role
ALTER TABLE public.payroll_regular_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payroll_regular_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_regular_items TO service_role;

COMMIT;
