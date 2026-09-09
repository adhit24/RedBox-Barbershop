-- Migration: Lock down employees table security
-- Ensures anon and normal authenticated users have NO access to employees table
-- Exclusively allows service_role operations

-- 1. Revoke all table-level grants from public roles
REVOKE ALL ON TABLE public.employees FROM anon;
REVOKE ALL ON TABLE public.employees FROM authenticated;
REVOKE ALL ON TABLE public.employees FROM public;

-- 2. Grant full access exclusively to service_role and postgres
GRANT ALL ON TABLE public.employees TO postgres;
GRANT ALL ON TABLE public.employees TO service_role;

-- 3. Drop existing permissive policies
DROP POLICY IF EXISTS "Allow public read access on employees" ON public.employees;
DROP POLICY IF EXISTS "Allow service role full access on employees" ON public.employees;
DROP POLICY IF EXISTS "service_role_all_employees" ON public.employees;

-- 4. Enable and force Row Level Security
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;

-- 5. Create strict policy for service_role only
CREATE POLICY "service_role_all_employees"
  ON public.employees
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
