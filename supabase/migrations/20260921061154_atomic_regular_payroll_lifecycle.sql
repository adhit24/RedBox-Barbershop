-- Forward-only migration: atomic Regular Payroll lifecycle.
--
-- 1. RUN UNIQUENESS. Two DRAFT (or DRAFT + LOCKED) regular runs for overlapping periods and overlapping
--    business-unit scope could both be locked and paid. A BEFORE INSERT/UPDATE trigger on payroll_runs
--    takes a transaction-level advisory lock (serializing every concurrent generation) and rejects a run
--    that overlaps another DRAFT/LOCKED regular run: same period overlap AND (same business unit OR either
--    side is 'ALL'). It is authoritative for every writer; the application pre-check is only for a friendly
--    message.
-- 2. ATOMIC CREATION. create_regular_payroll_run(header, items) inserts the header AND all items in ONE
--    transaction (the function body); the run becomes visible only at commit, and any failure rolls the
--    header back. There is no window with a visible empty DRAFT.
-- 3. ADJUSTMENTS.
--    * trigger: an adjustment's item must belong to the same run (and employee) and the run must be REGULAR
--      (ownership enforced by the database, not by the client-supplied ids);
--    * trigger: every adjustment insert/update/delete marks the item snapshot dirty in the SAME transaction
--      (attendance_summary.adjustments_dirty = true); recalculation replaces the summary and clears it;
--    * lock backstop: lock_payroll_run() compares the authoritative adjustment aggregate with the item
--      snapshot (manual_bonus / debt_deduction / manual_deduction / adjustments_total, engine semantics)
--      and refuses a dirty item. The salary formula is NOT duplicated in SQL.
-- 4. LOCK BACKSTOPS. lock_payroll_run() refuses a REGULAR run with ZERO items and re-checks overlap.
--
-- Everything else in lock_payroll_run() is unchanged from 20260921012501 (DRAFT-only + FOR UPDATE on the
-- run, SECURITY INVOKER, all overtime invariants, barber branch verbatim, service_role-only execution).
-- Applied migrations are not edited.
--
-- Lock ordering: advisory overlap lock (creation only) -> nothing else; run rows first, data rows second
-- (see 20260921033925). Creation never waits on a run row lock, so it cannot form a cycle with the lock RPC.

BEGIN;

