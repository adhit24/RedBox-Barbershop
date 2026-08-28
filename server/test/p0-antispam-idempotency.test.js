'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isReddyEnabled,
  hashValue,
  classifyInboundEvent,
  resolveProviderMessageId,
  resolveProviderDeviceHash,
  claimInboundEvent,
  admitInboundEvent,
} = require('../services/waInboundGuard');
const {
  createGuardedSend,
  reserveAutomatedSend,
  RATE_LIMIT_MAX_SENDS,
} = require('../services/waOutboundGuard');
const webhook = require('../../api/wa/webhook');

function fakeSupabase({ failInboundClaim = false, failReservation = false } = {}) {
  const state = { inbound: [], claims: [], nowMs: 0, next: 1 };

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
        if (failInboundClaim) return { data: null, error: { code: 'DB_DOWN' } };
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

  const client = {
    state,
    from(table) {
      if (table !== 'wa_inbound_events') throw new Error(`Unexpected table: ${table}`);
      return inboundBuilder();
    },
    rpc(name, args) {
      if (name === 'reserve_wa_automated_send') {
        if (failReservation) return Promise.resolve({ data: null, error: { code: 'DB_DOWN' } });
        const inbound = state.inbound.find((row) => row.id === args.p_inbound_event_id);
        if (!inbound || inbound.outbound_attempted) {
          return Promise.resolve({ data: [{ decision: 'already_attempted', claim_id: null }], error: null });
        }
        // Synchronous mutation models the database advisory-lock transaction.
        inbound.outbound_attempted = true;
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
        const claim = {
          id: `out-${state.next++}`,
          inbound_event_id: inbound.id,
          destination_hash: args.p_destination_hash,
          content_hash: args.p_content_hash,
          reserved_at: now,
          reservation_state: 'reserved',
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
  return client;
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

async function claimPayload(supabase, payload) {
  const admission = await admitInboundEvent(supabase, payload);
  assert.equal(admission.status, 'claimed');
  return admission.row.id;
}

test('classifier is the single provenance authority for customer/status/self/unsupported', () => {
  assert.equal(classifyInboundEvent(fonntePayload()), 'customer_message');
  assert.equal(classifyInboundEvent({ id: 'x', status: 'sent', stateid: 's' }), 'status_callback');
  assert.equal(classifyInboundEvent(fonntePayload({ isFromMe: true })), 'self_message');
  assert.equal(classifyInboundEvent({}), 'unsupported');
});

test('provider identifiers are bounded hashes; inboxid is supported and no fallback exists', () => {
  const id = resolveProviderMessageId({ inboxid: 'provider-raw-id' });
  assert.equal(id.source, 'inboxid');
  assert.equal(id.providerMessageId.length, 64);
  assert.notEqual(id.providerMessageId, 'provider-raw-id');
  assert.deepEqual(resolveProviderMessageId({ sender: '6281', message: 'halo' }), { providerMessageId: null, source: null });
  assert.deepEqual(resolveProviderMessageId({ inboxid: 0 }), { providerMessageId: null, source: null });
  const deviceHash = resolveProviderDeviceHash({ device: '62818202569' });
  assert.equal(deviceHash.length, 64);
  assert.notEqual(deviceHash, '62818202569');
});

test('A: missing provider ID fails closed with zero orchestrator/OpenAI/send', async () => {
  let orchestratorCalls = 0; let sends = 0;
  const res = await runWebhook(fonntePayload({ inboxid: undefined }), {
    supabase: fakeSupabase(),
    handleMessage: async () => { orchestratorCalls += 1; },
    realSend: async () => { sends += 1; },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reason, 'missing_provider_message_id');
  assert.equal(orchestratorCalls, 0);
  assert.equal(sends, 0);
});

test('missing provider device also fails closed before AI/send', async () => {
  let orchestratorCalls = 0; let sends = 0;
  const res = await runWebhook(fonntePayload({ device: undefined }), {
    supabase: fakeSupabase(),
    handleMessage: async () => { orchestratorCalls += 1; },
    realSend: async () => { sends += 1; },
  });
  assert.equal(res.body.reason, 'missing_provider_device_id');
  assert.equal(orchestratorCalls, 0);
  assert.equal(sends, 0);
});

test('B: same device + same ID x5 concurrent yields exactly one claim', async () => {
  const supabase = fakeSupabase();
  const results = await Promise.all(Array.from({ length: 5 }, () => admitInboundEvent(supabase, fonntePayload())));
  assert.equal(results.filter((r) => r.status === 'claimed').length, 1);
  assert.equal(results.filter((r) => r.status === 'duplicate').length, 4);
});

test('C: different Fonnte devices may claim the same provider message ID', async () => {
  const supabase = fakeSupabase();
  const a = await admitInboundEvent(supabase, fonntePayload({ device: 'device-A', inboxid: 'same-X' }));
  const b = await admitInboundEvent(supabase, fonntePayload({ device: 'device-B', inboxid: 'same-X' }));
  assert.equal(a.status, 'claimed');
  assert.equal(b.status, 'claimed');
  assert.notEqual(a.providerDeviceHash, b.providerDeviceHash);
});

test('D: inbound DB claim error yields zero orchestrator/OpenAI/send', async () => {
  let orchestratorCalls = 0; let sends = 0;
  const res = await runWebhook(fonntePayload({ inboxid: 'db-error' }), {
    supabase: fakeSupabase({ failInboundClaim: true }),
    handleMessage: async () => { orchestratorCalls += 1; },
    realSend: async () => { sends += 1; },
  });
  assert.equal(res.body.reason, 'error');
  assert.equal(orchestratorCalls, 0);
  assert.equal(sends, 0);
});

test('E: concurrent identical replies from different inbound IDs allow max one send', async () => {
  const supabase = fakeSupabase(); let sends = 0;
  const ids = await Promise.all([
    claimPayload(supabase, fonntePayload({ inboxid: 'E-1' })),
    claimPayload(supabase, fonntePayload({ inboxid: 'E-2' })),
  ]);
  const realSend = async () => { sends += 1; return { status: true }; };
  const guards = ids.map((id) => createGuardedSend({ realSend, supabase, inboundEventRowId: id }));
  const results = await Promise.all(guards.map((send) => send('6281000', 'balasan sama')));
  assert.equal(sends, 1);
  assert.equal(results.filter((r) => r.suppressed).length, 1);
});

test('F: rolling duplicate window prevents a minute-bucket boundary escape', async () => {
  const supabase = fakeSupabase(); let sends = 0;
  const firstId = await claimPayload(supabase, fonntePayload({ inboxid: 'F-1' }));
  supabase.state.nowMs = 59_999;
  await createGuardedSend({ realSend: async () => { sends += 1; return { status: true }; }, supabase, inboundEventRowId: firstId })('6281001', 'same');
  const secondId = await claimPayload(supabase, fonntePayload({ inboxid: 'F-2' }));
  supabase.state.nowMs = 60_001;
  const second = await createGuardedSend({ realSend: async () => { sends += 1; return { status: true }; }, supabase, inboundEventRowId: secondId })('6281001', 'same');
  assert.equal(sends, 1);
  assert.equal(second.reason, 'duplicate_content');
});

test('G: concurrent rate-limit race cannot exceed the hard ceiling', async () => {
  const supabase = fakeSupabase(); let sends = 0;
  const ids = await Promise.all(Array.from({ length: RATE_LIMIT_MAX_SENDS + 3 }, (_, i) =>
    claimPayload(supabase, fonntePayload({ inboxid: `G-${i}` }))));
  const results = await Promise.all(ids.map((id, i) => createGuardedSend({
    realSend: async () => { sends += 1; return { status: true }; }, supabase, inboundEventRowId: id,
  })('6281002', `unique-${i}`)));
  assert.equal(sends, RATE_LIMIT_MAX_SENDS);
  assert.equal(results.filter((r) => r.reason === 'rate_limited').length, 3);
});

test('outbound reservation DB error fails closed before provider send', async () => {
  const supabase = fakeSupabase({ failReservation: true }); let sends = 0;
  const id = await claimPayload(supabase, fonntePayload({ inboxid: 'rpc-error' }));
  const result = await createGuardedSend({ realSend: async () => { sends += 1; }, supabase, inboundEventRowId: id })('6281', 'x');
  assert.equal(result.reason, 'error');
  assert.equal(sends, 0);
});

test('KS1: REDDY_ENABLED unset defaults to disabled', () => {
  assert.equal(isReddyEnabled({}), false);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: '' }), false);
});

test('KS2 / H: REDDY_ENABLED=false yields zero AI and zero automated send', async () => {
  let aiCalls = 0; let sends = 0;
  const res = await runWebhook(fonntePayload({ inboxid: 'H-1' }), {
    supabase: fakeSupabase(), isReddyEnabled: () => false,
    handleMessage: async () => { aiCalls += 1; }, realSend: async () => { sends += 1; },
  });
  assert.equal(res.body.reddy_enabled, false);
  assert.equal(aiCalls, 0);
  assert.equal(sends, 0);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'false' }), false);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'FALSE' }), false);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: '0' }), false);
});

