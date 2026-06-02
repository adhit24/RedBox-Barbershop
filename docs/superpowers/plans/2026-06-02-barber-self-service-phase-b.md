# Barber Self-Service Phase B — Motivation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan sistem motivasi (streak, badges, missions, records, tier, customer favorite, review highlight, pace prediction) ke barber app dan 3 cron jobs untuk notifikasi cerdas — semua di-trigger via cron-job.org.

**Architecture:** Extend existing `server/routes/barber.js` (Phase A) dengan 8 endpoint baru + 3 cron endpoint di `server/routes/barberCron.js`. Hook `onBookingCompleted()` ke existing `/api/booking-status` endpoint (fire-and-forget). Frontend tambah komponen motivasi ke progress page + home page + leaderboard page baru.

**Tech Stack:** Express.js, Supabase (Postgres), Web Push (existing), Next.js 16, Tailwind CSS 4, cron-job.org

**Spec:** `docs/superpowers/specs/2026-06-02-barber-self-service-design.md` sections 7-10

---

## File Map

### Backend (server/)
```
migrations/006_barber_motivation.sql        ← BARU: 4 tabel gamification
services/barberMetrics.js                   ← BARU: onBookingCompleted, checkAchievements, updateRecords, updateMissions
routes/barber.js                            ← MODIFY: tambah 8 endpoint (streak, achievements, records, missions, leaderboard, favorites, reviews, pace)
routes/barberCron.js                        ← BARU: 3 cron endpoints (streak-daily, mission-weekly, reminder-morning)
index.js                                    ← MODIFY: wire barberCron routes + hook onBookingCompleted ke booking-status
```

### Frontend (frontend/src/)
```
lib/
  achievementDefs.ts                        ← BARU: badge labels, icons, thresholds
  barberApi.ts                              ← MODIFY: tambah 8 fetch functions
  barberTypes.ts                            ← MODIFY: tambah interfaces baru

components/barber/
  StreakBadge.tsx                            ← BARU: 🔥 streak counter + longest
  BadgeGrid.tsx                             ← BARU: grid badges earned + in-progress
  MissionList.tsx                           ← BARU: 3 missions + progress bars
  TierIndicator.tsx                         ← BARU: tier badge + next tier info
  ReviewQuoteCard.tsx                       ← BARU: kutipan review 5⭐
  PaceCard.tsx                              ← BARU: pace prediction card
  FavoriteCustomerList.tsx                  ← BARU: repeat customer list

app/barber/
  home/page.tsx                             ← MODIFY: tambah StreakBadge + PaceCard
  progress/page.tsx                         ← MODIFY: tambah semua komponen motivasi
  leaderboard/page.tsx                      ← BARU: tier system per cabang

app/api/barber/
  streak/route.ts                           ← BARU: proxy GET
  achievements/route.ts                     ← BARU: proxy GET
  records/route.ts                          ← BARU: proxy GET
  missions/route.ts                         ← BARU: proxy GET
  leaderboard/route.ts                      ← BARU: proxy GET
  favorites/route.ts                        ← BARU: proxy GET
  reviews/route.ts                          ← BARU: proxy GET
  pace/route.ts                             ← BARU: proxy GET
```

---

## Task 1: Database Migration — Gamification Tables

**Files:**
- Create: `server/migrations/006_barber_motivation.sql`

- [ ] **Step 1: Tulis migration SQL**

```sql
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
```

- [ ] **Step 2: User jalankan di Supabase SQL Editor**

- [ ] **Step 3: Commit**

```bash
git add server/migrations/006_barber_motivation.sql
git commit -m "feat: add gamification tables (achievements, streaks, records, missions)"
```

---

## Task 2: Backend — barberMetrics Service (Core Logic)

**Files:**
- Create: `server/services/barberMetrics.js`

- [ ] **Step 1: Buat file**

