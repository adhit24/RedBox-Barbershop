# Redbox System Event Log — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Redbox one central, structured, searchable `system_event_logs` table plus a fail-open logger service, instrumented on the highest-risk flow (public booking creation), with a simple read-only Backoffice viewer — so a support/ops person can answer "what happened to this booking attempt?" end-to-end without grepping five systems.

**Architecture:** Additive Supabase/Postgres table (`server/migrations/`, following the project's existing dated-migration convention used by `sync_logs` / `reddy_evaluation_events`), a single shared Node service (`server/services/systemEventLog.js`) with a companion sanitizer, instrumentation calls added to the existing canonical booking route in `server/index.js` (NOT a new booking path), a read-only Express router behind the existing Backoffice Supabase-auth middleware, and a new page in the standalone `backoffice/` Vite/React SPA. No new infra, no queue, no third-party logging service.

**Tech Stack:** Node.js/Express (`server/`), `@supabase/supabase-js` (service-role client), Node's built-in `node:test` + `node:assert/strict` (existing test runner in `server/test/`, run via `node --test`), React + Vite + TypeScript (`backoffice/`), Vitest (existing `backoffice/src/**/__tests__` convention).

**Spec:** This plan implements the "RED BOX SYSTEM EVENT LOG" business requirement handed down verbatim in the originating task brief (Phase 1 scope only: DB table, logger service, sanitizer, booking instrumentation, simple Backoffice viewer, tests). No separate spec file exists; the brief itself is the spec and travels with this plan via the summary below.

## Audit Summary (informs every task below — do not re-derive)

- **No generic event/error log exists today.** The closest analogs are `sync_logs` (Moka-specific, `server/moka_integration_schema.sql:206-226`, 205k+ rows), `reddy_evaluation_events` (`server/migrations/2026-08-29-reddy-evaluation-events.sql`, read via `server/services/reddyEvaluationMonitoring.js`), and `wa_inbound_events`/`wa_outbound_sends` (`server/migrations/2026-08-29-wa-antispam-idempotency.sql`). None of these are a cross-module event log; `system_event_logs` does not duplicate them, it complements them. Do not modify any of these tables.
- **No cron-run log table exists.** Cron outcomes currently only go to `console.log`/`console.error`. Out of scope for this Phase 1 plan (task brief explicitly scopes Phase 1 to booking only), but worth noting in the PR description as a Phase 2 candidate.
- **Migration convention:** `server/migrations/YYYY-MM-DD-kebab-case-description.sql`, applied via `server/run-migration.js`. New migration must follow this — NOT `supabase/migrations/` (that directory exists but is not where the actively-used tables live).
- **Service layer convention:** `server/services/*.js`, CommonJS (`'use strict'`, `module.exports = {...}`), each service takes an injectable `deps.supabase` for testability (see `server/services/reddyEvaluationMonitoring.js:198-215` `recordEvaluationEvent`). Follow this exact fail-open pattern.
- **Sanitizer precedent:** `server/orchestrator/telemetry.js` `sanitizeTelemetry()` — whitelists fields instead of blacklisting. Our sanitizer blacklists (per the task brief's explicit sensitive-key list) since `metadata` is a free-form JSONB bag callers populate, not a fixed telemetry shape.
- **Canonical booking write path:** `server/index.js`, `app.post('/api/bookings', ...)` starting at line 1246, Supabase branch runs lines 1275-1505. This is the ONLY place instrumentation goes.
- **BOOKING WRITE PATH DIVERGENCE (report, do not fix):** `frontend/src/app/api/bookings/route.ts` `POST` (lines 20-88) inserts directly into `bookings` via the cookie-scoped anon Supabase client, bypassing overlap checking, membership discount/identity gating, customer upsert, CRM linkage, all WA notifications, Web Push, and the Moka bridge entirely. This route is NOT touched by this plan (task brief: "DO NOT silently redesign it... Report it"). It also means a booking created through that route will NEVER appear in the System Event Log timeline — call this out explicitly in the PR description as an unresolved risk.
- **Backoffice auth pattern:** the standalone `backoffice/` SPA (`backoffice/src/lib/apiClient.ts`) sends `Authorization: Bearer <supabase access token>`. Server routes consumed by Backoffice wrap the legacy admin-token middleware with `createBackofficeSupabaseAuth` (`server/middleware/backofficeSupabaseAuth.js`), exactly as done in `server/routes/adminCrm.js`. New route must follow that wrapper pattern, not the bare `adminAuth` used by `reddyEvaluation.js` (that one only supports the legacy `x-admin-token` header, which Backoffice does not send).
- **Backoffice page convention:** pages live in `backoffice/src/pages/*.tsx` with a matching `backoffice/src/pages/__tests__/*.test.tsx`, registered as a real `<Route>` in `backoffice/src/App.tsx` (removing any matching entry from `backoffice/src/routes.ts` `PLACEHOLDER_ROUTES` if present — there is none for system logs today, so no removal needed).

## Global Constraints

- Never persist: passwords, `ADMIN_PASSWORD`, `CRON_SECRET`, API keys, Supabase service-role keys, OAuth/session/refresh tokens, `Authorization` headers, cookies, raw credit-card data, or full customer phone numbers. Sanitizer strips these before every insert — no caller may bypass it.
- Logging must be fail-open: a `system_event_logs` insert failure must never throw out of `logSystemEvent`, must never abort or delay the booking response, and must never duplicate a booking.
- `booking_confirmed_to_client` may only be logged AFTER a persisted booking row exists (`data.id` present from the real insert response) — never log it speculatively.
- Migration must be additive only (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — never touch `sync_logs`, `reddy_evaluation_events`, `wa_inbound_events`, or any other existing table.
- No Kafka, ElasticSearch, distributed tracing, or third-party logging SaaS. Correlation is a single UUID generated at request start, nothing more.
- Do not create, deploy, or apply this migration against production. Do not merge the PR. Stop after opening it.

---

### Task 1: Migration — `system_event_logs` table + indexes

**Files:**
- Create: `server/migrations/2026-09-07-system-event-logs.sql`

**Interfaces:**
- Produces: table `system_event_logs` with columns exactly as listed below — every later task's insert/select code depends on these exact column names.

- [ ] **Step 1: Write the migration file**

```sql
-- server/migrations/2026-09-07-system-event-logs.sql
-- Additive only. Central, structured, searchable Redbox system event log.
-- Does NOT replace or duplicate sync_logs, reddy_evaluation_events, or
-- wa_inbound_events/wa_outbound_sends — those remain module-specific.

CREATE TABLE IF NOT EXISTS system_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  request_id TEXT,

  module TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  status TEXT CHECK (status IS NULL OR status IN ('started', 'success', 'failed', 'partial', 'skipped', 'retrying', 'blocked')),

  message TEXT,
  error_code TEXT,
  error_message TEXT,

  source TEXT,
  entity_type TEXT,
  entity_id TEXT,

  booking_id TEXT,
  schedule_id TEXT,
  customer_id TEXT,
  outlet_id TEXT,
  barber_id TEXT,
  external_id TEXT,

  http_method TEXT,
  http_path TEXT,
  http_status INTEGER,
  duration_ms INTEGER,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_created_at
  ON system_event_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_module_created_at
  ON system_event_logs (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_severity_created_at
  ON system_event_logs (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_event_name_created_at
  ON system_event_logs (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_correlation_id
  ON system_event_logs (correlation_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_booking_id
  ON system_event_logs (booking_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_customer_id
  ON system_event_logs (customer_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_external_id
  ON system_event_logs (external_id);

ALTER TABLE system_event_logs ENABLE ROW LEVEL SECURITY;

-- Same access model as reddy_evaluation_events: service-role only. Backoffice
-- reads go through the server API (service-role client), never direct client
-- access to this table.
DROP POLICY IF EXISTS system_event_logs_service_role_all ON system_event_logs;
CREATE POLICY system_event_logs_service_role_all ON system_event_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Verify the file is syntactically valid SQL**

Run: `node -e "require('fs').readFileSync('server/migrations/2026-09-07-system-event-logs.sql','utf8')"` (sanity read; do NOT run `server/run-migration.js` against any real database — this plan does not apply migrations to production or any shared environment).

- [ ] **Step 3: Commit**

```bash
git add server/migrations/2026-09-07-system-event-logs.sql
git commit -m "feat(system-event-log): add system_event_logs migration"
```

---

### Task 2: Sanitizer service

**Files:**
- Create: `server/services/systemEventLogSanitizer.js`
- Test: `server/test/system-event-log-sanitizer.test.js`

**Interfaces:**
- Produces: `sanitizeMetadata(input: any): object` — deep-strips sensitive keys and bounds size. Used by Task 3's `systemEventLog.js`.

- [ ] **Step 1: Write the failing tests**

```js
// server/test/system-event-log-sanitizer.test.js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeMetadata } = require('../services/systemEventLogSanitizer');

test('sanitizeMetadata strips sensitive keys at top level', () => {
  const out = sanitizeMetadata({
    password: 'hunter2',
    ADMIN_PASSWORD: 'x',
    cron_secret: 'y',
    token: 'z',
    access_token: 'a',
    refresh_token: 'b',
    api_key: 'c',
    secret: 'd',
    authorization: 'Bearer abc',
    cookie: 'sid=1',
    safe: 'keep-me',
  });
  assert.deepEqual(out, { safe: 'keep-me' });
});

test('sanitizeMetadata strips sensitive keys nested inside objects and arrays', () => {
  const out = sanitizeMetadata({
    user: { name: 'Budi', password: 'hunter2' },
    items: [{ id: 1, token: 'z' }, { id: 2 }],
  });
  assert.deepEqual(out, { user: { name: 'Budi' }, items: [{ id: 1 }, { id: 2 }] });
});

test('sanitizeMetadata is case-insensitive and matches key variants', () => {
  const out = sanitizeMetadata({ Authorization: 'x', ApiKey: 'y', AccessToken: 'z', keep: 1 });
  assert.deepEqual(out, { keep: 1 });
});

test('sanitizeMetadata returns an empty object for non-object input', () => {
  assert.deepEqual(sanitizeMetadata(null), {});
  assert.deepEqual(sanitizeMetadata(undefined), {});
  assert.deepEqual(sanitizeMetadata('a string'), {});
  assert.deepEqual(sanitizeMetadata(42), {});
});

test('sanitizeMetadata bounds oversized metadata instead of storing it raw', () => {
  const big = { blob: 'x'.repeat(20000) };
  const out = sanitizeMetadata(big);
  assert.equal(out._truncated, true);
  assert.equal(typeof out._original_size, 'number');
  assert.ok(out._original_size > 8000);
  assert.ok(JSON.stringify(out).length < 1000);
});

test('sanitizeMetadata never throws on circular references', () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => sanitizeMetadata(circular));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/system-event-log-sanitizer.test.js`
Expected: FAIL — `Cannot find module '../services/systemEventLogSanitizer'`

- [ ] **Step 3: Write the sanitizer**

```js
// server/services/systemEventLogSanitizer.js
'use strict';

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|cookie|credential)/i;
const MAX_METADATA_JSON_LENGTH = 8000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripSensitive(value, seen) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitive(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      out[key] = stripSensitive(val, seen);
    }
    return out;
  }
  return value;
}

