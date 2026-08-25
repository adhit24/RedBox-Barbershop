'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const {
  BRANCH_SECRET_ENV,
  emitRedboxWebhookTrust,
  verifyRedboxWebhookTrustQuery,
} = require('../services/fonnteWebhookTrustGate');

const CSB_SECRET = 'csb-test-secret-0000000000000000000000000001';
const TEGAL_SECRET = 'tegal-test-secret-0000000000000000000000001';
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');

function loadWebhookWithRuntimeMocks() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent && parent.filename === webhookPath) {
      if (request === '../../server/services/fonnte') {
        return { sendWA: async () => ({ status: true }), detectBranchFromNumber: () => 'csb' };
      }
      if (request === '../../server/services/fonnteWebhookVerifier') {
        return {
          inspectFonnteWebhookShadow: () => ({ event_type: 'personal_message' }),
          emitFonnteWebhookShadow: () => ({}),
        };
      }
      if (request === '../../server/services/bookingNotificationOutbox') {
        return { reconcileCustomerNotificationDelivery: async () => ({ matched: false }) };
      }
      if (request === '../../server/whatsapp-ai/services/bookingStatusService') {
        return { STATUS: { CONFIRMED: 'CONFIRMED' }, getCustomerBookingStatus: async () => ({ status: 'UNKNOWN' }) };
      }
      if (request === 'openai') {
        return class OpenAITestDouble {
          constructor() {
            this.chat = { completions: { create: async () => ({ choices: [] }) } };
          }
        };
      }
      if (request === '@supabase/supabase-js') {
        return { createClient: () => null };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[webhookPath];
    return require(webhookPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createResponseHarness() {
  const output = { statusCode: null, body: null, ended: false };
  return {
    output,
    response: {
      headersSent: false,
      setHeader() {},
      status(code) { output.statusCode = code; return this; },
      json(body) { output.body = body; this.headersSent = true; return this; },
      end() { output.ended = true; this.headersSent = true; return this; },
    },
  };
}

test('exact CSB branch and Redbox-managed secret verify', () => {
  const result = verifyRedboxWebhookTrustQuery(
    { rb_branch: 'csb', rb_key: CSB_SECRET },
    { WA_WEBHOOK_SECRET_CSB: CSB_SECRET },
  );

  assert.deepEqual(result, { status: 'verified', branch: 'csb' });
  assert.equal(Object.isFrozen(result), true);
});

test('all five exact lowercase branch domains use only their dedicated environment variable', () => {
  for (const [branch, envName] of Object.entries(BRANCH_SECRET_ENV)) {
    const secret = `${branch}-dedicated-test-secret-0000000000000000000001`;
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: branch, rb_key: secret }, { [envName]: secret }),
      { status: 'verified', branch },
    );
  }
});

test('safe null-prototype query dictionaries remain compatible with serverless parsers', () => {
  const query = Object.create(null);
  query.rb_branch = 'csb';
  query.rb_key = CSB_SECRET;
  assert.deepEqual(
    verifyRedboxWebhookTrustQuery(query, { WA_WEBHOOK_SECRET_CSB: CSB_SECRET }),
    { status: 'verified', branch: 'csb' },
  );
});

test('missing, empty, whitespace, and weak environment configuration fail closed', () => {
  for (const configured of [undefined, '', '   ', 'too-short']) {
    const env = configured === undefined ? {} : { WA_WEBHOOK_SECRET_CSB: configured };
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }, env),
      { status: 'not_configured', branch: 'csb' },
    );
  }
});

test('missing and malformed provided secrets are distinguished without coercion', () => {
  const env = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  assert.deepEqual(
    verifyRedboxWebhookTrustQuery({ rb_branch: 'csb' }, env),
    { status: 'missing_secret', branch: 'csb' },
  );
  assert.deepEqual(
    verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: '' }, env),
    { status: 'missing_secret', branch: 'csb' },
  );
  for (const rb_key of [null, [], {}, 123, true, false]) {
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key }, env),
      { status: 'malformed', branch: 'csb' },
    );
  }
});

