// server/routes/barberCron.js
const express = require('express');
const { sendPushNotifToBarber } = require('../services/barberMetrics');
const { checkAchievements, assignRivals, crownKingOfShop, rebuildLeaderboardCache } = require('../services/gamificationService');
const { processCustomerNotificationOutbox } = require('../services/bookingNotificationOutbox');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Returns monday of current week as YYYY-MM-DD
function currentWeekStart(d = new Date()) {
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
  return localDateStr(monday);
}

// Combined web + Moka customer count for a specific barber on a specific date
async function getDailyCount(supabase, barberId, dateStr) {
  const [{ count: webCount }, { count: mokaCount }] = await Promise.all([
    supabase.from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId).eq('status', 'done').eq('date', dateStr),
    supabase.from('moka_barber_services')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId).eq('tx_date', dateStr),
  ]);

  // Moka lebih akurat (termasuk walk-in); kalau ada pakai Moka, fallback ke web
  return (mokaCount || 0) > 0 ? (mokaCount || 0) : (webCount || 0);
}

// Combined weekly count for a barber (weekStart..weekStart+6)
async function getWeeklyCount(supabase, barberId, weekStart) {
  const monday = new Date(weekStart + 'T00:00:00+07:00');
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekEnd = localDateStr(sunday);
  const weekEndTs = `${weekEnd}T23:59:59+07:00`;

  const [{ count: webCount }, { count: mokaCount }] = await Promise.all([
    supabase.from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('status', 'done')
      .gte('date', weekStart)
      .lte('date', weekEnd),
    supabase.from('schedules')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('source', 'moka')
      .eq('status', 'completed')
      .gte('start_time', weekStart + 'T00:00:00+07:00')
      .lte('start_time', weekEndTs),
  ]);

  return (webCount || 0) + (mokaCount || 0);
}

// Pull the current month directly from Moka before rebuilding leaderboard data.
// This is also exposed through the external cron route because in serverless
// deployments an in-process node-cron timer is not guaranteed to stay alive.
async function syncMokaTransactions(supabase) {
  const { syncCurrentMonthTx } = require('../moka/txSync');
  const { data: outlets, error: outletError } = await supabase
    .from('outlets')
    .select('id, slug, moka_outlet_id')
    .eq('is_active', true)
    .not('moka_outlet_id', 'is', null);
  if (outletError) throw outletError;
  if (!outlets?.length) return { outlets: 0, transactions: 0, services: 0 };

  const { data: tokenRows, error: tokenError } = await supabase
    .from('moka_tokens').select('outlet_id').in('outlet_id', outlets.map(o => o.id));
  if (tokenError) throw tokenError;
  const authorizedIds = new Set((tokenRows || []).map(row => row.outlet_id));

  const results = await Promise.all(outlets.map(async outlet => {
    if (!authorizedIds.has(outlet.id)) return { slug: outlet.slug, skipped: true };
    try {
      const result = await syncCurrentMonthTx(supabase, outlet);
      return { slug: outlet.slug, ...result };
    } catch (error) {
      return { slug: outlet.slug, error: error.message };
    }
  }));

  return {
    outlets: results.filter(r => !r.skipped && !r.error).length,
    transactions: results.reduce((sum, r) => sum + (r.totalTx || 0), 0),
    services: results.reduce((sum, r) => sum + (r.totalSvc || 0), 0),
    results,
  };
}

