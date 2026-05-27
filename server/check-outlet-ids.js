'use strict';
/**
 * Cek apakah moka_outlet_id yang tersimpan valid via v1 sync_bills endpoint
 * (berbeda dari v3 reports yang dipakai sync-moka-members.js)
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
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  const { data: outlets } = await supabase
    .from('outlets').select('id, slug, name, moka_outlet_id').order('slug');
  const { data: tokens } = await supabase
    .from('moka_tokens').select('outlet_id, access_token').order('expires_at', { ascending: false });

  // Use the freshest token for all tests (they're all client-credentials tokens anyway)
  const token = tokens?.[0]?.access_token;
  if (!token) { console.error('No token found'); process.exit(1); }

  const today = new Date();
  const d = String(today.getDate()).padStart(2,'0');
  const m = String(today.getMonth()+1).padStart(2,'0');
  const y = today.getFullYear();
  const fmt = `${d}/${m}/${y}`;

  console.log(`Testing with date: ${fmt}\n`);

  for (const outlet of outlets) {
    if (!outlet.moka_outlet_id) { console.log(`${outlet.slug}: no moka_outlet_id`); continue; }
    const id = outlet.moka_outlet_id;

    // Test v3 reports (same as sync script)
    const v3url = `${BASE}/v3/outlets/${id}/reports/get_latest_transactions?per_page=1`;
    const { status: v3s } = await fetchJson(v3url, token);

    // Test v1 sync_bills
    const v1url = `${BASE}/v1/outlets/${id}/sync_bills/?statuses=OPEN&start=${fmt}&end=${fmt}&per_page=1`;
    const { status: v1s, json: v1j } = await fetchJson(v1url, token);

    // Test v1 items (simpler endpoint)
    const itemUrl = `${BASE}/v1/outlets/${id}/items?per_page=1`;
    const { status: itemS } = await fetchJson(itemUrl, token);

    const mark = v3s === 200 ? '✅' : '❌';
    console.log(`${mark} ${outlet.slug.padEnd(12)} moka_id=${String(id).padEnd(8)} | v3-tx: ${v3s} | v1-bills: ${v1s} | v1-items: ${itemS}`);
    if (v1s !== 404 && v1s !== 200) console.log(`     v1-bills response: ${JSON.stringify(v1j).slice(0,200)}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
