'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('outlets').select('id, name, moka_outlet_id, is_active').then(({data,error}) => {
  if(error) { console.error(error.message); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
});
