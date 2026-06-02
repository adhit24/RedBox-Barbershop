
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Update is_active menjadi true untuk barber Dodi
  const { data, error } = await supabase
    .from('barbers')
    .update({ is_active: true })
    .ilike('name', '%dodi%')
    .select('*');

  console.log('Hasil update:', data);
  console.log('Error:', error);
}

main().catch(console.error);
