'use strict';
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const DATE = '2026-06-16';

function toWIB(s) { return new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }); }

async function main() {
  // 1. Status schedule yang tadi di-cancel
  const { data: sched } = await supabase
    .from('schedules').select('id, status, start_time, end_time')
    .eq('id', 'd89fad27-4c2e-440a-b8e4-7c30892a039d').single();
  console.log('Schedule d89fad27 status:', sched?.status, '| start:', sched ? toWIB(sched.start_time) : '-');

  // 2. SEMUA schedules aktif Ubay hari ini
  const { data: scheds } = await supabase
    .from('schedules').select('id, barber_id, start_time, end_time, status, external_id, source')
    .eq('outlet_id', 'd0c665ff-d2d1-4f78-be76-2b1e0619fbaa')
    .eq('barber_id', 'csb-ubay')
    .not('status', 'in', '("cancelled")')
    .lt('start_time', `${DATE}T23:59:59+07:00`)
    .gt('end_time',   `${DATE}T00:00:00+07:00`);
  console.log('\nSchedules aktif Ubay hari ini:', scheds?.length || 0);
  scheds?.forEach(s => console.log(`  [${s.status}] ${toWIB(s.start_time)} → ${toWIB(s.end_time)} ext=${s.external_id}`));

  // 3. Outlet-wide blocks (barber_id=null)
  const { data: wide } = await supabase
    .from('schedules').select('id, start_time, end_time, status, external_id')
    .eq('outlet_id', 'd0c665ff-d2d1-4f78-be76-2b1e0619fbaa')
    .is('barber_id', null)
    .not('status', 'in', '("cancelled")')
    .lt('start_time', `${DATE}T23:59:59+07:00`)
    .gt('end_time',   `${DATE}T00:00:00+07:00`);
  console.log('\nOutlet-wide blocks (barber_id=null):', wide?.length || 0);
  wide?.forEach(s => console.log(`  [${s.status}] ${toWIB(s.start_time)} → ${toWIB(s.end_time)} ext=${s.external_id}`));

  // 4. Bookings aktif Ubay hari ini
  const { data: books } = await supabase
    .from('bookings').select('id, time, duration, status, customer_id')
    .eq('barber_id', 'csb-ubay').eq('date', DATE)
    .not('status', 'in', '("cancelled","rejected")');
  console.log('\nBookings aktif Ubay hari ini:', books?.length || 0);
  books?.forEach(b => console.log(`  [${b.status}] ${String(b.time).slice(0,5)} dur=${b.duration}`));

  // 5. Cek apakah slot 16:00 overlap dengan sesuatu
  const slot16s = new Date(`${DATE}T16:00:00+07:00`).getTime();
  const slot16e = new Date(`${DATE}T17:00:00+07:00`).getTime();
  console.log('\n--- Overlap check jam 16:00 ---');
  [...(scheds||[]), ...(wide||[])].forEach(s => {
    const bs = new Date(s.start_time).getTime();
    const be = new Date(s.end_time).getTime();
    if (slot16s < be && slot16e > bs)
      console.log(`❌ OVERLAP: [${s.status}] ${toWIB(s.start_time)} → ${toWIB(s.end_time)} ext=${s.external_id}`);
  });
  (books||[]).forEach(b => {
    const timeStr = String(b.time).slice(0,5);
    const bs = new Date(`${DATE}T${timeStr}:00+07:00`).getTime();
    const be = bs + 60*60*1000;
    if (slot16s < be && slot16e > bs)
      console.log(`❌ BOOKING OVERLAP: [${b.status}] ${timeStr}`);
  });
  console.log('(selesai overlap check)');
}
main().catch(console.error);
