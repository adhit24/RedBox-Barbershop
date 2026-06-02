// server/routes/barber.js
const express = require('express');
const { sendBarberOTP, verifyBarberOTP, destroyBarberSession } = require('../services/barberOTP');
const { createBarberAuth } = require('../services/barberAuth');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDateRange(period) {
  const now = new Date();
  const today = localDateStr(now);
  const start = new Date(now);
  if (period === 'week')       start.setDate(now.getDate() - 7);
  else if (period === 'month') start.setDate(now.getDate() - 30);
  else if (period === 'year')  start.setFullYear(now.getFullYear() - 1);
  else                          { /* day = today only */ }
  return { from: localDateStr(start), to: today };
}

function createBarberRoutes(supabase) {
  const router = express.Router();
  const barberAuth = createBarberAuth(supabase);

  // ─── AUTH ────────────────────────────────────────────
  router.post('/auth/otp/send', async (req, res) => {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const result = await sendBarberOTP(supabase, phone);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, barber: result.barber });
  });

  router.post('/auth/otp/verify', async (req, res) => {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    const result = await verifyBarberOTP(supabase, phone, code);
    if (!result.ok) return res.status(401).json({ error: result.error });
    return res.json({
      ok: true,
      token: result.token,
      barber: result.barber,
      setup_completed: result.setup_completed,
    });
  });

  router.post('/auth/logout', barberAuth, async (req, res) => {
    const token = req.headers['x-barber-token'];
    await destroyBarberSession(supabase, token);
    return res.json({ ok: true });
  });

  // ─── PROFILE ─────────────────────────────────────────
  router.get('/me', barberAuth, async (req, res) => {
    const { data: profile } = await supabase
      .from('barber_users')
      .select('barber_id, phone, avatar_url, target_daily, target_monthly, setup_completed, notif_enabled')
      .eq('barber_id', req.barber.id)
      .maybeSingle();

    return res.json({
      barber: req.barber,
      profile: profile || null,
    });
  });

  router.post('/setup', barberAuth, async (req, res) => {
    const { target_daily, target_monthly, avatar_url } = req.body || {};
    if (!target_daily || !target_monthly) {
      return res.status(400).json({ error: 'target_daily and target_monthly required' });
    }
    const update = {
      target_daily: Number(target_daily),
      target_monthly: Number(target_monthly),
      setup_completed: true,
    };
    if (avatar_url) update.avatar_url = avatar_url;

    const { error } = await supabase
      .from('barber_users')
      .update(update)
      .eq('barber_id', req.barber.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  router.put('/target', barberAuth, async (req, res) => {
    const { target_daily, target_monthly } = req.body || {};
    const update = {};
    if (target_daily)   update.target_daily   = Number(target_daily);
    if (target_monthly) update.target_monthly = Number(target_monthly);
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const { error } = await supabase
      .from('barber_users')
      .update(update)
      .eq('barber_id', req.barber.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // ─── AVATAR UPLOAD ───────────────────────────────────
  router.post('/avatar/upload', barberAuth, async (req, res) => {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'dataUrl required (base64 data URL)' });
    }
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid data URL format' });

    const mime = match[1];
    const base64 = match[2];
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'File terlalu besar (max 2MB)' });
    }

    const path = `${req.barber.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('barber-avatars')
      .upload(path, buffer, { contentType: mime, upsert: true });

    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data: { publicUrl } } = supabase.storage
      .from('barber-avatars')
      .getPublicUrl(path);

    await supabase.from('barber_users')
      .update({ avatar_url: publicUrl })
      .eq('barber_id', req.barber.id);

    return res.json({ ok: true, avatar_url: publicUrl });
  });

  // ─── STATS ───────────────────────────────────────────
  router.get('/stats', barberAuth, async (req, res) => {
    const period = String(req.query.period || 'day');
    const { from, to } = getDateRange(period);

    const { data: rows, error } = await supabase
      .from('booking_full')
      .select('price, duration, date')
      .eq('barber_id', req.barber.id)
      .eq('status', 'done')
      .gte('date', from)
      .lte('date', to);

    if (error) return res.status(500).json({ error: error.message });

    const count = rows?.length || 0;
    const revenue = (rows || []).reduce((s, r) => s + (Number(r.price) || 0), 0);
    const minutesTotal = (rows || []).reduce((s, r) => s + (Number(r.duration) || 0), 0);
    const hours = Math.round((minutesTotal / 60) * 10) / 10;

    // Rating dari tabel reviews kalau ada
    let rating = 0;
    try {
      const { data: revs } = await supabase
        .from('reviews')
        .select('rating')
        .eq('barber_id', req.barber.id)
        .gte('created_at', from + 'T00:00:00')
        .lte('created_at', to + 'T23:59:59');
      if (revs && revs.length > 0) {
        const sum = revs.reduce((s, r) => s + (Number(r.rating) || 0), 0);
        rating = Math.round((sum / revs.length) * 10) / 10;
      }
    } catch { /* reviews table optional */ }

    return res.json({
      period,
      from,
      to,
      count,
      revenue,
      hours,
      rating,
    });
  });

  // ─── UPCOMING ────────────────────────────────────────
  router.get('/upcoming', barberAuth, async (req, res) => {
    const now = new Date();
    const today = localDateStr(now);
    const tomorrow = localDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
    const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const { data: todayList } = await supabase
      .from('booking_full')
      .select('*')
      .eq('barber_id', req.barber.id)
      .eq('date', today)
      .neq('status', 'cancelled')
      .order('time', { ascending: true });

    const { data: tomorrowList } = await supabase
      .from('booking_full')
      .select('*')
      .eq('barber_id', req.barber.id)
      .eq('date', tomorrow)
      .neq('status', 'cancelled')
      .order('time', { ascending: true });

    const upcomingToday = (todayList || []).filter(b => b.time >= currentTime && b.status !== 'done');
    const next = upcomingToday[0] || null;

    return res.json({
      next,
      today: todayList || [],
      tomorrow: tomorrowList || [],
    });
  });

  // ─── HISTORY ─────────────────────────────────────────
  router.get('/history', barberAuth, async (req, res) => {
    const period = String(req.query.period || 'month');
    const offset = Number(req.query.offset || 0);
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const { from, to } = getDateRange(period);

    const { data, error } = await supabase
      .from('booking_full')
      .select('*')
      .eq('barber_id', req.barber.id)
      .eq('status', 'done')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [], period, from, to });
  });

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
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const today = localDateStr(now);

    // Get ALL active barbers across all branches
    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name, branch')
      .eq('is_active', true);

    if (!barbers || barbers.length === 0) {
      return res.json({ tier: 'RISING', position_pct: 100, next_tier_needed: 0, barber_count: 0, rankings: [] });
    }

    const barberIds = barbers.map(b => b.id);

    // Primary source: barber_daily_counts (accurate, filled by CSV + nightly cron)
    const { data: dailyRows } = await supabase
      .from('barber_daily_counts')
      .select('barber_id, count')
      .in('barber_id', barberIds)
      .gte('date', monthStart)
      .lte('date', today);

    // Which dates already have recorded counts?
    const recordedDates = new Set((dailyRows || []).map(r => r.date));

    // For today (not yet captured by nightly cron), add live web bookings
    const { data: todayWebRows } = await supabase
      .from('bookings')
      .select('barber_id')
      .in('barber_id', barberIds)
      .eq('status', 'done')
      .eq('date', today);

    // Sum daily_counts by barber
    const dailyMap = {};
    for (const r of (dailyRows || [])) {
      dailyMap[r.barber_id] = (dailyMap[r.barber_id] || 0) + r.count;
    }

    // Add today's live web bookings only if today not yet recorded by cron
    if (!recordedDates.has(today)) {
      for (const r of (todayWebRows || [])) {
        if (r.barber_id) dailyMap[r.barber_id] = (dailyMap[r.barber_id] || 0) + 1;
      }
    }

    const counts = barbers.map(b => ({
      barber_id: b.id,
      name: b.name,
      branch: b.branch,
      count: dailyMap[b.id] || 0,
    }));

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

    const rankings = counts.map((c, i) => ({
      rank: i + 1,
      barber_id: c.barber_id,
      name: c.name,
      branch: c.branch,
      total_count: c.count,
      is_me: c.barber_id === req.barber.id,
    }));

    return res.json({
      tier,
      position_pct: positionPct,
      next_tier_needed: nextTierNeeded,
      my_count: myCount,
      barber_count: total,
      month: monthStart,
      rankings,
    });
  });

  // ─── FAVORITES ───────────────────────────────────────
  router.get('/favorites', barberAuth, async (req, res) => {
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

  return router;
}

module.exports = { createBarberRoutes };