/**
 * Strips sensitive keys (password/secret/token/api_key/authorization/cookie/
 * credential, case-insensitive, at any depth) and bounds the resulting size
 * so a caller can never accidentally persist a credential or an unbounded
 * payload into system_event_logs.metadata.
 */
function sanitizeMetadata(input) {
  if (!isPlainObject(input)) return {};

  let stripped;
  try {
    stripped = stripSensitive(input, new WeakSet());
  } catch {
    return { _truncated: true, _reason: 'sanitize_failed' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(stripped);
  } catch {
    return { _truncated: true, _reason: 'not_serializable' };
  }

  if (serialized.length <= MAX_METADATA_JSON_LENGTH) return stripped;

  return { _truncated: true, _original_size: serialized.length };
}

module.exports = { sanitizeMetadata, SENSITIVE_KEY_PATTERN, MAX_METADATA_JSON_LENGTH };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/system-event-log-sanitizer.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add server/services/systemEventLogSanitizer.js server/test/system-event-log-sanitizer.test.js
git commit -m "feat(system-event-log): add metadata sanitizer"
```

---

### Task 3: Logger service (`logSystemEvent`)

**Files:**
- Create: `server/services/systemEventLog.js`
- Test: `server/test/system-event-log.test.js`

**Interfaces:**
- Consumes: `sanitizeMetadata` from Task 2 (`server/services/systemEventLogSanitizer.js`).
- Produces: `logSystemEvent(event, deps = {}): Promise<{status: 'recorded'|'ignored'|'unavailable'|'error', normalized: object|null, error?: any}>`. Task 4 (booking instrumentation) and Task 5 (API route, indirectly) depend on this exact signature and the field names on `event`: `module, eventName, severity, status, message, correlationId, requestId, entityType, entityId, bookingId, scheduleId, customerId, outletId, barberId, externalId, httpMethod, httpPath, httpStatus, durationMs, errorCode, errorMessage, metadata`.

**Test framework note:** this repo uses Node's built-in `node:test` + `node:assert/strict` (see `server/test/backoffice-supabase-auth.test.js` for the house style), run via `node --test <file>` — NOT Jest. Every test in this plan uses that style; do not introduce `jest`, `expect()`, or a `jest.config`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/system-event-log.test.js`
Expected: FAIL — `Cannot find module '../services/systemEventLog'`

- [ ] **Step 3: Write the logger service**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/system-event-log.test.js`
Expected: PASS (10/10)

- [ ] **Step 5: Commit**

```bash
git add server/services/systemEventLog.js server/test/system-event-log.test.js
git commit -m "feat(system-event-log): add fail-open logSystemEvent service"
```

---

### Task 4: Booking instrumentation in `server/index.js`

**Files:**
- Modify: `server/index.js` (booking route, lines 1246-1505 — Supabase branch only; the MySQL fallback branch below it is legacy and out of scope)
- Test: `server/test/booking-system-event-log.test.js`

**Interfaces:**
- Consumes: `logSystemEvent` from Task 3 (`../services/systemEventLog`), `randomUUID` (already imported in `server/index.js` and used at existing line 1261 for `bookingId`).
- Produces: nothing new consumed elsewhere — this task wires the logger into the live booking flow using event names fixed by the task brief: `booking_submit_started`, `booking_validation_failed`, `booking_availability_failed`, `booking_insert_failed`, `booking_created`, `schedule_create_failed`, `schedule_created`, `booking_customer_link_failed`, `booking_notification_failed`, `booking_confirmed_to_client`.

This task modifies a live, heavily-guarded route. Because `server/index.js` is a single ~4000-line file, and the booking route is NOT factored into an injectable `createXRoutes(supabase, ...)` module the way `stockist`/`adminCrm`/`reddyEvaluation` are, this codebase does NOT integration-test it by booting the app with a mocked Supabase client. Instead, the existing test `server/test/booking-tier-discount.test.js` reads `server/index.js` as text, extracts the route handler's source via a regex match, and asserts the handler body contains specific code patterns (see e.g. its lines 8-9, 20-21, 25-26). Follow that exact convention here — do not invent a live-server/mocked-Supabase integration test; it is not this codebase's pattern for this specific route.

- [ ] **Step 1: Write the failing test**

```js
// server/test/booking-system-event-log.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const bookingRouteMatch = server.match(/app\.post\('\/api\/bookings'[\s\S]*?\n\}\);/);

test('the POST /api/bookings route exists and was located for the other assertions', () => {
  assert.ok(bookingRouteMatch, "expected to find the POST '/api/bookings' route handler");
});

test('server/index.js imports logSystemEvent from the system event log service', () => {
  assert.match(server, /const \{ logSystemEvent \} = require\('\.\/services\/systemEventLog'\);/);
});

test('a correlationId is generated once at the start of the route, before body destructuring', () => {
  const routeBody = bookingRouteMatch[0];
  const correlationIdx = routeBody.indexOf('const correlationId = randomUUID();');
  const destructureIdx = routeBody.indexOf('const { name, wa, service_id');
  assert.ok(correlationIdx >= 0, 'expected `const correlationId = randomUUID();`');
  assert.ok(destructureIdx >= 0, 'expected the existing body destructure line to still be present');
  assert.ok(correlationIdx < destructureIdx, 'correlationId must be generated before the body is destructured');
});

test('booking_submit_started is logged with status started', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /eventName: 'booking_submit_started'[\s\S]{0,200}status: 'started'|status: 'started'[\s\S]{0,200}eventName: 'booking_submit_started'/);
});

