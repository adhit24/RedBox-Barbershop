#!/usr/bin/env node
'use strict';
/**
 * Trigger Moka Sync Manual
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Import sync function
const { pullMokaToWeb } = require('./moka/sync');

async function main() {
  console.log('🔄 Triggering Moka Sync...\n');
  
  try {
    // Get outlet bypass
    const { data: outlet, error } = await supabase
      .from('outlets')
      .select('id, name, slug, moka_outlet_id')
      .eq('slug', 'bypass')
      .single();
    
    if (error || !outlet) {
      console.error('❌ Outlet not found:', error?.message);
      process.exit(1);
    }
    
    console.log('🏪 Outlet:', outlet.name, `(ID: ${outlet.id})`);
    console.log('🔗 Moka Outlet ID:', outlet.moka_outlet_id);
    
    if (!outlet.moka_outlet_id) {
      console.error('❌ No moka_outlet_id set');
      process.exit(1);
    }
    
    // Run sync
    console.log('\n📡 Pulling data from Moka...');
    const result = await pullMokaToWeb(supabase, outlet.id);
    
    console.log('\n✅ Sync Result:');
    console.log('  - Processed:', result.processed);
    console.log('  - Skipped:', result.skipped);
    console.log('  - Errors:', result.errors);
    
    if (result.processed > 0) {
      console.log('\n🎉 Sync successful! Open bills should now be in database.');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