-- 1. Overlap detection -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_overlapping_regular_run(
    p_exclude_id UUID,
    p_business_unit TEXT,
    p_start DATE,
    p_end DATE
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT r.id
    FROM public.payroll_runs r
    WHERE r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
      AND r.status IN ('DRAFT', 'LOCKED')
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND r.period_start <= p_end
      AND r.period_end >= p_start
      AND (r.business_unit = p_business_unit OR r.business_unit = 'ALL' OR p_business_unit = 'ALL')
    ORDER BY r.id
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.trg_payroll_runs_no_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_other UUID;
BEGIN
    IF NEW.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL') AND NEW.status IN ('DRAFT', 'LOCKED') THEN
        -- Serialize concurrent generations; the check below then sees every committed run.
        PERFORM pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'));
        v_other := public.find_overlapping_regular_run(NEW.id, NEW.business_unit, NEW.period_start, NEW.period_end);
        IF v_other IS NOT NULL THEN
            RAISE EXCEPTION 'Overlapping regular payroll run exists: % (a DRAFT or LOCKED run already covers this period and business unit)', v_other;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_runs_no_overlap ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_no_overlap
BEFORE INSERT OR UPDATE OF period_start, period_end, business_unit, payroll_type ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.trg_payroll_runs_no_overlap();

-- 2. Atomic creation -------------------------------------------------------------------------------
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
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Cannot create a regular payroll run without payroll items';
    END IF;
    v_expected := jsonb_array_length(p_items);

    -- The overlap trigger fires here (advisory lock + check) and rolls everything back on conflict.
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
        attendance_summary, warnings, status
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
        r.attendance_summary, r.warnings, r.status
    FROM jsonb_populate_recordset(NULL::public.payroll_regular_items, p_items) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> v_expected THEN
        RAISE EXCEPTION 'Regular payroll run creation aborted: inserted % of % items', v_inserted, v_expected;
    END IF;

    RETURN jsonb_build_object('run_id', v_run_id, 'items_count', v_inserted, 'status', 'DRAFT');
END;
$$;

-- 3. Adjustments: database-enforced ownership + snapshot-dirty marker ------------------------------
CREATE OR REPLACE FUNCTION public.trg_payroll_adjustment_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item_run UUID;
    v_item_employee UUID;
    v_run_type TEXT;
BEGIN
    IF NEW.payroll_regular_item_id IS NULL THEN
        RETURN NEW; -- barber adjustments use other columns
    END IF;

    SELECT i.payroll_run_id, i.employee_id INTO v_item_run, v_item_employee
    FROM public.payroll_regular_items i
    WHERE i.id = NEW.payroll_regular_item_id;

    IF NOT FOUND OR v_item_run <> NEW.payroll_run_id THEN
        RAISE EXCEPTION 'Payroll adjustment item % does not belong to payroll run %', NEW.payroll_regular_item_id, NEW.payroll_run_id;
    END IF;

    IF NEW.employee_id IS NOT NULL AND NEW.employee_id <> v_item_employee THEN
        RAISE EXCEPTION 'Payroll adjustment employee does not match the payroll item';
    END IF;

    SELECT r.payroll_type INTO v_run_type FROM public.payroll_runs r WHERE r.id = NEW.payroll_run_id;
    IF v_run_type NOT IN ('REGULAR', 'REGULAR_PAYROLL') THEN
        RAISE EXCEPTION 'Payroll adjustment for a regular item requires a REGULAR payroll run';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_adjustment_ownership ON public.payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustment_ownership
BEFORE INSERT OR UPDATE OF payroll_run_id, payroll_regular_item_id, employee_id ON public.payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION public.trg_payroll_adjustment_ownership();

CREATE OR REPLACE FUNCTION public.trg_payroll_adjustment_mark_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Same transaction as the adjustment write: the item snapshot is explicitly stale until recalculated
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.payroll_regular_item_id IS NOT NULL THEN
        UPDATE public.payroll_regular_items
        SET attendance_summary = jsonb_set(COALESCE(attendance_summary, '{}'::JSONB), '{adjustments_dirty}', 'true'::JSONB, TRUE),
            updated_at = now()
        WHERE id = OLD.payroll_regular_item_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.payroll_regular_item_id IS NOT NULL THEN
        UPDATE public.payroll_regular_items
        SET attendance_summary = jsonb_set(COALESCE(attendance_summary, '{}'::JSONB), '{adjustments_dirty}', 'true'::JSONB, TRUE),
            updated_at = now()
        WHERE id = NEW.payroll_regular_item_id;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_adjustment_mark_dirty ON public.payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustment_mark_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION public.trg_payroll_adjustment_mark_dirty();

-- 4. lock_payroll_run(): + zero-item guard, overlap re-check, adjustment snapshot invariant ---------
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
                   COALESCE(i.manual_bonus, 0) AS manual_bonus,
                   COALESCE(i.debt_deduction, 0) AS debt_deduction,
                   COALESCE(i.manual_deduction, 0) AS manual_deduction,
                   COALESCE(i.adjustments_total, 0) AS adjustments_total
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

REVOKE ALL ON FUNCTION public.create_regular_payroll_run(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_regular_payroll_run(JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.find_overlapping_regular_run(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_overlapping_regular_run(UUID, TEXT, DATE, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.trg_payroll_runs_no_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_payroll_adjustment_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_payroll_adjustment_mark_dirty() FROM PUBLIC, anon, authenticated;

COMMIT;
