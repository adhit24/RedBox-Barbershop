'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const gatePath = path.resolve(__dirname, '../services/fonnteWebhookTrustGate.js');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const executionPath = path.resolve(__dirname, '../orchestrator/executionService.js');
const {
  BRANCH_SECRET_ENV,
  emitRedboxWebhookTrust,
  verifyRedboxWebhookTrustQuery,
  isVerifiedRedboxWebhookTrust,
} = require(gatePath);

const CSB_SECRET = 'csb-test-secret-000000000000000000000000001';
const TEGAL_SECRET = 'tegal-test-secret-000000000000000000000002';
const SUMBER_SECRET = 'sumber-test-secret-00000000000000000000003';

// ── ASYNC-SAFE TEST ENV HELPER ──────────────────────────────────────────────
function withTestEnv(envSecrets, fn) {
  const previousEnv = {};
  for (const [key, value] of Object.entries(envSecrets)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const key of Object.keys(envSecrets)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
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

// ── ASYNC TEST ENV HELPER REGRESSION TEST ───────────────────────────────────
test('ASYNC ENV HELPER: process.env remains set across an awaited async boundary and is restored afterward', async () => {
  assert.equal(process.env.WA_WEBHOOK_SECRET_SUMBER, undefined);
  let checkedInsideAsync = false;

  await withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(process.env.WA_WEBHOOK_SECRET_SUMBER, SUMBER_SECRET);
    checkedInsideAsync = true;
  });

  assert.equal(checkedInsideAsync, true);
  assert.equal(process.env.WA_WEBHOOK_SECRET_SUMBER, undefined);
});

// ── BODY OWN-PROPERTY & ACCESSOR HARDENING TESTS ───────────────────────────
test('BODY HARDENING: inherited properties, getter accessors, and custom prototypes fail closed untrusted', () => {
  withTestEnv({ WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET }, () => {
    // 1. Inherited properties via Object.create
    const inheritedBody = Object.create({
      device: '0818202599',
      'webhook-secret-key': SUMBER_SECRET,
    });
    assert.equal(verifyRedboxWebhookTrustQuery(null, inheritedBody).status, 'malformed');

    // 2. Getter accessors
    const getterBody = {
      device: '0818202599',
      get 'webhook-secret-key'() { return SUMBER_SECRET; },
    };
    assert.equal(verifyRedboxWebhookTrustQuery(null, getterBody).status, 'malformed');

    // 3. Custom prototype
    const customProto = Object.create({ custom: true });
    customProto.device = '0818202599';
    customProto['webhook-secret-key'] = SUMBER_SECRET;
    assert.equal(verifyRedboxWebhookTrustQuery(null, customProto).status, 'malformed');

    // 4. Throwing getter
    const throwingBody = {
      device: '0818202599',
      get 'webhook-secret-key'() { throw new Error('getter exception'); },
    };
    assert.equal(verifyRedboxWebhookTrustQuery(null, throwingBody).status, 'malformed');
  });
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

// ── LIVE WEBHOOK RUNTIME LEVEL INTEGRATION TESTS WITH CRM SPY ───────────────
test('LIVE WEBHOOK RUNTIME PROOF: valid Fonnte body secret executes CRM points, whereas invalid/untrusted paths DO NOT', async () => {
  await withTestEnv({
    WA_WEBHOOK_SECRET_SUMBER: SUMBER_SECRET,
    WA_WEBHOOK_SECRET_CSB: CSB_SECRET,
  }, async () => {
    Object.keys(require.cache).forEach(k => delete require.cache[k]);

    const { isTrustedIdentity } = require('../identity/trustedIdentity');
    const executionService = require(executionPath);

    const crmAgentCalls = [];
    const originalExecute = executionService.executeOrchestration;

    executionService.executeOrchestration = async (userIntent, rawInput, context) => {
      if (!isTrustedIdentity(context?.trustedIdentity)) {
        return { execution_status: 'unauthorized', result: null };
      }
      crmAgentCalls.push({ userIntent, rawInput, context });
      return {
        execution_status: 'success',
        intent: 'points_inquiry',
        result: { data: { points_balance: 150 } },
      };
    };

    try {
      const webhook = require(webhookPath);

      // 1. Positive Case: Valid Body Secret + Valid SUMBER Device
      const { response: res1, output: out1 } = createResponseHarness();
      const validReq = {
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

      await webhook(validReq, res1);

      assert.equal(out1.statusCode, 200);
      assert.equal(crmAgentCalls.length, 1, 'CRM points must be executed exactly once for valid trusted request');
      assert.equal(crmAgentCalls[0].userIntent.intent, 'points_inquiry');
      assert.equal(crmAgentCalls[0].context.projection, 'CUSTOMER_SELF');
      assert.equal(isTrustedIdentity(crmAgentCalls[0].context.trustedIdentity), true);
      assert.equal(crmAgentCalls[0].context.trustedIdentity.phone, '6281234567890');

      crmAgentCalls.length = 0;

      // 2. Negative Case A: Wrong Body Secret + Valid Query Fallback (NO DOWNGRADE)
      const { response: res2 } = createResponseHarness();
      const wrongBodyReq = {
        method: 'POST',
        query: { rb_branch: 'sumber', rb_key: SUMBER_SECRET },
        body: {
          device: '0818202599',
          'webhook-secret-key': 'attacker-wrong-secret-0000000000000001',
          sender: '6281234567890',
          message: 'poin saya berapa?',
          type: 'text',
        },
      };
      await webhook(wrongBodyReq, res2);
      assert.equal(crmAgentCalls.length, 0, 'Wrong body secret MUST NOT execute CRM points even if valid query secret is present');

      // 3. Negative Case B: Wrong Device (Cross-branch device)
      const { response: res3 } = createResponseHarness();
      const wrongDeviceReq = {
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
      await webhook(wrongDeviceReq, res3);
      assert.equal(crmAgentCalls.length, 0, 'Cross-branch device MUST NOT execute CRM points');

      // 4. Fallback Case: Missing Body Secret + Valid Query Fallback
      const { response: res4 } = createResponseHarness();
      const legacyQueryReq = {
        method: 'POST',
        query: { rb_branch: 'csb', rb_key: CSB_SECRET },
        body: {
          device: '0818202889',
          sender: '6281234567890',
          message: 'poin saya berapa?',
          type: 'text',
        },
      };
      await webhook(legacyQueryReq, res4);
      assert.equal(crmAgentCalls.length, 1, 'Legacy query fallback MUST execute CRM points when body secret is absent');
      assert.equal(crmAgentCalls[0].context.trustedIdentity.phone, '6281234567890');

    } finally {
      executionService.executeOrchestration = originalExecute;
    }
  });
});
