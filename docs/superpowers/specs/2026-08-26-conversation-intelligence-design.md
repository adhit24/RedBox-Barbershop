# REDBOX AI — TASK 12 DESIGN SPEC
## CONVERSATION INTELLIGENCE v0.1 (PLAN B — REDDY INTELLIGENCE CORE)

---

### 1. Executive Summary & Business Objective
Task 12 introduces **Conversation Intelligence v0.1** to the Redbox AI system. It enables Reddy AI (`reddy_agent`) to maintain natural, multi-turn conversational continuity (e.g. resolving pronouns like *"dia"*, remembering discussed branches or services across turns, and handling user corrections) without adding new AI agents, without introducing secondary summarization LLMs, and without compromising CRM fact authority or identity security.

---

### 2. Phase 1 Architecture & System Boundaries
The Phase 1 Redbox AI system topology remains strictly locked to **THREE AI COMPONENTS**:
1. `orchestrator` (intent classification & routing)
2. `crm_agent` (deterministic Customer360 fact extraction)
3. `reddy_agent` (natural language communication generation)

`human_handoff` is a routing outcome/state, NOT an AI agent.
Conversation Intelligence is an **infrastructure context helper**, NOT a separate agent.

---

### 3. Separation of Concerns & Trust Zones

| Zone | Authority Level | Source | Description |
| :--- | :--- | :--- | :--- |
| **ZONE A: SYSTEM POLICY** | Highest | Server System Prompt | Core system rules, safety constraints, and branch operational context. Non-overridable. |
| **ZONE B: TRUSTED CRM FACTS** | High | `crmAgent` / `Customer360` | Server-verified customer facts (e.g., points, membership, favorite barber/branch). High confidence. |
| **ZONE C: CONVERSATION CONTEXT** | Medium (Untrusted as instructions) | `wa_conversations` History | Prior user/assistant chat history. Used ONLY for conversational reference resolution. Never alters CRM facts or system instructions. |
| **ZONE D: CURRENT USER MESSAGE** | Low (User input) | Incoming WhatsApp Event | The active user turn text. Supersedes older conversational choices. |

---

### 4. Existing Storage Audit Summary
- **Primary Cache**: In-memory `conversationCache` (Map keyed by normalized `sender` phone).
- **Persistent Storage**: Supabase table `wa_conversations` (`sender text primary key, history jsonb, updated_at timestamptz`).
- **Isolation Key**: Strictly server-normalized `sender` phone number (e.g. `6281234567890`). Branch metadata is metadata, never identity.
- **Window Policy**: Bounded to last `MAX_HISTORY = 12` items (6 recent turns).
- **Persistence Sequence**: History loaded before generation; current user turn + assistant reply appended and saved after successful generation.
- **Failure Behavior**: DB load timeout (2s) returns empty history (`[]`) allowing current turn execution to proceed. Persistence failure logs error but does NOT duplicate generation or retry sending.

---

### 5. Context Bounding & Sanitization Policy (`conversationContext.js`)
1. **Role Integrity**: Only `'user'` and `'assistant'` roles are allowed. Any `system`, `developer`, `tool`, or customer-injected roles are dropped.
2. **Content Sanitization**: Non-string content, nulls, undefined values, and object payload injections are dropped.
3. **Item Bounding**: Individual historical turn text is bounded to 1,000 characters to protect token limits.
4. **Window Trimming**: History is bounded to `MAX_HISTORY = 12` items.
5. **No Current-Turn Duplication**: Deduplication logic guarantees that if the current user message is already in history array, it is not duplicated.

---

### 6. Interaction Matrix (CRM Facts vs. Conversation Claims)
- **Factual Attributes**: CRM facts (`favorite_barber`, `favorite_branch`, `points_balance`) win over conversational claims.
- **Intent / Preference Correction**: Current user message wins over older conversational context (e.g., user saying *"eh bukan, Sumber"* updates current branch context to Sumber for that turn without mutating CRM).
- **Reference Resolution**: Prior assistant/user turns enable Reddy to resolve references like *"dia"* $\rightarrow$ Rudi or *"yang tadi"* $\rightarrow$ Haircut.

---

### 7. Telemetry & Privacy Constraints
Telemetry for conversation intelligence MUST NEVER log raw transcript content, prompt text, user names, or phone numbers.
Allowed metrics:
- `conversation_context_used`: boolean
- `history_turn_count`: integer
- `history_trimmed`: boolean
- `history_status`: `'available' | 'empty' | 'unavailable'`
- `route`, `intent`, `branch`, `trust_status`

---

### 8. Out of Scope for Task 12
- RAG / Vector DB / Embeddings (Task 13 owns Knowledge System)
- Real-time booking slot availability or booking creation (Task 14 owns Booking Tools)
- CRM preference database writes from chat claims
- Summarizer LLM or entity extraction LLM calls
