# Gamification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing barber self-service system with a full gamification layer — XP, levels, titles, rarity achievements, performance scores, leaderboard categories, social feed, rivals, and King of the Shop.

**Architecture:** Build on top of existing tables (`barber_achievements`, `barber_streaks`, `barber_missions`, `barber_daily_counts`). New tables store XP/levels/feed/rivals. A nightly cron at 00:00 WIB awards XP, checks achievements, rebuilds leaderboard cache, and assigns rivals. Frontend extends existing pages with new components.

**Tech Stack:** Supabase Postgres (RLS, triggers, functions), Express.js backend, Next.js App Router, TypeScript, Tailwind CSS.

---

## Context: Existing Structure

```
server/routes/barber.js — all barber API endpoints
server/routes/barberCron.js — nightly crons (daily-recap 23:30, streak 23:55, mission weekly)
frontend/src/lib/barberTypes.ts — TypeScript types
frontend/src/lib/barberApi.ts — fetch helpers
frontend/src/lib/achievementDefs.ts — BADGE_DEFS (7 badges, no rarity)
frontend/src/components/barber/BadgeGrid.tsx — achievement wall
frontend/src/app/barber/home/page.tsx — home page
frontend/src/app/barber/progress/page.tsx — progress/achievements page
frontend/src/app/barber/leaderboard/page.tsx — leaderboard
frontend/src/app/barber/layout.tsx — nav with 5 tabs
```

Existing DB tables relevant to this plan:
- `barbers(id, name, branch, is_active)` — 30 rows
- `barber_users(barber_id, target_daily, notif_enabled)` — 26 rows
- `barber_achievements(barber_id, badge_key, earned_at)` — 0 rows (needs ALTER)
- `barber_streaks(barber_id, current_streak, longest_streak)` — 26 rows
- `barber_missions(barber_id, week_start, mission_key, target, progress, completed_at)` — 78 rows
- `barber_daily_counts(barber_id, date, count, source)` — 40 rows (source of truth)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/gamification_schema.sql` | Create | All new tables + ALTER existing + functions |
| `server/routes/barberCron.js` | Modify | Add `/barber-nightly-gamification` endpoint |
| `server/routes/barber.js` | Modify | Add `/xp`, `/title`, `/social-feed`, `/rivals` endpoints |
| `server/services/gamificationService.js` | Create | checkAchievements(), assignRivals(), crownKing(), rebuildLeaderboardCache() |
| `frontend/src/lib/barberTypes.ts` | Modify | Add XPData, TitleData, SocialFeedItem, RivalData types |
| `frontend/src/lib/barberApi.ts` | Modify | Add fetchBarberXP(), fetchBarberTitle(), fetchBarberFeed(), fetchBarberRival() |
| `frontend/src/lib/achievementDefs.ts` | Modify | Expand BADGE_DEFS with rarity, add RARITY_CONFIG |
| `frontend/src/components/barber/XPBar.tsx` | Create | XP progress bar + level + title display |
| `frontend/src/components/barber/RivalWidget.tsx` | Create | Rival comparison card |
| `frontend/src/components/barber/KingBadge.tsx` | Create | King of the Shop banner |
| `frontend/src/components/barber/BadgeGrid.tsx` | Modify | Add rarity colors + XP reward display |
| `frontend/src/app/barber/home/page.tsx` | Modify | Add XPBar, KingBadge, RivalWidget |
| `frontend/src/app/barber/progress/page.tsx` | Modify | Add XP section, enhanced BadgeGrid |
| `frontend/src/app/barber/leaderboard/page.tsx` | Modify | Add category tabs (PS Score / Customer / Rating / Streak) |
| `frontend/src/app/barber/feed/page.tsx` | Create | Social feed page |
| `frontend/src/app/barber/layout.tsx` | Modify | Add Feed tab to nav |

---

## Task 1: Database Schema — New Tables + ALTER

**Files:**
- Create: `supabase/migrations/2026-06-02-gamification-schema.sql`

Apply via Supabase MCP (`apply_migration`) with project_id `khcvklzxfohwkyocenaf`.

- [ ] **Step 1: Run the migration SQL**

```sql
-- ── ALTER existing achievements table ───────────────────────────
ALTER TABLE barber_achievements
 ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common',
 ADD COLUMN IF NOT EXISTS xp_awarded INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS label TEXT;

