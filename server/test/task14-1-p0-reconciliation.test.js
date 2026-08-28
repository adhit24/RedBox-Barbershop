'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const webhook = require('../../api/wa/webhook');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
const { isReddyEnabled } = require('../services/waInboundGuard');

function fakeSupabase() {
  const state = {
    inbound: [],
    claims: [],
    reservationCalls: 0,
    completionCalls: 0,
    nextId: 1,
  };

  function inboundBuilder() {
    const query = { action: 'select', value: null, filters: [] };
    const builder = {
      insert(value) { query.action = 'insert'; query.value = value; return builder; },
      update(value) { query.action = 'update'; query.value = value; return builder; },
      select() { return builder; },
      eq(field, value) { query.filters.push([field, value]); return builder; },
      single() { return Promise.resolve(execute(true)); },
      maybeSingle() { return Promise.resolve(execute(false)); },
      then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };

    function matches(row) {
      return query.filters.every(([field, value]) => row[field] === value);
    }

    function execute(requireRow) {
      if (query.action === 'insert') {
        const duplicate = state.inbound.find((row) => row.provider === query.value.provider
          && row.provider_device_hash === query.value.provider_device_hash
          && row.provider_message_id === query.value.provider_message_id);
        if (duplicate) return { data: null, error: { code: '23505' } };
        const row = { id: `in-${state.nextId++}`, outbound_attempted: false, ...query.value };
        state.inbound.push(row);
        return { data: row, error: null };
      }
      if (query.action === 'update') {
        const row = state.inbound.find(matches);
        if (row) Object.assign(row, query.value);
        return { data: row || null, error: null };
      }
      const row = state.inbound.find(matches) || null;
      return { data: row, error: requireRow && !row ? { code: 'PGRST116' } : null };
    }

    return builder;
  }

  return {
    state,
    from(table) {
      assert.equal(table, 'wa_inbound_events');
      return inboundBuilder();
    },
    async rpc(name, args) {
      if (name === 'reserve_wa_automated_send') {
        state.reservationCalls += 1;
        const inbound = state.inbound.find((row) => row.id === args.p_inbound_event_id);
        if (!inbound || inbound.outbound_attempted) {
          return { data: [{ decision: 'already_attempted', claim_id: null }], error: null };
        }
        inbound.outbound_attempted = true;
        const claim = { id: `out-${state.nextId++}`, inbound_event_id: inbound.id };
        state.claims.push(claim);
        return { data: [{ decision: 'allowed', claim_id: claim.id }], error: null };
      }
      if (name === 'complete_wa_automated_send') {
        state.completionCalls += 1;
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
}

function payload(overrides = {}) {
  return {
    device: '0818202569',
    sender: '628123456789',
    message: 'Halo Reddy',
    inboxid: 'reconcile-1',
    ...overrides,
  };
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

async function runWebhook(body, dependencies) {
  const res = responseRecorder();
  await webhook({ method: 'POST', body, query: {} }, res, dependencies);
  return res;
}

function reddyThroughProductionBoundary({ reply, intent = 'general_inquiry', loadBarbers, getSchedule, counters }) {
  return async ({ from, text, branchFromPayload }, { send }) => executeReddyAgent({
    from,
    text,
    branch: branchFromPayload || 'bypass',
    orchestrationDecision: {
      intent,
      route: intent === 'points_inquiry' ? 'crm_agent' : 'reddy_agent',
      response_strategy: 'answer_directly',
    },
  }, {
    callOpenAI: async () => {
      counters.openAI += 1;
      return reply;
    },
    sendWA: send,
    loadBarbers: loadBarbers || (async () => ({ status: 'not_requested', barbers: [] })),
    getSchedule: getSchedule || (async () => {
      counters.schedule += 1;
      return { status: 'unknown' };
    }),
    supabase: null,
    logBookingTelemetry: () => {},
  });
}

test('R1: semantic reply passes Task 14.1 guards before P0 reservation and provider send', async () => {
  const supabase = fakeSupabase();
  const counters = { openAI: 0, schedule: 0, provider: 0 };
  const received = [];
  const res = await runWebhook(payload(), {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: reddyThroughProductionBoundary({ reply: 'Halo Kak, ada yang bisa Reddy bantu?', counters }),
    realSend: async (_to, message) => {
      counters.provider += 1;
      received.push(message);
      return { status: true };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(counters.openAI, 1);
  assert.equal(supabase.state.reservationCalls, 1);
  assert.equal(counters.provider, 1);
  assert.deepEqual(received, ['Halo Kak, ada yang bisa Reddy bantu?']);
});

test('R2: the same inbound event x5 runs Task 14.1 semantics and P0 outbound at most once', async () => {
  const supabase = fakeSupabase();
  const counters = { openAI: 0, schedule: 0, provider: 0, semantic: 0 };
  const handleMessage = async (...args) => {
    counters.semantic += 1;
    return reddyThroughProductionBoundary({ reply: 'Balasan unik untuk event ini.', counters })(...args);
  };
  const dependencies = {
    supabase,
    isReddyEnabled: () => true,
    handleMessage,
    realSend: async () => { counters.provider += 1; return { status: true }; },
  };

  const results = await Promise.all(Array.from({ length: 5 }, () => runWebhook(payload({ inboxid: 'same-event' }), dependencies)));

  assert.equal(results.filter((res) => res.body?.reason === 'duplicate').length, 4);
  assert.equal(counters.semantic, 1);
  assert.equal(counters.openAI, 1);
  assert.equal(supabase.state.reservationCalls, 1);
  assert.equal(counters.provider, 1);
});

test('R3: kill switch unset or false stops semantics, schedule lookup, reservation, and provider send', async () => {
  for (const env of [{}, { REDDY_ENABLED: 'false' }]) {
    const supabase = fakeSupabase();
    const counters = { semantic: 0, schedule: 0, provider: 0 };
    const res = await runWebhook(payload({ inboxid: `disabled-${String(env.REDDY_ENABLED)}` }), {
      supabase,
      isReddyEnabled: () => isReddyEnabled(env),
      handleMessage: async () => { counters.semantic += 1; },
      realSend: async () => { counters.provider += 1; return { status: true }; },
    });

    assert.equal(res.body?.reddy_enabled, false);
    assert.equal(counters.semantic, 0);
    assert.equal(counters.schedule, 0);
    assert.equal(supabase.state.reservationCalls, 0);
    assert.equal(counters.provider, 0);
  }
});

test('R4: points reply has unsolicited booking CTA removed before P0 reservation/provider send', async () => {
  const supabase = fakeSupabase();
  const counters = { openAI: 0, schedule: 0, provider: 0 };
  const received = [];
  await runWebhook(payload({ message: 'Poin saya berapa?', inboxid: 'points-cta' }), {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: reddyThroughProductionBoundary({
      intent: 'points_inquiry',
      reply: 'Saldo poin Kakak 50 poin. Yuk booking lagi.',
      counters,
    }),
    realSend: async (_to, message) => {
      counters.provider += 1;
      received.push(message);
      return { status: true };
    },
  });

  assert.equal(supabase.state.reservationCalls, 1);
  assert.equal(counters.provider, 1);
  assert.deepEqual(received, ['Saldo poin Kakak 50 poin.']);
  assert.doesNotMatch(received[0], /booking|redboxbarbershop\.com/i);
});

test('R5: unsupported live barber-presence claim is sanitized before P0 reservation/provider send', async () => {
  const supabase = fakeSupabase();
  const counters = { openAI: 0, schedule: 0, provider: 0 };
  const received = [];
  await runWebhook(payload({ message: 'Mas Opan masuk hari ini?', inboxid: 'barber-live-fact' }), {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: reddyThroughProductionBoundary({
      intent: 'barber_inquiry',
      reply: 'Mas Opan sudah hadir sekarang.',
      counters,
      loadBarbers: async () => ({
        status: 'verified',
        barbers: [{ id: 'opan', name: 'Opan', branch: 'samadikun', is_active: true }],
      }),
    }),
    realSend: async (_to, message) => {
      counters.provider += 1;
      received.push(message);
      return { status: true };
    },
  });

  assert.equal(supabase.state.reservationCalls, 1);
  assert.equal(counters.provider, 1);
  assert.equal(received.length, 1);
  assert.doesNotMatch(received[0], /Opan sudah hadir sekarang/i);
  assert.match(received[0], /belum bisa memastikan|data yang terverifikasi/i);
});
