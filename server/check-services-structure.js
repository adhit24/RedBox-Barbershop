'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkServicesStructure() {
  try {
    console.log('🔍 Checking services table structure...\n');
    
    // Get all services to see the structure
    const { data: services, error } = await supabase
      .from('services')
      .select('*')
      .limit(5);
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    if (services && services.length > 0) {
      console.log('📋 Services table columns:');
      const columns = Object.keys(services[0]);
      columns.forEach(col => {
        console.log(`  • ${col}`);
      });
      
      console.log('\n📄 Sample service data:');
      services[0] && Object.entries(services[0]).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    } else {
      console.log('ℹ️  No services found in database');
    }
    
    // Check specifically for haircut/fadecut/longtrim services
    const { data: groomingServices, error: groomingError } = await supabase
      .from('services')
      .select('*')
      .or('name.ilike.%haircut%,name.ilike.%fade%,name.ilike.%trim%');
      
    if (groomingError) {
      console.error('❌ Error fetching grooming services:', groomingError);
    } else {
      console.log(`\n✂️ Found ${groomingServices?.length || 0} grooming-related services:`);
      groomingServices?.forEach(service => {
        console.log(`  • ${service.name} - Rp${service.price || 'N/A'} - ${service.duration_minutes || 'N/A'}min`);
        console.log(`    Active: ${service.is_active ? 'Yes' : 'No'}`);
        console.log(`    Moka variant: ${service.moka_variant_name || 'None'}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkServicesStructure();
