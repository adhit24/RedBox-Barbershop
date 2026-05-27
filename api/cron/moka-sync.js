/**
 * Vercel Cron — GET /api/cron/moka-sync
 * Pulls open bills from Moka POS and creates/updates schedule entries
 * so that walk-in slots are blocked on the booking website.
 *
 * This replaces the `node-cron` based sync that only works on persistent servers.
 * Should run every 5 minutes via Vercel Cron.
 *
 * Env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   — Supabase credentials
 *   MOKA_CLIENT_ID, MOKA_CLIENT_SECRET   — Moka OAuth
 *   CRON_SECRET                          — optional auth header
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Auth check
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check Moka OAuth is configured
    const { isMokaOAuthConfigured } = require('../../server/moka/oauth');
    if (!isMokaOAuthConfigured()) {
      return res.status(503).json({ error: 'Moka OAuth not configured' });
    }

    const { pullMokaToWeb } = require('../../server/moka/sync');

    // Get all active outlets with Moka tokens
    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, name, moka_outlet_id')
      .eq('is_active', true)
      .not('moka_outlet_id', 'is', null);

    if (!outlets?.length) {
      return res.json({ ok: true, message: 'No active outlets with Moka configured', results: [] });
    }

    // Only sync outlets that have a valid token
    const { data: tokens } = await supabase
      .from('moka_tokens')
      .select('outlet_id')
      .gt('expires_at', new Date().toISOString());

    const authorizedIds = new Set((tokens || []).map(t => t.outlet_id));

    const results = [];
    for (const outlet of outlets) {
      if (!authorizedIds.has(outlet.id)) {
        results.push({ outletId: outlet.id, outletName: outlet.name, status: 'skipped', reason: 'no valid token' });
        continue;
      }

      try {
        const result = await pullMokaToWeb(supabase, outlet.id);
        results.push({ outletId: outlet.id, outletName: outlet.name, status: 'ok', ...result });
      } catch (err) {
        console.error(`[MokaSync] Outlet ${outlet.name} (${outlet.id}) error:`, err.message);
        results.push({ outletId: outlet.id, outletName: outlet.name, status: 'error', error: err.message });
      }
    }

    return res.status(200).json({ ok: true, syncedAt: new Date().toISOString(), results });
  } catch (err) {
    console.error('[MokaSync] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
