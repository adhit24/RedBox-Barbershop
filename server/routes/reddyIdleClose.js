'use strict';

/**
 * Endpoint / Scheduled Job: Conversation Idle Timeout Close.
 * Mounted at GET /api/cron/reddy-idle-close in server/index.js.
 *
 * Discovery & claim pattern (Task 45 + Objective C scoping):
 *   1. findDueSenders: query `wa_conversations` for rows where
 *      conversation_status='active', idle_close_due_at <= now, and
 *      idle_closed_at IS NULL, excluding legacy-unscoped rows.
 *      Returns { sender, providerDeviceHash, branch } tuples.
 *   2. claimIdleConversation: atomic conditional UPDATE setting status='closing'.
 *      If another process claimed or a customer message arrived, returns null.
 *   3. discovery-time + pre-send handoff checks: if an active Task 15 handoff
 *      case exists, abort and revert claim.
 *   4. verifyStillClaimedForClose: re-check status and last_customer_message_at
 *      immediately before send.
 *   5. channel route validation: branch metadata must be valid. If missing/invalid,
 *      fail closed (suppress send and release claim).
 *   6. guardedSend: send IDLE_CLOSE_MESSAGE passing { branch }.
 *   7. finalizeIdleClose: on success mark closed; on failure revert to active.
 */

const { createClient } = require('@supabase/supabase-js');
const { isReddyEnabled } = require('../services/waInboundGuard');
const { getActiveHandoffState } = require('../services/humanHandoff');
const { createGuardedSend } = require('../services/waOutboundGuard');
const { LEGACY_DEVICE_SCOPE } = require('../services/conversationScope');
const {
  IDLE_CLOSE_MESSAGE, claimIdleConversation, verifyStillClaimedForClose, finalizeIdleClose, normalizeBranch,
} = require('../services/conversationLifecycle');
const { logIdleLifecycleEvent } = require('../orchestrator/telemetry');
const { sendWA: realSendWA } = require('../services/fonnte');

async function findDueSenders(supabase, { now = Date.now(), limit = 200 } = {}) {
  const { data } = await supabase
    .from('wa_conversations')
    .select('sender,provider_device_hash,branch')
    .eq('conversation_status', 'active')
    .not('idle_close_due_at', 'is', null)
    .lte('idle_close_due_at', new Date(now).toISOString())
    .is('idle_closed_at', null)
    .neq('provider_device_hash', LEGACY_DEVICE_SCOPE)
    .limit(limit);
  return (data || []).map((row) => ({
    sender: row.sender,
    providerDeviceHash: row.provider_device_hash,
    branch: row.branch,
  }));
}

module.exports = async function reddyIdleCloseHandler(req, res, testDeps = {}) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
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

  const candidates = testDeps.candidateSenders || await findDueSenders(supabase, {});
  let closed = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    const sender = typeof candidate === 'string' ? candidate : candidate.sender;
    const providerDeviceHash = typeof candidate === 'string' ? null : candidate.providerDeviceHash;
    const rawBranch = typeof candidate === 'string' ? null : candidate.branch;
    const branch = normalizeBranch(rawBranch);

    // 1. Discovery-time handoff check
    const discoveryHandoffState = await handoffLookup(sender);
    if (discoveryHandoffState.status === 'waiting_human' || discoveryHandoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: discoveryHandoffState.status });
      continue;
    }

    // 2. Atomic claim.
      const claim = await claimFn(supabase, sender, { providerDeviceHash });
      if (!claim) {
      continue;
    }

    // Channel route validation: the closing message MUST leave through the
    // same Redbox branch channel that owns this scoped conversation. If branch
    // is missing/invalid, FAIL CLOSED — do NOT silently send through Bypass.
    if (!branch) {
      suppressed++;
      logEvent({
        event_type: 'conversation_idle_close_suppressed',
        suppress_reason: 'missing_branch_route',
      });
      await finalizeFn(supabase, sender, { sent: false, providerDeviceHash });
      continue;
    }

    // 3. Re-verify handoff state didn't open between discovery and claim.
    const preSendHandoffState = await handoffLookup(sender);
    if (preSendHandoffState.status === 'waiting_human' || preSendHandoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: preSendHandoffState.status });
      await finalizeFn(supabase, sender, { sent: false, providerDeviceHash });
      continue;
    }

    // 4. Verification check immediately before send.
      const stillValid = await verifyFn(supabase, sender, {
      expectedLastCustomerMessageAt: claim.last_customer_message_at || null,
      providerDeviceHash,
    });
    if (!stillValid) {
      suppressed++;
      logEvent({
        event_type: 'conversation_idle_close_suppressed',
        suppress_reason: 'newer_inbound_detected',
        stale_idle_close_prevented: true,
      });
      await finalizeFn(supabase, sender, { sent: false, providerDeviceHash });
      continue;
    }

    let sendResult;
    try {
        sendResult = await guardedSend(sender, IDLE_CLOSE_MESSAGE, { branch });
      } catch (_error) {
      sendResult = { status: false };
    }
    const sent = Boolean(sendResult && sendResult.status !== false);
    await finalizeFn(supabase, sender, { sent, providerDeviceHash });
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
