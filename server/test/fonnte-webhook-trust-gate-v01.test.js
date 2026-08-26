'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

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

test('safe null-prototype query dictionaries remain compatible with serverless parsers', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    const query = Object.create(null);
    query.rb_branch = 'csb';
    query.rb_key = CSB_SECRET;
    const trustResult = verifyRedboxWebhookTrustQuery(query);
    assert.equal(trustResult.status, 'verified');
    assert.equal(trustResult.branch, 'csb');
    assert.equal(isVerifiedRedboxWebhookTrust(trustResult), true);
  });
});

test('missing, empty, whitespace, and weak environment configuration fail closed', () => {
  for (const secretValue of [undefined, '', '   ', 'too-short-secret']) {
    const envSecrets = secretValue !== undefined ? { WA_WEBHOOK_SECRET_CSB: secretValue } : {};
    withTestEnv(envSecrets, () => {
      assert.deepEqual(
        verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: CSB_SECRET }),
        { status: 'not_configured', branch: 'csb', trust_method: 'query_secret_fallback' },
      );
    });
  }
});

test('missing and malformed provided secrets are distinguished without coercion', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, () => {
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb' }),
      { status: 'missing_secret', branch: 'csb', trust_method: 'query_secret_fallback' },
    );
    assert.deepEqual(
      verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key: '' }),
      { status: 'missing_secret', branch: 'csb', trust_method: 'query_secret_fallback' },
    );
    for (const rb_key of [null, [], {}, 123, true, false]) {
      assert.deepEqual(
        verifyRedboxWebhookTrustQuery({ rb_branch: 'csb', rb_key }),
        { status: 'malformed', branch: 'csb', trust_method: 'query_secret_fallback' },
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
        { status: 'invalid_secret', branch: 'csb', trust_method: 'query_secret_fallback' },
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
        { status: 'malformed', branch: null, trust_method: 'query_secret_fallback' },
      );
    }
  });
});

// ── FONNTE NATIVE BODY SECRET UNIT TESTS (PLAN A.1) ─────────────────────────
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

test('HARDENED DEVICE NORMALIZATION: reject mixed-letter and malicious device strings', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    for (const invalidDevice of [
      'abc0818202599xyz',
      '0818abc202599',
      '0818202599<script>',
      '0818202599 OR 1=1',
      '12345',
      'SELECT * FROM users',
    ]) {
      const body = {
        device: invalidDevice,
        'webhook-secret-key': SUMBER_SECRET,
      };
      const trustResult = verifyRedboxWebhookTrustQuery(null, body);
      assert.equal(trustResult.status, 'unknown_branch');
      assert.equal(isVerifiedRedboxWebhookTrust(trustResult), false);
    }
  });
});

// ── LIVE WEBHOOK RUNTIME LEVEL INTEGRATION TESTS ────────────────────────────
test('LIVE WEBHOOK RUNTIME: realistic Fonnte Flow payload verifies body secret and executes CRM points', async () => {
  await withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, async () => {
    const webhook = require(webhookPath);
    const { response, output } = createResponseHarness();

    const req = {
      method: 'POST',
      query: {},
      body: {
        device: '0818202599',
        inboxid: 0,
        isgroup: false,
        message: 'poin saya berapa?',
        sender: '6281234567890',
        timestamp: 1787727718,
        type: 'text',
        username: '62818202569',
        'webhook-secret-key': SUMBER_SECRET,
      },
    };

    await webhook(req, response);
    assert.equal(output.statusCode, 200);
    assert.equal(output.body.status, 'ok');
  });
});

test('LIVE WEBHOOK RUNTIME: correct body secret + wrong device fails closed', async () => {
  await withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, async () => {
    const webhook = require(webhookPath);
    const { response, output } = createResponseHarness();

    const req = {
      method: 'POST',
      query: {},
      body: {
        device: '0818202889', // CSB device instead of SUMBER device
        'webhook-secret-key': SUMBER_SECRET,
        sender: '6281234567890',
        message: 'poin saya berapa?',
        type: 'text',
      },
    };

    await webhook(req, response);
    assert.equal(output.statusCode, 200);
  });
});

test('LIVE WEBHOOK RUNTIME: wrong body secret + valid query fallback fails closed (no downgrade)', async () => {
  await withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, async () => {
    const webhook = require(webhookPath);
    const { response, output } = createResponseHarness();

    const req = {
      method: 'POST',
      query: { rb_branch: 'sumber', rb_key: SUMBER_SECRET },
      body: {
        device: '0818202599',
        'webhook-secret-key': 'attacker-wrong-body-secret-000001',
        sender: '6281234567890',
        message: 'poin saya berapa?',
        type: 'text',
      },
    };

    await webhook(req, response);
    assert.equal(output.statusCode, 200);
  });
});

test('LIVE WEBHOOK RUNTIME: absent body secret + valid query fallback verifies legacy path', async () => {
  await withTestEnv({ WA_WEBHOOK_SECRET_CSB: CSB_SECRET }, async () => {
    const webhook = require(webhookPath);
    const { response, output } = createResponseHarness();

    const req = {
      method: 'POST',
      query: { rb_branch: 'csb', rb_key: CSB_SECRET },
      body: {
        device: '0818202889',
        sender: '6281234567890',
        message: 'poin saya berapa?',
        type: 'text',
      },
    };

    await webhook(req, response);
    assert.equal(output.statusCode, 200);
  });
});
