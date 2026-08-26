# Reddy Knowledge System v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, version-controlled Redbox business knowledge layer that gives Reddy verified, bounded, branch-aware business facts without adding another LLM or AI agent.

**Architecture:** Export the existing booking service catalog for server reuse, compose one validated public knowledge contract, resolve only intent/text-relevant facts into a bounded envelope, and serialize it as a distinct Zone B1 prompt section. Inject resolution after the points shortcut and orchestrator decision while preserving CRM facts and conversation history as separate arguments.

**Tech Stack:** Node.js 24 CommonJS, built-in `node:test`, existing WhatsApp webhook dependency injection.

**Spec:** `docs/superpowers/specs/2026-08-26-reddy-knowledge-system-design.md`

## Global Constraints

- Exact knowledge version: `reddy_knowledge.v0.1`.
- Exact context version: `reddy_knowledge_context.v0.1`.
- Retrieval, validation, and promotion date decisions use zero LLM calls and zero external systems.
- Only `orchestrator`, `crm_agent`, and `reddy_agent` are AI components.
- No RAG, vectors, embeddings, crawler, CMS, runtime scraping, booking tools, database schema changes, deployment, or merge.
- Prices are integer IDR values from `public/js/services-data.js`; no conversation inference or implicit cross-branch fallback.
- Promotion dates use `Asia/Jakarta` and inclusive `YYYY-MM-DD` boundaries.
- Knowledge, CRM facts, conversation history, and the current message remain separate trust zones.
- Preserve Task 12 `MAX_HISTORY = 12`, 1,000 characters per historical turn, single history load, role allowlist, isolation, persistence dedup, and points zero-history-load.
- Preserve Task 11 read-only CRM, TrustedIdentity binding, `CUSTOMER_SELF`, and personalized intents.
- Preserve points fast path at zero knowledge resolver, history loader, orchestrator, and Reddy calls.
- Context bounds: at most 12 facts and 4,000 serialized characters, dropping whole fact objects only.

---

### Task 1: Canonical contract and deterministic validation

**Files:**
- Modify: `public/js/services-data.js`
- Create: `server/agents/reddy/knowledge/redboxKnowledge.js`
- Create: `server/agents/reddy/knowledge/validateKnowledge.js`
- Test: `server/test/reddy-knowledge-system-v01.test.js`

**Interfaces:**
- Produces: guarded CommonJS exports `{ REDBOX_SERVICES, REDBOX_ADDONS }` without changing browser globals.
- Produces: `REDBOX_KNOWLEDGE`, `KNOWLEDGE_VERSION`, `BRANCH_IDS`, and `SERVICE_IDS`.
- Produces: `validateKnowledge(knowledge)` which returns the knowledge object or throws a bounded validation error.

- [ ] **Step 1: Write failing contract and validation tests**

Add tests for exact version, booking-catalog price alignment, known IDs, no forbidden internal fields, duplicate branch/service alias rejection, invalid price rejection (`-1`, `NaN`, `Infinity`, string), wrong version, invalid promo date range/status, and unknown promo branch/service references.

- [ ] **Step 2: Run the focused file and verify RED**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: failure because the knowledge modules and CommonJS catalog export do not exist.

- [ ] **Step 3: Implement the minimum canonical contract and validator**

Export the browser catalog behind `if (typeof module !== 'undefined' && module.exports)`. Compose frozen services with explicit aliases, numeric duration, and `{ standard, csb }` prices. Add the five audited branch records, public contacts, booking policies, backend-enforced membership tiers, home-service/wedding capabilities, empty promotions, and source semantics. Implement deterministic validation with normalized global alias uniqueness and recursive forbidden-field checks.

- [ ] **Step 4: Run Task 1 tests and verify GREEN**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: Task 1 contract and validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add public/js/services-data.js server/agents/reddy/knowledge/redboxKnowledge.js server/agents/reddy/knowledge/validateKnowledge.js server/test/reddy-knowledge-system-v01.test.js
git commit -m "feat(ai): add validated Redbox knowledge contract"
```

### Task 2: Minimal deterministic retrieval and bounded context

**Files:**
- Create: `server/agents/reddy/knowledge/knowledgeResolver.js`
- Create: `server/agents/reddy/knowledge/knowledgeContext.js`
- Modify: `server/test/reddy-knowledge-system-v01.test.js`

**Interfaces:**
- Consumes: validated `REDBOX_KNOWLEDGE`.
- Produces: `resolveKnowledgeContext({ intent, text, branch, now, knowledge, maxFacts, maxChars })`.
- Produces: `buildKnowledgeContext(envelope)`, `serializeKnowledgeForPrompt(value)`, and `createUnavailableKnowledgeContext(topics)`.

- [ ] **Step 1: Write failing resolver and security tests**

Add tests for known/unknown branches, known services, approved aliases, no fuzzy match, canonical price, wrong-price conversation resistance, explicit standard/CSB prices, no unknown-branch price fallback, active/expired/future promotions with an injected Jakarta date, empty canonical promotions, public membership benefits, private membership-status boundary, booking policy, live-slot boundary, unknown facts, irrelevant general chat, 12-fact/4,000-character bounding, complete JSON, and exactly one injection-safe delimiter pair with round-trip recovery.

- [ ] **Step 2: Run the focused file and verify RED**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: failure because resolver/context exports do not exist.

- [ ] **Step 3: Implement minimum resolver and serializer**

Use explicit intent/topic allowlists and normalized exact alias matching. Resolve branch scope from explicit text alias first, then the trusted handler branch only where appropriate. Select complete fact objects by priority, compute promotion activity using Jakarta calendar dates, and bound at object boundaries. Serialize only the context envelope and encode `<`, `>`, and `&`.

- [ ] **Step 4: Run Task 2 tests and verify GREEN**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: all contract, validation, retrieval, promotion, boundary, bounding, and serialization tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/agents/reddy/knowledge/knowledgeResolver.js server/agents/reddy/knowledge/knowledgeContext.js server/test/reddy-knowledge-system-v01.test.js
git commit -m "feat(ai): resolve bounded verified business facts"
```