test('KS3: REDDY_ENABLED typo remains disabled', () => {
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'ture' }), false);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'enabled' }), false);
});

test('KS4: only explicit true enables Reddy, case-insensitively', () => {
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'true' }), true);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: 'TRUE' }), true);
  assert.equal(isReddyEnabled({ REDDY_ENABLED: ' true ' }), true);
});

test('KS5: webhook with REDDY_ENABLED unset has zero handleMessage/AI/send', async () => {
  const previous = process.env.REDDY_ENABLED;
  delete process.env.REDDY_ENABLED;
  let aiCalls = 0; let sends = 0;
  try {
    const res = await runWebhook(fonntePayload({ inboxid: 'KS5-1' }), {
      supabase: fakeSupabase(),
      handleMessage: async () => { aiCalls += 1; },
      realSend: async () => { sends += 1; },
    });
    assert.equal(res.body.reddy_enabled, false);
    assert.equal(aiCalls, 0);
    assert.equal(sends, 0);
  } finally {
    if (previous === undefined) delete process.env.REDDY_ENABLED;
    else process.env.REDDY_ENABLED = previous;
  }
});

test('KS6: guardedSend re-check suppresses when env changes from true to false', async () => {
  const supabase = fakeSupabase();
  const inboundEventRowId = await claimPayload(supabase, fonntePayload({ inboxid: 'KS6-1' }));
  const env = { REDDY_ENABLED: 'true' };
  let sends = 0;
  const guardedSend = createGuardedSend({
    realSend: async () => { sends += 1; return { status: true }; },
    supabase,
    inboundEventRowId,
    isEnabled: () => isReddyEnabled(env),
  });
  env.REDDY_ENABLED = 'false';
  const result = await guardedSend('6281003', 'must not send');
  assert.equal(result.reason, 'ai_kill_switch');
  assert.equal(sends, 0);
  assert.equal(supabase.state.claims.length, 0);
});

