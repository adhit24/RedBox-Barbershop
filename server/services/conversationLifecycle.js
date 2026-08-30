'use strict';

/**
 * Objective C / Task 45 - Conversation Idle Timeout & Lifecycle State Machine.
 *
 * Tracks per-conversation idle timeouts and status transitions:
 *   - active: active conversation, eligible for 5-minute idle-close.
 *   - closing: claimed by the idle-close cron, currently sending close message.
 *   - closed: idle-closed by Reddy. A subsequent customer message flips back
 *     to active and clears session context.
 *
 * Main entry points:
 *   - touchInboundActivity: every inbound customer message — cancels any
 *     pending idle close, and detects/handles reopening a previously-closed
 *     conversation.
 *   - armIdleTimerAfterReply: every successful automated Reddy send — the
 *     only place idle_close_due_at is ever set to a real deadline.
 *   - claimIdleConversation / verifyStillClaimedForClose / finalizeIdleClose:
 *     driven by the api/cron/reddy-idle-close.js cron job, which atomically
 *     claims a conversation whose due time has passed, re-verifies nothing
 *     changed immediately before the actual send (Blocker 2), and finalizes.
 */

const { resolveConversationDeviceScope } = require('./conversationScope');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const IDLE_CLOSE_MESSAGE =
  'Terima kasih sudah menghubungi Redbox ya Kak. Kalau nanti butuh info lagi, tinggal chat kami lagi aja.';

const ALLOWED_BRANCHES = new Set(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);

function normalizeBranch(branch) {
  if (typeof branch !== 'string') return null;
  const b = branch.trim().toLowerCase();
  return ALLOWED_BRANCHES.has(b) ? b : null;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Called once per inbound customer message. Cancels any pending idle-close
 * deadline (idle_close_due_at: null) - inbound activity alone never
 * schedules a new one; only armIdleTimerAfterReply does, after Reddy
 * actually replies. Also flips a 'closing' claim (mid-cron-pass) back to
 * 'active', which is exactly what lets a concurrent cron pass detect "a
 * newer inbound happened" via verifyStillClaimedForClose (Blocker 2). If the
 * conversation was previously closed, reopens it as a fresh short-term
 * session (clears idle_closed_at, stamps session_started_at) - the caller is
 * responsible for also dropping any in-memory conversation-history cache and
 * treating this turn's context as empty so stale booking context can't bleed
 * into the reopened conversation.
 *
 * Objective C: scoped by (sender, provider_device_hash) - a customer's
 * conversation on one branch device's idle timer is fully independent of
 * their conversation on another device. `providerDeviceHash` is optional for
 * backward compatibility (defaults to the legacy sentinel scope) but every
 * real caller (api/wa/webhook.js) always passes the actual hash.
 */
async function touchInboundActivity(supabase, sender, { now = Date.now(), providerDeviceHash = null, branch = null } = {}) {
  if (!supabase || !sender) return null;
  const deviceScope = resolveConversationDeviceScope(providerDeviceHash);
  const validBranch = normalizeBranch(branch);
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .select('conversation_status')
      .eq('sender', sender)
      .eq('provider_device_hash', deviceScope)
      .maybeSingle();
    const wasClosed = data?.conversation_status === 'closed';
    const patch = {
      conversation_status: 'active',
      last_customer_message_at: toIso(now),
      idle_close_due_at: null,
      updated_at: toIso(now),
      ...(wasClosed ? { session_started_at: toIso(now), idle_closed_at: null } : {}),
      ...(validBranch ? { branch: validBranch } : {}),
    };
    await supabase.from('wa_conversations')
      .upsert({ sender, provider_device_hash: deviceScope, ...patch }, { onConflict: 'sender,provider_device_hash' });
    return { reopened: wasClosed };
  } catch (_error) {
    return null;
  }
}

/** Called after every successful automated Reddy send - arms/re-arms the 5-minute idle timer. */
async function armIdleTimerAfterReply(supabase, sender, { now = Date.now(), providerDeviceHash = null, branch = null } = {}) {
  if (!supabase || !sender) return;
  const deviceScope = resolveConversationDeviceScope(providerDeviceHash);
  const validBranch = normalizeBranch(branch);
  try {
    await supabase.from('wa_conversations').upsert({
      sender,
      provider_device_hash: deviceScope,
      last_bot_message_at: toIso(now),
      idle_close_due_at: toIso(now + IDLE_TIMEOUT_MS),
      updated_at: toIso(now),
      ...(validBranch ? { branch: validBranch } : {}),
    }, { onConflict: 'sender,provider_device_hash' });
  } catch (_error) {
    /* best-effort - never blocks the send path */
  }
}

