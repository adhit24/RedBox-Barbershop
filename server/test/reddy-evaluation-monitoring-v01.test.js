'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  SEVERITIES,
  normalizeBranch,
  sanitizeMetadata,
  normalizeEvaluationEvent,
  recordEvaluationEvent,
  mapTelemetryToEvaluation,
  evaluateOutboundMessage,
  aggregateHealth,
  detectStuckHandoffCases,
} = require('../services/reddyEvaluationMonitoring');
const { createReddyEvaluationRoutes, parseWindow, resolveEvaluationBranch } = require('../routes/reddyEvaluation');
const { createGuardedSend } = require('../services/waOutboundGuard');

function event(event_type, branch = 'bypass', created_at = '2026-08-29T10:00:00.000Z', extras = {}) {
  return normalizeEvaluationEvent({ event_type, branch, created_at, ...extras });
}

function insertSupabase({ error = null, throws = false } = {}) {
  const rows = [];
  return {
    rows,
    from(table) {
      assert.equal(table, 'reddy_evaluation_events');
      return {
        async insert(row) {
          if (throws) throw new Error('monitoring offline');
          if (!error) rows.push(row);
          return { error };
        },
      };
    },
  };
}

test('1. successful inbound telemetry normalizes and persists without message content', async () => {
  const mapped = mapTelemetryToEvaluation('anti_spam', {
    timestamp: '2026-08-29T10:00:00Z', event_type: 'inbound_event_claimed', branch: 'bypass', provider: 'fonnte',
    device_hash: 'a'.repeat(64), message_id_present: true, idempotency_status: 'claimed',
  });
  assert.equal(mapped.length, 1);
  const supabase = insertSupabase();
  const result = await recordEvaluationEvent({
    ...mapped[0], metadata: { ...mapped[0].metadata, message_text: 'rahasia' },
  }, { supabase });
  assert.equal(result.status, 'recorded');
  assert.equal(supabase.rows[0].severity, SEVERITIES.INFO);
  assert.deepEqual(supabase.rows[0].metadata, {
    device_hash: 'a'.repeat(64), provider_id_present: true, dedup_outcome: 'claimed',
  });
});

test('2. duplicate inbound produces the normalized suppression event', () => {
  const [mapped] = mapTelemetryToEvaluation('anti_spam', { event_type: 'inbound_duplicate_suppressed', branch: 'csb', provider: 'fonnte' });
  assert.equal(mapped.event_type, 'inbound_duplicate_suppressed');
  assert.equal(normalizeEvaluationEvent(mapped).severity, 'INFO');
});

test('3. missing provider message id is a CRITICAL P0 identity event', () => {
  const [mapped] = mapTelemetryToEvaluation('anti_spam', { event_type: 'processing_failed', guard_reason: 'missing_provider_message_id' });
  const normalized = normalizeEvaluationEvent(mapped);
  assert.equal(normalized.event_type, 'missing_provider_message_id');
  assert.equal(normalized.severity, 'CRITICAL');
});

test('4. outbound duplicate suppression is recorded as WARNING', () => {
  const [mapped] = mapTelemetryToEvaluation('anti_spam', { event_type: 'outbound_duplicate_suppressed', branch: 'sumber' });
  assert.equal(normalizeEvaluationEvent(mapped).severity, 'WARNING');
});

test('5. kill switch suppression is visible without treating the expected guard as a bypass', () => {
  const [mapped] = mapTelemetryToEvaluation('anti_spam', { event_type: 'ai_kill_switch_suppressed', branch: 'tegal' });
  const normalized = normalizeEvaluationEvent(mapped);
  assert.equal(normalized.event_type, 'outbound_kill_switch_suppressed');
  assert.equal(normalized.severity, 'INFO');
});

test('6. P0.2 operating-hours question remains an hours event, never a price event', () => {
  const events = mapTelemetryToEvaluation('orchestrator', {
    event_type: 'orchestrator_routing', intent: 'operating_hours_inquiry', route: 'reddy_agent', action: 'keyword_shortcut', branch: 'tegal',
  });
  const keyword = events.find((item) => item.event_type === 'keyword_shortcut_used');
  assert.equal(keyword.intent, 'operating_hours_inquiry');
  assert.equal(events.some((item) => item.intent === 'price_inquiry'), false);
});

