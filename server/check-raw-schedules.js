'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Raw schedules table, no joins, semua hari ini
  const { data, error } = await sb
    .from('schedules')
    .select('id, outlet_id, barber_id, customer_id, service_name, start_time, status, source, external_id, notes, created_at')
    .gte('created_at', '2026-05-07T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);

  console.log(`=== Raw schedules hari ini (${data?.length || 0}) ===`);
  for (const s of (data || [])) {
    const t = new Date(s.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const c = new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`  [${s.source}] status:${s.status} | jam:${t} | barber_id:${s.barber_id || '-'} | customer_id:${s.customer_id || '-'}`);
    console.log(`    ext:${s.external_id || '-'} | created:${c}`);
    console.log(`    notes: ${(s.notes || '-').slice(0, 60)}`);
    console.log();
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
