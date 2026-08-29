'use strict';

/**
 * Reddy Conversation Lifecycle + 5-Minute Idle Close — test suite.
 *
 * Covers: durable (DB-backed, never in-memory-only) idle timer arm/reset,
 * atomic single-send close via the cron endpoint, Task15 handoff priority,
 * P0 guarded-outbound reuse (including the NULL-inbound-event extension),
 * session reopening without stale-context bleed, Task16 telemetry, and the
 * generic-closing-question suppression guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Correction Round 1 (PR #45 review, security hardening): the cron endpoint
// now fails closed without CRON_SECRET, so every test exercising its normal
// (authenticated) flow needs a configured secret + matching Bearer header.
// T-auth / T-auth-fail-closed manage process.env.CRON_SECRET themselves to
// test the rejection paths; every other cron test uses this shared default.
const TEST_CRON_SECRET = 'test-cron-secret';
process.env.CRON_SECRET = process.env.CRON_SECRET || TEST_CRON_SECRET;
const CRON_AUTH_HEADERS = { authorization: `Bearer ${TEST_CRON_SECRET}` };

const {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_MESSAGE,
  touchInboundActivity,
  armIdleTimerAfterReply,
  claimIdleConversation,
  verifyStillClaimedForClose,
  finalizeIdleClose,
} = require('../services/conversationLifecycle');
const { createGuardedSend } = require('../services/waOutboundGuard');
const { sanitizeIdleLifecycleTelemetry, logIdleLifecycleEvent } = require('../orchestrator/telemetry');
const { stripGenericClosingQuestion } = require('../agents/reddy/closingSuppressionGuard');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

// ── Fake wa_conversations Supabase builder ────────────────────────────────
function fakeConversationsSupabase(initialRows = []) {
  const rows = initialRows.map((r) => ({ ...r }));

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => {
      if (f.op === 'eq') return row[f.field] === f.value;
      if (f.op === 'lte') return row[f.field] != null && row[f.field] <= f.value;
      if (f.op === 'is') return f.value === null ? (row[f.field] === null || row[f.field] === undefined) : row[f.field] === f.value;
      if (f.op === 'not_is') return f.value === null ? (row[f.field] !== null && row[f.field] !== undefined) : row[f.field] !== f.value;
      return true;
    }));
  }

  function from(table) {
    if (table !== 'wa_conversations') throw new Error(`Unexpected table: ${table}`);
    const filters = [];
    let action = null;
    let payload = null;
    let limitN = null;

    function resolve() {
      if (action === 'upsert') {
        let row = rows.find((r) => r.sender === payload.sender);
        if (!row) { row = { sender: payload.sender, history: [] }; rows.push(row); }
        Object.assign(row, payload);
        return { data: row, error: null };
      }
      if (action === 'update') {
        const matches = applyFilters(rows, filters);
        matches.forEach((row) => Object.assign(row, payload));
        return { data: matches[0] || null, error: null };
      }
      // select
      const matches = applyFilters(rows, filters);
      if (limitN != null) return { data: matches.slice(0, limitN), error: null };
      return { data: matches[0] || null, error: null };
    }

    const builder = {
      select() { if (!action) action = 'select'; return builder; },
      eq(field, value) { filters.push({ field, op: 'eq', value }); return builder; },
      lte(field, value) { filters.push({ field, op: 'lte', value }); return builder; },
      is(field, value) { filters.push({ field, op: 'is', value }); return builder; },
      not(field, _op, value) { filters.push({ field, op: 'not_is', value }); return builder; },
      limit(n) { limitN = n; return builder; },
      update(value) { action = 'update'; payload = value; return builder; },
      upsert(value) { action = 'upsert'; payload = value; return builder; },
      async maybeSingle() { return resolve(); },
      async single() { return resolve(); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
    };
    return builder;
  }

  return { rows, from };
}

// ── Fake P0 RPC ledger (NULL-inbound-event-tolerant, matching the new migration) ──
function fakeGuardRpc(conversationsSupabase) {
  const state = { claims: [], next: 1 };
  conversationsSupabase.rpc = (name, args) => {
    if (name === 'reserve_wa_automated_send') {
      const now = Date.now();
      const duplicate = state.claims.some((c) => c.destination_hash === args.p_destination_hash
        && c.content_hash === args.p_content_hash
        && c.reserved_at >= now - (args.p_duplicate_window_seconds * 1000));
      if (duplicate) return Promise.resolve({ data: [{ decision: 'duplicate_content', claim_id: null }], error: null });
      const recent = state.claims.filter((c) => c.destination_hash === args.p_destination_hash
        && c.reserved_at >= now - (args.p_rate_window_seconds * 1000)).length;
      if (recent >= args.p_rate_limit) return Promise.resolve({ data: [{ decision: 'rate_limited', claim_id: null }], error: null });
      const claim = {
        id: `out-${state.next++}`, inbound_event_id: args.p_inbound_event_id || null,
        destination_hash: args.p_destination_hash, content_hash: args.p_content_hash, reserved_at: now,
      };
      state.claims.push(claim);
      return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
    }
    if (name === 'complete_wa_automated_send') {
      const claim = state.claims.find((c) => c.id === args.p_claim_id);
      return Promise.resolve({ data: Boolean(claim), error: null });
    }
    return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
  };
  return state;
}

// ── Task 2: conversationLifecycle.js ──────────────────────────────────────

test('L1. Correction R1 (Blocker 1): touchInboundActivity CANCELS the due time, never schedules one', async () => {
  const sb = fakeConversationsSupabase([]);
  const now = 1_700_000_000_000;
  const result = await touchInboundActivity(sb, '628111', { now });
  assert.equal(result.reopened, false);
  const row = sb.rows.find((r) => r.sender === '628111');
  assert.equal(row.conversation_status, 'active');
  assert.equal(row.idle_close_due_at, null, 'inbound activity alone must never schedule an idle close');
});

test('L1b. Correction R1 (Blocker 1): touchInboundActivity cancels a PENDING due time already scheduled by a prior reply', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now + IDLE_TIMEOUT_MS).toISOString() }]);
  await touchInboundActivity(sb, '628111', { now });
  assert.equal(sb.rows[0].idle_close_due_at, null, 'a fresh customer message must cancel the pending close, not just push it out');
});

test('L1c. Correction R1 (Blocker 1): if Reddy never replies, no idle close can later fire (due_at stays null until armIdleTimerAfterReply runs)', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([]);
  await touchInboundActivity(sb, '628111', { now });
  // No armIdleTimerAfterReply call — simulates Reddy failing to reply.
  const claimed = await claimIdleConversation(sb, '628111', { now: now + IDLE_TIMEOUT_MS + 60000 });
  assert.equal(claimed, null, 'a turn Reddy never replied to must never become claimable for closing');
});

test('L2. touchInboundActivity on a closed row reopens it (and still cancels due_at)', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'closed', idle_closed_at: new Date(now - 1000).toISOString() }]);
  const result = await touchInboundActivity(sb, '628111', { now });
  assert.equal(result.reopened, true);
  const row = sb.rows.find((r) => r.sender === '628111');
  assert.equal(row.conversation_status, 'active');
  assert.equal(row.idle_closed_at, null);
  assert.equal(row.idle_close_due_at, null);
  assert.equal(row.session_started_at, new Date(now).toISOString());
});

test('L3. armIdleTimerAfterReply bumps idle_close_due_at forward', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 60000).toISOString() }]);
  await armIdleTimerAfterReply(sb, '628111', { now });
  const row = sb.rows.find((r) => r.sender === '628111');
  assert.equal(row.idle_close_due_at, new Date(now + IDLE_TIMEOUT_MS).toISOString());
  assert.equal(row.last_bot_message_at, new Date(now).toISOString());
});

test('L4. claimIdleConversation returns the row when due, not-yet-due returns null', async () => {
  const now = 1_700_000_000_000;
  const overdueSb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  const claimed = await claimIdleConversation(overdueSb, '628111', { now });
  assert.ok(claimed, 'overdue conversation should be claimable');
  assert.equal(overdueSb.rows[0].conversation_status, 'closing');

  const notDueSb = fakeConversationsSupabase([{ sender: '628222', conversation_status: 'active', idle_close_due_at: new Date(now + 60000).toISOString(), idle_closed_at: null }]);
  const notDue = await claimIdleConversation(notDueSb, '628222', { now });
  assert.equal(notDue, null);
});

test('L5. claimIdleConversation never double-claims (second call after first sees "closing")', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  const first = await claimIdleConversation(sb, '628111', { now });
  const second = await claimIdleConversation(sb, '628111', { now });
  assert.ok(first);
  assert.equal(second, null, 'a conversation already in "closing" must not be claimable again');
});

test('L6. finalizeIdleClose(sent=true) marks closed; finalizeIdleClose(sent=false) reverts to active and keeps due_at for retry', async () => {
  const now = 1_700_000_000_000;
  const dueAt = new Date(now - 1000).toISOString();

  const successSb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'closing', idle_close_due_at: dueAt }]);
  await finalizeIdleClose(successSb, '628111', { now, sent: true });
  assert.equal(successSb.rows[0].conversation_status, 'closed');
  assert.equal(successSb.rows[0].idle_closed_at, new Date(now).toISOString());

  const failSb = fakeConversationsSupabase([{ sender: '628222', conversation_status: 'closing', idle_close_due_at: dueAt }]);
  await finalizeIdleClose(failSb, '628222', { now, sent: false });
  assert.equal(failSb.rows[0].conversation_status, 'active', 'a failed send must not falsely claim closure');
  assert.equal(failSb.rows[0].idle_close_due_at, dueAt, 'due_at stays overdue so a later run retries');
  assert.notEqual(failSb.rows[0].conversation_status, 'closed');
});

test('L6b. Correction R1 (Blocker 2): verifyStillClaimedForClose returns false once a newer inbound message arrived after the claim', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 60000).toISOString() }]);
  const claim = await claimIdleConversation(sb, '628111', { now });
  const validImmediately = await verifyStillClaimedForClose(sb, '628111', { expectedLastCustomerMessageAt: claim.last_customer_message_at });
  assert.equal(validImmediately, true, 'nothing has changed yet — still valid to close');

  // A new inbound message arrives in the window between the claim and the send.
  await touchInboundActivity(sb, '628111', { now: now + 500 });
  const validAfterInbound = await verifyStillClaimedForClose(sb, '628111', { expectedLastCustomerMessageAt: claim.last_customer_message_at });
  assert.equal(validAfterInbound, false, 'a newer inbound message must invalidate the claim before send');
  assert.equal(sb.rows[0].conversation_status, 'active', 'touchInboundActivity itself already reverted the claim');
});

// ── Task 3: telemetry ──────────────────────────────────────────────────────

test('L7. sanitizeIdleLifecycleTelemetry allowlists event types and suppress reasons', () => {
  const safe = sanitizeIdleLifecycleTelemetry({ event_type: 'conversation_idle_close_sent', branch: 'bypass' });
  assert.equal(safe.event_type, 'conversation_idle_close_sent');
  assert.equal(safe.branch, 'bypass');

  const unknown = sanitizeIdleLifecycleTelemetry({ event_type: 'made_up_event', suppress_reason: 'made_up_reason' });
  assert.equal(unknown.event_type, 'unknown');
  assert.equal(unknown.suppress_reason, null);

  const suppressed = sanitizeIdleLifecycleTelemetry({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'waiting_human' });
  assert.equal(suppressed.suppress_reason, 'waiting_human');
});

// ── Task 4: waOutboundGuard onSendSuccess hook ────────────────────────────

function fakeP0GuardSupabase() {
  const sb = fakeConversationsSupabase([]);
  fakeGuardRpc(sb);
  return sb;
}

test('L8. createGuardedSend calls onSendSuccess exactly once on a real success, never on suppression/throw', async () => {
  const sb = fakeP0GuardSupabase();
  let successCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => ({ status: 'sent' }),
    supabase: sb,
    inboundEventRowId: null,
    onSendSuccess: async () => { successCalls++; },
  });
  const result = await guardedSend('628111', 'hello', {});
  assert.equal(result.status, 'sent');
  assert.equal(successCalls, 1);
});

test('L9. onSendSuccess is not called when the send is suppressed (kill switch)', async () => {
  const sb = fakeP0GuardSupabase();
  let successCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => ({ status: 'sent' }),
    supabase: sb,
    inboundEventRowId: null,
    isEnabled: () => false,
    onSendSuccess: async () => { successCalls++; },
  });
  await guardedSend('628111', 'hello', {});
  assert.equal(successCalls, 0);
});

test('L10. onSendSuccess is not called when realSend throws', async () => {
  const sb = fakeP0GuardSupabase();
  let successCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => { throw new Error('provider down'); },
    supabase: sb,
    inboundEventRowId: null,
    onSendSuccess: async () => { successCalls++; },
  });
  await assert.rejects(() => guardedSend('628111', 'hello', {}));
  assert.equal(successCalls, 0);
});

// ── Task 6: cron endpoint (spec's 15 required tests, primary coverage) ───

function responseRecorder() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function loadCronHandler() {
  delete require.cache[require.resolve('../../api/cron/reddy-idle-close')];
  return require('../../api/cron/reddy-idle-close');
}

test('T1. exactly one idle closing is sent for an overdue conversation', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.closed, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, IDLE_CLOSE_MESSAGE);
  assert.equal(sb.rows[0].conversation_status, 'closed');
});

test('T2. customer reply before the close (timer reset) leaves nothing to claim', async () => {
  const now = 1_700_000_000_000;
  // Simulates: conversation was overdue, but a fresh inbound message reset
  // idle_close_due_at into the future before the cron pass runs its claim.
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now + 4 * 60 * 1000).toISOString(), idle_closed_at: null }]);
  const claimed = await claimIdleConversation(sb, '628111', { now });
  assert.equal(claimed, null, 'a timer reset before the claim must prevent the stale close');
});

test('T3. race: a newer inbound message right before the claim wins — no stale close', async () => {
  const handler = loadCronHandler();
  // The cron handler's claim step uses the real wall clock (no `now`
  // override is threaded through from the endpoint), so this test must too —
  // a fixed past epoch would look "overdue" from the endpoint's own
  // perspective regardless of what touchInboundActivity just set.
  const now = Date.now();
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  // A customer message arrives and resets the timer in the moment between
  // the candidate list being built and the claim being attempted.
  await touchInboundActivity(sb, '628111', { now });
  const sent = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(sent.length, 0, 'no closing should be sent once a newer inbound message reset the timer');
  assert.equal(sb.rows[0].conversation_status, 'active');
});

test('T4. running the job twice over the same overdue conversation sends only once', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const sendWA = async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; };

  const first = responseRecorder();
  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, first, {
    supabase: sb, isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA, // real findDueSenders path, not candidateSenders — proves the second pass naturally excludes the closed row
  });
  const second = responseRecorder();
  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, second, {
    supabase: sb, isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA,
  });

  assert.equal(sent.length, 1, 'a second cron pass must not resend the closing message');
  assert.equal(first.body.closed, 1);
  assert.equal(second.body.closed, 0);
});

test('T5. waiting_human handoff: no idle closing sent', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const events = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb, isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'waiting_human', case: { id: 'case-1' } }),
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    logEvent: (e) => events.push(e),
  });

  assert.equal(sent.length, 0);
  assert.equal(sb.rows[0].conversation_status, 'active', 'handoff-suppressed conversation must not even be claimed');
  assert.ok(events.some((e) => e.event_type === 'conversation_idle_close_suppressed' && e.suppress_reason === 'waiting_human'));
});

test('T6. human_active handoff: no idle closing sent', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb, isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'human_active', case: { id: 'case-1' } }),
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(sent.length, 0);
});

test('T7. REDDY_ENABLED=false: no automated closing send', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb, isReddyEnabled: () => false,
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(sent.length, 0);
  assert.equal(res.body.closed, 0);
});

test('T8. provider/send failure leaves the conversation active, not falsely closed', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb, isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA: async () => { throw new Error('Fonnte timeout'); },
    candidateSenders: ['628111'],
  });

  assert.equal(res.body.closed, 0);
  assert.equal(sb.rows[0].conversation_status, 'active', 'must not falsely claim the closing was sent');
  assert.notEqual(sb.rows[0].conversation_status, 'closed');
});

test('T-auth. unauthenticated cron request (wrong/missing bearer, secret configured) is rejected', async () => {
  const handler = loadCronHandler();
  const res = responseRecorder();
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';
  try {
    await handler({ method: 'GET', headers: {} }, res, {});
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('T-auth-fail-closed. Correction R1 (security hardening): CRON_SECRET missing => 401, zero close work executed', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();
  const previousSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    await handler({ method: 'GET', headers: {} }, res, {
      supabase: sb, isReddyEnabled: () => true,
      getActiveHandoffState: async () => ({ status: 'none', case: null }),
      sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
      candidateSenders: ['628111'],
    });
  } finally {
    if (previousSecret !== undefined) process.env.CRON_SECRET = previousSecret;
  }
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
  assert.equal(sent.length, 0, 'an unauthenticated request must never execute close work, even with an overdue candidate present');
  assert.equal(sb.rows[0].conversation_status, 'active', 'the candidate must not even be claimed');
});

test('T-auth-valid. correct Bearer secret is still allowed to process a due conversation', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';
  try {
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }, res, {
      supabase: sb, isReddyEnabled: () => true,
      getActiveHandoffState: async () => ({ status: 'none', case: null }),
      sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
      candidateSenders: ['628111'],
    });
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(res.body.closed, 1);
});

test('T-blocker2. Correction R1: a newer inbound message arriving right after the claim aborts the send (real cron flow)', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 60000).toISOString() }]);
  fakeGuardRpc(sb);
  const sent = [];
  const events = [];
  const res = responseRecorder();

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none', case: null }),
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
    logEvent: (e) => events.push(e),
    // Wraps the REAL claim function: after a genuine claim succeeds, simulate
    // the customer sending a new message before the endpoint's own pre-send
    // verify step runs.
    claimIdleConversation: async (supabaseArg, sender, opts) => {
      const claimed = await claimIdleConversation(supabaseArg, sender, opts);
      if (claimed) {
        await touchInboundActivity(supabaseArg, sender, { now: now + 500 });
      }
      return claimed;
    },
  });

  assert.equal(sent.length, 0, 'zero closing sends once a newer inbound arrived after the claim');
  assert.equal(res.body.closed, 0);
  assert.ok(events.some((e) => e.event_type === 'conversation_idle_close_suppressed' && e.suppress_reason === 'newer_inbound_detected'));
  assert.equal(sb.rows[0].conversation_status, 'active');
});

test('T-blocker3a. Correction R1: handoff becomes waiting_human between claim and send => zero closing sent', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 60000).toISOString() }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();
  let handoffCalls = 0;

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    // Inactive at discovery time (1st call), waiting_human by the pre-send re-check (2nd call).
    getActiveHandoffState: async () => {
      handoffCalls++;
      return handoffCalls === 1 ? { status: 'none', case: null } : { status: 'waiting_human', case: { id: 'case-1' } };
    },
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(sent.length, 0, 'a handoff opening after the claim must still prevent the send');
  assert.equal(handoffCalls, 2, 'handoff must be checked both at discovery AND immediately before send');
  assert.equal(sb.rows[0].conversation_status, 'active', 'the claim must be released, not left stuck in closing');
});

test('T-blocker3b. Correction R1: handoff becomes human_active between claim and send => zero closing sent', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 60000).toISOString() }]);
  fakeGuardRpc(sb);
  const sent = [];
  const res = responseRecorder();
  let handoffCalls = 0;

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => {
      handoffCalls++;
      return handoffCalls === 1 ? { status: 'none', case: null } : { status: 'human_active', case: { id: 'case-1' } };
    },
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
  });

  assert.equal(sent.length, 0);
  assert.equal(handoffCalls, 2);
});

test('T-blocker-order. Final Mini Correction (PR #45): a customer message landing between the handoff re-check and the final lifecycle verification is still caught, proving the verify-last ordering', async () => {
  const handler = loadCronHandler();
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([{ sender: '628111', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 60000).toISOString() }]);
  fakeGuardRpc(sb);
  const sent = [];
  const events = [];
  const res = responseRecorder();
  let handoffCalls = 0;

  await handler({ method: 'GET', headers: CRON_AUTH_HEADERS }, res, {
    supabase: sb,
    isReddyEnabled: () => true,
    // The handoff re-check itself always reports 'none' (it genuinely never
    // opens) — but its second (pre-send) call is the moment a real customer
    // message arrives, i.e. strictly AFTER discovery+claim and exactly in
    // the window this correction closes. If verifyStillClaimedForClose were
    // checked before the handoff re-check (the old, incorrect order), this
    // race would slip through undetected.
    getActiveHandoffState: async () => {
      handoffCalls++;
      if (handoffCalls === 2) {
        await touchInboundActivity(sb, '628111', { now: now + 500 });
      }
      return { status: 'none', case: null };
    },
    sendWA: async (to, msg) => { sent.push({ to, msg }); return { status: 'sent' }; },
    candidateSenders: ['628111'],
    logEvent: (e) => events.push(e),
  });

  assert.equal(handoffCalls, 2, 'both handoff checks must have run and reported no handoff');
  assert.equal(sent.length, 0, 'the final lifecycle verification must still catch a race that occurred after the handoff re-check passed');
  assert.equal(res.body.closed, 0);
  assert.ok(events.some((e) => e.event_type === 'conversation_idle_close_suppressed' && e.suppress_reason === 'newer_inbound_detected'));
  assert.equal(sb.rows[0].conversation_status, 'active');
});

test('T15. the idle-close send goes through the real P0 guard RPC (duplicate-content suppresses a second concurrent attempt)', async () => {
  const now = 1_700_000_000_000;
  const sb = fakeConversationsSupabase([]);
  const rpcState = fakeGuardRpc(sb);
  const guardedSend = createGuardedSend({
    realSend: async () => ({ status: 'sent' }),
    supabase: sb,
    inboundEventRowId: null,
  });
  const first = await guardedSend('628111', IDLE_CLOSE_MESSAGE, {});
  const second = await guardedSend('628111', IDLE_CLOSE_MESSAGE, {});
  assert.equal(first.status, 'sent');
  assert.equal(second.suppressed, true, 'the P0 duplicate-content guard must catch a second identical send within its window');
  assert.equal(rpcState.claims.length, 1);
});

// ── Task 5: webhook.js reopening / stale-context guard ────────────────────

const { handleMessage } = require('../../api/wa/webhook');

test('W1. reopened session starts with empty conversationContext regardless of what history-loader returns', async () => {
  const staleTurns = [
    { role: 'user', content: 'mau booking sama Ubay jam 6' },
    { role: 'assistant', content: 'Silakan lanjut ke website: https://redboxbarbershop.com/booking.html' },
  ];
  let seenConversationContext = null;
  const result = await handleMessage({ from: '628111', name: 'Kak', text: 'tanya soal membership dong' }, {
    touchLifecycle: async () => ({ reopened: true }),
    getHandoffState: async () => ({ status: 'none', case: null }),
    loadConversationHistory: async () => ({ history: staleTurns, status: 'available' }),
    orchestrate: async ({ conversationContext }) => {
      seenConversationContext = conversationContext;
      return {
        intent: 'membership_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'explain_membership',
        conversational_act: 'business_fact_question', continuation_type: 'none', required_sources: [],
        allowed_claims: [], prohibited_claims: [], clarification_required: false,
        session_behavior: 'continue', response_strategy: 'answer_with_knowledge_fact', confidence: 1, model_tier: 'none',
      };
    },
    executeReddy: async () => ({ used: 'reddy_agent', reply: 'Membership Redbox itu...', sendResult: { status: 'sent' }, error: null }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });

  assert.equal(seenConversationContext.turns.length, 0, 'stale pre-close turns must not reach the orchestrator on reopen');
  assert.equal(result.used, 'reddy_agent');
});

test('W2. a non-reopened (still active) session keeps its real history', async () => {
  const priorTurns = [{ role: 'user', content: 'halo' }, { role: 'assistant', content: 'Hai Kak!' }];
  let seenConversationContext = null;
  await handleMessage({ from: '628111', name: 'Kak', text: 'boleh tanya soal cabang redbox dong' }, {
    touchLifecycle: async () => ({ reopened: false }),
    getHandoffState: async () => ({ status: 'none', case: null }),
    loadConversationHistory: async () => ({ history: priorTurns, status: 'available' }),
    orchestrate: async ({ conversationContext }) => {
      seenConversationContext = conversationContext;
      return {
        intent: 'location_inquiry', route: 'reddy_agent', agent: 'reddy_agent', action: 'answer_location',
        conversational_act: 'business_fact_question', continuation_type: 'none', required_sources: [],
        allowed_claims: [], prohibited_claims: [], clarification_required: false,
        session_behavior: 'continue', response_strategy: 'answer_with_knowledge_fact', confidence: 1, model_tier: 'none',
      };
    },
    executeReddy: async () => ({ used: 'reddy_agent', reply: 'Redbox ada di beberapa cabang ya Kak.', sendResult: { status: 'sent' }, error: null }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });

  assert.equal(seenConversationContext.turns.length, 2, 'normal continuity must be preserved when the session was not reopened');
});

// ── Task 7: generic closing suppression ───────────────────────────────────

test('C1. each spec-listed generic closing phrase is stripped, rest of the reply survives', () => {
  const cases = [
    'Harga Gentleman Grooming Rp95.000 ya Kak. Ada yang bisa aku bantu lagi?',
    'Mas Ubay terdaftar di Redbox CSB ya Kak. Kalau ada yang mau ditanyakan, jangan ragu ya.',
    'Redbox buka jam 10 pagi. Ada yang ingin kamu tanyakan seputar Redbox?',
    'Poin kamu saat ini 120 poin. Kalau ada yang bisa aku bantu lagi, silakan tanya.',
  ];
  for (const reply of cases) {
    const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(reply);
    assert.equal(closingStripped, true, reply);
    assert.doesNotMatch(sanitizedReply, /ada yang bisa|jangan ragu|ada yang ingin/i, reply);
    assert.ok(sanitizedReply.length > 0);
  }
});

test('C2. a task-advancing clarification question is never stripped', () => {
  const cases = [
    'Mau di cabang mana, Kak?',
    'Mau booking untuk kapan, Kak?',
    'Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya?',
  ];
  for (const reply of cases) {
    const { sanitizedReply, closingStripped } = stripGenericClosingQuestion(reply);
    assert.equal(closingStripped, false, reply);
    assert.equal(sanitizedReply, reply);
  }
});

test('C3. executeReddyAgent strips a generic closing from the LLM reply end-to-end', async () => {
  const sent = [];
  const telemetry = [];
  await executeReddyAgent({
    from: '628111', text: 'harga haircut berapa?', branch: 'bypass',
    orchestrationDecision: { intent: 'price_inquiry', route: 'reddy_agent' },
  }, {
    callOpenAI: async () => 'Haircut di Redbox Rp85.000 ya Kak. Ada yang bisa aku bantu lagi?',
    sendWA: async (_to, reply) => { sent.push(reply); return { status: 'sent' }; },
    loadBarbers: () => Promise.resolve({ status: 'not_requested', barbers: [], reason: null }),
    logBookingTelemetry: (e) => telemetry.push(e),
  });

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /ada yang bisa aku bantu lagi/i);
  assert.match(sent[0], /Rp85\.000/);
  assert.ok(telemetry.some((e) => e.action === 'generic_closing_suppressed'));
});

// ── Test 13: no in-memory-only timer dependency (structural check) ───────

test('S1. the idle lifecycle mechanism never uses setTimeout as its closing driver', () => {
  const lifecycleSource = fs.readFileSync(path.join(__dirname, '../services/conversationLifecycle.js'), 'utf8');
  const cronSource = fs.readFileSync(path.join(__dirname, '../../api/cron/reddy-idle-close.js'), 'utf8');
  assert.doesNotMatch(lifecycleSource, /setTimeout\s*\(/);
  assert.doesNotMatch(cronSource, /setTimeout\s*\(/);
});

// ── Test 14: Task16 telemetry integration (webhook wiring) ───────────────

test('L11. logIdleLifecycleEvent is exported and produces the documented shape', () => {
  const safe = logIdleLifecycleEvent({ event_type: 'conversation_idle_close_sent' });
  assert.equal(safe.event_type, 'conversation_idle_close_sent');
  assert.ok(safe.timestamp);
});
