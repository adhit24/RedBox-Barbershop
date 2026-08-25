'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const verifierPath = path.resolve(__dirname, '../services/fonnteWebhookVerifier.js');
const webhookSource = fs.readFileSync(webhookPath, 'utf8');

function getBlock(source) {
  const start = source.indexOf("if (req.method === 'GET')");
  const end = source.indexOf("if (req.method !== 'POST')", start);
  assert.notEqual(start, -1, 'GET handler must exist');
  assert.notEqual(end, -1, 'POST method guard must exist');
  return source.slice(start, end);
}

test('GET exposes only a minimal health response', () => {
  const getBlockSource = getBlock(webhookSource);
  assert.match(getBlockSource, /service:\s*['"]redbox-wa-webhook['"]/);
  assert.match(getBlockSource, /ok:\s*true/);

  for (const forbidden of [
    'test_msg', 'debug', 'conv_dump', 'reset_history', 'db_dump', 'db_test',
    'paused_list', 'resume_ai', 'send_to', 'send_msg', 'callOpenAI', 'sendWA',
    'getHistory', 'clearHistory', 'persistMessageStatus', 'getDeviceInfo',
  ]) {
    assert.doesNotMatch(getBlockSource, new RegExp(`\\b${forbidden}\\b`), `${forbidden} must not be reachable over GET`);
  }
});

test('POST keeps the existing Reddy path while observing shadow metadata', () => {
  assert.match(webhookSource, /inspectFonnteWebhookShadow\(rawBody/);
  assert.match(webhookSource, /emitFonnteWebhookShadow\(shadowMetadata\)/);
  assert.match(webhookSource, /handleMessage\(\{\s*from:\s*sender,\s*name:/);
  assert.match(webhookSource, /isHumanTakeover\(sender\)/);
  assert.match(webhookSource, /sendWA\(sender,/);
});

test('structured shadow log emits only the six approved non-PII fields', () => {
  const { emitFonnteWebhookShadow } = require(verifierPath);
  const calls = [];
  const logger = { info: (...args) => calls.push(args) };
  const emitted = emitFonnteWebhookShadow({
    status: 'contract_unknown',
    auth_candidate_present: true,
    auth_candidate_field: 'secretKey',
    event_type: 'personal_message',
    has_timestamp: true,
    has_inboxid: true,
    sender: '628111111111',
    device: '628222222222',
    message: 'private message',
    secret: 'never-log-this',
    inboxid: 'provider-id-value',
    timestamp: 1720000000,
  }, logger);

  assert.deepEqual(calls, [['[WAWebhookAuthShadow]', {
    status: 'contract_unknown',
    auth_candidate_present: true,
    auth_candidate_field: 'secret_key',
    event_type: 'personal_message',
    has_timestamp: true,
    has_inboxid: true,
  }]]);
  assert.deepEqual(emitted, calls[0][1]);
  for (const prohibited of [
    '628111111111', '628222222222', 'private message', 'never-log-this',
    'provider-id-value', '1720000000',
  ]) {
    assert.equal(JSON.stringify(calls).includes(prohibited), false);
  }
});

test('active webhook does not log sender, message content, customer data, or auth values', () => {
  const logStatements = webhookSource.split(/\r?\n/).filter(line => /console\.(?:log|info|warn|error)/.test(line)).join('\n');
  assert.doesNotMatch(webhookSource, /pushDebug\(\{\s*sender/);
  assert.doesNotMatch(webhookSource, /\[WA Bot\] Incoming:/);
  assert.doesNotMatch(logStatements, /sender=\$\{sender\}|for \$\{from\}|\$\{senderNorm\}/);
  assert.doesNotMatch(logStatements, /value:\s*\$\{value\}/);
  assert.doesNotMatch(logStatements, /FONNTE_WEBHOOK_SECRET/);
});

test('webhook and verifier cannot issue identity or execute CRM/orchestration', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const combined = `${webhookSource}\n${verifierSource}`;
  for (const forbidden of ['crmAgent', 'customer360Service', 'customerIdentity']) {
    assert.doesNotMatch(combined, new RegExp(`\\b${forbidden}\\b`));
  }
  for (const verifierSideEffect of ['OpenAI', 'sendWA', 'fetch', 'createClient', 'reconcileCustomerNotificationDelivery']) {
    assert.doesNotMatch(verifierSource, new RegExp(`\\b${verifierSideEffect}\\b`));
  }
  assert.doesNotMatch(verifierSource, /\.from\s*\(|\.(?:insert|upsert|update|delete)\s*\(/);
});

test('shadow verifier never verifies while the provider field contract is unknown', () => {
  const {
    SHADOW_STATUS,
    inspectFonnteWebhookShadow,
  } = require(verifierPath);

  const samples = [
    [{ sender: '628111111111', message: 'halo', timestamp: 1, inboxid: 42 }, undefined, SHADOW_STATUS.NOT_CONFIGURED],
    [{ sender: '628111111111', message: 'halo' }, 'configured-secret', SHADOW_STATUS.CONTRACT_UNKNOWN],
    [{ sender: '628111111111', message: 'halo', secret: 'candidate-value' }, 'configured-secret', SHADOW_STATUS.CONTRACT_UNKNOWN],
    [{ data: { sender: '628111111111', message: 'halo', secret_key: 'candidate-value' } }, 'configured-secret', SHADOW_STATUS.CONTRACT_UNKNOWN],
    [{ payload: JSON.stringify({ sender: '628111111111', message: 'halo', webhookSecret: 'candidate-value' }) }, 'configured-secret', SHADOW_STATUS.CONTRACT_UNKNOWN],
  ];

  for (const [body, configuredSecret, expectedStatus] of samples) {
    const result = inspectFonnteWebhookShadow(body, configuredSecret);
    assert.equal(result.status, expectedStatus);
    assert.notEqual(result.status, SHADOW_STATUS.VERIFIED);
    assert.equal(JSON.stringify(result).includes('candidate-value'), false);
    assert.equal(JSON.stringify(result).includes('configured-secret'), false);
    assert.equal(JSON.stringify(result).includes('628111111111'), false);
    assert.equal(JSON.stringify(result).includes('halo'), false);
  }
});

test('shadow verifier returns only non-PII event metadata', () => {
  const { inspectFonnteWebhookShadow } = require(verifierPath);
  const result = inspectFonnteWebhookShadow({
    sender: '628111111111',
    device: '628222222222',
    message: 'private customer message',
    timestamp: 1720000000,
    inboxid: 'provider-id',
    secret_key: 'do-not-log',
  }, 'configured-secret');

  assert.deepEqual(result, {
    status: 'contract_unknown',
    auth_candidate_present: true,
    auth_candidate_field: 'secret_key',
    event_type: 'personal_message',
    has_timestamp: true,
    has_inboxid: true,
  });
});

test('malformed bodies fail closed and event classification covers non-personal events', () => {
  const { inspectFonnteWebhookShadow } = require(verifierPath);
  assert.equal(inspectFonnteWebhookShadow(null, 'configured-secret').status, 'malformed');
  assert.equal(inspectFonnteWebhookShadow([], 'configured-secret').status, 'malformed');
  assert.equal(inspectFonnteWebhookShadow({ sender: 'group@g.us', message: 'x' }, 'x').event_type, 'group_message');
  assert.equal(inspectFonnteWebhookShadow({ sender: '6281', message: 'x', isFromMe: true }, 'x').event_type, 'outgoing');
  assert.equal(inspectFonnteWebhookShadow({ id: 1, status: 'delivered' }, 'x').event_type, 'status_receipt');
  assert.equal(inspectFonnteWebhookShadow({ sender: '6281', type: 'image' }, 'x').event_type, 'media');
  assert.equal(inspectFonnteWebhookShadow({ event: 'unknown' }, 'x').event_type, 'unsupported');
});

test('retry preparation preserves current dedup and documents the future provider plus inboxid key', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  assert.match(webhookSource, /const processedIds = new Set\(\)/);
  assert.match(webhookSource, /DEDUP_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(verifierSource, /fonnte \+ inboxid/);
  assert.doesNotMatch(verifierSource, /(?:insert|upsert)\s*\(/);
});
