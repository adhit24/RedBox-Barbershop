# Reddy Conversation Idle Timeout + Generic Closing Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Stop Reddy from appending generic closing questions ("Ada yang bisa aku bantu lagi?") to ordinary replies. (2) Add a durable, serverless-safe 5-minute idle-close lifecycle: after Reddy's last reply, if the customer stays silent for ≥5 minutes, send exactly one deterministic closing message and mark the conversation closed; a new message before then cancels the pending close; a message after closing reopens a fresh short-term session without dragging stale booking context along.

**Architecture:** Durable state lives in new `wa_conversations` columns (`conversation_status`, `last_customer_message_at`, `last_bot_message_at`, `idle_close_due_at`, `idle_closed_at`, `session_started_at`), written from two existing choke points — the P0 `guardedSend` wrapper (arms the timer after every successful automated send) and the top of `handleMessage` (resets/reopens on every inbound message) — never from an in-memory timer. A new Vercel cron endpoint (`api/cron/reddy-idle-close.js`), triggered externally the same way `api/cron/home-service-flag.js` already is (cron-job.org, every 5 minutes — see `cronjoborg_homeservice.md`), atomically claims and closes conversations whose `idle_close_due_at` has passed, re-checking Task15 handoff state and reusing the existing P0 guarded-send RPC (extended, additively, to accept a NULL `inbound_event_id` for system-initiated sends) so the close message itself is rate-limited/dedup'd/kill-switched exactly like every other automated send. Generic-closing reduction is a prompt-policy addition plus a deterministic regex-based stripping guard (same pattern as `bookingGuards.js`'s `suppressUnsolicitedBookingCta`), so the fix does not rely solely on the LLM following instructions.

**Tech Stack:** Node.js, `node:test` + `node:assert/strict`. Supabase/Postgres (fluent query builder mocked in tests the same way `task15-p0-crosslayer.test.js` mocks it — a hand-written fake `.from()/.select()/.eq()/.upsert()/.update()` builder, no real network).

**Spec:** Task description "REDDY CONVERSATION LIFECYCLE + 5-MINUTE IDLE CLOSE" (given in full in the originating request).

## Global Constraints

