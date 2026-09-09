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
 *   7. finalizeIdleClose: mark the lifecycle closed after a successful send or
 *      after an optional close-message failure, preventing endless retries.
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

const MAX_CANDIDATES_PER_RUN = 12;
const MAX_CONCURRENCY = 4;

function emptySummary(overrides = {}) {
  return {
    ok: true,
    processed: 0,
    closed: 0,
    closed_without_message: 0,
    failed: 0,
    suppressed: 0,
    ...overrides,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function findDueSenders(supabase, { now = Date.now(), limit = MAX_CANDIDATES_PER_RUN } = {}) {
  const { data, error } = await supabase
    .from('wa_conversations')
    .select('sender,provider_device_hash,branch,idle_close_due_at')
    .eq('conversation_status', 'active')
    .not('idle_close_due_at', 'is', null)
    .lte('idle_close_due_at', new Date(now).toISOString())
    .is('idle_closed_at', null)
    .neq('provider_device_hash', LEGACY_DEVICE_SCOPE)
    .limit(limit * 4);
  if (error) throw error;
  return (data || [])
    .map((row) => ({
      sender: row.sender,
      providerDeviceHash: row.provider_device_hash,
      branch: normalizeBranch(row.branch),
      dueAt: row.idle_close_due_at,
    }))
    .filter((row) => row.sender && /^[a-f0-9]{64}$/i.test(row.providerDeviceHash || ''))
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
    .slice(0, limit)
    .map(({ dueAt: _dueAt, ...row }) => row);
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

  const checkEnabled = () => (testDeps.isReddyEnabled ? testDeps.isReddyEnabled() : isReddyEnabled());
  const logEvent = testDeps.logEvent || logIdleLifecycleEvent;
  const safeLogEvent = (event) => {
    try { logEvent(event); } catch (_error) { /* telemetry must never fail the cron */ }
  };

  if (!checkEnabled()) {
    safeLogEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'reddy_disabled' });
    return res.status(200).json(emptySummary({ reason: 'reddy_disabled' }));
  }

  let supabase;
  try {
    supabase = testDeps.supabase
      || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  } catch (_error) {
    return res.status(200).json(emptySummary({ ok: false, failed: 1, reason: 'database_not_configured' }));
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
    logEvent: (e) => safeLogEvent({ ...e }),
  });

  let candidates;
  try {
    const discover = testDeps.findDueSenders || findDueSenders;
    candidates = testDeps.candidateSenders
      || await discover(supabase, { limit: testDeps.candidateLimit || MAX_CANDIDATES_PER_RUN });
  } catch (_error) {
    return res.status(200).json(emptySummary({ ok: false, failed: 1, reason: 'discovery_failed' }));
  }

  // Authenticated, read-only production probe. This validates routing, auth,
  // configuration, and candidate discovery without claiming rows or sending WA.
  const dryRun = String(req.query?.dry_run || '').toLowerCase();
  if (dryRun === '1' || dryRun === 'true') {
    return res.status(200).json(emptySummary({ dry_run: true, eligible: candidates.length }));
  }

  const processCandidate = async (candidate) => {
    const sender = typeof candidate === 'string' ? candidate : candidate.sender;
    const providerDeviceHash = typeof candidate === 'string' ? null : candidate.providerDeviceHash;
    const rawBranch = typeof candidate === 'string' ? null : candidate.branch;
    const branch = normalizeBranch(rawBranch);
    let claimed = false;

    try {
      // 1. Discovery-time handoff check. Lookup failure is fail-closed.
      const discoveryHandoffState = await handoffLookup(sender);
      if (discoveryHandoffState.status === 'waiting_human' || discoveryHandoffState.status === 'human_active') {
        safeLogEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: discoveryHandoffState.status });
        return { closed: 0, closedWithoutMessage: 0, failed: 0, suppressed: 1 };
      }
      if (discoveryHandoffState.status === 'lookup_failed') {
        return { closed: 0, closedWithoutMessage: 0, failed: 1, suppressed: 0 };
      }

      if (!sender || !providerDeviceHash || !branch) {
        safeLogEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'missing_branch_route' });
        return { closed: 0, closedWithoutMessage: 0, failed: 0, suppressed: 1 };
      }

      // 2. Atomic claim.
      const claim = await claimFn(supabase, sender, { providerDeviceHash });
      if (!claim) {
        return { closed: 0, closedWithoutMessage: 0, failed: 0, suppressed: 1 };
      }
      claimed = true;

      // 3. Re-verify handoff state didn't open between discovery and claim.
      const preSendHandoffState = await handoffLookup(sender);
      if (preSendHandoffState.status !== 'none') {
        safeLogEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: preSendHandoffState.status });
        await finalizeFn(supabase, sender, { sent: false, providerDeviceHash });
        claimed = false;
        return preSendHandoffState.status === 'lookup_failed'
          ? { closed: 0, closedWithoutMessage: 0, failed: 1, suppressed: 0 }
          : { closed: 0, closedWithoutMessage: 0, failed: 0, suppressed: 1 };
      }

      // 4. Verification check immediately before send.
      const stillValid = await verifyFn(supabase, sender, {
        expectedLastCustomerMessageAt: claim.last_customer_message_at || null,
        providerDeviceHash,
      });
      if (!stillValid) {
        safeLogEvent({
          event_type: 'conversation_idle_close_suppressed',
          suppress_reason: 'newer_inbound_detected',
          stale_idle_close_prevented: true,
        });
        await finalizeFn(supabase, sender, { sent: false, providerDeviceHash });
        claimed = false;
        return { closed: 0, closedWithoutMessage: 0, failed: 0, suppressed: 1 };
      }

      let sendResult;
      try {
        sendResult = await guardedSend(sender, IDLE_CLOSE_MESSAGE, { branch });
      } catch (_error) {
        sendResult = { status: false };
      }
      const sent = Boolean(sendResult && sendResult.status !== false);
      await finalizeFn(supabase, sender, {
        sent,
        closeWithoutSend: !sent,
        providerDeviceHash,
      });
      claimed = false;
      if (sent) {
        safeLogEvent({ event_type: 'conversation_idle_close_sent', branch });
        return { closed: 1, closedWithoutMessage: 0, failed: 0, suppressed: 0 };
      }

      // The closing message is optional. A provider/guard failure closes the
      // lifecycle without a message, so the cron cannot spam-retry forever.
      safeLogEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'send_failed', branch });
      return { closed: 0, closedWithoutMessage: 1, failed: 1, suppressed: 0 };
    } catch (_error) {
      if (claimed) {
        try { await finalizeFn(supabase, sender, { sent: false, providerDeviceHash }); } catch (_releaseError) { /* best effort */ }
      }
      return { closed: 0, closedWithoutMessage: 0, failed: 1, suppressed: 0 };
    }
  };

  const results = await mapWithConcurrency(
    candidates,
    testDeps.concurrency || MAX_CONCURRENCY,
    processCandidate,
  );
  const summary = results.reduce((total, result) => ({
    closed: total.closed + result.closed,
    closed_without_message: total.closed_without_message + result.closedWithoutMessage,
    failed: total.failed + result.failed,
    suppressed: total.suppressed + result.suppressed,
  }), { closed: 0, closed_without_message: 0, failed: 0, suppressed: 0 });

  return res.status(200).json(emptySummary({ processed: candidates.length, ...summary }));
};

module.exports.findDueSenders = findDueSenders;
module.exports.mapWithConcurrency = mapWithConcurrency;
