'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function verifyFix() {
  try {
    console.log('🧪 Verifying Yuki\'s appointment fix...');
    
    // Check Opan's schedule for today
    const { data: opanSchedules, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('barber_id', 'samadikun-opan')
      .eq('status', 'reserved')
      .gte('start_time', '2026-05-19T00:00:00+07:00')
      .lt('start_time', '2026-05-20T00:00:00+07:00');
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log(`📅 Found ${opanSchedules?.length || 0} reserved slots for Opan today:`);
    
    for (const schedule of opanSchedules || []) {
      const startTime = new Date(schedule.start_time).toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log(`  • ${startTime} - ${schedule.service_name}`);
      console.log(`    Status: ${schedule.status}, Source: ${schedule.source}`);
      console.log(`    Notes: ${schedule.notes || 'None'}`);
    }
    
    // Check if 14:00 is properly blocked
    const targetTime = '2026-05-19T14:00:00+07:00';
    const isBlocked = opanSchedules?.some(schedule => {
      const start = new Date(schedule.start_time);
      const end = new Date(schedule.end_time);
      const target = new Date(targetTime);
      return target >= start && target < end;
    });
    
    console.log(`\n🔒 14:00 slot status: ${isBlocked ? 'BLOCKED ✅' : 'AVAILABLE ❌'}`);
    
    if (isBlocked) {
      console.log('✅ SUCCESS: Yuki\'s appointment is now correctly blocking the 14:00 slot for Opan at Samadikun!');
    } else {
      console.log('❌ ISSUE: 14:00 slot is still showing as available');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

verifyFix();