```javascript
// server/services/barberMetrics.js
// Core gamification logic — called when booking status → done

const { sendPushToUser } = require('./webPush');

// Badge definitions
const BADGES = {
  hair_cut_master:   { label: '✂️ Hair Cut Master',     serviceMatch: /gunting/i,         threshold: 500 },
  color_expert:      { label: '🎨 Color Expert',        serviceMatch: /color/i,           threshold: 100 },
  home_service_hero: { label: '🏠 Home Service Hero',   typeMatch: 'home_service',        threshold: 25 },
  early_bird:        { label: '🌅 Early Bird',          timeMax: '10:00',                 threshold: 10 },
  night_owl:         { label: '🌙 Night Owl',           timeMin: '20:00',                 threshold: 10 },
  diamond_hand:      { label: '💎 Diamond Hand',        allServices: true,                threshold: 1000 },
  streak_master:     { label: '🔥 Streak Master',       streakBased: true,                threshold: 30 },
};

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Fire-and-forget hook called when a booking status changes to 'done'.
 * Updates: daily count for target check, personal records, mission progress, achievement check.
 */
async function onBookingCompleted(supabase, booking) {
  if (!booking || !booking.barber_id) return;
  const barberId = booking.barber_id;
  const today = localDateStr();

  try {
    // 1. Count bookings done today for this barber
    const { count: todayCount } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('status', 'done')
      .eq('date', today);

    // 2. Get barber target
    const { data: profile } = await supabase
      .from('barber_users')
      .select('target_daily, barber_id')
      .eq('barber_id', barberId)
      .maybeSingle();

    const target = profile?.target_daily || 10;

    // 3. Check if just hit target → push notification
    if (todayCount === target) {
      sendPushNotifToBarber(supabase, barberId, {
        title: '🎉 Target Hari Ini Tercapai!',
        body: `${todayCount}/${target} customer. Mantap! 💪`,
        url: '/barber/home',
      });
    } else if (todayCount >= target - 2 && todayCount < target) {
      sendPushNotifToBarber(supabase, barberId, {
        title: `⚡ Sedikit lagi!`,
        body: `Sisa ${target - todayCount} customer lagi untuk hit target hari ini`,
        url: '/barber/home',
      });
    }

    // 4. Update personal records
    await updateRecords(supabase, barberId, todayCount);

    // 5. Update mission progress
    await updateMissionProgress(supabase, barberId, booking);

    // 6. Check achievements
    await checkAchievements(supabase, barberId);

  } catch (e) {
    console.error('[barberMetrics] onBookingCompleted error:', e.message);
  }
}

async function updateRecords(supabase, barberId, todayCount) {
  const today = localDateStr();

  // Upsert barber_records row if not exists
  const { data: rec } = await supabase
    .from('barber_records')
    .select('*')
    .eq('barber_id', barberId)
    .maybeSingle();

  if (!rec) {
    await supabase.from('barber_records').insert({
      barber_id: barberId,
      best_customer_per_day: todayCount,
      best_customer_per_day_at: today,
    });
    return;
  }

  if (todayCount > (rec.best_customer_per_day || 0)) {
    await supabase.from('barber_records').update({
      best_customer_per_day: todayCount,
      best_customer_per_day_at: today,
    }).eq('barber_id', barberId);

    sendPushNotifToBarber(supabase, barberId, {
      title: '🏆 PERSONAL BEST!',
      body: `Rekor baru: ${todayCount} customer dalam sehari!`,
      url: '/barber/progress',
    });
  }
}

async function updateMissionProgress(supabase, barberId, booking) {
  // Get current week Monday
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day === 0 ? 7 : day) - 1));
  const weekStart = localDateStr(monday);

  // Volume mission: increment progress
  await supabase
    .from('barber_missions')
    .update({ progress: supabase.rpc ? undefined : undefined }) // can't do increment directly
    .eq('barber_id', barberId)
    .eq('week_start', weekStart)
    .eq('mission_key', 'serve_customers');

  // Workaround: fetch + increment manually
  const { data: missions } = await supabase
    .from('barber_missions')
    .select('id, mission_key, progress, target, completed_at')
    .eq('barber_id', barberId)
    .eq('week_start', weekStart);

  if (!missions) return;

  for (const m of missions) {
    if (m.completed_at) continue;

    let newProgress = m.progress;
    if (m.mission_key === 'serve_customers') {
      newProgress = m.progress + 1;
    }
    // quality and consistency missions are updated by cron or separate logic

    if (newProgress !== m.progress) {
      const update = { progress: newProgress };
      if (newProgress >= m.target) {
        update.completed_at = new Date().toISOString();
      }
      await supabase.from('barber_missions').update(update).eq('id', m.id);
    }
  }

  // Check if ALL missions completed → bonus notification
  const allCompleted = missions.every(m => m.completed_at || (m.mission_key === 'serve_customers' && m.progress + 1 >= m.target));
  if (allCompleted && missions.length >= 3) {
    sendPushNotifToBarber(supabase, barberId, {
      title: '🏆 Weekly Champion!',
      body: 'Semua misi minggu ini selesai! Luar biasa!',
      url: '/barber/progress',
    });
  }
}

async function checkAchievements(supabase, barberId) {
  // Get already earned badges
  const { data: earned } = await supabase
    .from('barber_achievements')
    .select('badge_key')
    .eq('barber_id', barberId);
  const earnedKeys = new Set((earned || []).map(a => a.badge_key));

  for (const [key, def] of Object.entries(BADGES)) {
    if (earnedKeys.has(key)) continue;
    if (def.streakBased) continue; // streak_master is checked by cron

    let count = 0;

    if (def.allServices) {
      // Total done bookings
      const { count: c } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', barberId)
        .eq('status', 'done');
      count = c || 0;
    } else if (def.serviceMatch) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .ilike('service', `%${def.serviceMatch.source.replace(/[/\\^$*+?.()|[\]{}]/g, '')}%`);
      count = rows?.length || 0;
    } else if (def.typeMatch) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .like('notes', '%HOME SERVICE%');
      count = rows?.length || 0;
    } else if (def.timeMax) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .lt('time', def.timeMax);
      count = rows?.length || 0;
    } else if (def.timeMin) {
      const { data: rows } = await supabase
        .from('bookings')
        .select('id')
        .eq('barber_id', barberId)
        .eq('status', 'done')
        .gte('time', def.timeMin);
      count = rows?.length || 0;
    }

    if (count >= def.threshold) {
      await supabase.from('barber_achievements').insert({ barber_id: barberId, badge_key: key });
      sendPushNotifToBarber(supabase, barberId, {
        title: `🏅 Badge Baru: ${def.label}`,
        body: `Selamat! Kamu unlock ${def.label}!`,
        url: '/barber/progress',
      });
    }
  }
}

/**
 * Helper: send push notif to barber via barber_users → users mapping.
 * Fire and forget.
 */
function sendPushNotifToBarber(supabase, barberId, payload) {
  supabase
    .from('users')
    .select('id')
    .eq('barber_id', barberId)
    .eq('role', 'barber')
    .maybeSingle()
    .then(({ data }) => {
      if (data?.id) {
        sendPushToUser(supabase, data.id, payload).catch(() => {});
      }
    })
    .catch(() => {});
}

module.exports = { onBookingCompleted, checkAchievements, updateRecords, updateMissionProgress, BADGES, sendPushNotifToBarber };
```

- [ ] **Step 2: Commit**

```bash
git add server/services/barberMetrics.js
git commit -m "feat: barberMetrics service (onBookingCompleted, achievements, records, missions)"
```

---

## Task 3: Backend — Hook onBookingCompleted into booking-status endpoint

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add require at top**

Find the line `const { sendPushToUser, sendPushToBranch } = require('./services/webPush');` and add this line after it:

```javascript
const { onBookingCompleted } = require('./services/barberMetrics');
```

- [ ] **Step 2: Hook into POST /api/booking-status**

Find the `POST /api/booking-status` handler (around line 1241). It currently looks like:

```javascript
app.post('/api/booking-status', adminAuth, async (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase.from('bookings').update({ status }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
```

Replace the Supabase branch (`if (DB_TYPE === 'supabase') { ... }`) so that after the update succeeds and before returning, it fires onBookingCompleted:

```javascript
  if (DB_TYPE === 'supabase') {
    const { data, error } = await supabase.from('bookings').update({ status }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Fire-and-forget: update gamification when booking marked done
    if (status === 'done' && data) {
      onBookingCompleted(supabase, data).catch(e => console.error('[Metrics] onBookingCompleted error:', e.message));
    }
    return res.json({ data });
```

