'use strict';

const { notifyCustomerBookingConfirmed } = require('./waNotification');

const MAX_ATTEMPTS = 8;

async function enqueueCustomerNotification(supabase, booking) {
  if (!supabase || !booking?.id || !booking?.wa) return null;
  const { data, error } = await supabase
    .from('booking_notification_outbox')
    .upsert({
      booking_id: booking.id,
      kind: 'customer_booking_confirmed',
      payload: booking,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: 'booking_id,kind', ignoreDuplicates: true })
    .select('id,status,attempts')
    .single();
  if (error) throw error;
  return data;
}

async function markCustomerNotificationSent(supabase, bookingId, providerResponse = null) {
  if (!supabase || !bookingId) return;
  const { error } = await supabase
    .from('booking_notification_outbox')
    .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, provider_response: providerResponse })
    .eq('booking_id', bookingId)
    .eq('kind', 'customer_booking_confirmed');
  if (error) throw error;
}

async function processCustomerNotificationOutbox(supabase, limit = 25) {
  const now = new Date().toISOString();
  // Recover jobs abandoned by a serverless timeout.
  await supabase.from('booking_notification_outbox')
    .update({ status: 'retry', next_attempt_at: now, last_error: 'Recovered stale processing job' })
    .eq('status', 'processing')
    .lt('locked_at', new Date(Date.now() - 10 * 60000).toISOString());
  const { data: rows, error } = await supabase
    .from('booking_notification_outbox')
    .select('id,booking_id,payload,attempts')
    .eq('kind', 'customer_booking_confirmed')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', now)
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results = { processed: 0, sent: 0, retried: 0, failed: 0 };
  for (const row of rows || []) {
    // Claim before sending so two cron invocations do not send duplicates.
    const { data: claimed } = await supabase
      .from('booking_notification_outbox')
      .update({ status: 'processing', attempts: (row.attempts || 0) + 1, locked_at: now })
      .eq('id', row.id)
      .in('status', ['pending', 'retry'])
      .select('id,attempts')
      .maybeSingle();
    if (!claimed) continue;

    results.processed++;
    try {
      const providerResponse = await notifyCustomerBookingConfirmed(row.payload || {});
      await supabase.from('booking_notification_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), last_error: null, provider_response: providerResponse,
      }).eq('id', row.id);
      results.sent++;
    } catch (err) {
      const attempts = Number(claimed.attempts || row.attempts || 1);
      const terminal = attempts >= MAX_ATTEMPTS;
      const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attempts - 1, 6)));
      await supabase.from('booking_notification_outbox').update({
        status: terminal ? 'failed' : 'retry',
        next_attempt_at: new Date(Date.now() + delayMinutes * 60000).toISOString(),
        last_error: String(err.message || err).slice(0, 1000),
      }).eq('id', row.id);
      terminal ? results.failed++ : results.retried++;
    }
  }
  return results;
}

module.exports = {
  enqueueCustomerNotification,
  markCustomerNotificationSent,
  processCustomerNotificationOutbox,
};