- No in-memory-only timer (`setTimeout`) may be the closing mechanism — must survive across serverless instances (spec §"IMPORTANT SERVERLESS CONSTRAINT").
- Idle closing message text is fixed and deterministic — never LLM-generated.
- Must never close while Task15 handoff status is `waiting_human` or `human_active`.
- The idle-close send MUST go through the existing P0 guarded-outbound path (kill switch, send-once, duplicate-content guard, rate limit) — no raw `sendWA` bypass.
- Reuse the existing cron infrastructure (`api/cron/*.js` + `vercel.json` `functions`/`rewrites` entries, triggered externally per `cronjoborg_homeschema.md`'s established pattern) — do not introduce a new scheduling mechanism.
- Preserve Task14/14.1/15/16, P0/P0.1/P0.2, and the booking-completion-context hotfix (this branch is based on `main`, which does NOT yet include that hotfix branch — they are independent, unmerged branches; do not attempt to merge them here).
- DB migration is additive only (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` that stays backward-compatible for existing non-NULL callers) and is NOT applied to production — return it for review.
- Full suite: zero new regressions vs. `main` baseline (1248 tests / 1236 pass / 11 pre-existing unrelated failures, per the sibling hotfix branch's baseline run).

---

### Task 1: Schema migration (additive, not applied)

**Files:**
- Create: `server/migrations/2026-08-29-wa-conversation-idle-lifecycle.sql`

- [ ] **Step 1:** Write the migration:

```sql
-- Reddy conversation idle-timeout lifecycle (additive). NOT applied to
-- production by this change — for review only.
BEGIN;

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (conversation_status IN ('active', 'closing', 'closed')),
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_bot_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idle_close_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idle_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_idle_due
  ON wa_conversations (idle_close_due_at)
  WHERE conversation_status = 'active';

-- Allow a NULL inbound_event_id: a system-initiated send (the idle-close
-- message) has no triggering inbound customer message to attach to, but must
-- still flow through the same duplicate-content/rate-limit ledger as every
-- other automated send. Postgres UNIQUE allows multiple NULLs, so this does
-- not weaken the existing one-claim-per-inbound-event guarantee at all.
ALTER TABLE wa_outbound_send_claims ALTER COLUMN inbound_event_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION reserve_wa_automated_send(
  p_inbound_event_id UUID,
  p_destination_hash TEXT,
  p_content_hash TEXT,
  p_duplicate_window_seconds INTEGER DEFAULT 90,
  p_rate_window_seconds INTEGER DEFAULT 60,
  p_rate_limit INTEGER DEFAULT 5
)
RETURNS TABLE(decision TEXT, claim_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_claim_id UUID;
  v_updated INTEGER;
BEGIN
  IF COALESCE(p_destination_hash, '') = ''
     OR COALESCE(p_content_hash, '') = '' OR p_duplicate_window_seconds < 1
     OR p_rate_window_seconds < 1 OR p_rate_limit < 1 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_destination_hash, 0));

  IF p_inbound_event_id IS NOT NULL THEN
    UPDATE wa_inbound_events
    SET outbound_attempted = TRUE, processing_status = 'sending', updated_at = v_now
    WHERE id = p_inbound_event_id AND outbound_attempted = FALSE;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RETURN QUERY SELECT 'already_attempted'::TEXT, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND content_hash = p_content_hash
      AND reserved_at >= v_now - make_interval(secs => p_duplicate_window_seconds)
  ) THEN
    IF p_inbound_event_id IS NOT NULL THEN
      UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
      WHERE id = p_inbound_event_id;
    END IF;
    RETURN QUERY SELECT 'duplicate_content'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*) FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND reserved_at >= v_now - make_interval(secs => p_rate_window_seconds)
  ) >= p_rate_limit THEN
    IF p_inbound_event_id IS NOT NULL THEN
      UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
      WHERE id = p_inbound_event_id;
    END IF;
    RETURN QUERY SELECT 'rate_limited'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO wa_outbound_send_claims (
    inbound_event_id, destination_hash, content_hash, reserved_at
  ) VALUES (
    p_inbound_event_id, p_destination_hash, p_content_hash, v_now
  ) RETURNING id INTO v_claim_id;

  RETURN QUERY SELECT 'allowed'::TEXT, v_claim_id;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'error'::TEXT, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION complete_wa_automated_send(
  p_inbound_event_id UUID,
  p_claim_id UUID,
  p_sent BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE wa_outbound_send_claims
  SET reservation_state = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
      completed_at = clock_timestamp()
  WHERE id = p_claim_id AND inbound_event_id IS NOT DISTINCT FROM p_inbound_event_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN FALSE; END IF;

  IF p_inbound_event_id IS NOT NULL THEN
    UPDATE wa_inbound_events
    SET processing_status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
        outbound_sent = p_sent,
        updated_at = clock_timestamp()
    WHERE id = p_inbound_event_id;
  END IF;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) TO service_role;

