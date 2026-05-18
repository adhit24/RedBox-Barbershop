'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fixYukiAppointment() {
  try {
    console.log('🔧 Fixing Yuki\'s appointment assignment...');
    
    // 1. Get the current schedule
    const { data: schedule, error: scheduleError } = await supabase
      .from('schedules')
      .select('*')
      .eq('external_id', '627737085')
      .single();
      
    if (scheduleError) {
      console.error('❌ Error finding schedule:', scheduleError);
      return;
    }
    
    console.log('📋 Current schedule:', {
      id: schedule.id,
      barber_id: schedule.barber_id,
      outlet_id: schedule.outlet_id,
      service_name: schedule.service_name,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      status: schedule.status
    });
    
    // 2. Get Opan's barber information
    const { data: opan, error: opanError } = await supabase
      .from('barbers')
      .select('id, name, outlet_id')
      .eq('name', 'Opan')
      .eq('is_active', true)
      .single();
      
    if (opanError) {
      console.error('❌ Error finding Opan:', opanError);
      return;
    }
    
    console.log('✂️ Found Opan:', {
      id: opan.id,
      name: opan.name,
      outlet_id: opan.outlet_id
    });
    
    // 3. Update the schedule to assign to Opan at Samadikun
    const { data: updated, error: updateError } = await supabase
      .from('schedules')
      .update({
        barber_id: opan.id,
        outlet_id: opan.outlet_id,
        service_name: 'Haircut (Goshow) - Yuki',
        notes: 'Fixed assignment: Yuki with Opan at Samadikun'
      })
      .eq('id', schedule.id)
      .select()
      .single();
      
    if (updateError) {
      console.error('❌ Error updating schedule:', updateError);
      return;
    }
    
    console.log('✅ Schedule updated successfully!');
    console.log('📋 Updated schedule:', {
      id: updated.id,
      barber_id: updated.barber_id,
      outlet_id: updated.outlet_id,
      service_name: updated.service_name,
      start_time: updated.start_time,
      end_time: updated.end_time,
      status: updated.status,
      notes: updated.notes
    });
    
    console.log('🎉 Yuki\'s appointment is now correctly assigned to Opan at Samadikun branch!');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the fix
fixYukiAppointment();
