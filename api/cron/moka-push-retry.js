/**
 * Vercel Cron — GET /api/cron/moka-push-retry
 * Retry schedules yang gagal push ke Moka (external_id = 'booking:...' or IS NULL).
 * Dipanggil dari cron-job.org setiap 15 menit.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */

const { createClient } = require('@supabase/supabase-js');
const { pushScheduleToMoka } = require('../../server/moka/sync');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

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

    const now     = new Date();
    const ceiling = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 jam ke depan

    // Schedules yang belum dapat Moka order ID
    const { data: nullMissed } = await supabase
      .from('schedules')
      .select('id')
      .is('external_id', null)
      .eq('source', 'web')
      .in('status', ['reserved', 'confirmed'])
      .gte('start_time', now.toISOString())
      .lte('start_time', ceiling.toISOString());

    const { data: bridgeMissed } = await supabase
      .from('schedules')
      .select('id')
      .like('external_id', 'booking:%')
      .eq('source', 'web')
      .in('status', ['reserved', 'confirmed'])
      .gte('start_time', now.toISOString())
      .lte('start_time', ceiling.toISOString());

    const scheduleIds = [
      ...((nullMissed || []).map(s => s.id)),
      ...((bridgeMissed || []).map(s => s.id)),
    ];

    if (!scheduleIds.length) {
      return res.status(200).json({ ok: true, retried: 0, message: 'No pending schedules' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const id of scheduleIds) {
      try {
        await pushScheduleToMoka(supabase, id);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ id, error: err.message });
        console.error(`[MokaPushRetry] Schedule ${id} failed:`, err.message);
      }
    }

    console.log(`[MokaPushRetry] Retried ${scheduleIds.length}: ${results.success} OK, ${results.failed} failed`);

    return res.status(200).json({
      ok: true,
      retried: scheduleIds.length,
      ...results,
    });
  } catch (err) {
    console.error('[MokaPushRetry] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
