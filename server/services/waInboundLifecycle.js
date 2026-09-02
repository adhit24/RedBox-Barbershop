'use strict';

/**
 * P0 live incident — inbound processing terminalization.
 *
 * Invariant: once an inbound event is successfully CLAIMED (wa_inbound_events
 * row inserted at processing_status='processing'), it must eventually reach a
 * terminal state (sent/failed). The webhook handler has many early-return
 * branches (branch-number suppression, admin commands, human-handoff
 * suppression, kill switch, exceptions) that historically returned without
 * ever touching the row — see the P0 incident report. This module is the ONE
 * centralized place that performs the actual conditional write, so every
 * call site (explicit suppression branches, and the outer try/finally safety
 * net) shares one implementation instead of scattered best-effort updates.
 *
 * Deliberately does NOT touch 'sending' rows and NEVER writes 'sent' itself —
 * server/services/waOutboundGuard.js's reserve_wa_automated_send /
 * complete_wa_automated_send RPCs remain the sole authority for the
 * sending/sent transition (see that migration). This module only ever moves
 * a row OUT of 'received'/'processing' into 'failed', and only when it is
 * still sitting in one of those two states at the moment of the call — a
 * conditional UPDATE, safe to call redundantly (a second/late call is a
 * guaranteed no-op once the row is already terminal or 'sending').
 */

const { logInboundLifecycleEvent } = require('../orchestrator/telemetry');

const TERMINAL_STATUSES = new Set(['sent', 'failed']);

// Statuses this module is willing to move OUT of. Deliberately excludes
// 'sending' (the P0 guarded-send RPCs' exclusive domain) and both terminal
// states themselves (nothing to do).
const RECLAIMABLE_BY_THIS_MODULE = ['received', 'processing'];

/**
 * Conditionally terminalizes a claimed inbound event. Returns
 * { wrote: boolean } — wrote=false means the row was already terminal (or
 * 'sending', or didn't exist), which is the expected/safe outcome for a
 * redundant call, not an error.
 *
 * @param {object} supabase
 * @param {string|null} inboundEventRowId
 * @param {'failed'|'sent'} status - 'sent' is accepted for completeness but
 *   in practice this module is only ever called with 'failed' — a real send
 *   success is reported exclusively via complete_wa_automated_send.
 * @param {string} reason - bounded, non-PII reason tag for telemetry.
 * @param {object} [options]
 * @param {string} [options.source] - which call site triggered this, for telemetry.
 * @param {string|null} [options.branch]
 */
async function terminalizeInbound(supabase, inboundEventRowId, status, reason, { source = 'unknown', branch = null, correlationId = null } = {}) {
  if (!supabase || !inboundEventRowId || !TERMINAL_STATUSES.has(status)) return { wrote: false };
  try {
    const updatePayload = {
      processing_status: status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'failed' && reason) {
      updatePayload.failure_reason = String(reason).slice(0, 100);
      updatePayload.terminal_source = String(source).slice(0, 100);
    }
    if (correlationId) {
      updatePayload.correlation_id = String(correlationId).slice(0, 100);
    }

    let { data, error } = await supabase
      .from('wa_inbound_events')
      .update(updatePayload)
      .eq('id', inboundEventRowId)
      .in('processing_status', RECLAIMABLE_BY_THIS_MODULE)
      .select('id, processing_status');

    if (error && (error.code === '42703' || String(error.message || '').includes('column'))) {
      const fallbackRes = await supabase
        .from('wa_inbound_events')
        .update({ processing_status: status, updated_at: new Date().toISOString() })
        .eq('id', inboundEventRowId)
        .in('processing_status', RECLAIMABLE_BY_THIS_MODULE)
        .select('id, processing_status');
      data = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error) return { wrote: false, error };
    const wrote = Array.isArray(data) && data.length === 1;
    if (wrote) {
      // Observer-only, fail-open — never let telemetry failure affect the
      // caller. Bounded, non-PII dimensions only (see telemetry.js allowlist).
      try {
        logInboundLifecycleEvent({
          event_type: 'inbound_terminalized', new_status: status, reason, source, branch, correlation_id: correlationId,
        });
      } catch (_telemetryError) { /* never blocks the caller */ }
    }
    return { wrote };
  } catch (_error) {
    return { wrote: false };
  }
}

/**
 * The outer try/finally safety net's fallback call — deliberately generic
 * (reason is always 'unexpected_pre_send_exit'). Any earlier, more specific
 * terminalizeInbound() call already moved the row to 'failed', so this is a
 * guaranteed no-op in the common case; it only actually writes (and only
 * then emits telemetry, from terminalizeInbound above) when something this
 * module's author did not anticipate left the row stuck.
 */
async function terminalizeIfStillProcessing(supabase, inboundEventRowId, { source = 'webhook_finally', branch = null, reason = 'unexpected_pre_send_exit', correlationId = null } = {}) {
  return terminalizeInbound(supabase, inboundEventRowId, 'failed', reason, { source, branch, correlationId });
}

module.exports = {
  TERMINAL_STATUSES,
  RECLAIMABLE_BY_THIS_MODULE,
  terminalizeInbound,
  terminalizeIfStillProcessing,
};