The key change: add the 3 lines with `onBookingCompleted` between the existing `if (error)` check and `return res.json`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: hook onBookingCompleted into booking-status endpoint"
```

---

## Task 4: Backend — 8 New Barber Endpoints (motivation data)

**Files:**
- Modify: `server/routes/barber.js`

- [ ] **Step 1: Add all 8 endpoints before `return router;`**

```javascript
  // ─── STREAK ──────────────────────────────────────────
  router.get('/streak', barberAuth, async (req, res) => {
    const { data } = await supabase
      .from('barber_streaks')
      .select('current_streak, longest_streak, last_hit_date')
      .eq('barber_id', req.barber.id)
      .maybeSingle();
    return res.json(data || { current_streak: 0, longest_streak: 0, last_hit_date: null });
  });

  // ─── ACHIEVEMENTS ────────────────────────────────────
  router.get('/achievements', barberAuth, async (req, res) => {
    const { data: earned } = await supabase
      .from('barber_achievements')
      .select('badge_key, earned_at')
      .eq('barber_id', req.barber.id)
      .order('earned_at', { ascending: false });

    // Calculate progress for unearned badges
    const { BADGES } = require('../services/barberMetrics');
    const earnedKeys = new Set((earned || []).map(a => a.badge_key));
    const inProgress = [];

    for (const [key, def] of Object.entries(BADGES)) {
      if (earnedKeys.has(key) || def.streakBased) continue;

      let count = 0;
      if (def.allServices) {
        const { count: c } = await supabase
          .from('bookings').select('*', { count: 'exact', head: true })
          .eq('barber_id', req.barber.id).eq('status', 'done');
        count = c || 0;
      } else if (def.serviceMatch) {
        const pattern = def.serviceMatch.source.replace(/[/\\^$*+?.()|[\]{}]/g, '');
        const { data: rows } = await supabase
          .from('bookings').select('id')
          .eq('barber_id', req.barber.id).eq('status', 'done')
          .ilike('service', `%${pattern}%`);
        count = rows?.length || 0;
      } else if (def.typeMatch) {
        const { data: rows } = await supabase
          .from('bookings').select('id')
          .eq('barber_id', req.barber.id).eq('status', 'done')
          .like('notes', '%HOME SERVICE%');
        count = rows?.length || 0;
      } else if (def.timeMax) {
        const { data: rows } = await supabase
          .from('bookings').select('id')
          .eq('barber_id', req.barber.id).eq('status', 'done')
          .lt('time', def.timeMax);
        count = rows?.length || 0;
      } else if (def.timeMin) {
        const { data: rows } = await supabase
          .from('bookings').select('id')
          .eq('barber_id', req.barber.id).eq('status', 'done')
          .gte('time', def.timeMin);
        count = rows?.length || 0;
      }

      inProgress.push({ badge_key: key, label: def.label, current: count, target: def.threshold });
    }

    // Add streak_master progress from barber_streaks
    if (!earnedKeys.has('streak_master')) {
      const { data: streak } = await supabase
        .from('barber_streaks').select('longest_streak')
        .eq('barber_id', req.barber.id).maybeSingle();
      inProgress.push({
        badge_key: 'streak_master',
        label: '🔥 Streak Master',
        current: streak?.longest_streak || 0,
        target: 30,
      });
    }

    return res.json({ earned: earned || [], in_progress: inProgress });
  });

  // ─── RECORDS ─────────────────────────────────────────
  router.get('/records', barberAuth, async (req, res) => {
    const { data } = await supabase
      .from('barber_records')
      .select('*')
      .eq('barber_id', req.barber.id)
      .maybeSingle();
    return res.json(data || {
      best_customer_per_day: 0, best_customer_per_day_at: null,
      best_revenue_per_month: 0, best_revenue_per_month_at: null,
      best_rating_per_month: 0, best_rating_per_month_at: null,
      longest_streak_at: null,
    });
  });

  // ─── MISSIONS ────────────────────────────────────────
  router.get('/missions', barberAuth, async (req, res) => {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day === 0 ? 7 : day) - 1));
    const weekStart = localDateStr(monday);

    const { data } = await supabase
      .from('barber_missions')
      .select('mission_key, target, progress, completed_at')
      .eq('barber_id', req.barber.id)
      .eq('week_start', weekStart)
      .order('mission_key');

    return res.json({ week_start: weekStart, missions: data || [] });
  });

  // ─── LEADERBOARD ─────────────────────────────────────
  router.get('/leaderboard', barberAuth, async (req, res) => {
    const branch = req.barber.branch;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const today = localDateStr(now);

    // Get all barbers in this branch with their done count this month
    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name')
      .eq('branch', branch)
      .eq('is_active', true);

    if (!barbers || barbers.length === 0) {
      return res.json({ tier: 'RISING', position_pct: 100, next_tier_needed: 0, barber_count: 0 });
    }

    const counts = [];
    for (const b of barbers) {
      const { count } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', b.id)
        .eq('status', 'done')
        .gte('date', monthStart)
        .lte('date', today);
      counts.push({ barber_id: b.id, name: b.name, count: count || 0 });
    }

    counts.sort((a, b) => b.count - a.count);
    const total = counts.length;
    const myIdx = counts.findIndex(c => c.barber_id === req.barber.id);
    const myCount = myIdx >= 0 ? counts[myIdx].count : 0;
    const positionPct = total > 0 ? Math.round(((myIdx + 1) / total) * 100) : 100;

    let tier = 'RISING';
    let nextTierNeeded = 0;
    if (positionPct <= 10) {
      tier = 'LEGEND';
      nextTierNeeded = 0;
    } else if (positionPct <= 30) {
      tier = 'ELITE';
      const legendThreshold = counts[Math.max(0, Math.floor(total * 0.1) - 1)]?.count || 0;
      nextTierNeeded = Math.max(0, legendThreshold - myCount + 1);
    } else if (positionPct <= 70) {
      tier = 'ADVANCED';
      const eliteThreshold = counts[Math.max(0, Math.floor(total * 0.3) - 1)]?.count || 0;
      nextTierNeeded = Math.max(0, eliteThreshold - myCount + 1);
    } else {
      const advThreshold = counts[Math.max(0, Math.floor(total * 0.7) - 1)]?.count || 0;
      nextTierNeeded = Math.max(0, advThreshold - myCount + 1);
    }

    return res.json({
      tier,
      position_pct: positionPct,
      next_tier_needed: nextTierNeeded,
      my_count: myCount,
      barber_count: total,
      month: monthStart,
    });
  });

  // ─── FAVORITES ───────────────────────────────────────
  router.get('/favorites', barberAuth, async (req, res) => {
    const { data } = await supabase.rpc('get_barber_favorites', { p_barber_id: req.barber.id });
    // Fallback if RPC doesn't exist: raw query
    if (!data) {
      const { data: rows } = await supabase
        .from('booking_full')
        .select('name, service')
        .eq('barber_id', req.barber.id)
        .eq('status', 'done')
        .order('date', { ascending: false })
        .limit(500);

      const map = {};
      for (const r of (rows || [])) {
        const key = r.name || 'Unknown';
        if (!map[key]) map[key] = { name: key, visits: 0, service: r.service };
        map[key].visits++;
      }
      const favorites = Object.values(map)
        .filter(f => f.visits >= 3)
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 5);
      return res.json({ favorites });
    }
    return res.json({ favorites: data });
  });

  // ─── REVIEWS ─────────────────────────────────────────
  router.get('/reviews', barberAuth, async (req, res) => {
    let reviews = [];
    try {
      const { data } = await supabase
        .from('reviews')
        .select('rating, review_text, customer_name, created_at')
        .eq('barber_id', req.barber.id)
        .eq('rating', 5)
        .order('created_at', { ascending: false })
        .limit(5);
      reviews = data || [];
    } catch { /* reviews table optional */ }
    return res.json({ reviews });
  });

  // ─── PACE PREDICTION ────────────────────────────────
  router.get('/pace', barberAuth, async (req, res) => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - dayOfMonth;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const today = localDateStr(now);

    const { count } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', req.barber.id)
      .eq('status', 'done')
      .gte('date', monthStart)
      .lte('date', today);

    const currentCount = count || 0;
    const { data: profile } = await supabase
      .from('barber_users')
      .select('target_monthly')
      .eq('barber_id', req.barber.id)
      .maybeSingle();

    const targetMonthly = profile?.target_monthly || 250;
    const currentPace = dayOfMonth > 0 ? currentCount / dayOfMonth : 0;
    const predictedEnd = Math.round(currentCount + (currentPace * daysRemaining));
    const neededPerDay = daysRemaining > 0 ? Math.ceil((targetMonthly - currentCount) / daysRemaining) : 0;
    const onTrack = predictedEnd >= targetMonthly;

    return res.json({
      current_count: currentCount,
      target_monthly: targetMonthly,
      days_passed: dayOfMonth,
      days_remaining: daysRemaining,
      current_pace: Math.round(currentPace * 10) / 10,
      predicted_end: predictedEnd,
      needed_per_day: neededPerDay,
      on_track: onTrack,
    });
  });
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/barber.js
git commit -m "feat: 8 motivation endpoints (streak, achievements, records, missions, leaderboard, favorites, reviews, pace)"
```

---

## Task 5: Backend — Cron Routes (streak-daily, mission-weekly, reminder-morning)

**Files:**
- Create: `server/routes/barberCron.js`
- Modify: `server/index.js` — wire cron routes

- [ ] **Step 1: Buat file cron routes**

```javascript
// server/routes/barberCron.js
const express = require('express');
const { sendPushNotifToBarber } = require('../services/barberMetrics');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function createBarberCronRoutes(supabase, adminAuth) {
  const router = express.Router();

  // ─── STREAK DAILY (23:55 WIB) ───────────────────────
  router.post('/barber-streak-daily', adminAuth, async (req, res) => {
    const today = localDateStr();
    const { data: barberUsers } = await supabase
      .from('barber_users')
      .select('barber_id, target_daily');

    if (!barberUsers) return res.json({ ok: true, processed: 0 });

    let processed = 0;
    for (const bu of barberUsers) {
      const target = bu.target_daily || 10;

      const { count } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', bu.barber_id)
        .eq('status', 'done')
        .eq('date', today);

      const hitTarget = (count || 0) >= target;

      // Get or create streak row
      let { data: streak } = await supabase
        .from('barber_streaks')
        .select('*')
        .eq('barber_id', bu.barber_id)
        .maybeSingle();

      if (!streak) {
        await supabase.from('barber_streaks').insert({
          barber_id: bu.barber_id,
          current_streak: 0,
          longest_streak: 0,
          last_hit_date: null,
        });
        streak = { current_streak: 0, longest_streak: 0, last_hit_date: null };
      }

      const oldStreak = streak.current_streak;

      if (hitTarget) {
        const newStreak = streak.current_streak + 1;
        const newLongest = Math.max(newStreak, streak.longest_streak);
        await supabase.from('barber_streaks').update({
          current_streak: newStreak,
          longest_streak: newLongest,
          last_hit_date: today,
        }).eq('barber_id', bu.barber_id);

        // Update longest_streak_at in records
        if (newStreak > streak.longest_streak) {
          await supabase.from('barber_records').upsert({
            barber_id: bu.barber_id,
            longest_streak_at: today,
          }, { onConflict: 'barber_id' });
        }

        // Check streak_master badge
        if (newLongest >= 30) {
          const { data: exists } = await supabase
            .from('barber_achievements')
            .select('id')
            .eq('barber_id', bu.barber_id)
            .eq('badge_key', 'streak_master')
            .maybeSingle();
          if (!exists) {
            await supabase.from('barber_achievements').insert({
              barber_id: bu.barber_id,
              badge_key: 'streak_master',
            });
            sendPushNotifToBarber(supabase, bu.barber_id, {
              title: '🏅 Badge Baru: 🔥 Streak Master',
              body: '30 hari berturut-turut hit target! Luar biasa!',
              url: '/barber/progress',
            });
          }
        }

        sendPushNotifToBarber(supabase, bu.barber_id, {
          title: `🔥 Streak ${newStreak} hari!`,
          body: `Target tercapai: ${count}/${target} customer. Mantap!`,
          url: '/barber/home',
        });

      } else {
        // Streak broken
        await supabase.from('barber_streaks').update({
          current_streak: 0,
        }).eq('barber_id', bu.barber_id);

        if (oldStreak > 0) {
          sendPushNotifToBarber(supabase, bu.barber_id, {
            title: `Yah, streak ${oldStreak} hari putus`,
            body: 'Mulai lagi besok! Kamu pasti bisa 💪',
            url: '/barber/home',
          });
        }
      }

      processed++;
    }

    return res.json({ ok: true, processed, date: today });
  });

  // ─── MISSION WEEKLY (Senin 06:00 WIB) ───────────────
  router.post('/barber-mission-weekly', adminAuth, async (req, res) => {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day === 0 ? 7 : day) - 1));
    const weekStart = localDateStr(monday);

    // Previous week for avg calculation
    const prevMonday = new Date(monday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const prevWeekStart = localDateStr(prevMonday);
    const prevSunday = new Date(monday);
    prevSunday.setDate(prevSunday.getDate() - 1);
    const prevWeekEnd = localDateStr(prevSunday);

    const { data: barberUsers } = await supabase
      .from('barber_users')
      .select('barber_id');

    if (!barberUsers) return res.json({ ok: true, generated: 0 });

    let generated = 0;
    for (const bu of barberUsers) {
      // Check if missions already exist for this week
      const { count: existing } = await supabase
        .from('barber_missions')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', bu.barber_id)
        .eq('week_start', weekStart);

      if (existing > 0) continue;

      // Calculate avg from previous week
      const { count: prevCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', bu.barber_id)
        .eq('status', 'done')
        .gte('date', prevWeekStart)
        .lte('date', prevWeekEnd);

      const volumeTarget = Math.max(30, Math.round((prevCount || 30) * 1.1));

      const missions = [
        { barber_id: bu.barber_id, week_start: weekStart, mission_key: 'serve_customers', target: volumeTarget, progress: 0 },
        { barber_id: bu.barber_id, week_start: weekStart, mission_key: 'get_reviews', target: 10, progress: 0 },
        { barber_id: bu.barber_id, week_start: weekStart, mission_key: 'no_cancel', target: 1, progress: 1 },
      ];

      await supabase.from('barber_missions').insert(missions);

      sendPushNotifToBarber(supabase, bu.barber_id, {
        title: '🎯 Misi Minggu Ini Sudah Siap!',
        body: `Target: ${volumeTarget} customer, 10 review ⭐5, zero cancel`,
        url: '/barber/progress',
      });

      generated++;
    }

    return res.json({ ok: true, generated, week_start: weekStart });
  });

  // ─── REMINDER MORNING (07:00 WIB) ───────────────────
  router.post('/barber-reminder-morning', adminAuth, async (req, res) => {
    const today = localDateStr();

    const { data: barberUsers } = await supabase
      .from('barber_users')
      .select('barber_id, notif_enabled');

    if (!barberUsers) return res.json({ ok: true, sent: 0 });

    let sent = 0;
    for (const bu of barberUsers) {
      if (!bu.notif_enabled) continue;

      const { count: bookingCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', bu.barber_id)
        .eq('date', today)
        .neq('status', 'cancelled');

      const { count: hsCount } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', bu.barber_id)
        .eq('date', today)
        .like('notes', '%HOME SERVICE%')
        .neq('status', 'cancelled');

      if ((bookingCount || 0) === 0) continue;

      const { data: streak } = await supabase
        .from('barber_streaks')
        .select('current_streak')
        .eq('barber_id', bu.barber_id)
        .maybeSingle();

      const streakStr = streak?.current_streak > 0 ? ` Streak ${streak.current_streak} hari menanti 💪` : '';
      const hsStr = hsCount > 0 ? ` + ${hsCount} home service` : '';

      sendPushNotifToBarber(supabase, bu.barber_id, {
        title: 'Selamat pagi! ☀️',
        body: `Hari ini: ${bookingCount} booking${hsStr}.${streakStr}`,
        url: '/barber/home',
      });

      sent++;
    }

    return res.json({ ok: true, sent, date: today });
  });

  return router;
}

