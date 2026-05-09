'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Get Adhit's booking
  const { data: booking, error } = await sb
    .from('bookings')
    .select('*')
    .eq('name', 'Adhit Nugraha')
    .gte('created_at', '2026-05-07T00:00:00Z')
    .single();

  if (error || !booking) throw new Error('Booking not found: ' + (error?.message || ''));

  console.log('Booking found:', booking.id);
  console.log('  date:', booking.date, '| time:', booking.time, '| barber_id:', booking.barber_id);
  console.log('  location:', booking.location, '| wa:', booking.wa);
  console.log('  duration:', booking.duration, '| service:', booking.service);
  console.log();

  const { bridgeBookingToMoka } = require('./moka/sync');

  try {
    const result = await bridgeBookingToMoka(sb, booking);
    console.log('Bridge result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Bridge threw error:', err.message);
    console.error(err.stack);
  }
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
