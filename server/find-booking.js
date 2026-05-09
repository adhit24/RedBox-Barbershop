'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Cari booking hari ini untuk outlet bypass, barber Abdul, jam 20:00
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  
  const { data, error } = await sb
    .from('schedules_full')
    .select('id, customer_name, customer_phone, barber_name, service_name, start_time, status, source, external_id, created_at')
    .gte('created_at', todayStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);

  console.log(`=== Semua schedule hari ini (${data?.length || 0} entries) ===`);
  for (const s of (data || [])) {
    const startWIB = new Date(s.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const createdWIB = new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`  ${s.customer_name || '(no name)'} | barber: ${s.barber_name || '-'} | jam: ${startWIB}`);
    console.log(`    status: ${s.status} | source: ${s.source} | ext_id: ${s.external_id || '-'}`);
    console.log(`    created: ${createdWIB} | phone: ${s.customer_phone || '-'}`);
    console.log();
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
// already defined above, run additional check
