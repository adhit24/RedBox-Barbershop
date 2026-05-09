'use strict';
/**
 * Cek status token Moka di Supabase + test API call sederhana
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // 1. Cek token di moka_tokens table
  const { data: tokens, error } = await supabase
    .from('moka_tokens')
    .select('outlet_id, expires_at, scope, updated_at')
    .order('expires_at', { ascending: false });

  if (error) { console.error('DB error:', error.message); process.exit(1); }

  console.log(`\n=== moka_tokens table (${(tokens || []).length} rows) ===`);
  for (const t of (tokens || [])) {
    const exp = new Date(t.expires_at);
    const now = new Date();
    const expired = exp < now;
    const diffH = Math.round((exp - now) / 3600000);
    console.log(`  outlet: ${t.outlet_id}`);
    console.log(`  expires: ${t.expires_at} (${expired ? '❌ EXPIRED' : `✅ valid for ${diffH}h`})`);
    console.log(`  scope: ${t.scope || '(none)'}`);
    console.log(`  updated: ${t.updated_at}`);
    console.log();
  }

  if (!tokens?.length) {
    console.log('❌ No tokens found — perlu jalankan OAuth flow terlebih dahulu');
    console.log('   Visit: GET /api/moka/auth?outletId=<outlet-uuid>');
    process.exit(0);
  }

  // 2. Ambil access_token dan test Moka API
  const { data: tokenRow } = await supabase
    .from('moka_tokens')
    .select('access_token, outlet_id')
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();

  if (!tokenRow?.access_token) {
    console.log('❌ No access_token available');
    process.exit(0);
  }

  // 3. Load outlets
  const { data: outlets } = await supabase
    .from('outlets')
    .select('id, slug, moka_outlet_id')
    .eq('is_active', true);

  console.log('=== Test Moka API (GET /v1/outlets/{id}/advanced_orderings/orders) ===');
  for (const outlet of (outlets || [])) {
    if (!outlet.moka_outlet_id) { console.log(`  ${outlet.slug}: no moka_outlet_id — skip`); continue; }
    try {
      const res = await fetch(
        `https://api.mokapos.com/v1/outlets/${outlet.moka_outlet_id}/advanced_orderings/orders?limit=5`,
        { headers: { Authorization: `Bearer ${tokenRow.access_token}`, Accept: 'application/json' } }
      );
      const body = await res.json().catch(() => ({}));
      const count = body?.data?.length ?? body?.orders?.length ?? (Array.isArray(body?.data) ? body.data.length : '?');
      if (res.ok) {
        console.log(`  ✅ ${outlet.slug} (${outlet.moka_outlet_id}): HTTP ${res.status} — ${count} pending orders`);
      } else {
        console.log(`  ❌ ${outlet.slug}: HTTP ${res.status} — ${body?.message || body?.error || JSON.stringify(body).slice(0,100)}`);
      }
    } catch (e) {
      console.log(`  ❌ ${outlet.slug}: ${e.message}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
