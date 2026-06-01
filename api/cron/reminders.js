/**
 * Cron — GET /api/cron/reminders
 * Runs daily at 10:00 WIB via cron-job.org.
 * Sends WhatsApp H-1 booking reminder to customers with appointments tomorrow.
 * Re-engagement batch dipindah ke /api/cron/reengagement (endpoint terpisah).
 */

const { createClient } = require('@supabase/supabase-js');
const { notifyCustomerReminderH1 } = require('../../server/services/waNotification');

function tomorrowWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tom = new Date(wib);
  tom.setUTCDate(tom.getUTCDate() + 1);
  const y = tom.getUTCFullYear();
  const m = String(tom.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tom.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tomorrow = tomorrowWIB();
  console.log(`[Reminders] Checking bookings for ${tomorrow}`);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, name, wa, service, time, date, location, barber_id')
      .eq('date', tomorrow)
      .eq('status', 'confirmed')
      .eq('remind_h1_sent', false)
      .not('wa', 'is', null);

    if (error) {
      console.error('[Reminders] DB error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!bookings || bookings.length === 0) {
      console.log('[Reminders] No bookings tomorrow.');
      return res.status(200).json({ sent: 0, date: tomorrow });
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

      try {
        const result = await notifyCustomerReminderH1({ ...booking, barber_name: barberName });
        // Fonnte returns { status: false, reason: ... } on soft failure — treat as failure
        if (result && result.status === false) {
          failed++;
          console.error(`[Reminders] Fonnte rejected ${booking.wa} (${booking.name}): ${JSON.stringify(result)}`);
        } else {
          sent++;
          console.log(`[Reminders] Sent to ${booking.wa} (${booking.name})`);
          // Mark as reminded to prevent duplicate sends across Vercel instances
          await supabase.from('bookings').update({ remind_h1_sent: true }).eq('id', booking.id);
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[Reminders] Failed for ${booking.wa}:`, err.message);
      }
    }

    console.log(`[Reminders] Done. Sent: ${sent}, Failed: ${failed}`);
    return res.status(200).json({ sent, failed, date: tomorrow, total: bookings.length });

  } catch (err) {
    console.error('[Reminders] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
