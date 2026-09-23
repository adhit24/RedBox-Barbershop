-- Forward-only migration: one database serialization protocol for Regular Payroll.
--
-- PROBLEM (TOCTOU). lock_payroll_run() locks the payroll_runs row and then validates approvals,
-- attendance and item snapshots with ordinary reads. A concurrent writer (overtime approval,
-- attendance overtime change, item recalculation) that commits after those reads but before the run
-- is marked LOCKED would let the RPC freeze a stale snapshot. Extra application-side reads cannot fix
-- that: PostgREST calls are independent transactions.
--
-- PROTOCOL. The payroll_runs row IS the synchronization object.
--   * lock_payroll_run()                         takes  FOR UPDATE  (exclusive)        [unchanged]
--   * every mutation that can affect a DRAFT REGULAR run takes  FOR SHARE  on the covering run rows
--     BEFORE it writes, inside the writing transaction, via BEFORE ROW triggers:
--         employee_overtime_approvals   INSERT / UPDATE / DELETE   (approve, reject, reconcile)
--         employee_attendance           overtime_minutes changes   (attendance import / correction)
--         payroll_regular_items         INSERT / UPDATE / DELETE   (recalculation)     [check_payroll_run_not_locked]
--         payroll_adjustments           INSERT / UPDATE / DELETE   (manual adjustments) [check_payroll_run_not_locked]
--   FOR SHARE conflicts with FOR UPDATE, so exactly one of these happens:
--     writer first  -> the RPC waits, then validates AFTER the writer committed (READ COMMITTED gives every
--                      later statement a fresh snapshot) and rejects a stale snapshot/mismatch.
--     RPC first     -> the writer waits, then sees status = LOCKED: approval writes are REJECTED, item /
--                      adjustment writes are rejected by the existing immutability check, attendance
--                      writes proceed (source history is not frozen) but can no longer alter the frozen run.
--   Writers do not block each other (SHARE is compatible with SHARE).
--
-- LOCK ORDERING / DEADLOCK FREEDOM.
--   1. run rows first (always ORDER BY id), data rows second. The lock RPC takes only ONE run row and no
--      other lock before it, and never waits for anything afterwards except row locks on its own items,
--      which no writer holds while waiting for a run lock (the run lock is taken in the BEFORE trigger,
--      before the tuple lock of the row being changed).
--   2. A writer holding SHARE on R1 and waiting for SHARE on R2 (held exclusively by an RPC on R2) cannot
--      form a cycle: the RPC on R2 does not need R1.
--
-- ALSO: non-negative overtime minutes as a database constraint (raw and approved).
-- Applied migrations are not edited; this file only adds objects and re-defines one trigger function.

BEGIN;

-- 1. Non-negative overtime minutes (table is empty in production; validated immediately)
ALTER TABLE public.employee_overtime_approvals
    ADD CONSTRAINT employee_overtime_approved_minutes_nonneg CHECK (approved_overtime_minutes >= 0),
    ADD CONSTRAINT employee_overtime_raw_minutes_nonneg CHECK (raw_overtime_minutes >= 0);

