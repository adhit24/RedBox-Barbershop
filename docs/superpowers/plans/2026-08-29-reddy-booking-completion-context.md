# Reddy Booking-Completion-Context Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Reddy from replying with the deterministic "Booking belum dibuat atau diubah lewat WhatsApp ya Kak..." rejection when a customer is merely *reporting* that they already completed a booking on the website (as opposed to *asking* Reddy to create/change a booking).

**Architecture:** Add a new, narrowly-scoped deterministic classifier (`detectBookingCompletionReport`) that recognizes customer-reported-completion phrasing using message shape + recent conversation context. Wire it into `orchestratorService.buildDecisionEnvelope` as a new `conversational_act` (`booking_completion_report`) that takes precedence over the existing bag-of-words contextual-followup rules (which are the actual root cause of the misfire — see below). Downstream, `bookingEligibility.js` treats this act as CTA-ineligible, and `reddyAdapter.js` short-circuits to a single deterministic, natural-tone acknowledgement reply — bypassing the LLM and the prohibited-claim guard entirely for this narrow case, so there is no risk of the guard's regexes (which cannot distinguish "Reddy claims it booked" from "customer says they already booked") misfiring again.

**Tech Stack:** Node.js, `node:test` + `node:assert/strict` (no Jest/Vitest). Plain CommonJS modules, dependency-injected tests (no network/LLM/DB).

**Spec:** Task description "REDDY BOOKING CONTEXT INTERPRETATION HOTFIX" (given in full in the originating request; not a separate file in this repo).

## Root Cause (confirmed by reading source, not guessed)

1. `server/orchestrator/orchestratorService.js` `buildDecisionEnvelope()` has ~6 bag-of-words "contextual followup" branches (temporal/branch/service/barber choice) that fire whenever the current message is short (`shortChoice`, ≤40 chars) and matches a *very* generic pattern (e.g. `/^[\p{L} .'-]+$/u` for barber_choice_followup) **and** any of the last 6 turns (any role) contain generic words like "pilih", "mau", "kapster", "barber". A bare completion report like "Sudah kak" satisfies this shape whenever recent booking-guidance turns are in context (which they always are, right after Reddy has just guided the customer to the website).
2. This misclassifies the turn as `intent: 'booking_request'`, `conversational_act: 'barber_choice_followup'` (or similar).
3. `server/agents/reddy/bookingEligibility.js` `deriveBookingEligibility()` treats any of these acts as `contextual_booking_continuation` → `responseEligible = ctaEligible = true`.
4. The LLM is then prompted with a live `booking_authority.handoff_url` and an orchestrator decision framed as "continue booking selection" — even though the customer actually said "I already did this." The natural reply it generates ("sudah aku catat", "sudah booking...", etc.) trips one of `PROHIBITED_PATTERNS` in `server/agents/reddy/bookingGuards.js` (patterns like `/\b(sudah|telah|udah)\s+(aku|saya|kami)?\s*(booking|...)\b/i` cannot tell "Reddy claims it booked" from "customer says they booked" — both read the same to the regex).
5. `guardReddyReply()` then overwrites the reply with the canned `"Booking belum dibuat atau diubah lewat WhatsApp ya Kak..."` string, since `blockedProhibitedClaim = true` and `bookingCtaEligible = true` (this is `server/agents/reddy/bookingGuards.js:119-125`).

Fixing this requires intercepting the turn *before* the contextual-followup bag-of-words rules run, not patching the guard regexes (which would either stay too broad or become fragile trying to parse grammatical subject).

## Global Constraints

- `REDDY_BOOKING_EXECUTION = 'DISABLED'` must remain unchanged — no booking mutation capability is added.
- Do not weaken Task14 (`bookingContext.js`), Task14.1 (`bookingEligibility.js`, `bookingGuards.js`, `realtimeFactGuard.js`), Task15 (`humanHandoff.js`), Task16 (`telemetry.js`), or P0/P0.1/P0.2 guards.
- Telemetry stays a strict allowlist (zero PII) — any new `conversational_act` / `response_strategy` / `booking_eligibility_reason` value used in a `logOrchestratedEvent` call must be added to the matching `Set` in `server/orchestrator/telemetry.js:sanitizeTelemetry`, or it is silently dropped.
- Test runner: `node --test server/test/*.test.js` (see `package.json`). No new test framework.
- Zero regressions in the full suite vs. `main`.

---

### Task 1: Deterministic completion-report classifier

