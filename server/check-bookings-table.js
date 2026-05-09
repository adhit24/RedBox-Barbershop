'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Cek bookings table (old system) hari ini
  const { data, error } = await sb
    .from('bookings')
    .select('id, name, wa, service, barber_id, date, time, location, status, created_at')
    .gte('created_at', '2026-05-07T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);

  console.log(`=== bookings table hari ini (${data?.length || 0}) ===`);
  for (const b of (data || [])) {
    const c = new Date(b.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`  ${b.name} | ${b.date} ${b.time} | barber:${b.barber_id || '-'} | loc:${b.location}`);
    console.log(`    wa:${b.wa} | status:${b.status} | created:${c}`);
    console.log();
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