### Task 3: Reddy adapter trust-zone integration

**Files:**
- Modify: `server/agents/reddy/reddyAdapter.js`
- Modify: `api/wa/webhook.js`
- Modify: `server/test/reddy-knowledge-system-v01.test.js`

**Interfaces:**
- Consumes: `knowledgeContext` independently from `customerIntelligence` and `conversationContext`.
- Updates: `callOpenAI(sender, userMessage, name, branch, knowledgeFactsContext, customerFactsContext, conversationContext)`.
- Updates: `handleMessage(..., { resolveKnowledge })` dependency injection.

- [ ] **Step 1: Write failing adapter and production-boundary tests**

Using real `handleMessage`, add tests that points causes zero knowledge/history/orchestrator/Reddy calls; factual Reddy resolves once, generates once, and sends once; general chat does not receive knowledge; knowledge, CRM, and conversation stay distinct; prompt order is policy then knowledge then CRM then role-preserving history/current user; resolver failure yields `status: unavailable` for factual routes; human handoff and `aiPaused` remain unchanged; telemetry contains only bounded metadata and no values/PII.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: failure because `handleMessage` does not inject or call the knowledge resolver and Reddy has no knowledge argument.

- [ ] **Step 3: Implement the minimum production wiring**

Import the resolver and context builder, inject `resolveKnowledge`, resolve only after the points shortcut and orchestrator decision, and remove the early generic service/price intercepts that bypass the canonical catalog. Pass knowledge separately through the Reddy adapter. In `callOpenAI`, place the knowledge block before CRM facts and conversation messages. Catch resolver failures and pass an explicit unavailable envelope only for factual business routes. Add only privacy-safe knowledge telemetry metadata.

- [ ] **Step 4: Run focused integration tests and verify GREEN**

Run: `node --test server/test/reddy-knowledge-system-v01.test.js`

Expected: all Task 13 tests pass with exact call counts and trust separation.

- [ ] **Step 5: Commit**

```bash
git add server/agents/reddy/reddyAdapter.js api/wa/webhook.js server/test/reddy-knowledge-system-v01.test.js
git commit -m "feat(ai): wire verified knowledge into Reddy"
```

### Task 4: Regression, audit evidence, and canary documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-reddy-knowledge-system-design.md`
- Modify: `docs/superpowers/plans/2026-08-26-reddy-knowledge-system.md`
- Modify: `server/test/reddy-knowledge-system-v01.test.js` only if a regression needs a test-first fix.

**Interfaces:**
- Consumes: all Task 13 production interfaces.
- Produces: review-ready evidence with no deployment or merge.

- [ ] **Step 1: Run required focused suites**

Run the new Task 13 suite plus Task 12 conversation, Task 11 CRM-Reddy, Task 10 orchestrator-Reddy, CRM Agent, CRM points alignment, TrustedIdentity, WhatsApp identity adapter/wiring, WhatsApp trusted CRM points, Fonnte Trust Gate, Orchestrator Execution, and WA webhook security test files.

Expected: zero focused failures.

- [ ] **Step 2: Run the full suite and compare exact baseline delta**

Run: `node --test --test-reporter=tap server/test/*.test.js`

Expected: no new failing test names versus the recorded `origin/main` baseline of 684 tests, 668 pass, 15 fail, 1 skipped.

- [ ] **Step 3: Review privacy and prohibited scope**

Search changed production files for secrets, customer/CRM values in telemetry, extra AI agents, vectors/embeddings, external calls in knowledge modules, database writes, and Task 14 booking actions. Confirm none were added.

- [ ] **Step 4: Commit final documentation adjustments**

```bash
git add docs/superpowers/specs/2026-08-26-reddy-knowledge-system-design.md docs/superpowers/plans/2026-08-26-reddy-knowledge-system.md server/test/reddy-knowledge-system-v01.test.js
git commit -m "docs(ai): finalize Task 13 verification record"
```

- [ ] **Step 5: Prepare delivery**

Push `integration/redbox-task13-reddy-knowledge-system`, open one PR to `main`, do not merge, and include the prepared Sumber-first canary plan from the spec.