test('every logSystemEvent call site is defended with .catch(() => {}) so a logging failure cannot propagate', () => {
  const routeBody = bookingRouteMatch[0];
  const callSites = routeBody.match(/logSystemEvent\(\{[\s\S]*?\}, \{ supabase \}\)(\.catch\(\(\) => \{\}\))?;/g) || [];
  assert.ok(callSites.length >= 8, `expected at least 8 logSystemEvent call sites in the booking route, found ${callSites.length}`);
  for (const call of callSites) {
    assert.match(call, /\.catch\(\(\) => \{\}\);$/, `logSystemEvent call site is missing .catch(() => {}): ${call}`);
  }
});

test('every required Phase 1 booking event name appears exactly once in the route body', () => {
  const routeBody = bookingRouteMatch[0];
  const requiredOnce = [
    'booking_submit_started',
    'booking_availability_failed',
    'booking_insert_failed',
    'booking_created',
    'booking_customer_link_failed',
  ];
  for (const name of requiredOnce) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.equal(occurrences, 1, `expected eventName: '${name}' exactly once, found ${occurrences}`);
  }
  // These two appear twice: once on the confirmed-with-schedule path, once
  // on the moka-bridge-failed / no-schedule path (see Step 10).
  for (const name of ['schedule_create_failed', 'schedule_created', 'booking_confirmed_to_client']) {
    const occurrences = routeBody.split(`eventName: '${name}'`).length - 1;
    assert.ok(occurrences >= 1, `expected at least one eventName: '${name}', found ${occurrences}`);
  }
  assert.ok(routeBody.split("eventName: 'booking_validation_failed'").length - 1 >= 1, 'expected at least one booking_validation_failed');
  assert.ok(routeBody.split("eventName: 'booking_notification_failed'").length - 1 >= 1, 'expected at least one booking_notification_failed');
});

