
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const today = '2026-06-02';
  
  // 1. Cek outlet bypass UUID
  const { data: outlet } = await supabase
    .from('outlets')
    .select('id, name, slug')
    .eq('slug', 'bypass')
    .single();
  
  console.log('1. Outlet Bypass:', outlet);
  
  // 2. Cek barber dengan nama "Dodi" di outlet bypass
  const { data: barbers } = await supabase
    .from('barbers')
    .select('*')
    .ilike('name', '%dodi%')
    .eq('outlet_id', outlet?.id);
  
  console.log('\n2. Barber Dodi:', barbers);
  
  if (!barbers?.length) {
    console.log('Tidak ditemukan barber dengan nama Dodi!');
    return;
  }

  const dodi = barbers[0];
  
  // 3. Cek working hours Dodi hari ini
  const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=Sun, 6=Sat
  const { data: workingHours } = await supabase
    .from('barber_working_hours')
    .select('*')
    .eq('barber_id', dodi.id)
    .eq('day_of_week', dayOfWeek);
  
  console.log(`\n3. Working Hours Dodi (day ${dayOfWeek}):`, workingHours);
  
  // 4. Cek work_days di tabel barbers
  console.log(`\n4. work_days Dodi di tabel barbers:`, dodi.work_days);
  
  // 5. Cek schedules untuk hari ini
  const dayStart = `${today}T00:00:00+07:00`;
  const dayEnd = `${today}T23:59:59+07:00`;
  
  const { data: allSchedules } = await supabase
    .from('schedules')
    .select('*')
    .eq('outlet_id', outlet.id)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .not('status', 'in', '("cancelled")');
  
  console.log(`\n5. All schedules untuk ${today}:`, allSchedules?.length || 0);
  
  const { data: dodiSchedules } = await supabase
    .from('schedules')
    .select('*')
    .eq('outlet_id', outlet.id)
    .eq('barber_id', dodi.id)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .not('status', 'in', '("cancelled")');
  
  console.log(`\n6. Schedules Dodi untuk ${today}:`, dodiSchedules?.length || 0);
  console.log(dodiSchedules);
}

main().catch(console.error);