module.exports = { createBarberCronRoutes };
```

- [ ] **Step 2: Wire into server/index.js**

Find the line `app.use('/api/barber', createBarberRoutes(supabase));` and add immediately after:

```javascript
const { createBarberCronRoutes } = require('./routes/barberCron');
app.use('/api/cron', createBarberCronRoutes(supabase, adminAuth));
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/barberCron.js server/index.js
git commit -m "feat: barber cron routes (streak-daily, mission-weekly, reminder-morning)"
```

---

## Task 6: Frontend — Types, API Client, Achievement Definitions

**Files:**
- Modify: `frontend/src/lib/barberTypes.ts`
- Modify: `frontend/src/lib/barberApi.ts`
- Create: `frontend/src/lib/achievementDefs.ts`

- [ ] **Step 1: Add types to barberTypes.ts**

Append at bottom of `frontend/src/lib/barberTypes.ts`:

```typescript
export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_hit_date: string | null;
}

export interface BadgeEarned {
  badge_key: string;
  earned_at: string;
}

export interface BadgeInProgress {
  badge_key: string;
  label: string;
  current: number;
  target: number;
}

export interface AchievementsResponse {
  earned: BadgeEarned[];
  in_progress: BadgeInProgress[];
}

export interface RecordsData {
  best_customer_per_day: number;
  best_customer_per_day_at: string | null;
  best_revenue_per_month: number;
  best_revenue_per_month_at: string | null;
  best_rating_per_month: number;
  best_rating_per_month_at: string | null;
  longest_streak_at: string | null;
}

