'use strict';
/**
 * Cari moka_outlet_id yang benar untuk Samadikun, CSB, Sumber
 * dengan mencoba berbagai endpoint discovery Moka API
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
    .from('outlets')
    .select('id, slug, name, moka_outlet_id')
    .order('slug');

  const { data: tokens } = await supabase
    .from('moka_tokens')
    .select('outlet_id, access_token, expires_at');

  const tokenMap = Object.fromEntries((tokens || []).map(t => [t.outlet_id, t]));

  const FAILING = ['samadikun', 'csb', 'sumber'];

  for (const outlet of outlets) {
    if (!FAILING.includes(outlet.slug)) continue;
    const tok = tokenMap[outlet.id]?.access_token;
    if (!tok) { console.log(`${outlet.slug}: no token`); continue; }

    console.log(`\n=== ${outlet.slug} (stored moka_id: ${outlet.moka_outlet_id}) ===`);

    // Try: /v1/account/me — get account info with outlets
    const endpoints = [
      `${BASE}/v1/account/me`,
      `${BASE}/v1/outlets`,
      `${BASE}/v2/outlets`,
      `${BASE}/v3/outlets`,
      `${BASE}/v1/merchants/me`,
    ];
    for (const url of endpoints) {
      const { status, ok, json } = await fetchJson(url, tok);
      if (ok) {
        console.log(`  ✅ ${url} → ${status}`);
        const outlets = json?.data?.outlets || json?.outlets || json?.data;
        if (Array.isArray(outlets)) {
          outlets.forEach(o => console.log(`      outlet: id=${o.id} name=${o.name}`));
        } else {
          console.log(`      ${JSON.stringify(json).slice(0, 300)}`);
        }
      } else {
        console.log(`  ❌ ${url} → ${status}`);
      }
    }

    // Try the v3 transactions endpoint with the stored ID to confirm 404
    const txUrl = `${BASE}/v3/outlets/${outlet.moka_outlet_id}/reports/get_latest_transactions?per_page=1`;
    const { status: txStatus, json: txJson } = await fetchJson(txUrl, tok);
    console.log(`  v3 tx (stored id ${outlet.moka_outlet_id}): HTTP ${txStatus} — ${JSON.stringify(txJson).slice(0,100)}`);
  }

  // Also try with a WORKING token to see if it can discover all outlets
  const bypass = outlets.find(o => o.slug === 'bypass');
  const bypassTok = bypass ? tokenMap[bypass.id]?.access_token : null;
  if (bypassTok) {
    console.log(`\n=== Discovery with Bypass token ===`);
    const discoveryEndpoints = [
      `${BASE}/v1/account/me`,
      `${BASE}/v1/outlets`,
      `${BASE}/v2/outlets`,
      `${BASE}/v1/merchants/me`,
    ];
    for (const url of discoveryEndpoints) {
      const { status, ok, json } = await fetchJson(url, bypassTok);
      if (ok) {
        console.log(`  ✅ ${url} → ${status}: ${JSON.stringify(json).slice(0, 400)}`);
      } else {
        console.log(`  ❌ ${url} → ${status}`);
      }
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
