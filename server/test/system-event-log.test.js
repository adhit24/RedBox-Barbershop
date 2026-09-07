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