COMMIT;
```

- [ ] **Step 2:** No automated test for raw SQL (no live DB in CI) — the fake-Supabase unit tests in Tasks 2-5 encode the same NULL-tolerant contract this migration provides. Note in the final report that this migration is unapplied and needs a real Supabase run + `EXPLAIN`/RLS check by Aira before use.

---

### Task 2: `conversationLifecycle.js` — pure state-transition helpers + Supabase-DI functions

**Files:**
- Create: `server/services/conversationLifecycle.js`
- Test: `server/test/reddy-idle-timeout-v01.test.js` (new, houses all tasks' tests)

**Interfaces:**
- Produces:
  - `IDLE_TIMEOUT_MS` (5 * 60 * 1000)
  - `IDLE_CLOSE_MESSAGE` (deterministic string)
  - `touchInboundActivity(supabase, sender, { now }) -> Promise<{ reopened: boolean } | null>` — upserts `last_customer_message_at`, bumps `idle_close_due_at` to `now + IDLE_TIMEOUT_MS`; if the row's prior `conversation_status` was `'closed'`, also sets `conversation_status: 'active'`, `session_started_at: now`, `idle_closed_at: null` and returns `{ reopened: true }`.
  - `armIdleTimerAfterReply(supabase, sender, { now }) -> Promise<void>` — upserts `last_bot_message_at`, bumps `idle_close_due_at` to `now + IDLE_TIMEOUT_MS`.
  - `claimIdleConversation(supabase, sender, { now }) -> Promise<{ sender, last_customer_message_at, idle_close_due_at } | null>` — atomic `UPDATE ... SET conversation_status='closing' WHERE sender=? AND conversation_status='active' AND idle_close_due_at <= now AND idle_closed_at IS NULL RETURNING ...`; `null` if the row didn't match (already claimed/reopened/not yet due).
  - `finalizeIdleClose(supabase, sender, { now, sent }) -> Promise<void>` — if `sent`, `UPDATE ... SET conversation_status='closed', idle_closed_at=now WHERE sender=? AND conversation_status='closing'`; else `UPDATE ... SET conversation_status='active' WHERE sender=? AND conversation_status='closing'` (revert the claim so a later cron pass retries).

- [ ] **Step 1: Write failing tests** for each function against a hand-written fake `wa_conversations` Supabase builder (same pattern as `task15-p0-crosslayer.test.js`'s `fakeP0Supabase`/`fakeHandoffSupabase`):
  - `touchInboundActivity` on a brand-new sender creates a row, `active`, due 5 min out, `reopened: false`.
  - `touchInboundActivity` on a `closed` row flips to `active`, sets `session_started_at`, `idle_closed_at: null`, returns `reopened: true`.
  - `armIdleTimerAfterReply` bumps `idle_close_due_at` forward from whatever it was.
  - `claimIdleConversation` returns the row when due and not yet closed/claimed; returns `null` when not yet due, already `closing`/`closed`, or `idle_closed_at` already set.
  - `claimIdleConversation` called twice concurrently (simulated: second call after first already flipped status to `closing` in the fake store) — second call gets `null` (no double-claim).
  - `finalizeIdleClose({ sent: true })` sets `closed` + `idle_closed_at`; `finalizeIdleClose({ sent: false })` reverts to `active` and leaves `idle_close_due_at` unchanged (so it's still overdue for retry).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `conversationLifecycle.js`:

```js
'use strict';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const IDLE_CLOSE_MESSAGE =
  'Terima kasih sudah menghubungi Redbox ya Kak. Kalau nanti butuh info lagi, tinggal chat kami lagi aja.';

function toIso(ms) {
  return new Date(ms).toISOString();
}

async function touchInboundActivity(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return null;
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .select('conversation_status')
      .eq('sender', sender)
      .maybeSingle();
    const wasClosed = data?.conversation_status === 'closed';
    const patch = {
      conversation_status: 'active',
      last_customer_message_at: toIso(now),
      idle_close_due_at: toIso(now + IDLE_TIMEOUT_MS),
      updated_at: toIso(now),
      ...(wasClosed ? { session_started_at: toIso(now), idle_closed_at: null } : {}),
    };
    await supabase.from('wa_conversations').upsert({ sender, ...patch }, { onConflict: 'sender' });
    return { reopened: wasClosed };
  } catch (_error) {
    return null;
  }
}

async function armIdleTimerAfterReply(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return;
  try {
    await supabase.from('wa_conversations').upsert({
      sender,
      last_bot_message_at: toIso(now),
      idle_close_due_at: toIso(now + IDLE_TIMEOUT_MS),
      updated_at: toIso(now),
    }, { onConflict: 'sender' });
  } catch (_error) { /* best-effort — never blocks the send path */ }
}