test('prefix, suffix, length, spaces, and Unicode lookalikes never verify', () => {
  const env = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  for (const rb_key of [
    CSB_SECRET.slice(0, -6),
    CSB_SECRET.slice(6),
    `${CSB_SECRET}x`,
    ` ${CSB_SECRET}`,
    `${CSB_SECRET} `,
    CSB_SECRET.replace('c', '\u0441'),
    'wrong-test-secret-000000000000000000000000001',
  ]) {
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key }, env),
      { status: 'invalid_secret', branch: 'csb' },
    );
  }
});

test('branch secrets are bound to their exact domain with no Bypass fallback', () => {
  const env = {
    WA_WEBHOOK_SECRET_BYPASS: 'bypass-test-secret-000000000000000000000001',
    WA_WEBHOOK_SECRET_CSB: CSB_SECRET,
    WA_WEBHOOK_SECRET_TEGAL: TEGAL_SECRET,
  };
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }, env).status, 'verified');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'tegal', rb_key: TEGAL_SECRET }, env).status, 'verified');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'tegal', rb_key: CSB_SECRET }, env).status, 'invalid_secret');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: TEGAL_SECRET }, env).status, 'invalid_secret');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: env.WA_WEBHOOK_SECRET_BYPASS }, env).status, 'invalid_secret');
});

test('unknown, missing, case-variant, and Unicode-manipulated branch values fail closed', () => {
  const env = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_key: CSB_SECRET }, env).status, 'unknown_branch');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'unknown', rb_key: CSB_SECRET }, env).status, 'unknown_branch');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'CSB', rb_key: CSB_SECRET }, env).status, 'unknown_branch');
  assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'c\u0455b', rb_key: CSB_SECRET }, env).status, 'unknown_branch');
  for (const rb_branch of ['__proto__', 'constructor', 'toString']) {
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch, rb_key: CSB_SECRET }, env).status, 'unknown_branch');
  }
  for (const rb_branch of ['', '   ', null, [], {}, 123, true]) {
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch, rb_key: CSB_SECRET }, env).status, 'malformed');
  }
});

test('query input rejects inherited, custom-prototype, accessors, symbols, extras, and duplicate arrays', () => {
  const env = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  const inherited = Object.create({ rb_branch: 'csb', rb_key: CSB_SECRET });
  const customPrototype = Object.create({ attacker: true });
  customPrototype.rb_branch = 'csb';
  customPrototype.rb_key = CSB_SECRET;
  const accessor = { rb_branch: 'csb' };
  Object.defineProperty(accessor, 'rb_key', { enumerable: true, get: () => CSB_SECRET });
  const throwingGetter = { rb_branch: 'csb' };
  Object.defineProperty(throwingGetter, 'rb_key', {
    enumerable: true,
    get() { throw new Error('must not escape'); },
  });
  const symbolKey = { rb_branch: 'csb', rb_key: CSB_SECRET, [Symbol('secret')]: CSB_SECRET };
  const extra = { rb_branch: 'csb', rb_key: CSB_SECRET, authenticated: true };

  for (const query of [
    inherited, customPrototype, accessor, throwingGetter, symbolKey, extra,
    { rb_branch: ['csb', 'tegal'], rb_key: CSB_SECRET },
    null, [], 'rb_branch=csb',
  ]) {
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery(query, env),
      { status: 'malformed', branch: null },
    );
  }
  assert.deepEqual(
    verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: [CSB_SECRET, TEGAL_SECRET] }, env),
    { status: 'malformed', branch: 'csb' },
  );
});

test('safe trust logging emits status and branch only', () => {
  const calls = [];
  const secret = CSB_SECRET;
  const rawUrl = `/api/wa/webhook?rb_branch=csb&rb_key=${secret}`;
  const emitted = emitRedboxWebhookTrust({
    status: 'verified', branch: 'csb', secret, sender: '628111111111', rawUrl,
  }, { info: (...args) => calls.push(args) });

  assert.deepEqual(calls, [['[WAWebhookTrust]', { trust_status: 'verified', branch: 'csb' }]]);
  assert.deepEqual(emitted, calls[0][1]);
  const serialized = JSON.stringify(calls);
  for (const prohibited of [secret, rawUrl, '628111111111', 'rb_key']) {
    assert.equal(serialized.includes(prohibited), false);
  }
});

