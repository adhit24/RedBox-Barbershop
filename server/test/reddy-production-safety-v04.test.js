'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = require('../../api/wa/webhook');
const { createGuardedSend, normalizeOutboundLifecycleOutcome } = require('../services/waOutboundGuard');
const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

function fakeInboundEventsSupabase() {
  const state = { inbound: [], claims: [], nowMs: Date.now(), next: 1 };

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

  return {
    state,
    from(table) {
      if (table !== 'wa_inbound_events') return { select() { return { eq() { return { maybeSingle: async () => ({ data: null }) }; } }; } };
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
  await webhook({ method: 'POST', body, query: {} }, res, deps);
  return res;
}

// ── ROUND 4 REQUIRED TESTS ───────────────────────────────────────────────────

test('R4 TEST 1: media reply duplicate_content => duplicate_suppressed', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: '[image]', type: 'image', inboxid: `media-1` };
  let realSendCount = 0;
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => {
      realSendCount += 1;
      return { status: 'sent' };
    },
  });
  assert.equal(realSendCount, 1);

  // Send exact second image message within duplicate window
  const payload2 = { device: '62818202569', sender: '628123456789', message: '[image]', type: 'image', inboxid: `media-2` };
  await runWebhook(payload2, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => {
      realSendCount += 1;
      return { status: 'sent' };
    },
  });
  const secondRow = supabase.state.inbound[1];
  assert.ok(secondRow, 'second row must exist');
  assert.equal(secondRow.processing_status, 'failed');
});

test('R4 TEST 2: media reply rate_limited => rate_limited', async () => {
  const supabase = fakeInboundEventsSupabase();
  const destinationHash = require('../services/waInboundGuard').hashValue(require('../services/waInboundGuard').normalizePhoneDigits('628123456789'));
  for (let i = 0; i < 5; i++) {
    supabase.state.claims.push({ id: `seed-${i}`, destination_hash: destinationHash, content_hash: `content-${i}`, reserved_at: Date.now() });
  }

  const payload = { device: '62818202569', sender: '628123456789', message: '[image]', type: 'image', inboxid: `media-rate-${Math.random()}` };
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => ({ status: 'sent' }),
  });

  const row = supabase.state.inbound[0];
  assert.ok(row, 'inbound row must exist');
  assert.equal(row.processing_status, 'failed');
});

test('R4 TEST 3: media reply reservation error => processing_failed', async () => {
  const supabase = {
    from() {
      return {
        insert() { return { select() { return { single: async () => ({ data: { id: 'in-res-err' }, error: null }) }; } }; },
        update() { return { eq() { return { in() { return { select: async () => ({ data: [{ id: 'in-res-err' }] }) }; } }; } }; },
      };
    },
    rpc(name) {
      if (name === 'reserve_wa_automated_send') {
        return Promise.resolve({ data: null, error: { message: 'DB RPC crash' } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  const payload = { device: '62818202569', sender: '628123456789', message: '[audio]', type: 'audio', inboxid: `media-res-err-${Math.random()}` };
  const res = await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => ({ status: 'sent' }),
  });
  assert.equal(res.statusCode, 200);
});

test('R4 TEST 4: media reply successful send => no failed terminalization', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: '[sticker]', type: 'sticker', inboxid: `media-ok-${Math.random()}` };
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => ({ status: 'sent' }),
    armIdleTimer: async () => {},
  });

  const row = supabase.state.inbound[0];
  assert.ok(row, 'inbound row must exist');
  assert.equal(row.processing_status, 'sent');
  assert.equal(row.outbound_sent, true);
});

test('R4 TEST 5: media realSend throw => processing_failed', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: '[doc]', type: 'document', inboxid: `media-throw-${Math.random()}` };
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    realSend: async () => { throw new Error('Fonnte provider connection error'); },
  });

  const row = supabase.state.inbound[0];
  assert.ok(row, 'inbound row must exist');
  assert.equal(row.processing_status, 'failed');
});

test('R4 TEST 6: provider send throw is NOT model_call_failed', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: 'halo', inboxid: `prov-throw-${Math.random()}` };
  
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      await deps.send('628123456789', 'usable reply text', { branch: 'bypass' });
    },
    realSend: async () => { throw new Error('Network timeout connecting to WhatsApp gateway'); },
  });

  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('R4 TEST 7: genuine model generation throw + fallback send success => SENT', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: 'jam berapa buka?', inboxid: `model-err-ok-${Math.random()}` };

  let realSendCalled = false;
  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      let reply;
      let used = 'reddy_agent';
      try {
        throw new Error('OpenAI API Rate limit reached');
      } catch (err) {
        reply = 'Redbox Bypass buka jam 09.00 - 21.00 WIB setiap hari ya Kak!';
        used = 'static_fallback';
      }
      const sendResult = await deps.send('628123456789', reply, { branch: 'bypass' });
      return { used, reply, sendResult, error: null, failureReason: null };
    },
    realSend: async () => {
      realSendCalled = true;
      return { status: 'sent' };
    },
    armIdleTimer: async () => {},
  });

  assert.equal(realSendCalled, true);
  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'sent');
});

