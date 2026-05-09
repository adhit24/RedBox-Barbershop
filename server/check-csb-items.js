'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').limit(1);
  const { data: outlet } = await sb.from('outlets').select('id, moka_outlet_id').eq('slug', 'csb').single();
  const { data: barbers } = await sb.from('barbers').select('id, name, moka_employee_id').eq('outlet_id', outlet.id);

  const token = tokens?.[0]?.access_token;
  const mokaId = outlet.moka_outlet_id; // 216102

  console.log('CSB barbers in DB:');
  barbers?.forEach(b => console.log(`  ${b.name} → moka_employee_id: ${b.moka_employee_id || 'NULL'}`));

  // Fetch Moka items for CSB
  const res = await fetch(`https://api.mokapos.com/v1/outlets/${mokaId}/items?include_variants=true`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  const items = json?.data?.items || json?.data || [];
  console.log(`\nCSB Moka items (${items.length}):`);
  for (const item of items) {
    const variants = (item.item_variants || []).map(v => v.name).join(', ');
    console.log(`  ID: ${item.id} | ${item.name} | variants: ${variants.slice(0, 60) || '-'}`);
  }

  // Fetch one sample PENDING bill from CSB today
  const today = new Date().toISOString().slice(0,10);
  const [y,m,d] = today.split('-');
  const fmt = `${d}/${m}/${y}`;
  const billsRes = await fetch(
    `https://api.mokapos.com/v1/outlets/${mokaId}/sync_bills/?statuses=PENDING&start=${fmt}&end=${fmt}&per_page=3&deep=true`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const billsJson = await billsRes.json();
  const bills = billsJson?.data || [];
  console.log(`\nCSB PENDING bills today: ${bills.length}`);
  if (bills[0]) {
    console.log('Sample:', JSON.stringify(bills[0], null, 2).slice(0, 1500));
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
