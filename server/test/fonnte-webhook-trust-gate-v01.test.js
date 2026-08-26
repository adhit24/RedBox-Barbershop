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
} = require(gatePath);

const CSB_SECRET = 'csb-test-secret-000000000000000000000000001';
const TEGAL_SECRET = 'tegal-test-secret-000000000000000000000002';
const SUMBER_SECRET = 'sumber-test-secret-00000000000000000000003';

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
test('production verifier accepts query ONLY (arity 1) when body is absent and ignores caller-supplied fake env objects', () => {
  const fakeEnv = { WA_WEBHOOK_SECRET_CSB: CSB_SECRET };
  
  // process.env has NO CSB secret set
  const res = verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }, null, fakeEnv);
  assert.equal(res.status, 'not_configured');
  assert.equal(isVerifiedRedboxWebhookTrust(res), false);
});

test('exact CSB branch and Redbox-managed secret verify via process.env', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const trustResult = verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET });
    assert.equal(trustResult.status, 'verified');
    assert.equal(trustResult.branch, 'csb');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('all five exact lowercase branch domains use only their dedicated environment variable', () => {
  for (const [branch, envVar] of Object.entries(BRANCH_SECRET_ENV)) {
    withTestEnv({ [envVar]: CSB_SECRET }, () => {
      const trustResult = verifyRedboxWebhookTrustQuery({ rb_branch: branch, rb_key: CSB_SECRET });
      assert.equal(trustResult.status, 'verified');
      assert.equal(trustResult.branch, branch);
      assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
    });
  }
});

// ── FONNTE NATIVE BODY SECRET TESTS (PLAN A.1) ──────────────────────────────
test('A. verified Fonnte body secret + valid SUMBER device MUST verify trust', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    const body = {
      device: '0818202599',
      'webhook-secret-key': SUMBER_SECRET,
      sender: '6281234567890',
      message: 'test flow sumber',
    };
    const trustResult = verifyRedboxWebhookTrustQuery(null, body);

    assert.deepEqual(trustResult, {
      status: 'verified',
      branch: 'sumber',
      trust_method: 'fonnte_body_secret',
    });
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('B. wrong webhook-secret-key for valid device MUST return invalid_secret untrusted', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    const body = {
      device: '0818202599',
      'webhook-secret-key': 'wrong-sumber-secret-000000000000000000001',
    };
    const trustResult = verifyRedboxWebhookTrustQuery(null, body);

    assert.equal(trustResult.status, 'invalid_secret');
    assert.equal(trustResult.branch, 'sumber');
    assert.equal(trustResult.trust_method, 'fonnte_body_secret');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
  });
});

test('D. malformed webhook-secret-key MUST fail closed untrusted', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    for (const secretVal of [null, [], {}, 123, true, false]) {
      const body = {
        device: '0818202599',
        'webhook-secret-key': secretVal,
      };
      const trustResult = verifyRedboxWebhookTrustQuery(null, body);

      assert.equal(trustResult.status, 'malformed');
      assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
    }
  });
});

test('E. cross-branch device (SUMBER secret + CSB device) MUST fail closed', () => {
  withTestEnv({
    WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET,
    WA_WEBHOOK_SECRET_CSB: CSB_SECRET,
  }, () => {
    const body = {
      device: '0818202889',
      'webhook-secret-key': SUMBER_SECRET,
    };
    const trustResult = verifyRedboxWebhookTrustQuery(null, body);

    assert.equal(trustResult.status, 'invalid_secret');
    assert.equal(trustResult.branch, 'csb');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
  });
});

test('F. cross-branch secret (CSB secret + SUMBER device) MUST fail closed', () => {
  withTestEnv({
    WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET,
    WA_WEBHOOK_SECRET_CSB: CSB_SECRET,
  }, () => {
    const body = {
      device: '0818202599',
      'webhook-secret-key': CSB_SECRET,
    };
    const trustResult = verifyRedboxWebhookTrustQuery(null, body);

    assert.equal(trustResult.status, 'invalid_secret');
    assert.equal(trustResult.branch, 'sumber');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
  });
});

test('I. NO DOWNGRADE ATTACK: wrong body secret + valid query secret MUST fail closed untrusted', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    const query = { rb_branch: 'sumber', rb_key: SUMBER_SECRET };
    const body = {
      device: '0818202599',
      'webhook-secret-key': 'attacker-wrong-secret-0000000000000001',
    };

    const trustResult = verifyRedboxWebhookTrustQuery(query, body);

    assert.equal(trustResult.status, 'invalid_secret');
    assert.equal(trustResult.trust_method, 'fonnte_body_secret');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
  });
});

test('J. LEGACY FALLBACK: absent body secret + valid query secret MUST fall back to query secret', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const query = { rb_branch: 'csb', rb_key: CSB_SECRET };
    const body = {
      device: '0818202889',
      sender: '6281234567890',
      message: 'legacy query path',
    };

    const trustResult = verifyRedboxWebhookTrustQuery(query, body);

    assert.equal(trustResult.status, 'verified');
    assert.equal(trustResult.branch, 'csb');
    assert.equal(trustResult.trust_method, 'query_secret_fallback');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('K. LOG SAFETY: safe logging never includes webhook-secret-key, sender, message, or inboxid', () => {
  const calls = [];
  const emitted = emitRedboxWebhookTrust({
    status: 'verified',
    branch: 'sumber',
    trust_method: 'fonnte_body_secret',
    'webhook-secret-key': SUMBER_SECRET,
    sender: '6281234567890',
    message: 'secret chat',
    inboxid: 12345,
  }, { info: (...args) => calls.push(args) });

  assert.deepEqual(calls, [['[WAWebhookTrust]', {
    trust_status: 'verified',
    branch: 'sumber',
    trust_method: 'fonnte_body_secret',
  }]]);
  const serialized = JSON.stringify(calls);
  for (const prohibited of [SUMBER_SECRET, '6281234567890', 'secret chat', '12345', 'webhook-secret-key']) {
    assert.equal(serialized.includes(prohibited), false);
  }
});
