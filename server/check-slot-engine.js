const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const date = '2026-05-10';
  const outletSlug = 'bypass';
  const barberId = 'bypass-kaji-dodi';
  
  // 1. Resolve outlet
  const { data: outlet } = await supabase
    .from('outlets').select('id, name, slug').eq('slug', outletSlug).single();
  
  console.log('Outlet:', outlet);
  
  // 2. Load barber
  const { data: barber } = await supabase
    .from('barbers').select('id, name').eq('id', barberId).single();
  
  console.log('Barber:', barber);
  
  // 3. Query schedules seperti yang dilakukan slot engine
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59+07:00`;
  
  console.log('\nQuery filters:');
  console.log('dayStart (WIB):', dayStart);
  console.log('dayEnd (WIB):', dayEnd);
  console.log('outlet_id:', outlet.id);
  
  const { data: existing, error } = await supabase
    .from('schedules')
    .select('barber_id, start_time, end_time, status, external_id, service_name')
    .eq('outlet_id', outlet.id)
    .not('status', 'in', '("cancelled")')
    .lt('start_time', dayEnd)
    .gt('end_time', dayStart);
  
  if (error) {
    console.error('Query error:', error);
  }
  
  console.log('\nSchedules found by slot engine query:', existing?.length || 0);
  console.log(existing);
  
  // 4. Check busyMap untuk Dodi
  const busyMap = {};
  const outletWideBlocks = [];
  
  for (const s of existing || []) {
    const block = {
      start: new Date(s.start_time).getTime(),
      end: new Date(s.end_time).getTime(),
    };
    console.log(`\nSchedule: ${s.external_id}`);
    console.log('  barber_id:', s.barber_id);
    console.log('  start_time:', s.start_time);
    console.log('  end_time:', s.end_time);
    console.log('  start (epoch):', block.start);
    console.log('  end (epoch):', block.end);
    console.log('  start (WIB):', new Date(block.start).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
    
    if (s.barber_id === null) {
      outletWideBlocks.push(block);
    } else {
      if (!busyMap[s.barber_id]) busyMap[s.barber_id] = [];
      busyMap[s.barber_id].push(block);
    }
  }
  
  console.log('\n=== BusyMap for Dodi ===');
  console.log('Dodi blocks:', busyMap['bypass-kaji-dodi']);
  
  // 5. Simulasi generate slots
  const durationMinutes = 60;
  const openTime = '10:00';
  const closeTime = '21:00';
  
  function _timeStrToMs(dateStr, timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`).getTime();
  }
  
  const openMs = _timeStrToMs(date, openTime);
  const closeMs = _timeStrToMs(date, closeTime);
  const busy = busyMap['bypass-kaji-dodi'] || [];
  
  console.log('\n=== Slot Generation for Dodi ===');
  console.log('Open (epoch):', openMs);
  console.log('Close (epoch):', closeMs);
  console.log('Open (WIB):', new Date(openMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
  console.log('Close (WIB):', new Date(closeMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
  
  const SLOT_INTERVAL_MIN = 30;
  let cursor = openMs;
  const slots = [];
  
  while (cursor + durationMinutes * 60_000 <= closeMs) {
    const slotStart = cursor;
    const slotEnd = cursor + durationMinutes * 60_000;
    
    const isBusy = busy.some(b => slotStart < b.end && slotEnd > b.start);
    
    const slotTime = new Date(slotStart).toLocaleTimeString('id-ID', { 
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    if (slotTime === '16:00' || slotTime === '15:30' || slotTime === '16:30') {
      console.log(`\nSlot ${slotTime}:`);
      console.log('  slotStart (epoch):', slotStart);
      console.log('  slotEnd (epoch):', slotEnd);
      console.log('  slotStart (WIB):', new Date(slotStart).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
      console.log('  slotEnd (WIB):', new Date(slotEnd).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
      console.log('  isBusy:', isBusy);
      
      for (const b of busy) {
        console.log('  Checking against block:', {
          blockStart: new Date(b.start).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
          blockEnd: new Date(b.end).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
          overlap: slotStart < b.end && slotEnd > b.start
        });
      }
    }
    
    if (!isBusy) {
      slots.push({
        start: new Date(slotStart).toISOString(),
        end: new Date(slotEnd).toISOString(),
        barberId: barberId,
        barberName: barber?.name || 'Unknown'
      });
    }
    
    cursor += SLOT_INTERVAL_MIN * 60_000;
  }
  
  console.log('\n=== Available slots for Dodi ===');
  console.log('Total slots:', slots.length);
  console.log(slots.map(s => new Date(s.start).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })));
}

main().catch(console.error);
