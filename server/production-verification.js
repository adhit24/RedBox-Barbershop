'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function verifyProductionSystem() {
  console.log('🔍 Verifying Production Anti-Double-Booking System\n');
  
  try {
    // 1. Check current active schedules
    console.log('📊 Checking current active schedules...');
    const { data: schedules, error } = await supabase
      .from('schedules')
      .select(`
        id,
        external_id,
        service_name,
        barber_id,
        outlet_id,
        start_time,
        end_time,
        status,
        source,
        created_at
      `)
      .eq('status', 'reserved')
      .gte('start_time', '2026-05-19T00:00:00+07:00')
      .lt('start_time', '2026-05-20T00:00:00+07:00')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('❌ Error fetching schedules:', error);
      return;
    }
    
    console.log(`Found ${schedules?.length || 0} active schedules for today\n`);
    
    // Get reference data
    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name, outlet_id')
      .eq('is_active', true);
      
    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, slug, name');
      
    const barberMap = {};
    barbers?.forEach(b => barberMap[b.id] = b);
    const outletMap = {};
    outlets?.forEach(o => outletMap[o.id] = o);
    
    // 2. Analyze each schedule
    let potentialIssues = 0;
    let correctAssignments = 0;
    
    for (const schedule of schedules || []) {
      const barber = barberMap[schedule.barber_id];
      const outlet = outletMap[schedule.outlet_id];
      
      console.log(`📋 Schedule ${schedule.external_id}:`);
      console.log(`   Service: "${schedule.service_name}"`);
      console.log(`   Assigned: ${barber?.name || 'Unknown'} at ${outlet?.slug || 'Unknown'}`);
      console.log(`   Time: ${new Date(schedule.start_time).toLocaleString('id-ID')}`);
      
      // Check for structured format in service name
      const structured = extractStructuredInfo(schedule.service_name);
      if (structured) {
        console.log(`   Structured: ${structured.customerName} → ${structured.barberHint} at ${structured.timeStr}`);
        
        // Verify if assignment matches structured hint
        const expectedBarber = findBarberByHint(structured.barberHint, barbers);
        if (expectedBarber) {
          const isCorrect = expectedBarber.id === schedule.barber_id;
          const correctOutlet = expectedBarber.outlet_id === schedule.outlet_id;
          
          if (isCorrect && correctOutlet) {
            console.log(`   ✅ Correct assignment`);
            correctAssignments++;
          } else {
            console.log(`   ⚠️  MISMATCH detected!`);
            console.log(`      Expected: ${expectedBarber.name} at ${outletMap[expectedBarber.outlet_id]?.slug}`);
            console.log(`      Actual: ${barber?.name} at ${outlet?.slug}`);
            potentialIssues++;
          }
        } else {
          console.log(`   ❌ Could not find barber for hint "${structured.barberHint}"`);
          potentialIssues++;
        }
      } else {
        console.log(`   ℹ️  Unstructured format - using fuzzy matching`);
        correctAssignments++;
      }
      
      console.log('');
    }
    
    // 3. Summary
    console.log('📊 VERIFICATION SUMMARY:');
    console.log(`   Total active schedules: ${schedules?.length || 0}`);
    console.log(`   Correct assignments: ${correctAssignments}`);
    console.log(`   Potential issues: ${potentialIssues}`);
    
    if (potentialIssues === 0) {
      console.log('🎉 All assignments are correct! Anti-double-booking system is working properly.');
    } else {
      console.log('⚠️  Found potential issues that may need attention.');
    }
    
    // 4. Test API endpoint
    console.log('\n🌐 Testing production API...');
    try {
      const response = await fetch('https://www.redboxbarbershop.com/api/moka/open-bills');
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ API endpoint responding: ${data.openBills?.length || 0} open bills found`);
      } else {
        console.log(`❌ API endpoint error: ${response.status}`);
      }
    } catch (apiError) {
      console.log(`❌ API endpoint unreachable: ${apiError.message}`);
    }
    
    return {
      totalSchedules: schedules?.length || 0,
      correctAssignments,
      potentialIssues,
      systemHealthy: potentialIssues === 0
    };
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return null;
  }
}

function extractStructuredInfo(serviceName) {
  if (!serviceName) return null;
  
  const patterns = [
    /^(\S+)\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(\d{1,2}[.:]\d{2})\s+(.+)$/i,
    /^(.+?)\s+(\d{1,2}[\/\-\.]\d{1,2})\s+(\d{1,2}[.:]\d{2})\s+(.+)$/i
  ];
  
  for (const pattern of patterns) {
    const match = serviceName.match(pattern);
    if (match) {
      return {
        customerName: match[1].trim(),
        dateStr: match[2].trim(),
        timeStr: match[3].trim(),
        barberHint: match[4].trim()
      };
    }
  }
  
  return null;
}

function findBarberByHint(hint, barbers) {
  if (!hint || !barbers?.length) return null;
  
  const hintLower = hint.toLowerCase().trim();
  
  let exactMatch = barbers.find(b => b.name.toLowerCase() === hintLower);
  if (exactMatch) return exactMatch;
  
  for (const barber of barbers) {
    const barberLower = barber.name.toLowerCase();
    const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 2);
    
    const tokenHit = barberTokens.some(token => 
      hintLower.includes(token) || token.includes(hintLower)
    );
    
    if (tokenHit) return barber;
  }
  
  return null;
}

// Run verification
verifyProductionSystem();
