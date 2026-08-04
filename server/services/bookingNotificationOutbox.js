'use strict';

const { notifyCustomerBookingConfirmed } = require('./waNotification');

const MAX_ATTEMPTS = 8;

function asIdList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(v => String(v || '').trim()).filter(Boolean);
}

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
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: null,
      provider_response: providerResponse,
      provider_message_ids: asIdList(providerResponse?.id),
      provider_delivery_status: providerResponse?.process || 'queued',
    })
    .eq('booking_id', bookingId)
    .eq('kind', 'customer_booking_confirmed');
  if (error) throw error;
}

// Fonnte sends delivery updates asynchronously. A response with status=true
// only means WhatsApp accepted the request; state=0 means the target did not
// receive it and must never remain marked as successfully delivered.
async function reconcileCustomerNotificationDelivery(supabase, update) {
  if (!supabase || !update) return { matched: false };

  const messageId = String(update.messageId || '').trim();
  const stateId = String(update.stateId || '').trim();
  if (!messageId && !stateId) return { matched: false };

  // Read a bounded set and match in JS. This intentionally supports legacy
  // rows whose provider_response.id is numeric JSON and whose new indexed
  // provider_message_ids column was not populated yet.
  const { data: rows, error } = await supabase
    .from('booking_notification_outbox')
    .select('id,attempts,status,provider_state_ids,provider_message_ids,provider_response')
    .eq('kind', 'customer_booking_confirmed')
    .in('status', ['sent', 'retry', 'processing'])
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return { matched: false, error: error.message };
  const row = (rows || []).find(candidate => {
    const messageIds = [
      ...asIdList(candidate.provider_message_ids),
      ...asIdList(candidate.provider_response?.id),
    ];
    const stateIds = asIdList(candidate.provider_state_ids);
    return (messageId && messageIds.includes(messageId)) || (stateId && stateIds.includes(stateId));
  });
  if (!row) return { matched: false };

  const status = String(update.status || '').toLowerCase();
  const state = update.state === undefined || update.state === null ? null : String(update.state);
  const failed = state === '0' || ['failed', 'expired', 'invalid'].includes(status);
  const terminal = Number(row.attempts || 0) >= MAX_ATTEMPTS;
  const now = new Date().toISOString();
  const nextStateIds = Array.from(new Set([
    ...asIdList(row.provider_state_ids),
    ...(stateId ? [stateId] : []),
  ]));
  const patch = {
    provider_delivery_status: status || null,
    provider_delivery_state: state,
    provider_state_ids: nextStateIds,
    last_delivery_at: now,
    delivery_webhook_payload: update.raw || update,
  };

  if (failed) {
    patch.status = terminal ? 'failed' : 'retry';
    patch.next_attempt_at = terminal
      ? now
      : new Date(Date.now() + 10 * 60 * 1000).toISOString();
    patch.last_error = `Fonnte delivery rejected: status=${status || '-'} state=${state || '-'}`;
    patch.sent_at = null;
  } else if (['delivered', 'read'].includes(status)) {
    patch.status = 'sent';
    patch.sent_at = now;
    patch.last_error = null;
  }

  const { error: updateError } = await supabase
    .from('booking_notification_outbox')
    .update(patch)
    .eq('id', row.id);
  return { matched: !updateError, bookingNotificationId: row.id, error: updateError?.message };
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
  reconcileCustomerNotificationDelivery,
  processCustomerNotificationOutbox,
};
