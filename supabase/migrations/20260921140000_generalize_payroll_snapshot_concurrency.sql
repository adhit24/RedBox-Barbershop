-- ====================================================================================================
-- Migration: 20260921140000_generalize_payroll_snapshot_concurrency.sql
-- Description:
--   1. P1-1 (PRRT_kwDOSNmW7c6kV8-q): Generation race closure with source version validation in create_regular_payroll_run.
--   2. P1-2 (PRRT_kwDOSNmW7c6kV8-0): Corrective revision initialization for DRAFT items only (never touching LOCKED rows).
--   3. P2   (PRRT_kwDOSNmW7c6kV8-6): Generalized snapshot concurrency model across attendance, overtime, adjustments.
--
-- Invariants preserved:
--   - LOCKED payroll items are never mutated (check_payroll_run_not_locked immutability preserved)
--   - Generation rejects concurrent attendance changes with ATTENDANCE_CHANGED_DURING_GENERATION
--   - Overtime approvals, adjustments, and attendance all bump payroll_input_revision atomically
--   - lock_payroll_run checks payroll_input_revision = payroll_snapshot_revision and all dirty flags FALSE
--   - Barber payroll locking preserved verbatim
--   - Execute rights: service_role only (no widening)
-- ====================================================================================================

BEGIN;

-- 1. Generalized revision columns on payroll_regular_items --------------------------------------------
ALTER TABLE public.payroll_regular_items
ADD COLUMN IF NOT EXISTS payroll_input_revision BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS payroll_snapshot_revision BIGINT NOT NULL DEFAULT 0;

-- 2. Authoritative attendance source version tracking per employee (P1-1) ------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_attendance_source_versions (
    employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    source_revision BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_attendance_source_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'payroll_attendance_source_versions'
          AND policyname = 'service_role_all_payroll_att_source_versions'
    ) THEN
        CREATE POLICY "service_role_all_payroll_att_source_versions"
        ON public.payroll_attendance_source_versions
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'payroll_attendance_source_versions'
          AND policyname = 'authenticated_select_payroll_att_source_versions'
    ) THEN
        CREATE POLICY "authenticated_select_payroll_att_source_versions"
        ON public.payroll_attendance_source_versions
        FOR SELECT TO authenticated
        USING (true);
    END IF;
END $$;

-- Initialize source versions for existing employees
INSERT INTO public.payroll_attendance_source_versions (employee_id, source_revision)
SELECT id, 0 FROM public.employees
ON CONFLICT (employee_id) DO NOTHING;

-- 3. Corrective revision initialization: DRAFT items ONLY (P1-2) --------------------------------------
-- LOCKED runs are never mutated through normal UPDATE paths.
UPDATE public.payroll_regular_items i
SET
    attendance_source_revision = CASE
        WHEN COALESCE((i.attendance_summary ->> 'attendance_dirty')::BOOLEAN, FALSE) THEN 1
        ELSE COALESCE(i.attendance_source_revision, 0)
    END,
    attendance_snapshot_revision = COALESCE(i.attendance_snapshot_revision, 0),
    payroll_input_revision = CASE
        WHEN COALESCE((i.attendance_summary ->> 'attendance_dirty')::BOOLEAN, FALSE)
          OR COALESCE((i.attendance_summary ->> 'adjustments_dirty')::BOOLEAN, FALSE) THEN 1
        ELSE 0
    END,
    payroll_snapshot_revision = 0
FROM public.payroll_runs r
WHERE i.payroll_run_id = r.id
  AND r.status = 'DRAFT';