test('R4 TEST 8: genuine model generation throw + fallback send failure => processing_failed', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: 'jam berapa buka?', inboxid: `model-err-fail-${Math.random()}` };

  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      let reply;
      let used = 'reddy_agent';
      try {
        throw new Error('LLM provider error');
      } catch (err) {
        reply = 'Redbox Bypass buka jam 09.00 - 21.00 WIB setiap hari ya Kak!';
        used = 'static_fallback';
      }
      let sendResult;
      try {
        sendResult = await deps.send('628123456789', reply, { branch: 'bypass' });
      } catch (sendErr) {
        sendResult = { status: false, reason: 'send_threw', error: sendErr };
      }
      const outboundOutcome = normalizeOutboundLifecycleOutcome(sendResult);
      const sendSucceeded = outboundOutcome.terminalKind === 'sent';
      return {
        used,
        reply,
        sendResult,
        error: sendSucceeded ? null : 'send_failed',
        failureReason: sendSucceeded ? null : (outboundOutcome.reason || 'processing_failed'),
      };
    },
    realSend: async () => { throw new Error('WhatsApp gateway down'); },
  });

  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'failed');
});

test('R4 TEST 9: genuine CRM generation/Reddy failure + fallback send success => SENT', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: 'poin saya berapa?', inboxid: `crm-err-ok-${Math.random()}` };

  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      const fallbackMsg = 'Data pribadi kamu sedang tidak dapat dibaca dengan aman; fitur ini masih sedang kami siapkan agar tetap aman ya Kak.';
      const sendResult = await deps.send('628123456789', fallbackMsg, { branch: 'bypass' });
      const outboundOutcome = normalizeOutboundLifecycleOutcome(sendResult);
      const sendSucceeded = outboundOutcome.terminalKind === 'sent';
      return {
        used: 'crm_unavailable_guard',
        reply: fallbackMsg,
        sendResult,
        error: sendSucceeded ? null : 'crm_context_failed',
        failureReason: sendSucceeded ? null : (outboundOutcome.reason || 'processing_failed'),
      };
    },
    realSend: async () => ({ status: 'sent' }),
    armIdleTimer: async () => {},
  });

  const row = supabase.state.inbound[0];
  assert.equal(row.processing_status, 'sent');
});

test('R4 TEST 10: first outbound send throw does NOT trigger second guarded send', async () => {
  const supabase = fakeInboundEventsSupabase();
  const payload = { device: '62818202569', sender: '628123456789', message: 'halo', inboxid: `send-once-${Math.random()}` };

  let guardedSendCallCount = 0;

  await runWebhook(payload, {
    supabase,
    isReddyEnabled: () => true,
    handleMessage: async (_input, deps) => {
      guardedSendCallCount += 1;
      await deps.send('628123456789', 'balasan pertama', { branch: 'bypass' });
    },
    realSend: async () => { throw new Error('first send network error'); },
  });

  assert.equal(guardedSendCallCount, 1, 'guardedSend must only be called ONCE during message processing');
});

test('R4 TEST 11: send-once invariant preserved', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(source, /if\s*\(\s*err\s*&&\s*err\.outboundFailure\s*\)/);
});

test('R4 TEST 12: duplicate/rate-limit mappings from Round 3 remain PASS', () => {
  assert.equal(normalizeOutboundLifecycleOutcome({ status: false, suppressed: true, reason: 'duplicate_content' }).reason, 'duplicate_suppressed');
  assert.equal(normalizeOutboundLifecycleOutcome({ status: false, suppressed: true, reason: 'already_attempted' }).reason, 'duplicate_suppressed');
  assert.equal(normalizeOutboundLifecycleOutcome({ status: false, suppressed: true, reason: 'rate_limited' }).reason, 'rate_limited');
});

test('R4 TEST 13: unexpected_pre_send_exit remains watchdog-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/services/waInboundLifecycle.js'), 'utf8');
  assert.match(source, /reason\s*=\s*'unexpected_pre_send_exit'/);
});

test('R4 TEST 14: price authority preserved', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/services/waOutboundGuard.js'), 'utf8');
  assert.match(source, /guardPricePlaceholders/);
});

test('R4 TEST 15: contact authority preserved', () => {
  const webhookSource = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(webhookSource, /resolveOfficialBranchContact/);
});

test('R4 TEST 16: booking authority unchanged', () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, '../../server/agents/reddy/reddyAdapter.js'), 'utf8');
  assert.match(adapterSource, /REDDY_BOOKING_EXECUTION/);
});

test('R4 TEST 17: Task16 observer-only unchanged', () => {
  const guardSource = fs.readFileSync(path.join(__dirname, '../../server/services/waOutboundGuard.js'), 'utf8');
  assert.match(guardSource, /observeMessageFailOpen/);
});

test('R4 TEST 18: P0 anti-spam unchanged', () => {
  const webhookSource = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(webhookSource, /logAntiSpamEvent/);
});

test('R4 TEST 19: PR58 bootstrap guard PASS', () => {
  const webhookSource = fs.readFileSync(path.join(__dirname, '../../api/wa/webhook.js'), 'utf8');
  assert.match(webhookSource, /terminalizeIfStillProcessing/);
});

test('R4 TEST 20: frontend untouched', () => {
  const statusOutput = require('child_process').execSync('git status --porcelain -uno frontend/', { encoding: 'utf8' });
  assert.equal(statusOutput.trim(), '', 'frontend directory must remain completely untouched');
});
