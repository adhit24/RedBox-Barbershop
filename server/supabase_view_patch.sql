-- ============================================================
-- PATCH: Update schedules_full view + tambah index penting
-- Jalankan di Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Update schedules_full view — tambah barber_moka_employee_id dan moka_variant_name
--    sehingga tidak perlu extra round-trip ke DB saat push booking ke Moka
--    Harus DROP dulu karena CREATE OR REPLACE tidak bisa ubah urutan/nama kolom
DROP VIEW IF EXISTS schedules_full;

CREATE VIEW schedules_full AS
  SELECT
    s.*,
    b.name               AS barber_name,
    b.role               AS barber_role,
    b.moka_employee_id   AS barber_moka_employee_id,
    c.name               AS customer_name,
    COALESCE(c.phone_e164, c.wa) AS customer_phone,
    c.email              AS customer_email,
    o.name               AS outlet_name,
    o.moka_outlet_id     AS outlet_moka_id,
    svc.moka_item_id,
    svc.moka_category_id,
    svc.moka_category_name,
    svc.moka_variant_name
  FROM  schedules s
  LEFT JOIN barbers   b   ON s.barber_id   = b.id
  LEFT JOIN customers c   ON s.customer_id = c.id
  LEFT JOIN outlets   o   ON s.outlet_id   = o.id
  LEFT JOIN services  svc ON s.service_id  = svc.id;

-- 2. Index untuk retry cron: cari schedules dengan external_id LIKE 'booking:%'
CREATE INDEX IF NOT EXISTS idx_schedules_external_bridge
  ON schedules (external_id)
  WHERE external_id LIKE 'booking:%';

-- 3. Index untuk retry cron: cari schedules tanpa external_id yang akan datang
CREATE INDEX IF NOT EXISTS idx_schedules_pending_push
  ON schedules (start_time, status)
  WHERE external_id IS NULL AND status IN ('reserved','confirmed');

-- 4. Index untuk lookup schedule by external_id (dipakai webhook callback)
CREATE INDEX IF NOT EXISTS idx_schedules_external_id
  ON schedules (external_id)
  WHERE external_id IS NOT NULL;

-- 5. Tambah kolom schedule_id ke bookings (untuk mirror status dari Moka callback)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id);

CREATE INDEX IF NOT EXISTS idx_bookings_schedule_id
  ON bookings (schedule_id)
  WHERE schedule_id IS NOT NULL;

-- Verifikasi: lihat kolom schedules_full
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'schedules_full'
ORDER BY ordinal_position;