async function claimIdleConversation(supabase, sender, { now = Date.now() } = {}) {
  if (!supabase || !sender) return null;
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .update({ conversation_status: 'closing', updated_at: toIso(now) })
      .eq('sender', sender)
      .eq('conversation_status', 'active')
      .lte('idle_close_due_at', toIso(now))
      .is('idle_closed_at', null)
      .select('sender,last_customer_message_at,idle_close_due_at')
      .maybeSingle();
    return data || null;
  } catch (_error) {
    return null;
  }
}

async function finalizeIdleClose(supabase, sender, { now = Date.now(), sent } = {}) {
  if (!supabase || !sender) return;
  try {
    if (sent) {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'closed', idle_closed_at: toIso(now), updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('conversation_status', 'closing');
    } else {
      await supabase.from('wa_conversations')
        .update({ conversation_status: 'active', updated_at: toIso(now) })
        .eq('sender', sender)
        .eq('conversation_status', 'closing');
    }
  } catch (_error) { /* best-effort */ }
}

module.exports = {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_MESSAGE,
  touchInboundActivity,
  armIdleTimerAfterReply,
  claimIdleConversation,
  finalizeIdleClose,
};
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Telemetry — idle lifecycle event schema

**Files:**
- Modify: `server/orchestrator/telemetry.js`
- Test: `server/test/reddy-idle-timeout-v01.test.js`

**Interfaces:**
- Produces: `sanitizeIdleLifecycleTelemetry(event) -> safeEvent`, `logIdleLifecycleEvent(event) -> safeEvent` (console.log side effect, same style as `logAntiSpamEvent`).

- [ ] **Step 1: Write failing tests** asserting an unknown `event_type` sanitizes to `'unknown'`, all 5 required event types plus the 2 optional flags pass through, and `branch`/`sender`-shaped free text is never accepted as a field (no PII surface).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**, appended to `telemetry.js`:

```js
const ALLOWED_IDLE_LIFECYCLE_EVENTS = new Set([
  'conversation_idle_timer_scheduled', 'conversation_idle_timer_reset',
  'conversation_idle_close_sent', 'conversation_idle_close_suppressed',
  'conversation_session_reopened',
]);
const ALLOWED_IDLE_SUPPRESS_REASONS = new Set([
  'waiting_human', 'human_active', 'reddy_disabled', 'already_closed',
  'not_yet_due', 'claim_lost_race', 'send_failed', null,
]);

function sanitizeIdleLifecycleTelemetry(event = {}) {
  return {
    timestamp: new Date().toISOString(),
    event_type: ALLOWED_IDLE_LIFECYCLE_EVENTS.has(event.event_type) ? event.event_type : 'unknown',
    branch: typeof event.branch === 'string' ? event.branch : 'unknown',
    suppress_reason: ALLOWED_IDLE_SUPPRESS_REASONS.has(event.suppress_reason) ? event.suppress_reason : null,
    stale_idle_close_prevented: typeof event.stale_idle_close_prevented === 'boolean'
      ? event.stale_idle_close_prevented : null,
    duplicate_idle_close_prevented: typeof event.duplicate_idle_close_prevented === 'boolean'
      ? event.duplicate_idle_close_prevented : null,
  };
}

function logIdleLifecycleEvent(event = {}) {
  const safe = sanitizeIdleLifecycleTelemetry(event);
  console.log('[IdleLifecycleTelemetry]', JSON.stringify(safe));
  return safe;
}
```

  Add both to `module.exports`.

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 4: `waOutboundGuard.js` — optional post-send lifecycle hook

**Files:**
- Modify: `server/services/waOutboundGuard.js`
- Test: `server/test/reddy-idle-timeout-v01.test.js`

**Interfaces:**
- Consumes: new optional `createGuardedSend({ ..., onSendSuccess = async () => {} })` parameter.
- Produces: `onSendSuccess(to, message, options)` is awaited exactly once, only after a send both passed the guard AND actually succeeded (`sent === true`) — never on suppression, never on throw.

