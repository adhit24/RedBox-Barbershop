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
const { notifyBarberHomeServiceReminderH1 } = require('../../server/services/waNotification');

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

// Home Service Helper Functions
function _fmtTime(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function _fmtTimeOnly(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit',
  });
}

async function sendHomeServiceReminders(supabase) {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  // Find confirmed home service jobs where:
  // 1. Booking time is in ~1 hour (between now + 55 mins and now + 65 mins to handle cron timing)
  // 2. We haven't sent the reminder yet
  const { data: jobs, error: jobsError } = await supabase
    .from('home_service_jobs')
    .select('id, address, schedule_id, barber_reminded_at')
    .eq('status', 'confirmed')
    .is('barber_reminded_at', null);

  if (jobsError) {
    console.error('[HomeServiceReminder] Error fetching jobs:', jobsError.message);
    return;
  }

  if (!jobs?.length) {
    console.log('[HomeServiceReminder] No jobs to remind');
    return;
  }

  for (const job of jobs) {
    try {
      // Get schedule details
      const { data: sch, error: schError } = await supabase
        .from('schedules')
        .select('start_time, price, service_name, barber_id, customers(name)')
        .eq('id', job.schedule_id)
        .single();

      if (schError || !sch) {
        console.warn(`[HomeServiceReminder] Schedule not found for job ${job.id}`);
        continue;
      }

      const scheduleTime = new Date(sch.start_time);
      const timeDiff = scheduleTime.getTime() - now.getTime();
      const minutesUntil = timeDiff / 1000 / 60;

      // Only send if between 55 and 65 minutes from now
      if (minutesUntil < 55 || minutesUntil > 65) {
        continue;
      }

      // Get barber details
      const { data: barber, error: barberError } = await supabase
        .from('barbers')
        .select('name, phone')
        .eq('id', sch.barber_id)
        .single();

      if (barberError || !barber?.phone) {
        console.warn(`[HomeServiceReminder] Barber not found or no phone for job ${job.id}`);
        continue;
      }

      // Send the reminder
      await notifyBarberHomeServiceReminderH1({
        barberPhone: barber.phone,
        barberName: barber.name,
        customerName: sch.customers?.name || 'Pelanggan',
        dateStr: _fmtTime(sch.start_time),
        timeStr: _fmtTimeOnly(sch.start_time),
        address: job.address,
        serviceLabel: sch.service_name || 'Home Service',
        price: sch.price ? `Rp ${sch.price.toLocaleString('id-ID')}` : '-',
      });

      // Mark reminder as sent
      await supabase.from('home_service_jobs')
        .update({ barber_reminded_at: new Date().toISOString() })
        .eq('id', job.id);

      console.log(`[HomeServiceReminder] Reminder sent to barber ${barber.name} for job ${job.id}`);
    } catch (err) {
      console.error(`[HomeServiceReminder] Error processing job ${job.id}:`, err.message);
    }
  }
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

    // Run home service reminders
    try {
      console.log('[RemindSoon] Running home service reminders...');
      await sendHomeServiceReminders(supabase);
    } catch (err) {
      console.error('[RemindSoon] Home service reminder error:', err.message);
    }

    return res.status(200).json({ sent, failed, date, hourPrefix, total: bookings.length });

  } catch (err) {
    console.error('[RemindSoon] Unexpected error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