test('booking_confirmed_to_client is never logged before the bookings insert result (data.id) exists', () => {
  const routeBody = bookingRouteMatch[0];
  const insertIdx = routeBody.indexOf("supabase.from('bookings').insert([{");
  const firstConfirmedIdx = routeBody.indexOf("eventName: 'booking_confirmed_to_client'");
  assert.ok(insertIdx >= 0, 'expected the bookings insert call');
  assert.ok(firstConfirmedIdx >= 0, 'expected at least one booking_confirmed_to_client log call');
  assert.ok(insertIdx < firstConfirmedIdx, 'booking_confirmed_to_client must be logged after the insert, never before');
});

test('booking_customer_link_failed is only logged when linkage was not persisted', () => {
  const routeBody = bookingRouteMatch[0];
  assert.match(routeBody, /if \(linkageResult\.persistence_status !== 'persisted'\)/);
});

test('booking_insert_failed and booking_created both carry the bookingId', () => {
  const routeBody = bookingRouteMatch[0];
  const insertFailedBlock = routeBody.match(/if \(error\) \{[\s\S]*?eventName: 'booking_insert_failed'[\s\S]*?\}\);/);
  const createdBlock = routeBody.match(/eventName: 'booking_created'[\s\S]{0,200}/);
  assert.ok(insertFailedBlock, 'expected a booking_insert_failed block inside the insert-error branch');
  assert.match(insertFailedBlock[0], /bookingId/);
  assert.ok(createdBlock, 'expected a booking_created log call');
  assert.match(createdBlock[0], /bookingId: data\.id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/booking-system-event-log.test.js`
Expected: FAIL (`logSystemEvent` import not found, `correlationId` not found, and every subsequent assertion — instrumentation not yet added)

- [ ] **Step 3: Add the import**

Find the top-of-file require block in `server/index.js` (near the other `server/services/*` requires, e.g. alongside the existing `require('./services/bookingCustomerLinkage')` import). Add:

```js
const { logSystemEvent } = require('./services/systemEventLog');
```

- [ ] **Step 4: Generate the correlation ID and log `booking_submit_started`**

Locate the route start:

```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10, name: 'bookings-create' }), async (req, res) => {
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address, group } = req.body;
```

Change to:

```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10, name: 'bookings-create' }), async (req, res) => {
  const correlationId = randomUUID();
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address, group } = req.body;
  logSystemEvent({
    module: 'booking',
    eventName: 'booking_submit_started',
    severity: 'INFO',
    status: 'started',
    correlationId,
    requestId: req.headers['x-request-id'] || null,
    httpMethod: 'POST',
    httpPath: '/api/bookings',
    source: 'website',
  }, { supabase }).catch(() => {});
```

(`.catch(() => {})` is defense-in-depth only — `logSystemEvent` already never rejects — but the route must never be coupled to the logger's promise, per the fail-open constraint.)

- [ ] **Step 5: Log `booking_validation_failed` at every early-return validation branch**

There are three validation-style early returns before the DB branch splits (missing fields, invalid WA format) and several more inside the Supabase branch (barber not found, barber inactive, branch mismatch). Add a `logSystemEvent(...).catch(() => {})` call immediately before each existing `return res.status(4xx)...` in this range, reusing `correlationId`. Example for the first one:

```js
  if (!name || !wa || !service || !date || !time) {
    logSystemEvent({
      module: 'booking', eventName: 'booking_validation_failed', severity: 'WARNING', status: 'failed',
      correlationId, httpMethod: 'POST', httpPath: '/api/bookings', httpStatus: 400,
      errorMessage: 'Missing required fields: name, wa, service, date, time',
    }, { supabase }).catch(() => {});
    return res.status(400).json({ error: 'Missing required fields: name, wa, service, date, time' });
  }
```

Apply the same pattern (same `eventName: 'booking_validation_failed'`, `httpStatus` matching the actual response code, `errorMessage` matching the actual response `error` text) to: the WA format check, the barber-not-found check, the barber-inactive check, and the branch-mismatch check (all within the existing lines ~1253-1305 range).

- [ ] **Step 6: Log `booking_availability_failed` at the overlap check**

Find:

```js
      if (await hasOverlapSupabase({ barberId: normalizedBarberId, date, time, duration })) {
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }
```

Change to:

```js
      if (await hasOverlapSupabase({ barberId: normalizedBarberId, date, time, duration })) {
        logSystemEvent({
          module: 'booking', eventName: 'booking_availability_failed', severity: 'WARNING', status: 'failed',
          correlationId, barberId: normalizedBarberId, httpStatus: 409,
          errorMessage: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.',
        }, { supabase }).catch(() => {});
        return res.status(409).json({ error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.' });
      }
```

- [ ] **Step 7: Log `booking_insert_failed` / `booking_created` around the insert**

Find:

```js
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: finalPrice,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: resolvedLocation, status: desiredStatus, notes: notes || '', payment: payment || '',
        original_price: originalPrice, discount_label: discountLabel
      }]).select().single();
      if (error) return res.status(500).json({ error: error.message });
```

Change to:

```js
      const { data, error } = await supabase.from('bookings').insert([{
        id: bookingId, name, wa, service_id: service_id || '', service, price: finalPrice,
        duration: duration || '', barber_id: normalizedBarberId, date, time,
        location: resolvedLocation, status: desiredStatus, notes: notes || '', payment: payment || '',
        original_price: originalPrice, discount_label: discountLabel
      }]).select().single();
      if (error) {
        logSystemEvent({
          module: 'booking', eventName: 'booking_insert_failed', severity: 'ERROR', status: 'failed',
          correlationId, bookingId, barberId: normalizedBarberId, httpStatus: 500,
          errorMessage: error.message,
        }, { supabase }).catch(() => {});
        return res.status(500).json({ error: error.message });
      }
      logSystemEvent({
        module: 'booking', eventName: 'booking_created', severity: 'INFO', status: 'success',
        correlationId, bookingId: data.id, entityType: 'booking', entityId: data.id,
        barberId: normalizedBarberId, outletId: resolvedLocation,
      }, { supabase }).catch(() => {});
```

- [ ] **Step 8: Log `booking_customer_link_failed` after the CRM linkage call**

Find:

```js
      await linkNewlyCreatedBooking(supabase, {
        booking: { id: bookingId }, phone: wa, source: 'booking_create', branch: resolvedLocation,
      });
```

Change to:

```js
      const linkageResult = await linkNewlyCreatedBooking(supabase, {
        booking: { id: bookingId }, phone: wa, source: 'booking_create', branch: resolvedLocation,
      });
      if (linkageResult.persistence_status !== 'persisted') {
        logSystemEvent({
          module: 'booking', eventName: 'booking_customer_link_failed', severity: 'WARNING', status: 'failed',
          correlationId, bookingId, entityType: 'booking', entityId: bookingId,
          errorCode: linkageResult.persistence_status,
          errorMessage: `customer linkage not persisted: ${linkageResult.persistence_status}`,
        }, { supabase }).catch(() => {});
      }
```

- [ ] **Step 9: Log `booking_notification_failed` on notification failures**

Find the customer-confirmation call:

```js
        await _notifyCustomerConfirmedWithRetry(supabase, data, barberName);
```

Change to:

```js
        const notifyResult = await _notifyCustomerConfirmedWithRetry(supabase, data, barberName);
        if (!notifyResult?.sent) {
          logSystemEvent({
            module: 'booking', eventName: 'booking_notification_failed', severity: 'WARNING', status: 'failed',
            correlationId, bookingId: data.id, entityType: 'booking', entityId: data.id,
            errorMessage: 'customer confirmation WA not sent',
          }, { supabase }).catch(() => {});
        }
```

Find the barber-notification catch block:

```js
        } catch (err) {
          console.error('[Booking] Barber notif failed:', err.message);
        }
```

Change to:

```js
        } catch (err) {
          console.error('[Booking] Barber notif failed:', err.message);
          logSystemEvent({
            module: 'booking', eventName: 'booking_notification_failed', severity: 'WARNING', status: 'failed',
            correlationId, bookingId: data.id, entityType: 'booking', entityId: data.id,
            errorMessage: err.message,
          }, { supabase }).catch(() => {});
        }
```

- [ ] **Step 10: Log `schedule_created` / `schedule_create_failed` and `booking_confirmed_to_client` around the Moka bridge**

Find:

```js
      if (supabase && desiredStatus === 'confirmed') {
        try {
          const r = await require('./moka/sync').bridgeBookingToMoka(supabase, { ...data, type, address });
```

...through...

```js
          return res.status(201).json({ data, autoBooked: true, scheduleId: r.scheduleId, mokaSync: r.mokaSync, homeServiceJobId });
        } catch (e) {
          console.warn(`[Moka Bridge] booking ${data.id} failed:`, e.message);
          return res.status(201).json({ data, autoBooked: true, scheduleId: null, mokaSync: 'failed' });
        }
      }

      return res.status(201).json({ data, autoBooked: desiredStatus === 'confirmed' });
```

Change to (only the additions — keep the existing home-service block between the `bridgeBookingToMoka` call and the first `return` untouched):

```js
      if (supabase && desiredStatus === 'confirmed') {
        try {
          const r = await require('./moka/sync').bridgeBookingToMoka(supabase, { ...data, type, address });
          if (r.scheduleId) {
            logSystemEvent({
              module: 'booking', eventName: 'schedule_created', severity: 'INFO', status: 'success',
              correlationId, bookingId: data.id, scheduleId: r.scheduleId,
              entityType: 'schedule', entityId: r.scheduleId,
            }, { supabase }).catch(() => {});
          }

          // ...existing home_service_jobs block unchanged...

          logSystemEvent({
            module: 'booking', eventName: 'booking_confirmed_to_client', severity: 'INFO', status: 'success',
            correlationId, bookingId: data.id, scheduleId: r.scheduleId || null,
            entityType: 'booking', entityId: data.id, httpStatus: 201,
          }, { supabase }).catch(() => {});
          return res.status(201).json({ data, autoBooked: true, scheduleId: r.scheduleId, mokaSync: r.mokaSync, homeServiceJobId });
        } catch (e) {
          console.warn(`[Moka Bridge] booking ${data.id} failed:`, e.message);
          logSystemEvent({
            module: 'booking', eventName: 'schedule_create_failed', severity: 'ERROR', status: 'failed',
            correlationId, bookingId: data.id, entityType: 'booking', entityId: data.id,
            errorMessage: e.message,
          }, { supabase }).catch(() => {});
          // A booking row exists (data.id is real) but no schedule was
          // created — this IS booking_confirmed_to_client's truthful state:
          // the client sees the booking exists, scheduleId is explicitly
          // null in the response so nothing downstream assumes a schedule.
          logSystemEvent({
            module: 'booking', eventName: 'booking_confirmed_to_client', severity: 'WARNING', status: 'partial',
            correlationId, bookingId: data.id, scheduleId: null,
            entityType: 'booking', entityId: data.id, httpStatus: 201,
            message: 'confirmed to client without a linked schedule (moka bridge failed)',
          }, { supabase }).catch(() => {});
          return res.status(201).json({ data, autoBooked: true, scheduleId: null, mokaSync: 'failed' });
        }
      }

      logSystemEvent({
        module: 'booking', eventName: 'booking_confirmed_to_client', severity: 'INFO', status: 'success',
        correlationId, bookingId: data.id, entityType: 'booking', entityId: data.id, httpStatus: 201,
      }, { supabase }).catch(() => {});
      return res.status(201).json({ data, autoBooked: desiredStatus === 'confirmed' });
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd server && node --test test/booking-system-event-log.test.js`
Expected: PASS (all tests green — the exact count depends on the assertions written in Step 1).

- [ ] **Step 12: Run the full existing booking-related test suite to confirm no regression**

Run: `cd server && node --test test/*booking*.test.js`
Expected: All existing booking-related tests still PASS (this task only adds `logSystemEvent(...).catch(() => {})` calls before/after existing logic — it must never change an existing response shape, status code, or control flow).

- [ ] **Step 13: Commit**

```bash
git add server/index.js server/test/booking-system-event-log.test.js
git commit -m "feat(system-event-log): instrument canonical booking flow"
```

---

### Task 5: Read-only Backoffice API route

**Files:**
- Create: `server/routes/systemEventLogs.js`
- Modify: `server/index.js` (route registration, alongside the existing `app.use('/api/admin/crm', ...)` / `app.use('/api/internal/reddy-evaluation', ...)` block around line 3660-3668)
- Test: `server/test/system-event-logs-route.test.js`

**Interfaces:**
- Consumes: `createBackofficeSupabaseAuth` from `server/middleware/backofficeSupabaseAuth.js` (same pattern as `server/routes/adminCrm.js`).
- Produces: `GET /api/internal/system-event-logs` (filtered list: `module`, `severity`, `status`, `eventName`, `from`, `to`, `correlationId`, `bookingId`, pagination via `limit`/`cursor`) and `GET /api/internal/system-event-logs/timeline/:correlationId` (all rows sharing one correlation_id, ordered by `created_at ASC`) — both consumed by Task 6's Backoffice page.

**Test framework note:** follow `server/test/stockist-routes-dashboard.test.js`'s exact convention — `node:test` + `node:assert/strict`, a real `express()` app bound with `app.listen(0, '127.0.0.1')`, and the built-in `fetch()` to make requests. This codebase does NOT use `supertest` or Jest anywhere; do not introduce either.

- [ ] **Step 1: Write the failing tests**

```js
// server/test/system-event-logs-route.test.js
'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createSystemEventLogRoutes } = require('../routes/systemEventLogs');

async function withServer(supabase, legacyAdminAuth, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/system-event-logs', createSystemEventLogRoutes(supabase, legacyAdminAuth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function makeFakeSupabase(rows) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'adhit24@gmail.com' } }, error: null }) },
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'owner' }, error: null }) }) }),
        };
      }
      const query = {
        _filters: [],
        select() { return query; },
        eq(col, val) { query._filters.push([col, val]); return query; },
        order() { return query; },
        limit() { return query; },
        gte() { return query; },
        lte() { return query; },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function legacyAdminAuth(req, res) { return res.status(401).json({ error: 'legacy auth not used in this test' }); }

test('GET /api/internal/system-event-logs rejects requests without a bearer token via the legacy fallback', async () => {
  const supabase = makeFakeSupabase([]);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs`);
    assert.equal(res.status, 401);
  });
});

test('GET /api/internal/system-event-logs returns rows for an authenticated owner', async () => {
  const rows = [{ id: '1', module: 'booking', event_name: 'booking_created', severity: 'INFO', created_at: new Date().toISOString() }];
  const supabase = makeFakeSupabase(rows);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs`, {
      headers: { Authorization: 'Bearer faketoken' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 1);
  });
});

test('GET /api/internal/system-event-logs/timeline/:correlationId returns rows ordered by created_at ascending', async () => {
  const rows = [{ id: '1', module: 'booking', event_name: 'booking_created', correlation_id: 'c1', created_at: new Date().toISOString() }];
  const supabase = makeFakeSupabase(rows);
  await withServer(supabase, legacyAdminAuth, async (base) => {
    const res = await fetch(`${base}/api/internal/system-event-logs/timeline/c1`, {
      headers: { Authorization: 'Bearer faketoken' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/system-event-logs-route.test.js`
Expected: FAIL — `Cannot find module '../routes/systemEventLogs'`

- [ ] **Step 3: Write the route**

```js
// server/routes/systemEventLogs.js
'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');

const TABLE = 'system_event_logs';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

function createSystemEventLogRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  router.get('/', adminAuth, async (req, res) => {
    const { module: moduleFilter, severity, status, eventName, from, to, correlationId, bookingId } = req.query;
    let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(parseLimit(req.query.limit));

    if (moduleFilter) query = query.eq('module', moduleFilter);
    if (severity) query = query.eq('severity', severity);
    if (status) query = query.eq('status', status);
    if (eventName) query = query.eq('event_name', eventName);
    if (correlationId) query = query.eq('correlation_id', correlationId);
    if (bookingId) query = query.eq('booking_id', bookingId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'failed to load system event logs' });
    return res.json({ data: data || [] });
  });

  router.get('/timeline/:correlationId', adminAuth, async (req, res) => {
    const { correlationId } = req.params;
    if (!correlationId) return res.status(400).json({ error: 'correlationId required' });

    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('correlation_id', correlationId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: 'failed to load timeline' });
    return res.json({ data: data || [] });
  });

  return router;
}

module.exports = { createSystemEventLogRoutes };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/system-event-logs-route.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Register the route in `server/index.js`**

Find:

```js
app.use('/api/internal/reddy-evaluation', createReddyEvaluationRoutes(supabase, adminAuth));
```

Add immediately after it:

```js
const { createSystemEventLogRoutes } = require('./routes/systemEventLogs');
app.use('/api/internal/system-event-logs', createSystemEventLogRoutes(supabase, adminAuth));
```

(Place the `require` next to the other route requires near line 3665, and the `app.use` next to the other `app.use` registrations near line 3668 — do not inline the `require` mid-function if the file's convention groups all route requires together; match whatever the surrounding lines already do.)

- [ ] **Step 6: Commit**

```bash
git add server/routes/systemEventLogs.js server/test/system-event-logs-route.test.js server/index.js
git commit -m "feat(system-event-log): add read-only Backoffice API route"
```

---

### Task 6: Backoffice viewer page

**Files:**
- Create: `backoffice/src/pages/SystemEventLog.tsx`
- Create: `backoffice/src/pages/__tests__/SystemEventLog.test.tsx`
- Modify: `backoffice/src/App.tsx` (register the route)

**Interfaces:**
- Consumes: `apiClient.get` from `backoffice/src/lib/apiClient.ts` (existing, Bearer-auth-aware), endpoints from Task 5 (`GET /api/internal/system-event-logs`, `GET /api/internal/system-event-logs/timeline/:correlationId`).

- [ ] **Step 1: Read one existing data-fetching page and its test for the exact conventions**

Before writing, open `backoffice/src/pages/CRMOverview.tsx` (or another real, non-placeholder page that fetches via `apiClient.get`) and its matching `__tests__` file to copy the exact loading/error/render pattern, component export shape, and how the page's route wraps auth/layout chrome. This plan does not restate that boilerplate — reuse it.

- [ ] **Step 2: Write the failing test**

```tsx
// backoffice/src/pages/__tests__/SystemEventLog.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { apiClient } from '../../lib/apiClient';
import SystemEventLog from '../SystemEventLog';

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}));

describe('SystemEventLog', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  test('renders the event table once data loads', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [{
        id: '1', created_at: new Date().toISOString(), severity: 'ERROR', module: 'booking',
        event_name: 'booking_insert_failed', status: 'failed', entity_type: 'booking',
        entity_id: 'b1', message: 'insert failed', correlation_id: 'corr-1',
      }],
    });

    render(<SystemEventLog />);

    await waitFor(() => expect(screen.getByText('booking_insert_failed')).toBeTruthy());
    expect(screen.getByText('System Event Log')).toBeTruthy();
  });

  test('shows an empty state when there are no events', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
    render(<SystemEventLog />);
    await waitFor(() => expect(screen.getByText(/no events/i)).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backoffice && npx vitest run src/pages/__tests__/SystemEventLog.test.tsx`
Expected: FAIL — cannot find `../SystemEventLog`

- [ ] **Step 4: Write the page**

Match whatever layout/table primitives `CRMOverview.tsx` (or the page read in Step 1) actually uses — do not invent new shared components. The functional shape to implement:

```tsx
// backoffice/src/pages/SystemEventLog.tsx
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/apiClient';

interface SystemEventLogRow {
  id: string;
  created_at: string;
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  module: string;
  event_name: string;
  status: string | null;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  correlation_id: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

interface Filters {
  module: string;
  severity: string;
  status: string;
  eventName: string;
  correlationId: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#b91c1c',
  ERROR: '#dc2626',
  WARNING: '#d97706',
  INFO: '#2563eb',
  DEBUG: '#6b7280',
};

const EMPTY_FILTERS: Filters = { module: '', severity: '', status: '', eventName: '', correlationId: '' };

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  if (filters.eventName) params.set('eventName', filters.eventName);
  if (filters.correlationId) params.set('correlationId', filters.correlationId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function SystemEventLog() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<SystemEventLogRow[]>([]);
  const [selected, setSelected] = useState<SystemEventLogRow | null>(null);
  const [timeline, setTimeline] = useState<SystemEventLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<{ data: SystemEventLogRow[] }>(`/api/internal/system-event-logs${buildQuery(filters)}`)
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    if (!selected?.correlation_id) { setTimeline([]); return; }
    apiClient
      .get<{ data: SystemEventLogRow[] }>(`/api/internal/system-event-logs/timeline/${selected.correlation_id}`)
      .then((res) => setTimeline(res.data));
  }, [selected]);

  return (
    <div>
      <h1>System Event Log</h1>

      <div>
        <input placeholder="Module" value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })} />
        <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
          <option value="">All severities</option>
          {['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} />
        <input placeholder="Event name" value={filters.eventName} onChange={(e) => setFilters({ ...filters, eventName: e.target.value })} />
        <input placeholder="Correlation / Booking ID" value={filters.correlationId} onChange={(e) => setFilters({ ...filters, correlationId: e.target.value })} />
      </div>

      {loading && <p>Loading...</p>}
      {!loading && rows.length === 0 && <p>No events found for the current filters.</p>}

      {!loading && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Timestamp</th><th>Severity</th><th>Module</th><th>Event</th><th>Status</th><th>Entity</th><th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: 'pointer' }}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td style={{ color: SEVERITY_COLOR[row.severity] || undefined, fontWeight: row.severity === 'ERROR' || row.severity === 'CRITICAL' ? 700 : 400 }}>
                  {row.severity}
                </td>
                <td>{row.module}</td>
                <td>{row.event_name}</td>
                <td>{row.status || '-'}</td>
                <td>{row.entity_type ? `${row.entity_type}:${row.entity_id}` : '-'}</td>
                <td>{row.message || row.error_message || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <aside>
          <h2>Event Detail</h2>
          <dl>
            <dt>Correlation ID</dt><dd>{selected.correlation_id || '-'}</dd>
            <dt>Error code</dt><dd>{selected.error_code || '-'}</dd>
            <dt>Error message</dt><dd>{selected.error_message || '-'}</dd>
            <dt>Metadata</dt><dd><pre>{JSON.stringify(selected.metadata, null, 2)}</pre></dd>
          </dl>

          <h3>Timeline</h3>
          <ol>
            {timeline.map((t) => (
              <li key={t.id}>
                {new Date(t.created_at).toLocaleTimeString()} — {t.event_name} ({t.status || t.severity})
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backoffice && npx vitest run src/pages/__tests__/SystemEventLog.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 6: Register the route**

Open `backoffice/src/App.tsx`, find where other real pages (e.g. `CommandCenter`, `ExceptionReview`) are imported and added as `<Route>` elements inside the authenticated layout, and add following the exact same pattern:

```tsx
import SystemEventLog from './pages/SystemEventLog';
// ...
<Route path="/system/events" element={<SystemEventLog />} />
```

Pick a path consistent with whatever URL-naming convention the other routes in that file already use (e.g. if they're `/reports/...`, `/hr/...` style, use `/system/events` or `/reports/system-events` — match the existing scheme rather than introducing a new one).

- [ ] **Step 7: Commit**

```bash
git add backoffice/src/pages/SystemEventLog.tsx backoffice/src/pages/__tests__/SystemEventLog.test.tsx backoffice/src/App.tsx
git commit -m "feat(system-event-log): add Backoffice System Event Log viewer"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && node --test test/*.test.js`
Expected: All tests pass, including every test added in Tasks 2-5.

- [ ] **Step 2: Run the full backoffice test suite**

Run: `cd backoffice && npx vitest run`
Expected: All tests pass, including the test added in Task 6.

- [ ] **Step 3: Grep for accidental secret logging**

Run: `cd server && grep -rn "logSystemEvent" index.js services/ routes/ | grep -iE "password|secret|token|authorization|cookie"`
Expected: no output. If anything matches, fix the call site before proceeding — do not weaken the sanitizer to hide it.

- [ ] **Step 4: Confirm the migration only adds, never alters, existing tables**

Run: `git diff --stat main -- server/migrations/` and manually confirm no file under `server/migrations/` other than `2026-09-07-system-event-logs.sql` was touched.

- [ ] **Step 5: Open the PR and stop**

Push the branch and open a PR whose description answers, verbatim, the questions the task brief requires:
- A. Can a booking currently show success without a persisted booking? (No for the canonical `server/index.js` path — `booking_confirmed_to_client` is only logged after `data.id` exists from a real insert response; YES risk remains for `frontend/src/app/api/bookings/route.ts`, see the divergence note below.)
- B. Are there multiple booking write paths? (Yes — report the exact divergence found in the audit: `frontend/src/app/api/bookings/route.ts` POST inserts directly into `bookings`, bypassing overlap/discount/CRM/notification/Moka logic entirely, and is NOT instrumented by this PR.)
- C. Can we trace one booking attempt end-to-end after this PR? (Yes, for bookings created through `server/index.js` — via `correlation_id` in `/api/internal/system-event-logs/timeline/:correlationId`.)
- D. Does logging failure affect business operations? (No — `logSystemEvent` is fail-open per Task 3's tests; every call site in Task 4 uses `.catch(() => {})` as defense-in-depth.)
- E. Is any sensitive credential stored in `system_event_logs`? (No — enforced by the Task 2 sanitizer and verified in Step 3 above.)

Include the full deliverable list from the task brief (audit, gaps, architecture, migration file, schema, indexes, logger, sanitizer, instrumentation locations, Backoffice page, tests added, test results, files changed, commit SHAs, PR URL, "no production migration was performed", and the BOOKING WRITE PATH DIVERGENCE finding as an explicit unresolved risk). Do not merge. Do not apply the migration to any real database.

---

## Self-Review Notes

- **Spec coverage:** DB table ✅ (Task 1), sanitizer ✅ (Task 2), logger service with fail-open contract ✅ (Task 3), correlation ID ✅ (Task 4 Step 4, reuses existing `randomUUID` import), booking Phase-1 event set ✅ (Task 4, all ten event names from the brief present), Backoffice viewer with filters/timeline/severity coloring ✅ (Task 6), required test list (10 items in the brief) ✅ covered across Tasks 2-4 test files, BOOKING WRITE PATH DIVERGENCE report ✅ (Audit Summary + Task 7 Step 5), booking success invariant ✅ (Task 4 Step 10 comment + Task 4 test 3). Moka/Stockist/WhatsApp/CRM/Cron instrumentation (brief's B-E) and alerting are explicitly Phase 2/3 per the brief's own "Do NOT turn this into one giant PR" instruction — not included here.
- **Placeholder scan:** none remaining — Task 4's test was rewritten to follow this codebase's actual convention for this specific route (`server/test/booking-tier-discount.test.js`'s static source-regex style, not a live-server/mocked-Supabase integration test), and every assertion is concrete.
- **Type consistency:** `logSystemEvent(event, deps)` field names (`bookingId`, `scheduleId`, `correlationId`, etc.) are identical across Task 3's implementation, Task 3's tests, and every call site added in Task 4. The route in Task 5 selects `*` from the same table Task 1 creates and Task 3 inserts into, so column names never need to be re-declared in Task 5/6.
- **Test framework correction (found during pre-flight scan, not at plan-writing time):** the plan as originally drafted used Jest syntax (`describe`/`expect`/`jest.fn`) and `supertest` throughout every `server/test/*.test.js` file, and referenced `npx jest`. The actual repo convention (confirmed via `server/package.json`, root `package.json`'s `"test": "node --test server/test/*.test.js"`, and multiple existing test files) is Node's built-in `node:test` + `node:assert/strict`, with Express routes tested via a real `app.listen(0, '127.0.0.1')` + `fetch()` (see `server/test/stockist-routes-dashboard.test.js`), and the booking route specifically tested via static source-regex assertions (see `server/test/booking-tier-discount.test.js`) since it has no injectable router factory. Every test block and run command in this plan has been rewritten to match. Ruling: use `node:test` everywhere in `server/`, keep Vitest in `backoffice/` (already correct there) — Why: matches the actual repo test infrastructure, no new dependency needed — Cost if wrong: none, this only affects how tests are written/run, not the production code shipped.