- [ ] **Step 1: Write failing test**: a `createGuardedSend` instance with a spy `onSendSuccess` — asserts it's called once with `(to, message, options)` on success, and NOT called when suppressed (kill switch / duplicate / rate-limited) or when `realSend` throws.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `createGuardedSend`, add `onSendSuccess = async () => {}` to the destructured options, and after the existing `const sent = Boolean(result && result.status !== false);` line, add:

```js
    if (sent) {
      try { await onSendSuccess(to, message, options); } catch (_error) { /* never blocks the send result */ }
    }
```

  (placed before the existing `await markOutboundResult(...)` call or after — order doesn't matter since they're independent; keep it right after the `sent` computation for readability.)

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 5: Wire the timer into `webhook.js` (inbound reset/reopen + outbound arm)

**Files:**
- Modify: `api/wa/webhook.js`
- Test: `server/test/reddy-idle-timeout-v01.test.js`

**Interfaces:**
- Consumes: `touchInboundActivity`, `armIdleTimerAfterReply` from Task 2; `logIdleLifecycleEvent` from Task 3; `onSendSuccess` hook from Task 4.
- Produces: `handleMessage` gains a new injectable dep `touchLifecycle = (sender) => touchInboundActivity(getSupabase(), sender, {})`, called once near the top (after the Task15/legacy-pause gates, before the points-inquiry fast path), and its `reopened` result forces `loadedHistoryResult = { history: [], status: 'empty' }` for this turn only, clearing `conversationCache`/`cacheTimestamps` for the sender. The outer `handler()`'s `createGuardedSend(...)` call gains `onSendSuccess: (to) => armIdleTimerAfterReply(supabaseForGuard, to, {})`.