**Files:**
- Create: `server/agents/reddy/bookingCompletionReport.js`
- Test: `server/test/booking-completion-context-v01.test.js` (new file, also houses Tasks 2-4 tests)

**Interfaces:**
- Produces: `detectBookingCompletionReport({ text, conversationContext }) -> { isCompletionReport: boolean, reason: string }`. `conversationContext` is the same envelope shape used throughout the codebase: `{ turns: [{ role: 'user'|'assistant', content: string }, ...], ... }`.

- [ ] **Step 1: Write failing tests for the classifier** covering: bare "sudah kak"/"udah" require booking-guidance context to fire; explicit phrases ("udah booking di web", "udah dapet jam 2", "sudah saya booking") fire without context; status questions ("booking saya sudah belum?", messages ending in "?") never fire; unrelated "sudah" usage ("sudah bayar?", "sudah potong tadi") never fires.
- [ ] **Step 2: Run to verify failure** (module does not exist yet).
- [ ] **Step 3: Implement** `bookingCompletionReport.js` per the design below.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

Implementation:

```js
'use strict';

/**
 * Distinguishes a customer REPORTING that they already completed a booking
 * (on the website) from a customer REQUESTING that Reddy create/change one,
 * and from an unrelated use of "sudah/udah". Deliberately narrow: bare
 * "sudah"/"udah"-only phrasing only counts as a completion report when
 * recent conversation context shows booking guidance was actually given —
 * see spec CONTEXT RULE. Explicit self-declaring phrases ("udah booking di
 * web", "udah dapet jam 2") don't need that context.
 */

const BARE_COMPLETION_PATTERNS = [
  /^(?:sudah|udah)\s*(?:kak|ka|deh|nih|tuh|dong)?[.!]?\s*$/i,
  /^oke\s+(?:kak\s+)?sudah\s*(?:ya|kak)?[.!]?\s*$/i,
  /^(?:sudah|udah)\s+selesai[.!]?\s*$/i,
  /^sudah\s+berhasil[.!]?\s*$/i,
];

const EXPLICIT_COMPLETION_PATTERNS = [
  /\b(?:sudah|udah)\s+(?:saya\s+|aku\s+)?book(?:ing)?\b/i,
  /\b(?:sudah|udah)\s+(?:dapet|dapat)\b/i,
  /\btadi\b[^.!?]{0,40}\b(?:booking|book)\b[^.!?]{0,40}\b(?:web|website)\b/i,
  /\btadi\b[^.!?]{0,40}\b(?:web|website)\b[^.!?]{0,40}\b(?:booking|book)\b/i,
];

const STATUS_QUERY_PATTERN = /\bbelum\b/i;

const BOOKING_GUIDANCE_CONTEXT_PATTERN =
  /\b(booking|reservasi|website|redboxbarbershop|link|jadwal|slot|kapster|barber)\b/i;

function hasRecentBookingGuidanceContext(conversationContext) {
  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns.slice(-6) : [];
  return turns.some(
    (turn) => turn && typeof turn.content === 'string' && BOOKING_GUIDANCE_CONTEXT_PATTERN.test(turn.content),
  );
}

function detectBookingCompletionReport({ text, conversationContext } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { isCompletionReport: false, reason: 'empty' };
  if (raw.endsWith('?')) return { isCompletionReport: false, reason: 'question' };
  if (STATUS_QUERY_PATTERN.test(raw)) return { isCompletionReport: false, reason: 'status_query' };

  if (EXPLICIT_COMPLETION_PATTERNS.some((pattern) => pattern.test(raw))) {
    return { isCompletionReport: true, reason: 'explicit_completion_phrase' };
  }

  const bare = BARE_COMPLETION_PATTERNS.some((pattern) => pattern.test(raw));
  if (bare && hasRecentBookingGuidanceContext(conversationContext)) {
    return { isCompletionReport: true, reason: 'contextual_completion_ack' };
  }

  return { isCompletionReport: false, reason: bare ? 'bare_without_context' : 'no_match' };
}

module.exports = { detectBookingCompletionReport, hasRecentBookingGuidanceContext };
```

---

### Task 2: Wire classification into the orchestrator decision envelope

**Files:**
- Modify: `server/orchestrator/orchestratorService.js`
- Modify: `server/orchestrator/telemetry.js` (allowlist additions)
- Test: `server/test/booking-completion-context-v01.test.js`

