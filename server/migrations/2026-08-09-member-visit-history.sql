-- Real per-transaction member visit history, populated from Moka data
-- POST /api/member/sync already pulls and previously discarded after
-- aggregating into total_visits/total_points.

CREATE TABLE IF NOT EXISTS public.member_visit_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key        TEXT NOT NULL,
  receipt_number  TEXT NOT NULL UNIQUE,
  outlet_slug     TEXT,
  visit_date      DATE NOT NULL,
  visit_time      TEXT,
  service_summary TEXT,
  amount          INTEGER NOT NULL DEFAULT 0,
  points_earned   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_visit_history_user_key_visit_date_idx
  ON public.member_visit_history (user_key, visit_date DESC);

-- This workflow is server-to-server only: every caller reaches this table
-- through the Express backend client configured with SUPABASE_SERVICE_KEY
-- (the database service_role), never from a browser key. Same pattern as
-- server/migrations/2026-08-08-paid-membership-registration.sql.
ALTER TABLE public.member_visit_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.member_visit_history FROM service_role;
GRANT SELECT, INSERT ON TABLE public.member_visit_history TO service_role;
