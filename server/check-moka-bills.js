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

  // Check sync_bills — shows open bills on Moka POS
  const res = await fetch(`${base}/v1/outlets/${mokaOutletId}/sync_bills/`, { headers });
  const json = await res.json();

  console.log(`HTTP ${res.status} — ${(json?.data || []).length} bills`);
  for (const bill of (json?.data || [])) {
    console.log(`\n  Bill ID: ${bill.id} | Name: ${bill.name || '-'} | Status: ${bill.status || '-'}`);
    console.log(`  Items: ${(bill.items || bill.order_items || []).map(i => i.name || i.item_name).join(', ')}`);
    console.log(`  Created: ${bill.created_at || bill.client_created_at || '-'}`);
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
