'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage } = require('../../api/wa/webhook');

const NON_PRICE_CASES = [
  'Tegal buka jam berapa?',
  'Tegal tutup jam berapa?',
  'jam berapa buka?',
  'jam berapa tutup?',
  'booking jam berapa?',
  'kapster Opan masuk jam berapa?',
  'besok jam berapa?',
  'terakhir booking jam berapa?',
];

function makeDeps() {
  return {
    loadConversationHistory: async () => [],
    orchestrate: async () => ({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: 'operating_hours_inquiry',
      action: 'answer_operating_hours',
      confidence: 1,
      model_tier: 'none',
      response_strategy: 'answer_directly',
    }),
    executeReddy: async () => ({ reply: 'ORCHESTRATOR_OK', sendResult: { status: true } }),
    send: async () => ({ status: true }),
    logTelemetry: () => {},
    resolveKnowledge: () => null,
  };
}

test('P0.2: generic berapa in time/schedule questions does not hit price keyword fast-path', async () => {
  for (const text of NON_PRICE_CASES) {
    const result = await handleMessage({
      from: '628123456789',
      name: 'Kak',
      text,
      branchFromPayload: 'tegal',
    }, makeDeps());

    assert.notEqual(result.used, 'keyword', text);
  }
});

test('P0.2: explicit generic price wording still hits price keyword fast-path', async () => {
  for (const text of ['harga haircut', 'biaya haircut berapa?', 'tarif haircut', 'price haircut']) {
    const result = await handleMessage({
      from: '628123456789',
      name: 'Kak',
      text,
      branchFromPayload: 'tegal',
    }, makeDeps());

    assert.equal(result.used, 'keyword', text);
    assert.match(result.reply, /daftar harga layanan/i, text);
  }
});
