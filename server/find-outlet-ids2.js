'use strict';
/**
 * Try profile endpoints to discover correct Moka outlet IDs
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BASE = 'https://api.mokapos.com';

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  const { data: outlets } = await supabase
    .from('outlets').select('id, slug, name, moka_outlet_id').order('slug');
  const { data: tokens } = await supabase
    .from('moka_tokens').select('outlet_id, access_token');
  const tokenMap = Object.fromEntries((tokens || []).map(t => [t.outlet_id, t]));

  // Profile/discovery endpoints to try
  const DISCOVERY = [
    '/v1/profile',
    '/v1/account/profile',
    '/v1/account',
    '/v1/me',
    '/v2/profile',
    '/v1/merchants',
    '/v1/outlet_profile',
  ];

  for (const outlet of outlets) {
    const tok = tokenMap[outlet.id]?.access_token;
    if (!tok) continue;
    console.log(`\n=== ${outlet.slug} (stored: ${outlet.moka_outlet_id}) ===`);

    for (const path of DISCOVERY) {
      const { status, ok, json } = await fetchJson(BASE + path, tok);
      if (ok || status !== 404) {
        console.log(`  ${ok ? '✅' : '⚠️'} ${path} → ${status}`);
        console.log(`     ${JSON.stringify(json).slice(0, 400)}`);
      }
    }
  }

  // Also verify the 2 known-good outlet IDs work
  console.log('\n\n=== Verify known-good outlets ===');
  for (const outlet of outlets.filter(o => ['bypass','tegal'].includes(o.slug))) {
    const tok = tokenMap[outlet.id]?.access_token;
    if (!tok) continue;
    const url = `${BASE}/v3/outlets/${outlet.moka_outlet_id}/reports/get_latest_transactions?per_page=1`;
    const { status, json } = await fetchJson(url, tok);
    console.log(`  ${outlet.slug} (${outlet.moka_outlet_id}): HTTP ${status}`);
    const pmts = json?.data?.payments;
    if (Array.isArray(pmts) && pmts[0]) {
      console.log(`    First tx: ${pmts[0].created_at || pmts[0].transaction_time} — ${pmts[0].customer_name || pmts[0].customer_phone}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
