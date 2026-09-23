-- ====================================================================================================
-- Migration: 20260923150000_finalize_regular_payroll_run_summary.sql
-- Description:
--   Codex Round-18 findings on PR #98 (against head c1d41742787b68c1687b786a764c17f315140e6f):
--
--   1. PRRT_kwDOSNmW7c6lG3sS (P1): recalculateRegularPayrollRun computes runCoverage once, recalculates
--      items against it, then publishes the run summary with that SAME runCoverage. If the attendance row
--      defining the latest date is deleted (or corrected, or a newest row is inserted, or the eligible
--      population changes) after that coverage read but before the summary is published, per-item CAS
--      only proves each recalculated item's OWN attendance_source_revision matches what it read -- it
--      never proves the RUN-WIDE coverage basis used for the calculation is still current. The summary
--      can be published as complete/clean from a coverage cutoff that has already gone stale, and
--      lock_payroll_run (which trusts payroll_runs.summary->>'attendance_period_complete' rather than
--      recomputing it) can then freeze the run.
--
--   2. PRRT_kwDOSNmW7c6lG3sZ (P1): the run summary refresh (refreshRunSummary) reads every item, computes
--      totals in Node, then writes them with a bare UPDATE -- no lock. When employees are recalculated by
--      concurrent requests (each touching different items, so the per-item CAS never conflicts), one
--      request can read an OLDER item snapshot than another, and whichever writes LAST wins regardless of
--      which snapshot was actually more current -- an already-correct summary can be silently overwritten
--      by a stale one. lock_payroll_run validates individual item reconciliation but never recomputes the
--      header totals, so an incorrect total can be frozen into a locked run.
--
-- Fix: public.finalize_regular_payroll_run_summary(...) -- a single atomic, serialized DB operation that
-- becomes the ONLY writer of payroll_runs.summary for Regular Payroll runs.
--
--   - Lock ordering matches every existing Regular Payroll RPC exactly (create_regular_payroll_run /
--     add_regular_payroll_run_items / lock_payroll_run), so none of them can deadlock against this one:
--       1. pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'))  (same global key)
--       2. SELECT ... FROM payroll_runs WHERE id = p_run_id FOR UPDATE               (same row target)
--       3. SELECT 1 FROM payroll_workforce_version WHERE id = 1 FOR UPDATE           (only when
--          p_employee_ids is supplied -- see below)
--   - Aggregates (total_gross_pay, total_deductions, total_take_home_pay, counts) are computed by ONE
--     SQL query over the CURRENT payroll_regular_items rows, read fresh under the run-row lock. Whichever
--     concurrent caller reaches this function SECOND always sees every item update the first one already
--     committed, so the header can never regress to an older snapshot (closes finding #2, for every
--     caller of refreshRunSummary -- not only the full-run recalculation path).
--   - When p_employee_ids IS NOT NULL (only recalculateRegularPayrollRun's final call passes it), the
--     function additionally revalidates the run-wide coverage basis: it recomputes, under the SAME lock,
--       * attendance_data_through  = MAX(employee_attendance.attendance_date) over EXACTLY the same
--         employee_id set the caller used (p_employee_ids), within the run period -- the identical
--         population-scoped MAX query computeRunAttendanceCoverage runs in Node, just re-run fresh here;
--       * the CURRENT eligible-employee count (same is_active / employment_type / join_date / business_unit
--         criteria already used identically by add_regular_payroll_run_items and lock_payroll_run);
--       * the CURRENT payroll_workforce_version.revision (held FOR UPDATE for the duration, so no
--         concurrent employees eligibility change can commit mid-check -- same guarantee
--         lock_payroll_run/add_regular_payroll_run_items already rely on).
--     and compares all three against what the caller expected (p_expected_attendance_data_through,
--     p_expected_attendance_period_complete, p_expected_workforce_version, p_expected_eligible_count).
--     Any mismatch means the basis used for the just-completed item recalculation is no longer current:
--     the function returns {success:false, status:'STALE_COVERAGE', ...} WITHOUT writing anything, so the
--     summary is never published as complete against a stale cutoff (closes finding #1). The caller
--     (recalculateRegularPayrollRun) retries the whole recalculation from population reconciliation with
--     a small bounded retry count, and fails closed with PAYROLL_RECALC_CONCURRENT_MUTATION if attendance
--     keeps changing faster than it can converge -- it never marks the run clean/complete on a guess.
--
-- No sequence/business DDL beyond this function. No existing applied migration is edited. This is a new,
-- forward-only migration.
--
-- Invariants preserved:
--   - DRAFT-only: the function returns {success:false, status:'RUN_NOT_DRAFT'} without writing if the run
--     is not DRAFT (e.g. locked concurrently mid-recalculation) -- the caller raises, never retries a lock.
--   - lock_payroll_run, create_regular_payroll_run, add_regular_payroll_run_items are UNCHANGED.
--   - Barber payroll is entirely untouched (this function only ever reads/writes Regular Payroll rows).
--   - LOCKED payroll runs/items are never mutated.
--   - SECURITY INVOKER, service_role-only EXECUTE (no privilege widening).
-- ====================================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_regular_payroll_run_summary(
    p_run_id UUID,
    p_employee_ids UUID[] DEFAULT NULL,
    p_expected_attendance_data_through DATE DEFAULT NULL,
    p_expected_attendance_period_complete BOOLEAN DEFAULT NULL,
    p_expected_workforce_version BIGINT DEFAULT NULL,
    p_expected_eligible_count INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_run public.payroll_runs%ROWTYPE;
    v_workforce_version BIGINT;
    v_data_through DATE;
    v_period_complete BOOLEAN;
    v_eligible_count INTEGER;
    v_total_employees INTEGER := 0;
    v_total_gross NUMERIC := 0;
    v_total_deduction NUMERIC := 0;
    v_total_take_home NUMERIC := 0;
    v_review_count INTEGER := 0;
    v_missing_salary_count INTEGER := 0;
    v_missing_attendance_count INTEGER := 0;
    v_summary JSONB;
BEGIN
    -- Same deterministic lock order as create_regular_payroll_run / add_regular_payroll_run_items /
    -- lock_payroll_run: global advisory lock first, then the run row.
    PERFORM pg_advisory_xact_lock(hashtext('redbox.regular_payroll_run_overlap'));

    SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;

    IF v_run.status <> 'DRAFT' THEN
        -- Concurrently locked (or otherwise no longer DRAFT): never publish, never pretend success.
        RETURN jsonb_build_object('success', false, 'status', 'RUN_NOT_DRAFT', 'run_id', p_run_id);
    END IF;

    IF p_employee_ids IS NOT NULL THEN
        -- Workforce serialization, same guarantee as lock_payroll_run / add_regular_payroll_run_items:
        -- held for the rest of this transaction so no concurrent employees eligibility change can commit
        -- while we compute the authoritative basis below.
        PERFORM 1 FROM public.payroll_workforce_version WHERE id = 1 FOR UPDATE;
        SELECT revision INTO v_workforce_version FROM public.payroll_workforce_version WHERE id = 1;

        SELECT COUNT(*) INTO v_eligible_count
        FROM public.employees e
        WHERE e.is_active = true
          AND (e.employment_type = 'regular' OR e.employment_type IS NULL)
          AND (e.join_date IS NULL OR e.join_date <= v_run.period_end)
          AND (v_run.business_unit = 'ALL' OR e.business_unit = v_run.business_unit);

        -- Same population-scoped MAX query as Node's computeRunAttendanceCoverage, re-run fresh, over
        -- EXACTLY the employee_id set the caller used for its item recalculation.
        SELECT MAX(att.attendance_date) INTO v_data_through
        FROM public.employee_attendance att
        WHERE att.employee_id = ANY (p_employee_ids)
          AND att.attendance_date BETWEEN v_run.period_start AND v_run.period_end;

        v_period_complete := (v_data_through IS NOT NULL AND v_data_through >= v_run.period_end);

        IF p_expected_workforce_version IS DISTINCT FROM v_workforce_version
           OR p_expected_eligible_count IS DISTINCT FROM v_eligible_count
           OR p_expected_attendance_data_through IS DISTINCT FROM v_data_through
           OR p_expected_attendance_period_complete IS DISTINCT FROM v_period_complete
        THEN
            RETURN jsonb_build_object(
                'success', false,
                'status', 'STALE_COVERAGE',
                'run_id', p_run_id,
                'expected', jsonb_build_object(
                    'workforce_version', p_expected_workforce_version,
                    'eligible_count', p_expected_eligible_count,
                    'attendance_data_through', p_expected_attendance_data_through,
                    'attendance_period_complete', p_expected_attendance_period_complete
                ),
                'actual', jsonb_build_object(
                    'workforce_version', v_workforce_version,
                    'eligible_count', v_eligible_count,
                    'attendance_data_through', v_data_through,
                    'attendance_period_complete', v_period_complete
                )
            );
        END IF;
    END IF;

    -- Aggregate totals from the CURRENT authoritative item rows, read fresh under the run-row lock
    -- (Codex Round-18 P1, PRRT_kwDOSNmW7c6lG3sZ): whichever concurrent caller serializes second here
    -- always recomputes from every committed item update, so the header can never regress.
    SELECT
        COUNT(*),
        COALESCE(SUM(gross_pay), 0),
        COALESCE(SUM(total_deduction), 0),
        COALESCE(SUM(take_home_pay), 0),
        COUNT(*) FILTER (WHERE status = 'REVIEW_REQUIRED'),
        COUNT(*) FILTER (WHERE status = 'MISSING_SALARY'),
        COUNT(*) FILTER (WHERE status IN ('MISSING_ATTENDANCE', 'BLOCKED_ATTENDANCE_SOURCE'))
    INTO v_total_employees, v_total_gross, v_total_deduction, v_total_take_home,
         v_review_count, v_missing_salary_count, v_missing_attendance_count
    FROM public.payroll_regular_items
    WHERE payroll_run_id = p_run_id;

    v_summary := COALESCE(v_run.summary, '{}'::jsonb) || jsonb_build_object(
        'total_employees', v_total_employees,
        'total_gross_pay', v_total_gross,
        'total_deductions', v_total_deduction,
        'total_take_home_pay', v_total_take_home,
        'review_required_count', v_review_count,
        'missing_salary_count', v_missing_salary_count,
        'missing_attendance_count', v_missing_attendance_count
    );

    IF p_employee_ids IS NOT NULL THEN
        v_summary := v_summary || jsonb_build_object(
            'attendance_data_through', v_data_through,
            'expected_period_end', v_run.period_end,
            'attendance_period_complete', v_period_complete
        );
    END IF;

    UPDATE public.payroll_runs
    SET summary = v_summary, updated_at = now()
    WHERE id = p_run_id;

    RETURN jsonb_build_object('success', true, 'status', 'PUBLISHED', 'run_id', p_run_id, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_regular_payroll_run_summary(UUID, UUID[], DATE, BOOLEAN, BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_regular_payroll_run_summary(UUID, UUID[], DATE, BOOLEAN, BIGINT, INTEGER) TO service_role;

COMMIT;
