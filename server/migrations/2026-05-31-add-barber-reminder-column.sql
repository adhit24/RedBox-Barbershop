-- Add barber_reminded_at column to track when we sent the H-1 reminder
ALTER TABLE home_service_jobs
ADD COLUMN IF NOT EXISTS barber_reminded_at TIMESTAMPTZ;
