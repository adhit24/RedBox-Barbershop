'use strict';
const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

const ADMIN_PHONE = process.env.WA_ADMIN_NUMBER;

function _db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
    await flagNoShows(supabase);
    await flagCustomerNoConfirm(supabase);
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Cron/HomeServiceFlag]', err.message);
    res.status(500).json({ error: err.message });
  }
};
