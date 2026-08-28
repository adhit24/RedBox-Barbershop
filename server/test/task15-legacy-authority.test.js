'use strict';

/**
 * Correction Round 1 — Blocker 1: the legacy 30-minute wa_paused pause must
 * never prevent Task 15's persisted human_handoff_cases gate from observing
 * an inbound customer message first, and a case resolution must actually let
 * AI resume (not stay silently suppressed by a stale Task15-generated legacy
 * pause). Tested at the REAL HTTP level (webhook(req, res, testDeps)), not
 * only via direct handleMessage() calls, per the correction's explicit
 * requirement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const webhook = require('../../api/wa/webhook');
const { createOrGetActiveCase, OPEN_STATUSES, TRIGGER_TYPES, PRIORITIES } = require('../services/humanHandoff');
const { createHumanHandoffRoutes } = require('../routes/humanHandoff');

// ── Fake wa_inbound_events + RPC ledger (P0) ──────────────────────────────
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
        const claim = { id: `out-${state.next++}`, inbound_event_id: inbound.id, reserved_at: Date.now() };
        state.claims.push(claim);
        return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
      }
      if (name === 'complete_wa_automated_send') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
    },
  };
}

// ── Combined fake: human_handoff_cases + wa_paused, sharing one store so the
// route layer (claim/resolve) and the webhook layer (Task 15 gate + legacy
// pause reconciliation) observe the same state. ──────────────────────────
function fakeCombinedSupabase() {
  const cases = [];
  const paused = new Map(); // sender -> { sender, paused_by, paused_until }
  let seq = 0;

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => (
      f.op === 'eq' ? row[f.field] === f.value : f.value.includes(row[f.field])
    )));
  }

  function casesTable() {
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
      then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
    };
    function resolve() {
      if (insertPayload) {
        const conflict = cases.find((r) => r.customer_phone === insertPayload.customer_phone && OPEN_STATUSES.includes(r.status));
        if (conflict) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = {
          id: `case-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          resolved_at: null, assigned_to: null, ...insertPayload,
        };
        cases.push(row);
        return { data: row, error: null };
      }
      if (updatePayload) {
        const matches = applyFilters(cases, filters);
        matches.forEach((row) => Object.assign(row, updatePayload));
        return { data: matches[0] || null, error: null };
      }
      const matches = applyFilters(cases, filters);
      return { data: matches[0] || null, error: null };
    }
    return api;
  }

  function pausedTable() {
    let filterSender = null;
    let deleting = false;
    const api = {
      select() { return api; },
      eq(field, value) { if (field === 'sender') filterSender = value; return api; },
      delete() { deleting = true; return api; },
      async maybeSingle() {
        if (deleting) { paused.delete(filterSender); return { data: null, error: null }; }
        return { data: paused.get(filterSender) || null, error: null };
      },
      then(onFulfilled) {
        if (deleting) { paused.delete(filterSender); return Promise.resolve({ data: null, error: null }).then(onFulfilled); }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      },
    };
    return api;
  }

  return {
    from(table) {
      if (table === 'human_handoff_cases') return casesTable();
      if (table === 'wa_paused') return pausedTable();
      throw new Error(`unexpected table ${table}`);
    },
    seedWaPaused(sender, pausedBy) {
      paused.set(sender, { sender, paused_by: pausedBy, paused_until: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
    },
    getWaPaused(sender) { return paused.get(sender); },
    getCase(id) { return cases.find((c) => c.id === id); },
  };
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
  await webhook({ method: 'POST', body, query: {} }, res, { isReddyEnabled: () => true, ...deps });
  return res;
}

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/handoff', createHumanHandoffRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified: true };
    next();
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

// ── H1: waiting_human next inbound, legacy pause ALSO exists ──────────────

test('H1. waiting_human suppresses via the Task 15 gate even when a legacy pause also exists', async () => {
  const phone = '628111333001';
  const combined = fakeCombinedSupabase();
  const created = await createOrGetActiveCase({
    customerPhone: phone, branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  }, { supabase: combined });
  assert.equal(created.status, 'created');
  const caseId = created.case.id;

  // legacy pause also exists (simulates Task 15's own case-creation side effect)
  webhook.setHumanTakeoverLocal(phone);

  let handleMessageCalls = 0;
  let realSendCalls = 0;
  const res = await runWebhook(fonntePayload({ sender: phone, inboxid: 'h1-1' }), {
    supabase: fakeP0Supabase(),
    handoffSupabase: combined,
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { realSendCalls += 1; return { status: true }; },
  });

  // Proves the TASK 15 gate specifically suppressed (not just "some" pause —
  // the legacy-only path returns reason:'human_takeover', never 'handoff_active').
  assert.equal(res.body.reason, 'handoff_active');
  assert.equal(handleMessageCalls, 0);
  assert.equal(realSendCalls, 0);
  assert.equal(combined.getCase(caseId).latest_customer_message, 'halo', 'the inbound message must be appended to the open case');
});

// ── H2: human_active next inbound — same invariant ─────────────────────────

test('H2. human_active suppresses via the Task 15 gate even when a legacy pause also exists', async () => {
  const phone = '628111333002';
  const combined = fakeCombinedSupabase();
  const created = await createOrGetActiveCase({
    customerPhone: phone, branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  }, { supabase: combined });
  await withServer(combined, (base) => fetch(`${base}/api/handoff/cases/${created.case.id}/claim`, { method: 'POST' }), { role: 'owner' });
  assert.equal(combined.getCase(created.case.id).status, 'human_active');

  webhook.setHumanTakeoverLocal(phone);

  let handleMessageCalls = 0;
  const res = await runWebhook(fonntePayload({ sender: phone, inboxid: 'h2-1', message: 'kok belum dibales' }), {
    supabase: fakeP0Supabase(),
    handoffSupabase: combined,
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => ({ status: true }),
  });

  assert.equal(res.body.reason, 'handoff_active');
  assert.equal(handleMessageCalls, 0);
  assert.equal(combined.getCase(created.case.id).latest_customer_message, 'kok belum dibales');
});

// ── H3: resolve really reactivates ─────────────────────────────────────────

test('H3. resolve reconciles the Task15-sourced legacy pause; next customer webhook reaches AI and its send uses guardedSend', async () => {
  const phone = '628111333003';
  const combined = fakeCombinedSupabase();

  const created = await createOrGetActiveCase({
    customerPhone: phone, branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  }, { supabase: combined });
  const caseId = created.case.id;

  // Task 15's own case-creation legacy side effect: local + persisted, tagged
  // with TASK15_PAUSE_SOURCE.
  webhook.setHumanTakeoverLocal(phone);
  combined.seedWaPaused(phone, webhook.TASK15_PAUSE_SOURCE);

  await withServer(combined, (base) => fetch(`${base}/api/handoff/cases/${caseId}/claim`, { method: 'POST' }), { role: 'owner' });
  assert.equal(combined.getCase(caseId).status, 'human_active');

  // Sanity: while human_active, the webhook must still suppress.
  let preResolveCalls = 0;
  const preResolve = await runWebhook(fonntePayload({ sender: phone, inboxid: 'h3-pre' }), {
    supabase: fakeP0Supabase(),
    handoffSupabase: combined,
    handleMessage: async () => { preResolveCalls += 1; },
  });
  assert.equal(preResolve.body.reason, 'handoff_active');
  assert.equal(preResolveCalls, 0);

  // Resolve via the real route — must reconcile the Task15-sourced legacy pause.
  const resolveRes = await withServer(combined, (base) => fetch(`${base}/api/handoff/cases/${caseId}/resolve`, { method: 'POST' }), { role: 'owner' });
  assert.equal(resolveRes.status, 200);
  assert.equal(combined.getCase(caseId).status, 'resolved');
  assert.equal(webhook.isHumanTakeoverLocal(phone), false, 'resolve must clear the Task15-sourced legacy pause');
  assert.equal(combined.getWaPaused(phone), undefined, 'the persisted wa_paused row must be deleted too');

  // Next customer webhook: not suppressed, reaches "AI", and its reply flows
  // through the real P0 guardedSend down to the provider send.
  let handleMessageCalls = 0;
  let realSendCalls = 0;
  const res = await runWebhook(fonntePayload({ sender: phone, inboxid: 'h3-next' }), {
    supabase: fakeP0Supabase(),
    handoffSupabase: combined,
    handleMessage: async (msgArgs, deps) => {
      handleMessageCalls += 1;
      const sendResult = await deps.send(msgArgs.from, 'Halo lagi Kak, ada yang bisa dibantu?', { branch: 'bypass' });
      return { used: 'reddy_agent', reply: 'Halo lagi Kak, ada yang bisa dibantu?', sendResult };
    },
    realSend: async () => { realSendCalls += 1; return { status: true }; },
  });

  assert.equal(handleMessageCalls, 1, 'AI/orchestrator must run once the case is resolved');
  assert.equal(realSendCalls, 1, 'the reactivated reply must flow through the real P0 guardedSend');
  assert.notEqual(res.body.reason, 'handoff_active');
});

// ── H4: genuine manual human takeover remains respected, and resolve must
// never clear a pause it did not itself create. ───────────────────────────

test('H4a. a manual admin takeover with no Task15 case still suppresses AI', async () => {
  const phone = '628111333004';
  const combined = fakeCombinedSupabase(); // no case seeded at all

  // Simulates an admin replying manually from their own phone (self_message
  // path sets this local pause; not Task15-sourced).
  webhook.setHumanTakeoverLocal(phone);

  let handleMessageCalls = 0;
  const res = await runWebhook(fonntePayload({ sender: phone, inboxid: 'h4a-1' }), {
    supabase: fakeP0Supabase(),
    handoffSupabase: combined,
    handleMessage: async () => { handleMessageCalls += 1; },
  });

  assert.equal(res.body.reason, 'human_takeover', 'falls through to the legacy check since Task 15 has no open case');
  assert.equal(handleMessageCalls, 0);
});

test('H4b. resolving a Task15 case must NOT clear an unrelated, genuinely separate manual-admin pause', async () => {
  const phone = '628111333005';
  const combined = fakeCombinedSupabase();
  const created = await createOrGetActiveCase({
    customerPhone: phone, branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  }, { supabase: combined });
  const caseId = created.case.id;
  await withServer(combined, (base) => fetch(`${base}/api/handoff/cases/${caseId}/claim`, { method: 'POST' }), { role: 'owner' });

  // A genuinely separate pause exists for this same phone, sourced from a
  // manual admin reply — NOT Task 15.
  combined.seedWaPaused(phone, 'manual_reply_bypass');

  const resolveRes = await withServer(combined, (base) => fetch(`${base}/api/handoff/cases/${caseId}/resolve`, { method: 'POST' }), { role: 'owner' });
  assert.equal(resolveRes.status, 200);
  assert.equal(combined.getCase(caseId).status, 'resolved');
  assert.ok(combined.getWaPaused(phone), 'the unrelated manual pause must survive the resolve — source did not match');
  assert.equal(combined.getWaPaused(phone).paused_by, 'manual_reply_bypass');
});
