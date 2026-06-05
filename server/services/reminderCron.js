/**
 * H-1 Reminder Cron Job
 * Runs every day at 09:00 WIB (02:00 UTC)
 * Reads bookings from Supabase, sends WA reminder for tomorrow's appointments
 *
 * Usage: require('./services/reminderCron') in server index.js
 */

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { notifyCustomerReminderH1, notifyBarberHomeServiceReminderH1 } = require('./waNotification');

function startReminderCron() {
  // Every day at 09:00 WIB = 02:00 UTC
  cron.schedule('0 2 * * *', async () => {
    console.log('[ReminderCron] Running H-1 reminder job...');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Tomorrow's date in YYYY-MM-DD
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, barbers(name, phone)')
      .eq('date', tomorrowStr)
      .in('status', ['confirmed', 'pending']);

    if (error) {
      console.error('[ReminderCron] Supabase error:', error.message);
      return;
    }

    console.log(`[ReminderCron] Found ${bookings.length} booking(s) for ${tomorrowStr}`);

    for (const booking of bookings) {
      // Reminder ke pelanggan
      try {
        await notifyCustomerReminderH1({
          ...booking,
          barber_name: booking.barbers?.name
        });
        console.log(`[ReminderCron] Customer reminder sent to ${booking.wa} (${booking.name})`);
      } catch (err) {
        console.error(`[ReminderCron] Customer reminder failed for ${booking.wa}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 1500));

      // Reminder H-1 ke kapster untuk home service
      const isHomeService = booking.notes?.includes('[HOME SERVICE]');
      if (isHomeService && booking.barber_id && booking.barbers?.phone) {
        const addrMatch = booking.notes?.match(/\[HOME SERVICE\] Alamat:\s*(.+)/);
        const address = addrMatch?.[1]?.trim() || '';
        const dateStr = new Date(booking.date + 'T12:00:00').toLocaleDateString('id-ID', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        const timeStr = booking.time ? String(booking.time).slice(0, 5) : '';
        try {
          await notifyBarberHomeServiceReminderH1({
            barberPhone:  booking.barbers.phone,
            barberName:   booking.barbers.name,
            customerName: booking.name,
            dateStr,
            timeStr,
            address,
            serviceLabel: booking.service,
            price:        booking.price ? `Rp ${Number(booking.price).toLocaleString('id-ID')}` : '-',
            branch:       booking.location,
          });
          console.log(`[ReminderCron] Barber H-1 reminder sent to ${booking.barbers.phone} (${booking.barbers.name})`);
        } catch (err) {
          console.error(`[ReminderCron] Barber reminder failed for ${booking.barbers.phone}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    console.log('[ReminderCron] Done.');
  }, { timezone: 'UTC' });

  console.log('[ReminderCron] Scheduled: daily H-1 reminder at 09:00 WIB');
}

module.exports = { startReminderCron };