/**
 * Atomically claims the right to close ONE conversation. The WHERE clause is
 * the entire "verify at execution time" contract: still active, genuinely
 * overdue (a newer inbound message would have pushed idle_close_due_at
 * forward, past `now`), and not already claimed/sent. Returns null if any
 * condition fails - including a concurrent cron run winning the race.
 * Scoped by (sender, provider_device_hash) - see touchInboundActivity.
 */
async function claimIdleConversation(supabase, sender, { now = Date.now(), providerDeviceHash = null } = {}) {
  if (!supabase || !sender) return null;
  const deviceScope = resolveConversationDeviceScope(providerDeviceHash);
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .update({ conversation_status: 'closing', updated_at: toIso(now) })
      .eq('sender', sender)
      .eq('provider_device_hash', deviceScope)
      .eq('conversation_status', 'active')
      .lte('idle_close_due_at', toIso(now))
      .is('idle_closed_at', null)
      .select('sender,provider_device_hash,last_customer_message_at,idle_close_due_at')
      .maybeSingle();
    return data || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Correction Round 1 (PR #45 review, Blocker 2): an atomic claim alone is not
 * enough - a customer can message again in the window between the claim and
 * the actual provider send. Called immediately before that send: re-reads
 * authoritative state and returns true only if the conversation is STILL in
 * the exact claim this caller made - status is still 'closing' AND
 * last_customer_message_at is unchanged since the claim (touchInboundActivity
 * both flips status back to 'active' and bumps last_customer_message_at on
 * any new inbound message, so either check alone would already catch it -
 * both are verified for defense in depth). False means "do nothing": the
 * caller must abort the send and release the claim via finalizeIdleClose.
 * Scoped by (sender, provider_device_hash) - see touchInboundActivity.
 */
async function verifyStillClaimedForClose(supabase, sender, { expectedLastCustomerMessageAt = null, providerDeviceHash = null } = {}) {
  if (!supabase || !sender) return false;
  const deviceScope = resolveConversationDeviceScope(providerDeviceHash);
  try {
    let query = supabase
      .from('wa_conversations')
      .select('sender')
      .eq('sender', sender)
      .eq('provider_device_hash', deviceScope)
      .eq('conversation_status', 'closing');
    query = expectedLastCustomerMessageAt == null
      ? query.is('last_customer_message_at', null)
      : query.eq('last_customer_message_at', expectedLastCustomerMessageAt);
    const { data } = await query.maybeSingle();
    return Boolean(data);
  } catch (_error) {
    return false;
  }
}

/**
 * Resolves a claim made by claimIdleConversation. On success, marks the
 * conversation durably closed (idle_closed_at set) so no later cron pass
 * re-attempts it. On failure, reverts to 'active' - the row stays overdue
 * (idle_close_due_at unchanged) so a later cron pass retries the send; the
 * conversation is never falsely marked closed when the send didn't happen.
 * Scoped by (sender, provider_device_hash) - see touchInboundActivity.
 */
async function finalizeIdleClose(supabase, sender, { now = Date.now(), sent, providerDeviceHash = null } = {}) {
  if (!supabase || !sender) return;
  const deviceScope = resolveConversationDeviceScope(providerDeviceHash);
  try {
    if (sent) {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'closed', idle_closed_at: toIso(now), updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('provider_device_hash', deviceScope)
        .eq('conversation_status', 'closing');
    } else {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'active', updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('provider_device_hash', deviceScope)
        .eq('conversation_status', 'closing');
    }
  } catch (_error) {
    /* best-effort */
  }
}

module.exports = {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_MESSAGE,
  ALLOWED_BRANCHES,
  normalizeBranch,
  touchInboundActivity,
  armIdleTimerAfterReply,
  claimIdleConversation,
  verifyStillClaimedForClose,
  finalizeIdleClose,
};
