'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main() {
  // Get bypass outlet with its specific token
  const { data: outlet } = await supabase
    .from('outlets').select('id, slug, moka_outlet_id').eq('slug', 'bypass').single();

  const { data: tok } = await supabase
    .from('moka_tokens').select('access_token, expires_at').eq('outlet_id', outlet.id).single();

  console.log(`Bypass outlet UUID: ${outlet.id}`);
  console.log(`Bypass moka_outlet_id: ${outlet.moka_outlet_id}`);
  console.log(`Token expires: ${tok?.expires_at}`);
  console.log(`Token prefix: ${tok?.access_token?.slice(0,20)}...`);

  const url = `https://api.mokapos.com/v3/outlets/${outlet.moka_outlet_id}/reports/get_latest_transactions?per_page=1`;
  console.log(`\nTesting: ${url}`);

  const { status, body } = await httpsGet(url, tok.access_token);
  console.log(`Status: ${status}`);
  const json = JSON.parse(body);
  if (status === 200) {
    const p = json?.data?.payments?.[0];
    console.log(`First payment: ${p?.customer_name || p?.customer_phone} — ${p?.created_at}`);
  } else {
    console.log(`Error: ${JSON.stringify(json).slice(0, 200)}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
