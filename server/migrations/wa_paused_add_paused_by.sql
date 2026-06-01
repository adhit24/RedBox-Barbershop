-- Migration: Create wa_paused table for AI bot override (human takeover)
-- Shared across ALL branches via Supabase.
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS wa_paused (
  sender text PRIMARY KEY,
  paused_until timestamptz NOT NULL,
  paused_at timestamptz DEFAULT now(),
  paused_by text DEFAULT 'unknown'
);

-- Index for faster lookups on active pauses
CREATE INDEX IF NOT EXISTS idx_wa_paused_until ON wa_paused (paused_until);
