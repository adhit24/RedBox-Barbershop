'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createClassifier } = require('../orchestrator/classifier');
const { classifyDeterministically } = require('../orchestrator/routingPolicy');
const { classifyWithOpenAI } = require('../orchestrator/openaiClient');
const { ROUTES } = require('../orchestrator/contract');
const { sanitizeTelemetry } = require('../orchestrator/telemetry');
const {
  getBarberPopularity,
  resolvePopularityPeriod,
} = require('../services/barberPopularityService');
const { formatBarberPopularityReply } = require('../agents/reddy/barberPopularityReply');
const { handleMessage } = require('../../api/wa/webhook');

const NOW = new Date('2026-08-27T05:00:00.000Z');

function createReadOnlySupabase({ bookings = [], barbers = [], errors = {} } = {}) {
  const rowsByTable = { bookings, barbers };
  const calls = [];

  return {
    calls,
    from(table) {
      calls.push({ table, filters: [] });
      const call = calls.at(-1);
      const query = {
        select(columns) { call.select = columns; return query; },
        eq(column, value) {
          call.filters.push({ op: 'eq', column, value });
          return query;
        },
        neq(column, value) {
          call.filters.push({ op: 'neq', column, value });
          return query;
        },
        gte(column, value) {
          call.filters.push({ op: 'gte', column, value });
          return query;
        },
        lte(column, value) {
          call.filters.push({ op: 'lte', column, value });
          return query;
        },
        not(column, operator, value) {
          call.filters.push({ op: 'not', column, operator, value });
          return query;
        },
        in(column, values) {
          call.filters.push({ op: 'in', column, values });
          return query;
        },
        execute() {
          if (errors[table]) return { data: null, error: { message: errors[table] } };
          let data = structuredClone(rowsByTable[table] || []);
          for (const filter of call.filters) {
            if (filter.op === 'eq') data = data.filter(row => row[filter.column] === filter.value);
            if (filter.op === 'neq') data = data.filter(row => row[filter.column] != null && row[filter.column] !== filter.value);
            if (filter.op === 'gte') data = data.filter(row => row[filter.column] >= filter.value);
            if (filter.op === 'lte') data = data.filter(row => row[filter.column] <= filter.value);
            if (filter.op === 'not' && filter.operator === 'is' && filter.value === null) {
              data = data.filter(row => row[filter.column] != null);
            }
            if (filter.op === 'in') data = data.filter(row => filter.values.includes(row[filter.column]));
          }
          return { data, error: null };
        },
        then(resolve, reject) { return Promise.resolve(query.execute()).then(resolve, reject); },
      };
      return query;
    },
  };
}

function popularityFixture() {
  return createReadOnlySupabase({
    bookings: [
      { barber_id: 'csb-ubay', location: 'csb', date: '2026-08-10', status: 'confirmed' },
      { barber_id: 'csb-ubay', location: 'csb', date: '2026-08-11', status: 'done' },
      { barber_id: 'csb-sarif', location: 'csb', date: '2026-08-12', status: 'cancelled' },
      { barber_id: 'csb-sarif', location: 'csb', date: '2026-08-20', status: 'confirmed' },
      { barber_id: 'csb-sarif', location: 'csb', date: '2026-08-28', status: 'confirmed' },
      { barber_id: 'sumber-aziz', location: 'csb', date: '2026-08-13', status: 'confirmed' },
      { barber_id: 'csb-ega', location: 'csb', date: '2026-08-14', status: 'confirmed' },
    ],
    barbers: [
      { id: 'csb-ubay', name: 'Ubay', branch: 'csb', is_active: true },
      { id: 'csb-sarif', name: 'Sarif', branch: 'csb', is_active: true },
      { id: 'sumber-aziz', name: 'Aziz', branch: 'sumber', is_active: true },
      { id: 'csb-ega', name: 'Ega', branch: 'csb', is_active: false },
    ],
  });
}

test('P1: production phrase is barber popularity, never booking_request', async () => {
  const result = await createClassifier({
    modelClassifier: async () => { throw new Error('narrow high-confidence route should not need model'); },
  })('klo di csb kapster yang paling sering di book siapa ya?');

  assert.equal(result.intent, 'barber_popularity_inquiry');
  assert.equal(result.action, 'read_barber_popularity');
  assert.notEqual(result.intent, 'booking_request');
});

test('P1 variants: bounded popularity language routes without a generic paling-sering rule', () => {
  for (const message of [
    'barber paling populer di CSB?',
    'kapster yang paling banyak dipilih siapa?',
    'barber favorit customer di CSB siapa?',
    'siapa yang bookingnya paling banyak bulan ini?',
  ]) {
    assert.equal(classifyDeterministically(message)?.intent, 'barber_popularity_inquiry', message);
  }
  assert.equal(classifyDeterministically('layanan yang paling sering ditanya apa?'), null);
  assert.equal(classifyDeterministically('aku paling sering booking Ubay'), null);
});

