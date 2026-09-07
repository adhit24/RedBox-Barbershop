// server/services/systemEventLog.js
'use strict';

const { sanitizeMetadata } = require('./systemEventLogSanitizer');

const SYSTEM_EVENT_LOG_TABLE = 'system_event_logs';
const SEVERITIES = new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']);
const STATUSES = new Set(['started', 'success', 'failed', 'partial', 'skipped', 'retrying', 'blocked']);

function bounded(value, maxLength) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

function boundedInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function normalizeEvent(event = {}) {
  if (!event || typeof event !== 'object') return null;
  const module_ = bounded(event.module, 64);
  const eventName = bounded(event.eventName, 128);
  const severity = SEVERITIES.has(event.severity) ? event.severity : null;
  if (!module_ || !eventName || !severity) return null;

  return {
    module: module_,
    event_name: eventName,
    event_type: bounded(event.eventType, 64),
    severity,
    status: STATUSES.has(event.status) ? event.status : null,
    message: bounded(event.message, 500),
    correlation_id: bounded(event.correlationId, 128),
    request_id: bounded(event.requestId, 128),
    error_code: bounded(event.errorCode, 64),
    error_message: bounded(event.errorMessage, 1000),
    source: bounded(event.source, 32),
    entity_type: bounded(event.entityType, 32),
    entity_id: bounded(event.entityId, 128),
    booking_id: bounded(event.bookingId, 128),
    schedule_id: bounded(event.scheduleId, 128),
    customer_id: bounded(event.customerId, 128),
    outlet_id: bounded(event.outletId, 64),
    barber_id: bounded(event.barberId, 64),
    external_id: bounded(event.externalId, 128),
    http_method: bounded(event.httpMethod, 10),
    http_path: bounded(event.httpPath, 256),
    http_status: boundedInt(event.httpStatus),
    duration_ms: boundedInt(event.durationMs),
    metadata: sanitizeMetadata(event.metadata),
  };
}

/**
 * Fail-open: this function NEVER throws and NEVER delays/blocks the caller's
 * business operation on a logging failure. If persistence fails, the failure
 * is reported back in the return value (and echoed to console.error) but the
 * caller must not treat that as a reason to abort booking/payment/sync work.
 */
async function logSystemEvent(event, deps = {}) {
  const normalized = normalizeEvent(event);
  if (!normalized) return { status: 'ignored', normalized: null };

  const supabase = deps.supabase;
  if (!supabase) return { status: 'unavailable', normalized };

  try {
    const { error } = await supabase.from(SYSTEM_EVENT_LOG_TABLE).insert(normalized);
    if (error) {
      console.error('[SystemEventLog] insert failed:', error.message || error);
      return { status: 'error', normalized, error };
    }
    return { status: 'recorded', normalized };
  } catch (error) {
    console.error('[SystemEventLog] insert threw:', error?.message || error);
    return { status: 'error', normalized, error };
  }
}

module.exports = { logSystemEvent, normalizeEvent, SYSTEM_EVENT_LOG_TABLE, SEVERITIES, STATUSES };
