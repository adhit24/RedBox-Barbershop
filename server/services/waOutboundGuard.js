'use strict';

const { hashValue, normalizePhoneDigits } = require('./waInboundGuard');

const DUPLICATE_CONTENT_WINDOW_MS = 90 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_SENDS = 5;
const MONITORING_MAX_WAIT_MS = 250;

async function observeMessageFailOpen(observeMessage, message, context) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, MONITORING_MAX_WAIT_MS);
    Promise.resolve()
      .then(() => observeMessage(message, context))
      .catch(() => null)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

function firstRpcRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

/** One DB authority call serializes, checks rolling windows, and reserves. */
async function reserveAutomatedSend(supabase, {
  inboundEventId, destinationHash, contentHash,
}) {
  if (!supabase || !inboundEventId || !destinationHash || !contentHash) {
    return { status: 'error', claimId: null };
  }
  try {
    const { data, error } = await supabase.rpc('reserve_wa_automated_send', {
      p_inbound_event_id: inboundEventId,
      p_destination_hash: destinationHash,
      p_content_hash: contentHash,
      p_duplicate_window_seconds: Math.floor(DUPLICATE_CONTENT_WINDOW_MS / 1000),
      p_rate_window_seconds: Math.floor(RATE_LIMIT_WINDOW_MS / 1000),
      p_rate_limit: RATE_LIMIT_MAX_SENDS,
    });
    if (error) return { status: 'error', claimId: null, error };
    const row = firstRpcRow(data);
    return { status: row?.decision || 'error', claimId: row?.claim_id || null };
  } catch (error) {
    return { status: 'error', claimId: null, error };
  }
}

async function markOutboundResult(supabase, { inboundEventId, claimId, sent }) {
  if (!supabase || !inboundEventId || !claimId) return;
  try {
    await supabase.rpc('complete_wa_automated_send', {
      p_inbound_event_id: inboundEventId,
      p_claim_id: claimId,
      p_sent: Boolean(sent),
    });
  } catch (_error) { /* reservation already prevents duplicates; bookkeeping is best effort */ }
}

/** Manual/human sends never call this wrapper and remain unaffected. */
function createGuardedSend({
  realSend, supabase, inboundEventRowId, isEnabled = () => true, logEvent = () => {}, observeMessage = () => {},
}) {
  return async function guardedSend(to, message, options = {}) {
    const branch = options.branch || null;
    if (!isEnabled()) {
      logEvent({ event_type: 'ai_kill_switch_suppressed', branch, guard_reason: 'reddy_disabled' });
      return { status: false, suppressed: true, reason: 'ai_kill_switch' };
    }

    const destinationHash = hashValue(normalizePhoneDigits(to));
    const contentHash = hashValue(String(message || '').trim().toLowerCase());
    const reservation = await reserveAutomatedSend(supabase, {
      inboundEventId: inboundEventRowId,
      destinationHash,
      contentHash,
    });
    if (reservation.status !== 'allowed') {
      const eventType = reservation.status === 'duplicate_content'
        ? 'outbound_duplicate_suppressed'
        : reservation.status === 'rate_limited'
          ? 'rate_limit_suppressed'
          : reservation.status === 'already_attempted'
            ? 'inbound_duplicate_suppressed'
            : 'processing_failed';
      logEvent({ event_type: eventType, branch, guard_reason: reservation.status });
      return { status: false, suppressed: true, reason: reservation.status };
    }

    logEvent({ event_type: 'outbound_send_attempt', branch });
    // Task 16 is observation-only and fail-open. Evaluation storage or rule
    // failures must never block, replace, or mutate the customer reply.
    await observeMessageFailOpen(observeMessage, message, {
      branch,
      inboundEventRowId,
      ...(options.evaluationContext && typeof options.evaluationContext === 'object' ? options.evaluationContext : {}),
    });
    let result;
    try {
      result = await realSend(to, message, options);
    } catch (error) {
      await markOutboundResult(supabase, {
        inboundEventId: inboundEventRowId, claimId: reservation.claimId, sent: false,
      });
      logEvent({ event_type: 'processing_failed', branch, guard_reason: 'send_threw' });
      throw error;
    }
    const sent = Boolean(result && result.status !== false);
    await markOutboundResult(supabase, {
      inboundEventId: inboundEventRowId, claimId: reservation.claimId, sent,
    });
    logEvent({ event_type: sent ? 'outbound_sent' : 'processing_failed', branch, guard_reason: sent ? null : 'send_failed' });
    return result;
  };
}

module.exports = {
  createGuardedSend,
  reserveAutomatedSend,
  markOutboundResult,
  DUPLICATE_CONTENT_WINDOW_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_SENDS,
  MONITORING_MAX_WAIT_MS,
};