test('P2-P4: booking request, availability, and roster semantics remain distinct', async () => {
  const expected = [
    ['aku mau booking Ubay', 'booking_request'],
    ['Ubay available jam 7?', 'booking_availability_inquiry'],
    ['siapa kapster di CSB?', 'barber_inquiry'],
  ];

  for (const [message, intent] of expected) {
    assert.equal(classifyDeterministically(message), null);
    const decision = await createClassifier({ modelClassifier: async () => ({ intent, confidence: 0.99 }) })(message);
    assert.equal(decision.intent, intent);
  }
});

test('model intent guide distinguishes booking popularity from booking and served volume', async () => {
  let payload;
  const client = { chat: { completions: { create: async (input) => {
    payload = input;
    return { choices: [{ message: { content: JSON.stringify({ intent: 'barber_popularity_inquiry', confidence: 0.99 }) } }] };
  } } } };

  await classifyWithOpenAI('barber paling populer di CSB?', { client });
  const guide = payload.messages[0].content;
  assert.match(guide, /barber_popularity_inquiry/);
  assert.match(guide, /aggregate/i);
  assert.match(guide, /not.*booking_request/i);
  assert.match(guide, /melayani/i);
  assert.ok(Object.hasOwn(ROUTES, 'barber_popularity_inquiry'));
});

test('period resolver supports default, rolling 30 days, current month, and Monday-based current week', () => {
  assert.deepEqual(resolvePopularityPeriod('siapa paling populer?', NOW), {
    type: 'rolling_30_days', start_date: '2026-07-28', end_date: '2026-08-27', fallback_used: false,
  });
  assert.equal(resolvePopularityPeriod('30 hari terakhir', NOW).type, 'rolling_30_days');
  assert.deepEqual(resolvePopularityPeriod('bulan ini', NOW), {
    type: 'current_month', start_date: '2026-08-01', end_date: '2026-08-27', fallback_used: false,
  });
  assert.deepEqual(resolvePopularityPeriod('minggu ini', NOW), {
    type: 'current_week', start_date: '2026-08-24', end_date: '2026-08-27', fallback_used: false,
  });
  assert.deepEqual(resolvePopularityPeriod('tahun ini', NOW), {
    type: 'rolling_30_days', start_date: '2026-07-28', end_date: '2026-08-27', fallback_used: true,
  });
});

test('P5-P8: aggregate excludes cancelled, future, cross-branch, and inactive barber rows', async () => {
  const supabase = popularityFixture();
  const result = await getBarberPopularity({
    supabase, branch: 'csb', message: 'paling sering dibooking siapa?', now: NOW,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.metric, 'booking_selection_count');
  assert.equal(result.eligible_booking_count, 3);
  assert.deepEqual(result.leaders.map(({ barber_name, booking_count }) => ({ barber_name, booking_count })), [
    { barber_name: 'Ubay', booking_count: 2 },
    { barber_name: 'Sarif', booking_count: 1 },
  ]);
  assert.equal(result.data_quality.cross_branch_rows_excluded, 1);
  assert.equal(result.data_quality.inactive_barber_rows_excluded, 1);
  assert.doesNotMatch(JSON.stringify(result), /barber_id|csb-ubay|sumber-aziz/);
  assert.equal(supabase.calls.filter(call => call.table === 'bookings').length, 1);
  assert.equal(supabase.calls.filter(call => call.table === 'barbers').length, 1);
  const bookingCall = supabase.calls.find(call => call.table === 'bookings');
  assert.deepEqual(bookingCall.filters, [
    { op: 'eq', column: 'location', value: 'csb' },
    { op: 'gte', column: 'date', value: '2026-07-28' },
    { op: 'lte', column: 'date', value: '2026-08-27' },
    { op: 'not', column: 'barber_id', operator: 'is', value: null },
    { op: 'neq', column: 'status', value: 'cancelled' },
  ]);
});

test('trusted read is bounded to public bookings plus canonical barbers, never schedules or Customer360', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/barberPopularityService.js'), 'utf8');
  assert.match(source, /\.from\('bookings'\)/);
  assert.match(source, /\.from\('barbers'\)/);
  assert.doesNotMatch(source, /\.from\('schedules'\)|customer360|customer_history|customer_preferences/i);
});

test('P9: equal counts return shared rank with stable name ordering', async () => {
  const supabase = createReadOnlySupabase({
    bookings: [
      { barber_id: 'z', location: 'csb', date: '2026-08-20', status: 'done' },
      { barber_id: 'a', location: 'csb', date: '2026-08-20', status: 'done' },
    ],
    barbers: [
      { id: 'z', name: 'Zulu', branch: 'csb', is_active: true },
      { id: 'a', name: 'Alpha', branch: 'csb', is_active: true },
    ],
  });

  const result = await getBarberPopularity({ supabase, branch: 'csb', message: '', now: NOW });
  assert.deepEqual(result.leaders.map(({ barber_name, rank }) => ({ barber_name, rank })), [
    { barber_name: 'Alpha', rank: 1 },
    { barber_name: 'Zulu', rank: 1 },
  ]);
});

