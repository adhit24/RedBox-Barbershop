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
 * Correction Round 1 (PR #45 review) hardened this to re-verify state FOUR
 * separate times before a customer-facing send ever happens, since none of
 * these can be assumed stable across the async gaps between them:
 *   1. Discovery-time handoff check (cheap short-circuit — skip claiming at
 *      all if a handoff is already open).
 *   2. Atomic DB claim (still active, still overdue, not already closed).
 *   3. A second Task15 handoff re-check (Blocker 3) — a handoff can open in
 *      the gap between discovery and claim.
 *   4. verifyStillClaimedForClose (Blocker 2) — deliberately the LAST async
 *      check before guardedSend, called immediately before it: a customer
 *      message landing in the gap while step 3's handoff lookup was in
 *      flight would otherwise slip through undetected. Lifecycle state
 *      (conversation_status/last_customer_message_at) is the most volatile
 *      authority here — a Reddy reply's own arm/reset and a fresh inbound
 *      message can invalidate a claim at any moment — so it is checked as
 *      close to the actual send as this process can get. This does not
 *      make the send itself transactional with a concurrent inbound DB
 *      write — no ordering of async DB reads can fully close that gap
 *      against an external HTTP provider call — but placing the lifecycle
 *      check last minimizes the remaining unavoidable window to just the
 *      provider network round-trip itself, rather than also including a
 *      second DB round-trip (the handoff re-check) after the last
 *      verification.
 * Any of steps 1/3/4 failing aborts the send and releases the claim.
 * The close message itself flows through the same P0 guarded-send path
 * (kill switch, send-once, duplicate-content, rate limit) as every other
 * automated Reddy send — see server/services/waOutboundGuard.js. On any
 * abort or send failure the claim is reverted to 'active' so a later run
 * retries (or, for a newer-inbound abort, simply does nothing further — the
 * timer stays cancelled until Reddy's next reply reschedules it); the
 * conversation is never falsely marked closed.
 *
 * Fails closed if CRON_SECRET is not configured: unlike the read-only/
 * internal cron jobs elsewhere in this codebase, this endpoint sends
 * customer-facing WhatsApp messages, so an unauthenticated request must
 * never be allowed to execute close work.
 */

const { createClient } = require('@supabase/supabase-js');
const { isReddyEnabled } = require('../../server/services/waInboundGuard');
const { getActiveHandoffState } = require('../../server/services/humanHandoff');
const { createGuardedSend } = require('../../server/services/waOutboundGuard');
const {
  IDLE_CLOSE_MESSAGE, claimIdleConversation, verifyStillClaimedForClose, finalizeIdleClose,
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
  if (!secret) {
    // Fail closed: never run customer-facing send work unauthenticated,
    // even in an environment where the secret was never configured.
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${secret}`) {
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
  const claimFn = testDeps.claimIdleConversation || claimIdleConversation;
  const verifyFn = testDeps.verifyStillClaimedForClose || verifyStillClaimedForClose;
  const finalizeFn = testDeps.finalizeIdleClose || finalizeIdleClose;
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
    // 1. Discovery-time handoff check — cheap short-circuit, no DB mutation.
    const discoveryHandoffState = await handoffLookup(sender);
    if (discoveryHandoffState.status === 'waiting_human' || discoveryHandoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: discoveryHandoffState.status });
      continue;
    }

    // 2. Atomic claim.
    const claim = await claimFn(supabase, sender, {});
    if (!claim) {
      // Already claimed by a concurrent run, reopened by a newer inbound
      // message, or not actually due — do nothing (spec: "if any condition
      // fails: do nothing").
      continue;
    }

    // 3. Blocker 3: re-verify handoff state didn't open between discovery and claim.
    const preSendHandoffState = await handoffLookup(sender);
    if (preSendHandoffState.status === 'waiting_human' || preSendHandoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: preSendHandoffState.status });
      await finalizeFn(supabase, sender, { sent: false });
      continue;
    }

    // 4. Blocker 2: the FINAL check, immediately before the send — a customer
    // can message again in the window that just elapsed (including during
    // the handoff lookup above), and lifecycle state is the most volatile
    // authority here. See the file-header note on why this must be last.
    const stillValid = await verifyFn(supabase, sender, {
      expectedLastCustomerMessageAt: claim.last_customer_message_at || null,
    });
    if (!stillValid) {
      suppressed++;
      logEvent({
        event_type: 'conversation_idle_close_suppressed',
        suppress_reason: 'newer_inbound_detected',
        stale_idle_close_prevented: true,
      });
      await finalizeFn(supabase, sender, { sent: false });
      continue;
    }

    let sendResult;
    try {
      sendResult = await guardedSend(sender, IDLE_CLOSE_MESSAGE, {});
    } catch (_error) {
      sendResult = { status: false };
    }
    const sent = Boolean(sendResult && sendResult.status !== false);
    await finalizeFn(supabase, sender, { sent });
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
