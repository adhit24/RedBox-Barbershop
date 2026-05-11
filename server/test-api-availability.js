const { createClient } = require('@supabase/supabase-js');
const { getAvailableSlots } = require('./moka/slotEngine');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const date = '2026-05-10';
  const outletSlug = 'bypass';
  const barberId = 'bypass-kaji-dodi';
  
  // Resolve outlet
  const { data: outlet } = await supabase
    .from('outlets').select('id, name, slug').eq('slug', outletSlug).single();
  
  console.log('Testing /api/availability endpoint simulation...\n');
  console.log('Outlet:', outlet.name, `(UUID: ${outlet.id})`);
  console.log('Date:', date);
  console.log('Barber ID:', barberId);
  console.log('Duration: 60 menit\n');
  
  // Call slot engine directly (same as what /api/availability does)
  const slots = await getAvailableSlots(supabase, {
    outletId: outlet.id,
    date: date,
    durationMinutes: 60,
    barberId: barberId,
  });
  
  console.log('Available slots returned by slot engine:', slots.length);
  
  // Group by hour for easier reading
  const slotsByHour = {};
  for (const s of slots) {
    const d = new Date(s.start);
    const hour = String(d.getUTCHours() + 7).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    if (!slotsByHour[hour]) slotsByHour[hour] = [];
    slotsByHour[hour].push({
      barberId: s.barberId,
      barberName: s.barberName,
      start: s.start,
      end: s.end
    });
  }
  
  console.log('\nAvailable time slots (WIB):');
  Object.keys(slotsByHour).sort().forEach(time => {
    console.log(`  ${time}: ${slotsByHour[time].length} slot(s)`);
  });
  
  // Check if 16:00 is available
  const has16 = slots.some(s => {
    const d = new Date(s.start);
    const hour = d.getUTCHours() + 7;
    const min = d.getUTCMinutes();
    return hour === 16 && min === 0;
  });
  
  console.log('\n=== CRITICAL CHECK ===');
  console.log('Slot 16:00 available:', has16);
  
  if (!has16) {
    console.log('\n✅ Slot 16:00 is CORRECTLY BLOCKED for Dodi');
    console.log('The slot engine is working correctly.');
    console.log('\nPossible reasons why web still shows 16:00 as available:');
    console.log('1. API /api/availability is not being called (check browser network tab)');
    console.log('2. API call is timing out or failing silently');
    console.log('3. Frontend is using fallback (mokaAvailabilityActive = false)');
    console.log('4. There is a caching issue');
  }
}

main().catch(console.error);
