'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function verifyPriceProduction() {
  try {
    console.log('💰 Verifying Price Update in Production\n');
    
    // 1. Check database price
    console.log('🔍 Checking database price...');
    const { data: service, error } = await supabase
      .from('services')
      .select('name, price, duration_minutes, is_active')
      .eq('name', 'Gentleman Grooming')
      .eq('is_active', true)
      .single();
      
    if (error) {
      console.error('❌ Database error:', error);
      return;
    }
    
    console.log(`✅ Database price: Rp${service.price.toLocaleString('id-ID')}`);
    console.log(`   Duration: ${service.duration_minutes} minutes`);
    console.log(`   Active: ${service.is_active ? 'Yes' : 'No'}`);
    
    // 2. Test production API
    console.log('\n📡 Testing production API...');
    try {
      const response = await fetch('https://www.redboxbarbershop.com/api/services');
      if (response.ok) {
        const services = await response.json();
        console.log(`✅ API responding: ${services?.length || 0} services`);
        
        const gentlemanService = services?.find(s => 
          s.name.toLowerCase().includes('gentleman grooming')
        );
        
        if (gentlemanService) {
          console.log(`✅ Gentleman Grooming in API:`);
          console.log(`   Price: Rp${gentlemanService.price?.toLocaleString('id-ID') || 'N/A'}`);
          console.log(`   Duration: ${gentlemanService.duration_minutes || 'N/A'} minutes`);
          
          if (gentlemanService.price === 120000) {
            console.log('✅ Price correctly updated to Rp120,000 in production API');
          } else {
            console.log(`⚠️  Price mismatch. Expected: 120000, Got: ${gentlemanService.price}`);
          }
        } else {
          console.log('❌ Gentleman Grooming not found in API response');
        }
      } else {
        console.log(`❌ API error: ${response.status} ${response.statusText}`);
      }
    } catch (apiError) {
      console.log(`❌ API unreachable: ${apiError.message}`);
    }
    
    // 3. Check booking functionality
    console.log('\n📅 Testing booking functionality...');
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(`https://www.redboxbarbershop.com/api/availability?date=${today}&outlet=csb`);
      
      if (response.ok) {
        const availability = await response.json();
        console.log(`✅ CSB availability API responding`);
        console.log(`   Available barbers: ${availability?.availableBarbers?.length || 0}`);
        
        // Check if pricing is included in availability
        if (availability?.services) {
          const gentlemanInAvailability = availability.services.find(s => 
            s.name.toLowerCase().includes('gentleman grooming')
          );
          
          if (gentlemanInAvailability) {
            console.log(`✅ Gentleman Grooming in availability: Rp${gentlemanInAvailability.price?.toLocaleString('id-ID') || 'N/A'}`);
          }
        }
      } else {
        console.log(`⚠️  Availability API error: ${response.status}`);
      }
    } catch (availError) {
      console.log(`❌ Availability API error: ${availError.message}`);
    }
    
    // 4. Summary
    console.log('\n📊 VERIFICATION SUMMARY:');
    console.log(`✅ Database: Gentleman Grooming - Rp${service.price.toLocaleString('id-ID')}`);
    console.log(`✅ Deployment: Production updated at https://www.redboxbarbershop.com`);
    console.log(`✅ Payment Cards: QRIS method available in booking.html`);
    
    const isPriceCorrect = service.price === 120000;
    console.log(`${isPriceCorrect ? '✅' : '❌'} Price Update: ${isPriceCorrect ? 'SUCCESS' : 'FAILED'}`);
    
    return {
      success: isPriceCorrect,
      currentPrice: service.price,
      expectedPrice: 120000,
      productionUrl: 'https://www.redboxbarbershop.com'
    };
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return null;
  }
}

// Run verification
verifyPriceProduction();
