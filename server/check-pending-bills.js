'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').limit(1);
  const { data: outlet } = await sb.from('outlets').select('moka_outlet_id').eq('slug', 'bypass').single();

  const token = tokens?.[0]?.access_token;
  const mokaId = outlet?.moka_outlet_id;

  const today = new Date().toISOString().slice(0,10);
  const [y,m,d] = today.split('-');
  const fmt = `${d}/${m}/${y}`;
  const res = await fetch(`https://api.mokapos.com/v1/outlets/${mokaId}/sync_bills/?statuses=PENDING&start=${fmt}&end=${fmt}&per_page=5&deep=true`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  const bills = json?.data || [];
  console.log('PENDING bills today:', bills.length);
  if (bills[0]) {
    console.log('First bill sample:');
    console.log(JSON.stringify(bills[0], null, 2).slice(0, 2000));
  } else {
    console.log('No pending bills. Meta:', JSON.stringify(json?.meta));
  }

  // Also check Report API for recent transactions
  const since = new Date(Date.now() - 2*60*60*1000).toISOString();
  const repRes = await fetch(`https://api.mokapos.com/v3/outlets/${mokaId}/reports/get_latest_transactions?limit=3&updated_since=${since}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const repJson = await repRes.json();
  const orders = repJson?.data || repJson?.orders || [];
  const orderArr = Array.isArray(orders) ? orders : (orders ? [orders] : []);
  console.log('\nReport API recent transactions:', orderArr.length);
  if (orderArr[0]) {
    console.log('First order sample:');
    console.log(JSON.stringify(orderArr[0], null, 2).slice(0, 1500));
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
