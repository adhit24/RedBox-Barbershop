'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const gatePath = path.resolve(__dirname, '../services/fonnteWebhookTrustGate.js');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const {
  BRANCH_SECRET_ENV,
  emitRedboxWebhookTrust,
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
  __verifyRedboxWebhookTrustQueryForTest,
} = require(gatePath);

const CSB_SECRET = 'csb-test-secret-000000000000000000000000001';
const TEGAL_SECRET = 'tegal-test-secret-000000000000000000000002';

// Helper for test verification using process.env setup/restore
function withTestEnv(envSecrets, fn) {
  const previousEnv = {};
  for (const [key, value] of Object.entries(envSecrets)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(envSecrets)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

function createResponseHarness() {
  const output = { statusCode: 200, headers: {}, body: null };
  const response = {
    setHeader(name, value) { output.headers[name] = value; return response; },
    status(code) { output.statusCode = code; return response; },
    json(payload) { output.body = payload; return response; },
    end() { return response; },
  };
  return { response, output };
}

function loadWebhookWithRuntimeMocks() {
  return require(webhookPath);
}

// ── MANDATORY SECURITY REGRESSION TEST (FINDING 3) ──────────────────────────
test('production verifier accepts query ONLY (arity 1) and ignores caller-supplied fake env objects', () => {
  assert.equal(verifyRedboxWebhookTrustQuery.length, 1);
  const fakeEnv = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  
  // process.env has NO CSB secret set
  const res = verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }, fakeEnv);
  assert.equal(res.status, 'not_configured');
  assert.equal(isVerifiedRedboxWebhookTrust(res), false);
});

test('exact CSB branch and Redbox-managed secret verify via process.env', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const trustResult = verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET });
    assert.deepEqual(trustResult, { status: 'verified', branch: 'csb' });
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('all five exact lowercase branch domains use only their dedicated environment variable', () => {
  for (const [branch, envVar] of Object.entries(BRANCH_SECRET_ENV)) {
    withTestEnv({ [envVar]: CSB_SECRET }, () => {
      const trustResult = verifyRedboxWebhookTrustQuery({ rb_branch: branch, rb_key: CSB_SECRET });
      assert.deepEqual(trustResult, { status: 'verified', branch });
      assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
    });
  }
});

test('safe null-prototype query dictionaries remain compatible with serverless parsers', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const query = Object.create(null);
    query.rb_branch = 'csb';
    query.rb_key = CSB_SECRET;
    const trustResult = verifyRedboxWebhookTrustQuery(query);
    assert.deepEqual(trustResult, { status: 'verified', branch: 'csb' });
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('missing, empty, whitespace, and weak environment configuration fail closed', () => {
  for (const secretValue of [undefined, '', '   ', 'too-short-secret']) {
    const envSecrets = secretValue !== undefined ? { WA_WEBHOOK_SECRET_CSB: secretValue } : {};
    withTestEnv(envSecrets, () => {
      assert.deepEqual(
        verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }),
        { status: 'not_configured', branch: 'csb' },
      );
    });
  }
});

test('missing and malformed provided secrets are distinguished without coercion', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb' }),
      { status: 'missing_secret', branch: 'csb' },
    );
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: '' }),
      { status: 'missing_secret', branch: 'csb' },
    );
    for (const rb_key of [null, [], {}, 123, true, false]) {
      assert.deepEqual(
        verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key }),
        { status: 'malformed', branch: 'csb' },
      );
    }
  });
});

test('prefix, suffix, length, spaces, and Unicode lookalikes never verify', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
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
        verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key }),
        { status: 'invalid_secret', branch: 'csb' },
      );
    }
  });
});

test('branch secrets are bound to their exact domain with no Bypass fallback', () => {
  withTestEnv({
    WA_WEBHOOK_SECRET_BYPASS: 'bypass-test-secret-000000000000000000000001',
    WA_WEBHOOK_SECRET_CSB: CSB_SECRET,
    WA_WEBHOOK_SECRET_TEGAL: TEGAL_SECRET,
  }, () => {
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }).status, 'verified');
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'tegal', rb_key: TEGAL_SECRET }).status, 'verified');
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'tegal', rb_key: CSB_SECRET }).status, 'invalid_secret');
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: TEGAL_SECRET }).status, 'invalid_secret');
  });
});

test('unknown, missing, case-variant, and Unicode-manipulated branch values fail closed', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_key: CSB_SECRET }).status, 'unknown_branch');
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'unknown', rb_key: CSB_SECRET }).status, 'unknown_branch');
    assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch: 'CSB', rb_key: CSB_SECRET }).status, 'unknown_branch');
    for (const rb_branch of ['__proto__', 'constructor', 'toString']) {
      assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch, rb_key: CSB_SECRET }).status, 'unknown_branch');
    }
    for (const rb_branch of ['', '   ', null, [], {}, 123, true]) {
      assert.equal(verifyRedboxWebhookTrustQuery({ rb_branch, rb_key: CSB_SECRET }).status, 'malformed');
    }
  });
});

test('query input rejects inherited, custom-prototype, accessors, symbols, extras, and duplicate arrays', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const inherited = Object.create({ rb_branch: 'csb', rb_key: CSB_SECRET });
    const customPrototype = Object.create({ attacker: true });
    customPrototype.rb_branch = 'csb';
    customPrototype.rb_key = CSB_SECRET;

    for (const query of [
      inherited, customPrototype,
      { rb_branch: ['csb', 'tegal'], rb_key: CSB_SECRET },
      null, [], 'rb_branch=csb',
    ]) {
      assert.deepEqual(
        verifyRedboxWebhookTrustQuery(query),
        { status: 'malformed', branch: null },
      );
    }
  });
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
});

test('raw/untrusted webhook cannot directly access CRM without genuine TrustedIdentity', () => {
  const source = fs.readFileSync(webhookPath, 'utf8');
  assert.match(source, /fonnteWebhookTrustGate/);
  assert.match(source, /verifyRedboxWebhookTrustQuery/);
  assert.match(source, /emitRedboxWebhookTrust/);
  assert.ok(source.indexOf('verifyRedboxWebhookTrustQuery') < source.indexOf('coerceBody(req.body, req)'));
  for (const forbidden of ['crmAgent', 'customer360Service', 'customerIdentity']) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`));
  }
});
