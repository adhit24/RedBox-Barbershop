// server/test/system-event-log.test.js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { logSystemEvent, SYSTEM_EVENT_LOG_TABLE } = require('../services/systemEventLog');

function makeFakeSupabase({ insertError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert: async (row) => {
          calls.push({ table, row });
          if (insertError) return { data: null, error: insertError };
          return { data: [row], error: null };
        },
      };
    },
  };
}

test('logSystemEvent writes a valid event with required fields', async () => {
  const supabase = makeFakeSupabase();
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_submit_started',
    severity: 'INFO',
    status: 'started',
  }, { supabase });

  assert.equal(result.status, 'recorded');
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].table, SYSTEM_EVENT_LOG_TABLE);
  assert.equal(supabase.calls[0].row.module, 'booking');
  assert.equal(supabase.calls[0].row.event_name, 'booking_submit_started');
  assert.equal(supabase.calls[0].row.severity, 'INFO');
});

test('logSystemEvent: missing optional fields do not fail', async () => {
  const supabase = makeFakeSupabase();
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
  }, { supabase });

  assert.equal(result.status, 'recorded');
  assert.equal(supabase.calls[0].row.booking_id, null);
  assert.equal(supabase.calls[0].row.correlation_id, null);
  assert.deepEqual(supabase.calls[0].row.metadata, {});
});

test('logSystemEvent: missing required fields are ignored, not thrown', async () => {
  const supabase = makeFakeSupabase();
  const result = await logSystemEvent({ eventName: 'x' }, { supabase });
  assert.equal(result.status, 'ignored');
  assert.equal(supabase.calls.length, 0);
});

test('logSystemEvent: sensitive metadata keys are stripped before persistence', async () => {
  const supabase = makeFakeSupabase();
  await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
    metadata: { password: 'hunter2', service: 'Haircut' },
  }, { supabase });

  assert.deepEqual(supabase.calls[0].row.metadata, { service: 'Haircut' });
});

test('logSystemEvent: DB failure does not throw and reports error status', async () => {
  const supabase = makeFakeSupabase({ insertError: { message: 'connection refused' } });
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
  }, { supabase });
  assert.equal(result.status, 'error');
});

test('logSystemEvent: a supabase client that throws does not propagate the throw', async () => {
  const supabase = {
    from() {
      return { insert: async () => { throw new Error('network down'); } };
    },
  };
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
  }, { supabase });
  assert.equal(result.status, 'error');
});

test('logging DB failure still never changes the booking business response when awaited', async () => {
  const failingSupabase = {
    from() {
      return { insert: async () => { throw new Error('database connection crashed'); } };
    },
  };

  // Simulate a business handler awaiting logSystemEvent immediately before returning business response
  async function simulatedTerminalBookingHandler() {
    await logSystemEvent({
      module: 'booking',
      eventName: 'booking_confirmed_to_client',
      severity: 'INFO',
      status: 'success',
      bookingId: 'bk-123',
    }, { supabase: failingSupabase });

    return { httpStatus: 201, body: { data: { id: 'bk-123' }, scheduleId: 'sch-456' } };
  }

  const response = await simulatedTerminalBookingHandler();
  assert.equal(response.httpStatus, 201);
  assert.equal(response.body.data.id, 'bk-123');
});

test('logSystemEvent: ERROR severity persists the exact severity given', async () => {
  const supabase = makeFakeSupabase();
  await logSystemEvent({
    module: 'moka',
    eventName: 'moka_sync_failed',
    severity: 'ERROR',
    errorCode: 'MOKA_TIMEOUT',
    errorMessage: 'upstream timed out',
  }, { supabase });

  assert.equal(supabase.calls[0].row.severity, 'ERROR');
  assert.equal(supabase.calls[0].row.error_code, 'MOKA_TIMEOUT');
});

test('logSystemEvent: correlation_id is passed through unchanged', async () => {
  const supabase = makeFakeSupabase();
  const correlationId = 'abc-123';
  await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
    correlationId,
  }, { supabase });

  assert.equal(supabase.calls[0].row.correlation_id, correlationId);
});

