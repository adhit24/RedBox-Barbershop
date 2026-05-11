const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const date = '2026-05-10';
  
  // 1. Cek outlet bypass UUID
  const { data: outlet } = await supabase
    .from('outlets')
    .select('id, name, slug')
    .eq('slug', 'bypass')
    .single();
  
  console.log('Outlet Bypass:', outlet);
  
  // 2. Cek barber Kaji dodi
  const { data: barber } = await supabase
    .from('barbers')
    .select('id, name, outlet_id')
    .ilike('name', '%dodi%')
    .eq('outlet_id', outlet.id);
  
  console.log('\nBarber Dodi:', barber);
  
  // 3. Cek schedules untuk tanggal 10/05
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59+07:00`;
  
  const { data: allSchedules } = await supabase
    .from('schedules')
    .select('id, barber_id, start_time, end_time, status, external_id, service_name')
    .eq('outlet_id', outlet.id)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .not('status', 'in', '("cancelled")');
  
  console.log(`\nAll schedules for ${date}:`, allSchedules?.length || 0);
  console.log(allSchedules);
  
  // 4. Cek spesifik untuk barber Dodi
  if (barber && barber.length > 0) {
    const barberId = barber[0].id;
    const { data: dodiSchedules } = await supabase
      .from('schedules')
      .select('id, barber_id, start_time, end_time, status, external_id, service_name')
      .eq('outlet_id', outlet.id)
      .eq('barber_id', barberId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .not('status', 'in', '("cancelled")');
    
    console.log(`\nDodi schedules for ${date}:`, dodiSchedules?.length || 0);
    console.log(dodiSchedules);
  }
  
  // 5. Cek schedules dengan external_id yang match open bills
  const billIds = ['625020175', '625228980', '625229054', '625230883'];
  const { data: billSchedules } = await supabase
    .from('schedules')
    .select('id, barber_id, start_time, end_time, status, external_id, service_name, outlet_id')
    .in('external_id', billIds);
  
  console.log('\nSchedules for open bills:');
  console.log(billSchedules);
}

main().catch(console.error);
