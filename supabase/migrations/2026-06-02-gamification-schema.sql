-- ── ALTER existing achievements table ───────────────────────────
ALTER TABLE barber_achievements
 ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common',
 ADD COLUMN IF NOT EXISTS xp_awarded INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS label TEXT;

-- ── XP & Level ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_xp (
 barber_id TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
 total_xp INTEGER NOT NULL DEFAULT 0,
 current_xp INTEGER NOT NULL DEFAULT 0,
 level INTEGER NOT NULL DEFAULT 1,
 prestige INTEGER NOT NULL DEFAULT 0,
 xp_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS barber_xp_log (
 id BIGSERIAL PRIMARY KEY,
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 xp_delta INTEGER NOT NULL,
 reason TEXT NOT NULL,
 total_after INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_log_barber ON barber_xp_log(barber_id, created_at DESC);

-- ── Titles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_titles (
 barber_id TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
 level_title TEXT NOT NULL DEFAULT 'Rookie',
 special_title TEXT,
 active_title TEXT NOT NULL DEFAULT 'Rookie',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Performance Score (monthly snapshot) ───────────────────────
CREATE TABLE IF NOT EXISTS barber_perf_scores (
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 month DATE NOT NULL,
 volume_score NUMERIC(6,2) DEFAULT 0,
 quality_score NUMERIC(6,2) DEFAULT 0,
 consistency_score NUMERIC(6,2) DEFAULT 0,
 mission_score NUMERIC(6,2) DEFAULT 0,
 growth_score NUMERIC(6,2) DEFAULT 0,
 total_score NUMERIC(7,2) DEFAULT 0,
 rank_overall INTEGER,
 calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (barber_id, month)
);

-- ── Leaderboard cache ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_leaderboard_cache (
 period_type TEXT NOT NULL,
 category TEXT NOT NULL,
 period_start DATE NOT NULL,
 rank INTEGER NOT NULL,
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 barber_name TEXT NOT NULL,
 branch TEXT NOT NULL,
 score NUMERIC(10,2) NOT NULL DEFAULT 0,
 display_value TEXT,
 snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (period_type, category, period_start, rank)
);
CREATE INDEX IF NOT EXISTS idx_lb_cache_lookup
 ON barber_leaderboard_cache(period_type, category, period_start);

-- ── Social Feed ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_social_feed (
 id BIGSERIAL PRIMARY KEY,
 event_type TEXT NOT NULL,
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 barber_name TEXT NOT NULL,
 branch TEXT NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 emoji TEXT,
 metadata JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_recent ON barber_social_feed(created_at DESC);

-- ── Rivals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_rivals (
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 rival_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 week_start DATE NOT NULL,
 my_count_start INTEGER DEFAULT 0,
 rival_count_start INTEGER DEFAULT 0,
 my_count_current INTEGER DEFAULT 0,
 rival_count_current INTEGER DEFAULT 0,
 result TEXT,
 notified_win BOOLEAN DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (barber_id, week_start)
);

-- ── King of the Shop ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS king_of_shop (
 branch TEXT NOT NULL,
 week_start DATE NOT NULL,
 barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
 barber_name TEXT NOT NULL,
 total_count INTEGER NOT NULL DEFAULT 0,
 notified BOOLEAN DEFAULT false,
 PRIMARY KEY (branch, week_start)
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE barber_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_xp_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_perf_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_leaderboard_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_social_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_rivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE king_of_shop ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_daily_counts ENABLE ROW LEVEL SECURITY;

-- Read-all policies (server writes via service role)
CREATE POLICY "xp_read" ON barber_xp FOR SELECT TO authenticated USING (true);
CREATE POLICY "xp_log_read" ON barber_xp_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "titles_read" ON barber_titles FOR SELECT TO authenticated USING (true);
CREATE POLICY "perf_read" ON barber_perf_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "lb_cache_read" ON barber_leaderboard_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "feed_read" ON barber_social_feed FOR SELECT TO authenticated USING (true);
CREATE POLICY "rivals_read" ON barber_rivals FOR SELECT TO authenticated USING (true);
CREATE POLICY "king_read" ON king_of_shop FOR SELECT TO authenticated USING (true);
CREATE POLICY "daily_counts_read" ON barber_daily_counts FOR SELECT TO authenticated USING (true);

GRANT SELECT ON barber_xp, barber_xp_log, barber_titles, barber_perf_scores,
 barber_leaderboard_cache, barber_social_feed, barber_rivals, king_of_shop
 TO anon, authenticated;
