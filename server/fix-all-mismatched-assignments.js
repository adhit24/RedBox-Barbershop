'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fixAllMismatchedAssignments() {
  try {
    console.log('🔧 Scanning for mismatched barber assignments across all branches...');
    
    // Get all recent schedules with source='moka'
    const { data: schedules, error } = await supabase
      .from('schedules')
      .select(`
        id,
        external_id,
        service_name,
        barber_id,
        outlet_id,
        start_time,
        status,
        notes
      `)
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .gte('start_time', '2026-05-19T00:00:00+07:00')
      .lt('start_time', '2026-05-20T00:00:00+07:00')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('❌ Error fetching schedules:', error);
      return;
    }
    
    console.log(`📋 Found ${schedules?.length || 0} active Moka schedules to check`);
    
    // Get all barbers and outlets for reference
    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name, outlet_id')
      .eq('is_active', true);
      
    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, slug');
      
    const barberMap = {};
    barbers?.forEach(b => barberMap[b.id] = b);
    const outletMap = {};
    outlets?.forEach(o => outletMap[o.id] = o);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const schedule of schedules || []) {
      const barber = barberMap[schedule.barber_id];
      const outlet = outletMap[schedule.outlet_id];
      
      console.log(`\n🔍 Checking schedule ${schedule.external_id}:`);
      console.log(`   Service: "${schedule.service_name}"`);
      console.log(`   Current: ${barber?.name || 'Unknown'} at ${outlet?.slug || 'Unknown'}`);
      
      // Try to extract structured info from service name
      const structuredMatch = extractStructuredInfo(schedule.service_name);
      
      if (structuredMatch) {
        console.log(`   Structured info:`, structuredMatch);
        
        // Find the correct barber based on hint
        const correctBarber = findBarberByHint(structuredMatch.barberHint, barbers);
        
        if (correctBarber && correctBarber.id !== schedule.barber_id) {
          console.log(`   ✅ Found mismatch! Should be: ${correctBarber.name} at ${outletMap[correctBarber.outlet_id]?.slug}`);
          
          // Fix the assignment
          const { data: updated, error: updateError } = await supabase
            .from('schedules')
            .update({
              barber_id: correctBarber.id,
              outlet_id: correctBarber.outlet_id,
              service_name: `Haircut (Goshow) - ${structuredMatch.customerName}`,
              notes: `Fixed assignment: ${structuredMatch.customerName} with ${correctBarber.name} at ${outletMap[correctBarber.outlet_id]?.slug} (was: ${barber?.name} at ${outlet?.slug})`
            })
            .eq('id', schedule.id)
            .select()
            .single();
            
          if (updateError) {
            console.error(`   ❌ Update failed:`, updateError);
            errorCount++;
          } else {
            console.log(`   ✅ Fixed successfully!`);
            fixedCount++;
          }
        } else if (correctBarber && correctBarber.id === schedule.barber_id) {
          console.log(`   ✅ Already correct assignment`);
        } else {
          console.log(`   ⚠️  Could not find correct barber for hint "${structuredMatch.barberHint}"`);
        }
      } else {
        console.log(`   ℹ️  No structured format found in service name`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Fixed: ${fixedCount} schedules`);
    console.log(`   Errors: ${errorCount} schedules`);
    console.log(`   Total checked: ${schedules?.length || 0} schedules`);
    
    if (fixedCount > 0) {
      console.log(`\n🎉 Successfully fixed ${fixedCount} mismatched assignments!`);
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

function extractStructuredInfo(serviceName) {
  if (!serviceName) return null;
  
  // Try to match patterns like "customer 19/05 14.00 barber"
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
  
  // Exact match first
  let exactMatch = barbers.find(b => b.name.toLowerCase() === hintLower);
  if (exactMatch) return exactMatch;
  
  // Token-based matching
  for (const barber of barbers) {
    const barberLower = barber.name.toLowerCase();
    const barberTokens = barberLower.split(/\s+/).filter(t => t.length >= 2);
    
    const tokenHit = barberTokens.some(token => 
      hintLower.includes(token) || token.includes(hintLower)
    );
    
    if (tokenHit) {
      return barber;
    }
  }
  
  return null;
}

// Run the fix
fixAllMismatchedAssignments();
