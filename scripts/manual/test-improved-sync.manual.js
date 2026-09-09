'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Import our improved sync functions
const { resolveBarberWithValidation, validateOutletAssignment } = require('./moka/improved-sync');

async function testImprovedSync() {
  console.log('🧪 Testing Improved Sync System Across All Branches\n');
  
  // Get all outlets for testing
  const { data: outlets, error: outletError } = await supabase
    .from('outlets')
    .select('id, slug, name, moka_outlet_id');
    
  if (outletError) {
    console.error('❌ Error fetching outlets:', outletError);
    return;
  }
  
  console.log('📍 Testing barber resolution for all outlets...\n');
  
  // Test cases for different scenarios
  const testCases = [
    {
      name: 'Yuki at Samadikun (original issue)',
      billName: 'yuki 19/05 14.00 opan',
      expectedOutlet: 'samadikun',
      expectedBarber: 'Opan'
    },
    {
      name: 'Customer at Bypass with Bob',
      billName: 'andi 19/05 15.00 bob',
      expectedOutlet: 'bypass',
      expectedBarber: 'Bob'
    },
    {
      name: 'Customer at CSB with Anggi',
      billName: 'budi 19/05 16.00 anggi',
      expectedOutlet: 'csb',
      expectedBarber: 'Anggi'
    },
    {
      name: 'Customer at Tegal with Epik',
      billName: 'citra 19/05 17.00 epik',
      expectedOutlet: 'tegal',
      expectedBarber: 'Epik'
    },
    {
      name: 'Customer at Sumber with Didi',
      billName: 'eko 19/05 18.00 didi',
      expectedOutlet: 'sumber',
      expectedBarber: 'Didi'
    },
    {
      name: 'Cross-branch attempt (should fail)',
      billName: 'test 19/05 14.00 opan', // opan is at samadikun
      expectedOutlet: 'bypass', // but we'll test with bypass outlet
      expectedBarber: null // Should fail validation
    },
    {
      name: 'Unstructured format (fuzzy)',
      billName: 'walkin abdul',
      expectedOutlet: 'bypass',
      expectedBarber: 'Abdul'
    }
  ];
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  for (const testCase of testCases) {
    console.log(`\n🧪 Test: ${testCase.name}`);
    console.log(`   Bill: "${testCase.billName}"`);
    console.log(`   Expected: ${testCase.expectedBarber} at ${testCase.expectedOutlet}`);
    
    try {
      // Find the outlet ID
      const outlet = outlets.find(o => o.slug === testCase.expectedOutlet);
      if (!outlet) {
        console.log(`   ❌ Outlet "${testCase.expectedOutlet}" not found`);
        continue;
      }
      
      // Test barber resolution
      const resolution = await resolveBarberWithValidation(
        testCase.billName, 
        outlet.id, 
        'test-bill-id'
      );
      
      if (!resolution) {
        if (testCase.expectedBarber === null) {
          console.log(`   ✅ PASS: Correctly failed to resolve barber`);
          passedTests++;
        } else {
          console.log(`   ❌ FAIL: Expected barber but got none`);
        }
        continue;
      }
      
      // Get barber details
      const { data: barber } = await supabase
        .from('barbers')
        .select('name, outlet_id')
        .eq('id', resolution.barberId)
        .single();
      
      if (!barber) {
        console.log(`   ❌ FAIL: Resolved barber not found in database`);
        continue;
      }
      
      // Check if barber matches expected
      const barberNameMatch = barber.name.toLowerCase().includes(testCase.expectedBarber.toLowerCase()) ||
                             testCase.expectedBarber.toLowerCase().includes(barber.name.toLowerCase());
      
      // Check outlet assignment
      const outletMatch = barber.outlet_id === outlet.id;
      
      if (barberNameMatch && outletMatch) {
        console.log(`   ✅ PASS: Resolved to "${barber.name}" at correct outlet`);
        console.log(`      Method: ${resolution.method}, Confidence: ${resolution.confidence}`);
        passedTests++;
      } else {
        console.log(`   ❌ FAIL: Resolution mismatch`);
        console.log(`      Got: "${barber.name}" at outlet ${barber.outlet_id}`);
        console.log(`      Expected: "${testCase.expectedBarber}" at ${outlet.id}`);
        console.log(`      Name match: ${barberNameMatch}, Outlet match: ${outletMatch}`);
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }
  
  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Improved sync system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Review the results above.');
  }
  
  // Test outlet validation specifically
  console.log('\n🔒 Testing outlet validation...');
  
  const validationTests = [
    {
      name: 'Valid assignment (Opan at Samadikun)',
      barberId: 'samadikun-opan',
      outletId: outlets.find(o => o.slug === 'samadikun')?.id,
      shouldPass: true
    },
    {
      name: 'Invalid cross-branch (Opan at Bypass)',
      barberId: 'samadikun-opan',
      outletId: outlets.find(o => o.slug === 'bypass')?.id,
      shouldPass: false
    }
  ];
  
  let validationPassed = 0;
  
  for (const test of validationTests) {
    if (!test.outletId) continue;
    
    const isValid = await validateOutletAssignment(test.barberId, test.outletId, 'validation-test');
    const passed = isValid === test.shouldPass;
    
    if (passed) {
      console.log(`   ✅ ${test.name}: ${isValid ? 'Valid' : 'Invalid'} (correct)`);
      validationPassed++;
    } else {
      console.log(`   ❌ ${test.name}: Expected ${test.shouldPass ? 'valid' : 'invalid'} but got ${isValid ? 'valid' : 'invalid'}`);
    }
  }
  
  console.log(`\n🔒 Validation Results: ${validationPassed}/${validationTests.length} tests passed`);
  
  return {
    resolutionTests: { passed: passedTests, total: totalTests },
    validationTests: { passed: validationPassed, total: validationTests.length }
  };
}

// Run the tests
testImprovedSync().then(results => {
  console.log('\n🏁 Testing completed!');
}).catch(error => {
  console.error('💥 Test execution failed:', error);
});