**Interfaces:**
- Consumes: `detectBookingCompletionReport` from Task 1.
- Produces: when detected, `buildDecisionEnvelope(...)` returns `conversational_act: 'booking_completion_report'`, `intent: 'general_question'`, `action: 'acknowledge_booking_completion'`, `response_strategy: 'acknowledge_booking_completion_report'`, `session_behavior: 'keep_current_state'`.

- [ ] **Step 1: Write failing tests** using `buildDecisionEnvelope({ message, conversationContext, decision })` directly (see `task13-6-4-member-identity-semantic-integrity.test.js` for the calling convention already used in this codebase), asserting the new fields for: bare "Sudah kak" with a prior assistant booking-CTA turn; the full production regression turn sequence; and that "booking saya sudah belum?" / "sudah bayar?" / "sudah potong tadi" / "bisa booking jam 2?" are NOT reclassified (existing behavior/fields unchanged for those).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `orchestratorService.js`, add `const { detectBookingCompletionReport } = require('../agents/reddy/bookingCompletionReport');` at the top. Inside `buildDecisionEnvelope`, add a new first branch in the `if/else if` chain (before the `hasActiveContext && currentTimeChoice` branch at the current line ~172):

```js
  const completionReport = detectBookingCompletionReport({ text: message, conversationContext });

  if (completionReport.isCompletionReport) {
    conversationalAct = 'booking_completion_report';
    sessionBehavior = 'keep_current_state';
    resolved = {
      ...resolved,
      intent: 'general_question',
      route: 'reddy_agent',
      agent: 'reddy_agent',
      action: 'acknowledge_booking_completion',
    };
    policy = {
      required_sources: [],
      response_strategy: 'acknowledge_booking_completion_report',
      allowed_claims: ['acknowledge_customer_reported_completion'],
      prohibited_claims: [
        'booking_confirmed_by_whatsapp',
        'booking_confirmed_by_backend',
        'repeat_booking_cta',
      ],
    };
  } else if (hasActiveContext && currentTimeChoice && (priorTimeContext || conversationContext?.sessionStatus !== 'expired')) {
    // ...existing branch unchanged...
```

  Then in `server/orchestrator/telemetry.js`, add to the three allowlists inside `sanitizeTelemetry`:
  - `allowedActs`: add `'booking_completion_report'`
  - `allowedStrategies`: add `'acknowledge_booking_completion_report'`
  - `allowedEligibilityReasons`: add `'booking_completion_acknowledged'` (used by Task 3)

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Make the completion-report act CTA-ineligible

**Files:**
- Modify: `server/agents/reddy/bookingEligibility.js`
- Test: `server/test/booking-completion-context-v01.test.js`

