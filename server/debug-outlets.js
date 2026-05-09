'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const today = new Date(); today.setHours(0,0,0,0);
  const [{ data: badSchedules }, { data: outlets }] = await Promise.all([
    sb.from('schedules').select('outlet_id, external_id').is('barber_id', null).eq('source', 'moka')
      .gte('created_at', today.toISOString()).not('external_id', 'is', null).limit(5),
    sb.from('outlets').select('id, name, moka_outlet_id').eq('is_active', true).not('moka_outlet_id', 'is', null),
  ]);

  const outletIds = [...new Set(badSchedules?.map(s => s.outlet_id))];
  console.log('Bad schedule outlet_ids:', outletIds);
  console.log('Outlets available:', outlets?.map(o => `${o.id.slice(0,8)}... ${o.name}`));
  outletIds.forEach(id => {
    const found = outlets?.find(o => o.id === id);
    console.log(`  ${id} → ${found?.name || 'NOT FOUND in outlets table'}`);
  });
  console.log('\nSample bad schedule:', JSON.stringify(badSchedules?.[0]));
}
main().catch(e => { console.error(e.message); process.exit(1); });