test('I: status callback yields zero AI and zero automated send', async () => {
  let aiCalls = 0; let sends = 0;
  const res = await runWebhook({ id: 'status-1', status: 'sent', stateid: 'state-1' }, {
    supabase: fakeSupabase(), handleMessage: async () => { aiCalls += 1; }, realSend: async () => { sends += 1; },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(aiCalls, 0);
  assert.equal(sends, 0);
});

test('J: self/fromMe event yields zero AI and zero automated reply', async () => {
  let aiCalls = 0; let sends = 0;
  const res = await runWebhook(fonntePayload({ sender: '62818202569', isFromMe: true }), {
    supabase: fakeSupabase(), handleMessage: async () => { aiCalls += 1; }, realSend: async () => { sends += 1; },
  });
  assert.equal(res.body.reason, 'outgoing');
  assert.equal(aiCalls, 0);
  assert.equal(sends, 0);
});

test('direct claim refuses missing device scope instead of using a global key', async () => {
  const result = await claimInboundEvent(fakeSupabase(), {
    providerMessageId: hashValue('x'), providerDeviceHash: null, eventType: 'customer_message',
  });
  assert.equal(result.status, 'unavailable');
});

test('SQL migration is idempotent, atomic, rolling-window, least-privilege, and hash-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/2026-08-29-wa-antispam-idempotency.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS wa_outbound_send_claims/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION reserve_wa_automated_send/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /reserved_at >= v_now - make_interval/i);
  assert.match(sql, /provider_device_hash, provider_message_id/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL .* anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE .* service_role/i);
  assert.doesNotMatch(sql, /raw_phone|raw_message|message_body/i);
});

test('manual human channel is not globally wrapped by the automated guard', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/waOutboundGuard.js'), 'utf8');
  assert.match(source, /Manual\/human sends never call this wrapper/);
  assert.doesNotMatch(source, /require\(['"]\.\/fonnte['"]\)/);
});

test('production webhook calls admission before handleMessage and has no in-memory dedupe authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.ok(source.indexOf('await admitInboundEvent(') < source.indexOf('await processMessage('));
  assert.doesNotMatch(source, /processedIds|fallback_fingerprint/);
});

test('reserveAutomatedSend exposes only one database authority call', async () => {
  let calls = 0;
  const result = await reserveAutomatedSend({ rpc: async (name) => {
    calls += 1;
    assert.equal(name, 'reserve_wa_automated_send');
    return { data: [{ decision: 'allowed', claim_id: 'claim-1' }], error: null };
  } }, { inboundEventId: 'in-1', destinationHash: 'd', contentHash: 'c' });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'allowed', claimId: 'claim-1' });
});