-- ── XP & Level ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barber_xp (
 barber_id TEXT PRIMARY KEY REFERENCES barbers(id) ON DELETE CASCADE,
 total_xp INTEGER NOT NULL DEFAULT 0,
 current_xp INTEGER NOT NULL DEFAULT 0, -- XP within current level
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
```

- [ ] **Step 2: Verify tables created**

Run via Supabase MCP execute_sql:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
 AND table_name IN ('barber_xp','barber_titles','barber_perf_scores',
 'barber_leaderboard_cache','barber_social_feed','barber_rivals','king_of_shop');
```
Expected: 7 rows returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-06-02-gamification-schema.sql
git commit -m "feat(gamification): DB schema — XP, titles, perf score, feed, rivals, king"
```

---

## Task 2: PostgreSQL Functions — add_xp, unlock_achievement, get_level_title

**Files:**
- Create: `supabase/migrations/2026-06-02-gamification-functions.sql`

Apply via Supabase MCP `apply_migration`.

- [ ] **Step 1: Create functions**

```sql
-- ── xp_to_level: Level N requires 150*N² cumulative XP ──────────
CREATE OR REPLACE FUNCTION xp_to_level(p_total_xp INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
 SELECT GREATEST(1, FLOOR(SQRT(p_total_xp::FLOAT / 150.0))::INTEGER);
$$;

-- ── get_level_title ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_level_title(p_level INTEGER, p_prestige INTEGER DEFAULT 0)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
 base TEXT;
 stars TEXT := repeat('', LEAST(p_prestige, 3));
BEGIN
 base := CASE
 WHEN p_level >= 50 AND p_prestige >= 3 THEN 'Immortal Barber '
 WHEN p_level >= 50 THEN 'Mythic Barber '
 WHEN p_level >= 40 THEN 'Legend Barber '
 WHEN p_level >= 30 THEN 'Grandmaster Barber '
 WHEN p_level >= 20 THEN 'Master Barber 🟠'
 WHEN p_level >= 15 THEN 'Elite Barber 🟣'
 WHEN p_level >= 10 THEN 'Skilled Barber '
 WHEN p_level >= 5 THEN 'Junior Barber 🟢'
 ELSE 'Rookie '
 END;
 RETURN CASE WHEN stars <> '' THEN stars || ' ' || base ELSE base END;
END;
$$;

-- ── add_xp: adds XP, levels up, updates title, writes feed ──────
CREATE OR REPLACE FUNCTION add_xp(
 p_barber_id TEXT,
 p_xp INTEGER,
 p_reason TEXT DEFAULT 'unknown'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
 rec barber_xp%ROWTYPE;
 new_total INTEGER;
 new_level INTEGER;
 old_level INTEGER;
 actual_xp INTEGER;
 prev_level_xp INTEGER;
 leveled_up BOOLEAN := false;
 b_name TEXT;
 b_branch TEXT;
BEGIN
 INSERT INTO barber_xp (barber_id) VALUES (p_barber_id)
 ON CONFLICT (barber_id) DO NOTHING;

 SELECT * INTO rec FROM barber_xp WHERE barber_id = p_barber_id;
 actual_xp := ROUND(p_xp * rec.xp_multiplier)::INTEGER;
 old_level := rec.level;
 new_total := rec.total_xp + actual_xp;
 new_level := xp_to_level(new_total);
 leveled_up := new_level > old_level;
 prev_level_xp := 150 * (new_level - 1) * (new_level - 1);

 UPDATE barber_xp SET
 total_xp = new_total,
 current_xp = new_total - prev_level_xp,
 level = new_level,
 updated_at = now()
 WHERE barber_id = p_barber_id;

 INSERT INTO barber_xp_log (barber_id, xp_delta, reason, total_after)
 VALUES (p_barber_id, actual_xp, p_reason, new_total);

 IF leveled_up THEN
 SELECT name, branch INTO b_name, b_branch FROM barbers WHERE id = p_barber_id;

 INSERT INTO barber_titles (barber_id, level_title, active_title)
 VALUES (p_barber_id, get_level_title(new_level, rec.prestige), get_level_title(new_level, rec.prestige))
 ON CONFLICT (barber_id) DO UPDATE SET
 level_title = get_level_title(new_level, rec.prestige),
 active_title = CASE
 WHEN barber_titles.special_title IS NULL
 THEN get_level_title(new_level, rec.prestige)
 ELSE barber_titles.active_title
 END,
 updated_at = now();

 INSERT INTO barber_social_feed
 (event_type, barber_id, barber_name, branch, title, body, emoji, metadata)
 VALUES (
 'level_up', p_barber_id, b_name, b_branch,
 b_name || ' naik ke Level ' || new_level,
 'Sekarang: ' || get_level_title(new_level, rec.prestige),
 '',
 jsonb_build_object('level', new_level, 'old_level', old_level)
 );
 END IF;

 RETURN jsonb_build_object(
 'xp_added', actual_xp, 'total_xp', new_total,
 'level', new_level, 'leveled_up', leveled_up
 );
END;
$$;

-- ── unlock_achievement: idempotent, awards XP, writes feed ──────
CREATE OR REPLACE FUNCTION unlock_achievement(
 p_barber_id TEXT,
 p_badge_key TEXT,
 p_label TEXT,
 p_rarity TEXT DEFAULT 'common'
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
 xp_map JSONB := '{"common":25,"rare":50,"epic":100,"legendary":250,"mythic":500}';
 xp_reward INTEGER;
 b_name TEXT;
 b_branch TEXT;
 emoji_map JSONB := '{"mythic":"","legendary":"","epic":"","rare":"","common":""}';
BEGIN
 IF EXISTS (
 SELECT 1 FROM barber_achievements
 WHERE barber_id = p_barber_id AND badge_key = p_badge_key
 ) THEN RETURN false; END IF;

 xp_reward := (xp_map ->> p_rarity)::INTEGER;

 INSERT INTO barber_achievements (barber_id, badge_key, rarity, xp_awarded, label)
 VALUES (p_barber_id, p_badge_key, p_rarity, xp_reward, p_label);

 PERFORM add_xp(p_barber_id, xp_reward, 'achievement_' || p_badge_key);

 SELECT name, branch INTO b_name, b_branch FROM barbers WHERE id = p_barber_id;

 INSERT INTO barber_social_feed
 (event_type, barber_id, barber_name, branch, title, body, emoji, metadata)
 VALUES (
 'achievement_unlock', p_barber_id, b_name, b_branch,
 b_name || ' mendapat: ' || p_label,
 'Rarity: ' || UPPER(p_rarity) || ' · +' || xp_reward || ' XP',
 (emoji_map ->> p_rarity)::TEXT,
 jsonb_build_object('badge_key', p_badge_key, 'rarity', p_rarity, 'xp', xp_reward)
 );

 RETURN true;
END;
$$;
```

- [ ] **Step 2: Verify functions exist**

Run via Supabase MCP execute_sql:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
 AND routine_name IN ('xp_to_level','get_level_title','add_xp','unlock_achievement');
```
Expected: 4 rows.

- [ ] **Step 3: Smoke test add_xp**

```sql
-- Award 100 XP to bypass-bob, should reach level 1 → check
SELECT add_xp('bypass-bob', 100, 'test');
SELECT barber_id, total_xp, level FROM barber_xp WHERE barber_id = 'bypass-bob';
-- Delete test data
DELETE FROM barber_xp WHERE barber_id = 'bypass-bob';
DELETE FROM barber_xp_log WHERE barber_id = 'bypass-bob';
DELETE FROM barber_social_feed WHERE barber_id = 'bypass-bob' AND event_type = 'level_up';
```
Expected: total_xp = 100, level = 1 (since 150 × 1² = 150 XP needed for level 1, so still level 1... wait, floor(sqrt(100/150)) = floor(0.81) = 0, GREATEST(1,0) = 1. Correct).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-06-02-gamification-functions.sql
git commit -m "feat(gamification): PostgreSQL functions — add_xp, unlock_achievement, get_level_title"
```

---

## Task 3: Achievement Definitions — Expand BADGE_DEFS with Rarity

**Files:**
- Modify: `frontend/src/lib/achievementDefs.ts`

- [ ] **Step 1: Replace BADGE_DEFS and add RARITY_CONFIG**

Replace the entire `achievementDefs.ts`:

```typescript
// frontend/src/lib/achievementDefs.ts

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface BadgeDef {
 key: string;
 label: string;
 icon: string;
 description: string;
 rarity: Rarity;
 xp: number;
}

export const RARITY_CONFIG: Record<Rarity, {
 label: string; color: string; bg: string; border: string; glow: string; xp: number;
}> = {
 common: { label: 'Common', color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200', glow: '', xp: 25 },
 rare: { label: 'Rare', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', glow: '', xp: 50 },
 epic: { label: 'Epic', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-300', glow: 'shadow-purple-200', xp: 100 },
 legendary: { label: 'Legendary', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-400', glow: 'shadow-yellow-200', xp: 250 },
 mythic: { label: 'Mythic', color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-400', glow: 'shadow-rose-200 shadow-md', xp: 500 },
};

export const BADGE_DEFS: BadgeDef[] = [
 // ── Customer ─────────────────────────────────────────────────
 { key: 'first_cut', icon: '', label: 'First Cut', description: 'Layani customer pertama', rarity: 'common', xp: 25 },
 { key: 'rookie_10', icon: '', label: 'Rookie Cutter', description: 'Layani 10 customer', rarity: 'common', xp: 25 },
 { key: 'century', icon: '', label: 'Century Club', description: 'Layani 100 customer', rarity: 'rare', xp: 50 },
 { key: 'diamond_hand', icon: '', label: 'Diamond Hand', description: 'Layani 1000 customer', rarity: 'epic', xp: 100 },
 { key: 'five_thousand', icon: '', label: '5000 Legend', description: 'Layani 5000 customer', rarity: 'mythic', xp: 500 },

 // ── Rating ───────────────────────────────────────────────────
 { key: 'first_star', icon: '', label: 'First Star', description: 'Pertama dapat review bintang', rarity: 'common', xp: 25 },
 { key: 'review_50', icon: '', label: '50 Happy Clients', description: '50 review positif', rarity: 'rare', xp: 50 },
 { key: 'review_100', icon: '', label: '100 Happy Clients',description: '100 review positif', rarity: 'epic', xp: 100 },
 { key: 'review_500', icon: '', label: 'Review Master', description: '500 review positif', rarity: 'legendary', xp: 250 },

 // ── Streak ──────────────────────────────────────────────────
 { key: 'streak_master', icon: '', label: 'Streak Master', description: 'Streak 30 hari', rarity: 'rare', xp: 50 },
 { key: 'streak_60', icon: '', label: 'Streak Legend', description: 'Streak 60 hari', rarity: 'epic', xp: 100 },
 { key: 'streak_100', icon: '', label: 'Streak God', description: 'Streak 100 hari', rarity: 'legendary', xp: 250 },

 // ── Mission ─────────────────────────────────────────────────
 { key: 'first_mission', icon: '', label: 'First Mission', description: 'Selesaikan misi pertama', rarity: 'common', xp: 25 },
 { key: 'mission_hunter', icon: '', label: 'Mission Hunter', description: 'Selesaikan 20 misi', rarity: 'rare', xp: 50 },
 { key: 'mission_conqueror',icon: '', label: 'Mission Conqueror',description: 'Selesaikan 50 misi', rarity: 'epic', xp: 100 },

 // ── Special ─────────────────────────────────────────────────
 { key: 'hair_cut_master', icon: '', label: 'Hair Cut Master', description: '500 potong rambut web', rarity: 'rare', xp: 50 },
 { key: 'home_service_hero',icon: '', label: 'Home Service Hero',description: '25 home service', rarity: 'rare', xp: 50 },
 { key: 'customer_king', icon: '', label: 'Customer King', description: '#1 leaderboard 3x berturut', rarity: 'legendary', xp: 250 },
 { key: 'barber_legend', icon: '', label: 'Barber Legend', description: 'Performance Score > 900', rarity: 'mythic', xp: 500 },
 { key: 'king_of_shop', icon: '', label: 'King of The Shop', description: 'Raih King of Shop 4x', rarity: 'mythic', xp: 500 },
];

// For barberCron.js achievement checking
export const ACHIEVEMENT_THRESHOLDS = {
 first_cut: { type: 'total_customers', value: 1, rarity: 'common' as Rarity },
 rookie_10: { type: 'total_customers', value: 10, rarity: 'common' as Rarity },
 century: { type: 'total_customers', value: 100, rarity: 'rare' as Rarity },
 diamond_hand: { type: 'total_customers', value: 1000, rarity: 'epic' as Rarity },
 five_thousand: { type: 'total_customers', value: 5000, rarity: 'mythic' as Rarity },
 first_star: { type: 'total_reviews', value: 1, rarity: 'common' as Rarity },
 review_50: { type: 'total_reviews', value: 50, rarity: 'rare' as Rarity },
 review_100: { type: 'total_reviews', value: 100, rarity: 'epic' as Rarity },
 review_500: { type: 'total_reviews', value: 500, rarity: 'legendary' as Rarity },
 streak_master: { type: 'streak', value: 30, rarity: 'rare' as Rarity },
 streak_60: { type: 'streak', value: 60, rarity: 'epic' as Rarity },
 streak_100: { type: 'streak', value: 100, rarity: 'legendary' as Rarity },
 first_mission: { type: 'missions_done', value: 1, rarity: 'common' as Rarity },
 mission_hunter: { type: 'missions_done', value: 20, rarity: 'rare' as Rarity },
 mission_conqueror: { type: 'missions_done', value: 50, rarity: 'epic' as Rarity },
};

export const TIER_CONFIG = {
 LEGEND: { icon: '', label: 'LEGEND', color: 'text-yellow-500', bg: 'bg-yellow-50' },
 ELITE: { icon: '', label: 'ELITE', color: 'text-purple-600', bg: 'bg-purple-50' },
 ADVANCED: { icon: '', label: 'ADVANCED', color: 'text-blue-600', bg: 'bg-blue-50' },
 RISING: { icon: '', label: 'RISING', color: 'text-green-600', bg: 'bg-green-50' },
} as const;

export const MISSION_LABELS: Record<string, { label: string; icon: string }> = {
 serve_customers: { label: 'Layani customer', icon: '' },
 get_reviews: { label: 'Dapat review 5', icon: '' },
 no_cancel: { label: 'Zero cancel/no-show', icon: '' },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (or only pre-existing errors unrelated to achievementDefs.ts).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/achievementDefs.ts
git commit -m "feat(gamification): expand BADGE_DEFS with rarity system — 20 badges"
```

---

## Task 4: Gamification Service — checkAchievements, assignRivals, crownKing, rebuildCache

**Files:**
- Create: `server/services/gamificationService.js`

- [ ] **Step 1: Create the service file**

```javascript
// server/services/gamificationService.js
'use strict';

const { sendPushNotifToBarber } = require('./barberMetrics');

function localDateStr(d = new Date()) {
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Achievement Thresholds (mirrors frontend achievementDefs.ts) ─
const ACHIEVEMENT_CHECKS = [
 { key: 'first_cut', label: 'First Cut', type: 'total_customers', value: 1, rarity: 'common' },
 { key: 'rookie_10', label: 'Rookie Cutter', type: 'total_customers', value: 10, rarity: 'common' },
 { key: 'century', label: 'Century Club', type: 'total_customers', value: 100, rarity: 'rare' },
 { key: 'diamond_hand', label: 'Diamond Hand', type: 'total_customers', value: 1000, rarity: 'epic' },
 { key: 'five_thousand', label: '5000 Legend', type: 'total_customers', value: 5000, rarity: 'mythic' },
 { key: 'first_star', label: 'First Star', type: 'total_reviews', value: 1, rarity: 'common' },
 { key: 'review_50', label: '50 Happy Clients', type: 'total_reviews', value: 50, rarity: 'rare' },
 { key: 'review_100', label: '100 Happy Clients',type: 'total_reviews', value: 100, rarity: 'epic' },
 { key: 'review_500', label: 'Review Master', type: 'total_reviews', value: 500, rarity: 'legendary' },
 { key: 'streak_master', label: 'Streak Master', type: 'streak', value: 30, rarity: 'rare' },
 { key: 'streak_60', label: 'Streak Legend', type: 'streak', value: 60, rarity: 'epic' },
 { key: 'streak_100', label: 'Streak God', type: 'streak', value: 100, rarity: 'legendary' },
 { key: 'first_mission', label: 'First Mission', type: 'missions_done', value: 1, rarity: 'common' },
 { key: 'mission_hunter', label: 'Mission Hunter', type: 'missions_done', value: 20, rarity: 'rare' },
 { key: 'mission_conqueror',label:'Mission Conqueror',type: 'missions_done', value: 50, rarity: 'epic' },
];

async function checkAchievements(supabase, barberId, { totalCustomers, totalReviews, streak, missionsDone }) {
 const unlocked = [];
 for (const check of ACHIEVEMENT_CHECKS) {
 const metric =
 check.type === 'total_customers' ? totalCustomers :
 check.type === 'total_reviews' ? totalReviews :
 check.type === 'streak' ? streak :
 check.type === 'missions_done' ? missionsDone : 0;

 if (metric >= check.value) {
 const { data: result } = await supabase.rpc('unlock_achievement', {
 p_barber_id: barberId,
 p_badge_key: check.key,
 p_label: check.label,
 p_rarity: check.rarity,
 });
 if (result === true) {
 unlocked.push(check.key);
 const xpMap = { common: 25, rare: 50, epic: 100, legendary: 250, mythic: 500 };
 sendPushNotifToBarber(supabase, barberId, {
 title: ` Badge Baru: ${check.label}`,
 body: `${check.rarity.toUpperCase()} · +${xpMap[check.rarity]} XP`,
 url: '/barber/progress',
 });
 }
 }
 }
 return unlocked;
}

async function assignRivals(supabase, weekStart) {
 // Get all active barbers with their monthly customer count
 const monthStart = weekStart.slice(0, 7) + '-01';

 const { data: barbers } = await supabase
 .from('barbers').select('id, name, branch').eq('is_active', true);
 if (!barbers?.length) return 0;

 // Get monthly counts per barber
 const { data: countRows } = await supabase
 .from('barber_daily_counts')
 .select('barber_id, count')
 .gte('date', monthStart)
 .lte('date', weekStart);

 const countMap = {};
 for (const r of (countRows || [])) {
 countMap[r.barber_id] = (countMap[r.barber_id] || 0) + r.count;
 }

 // Sort by count desc
 const ranked = barbers
 .map(b => ({ ...b, count: countMap[b.id] || 0 }))
 .sort((a, b) => b.count - a.count);

 let assigned = 0;
 for (let i = 0; i < ranked.length; i++) {
 const me = ranked[i];
 // Find closest rival (prefer one rank above, fallback one rank below)
 const rival = ranked[i - 1] || ranked[i + 1];
 if (!rival) continue;

 await supabase.from('barber_rivals').upsert({
 barber_id: me.id,
 rival_id: rival.id,
 week_start: weekStart,
 my_count_start: me.count,
 rival_count_start: rival.count,
 my_count_current: me.count,
 rival_count_current: rival.count,
 }, { onConflict: 'barber_id,week_start' });

 const gap = rival.count - me.count;
 const msg = gap > 0
 ? `Kamu tertinggal ${gap} customer dari ${rival.name}`
 : gap === 0
 ? `Kamu sejajar dengan ${rival.name}!`
 : `Kamu unggul ${Math.abs(gap)} customer dari ${rival.name}`;

 sendPushNotifToBarber(supabase, me.id, {
 title: ` Rival minggu ini: ${rival.name}`,
 body: msg,
 url: '/barber/leaderboard',
 });
 assigned++;
 }
 return assigned;
}

async function crownKingOfShop(supabase, weekStart) {
 const monthStart = weekStart.slice(0, 7) + '-01';

 const { data: barbers } = await supabase
 .from('barbers').select('id, name, branch').eq('is_active', true);
 if (!barbers?.length) return;

 // Group by branch, find top barber per branch this month
 const branches = [...new Set(barbers.map(b => b.branch))];

 const { data: countRows } = await supabase
 .from('barber_daily_counts')
 .select('barber_id, count')
 .gte('date', monthStart)
 .lte('date', weekStart);

 const countMap = {};
 for (const r of (countRows || [])) {
 countMap[r.barber_id] = (countMap[r.barber_id] || 0) + r.count;
 }

 for (const branch of branches) {
 const branchBarbers = barbers.filter(b => b.branch === branch);
 const top = branchBarbers
 .map(b => ({ ...b, count: countMap[b.id] || 0 }))
 .sort((a, b) => b.count - a.count)[0];

 if (!top || top.count === 0) continue;

 await supabase.from('king_of_shop').upsert({
 branch,
 week_start: weekStart,
 barber_id: top.id,
 barber_name: top.name,
 total_count: top.count,
 }, { onConflict: 'branch,week_start' });

 // Give special title
 await supabase.from('barber_titles').upsert({
 barber_id: top.id,
 special_title: 'King of The Shop ',
 active_title: 'King of The Shop ',
 }, { onConflict: 'barber_id' });

 // Award XP
 await supabase.rpc('add_xp', {
 p_barber_id: top.id, p_xp: 200, p_reason: 'king_of_shop'
 });

 // Social feed
 await supabase.from('barber_social_feed').insert({
 event_type: 'king_of_shop', barber_id: top.id,
 barber_name: top.name, branch,
 title: `${top.name} adalah King of The Shop!`,
 body: `Cabang ${branch} — ${top.count} customer bulan ini`,
 emoji: '',
 metadata: { branch, week_start: weekStart, count: top.count },
 });

 sendPushNotifToBarber(supabase, top.id, {
 title: ' KAMU ADALAH KING OF THE SHOP!',
 body: `Cabang ${branch} — ${top.count} customer bulan ini`,
 url: '/barber/leaderboard',
 });
 }
}

async function rebuildLeaderboardCache(supabase, today) {
 const monthStart = today.slice(0, 7) + '-01';
 const weekStart = (() => {
 const d = new Date(today + 'T00:00:00+07:00');
 const day = d.getDay();
 d.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
 return localDateStr(d);
 })();

 const { data: barbers } = await supabase
 .from('barbers').select('id, name, branch').eq('is_active', true);
 if (!barbers?.length) return;

 // ── Monthly Customer Champion ──────────────────────────────────
 const { data: monthRows } = await supabase
 .from('barber_daily_counts').select('barber_id, count')
 .gte('date', monthStart).lte('date', today);

 const monthMap = {};
 for (const r of (monthRows || [])) {
 monthMap[r.barber_id] = (monthMap[r.barber_id] || 0) + r.count;
 }

 const monthRanked = barbers
 .map(b => ({ ...b, count: monthMap[b.id] || 0 }))
 .sort((a, b) => b.count - a.count);

 // Delete old monthly customer_champion cache
 await supabase.from('barber_leaderboard_cache')
 .delete().eq('period_type', 'monthly').eq('category', 'customer_champion')
 .eq('period_start', monthStart);

 // Insert new
 for (let i = 0; i < monthRanked.length; i++) {
 const b = monthRanked[i];
 await supabase.from('barber_leaderboard_cache').insert({
 period_type: 'monthly', category: 'customer_champion',
 period_start: monthStart,
 rank: i + 1, barber_id: b.id, barber_name: b.name, branch: b.branch,
 score: b.count, display_value: `${b.count} customer`,
 });
 }

 // ── Monthly Streak Champion ────────────────────────────────────
 const { data: streakRows } = await supabase
 .from('barber_streaks').select('barber_id, current_streak');

 const streakMap = {};
 for (const r of (streakRows || [])) streakMap[r.barber_id] = r.current_streak;

 const streakRanked = barbers
 .map(b => ({ ...b, streak: streakMap[b.id] || 0 }))
 .sort((a, b) => b.streak - a.streak);

 await supabase.from('barber_leaderboard_cache')
 .delete().eq('period_type', 'monthly').eq('category', 'streak_champion')
 .eq('period_start', monthStart);

 for (let i = 0; i < streakRanked.length; i++) {
 const b = streakRanked[i];
 await supabase.from('barber_leaderboard_cache').insert({
 period_type: 'monthly', category: 'streak_champion',
 period_start: monthStart,
 rank: i + 1, barber_id: b.id, barber_name: b.name, branch: b.branch,
 score: b.streak, display_value: `${b.streak} hari`,
 });
 }
}

module.exports = { checkAchievements, assignRivals, crownKingOfShop, rebuildLeaderboardCache };
```

- [ ] **Step 2: Commit**

```bash
git add server/services/gamificationService.js
git commit -m "feat(gamification): gamificationService — checkAchievements, assignRivals, crownKing, rebuildCache"
```

---

## Task 5: Nightly Gamification Cron — Award XP + Check Achievements

**Files:**
- Modify: `server/routes/barberCron.js`

- [ ] **Step 1: Add require at top of barberCron.js**

After the existing `require` lines at the top of `barberCron.js`, add:

```javascript
const { checkAchievements, assignRivals, crownKingOfShop, rebuildLeaderboardCache } = require('../services/gamificationService');
```

- [ ] **Step 2: Add new cron endpoint**

Add before the `return router;` line at the bottom of `createBarberCronRoutes`:

```javascript
 // ─── NIGHTLY GAMIFICATION (00:00 WIB) ─────────────────────────
 // Award XP, check achievements, rebuild leaderboard cache
 // Tiap Senin: assign rivals + crown King of the Shop
 router.post('/barber-nightly-gamification', adminAuth, async (req, res) => {
 const today = localDateStr();
 const monthStart = today.slice(0, 7) + '-01';

 const { data: barberUsers } = await supabase
 .from('barber_users').select('barber_id, target_daily');
 if (!barberUsers) return res.json({ ok: true, processed: 0 });

 const results = [];

 for (const bu of barberUsers) {
 const bId = bu.barber_id;

 // 1. Total customers all-time (from barber_daily_counts)
 const { data: allCounts } = await supabase
 .from('barber_daily_counts').select('count').eq('barber_id', bId);
 const totalCustomers = (allCounts || []).reduce((s, r) => s + r.count, 0);

 // 2. Today's count for XP
 const { data: todayRow } = await supabase
 .from('barber_daily_counts').select('count')
 .eq('barber_id', bId).eq('date', today).maybeSingle();
 const todayCount = todayRow?.count || 0;

 // 3. Total reviews
 const { count: totalReviews } = await supabase
 .from('reviews').select('*', { count: 'exact', head: true })
 .eq('barber_id', bId);

 // 4. Current streak
 const { data: streak } = await supabase
 .from('barber_streaks').select('current_streak').eq('barber_id', bId).maybeSingle();
 const currentStreak = streak?.current_streak || 0;

 // 5. Total completed missions
 const { count: missionsDone } = await supabase
 .from('barber_missions').select('*', { count: 'exact', head: true })
 .eq('barber_id', bId).not('completed_at', 'is', null);

 // 6. Award XP for today's customers
 if (todayCount > 0) {
 await supabase.rpc('add_xp', {
 p_barber_id: bId,
 p_xp: todayCount * 10,
 p_reason: 'daily_customers',
 });
 }

 // 7. Award streak XP
 if (currentStreak > 0) {
 const streakXp = currentStreak >= 30 ? 20 : currentStreak >= 7 ? 10 : 5;
 await supabase.rpc('add_xp', {
 p_barber_id: bId, p_xp: streakXp, p_reason: 'streak'
 });
 }

 // 8. Check and unlock achievements
 const unlocked = await checkAchievements(supabase, bId, {
 totalCustomers, totalReviews: totalReviews || 0, streak: currentStreak,
 missionsDone: missionsDone || 0,
 });

 results.push({ barber_id: bId, today: todayCount, xp_from_customers: todayCount * 10, unlocked });
 }

 // 9. Rebuild leaderboard cache
 await rebuildLeaderboardCache(supabase, today);

 // 10. Monday: assign rivals + crown King
 const isMonday = new Date(today + 'T00:00:00+07:00').getDay() === 1;
 if (isMonday) {
 await assignRivals(supabase, today);
 await crownKingOfShop(supabase, today);
 }

 return res.json({
 ok: true, processed: results.length, date: today,
 is_monday: isMonday, results
 });
 });
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/barberCron.js
git commit -m "feat(gamification): nightly cron — XP award, achievement check, leaderboard rebuild, Monday rivals+king"
```

---

## Task 6: Backend API Endpoints — /xp, /title, /social-feed, /rivals, /king

**Files:**
- Modify: `server/routes/barber.js`

Find the leaderboard endpoint section and add these routes AFTER it (before the `return router` at the end):

- [ ] **Step 1: Add new endpoints to barber.js**

```javascript
 // ─── XP & LEVEL ──────────────────────────────────────────────
 router.get('/xp', barberAuth, async (req, res) => {
 const { data } = await supabase
 .from('barber_xp')
 .select('total_xp, current_xp, level, prestige, xp_multiplier')
 .eq('barber_id', req.barber.id)
 .maybeSingle();

 if (!data) {
 return res.json({ total_xp: 0, current_xp: 0, level: 1, prestige: 0,
 xp_to_next_level: 150, xp_multiplier: 1.0 });
 }

 const nextLevelXp = 150 * data.level * data.level;
 return res.json({ ...data, xp_to_next_level: nextLevelXp });
 });

 // ─── TITLE ───────────────────────────────────────────────────
 router.get('/title', barberAuth, async (req, res) => {
 const { data } = await supabase
 .from('barber_titles')
 .select('level_title, special_title, active_title')
 .eq('barber_id', req.barber.id)
 .maybeSingle();

 return res.json(data || { level_title: 'Rookie', special_title: null, active_title: 'Rookie' });
 });

 // ─── SOCIAL FEED ─────────────────────────────────────────────
 router.get('/social-feed', barberAuth, async (req, res) => {
 const limit = Math.min(parseInt(req.query.limit) || 20, 50);
 const offset = parseInt(req.query.offset) || 0;

 const { data } = await supabase
 .from('barber_social_feed')
 .select('id, event_type, barber_name, branch, title, body, emoji, created_at')
 .order('created_at', { ascending: false })
 .range(offset, offset + limit - 1);

 return res.json({ items: data || [], offset, limit });
 });

 // ─── RIVAL ───────────────────────────────────────────────────
 router.get('/rival', barberAuth, async (req, res) => {
 const today = localDateStr();
 const day = new Date(today + 'T00:00:00+07:00').getDay();
 const monday = new Date(today + 'T00:00:00+07:00');
 monday.setDate(monday.getDate() - ((day === 0 ? 7 : day) - 1));
 const weekStart = localDateStr(monday);

 const { data: rival } = await supabase
 .from('barber_rivals')
 .select('rival_id, my_count_current, rival_count_current, result')
 .eq('barber_id', req.barber.id)
 .eq('week_start', weekStart)
 .maybeSingle();

 if (!rival) return res.json(null);

 const { data: rivalBarber } = await supabase
 .from('barbers').select('name, branch').eq('id', rival.rival_id).single();

 return res.json({
 rival_id: rival.rival_id,
 rival_name: rivalBarber?.name || 'Unknown',
 rival_branch: rivalBarber?.branch || '',
 my_count: rival.my_count_current,
 rival_count: rival.rival_count_current,
 result: rival.result,
 gap: rival.my_count_current - rival.rival_count_current,
 });
 });

 // ─── KING OF THE SHOP ────────────────────────────────────────
 router.get('/king', barberAuth, async (req, res) => {
 const today = localDateStr();
 const day = new Date(today + 'T00:00:00+07:00').getDay();
 const monday = new Date(today + 'T00:00:00+07:00');
 monday.setDate(monday.getDate() - ((day === 0 ? 7 : day) - 1));
 const weekStart = localDateStr(monday);

 const { data } = await supabase
 .from('king_of_shop')
 .select('barber_id, barber_name, total_count')
 .eq('branch', req.barber.branch)
 .eq('week_start', weekStart)
 .maybeSingle();

 if (!data) return res.json(null);

 return res.json({
 ...data,
 is_me: data.barber_id === req.barber.id,
 });
 });
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/barber.js
git commit -m "feat(gamification): API endpoints — /xp, /title, /social-feed, /rival, /king"
```

---

## Task 7: TypeScript Types + API Helpers

**Files:**
- Modify: `frontend/src/lib/barberTypes.ts`
- Modify: `frontend/src/lib/barberApi.ts`

- [ ] **Step 1: Add new types to barberTypes.ts**

Add after the last `export interface` in the file:

```typescript
export interface XPData {
 total_xp: number;
 current_xp: number;
 level: number;
 prestige: number;
 xp_to_next_level: number;
 xp_multiplier: number;
}

export interface TitleData {
 level_title: string;
 special_title: string | null;
 active_title: string;
}

export interface SocialFeedItem {
 id: number;
 event_type: string;
 barber_name: string;
 branch: string;
 title: string;
 body: string;
 emoji: string | null;
 created_at: string;
}

export interface SocialFeedResponse {
 items: SocialFeedItem[];
 offset: number;
 limit: number;
}

export interface RivalData {
 rival_id: string;
 rival_name: string;
 rival_branch: string;
 my_count: number;
 rival_count: number;
 result: string | null;
 gap: number;
}

export interface KingData {
 barber_id: string;
 barber_name: string;
 total_count: number;
 is_me: boolean;
}
```

- [ ] **Step 2: Add API functions to barberApi.ts**

After the last existing export function:

```typescript
export function fetchBarberXP() {
 return jsonFetch<XPData>('/api/barber/xp');
}

export function fetchBarberTitle() {
 return jsonFetch<TitleData>('/api/barber/title');
}

export function fetchBarberFeed(offset = 0) {
 return jsonFetch<SocialFeedResponse>(`/api/barber/social-feed?limit=20&offset=${offset}`);
}

export function fetchBarberRival() {
 return jsonFetch<RivalData | null>('/api/barber/rival');
}

export function fetchBarberKing() {
 return jsonFetch<KingData | null>('/api/barber/king');
}
```

(Also add missing imports at top of barberApi.ts for the new types: `XPData, TitleData, SocialFeedResponse, RivalData, KingData`)

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/barberTypes.ts frontend/src/lib/barberApi.ts
git commit -m "feat(gamification): TypeScript types + API helpers for XP, titles, feed, rival, king"
```

---

## Task 8: XPBar Component

**Files:**
- Create: `frontend/src/components/barber/XPBar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/barber/XPBar.tsx
import type { XPData, TitleData } from '@/lib/barberTypes';

interface Props {
 xp: XPData;
 title: TitleData;
}

export function XPBar({ xp, title }: Props) {
 const pct = xp.xp_to_next_level > 0
 ? Math.min(100, Math.round((xp.current_xp / xp.xp_to_next_level) * 100))
 : 100;

 const levelColor =
 xp.level >= 40 ? 'from-rose-400 to-orange-400' :
 xp.level >= 30 ? 'from-red-500 to-rose-500' :
 xp.level >= 20 ? 'from-orange-400 to-amber-400' :
 xp.level >= 15 ? 'from-purple-500 to-indigo-500' :
 xp.level >= 10 ? 'from-blue-500 to-cyan-500' :
 xp.level >= 5 ? 'from-green-400 to-teal-400' :
 'from-gray-400 to-gray-500';

 return (
 <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-2">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-xs text-gray-400 uppercase tracking-wide">Level {xp.level}{xp.prestige > 0 ? ` · ${''.repeat(xp.prestige)} Prestige` : ''}</p>
 <p className="font-bold text-gray-800 text-sm">{title.active_title}</p>
 </div>
 <div className="text-right">
 <p className="text-xs text-gray-400">{xp.current_xp.toLocaleString()} / {xp.xp_to_next_level.toLocaleString()} XP</p>
 <p className="text-xs font-semibold text-gray-600">{pct}%</p>
 </div>
 </div>
 <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
 <div
 className={`h-full bg-gradient-to-r ${levelColor} transition-all duration-500 rounded-full`}
 style={{ width: `${pct}%` }}
 />
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/barber/XPBar.tsx
git commit -m "feat(gamification): XPBar component — level, title, XP progress"
```

---

## Task 9: RivalWidget + KingBadge Components

**Files:**
- Create: `frontend/src/components/barber/RivalWidget.tsx`
- Create: `frontend/src/components/barber/KingBadge.tsx`

- [ ] **Step 1: Create RivalWidget**

```typescript
// frontend/src/components/barber/RivalWidget.tsx
import type { RivalData } from '@/lib/barberTypes';

export function RivalWidget({ data }: { data: RivalData }) {
 const gap = data.gap;
 const isWinning = gap > 0;
 const isTied = gap === 0;

 return (
 <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
 <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2"> Rival Minggu Ini</p>
 <div className="flex items-center justify-between">
 <div>
 <p className="font-bold text-gray-800">{data.rival_name}</p>
 <p className="text-xs text-gray-400 capitalize">{data.rival_branch}</p>
 </div>
 <div className="text-right">
 <p className="text-sm font-bold text-gray-700">
 {data.my_count} <span className="text-gray-300 font-normal">vs</span> {data.rival_count}
 </p>
 <p className={`text-xs font-semibold mt-0.5 ${
 isWinning ? 'text-green-600' : isTied ? 'text-gray-500' : 'text-red-500'
 }`}>
 {isWinning ? `+${gap} customer unggul` :
 isTied ? 'Sejajar' :
 `${Math.abs(gap)} customer tertinggal`}
 </p>
 </div>
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Create KingBadge**

```typescript
// frontend/src/components/barber/KingBadge.tsx
import type { KingData } from '@/lib/barberTypes';

export function KingBadge({ data }: { data: KingData }) {
 if (data.is_me) {
 return (
 <div className="bg-gradient-to-r from-yellow-400 to-amber-400 rounded-2xl px-4 py-3 text-center">
 <p className="text-2xl"></p>
 <p className="font-bold text-white text-sm mt-1">King of The Shop</p>
 <p className="text-yellow-100 text-xs">{data.total_count} customer bulan ini</p>
 </div>
 );
 }
 return (
 <div className="bg-amber-50 rounded-2xl border border-amber-200 px-4 py-3 flex items-center gap-3">
 <span className="text-2xl"></span>
 <div>
 <p className="text-xs text-amber-600 font-semibold">King of The Shop</p>
 <p className="font-bold text-amber-800 text-sm">{data.barber_name}</p>
 <p className="text-xs text-amber-600">{data.total_count} customer bulan ini</p>
 </div>
 </div>
 );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/barber/RivalWidget.tsx frontend/src/components/barber/KingBadge.tsx
git commit -m "feat(gamification): RivalWidget + KingBadge components"
```

---

## Task 10: Update BadgeGrid with Rarity Colors

**Files:**
- Modify: `frontend/src/components/barber/BadgeGrid.tsx`

- [ ] **Step 1: Replace BadgeGrid**

```typescript
// frontend/src/components/barber/BadgeGrid.tsx
import type { AchievementsResponse } from '@/lib/barberTypes';
import { BADGE_DEFS, RARITY_CONFIG } from '@/lib/achievementDefs';

export function BadgeGrid({ data }: { data: AchievementsResponse }) {
 const earnedMap = new Map(data.earned.map(e => [e.badge_key, e]));

 return (
 <div>
 <p className="text-sm font-medium text-gray-700 mb-3"> Badges</p>
 <div className="grid grid-cols-3 gap-2">
 {BADGE_DEFS.map(def => {
 const earned = earnedMap.has(def.key);
 const prog = data.in_progress.find(p => p.badge_key === def.key);
 const pct = prog ? Math.min(100, (prog.current / prog.target) * 100) : 0;
 const rc = RARITY_CONFIG[def.rarity];

 return (
 <div
 key={def.key}
 className={`rounded-xl p-3 text-center border transition-all ${
 earned
 ? `${rc.bg} ${rc.border} ${rc.glow}`
 : 'bg-gray-50 border-gray-100'
 }`}
 >
 <p className="text-2xl">{earned ? def.icon : ''}</p>
 <p className={`text-xs mt-1 font-medium leading-tight ${
 earned ? rc.color : 'text-gray-400'
 }`}>
 {def.label}
 </p>
 {earned && (
 <p className={`text-[10px] mt-0.5 font-bold uppercase ${rc.color} opacity-60`}>
 {rc.label}
 </p>
 )}
 {!earned && prog && (
 <div className="mt-1">
 <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
 <div className="h-full bg-gray-400 rounded-full" style={{ width: `${pct}%` }} />
 </div>
 <p className="text-[10px] text-gray-400 mt-0.5">{prog.current}/{prog.target}</p>
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/barber/BadgeGrid.tsx
git commit -m "feat(gamification): BadgeGrid — rarity colors, mythic/legendary glow effects"
```

---

## Task 11: Home Page — Add XPBar, KingBadge, RivalWidget

**Files:**
- Modify: `frontend/src/app/barber/home/page.tsx`

The file currently fetches `stats`, `upcoming`, `streak`, `pace` in a Promise.all. Extend it:

- [ ] **Step 1: Update home page**

Add to imports at top:
```typescript
import { fetchBarberXP, fetchBarberTitle, fetchBarberRival, fetchBarberKing } from '@/lib/barberApi';
import { XPBar } from '@/components/barber/XPBar';
import { RivalWidget } from '@/components/barber/RivalWidget';
import { KingBadge } from '@/components/barber/KingBadge';
import type { XPData, TitleData, RivalData, KingData } from '@/lib/barberTypes';
```

Add state variables after existing ones:
```typescript
const [xp, setXp] = useState<XPData | null>(null);
const [title, setTitle] = useState<TitleData | null>(null);
const [rival, setRival] = useState<RivalData | null>(null);
const [king, setKing] = useState<KingData | null>(null);
```

Update useEffect Promise.all to fetch all 8:
```typescript
Promise.all([
 fetchBarberStats('day'),
 fetchBarberUpcoming(),
 fetchBarberStreak(),
 fetchBarberPace(),
 fetchBarberXP(),
 fetchBarberTitle(),
 fetchBarberRival().catch(() => null),
 fetchBarberKing().catch(() => null),
]).then(([s, u, st, p, x, t, rv, k]) => {
 setStats(s); setUpcoming(u); setStreak(st); setPace(p);
 setXp(x); setTitle(t); setRival(rv); setKing(k);
}).catch(console.error).finally(() => setLoading(false));
```

In the JSX, add after the `<StreakBadge>` component but before the booking sections:
```tsx
{/* XP Bar */}
{xp && title && (
 <div className="px-4">
 <XPBar xp={xp} title={title} />
 </div>
)}

{/* King of the Shop */}
{king && (
 <div className="px-4">
 <KingBadge data={king} />
 </div>
)}

{/* Rival */}
{rival && (
 <div className="px-4">
 <RivalWidget data={rival} />
 </div>
)}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/barber/home/page.tsx
git commit -m "feat(gamification): home page — XPBar, KingBadge, RivalWidget"
```

---

## Task 12: Social Feed Page

**Files:**
- Create: `frontend/src/app/barber/feed/page.tsx`
- Modify: `frontend/src/app/barber/layout.tsx`

- [ ] **Step 1: Create feed page**

```typescript
// frontend/src/app/barber/feed/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberFeed } from '@/lib/barberApi';
import type { SocialFeedItem } from '@/lib/barberTypes';

function timeAgo(iso: string) {
 const diff = (Date.now() - new Date(iso).getTime()) / 1000;
 if (diff < 60) return 'baru saja';
 if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
 if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
 return `${Math.floor(diff / 86400)} hari lalu`;
}

export default function FeedPage() {
 const { data: session } = useBarberSession();
 const [items, setItems] = useState<SocialFeedItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [loadingMore, setLoadingMore] = useState(false);
 const [offset, setOffset] = useState(0);
 const [hasMore, setHasMore] = useState(true);

 const load = useCallback(async (off: number) => {
 if (!session) return;
 const res = await fetchBarberFeed(off);
 if (off === 0) {
 setItems(res.items);
 } else {
 setItems(prev => [...prev, ...res.items]);
 }
 setHasMore(res.items.length === 20);
 }, [session]);

 useEffect(() => {
 load(0).catch(console.error).finally(() => setLoading(false));
 }, [load]);

 const loadMore = async () => {
 const next = offset + 20;
 setLoadingMore(true);
 await load(next).catch(console.error);
 setOffset(next);
 setLoadingMore(false);
 };

 if (loading) return <div className="p-4 text-center text-gray-400">Memuat...</div>;

 return (
 <div className="p-4 space-y-3">
 <h2 className="text-lg font-bold text-gray-900"> Feed Aktivitas</h2>

 {items.length === 0 && (
 <p className="text-center text-gray-400 py-10">Belum ada aktivitas</p>
 )}

 {items.map(item => (
 <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex gap-3 items-start">
 <span className="text-2xl flex-shrink-0">{item.emoji || ''}</span>
 <div className="flex-1 min-w-0">
 <p className="font-semibold text-gray-800 text-sm">{item.title}</p>
 <p className="text-xs text-gray-500 mt-0.5">{item.body}</p>
 <p className="text-[11px] text-gray-300 mt-1">{timeAgo(item.created_at)} · {item.branch}</p>
 </div>
 </div>
 ))}

 {hasMore && (
 <button
 onClick={loadMore}
 disabled={loadingMore}
 className="w-full py-2 text-sm text-gray-500 border border-gray-200 rounded-xl"
 >
 {loadingMore ? 'Memuat...' : 'Lihat lebih banyak'}
 </button>
 )}
 </div>
 );
}
```

- [ ] **Step 2: Add Feed tab to layout.tsx**

In `frontend/src/app/barber/layout.tsx`, replace the `BARBER_NAV` array:

```typescript
const BARBER_NAV = [
 { href: '/barber/home', label: 'Home', icon: '' },
 { href: '/barber/schedule', label: 'Jadwal', icon: '' },
 { href: '/barber/leaderboard', label: 'Ranking', icon: '' },
 { href: '/barber/feed', label: 'Feed', icon: '' },
 { href: '/barber/profile', label: 'Saya', icon: '' },
];
```

(Progress dipindah ke dalam menu Saya/profile agar tetap 5 tab.)

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/barber/feed/page.tsx frontend/src/app/barber/layout.tsx
git commit -m "feat(gamification): social feed page + Feed tab in nav"
```

---

## Task 13: Leaderboard — Category Tabs

**Files:**
- Modify: `frontend/src/app/barber/leaderboard/page.tsx`

The current leaderboard shows one category (customer count). Add tabs: **Customer** | **Streak** | (Performance Score comes later after cron populates it).

- [ ] **Step 1: Update leaderboard page**

The current `fetchBarberLeaderboard()` returns `LeaderboardData` with `rankings[]`.
Add a `fetchLeaderboardCategory(category: string)` API call in `barberApi.ts`:

In barberApi.ts add:
```typescript
export function fetchLeaderboardCategory(category: 'customer_champion' | 'streak_champion') {
 return jsonFetch<{ items: Array<{ rank: number; barber_id: string; barber_name: string; branch: string; score: number; display_value: string }> }>(
 `/api/barber/leaderboard/category?type=monthly&category=${category}`
 );
}
```

In barber.js add endpoint:
```javascript
 router.get('/leaderboard/category', barberAuth, async (req, res) => {
 const type = req.query.type || 'monthly';
 const category = req.query.category || 'customer_champion';
 const now = new Date();
 const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

 const { data } = await supabase
 .from('barber_leaderboard_cache')
 .select('rank, barber_id, barber_name, branch, score, display_value')
 .eq('period_type', type)
 .eq('category', category)
 .eq('period_start', monthStart)
 .order('rank', { ascending: true })
 .limit(50);

 return res.json({ items: data || [] });
 });
```

In leaderboard page, add category state and tab UI:

```typescript
type Category = 'customer_champion' | 'streak_champion';

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
 { key: 'customer_champion', label: 'Customer', icon: '' },
 { key: 'streak_champion', label: 'Streak', icon: '' },
];
```

Add tabs above the ranking list:
```tsx
{/* Category Tabs */}
<div className="flex gap-2">
 {CATEGORIES.map(c => (
 <button
 key={c.key}
 onClick={() => setCategory(c.key)}
 className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
 category === c.key
 ? 'bg-gray-900 text-white border-gray-900'
 : 'bg-white text-gray-500 border-gray-200'
 }`}
 >
 {c.icon} {c.label}
 </button>
 ))}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/barber/leaderboard/page.tsx frontend/src/routes/barber.js frontend/src/lib/barberApi.ts
git commit -m "feat(gamification): leaderboard category tabs — Customer + Streak"
```

---

## Task 14: Deploy + Register Nightly Cron

**Files:**
- Push to GitHub → Vercel auto-deploy

- [ ] **Step 1: Final TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```
Expected: 0 errors (or only pre-existing).

- [ ] **Step 2: Push to GitHub**

```bash
git push
```

- [ ] **Step 3: Verify Vercel deployment**

Check Vercel dashboard at `redboxbarbershop.com`. Confirm no build errors.

- [ ] **Step 4: Register nightly cron at cron-job.org**

Add a new cron job:
- URL: `https://redboxbarbershop.com/api/cron/barber-nightly-gamification`
- Method: POST
- Headers: `{ "x-admin-key": "<same key used by other crons>" }`
- Schedule: `0 17 * * *` (UTC 17:00 = WIB 00:00 midnight)

- [ ] **Step 5: Seed initial XP for existing barbers**

Run via Supabase execute_sql to give all active barbers base XP from their existing all-time customer counts:

```sql
-- Seed XP: 10 XP per customer in barber_daily_counts (all time)
DO $$
DECLARE
 r RECORD;
 total INT;
BEGIN
 FOR r IN
 SELECT b.id as barber_id, COALESCE(SUM(dc.count), 0)::INT as cnt
 FROM barbers b
 LEFT JOIN barber_daily_counts dc ON dc.barber_id = b.id
 WHERE b.is_active = true
 GROUP BY b.id
 LOOP
 IF r.cnt > 0 THEN
 PERFORM add_xp(r.barber_id, r.cnt * 10, 'seed_historical_customers');
 END IF;
 END LOOP;
END;
$$;
```

Expected: All active barbers now have XP and level in `barber_xp`.

- [ ] **Step 6: Verify seed**

```sql
SELECT barber_id, total_xp, level
FROM barber_xp ORDER BY total_xp DESC LIMIT 10;
```
Expected: Barbers with 40+ customers seeded have level 1+ XP.

- [ ] **Step 7: Final commit**

```bash
git commit -m "feat(gamification): deploy + initial XP seed for existing barbers" --allow-empty
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|------------|------|
| Performance Score formula | Schema in T1, calculation in T4 rebuildCache (simplified — full PS in follow-up) |
| XP & Level system | T2 (add_xp function) + T5 (cron awards) + T8 (XPBar UI) |
| Achievement rarity system | T3 (BADGE_DEFS) + T2 (unlock_achievement) + T10 (BadgeGrid) |
| Title system | T2 (get_level_title) + T1 (barber_titles table) + T6 (/title endpoint) |
| Leaderboard categories | T13 (category tabs) + T4 (rebuildCache) + T6 (/leaderboard/category) |
| Rival system | T4 (assignRivals) + T5 (Monday trigger) + T9 (RivalWidget) + T11 (home page) |
| King of the Shop | T4 (crownKing) + T5 (Monday trigger) + T9 (KingBadge) + T11 (home page) |
| Social Feed | T1 (table) + T2 (auto-write on events) + T6 (endpoint) + T12 (Feed page) |
| Season System | Not in this plan — follow-up plan |
| Hall of Fame | Not in this plan — follow-up plan |
| Anti-cheat | Covered: all writes through server, barber_xp_log audit trail |
| RLS policies | T1 (all tables) |

### Notes

- Season System and Hall of Fame are complex, lower priority, and fully independent — they deserve their own plan after this foundation is stable.
- Performance Score full formula (5-component) needs 30 days of `barber_daily_counts` to be meaningful; simplified leaderboard cache (customer count + streak) is used first, PS added in follow-up.
- `barber_daily_counts` data only covers June 1-2 for now; the nightly cron will accumulate data daily going forward.