**Interfaces:**
- Consumes: `orchestrationDecision.conversational_act === 'booking_completion_report'` (Task 2's output).
- Produces: `deriveBookingEligibility(...)` returns `{ responseEligible: false, ctaEligible: false, reason: 'booking_completion_acknowledged' }` for this act, taking priority over every other reason branch.

- [ ] **Step 1: Write failing test** calling `deriveBookingEligibility({ text: 'Sudah kak', orchestrationDecision: { intent: 'general_question', conversational_act: 'booking_completion_report' } })` and asserting `responseEligible === false`, `ctaEligible === false`, `reason === 'booking_completion_acknowledged'`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `deriveBookingEligibility`, add as the *first* check in the `if/else if` reason chain (before `explicitLinkRequest`):

```js
  if (act === 'booking_completion_report') {
    return { memoryRelevant, responseEligible: false, ctaEligible: false, reason: 'booking_completion_acknowledged' };
  }
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 4: Deterministic acknowledgement short-circuit in `reddyAdapter.js`

**Files:**
- Modify: `server/agents/reddy/reddyAdapter.js`
- Test: `server/test/booking-completion-context-v01.test.js`

**Interfaces:**
- Consumes: `orchestrationDecision.conversational_act === 'booking_completion_report'`; `deriveBookingEligibility` output from Task 3; `logBookingTelemetry`, `persistConversation`, `sendWA` dependencies (existing signatures, unchanged).
- Produces: `executeReddyAgent(...)` returns `{ used: 'reddy_agent', reply: BOOKING_COMPLETION_ACK_REPLY, sendResult, error: null }` without invoking `callOpenAI`.

- [ ] **Step 1: Write failing tests** replaying:
  1. The exact production regression sequence (assistant already told customer Ubay is available and to book on the website; customer says "Oke kak besok saja ya" then "Oke kak sudah jam 2 besok" then "Sudah kak") — assert the final reply equals the canned acknowledgement, contains no URL, does not match `/belum dibuat atau diubah/i`, does not match `/terkonfirmasi|confirmed/i`, and that `callOpenAI` was never called for that final turn.
  2. `callOpenAI` not invoked, `sendWA` invoked exactly once, `persistConversation` receives the same sanitized reply.
  3. Telemetry event `action: 'booking_completion_acknowledged'` logged with `booking_cta_eligible: false`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `reddyAdapter.js`, add near the top (after existing requires):

```js
const { detectBookingCompletionReport } = require('./bookingCompletionReport');

const BOOKING_COMPLETION_ACK_REPLY =
  'Sip Kak, kalau sudah selesai booking di website berarti tinggal datang sesuai jadwal yang dipilih ya.';
```

  Then inside `executeReddyAgent`, immediately after the `deriveBookingEligibility` destructure (after the existing block that computes `bookingMemoryRelevant`/`bookingResponseEligible`/`bookingCtaEligible`/`bookingEligibilityReason`, before `realtimeBarberQuerySignal` is computed), insert:

```js
  const isBookingCompletionReport = orchestrationDecision?.conversational_act === 'booking_completion_report';

  if (isBookingCompletionReport) {
    const reply = BOOKING_COMPLETION_ACK_REPLY;

    logBookingTelemetry({
      route: 'reddy_agent',
      agent: 'reddy_agent',
      intent: orchestrationDecision?.intent || 'unknown',
      action: 'booking_completion_acknowledged',
      branch,
      trust_status: 'unverified',
      execution_status: 'acknowledged',
      booking_memory_relevant: bookingMemoryRelevant,
      booking_response_eligible: bookingResponseEligible,
      booking_cta_eligible: bookingCtaEligible,
      booking_eligibility_reason: bookingEligibilityReason,
    });

    if (persistConversation && typeof persistConversation === 'function') {
      await persistConversation(from, conversationContext?.turns || [], text, reply);
    }

    let sendResult = null;
    if (sendWA && typeof sendWA === 'function') {
      sendResult = await sendWA(from, reply, { branch });
    }

    return { used: 'reddy_agent', reply, sendResult, error: null };
  }
```

  Note: `detectBookingCompletionReport` is imported for potential direct reuse/tests but the adapter trusts `orchestrationDecision.conversational_act` (already computed once, upstream, by Task 2) rather than re-deriving it — avoids a second, possibly-inconsistent classification pass. Remove the unused import if not directly referenced (keep only if a test imports it from this module; otherwise import only in `orchestratorService.js`).

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 5: Full regression sweep

- [ ] **Step 1:** Run focused suites: `node --test server/test/booking-completion-context-v01.test.js server/test/booking-intelligence-v01.test.js server/test/task14-1-context-knowledge-hotfix.test.js server/test/task14-1-p0-reconciliation.test.js server/test/conversation-intelligence-v01.test.js server/test/human-handoff-v01.test.js server/test/task15-branch-authorization.test.js server/test/task15-legacy-authority.test.js server/test/task15-p0-crosslayer.test.js server/test/p0-antispam-idempotency.test.js server/test/p01-fonnte-envelope-normalization.test.js server/test/p02-price-keyword-intent.test.js server/test/orchestrator-reddy-integration-v01.test.js server/test/orchestrator-execution-v01.test.js server/test/ai-orchestrator-contract.test.js server/test/ai-orchestrator-route.test.js server/test/task13-6-4-member-identity-semantic-integrity.test.js`
- [ ] **Step 2:** Run full suite: `node --test server/test/*.test.js` and record exact pass/fail counts.
- [ ] **Step 3:** Compare against a baseline run of the same full suite on `main` (before this branch's changes) to prove zero regressions.
- [ ] **Step 4:** Commit any fixups; do not merge.

## Self-Review Notes

- Spec coverage: state A (booking request) is untouched — no new code path is entered for it, since `detectBookingCompletionReport` explicitly excludes `?`-terminated and `belum`-bearing messages, and requires either an explicit self-declaring phrase or bare phrasing + recent booking-guidance context. State C (verified booking) is untouched — `booking_status` intent and `bookingStatusService.js` are not modified; a regression test (not a new implementation) confirms this path still works.
- Type/signature consistency checked: `detectBookingCompletionReport({ text, conversationContext })` is called identically in Task 2 (`orchestratorService.js`) as it is defined in Task 1, and its return shape (`{ isCompletionReport, reason }`) is consumed consistently.
- No placeholders — every step has literal code.
