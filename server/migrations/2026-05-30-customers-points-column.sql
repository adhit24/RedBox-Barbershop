-- Tambah kolom points ke customers jika belum ada.
-- Idempotent — aman dijalankan berulang.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;

-- Backfill dari member_profiles untuk member yang sudah ada
-- tapi belum punya points (matching by phone_e164 ↔ member_profiles.phone)
UPDATE customers c
SET    points = COALESCE(mp.total_points, c.visits * 10)
FROM   member_profiles mp
WHERE  mp.phone      = c.phone_e164
  AND  mp.total_points > 0
  AND  (c.points IS NULL OR c.points = 0);
