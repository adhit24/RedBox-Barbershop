'use strict';
const { isSlotAvailable } = require('../moka/slotEngine');
const { pushScheduleToMoka } = require('../moka/sync');
const { sendWA } = require('../services/fonnte');

async function reschedule(supabase, { jobId, newStartTime }) {
  // 1. Load job
  const { data: job, error: jobErr } = await supabase
    .from('home_service_jobs')
    .select('id, status, address, reschedule_count, schedule_id')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    throw Object.assign(new Error('Job tidak ditemukan'), { statusCode: 404 });
  }
  if (job.status !== 'confirmed') {
    throw Object.assign(new Error('Reschedule hanya bisa dilakukan sebelum kapster berangkat'), { statusCode: 400 });
  }

  // 2. Load old schedule
  const { data: old } = await supabase
    .from('schedules')
    .select('id, start_time, end_time, outlet_id, barber_id, customer_id, service_id, service_name, price, notes')
    .eq('id', job.schedule_id)
    .single();

  // 3. H-1 check (must be > 24 hours from now)
  const hoursUntil = (new Date(old.start_time).getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < 24) {
    throw Object.assign(
      new Error('Reschedule tidak dapat dilakukan kurang dari 24 jam sebelum jadwal.'),
      { statusCode: 400 }
    );
  }

  // 4. Check new slot availability
  const durationMs = new Date(old.end_time) - new Date(old.start_time);
  const newEndTime = new Date(new Date(newStartTime).getTime() + durationMs).toISOString();
  const slotFree   = await isSlotAvailable(supabase, {
    barberId: old.barber_id, startTime: newStartTime, endTime: newEndTime,
  });
  if (!slotFree) {
    throw Object.assign(new Error('Slot baru tidak tersedia. Pilih waktu lain.'), { statusCode: 409 });
  }

  // 5. Cancel old schedule
  await supabase.from('schedules').update({ status: 'cancelled' }).eq('id', old.id);

  // 6. Insert new schedule
  const { data: newSch } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    old.outlet_id,
      barber_id:    old.barber_id,
      customer_id:  old.customer_id,
      service_id:   old.service_id,
      service_name: old.service_name,
      price:        old.price,
      start_time:   newStartTime,
      end_time:     newEndTime,
      status:       'confirmed',
      source:       'web',
      notes:        old.notes,
      type:         'home_service',
    })
    .select()
    .single();

  // 7. Update home_service_jobs to point to new schedule
  await supabase.from('home_service_jobs')
    .update({ schedule_id: newSch.id, reschedule_count: (job.reschedule_count || 0) + 1 })
    .eq('id', jobId);

  // 8. Push to Moka (non-blocking)
  pushScheduleToMoka(supabase, newSch.id).catch(err =>
    console.error('[Reschedule] Moka push failed:', err.message)
  );

  // 9. Notify barber & customer
  const [barberRes, customerRes] = await Promise.all([
    supabase.from('barbers').select('name, phone').eq('id', old.barber_id).single(),
    supabase.from('customers').select('name, phone').eq('id', old.customer_id).single(),
  ]);

  const dtStr = new Date(newStartTime).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  if (barberRes.data?.phone) {
    sendWA(barberRes.data.phone,
      `📅 *Reschedule Home Service*\n\nJadwal kamu telah diubah:\n${dtStr} WIB\nAlamat: ${job.address}`
    ).catch(() => {});
  }
  if (customerRes.data?.phone) {
    sendWA(customerRes.data.phone,
      `📅 *Reschedule Berhasil*\n\nJadwal baru kamu:\n${dtStr} WIB\n\nKapster akan hadir sesuai jadwal baru. ✂️`
    ).catch(() => {});
  }

  return { jobId, newScheduleId: newSch.id, rescheduleCount: (job.reschedule_count || 0) + 1 };
}

module.exports = { reschedule };
