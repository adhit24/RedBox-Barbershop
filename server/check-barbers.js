'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('barbers')
    .select('id, name, outlet_id, moka_employee_id, is_active')
    .order('outlet_id')
    .order('name');

  if (error) { console.error(error); process.exit(1); }

  // Load outlets for name display
  const { data: outlets } = await supabase.from('outlets').select('id, slug');
  const slugById = {};
  for (const o of (outlets || [])) slugById[o.id] = o.slug;

  console.log('\n=== Barbers in Supabase ===\n');
  console.log(`${'ID'.padEnd(30)} ${'Name'.padEnd(20)} ${'Outlet'.padEnd(12)} ${'MokaID'.padEnd(12)} Active`);
  console.log('-'.repeat(85));

  for (const b of data) {
    const outlet = slugById[b.outlet_id] || b.outlet_id?.slice(0, 8);
    const mokaId = b.moka_employee_id || '(none)';
    const active = b.is_active ? 'YES' : 'no';
    console.log(`${b.id.padEnd(30)} ${b.name.padEnd(20)} ${outlet.padEnd(12)} ${mokaId.padEnd(12)} ${active}`);
  }

  const withMoka = data.filter(b => b.moka_employee_id && b.is_active);
  const withoutMoka = data.filter(b => !b.moka_employee_id && b.is_active);
  console.log(`\nActive barbers: ${data.filter(b=>b.is_active).length}, with Moka ID: ${withMoka.length}, WITHOUT Moka ID: ${withoutMoka.length}`);
  if (withoutMoka.length) {
    console.log('Missing Moka ID:', withoutMoka.map(b => b.id).join(', '));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