- [ ] **Step 1: Write failing tests** (full-webhook-level, via `handleMessage`/exported `handler`, mirroring existing DI-test style in this file's sibling suites):
  1. A message on a `closed` conversation reopens it (`touchLifecycle` stub returns `{ reopened: true }`) and the `conversationContext` passed downstream to `orchestrate`/`executeReddy` has empty `turns` even though a `loadConversationHistory` stub would otherwise return old turns — proves stale booking context cannot bleed into the reopened turn.
  2. A message on an `active` conversation does NOT clear history (normal continuity preserved).
  3. `createGuardedSend`'s `onSendSuccess` is wired to `armIdleTimerAfterReply` in the real `handler()` — a full HTTP-level test (fake Supabase capturing the upsert payload) confirms `idle_close_due_at` gets bumped after a successful automated send.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement:**
  - Add `const { touchInboundActivity, armIdleTimerAfterReply } = require('../../server/services/conversationLifecycle');` and `const { logIdleLifecycleEvent } = require('../../server/orchestrator/telemetry');` near the existing requires.
  - In `handleMessage`, add to the `deps` destructure: `touchLifecycle = (sender) => touchInboundActivity(getSupabase(), sender, {}),`.
  - Immediately after the legacy `aiPaused`/`checkHumanTakeover` block (after line ~1331 in the pre-change file) and before the points-inquiry fast path, add:

```js
  let sessionReopened = false;
  try {
    const lifecycle = await touchLifecycle(from);
    sessionReopened = Boolean(lifecycle?.reopened);
    if (sessionReopened) {
      conversationCache.delete(from);
      cacheTimestamps.delete(from);
      logIdleLifecycleEvent({ event_type: 'conversation_session_reopened', branch });
    } else {
      logIdleLifecycleEvent({ event_type: 'conversation_idle_timer_reset', branch });
    }
  } catch (_error) { /* best-effort — never blocks message processing */ }
```

  - Change the history-load line (originally `const loadedHistoryResult = await safeLoadConversationHistory(loadConversationHistory, from);`) to:

```js
  const loadedHistoryResult = sessionReopened
    ? { history: [], status: 'empty' }
    : await safeLoadConversationHistory(loadConversationHistory, from);
```

  - In the outer `handler()`, extend the `createGuardedSend({...})` call with:

```js
      onSendSuccess: (to) => armIdleTimerAfterReply(supabaseForGuard, to, {}).then(
        () => logIdleLifecycleEvent({ event_type: 'conversation_idle_timer_scheduled', branch: branchForGuardTelemetry }),
      ),
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 6: Cron endpoint — `api/cron/reddy-idle-close.js`

**Files:**
- Create: `api/cron/reddy-idle-close.js`
- Modify: `vercel.json` (add function + rewrite entries, matching the existing `api/cron/*.js` pattern)
- Test: `server/test/reddy-idle-timeout-v01.test.js`

**Interfaces:**
- Produces: `module.exports = async function handler(req, res, testDeps = {})`. Auth: `Authorization: Bearer <CRON_SECRET>`, same as `expire-stale-bills.js`. `testDeps` may supply `supabase`, `sendWA`, `isReddyEnabled`, `getActiveHandoffState`, `logEvent`, and `candidateSenders` (an explicit list, so a test doesn't need a full `wa_conversations` table scan mock).

- [ ] **Step 1: Write failing tests** for all of: exactly-one-close-when-overdue; second job run (simulated duplicate invocation over the same candidate) sends only once; `waiting_human`/`human_active` → no send, `conversation_idle_close_suppressed` logged with the right `suppress_reason`; `REDDY_ENABLED=false` → no send (via the real `isReddyEnabled()` reading `process.env.REDDY_ENABLED`, matching `paused-cron-status.test.js`'s env-var style); a `sendWA` throw/failure leaves the row `active` (not falsely `closed`) so a later run retries; unauthenticated request → 401, matching `expire-stale-bills.js`'s pattern.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement:**

```js
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { isReddyEnabled } = require('../../server/services/waInboundGuard');
const { getActiveHandoffState } = require('../../server/services/humanHandoff');
const { createGuardedSend } = require('../../server/services/waOutboundGuard');
const {
  IDLE_CLOSE_MESSAGE, claimIdleConversation, finalizeIdleClose,
} = require('../../server/services/conversationLifecycle');
const { logIdleLifecycleEvent } = require('../../server/orchestrator/telemetry');
const { sendWA: realSendWA } = require('../../server/services/fonnteClient'); // existing WA send helper — see webhook.js's own `sendWA` import for the exact path

async function findDueSenders(supabase, { now = Date.now(), limit = 200 } = {}) {
  const { data } = await supabase
    .from('wa_conversations')
    .select('sender')
    .eq('conversation_status', 'active')
    .not('idle_close_due_at', 'is', null)
    .lte('idle_close_due_at', new Date(now).toISOString())
    .is('idle_closed_at', null)
    .limit(limit);
  return (data || []).map((row) => row.sender);
}

module.exports = async function handler(req, res, testDeps = {}) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = testDeps.supabase || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const enabled = testDeps.isReddyEnabled ? testDeps.isReddyEnabled() : isReddyEnabled();
  const logEvent = testDeps.logEvent || logIdleLifecycleEvent;

  if (!enabled) {
    logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'reddy_disabled' });
    return res.status(200).json({ ok: true, closed: 0, suppressed: 'reddy_disabled' });
  }

  const handoffLookup = testDeps.getActiveHandoffState || ((phone) => getActiveHandoffState(phone, { supabase }));
  const sendFn = testDeps.sendWA || realSendWA;
  const guardedSend = createGuardedSend({
    realSend: sendFn,
    supabase,
    inboundEventRowId: null,
    isEnabled: () => (testDeps.isReddyEnabled ? testDeps.isReddyEnabled() : isReddyEnabled()),
    logEvent: (e) => logEvent({ ...e }),
  });

  const senders = testDeps.candidateSenders || await findDueSenders(supabase, {});
  let closed = 0;
  let suppressed = 0;

  for (const sender of senders) {
    const handoffState = await handoffLookup(sender);
    if (handoffState.status === 'waiting_human' || handoffState.status === 'human_active') {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: handoffState.status });
      continue;
    }

    const claim = await claimIdleConversation(supabase, sender, {});
    if (!claim) {
      // Already claimed by a concurrent run, reopened, or not actually due — do nothing.
      continue;
    }

    let sendResult;
    try {
      sendResult = await guardedSend(sender, IDLE_CLOSE_MESSAGE, {});
    } catch (_error) {
      sendResult = { status: false };
    }
    const sent = Boolean(sendResult && sendResult.status !== false);
    await finalizeIdleClose(supabase, sender, { sent });
    if (sent) {
      closed++;
      logEvent({ event_type: 'conversation_idle_close_sent' });
    } else {
      suppressed++;
      logEvent({ event_type: 'conversation_idle_close_suppressed', suppress_reason: 'send_failed' });
    }
  }

  return res.status(200).json({ ok: true, closed, suppressed });
};
```

  Note: confirm the exact existing WA-send helper's module path/export name from `api/wa/webhook.js`'s own top-of-file requires before finalizing this import — reuse the identical function the production webhook uses for outbound Fonnte sends (do not write a second implementation).

  Add to `vercel.json`:
  - `"functions"`: `"api/cron/reddy-idle-close.js": { "maxDuration": 60, "includeFiles": "server/**" }`
  - `"rewrites"`: `{ "source": "/api/cron/reddy-idle-close", "destination": "/api/cron/reddy-idle-close.js" }`

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 7: Generic closing reduction — prompt + deterministic strip guard

**Files:**
- Create: `server/agents/reddy/closingSuppressionGuard.js`
- Modify: `server/agents/reddy/personalityPolicy.js`
- Modify: `server/agents/reddy/reddyAdapter.js`
- Test: `server/test/reddy-idle-timeout-v01.test.js`

**Interfaces:**
- Produces: `stripGenericClosingQuestion(reply) -> { sanitizedReply, closingStripped }`.

- [ ] **Step 1: Write failing tests**: each of the 4 spec-listed BAD phrases gets stripped from a multi-sentence reply while the rest of the reply survives; a task-advancing clarification ("Mau di cabang mana, Kak?", "Mau booking untuk kapan, Kak?") is never stripped; `executeReddyAgent` end-to-end strips a generic closing from a stubbed `callOpenAI` reply.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `closingSuppressionGuard.js`:

```js
'use strict';

// Task: Reddy conversation lifecycle — normal replies must not append a
// generic closing question; the system (idle-timeout cron), not the LLM on
// every turn, controls conversation closure. Deliberately scoped to the
// specific generic phrasings called out in spec — a task-advancing
// clarification question ("Mau di cabang mana, Kak?") has none of this
// shape and is never touched.
const GENERIC_CLOSING_PATTERNS = [
  /\bada\s+yang\s+bisa\s+(aku|saya|kami)\s+bantu\s+lagi\s*\??/i,
  /\bkalau\s+ada\s+yang\s+(mau|ingin)\s+ditanyakan,?\s+jangan\s+ragu\s+ya\.?/i,
  /\bada\s+yang\s+ingin\s+kamu\s+tanyakan\s+seputar\s+redbox\s*\??/i,
  /\bkalau\s+ada\s+yang\s+bisa\s+(aku|saya|kami)\s+bantu\s+lagi,?\s+silakan\s+tanya\.?/i,
  /\bjangan\s+ragu\s+(untuk\s+)?(tanya|bertanya)\s+ya\.?/i,
];

function stripGenericClosingQuestion(reply) {
  if (typeof reply !== 'string' || !reply.trim()) {
    return { sanitizedReply: reply, closingStripped: false };
  }
  const sentences = reply.match(/[^.!?]+[.!?]*/g) || [reply];
  let closingStripped = false;
  const kept = sentences.filter((sentence) => {
    const isGenericClosing = GENERIC_CLOSING_PATTERNS.some((pattern) => pattern.test(sentence));
    if (isGenericClosing) closingStripped = true;
    return !isGenericClosing;
  });
  const rejoined = kept.join('').trim();
  return { sanitizedReply: rejoined || reply.trim(), closingStripped };
}