test('7. Task15 waiting_human suppression is observed', () => {
  const [mapped] = mapTelemetryToEvaluation('handoff', { event_type: 'handoff_bot_suppressed', branch: 'bypass', priority: 'normal' });
  assert.equal(mapped.event_type, 'handoff_bot_suppressed');
});

test('8. Task15 human_active suppression uses the same persisted-authority observation event', () => {
  const [mapped] = mapTelemetryToEvaluation('handoff', { event_type: 'handoff_bot_suppressed', branch: 'csb', priority: 'high' });
  assert.equal(normalizeEvaluationEvent(mapped).source_layer, 'handoff');
});

test('9. a forwarded-to-admin claim without persisted case is HIGH', () => {
  const flags = evaluateOutboundMessage('Pesan Kakak sudah aku teruskan ke admin Redbox.', { handoffPersisted: false });
  const flag = flags.find((item) => item.event_type === 'false_handoff_forwarded_claim');
  assert.equal(flag.severity, 'HIGH');
});

test('10. false booking confirmation is CRITICAL and monitoring-only', () => {
  const [flag] = evaluateOutboundMessage('Booking sudah berhasil ya Kak.', {});
  assert.equal(flag.event_type, 'booking_confirmation_claim_detected');
  assert.equal(flag.severity, 'CRITICAL');
});

test('11. unsupported barber realtime availability claim is HIGH', () => {
  const flags = evaluateOutboundMessage('Mas Opan tersedia sekarang ya Kak.', { barberFactSource: 'roster' });
  const flag = flags.find((item) => item.event_type === 'barber_realtime_overclaim_detected');
  assert.equal(flag.severity, 'HIGH');
  assert.equal(flag.metadata.fact_source, 'roster');
});

test('12. unsupported membership claim is HIGH', () => {
  const flags = evaluateOutboundMessage('Membership Platinum Kakak aktif.', { membershipClaimSupported: false });
  assert.equal(flags.find((item) => item.event_type === 'membership_false_claim').severity, 'HIGH');
});

test('13. repeated generic closing is WARNING', () => {
  const flags = evaluateOutboundMessage('Semoga membantu. Ada yang bisa aku bantu lagi?', {});
  assert.equal(flags.find((item) => item.event_type === 'repetitive_generic_closing').severity, 'WARNING');
});

test('14. known Redbox branches retain correct attribution', () => {
  for (const branch of ['Bypass', 'CSB', 'Sumber', 'Samadikun', 'Tegal']) {
    assert.equal(normalizeBranch(branch), branch.toLowerCase());
  }
});

test('15. unknown device attribution stays unknown', () => {
  assert.equal(normalizeBranch('device-random'), 'unknown');
  assert.equal(normalizeBranch(null), 'unknown');
});

test('16. health aggregation separates branch health and exposes required rates', () => {
  const summary = aggregateHealth([
    event('inbound_event_claimed', 'bypass'), event('outbound_sent', 'bypass'),
    event('inbound_event_claimed', 'tegal'), event('outbound_provider_error', 'tegal'),
    event('membership_false_claim', 'tegal'), event('outbound_kill_switch_suppressed', 'csb'),
  ]);
  assert.equal(summary.totals.total_inbound, 2);
  assert.equal(summary.totals.total_automated_outbound, 1);
  assert.equal(summary.totals.provider_error_rate, 0.5);
  assert.equal(summary.totals.membership_false_claim_count, 1);
  assert.equal(summary.totals.kill_switch_suppression_count, 1);
  assert.equal(summary.branches.find((item) => item.branch === 'tegal').health, 'warning');
});

test('17. health aggregation applies time window and branch filters', () => {
  const summary = aggregateHealth([
    event('inbound_event_claimed', 'bypass', '2026-08-29T08:00:00Z'),
    event('inbound_event_claimed', 'tegal', '2026-08-29T10:00:00Z'),
    event('outbound_sent', 'tegal', '2026-08-29T10:01:00Z'),
  ], { from: '2026-08-29T09:00:00Z', to: '2026-08-29T11:00:00Z', branch: 'tegal' });
  assert.equal(summary.totals.total_inbound, 1);
  assert.equal(summary.branches.length, 1);
  assert.equal(summary.branches[0].branch, 'tegal');
});

