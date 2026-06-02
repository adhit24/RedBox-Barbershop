-- Badge yang sudah didapat
CREATE TABLE IF NOT EXISTS barber_achievements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id  TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  badge_key  TEXT NOT NULL,
  earned_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (barber_id, badge_key)
);
CREATE INDEX IF NOT EXISTS idx_barber_achievements_bid ON barber_achievements(barber_id);
GRANT SELECT, INSERT ON barber_achievements TO anon, authenticated;

-- Streak harian
CREATE TABLE IF NOT EXISTS barber_streaks (
  barber_id       TEXT PRIMARY KEY REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  current_streak  INT DEFAULT 0,
  longest_streak  INT DEFAULT 0,
  last_hit_date   DATE
);
GRANT SELECT, INSERT, UPDATE ON barber_streaks TO anon, authenticated;

-- Personal records
CREATE TABLE IF NOT EXISTS barber_records (
  barber_id                 TEXT PRIMARY KEY REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  best_customer_per_day     INT DEFAULT 0,
  best_customer_per_day_at  DATE,
  best_revenue_per_month    BIGINT DEFAULT 0,
  best_revenue_per_month_at TEXT,
  best_rating_per_month     NUMERIC(3,2) DEFAULT 0,
  best_rating_per_month_at  TEXT,
  longest_streak_at         DATE
);
GRANT SELECT, INSERT, UPDATE ON barber_records TO anon, authenticated;

-- Mission mingguan
CREATE TABLE IF NOT EXISTS barber_missions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id    TEXT NOT NULL REFERENCES barber_users(barber_id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,
  mission_key  TEXT NOT NULL,
  target       INT NOT NULL,
  progress     INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  UNIQUE (barber_id, week_start, mission_key)
);
CREATE INDEX IF NOT EXISTS idx_barber_missions_bw ON barber_missions(barber_id, week_start);
GRANT SELECT, INSERT, UPDATE ON barber_missions TO anon, authenticated;

-- RLS policies
ALTER TABLE barber_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY barber_achievements_all ON barber_achievements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY barber_streaks_all ON barber_streaks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY barber_records_all ON barber_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY barber_missions_all ON barber_missions FOR ALL USING (true) WITH CHECK (true);