test('P10: no eligible trusted rows returns safe no-data without fabricated roster', async () => {
  const result = await getBarberPopularity({
    supabase: createReadOnlySupabase(), branch: 'csb', message: '', now: NOW,
  });
  assert.equal(result.status, 'no_data');
  assert.deepEqual(result.leaders, []);
  assert.equal(result.fallback_reason, 'insufficient_booking_data');
  assert.match(formatBarberPopularityReply(result), /belum punya data booking yang cukup/i);
});

test('P10 failure path: database errors return a safe unavailable result without leaking internals', async () => {
  const result = await getBarberPopularity({
    supabase: createReadOnlySupabase({ errors: { bookings: 'password secret raw database error' } }),
    branch: 'csb', message: '', now: NOW,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.fallback_reason, 'bookings_query_failed');
  assert.doesNotMatch(JSON.stringify(result), /password|secret|raw database error/i);
  assert.match(formatBarberPopularityReply(result), /belum punya data booking yang cukup/i);
});

test('P11: actual webhook sends trusted popularity answer once with no booking CTA', async () => {
  const sent = [];
  const telemetry = [];
  const aggregate = {
    status: 'success', metric: 'booking_selection_count', branch: 'csb',
    period: { type: 'rolling_30_days', start_date: '2026-07-28', end_date: '2026-08-27' },
    leaders: [{ barber_name: 'Ubay', booking_count: 9, rank: 1 }],
    eligible_booking_count: 9,
    data_quality: { cross_branch_rows_excluded: 1, inactive_barber_rows_excluded: 0 },
  };

  const result = await handleMessage({
    from: '6281111110000', name: 'Kak', text: 'klo di csb kapster yang paling sering di book siapa ya?',
    branchFromPayload: 'csb',
  }, {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      intent: 'barber_popularity_inquiry', route: 'reddy_agent', agent: 'reddy_agent',
      action: 'read_barber_popularity', confidence: 1, model_tier: 'none',
    }),
    readBarberPopularity: async () => aggregate,
    send: async (_to, reply) => { sent.push(reply); return { ok: true }; },
    logTelemetry: event => { telemetry.push(event); return event; },
    executeReddy: async () => { throw new Error('popularity fact path must stay deterministic'); },
  });

  assert.equal(result.used, 'barber_popularity_trusted_read');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /CSB 30 hari terakhir/i);
  assert.match(sent[0], /Ubay/);
  assert.doesNotMatch(sent[0], /booking\.html|booking sekarang|reservasi/i);
  assert.doesNotMatch(sent[0], /terbaik|paling ahli|paling tersedia|best barber/i);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].metric, 'booking_selection_count');
  assert.equal(telemetry[0].data_quality_exclusion_count, 1);
});

test('P12: served-volume wording is not silently converted into booking popularity', async () => {
  const decision = classifyDeterministically('yang paling sering melayani customer siapa?');
  assert.equal(decision.intent, 'barber_popularity_inquiry');

  const supabase = createReadOnlySupabase();
  const result = await getBarberPopularity({
    supabase, branch: 'csb', message: 'yang paling sering melayani customer siapa?', now: NOW,
  });
  assert.equal(result.status, 'unsupported_metric');
  assert.equal(result.metric, 'served_customer_count');
  assert.equal(supabase.calls.length, 0);
  assert.match(formatBarberPopularityReply(result), /jumlah booking yang dipilih/i);
  assert.doesNotMatch(formatBarberPopularityReply(result), /yang paling sering dipilih adalah/i);
});

test('telemetry allows only non-PII popularity reliability fields', () => {
  const safe = sanitizeTelemetry({
    intent: 'barber_popularity_inquiry', route: 'reddy_agent', action: 'read_barber_popularity',
    branch: 'csb', metric: 'booking_selection_count', period_type: 'rolling_30_days',
    result_count: 2, data_quality_exclusion_count: 3, fallback_used: false,
    phone: '6281111110000', message: 'raw customer message', booking_rows: [{ phone: 'secret' }],
  });
  assert.equal(safe.metric, 'booking_selection_count');
  assert.equal(safe.period_type, 'rolling_30_days');
  assert.equal(safe.result_count, 2);
  assert.equal(safe.data_quality_exclusion_count, 3);
  assert.equal(Object.hasOwn(safe, 'phone'), false);
  assert.equal(Object.hasOwn(safe, 'message'), false);
  assert.equal(Object.hasOwn(safe, 'booking_rows'), false);
});
