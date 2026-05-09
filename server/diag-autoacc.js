'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { getAccessToken } = require('./moka/oauth');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

async function tryEndpoint(method, path, body, token) {
  const url = BASE + path;
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer '+token, 'Content-Type':'application/json', Accept:'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text().catch(()=>'');
  let d; try { d=JSON.parse(txt); } catch { d={raw:txt}; }
  console.log(method, path, '->', res.status, JSON.stringify(d).slice(0,250));
}

async function main() {
  const { data: outlet } = await sb.from('outlets').select('id,moka_outlet_id').eq('slug','bypass').single();
  const token = await getAccessToken(sb, outlet.id);
  const mid = outlet.moka_outlet_id;

  console.log('=== Coba update Auto Accept ===');
  await tryEndpoint('GET',   `/v1/advanced_orderings/applications/2000001165`, null, token);
  await tryEndpoint('PATCH', `/v1/advanced_orderings/applications/2000001165`, { auto_accept: true }, token);
  await tryEndpoint('GET',   `/v1/applications/2000001165`, null, token);
  await tryEndpoint('GET',   `/v1/outlets/${mid}/advanced_orderings/settings`, null, token);
  await tryEndpoint('PATCH', `/v1/outlets/${mid}/advanced_orderings/settings`, { auto_accept: true }, token);
  await tryEndpoint('GET',   `/v1/outlets/${mid}/advanced_orderings`, null, token);
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