test('18. monitoring failure or hang never breaks the guarded customer reply flow', async () => {
  let sends = 0;
  const supabase = {
    async rpc(name) {
      if (name === 'reserve_wa_automated_send') return { data: [{ decision: 'allowed', claim_id: 'claim-1' }], error: null };
      return { data: true, error: null };
    },
  };
  const send = createGuardedSend({
    realSend: async () => { sends += 1; return { status: true }; },
    supabase,
    inboundEventRowId: 'inbound-1',
    observeMessage: async () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const result = await send('628111000001', 'Jawaban aman', { branch: 'bypass' });
  assert.equal(result.status, true);
  assert.equal(sends, 1);
  assert.ok(Date.now() - startedAt < 750, 'monitoring timeout must remain bounded well below customer-flow timeouts');
});

test('privacy sanitizer excludes secrets, tokens, raw text, phone and content fields', () => {
  const safe = sanitizeMetadata({ token: 'x', auth_header: 'y', phone: '6281', raw_text: 'secret', content: 'secret', outcome: 'sent', retry: 1 });
  assert.deepEqual(safe, { outcome: 'sent', retry: 1 });
});

test('message and conversation references are hashed, never stored raw', () => {
  const normalized = normalizeEvaluationEvent({ event_type: 'routing_decision', message_id: 'provider-123', conversation_id: '628111' });
  assert.match(normalized.message_id, /^[a-f0-9]{64}$/);
  assert.match(normalized.conversation_id, /^[a-f0-9]{64}$/);
  assert.notEqual(normalized.message_id, 'provider-123');
});

test('stuck handoff detection is metadata-only and does not mutate case state', () => {
  const source = { id: 'case-1', status: 'waiting_human', branch: 'sumber', updated_at: '2026-08-29T08:00:00Z' };
  const flags = detectStuckHandoffCases([source], new Date('2026-08-29T10:00:00Z'));
  assert.equal(flags[0].event_type, 'handoff_case_stuck');
  assert.equal(source.status, 'waiting_human');
});

test('health endpoint window and branch scope come from verified staff access', async () => {
  assert.equal(parseWindow({ from: '2026-08-01', to: '2026-09-15' }), null);
  assert.equal(resolveEvaluationBranch({ role: 'branch_admin', branch: 'csb' }, 'tegal'), 'csb');
  assert.equal(resolveEvaluationBranch({ role: 'owner', branch: null }, 'tegal'), 'tegal');

  const app = express();
  const adminAuth = (req, _res, next) => {
    req.adminAuth = { sessionVerified: true, role: 'branch_admin', branch: 'csb', staffId: 'staff-1' };
    next();
  };
  app.use('/api/internal/reddy-evaluation', createReddyEvaluationRoutes({}, adminAuth, {
    getHealthSummary: async (args) => ({ status: 'ok', summary: { status: 'healthy', branch: args.branch } }),
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/reddy-evaluation/health?branch=tegal`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.branch, 'csb');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('recording storage errors degrades to a status value and never throws', async () => {
  const result = await recordEvaluationEvent({ event_type: 'routing_decision' }, { supabase: insertSupabase({ throws: true }) });
  assert.equal(result.status, 'error');
});

test('migration is append-only, indexed, RLS-aware, and stores no raw conversation columns', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/2026-08-29-reddy-evaluation-events.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS reddy_evaluation_events/i);
  assert.match(sql, /ALTER TABLE reddy_evaluation_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE reddy_evaluation_events TO service_role/i);
  assert.doesNotMatch(sql, /GRANT[^;]*(UPDATE|DELETE)/i);
  assert.doesNotMatch(sql, /message_(text|content)|raw_(message|conversation)|full_conversation/i);
  assert.match(sql, /branch, created_at DESC/i);
  assert.match(sql, /severity, created_at DESC/i);
});
