-- Enable RLS on the public home_service_jobs table.
-- Existing server-side flows use the service role key, which bypasses RLS.
-- We intentionally do not add anon/authenticated policies here because
-- no public client access path for this table exists in the codebase.

ALTER TABLE public.home_service_jobs ENABLE ROW LEVEL SECURITY;