export interface Mission {
  mission_key: string;
  target: number;
  progress: number;
  completed_at: string | null;
}

export interface MissionsResponse {
  week_start: string;
  missions: Mission[];
}

export interface LeaderboardData {
  tier: 'LEGEND' | 'ELITE' | 'ADVANCED' | 'RISING';
  position_pct: number;
  next_tier_needed: number;
  my_count: number;
  barber_count: number;
  month: string;
}

export interface FavoriteCustomer {
  name: string;
  visits: number;
  service: string;
}

export interface ReviewHighlight {
  rating: number;
  review_text: string;
  customer_name: string;
  created_at: string;
}

export interface PaceData {
  current_count: number;
  target_monthly: number;
  days_passed: number;
  days_remaining: number;
  current_pace: number;
  predicted_end: number;
  needed_per_day: number;
  on_track: boolean;
}
```

- [ ] **Step 2: Add API functions to barberApi.ts**

Append at bottom of `frontend/src/lib/barberApi.ts`:

```typescript
import type {
  StreakData,
  AchievementsResponse,
  RecordsData,
  MissionsResponse,
  LeaderboardData,
  PaceData,
} from './barberTypes';

export function fetchBarberStreak() {
  return jsonFetch<StreakData>('/api/barber/streak');
}

export function fetchBarberAchievements() {
  return jsonFetch<AchievementsResponse>('/api/barber/achievements');
}

export function fetchBarberRecords() {
  return jsonFetch<RecordsData>('/api/barber/records');
}

export function fetchBarberMissions() {
  return jsonFetch<MissionsResponse>('/api/barber/missions');
}

export function fetchBarberLeaderboard() {
  return jsonFetch<LeaderboardData>('/api/barber/leaderboard');
}

export function fetchBarberFavorites() {
  return jsonFetch<{ favorites: Array<{ name: string; visits: number; service: string }> }>('/api/barber/favorites');
}

export function fetchBarberReviews() {
  return jsonFetch<{ reviews: Array<{ rating: number; review_text: string; customer_name: string; created_at: string }> }>('/api/barber/reviews');
}