test('source documents URL-secret limitations and never parses or logs a raw URL', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../services/fonnteWebhookTrustGate.js'),
    'utf8',
  );
  assert.match(source, /not a Fonnte[\s\S]*signature/);
  assert.match(source, /access infrastructure/);
  assert.doesNotMatch(source, /req\.(?:url|originalUrl)|new URL\s*\(|console\.(?:log|info|warn|error)\s*\(/);
});

test('webhook evaluates Redbox trust early without creating an identity or CRM path', () => {
  const source = fs.readFileSync(webhookPath, 'utf8');
  assert.match(source, /fonnteWebhookTrustGate/);
  assert.match(source, /verifyRedboxWebhookTrustQuery/);
  assert.match(source, /emitRedboxWebhookTrust/);
  assert.ok(source.indexOf('verifyRedboxWebhookTrustQuery') < source.indexOf('coerceBody(req.body, req)'));
  for (const forbidden of ['whatsappIdentityAdapter', 'issueTrustedIdentity', 'executeOrchestration', 'get_points', 'crmAgent']) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`));
  }
});

test('missing, wrong, and valid Redbox secrets all preserve the existing webhook handler path', async () => {
  const handler = loadWebhookWithRuntimeMocks();
  const previousSecret = process.env.WA_WEBHOOK_SECRET_CSB;
  process.env.WA_WEBHOOK_SECRET_CSB = CSB_SECRET;
  const infoCalls = [];
  const originalInfo = console.info;
  console.info = (...args) => infoCalls.push(args);
  try {
    const cases = [
      { query: undefined, expectedTrust: 'unknown_branch' },
      { query: { rb_branch: 'csb', rb_key: 'wrong-test-secret-000000000000000000000000001' }, expectedTrust: 'invalid_secret' },
      { query: { rb_branch: 'csb', rb_key: CSB_SECRET }, expectedTrust: 'verified' },
    ];
    for (const [index, sample] of cases.entries()) {
      const { response, output } = createResponseHarness();
      await handler({
        method: 'POST',
        query: sample.query,
        body: {
          sender: '6281111111111',
          device: '6281111111111',
          message: 'legacy bot path',
          id: `trust-gate-runtime-${index}`,
          isFromMe: true,
        },
      }, response);
      assert.equal(output.statusCode, 200);
      assert.deepEqual(output.body, { status: 'ignored', reason: 'outgoing' });
      assert.equal(infoCalls.at(-1)[0], '[WAWebhookTrust]');
      assert.equal(infoCalls.at(-1)[1].trust_status, sample.expectedTrust);
    }
  } finally {
    console.info = originalInfo;
    if (previousSecret === undefined) delete process.env.WA_WEBHOOK_SECRET_CSB;
    else process.env.WA_WEBHOOK_SECRET_CSB = previousSecret;
  }

  const serializedLogs = JSON.stringify(infoCalls);
  assert.equal(serializedLogs.includes(CSB_SECRET), false);
  assert.equal(serializedLogs.includes('6281111111111'), false);
  assert.equal(serializedLogs.includes('rb_key'), false);
});

test('admin, human takeover, branch routing, and outbound token selection remain structurally unchanged', () => {
  const source = fs.readFileSync(webhookPath, 'utf8');
  assert.match(source, /handleAdminCommand\(sender, message, device\)/);
  assert.match(source, /isHumanTakeover\(sender\)/);
  assert.match(source, /branchFromPayload \|\| detectBranchFromNumber/);
  assert.match(source, /sendWA\(sender,/);
  assert.doesNotMatch(source, /WA_WEBHOOK_SECRET_BYPASS\s*\|\|/);
});
