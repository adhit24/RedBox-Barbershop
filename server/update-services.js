'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function updateServices() {
  try {
    console.log('🔧 Updating Services: Haircut + FadeCut + LongTrim → Gentleman Grooming (95k)\n');
    
    // 1. Check current services
    console.log('📋 Checking current services...');
    const { data: currentServices, error } = await supabase
      .from('services')
      .select('*')
      .or('name.ilike.%haircut%,name.ilike.%fade%,name.ilike.%trim%')
      .eq('is_active', true);
      
    if (error) {
      console.error('❌ Error fetching current services:', error);
      return;
    }
    
    console.log(`Found ${currentServices?.length || 0} services to update:`);
    currentServices?.forEach(service => {
      console.log(`  • ${service.name} - ${service.price || service.duration_minutes}min - Rp${service.price || 'N/A'}`);
      console.log(`    Moka variant: ${service.moka_variant_name || 'None'}`);
      console.log(`    ID: ${service.id}`);
    });
    
    // 2. Deactivate old services
    console.log('\n🗑️  Deactivating old services...');
    let deactivatedCount = 0;
    
    for (const service of currentServices || []) {
      const { error: updateError } = await supabase
        .from('services')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', service.id);
        
      if (updateError) {
        console.error(`❌ Failed to deactivate ${service.name}:`, updateError);
      } else {
        console.log(`  ✅ Deactivated: ${service.name}`);
        deactivatedCount++;
      }
    }
    
    // 3. Add new Gentleman Grooming service
    console.log('\n➕ Adding new "Gentleman Grooming" service...');
    
    const newService = {
      name: 'Gentleman Grooming',
      slug: 'gentleman-grooming',
      price: 95000,
      duration_minutes: 75, // Combined duration
      is_active: true,
      moka_variant_name: 'Gentleman Grooming',
      created_at: new Date().toISOString()
    };
    
    const { data: insertedService, error: insertError } = await supabase
      .from('services')
      .insert(newService)
      .select()
      .single();
      
    if (insertError) {
      console.error('❌ Failed to insert new service:', insertError);
      return;
    }
    
    console.log(`  ✅ Added: ${insertedService.name}`);
    console.log(`     Price: Rp${insertedService.price.toLocaleString('id-ID')}`);
    console.log(`     Duration: ${insertedService.duration_minutes} minutes`);
    console.log(`     ID: ${insertedService.id}`);
    
    // 4. Verify the update
    console.log('\n🔍 Verifying service update...');
    const { data: activeServices, error: verifyError } = await supabase
      .from('services')
      .select('name, price, duration_minutes, is_active')
      .eq('is_active', true)
      .order('name');
      
    if (verifyError) {
      console.error('❌ Error verifying services:', verifyError);
      return;
    }
    
    console.log('Current active services:');
    activeServices?.forEach(service => {
      console.log(`  • ${service.name} - Rp${service.price?.toLocaleString('id-ID') || 'N/A'} (${service.duration_minutes}min)`);
    });
    
    // 5. Check if Gentleman Grooming is the only grooming service
    const groomingServices = activeServices?.filter(s => 
      s.name.toLowerCase().includes('grooming') || 
      s.name.toLowerCase().includes('haircut') ||
      s.name.toLowerCase().includes('fade') ||
      s.name.toLowerCase().includes('trim')
    );
    
    console.log(`\n📊 Summary:`);
    console.log(`   Deactivated services: ${deactivatedCount}`);
    console.log(`   Added new service: 1 (Gentleman Grooming)`);
    console.log(`   Total active services: ${activeServices?.length || 0}`);
    console.log(`   Grooming-related services: ${groomingServices?.length || 0}`);
    
    if (groomingServices?.length === 1 && groomingServices[0].name === 'Gentleman Grooming') {
      console.log(`\n🎉 Service update successful! Now offering "Gentleman Grooming" for Rp95,000`);
    } else {
      console.log(`\n⚠️  Please verify the grooming services list above`);
    }
    
    return {
      deactivatedCount,
      newService: insertedService,
      totalActiveServices: activeServices?.length || 0
    };
    
  } catch (error) {
    console.error('❌ Service update failed:', error);
    return null;
  }
}

// Run the update
updateServices();
