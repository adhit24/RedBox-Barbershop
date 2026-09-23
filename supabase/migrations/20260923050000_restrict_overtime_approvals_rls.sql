-- Migration: 20260923050000_restrict_overtime_approvals_rls.sql
-- Description:
-- Codex Round-18 P1 (PRRT_kwDOSNmW7c6lCAtZ): employee_overtime_approvals carried a permissive
-- `authenticated` SELECT policy (USING (true)) created by
-- 20260919143000_create_overtime_approvals_and_guards.sql. That let any Supabase-authenticated
-- account -- including ordinary customer or barber accounts, not just Owner/Manager staff -- read
-- every overtime approval row directly through the public API: employee_id, attendance_date,
-- raw/approved overtime minutes, approval status, approver identity, notes, and timestamps. This
-- bypassed the owner/manager and branch authorization already enforced in
-- server/routes/regularPayroll.js (adminAuth + overtimeScope). No authenticated INSERT/UPDATE/DELETE
-- policy existed, so the write path was already denied by RLS default-deny; this migration closes the
-- read path the same way and makes the posture explicit at the GRANT level too.
--
-- The regular payroll backend (server/index.js) always talks to Supabase with SUPABASE_SERVICE_KEY
-- (service_role), never the anon/authenticated roles -- confirmed for every route in
-- server/routes/regularPayroll.js and every helper in server/services/regularPayrollService.js.
-- Removing authenticated's direct table access therefore does not affect any existing backend flow.
--
-- This migration is access-only: it does not touch 20260919143000_create_overtime_approvals_and_guards.sql
-- or any other already-applied migration, does not alter payroll business data, and does not lock any
-- payroll run.

BEGIN;

-- 1. RLS stays enabled on this table (unchanged; asserted here so the posture is explicit and
-- self-documenting rather than implicit).
ALTER TABLE public.employee_overtime_approvals ENABLE ROW LEVEL SECURITY;

-- 2. Remove the unsafe permissive policy by its exact name. The service_role policy
-- ("Allow service_role full access on employee_overtime_approvals") is untouched: the backend keeps
-- working exactly as before.
DROP POLICY IF EXISTS "Allow authenticated read on employee_overtime_approvals" ON public.employee_overtime_approvals;

-- 3. Table-level GRANTs are a separate gate from RLS policies -- Supabase's default project bootstrap
-- grants full table privileges to anon/authenticated/service_role regardless of RLS state. Revoke the
-- ones a customer/barber account (or an unauthenticated caller) must never have, explicitly, rather
-- than relying on RLS default-deny alone as the only line of defense.
REVOKE ALL ON TABLE public.employee_overtime_approvals FROM PUBLIC;
REVOKE ALL ON TABLE public.employee_overtime_approvals FROM anon;
REVOKE ALL ON TABLE public.employee_overtime_approvals FROM authenticated;

-- 4. Keep the payroll backend working: service_role already has full access via its RLS policy: make
-- the underlying table-level grant explicit too, for the same defense-in-depth reason as step 3.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_overtime_approvals TO service_role;

-- No sequence is associated with employee_overtime_approvals (its primary key is
-- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, not a serial/identity column), so no sequence
-- privileges are affected by this change.

COMMIT;
