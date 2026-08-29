'use strict';

/**
 * Task 15 — Human Handoff Foundation
 * Covers the required test matrix (spec §21 A-H) at the webhook runtime-gate
 * level, plus direct unit coverage of the human_handoff_cases state machine
 * in server/services/humanHandoff.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPEN_STATUSES,
  TRIGGER_TYPES,
  PRIORITIES,
  detectHandoffTrigger,
  computeHandoffPriority,
  buildConversationSummary,
  createOrGetActiveCase,
  getActiveHandoffState,
  claimCase,
  resolveCase,
} = require('../services/humanHandoff');
const { sanitizeHandoffTelemetry } = require('../orchestrator/telemetry');
const { handleMessage } = require('../../api/wa/webhook');

// ── Minimal fake Supabase double for human_handoff_cases ─────────────────────
// Supports exactly the chained calls humanHandoff.js issues: select/eq/in/
// order/limit/maybeSingle for reads, insert/select/single for create,
// update/eq(/eq)/select/maybeSingle for mutations. Enforces the same
// single-active-case-per-phone uniqueness the real migration's partial unique
// index enforces, so duplicate-protection tests exercise real conflict logic.
function createFakeHandoffSupabase(initialRows = [], options = {}) {
  const rows = initialRows.map((row) => ({ ...row }));
  let seq = rows.length;
  const initialReadWaiters = [];

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
    };

    function resolve() {
      if (insertPayload) {
        const conflict = rows.find((r) => r.customer_phone === insertPayload.customer_phone
          && OPEN_STATUSES.includes(r.status));
        if (conflict) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
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
      if (options.synchronizeFirstTwoEmptyReads && rows.length === 0 && initialReadWaiters.length < 2) {
        return new Promise((resolveRead) => {
          initialReadWaiters.push(resolveRead);
          if (initialReadWaiters.length === 2) {
            for (const waiter of initialReadWaiters.splice(0)) waiter({ data: null, error: null });
          }
        });
      }
      const matches = applyFilters(rows, filters);
      return { data: matches[0] || null, error: null };
    }

    return api;
  }

  return { from, _rows: rows };
}

function throwingSupabase() {
  return {
    from() {
      throw new Error('connection reset');
    },
  };
}

// ── Service-level: trigger detection, priority, summary ──────────────────────

test('detectHandoffTrigger: explicit human_request is EXPLICIT, complaint is POLICY, unrelated intents are null', () => {
  assert.deepEqual(
    detectHandoffTrigger({ orchestrationDecision: { intent: 'human_request', route: 'human' } }),
    { triggerType: TRIGGER_TYPES.EXPLICIT, reason: 'customer_requested_human', intent: 'human_request' },
  );
  assert.deepEqual(
    detectHandoffTrigger({ orchestrationDecision: { intent: 'complaint', route: 'human' } }),
    { triggerType: TRIGGER_TYPES.POLICY, reason: 'complaint_escalation', intent: 'complaint' },
  );
  assert.equal(detectHandoffTrigger({ orchestrationDecision: { intent: 'price_inquiry', route: 'reddy_agent' } }), null);
  assert.equal(detectHandoffTrigger({ orchestrationDecision: null }), null);
});

test('computeHandoffPriority: safety language is urgent, payment dispute and complaint are high, plain request is normal', () => {
  assert.equal(computeHandoffPriority({ text: 'ada kecelakaan di outlet, tolong darurat' }), PRIORITIES.URGENT);
  assert.equal(computeHandoffPriority({ text: 'saya mau refund, uangnya belum kembali' }), PRIORITIES.HIGH);
  assert.equal(computeHandoffPriority({ intent: 'complaint', text: 'hasil cukurnya jelek' }), PRIORITIES.HIGH);
  assert.equal(computeHandoffPriority({ triggerType: TRIGGER_TYPES.EXPLICIT, text: 'mau bicara admin' }), PRIORITIES.NORMAL);
});

test('buildConversationSummary distinguishes customer-said from system-verified and never fabricates a booking fact', () => {
  const summary = buildConversationSummary({
    text: 'saya mau reschedule booking besok',
    bookingContext: { booking_readiness: 'ready_for_handoff', branch: { value: 'bypass' }, service: { name: 'Gentleman Grooming' }, date: { value: '2026-08-29' } },
  });
  assert.match(summary, /^customer says: saya mau reschedule booking besok/);
  assert.match(summary, /system verified \(booking context, not a reservation\): readiness=ready_for_handoff, branch=bypass, service=Gentleman Grooming, date=2026-08-29/);
  assert.match(summary, /unknown: any detail not listed above has not been verified/);
  assert.doesNotMatch(summary, /confirmed|reserved|locked/i);
});

// ── Service-level: state machine + duplicate protection ──────────────────────

test('createOrGetActiveCase: creates a waiting_human case, and a second attempt for the same phone returns the existing case (no duplicate row)', async () => {
  const supabase = createFakeHandoffSupabase();
  const first = await createOrGetActiveCase({
    customerPhone: '628111000001', branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  }, { supabase });
  assert.equal(first.status, 'created');
  assert.equal(first.case.status, 'waiting_human');

  const second = await createOrGetActiveCase({
    customerPhone: '628111000001', branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'halo?',
  }, { supabase });
  assert.equal(second.status, 'existing');
  assert.equal(second.case.id, first.case.id);
  assert.equal(supabase._rows.filter((r) => r.customer_phone === '628111000001').length, 1);
});

test('createOrGetActiveCase: concurrent duplicate race converges through the DB unique violation to one active case', async () => {
  const supabase = createFakeHandoffSupabase([], { synchronizeFirstTwoEmptyReads: true });
  const params = {
    customerPhone: '628111000009', branch: 'bypass', triggerType: TRIGGER_TYPES.EXPLICIT,
    reason: 'customer_requested_human', intent: 'human_request', priority: PRIORITIES.NORMAL,
    latestCustomerMessage: 'mau bicara admin',
  };

  const results = await Promise.all([
    createOrGetActiveCase(params, { supabase }),
    createOrGetActiveCase({ ...params, latestCustomerMessage: 'admin?' }, { supabase }),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ['created', 'existing']);
  assert.equal(results[0].case.id, results[1].case.id);
  assert.equal(supabase._rows.filter((row) => row.customer_phone === params.customerPhone).length, 1);
});

test('createOrGetActiveCase: storage unavailable and a genuine error are reported distinctly', async () => {
  const unavailable = await createOrGetActiveCase({ customerPhone: '628111000002', triggerType: TRIGGER_TYPES.EXPLICIT }, { supabase: null });
  assert.equal(unavailable.status, 'unavailable');

  const erroring = await createOrGetActiveCase({ customerPhone: '628111000002', triggerType: TRIGGER_TYPES.EXPLICIT }, { supabase: throwingSupabase() });
  assert.equal(erroring.status, 'error');
});

test('getActiveHandoffState: none when no case, correct status when open, fail-safe lookup_failed on a real error, none when unconfigured', async () => {
  const supabase = createFakeHandoffSupabase([
    { id: 'case-x', customer_phone: '628111000003', status: 'waiting_human', branch: 'bypass', priority: 'normal' },
  ]);
  assert.equal((await getActiveHandoffState('628111000099', { supabase })).status, 'none');
  assert.equal((await getActiveHandoffState('628111000003', { supabase })).status, 'waiting_human');
  assert.equal((await getActiveHandoffState('628111000003', { supabase: throwingSupabase() })).status, 'lookup_failed');
  assert.equal((await getActiveHandoffState('628111000003', { supabase: null })).status, 'none');
});

test('claimCase then resolveCase walks WAITING_HUMAN -> HUMAN_ACTIVE -> RESOLVED, and a resolved case cannot be reclaimed', async () => {
  const supabase = createFakeHandoffSupabase([
    { id: 'case-y', customer_phone: '628111000004', status: 'waiting_human', branch: 'bypass', priority: 'normal' },
  ]);
  const claimed = await claimCase('case-y', 'staff-1', { supabase });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.case.status, 'human_active');
  assert.equal(claimed.case.assigned_to, 'staff-1');

  const resolved = await resolveCase('case-y', { supabase });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.case.status, 'resolved');
  assert.ok(resolved.case.resolved_at);

  const reclaim = await claimCase('case-y', 'staff-2', { supabase });
  assert.equal(reclaim.status, 'not_claimable');
});

test('sanitizeHandoffTelemetry never carries conversation text and falls back to safe defaults for unknown values', () => {
  const safe = sanitizeHandoffTelemetry({
    event_type: 'handoff_case_created', trigger_type: 'explicit_customer_request', reason: 'customer_requested_human',
    priority: 'normal', branch: 'bypass', status_transition: 'none_to_waiting_human',
    latest_customer_message: 'this must never appear', conversation_summary: 'nor this',
  });
  assert.equal(safe.event_type, 'handoff_case_created');
  assert.equal(safe.branch, 'bypass');
  assert.equal('latest_customer_message' in safe, false);
  assert.equal('conversation_summary' in safe, false);
  assert.equal(sanitizeHandoffTelemetry({ event_type: 'not_a_real_event' }).event_type, 'unknown');
});

// ── Required test matrix (spec §21) at the webhook runtime-gate level ────────

test('A. explicit human request: case created, one acknowledgement, used=human_handoff', async () => {
  let createCalls = 0;
  let sendCalls = 0;
  const mocks = {
    orchestrate: async () => ({ route: 'human', intent: 'human_request', action: 'request_human', fallback_used: false }),
    getHandoffState: async () => ({ status: 'none', case: null }),
    createHandoffCase: async (params) => {
      createCalls++;
      assert.equal(params.triggerType, TRIGGER_TYPES.EXPLICIT);
      return { status: 'created', case: { id: 'case-a', status: 'waiting_human', branch: params.branch, priority: params.priority }, created: true };
    },
    setHumanTakeover: () => {},
    persistHumanHandoff: async () => {},
    send: async () => { sendCalls++; return { status: 'sent' }; },
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111000', text: 'Saya mau bicara sama admin.', branchFromPayload: 'bypass' }, mocks);

  assert.equal(createCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(result.used, 'human_handoff');
  assert.ok(result.reply);
});

test('B. HUMAN_ACTIVE suppresses Reddy and OpenAI entirely; the inbound message is still persisted', async () => {
  let reddyCalls = 0;
  let openaiCalls = 0;
  let sendCalls = 0;
  let orchestrateCalls = 0;
  let appendCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'human_active', case: { id: 'case-b', branch: 'bypass', priority: 'normal' } }),
    appendHandoffMessage: async () => { appendCalls++; return true; },
    orchestrate: async () => { orchestrateCalls++; return {}; },
    executeReddy: async () => { reddyCalls++; },
    generateReddy: async () => { openaiCalls++; return 'must not be sent'; },
    send: async () => { sendCalls++; return { status: 'sent' }; },
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111001', text: 'Halo, ini gimana ya?' }, mocks);

  assert.equal(reddyCalls, 0);
  assert.equal(openaiCalls, 0);
  assert.equal(sendCalls, 0);
  assert.equal(orchestrateCalls, 0);
  assert.equal(appendCalls, 1);
  assert.equal(result.used, 'human_active_suppressed');
  assert.equal(result.reply, null);
});

test('C. WAITING_HUMAN: 3 further messages create no additional case (duplicate protection)', async () => {
  let createCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'waiting_human', case: { id: 'case-c', branch: 'bypass', priority: 'normal' } }),
    createHandoffCase: async () => { createCalls++; return { status: 'created', case: {}, created: true }; },
    appendHandoffMessage: async () => true,
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  for (const text of ['masih nunggu ya', 'halo?', 'kok belum dibales']) {
    // eslint-disable-next-line no-await-in-loop
    await handleMessage({ from: '628111111002', text }, mocks);
  }

  assert.equal(createCalls, 0);
});

test('D. an ordinary factual question stays AI_ACTIVE — no handoff case, Reddy answers normally', async () => {
  let createCalls = 0;
  let reddyCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'none', case: null }),
    orchestrate: async () => ({
      route: 'reddy_agent', agent: 'reddy_agent', intent: 'price_inquiry', action: 'answer_price',
      response_strategy: 'answer_with_knowledge_fact', required_sources: [], allowed_claims: [], prohibited_claims: [],
    }),
    createHandoffCase: async () => { createCalls++; return { status: 'created', case: {}, created: true }; },
    executeReddy: async () => { reddyCalls++; return { reply: 'Harga Gentleman Grooming mulai dari Rp X.', sendResult: { status: 'sent' } }; },
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111003', text: 'Halo, mau tanya-tanya soal RedBox ya.' }, mocks);

  assert.equal(createCalls, 0);
  assert.equal(reddyCalls, 1);
  assert.notEqual(result.used, 'human_handoff');
});

test('D2. the literal spec example ("Haircut harganya berapa?") never opens a handoff case', async () => {
  let createCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'none', case: null }),
    createHandoffCase: async () => { createCalls++; return { status: 'created', case: {}, created: true }; },
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };
  const result = await handleMessage({ from: '628111111008', text: 'Haircut harganya berapa?' }, mocks);
  assert.equal(createCalls, 0);
  assert.notEqual(result.used, 'human_handoff');
});

test('E. booking exception with explicit human request escalates and never lets Reddy touch the booking', async () => {
  let reddyCalls = 0;
  let createCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'none', case: null }),
    orchestrate: async () => ({ route: 'human', intent: 'human_request', action: 'request_human', fallback_used: false }),
    createHandoffCase: async (params) => {
      createCalls++;
      return { status: 'created', case: { id: 'case-e', status: 'waiting_human', branch: params.branch, priority: params.priority }, created: true };
    },
    executeReddy: async () => { reddyCalls++; },
    setHumanTakeover: () => {},
    persistHumanHandoff: async () => {},
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111004', text: 'Booking saya bermasalah, saya mau bicara admin.', branchFromPayload: 'bypass' }, mocks);

  assert.equal(createCalls, 1);
  assert.equal(reddyCalls, 0);
  assert.equal(result.used, 'human_handoff');
});

test('F. after resolution, the very next customer message reaches AI_ACTIVE again with no injected bot message', async () => {
  let reddyCalls = 0;
  const suppressedResult = await handleMessage({ from: '628111111005', text: 'masih nunggu' }, {
    getHandoffState: async () => ({ status: 'human_active', case: { id: 'case-f', branch: 'bypass', priority: 'normal' } }),
    appendHandoffMessage: async () => true,
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  });
  assert.equal(suppressedResult.used, 'human_active_suppressed');
  assert.equal(suppressedResult.reply, null); // RESOLVED never auto-injects a bot message

  const reactivatedResult = await handleMessage({ from: '628111111005', text: 'Halo, mau tanya-tanya soal RedBox ya.' }, {
    getHandoffState: async () => ({ status: 'none', case: null }), // case now resolved
    orchestrate: async () => ({
      route: 'reddy_agent', agent: 'reddy_agent', intent: 'price_inquiry', action: 'answer_price',
      response_strategy: 'answer_with_knowledge_fact', required_sources: [], allowed_claims: [], prohibited_claims: [],
    }),
    executeReddy: async () => { reddyCalls++; return { reply: 'Harga mulai dari Rp X.', sendResult: { status: 'sent' } }; },
    resolveKnowledge: () => ({ status: 'no_verified_fact', facts: [] }),
    send: async () => ({ status: 'sent' }),
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  });
  assert.equal(reddyCalls, 1);
  assert.notEqual(reactivatedResult.used, 'human_handoff');
});

test('G. case creation storage failure never claims the request reached admin', async () => {
  let sendCalls = 0;
  let sentReply = null;
  const mocks = {
    getHandoffState: async () => ({ status: 'none', case: null }),
    orchestrate: async () => ({ route: 'human', intent: 'human_request', action: 'request_human', fallback_used: false }),
    createHandoffCase: async () => ({ status: 'error', case: null, created: false, error: new Error('db unreachable') }),
    setHumanTakeover: () => {},
    persistHumanHandoff: async () => {},
    send: async (_to, reply) => { sendCalls++; sentReply = reply; return { status: 'sent' }; },
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111006', text: 'saya mau bicara admin', branchFromPayload: 'bypass' }, mocks);

  assert.equal(sendCalls, 1);
  assert.doesNotMatch(sentReply, /sudah aku teruskan/i);
  assert.notEqual(result.used, 'human_handoff');
  assert.equal(result.used, 'human_handoff_creation_failed');
});

test('G2. case storage genuinely unavailable never claims the request reached admin (Correction Round 1, Correction 4)', async () => {
  let sendCalls = 0;
  let sentReply = null;
  let setTakeoverCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'none', case: null }),
    orchestrate: async () => ({ route: 'human', intent: 'human_request', action: 'request_human', fallback_used: false }),
    createHandoffCase: async () => ({ status: 'unavailable', case: null, created: false }),
    setHumanTakeover: () => { setTakeoverCalls++; },
    persistHumanHandoff: async () => {},
    send: async (_to, reply) => { sendCalls++; sentReply = reply; return { status: 'sent' }; },
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111009', text: 'saya mau bicara admin', branchFromPayload: 'bypass' }, mocks);

  assert.equal(sendCalls, 1);
  assert.doesNotMatch(sentReply, /sudah aku teruskan/i, 'unavailable storage must never claim the message reached admin');
  assert.match(sentReply, /belum berhasil meneruskan/i);
  assert.equal(result.used, 'human_handoff_unavailable');
  // Still pauses AI via the legacy mechanism as a safety net, even though it
  // cannot honestly promise admin was notified.
  assert.equal(setTakeoverCalls, 1);
});

test('H. handoff state lookup failure fails safe — bot never speaks over a possibly-active human conversation', async () => {
  let reddyCalls = 0;
  let sendCalls = 0;
  let orchestrateCalls = 0;
  const mocks = {
    getHandoffState: async () => ({ status: 'lookup_failed', case: null }),
    orchestrate: async () => { orchestrateCalls++; return {}; },
    executeReddy: async () => { reddyCalls++; },
    send: async () => { sendCalls++; return { status: 'sent' }; },
    logTelemetry: () => {},
    logHandoffTelemetry: () => {},
  };

  const result = await handleMessage({ from: '628111111007', text: 'halo' }, mocks);

  assert.equal(reddyCalls, 0);
  assert.equal(orchestrateCalls, 0);
  assert.equal(sendCalls, 0);
  assert.equal(result.used, 'human_active_suppressed');
});
