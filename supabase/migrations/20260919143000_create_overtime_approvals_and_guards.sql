-- Migration: 20260919143000_create_overtime_approvals_and_guards.sql
-- Description:
-- 1. Create employee_overtime_approvals table
-- 2. Add attendance coverage metadata columns to payroll_regular_items
-- 3. Enhance lock_payroll_run RPC with safety guards for incomplete attendance / salary

BEGIN;

-- 1. Table: employee_overtime_approvals
CREATE TABLE IF NOT EXISTS public.employee_overtime_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id),
    attendance_date DATE NOT NULL,
    raw_overtime_minutes NUMERIC NOT NULL DEFAULT 0,
    approved_overtime_minutes NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_emp_overtime_approval_date UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_eoa_emp_date ON public.employee_overtime_approvals(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_eoa_status ON public.employee_overtime_approvals(status);

ALTER TABLE public.employee_overtime_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'employee_overtime_approvals'
          AND policyname = 'Allow service_role full access on employee_overtime_approvals'
    ) THEN
        CREATE POLICY "Allow service_role full access on employee_overtime_approvals"
        ON public.employee_overtime_approvals
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'employee_overtime_approvals'
          AND policyname = 'Allow authenticated read on employee_overtime_approvals'
    ) THEN
        CREATE POLICY "Allow authenticated read on employee_overtime_approvals"
        ON public.employee_overtime_approvals
        FOR SELECT
        TO authenticated
        USING (true);
    END IF;
END $$;

-- 2. Add attendance coverage metadata columns to payroll_regular_items
ALTER TABLE public.payroll_regular_items
    ADD COLUMN IF NOT EXISTS attendance_period_expected TEXT,
    ADD COLUMN IF NOT EXISTS attendance_period_available TEXT,
    ADD COLUMN IF NOT EXISTS attendance_coverage_days INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attendance_coverage_status TEXT DEFAULT 'NO_ATTENDANCE';

ALTER TABLE public.payroll_regular_items
    DROP CONSTRAINT IF EXISTS payroll_regular_items_status_check;

ALTER TABLE public.payroll_regular_items
    ADD CONSTRAINT payroll_regular_items_status_check
    CHECK (status IN ('READY', 'REVIEW_REQUIRED', 'MISSING_SALARY', 'MISSING_ATTENDANCE', 'BLOCKED_ATTENDANCE_SOURCE', 'LOCKED'));

-- 3. Enhance lock_payroll_run RPC with safety guards
CREATE OR REPLACE FUNCTION public.lock_payroll_run(
    p_run_id UUID,
    p_user_email TEXT DEFAULT 'owner@redbox.id'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run RECORD;
    v_blocking_count INTEGER := 0;
BEGIN
    SELECT * INTO v_run
    FROM public.payroll_runs
    WHERE id = p_run_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;

    IF v_run.status = 'LOCKED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Run already locked', 'status', 'LOCKED');
    END IF;

    -- Safety check for Regular Payroll: Cannot lock if employees are missing attendance or salary
    IF v_run.payroll_type = 'REGULAR' THEN
        SELECT COUNT(*) INTO v_blocking_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id
          AND status IN ('MISSING_ATTENDANCE', 'MISSING_SALARY', 'BLOCKED_ATTENDANCE_SOURCE');

        IF v_blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % employee(s) have incomplete attendance or salary data (MISSING_ATTENDANCE / BLOCKED_ATTENDANCE_SOURCE). Take-home pay is not finalized.', p_run_id, v_blocking_count;
        END IF;
    END IF;

    -- Transition status
    UPDATE public.payroll_runs
    SET status = 'LOCKED',
        locked_at = now(),
        locked_by = p_user_email,
        updated_at = now()
    WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'status', 'LOCKED',
        'locked_at', now(),
        'locked_by', p_user_email
    );
END;
$$;

COMMIT;
