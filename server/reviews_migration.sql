-- ================================================
-- REDBOX — Review System Migration
-- Run this in Supabase SQL Editor
-- ================================================

-- 1. Add review_sent_at column to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_sent_at TIMESTAMPTZ;

-- Index: only unset rows (for cron query efficiency)
CREATE INDEX IF NOT EXISTS idx_bookings_review_pending
  ON bookings (date, time)
  WHERE review_sent_at IS NULL AND status NOT IN ('cancelled','pending');

-- 2. Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_name TEXT,
  kapster_id    TEXT REFERENCES barbers(id) ON DELETE SET NULL,
  kapster_name  TEXT,
  branch        TEXT,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  is_public     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_kapster   ON reviews (kapster_id);
CREATE INDEX IF NOT EXISTS idx_reviews_branch    ON reviews (branch);
CREATE INDEX IF NOT EXISTS idx_reviews_public    ON reviews (is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_booking   ON reviews (booking_id);

-- 3. Prevent duplicate review per booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_booking
  ON reviews (booking_id)
  WHERE booking_id IS NOT NULL;