module.exports = { stripGenericClosingQuestion, GENERIC_CLOSING_PATTERNS };
```

  In `personalityPolicy.js`, add a new numbered rule to the prompt string (after rule 9, renumber not required — existing prompt already has a duplicate "13."/"12." numbering quirk, follow that precedent and just append):

```js
    '14. TANPA PENUTUP GENERIK OTOMATIS: Jawaban normal TIDAK PERLU menutup percakapan. Sistem (bukan kamu) yang mengatur kapan percakapan berakhir. DILARANG menambahkan pertanyaan penutup generik di akhir jawaban biasa, misal: "Ada yang bisa aku bantu lagi?", "Kalau ada yang mau ditanyakan, jangan ragu ya.", "Ada yang ingin kamu tanyakan seputar Redbox?". Jawab pertanyaan lalu berhenti. PENGECUALIAN: pertanyaan klarifikasi yang MEMANG diperlukan untuk melanjutkan tugas pelanggan (misal pelanggan bilang "mau booking" lalu kamu tanya "Mau di cabang mana, Kak?") tetap diperbolehkan — itu bukan penutup generik.\n';
```

  In `reddyAdapter.js`, import `stripGenericClosingQuestion` and apply it right after `guardRealtimeBarberFacts` and before the final `suppressUnsolicitedBookingCta` re-check pass:

```js
  const closingGuarded = stripGenericClosingQuestion(reply);
  reply = closingGuarded.sanitizedReply;
  if (closingGuarded.closingStripped) {
    logBookingTelemetry({
      route: 'reddy_agent', agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'generic_closing_suppressed', branch,
      trust_status: 'unverified', execution_status: 'guarded',
    });
  }
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 8: Full regression sweep

