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

/**
 * One DB authority call serializes, checks rolling windows, and reserves.
 * inboundEventId may be explicitly `null` for a system-initiated send (e.g.
 * the idle-close cron job) that has no triggering inbound customer message —
 * the RPC still enforces the same duplicate-content/rate-limit checks by
 * destination_hash in that case. Only an accidental omission (`undefined`)
 * is rejected.
 */
async function reserveAutomatedSend(supabase, {
  inboundEventId, destinationHash, contentHash,
}) {
  if (!supabase || inboundEventId === undefined || !destinationHash || !contentHash) {
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
  if (!supabase || inboundEventId === undefined || !claimId) return;
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
  realSend, supabase, inboundEventRowId, isEnabled = () => true, logEvent = () => {},
  observeMessage = () => {}, onSendSuccess = async () => {},
}) {
  return async function guardedSend(to, message, options = {}) {
    const branch = options.branch || null;
    if (!isEnabled()) {
      logEvent({ event_type: 'ai_kill_switch_suppressed', branch, guard_reason: 'reddy_disabled' });
      return { status: false, suppressed: true, reason: 'ai_kill_switch' };
    }

    // P0-A: Price placeholder guard pass (runs BEFORE reservation & contentHash)
    const { guardPricePlaceholders } = require('../agents/reddy/personalityPolicy');
    const priceGuarded = guardPricePlaceholders(message, {
      branch,
      serviceId: options.serviceId,
      serviceName: options.serviceName,
      authoritativePriceResolver: options.authoritativePriceResolver,
    });
    const finalOutboundText = priceGuarded.sanitizedReply;
    if (priceGuarded.blocked) {
      logEvent({ event_type: 'price_placeholder_blocked', branch });
    }

    // Hashes computed on final sanitized text
    const destinationHash = hashValue(normalizePhoneDigits(to));
    const contentHash = hashValue(String(finalOutboundText || '').trim().toLowerCase());
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
    logEvent({ event_type: 'final_outbound_after_guards', branch, metadata: { text_length: finalOutboundText.length } });

    // Task 16 is observation-only and fail-open. Evaluation storage or rule
    // failures must never block, replace, or mutate the customer reply.
    await observeMessageFailOpen(observeMessage, finalOutboundText, {
      branch,
      inboundEventRowId,
      ...(options.evaluationContext && typeof options.evaluationContext === 'object' ? options.evaluationContext : {}),
    });
    let result;
    try {
      result = await realSend(to, finalOutboundText, options);
    } catch (error) {
      await markOutboundResult(supabase, {
        inboundEventId: inboundEventRowId, claimId: reservation.claimId, sent: false,
      });
      logEvent({ event_type: 'processing_failed', branch, guard_reason: 'send_threw' });
      throw error;
    }
    const sent = Boolean(result && result.status !== false);
    if (sent) {
      try { await onSendSuccess(to, finalOutboundText, options); } catch (_error) { /* never blocks the send result */ }
    }
    await markOutboundResult(supabase, {
      inboundEventId: inboundEventRowId, claimId: reservation.claimId, sent,
    });
    logEvent({ event_type: sent ? 'outbound_sent' : 'processing_failed', branch, guard_reason: sent ? null : 'send_failed' });
    return result;
  };
}

/**
 * Normalizes a sendResult from guardedSend / sendWA into a bounded inbound lifecycle outcome.
 *
 * @param {object|null|undefined} sendResult
 * @returns {{ terminalKind: 'sent' | 'suppressed' | 'failed' | 'not_attempted', reason: string|null }}
 */
function normalizeOutboundLifecycleOutcome(sendResult) {
  if (!sendResult || typeof sendResult !== 'object') {
    return { terminalKind: 'not_attempted', reason: null };
  }

  // 1. Successful send
  if (sendResult.status !== false && sendResult.suppressed !== true) {
    return { terminalKind: 'sent', reason: null };
  }

  const rawReason = String(sendResult.reason || '').toLowerCase();

  // 2. Suppressions with bounded known reason
  if (rawReason === 'duplicate_content' || rawReason === 'already_attempted' || rawReason === 'duplicate_suppressed') {
    return { terminalKind: 'suppressed', reason: 'duplicate_suppressed' };
  }
  if (rawReason === 'rate_limited') {
    return { terminalKind: 'suppressed', reason: 'rate_limited' };
  }
  if (rawReason === 'ai_kill_switch' || rawReason === 'reddy_disabled' || rawReason === 'kill_switch_blocked') {
    return { terminalKind: 'suppressed', reason: 'reddy_disabled' };
  }

  // 3. Send / Provider / DB Guard Failures
  if (rawReason === 'send_failed' || rawReason === 'send_threw' || rawReason === 'error' || rawReason === 'provider_send_failed' || rawReason === 'send_failed_provider') {
    return { terminalKind: 'failed', reason: 'processing_failed' };
  }

  // 4. Default fallbacks
  if (sendResult.suppressed === true) {
    return { terminalKind: 'suppressed', reason: sendResult.reason || 'processing_failed' };
  }

  return { terminalKind: 'failed', reason: sendResult.reason || 'processing_failed' };
}

module.exports = {
  createGuardedSend,
  reserveAutomatedSend,
  markOutboundResult,
  normalizeOutboundLifecycleOutcome,
  DUPLICATE_CONTENT_WINDOW_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_SENDS,
  MONITORING_MAX_WAIT_MS,
};
