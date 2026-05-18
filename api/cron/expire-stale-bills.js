/**
 * Vercel Cron — GET /api/cron/expire-stale-bills
 * Runs every 15 minutes.
 *
 * Expires stale "reserved" Moka open bill schedules that are blocking slots.
 * Two windows:
 *   - barber_id IS NULL  (outlet-wide block): end_time + 1h
 *     Blokir semua kapster — harus cepat expire setelah service selesai.
 *   - barber_id IS NOT NULL (per-barber block): end_time + 4h (configurable)
 *     Lebih lama; kasir mungkin lupa close bill tapi hanya blokir 1 kapster.
 *
 * Env vars:
 *   MOKA_OPENBILL_OUTLET_WIDE_STALE_HOURS  default 1
 *   MOKA_OPENBILL_STALE_HOURS              default 4
 */

const { createClient } = require('@supabase/supabase-js');

const STALE_OUTLET_WIDE = Math.max(1, parseInt(process.env.MOKA_OPENBILL_OUTLET_WIDE_STALE_HOURS || '1', 10) || 1);
const STALE_PER_BARBER  = Math.max(1, parseInt(process.env.MOKA_OPENBILL_STALE_HOURS || '4', 10) || 4);

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

    const now = Date.now();

    // ── 1. Outlet-wide blocks (barber_id IS NULL) — window lebih pendek ──
    const cutoffOutletWide = new Date(now - STALE_OUTLET_WIDE * 60 * 60 * 1000).toISOString();
    const { data: expiredOutletWide, error: err1 } = await supabase
      .from('schedules')
      .update({ status: 'cancelled', notes: '[auto] stale outlet-wide open bill — kasir lupa close di MokaPOS' })
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .is('barber_id', null)
      .lt('end_time', cutoffOutletWide)
      .select('id');

    if (err1) console.error('[ExpireStale] outlet-wide error:', err1.message);

    // ── 2. Per-barber blocks (barber_id IS NOT NULL) — window lebih panjang ──
    const cutoffPerBarber = new Date(now - STALE_PER_BARBER * 60 * 60 * 1000).toISOString();
    const { data: expiredPerBarber, error: err2 } = await supabase
      .from('schedules')
      .update({ status: 'cancelled', notes: '[auto] stale open bill — kasir lupa close di MokaPOS' })
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .not('barber_id', 'is', null)
      .lt('end_time', cutoffPerBarber)
      .select('id');

    if (err2) console.error('[ExpireStale] per-barber error:', err2.message);

    const outletWideCount = expiredOutletWide?.length || 0;
    const perBarberCount  = expiredPerBarber?.length || 0;

    if (outletWideCount) console.log(`[ExpireStale] Expired ${outletWideCount} outlet-wide block(s)`);
    if (perBarberCount)  console.log(`[ExpireStale] Expired ${perBarberCount} per-barber block(s)`);

    return res.status(200).json({
      ok: true,
      expired: { outletWide: outletWideCount, perBarber: perBarberCount },
      windows:  { outletWideHours: STALE_OUTLET_WIDE, perBarberHours: STALE_PER_BARBER },
    });
  } catch (err) {
    console.error('[ExpireStale] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