test('logSystemEvent: an invalid severity is ignored rather than persisted', async () => {
  const supabase = makeFakeSupabase();
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'NOT_A_LEVEL',
  }, { supabase });

  assert.equal(result.status, 'ignored');
  assert.equal(supabase.calls.length, 0);
});

test('logSystemEvent: a field that throws on String() coercion does not propagate the throw', async () => {
  const supabase = makeFakeSupabase();
  const hostileValue = { toString() { throw new Error('boom'); } };
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_created',
    severity: 'INFO',
    bookingId: hostileValue,
  }, { supabase });
  assert.equal(result.status, 'error');
  assert.equal(supabase.calls.length, 0);
});

test('logSystemEvent: unbounded error message is truncated, not crashed on', async () => {
  const supabase = makeFakeSupabase();
  const hugeMessage = 'x'.repeat(50000);
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_insert_failed',
    severity: 'ERROR',
    errorMessage: hugeMessage,
  }, { supabase });

  assert.equal(result.status, 'recorded');
  assert.ok(supabase.calls[0].row.error_message.length <= 1000);
});

test('logSystemEvent: an 8-15 digit sequence in error_message (phone-shaped) is masked', async () => {
  const supabase = makeFakeSupabase();
  const result = await logSystemEvent({
    module: 'booking',
    eventName: 'booking_insert_failed',
    severity: 'ERROR',
    errorMessage: 'duplicate key value violates constraint for wa=6281234567890',
  }, { supabase });

  assert.equal(result.status, 'recorded');
  const persisted = supabase.calls[0].row.error_message;
  assert.ok(!persisted.includes('6281234567890'), 'raw phone-like sequence must not be persisted');
  assert.match(persisted, /62\*\*\*90/);
});

test('logSystemEvent: a short (e.g. 4-digit) number in error_message is left unmasked', async () => {
  const supabase = makeFakeSupabase();
  await logSystemEvent({
    module: 'booking',
    eventName: 'booking_insert_failed',
    severity: 'ERROR',
    errorMessage: 'validation failed for code 1234',
  }, { supabase });

  assert.equal(supabase.calls[0].row.error_message, 'validation failed for code 1234');
});

test('logSystemEvent: message scrubs Bearer tokens and credentials', async () => {
  const supabase = makeFakeSupabase();
  await logSystemEvent({
    module: 'booking',
    eventName: 'booking_submit_started',
    severity: 'INFO',
    message: 'User sent Authorization: Bearer eyJhbGciOi_secret with password=hunter2',
  }, { supabase });

  const persisted = supabase.calls[0].row.message;
  assert.ok(!persisted.includes('eyJhbGciOi_secret'), 'raw bearer token must not persist in message');
  assert.ok(!persisted.includes('hunter2'), 'raw password must not persist in message');
  assert.match(persisted, /Authorization: Bearer \[REDACTED\]/);
  assert.match(persisted, /password=\[REDACTED\]/);
});

test('logSystemEvent: error_message scrubs access_token, api_key, password, and secret patterns', async () => {
  const supabase = makeFakeSupabase();
  await logSystemEvent({
    module: 'booking',
    eventName: 'booking_insert_failed',
    severity: 'ERROR',
    errorMessage: 'upstream failed: access_token=tok123 api_key=key456 secret=sec789 password=pwd999',
  }, { supabase });

  const persisted = supabase.calls[0].row.error_message;
  assert.ok(!persisted.includes('tok123'), 'access_token must not persist');
  assert.ok(!persisted.includes('key456'), 'api_key must not persist');
  assert.ok(!persisted.includes('sec789'), 'secret must not persist');
  assert.ok(!persisted.includes('pwd999'), 'password must not persist');
  assert.match(persisted, /access_token=\[REDACTED\]/);
  assert.match(persisted, /api_key=\[REDACTED\]/);
  assert.match(persisted, /secret=\[REDACTED\]/);
  assert.match(persisted, /password=\[REDACTED\]/);
});
