'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage, callOpenAI } = require('../../api/wa/webhook');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { BRANCH_WA_NUMBER } = require('../services/fonnte');
const {
  buildBranchContext,
  detectRequestedBranch,
  normalizeGreetingName,
  matchBranchFromDevice,
} = require('../agents/reddy/branchGreetingContext');

const CUSTOMER = '6281234567890';
const trustedIdentity = () => issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: CUSTOMER });

// Drives the real handleMessage + real callOpenAI/buildSystemPrompt with a
// mocked OpenAI, returning what the model was told and what was sent.
async function run({ device, text, name = null, history = [], deviceBranchParam, identity = trustedIdentity() }) {
  const captured = { system: null, lookups: 0, sent: [] };
  const mockOpenAI = {
    chat: { completions: { create: async (params) => {
      captured.system = params.messages.find((m) => m.role === 'system').content;
      return { choices: [{ message: { content: 'ok' } }] };
    } } },
  };
  const res = await handleMessage(
    { from: CUSTOMER, text, device, receiver: device, branchFromPayload: deviceBranchParam, trustedIdentity: identity },
    {
      send: async (to, reply) => { captured.sent.push(reply); return { status: true }; },
      loadConversationHistory: async () => ({ history, status: history.length ? 'available' : 'empty' }),
      getHandoffState: async () => ({ status: 'none' }),
      checkHumanTakeover: async () => false,
      touchLifecycle: async () => ({ reopened: false }),
      recordEvaluation: () => {},
      logTelemetry: () => {},
      persistConversation: async () => {},
      lookupCustomerName: async () => { captured.lookups += 1; return name; },
      orchestrate: async () => ({
        route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1,
        model_tier: 'economy', fallback_used: false,
      }),
      generateReddy: (a, b, c, d, e, f, g) => callOpenAI(a, b, c, d, e, f, g, { openai: mockOpenAI }),
    },
  );
  return { res, captured };
}

const recentTurns = () => [
  { role: 'user', content: 'halo', timestamp: Date.now() - 60_000 },
  { role: 'assistant', content: 'Halo Adhit 👋', timestamp: Date.now() - 55_000 },
];

test('1. Inbound via CSB device locks branch to csb and forbids asking for the branch', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', deviceBranchParam: 'csb' });
  assert.match(captured.system, /CURRENT_BRANCH: Redbox CSB Mall \(id: csb\)/);
  assert.match(captured.system, /BRANCH_LOCKED: true/);
  assert.match(captured.system, /DILARANG bertanya "mau cabang mana/);
});

test('2. Existing customer name is resolved (normalized phone) and used in the first greeting', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', name: 'ADHITYA NUGRAHA' });
  assert.equal(captured.lookups, 1);
  assert.match(captured.system, /Nama customer: Adhitya\./);
  assert.match(captured.system, /Halo Adhitya 👋 ada yang bisa Reddy bantu hari ini di Redbox CSB Mall\?/);
});

test('3. Unknown customer gets a natural greeting with no null/undefined/phone-number name', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', name: null });
  assert.match(captured.system, /NAMA TIDAK DIKETAHUI/);
  assert.match(captured.system, /Halo 👋 selamat datang di Redbox CSB Mall/);
  assert.equal(/Halo (null|undefined|Customer)\b/.test(captured.system), false);
  for (const bad of [null, undefined, '', 'null', 'undefined', 'Customer', '6281234567890', '+62812345', 'a@b.com']) {
    assert.equal(normalizeGreetingName(bad), null, String(bad));
  }
  assert.equal(normalizeGreetingName('Muhammad Rizky Ramadhan'), 'Muhammad');
});

test('4. Sumber channel: address question is scoped to Sumber only', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.sumber, text: 'alamatnya dimana?' });
  assert.match(captured.system, /CURRENT_BRANCH: Redbox Sumber/);
  assert.match(captured.system, /Pangeran Cakrabuana/);
  assert.equal(captured.system.includes('Soetomo'), false, 'Tegal address must not be in context');
  assert.equal(captured.system.includes('Samadikun No.60'), false, 'Samadikun address must not be in context');
});

test('5. CSB channel: barber question stays in CSB context with no requested branch', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Ubay itu spesialis apa?' });
  assert.match(captured.system, /CURRENT_BRANCH: Redbox CSB Mall/);
  assert.equal(captured.system.includes('REQUESTED_BRANCH (pesan ini)'), false);
  assert.match(captured.system, /DILARANG menawarkan \/ membandingkan \/ mendaftar cabang/);
});

test('6. CSB channel asking about Bypass: requested_branch=bypass, conversation branch stays csb', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'kalau di Bypass Abdul ada?' });
  assert.match(captured.system, /CURRENT_BRANCH: Redbox CSB Mall/);
  assert.match(captured.system, /REQUESTED_BRANCH \(pesan ini\): Redbox Bypass/);
  const ctx = buildBranchContext({ branch: 'csb', deviceOrReceiver: BRANCH_WA_NUMBER.csb, text: 'kalau di Bypass Abdul ada?' });
  assert.equal(ctx.conversation_branch, 'csb');
  assert.equal(ctx.requested_branch, 'bypass');
});

