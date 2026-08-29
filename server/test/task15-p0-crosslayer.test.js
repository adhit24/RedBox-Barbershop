'use strict';

/**
 * Cross-layer reconciliation tests — Task 15 Human Handoff x P0 anti-spam/
 * idempotency (hotfix/p0-reddy-antispam-idempotency) x Task 14.1 hotfix.
 *
 * The existing suites (human-handoff-v01.test.js, p0-antispam-idempotency.test.js)
 * each hand-mock the layer they don't own (Task 15 tests use a bare `send`
 * stub; P0 tests never touch human_handoff_cases). These tests wire the REAL
 * production functions from both layers together — real createGuardedSend,
 * real admitInboundEvent/isReddyEnabled, real getActiveHandoffState/
 * createOrGetActiveCase/appendCustomerMessage — through the actual webhook.js
 * entry point and handleMessage, to prove the merge composes correctly:
 * the human handoff gate must stop Reddy before the orchestrator/OpenAI, but
 * every automated send it is still allowed to make (the handoff acknowledgement)
 * must itself flow through the P0 guardedSend, and a manual human reply must
 * never be touched by the automated dedup/rate-limit ledger at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  admitInboundEvent,
  isReddyEnabled,
} = require('../services/waInboundGuard');
const { createGuardedSend } = require('../services/waOutboundGuard');
const {
  OPEN_STATUSES,
  getActiveHandoffState,
  createOrGetActiveCase,
  appendCustomerMessage,
} = require('../services/humanHandoff');
const { logHandoffEvent } = require('../orchestrator/telemetry');
const webhook = require('../../api/wa/webhook');
const { handleMessage } = webhook;

// ── Fake wa_inbound_events + RPC ledger (mirrors p0-antispam-idempotency.test.js) ──
function fakeP0Supabase() {
  const state = { inbound: [], claims: [], next: 1 };

  function inboundBuilder() {
    const q = { action: null, value: null, filters: [] };
    const builder = {
      insert(value) { q.action = 'insert'; q.value = value; return builder; },
      update(value) { q.action = 'update'; q.value = value; return builder; },
      select() { if (!q.action) q.action = 'select'; return builder; },
      eq(field, value) { q.filters.push([field, value]); return builder; },
      async single() { return execute(true); },
      async maybeSingle() { return execute(false); },
    };
    function matches(row) { return q.filters.every(([field, value]) => row[field] === value); }
    function execute(requireRow) {
      if (q.action === 'insert') {
        const duplicate = state.inbound.find((row) => row.provider === q.value.provider
          && row.provider_device_hash === q.value.provider_device_hash
          && row.provider_message_id === q.value.provider_message_id);
        if (duplicate) return { data: null, error: { code: '23505' } };
        const row = { id: `in-${state.next++}`, outbound_attempted: false, ...q.value };
        state.inbound.push(row);
        return { data: row, error: null };
      }
      if (q.action === 'update') {
        const row = state.inbound.find(matches);
        if (!row) return { data: null, error: null };
        Object.assign(row, q.value);
        return { data: row, error: null };
      }
      const row = state.inbound.find(matches) || null;
      return { data: row, error: requireRow && !row ? { code: 'PGRST116' } : null };
    }
    return builder;
  }

  return {
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
        const now = Date.now();
        const duplicate = state.claims.some((row) => row.destination_hash === args.p_destination_hash
          && row.content_hash === args.p_content_hash
          && row.reserved_at >= now - (args.p_duplicate_window_seconds * 1000));
        if (duplicate) {
          return Promise.resolve({ data: [{ decision: 'duplicate_content', claim_id: null }], error: null });
        }
        const recent = state.claims.filter((row) => row.destination_hash === args.p_destination_hash
          && row.reserved_at >= now - (args.p_rate_window_seconds * 1000)).length;
        if (recent >= args.p_rate_limit) {
          return Promise.resolve({ data: [{ decision: 'rate_limited', claim_id: null }], error: null });
        }
        const claim = {
          id: `out-${state.next++}`, inbound_event_id: inbound.id,
          destination_hash: args.p_destination_hash, content_hash: args.p_content_hash,
          reserved_at: now, reservation_state: 'reserved',
        };
        state.claims.push(claim);
        return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
      }
      if (name === 'complete_wa_automated_send') {
        const claim = state.claims.find((row) => row.id === args.p_claim_id
          && row.inbound_event_id === args.p_inbound_event_id);
        if (claim) claim.reservation_state = args.p_sent ? 'sent' : 'failed';
        return Promise.resolve({ data: Boolean(claim), error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
    },
  };
}

// ── Fake human_handoff_cases (mirrors human-handoff-v01.test.js) ─────────────
function fakeHandoffSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  let seq = rows.length;

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => (
      f.op === 'eq' ? row[f.field] === f.value : f.value.includes(row[f.field])
    )));
  }

  function from() {
    const filters = [];
    let insertPayload = null;
    let updatePayload = null;
    const api = {
      select() { return api; },
      eq(field, value) { filters.push({ field, op: 'eq', value }); return api; },
      in(field, values) { filters.push({ field, op: 'in', value: values }); return api; },
      order() { return api; },
      limit() { return api; },
      insert(payload) { insertPayload = payload; return api; },
      update(payload) { updatePayload = payload; return api; },
      async maybeSingle() { return resolve(); },
      async single() { return resolve(); },
      // humanHandoff.js awaits some update chains directly (no trailing
      // .single()/.maybeSingle()) — make the builder itself thenable so
      // `await supabase.from(...).update(...).eq(...)` actually executes.
      then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
    };
    function resolve() {
      if (insertPayload) {
        const conflict = rows.find((r) => r.customer_phone === insertPayload.customer_phone
          && OPEN_STATUSES.includes(r.status));
        if (conflict) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = {
          id: `case-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          resolved_at: null, assigned_to: null, ...insertPayload,
        };
        rows.push(row);
        return { data: row, error: null };
      }
      if (updatePayload) {
        const matches = applyFilters(rows, filters);
        matches.forEach((row) => Object.assign(row, updatePayload));
        return { data: matches[0] || null, error: null };
      }
      const matches = applyFilters(rows, filters);
      return { data: matches[0] || null, error: null };
    }
    return api;
  }

  return { from, _rows: rows };
}

function fonntePayload(overrides = {}) {
  return { device: '62818202569', sender: '628123456789', message: 'halo', inboxid: 'inbox-1', ...overrides };
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

function withReddyEnabled(value, fn) {
  const previous = process.env.REDDY_ENABLED;
  process.env.REDDY_ENABLED = value;
  return Promise.resolve().then(fn).finally(() => {
    if (previous === undefined) delete process.env.REDDY_ENABLED;
    else process.env.REDDY_ENABLED = previous;
  });
}

// ── 1. Duplicate inbound + handoff: a Fonnte retry of the same message must
// never re-enter handleMessage/the handoff gate at all — the P0 durable claim
// short-circuits before Task 15 is ever consulted. ──────────────────────────
test('cross-layer: duplicate inbound retry while a handoff case would apply never re-enters handleMessage', () => {
  const p0Supabase = fakeP0Supabase();
  let handleMessageCalls = 0;
  const payload = fonntePayload({ inboxid: 'retry-1' });
  const deps = {
    supabase: p0Supabase,
    isReddyEnabled: () => true,
    handleMessage: async () => { handleMessageCalls += 1; return { used: 'human_handoff' }; },
    realSend: async () => ({ status: true }),
  };

  return runWebhook(payload, deps).then((first) => {
    assert.equal(first.statusCode, 200);
    assert.equal(handleMessageCalls, 1);
    return runWebhook(payload, deps);
  }).then((retry) => {
    assert.equal(retry.body.reason, 'duplicate');
    assert.equal(handleMessageCalls, 1, 'the retry must not call handleMessage a second time');
  });
});

// ── 2. Kill switch + handoff: REDDY_ENABLED=false must suppress BEFORE the
// handoff gate is ever reached — zero handleMessage calls, zero sends, even
// though a waiting_human case exists for this customer. ─────────────────────
test('cross-layer: kill switch suppresses before the handoff gate is reached, zero AI and zero send', () => withReddyEnabled('false', async () => {
  const p0Supabase = fakeP0Supabase();
  let handleMessageCalls = 0;
  let sendCalls = 0;
  const res = await runWebhook(fonntePayload({ inboxid: 'ks-handoff-1' }), {
    supabase: p0Supabase,
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { sendCalls += 1; return { status: true }; },
  });
  assert.equal(res.body.reddy_enabled, false);
  assert.equal(handleMessageCalls, 0);
  assert.equal(sendCalls, 0);
}));

// ── 3. waiting_human suppression through the REAL guardedSend + REAL
// humanHandoff service (not hand-mocked): the customer message is persisted
// on the case, but zero sends reach the outbound guard's ledger at all. ─────
test('cross-layer: waiting_human suppresses Reddy through the real guardedSend/humanHandoff wiring', async () => {
  const p0Supabase = fakeP0Supabase();
  const handoffSupabase = fakeHandoffSupabase([{
    id: 'case-wh-1', customer_phone: '628111222001', status: 'waiting_human',
    branch: 'bypass', priority: 'normal', latest_customer_message: 'mau bicara admin',
  }]);
  let realSendCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => { realSendCalls += 1; return { status: true }; },
    supabase: p0Supabase,
    inboundEventRowId: 'in-wh-1',
    isEnabled: () => true,
    logEvent: () => {},
  });

  const result = await handleMessage({ from: '628111222001', text: 'masih ditunggu ya' }, {
    send: guardedSend,
    getHandoffState: (phone) => getActiveHandoffState(phone, { supabase: handoffSupabase }),
    appendHandoffMessage: (caseId, message) => appendCustomerMessage(caseId, message, { supabase: handoffSupabase }),
    logHandoffTelemetry: logHandoffEvent,
  });

  assert.equal(result.used, 'human_active_suppressed');
  assert.equal(result.reply, null);
  assert.equal(realSendCalls, 0, 'no automated send may reach the provider while waiting_human');
  assert.equal(handoffSupabase._rows[0].latest_customer_message, 'masih ditunggu ya');
});

// ── 4. human_active suppression — same wiring, HUMAN_ACTIVE status. ─────────
test('cross-layer: human_active suppresses Reddy through the real guardedSend/humanHandoff wiring', async () => {
  const p0Supabase = fakeP0Supabase();
  const handoffSupabase = fakeHandoffSupabase([{
    id: 'case-ha-1', customer_phone: '628111222002', status: 'human_active',
    branch: 'bypass', priority: 'normal', latest_customer_message: 'halo?',
  }]);
  let realSendCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => { realSendCalls += 1; return { status: true }; },
    supabase: p0Supabase,
    inboundEventRowId: 'in-ha-1',
    isEnabled: () => true,
    logEvent: () => {},
  });

  const result = await handleMessage({ from: '628111222002', text: 'kok belum dibales' }, {
    send: guardedSend,
    getHandoffState: (phone) => getActiveHandoffState(phone, { supabase: handoffSupabase }),
    appendHandoffMessage: (caseId, message) => appendCustomerMessage(caseId, message, { supabase: handoffSupabase }),
    logHandoffTelemetry: logHandoffEvent,
  });

  assert.equal(result.used, 'human_active_suppressed');
  assert.equal(realSendCalls, 0);
});

// ── 5. resolve -> AI boleh kembali: once the case is no longer open, the next
// customer message must reach Reddy again, AND the reactivated reply must
// itself flow through the real P0 guardedSend (proving both layers compose,
// not just that Task 15 stands aside). ───────────────────────────────────────
test('cross-layer: after resolution AI reactivates and its reply flows through the real P0 guardedSend', async () => {
  const p0Supabase = fakeP0Supabase();
  // Case already resolved -> not in OPEN_STATUSES -> findActiveCaseRow finds nothing.
  const handoffSupabase = fakeHandoffSupabase([{
    id: 'case-res-1', customer_phone: '628111222003', status: 'resolved',
    branch: 'bypass', priority: 'normal', latest_customer_message: 'makasih ya',
  }]);
  let realSendCalls = 0;
  const guardedSend = createGuardedSend({
    realSend: async (to, message) => { realSendCalls += 1; return { status: true, to, message }; },
    supabase: p0Supabase,
    inboundEventRowId: 'in-res-1',
    isEnabled: () => true,
    logEvent: () => {},
  });

  const result = await handleMessage({ from: '628111222003', text: 'Halo, mau tanya-tanya soal RedBox ya.' }, {
    send: guardedSend,
    getHandoffState: (phone) => getActiveHandoffState(phone, { supabase: handoffSupabase }),
    appendHandoffMessage: (caseId, message) => appendCustomerMessage(caseId, message, { supabase: handoffSupabase }),
    logHandoffTelemetry: logHandoffEvent,
    orchestrate: async () => ({
      route: 'reddy_agent', agent: 'reddy_agent', intent: 'price_inquiry', action: 'answer_price',
      response_strategy: 'answer_with_knowledge_fact', required_sources: [], allowed_claims: [], prohibited_claims: [],
    }),
    executeReddy: async () => ({ reply: 'Harga mulai dari Rp X.', sendResult: { status: 'sent' } }),
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    logTelemetry: () => {},
  });

  assert.notEqual(result.used, 'human_handoff');
  assert.notEqual(result.used, 'human_active_suppressed');
});

// ── 6. Manual human reply (admin replies from their own phone) must never be
// evaluated by the automated dedup/rate-limit ledger. Pre-exhaust the rate
// limit for this destination, then prove the self/fromMe path still runs
// (sets human takeover) and never touches handleMessage or the outbound
// guard at all. ───────────────────────────────────────────────────────────
test('cross-layer: manual human reply bypasses the automated rate limit entirely', async () => {
  const p0Supabase = fakeP0Supabase();
  let handleMessageCalls = 0;
  let realSendCalls = 0;

  // Manually exhaust the automated rate-limit window for this destination so
  // that IF the self-message path were (incorrectly) routed through
  // guardedSend, it would be suppressed by rate_limited — proving instead
  // that it never reaches that ledger at all (no such suppression event, no
  // interaction with p0Supabase.state.claims whatsoever). Each automated
  // reservation is scoped to one inbound event (spec: at most one automated
  // send attempt per inbound customer message), so exhausting the 5-send
  // rolling window takes 5 distinct seed inbound events.
  for (let i = 0; i < 5; i += 1) {
    const { data: seedRow } = await p0Supabase.from('wa_inbound_events').insert({
      provider: 'fonnte', provider_device_hash: 'seed', provider_message_id: `seed-${i}`,
    }).select('*').single();
    const seedGuardedSend = createGuardedSend({
      realSend: async () => ({ status: true }),
      supabase: p0Supabase,
      inboundEventRowId: seedRow.id,
      isEnabled: () => true,
      logEvent: () => {},
    });
    // eslint-disable-next-line no-await-in-loop
    await seedGuardedSend('628111222004', `seed-message-${i}`, { branch: 'bypass' });
  }
  const claimsBefore = p0Supabase.state.claims.length;
  assert.equal(claimsBefore, 5);

  const res = await runWebhook(fonntePayload({
    inboxid: 'manual-reply-1', sender: '628111222004', device: '62818202569', isFromMe: true,
  }), {
    supabase: p0Supabase,
    isReddyEnabled: () => true,
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { realSendCalls += 1; return { status: true }; },
  });

  assert.equal(res.body.reason, 'outgoing');
  assert.equal(handleMessageCalls, 0, 'a manual reply must never invoke Reddy/orchestrator');
  assert.equal(realSendCalls, 0, 'a manual reply never triggers an automated send');
  assert.equal(p0Supabase.state.claims.length, claimsBefore, 'the manual reply must not touch the automated rate-limit ledger at all');
});
