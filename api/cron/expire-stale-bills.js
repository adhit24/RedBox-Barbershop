/**
 * Vercel Cron — GET /api/cron/expire-stale-bills
 * Runs every 15 minutes.
 *
 * Expires stale "reserved" Moka open bill schedules that are blocking slots.
 *
 * Null-barber (outlet-wide) blocks — expire jika SALAH SATU terpenuhi:
 *   a) end_time + 1h sudah lewat  (service sudah selesai, kasir lupa close)
 *   b) created_at + 2h sudah lewat  (unmatched terlalu lama, bisa blokir lintas hari)
 *
 * Per-barber blocks — expire jika end_time + 4h sudah lewat.
 *   Hanya blokir 1 kapster; window lebih panjang aman.
 *
 * Env vars:
 *   MOKA_OPENBILL_OUTLET_WIDE_STALE_HOURS  default 1  (jam setelah end_time)
 *   MOKA_OPENBILL_UNMATCHED_HOURS          default 2  (jam setelah created_at)
 *   MOKA_OPENBILL_STALE_HOURS              default 4  (per-barber)
 */

const { createClient } = require('@supabase/supabase-js');

const STALE_OUTLET_WIDE = Math.max(1, parseInt(process.env.MOKA_OPENBILL_OUTLET_WIDE_STALE_HOURS || '1', 10) || 1);
const STALE_UNMATCHED   = Math.max(1, parseInt(process.env.MOKA_OPENBILL_UNMATCHED_HOURS          || '2', 10) || 2);
const STALE_PER_BARBER  = Math.max(1, parseInt(process.env.MOKA_OPENBILL_STALE_HOURS              || '4', 10) || 4);

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

    // ── 1. Outlet-wide blocks (barber_id IS NULL) ─────────────────────────
    // Expire jika SALAH SATU terpenuhi:
    //   a) end_time + STALE_OUTLET_WIDE jam sudah lewat (kasir lupa close setelah selesai)
    //   b) created_at + STALE_UNMATCHED jam sudah lewat (unmatched terlalu lama —
    //      mencegah open bill lintas hari terus blokir semua kapster)
    const cutoffOutletWide = new Date(now - STALE_OUTLET_WIDE * 60 * 60 * 1000).toISOString();
    const cutoffUnmatched  = new Date(now - STALE_UNMATCHED   * 60 * 60 * 1000).toISOString();
    const { data: expiredOutletWide, error: err1 } = await supabase
      .from('schedules')
      .update({ status: 'cancelled', notes: '[auto] stale outlet-wide open bill — kasir lupa close di MokaPOS' })
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .is('barber_id', null)
      .or(`end_time.lt.${cutoffOutletWide},created_at.lt.${cutoffUnmatched}`)
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