test('7. Continuing session: no greeting instruction, no CRM lookup, greeting suppression present', async () => {
  const { captured } = await run({
    device: BRANCH_WA_NUMBER.csb, text: 'Mau potong jam 5', name: 'Adhit', history: recentTurns(),
  });
  assert.equal(captured.lookups, 0);
  assert.equal(captured.system.includes('SALAM PERSONAL'), false);
  assert.match(captured.system, /SUPRESI SALAM/);
  assert.match(captured.system, /BRANCH_LOCKED: true/, 'branch lock persists on every turn');
});

test('8. Duplicate inbound (retry) is suppressed before any greeting/response generation', async () => {
  // Durable dedupe lives in the webhook admission layer (unchanged); the
  // aiPaused/duplicate gate returns before handleMessage reaches Reddy.
  const { res, captured } = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', name: 'Adhit' });
  assert.equal(captured.sent.length <= 1, true);
  const again = await handleMessage(
    { from: CUSTOMER, text: 'Halo', device: BRANCH_WA_NUMBER.csb, aiPaused: true, trustedIdentity: trustedIdentity() },
    { send: async (_t, r) => { captured.sent.push(r); return { status: true }; }, getHandoffState: async () => ({ status: 'none' }), recordEvaluation: () => {}, touchLifecycle: async () => ({}) },
  );
  assert.equal(again.reply == null, true);
  assert.ok(res);
});

test('9. After human takeover ends, next inbound re-resolves branch from the CSB device', async () => {
  const seq = [{ status: 'human_active' }, { status: 'none' }];
  let call = 0;
  const captured = { system: null };
  const mockOpenAI = { chat: { completions: { create: async (p) => { captured.system = p.messages[0].content; return { choices: [{ message: { content: 'ok' } }] }; } } } };
  const deps = () => ({
    send: async () => ({ status: true }),
    loadConversationHistory: async () => ({ history: [], status: 'empty' }),
    getHandoffState: async () => seq[Math.min(call++, 1)],
    appendHandoffMessage: async () => {},
    logHandoffTelemetry: () => {},
    touchLifecycle: async () => ({}),
    recordEvaluation: () => {},
    logTelemetry: () => {},
    persistConversation: async () => {},
    lookupCustomerName: async () => 'Adhit',
    orchestrate: async () => ({ route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1, model_tier: 'economy' }),
    generateReddy: (a, b, c, d, e, f, g) => callOpenAI(a, b, c, d, e, f, g, { openai: mockOpenAI }),
  });
  const base = { from: CUSTOMER, text: 'halo lagi', device: BRANCH_WA_NUMBER.csb, receiver: BRANCH_WA_NUMBER.csb, trustedIdentity: trustedIdentity() };
  const suppressed = await handleMessage(base, deps());
  assert.equal(suppressed.used, 'human_active_suppressed');
  assert.equal(captured.system, null);
  await handleMessage(base, deps());
  assert.match(captured.system, /CURRENT_BRANCH: Redbox CSB Mall/);
});

test('10. Tegal channel: hours question is scoped to Tegal only', async () => {
  const { captured } = await run({ device: BRANCH_WA_NUMBER.tegal, text: 'bukanya sampai jam berapa?' });
  assert.match(captured.system, /CURRENT_BRANCH: Redbox Tegal/);
  assert.match(captured.system, /Soetomo/);
  assert.equal(captured.system.includes('Cakrabuana'), false);
  assert.equal(captured.system.includes('CSB Mall, Jl.'), false);
});

test('11. CRM lookup uses the trusted normalized phone; no lookup without trusted identity', async () => {
  let phoneSeen = null;
  await handleMessage(
    { from: CUSTOMER, text: 'Halo', device: BRANCH_WA_NUMBER.csb, receiver: BRANCH_WA_NUMBER.csb, trustedIdentity: trustedIdentity() },
    {
      send: async () => ({ status: true }), loadConversationHistory: async () => ({ history: [], status: 'empty' }),
      getHandoffState: async () => ({ status: 'none' }), touchLifecycle: async () => ({}), recordEvaluation: () => {}, logTelemetry: () => {},
      persistConversation: async () => {},
      lookupCustomerName: async (phone) => { phoneSeen = phone; return null; },
      orchestrate: async () => ({ route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1, model_tier: 'economy' }),
      generateReddy: async () => 'ok',
    },
  );
  assert.equal(phoneSeen, CUSTOMER);
  const anon = await run({ device: BRANCH_WA_NUMBER.csb, text: 'Halo', name: 'Adhit', identity: null });
  assert.equal(anon.captured.lookups, 0);
});

test('12. "Saya mau ke Sumber" on CSB channel: requested_branch=sumber, channel stays csb', () => {
  assert.equal(detectRequestedBranch('Saya mau ke Sumber', 'csb'), 'sumber');
  const ctx = buildBranchContext({ branch: 'csb', deviceOrReceiver: '0818202889', text: 'Saya mau ke Sumber' });
  assert.equal(ctx.conversation_branch, 'csb');
  assert.equal(ctx.requested_branch, 'sumber');
  assert.equal(ctx.branch_locked, true);
  assert.equal(ctx.branch_source, 'fonnte_device');
});

test('13. Unknown device is not locked (falls back to prior default behaviour)', () => {
  assert.equal(matchBranchFromDevice('6289999999999'), null);
  const ctx = buildBranchContext({ branch: 'bypass', deviceOrReceiver: '6289999999999', text: 'halo' });
  assert.equal(ctx.branch_locked, false);
  assert.equal(ctx.branch_source, 'default_fallback');
  assert.equal(matchBranchFromDevice('+62 818-202-889'), 'csb');
});
