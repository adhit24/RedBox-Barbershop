# REDBOX AI — TASK 10 IMPLEMENTATION PLAN
## Orchestrator → Reddy Integration (Plan B — Reddy Intelligence Core)
**Date**: 2026-08-26  
**Status**: APPROVED IMPLEMENTATION PLAN  

---

### Task Breakdown & TDD Steps

#### Phase 1: Internal Orchestrator Service Layer (`server/orchestrator/orchestratorService.js`)
- Extract in-process internal orchestration function `orchestrateMessage({ message, channel, branch, trustedIdentity, conversationContext })`.
- Wrap `classifyMessage(message)` without making HTTP round-trips to public endpoints.
- Return structured routing decisions (`intent`, `route`, `agent`, `action`, `confidence`, `model_tier`).
- Ensure no PII (phone, secret, customer name) is passed to OpenAI classifier.

#### Phase 2: Reddy Execution Adapter (`server/agents/reddy/reddyAdapter.js`)
- Create lightweight adapter connecting Orchestrator route `reddy_agent` to existing Reddy conversation implementation (`callOpenAI` / keyword / policy fallback).
- Re-export `executeReddyAgent({ from, name, text, device, branch, trustedIdentity, dependencies })`.
- Ensure zero change to Reddy's personality or knowledge base in this task.

#### Phase 3: Observability & Telemetry (`server/orchestrator/telemetry.js`)
- Create telemetry helper `logOrchestratedEvent(metadata)` logging safe routing metrics.
- Enforce strict PII filtering (strip phone, secrets, names, full message text).

#### Phase 4: Live WhatsApp Webhook Integration (`api/wa/webhook.js`)
- Update `handleMessage` in `api/wa/webhook.js`:
  1. Preserves 0-LLM deterministic CRM points inquiry path (`classifyDeterministically`).
  2. Preserves admin commands, deduplication, media filter, human takeover (`wa_paused`), branch off-hours.
  3. Invokes `orchestrateMessage` for eligible conversational messages.
  4. Routes `route === 'reddy_agent'` to Reddy Execution Adapter.
  5. Routes `route === 'human'` or `human_handoff` to human takeover handler (disables Reddy LLM reply).
  6. Implements availability fallback to legacy Reddy when Orchestrator fails or returns unknown classification.
  7. Implements security override (unauthenticated CRM requests or `wa_paused` sessions MUST NOT fall back to Reddy).

#### Phase 5: Test Suite & TDD Verification (`server/test/orchestrator-reddy-integration-v01.test.js`)
- Implement TDD suite covering all 18 required test scenarios (A through R):
  - A. Ordinary customer message $\rightarrow$ route `reddy_agent` $\rightarrow$ exactly 1 Reddy execution.
  - B. Points inquiry $\rightarrow$ CRM path executes $\rightarrow$ Reddy not called $\rightarrow$ 0 LLM.
  - C. Orchestrator exception $\rightarrow$ legacy Reddy fallback.
  - D. Malformed orchestrator response $\rightarrow$ legacy Reddy fallback.
  - E. Unsupported agent route $\rightarrow$ legacy Reddy fallback.
  - F. `human_handoff` route $\rightarrow$ Reddy does NOT execute.
  - G. `wa_paused` session $\rightarrow$ AI response suppressed.
  - H. Message text injection $\rightarrow$ cannot alter identity.
  - I. CRM request without identity $\rightarrow$ fallback does not leak private data.
  - J. `route=reddy_agent` $\rightarrow$ orchestrator does not generate copy itself.
  - K. Max 1 orchestrator call per message.
  - L. Max 1 Reddy generation per message.
  - M. No raw phone in telemetry.
  - N. No webhook secret in telemetry.
  - O. Safe metadata logging.
  - P. Fonnte native body-secret tests GREEN.
  - Q. TrustedIdentity tests GREEN.
  - R. CRM points production alignment tests GREEN.

---

### Verification & Regression Plan
1. Run focused test suite:
   `node --test server/test/orchestrator-reddy-integration-v01.test.js server/test/crm-points-production-alignment-v01.test.js server/test/crm-agent-v01.test.js server/test/fonnte-webhook-trust-gate-v01.test.js server/test/whatsapp-identity-adapter-v01.test.js server/test/whatsapp-trusted-identity-wiring-v01.test.js server/test/whatsapp-trusted-crm-points-v01.test.js server/test/orchestrator-execution-v01.test.js`
2. Run full repository test suite:
   `node --test server/test/*.test.js`
3. Verify zero new test failures compared to baseline.
