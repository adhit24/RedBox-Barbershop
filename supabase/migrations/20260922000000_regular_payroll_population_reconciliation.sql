-- ====================================================================================================
-- Migration: 20260922000000_regular_payroll_population_reconciliation.sql
-- Description:
--   Codex round-11 P1 findings on PR #98:
--   1. PRRT_kwDOSNmW7c6kkm1V: employees.employment_type = 'regular' is now enforced at the DB level
--      wherever the regular-payroll eligible population is read (Node-side change, no schema needed --
--      see server/services/regularPayrollService.js fetchEligibleRegularEmployees).
--   2. PRRT_kwDOSNmW7c6kkm1X: a DRAFT regular payroll run's payroll_regular_items population can drift
--      from the CURRENT authoritative eligible-employee population (new hires, activations, or
--      employment_type corrections after the draft was generated). This migration adds:
--        a. add_regular_payroll_run_items(p_run_id, p_items): inserts payroll items for employees
--           newly eligible for an existing DRAFT run, reusing the same source-revision concurrency
--           guard as create_regular_payroll_run (P1-1, 20260921140000) and independently
--           re-verifying employee eligibility server-side (is_active, employment_type, join_date)
--           under the SAME advisory lock used by generation/lock, so it can never race them.
--        b. lock_payroll_run(): adds an authoritative population-completeness backstop (every
--           currently-eligible employee must have an item) and blocks locking any item flagged
--           population_changed (an existing item whose employee is no longer eligible -- see
--           regularPayrollService.reconcileRegularPayrollPopulation, which flags rather than
--           deletes such items for audit).
--
-- Invariants preserved:
--   - LOCKED payroll items/runs are never mutated (check_payroll_run_not_locked immutability preserved)
--   - Barber payroll branch preserved verbatim
--   - SECURITY INVOKER preserved
--   - Execute rights: service_role only (no widening)
--   - No existing applied migration is edited
-- ====================================================================================================

BEGIN;

-- 1. Add missing-eligible-employee items to an existing DRAFT regular payroll run -----------------
CREATE OR REPLACE FUNCTION public.add_regular_payroll_run_items(p_run_id UUID, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run public.payroll_runs%ROWTYPE;
    v_expected INTEGER;
    v_inserted INTEGER;
    v_item RECORD;
    v_curr_ver BIGINT;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RETURN jsonb_build_object('run_id', p_run_id, 'items_count', 0, 'status', 'NOOP');
    END IF;
    v_expected := jsonb_array_length(p_items);

    -- Serialize with the SAME advisory lock used by create_regular_payroll_run / lock_payroll_run, so
    -- population reconciliation can never race a concurrent generation or lock.
    PERFORM pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'));

    SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;
    IF v_run.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot add items to payroll run %: status is % (only DRAFT can be modified)', p_run_id, v_run.status;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_populate_recordset(NULL::public.payroll_regular_items, p_items) LOOP
        -- Never duplicate: an employee already present in this run is rejected, not silently skipped or
        -- re-inserted -- the caller re-derives the missing set fresh and retries.
        IF EXISTS (
            SELECT 1 FROM public.payroll_regular_items i
            WHERE i.payroll_run_id = p_run_id AND i.employee_id = v_item.employee_id
        ) THEN
            RAISE EXCEPTION 'EMPLOYEE_ALREADY_IN_RUN: employee % already has a payroll item in run %', v_item.employee_id, p_run_id;
        END IF;

        -- Re-validate attendance source revision (same invariant as create_regular_payroll_run, P1-1):
        -- population reconciliation must not insert an item calculated from stale attendance.
        SELECT COALESCE(v.source_revision, 0) INTO v_curr_ver
        FROM public.payroll_attendance_source_versions v
        WHERE v.employee_id = v_item.employee_id;
        IF NOT FOUND THEN
            v_curr_ver := 0;
        END IF;
        IF v_curr_ver <> COALESCE(v_item.attendance_source_revision, 0) THEN
            RAISE EXCEPTION 'PAYROLL_INPUT_CHANGED_DURING_POPULATION_RECONCILIATION: attendance source changed for employee % (expected %, current %)',
                v_item.employee_id, v_item.attendance_source_revision, v_curr_ver;
        END IF;

        -- Server-side eligibility re-check: authoritative regardless of how stale the caller's own
        -- eligibility snapshot might be. Mirrors the Node-side rule (P1-1, PRRT_kwDOSNmW7c6kkm1V):
        -- is_active, employment_type = 'regular', join_date <= period_end, matching business unit.
        IF NOT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = v_item.employee_id
              AND e.is_active = true
              AND e.employment_type = 'regular'
              AND (e.join_date IS NULL OR e.join_date <= v_run.period_end)
              AND (v_run.business_unit = 'ALL' OR e.business_unit = v_run.business_unit)
        ) THEN
            RAISE EXCEPTION 'EMPLOYEE_NOT_ELIGIBLE_FOR_POPULATION_RECONCILIATION: employee % is not currently eligible for run %', v_item.employee_id, p_run_id;
        END IF;
    END LOOP;

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
        p_run_id, r.employee_id, r.employee_name_snapshot, r.employee_nickname_snapshot,
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
        RAISE EXCEPTION 'Population reconciliation aborted: inserted % of % items', v_inserted, v_expected;
    END IF;

    RETURN jsonb_build_object('run_id', p_run_id, 'items_count', v_inserted, 'status', 'DRAFT');
END;
$$;
REVOKE ALL ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_regular_payroll_run_items(UUID, JSONB) TO service_role;

-- 2. lock_payroll_run: population-completeness backstop + population_changed guard -----------------
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
    v_missing_eligible INTEGER := 0;
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

        -- 2a-2. Population completeness backstop (P1-2, PRRT_kwDOSNmW7c6kkm1X): every employee
        -- CURRENTLY eligible for this run's business unit/period must already have an item. This is the
        -- authoritative check -- reconcileRegularPayrollPopulation (Node) inserts missing items before
        -- this point in normal operation, but the DB never relies on that alone.
        SELECT COUNT(*) INTO v_missing_eligible
        FROM public.employees e
        WHERE e.is_active = true
          AND e.employment_type = 'regular'
          AND (e.join_date IS NULL OR e.join_date <= v_run.period_end)
          AND (v_run.business_unit = 'ALL' OR e.business_unit = v_run.business_unit)
          AND NOT EXISTS (
              SELECT 1 FROM public.payroll_regular_items i
              WHERE i.payroll_run_id = p_run_id AND i.employee_id = e.id
          );

        IF v_missing_eligible > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % eligible employee(s) are missing from the payroll run. Recalculate to reconcile the population first.',
                p_run_id, v_missing_eligible;
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
        -- - population_changed must be false (employee still currently eligible)
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
                   COALESCE((i.attendance_summary ->> 'population_changed')::BOOLEAN, FALSE) AS population_changed,
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
            IF v_snap_item.population_changed THEN
                RAISE EXCEPTION 'Cannot lock regular payroll run %: employee % is no longer eligible for this run (EMPLOYEE_NO_LONGER_ELIGIBLE_FOR_RUN). Resolve before locking.',
                    p_run_id, v_snap_item.employee_name_snapshot;
            END IF;

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
VALUES ('20260922000000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
