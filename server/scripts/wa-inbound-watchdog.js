'use strict';

/**
 * P0 live incident — stale inbound watchdog. SAFETY NET, NOT THE PRIMARY FIX
 * (the primary fix is Objective A's terminalization + Objective B's atomic
 * stale-reclaim, both already wired into api/wa/webhook.js and
 * waInboundGuard.js). This script exists for the residual case neither of
 * those can cover: a message that was claimed, then genuinely never
 * redelivered by the provider (so stale-reclaim never triggers) and whose
 * request crashed hard enough that even the outer try/finally safety net in
 * the webhook handler never ran (a killed serverless instance, not a normal
 * exception).
 *
 * wa_inbound_events does NOT store the raw customer message payload (only
 * bounded SHA-256 hashes — see server/services/waInboundGuard.js and its own
 * migration's header comment). There is therefore NO way for this script to
 * reconstruct what the customer actually asked, and it MUST NOT attempt to:
 *   - never regenerates or guesses an AI response from stale event metadata
 *   - never replays a "reply" the customer never received an answer to
 * If a genuine, trusted, durable raw-payload source is ever proven to exist
 * (e.g. a Fonnte inbox API that can be queried by provider_message_id with
 * real evidence it is safe/authorized to use), that would be a SEPARATE,
 * explicitly-approved follow-up — not something this script does.
 *
 * What this script DOES do, both read-only by default:
 *   1. Alert/ledger pass: finds every wa_inbound_events row stuck at
 *      'received'/'processing' past ALERT_THRESHOLD_SECONDS and emits one
 *      bounded, non-PII `inbound_orphan_detected` telemetry event per row
 *      (age bucket, device hash, outbound_attempted — never sender/phone/
 *      message content).
 *   2. Optional terminalization pass (only when --terminalize is passed):
 *      for rows past the much longer ORPHAN_HORIZON_SECONDS (default 1
 *      hour — well beyond stale-reclaim's own default 3-minute window, so
 *      this only ever touches events that had ample opportunity to either
 *      complete normally or be reclaimed by a genuine redelivery and still
 *      didn't), conditionally moves them to 'failed' via the same
 *      terminalizeInbound() conditional-write module the webhook handler's
 *      own safety net uses — never fabricates a 'sent' outcome.
 *
 * Usage:
 *   node server/scripts/wa-inbound-watchdog.js              # alert-only, read-only
 *   node server/scripts/wa-inbound-watchdog.js --terminalize # also closes true orphans
 * Requires SUPABASE_URL / SUPABASE_SERVICE_KEY. Intended to be run on a
 * schedule (e.g. a cron route, mirroring server/routes/reddyIdleClose.js's
 * pattern) once Aira approves activation — NOT wired into any cron trigger
 * by this change.
 */

const path = require('path');

const { createClient } = require('@supabase/supabase-js');
const { logInboundLifecycleEvent } = require('../orchestrator/telemetry');
const { terminalizeInbound } = require('../services/waInboundLifecycle');

const ALERT_THRESHOLD_SECONDS = Math.max(60, parseInt(process.env.WA_INBOUND_WATCHDOG_ALERT_SECONDS || '300', 10) || 300);
const ORPHAN_HORIZON_SECONDS = Math.max(
  ALERT_THRESHOLD_SECONDS,
  parseInt(process.env.WA_INBOUND_WATCHDOG_ORPHAN_HORIZON_SECONDS || '3600', 10) || 3600,
);
const PAGE_SIZE = 500;

function ageBucket(ageMs) {
  if (ageMs < 5 * 60 * 1000) return '<5m';
  if (ageMs < 8 * 60 * 60 * 1000) return '5-8h';
  if (ageMs < 24 * 60 * 60 * 1000) return '8-24h';
  return '>24h';
}

async function fetchStaleRows(supabase, { olderThanSeconds }) {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('wa_inbound_events')
      .select('id, provider, provider_device_hash, processing_status, outbound_attempted, received_at, updated_at')
      .in('processing_status', ['received', 'processing'])
      .lt('received_at', cutoff)
      .order('received_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch stale wa_inbound_events failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function run({ terminalize = false } = {}) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not configured — refusing to run.');
  }
  const supabase = createClient(url, key);

  const alertRows = await fetchStaleRows(supabase, { olderThanSeconds: ALERT_THRESHOLD_SECONDS });
  const now = Date.now();
  let orphansTerminalized = 0;

  for (const row of alertRows) {
    const ageMs = now - new Date(row.received_at).getTime();
    logInboundLifecycleEvent({
      event_type: 'inbound_orphan_detected',
      provider: row.provider,
      device_hash: row.provider_device_hash,
      previous_status: row.processing_status,
      age_bucket: ageBucket(ageMs),
      outbound_attempted: Boolean(row.outbound_attempted),
      source: 'watchdog',
    });

    if (terminalize && ageMs >= ORPHAN_HORIZON_SECONDS * 1000) {
      const result = await terminalizeInbound(supabase, row.id, 'failed', 'orphan_horizon_exceeded', {
        source: 'watchdog',
      });
      if (result.wrote) orphansTerminalized += 1;
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    alert_threshold_seconds: ALERT_THRESHOLD_SECONDS,
    orphan_horizon_seconds: ORPHAN_HORIZON_SECONDS,
    stale_alerted: alertRows.length,
    orphans_terminalized: orphansTerminalized,
    terminalize_enabled: terminalize,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { run, ALERT_THRESHOLD_SECONDS, ORPHAN_HORIZON_SECONDS };

if (require.main === module) {
  const terminalize = process.argv.includes('--terminalize');
  run({ terminalize }).catch((error) => {
    console.error('[wa-inbound-watchdog] failed:', error.message);
    process.exitCode = 1;
  });
}
