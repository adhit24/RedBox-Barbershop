-- ====================================================================================================
-- Migration: 20260921110000_block_review_required_on_payroll_lock.sql
-- Description: Block all REVIEW_REQUIRED items before locking regular payroll runs (P1-1).
--
-- Background:
--   The Regular Payroll engine marks an item REVIEW_REQUIRED for incomplete punches, unresolved
--   attendance exceptions, insufficient coverage, overtime discrepancies, unverified commission, etc.
--   The lock RPC previously guarded only MISSING_* and overtime conditions.
--   This migration ensures ANY item with status = 'REVIEW_REQUIRED' blocks lock_payroll_run.
--
-- Invariants preserved:
--   - MISSING_SALARY, MISSING_ATTENDANCE, BLOCKED_ATTENDANCE_SOURCE block lock
--   - REVIEW_REQUIRED blocks lock
--   - attendance period incomplete blocks lock
--   - pending overtime blocks lock
--   - missing reviewed overtime blocks lock
--   - overtime source mismatch blocks lock
--   - stale overtime snapshot blocks lock
--   - attendance_dirty blocks lock
--   - adjustments_dirty blocks lock
--   - adjustment aggregate mismatch blocks lock
--   - empty run blocks lock
--   - overlap blocks lock
--   - gross/deduction/take-home reconciliation blocks lock
--   - Barber payroll locking preserved verbatim
--   - Execute rights: service_role only (no widening)
-- ====================================================================================================

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

        -- 2e. Snapshot consistency per item: approved overtime minutes AND manual adjustments in the database
        -- must equal what the item was calculated with (closes the approve/adjust -> lock race; the salary
        -- formula itself is not duplicated here, only the authoritative aggregates are compared)
        FOR v_snap_item IN
            SELECT i.id,
                   i.employee_id,
                   i.employee_name_snapshot,
                   COALESCE(i.overtime_hours, 0) AS overtime_hours,
                   COALESCE((i.attendance_summary ->> 'approved_overtime_minutes')::NUMERIC, 0) AS snap_minutes,
                   COALESCE((i.attendance_summary ->> 'adjustments_dirty')::BOOLEAN, FALSE) AS adjustments_dirty,
                   COALESCE((i.attendance_summary ->> 'attendance_dirty')::BOOLEAN, FALSE) AS attendance_dirty,
                   COALESCE(i.manual_bonus, 0) AS manual_bonus,
                   COALESCE(i.debt_deduction, 0) AS debt_deduction,
                   COALESCE(i.manual_deduction, 0) AS manual_deduction,
                   COALESCE(i.adjustments_total, 0) AS adjustments_total
            FROM public.payroll_regular_items i
            WHERE i.payroll_run_id = p_run_id
        LOOP
            -- payroll-relevant attendance changed after this item was calculated (marker set in the same
            -- transaction as the attendance write by trg_attendance_payroll_sync)
            IF v_snap_item.attendance_dirty THEN
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

            -- adjustment aggregate with the engine's semantics:
            --   BONUS -> +|amt|; DEBT -> debt +|amt|; DEDUCTION -> deduction +|amt|;
            --   CORRECTION / OTHER / anything else -> amt >= 0 bonus, amt < 0 deduction
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

        -- 2g-2. All review-required items must be resolved before locking (P1-1)
        SELECT COUNT(*) INTO v_review_count
        FROM public.payroll_regular_items
        WHERE payroll_run_id = p_run_id
          AND status = 'REVIEW_REQUIRED';

        IF v_review_count > 0 THEN
            RAISE EXCEPTION 'Cannot lock regular payroll run %: % review-required item(s) remain. Resolve all review warnings before locking.',
                p_run_id, v_review_count;
        END IF;


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

-- Execute rights: service_role only (no widening)
REVOKE ALL ON FUNCTION public.lock_payroll_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(UUID, TEXT) TO service_role;

-- Record migration in schema_migrations
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260921110000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
