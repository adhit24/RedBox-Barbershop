#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('🏪 Getting Moka Outlets...\n');
  
  // Get token
  const { data: tokenRow } = await supabase
    .from('moka_tokens')
    .select('access_token')
    .limit(1)
    .single();
  
  if (!tokenRow) {
    console.error('❌ No token found');
    process.exit(1);
  }
  
  try {
    // Try outlets endpoint
    const res = await fetch('https://api.mokapos.com/v1/outlets', {
      headers: { 'Authorization': `Bearer ${tokenRow.access_token}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      console.log('✅ Outlets found:');
      
      if (data.data && data.data.length > 0) {
        data.data.forEach(o => {
          console.log(`\n  ID: ${o.id}`);
          console.log(`  Name: ${o.name}`);
          console.log(`  Address: ${o.address || '-'}`);
          console.log(`  ---`);
        });
        
        // Show SQL to update
        console.log('\n\n📋 SQL to update outlets:');
        console.log('------------------------');
        data.data.forEach(o => {
          const slug = o.name.toLowerCase().includes('bypass') ? 'bypass' :
                       o.name.toLowerCase().includes('samadikun') ? 'samadikun' :
                       o.name.toLowerCase().includes('csb') ? 'csb' :
                       o.name.toLowerCase().includes('sumber') ? 'sumber' :
                       o.name.toLowerCase().includes('tegal') ? 'tegal' : null;
          
          if (slug) {
            console.log(`UPDATE outlets SET moka_outlet_id = '${o.id}' WHERE slug = '${slug}';`);
          }
        });
      } else {
        console.log('No outlets returned from API');
      }
    } else {
      console.error('❌ API Error:', res.status);
      const err = await res.text();
      console.error(err.slice(0, 200));
    }
    
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

main();
