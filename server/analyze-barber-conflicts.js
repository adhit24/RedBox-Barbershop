'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function analyzeBarberNameIssues() {
  try {
    console.log('🔍 Analyzing barber name resolution issues across all branches...');
    
    // Get all active barbers with their outlets
    const { data: barbers, error } = await supabase
      .from('barbers')
      .select('id, name, outlet_id, moka_employee_id, is_active')
      .eq('is_active', true);
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    // Get outlets
    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, slug, name, moka_outlet_id');
      
    const outletMap = {};
    outlets?.forEach(o => outletMap[o.id] = o);
    
    // Group barbers by outlet
    const barbersByOutlet = {};
    barbers?.forEach(barber => {
      const outlet = outletMap[barber.outlet_id];
      const outletName = outlet?.slug || barber.outlet_id?.slice(0, 8);
      if (!barbersByOutlet[outletName]) barbersByOutlet[outletName] = [];
      barbersByOutlet[outletName].push(barber);
    });
    
    console.log('\n📊 Barber Analysis by Outlet:');
    for (const [outlet, outletBarbers] of Object.entries(barbersByOutlet)) {
      console.log(`\n${outlet.toUpperCase()} (${outletBarbers.length} barbers):`);
      outletBarbers.forEach(b => {
        console.log(`  • ${b.name.padEnd(15)} | ID: ${b.id.padEnd(25)} | Moka: ${b.moka_employee_id || 'None'}`);
      });
    }
    
    // Check for potential name conflicts
    console.log('\n⚠️  POTENTIAL NAME CONFLICTS:');
    const nameMap = {};
    barbers?.forEach(barber => {
      const nameKey = barber.name.toLowerCase().replace(/[^a-z]/g, '');
      if (!nameMap[nameKey]) nameMap[nameKey] = [];
      nameMap[nameKey].push(barber);
    });
    
    let conflictsFound = 0;
    for (const [nameKey, conflicts] of Object.entries(nameMap)) {
      if (conflicts.length > 1) {
        conflictsFound++;
        console.log(`  • "${conflicts[0].name}" conflicts:`);
        conflicts.forEach(c => {
          const outlet = outletMap[c.outlet_id];
          console.log(`    - ${c.name} at ${outlet?.slug || 'unknown'}`);
        });
      }
    }
    
    if (conflictsFound === 0) {
      console.log('  ✅ No direct name conflicts found');
    }
    
    // Analyze fuzzy matching risks
    console.log('\n🔍 FUZZY MATCHING RISKS:');
    const riskyPairs = [];
    for (let i = 0; i < barbers?.length; i++) {
      for (let j = i + 1; j < barbers?.length; j++) {
        const b1 = barbers[i];
        const b2 = barbers[j];
        
        // Skip same outlet
        if (b1.outlet_id === b2.outlet_id) continue;
        
        // Check for similar names (substring matches)
        const name1 = b1.name.toLowerCase();
        const name2 = b2.name.toLowerCase();
        
        if (name1.includes(name2) || name2.includes(name1) || 
            name1.includes(name2.slice(0, 3)) || name2.includes(name1.slice(0, 3))) {
          riskyPairs.push({ b1, b2 });
        }
      }
    }
    
    if (riskyPairs.length > 0) {
      console.log(`  Found ${riskyPairs.length} risky pairs that could cause mis-matching:`);
      riskyPairs.forEach(pair => {
        const outlet1 = outletMap[pair.b1.outlet_id];
        const outlet2 = outletMap[pair.b2.outlet_id];
        console.log(`    • "${pair.b1.name}" (${outlet1?.slug}) ↔ "${pair.b2.name}" (${outlet2?.slug})`);
      });
    } else {
      console.log('  ✅ No high-risk fuzzy matches found');
    }
    
    return { barbersByOutlet, conflictsFound, riskyPairs };
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return null;
  }
}

// Run analysis
analyzeBarberNameIssues();
