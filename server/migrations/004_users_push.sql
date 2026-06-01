-- Tabel profil user (extend Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'branch_admin', 'barber')),
  branch TEXT CHECK (branch IS NULL OR branch IN ('bypass', 'samadikun', 'csb', 'sumber', 'tegal')),      -- NULL untuk owner; 'bypass'|'samadikun'|'csb'|'sumber'|'tegal' untuk lainnya
  barber_id TEXT,   -- diisi untuk role 'barber', referensi ke barbers.id
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRANT wajib (Supabase policy project)
GRANT SELECT, INSERT, UPDATE ON users TO anon, authenticated;

-- Tabel push subscription token per device
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- GRANT wajib
GRANT SELECT, INSERT, DELETE ON push_subscriptions TO anon, authenticated;

-- Tabel notifikasi internal per user (untuk log di barber/notifications)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- GRANT wajib
GRANT SELECT, INSERT, UPDATE ON notifications TO anon, authenticated;
