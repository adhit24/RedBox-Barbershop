'use strict';

const { hashValue, normalizePhoneDigits } = require('./waInboundGuard');

// Circuit-breaker window for near-identical automated sends to the same
// destination (spec range 60-120s) — this is a secondary safety net, not the
// primary idempotency mechanism (that is the inbound event claim + the
// send-once claim below).
const DUPLICATE_CONTENT_WINDOW_MS = 90 * 1000;
// Emergency per-customer ceiling on AUTOMATED sends only — never applied to
// manual human WhatsApp replies, which never go through this module.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_SENDS = 5;

/**
 * Atomically claims the right to send for a given inbound event row via a
 * compare-and-swap UPDATE (outbound_attempted must still be false). A crash
 * between this claim succeeding and the real provider send completing is a
 * MISSED reply, never a duplicate — deliberate per spec: "temporary missed
 * bot reply < runaway WhatsApp spam".
 */
async function claimOutboundSend(supabase, inboundEventRowId) {
  if (!supabase || !inboundEventRowId) return { claimed: false, reason: 'unavailable' };
  try {
    const { data, error } = await supabase
      .from('wa_inbound_events')
      .update({ processing_status: 'sending', outbound_attempted: true, updated_at: new Date().toISOString() })
      .eq('id', inboundEventRowId)
      .eq('outbound_attempted', false)
      .select('id')
      .maybeSingle();
    if (error) return { claimed: false, reason: 'error', error };
    return { claimed: Boolean(data), reason: data ? null : 'already_attempted' };
  } catch (error) {
    return { claimed: false, reason: 'error', error };
  }
}

async function markOutboundResult(supabase, inboundEventRowId, sent) {
  if (!supabase || !inboundEventRowId) return;
  try {
    await supabase
      .from('wa_inbound_events')
      .update({ processing_status: sent ? 'sent' : 'failed', outbound_sent: sent, updated_at: new Date().toISOString() })
      .eq('id', inboundEventRowId);
  } catch (_error) { /* best-effort bookkeeping only */ }
}

async function isDuplicateContent(supabase, { destinationHash, contentHash, windowMs = DUPLICATE_CONTENT_WINDOW_MS }) {
  if (!supabase) return { duplicate: false, status: 'unavailable' };
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { data, error } = await supabase
      .from('wa_outbound_sends')
      .select('id')
      .eq('destination_hash', destinationHash)
      .eq('content_hash', contentHash)
      .gte('sent_at', since)
      .limit(1);
    if (error) return { duplicate: false, status: 'error' };
    return { duplicate: Boolean(data && data.length), status: 'checked' };
  } catch (_error) {
    return { duplicate: false, status: 'error' };
  }
}

async function isRateLimited(supabase, destinationHash, {
  windowMs = RATE_LIMIT_WINDOW_MS, maxSends = RATE_LIMIT_MAX_SENDS,
} = {}) {
  if (!supabase) return { limited: false, status: 'unavailable' };
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await supabase
      .from('wa_outbound_sends')
      .select('id', { count: 'exact', head: true })
      .eq('destination_hash', destinationHash)
      .gte('sent_at', since);
    if (error) return { limited: false, status: 'error' };
    return { limited: (count || 0) >= maxSends, status: 'checked', count: count || 0 };
  } catch (_error) {
    return { limited: false, status: 'error' };
  }
}

async function recordOutboundSend(supabase, { destinationHash, contentHash, inboundEventId = null, branch = null }) {
  if (!supabase) return;
  try {
    await supabase.from('wa_outbound_sends').insert({
      destination_hash: destinationHash,
      content_hash: contentHash,
      inbound_event_id: inboundEventId,
      branch,
    });
  } catch (_error) { /* best-effort log only, never blocks a send that already happened */ }
}

/**
 * Wraps the real sendWA with the full P0 safety chain, in order:
 *   kill switch -> send-once claim (tied to ONE inbound event) ->
 *   duplicate-content circuit breaker -> per-customer rate limit ->
 *   real provider send -> durable result recording.
 * Fails CLOSED at every step: any guard that cannot be evaluated reliably
 * (supabase unavailable, a query errors) suppresses the send rather than
 * risking a duplicate — "temporary missed bot reply < runaway WhatsApp spam".
 * This is the ONE boundary every automated send path is wired through.
 */
function createGuardedSend({
  realSend, supabase, inboundEventRowId, isEnabled = () => true, logEvent = () => {},
}) {
  return async function guardedSend(to, message, options = {}) {
    const branch = options.branch || null;

    if (!isEnabled()) {
      logEvent({ event_type: 'ai_kill_switch_suppressed', branch, guard_reason: 'reddy_disabled' });
      return { status: false, suppressed: true, reason: 'ai_kill_switch' };
    }

    const destinationHash = hashValue(normalizePhoneDigits(to));
    const contentHash = hashValue(String(message || '').trim().toLowerCase());

    const claim = await claimOutboundSend(supabase, inboundEventRowId);
    if (!claim.claimed) {
      logEvent({
        event_type: claim.reason === 'error' || claim.reason === 'unavailable' ? 'processing_failed' : 'inbound_duplicate_suppressed',
        branch,
        guard_reason: claim.reason || 'unavailable',
      });
      return { status: false, suppressed: true, reason: claim.reason || 'send_already_attempted' };
    }

    const dup = await isDuplicateContent(supabase, { destinationHash, contentHash });
    if (dup.status === 'error') {
      await markOutboundResult(supabase, inboundEventRowId, false);
      logEvent({ event_type: 'processing_failed', branch, guard_reason: 'duplicate_check_unavailable' });
      return { status: false, suppressed: true, reason: 'duplicate_check_failed' };
    }
    if (dup.duplicate) {
      await markOutboundResult(supabase, inboundEventRowId, false);
      logEvent({ event_type: 'outbound_duplicate_suppressed', branch, guard_reason: 'duplicate_content_window' });
      return { status: false, suppressed: true, reason: 'duplicate_content' };
    }

    const limited = await isRateLimited(supabase, destinationHash);
    if (limited.status === 'error') {
      await markOutboundResult(supabase, inboundEventRowId, false);
      logEvent({ event_type: 'processing_failed', branch, guard_reason: 'rate_limit_check_unavailable' });
      return { status: false, suppressed: true, reason: 'rate_limit_check_failed' };
    }
    if (limited.limited) {
      await markOutboundResult(supabase, inboundEventRowId, false);
      logEvent({ event_type: 'rate_limit_suppressed', branch, guard_reason: 'per_customer_ceiling' });
      return { status: false, suppressed: true, reason: 'rate_limited' };
    }

    logEvent({ event_type: 'outbound_send_attempt', branch });
    let result;
    try {
      result = await realSend(to, message, options);
    } catch (error) {
      await markOutboundResult(supabase, inboundEventRowId, false);
      logEvent({ event_type: 'processing_failed', branch, guard_reason: 'send_threw' });
      throw error;
    }

    const sent = Boolean(result && result.status !== false);
    await markOutboundResult(supabase, inboundEventRowId, sent);
    if (sent) await recordOutboundSend(supabase, { destinationHash, contentHash, inboundEventId: inboundEventRowId, branch });
    logEvent({ event_type: sent ? 'outbound_sent' : 'processing_failed', branch, guard_reason: sent ? null : 'send_failed' });

    return result;
  };
}

module.exports = {
  createGuardedSend,
  claimOutboundSend,
  markOutboundResult,
  isDuplicateContent,
  isRateLimited,
  recordOutboundSend,
  DUPLICATE_CONTENT_WINDOW_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_SENDS,
};
