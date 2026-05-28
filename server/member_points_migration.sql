-- ================================================
-- REDBOX — Member Points System Migration
-- Run this in Supabase SQL Editor
-- ================================================

-- 1. Create member_points table
CREATE TABLE IF NOT EXISTS member_points (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  customer_wa   TEXT,  -- normalized WA for quick lookup
  points        INTEGER NOT NULL DEFAULT 0,
  type          TEXT NOT NULL DEFAULT 'earned'
                CHECK (type IN ('earned', 'redeemed', 'bonus', 'expired')),
  source        TEXT NOT NULL,  -- 'review', 'booking', 'referral', 'manual'
  source_id     TEXT,  -- booking_id, review_id, etc.
  description   TEXT,
  value_idr     INTEGER,  -- Rupiah equivalent value
  expires_at    TIMESTAMPTZ,  -- optional expiration
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_member_points_customer_id ON member_points (customer_id);
CREATE INDEX IF NOT EXISTS idx_member_points_customer_wa ON member_points (customer_wa);
CREATE INDEX IF NOT EXISTS idx_member_points_source ON member_points (source, source_id);
CREATE INDEX IF NOT EXISTS idx_member_points_type ON member_points (type);
CREATE INDEX IF NOT EXISTS idx_member_points_created ON member_points (created_at DESC);

-- 2. View: member_points_balance (total points per customer)
CREATE OR REPLACE VIEW member_points_balance AS
SELECT 
  customer_id,
  customer_wa,
  COALESCE(SUM(CASE WHEN type IN ('earned', 'bonus') THEN points ELSE 0 END), 0) -
  COALESCE(SUM(CASE WHEN type = 'redeemed' THEN points ELSE 0 END), 0) AS total_points,
  COALESCE(SUM(CASE WHEN type IN ('earned', 'bonus') THEN value_idr ELSE 0 END), 0) -
  COALESCE(SUM(CASE WHEN type = 'redeemed' THEN value_idr ELSE 0 END), 0) AS total_value_idr,
  MAX(created_at) AS last_activity
FROM member_points
GROUP BY customer_id, customer_wa;

-- 3. Function: auto-credit points on positive review
-- This can be called via trigger or application code
CREATE OR REPLACE FUNCTION credit_review_points()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
  v_customer_wa TEXT;
  v_review_count INTEGER;
  v_points_to_credit INTEGER := 5;  -- 5 points for positive review
  v_value_idr INTEGER := 50000;       -- Rp 50,000 value
BEGIN
  -- Only credit for positive reviews (4-5 stars)
  IF NEW.rating >= 4 THEN
    -- Get customer info from booking
    SELECT c.id, c.wa INTO v_customer_id, v_customer_wa
    FROM bookings b
    JOIN customers c ON c.wa = b.wa
    WHERE b.id = NEW.booking_id
    LIMIT 1;
    
    IF v_customer_id IS NOT NULL THEN
      -- Check if this customer already got review points for this booking
      SELECT COUNT(*) INTO v_review_count
      FROM member_points
      WHERE source = 'review' 
        AND source_id = NEW.booking_id::TEXT
        AND customer_id = v_customer_id;
      
      -- Only credit if not already credited
      IF v_review_count = 0 THEN
        INSERT INTO member_points (
          customer_id, customer_wa, points, type, source, source_id,
          description, value_idr
        ) VALUES (
          v_customer_id, v_customer_wa, v_points_to_credit, 'earned', 'review',
          NEW.booking_id::TEXT,
          format('Bonus %s poin (Rp %s) untuk ulasan positif %s bintang ⭐', 
                 v_points_to_credit, to_char(v_value_idr, 'FM999,999,999'), NEW.rating),
          v_value_idr
        );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger: auto-credit on review insert (optional, use with caution)
-- Uncomment if you want database-level trigger (application-level recommended for WA notification)
-- DROP TRIGGER IF EXISTS trg_credit_review_points ON reviews;
-- CREATE TRIGGER trg_credit_review_points
--   AFTER INSERT ON reviews
--   FOR EACH ROW
--   EXECUTE FUNCTION credit_review_points();

-- 5. Function: get_member_points_summary (for API)
CREATE OR REPLACE FUNCTION get_member_points_summary(p_customer_wa TEXT)
RETURNS JSON AS $$
DECLARE
  result JSON;
  v_wa_normalized TEXT;
BEGIN
  -- Normalize WA number
  v_wa_normalized := regexp_replace(p_customer_wa, '[^0-9]', '', 'g');
  IF starts_with(v_wa_normalized, '0') THEN
    v_wa_normalized := '62' || substring(v_wa_normalized, 2);
  ELSIF NOT starts_with(v_wa_normalized, '62') THEN
    v_wa_normalized := '62' || v_wa_normalized;
  END IF;
  
  SELECT json_build_object(
    'customer_wa', v_wa_normalized,
    'total_points', COALESCE(SUM(CASE WHEN type IN ('earned', 'bonus') THEN points ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN type = 'redeemed' THEN points ELSE 0 END), 0),
    'total_value_idr', COALESCE(SUM(CASE WHEN type IN ('earned', 'bonus') THEN value_idr ELSE 0 END), 0) -
                       COALESCE(SUM(CASE WHEN type = 'redeemed' THEN value_idr ELSE 0 END), 0),
    'transactions', COALESCE(json_agg(
      json_build_object(
        'id', id,
        'points', points,
        'type', type,
        'source', source,
        'description', description,
        'value_idr', value_idr,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ), '[]'::json)
  ) INTO result
  FROM member_points
  WHERE customer_wa = v_wa_normalized;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE member_points IS 'Loyalty points transactions for RedBox members';
COMMENT ON COLUMN member_points.value_idr IS 'Rupiah equivalent: 1 point = Rp 10,000';
