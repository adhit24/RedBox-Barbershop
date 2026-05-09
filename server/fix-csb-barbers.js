'use strict';
/**
 * Fix CSB barbers: fetch all Moka items, show unmatched barbers,
 * and manually set moka_employee_id where names differ slightly.
 * Run: node server/fix-csb-barbers.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: tokens } = await sb.from('moka_tokens').select('access_token').limit(1);
  const { data: outlet } = await sb.from('outlets').select('id, moka_outlet_id').eq('slug', 'csb').single();
  const { data: barbers } = await sb.from('barbers').select('id, name, moka_employee_id').eq('outlet_id', outlet.id);

  const token = tokens?.[0]?.access_token;
  const mokaId = outlet.moka_outlet_id;
  const headers = { 'Authorization': `Bearer ${token}` };

  // Fetch ALL Moka items (paginated)
  let allItems = [], page = 1;
  while (true) {
    const res = await fetch(`https://api.mokapos.com/v1/outlets/${mokaId}/items?include_variants=true&page=${page}&per_page=100`, { headers });
    const json = await res.json();
    const items = json?.data?.items || json?.data || [];
    if (!items.length) break;
    allItems = allItems.concat(items);
    page++;
    if (items.length < 100) break;
  }

  // Filter to barber items (2+ variants with barbershop-like names)
  const mokaBarbers = allItems.filter(i => (i.item_variants || []).length >= 2);
  console.log(`CSB Moka barber items (${mokaBarbers.length}):`);
  mokaBarbers.forEach(i => console.log(`  ID: ${i.id} | ${i.name}`));

  console.log('\nCSB DB barbers:');
  barbers?.forEach(b => console.log(`  ${b.name} → moka_employee_id: ${b.moka_employee_id || 'NULL'}`));

  // Manual mapping for name mismatches and wrong assignments
  const manualMap = [
    { dbName: 'Syarif', mokaName: 'Sarif',  mokaId: '26541541' },  // name mismatch
    { dbName: 'Ragil',  mokaName: 'Ragil',  mokaId: '25658986' },  // was wrongly set to Hamami (88894856)
    { dbName: 'Ubay',   mokaName: 'Ubay',   mokaId: '25654316' },
    { dbName: 'Yuda',   mokaName: 'Yuda',   mokaId: '58487047' },
  ];

  // Try to auto-match unmatched barbers against ALL Moka barber items
  const unmatched = barbers?.filter(b => !b.moka_employee_id) || [];
  console.log('\nAuto-matching unmatched barbers:');
  for (const barber of unmatched) {
    const bn = barber.name.toLowerCase().replace(/\s/g, '');
    let best = null, bestScore = 0;
    for (const item of mokaBarbers) {
      const mn = item.name.toLowerCase().replace(/\s/g, '');
      // Check substring match or similar starts
      let score = 0;
      if (mn === bn) score = 1;
      else if (mn.includes(bn) || bn.includes(mn)) score = 0.9;
      else if (bn.slice(0,4) === mn.slice(0,4)) score = 0.7;
      else if (mn.startsWith(bn.slice(0,3)) || bn.startsWith(mn.slice(0,3))) score = 0.6;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= 0.6) {
      console.log(`  ${barber.name} → ${best.name} (ID: ${best.id}, score: ${bestScore})`);
    } else {
      console.log(`  ${barber.name} → NO MATCH (best: ${best?.name}, score: ${bestScore})`);
    }
  }

  // Apply manual map
  console.log('\nApplying manual mappings...');
  for (const { dbName, mokaName, mokaId: mid } of manualMap) {
    const barber = barbers?.find(b => b.name === dbName);
    if (!barber) { console.log(`  ${dbName}: not found in DB`); continue; }
    if (barber.moka_employee_id === mid) { console.log(`  ${dbName}: already set to ${mid}`); continue; }
    const { error } = await sb.from('barbers').update({ moka_employee_id: mid }).eq('id', barber.id);
    if (error) console.error(`  ${dbName}: error ${error.message}`);
    else console.log(`  ✓ ${dbName} → ${mokaName} (${mid})`);
  }

  console.log('\nDone. Re-run node server/run-schema-sync.js to verify all outlets.');
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
