'use strict';

/**
 * P0.1 incident hotfix — Fonnte envelope normalization.
 *
 * Production symptom: customers reaching /api/wa/webhook got automated
 * replies suppressed with missing_provider_message_id, while webhook shadow
 * telemetry showed has_inboxid: true for the same requests. Root cause: the
 * pre-hotfix body normalization REPLACED the working body with a nested
 * `data`/`payload` envelope wholesale whenever one was present
 * (`body = rawBody.data`), silently dropping any envelope-level field (most
 * critically `inboxid`) the nested object did not repeat.
 *
 * server/services/fonnteEnvelopeNormalizer.js now builds one canonical,
 * bounded merge (nested value wins when present, envelope is the fallback)
 * used for classification, admission, branch detection, and message routing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeFonnteEnvelope, CANONICAL_FIELDS } = require('../services/fonnteEnvelopeNormalizer');
const {
  admitInboundEvent,
  resolveProviderMessageId,
  resolveProviderDeviceHash,
} = require('../services/waInboundGuard');
const webhook = require('../../api/wa/webhook');

// ── Fake wa_inbound_events + RPC ledger (mirrors p0-antispam-idempotency.test.js) ──
function fakeSupabase() {
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
        if (duplicate) return Promise.resolve({ data: [{ decision: 'duplicate_content', claim_id: null }], error: null });
        const claim = { id: `out-${state.next++}`, inbound_event_id: inbound.id, reserved_at: now };
        state.claims.push(claim);
        return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
      }
      if (name === 'complete_wa_automated_send') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
    },
  };
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

// ── Direct unit coverage of the canonical merge itself ─────────────────────

test('normalizeFonnteEnvelope: bounded field list never leaks arbitrary raw keys', () => {
  const { canonical } = normalizeFonnteEnvelope({
    inboxid: 'x', device: 'y', sender: 'z', message: 'halo',
    some_unrelated_internal_field: 'must not leak', __proto__: { polluted: true },
  });
  assert.equal(canonical.some_unrelated_internal_field, undefined);
  assert.equal(canonical.polluted, undefined);
  assert.ok(CANONICAL_FIELDS.includes('inboxid'));
  for (const key of Object.keys(canonical)) {
    assert.ok(CANONICAL_FIELDS.includes(key), `${key} must be in the bounded field list`);
  }
});

test('normalizeFonnteEnvelope: nested value wins when a field is present on both layers', () => {
  const { canonical } = normalizeFonnteEnvelope({
    sender: 'envelope-sender', data: { sender: 'nested-sender', message: 'halo' },
  });
  assert.equal(canonical.sender, 'nested-sender');
});

test('normalizeFonnteEnvelope: envelope value survives as fallback when the nested object omits it', () => {
  const { canonical } = normalizeFonnteEnvelope({
    inboxid: 'envelope-only-id', device: 'envelope-device', data: { sender: 'CUSTOMER', message: 'halo' },
  });
  assert.equal(canonical.inboxid, 'envelope-only-id');
  assert.equal(canonical.device, 'envelope-device');
  assert.equal(canonical.sender, 'CUSTOMER');
  assert.equal(canonical.message, 'halo');
});

test('normalizeFonnteEnvelope: two levels of nesting (data.data) still resolve, deepest wins', () => {
  const { canonical } = normalizeFonnteEnvelope({
    inboxid: 'outer-id', data: JSON.stringify({ device: 'mid-device', data: { sender: 'inner-sender', message: 'halo' } }),
  });
  assert.equal(canonical.inboxid, 'outer-id');
  assert.equal(canonical.device, 'mid-device');
  assert.equal(canonical.sender, 'inner-sender');
});

// ── F1: top-level inboxid + nested object data ──────────────────────────────

test('F1. top-level inboxid + nested object data: claimed via inboxid, AI path may proceed', async () => {
  const supabase = fakeSupabase();
  const payload = { inboxid: 'stable-123', device: 'DEVICE-A', data: { sender: 'CUSTOMER-1', message: 'Halo' } };

  const admission = await admitInboundEvent(supabase, normalizeFonnteEnvelope(payload).canonical, { provider: 'fonnte' });
  assert.equal(admission.status, 'claimed');
  assert.equal(admission.providerMessageIdSource, 'inboxid');

  let handleMessageCalls = 0;
  const res = await runWebhook(payload, { supabase: fakeSupabase(), handleMessage: async () => { handleMessageCalls += 1; } });
  assert.equal(res.statusCode, 200);
  assert.equal(handleMessageCalls, 1);
});

// ── F2: top-level inboxid + nested JSON-STRING data — same behavior ────────

test('F2. top-level inboxid + nested JSON-string data: same behavior as F1', async () => {
  const payload = { inboxid: 'stable-124', device: 'DEVICE-A', data: JSON.stringify({ sender: 'CUSTOMER-2', message: 'Halo lagi' }) };

  const { canonical } = normalizeFonnteEnvelope(payload);
  assert.equal(canonical.inboxid, 'stable-124');
  assert.equal(canonical.sender, 'CUSTOMER-2');
  assert.equal(canonical.message, 'Halo lagi');

  let handleMessageCalls = 0;
  const res = await runWebhook(payload, { supabase: fakeSupabase(), handleMessage: async () => { handleMessageCalls += 1; } });
  assert.equal(res.statusCode, 200);
  assert.equal(handleMessageCalls, 1);
});

// ── F3: inboxid inside nested data ──────────────────────────────────────────

test('F3. inboxid only inside nested data: still resolves and claims', async () => {
  const payload = { device: 'DEVICE-A', data: { inboxid: 'nested-only-id', sender: 'CUSTOMER-3', message: 'halo' } };
  const { canonical } = normalizeFonnteEnvelope(payload);
  assert.equal(canonical.inboxid, 'nested-only-id');

  const admission = await admitInboundEvent(fakeSupabase(), canonical, { provider: 'fonnte' });
  assert.equal(admission.status, 'claimed');
  assert.equal(admission.providerMessageIdSource, 'inboxid');
});

// ── F4: top-level device + nested sender/message — device identity preserved ─

test('F4. top-level device + nested sender/message: device identity preserved', async () => {
  const payload = { inboxid: 'id-f4', device: 'DEVICE-ENVELOPE', data: { sender: 'CUSTOMER-4', message: 'halo' } };
  const { canonical } = normalizeFonnteEnvelope(payload);
  assert.equal(canonical.device, 'DEVICE-ENVELOPE');

  const deviceHash = resolveProviderDeviceHash(canonical);
  assert.ok(deviceHash);
  assert.notEqual(deviceHash, 'DEVICE-ENVELOPE');

  const admission = await admitInboundEvent(fakeSupabase(), canonical, { provider: 'fonnte' });
  assert.equal(admission.status, 'claimed');
  assert.equal(admission.providerDeviceHash, deviceHash);
});

// ── F5: nested device + top-level inboxid — both identities preserved ──────

test('F5. nested device + top-level inboxid: both identities preserved', async () => {
  const payload = { inboxid: 'id-f5', data: { device: 'DEVICE-NESTED', sender: 'CUSTOMER-5', message: 'halo' } };
  const { canonical } = normalizeFonnteEnvelope(payload);
  assert.equal(canonical.inboxid, 'id-f5');
  assert.equal(canonical.device, 'DEVICE-NESTED');

  const admission = await admitInboundEvent(fakeSupabase(), canonical, { provider: 'fonnte' });
  assert.equal(admission.status, 'claimed');
  assert.equal(admission.providerMessageIdSource, 'inboxid');
});

// ── F6: no provider ID anywhere — fail closed remains intact ───────────────

test('F6. no provider ID anywhere: fails closed, zero AI, zero send', async () => {
  const payload = { device: 'DEVICE-A', sender: 'CUSTOMER-6', message: 'halo, tidak ada inboxid' };
  const { canonical } = normalizeFonnteEnvelope(payload);
  assert.equal(canonical.inboxid, undefined);
  assert.equal(canonical.id, undefined);

  let handleMessageCalls = 0;
  let sendCalls = 0;
  const res = await runWebhook(payload, {
    supabase: fakeSupabase(),
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { sendCalls += 1; return { status: true }; },
  });
  assert.equal(res.body.reason, 'missing_provider_message_id');
  assert.equal(handleMessageCalls, 0);
  assert.equal(sendCalls, 0);
});

// ── F7: same inboxid delivered 5 times ──────────────────────────────────────

test('F7. same inboxid delivered 5 times: 1 claimed, 4 duplicate, OpenAI <= 1, provider send <= 1', async () => {
  const supabase = fakeSupabase();
  const payload = { inboxid: 'repeat-id', device: 'DEVICE-A', data: { sender: 'CUSTOMER-7', message: 'halo' } };

  let handleMessageCalls = 0;
  let sendCalls = 0;
  const results = [];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await runWebhook(payload, {
      supabase,
      handleMessage: async (_args, deps) => { handleMessageCalls += 1; await deps.send('x', 'reply', {}); },
      realSend: async () => { sendCalls += 1; return { status: true }; },
    });
    results.push(res);
  }

  assert.equal(results.filter((r) => r.body?.reason === undefined && r.statusCode === 200 && !r.body?.reason).length >= 1, true);
  assert.equal(results.filter((r) => r.body?.reason === 'duplicate').length, 4);
  assert.ok(handleMessageCalls <= 1);
  assert.ok(sendCalls <= 1);
});

// ── F8: same inboxid on different devices — independent valid claims ───────

test('F8. same inboxid on different Fonnte devices: independent valid claims, device-scoped identity preserved', async () => {
  const supabase = fakeSupabase();
  const payloadA = { inboxid: 'shared-id', device: 'DEVICE-A', data: { sender: 'CUSTOMER-8A', message: 'halo dari A' } };
  const payloadB = { inboxid: 'shared-id', device: 'DEVICE-B', data: { sender: 'CUSTOMER-8B', message: 'halo dari B' } };

  const admissionA = await admitInboundEvent(supabase, normalizeFonnteEnvelope(payloadA).canonical, { provider: 'fonnte' });
  const admissionB = await admitInboundEvent(supabase, normalizeFonnteEnvelope(payloadB).canonical, { provider: 'fonnte' });

  assert.equal(admissionA.status, 'claimed');
  assert.equal(admissionB.status, 'claimed');
  assert.notEqual(admissionA.providerDeviceHash, admissionB.providerDeviceHash);
});

// ── F9: status callback, nested/enveloped ───────────────────────────────────

test('F9. status callback nested/enveloped: zero AI, zero automated reply', async () => {
  const payload = { data: { id: 'msg-status-1', status: 'delivered', stateid: 's1', state: 'DELIVERED' } };
  let handleMessageCalls = 0;
  let sendCalls = 0;
  const res = await runWebhook(payload, {
    supabase: fakeSupabase(),
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { sendCalls += 1; return { status: true }; },
  });
  assert.equal(res.body.status, 'ok');
  assert.equal(handleMessageCalls, 0);
  assert.equal(sendCalls, 0);
});

// ── F10: self/outbound echo, nested/enveloped ───────────────────────────────

test('F10. self/outbound echo nested/enveloped: remains suppressed', async () => {
  const payload = { device: 'DEVICE-A', data: { sender: 'DEVICE-A', message: 'echo of my own reply', isFromMe: true } };
  let handleMessageCalls = 0;
  let sendCalls = 0;
  const res = await runWebhook(payload, {
    supabase: fakeSupabase(),
    handleMessage: async () => { handleMessageCalls += 1; },
    realSend: async () => { sendCalls += 1; return { status: true }; },
  });
  assert.equal(res.body.reason, 'outgoing');
  assert.equal(handleMessageCalls, 0);
  assert.equal(sendCalls, 0);
});
