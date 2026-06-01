// server/routes/barber.js
const express = require('express');
const { sendBarberOTP, verifyBarberOTP, destroyBarberSession } = require('../services/barberOTP');
const { createBarberAuth } = require('../services/barberAuth');

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

  return router;
}

module.exports = { createBarberRoutes };
