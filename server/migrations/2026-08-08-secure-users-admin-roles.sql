BEGIN;

-- Role and branch are authorization data. Browser clients may read their own
-- profile, but may never create or modify these fields directly.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.users FROM authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;

DROP POLICY IF EXISTS users_read_own_profile ON public.users;
CREATE POLICY users_read_own_profile
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

COMMIT;
