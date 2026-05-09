'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').limit(1);
  const { data: outlet } = await sb.from('outlets').select('moka_outlet_id').eq('slug', 'bypass').single();

  const token = tokens?.[0]?.access_token;
  const mokaOutletId = outlet?.moka_outlet_id;
  const base = 'https://api.mokapos.com';
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Get schedule UUIDs for our two bookings (application_order_id = schedule.id)
  const { data: schedules } = await sb
    .from('schedules')
    .select('id, external_id, start_time, barber_id')
    .in('external_id', ['7963818', '7963873']);

  console.log('Schedules found:', schedules?.length || 0);

  for (const sched of (schedules || [])) {
    const appOrderId = sched.id; // This is what we sent as application_order_id to Moka
    const url = `${base}/v1/outlets/${mokaOutletId}/advanced_orderings/orders/${appOrderId}/status`;
    const res = await fetch(url, { headers });
    const json = await res.json();
    console.log(`\nSchedule ${appOrderId} (mokaId: ${sched.external_id}) — HTTP ${res.status}`);
    console.log(JSON.stringify(json?.data || json?.meta, null, 2));
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
