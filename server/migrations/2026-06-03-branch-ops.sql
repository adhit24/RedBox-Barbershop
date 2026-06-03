-- Extend booking status untuk home service + no-show
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending','confirmed','done','cancelled',
    'no_show','departed','arrived','in_progress'
  ));

-- Tabel absensi harian barber
CREATE TABLE IF NOT EXISTS barber_attendance (
  barber_id   TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'hadir'
              CHECK (status IN ('hadir','terlambat','izin','sakit','cuti')),
  note        TEXT,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (barber_id, date)
);

GRANT SELECT, INSERT, UPDATE ON barber_attendance TO anon, authenticated;

ALTER TABLE barber_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_all" ON barber_attendance FOR ALL USING (true) WITH CHECK (true);

-- Tabel broadcast log
CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch      TEXT NOT NULL,
  sender_id   UUID,
  target      TEXT NOT NULL DEFAULT 'all', -- 'all' or barber_id
  message     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'push', -- 'push' | 'wa' | 'both'
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT ON admin_broadcasts TO anon, authenticated;

ALTER TABLE admin_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts_all" ON admin_broadcasts FOR ALL USING (true) WITH CHECK (true);
