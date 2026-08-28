'use strict';

const crypto = require('crypto');

// P0 incident hotfix. Env var checked before orchestrator/CRM AI/Reddy/OpenAI/
// automated sendWA are ever reached. Defaults to enabled (true) so merely
// deploying this code does not silently disable Reddy for every environment —
// per the incident runbook, an operator explicitly sets REDDY_ENABLED=false
// in Vercel immediately after this deploys, and re-enables per the smoke-test
// checklist. This is deliberately NOT the same thing as the existing
// per-customer wa_paused/human-takeover mechanism (server/services or
// api/wa/webhook.js checkHumanTakeover/aiPaused) — that is per-customer and
// unaffected by this switch; this is a single global emergency stop.
function isReddyEnabled(env = process.env) {
  return env.REDDY_ENABLED !== 'false';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Classifies a raw provider webhook body into a provenance category BEFORE
 * any AI processing is considered. Extracted from api/wa/webhook.js's
 * existing inline detection (unchanged logic, now shared/testable) — only a
 * 'customer_message' may ever reach the orchestrator/Reddy/OpenAI/automated
 * sendWA. Confirmed actual Fonnte inbound shape via repo comment/existing
 * code: { device, sender, name, message, id, type, isFromMe }; status
 * callbacks carry message_status/status + id/stateid with no message field.
 */
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
 * Resolves the durable idempotency key for a provider event. Fonnte's own
 * `id` field is the primary key (already relied on by the pre-existing
 * in-memory dedup this replaces). Only when it is genuinely absent does this
 * fall back to a bounded fingerprint (sender + message + a short time
 * bucket) — bucketed, not permanent, so two intentionally-repeated identical
 * customer messages sent minutes apart are never conflated; only near-
 * simultaneous redeliveries of the SAME event collapse together.
 */
function resolveProviderMessageId(body = {}, { fallbackBucketMs = 5000, now = Date.now() } = {}) {
  const id = body.id || body.message_id || body.msgid || body.messageId;
  if (id) return { providerMessageId: String(id), isFallback: false };

  const sender = body.sender || body.from || body.number || body.phone || body.target || '';
  const message = body.message || body.text || body.chat || body.body || body.msg || '';
  const bucket = Math.floor(now / fallbackBucketMs);
  const fingerprint = hashValue(`${sender}|${message}|${bucket}`);
  return { providerMessageId: `fallback:${fingerprint}`, isFallback: true };
}

/**
 * Atomically claims a provider inbound event via the wa_inbound_events
 * unique index (provider, provider_message_id). Two concurrent requests for
 * the same event race the same INSERT; exactly one gets a row back, the
 * other gets a 23505 unique violation and is told 'duplicate'. Never reads
 * status. Never sends anything.
 */
async function claimInboundEvent(supabase, { provider = 'fonnte', providerMessageId, senderHash = null, eventType }) {
  if (!supabase || !providerMessageId) return { status: 'unavailable', row: null };
  try {
    const { data, error } = await supabase
      .from('wa_inbound_events')
      .insert({
        provider,
        provider_message_id: String(providerMessageId),
        sender_hash: senderHash,
        event_type: eventType,
        processing_status: 'processing',
      })
      .select('*')
      .single();
    if (!error) return { status: 'claimed', row: data };
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('wa_inbound_events')
        .select('*')
        .eq('provider', provider)
        .eq('provider_message_id', String(providerMessageId))
        .maybeSingle();
      return { status: 'duplicate', row: existing || null };
    }
    return { status: 'error', row: null, error };
  } catch (error) {
    return { status: 'error', row: null, error };
  }
}

async function markInboundEventStatus(supabase, rowId, status) {
  if (!supabase || !rowId) return false;
  try {
    await supabase
      .from('wa_inbound_events')
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
  claimInboundEvent,
  markInboundEventStatus,
};
