const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.ORCHESTRATOR_INTERNAL_SECRET = 'test-internal-secret';
process.env.OPENAI_ORCHESTRATOR_API_KEY = 'test-openai-key';

const app = require('../index');
const {
  createAiOrchestratorRoutes,
  orchestratorJsonErrorHandler,
  safeSecretEqual,
} = require('../routes/aiOrchestrator');

async function listen(application) {
  return new Promise((resolve) => {
    const server = application.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('POST /api/ai/orchestrator routes an explicit human request without executing an action', async (t) => {
  const server = await listen(app);
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/orchestrator`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-orchestrator-secret': 'test-internal-secret',
    },
    body: JSON.stringify({ message: 'Saya mau bicara dengan admin' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.trace_id, /^orch_[a-f0-9-]+$/);
  assert.deepEqual(
    { intent: body.intent, agent: body.agent, action: body.action, mode: body.mode },
    {
      intent: 'human_request',
      agent: 'human_handoff',
      action: 'request_human',
      mode: 'classify_only',
    },
  );
  assert.equal(typeof body.confidence, 'number');
});

function createTestApp({ classifier = async () => ({
  intent: 'price_inquiry', agent: 'reddy_agent', action: 'answer_price', confidence: 0.8,
}), env = {
  ORCHESTRATOR_INTERNAL_SECRET: 'test-internal-secret',
  OPENAI_ORCHESTRATOR_API_KEY: 'test-openai-key',
} } = {}) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(orchestratorJsonErrorHandler);
  testApp.use('/api/ai/orchestrator', createAiOrchestratorRoutes({ classifier, env }));
  return testApp;
}

async function post(application, { body = { message: 'berapa harganya?' }, secret = 'test-internal-secret', raw, path = '/api/ai/orchestrator' } = {}) {
  const server = await listen(application);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { 'x-orchestrator-secret': secret }),
      },
      body: raw === undefined ? JSON.stringify(body) : raw,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('missing or wrong internal secret is rejected before classification', async () => {
  let calls = 0;
  const testApp = createTestApp({ classifier: async () => { calls += 1; } });
  assert.deepEqual(await post(testApp, { secret: null }), { status: 401, body: { error: 'unauthorized' } });
  assert.deepEqual(await post(testApp, { secret: 'wrong' }), { status: 401, body: { error: 'unauthorized' } });
  assert.equal(calls, 0);
});

test('missing server secret or dedicated OpenAI key fails closed', async () => {
  const missingSecret = createTestApp({ env: { OPENAI_ORCHESTRATOR_API_KEY: 'key' } });
  const missingKey = createTestApp({ env: { ORCHESTRATOR_INTERNAL_SECRET: 'test-internal-secret', OPENAI_API_KEY: 'shared-key' } });
  assert.deepEqual(await post(missingSecret), { status: 503, body: { error: 'orchestrator_not_configured' } });
  assert.deepEqual(await post(missingKey), { status: 503, body: { error: 'orchestrator_not_configured' } });

  const whitespaceKey = createTestApp({ env: {
    ORCHESTRATOR_INTERNAL_SECRET: 'test-internal-secret',
    OPENAI_ORCHESTRATOR_API_KEY: '   ',
  } });
  assert.deepEqual(await post(whitespaceKey), { status: 503, body: { error: 'orchestrator_not_configured' } });
});

test('secret comparison accepts only exact values regardless of input length', () => {
  assert.equal(safeSecretEqual('same-secret', 'same-secret'), true);
  assert.equal(safeSecretEqual('short', 'a-much-longer-secret'), false);
  assert.equal(safeSecretEqual('same-secrex', 'same-secret'), false);
});

test('empty, non-string, and too-long messages are rejected', async () => {
  const testApp = createTestApp();
  assert.deepEqual(await post(testApp, { body: { message: '   ' } }), { status: 400, body: { error: 'message_required' } });
  assert.deepEqual(await post(testApp, { body: { message: 123 } }), { status: 400, body: { error: 'message_required' } });
  assert.deepEqual(await post(testApp, { body: { message: 'x'.repeat(1001) } }), { status: 413, body: { error: 'message_too_long' } });
});

test('malformed JSON returns a scoped safe 400 response', async () => {
  assert.deepEqual(await post(createTestApp(), { raw: '{bad json' }), {
    status: 400,
    body: { error: 'malformed_json' },
  });
});

test('malformed JSON on a trailing-slash route returns 400 without logging the raw body', async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.map(String).join(' '));
  try {
    assert.deepEqual(await post(app, {
      path: '/api/ai/orchestrator/',
      raw: '{raw-private-marker-88',
    }), { status: 400, body: { error: 'malformed_json' } });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.some((line) => line.includes('raw-private-marker-88')), false);
});

test('route sends only the trimmed message to classifier and never forwards customer_phone', async () => {
  const received = [];
  const testApp = createTestApp({ classifier: async (...args) => {
    received.push(args);
    return { intent: 'booking_status', agent: 'booking_agent', action: 'get_booking_status', confidence: 0.88 };
  } });
  const result = await post(testApp, {
    body: { message: '  cek booking saya  ', customer_phone: '628123456789', channel: 'whatsapp' },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(received, [['cek booking saya']]);
});

test('OpenAI timeout and upstream errors fail safely without leaking details', async () => {
  const timeout = new Error('provider secret timeout detail');
  timeout.code = 'CLASSIFICATION_TIMEOUT';
  const timeoutResult = await post(createTestApp({ classifier: async () => { throw timeout; } }));
  assert.deepEqual(timeoutResult, { status: 504, body: { error: 'classification_timeout' } });

  const upstreamResult = await post(createTestApp({ classifier: async () => { throw new Error('raw provider failure'); } }));
  assert.deepEqual(upstreamResult, { status: 502, body: { error: 'classification_unavailable' } });
});

test('successful response contains only the classify-only contract fields', async () => {
  const result = await post(createTestApp());
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), [
    'action', 'agent', 'confidence', 'intent', 'mode', 'trace_id',
  ]);
  assert.equal(result.body.mode, 'classify_only');
});

test('mounted endpoint does not pass message or customer phone through the general request logger', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await post(app, {
      body: { message: 'admin privacy-marker-77', customer_phone: '628777777777' },
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.some((line) => line.includes('privacy-marker-77') || line.includes('628777777777')), false);
});
