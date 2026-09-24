'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const webhook = require('../../api/wa/webhook');
const { handleMessage, callOpenAI, fallbackReply, handleForeignGeneralQuestion } = webhook;
const { admitInboundEvent } = require('../services/waInboundGuard');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { BRANCH_WA_NUMBER } = require('../services/fonnte');
const { REDBOX_KNOWLEDGE } = require('../agents/reddy/knowledge/redboxKnowledge');

const CUSTOMER = '6281234567890';
const trusted = () => issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: CUSTOMER });
const branchName = (id) => REDBOX_KNOWLEDGE.branches.find((b) => b.id === id).name;
const branchAddress = (id) => REDBOX_KNOWLEDGE.branches.find((b) => b.id === id).address;

// ── 1. Greeting consistency across deterministic paths ─────────────────────

test('F1. fallbackReply uses the bare first name (no "Kak") when a name exists', () => {
  assert.ok(fallbackReply('halo', 'Adhit Nugraha', 'bypass').startsWith('Halo Adhit,'));
  assert.match(fallbackReply('makasih', 'Adhit Nugraha', 'csb'), /Sama-sama Adhit!/);
  assert.match(fallbackReply('apa itu xyz', 'Adhit Nugraha', 'csb'), /Mohon maaf Adhit,/);
});

test('F2. Nameless customers keep "Kak" (not removed globally)', () => {
  for (const noName of [null, undefined, '', 'Kak', '6281234567890']) {
    assert.ok(fallbackReply('halo', noName, 'bypass').startsWith('Halo Kak,'), String(noName));
  }
});

test('F3. No remaining "Kak <name>" template in the Reddy conversation paths', () => {
  const root = path.join(__dirname, '..', '..');
  const files = [
    'api/wa/webhook.js',
    'server/agents/reddy/personalityPolicy.js',
    'server/agents/reddy/branchGreetingContext.js',
    'server/agents/reddy/reddyAdapter.js',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.equal(/'Kak '\s*\+\s*(fn|firstName)/.test(src), false, `${f} still builds "Kak <name>"`);
    assert.equal(/Kak \$\{(fn|firstName)\}/.test(src), false, `${f} still interpolates "Kak <name>"`);
  }
});

// ── 2. Foreign-language handlers stay branch-aware ─────────────────────────

test('B1. English hours on the locked CSB channel answers CSB only', () => {
  const reply = handleForeignGeneralQuestion('What time do you close?', 'english', null, 'csb', true);
  assert.match(reply, /Redbox CSB Mall: 10:00–22:00/);
  assert.equal(/Other branches/i.test(reply), false);
});

test('B2. English location on the locked CSB channel returns only the CSB address', () => {
  const reply = handleForeignGeneralQuestion('Where are you located?', 'english', null, 'csb', true);
  assert.ok(reply.includes(branchAddress('csb')));
  for (const other of ['bypass', 'samadikun', 'sumber', 'tegal']) {
    assert.equal(reply.includes(branchAddress(other)), false, `${other} must not be listed`);
  }
});

test('B3. Locked CSB channel asking about another branch by name answers that branch, not all', () => {
  const reply = handleForeignGeneralQuestion('What time does Tegal close?', 'english', null, 'csb', true);
  assert.match(reply, /Redbox Tegal: 10:00–21:00/);
  assert.equal(reply.includes('CSB Mall'), false);
});

test('B4. Other supported languages are also scoped to the locked branch', () => {
  const reply = handleForeignGeneralQuestion('住所はどこですか 住所', 'japanese', null, 'sumber', true);
  assert.ok(reply.includes(branchAddress('sumber')));
  assert.equal(reply.includes(branchAddress('tegal')), false);
});

test('B5. Unlocked (unknown device) foreign handler keeps the legacy multi-branch summary', () => {
  const reply = handleForeignGeneralQuestion('Where are you located?', 'english', null, 'bypass', false);
  for (const b of REDBOX_KNOWLEDGE.branches) assert.ok(reply.includes(b.address));
});

