'use strict';
const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');
const { notifyBarberHomeServiceReminderH1 } = require('../../server/services/waNotification');

const ADMIN_PHONE = process.env.WA_ADMIN_NUMBER;

function _db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function _shortId(uuid) {
  return uuid.slice(0, 8).toUpperCase();
}

function _fmtTime(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function _fmtTimeOnly(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit',
  });
}

async function _sendAdminAlert(job, barberName, reason) {
  if (!ADMIN_PHONE) return;
  const label = reason === 'barber_no_show' ? 'Kapster tidak berangkat' : 'Pelanggan tidak konfirmasi';
  await sendWA(ADMIN_PHONE,
`⚠️ *FLAG HOME SERVICE*

Job    : HS-${_shortId(job.id)}
Kapster: ${barberName}
Alasan : ${label}
Waktu  : ${job._startTime}
Alamat : ${job.address}`
  ).catch(() => {});
}

// ==================== HOME SERVICE REMINDER ====================
async function sendHomeServiceReminders(supabase) {
  const now = new Date();
  const nowWIB = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  console.log(`[HomeServiceReminder] Now (UTC): ${now.toISOString()}, Now (WIB): ${nowWIB.toISOString()}`);

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

  console.log(`[HomeServiceReminder] Found ${jobs.length} candidate jobs`);

  for (const job of jobs) {
    try {
      console.log(`[HomeServiceReminder] Processing job ${job.id}`);
      
      const { data: sch, error: schError } = await supabase
        .from('schedules')
        .select('start_time, price, service_name, barber_id, customers(name)')
        .eq('id', job.schedule_id)
        .single();

      if (schError || !sch) {
        console.warn(`[HomeServiceReminder] Schedule not found for job ${job.id}`, schError?.message);
        continue;
      }

      console.log(`[HomeServiceReminder] Job ${job.id}: schedule.start_time = ${sch.start_time}`);

      let scheduleTime;
      try {
        scheduleTime = new Date(sch.start_time);
        if (isNaN(scheduleTime.getTime())) {
          console.warn(`[HomeServiceReminder] Invalid start_time for job ${job.id}: ${sch.start_time}`);
          continue;
        }
      } catch (err) {
        console.warn(`[HomeServiceReminder] Error parsing start_time for job ${job.id}:`, err.message);
        continue;
      }

      const timeDiff = scheduleTime.getTime() - now.getTime();
      const minutesUntil = timeDiff / 1000 / 60;

      console.log(`[HomeServiceReminder] Job ${job.id}: time until booking = ${minutesUntil.toFixed(1)} minutes`);

      if (minutesUntil < 55 || minutesUntil > 65) {
        console.log(`[HomeServiceReminder] Job ${job.id}: skipping (not in 55-65 min window)`);
        continue;
      }

      const { data: barber, error: barberError } = await supabase
        .from('barbers')
        .select('name, phone')
        .eq('id', sch.barber_id)
        .single();

      if (barberError || !barber?.phone) {
        console.warn(`[HomeServiceReminder] Barber not found or no phone for job ${job.id}`);
        continue;
      }

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

      await supabase.from('home_service_jobs')
        .update({ barber_reminded_at: new Date().toISOString() })
        .eq('id', job.id);

      console.log(`[HomeServiceReminder] Reminder sent to barber ${barber.name} for job ${job.id}`);
    } catch (err) {
      console.error(`[HomeServiceReminder] Error processing job ${job.id}:`, err.message);
    }
  }
}

// Flag jobs where kapster didn't reply BERANGKAT within 30 min of booking time
async function flagNoShows(supabase) {
  const { data: jobs } = await supabase
    .from('home_service_jobs')
    .select('id, address, schedule_id')
    .eq('status', 'confirmed')
    .is('barber_enroute_at', null);

  for (const job of jobs || []) {
    const { data: sch } = await supabase
      .from('schedules')
      .select('start_time, barbers(name)')
      .eq('id', job.schedule_id)
      .single();
    if (!sch) continue;

    const deadline = new Date(sch.start_time).getTime() + 30 * 60 * 1000;
    if (Date.now() < deadline) continue;

    await supabase.from('home_service_jobs').update({
      status: 'flagged', flag_reason: 'barber_no_show', flagged_at: new Date().toISOString(),
    }).eq('id', job.id);

    await _sendAdminAlert(
      { ...job, _startTime: _fmtTime(sch.start_time) },
      sch.barbers?.name || 'Unknown',
      'barber_no_show'
    );
  }
}

// Flag jobs where customer didn't reply YA within 45 min after kapster said SELESAI
async function flagCustomerNoConfirm(supabase) {
  const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();

  const { data: jobs } = await supabase
    .from('home_service_jobs')
    .select('id, address, schedule_id, barber_done_at')
    .eq('status', 'done_barber')
    .is('customer_confirmed_at', null)
    .lt('barber_done_at', cutoff);

  for (const job of jobs || []) {
    await supabase.from('home_service_jobs').update({
      status: 'flagged', flag_reason: 'customer_no_confirm', flagged_at: new Date().toISOString(),
    }).eq('id', job.id);

    const { data: sch } = await supabase
      .from('schedules')
      .select('start_time, barbers(name)')
      .eq('id', job.schedule_id)
      .single();

    await _sendAdminAlert(
      { ...job, _startTime: _fmtTime(sch?.start_time) },
      sch?.barbers?.name || 'Unknown',
      'customer_no_confirm'
    );
  }
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = _db();
    console.log('[HomeServiceTasks] Starting...');
    await sendHomeServiceReminders(supabase);
    await flagNoShows(supabase);
    await flagCustomerNoConfirm(supabase);
    console.log('[HomeServiceTasks] Completed');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Cron/HomeServiceFlag]', err.message);
    res.status(500).json({ error: err.message });
  }
};