- [ ] **Step 1:** Focused: `node --test server/test/reddy-idle-timeout-v01.test.js server/test/booking-intelligence-v01.test.js server/test/task14-1-context-knowledge-hotfix.test.js server/test/task14-1-p0-reconciliation.test.js server/test/conversation-intelligence-v01.test.js server/test/human-handoff-v01.test.js server/test/task15-branch-authorization.test.js server/test/task15-legacy-authority.test.js server/test/task15-p0-crosslayer.test.js server/test/p0-antispam-idempotency.test.js server/test/p01-fonnte-envelope-normalization.test.js server/test/p02-price-keyword-intent.test.js server/test/orchestrator-reddy-integration-v01.test.js server/test/orchestrator-execution-v01.test.js server/test/ai-orchestrator-contract.test.js server/test/ai-orchestrator-route.test.js server/test/reddy-behavioral-personality-v21.test.js server/test/reddy-conversation-policy-v01.test.js server/test/reddy-24x7-ai-availability-v01.test.js server/test/paused-cron-status.test.js`
- [ ] **Step 2:** Full suite: `node --test server/test/*.test.js`, record exact pass/fail.
- [ ] **Step 3:** Compare against the `main` baseline (1248/1236/11, same 11 pre-existing unrelated failures already established for the sibling hotfix branch).
- [ ] **Step 4:** Commit; do not merge; push; open draft PR.

## Self-Review Notes

- Spec coverage: all 15 required tests map onto Tasks 2, 4, 6, 7's test steps. Migration is additive-only and unapplied per spec's explicit instruction. `session_id` field from spec's "possible conceptual fields" was intentionally dropped in favor of `session_started_at` alone — `sender` is already the natural conversation key and a separate session id added no test-observable behavior.
- Type/signature consistency: `conversationLifecycle.js`'s exports are used identically in Tasks 5 and 6 as defined in Task 2.
- Known open item for Aira review: Task 6's exact WA-send helper import path is a placeholder (`../../server/services/fonnteClient`) — must be corrected to match whatever `api/wa/webhook.js` actually imports as `sendWA` before merge; implementation step must verify this against the real file before writing the import.
