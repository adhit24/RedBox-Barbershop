/**
 * H-1 Reminder Cron Job
 * Runs every day at 09:00 WIB (02:00 UTC)
 * Reads bookings from Supabase, sends WA reminder for tomorrow's appointments
 *
 * Usage: require('./services/reminderCron') in server index.js
 */

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { notifyCustomerReminderH1 } = require('./waNotification');

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
      .select('*, barbers(name)')
      .eq('date', tomorrowStr)
      .in('status', ['confirmed', 'pending']);

    if (error) {
      console.error('[ReminderCron] Supabase error:', error.message);
      return;
    }

    console.log(`[ReminderCron] Found ${bookings.length} booking(s) for ${tomorrowStr}`);

    for (const booking of bookings) {
      try {
        await notifyCustomerReminderH1({
          ...booking,
          barber_name: booking.barbers?.name
        });
        console.log(`[ReminderCron] Reminder sent to ${booking.wa} (${booking.name})`);
      } catch (err) {
        console.error(`[ReminderCron] Failed for ${booking.wa}:`, err.message);
      }

      // Small delay between messages to avoid rate limit
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log('[ReminderCron] Done.');
  }, { timezone: 'UTC' });

  console.log('[ReminderCron] Scheduled: daily H-1 reminder at 09:00 WIB');
}

module.exports = { startReminderCron };
