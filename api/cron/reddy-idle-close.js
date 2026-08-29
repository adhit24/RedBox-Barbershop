/**
 * Vercel Cron — GET /api/cron/reddy-idle-close
 * Triggered externally every 5 minutes (cron-job.org — same pattern as
 * api/cron/home-service-flag.js, see cronjoborg_homeservice.md), since the
 * Vercel Hobby plan's own cron scheduler cannot run this frequently.
 *
 * Closes any Reddy conversation that has been idle for AT LEAST 5 minutes
 * since Reddy's last reply, sending exactly one deterministic closing
 * message per session. "At least" because scheduler frequency is coarser
 * than the exact 5-minute mark — see conversationLifecycle.js.
 *
 * Every close attempt re-verifies, at execution time, in this order:
 *   1. REDDY_ENABLED kill switch (global).
 *   2. Task15 human handoff state — never closes while waiting_human/human_active.
 *   3. An atomic DB claim (still active, still overdue, not already closed) —
 *      the actual race-condition protection; see claimIdleConversation.
 * The close message itself flows through the same P0 guarded-send path
 * (kill switch, send-once, duplicate-content, rate limit) as every other
 * automated Reddy send — see server/services/waOutboundGuard.js. On send
 * failure the claim is reverted to 'active' so a later run retries; the
 * conversation is never falsely marked closed.
 */

const { createClient } = require('@supabase/supabase-js');
const { isReddyEnabled } = require('../../server/services/waInboundGuard');
const { getActiveHandoffState } = require('../../server/services/humanHandoff');
const { createGuardedSend } = require('../../server/services/waOutboundGuard');
const {
  IDLE_CLOSE_MESSAGE, claimIdleConversation, finalizeIdleClose,
} = require('../../server/services/conversationLifecycle');
const { logIdleLifecycleEvent } = require('../../server/orchestrator/telemetry');
const { sendWA: realSendWA } = require('../../server/services/fonnte');

async function findDueSenders(supabase, { now = Date.now(), limit = 200 } = {}) {
  const { data } = await supabase
    .from('wa_conversations')
    .select('sender')
    .eq('conversation_status', 'active')
    .not('idle_close_due_at', 'is', null)
    .lte('idle_close_due_at', new Date(now).toISOString())
    .is('idle_closed_at', null)
    .limit(limit);
  return (data || []).map((row) => row.sender);
}

module.exports = async function handler(req, res, testDeps = {}) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = testDeps.supabase
    || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const checkEnabled = () => (testDeps.isReddyEnabled ? testDeps.isReddyEnabled() : isReddyEnabled());
  const logEvent = testDeps.logEvent || logIdleLifecycleEvent;

  if (!checkEnabled()) {
    logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'reddy_disabled' });
    return res.status(200).json({ ok: true, closed: 0, suppressed: 0, reason: 'reddy_disabled' });
  }

  const handoffLookup = testDeps.getActiveHandoffState
    || ((phone) => getActiveHandoffState(phone, { supabase }));
  const sendFn = testDeps.sendWA || realSendWA;
  const guardedSend = createGuardedSend({
    realSend: sendFn,
    supabase,
    inboundEventRowId: null,
    isEnabled: checkEnabled,
    logEvent: (e) => logEvent({ ...e }),
  });

  const senders = testDeps.candidateSenders || await findDueSenders(supabase, {});
  let closed = 0;
  let suppressed = 0;

  for (const sender of senders) {
    const handoffState = await handoffLookup(sender);
    if (handoffState.status === 'waiting_human' || handoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: handoffState.status });
      continue;
    }

    const claim = await claimIdleConversation(supabase, sender, {});
    if (!claim) {
      // Already claimed by a concurrent run, reopened by a newer inbound
      // message, or not actually due — do nothing (spec: "if any condition
      // fails: do nothing").
      continue;
    }

    let sendResult;
    try {
      sendResult = await guardedSend(sender, IDLE_CLOSE_MESSAGE, {});
    } catch (_error) {
      sendResult = { status: false };
    }
    const sent = Boolean(sendResult && sendResult.status !== false);
    await finalizeIdleClose(supabase, sender, { sent });
    if (sent) {
      closed++;
      logEvent({ event_type: 'conversation_idle_close_sent' });
    } else {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'send_failed' });
    }
  }

  return res.status(200).json({ ok: true, closed, suppressed });
};