// Drives the real handleMessage; a scripted "model" only sees the system prompt.
function scriptedModel(system, userText) {
  const greetingSection = system.split('# SALAM')[1] || '';
  const example = /contoh[^:]*: "([^"]+)"/.exec(greetingSection)?.[1];
  const requested = /REQUESTED_BRANCH \(pesan ini\): (Redbox [^(]+?) \(/.exec(system)?.[1];
  if (/alamat|address|where/i.test(userText)) {
    const shown = REDBOX_KNOWLEDGE.branches.filter((b) => system.includes(b.address));
    return `Alamat: ${shown.map((b) => `${b.name} — ${b.address}`).join('; ')}`;
  }
  if (requested) return `Boleh, untuk ${requested} ya. Nanti pilih barbernya langsung saat booking.`;
  if (example) return example;
  return 'Siap.';
}

async function converse({ device, text, name = null, history = [], sent = [], captured = {}, branchFromPayload }) {
  const model = {
    chat: { completions: { create: async (params) => {
      const system = params.messages.find((m) => m.role === 'system').content;
      captured.system = system;
      return { choices: [{ message: { content: scriptedModel(system, text) } }] };
    } } },
  };
  return handleMessage(
    { from: CUSTOMER, text, device, receiver: device, branchFromPayload, trustedIdentity: trusted() },
    {
      send: async (_to, reply) => { sent.push(reply); return { status: true }; },
      loadConversationHistory: async () => ({ history, status: history.length ? 'available' : 'empty' }),
      getHandoffState: async () => ({ status: 'none' }),
      touchLifecycle: async () => ({ reopened: false }),
      recordEvaluation: () => {},
      logTelemetry: () => {},
      persistConversation: async () => {},
      lookupCustomerName: async () => name,
      orchestrate: async () => ({
        route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1, model_tier: 'economy',
      }),
      generateReddy: (a, b, c, d, e, f, g) => callOpenAI(a, b, c, d, e, f, g, { openai: model }),
    },
  );
}

test('B6. Full flow: English "What time do you close?" on CSB device sends CSB hours only', async () => {
  const sent = [];
  await converse({ device: BRANCH_WA_NUMBER.csb, text: 'What time do you close?', sent });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /CSB Mall: 10:00–22:00/);
  assert.equal(/Other branches/i.test(sent[0]), false);
});

// ── 3. Durable inbound dedupe through the real webhook ─────────────────────

function fakeSupabase() {
  const state = { inbound: [], claims: [], next: 1 };
  function inboundBuilder() {
    const q = { action: null, value: null, filters: [] };
    const b = {
      insert(v) { q.action = 'insert'; q.value = v; return b; },
      update(v) { q.action = 'update'; q.value = v; return b; },
      select() { if (!q.action) q.action = 'select'; return b; },
      eq(f, v) { q.filters.push([f, v]); return b; },
      async single() { return run(true); },
      async maybeSingle() { return run(false); },
    };
    const matches = (row) => q.filters.every(([f, v]) => row[f] === v);
    function run(requireRow) {
      if (q.action === 'insert') {
        const dup = state.inbound.find((r) => r.provider === q.value.provider
          && r.provider_device_hash === q.value.provider_device_hash
          && r.provider_message_id === q.value.provider_message_id);
        if (dup) return { data: null, error: { code: '23505' } };
        const row = { id: `in-${state.next++}`, outbound_attempted: false, ...q.value };
        state.inbound.push(row);
        return { data: row, error: null };
      }
      if (q.action === 'update') {
        const row = state.inbound.find(matches);
        if (row) Object.assign(row, q.value);
        return { data: row || null, error: null };
      }
      const row = state.inbound.find(matches) || null;
      return { data: row, error: requireRow && !row ? { code: 'PGRST116' } : null };
    }
    return b;
  }
  return {
    state,
    from(table) {
      if (table !== 'wa_inbound_events') throw new Error(`Unexpected table: ${table}`);
      return inboundBuilder();
    },
    rpc(name, args) {
      if (name === 'reserve_wa_automated_send') {
        const inbound = state.inbound.find((r) => r.id === args.p_inbound_event_id);
        if (!inbound || inbound.outbound_attempted) return Promise.resolve({ data: [{ decision: 'already_attempted', claim_id: null }], error: null });
        inbound.outbound_attempted = true;
        const claim = { id: `out-${state.next++}`, inbound_event_id: inbound.id };
        state.claims.push(claim);
        return Promise.resolve({ data: [{ decision: 'allowed', claim_id: claim.id }], error: null });
      }
      if (name === 'complete_wa_automated_send') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: { code: 'UNKNOWN_RPC' } });
    },
  };
}

const recorder = () => ({
  statusCode: null, body: null, headersSent: false,
  setHeader() {},
  status(c) { this.statusCode = c; return this; },
  json(v) { this.body = v; this.headersSent = true; return this; },
  end() { this.headersSent = true; return this; },
});

test('D1. admitInboundEvent: same device + same message id sent twice → first claimed, second duplicate', async () => {
  const supabase = fakeSupabase();
  const payload = { device: BRANCH_WA_NUMBER.csb, sender: CUSTOMER, message: 'Halo', inboxid: 'dedupe-1' };
  const first = await admitInboundEvent(supabase, payload);
  const second = await admitInboundEvent(supabase, { ...payload });
  assert.equal(first.status, 'claimed');
  assert.equal(second.status, 'duplicate');
  assert.equal(supabase.state.inbound.length, 1);
});

