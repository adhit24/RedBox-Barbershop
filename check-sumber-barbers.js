'use strict';
require('dotenv').config({ path: require('path').join(__dirname, 'server/.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: outlets } = await supabase.from('outlets').select('id, slug').eq('slug', 'sumber');
  const sumberId = outlets?.[0]?.id;
  console.log('Sumber outlet ID:', sumberId);
  
  const { data, error } = await supabase
    .from('barbers')
    .select('id, name, moka_employee_id, is_active, img, role')
    .eq('outlet_id', sumberId)
    .order('name');
  
  if (error) { console.error(error); return; }
  
  console.log('\n=== Barbers Sumber ===');
  for (const b of data) {
    console.log({
      id: b.id,
      name: b.name,
      mokaId: b.moka_employee_id || '(none)',
      active: b.is_active,
      img: b.img ? 'HAS_IMG' : 'NO_IMG',
      role: b.role
    });
  }
}
main();
