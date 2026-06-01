-- Profil + setup status kapster (extend tabel barbers)
CREATE TABLE IF NOT EXISTS barber_users (
  barber_id       TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  avatar_url      TEXT,
  target_daily    INT,
  target_monthly  INT,
  setup_completed BOOLEAN DEFAULT FALSE,
  notif_enabled   BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_barber_users_phone ON barber_users(phone);
GRANT SELECT, INSERT, UPDATE ON barber_users TO anon, authenticated;

-- Session token untuk kapster (custom OTP, bukan Supabase Auth)
CREATE TABLE IF NOT EXISTS barber_sessions (
  token      TEXT PRIMARY KEY,
  barber_id  TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_barber_sessions_barber_id ON barber_sessions(barber_id);
GRANT SELECT, INSERT, DELETE ON barber_sessions TO anon, authenticated;
