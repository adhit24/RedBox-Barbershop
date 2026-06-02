// server/routes/barberCron.js
const express = require('express');
const { sendPushNotifToBarber } = require('../services/barberMetrics');

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
  const dayStart = `${dateStr}T00:00:00+07:00`;
  const dayEnd   = `${dateStr}T23:59:59+07:00`;

  const [{ count: webCount }, { count: mokaCount }] = await Promise.all([
    supabase.from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('status', 'done')
      .eq('date', dateStr),
    supabase.from('schedules')
      .select('*', { count: 'exact', head: true })
      .eq('barber_id', barberId)
      .eq('source', 'moka')
      .eq('status', 'completed')
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd),
  ]);

  return (webCount || 0) + (mokaCount || 0);
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

  return router;
}

module.exports = { createBarberCronRoutes };
