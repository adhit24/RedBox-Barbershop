const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // 1. Cek outlet bypass
  const { data: outlet } = await supabase
    .from('outlets').select('id, name, slug').eq('slug', 'bypass').single();
  
  console.log('Outlet:', outlet);
  
  // 2. Cek semua barbers di outlet bypass
  const { data: barbers } = await supabase
    .from('barbers')
    .select('id, name, moka_employee_id, outlet_id')
    .eq('outlet_id', outlet.id)
    .eq('is_active', true);
  
  console.log('\nAll barbers in Bypass:');
  barbers.forEach(b => {
    console.log(`  - ${b.name}: id=${b.id}, moka_employee_id=${b.moka_employee_id}`);
  });
  
  // 3. Cari barber dengan nama dodi
  const dodi = barbers.find(b => b.name.toLowerCase().includes('dodi'));
  console.log('\nDodi barber:', dodi);
  
  // 4. Cek apakah ada barber dengan ID 'dodi' saja (tanpa prefix)
  const { data: weirdBarber } = await supabase
    .from('barbers')
    .select('id, name, outlet_id')
    .eq('id', 'dodi')
    .maybeSingle();
  
  console.log('\nWeird barber with id="dodi":', weirdBarber);
}

main().catch(console.error);
