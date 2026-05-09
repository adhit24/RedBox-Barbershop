'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').limit(1);
  const { data: outlet } = await sb.from('outlets').select('moka_outlet_id').eq('slug', 'bypass').single();

  const token = tokens?.[0]?.access_token;
  const base  = 'https://api.mokapos.com';
  const mokaId = outlet?.moka_outlet_id;
  const headers = { 'Authorization': `Bearer ${token}` };

  const res  = await fetch(`${base}/v1/outlets/${mokaId}/items`, { headers });
  const json = await res.json();
  const items = json?.data?.items || json?.data || [];

  console.log(`\nTotal items: ${items.length}\n`);
  for (const item of items) {
    const price = item.item_variants?.[0]?.price ?? item.price ?? '-';
    console.log(`ID: ${item.id}  | Rp ${price}  | ${item.name}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
