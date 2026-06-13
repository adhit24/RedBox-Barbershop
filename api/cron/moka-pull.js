/**
 * Vercel Cron — GET /api/cron/moka-pull
 * Dijadwalkan setiap 5 menit di vercel.json.
 *
 * Pull open (PENDING) bills dari Moka POS ke tabel schedules sehingga slot
 * kapster langsung terblokir saat admin membuka GoShow bill di Moka.
 * Tanpa cron ini, GoShow tidak pernah masuk schedules → slot tidak terblokir
 * → rawan double booking.
 *
 * Auth: Vercel mengirim header "Authorization: Bearer <CRON_SECRET>".
 * Set env var CRON_SECRET di Vercel project settings.
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  // Skip auth check if CRON_SECRET is not set (legacy / local dev).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { pullMokaToWeb } = require('../../server/moka/sync');

    // Fetch all outlets that have Moka OAuth tokens
    const { data: tokens, error: tokErr } = await supabase
      .from('moka_tokens')
      .select('outlet_id');

    if (tokErr) throw new Error(`moka_tokens fetch failed: ${tokErr.message}`);
    if (!tokens?.length) {
      return res.status(200).json({ ok: true, message: 'No outlets with Moka tokens', results: [] });
    }

    // Pull all outlets in parallel — each pull fetches PENDING bills and inserts
    // them as 'reserved' schedules to block slots on the website.
    const results = await Promise.all(
      tokens.map(t =>
        pullMokaToWeb(supabase, t.outlet_id)
          .then(r => ({ outletId: t.outlet_id, ...r }))
          .catch(err => ({
            outletId:  t.outlet_id,
            error:     err.message,
            processed: 0,
            skipped:   0,
            errors:    1,
          }))
      )
    );

    const totalProcessed = results.reduce((s, r) => s + (r.processed || 0), 0);
    const totalErrors    = results.reduce((s, r) => s + (r.errors   || 0), 0);

    console.log(`[MokaPull] done — ${results.length} outlet(s), processed=${totalProcessed}, errors=${totalErrors}`);

    return res.status(200).json({
      ok:        true,
      syncedAt:  new Date().toISOString(),
      outlets:   results.length,
      processed: totalProcessed,
      errors:    totalErrors,
      results,
    });
  } catch (err) {
    console.error('[MokaPull] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
