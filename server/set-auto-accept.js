'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Get outlets (for Moka numeric IDs) and tokens
  const [{ data: outlets, error: oErr }, { data: tokens, error: tErr }] = await Promise.all([
    sb.from('outlets').select('id, name, moka_outlet_id').eq('is_active', true),
    sb.from('moka_tokens').select('outlet_id, access_token').limit(1),
  ]);
  if (oErr) throw new Error(oErr.message);
  if (tErr) throw new Error(tErr.message);
  if (!tokens || tokens.length === 0) throw new Error('No tokens found in moka_tokens table');

  const accessToken = tokens[0].access_token;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const base = 'https://api.mokapos.com';

  for (const outlet of outlets) {
    const mokaId = outlet.moka_outlet_id;
    console.log(`\nOutlet: ${outlet.name} (Moka ID: ${mokaId})`);

    // GET current status
    const getRes = await fetch(`${base}/v1/outlets/${mokaId}/advanced_orderings/auto_accept`, { headers });
    const getJson = await getRes.json();
    if (!getRes.ok) {
      console.log('  GET error:', JSON.stringify(getJson?.meta));
      continue;
    }
    console.log('  Current auto_accept_status:', getJson?.data?.auto_accept_status);

    // POST enable auto-accept
    const postRes = await fetch(`${base}/v1/outlets/${mokaId}/advanced_orderings/auto_accept`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ auto_accept_status: true }),
    });
    const postJson = await postRes.json();
    if (postRes.ok) {
      console.log('  ✓ Set auto_accept_status =', postJson?.data?.auto_accept_status);
    } else {
      console.log('  POST error:', JSON.stringify(postJson?.meta));
    }
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
