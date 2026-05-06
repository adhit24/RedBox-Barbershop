'use strict';
// Run: node server/fetch-moka-variants.js
// Fetches Moka item list for all outlets and prints all variants,
// then shows which website services still need mapping.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { getAccessToken } = require('./moka/oauth');

const MOKA_API_BASE = 'https://api.mokapos.com';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // 1. Get all active outlets with moka_outlet_id
  const { data: outlets, error } = await supabase
    .from('outlets')
    .select('id, name, slug, moka_outlet_id')
    .not('moka_outlet_id', 'is', null)
    .eq('is_active', true);

  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  if (!outlets?.length) { console.log('No outlets with moka_outlet_id found'); process.exit(0); }

  // 2. Collect all unique variants across outlets
  const allVariantNames = new Set();

  for (const outlet of outlets) {
    console.log(`\n═══ ${outlet.name} (moka_outlet_id: ${outlet.moka_outlet_id}) ═══`);
    try {
      const token = await getAccessToken(supabase, outlet.id);
      const res   = await fetch(`${MOKA_API_BASE}/v1/outlets/${outlet.moka_outlet_id}/items`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const json  = await res.json();
      const items = json?.data || json?.items || [];

      if (!items.length) { console.log('  (no items returned)'); continue; }

      for (const item of items) {
        const variants = item.variants || item.item_variants || [];
        console.log(`\n  ITEM: ${item.name} (id: ${item.id})`);
        if (variants.length) {
          variants.forEach(v => {
            console.log(`    - variant: "${v.name}"  id: ${v.id}  price: ${v.price ?? v.selling_price ?? '?'}`);
            allVariantNames.add(v.name);
          });
        } else {
          console.log('    (no variants)');
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  // 3. Show unique variant names across all outlets
  console.log('\n\n══════════════════════════════════════════');
  console.log('SEMUA NAMA VARIANT UNIK DI MOKA:');
  console.log('══════════════════════════════════════════');
  [...allVariantNames].sort().forEach(v => console.log(`  "${v}"`));

  // 4. Compare with website services
  const WEBSITE_SERVICES = [
    'Hair Cut', 'Hair and Fade Cut', 'Hair Tattoo Single Side', 'Hair Tattoo Double Side',
    'Hair Color', 'Hair Bleaching', 'Hair Highlighting', 'Hair Curly', 'Hair Smoothing',
    'Hair Spa', 'Down Perm / Root Lift',
    'Shaving', 'Traditional Shaving', 'Premium Head Shave',
    'Men Massage Service', 'Nose Wax', 'Ear Wax', 'Ear Singeing',
    'Charcoal Deep Cleansing', 'Ear Candle', 'Charcoal Nose Cleansing Strip',
    'Redbox Royal Grooming', 'Redbox Duxe Grooming', 'Redbox Earl Grooming',
    'Redbox Baron Grooming', 'Redbox Noble Grooming',
  ];

  console.log('\n══════════════════════════════════════════');
  console.log('STATUS MAPPING LAYANAN WEBSITE ↔ MOKA:');
  console.log('══════════════════════════════════════════');

  const variantNamesLower = new Set([...allVariantNames].map(v => v.toLowerCase()));

  for (const svc of WEBSITE_SERVICES) {
    const exact = allVariantNames.has(svc);
    const fuzzy = !exact && variantNamesLower.has(svc.toLowerCase());
    const status = exact ? '✅ exact match' : fuzzy ? '⚠️  case mismatch' : '❌ belum ada di Moka';
    console.log(`  ${status}: "${svc}"`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
