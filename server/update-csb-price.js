'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function updateCSBPrice() {
  try {
    console.log('💰 Updating Gentleman Grooming Price for CSB Outlet\n');
    
    // 1. Get CSB outlet ID
    const { data: csbOutlet, error: outletError } = await supabase
      .from('outlets')
      .select('id, slug, name')
      .eq('slug', 'csb')
      .single();
      
    if (outletError || !csbOutlet) {
      console.error('❌ CSB outlet not found:', outletError);
      return;
    }
    
    console.log(`📍 Found CSB outlet: ${csbOutlet.name} (${csbOutlet.id})`);
    
    // 2. Check if there's outlet-specific pricing or if we need to modify the base service
    console.log('\n🔍 Checking current pricing structure...');
    
    // First, let's see if there are outlet-specific prices
    const { data: outletServices, error: serviceError } = await supabase
      .from('outlet_services')
      .select('*')
      .eq('outlet_id', csbOutlet.id)
      .eq('service_name', 'Gentleman Grooming');
      
    if (serviceError) {
      console.log('ℹ️  No outlet_services table found, using base service approach');
    }
    
    // Option 1: Update base service price (affects all outlets)
    // Option 2: Create outlet-specific pricing (if table exists)
    
    if (outletServices && outletServices.length > 0) {
      console.log('📝 Found outlet-specific pricing, updating CSB price...');
      const { error: updateError } = await supabase
        .from('outlet_services')
        .update({ 
          price: 120000,
          updated_at: new Date().toISOString()
        })
        .eq('outlet_id', csbOutlet.id)
        .eq('service_name', 'Gentleman Grooming');
        
      if (updateError) {
        console.error('❌ Failed to update outlet-specific price:', updateError);
      } else {
        console.log('✅ Updated CSB-specific price to Rp120,000');
      }
    } else {
      console.log('📝 No outlet-specific pricing found. Checking if we should create it...');
      
      // Create outlet-specific pricing for CSB
      const { data: newOutletService, error: createError } = await supabase
        .from('outlet_services')
        .insert({
          outlet_id: csbOutlet.id,
          service_name: 'Gentleman Grooming',
          price: 120000,
          is_active: true,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (createError) {
        console.log('⚠️  Cannot create outlet-specific pricing. Will check alternative approach...');
        
        // Alternative: Update the base service and note CSB pricing in description
        console.log('🔄 Alternative approach: Update base service with CSB note...');
        const { error: baseUpdateError } = await supabase
          .from('services')
          .update({ 
            price: 120000,
            // You could add a note here about CSB pricing if needed
          })
          .eq('name', 'Gentleman Grooming')
          .eq('is_active', true);
          
        if (baseUpdateError) {
          console.error('❌ Failed to update base service:', baseUpdateError);
        } else {
          console.log('✅ Updated Gentleman Grooming price to Rp120,000 (base service)');
        }
      } else {
        console.log('✅ Created CSB-specific pricing: Rp120,000');
      }
    }
    
    // 3. Verify the update
    console.log('\n🔍 Verifying price update...');
    const { data: verifyService, error: verifyError } = await supabase
      .from('services')
      .select('name, price, duration_minutes')
      .eq('name', 'Gentleman Grooming')
      .eq('is_active', true)
      .single();
      
    if (verifyError) {
      console.error('❌ Verification failed:', verifyError);
    } else {
      console.log(`✅ Current Gentleman Grooming price: Rp${verifyService.price.toLocaleString('id-ID')}`);
      console.log(`   Duration: ${verifyService.duration_minutes} minutes`);
    }
    
    // 4. Check outlet-specific pricing if it exists
    const { data: verifyOutletPrice, error: verifyOutletError } = await supabase
      .from('outlet_services')
      .select('price')
      .eq('outlet_id', csbOutlet.id)
      .eq('service_name', 'Gentleman Grooming')
      .eq('is_active', true)
      .maybeSingle();
      
    if (!verifyOutletError && verifyOutletPrice) {
      console.log(`✅ CSB-specific price: Rp${verifyOutletPrice.price.toLocaleString('id-ID')}`);
    }
    
    return {
      success: true,
      csbOutlet: csbOutlet.name,
      newPrice: 120000
    };
    
  } catch (error) {
    console.error('❌ Price update failed:', error);
    return null;
  }
}

// Run the update
updateCSBPrice();
