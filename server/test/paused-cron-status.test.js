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

test('paused reminder cron returns a successful no-op response', async () => {
  const handler = require('../../api/cron/reminders');
  const response = responseRecorder();

  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    paused: true,
    reason: 'WA reminders suspended — Meta warning on bypass number',
  });
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
