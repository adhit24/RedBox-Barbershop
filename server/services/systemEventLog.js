// server/services/systemEventLog.js
'use strict';

const { sanitizeMetadata, sanitizeFreeText } = require('./systemEventLogSanitizer');

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

// Targeted free-text sanitizer: scrubs credentials (tokens, passwords, api keys)
// and masks phone-number-shaped substrings (8-15 digits) across free-text fields.
function maskPhoneLikeSequences(value) {
  return sanitizeFreeText(value);
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
    message: bounded(sanitizeFreeText(event.message), 500),
    correlation_id: bounded(event.correlationId, 128),
    request_id: bounded(event.requestId, 128),
    error_code: bounded(event.errorCode, 64),
    error_message: bounded(sanitizeFreeText(event.errorMessage), 1000),
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

const DEFAULT_LOGGER_TIMEOUT_MS = Number(process.env.SYSTEM_EVENT_LOG_TIMEOUT_MS) || 2000;

/**
 * Fail-open: this function NEVER throws and NEVER delays/blocks the caller's
 * business operation on a logging failure. If persistence fails or times out,
 * the failure is reported back in the return value (and echoed to console) but
 * the caller must not treat that as a reason to abort booking/payment/sync work.
 *
 * Supabase inserts are bounded by a configurable timeout (default 2000ms, or
 * process.env.SYSTEM_EVENT_LOG_TIMEOUT_MS, or deps.timeoutMs) to ensure awaited
 * terminal logging preserves serverless durability without becoming an unbounded
 * blocking dependency for business responses.
 */
async function logSystemEvent(event, deps = {}) {
  try {
    const normalized = normalizeEvent(event);
    if (!normalized) return { status: 'ignored', normalized: null };

    const supabase = deps.supabase;
    if (!supabase) return { status: 'unavailable', normalized };

    const timeoutMs = (Number.isFinite(Number(deps.timeoutMs)) && Number(deps.timeoutMs) > 0)
      ? Number(deps.timeoutMs)
      : DEFAULT_LOGGER_TIMEOUT_MS;

    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({ isTimeout: true });
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const insertPromise = Promise.resolve(supabase.from(SYSTEM_EVENT_LOG_TABLE).insert(normalized))
      .then((res) => {
        clearTimeout(timer);
        return { isTimeout: false, ...res };
      })
      .catch((err) => {
        clearTimeout(timer);
        return { isTimeout: false, error: err };
      });

    const outcome = await Promise.race([insertPromise, timeoutPromise]);

    if (outcome.isTimeout) {
      console.warn(`[SystemEventLog] insert timed out after ${timeoutMs}ms:`, normalized.event_name);
      return { status: 'timeout', normalized };
    }

    const { error } = outcome;
    if (error) {
      console.error('[SystemEventLog] insert failed:', error.message || error);
      return { status: 'error', normalized, error };
    }
    return { status: 'recorded', normalized };
  } catch (error) {
    console.error('[SystemEventLog] insert threw:', error?.message || error);
    return { status: 'error', normalized: null, error };
  }
}

module.exports = {
  logSystemEvent, normalizeEvent, SYSTEM_EVENT_LOG_TABLE, SEVERITIES, STATUSES, maskPhoneLikeSequences, DEFAULT_LOGGER_TIMEOUT_MS,
};