function createBarberCronRoutes(supabase, adminAuth) {
  const router = express.Router();

  // ─── DAILY RECAP (23:30 WIB) ────────────────────────
  // Pulls web+Moka data, updates barber_records & missions, sends recap notif
  router.post('/barber-daily-recap', adminAuth, async (req, res) => {
    const today = localDateStr();
    const weekStart = currentWeekStart();

    const { data: barberUsers } = await supabase
      .from('barber_users')
      .select('barber_id, notif_enabled');

    if (!barberUsers) return res.json({ ok: true, processed: 0 });

    const results = [];
    for (const bu of barberUsers) {
      const todayCount = await getDailyCount(supabase, bu.barber_id, today);
      const weekCount  = await getWeeklyCount(supabase, bu.barber_id, weekStart);

      // ── Update barber_records: best single-day ──
      const { data: rec } = await supabase
        .from('barber_records')
        .select('best_customer_per_day')
        .eq('barber_id', bu.barber_id)
        .maybeSingle();

      const prevBest = rec?.best_customer_per_day || 0;
      const isNewRecord = todayCount > 0 && todayCount > prevBest;

      // ── Write accurate daily count (used by leaderboard) ──
      if (todayCount > 0) {
        await supabase.from('barber_daily_counts').upsert({
          barber_id: bu.barber_id,
          date: today,
          count: todayCount,
          source: 'cron',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'barber_id,date' });
      }

      if (todayCount > 0) {
        await supabase.from('barber_records').upsert({
          barber_id: bu.barber_id,
          best_customer_per_day: isNewRecord ? todayCount : prevBest,
          best_customer_per_day_at: isNewRecord ? today : (rec?.best_customer_per_day_at || today),
        }, { onConflict: 'barber_id' });
      }

      // ── Update barber_missions: serve_customers progress ──
      if (todayCount > 0) {
        const { data: mission } = await supabase
          .from('barber_missions')
          .select('id, target, progress, completed_at')
          .eq('barber_id', bu.barber_id)
          .eq('week_start', weekStart)
          .eq('mission_key', 'serve_customers')
          .maybeSingle();

        if (mission) {
          const newProgress = Math.min(weekCount, mission.target);
          const justCompleted = newProgress >= mission.target && !mission.completed_at;
          await supabase.from('barber_missions').update({
            progress: newProgress,
            completed_at: justCompleted ? new Date().toISOString() : mission.completed_at,
          }).eq('id', mission.id);

          if (justCompleted) {
            sendPushNotifToBarber(supabase, bu.barber_id, {
              title: '🎯 Misi Selesai!',
              body: `Target ${mission.target} customer minggu ini tercapai! Keren! 🔥`,
              url: '/barber/progress',
            });
          }
        }
      }

      // ── Push recap notif ──
      if (bu.notif_enabled !== false && todayCount > 0) {
        const recordStr = isNewRecord ? ` 🏆 REKOR BARU: ${todayCount}/hari!` : '';
        sendPushNotifToBarber(supabase, bu.barber_id, {
          title: `Recap hari ini: ${todayCount} customer`,
          body: `Total minggu ini: ${weekCount} customer.${recordStr}`,
          url: '/barber/home',
        });
      }

      results.push({ barber_id: bu.barber_id, today: todayCount, week: weekCount, new_record: isNewRecord });
    }

    return res.json({ ok: true, processed: results.length, date: today, week_start: weekStart, results });
  });

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

      // Combined web + Moka count for today
      const count = await getDailyCount(supabase, bu.barber_id, today);

      const hitTarget = count >= target;

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

      // Calculate target from previous week (web + Moka combined)
      const prevCount = await getWeeklyCount(supabase, bu.barber_id, prevWeekStart);

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

  // ─── NIGHTLY GAMIFICATION (00:00 WIB) ─────────────────────────
  // Award XP, check achievements, rebuild leaderboard cache
  // Tiap Senin: assign rivals + crown King of the Shop
  router.post('/barber-nightly-gamification', adminAuth, async (req, res) => {
    const today = localDateStr();

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

  // ─── SYNC MOKA DAILY (dipanggil cronjob.org tiap jam) ──
  // GET /api/cron/sync-moka-daily?token=CRON_SECRET
  // Update barber_daily_counts dari moka_barber_services untuk hari ini (dan kemarin jika ada)
  router.get('/sync-moka-daily', async (req, res) => {
    const secret = process.env.CRON_SECRET || process.env.ADMIN_PASSWORD;
    if (!secret || req.query.token !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let notifications;
    try {
      notifications = await processCustomerNotificationOutbox(supabase, 25);
    } catch (error) {
      console.error('[Cron] Customer notification retry failed:', error.message);
      notifications = { error: 'retry_failed' };
    }

    let mokaSync;
    try {
      mokaSync = await syncMokaTransactions(supabase);
    } catch (error) {
      console.error('[Cron] Live Moka transaction sync failed:', error.message);
      return res.status(502).json({ ok: false, error: 'Moka transaction sync failed' });
    }

    const today = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    const datesToSync = [yesterday, today];

    const { data: barberUsers } = await supabase
      .from('barber_users').select('barber_id');
    if (!barberUsers?.length) return res.json({ ok: true, synced: 0 });

    let synced = 0;
    for (const dateStr of datesToSync) {
      for (const { barber_id } of barberUsers) {
        const count = await getDailyCount(supabase, barber_id, dateStr);
        if (count > 0) {
          await supabase.from('barber_daily_counts').upsert({
            barber_id, date: dateStr, count, source: 'moka_sync',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'barber_id,date' });
          synced++;
        }
      }
    }

    // Rebuild leaderboard cache setelah sync
    try { await rebuildLeaderboardCache(supabase); } catch { /* optional */ }

    return res.json({ ok: true, synced, notifications, moka_sync: mokaSync, dates: datesToSync, ts: new Date().toISOString() });
  });

  return router;
}

module.exports = { createBarberCronRoutes };
