'use strict';

/**
 * Reddy conversation idle-timeout lifecycle (durable, DB-backed — never an
 * in-memory setTimeout, since Redbox runs serverless/multi-instance). State
 * lives in wa_conversations (see server/migrations/2026-08-29-wa-conversation-
 * idle-lifecycle.sql). Two write paths arm/reset the timer:
 *   - touchInboundActivity: every inbound customer message (resets the timer,
 *     and detects/handles reopening a previously-closed conversation).
 *   - armIdleTimerAfterReply: every successful automated Reddy send (the spec's
 *     authoritative "timer starts AFTER Reddy successfully replies" rule).
 * A third path, driven by the api/cron/reddy-idle-close.js cron job, atomically
 * claims and closes conversations whose due time has passed.
 */

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const IDLE_CLOSE_MESSAGE =
  'Terima kasih sudah menghubungi Redbox ya Kak. Kalau nanti butuh info lagi, tinggal chat kami lagi aja.';

function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Called once per inbound customer message. Resets the idle timer and, if the
 * conversation was previously closed, reopens it as a fresh short-term
 * session (clears idle_closed_at, stamps session_started_at) — the caller is
 * responsible for also dropping any in-memory conversation-history cache and
 * treating this turn's context as empty so stale booking context can't bleed
 * into the reopened conversation.
 */
async function touchInboundActivity(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return null;
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .select('conversation_status')
      .eq('sender', sender)
      .maybeSingle();
    const wasClosed = data?.conversation_status === 'closed';
    const patch = {
      conversation_status: 'active',
      last_customer_message_at: toIso(now),
      idle_close_due_at: toIso(now + IDLE_TIMEOUT_MS),
      updated_at: toIso(now),
      ...(wasClosed ? { session_started_at: toIso(now), idle_closed_at: null } : {}),
    };
    await supabase.from('wa_conversations').upsert({ sender, ...patch }, { onConflict: 'sender' });
    return { reopened: wasClosed };
  } catch (_error) {
    return null;
  }
}

/** Called after every successful automated Reddy send — arms/re-arms the 5-minute idle timer. */
async function armIdleTimerAfterReply(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return;
  try {
    await supabase.from('wa_conversations').upsert({
      sender,
      last_bot_message_at: toIso(now),
      idle_close_due_at: toIso(now + IDLE_TIMEOUT_MS),
      updated_at: toIso(now),
    }, { onConflict: 'sender' });
  } catch (_error) {
    /* best-effort — never blocks the send path */
  }
}

/**
 * Atomically claims the right to close ONE conversation. The WHERE clause is
 * the entire "verify at execution time" contract: still active, genuinely
 * overdue (a newer inbound message would have pushed idle_close_due_at
 * forward, past `now`), and not already claimed/sent. Returns null if any
 * condition fails — including a concurrent cron run winning the race.
 */
async function claimIdleConversation(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return null;
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .update({ conversation_status: 'closing', updated_at: toIso(now) })
      .eq('sender', sender)
      .eq('conversation_status', 'active')
      .lte('idle_close_due_at', toIso(now))
      .is('idle_closed_at', null)
      .select('sender,last_customer_message_at,idle_close_due_at')
      .maybeSingle();
    return data || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Resolves a claim made by claimIdleConversation. On success, marks the
 * conversation durably closed (idle_closed_at set) so no later cron pass
 * re-attempts it. On failure, reverts to 'active' — the row stays overdue
 * (idle_close_due_at unchanged) so a later cron pass retries the send; the
 * conversation is never falsely marked closed when the send didn't happen.
 */
async function finalizeIdleClose(supabase, sender, { now = Date.now(), sent } = {}) {
  if (!supabase || !sender) return;
  try {
    if (sent) {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'closed', idle_closed_at: toIso(now), updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('conversation_status', 'closing');
    } else {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'active', updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('conversation_status', 'closing');
    }
  } catch (_error) {
    /* best-effort */
  }
}

module.exports = {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_MESSAGE,
  touchInboundActivity,
  armIdleTimerAfterReply,
  claimIdleConversation,
  finalizeIdleClose,
};