export function fetchBarberPace() {
  return jsonFetch<PaceData>('/api/barber/pace');
}
```

**Important:** The new imports need to be merged with the existing imports at the top of barberApi.ts. The `jsonFetch` function is already defined there.

- [ ] **Step 3: Create achievementDefs.ts**

```typescript
// frontend/src/lib/achievementDefs.ts

export interface BadgeDef {
  key: string;
  label: string;
  icon: string;
  description: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  { key: 'hair_cut_master',   icon: '✂️', label: 'Hair Cut Master',   description: '500 potong rambut' },
  { key: 'color_expert',      icon: '🎨', label: 'Color Expert',      description: '100 hair color' },
  { key: 'home_service_hero', icon: '🏠', label: 'Home Service Hero', description: '25 home service' },
  { key: 'early_bird',        icon: '🌅', label: 'Early Bird',        description: '10 booking sebelum jam 10 pagi' },
  { key: 'night_owl',         icon: '🌙', label: 'Night Owl',         description: '10 booking setelah jam 20 malam' },
  { key: 'diamond_hand',      icon: '💎', label: 'Diamond Hand',      description: '1000 customer total' },
  { key: 'streak_master',     icon: '🔥', label: 'Streak Master',     description: '30 hari streak tanpa putus' },
];

export const TIER_CONFIG = {
  LEGEND:   { icon: '👑', label: 'LEGEND',   color: 'text-yellow-500', bg: 'bg-yellow-50' },
  ELITE:    { icon: '💎', label: 'ELITE',    color: 'text-purple-600', bg: 'bg-purple-50' },
  ADVANCED: { icon: '⭐', label: 'ADVANCED', color: 'text-blue-600',   bg: 'bg-blue-50' },
  RISING:   { icon: '🌱', label: 'RISING',   color: 'text-green-600',  bg: 'bg-green-50' },
} as const;

export const MISSION_LABELS: Record<string, { label: string; icon: string }> = {
  serve_customers: { label: 'Layani customer', icon: '👥' },
  get_reviews:     { label: 'Dapat review ⭐5', icon: '⭐' },
  no_cancel:       { label: 'Zero cancel/no-show', icon: '✅' },
};
```

- [ ] **Step 4: TypeScript check + Commit**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/lib/
git commit -m "feat: motivation types, API client, achievement definitions"
```

---

## Task 7: Frontend — 8 Next.js Proxy Routes for Motivation Endpoints

**Files:**
- Create: 8 proxy route files under `frontend/src/app/api/barber/`

- [ ] **Step 1: Create all 8 files**

All follow the same pattern — authenticated GET proxy reading cookie `redbox_barber_session` and forwarding as `x-barber-token` header.

`streak/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/streak`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`achievements/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/achievements`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`records/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/records`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`missions/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/missions`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`leaderboard/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/leaderboard`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`favorites/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/favorites`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`reviews/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/reviews`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`pace/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export async function GET(req: NextRequest) {
  const token = req.cookies.get('redbox_barber_session')?.value || '';
  const res = await fetch(`${API_URL}/api/barber/pace`, { headers: { 'x-barber-token': token } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/api/barber/
git commit -m "feat: 8 proxy routes for motivation endpoints"
```

---

## Task 8: Frontend — 7 Motivation Components

**Files:**
- Create: 7 files in `frontend/src/components/barber/`

- [ ] **Step 1: StreakBadge.tsx**

```typescript
import type { StreakData } from '@/lib/barberTypes';

export function StreakBadge({ streak }: { streak: StreakData }) {
  if (streak.current_streak === 0 && streak.longest_streak === 0) return null;
  return (
    <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-orange-600 font-medium">🔥 Streak</p>
          <p className="text-3xl font-bold text-orange-700">{streak.current_streak} hari</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Rekor</p>
          <p className="text-lg font-semibold text-gray-700">{streak.longest_streak} hari</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: BadgeGrid.tsx**

```typescript
import type { AchievementsResponse } from '@/lib/barberTypes';
import { BADGE_DEFS } from '@/lib/achievementDefs';

