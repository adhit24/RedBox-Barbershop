'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function responseRecorder() {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
  return response;
}

test('reminder cron rejects unauthenticated requests when CRON_SECRET is configured', async () => {
  const handler = require('../../api/cron/reminders');
  const response = responseRecorder();
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';

  try {
    await handler({ method: 'GET', headers: {} }, response);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'Unauthorized' });
});

test('paused reengagement cron returns a successful no-op response', async () => {
  const handler = require('../../api/cron/reengagement');
  const response = responseRecorder();

  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    paused: true,
    reason: 'WA reminders suspended — Meta warning on bypass number',
  });
});
