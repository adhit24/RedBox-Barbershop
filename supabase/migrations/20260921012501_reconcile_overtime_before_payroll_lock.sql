-- Forward-only migration: overtime reconciliation invariants in lock_payroll_run().
--
-- Model:  attendance source -> overtime reconciliation -> approval state -> payroll snapshot -> LOCK.
-- The database RPC is the last authority. On top of 20260921005831 (pending approvals block the lock),
-- the REGULAR branch now also refuses to lock when:
--   (a) an attendance day with overtime_minutes > 0 has no reviewed (APPROVED / REJECTED) approval
--       (unsynced or undecided source overtime),
--   (b) an approval's raw_overtime_minutes differs from the current attendance overtime
--       (source corrected after the decision / candidate is stale),
--   (c) per payroll item, the SUM of APPROVED minutes in the run period differs from the overtime
--       snapshot stored on the item (approve -> lock race: the item was not recalculated yet).
--
-- Lock invariants for a REGULAR run (all must hold):
--   1 no MISSING_SALARY   2 no MISSING_ATTENDANCE   3 no BLOCKED_ATTENDANCE_SOURCE
--   4 attendance period complete
--   5 no attendance overtime without a reviewed approval
--   6 no PENDING approval
--   7 approval raw minutes == current attendance overtime
--   8 sum(APPROVED minutes) == payroll item overtime snapshot
--   9 gross - deduction == take-home
--
-- Everything else is unchanged: DRAFT-only + row lock, SECURITY INVOKER, explicit REGULAR /
-- non-REGULAR (barber) branches with the barber branch verbatim, service_role-only execution.
-- Applied migrations are not edited.

BEGIN;

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
    v_run RECORD;
    v_blocking_count INTEGER := 0;
    v_pending_overtime INTEGER := 0;
    v_unreviewed_overtime INTEGER := 0;
    v_source_mismatch INTEGER := 0;
    v_db_minutes NUMERIC := 0;
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

        -- 2e. Snapshot consistency: approved minutes in the database must equal what each item was
        -- calculated with (closes the approve -> lock race; the formula itself is not duplicated here)
        FOR v_snap_item IN
            SELECT i.id,
                   i.employee_id,
                   i.employee_name_snapshot,
                   COALESCE(i.overtime_hours, 0) AS overtime_hours,
                   COALESCE((i.attendance_summary ->> 'approved_overtime_minutes')::NUMERIC, 0) AS snap_minutes
            FROM public.payroll_regular_items i
            WHERE i.payroll_run_id = p_run_id
        LOOP
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

        -- 2h. Freeze items (run is still DRAFT here, so the immutability trigger allows it)
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

        -- 2c. Claim source items into payroll_source_claims.
        -- source_moka_transaction_item_id is the PRIMARY KEY, so any duplicate claim across
        -- locked runs fails atomically (duplicate payment protection).
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

-- Execute rights: service_role only (unchanged)
REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role;

COMMIT;
