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

  return router;
}

module.exports = { createBarberRoutes };
