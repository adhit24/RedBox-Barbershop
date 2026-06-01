'use strict';
const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');
const { notifyBarberHomeServiceReminderH1 } = require('../../server/services/waNotification');

function _db() {
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  return require('@supabase/supabase-js').createClient(
    process.env.SUPABASE_URL,
    supabaseKey
  );
}

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

async function sendReminders() {
  const supabase = _db();
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
};

module.exports = async (req, res) => {
  try {
    await sendReminders();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[HomeServiceReminder] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
