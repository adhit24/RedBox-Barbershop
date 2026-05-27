'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Total count
  const { count } = await supabase
    .from('customers').select('*', { count: 'exact', head: true });

  // Members with points > 0
  const { count: withPoints } = await supabase
    .from('customers').select('*', { count: 'exact', head: true })
    .gt('points', 0);

  // Members synced from Moka (source = 'moka')
  const { count: fromMoka } = await supabase
    .from('customers').select('*', { count: 'exact', head: true })
    .eq('source', 'moka');

  // Most recent updated_at
  const { data: latest } = await supabase
    .from('customers').select('updated_at').order('updated_at', { ascending: false }).limit(1);

  // Top 5 by points
  const { data: top5 } = await supabase
    .from('customers').select('name, wa, visits, points, last_visit')
    .order('points', { ascending: false }).limit(5);

  console.log(`\n=== CUSTOMERS TABLE — SUPABASE ===`);
  console.log(`Total rows     : ${count}`);
  console.log(`Source=moka    : ${fromMoka}`);
  console.log(`Punya poin > 0 : ${withPoints}`);
  console.log(`Update terakhir: ${latest?.[0]?.updated_at}`);
  console.log(`\nTop 5 by poin:`);
  (top5 || []).forEach((c, i) => {
    console.log(`  ${i+1}. ${(c.name||'-').padEnd(25)} WA:${c.wa}  visits:${c.visits}  poin:${c.points}  last:${c.last_visit}`);
  });
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