test('D2. Webhook retry of the same event: one AI call, one send, one greeting, one assistant history turn', async () => {
  const supabase = fakeSupabase();
  const store = [];
  let aiCalls = 0;
  const realSends = [];
  const model = {
    chat: { completions: { create: async (params) => {
      aiCalls += 1;
      const system = params.messages.find((m) => m.role === 'system').content;
      return { choices: [{ message: { content: scriptedModel(system, 'Halo') } }] };
    } } },
  };
  const persist = async (_sender, _prior, userMessage, assistantReply) => {
    store.push({ role: 'user', content: userMessage }, { role: 'assistant', content: assistantReply });
  };
  const body = { device: BRANCH_WA_NUMBER.csb, sender: CUSTOMER, message: 'Halo', inboxid: 'retry-1' };
  const deps = {
    supabase,
    handoffSupabase: null,
    isReddyEnabled: () => true,
    realSend: async (_to, reply) => { realSends.push(reply); return { status: true }; },
    armIdleTimer: async () => {},
    handleMessage: (params, msgDeps) => handleMessage({ ...params, trustedIdentity: trusted() }, {
      ...msgDeps,
      loadConversationHistory: async () => ({ history: store.slice(), status: store.length ? 'available' : 'empty' }),
      touchLifecycle: async () => ({ reopened: false }),
      recordEvaluation: () => {},
      logTelemetry: () => {},
      persistConversation: persist,
      lookupCustomerName: async () => 'Adhit',
      orchestrate: async () => ({ route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1, model_tier: 'economy' }),
      generateReddy: (a, b, c, d, e, f, g) => callOpenAI(a, b, c, d, e, f, g, { openai: model, persistConversationExchange: persist }),
    }),
  };

  const r1 = recorder();
  await webhook({ method: 'POST', body: { ...body }, query: {} }, r1, deps);
  const r2 = recorder();
  await webhook({ method: 'POST', body: { ...body }, query: {} }, r2, deps);

  assert.equal(aiCalls, 1, 'second delivery must not reach the AI');
  assert.equal(realSends.length, 1, 'exactly one customer-visible send');
  assert.match(realSends[0], /Adhit/);
  assert.equal(realSends.filter((m) => /Halo Adhit/.test(m)).length, 1, 'one personalized greeting');
  assert.equal(store.filter((t) => t.role === 'assistant').length, 1, 'no duplicate assistant history turn');
  assert.equal(supabase.state.inbound.length, 1);
  assert.equal(r2.statusCode, 200);
});

// ── 4. Response-level regression (mocked model, real orchestration) ────────

test('A. CSB + known customer "Adhit" + "Halo": personalized, CSB-aware, never asks the branch', async () => {
  const sent = [];
  await converse({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', name: 'Adhit', sent });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Halo Adhit/);
  assert.match(sent[0], /CSB Mall/);
  assert.equal(/cabang mana|outlet mana|lokasi.*cabang mana/i.test(sent[0]), false);
  assert.equal(/Kak Adhit/.test(sent[0]), false);
});

test('B. Sumber + "alamatnya dimana?": reply names only Sumber', async () => {
  const sent = [];
  await converse({ device: BRANCH_WA_NUMBER.sumber, text: 'alamatnya dimana?', sent });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes(branchAddress('sumber')));
  for (const other of ['bypass', 'samadikun', 'csb', 'tegal']) {
    assert.equal(sent[0].includes(branchAddress(other)), false, `${other} must not appear`);
  }
});

test('C. CSB + "kalau di Bypass ada Abdul?": answers Bypass, CURRENT_BRANCH stays CSB', async () => {
  const sent = [];
  const captured = {};
  await converse({ device: BRANCH_WA_NUMBER.csb, text: 'kalau di Bypass ada Abdul?', sent, captured });
  assert.match(sent[0], /untuk Redbox Bypass/);
  assert.match(captured.system, /CURRENT_BRANCH: Redbox CSB Mall \(id: csb\)/);
  assert.equal(captured.system.includes('CURRENT_BRANCH: Redbox Bypass'), false);
});

test('D. Unknown device: branch_locked=false and the channel is not presented as Bypass', async () => {
  const sent = [];
  const captured = {};
  await converse({ device: '6289999999999', text: 'Halo', name: null, sent, captured });
  assert.equal(captured.system.includes('BRANCH_LOCKED: true'), false);
  assert.match(captured.system, /BRANCH_LOCKED: false/);
  assert.equal(captured.system.includes('CURRENT_BRANCH'), false);
  assert.equal(/melayani customer dari/.test(captured.system), false);
  assert.equal(/di Redbox (Bypass|CSB|Sumber|Tegal|Samadikun)/.test(sent[0] || ''), false);
});
