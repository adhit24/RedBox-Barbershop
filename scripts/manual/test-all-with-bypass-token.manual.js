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
  // Use bypass's working token for ALL tests
  const { data: bypassOutlet } = await supabase
    .from('outlets').select('id').eq('slug', 'bypass').single();
  const { data: bypassTok } = await supabase
    .from('moka_tokens').select('access_token').eq('outlet_id', bypassOutlet.id).single();
  const token = bypassTok.access_token;
  console.log(`Using bypass token: ${token.slice(0,20)}...\n`);

  // Test all outlets with bypass token
  const { data: outlets } = await supabase
    .from('outlets').select('id, slug, moka_outlet_id').order('slug');

  for (const o of outlets) {
    if (!o.moka_outlet_id) { console.log(`${o.slug}: no moka_outlet_id`); continue; }
    const url = `https://api.mokapos.com/v3/outlets/${o.moka_outlet_id}/reports/get_latest_transactions?per_page=1`;
    const { status, body } = await httpsGet(url, token);
    const json = JSON.parse(body);
    if (status === 200) {
      const p = json?.data?.payments?.[0];
      console.log(`✅ ${o.slug.padEnd(12)} (${o.moka_outlet_id}): ${p?.customer_name || p?.customer_phone || '(no payments)'} — ${p?.created_at?.slice(0,10) || ''}`);
    } else {
      console.log(`❌ ${o.slug.padEnd(12)} (${o.moka_outlet_id}): HTTP ${status} — ${json?.meta?.error_message || JSON.stringify(json).slice(0,100)}`);
    }
  }

  // Also try nearby IDs around 105517 to find samadikun
  console.log('\n--- Searching for correct samadikun ID ---');
  const candidates = [105515, 105516, 105517, 105518, 105519, 105520, 105521, 105522];
  for (const id of candidates) {
    const url = `https://api.mokapos.com/v3/outlets/${id}/reports/get_latest_transactions?per_page=1`;
    const { status } = await httpsGet(url, token);
    if (status === 200) console.log(`  ✅ ID ${id} exists!`);
    else process.stdout.write(`  ${id}:${status} `);
  }
  console.log('');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
