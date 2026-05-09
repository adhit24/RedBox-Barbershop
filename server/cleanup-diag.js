'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { error, count } = await sb.from('schedules').delete({ count: 'exact' })
    .or("notes.ilike.%DIAG TEST%,notes.ilike.%TEST SIMULASI%");
  if (error) console.error('Error:', error.message);
  else console.log('Deleted', count, 'test schedules');
}
main().catch(e => { console.error(e.message); process.exit(1); });
