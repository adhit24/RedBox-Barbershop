-- server/migrations/2026-05-30-home-service-jobs.sql

-- Prerequisite: update_updated_at trigger function (create if not exists)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- 1. New table: home_service_jobs
CREATE TABLE IF NOT EXISTS home_service_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           UUID REFERENCES schedules(id) ON DELETE CASCADE,
  status                TEXT DEFAULT 'confirmed',
  -- confirmed | on_the_way | done_barber | completed | flagged
  address               TEXT NOT NULL,
  reschedule_count      INT DEFAULT 0,
  barber_enroute_at     TIMESTAMPTZ,
  barber_done_at        TIMESTAMPTZ,
  customer_confirmed_at TIMESTAMPTZ,
  flagged_at            TIMESTAMPTZ,
  flag_reason           TEXT,
  -- 'barber_no_show' | 'customer_no_confirm'
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_service_jobs_schedule_id
  ON home_service_jobs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_home_service_jobs_status
  ON home_service_jobs(status);

CREATE TRIGGER home_service_jobs_updated_at
  BEFORE UPDATE ON home_service_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Extend schedules table
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'outlet';
-- 'outlet' | 'home_service'

-- 3. Extend barbers table
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS home_service_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS phone TEXT;
-- Barber's personal WhatsApp number for lifecycle notifications

-- 4. GRANTs (required by Supabase PostgREST)
GRANT SELECT, INSERT, UPDATE ON home_service_jobs TO anon, authenticated;