export function BadgeGrid({ data }: { data: AchievementsResponse }) {
  const earnedKeys = new Set(data.earned.map(e => e.badge_key));

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🏅 Badges</p>
      <div className="grid grid-cols-3 gap-2">
        {BADGE_DEFS.map(def => {
          const earned = earnedKeys.has(def.key);
          const prog = data.in_progress.find(p => p.badge_key === def.key);
          const pct = prog ? Math.min(100, (prog.current / prog.target) * 100) : 0;

          return (
            <div
              key={def.key}
              className={`rounded-xl p-3 text-center border ${
                earned ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-100'
              }`}
            >
              <p className="text-2xl">{earned ? def.icon : '🔒'}</p>
              <p className={`text-xs mt-1 font-medium ${earned ? 'text-yellow-800' : 'text-gray-400'}`}>
                {def.label}
              </p>
              {!earned && prog && (
                <div className="mt-1">
                  <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400" style={{ width: `${pct}%` }} />
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

- [ ] **Step 3: MissionList.tsx**

```typescript
import type { MissionsResponse } from '@/lib/barberTypes';
import { MISSION_LABELS } from '@/lib/achievementDefs';

export function MissionList({ data }: { data: MissionsResponse }) {
  if (data.missions.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        Belum ada misi minggu ini. Misi baru di-generate tiap Senin pagi.
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🎯 Misi Minggu Ini</p>
      <div className="space-y-3">
        {data.missions.map(m => {
          const def = MISSION_LABELS[m.mission_key] || { label: m.mission_key, icon: '🎯' };
          const pct = m.target > 0 ? Math.min(100, (m.progress / m.target) * 100) : 0;
          const done = !!m.completed_at;

          return (
            <div key={m.mission_key} className={`bg-white rounded-xl p-3 border ${done ? 'border-green-200 bg-green-50' : 'border-gray-100'}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">
                  {done ? '✅' : def.icon} {def.label}
                </span>
                <span className="text-xs text-gray-500">{m.progress}/{m.target}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${done ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: TierIndicator.tsx**

```typescript
import type { LeaderboardData } from '@/lib/barberTypes';
import { TIER_CONFIG } from '@/lib/achievementDefs';

export function TierIndicator({ data }: { data: LeaderboardData }) {
  const tier = TIER_CONFIG[data.tier];
  return (
    <div className={`${tier.bg} rounded-2xl p-4 border`}>
      <div className="flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-500">🏆 Tier Kamu</p>
          <p className={`text-xl font-bold ${tier.color}`}>
            {tier.icon} {tier.label}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">{data.my_count} customer</p>
          <p className="text-xs text-gray-400">{data.barber_count} kapster di cabang</p>
        </div>
      </div>
      {data.next_tier_needed > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Butuh +{data.next_tier_needed} customer untuk naik tier
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: ReviewQuoteCard.tsx**

```typescript
import type { ReviewHighlight } from '@/lib/barberTypes';

export function ReviewQuoteCard({ reviews }: { reviews: ReviewHighlight[] }) {
  if (reviews.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🌟 Kata Mereka</p>
      <div className="space-y-2">
        {reviews.slice(0, 3).map((r, i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100">
            <p className="text-sm text-gray-700 italic">"{r.review_text}"</p>
            <p className="text-xs text-gray-400 mt-1">— {r.customer_name} ({'⭐'.repeat(r.rating)})</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: PaceCard.tsx**

```typescript
import type { PaceData } from '@/lib/barberTypes';

export function PaceCard({ pace }: { pace: PaceData }) {
  const pct = pace.target_monthly > 0 ? Math.min(100, (pace.current_count / pace.target_monthly) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500 mb-2">📈 Pace Bulan Ini</p>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-2xl font-bold text-gray-900">{pace.current_count}</span>
        <span className="text-sm text-gray-500">/ {pace.target_monthly}</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all ${pace.on_track ? 'bg-green-500' : 'bg-yellow-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Sisa {pace.days_remaining} hari</span>
        <span>~{pace.needed_per_day}/hari</span>
      </div>
      <p className={`text-sm font-medium mt-2 ${pace.on_track ? 'text-green-600' : 'text-yellow-600'}`}>
        {pace.on_track
          ? `✅ On track! Prediksi: ${pace.predicted_end} customer`
          : `💪 Tambah ${Math.max(0, pace.needed_per_day - Math.round(pace.current_pace))}/hari lagi`
        }
      </p>
    </div>
  );
}
```

- [ ] **Step 7: FavoriteCustomerList.tsx**

```typescript
import type { FavoriteCustomer } from '@/lib/barberTypes';

export function FavoriteCustomerList({ favorites }: { favorites: FavoriteCustomer[] }) {
  if (favorites.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">💝 Customer Setia</p>
      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
        {favorites.map((f, i) => (
          <div key={i} className="px-3 py-2 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-gray-900">{f.name}</p>
              <p className="text-xs text-gray-400">{f.service}</p>
            </div>
            <span className="text-sm text-gray-500">{f.visits}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/barber/
git commit -m "feat: 7 motivation components (StreakBadge, BadgeGrid, MissionList, TierIndicator, ReviewQuoteCard, PaceCard, FavoriteCustomerList)"
```

---

## Task 9: Frontend — Update Home Page (add streak + pace)

**Files:**
- Modify: `frontend/src/app/barber/home/page.tsx`

- [ ] **Step 1: Add imports and fetch calls**

Add imports at top:
```typescript
import { fetchBarberStreak, fetchBarberPace } from '@/lib/barberApi';
import { StreakBadge } from '@/components/barber/StreakBadge';
import { PaceCard } from '@/components/barber/PaceCard';
import type { StreakData, PaceData } from '@/lib/barberTypes';
```

Add state:
```typescript
const [streak, setStreak] = useState<StreakData | null>(null);
const [pace, setPace] = useState<PaceData | null>(null);
```

Update the `Promise.all` fetch to include streak and pace:
```typescript
Promise.all([fetchBarberStats('day'), fetchBarberUpcoming(), fetchBarberStreak(), fetchBarberPace()])
  .then(([s, u, st, p]) => {
    setStats(s);
    setUpcoming(u);
    setStreak(st);
    setPace(p);
  })
```

- [ ] **Step 2: Add components to JSX**

After the target card and before `{upcoming.next && ...}`:
```tsx
{streak && <StreakBadge streak={streak} />}
```

After the home service section and before the tomorrow section:
```tsx
{pace && <PaceCard pace={pace} />}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/barber/home/page.tsx
git commit -m "feat: add streak badge and pace prediction to barber home"
```

---

## Task 10: Frontend — Update Progress Page (full motivation dashboard)

**Files:**
- Modify: `frontend/src/app/barber/progress/page.tsx`

- [ ] **Step 1: Add imports and fetch calls**

Add imports:
```typescript
import { fetchBarberStreak, fetchBarberAchievements, fetchBarberRecords, fetchBarberMissions, fetchBarberLeaderboard, fetchBarberFavorites, fetchBarberReviews } from '@/lib/barberApi';
import { StreakBadge } from '@/components/barber/StreakBadge';
import { BadgeGrid } from '@/components/barber/BadgeGrid';
import { MissionList } from '@/components/barber/MissionList';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { FavoriteCustomerList } from '@/components/barber/FavoriteCustomerList';
import { ReviewQuoteCard } from '@/components/barber/ReviewQuoteCard';
import type { StreakData, AchievementsResponse, RecordsData, MissionsResponse, LeaderboardData } from '@/lib/barberTypes';
```

Add state variables, fetch them in useEffect (separate from the period-based fetches since these are not period-filtered):
```typescript
const [streak, setStreak] = useState<StreakData | null>(null);
const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
const [records, setRecords] = useState<RecordsData | null>(null);
const [missions, setMissions] = useState<MissionsResponse | null>(null);
const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
const [favorites, setFavorites] = useState<Array<{name:string;visits:number;service:string}>>([]);
const [reviews, setReviews] = useState<Array<{rating:number;review_text:string;customer_name:string;created_at:string}>>([]);
```

Add a second `useEffect` for motivation data (loads once, not per-period):
```typescript
useEffect(() => {
  if (!session) return;
  Promise.all([
    fetchBarberStreak(),
    fetchBarberAchievements(),
    fetchBarberRecords(),
    fetchBarberMissions(),
    fetchBarberLeaderboard(),
    fetchBarberFavorites(),
    fetchBarberReviews(),
  ])
    .then(([st, ach, rec, mis, lb, fav, rev]) => {
      setStreak(st);
      setAchievements(ach);
      setRecords(rec);
      setMissions(mis);
      setLeaderboard(lb);
      setFavorites(fav.favorites || []);
      setReviews(rev.reviews || []);
    })
    .catch(console.error);
}, [session]);
```

- [ ] **Step 2: Add components to JSX between StatsGrid and History**

After `<StatsGrid stats={stats} />`:

```tsx
{/* Motivation Section */}
{leaderboard && <TierIndicator data={leaderboard} />}
{streak && <StreakBadge streak={streak} />}
{missions && <MissionList data={missions} />}
{achievements && <BadgeGrid data={achievements} />}

{/* Records */}
{records && records.best_customer_per_day > 0 && (
  <div className="bg-white rounded-xl p-4 border border-gray-100">
    <p className="text-sm font-medium text-gray-700 mb-2">🏆 Rekor Pribadi</p>
    <div className="space-y-1 text-sm">
      <p>📋 Customer/hari terbanyak: <span className="font-semibold">{records.best_customer_per_day}</span> ({records.best_customer_per_day_at})</p>
      {records.best_revenue_per_month > 0 && (
        <p>💰 Revenue/bulan tertinggi: <span className="font-semibold">Rp {records.best_revenue_per_month.toLocaleString('id-ID')}</span></p>
      )}
    </div>
  </div>
)}

<FavoriteCustomerList favorites={favorites} />
<ReviewQuoteCard reviews={reviews} />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/barber/progress/page.tsx
git commit -m "feat: full motivation dashboard on progress page"
```

---

## Task 11: Frontend — Leaderboard Page

**Files:**
- Create: `frontend/src/app/barber/leaderboard/page.tsx`

- [ ] **Step 1: Buat halaman**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { fetchBarberLeaderboard } from '@/lib/barberApi';
import { TierIndicator } from '@/components/barber/TierIndicator';
import { TIER_CONFIG } from '@/lib/achievementDefs';
import type { LeaderboardData } from '@/lib/barberTypes';

const TIERS = ['LEGEND', 'ELITE', 'ADVANCED', 'RISING'] as const;

export default function LeaderboardPage() {
  const { data: session } = useBarberSession();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetchBarberLeaderboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  if (loading || !data) {
    return <div className="p-4 text-center text-gray-400">Memuat...</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">🏆 Leaderboard</h2>
      <p className="text-sm text-gray-500 capitalize">Cabang {session?.barber.branch} — Bulan ini</p>

      <TierIndicator data={data} />

      {/* Tier ladder visualization */}
      <div className="space-y-2 pt-2">
        {TIERS.map(tier => {
          const config = TIER_CONFIG[tier];
          const isMyTier = data.tier === tier;
          return (
            <div
              key={tier}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                isMyTier ? `${config.bg} border-current ${config.color}` : 'bg-gray-50 border-gray-100'
              }`}
            >
              <span className="text-2xl">{config.icon}</span>
              <div className="flex-1">
                <p className={`font-semibold ${isMyTier ? config.color : 'text-gray-500'}`}>
                  {config.label}
                </p>
                <p className="text-xs text-gray-400">
                  {tier === 'LEGEND' && 'Top 10%'}
                  {tier === 'ELITE' && 'Top 11-30%'}
                  {tier === 'ADVANCED' && 'Middle 31-70%'}
                  {tier === 'RISING' && 'Bottom 70-100%'}
                </p>
              </div>
              {isMyTier && (
                <span className="text-sm font-bold">← Kamu</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl p-4 border border-gray-100">
        <p className="text-sm text-gray-600">
          Kamu saat ini: <span className="font-bold">{data.my_count} customer</span> bulan ini
        </p>
        {data.next_tier_needed > 0 && (
          <p className="text-sm text-gray-500 mt-1">
            Naik tier butuh: +{data.next_tier_needed} customer lagi
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add link to leaderboard from progress page**

In `progress/page.tsx`, after the `TierIndicator` component, add a link:

```tsx
import Link from 'next/link';
// ...
{leaderboard && (
  <>
    <TierIndicator data={leaderboard} />
    <Link href="/barber/leaderboard" className="block text-center text-sm text-red-600 hover:underline -mt-2">
      Lihat detail leaderboard →
    </Link>
  </>
)}
```

- [ ] **Step 3: TypeScript check + Commit**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/app/barber/leaderboard/ frontend/src/app/barber/progress/page.tsx
git commit -m "feat: leaderboard page + link from progress"
```

---

## Task 12: Final TypeScript Check + Commit All Remaining

- [ ] **Step 1: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Fix any errors.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: Phase B complete — motivation layer (streak, badges, missions, tier, pace, cron)"
```

---

## Ringkasan File

| File | Aksi |
|---|---|
| `server/migrations/006_barber_motivation.sql` | Baru |
| `server/services/barberMetrics.js` | Baru |
| `server/routes/barber.js` | Modifikasi (+8 endpoints) |
| `server/routes/barberCron.js` | Baru |
| `server/index.js` | Modifikasi (hook onBookingCompleted + wire cron routes) |
| `frontend/src/lib/achievementDefs.ts` | Baru |
| `frontend/src/lib/barberTypes.ts` | Modifikasi (+12 interfaces) |
| `frontend/src/lib/barberApi.ts` | Modifikasi (+8 functions) |
| `frontend/src/components/barber/StreakBadge.tsx` | Baru |
| `frontend/src/components/barber/BadgeGrid.tsx` | Baru |
| `frontend/src/components/barber/MissionList.tsx` | Baru |
| `frontend/src/components/barber/TierIndicator.tsx` | Baru |
| `frontend/src/components/barber/ReviewQuoteCard.tsx` | Baru |
| `frontend/src/components/barber/PaceCard.tsx` | Baru |
| `frontend/src/components/barber/FavoriteCustomerList.tsx` | Baru |
| `frontend/src/app/api/barber/streak/route.ts` | Baru |
| `frontend/src/app/api/barber/achievements/route.ts` | Baru |
| `frontend/src/app/api/barber/records/route.ts` | Baru |
| `frontend/src/app/api/barber/missions/route.ts` | Baru |
| `frontend/src/app/api/barber/leaderboard/route.ts` | Baru |
| `frontend/src/app/api/barber/favorites/route.ts` | Baru |
| `frontend/src/app/api/barber/reviews/route.ts` | Baru |
| `frontend/src/app/api/barber/pace/route.ts` | Baru |
| `frontend/src/app/barber/home/page.tsx` | Modifikasi (+streak, +pace) |
| `frontend/src/app/barber/progress/page.tsx` | Modifikasi (+full motivation) |
| `frontend/src/app/barber/leaderboard/page.tsx` | Baru |

## Cron Jobs (setup di cron-job.org setelah deploy)

| Endpoint | Jadwal | Method |
|---|---|---|
| `POST /api/cron/barber-streak-daily` | 23:55 WIB setiap hari | POST + header x-admin-token |
| `POST /api/cron/barber-mission-weekly` | Senin 06:00 WIB | POST + header x-admin-token |
| `POST /api/cron/barber-reminder-morning` | 07:00 WIB setiap hari | POST + header x-admin-token |
