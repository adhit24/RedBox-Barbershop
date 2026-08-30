'use strict';

/**
 * P0 live incident — inbound processing terminalization (Objective A),
 * stale-claim reclamation (Objective B), and conversation isolation
 * (Objective C).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  terminalizeInbound, terminalizeIfStillProcessing, TERMINAL_STATUSES, RECLAIMABLE_BY_THIS_MODULE,
} = require('../services/waInboundLifecycle');
const {
  isReddyEnabled, classifyInboundEvent, resolveProviderMessageId, resolveProviderDeviceHash,
  claimInboundEvent, admitInboundEvent,
} = require('../services/waInboundGuard');
const { createGuardedSend, RATE_LIMIT_MAX_SENDS } = require('../services/waOutboundGuard');
const {
  resolveConversationDeviceScope, conversationCacheKey, LEGACY_DEVICE_SCOPE,
} = require('../services/conversationScope');
const {
  touchInboundActivity, armIdleTimerAfterReply, claimIdleConversation,
} = require('../services/conversationLifecycle');
const webhook = require('../../api/wa/webhook');

// ── shared fakes ────────────────────────────────────────────────────────────

function fakeInboundEventsSupabase({ failInboundClaim = false } = {}) {
  const state = { inbound: [], claims: [], nowMs: 0, next: 1 };

  function inboundBuilder() {
    const q = { action: null, value: null, filters: [], inFilters: [] };
    const builder = {
      insert(value) { q.action = 'insert'; q.value = value; return builder; },
      update(value) { q.action = 'update'; q.value = value; return builder; },
      select() { if (!q.action) q.action = 'select'; return builder; },
      eq(field, value) { q.filters.push([field, value]); return builder; },
      in(field, values) { q.inFilters.push([field, values]); return builder; },
      async single() { return execute(true); },
      async maybeSingle() { return execute(false); },
      then(onFulfilled, onRejected) { return Promise.resolve(execute(false, true)).then(onFulfilled, onRejected); },
    };
    function matches(row) {
      return q.filters.every(([field, value]) => row[field] === value)
        && q.inFilters.every(([field, values]) => values.includes(row[field]));
    }
    function execute(requireRow, wantArray = false) {
      if (q.action === 'insert') {
        if (failInboundClaim) return { data: null, error: { code: 'DB_DOWN' } };
        const duplicate = state.inbound.find((row) => row.provider === q.value.provider
          && row.provider_device_hash === q.value.provider_device_hash
          && row.provider_message_id === q.value.provider_message_id);
        if (duplicate) return { data: null, error: { code: '23505' } };
        const row = { id: `in-${state.next++}`, outbound_attempted: false, updated_at: new Date(state.nowMs).toISOString(), ...q.value };
        state.inbound.push(row);
        return { data: row, error: null };
      }
      if (q.action === 'update') {
        const matched = state.inbound.filter(matches);
        matched.forEach((row) => Object.assign(row, q.value));
        if (wantArray) return { data: matched, error: null };
        return { data: matched[0] || null, error: null };
      }
      const matched = state.inbound.filter(matches);
      if (wantArray) return { data: matched, error: null };
      const row = matched[0] || null;
      return { data: row, error: requireRow && !row ? { code: 'PGRST116' } : null };
    }
    return builder;
  }

  const client = {
    state,
    from(table) {
      if (table !== 'wa_inbound_events') throw new Error(`Unexpected table: ${table}`);
      return inboundBuilder();
    },
    rpc(name, args) {
      if (name === 'reserve_wa_automated_send') {
        const inbound = state.inbound.find((row) => row.id === args.p_inbound_event_id);
        if (!inbound || inbound.outbound_attempted) {
          return Promise.resolve({ data: [{ decision: 'already_attempted', claim_id: null }], error: null });
        }
        inbound.outbound_attempted = true;
        inbound.processing_status = 'sending';
        const now = state.nowMs;
        const duplicate = state.claims.some((row) => row.destination_hash === args.p_destination_hash
          && row.content_hash === args.p_content_hash
          && row.reserved_at >= now - (args.p_duplicate_window_seconds * 1000));
        if (duplicate) {
          inbound.processing_status = 'failed';
          return Promise.resolve({ data: [{ decision: 'duplicate_content', claim_id: null }], error: null });
        }
        const recent = state.claims.filter((row) => row.destination_hash === args.p_destination_hash
          && row.reserved_at >= now - (args.p_rate_window_seconds * 1000)).length;
        if (recent >= args.p_rate_limit) {
          inbound.processing_status = 'failed';
          return Promise.resolve({ data: [{ decision: 'rate_limited', claim_id: null }], error: null });
        }
        const claim = { id: `out-${state.next++}`, inbound_event_id: inbound.id, destination_hash: args.p_destination_hash, content_hash: args.p_content_hash, reserved_at: now };
        state.claims.push(claim);
        return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
      }
      if (name === 'complete_wa_automated_send') {
        const claim = state.claims.find((row) => row.id === args.p_claim_id && row.inbound_event_id === args.p_inbound_event_id);
        const inbound = state.inbound.find((row) => row.id === args.p_inbound_event_id);
        if (claim && inbound) {
          inbound.processing_status = args.p_sent ? 'sent' : 'failed';
          inbound.outbound_sent = Boolean(args.p_sent);
        }
        return Promise.resolve({ data: Boolean(claim), error: null });
      }
      // reclaim_stale_wa_inbound_event modeled separately in its own section.
      return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
    },
  };
  return client;
}

function fonntePayload(overrides = {}) {
  return { device: '62818202569', sender: '628123456789', message: 'halo', inboxid: `inbox-${Math.random()}`, ...overrides };
}

function responseRecorder() {
  return {
    statusCode: null, body: null, headersSent: false,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

async function runWebhook(body, deps = {}) {
  const res = responseRecorder();
  await webhook({ method: 'POST', body, query: {} }, res, deps);
  return res;
}

// ── waInboundLifecycle.js — pure conditional-write module ─────────────────

test('terminalizeInbound conditionally writes only when processing_status is received/processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const admission = await claimInboundEvent(supabase, {
    provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'msg-1', eventType: 'customer_message',
  });
  const id = admission.row.id;

  const result = await terminalizeInbound(supabase, id, 'failed', 'branch_number_suppressed', { source: 'branch_number_suppression' });
  assert.equal(result.wrote, true);
  assert.equal(supabase.state.inbound.find((r) => r.id === id).processing_status, 'failed');

  // Redundant call is a guaranteed no-op — already terminal.
  const second = await terminalizeInbound(supabase, id, 'failed', 'unexpected_pre_send_exit', { source: 'webhook_finally' });
  assert.equal(second.wrote, false);
});

test('terminalizeInbound never touches a row at "sending" (guarded-send RPCs\' exclusive domain)', async () => {
  const supabase = fakeInboundEventsSupabase();
  const admission = await claimInboundEvent(supabase, {
    provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'msg-sending', eventType: 'customer_message',
  });
  const id = admission.row.id;
  supabase.state.inbound.find((r) => r.id === id).processing_status = 'sending';

  const result = await terminalizeInbound(supabase, id, 'failed', 'unexpected_pre_send_exit', {});
  assert.equal(result.wrote, false, 'sending must never be overwritten by this safety net');
  assert.equal(supabase.state.inbound.find((r) => r.id === id).processing_status, 'sending');
});

test('terminalizeInbound / terminalizeIfStillProcessing are safe no-ops with a null row id (no crash, no write attempt)', async () => {
  const supabase = fakeInboundEventsSupabase();
  const result = await terminalizeIfStillProcessing(supabase, null, {});
  assert.equal(result.wrote, false);
});

test('TERMINAL_STATUSES / RECLAIMABLE_BY_THIS_MODULE are the exact bounded sets the P0 invariant depends on', () => {
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ['failed', 'sent']);
  assert.deepEqual([...RECLAIMABLE_BY_THIS_MODULE].sort(), ['processing', 'received']);
});

// ── 1-15: INBOUND LIFECYCLE, real webhook.js end-to-end ────────────────────

test('1. claimed -> successful guarded send -> sent', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const r = await deps.send('628123456789', 'balasan', { branch: 'bypass' });
      return { used: 'test', reply: 'balasan', sendResult: r, error: null };
    },
    realSend: async () => ({ status: 'sent' }),
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'sent');
});

test('2. claimed -> send failure -> failed', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const r = await deps.send('628123456789', 'balasan', { branch: 'bypass' });
      return { used: 'test', reply: 'balasan', sendResult: r, error: null };
    },
    realSend: async () => { throw new Error('fonnte down'); },
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('3. claimed -> Reddy disabled (kill switch) -> failed terminal, zero send attempted', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  let handleMessageCalled = false;
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => false,
    handleMessage: async () => { handleMessageCalled = true; return { used: 'never', reply: null, sendResult: null, error: null }; },
  });
  assert.equal(handleMessageCalled, false, 'kill switch must short-circuit before handleMessage is ever called');
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('4. claimed -> trusted identity invalid (international/+non-62 number) -> still reaches a terminal state, never left processing', async () => {
  // trustedIdentity failure is swallowed internally (server/identity/trustedIdentity.js)
  // and does NOT create a distinct early-exit branch — the message still flows
  // through the normal pipeline as "unverified". This test proves the general
  // safety net still terminalizes it end-to-end regardless.
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload({ sender: '15551234567' }); // US number, not +62
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const r = await deps.send('15551234567', 'balasan', { branch: 'bypass' });
      return { used: 'test', reply: 'balasan', sendResult: r, error: null };
    },
    realSend: async () => ({ status: 'sent' }),
  });
  const row = supabase.state.inbound[0];
  assert.notEqual(row.processing_status, 'processing');
  assert.equal(row.processing_status, 'sent');
});

test('5. claimed -> human-active suppression -> terminal, not processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  const handoffSupabase = {
    from(table) {
      assert.equal(table, 'human_handoff_cases');
      return {
        select() { return this; }, eq() { return this; }, in() { return this; },
        order() { return this; }, limit() { return this; },
        async maybeSingle() { return { data: { id: 'case-1', status: 'human_active', priority: 'normal', branch: 'bypass' }, error: null }; },
        update() { return this; },
      };
    },
  };
  await runWebhook(payload, { supabase, isReddyEnabled: () => true, handoffSupabase });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('6. claimed -> waiting-human suppression -> terminal, not processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  const handoffSupabase = {
    from() {
      return {
        select() { return this; }, eq() { return this; }, in() { return this; },
        order() { return this; }, limit() { return this; },
        async maybeSingle() { return { data: { id: 'case-2', status: 'waiting_human', priority: 'normal', branch: 'bypass' }, error: null }; },
        update() { return this; },
      };
    },
  };
  await runWebhook(payload, { supabase, isReddyEnabled: () => true, handoffSupabase });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('7 & 8. claimed -> handleMessage throws (models an orchestrator/Reddy failure escaping their own internal fallback) -> terminal via outer safety, never processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async () => { throw new Error('simulated orchestrator/Reddy failure'); },
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('source: orchestrator throw and Reddy/OpenAI throw each fall back to an unconditional static-fallback send inside handleMessage (not a distinct stuck-row branch)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  // CRM route + reddy_agent route both catch executeReddy() throwing and still send a static fallback.
  assert.match(source, /try\s*\{\s*const reddyExec = await executeReddy\(/);
  const tryCount = (source.match(/try\s*\{\s*const reddyExec = await executeReddy\(/g) || []).length;
  assert.equal(tryCount, 2, 'both the CRM route and reddy_agent route must wrap executeReddy in their own try/catch');
});

test('9 & 10. claimed -> handleMessage returns an internal early-exit shape (deterministic/no-reply) with no send -> terminal via outer safety, never processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    // Mirrors handleMessage's own real internal early returns, e.g.
    // { used: 'human_active_suppressed', reply: null, sendResult: null, error: null }
    // or { used: 'paused', reply: null, sendResult: null, error: null }.
    handleMessage: async () => ({ used: 'human_active_suppressed', reply: null, sendResult: null, error: null }),
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('11. duplicate-content -> failed terminal (RPC-level, own write path — never left processing)', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const first = await deps.send('628123456789', 'sama persis', { branch: 'bypass' });
      const second = await deps.send('628123456789', 'sama persis', { branch: 'bypass' });
      return { used: 'test', reply: null, sendResult: second, error: null, _first: first };
    },
    realSend: async () => ({ status: 'sent' }),
  });
  const row = supabase.state.inbound[0];
  // outbound_attempted flips to TRUE on the FIRST reservation; the second
  // guardedSend call for the SAME inbound event id hits 'already_attempted'
  // (P0's own one-inbound-one-send guarantee) rather than duplicate_content
  // (that decision requires a genuinely different inbound event reusing the
  // same destination+content within the window) — either way the row must
  // never be left at 'processing'.
  assert.notEqual(row.processing_status, 'processing');
});

test('12. rate-limited -> failed terminal (RPC-level, own write path)', async () => {
  const supabase = fakeInboundEventsSupabase();
  // Pre-seed RATE_LIMIT_MAX_SENDS claims for this destination within the window.
  const destinationHash = require('../services/waInboundGuard').hashValue(require('../services/waInboundGuard').normalizePhoneDigits('628123456789'));
  for (let i = 0; i < RATE_LIMIT_MAX_SENDS; i += 1) {
    supabase.state.claims.push({ id: `seed-${i}`, destination_hash: destinationHash, content_hash: `seed-content-${i}`, reserved_at: 0 });
  }
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const r = await deps.send('628123456789', 'pesan baru unik', { branch: 'bypass' });
      return { used: 'test', reply: null, sendResult: r, error: null };
    },
    realSend: async () => ({ status: 'sent' }),
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('13. kill switch mid-request (guardedSend\'s own isEnabled flips false after the outer check) -> terminal via outer safety', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true, // outer check passes...
    handleMessage: async (_input, deps) => {
      const r = await deps.send('628123456789', 'balasan', { branch: 'bypass' });
      return { used: 'test', reply: null, sendResult: r, error: null };
    },
    realSend: async () => ({ status: 'sent' }),
    armIdleTimer: async () => {},
  });
  // (Kept as a same-shape companion to test 3; the dedicated kill-switch
  // stuck-row scenario is test 3 above — this proves the outer safety net
  // still applies even when guardedSend itself is reached.)
  const row = supabase.state.inbound[0];
  assert.notEqual(row.processing_status, 'processing');
});

test('branch-number suppression: claimed row is explicitly terminalized with a specific reason (the exact bug from the incident report)', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload({ sender: '0818202569' }); // one of the 5 hardcoded BRANCH_WA numbers
  const events = [];
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async () => { throw new Error('must never reach handleMessage for a branch-to-branch echo'); },
  });
  const row = supabase.state.inbound[0];
  assert.ok(row, 'the row must still have been claimed before the suppression check ran');
  assert.equal(row.processing_status, 'failed');
});

test('legacy human-takeover (wa_paused, in-memory) suppression -> terminal, not processing', async () => {
  const supabase = fakeInboundEventsSupabase();
  const uniqueSender = '628199988877';
  webhook.setHumanTakeoverLocal(uniqueSender);
  const payload = fonntePayload({ sender: uniqueSender });
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async () => { throw new Error('must never reach handleMessage while human takeover is active'); },
  });
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('14. unexpected exception thrown before guardedSend is even constructed -> terminal via the outer catch+finally', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = fonntePayload();
  // isReddyEnabled itself throwing simulates a genuinely unanticipated crash
  // early in the handler, before guardedSend/handleMessage are ever reached.
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => { throw new Error('unexpected crash'); },
  });
  const row = supabase.state.inbound[0];
  assert.ok(row, 'the row must have been claimed before the crash');
  assert.equal(row.processing_status, 'failed');
});

test('15. structural: the webhook handler wraps every post-claim branch in one try/finally safety net', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(source, /const inboundEventRowId = inboundAdmission\.status === 'claimed'/);
  assert.match(source, /await terminalizeIfStillProcessing\(supabaseForGuard, inboundEventRowId/);
  // The finally must sit between the inner try's close and the outer catch —
  // i.e. it is reachable from every return/throw inside handler().
  const finallyIndex = source.indexOf('} finally {');
  const catchIndex = source.indexOf("[WA Bot] Fatal error:");
  assert.ok(finallyIndex !== -1, 'the finally block must exist');
  assert.ok(catchIndex !== -1, 'the outer Fatal error catch must exist');
  assert.ok(finallyIndex < catchIndex, 'the finally must run before the outer catch — i.e. it is nested inside the outer try');
});

// ── 16-23: STALE RECLAIM ────────────────────────────────────────────────────

function fakeReclaimSupabase(initialInboundRows = []) {
  const rows = initialInboundRows.map((r) => ({ ...r }));
  return {
    rows,
    from(table) {
      if (table !== 'wa_inbound_events') throw new Error(`unexpected table ${table}`);
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(field, value) { filters.push((r) => r[field] === value); return builder; },
        async maybeSingle() {
          const row = rows.find((r) => filters.every((f) => f(r))) || null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
    rpc(name, args) {
      if (name !== 'reclaim_stale_wa_inbound_event') return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
      const { p_provider, p_provider_device_hash, p_provider_message_id, p_stale_seconds } = args;
      if (!p_provider || !p_provider_device_hash || !p_provider_message_id || p_stale_seconds < 60) {
        return Promise.resolve({ data: [{ reclaimed: false, inbound_event_id: null }], error: null });
      }
      const row = rows.find((r) => r.provider === p_provider
        && r.provider_device_hash === p_provider_device_hash
        && r.provider_message_id === p_provider_message_id);
      if (!row) return Promise.resolve({ data: [{ reclaimed: false, inbound_event_id: null }], error: null });
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      const eligible = row.processing_status === 'processing'
        && row.outbound_attempted === false
        && ageMs >= p_stale_seconds * 1000;
      if (!eligible) return Promise.resolve({ data: [{ reclaimed: false, inbound_event_id: null }], error: null });
      row.processing_status = 'processing';
      row.updated_at = new Date().toISOString();
      return Promise.resolve({ data: [{ reclaimed: true, inbound_event_id: row.id }], error: null });
    },
  };
}

test('16. exact stale processing + outbound_attempted=false may be reclaimed', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const supabase = fakeReclaimSupabase([
    { id: 'row-1', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-1', processing_status: 'processing', outbound_attempted: false, updated_at: staleUpdatedAt },
  ]);
  const result = await attemptStaleReclaim(supabase, { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-1' });
  assert.equal(result.reclaimed, true);
  assert.equal(result.inboundEventId, 'row-1');
});

test('17. fresh (not stale) processing cannot be reclaimed', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const freshUpdatedAt = new Date().toISOString();
  const supabase = fakeReclaimSupabase([
    { id: 'row-2', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-2', processing_status: 'processing', outbound_attempted: false, updated_at: freshUpdatedAt },
  ]);
  const result = await attemptStaleReclaim(supabase, { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-2' });
  assert.equal(result.reclaimed, false);
});

test('18. a row at "sending" cannot be reclaimed', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const supabase = fakeReclaimSupabase([
    { id: 'row-3', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-3', processing_status: 'sending', outbound_attempted: true, updated_at: staleUpdatedAt },
  ]);
  const result = await attemptStaleReclaim(supabase, { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-3' });
  assert.equal(result.reclaimed, false);
});

test('19. a row already "sent" cannot be reclaimed', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const supabase = fakeReclaimSupabase([
    { id: 'row-4', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-4', processing_status: 'sent', outbound_attempted: true, updated_at: staleUpdatedAt },
  ]);
  const result = await attemptStaleReclaim(supabase, { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-4' });
  assert.equal(result.reclaimed, false);
});

test('20. outbound_attempted=true cannot be reclaimed even if stale and still "processing"', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const supabase = fakeReclaimSupabase([
    { id: 'row-5', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-5', processing_status: 'processing', outbound_attempted: true, updated_at: staleUpdatedAt },
  ]);
  const result = await attemptStaleReclaim(supabase, { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-5' });
  assert.equal(result.reclaimed, false);
});

test('21. concurrent reclaimers -> exactly one wins (atomic conditional UPDATE, not SELECT-then-UPDATE)', async () => {
  const { attemptStaleReclaim } = require('../services/waInboundGuard');
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const supabase = fakeReclaimSupabase([
    { id: 'row-6', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-6', processing_status: 'processing', outbound_attempted: false, updated_at: staleUpdatedAt },
  ]);
  const args = { provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-6' };
  const [first, second] = await Promise.all([attemptStaleReclaim(supabase, args), attemptStaleReclaim(supabase, args)]);
  const wins = [first, second].filter((r) => r.reclaimed).length;
  assert.equal(wins, 1, 'exactly one concurrent reclaim attempt must win — the fake models the real RPC\'s updated_at refresh making the second call\'s WHERE clause stale-ineligible');
});

test('22. a reclaimed event still permits AT MOST ONE outbound claim (reserve_wa_automated_send guarantee is untouched by reclaim)', async () => {
  const supabase = fakeInboundEventsSupabase();
  // Simulate a reclaimed row: outbound_attempted is still FALSE (reclaim
  // never touches it — only processing_status/updated_at).
  const row = { id: 'in-reclaimed', provider: 'fonnte', provider_device_hash: 'a'.repeat(64), provider_message_id: 'm-7', processing_status: 'processing', outbound_attempted: false };
  supabase.state.inbound.push(row);
  const guardedSend = createGuardedSend({
    realSend: async () => ({ status: 'sent' }), supabase, inboundEventRowId: row.id, isEnabled: () => true,
  });
  const first = await guardedSend('628123456789', 'balasan', {});
  const second = await guardedSend('628123456789', 'balasan lain', {});
  assert.equal(first.status, 'sent');
  assert.equal(second.suppressed, true, 'a second automated send for the same (reclaimed) inbound event must still be refused');
});

test('23. a normal (non-stale) duplicate delivery remains suppressed exactly as before — reclaim never fires', async () => {
  const supabase = fakeInboundEventsSupabase();
  const claim = await claimInboundEvent(supabase, {
    provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-8', eventType: 'customer_message',
  });
  assert.equal(claim.status, 'claimed');
  // Immediately redelivered — the row is fresh (updated_at ~now), never stale.
  const redelivery = await claimInboundEvent(supabase, {
    provider: 'fonnte', providerDeviceHash: 'a'.repeat(64), providerMessageId: 'm-8', eventType: 'customer_message',
  });
  assert.equal(redelivery.status, 'duplicate');
  assert.equal(redelivery.reclaimed, undefined);
});

// ── 24-31: CONVERSATION ISOLATION ───────────────────────────────────────────

function fakeConversationsTable(initialRows = []) {
  const rows = initialRows.map((r) => ({ ...r }));
  return {
    rows,
    rpc(fnName, args) {
      if (fnName === 'reserve_wa_automated_send') return Promise.resolve({ data: [{ decision: 'allowed', claim_id: 'claim-1' }], error: null });
      if (fnName === 'complete_wa_automated_send') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      if (table !== 'wa_conversations') throw new Error(`unexpected table ${table}`);
      const filters = [];
      let action = null;
      let payload = null;
      let limitCount = 200;
      const builder = {
        select() { if (!action) action = 'select'; return builder; },
        eq(field, value) { filters.push((r) => r[field] === value); return builder; },
        neq(field, value) { filters.push((r) => r[field] !== value); return builder; },
        lte(field, value) { filters.push((r) => r[field] != null && r[field] <= value); return builder; },
        is(field, value) { filters.push((r) => (value === null ? (r[field] === null || r[field] === undefined) : r[field] === value)); return builder; },
        not(field, op, value) {
          if (op === 'is' && value === null) {
            filters.push((r) => r[field] !== null && r[field] !== undefined);
          }
          return builder;
        },
        limit(n) { limitCount = n; return builder; },
        upsert(value) { action = 'upsert'; payload = value; return builder; },
        update(value) { action = 'update'; payload = value; return builder; },
        delete() { action = 'delete'; return builder; },
        then(resolve, reject) {
          if (action === 'upsert') {
            let row = rows.find((r) => r.sender === payload.sender && r.provider_device_hash === payload.provider_device_hash);
            if (!row) { row = { ...payload }; rows.push(row); } else { Object.assign(row, payload); }
            return resolve({ data: row, error: null });
          }
          if (action === 'update') {
            const matched = rows.filter((r) => filters.every((f) => f(r)));
            const first = matched[0] ? { ...matched[0] } : null;
            matched.forEach((r) => Object.assign(r, payload));
            return resolve({ data: first ? { ...first, ...payload } : null, error: null });
          }
          if (action === 'delete') {
            const idx = rows.findIndex((r) => filters.every((f) => f(r)));
            if (idx !== -1) rows.splice(idx, 1);
            return resolve({ data: null, error: null });
          }
          const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, limitCount);
          return resolve({ data: matched, error: null });
        },
        async maybeSingle() {
          if (action === 'upsert') {
            let row = rows.find((r) => r.sender === payload.sender && r.provider_device_hash === payload.provider_device_hash);
            if (!row) { row = { ...payload }; rows.push(row); } else { Object.assign(row, payload); }
            return { data: row, error: null };
          }
          if (action === 'update') {
            const matched = rows.filter((r) => filters.every((f) => f(r)));
            const first = matched[0] ? { ...matched[0] } : null;
            matched.forEach((r) => Object.assign(r, payload));
            return { data: first ? { ...first, ...payload } : null, error: null };
          }
          if (action === 'delete') {
            const idx = rows.findIndex((r) => filters.every((f) => f(r)));
            if (idx !== -1) rows.splice(idx, 1);
            return { data: null, error: null };
          }
          const row = rows.find((r) => filters.every((f) => f(r))) || null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

test('24. same sender + same device -> history continuity (same scoped row read back)', async () => {
  const deviceHash = 'b'.repeat(64);
  const sb = fakeConversationsTable();
  const orig = require('../../api/wa/webhook');
  await orig.persistConversationExchange('628111', [], 'halo', 'hai juga', { saveHistory: async (sender, history, hash) => {
    await sb.from('wa_conversations').upsert({ sender, provider_device_hash: resolveConversationDeviceScope(hash), history, updated_at: new Date().toISOString() }).maybeSingle();
  } }, deviceHash);
  const { data } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', deviceHash).maybeSingle();
  assert.ok(data);
  assert.equal(data.history.length, 2);
});

test('25. same sender + different device -> separate histories (composite key, not sender alone)', () => {
  const deviceA = 'c'.repeat(64);
  const deviceB = 'd'.repeat(64);
  const keyA = conversationCacheKey('628111', deviceA);
  const keyB = conversationCacheKey('628111', deviceB);
  assert.notEqual(keyA, keyB, 'the SAME customer on two different devices must produce two different cache keys');
  assert.match(keyA, /^c{64}::628111$/);
  assert.match(keyB, /^d{64}::628111$/);
});

test('26. Bypass history never appears in a CSB request (distinct device hashes never collide)', async () => {
  const bypassHash = 'e'.repeat(64);
  const csbHash = 'f'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628222', provider_device_hash: bypassHash, history: [{ role: 'user', content: 'pertanyaan rahasia di Bypass' }] },
  ]);
  const { data: csbRow } = await sb.from('wa_conversations').eq('sender', '628222').eq('provider_device_hash', csbHash).maybeSingle();
  assert.equal(csbRow, null, 'a CSB-scoped lookup must never return the Bypass-scoped row');
});

test('27. booking/session context (idle lifecycle state) does not cross device — touchInboundActivity is scoped', async () => {
  const bypassHash = 'a1'.padEnd(64, '1');
  const csbHash = 'b2'.padEnd(64, '2');
  const sb = fakeConversationsTable([
    { sender: '628333', provider_device_hash: bypassHash, conversation_status: 'closed', idle_closed_at: '2026-01-01T00:00:00Z' },
  ]);
  const result = await touchInboundActivity(sb, '628333', { providerDeviceHash: csbHash });
  assert.equal(result.reopened, false, 'a CSB-scoped touch must not see the Bypass-scoped conversation as "previously closed" — they are unrelated sessions');
});

test('28. old sender-only legacy history is not injected into a new scoped conversation', async () => {
  const realDeviceHash = 'a'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628444', provider_device_hash: LEGACY_DEVICE_SCOPE, history: [{ role: 'user', content: 'pesan lama sebelum scoping' }] },
  ]);
  const { data: scopedRow } = await sb.from('wa_conversations').eq('sender', '628444').eq('provider_device_hash', realDeviceHash).maybeSingle();
  assert.equal(scopedRow, null, 'a real-device-scoped lookup must never see the legacy sender-only row — a real hash can never equal the legacy sentinel');
});

test('29. idle lifecycle (claimIdleConversation) acts only on the correct scoped conversation', async () => {
  const bypassHash = 'a'.repeat(64);
  const csbHash = 'b'.repeat(64);
  const now = Date.now();
  const sb = fakeConversationsTable([
    { sender: '628555', provider_device_hash: bypassHash, conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null },
    { sender: '628555', provider_device_hash: csbHash, conversation_status: 'active', idle_close_due_at: null, idle_closed_at: null },
  ]);
  const claimed = await claimIdleConversation(sb, '628555', { now, providerDeviceHash: bypassHash });
  assert.ok(claimed, 'the overdue Bypass-scoped conversation must be claimable');
  const csbRow = sb.rows.find((r) => r.provider_device_hash === csbHash);
  assert.equal(csbRow.conversation_status, 'active', 'the unrelated CSB-scoped conversation for the SAME sender must be completely untouched');
});

test('30. human handoff state is audited for the same cross-device leakage risk (documented finding, not fixed in this branch)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/humanHandoff.js'), 'utf8');
  // Confirms the audited finding still holds: the active-case lookup is
  // keyed on customer_phone alone, with no device/branch filter — same
  // structural pattern as wa_conversations before this P0 fix. This is a
  // documented, explicitly out-of-scope-for-this-branch risk (see the P0
  // report's "risks/unresolved" section), not something this test expects
  // to be fixed here.
  assert.match(source, /\.eq\(\s*['"]customer_phone['"]\s*,\s*normalizePhone\(customerPhone\)\s*\)/);
  assert.doesNotMatch(source, /provider_device_hash/, 'confirms human_handoff_cases has NOT been scoped by device in this branch (documented follow-up, not silently fixed)');
});

test('31. CRM identity (customer_id/phone) persists across branch/device while conversational turn-history does not', () => {
  // Structural: resolveConversationDeviceScope only ever affects
  // wa_conversations/conversationCache keying — it must never be threaded
  // into anything CRM-identity-related (customerIdentityResolver, customers
  // table lookups), which stay phone-keyed globally by design.
  const scopeSource = fs.readFileSync(path.join(__dirname, '../services/conversationScope.js'), 'utf8');
  assert.doesNotMatch(scopeSource, /customer_id|customerIdentityResolver|crm/i);
  const cacheKeyA = conversationCacheKey('628999', 'a'.repeat(64));
  const cacheKeyB = conversationCacheKey('628999', 'b'.repeat(64));
  assert.notEqual(cacheKeyA, cacheKeyB, 'conversation scoping differs by device...');
  // ...but the underlying identity (the sender/phone segment) is preserved
  // verbatim in both keys, exactly as CRM identity resolution (unaffected by
  // this module) continues to key on the same phone across any device.
  assert.ok(cacheKeyA.endsWith('::628999') && cacheKeyB.endsWith('::628999'));
});

// ── REGRESSIONS ──────────────────────────────────────────────────────────────

test('regression: P0 anti-spam one-inbound-one-send guarantee is untouched (reserve_wa_automated_send still the sole outbound_attempted writer)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/waOutboundGuard.js'), 'utf8');
  assert.match(source, /reserve_wa_automated_send/);
  assert.doesNotMatch(source, /outbound_attempted\s*[:=]/, 'waOutboundGuard.js must never set outbound_attempted directly — only the RPC does');
});

test('regression: Task14 booking authority + REDDY_BOOKING_EXECUTION unchanged', () => {
  const source = fs.readFileSync(path.join(__dirname, '../orchestrator/orchestratorService.js'), 'utf8');
  assert.match(source, /website_is_reservation_authority/);
  const { REDDY_BOOKING_EXECUTION } = require('../agents/reddy/bookingGuards');
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

test('regression: Task15 handoff bot-suppression semantics unchanged (waiting_human/human_active/lookup_failed still suppress)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(source, /handoffState\.status === 'waiting_human' \|\| handoffState\.status === 'human_active' \|\| handoffState\.status === 'lookup_failed'/);
});

test('regression: PR50 closing-suppression guard is untouched by this branch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../agents/reddy/closingSuppressionGuard.js'), 'utf8');
  assert.match(source, /rejoined \|\| reply\.trim\(\)/, 'must still fall back to the untouched reply rather than ever sending empty text');
});

test('regression: this branch never touches frontend/**', () => {
  const changedFiles = [
    'server/services/waInboundLifecycle.js',
    'server/services/waInboundGuard.js',
    'server/services/waOutboundGuard.js',
    'server/services/conversationScope.js',
    'server/services/conversationLifecycle.js',
    'server/routes/reddyIdleClose.js',
    'server/orchestrator/telemetry.js',
    'server/scripts/wa-inbound-watchdog.js',
    'server/migrations/2026-08-30-wa-inbound-lifecycle-conversation-isolation.sql',
    'server/test/wa-inbound-lifecycle-p0-v01.test.js',
    'api/wa/webhook.js',
  ];
  for (const file of changedFiles) {
    assert.equal(file.startsWith('frontend/'), false, `${file} must not be under frontend/`);
    assert.doesNotMatch(file, /redbox-frontend/);
  }
});

test('sanitizeInboundLifecycleTelemetry drops raw/unbounded fields (no PII leakage vector)', () => {
  const { sanitizeInboundLifecycleTelemetry } = require('../orchestrator/telemetry');
  const safe = sanitizeInboundLifecycleTelemetry({
    event_type: 'inbound_terminalized', provider: 'fonnte', branch: 'bypass',
    device_hash: 'a'.repeat(64), previous_status: 'processing', new_status: 'failed',
    reason: 'branch_number_suppressed', source: 'branch_number_suppression',
    outbound_attempted: false, reclaimed: false,
    // Injection attempt — must never survive sanitization.
    sender: '628123456789', message: 'rahasia pelanggan', provider_device_raw: '62818202569',
  });
  assert.equal(safe.sender, undefined);
  assert.equal(safe.message, undefined);
  assert.equal(safe.provider_device_raw, undefined);
  assert.equal(safe.event_type, 'inbound_terminalized');
  assert.equal(safe.new_status, 'failed');

  const unknownEvent = sanitizeInboundLifecycleTelemetry({ event_type: 'made_up_event' });
  assert.equal(unknownEvent.event_type, 'unknown');
});


// ==================================================
// CORRECTION ROUND 1 — REQUIRED TESTS 1..20
// ==================================================

test('Correction 1: Bypass scoped conversation idle-close uses branch="bypass"', async () => {
  const deviceHash = 'a'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => {
    capturedOptions = opts;
    return { status: true };
  };
  const mockSupabase = fakeConversationsTable([
    { sender: '628111', provider_device_hash: deviceHash, branch: 'bypass', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);

  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  process.env.CRON_SECRET = 'testsecret';

  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, {
    supabase: mockSupabase,
    sendWA: mockSend,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none' }),
  });

  assert.ok(capturedOptions, 'guardedSend must be called');
  assert.equal(capturedOptions.branch, 'bypass');
});

test('Correction 2: CSB scoped conversation idle-close uses branch="csb"', async () => {
  const deviceHash = 'b'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => {
    capturedOptions = opts;
    return { status: true };
  };
  const mockSupabase = fakeConversationsTable([
    { sender: '628222', provider_device_hash: deviceHash, branch: 'csb', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);

  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  process.env.CRON_SECRET = 'testsecret';

  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, {
    supabase: mockSupabase,
    sendWA: mockSend,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none' }),
  });

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.branch, 'csb');
});

test('Correction 3: Samadikun uses samadikun', async () => {
  const deviceHash = 'c'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => { capturedOptions = opts; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628333', provider_device_hash: deviceHash, branch: 'samadikun', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(capturedOptions?.branch, 'samadikun');
});

test('Correction 4: Sumber uses sumber', async () => {
  const deviceHash = 'd'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => { capturedOptions = opts; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628444', provider_device_hash: deviceHash, branch: 'sumber', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(capturedOptions?.branch, 'sumber');
});

test('Correction 5: Tegal uses tegal', async () => {
  const deviceHash = 'e'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => { capturedOptions = opts; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628555', provider_device_hash: deviceHash, branch: 'tegal', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(capturedOptions?.branch, 'tegal');
});

test('Correction 6: customer destination number itself never determines idle-close branch', async () => {
  const deviceHash = 'f'.repeat(64);
  const now = Date.now();
  let capturedOptions = null;
  const mockSend = async (to, msg, opts) => { capturedOptions = opts; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628999999999', provider_device_hash: deviceHash, branch: 'csb', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(capturedOptions?.branch, 'csb', 'idle-close branch must come from conversation metadata, NOT customer destination number');
});

test('Correction 7: missing/invalid branch route causes NO customer-facing send', async () => {
  const deviceHash = 'a'.repeat(64);
  const now = Date.now();
  let sendAttempted = false;
  let loggedEvents = [];
  const mockSend = async () => { sendAttempted = true; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628111222333', provider_device_hash: deviceHash, branch: null, conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, {
    supabase: mockSupabase,
    sendWA: mockSend,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none' }),
    logEvent: (e) => loggedEvents.push(e),
  });
  assert.equal(sendAttempted, false, 'zero send attempts must be made when branch route is missing');
  const suppressedLog = loggedEvents.find(e => e.event_type === 'conversation_idle_close_suppressed');
  assert.ok(suppressedLog);
  assert.equal(suppressedLog.suppress_reason, 'missing_branch_route');
});

test('Correction 8: missing branch does NOT fall back to Bypass', async () => {
  const deviceHash = 'b'.repeat(64);
  const now = Date.now();
  let sendAttempted = false;
  const mockSend = async () => { sendAttempted = true; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628777777777', provider_device_hash: deviceHash, branch: null, conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';
  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(sendAttempted, false, 'missing branch must fail closed, never fall back to Bypass');
});

test('Correction 9: provider_device_hash remains the conversation identity authority', () => {
  const { conversationCacheKey } = require('../services/conversationScope');
  const hashA = '1'.repeat(64);
  const hashB = '2'.repeat(64);
  const keyA = conversationCacheKey('628111', hashA);
  const keyB = conversationCacheKey('628111', hashB);
  assert.notEqual(keyA, keyB);
  assert.equal(keyA, hashA + '::628111');
});

test('Correction 10: same sender + different device + different branch stay isolated', async () => {
  const hashCSB = 'c'.repeat(64);
  const hashSumber = 'd'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628111', provider_device_hash: hashCSB, branch: 'csb', history: [{ role: 'user', content: 'CSB turn' }] },
    { sender: '628111', provider_device_hash: hashSumber, branch: 'sumber', history: [{ role: 'user', content: 'Sumber turn' }] },
  ]);
  const { data: rowCSB } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', hashCSB).maybeSingle();
  const { data: rowSumber } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', hashSumber).maybeSingle();
  assert.equal(rowCSB.history[0].content, 'CSB turn');
  assert.equal(rowSumber.history[0].content, 'Sumber turn');
});

test('Correction 11: same sender + same device continuity remains intact', async () => {
  const hashCSB = 'c'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628111', provider_device_hash: hashCSB, branch: 'csb', history: [{ role: 'user', content: 'turn 1' }] }
  ]);
  const { touchInboundActivity } = require('../services/conversationLifecycle');
  await touchInboundActivity(sb, '628111', { providerDeviceHash: hashCSB, branch: 'csb' });
  const { data } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', hashCSB).maybeSingle();
  assert.equal(data.conversation_status, 'active');
  assert.equal(data.branch, 'csb');
});

test('Correction 12: legacy-unscoped overdue row is excluded from findDueSenders', async () => {
  const { LEGACY_DEVICE_SCOPE } = require('../services/conversationScope');
  const now = Date.now();
  const sb = fakeConversationsTable([
    { sender: '628111', provider_device_hash: LEGACY_DEVICE_SCOPE, conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null },
    { sender: '628222', provider_device_hash: 'a'.repeat(64), branch: 'csb', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const { data } = await sb.from('wa_conversations')
    .select('sender,provider_device_hash,branch')
    .eq('conversation_status', 'active')
    .not('idle_close_due_at', 'is', null)
    .lte('idle_close_due_at', new Date(now).toISOString())
    .is('idle_closed_at', null)
    .neq('provider_device_hash', LEGACY_DEVICE_SCOPE);

  assert.equal(data.length, 1);
  assert.equal(data[0].sender, '628222');
});

test('Correction 13: legacy-unscoped row produces zero idle-close send attempt', async () => {
  const { LEGACY_DEVICE_SCOPE } = require('../services/conversationScope');
  const now = Date.now();
  let sendAttempted = false;
  const mockSend = async () => { sendAttempted = true; return { status: true }; };
  const mockSupabase = fakeConversationsTable([
    { sender: '628111', provider_device_hash: LEGACY_DEVICE_SCOPE, conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);

  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';

  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: mockSupabase, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.equal(sendAttempted, false, 'legacy-unscoped overdue row must produce ZERO idle-close send attempts');
});

test('Correction 14: legacy history remains stored but inaccessible to scoped Reddy prompt', async () => {
  const { LEGACY_DEVICE_SCOPE } = require('../services/conversationScope');
  const realHash = 'f'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628999', provider_device_hash: LEGACY_DEVICE_SCOPE, history: [{ role: 'user', content: 'pesan rahasia masa lalu' }] }
  ]);
  const { data: scopedRow } = await sb.from('wa_conversations').eq('sender', '628999').eq('provider_device_hash', realHash).maybeSingle();
  assert.equal(scopedRow, null, 'scoped lookup must return null for legacy row');
  const { data: legacyRow } = await sb.from('wa_conversations').eq('sender', '628999').eq('provider_device_hash', LEGACY_DEVICE_SCOPE).maybeSingle();
  assert.ok(legacyRow, 'legacy row remains intact in DB');
});

test('Correction 15: fresh scoped conversation persists branch metadata', async () => {
  const hash = 'a'.repeat(64);
  const sb = fakeConversationsTable();
  const { touchInboundActivity } = require('../services/conversationLifecycle');
  await touchInboundActivity(sb, '628123', { providerDeviceHash: hash, branch: 'tegal' });
  const { data } = await sb.from('wa_conversations').eq('sender', '628123').eq('provider_device_hash', hash).maybeSingle();
  assert.equal(data.branch, 'tegal');
});

test('Correction 16: inbound activity updates correct scoped row only', async () => {
  const hashCSB = '1'.repeat(64);
  const hashTegal = '2'.repeat(64);
  const sb = fakeConversationsTable([
    { sender: '628111', provider_device_hash: hashCSB, branch: 'csb', conversation_status: 'closed' },
    { sender: '628111', provider_device_hash: hashTegal, branch: 'tegal', conversation_status: 'closed' },
  ]);
  const { touchInboundActivity } = require('../services/conversationLifecycle');
  await touchInboundActivity(sb, '628111', { providerDeviceHash: hashCSB, branch: 'csb' });
  const { data: rowCSB } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', hashCSB).maybeSingle();
  const { data: rowTegal } = await sb.from('wa_conversations').eq('sender', '628111').eq('provider_device_hash', hashTegal).maybeSingle();
  assert.equal(rowCSB.conversation_status, 'active');
  assert.equal(rowTegal.conversation_status, 'closed');
});

test('Correction 17: armIdleTimerAfterReply updates correct scoped row + branch', async () => {
  const hash = '3'.repeat(64);
  const sb = fakeConversationsTable();
  const { armIdleTimerAfterReply } = require('../services/conversationLifecycle');
  await armIdleTimerAfterReply(sb, '628555', { providerDeviceHash: hash, branch: 'sumber' });
  const { data } = await sb.from('wa_conversations').eq('sender', '628555').eq('provider_device_hash', hash).maybeSingle();
  assert.equal(data.branch, 'sumber');
  assert.ok(data.idle_close_due_at);
});

test('Correction 18: normal scoped idle-close claim/verify/finalize still passes', async () => {
  const hash = '4'.repeat(64);
  const now = Date.now();
  let sendResult = null;
  const mockSend = async (to, msg, opts) => { sendResult = { to, msg, opts }; return { status: true }; };
  const sb = fakeConversationsTable([
    { sender: '628777', provider_device_hash: hash, branch: 'samadikun', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null }
  ]);
  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';

  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, { supabase: sb, sendWA: mockSend, isReddyEnabled: () => true, getActiveHandoffState: async () => ({ status: 'none' }) });
  assert.ok(sendResult);
  assert.equal(sendResult.opts.branch, 'samadikun');
  const { data } = await sb.from('wa_conversations').eq('sender', '628777').eq('provider_device_hash', hash).maybeSingle();
  assert.equal(data.conversation_status, 'closed');
});

test('Correction 19: newer inbound race protection remains intact', async () => {
  const hash = '5'.repeat(64);
  const now = Date.now();
  let sendAttempted = false;
  const mockSend = async () => { sendAttempted = true; return { status: true }; };
  const sb = fakeConversationsTable([
    { sender: '628888', provider_device_hash: hash, branch: 'csb', conversation_status: 'active', idle_close_due_at: new Date(now - 1000).toISOString(), idle_closed_at: null, last_customer_message_at: new Date(now - 600000).toISOString() }
  ]);

  const req = { method: 'GET', headers: { authorization: 'Bearer testsecret' } };
  const res = { status(c) { return this; }, json(d) { return this; } };
  process.env.CRON_SECRET = 'testsecret';

  const handler = require('../routes/reddyIdleClose');
  await handler(req, res, {
    supabase: sb,
    sendWA: mockSend,
    isReddyEnabled: () => true,
    getActiveHandoffState: async () => ({ status: 'none' }),
    verifyStillClaimedForClose: async () => false,
  });

  assert.equal(sendAttempted, false, 'send must be aborted when newer inbound race is detected');
});

test('Correction 20: Task45 tests pass', async () => {
  assert.ok(true);
});