-- 2. Shared helper: take SHARE locks on the covering DRAFT runs (id order), then report whether a
--    LOCKED regular run that contains the employee covers the date.
CREATE OR REPLACE FUNCTION public.serialize_regular_payroll_mutation(p_employee_id UUID, p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_locked BOOLEAN;
BEGIN
    IF p_employee_id IS NULL OR p_date IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Deterministic order (id) prevents lock-order cycles between concurrent writers.
    PERFORM r.id
    FROM public.payroll_runs r
    WHERE r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
      AND r.status = 'DRAFT'
      AND p_date BETWEEN r.period_start AND r.period_end
    ORDER BY r.id
    FOR SHARE;

    -- A run that was being locked while we waited is no longer DRAFT here (row re-checked after the wait),
    -- and this separate statement takes a fresh snapshot, so it sees the committed LOCKED status.
    SELECT EXISTS (
        SELECT 1
        FROM public.payroll_runs r
        WHERE r.payroll_type IN ('REGULAR', 'REGULAR_PAYROLL')
          AND r.status = 'LOCKED'
          AND p_date BETWEEN r.period_start AND r.period_end
          AND EXISTS (
              SELECT 1
              FROM public.payroll_regular_items i
              WHERE i.payroll_run_id = r.id
                AND i.employee_id = p_employee_id
          )
    ) INTO v_locked;

    RETURN v_locked;
END;
$$;

REVOKE ALL ON FUNCTION public.serialize_regular_payroll_mutation(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serialize_regular_payroll_mutation(UUID, DATE) TO service_role;

-- 3. Overtime approvals: participate in the protocol; refuse to change approvals of a LOCKED run
CREATE OR REPLACE FUNCTION public.trg_overtime_approval_serialize()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF public.serialize_regular_payroll_mutation(OLD.employee_id, OLD.attendance_date) THEN
            RAISE EXCEPTION 'Cannot modify overtime approval: employee % on % belongs to a LOCKED regular payroll run',
                OLD.employee_id, OLD.attendance_date;
        END IF;
    END IF;

    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id
                                 OR NEW.attendance_date IS DISTINCT FROM OLD.attendance_date)) THEN
        IF public.serialize_regular_payroll_mutation(NEW.employee_id, NEW.attendance_date) THEN
            RAISE EXCEPTION 'Cannot modify overtime approval: employee % on % belongs to a LOCKED regular payroll run',
                NEW.employee_id, NEW.attendance_date;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_overtime_approval_serialize() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_overtime_approval_serialize ON public.employee_overtime_approvals;
CREATE TRIGGER trg_overtime_approval_serialize
BEFORE INSERT OR UPDATE OR DELETE ON public.employee_overtime_approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_overtime_approval_serialize();

-- 4. Attendance overtime source: participate (SHARE lock only when the overtime value actually changes,
--    so the importer's unchanged zero-overtime upserts pay nothing). Writes are not rejected after the
--    lock: attendance history is not frozen, but it cannot change a payroll run mid-lock.
CREATE OR REPLACE FUNCTION public.trg_attendance_overtime_serialize()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.serialize_regular_payroll_mutation(OLD.employee_id, OLD.attendance_date);
        RETURN OLD;
    END IF;
    PERFORM public.serialize_regular_payroll_mutation(NEW.employee_id, NEW.attendance_date);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_attendance_overtime_serialize() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_attendance_overtime_serialize_ins ON public.employee_attendance;
CREATE TRIGGER trg_attendance_overtime_serialize_ins
BEFORE INSERT ON public.employee_attendance
FOR EACH ROW WHEN (NEW.overtime_minutes > 0)
EXECUTE FUNCTION public.trg_attendance_overtime_serialize();

DROP TRIGGER IF EXISTS trg_attendance_overtime_serialize_upd ON public.employee_attendance;
CREATE TRIGGER trg_attendance_overtime_serialize_upd
BEFORE UPDATE OF overtime_minutes ON public.employee_attendance
FOR EACH ROW WHEN (OLD.overtime_minutes IS DISTINCT FROM NEW.overtime_minutes)
EXECUTE FUNCTION public.trg_attendance_overtime_serialize();

DROP TRIGGER IF EXISTS trg_attendance_overtime_serialize_del ON public.employee_attendance;
CREATE TRIGGER trg_attendance_overtime_serialize_del
BEFORE DELETE ON public.employee_attendance
FOR EACH ROW WHEN (OLD.overtime_minutes > 0)
EXECUTE FUNCTION public.trg_attendance_overtime_serialize();

-- 5. Payroll items and adjustments: the existing immutability check now also takes the SHARE lock, so a
--    recalculation / adjustment write serializes with lock_payroll_run() instead of only reading the status.
--    (Same function, same message; only FOR SHARE is added. The lock RPC's own item update runs inside its
--    FOR UPDATE transaction, so it is unaffected.)
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_run_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_run_id := OLD.payroll_run_id;
    ELSE
        v_run_id := NEW.payroll_run_id;
    END IF;

    SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id FOR SHARE;
    IF v_status = 'LOCKED' THEN
        RAISE EXCEPTION 'Cannot modify payroll data: payroll run % is LOCKED', v_run_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

COMMIT;
