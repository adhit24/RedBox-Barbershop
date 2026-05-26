/**
 * Vercel Cron — GET /api/cron/review-request
 * Schedule: every 30 minutes  ("0,30 * * * *")
 *
 * Finds bookings where service is estimated done + 30 min have passed
 * and no review request has been sent yet, then sends a WhatsApp via Fonnte.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   FONNTE_TOKEN
 *   CRON_SECRET       (optional, recommended)
 *   APP_BASE_URL      (e.g. https://redboxbarbershop.vercel.app)
 */

const { createClient } = require('@supabase/supabase-js');
const { notifyCustomerReviewRequest } = require('../../server/services/waNotification');

// Parse duration strings like "60 menit", "45 menit", "30 menit" → minutes integer
function parseDurationMinutes(durStr) {
  if (!durStr) return 60;
  const m = String(durStr).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 60;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const nowUTC = new Date();
  // Current time in WIB (UTC+7) for log readability
  const nowWIB = new Date(nowUTC.getTime() + 7 * 60 * 60 * 1000);
  console.log(`[ReviewRequest] Cron fired at ${nowWIB.toISOString().replace('T', ' ').slice(0, 16)} WIB`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Fetch confirmed/done bookings that haven't had a review request sent yet
    // Look back max 48h to avoid processing very old bookings
    const cutoffPast = new Date(nowUTC.getTime() - 48 * 60 * 60 * 1000);
    const cutoffDate = cutoffPast.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, date, time, location, barber_id, duration, status')
      .in('status', ['confirmed', 'done'])
      .is('review_sent_at', null)
      .gte('date', cutoffDate)
      .not('wa', 'is', null);

    if (error) {
      console.error('[ReviewRequest] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!bookings || bookings.length === 0) {
      console.log('[ReviewRequest] No eligible bookings found.');
      return res.status(200).json({ sent: 0 });
    }

    // Resolve barber names in bulk
    const barberIds = [...new Set(bookings.map(b => b.barber_id).filter(Boolean))];
    const barberMap = {};
    if (barberIds.length) {
      const { data: barbers } = await supabase
        .from('barbers').select('id, name').in('id', barberIds);
      for (const b of barbers || []) barberMap[b.id] = b.name;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (!booking.wa) { skipped++; continue; }

      // Calculate when the review request should fire:
      // booking_start (WIB) + service_duration + 30 min
      const durationMin = parseDurationMinutes(booking.duration);
      const bookingStartWIB = new Date(`${booking.date}T${booking.time}+07:00`);
      const triggerTime = new Date(
        bookingStartWIB.getTime() + (durationMin + 30) * 60 * 1000
      );

      if (nowUTC < triggerTime) {
        // Not yet time
        skipped++;
        continue;
      }

      const barberName = barberMap[booking.barber_id] || null;

      try {
        const result = await notifyCustomerReviewRequest({
          ...booking,
          barber_name: barberName,
        });

        if (result && result.status === false) {
          failed++;
          console.error(`[ReviewRequest] Fonnte rejected ${booking.wa}: ${JSON.stringify(result)}`);
        } else {
          // Mark as sent even on soft failure to avoid infinite retry
          await supabase
            .from('bookings')
            .update({ review_sent_at: nowUTC.toISOString() })
            .eq('id', booking.id);
          sent++;
          console.log(`[ReviewRequest] Sent to ${booking.name} (${booking.wa}) — booking ${booking.id}`);
        }
      } catch (sendErr) {
        failed++;
        console.error(`[ReviewRequest] Send error for ${booking.id}:`, sendErr.message);
      }
    }

    console.log(`[ReviewRequest] Done — sent: ${sent}, skipped: ${skipped}, failed: ${failed}`);
    return res.status(200).json({ sent, skipped, failed });

  } catch (e) {
    console.error('[ReviewRequest] Unexpected error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
