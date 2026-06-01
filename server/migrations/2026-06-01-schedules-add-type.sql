-- ============================================================
-- MIGRATION: Add type column to schedules table
-- Run di Supabase Dashboard > SQL Editor
-- Root cause: bridgeBookingToMoka inserts type='home_service'/'outlet'
--             since commit be7d055 (2026-05-30) tapi kolom belum ada → INSERT gagal
-- ============================================================

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'outlet'
  CHECK (type IN ('outlet', 'home_service'));

-- Backfill: tandai schedules yang berasal dari home_service_jobs
UPDATE schedules s
SET    type = 'home_service'
FROM   home_service_jobs hsj
WHERE  hsj.schedule_id = s.id
  AND  s.type = 'outlet';

-- Index untuk filter by type
CREATE INDEX IF NOT EXISTS idx_schedules_type
  ON schedules (type)
  WHERE type = 'home_service';
