-- ================================================================
-- Migration: catat paket yang dibeli saat aktivasi membership
-- Run di Supabase SQL Editor. Aman di-run berulang kali.
-- ================================================================

ALTER TABLE member_activations
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IS NULL OR tier IN ('silver', 'gold', 'platinum'));

