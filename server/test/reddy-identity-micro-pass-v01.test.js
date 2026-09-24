'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage, callOpenAI } = require('../../api/wa/webhook');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const { BRANCH_WA_NUMBER } = require('../services/fonnte');

const CUSTOMER = '6281234567890';
const RAW_DISPLAY_NAME = 'Bos Ganteng 😎';

async function converse({ device, text, rawName = RAW_DISPLAY_NAME, crmName = null, modelFails = false, captured = {}, sent = [] }) {
  const model = {
    chat: { completions: { create: async (params) => {
      captured.system = params.messages.find((m) => m.role === 'system').content;
      if (modelFails) throw new Error('model down');
      return { choices: [{ message: { content: 'ok' } }] };
    } } },
  };
  await handleMessage(
    {
      from: CUSTOMER, name: rawName, text, device, receiver: device,
      trustedIdentity: issueTrustedIdentity({ source: 'whatsapp', verifiedPhone: CUSTOMER }),
    },
    {
      send: async (_to, reply) => { sent.push(reply); return { status: true }; },
      loadConversationHistory: async () => ({ history: [], status: 'empty' }),
      getHandoffState: async () => ({ status: 'none' }),
      touchLifecycle: async () => ({ reopened: false }),
      recordEvaluation: () => {},
      logTelemetry: () => {},
      persistConversation: async () => {},
      lookupCustomerName: async () => crmName,
      orchestrate: async () => ({
        route: 'reddy_agent', agent: 'reddy_agent', intent: 'general_question', action: 'answer', confidence: 1, model_tier: 'economy',
      }),
      generateReddy: (a, b, c, d, e, f, g) => callOpenAI(a, b, c, d, e, f, g, { openai: model }),
    },
  );
  return { sent, captured };
}

test('1. Raw WhatsApp display name is ignored; deterministic greeting uses the CRM name', async () => {
  const { sent } = await converse({ device: BRANCH_WA_NUMBER.csb, text: 'halo', crmName: 'Adhit', modelFails: true });
  assert.ok(sent.length >= 1, 'a deterministic fallback reply was sent');
  assert.match(sent[0], /Halo Adhit/);
  assert.equal(sent[0].includes('Bos Ganteng'), false);
});

test('2. Raw display name present but CRM finds nothing: generic greeting, no display name', async () => {
  const { sent } = await converse({ device: BRANCH_WA_NUMBER.csb, text: 'halo', crmName: null, modelFails: true });
  assert.ok(sent.length >= 1);
  assert.match(sent[0], /Halo Kak,/);
  assert.equal(/Bos|Ganteng|😎/.test(sent[0]), false);
});

test('3. Foreign-language handler uses the trusted CRM name, never the raw display name', async () => {
  const withCrm = await converse({ device: BRANCH_WA_NUMBER.csb, text: 'I want to book a haircut', crmName: 'Adhit' });
  assert.equal(withCrm.sent.length, 1);
  assert.match(withCrm.sent[0], /Adhit/);
  assert.equal(withCrm.sent[0].includes('Bos'), false);

  const noCrm = await converse({ device: BRANCH_WA_NUMBER.csb, text: 'I want to book a haircut', crmName: null });
  assert.equal(/Bos|Ganteng|😎/.test(noCrm.sent[0]), false);
});

test('4. Unknown device: no default branch (Bypass) is presented to the model as verified', async () => {
  const { captured } = await converse({ device: '6289999999999', text: 'Halo', crmName: null });
  const p = captured.system;
  assert.match(p, /BRANCH_LOCKED: false/);
  assert.match(p, /Cabang sesi ini: TIDAK DIKETAHUI/);
  for (const forbidden of [
    'Cabang sesi ini: Redbox Bypass',
    'melayani customer dari',
    'CURRENT_BRANCH: Redbox Bypass',
    'cabang Redbox Bypass',
    'Ahmad Yani',
    'Kapster cabang ini',
  ]) {
    assert.equal(p.includes(forbidden), false, `prompt must not contain: ${forbidden}`);
  }
});

test('5. Known Bypass device still locks to Bypass with full branch facts', async () => {
  const { captured } = await converse({ device: BRANCH_WA_NUMBER.bypass, text: 'Halo', crmName: null });
  const p = captured.system;
  assert.match(p, /CURRENT_BRANCH: Redbox Bypass \(id: bypass\)/);
  assert.match(p, /BRANCH_LOCKED: true/);
  assert.match(p, /Cabang sesi ini: Redbox Bypass/);
  assert.match(p, /Kapster cabang ini/);
});
