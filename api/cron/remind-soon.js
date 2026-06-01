/**
 * Vercel Cron — GET /api/cron/remind-soon
 * Runs every hour at :00 UTC (= every hour WIB).
 * 1. Finds bookings starting in the NEXT hour (WIB) and sends a "1 jam lagi!" reminder to customers.
 * 2. Finds home service jobs starting in ~1 hour and sends reminder to barber.
 *
 * Example: cron fires at 07:00 UTC (14:00 WIB)
 *   → finds bookings with date=today & time starts with "15:" (15:00–15:59 WIB)
 *   → sends reminder to those customers
 */

const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

/** Returns { date: 'YYYY-MM-DD', hourPrefix: 'HH' } in WIB for the *next* hour */
function nextHourWIB() {
  const now = new Date();
  // Shift to WIB (UTC+7)
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const currentHourWIB = wib.getUTCHours();
  const nextHourWIB = currentHourWIB + 1;

  // If next hour rolls past midnight, bookings would be on the next day —
  // skip to avoid false matches (D-1 reminder already covers that window).
  if (nextHourWIB >= 24) return null;

  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  const date = `${y}-${m}-${d}`;
  const hourPrefix = String(nextHourWIB).padStart(2, '0');

  return { date, hourPrefix };
}

const BRANCH_LABELS = {
  bypass:    'RedBox Bypass (Pusat)',
  samadikun: 'RedBox Samadikun',
  csb:       'RedBox CSB Mall',
  sumber:    'RedBox Sumber',
  tegal:     'RedBox Tegal',
};

function branchLabel(location) {
  return BRANCH_LABELS[String(location || '').toLowerCase()] || 'RedBox Barbershop';
}

function buildSoonMessage(booking, barberName) {
  const { name, service, time, location } = booking;
  const fn = (name || 'Kak').split(' ')[0];
  const branch = branchLabel(location);

  return `Hai kak ${fn}! Mau ngingetin — *1 jam lagi* kamu ada jadwal nih! 😊\n\n📍 *${branch}*\n⏰ Jam *${time} WIB*\n✂️ *${service}*${barberName ? `\n💈 Kapster: *${barberName}*` : ''}\n\nBrangkat sekarang biar santai ya kak, jangan rush! 😄`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const window = nextHourWIB();

  if (!window) {
    console.log('[RemindSoon] Next hour is past midnight, skipping.');
    return res.status(200).json({ sent: 0, reason: 'past midnight' });
  }

  const { date, hourPrefix } = window;
  console.log(`[RemindSoon] Looking for bookings on ${date} at ${hourPrefix}:xx WIB`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Match bookings in the next hour (e.g. 17:00–17:59).
    // Use gte/lte instead of like — `time without time zone` doesn't support LIKE.
    // barber_id fetched separately below to avoid FK join failure crashing the whole cron.
    // Only confirmed bookings; skip already-reminded ones (dedup across Vercel instances).
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, time, date, location, barber_id')
      .eq('date', date)
      .gte('time', `${hourPrefix}:00:00`)
      .lte('time', `${hourPrefix}:59:59`)
      .eq('status', 'confirmed')
      .eq('remind_soon_sent', false)
      .not('wa', 'is', null);

    if (error) {
      console.error('[RemindSoon] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!bookings || bookings.length === 0) {
      console.log(`[RemindSoon] No bookings at ${hourPrefix}:xx today.`);
      return res.status(200).json({ sent: 0, date, hourPrefix });
    }

    // Bulk fetch barber names — non-blocking: if it fails, reminders still send without kapster name.
    const barberMap = {};
    const barberIds = [...new Set(bookings.map(b => b.barber_id).filter(Boolean))];
    if (barberIds.length) {
      const { data: barbers } = await supabase
        .from('barbers').select('id, name').in('id', barberIds);
      for (const b of barbers || []) barberMap[b.id] = b.name;
    }

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (!booking.wa) continue;

      const barberName = barberMap[booking.barber_id] || null;
      const msg = buildSoonMessage(booking, barberName);

      try {
        await sendWA(booking.wa, msg);
        sent++;
        console.log(`[RemindSoon] Sent to ${booking.wa} (${booking.name}) for ${booking.time}`);
        // Mark as reminded to prevent duplicate sends across Vercel instances
        await supabase.from('bookings').update({ remind_soon_sent: true }).eq('id', booking.id);
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[RemindSoon] Failed for ${booking.wa}:`, err.message);
      }
    }

    console.log(`[RemindSoon] Done. Sent: ${sent}, Failed: ${failed}`);

    return res.status(200).json({ sent, failed, date, hourPrefix, total: bookings.length });

  } catch (err) {
    console.error('[RemindSoon] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
