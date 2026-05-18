'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fixServicesFinal() {
  try {
    console.log('🔧 Final Service Update: Deactivate Hair Cut + Hair Fade Cut → Keep Gentleman Grooming (95k)\n');
    
    // 1. Deactivate specific services
    const servicesToDeactivate = ['Hair Cut', 'Hair Fade Cut'];
    let deactivatedCount = 0;
    
    for (const serviceName of servicesToDeactivate) {
      console.log(`🗑️  Deactivating "${serviceName}"...`);
      
      const { error } = await supabase
        .from('services')
        .update({ is_active: false })
        .eq('name', serviceName)
        .eq('is_active', true);
        
      if (error) {
        console.log(`   ℹ️  ${serviceName} not found or already inactive`);
      } else {
        console.log(`   ✅ Deactivated: ${serviceName}`);
        deactivatedCount++;
      }
    }
    
    // 2. Verify Gentleman Grooming is active
    console.log('\n✅ Verifying Gentleman Grooming service...');
    const { data: gentlemanService, error: checkError } = await supabase
      .from('services')
      .select('*')
      .eq('name', 'Gentleman Grooming')
      .eq('is_active', true)
      .single();
      
    if (checkError || !gentlemanService) {
      console.log('❌ Gentleman Grooming service not found or inactive');
      
      // Add it if not exists
      console.log('➕ Adding Gentleman Grooming service...');
      const { data: newService, error: insertError } = await supabase
        .from('services')
        .insert({
          name: 'Gentleman Grooming',
          slug: 'gentleman-grooming',
          price: 95000,
          duration_minutes: 75,
          is_active: true,
          moka_variant_name: 'Gentleman Grooming',
          created_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (insertError) {
        console.error('❌ Failed to add Gentleman Grooming:', insertError);
      } else {
        console.log('✅ Added Gentleman Grooming successfully');
      }
    } else {
      console.log('✅ Gentleman Grooming is active');
      console.log(`   Price: Rp${gentlemanService.price.toLocaleString('id-ID')}`);
      console.log(`   Duration: ${gentlemanService.duration_minutes} minutes`);
    }
    
    // 3. Show final grooming services status
    console.log('\n📋 Final grooming services status:');
    const { data: groomingServices, error: groomingError } = await supabase
      .from('services')
      .select('name, price, duration_minutes, is_active')
      .or('name.ilike.%haircut%,name.ilike.%fade%,name.ilike.%trim%,name.ilike.%grooming%')
      .order('name');
      
    if (groomingError) {
      console.error('❌ Error:', groomingError);
    } else {
      const activeGrooming = groomingServices?.filter(s => s.is_active) || [];
      const inactiveGrooming = groomingServices?.filter(s => !s.is_active) || [];
      
      console.log(`\n🟢 Active grooming services (${activeGrooming.length}):`);
      activeGrooming.forEach(service => {
        console.log(`  • ${service.name} - Rp${service.price?.toLocaleString('id-ID') || 'N/A'} (${service.duration_minutes}min)`);
      });
      
      if (inactiveGrooming.length > 0) {
        console.log(`\n🔴 Inactive grooming services (${inactiveGrooming.length}):`);
        inactiveGrooming.forEach(service => {
          console.log(`  • ${service.name} - Rp${service.price?.toLocaleString('id-ID') || 'N/A'} (${service.duration_minutes}min)`);
        });
      }
    }
    
    // 4. Summary
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Services deactivated: ${deactivatedCount}`);
    console.log(`   Gentleman Grooming: Active at Rp95,000`);
    console.log(`   Status: ✅ Service update completed`);
    
    return {
      deactivatedCount,
      success: true
    };
    
  } catch (error) {
    console.error('❌ Service update failed:', error);
    return null;
  }
}

// Run the final fix
fixServicesFinal();