-- 4. Attendance sync: increment source version + DRAFT item input revision (P1-1 & P2) ----------------
CREATE OR REPLACE FUNCTION public.apply_attendance_payroll_effect(
    p_employee_id UUID,
    p_date DATE,
    p_operation TEXT,
    p_old JSONB,
    p_new JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_employee_id IS NULL OR p_date IS NULL THEN
        RETURN;
    END IF;

    -- (1) Increment authoritative source version for the employee
    INSERT INTO public.payroll_attendance_source_versions (employee_id, source_revision, updated_at)
    VALUES (p_employee_id, 1, now())
    ON CONFLICT (employee_id)
    DO UPDATE SET source_revision = payroll_attendance_source_versions.source_revision + 1, updated_at = now();

    -- (2) Synchronise with lock_payroll_run(): SHARE on covering DRAFT runs in id order
    PERFORM public.serialize_regular_payroll_mutation(p_employee_id, p_date);

    -- (3) DRAFT items of the employee whose run covers the date are now stale:
    -- increment attendance_source_revision, payroll_input_revision, and set attendance_dirty = true atomically
    UPDATE public.payroll_regular_items i
    SET 
        attendance_source_revision = i.attendance_source_revision + 1,
        payroll_input_revision = i.payroll_input_revision + 1,
        attendance_summary = jsonb_set(COALESCE(i.attendance_summary, '{}'::jsonb), '{attendance_dirty}', 'true'::jsonb, true)
    FROM public.payroll_runs r
    WHERE i.payroll_run_id = r.id
      AND r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
      AND r.status = 'DRAFT'
      AND i.employee_id = p_employee_id
      AND i.status <> 'LOCKED'
      AND p_date BETWEEN r.period_start AND r.period_end;

    -- (4) LOCKED payroll is never mutated; report the anomaly instead
    INSERT INTO public.payroll_attendance_post_lock_anomalies (payroll_run_id, employee_id, attendance_date, operation, old_values, new_values)
    SELECT r.id, p_employee_id, p_date, p_operation, p_old, p_new
    FROM public.payroll_runs r
    WHERE r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
      AND r.status = 'LOCKED'
      AND p_date BETWEEN r.period_start AND r.period_end
      AND EXISTS (
          SELECT 1 FROM public.payroll_regular_items i
          WHERE i.payroll_run_id = r.id AND i.employee_id = p_employee_id
      );
END;
$$;
REVOKE ALL ON FUNCTION public.apply_attendance_payroll_effect(UUID, DATE, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_attendance_payroll_effect(UUID, DATE, TEXT, JSONB, JSONB) TO service_role;

-- 5. Overtime approvals sync: bump source version & payroll_input_revision (P1-1 & P2) -----------------
CREATE OR REPLACE FUNCTION public.trg_overtime_approval_payroll_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_emp UUID;
    v_date DATE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_emp := OLD.employee_id;
        v_date := OLD.attendance_date;
    ELSE
        v_emp := NEW.employee_id;
        v_date := NEW.attendance_date;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.approved_overtime_minutes IS NOT DISTINCT FROM NEW.approved_overtime_minutes
       AND OLD.raw_overtime_minutes IS NOT DISTINCT FROM NEW.raw_overtime_minutes THEN
        RETURN NEW;
    END IF;

    -- Increment authoritative source version for the employee
    INSERT INTO public.payroll_attendance_source_versions (employee_id, source_revision, updated_at)
    VALUES (v_emp, 1, now())
    ON CONFLICT (employee_id)
    DO UPDATE SET source_revision = payroll_attendance_source_versions.source_revision + 1, updated_at = now();

    -- Synchronize with lock_payroll_run()
    PERFORM public.serialize_regular_payroll_mutation(v_emp, v_date);

    -- Bump payroll_input_revision on covering DRAFT items
    UPDATE public.payroll_regular_items i
    SET payroll_input_revision = i.payroll_input_revision + 1,
        updated_at = now()
    FROM public.payroll_runs r
    WHERE i.payroll_run_id = r.id
      AND r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
      AND r.status = 'DRAFT'
      AND i.employee_id = v_emp
      AND i.status <> 'LOCKED'
      AND v_date BETWEEN r.period_start AND r.period_end;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_overtime_approval_payroll_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_overtime_approval_payroll_sync ON public.employee_overtime_approvals;
CREATE TRIGGER trg_overtime_approval_payroll_sync
AFTER INSERT OR UPDATE OR DELETE ON public.employee_overtime_approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_overtime_approval_payroll_sync();

-- 6. Adjustments sync: bump payroll_input_revision and set adjustments_dirty (P2) ---------------------
CREATE OR REPLACE FUNCTION public.trg_payroll_adjustment_mark_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.payroll_regular_item_id IS NOT NULL THEN
        UPDATE public.payroll_regular_items
        SET payroll_input_revision = payroll_input_revision + 1,
            attendance_summary = jsonb_set(COALESCE(attendance_summary, '{}'::JSONB), '{adjustments_dirty}', 'true'::JSONB, TRUE),
            updated_at = now()
        WHERE id = OLD.payroll_regular_item_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.payroll_regular_item_id IS NOT NULL THEN
        UPDATE public.payroll_regular_items
        SET payroll_input_revision = payroll_input_revision + 1,
            attendance_summary = jsonb_set(COALESCE(attendance_summary, '{}'::JSONB), '{adjustments_dirty}', 'true'::JSONB, TRUE),
            updated_at = now()
        WHERE id = NEW.payroll_regular_item_id;
    END IF;
    RETURN NULL;
END;
$$;

-- 7. Atomic creation with source version validation under advisory lock (P1-1) ------------------------
CREATE OR REPLACE FUNCTION public.create_regular_payroll_run(p_header JSONB, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run_id UUID;
    v_expected INTEGER;
    v_inserted INTEGER;
    v_item RECORD;
    v_curr_ver BIGINT;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Cannot create a regular payroll run without payroll items';
    END IF;
    v_expected := jsonb_array_length(p_items);

    -- Serialize concurrent generations and freeze checking
    PERFORM pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'));

    -- Validate that source revision has not changed during calculation (P1-1)
    FOR v_item IN SELECT * FROM jsonb_populate_recordset(NULL::public.payroll_regular_items, p_items) LOOP
        SELECT COALESCE(v.source_revision, 0) INTO v_curr_ver
        FROM public.payroll_attendance_source_versions v
        WHERE v.employee_id = v_item.employee_id;

        IF NOT FOUND THEN
            v_curr_ver := 0;
        END IF;

        IF v_curr_ver <> COALESCE(v_item.attendance_source_revision, 0) THEN
            RAISE EXCEPTION 'ATTENDANCE_CHANGED_DURING_GENERATION: attendance source changed for employee % (expected %, current %)',
                v_item.employee_id, v_item.attendance_source_revision, v_curr_ver;
        END IF;
    END LOOP;

    -- The overlap trigger also fires here and rolls everything back on conflict
    INSERT INTO public.payroll_runs (
        payroll_type, business_unit, period_start, period_end, status,
        generated_by, calculation_version, summary
    ) VALUES (
        'REGULAR',
        COALESCE(p_header ->> 'business_unit', 'ALL'),
        (p_header ->> 'period_start')::DATE,
        (p_header ->> 'period_end')::DATE,
        'DRAFT',
        p_header ->> 'generated_by',
        COALESCE(p_header ->> 'calculation_version', 'regular-v1.0'),
        COALESCE(p_header -> 'summary', '{}'::JSONB)
    )
    RETURNING id INTO v_run_id;

    INSERT INTO public.payroll_regular_items (
        payroll_run_id, employee_id, employee_name_snapshot, employee_nickname_snapshot,
        business_unit_snapshot, position_snapshot, branch_snapshot,
        base_salary, daily_salary, salary_divisor, work_days, actual_salary,
        meal_allowance_days, meal_allowance_rate, meal_allowance_total,
        position_allowance, attendance_allowance, attendance_allowance_source,
        product_commission, product_commission_source, service_barber_amount, service_barber_source,
        overtime_hours, overtime_rate, overtime_amount,
        late_count, late_penalty_rate, late_deduction, late_deduction_source,
        debt_deduction, manual_deduction, manual_bonus, adjustments_total,
        gross_pay, total_deduction, take_home_pay,
        attendance_period_expected, attendance_period_available,
        attendance_coverage_days, attendance_coverage_status,
        attendance_summary, warnings, status,
        attendance_source_revision, attendance_snapshot_revision,
        payroll_input_revision, payroll_snapshot_revision
    )
    SELECT
        v_run_id, r.employee_id, r.employee_name_snapshot, r.employee_nickname_snapshot,
        r.business_unit_snapshot, r.position_snapshot, r.branch_snapshot,
        r.base_salary, r.daily_salary, r.salary_divisor, r.work_days, r.actual_salary,
        r.meal_allowance_days, r.meal_allowance_rate, r.meal_allowance_total,
        r.position_allowance, r.attendance_allowance, r.attendance_allowance_source,
        r.product_commission, r.product_commission_source, r.service_barber_amount, r.service_barber_source,
        r.overtime_hours, r.overtime_rate, r.overtime_amount,
        r.late_count, r.late_penalty_rate, r.late_deduction, r.late_deduction_source,
        r.debt_deduction, r.manual_deduction, r.manual_bonus, r.adjustments_total,
        r.gross_pay, r.total_deduction, r.take_home_pay,
        r.attendance_period_expected, r.attendance_period_available,
        r.attendance_coverage_days, r.attendance_coverage_status,
        r.attendance_summary, r.warnings, r.status,
        COALESCE(r.attendance_source_revision, 0),
        COALESCE(r.attendance_snapshot_revision, 0),
        COALESCE(r.payroll_input_revision, 0),
        COALESCE(r.payroll_snapshot_revision, 0)
    FROM jsonb_populate_recordset(NULL::public.payroll_regular_items, p_items) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> v_expected THEN
        RAISE EXCEPTION 'Regular payroll run creation aborted: inserted % of % items', v_inserted, v_expected;
    END IF;

    RETURN jsonb_build_object('run_id', v_run_id, 'items_count', v_inserted, 'status', 'DRAFT');
END;
$$;

-- 8. lock_payroll_run with generalized revision invariant (P2) ----------------------------------------
CREATE OR REPLACE FUNCTION public.lock_payroll_run(
    p_run_id UUID,
    p_user_email TEXT DEFAULT 'owner@redbox.id'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run public.payroll_runs%ROWTYPE;
    v_blocking_count INTEGER := 0;
    v_review_count INTEGER := 0;
    v_pending_overtime INTEGER := 0;
    v_unreviewed_overtime INTEGER := 0;
    v_source_mismatch INTEGER := 0;
    v_item_count INTEGER := 0;
    v_overlap UUID;
    v_db_minutes NUMERIC := 0;
    v_adj_bonus NUMERIC := 0;
    v_adj_debt NUMERIC := 0;
    v_adj_deduction NUMERIC := 0;
    v_snap_item RECORD;
    v_barber_rec RECORD;
    v_line_sum RECORD;
    v_claim_count INTEGER := 0;
    v_reg_item RECORD;
BEGIN
    -- 1. Lock and verify run exists and is DRAFT (all payroll types)
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

    -- 2. Branch on payroll_type
    IF v_run.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') THEN
        -- 2-. Defensive backstops: a run without items, or one overlapping another active run, is never lockable
        SELECT COUNT(*) INTO v_item_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id;

        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: it has no payroll items', p_run_id;
        END IF;

        v_overlap := public.find_overlapping_regular_run(p_run_id, v_run.business_unit, v_run.period_start, v_run.period_end);
        IF v_overlap IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: it overlaps regular payroll run %', p_run_id, v_overlap;
        END IF;

        -- 2a. No employee may be missing salary / attendance
        SELECT COUNT(*) INTO v_blocking_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id
          AND status IN ('MISSING_ATTENDANCE', 'MISSING_SALARY', 'BLOCKED_ATTENDANCE_SOURCE');

        IF v_blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % employee(s) have incomplete attendance or salary data (MISSING_ATTENDANCE / MISSING_SALARY / BLOCKED_ATTENDANCE_SOURCE). Take-home pay is not finalized.',
                p_run_id, v_blocking_count;
        END IF;

        -- 2b. No overtime approval may still be PENDING for this run's employees and period
        SELECT COUNT(*) INTO v_pending_overtime
        FROM public.employee_overtime_approvals a
        WHERE a.status = 'PENDING'
          AND a.attendance_date BETWEEN v_run.period_start AND v_run.period_end
          AND EXISTS (
              SELECT 1
              FROM public.payroll_regular_items i
              WHERE i.payroll_run_id = p_run_id
                AND i.employee_id = a.employee_id
          );

        IF v_pending_overtime > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % pending overtime approval(s) remain. Approve or reject them first.',
                p_run_id, v_pending_overtime;
        END IF;

        -- 2c. Every attendance day with overtime needs a reviewed approval (catches unsynced overtime)
        SELECT COUNT(*) INTO v_unreviewed_overtime
        FROM public.employee_attendance att
        WHERE att.overtime_minutes > 0
          AND att.attendance_date BETWEEN v_run.period_start AND v_run.period_end
          AND EXISTS (
              SELECT 1
              FROM public.payroll_regular_items i
              WHERE i.payroll_run_id = p_run_id
                AND i.employee_id = att.employee_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.employee_overtime_approvals a
              WHERE a.employee_id = att.employee_id
                AND a.attendance_date = att.attendance_date
                AND a.status IN ('APPROVED', 'REJECTED')
          );

        IF v_unreviewed_overtime > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % attendance overtime row(s) have no reviewed approval. Sync and review overtime first.',
                p_run_id, v_unreviewed_overtime;
        END IF;

        -- 2d. Approvals must still match the attendance source (source corrected after the decision)
        SELECT COUNT(*) INTO v_source_mismatch
        FROM public.employee_overtime_approvals a
        WHERE a.attendance_date BETWEEN v_run.period_start AND v_run.period_end
          AND EXISTS (
              SELECT 1
              FROM public.payroll_regular_items i
              WHERE i.payroll_run_id = p_run_id
                AND i.employee_id = a.employee_id
          )
          AND a.raw_overtime_minutes <> COALESCE((
              SELECT att.overtime_minutes
              FROM public.employee_attendance att
              WHERE att.employee_id = a.employee_id
                AND att.attendance_date = a.attendance_date
          ), 0);

        IF v_source_mismatch > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % overtime approval(s) no longer match attendance overtime. Reconcile and re-review first.',
                p_run_id, v_source_mismatch;
        END IF;

        -- 2e. Snapshot consistency per item:
        -- - attendance_dirty must be false
        -- - attendance_source_revision must equal attendance_snapshot_revision
        -- - payroll_input_revision must equal payroll_snapshot_revision
        -- - adjustments_dirty must be false
        -- - approved overtime minutes DB sum must equal item snapshot
        -- - adjustment aggregate DB sum must equal item snapshot
        FOR v_snap_item IN
            SELECT i.id,
                   i.employee_id,
                   i.employee_name_snapshot,
                   COALESCE(i.overtime_hours, 0) AS overtime_hours,
                   COALESCE((i.attendance_summary ->> 'approved_overtime_minutes')::NUMERIC, 0) AS snap_minutes,
                   COALESCE((i.attendance_summary ->> 'adjustments_dirty')::BOOLEAN, FALSE) AS adjustments_dirty,
                   COALESCE((i.attendance_summary ->> 'attendance_dirty')::BOOLEAN, FALSE) AS attendance_dirty,
                   i.attendance_source_revision,
                   i.attendance_snapshot_revision,
                   i.payroll_input_revision,
                   i.payroll_snapshot_revision,
                   COALESCE(i.manual_bonus, 0) AS manual_bonus,
                   COALESCE(i.debt_deduction, 0) AS debt_deduction,
                   COALESCE(i.manual_deduction, 0) AS manual_deduction,
                   COALESCE(i.adjustments_total, 0) AS adjustments_total
            FROM public.payroll_regular_items i
            WHERE i.payroll_run_id = p_run_id
        LOOP
            IF v_snap_item.attendance_dirty
               OR v_snap_item.attendance_source_revision <> v_snap_item.attendance_snapshot_revision
               OR v_snap_item.payroll_input_revision <> v_snap_item.payroll_snapshot_revision THEN
                RAISE EXCEPTION 'Payroll attendance snapshot is stale for %. Recalculate before locking.',
                    v_snap_item.employee_name_snapshot;
            END IF;

            SELECT COALESCE(SUM(a.approved_overtime_minutes), 0) INTO v_db_minutes
            FROM public.employee_overtime_approvals a
            WHERE a.employee_id = v_snap_item.employee_id
              AND a.status = 'APPROVED'
              AND a.attendance_date BETWEEN v_run.period_start AND v_run.period_end;

            IF v_db_minutes <> v_snap_item.snap_minutes
               OR ABS(v_snap_item.overtime_hours - ROUND(v_db_minutes / 60.0, 1)) > 0.05 THEN
                RAISE EXCEPTION 'Payroll overtime snapshot is stale for %. Recalculate before locking.',
                    v_snap_item.employee_name_snapshot;
            END IF;

            -- adjustment aggregate with engine semantics:
            SELECT
                COALESCE(SUM(CASE WHEN x.t = 'BONUS' THEN ABS(x.amount)
                                  WHEN x.t IN ('DEBT', 'DEDUCTION') THEN 0
                                  ELSE GREATEST(x.amount, 0) END), 0),
                COALESCE(SUM(CASE WHEN x.t = 'DEBT' THEN ABS(x.amount) ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN x.t = 'DEDUCTION' THEN ABS(x.amount)
                                  WHEN x.t IN ('BONUS', 'DEBT') THEN 0
                                  ELSE GREATEST(-x.amount, 0) END), 0)
            INTO v_adj_bonus, v_adj_debt, v_adj_deduction
            FROM (
                SELECT a.amount, UPPER(BTRIM(a.type)) AS t
                FROM public.payroll_adjustments a
                WHERE a.payroll_regular_item_id = v_snap_item.id
            ) x;

            IF v_snap_item.adjustments_dirty
               OR v_adj_bonus <> v_snap_item.manual_bonus
               OR v_adj_debt <> v_snap_item.debt_deduction
               OR v_adj_deduction <> v_snap_item.manual_deduction
               OR (v_adj_bonus - v_adj_debt - v_adj_deduction) <> v_snap_item.adjustments_total THEN
                RAISE EXCEPTION 'Payroll adjustment snapshot is stale for %. Recalculate before locking.',
                    v_snap_item.employee_name_snapshot;
            END IF;
        END LOOP;

        -- 2f. Attendance source must cover the whole payroll period
        IF COALESCE(v_run.summary ->> 'attendance_period_complete', '') = 'false' THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: attendance data is only available through % but the period ends %.',
                p_run_id, COALESCE(v_run.summary ->> 'attendance_data_through', 'unknown'), v_run.period_end;
        END IF;

        -- 2g. Reconciliation for every item: gross_pay - total_deduction = take_home_pay
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

        -- 2g-2. All review-required items must be resolved before locking
        SELECT COUNT(*) INTO v_review_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id
          AND status = 'REVIEW_REQUIRED';

        IF v_review_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % review-required item(s) remain. Resolve all review warnings before locking.',
                p_run_id, v_review_count;
        END IF;

        -- 2h. Freeze items
        UPDATE public.payroll_regular_items
        SET status = 'LOCKED', updated_at = now()
        WHERE payroll_run_id = p_run_id;

    ELSE
        -- Barber payroll: preserved verbatim from 20260918_create_payroll_draft_schema.sql
        -- 2a. Verify 0 blocking review items
        SELECT COUNT(*) INTO v_blocking_count
        FROM public.payroll_review_items
        WHERE payroll_run_id = p_run_id
          AND blocking = true;

        IF v_blocking_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock payroll run %: % blocking review items remain unresolved', p_run_id, v_blocking_count;
        END IF;

        -- 2b. Verify exact mathematical reconciliation per barber
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

        -- 2c. Claim source items into payroll_source_claims
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
        'locked_at', now(),
        'locked_by', p_user_email,
        'claims_created', v_claim_count
    );
END;
$$;

-- Execute rights: service_role only (no widening)
REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role;

-- Record migration in schema_migrations
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260921140000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
