'use strict';

const crypto = require('crypto');
const { logInboundLifecycleEvent } = require('../orchestrator/telemetry');

function isReddyEnabled(env = process.env) {
  return String(env.REDDY_ENABLED || '').trim().toLowerCase() === 'true';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** One provenance classifier for the production webhook and its tests. */
function classifyInboundEvent(body = {}, { device = null } = {}) {
  const messageStatus = body.message_status || body.status;
  const statusId = body.id || body.message_id || body.msgid || body.messageId;
  const statusStateId = body.stateid || body.stateId;
  const hasIncomingMessageField = Boolean(body.message || body.text || body.chat || body.body || body.msg);
  const likelyStatusWebhook = Boolean(messageStatus) && (Boolean(statusId) || Boolean(statusStateId))
    && !hasIncomingMessageField && !body.sender && !body.from && !body.name && !body.pushName;
  const likelyFonnteStatusWebhook = likelyStatusWebhook
    || ((Boolean(statusId) || Boolean(statusStateId)) && Boolean(body.status)
      && (Boolean(body.stateid) || Boolean(body.state)) && !hasIncomingMessageField);
  if (likelyFonnteStatusWebhook) return 'status_callback';

  const sender = body.sender || body.from || body.number || body.phone || body.target;
  const isFromMe = body.isFromMe === true || body.isFromMe === 1
    || body.is_from_me === true || body.is_from_me === 1
    || body.fromMe === true || body.fromMe === 1
    || (device && sender && String(sender) === String(device));
  if (isFromMe) return 'self_message';

  const message = body.message || body.text || body.chat || body.body || body.msg;
  if (!sender || !message) return 'unsupported';
  return 'customer_message';
}

/**
 * Fonnte's documented inbound reply identifier is `inboxid` when Inbox is
 * enabled; older/live payload variants also use the four existing ID names.
 * There is deliberately no content/time fallback: without a provider ID the
 * webhook fails closed before AI. The stored value is a bounded SHA-256 hash.
 */
function resolveProviderMessageId(body = {}) {
  const candidates = [
    ['inboxid', body.inboxid],
    ['id', body.id],
    ['message_id', body.message_id],
    ['msgid', body.msgid],
    ['messageId', body.messageId],
  ];
  const found = candidates.find(([, value]) => value !== undefined && value !== null
    && String(value).trim() && String(value).trim() !== '0');
  if (!found) return { providerMessageId: null, source: null };
  const [source, value] = found;
  return {
    providerMessageId: hashValue(`fonnte-message:${String(value).trim()}`),
    source,
  };
}

/** Fonnte `device` is the provider channel scope. Never store it raw. */
function resolveProviderDeviceHash(body = {}) {
  const value = body.device ?? body.device_id ?? body.deviceId;
  if (value === undefined || value === null || !String(value).trim() || String(value).trim() === '0') return null;
  return hashValue(`fonnte-device:${String(value).trim()}`);
}

// Objective B (P0 stale-claim reclamation): a redelivered provider event
// whose original claim crashed/stalled after claim (row stuck at
// processing_status='processing', outbound_attempted=FALSE, stale past a
// bounded threshold) may atomically reclaim that SAME row instead of
// bouncing off the unique-index hit as a permanent 'duplicate'. Eligibility
// is enforced entirely inside the single-statement conditional UPDATE in
// reclaim_stale_wa_inbound_event (see the P0 migration) — no SELECT-then-
// UPDATE race, Postgres row locking + the updated_at refresh on a successful
// reclaim guarantee at most one concurrent winner. Never reclaims 'sending'/
// 'sent'/'failed', never a row that already has outbound_attempted=true, and
// never touches outbound_attempted itself — the normal single-send guarantee
// (reserve_wa_automated_send's own conditional UPDATE) still applies exactly
// once when the reclaimed event proceeds through the normal pipeline.
const STALE_RECLAIM_SECONDS = Math.max(60, parseInt(process.env.WA_INBOUND_STALE_RECLAIM_SECONDS || '180', 10) || 180);

async function attemptStaleReclaim(supabase, { provider, providerDeviceHash, providerMessageId }) {
  if (!supabase || !providerDeviceHash || !providerMessageId) return { reclaimed: false, inboundEventId: null };
  try {
    const { data, error } = await supabase.rpc('reclaim_stale_wa_inbound_event', {
      p_provider: provider,
      p_provider_device_hash: String(providerDeviceHash),
      p_provider_message_id: String(providerMessageId),
      p_stale_seconds: STALE_RECLAIM_SECONDS,
    });
    if (error) return { reclaimed: false, inboundEventId: null, error };
    const row = Array.isArray(data) ? data[0] : data;
    return { reclaimed: Boolean(row?.reclaimed), inboundEventId: row?.inbound_event_id || null };
  } catch (error) {
    return { reclaimed: false, inboundEventId: null, error };
  }
}

/** Atomic INSERT claim backed by (provider, device hash, message ID hash). */
async function claimInboundEvent(supabase, {
  provider = 'fonnte', providerDeviceHash, providerMessageId, senderHash = null, eventType,
}) {
  if (!supabase || !providerDeviceHash || !providerMessageId) return { status: 'unavailable', row: null };
  try {
    const { data, error } = await supabase
      .from('wa_inbound_events')
      .insert({
        provider,
        provider_device_hash: String(providerDeviceHash),
        provider_message_id: String(providerMessageId),
        sender_hash: senderHash,
        event_type: eventType,
        processing_status: 'processing',
      })
      .select('*')
      .single();
    if (!error) return { status: 'claimed', row: data };
    if (error.code === '23505') {
      const reclaim = await attemptStaleReclaim(supabase, { provider, providerDeviceHash, providerMessageId });
      if (reclaim.reclaimed && reclaim.inboundEventId) {
        const { data: reclaimedRow } = await supabase
          .from('wa_inbound_events')
          .select('*')
          .eq('id', reclaim.inboundEventId)
          .maybeSingle();
        try {
          logInboundLifecycleEvent({
            event_type: 'inbound_stale_reclaimed', provider, reclaimed: true,
            outbound_attempted: false, source: 'claim_inbound_event',
          });
        } catch (_telemetryError) { /* observer-only */ }
        return { status: 'claimed', row: reclaimedRow || null, reclaimed: true };
      }
      const { data: existing } = await supabase
        .from('wa_inbound_events')
        .select('*')
        .eq('provider', provider)
        .eq('provider_device_hash', String(providerDeviceHash))
        .eq('provider_message_id', String(providerMessageId))
        .maybeSingle();
      return { status: 'duplicate', row: existing || null };
    }
    return { status: 'error', row: null, error };
  } catch (error) {
    return { status: 'error', row: null, error };
  }
}

/**
 * Admission authority used by the real webhook. Only `claimed` may proceed
 * to orchestration. Missing provider identity and every DB failure fail closed.
 */
async function admitInboundEvent(supabase, body = {}, { provider = 'fonnte' } = {}) {
  const device = body.device || body.device_id || body.deviceId;
  const eventType = classifyInboundEvent(body, { device });
  if (eventType !== 'customer_message') return { status: 'ignored', eventType, row: null };

  const { providerMessageId, source } = resolveProviderMessageId(body);
  if (!providerMessageId) {
    return { status: 'missing_provider_message_id', eventType, row: null };
  }
  const providerDeviceHash = resolveProviderDeviceHash(body);
  if (!providerDeviceHash) {
    return { status: 'missing_provider_device_id', eventType, row: null, providerMessageIdSource: source };
  }
  const sender = body.sender || body.from || body.number || body.phone || body.target;
  const claim = await claimInboundEvent(supabase, {
    provider,
    providerDeviceHash,
    providerMessageId,
    senderHash: hashValue(normalizePhoneDigits(sender)),
    eventType,
  });
  return {
    ...claim,
    eventType,
    providerDeviceHash,
    providerMessageId,
    providerMessageIdSource: source,
  };
}

async function markInboundEventStatus(supabase, rowId, status) {
  if (!supabase || !rowId) return false;
  try {
    await supabase.from('wa_inbound_events')
      .update({ processing_status: status, updated_at: new Date().toISOString() })
      .eq('id', rowId);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  isReddyEnabled,
  hashValue,
  normalizePhoneDigits,
  classifyInboundEvent,
  resolveProviderMessageId,
  resolveProviderDeviceHash,
  claimInboundEvent,
  admitInboundEvent,
  markInboundEventStatus,
  attemptStaleReclaim,
  STALE_RECLAIM_SECONDS,
};
