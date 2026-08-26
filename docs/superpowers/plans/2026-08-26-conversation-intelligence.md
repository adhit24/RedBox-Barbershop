# REDBOX AI — TASK 12 IMPLEMENTATION PLAN
## CONVERSATION INTELLIGENCE v0.1 (PLAN B — REDDY INTELLIGENCE CORE)

This plan outlines the TDD implementation steps for Task 12: Conversation Intelligence v0.1.

---

## User Review Required
> [!NOTE]
> Architecture enforces Phase 1 topology (`orchestrator`, `crm_agent`, `reddy_agent`). Conversation Intelligence is an internal context helper (`server/agents/reddy/conversationContext.js`) with 0 extra LLM calls.

---

## Proposed Changes

### Reddy Agent Component

#### [NEW] [conversationContext.js](file:///d:/Digital%20Market/Website%20RedBox/server/agents/reddy/conversationContext.js)
- `sanitizeConversationHistory(history, options)`: Sanitizes historical array, drops invalid roles/content, bounds length, and trims turns.
- `selectRecentConversationTurns(history, maxItems)`: Selects bounded recent turns.
- `buildConversationMessages(history, userMessage)`: Constructs OpenAI messages array preventing duplicate user/assistant turns.
- `extractConversationContextEnvelope(history, userMessage)`: Returns structured context envelope.

#### [MODIFY] [reddyAdapter.js](file:///d:/Digital%20Market/Website%20RedBox/server/agents/reddy/reddyAdapter.js)
- Accepts optional `conversationContext` parameter in `executeReddyAgent`.
- Passes `conversationContext` down to `callOpenAI`.

---

### Webhook & Production Wiring

#### [MODIFY] [webhook.js](file:///d:/Digital%20Market/Website%20RedBox/api/wa/webhook.js)
- Updates `callOpenAI` signature to accept `conversationContext`.
- Integrates `sanitizeConversationHistory` to prepare bounded OpenAI messages.
- Prevents duplicate current user message in history array.
- Ensures no transcript PII enters telemetry.

---

### Test Suite

#### [NEW] [conversation-intelligence-v01.test.js](file:///d:/Digital%20Market/Website%20RedBox/server/test/conversation-intelligence-v01.test.js)
- 26+ TDD tests covering history sanitization, role integrity, prompt injection defense, cross-customer isolation, failure fallback, duplicate prevention, points 0-LLM shortcut, and production path integration via `handleMessage`.

---

## Verification Plan

### Automated Tests
```bash
node --test server/test/conversation-intelligence-v01.test.js \
  server/test/crm-reddy-customer-intelligence-v01.test.js \
  server/test/orchestrator-reddy-integration-v01.test.js \
  server/test/crm-points-production-alignment-v01.test.js \
  server/test/crm-agent-v01.test.js \
  server/test/fonnte-webhook-trust-gate-v01.test.js \
  server/test/whatsapp-identity-adapter-v01.test.js \
  server/test/whatsapp-trusted-identity-wiring-v01.test.js \
  server/test/whatsapp-trusted-crm-points-v01.test.js \
  server/test/orchestrator-execution-v01.test.js
```
Full test suite:
```bash
node --test server/test/*.test.js
```
