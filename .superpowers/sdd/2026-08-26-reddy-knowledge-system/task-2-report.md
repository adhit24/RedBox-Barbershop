# Task 2 — Deterministic retrieval and bounded context

## Scope

- Added `knowledgeResolver.js` for deterministic, validated public-fact retrieval.
- Added `knowledgeContext.js` for the bounded context envelope and delimiter-safe prompt serialization.
- Extended only `server/test/reddy-knowledge-system-v01.test.js` for Task 2 behavior.
- No runtime wiring, database access, network access, deployment, merge, or push.

## TDD evidence

### RED

Command:

```powershell
node --test server/test/reddy-knowledge-system-v01.test.js
```

Result: exit 1. The suite stopped with the expected `MODULE_NOT_FOUND` for `../agents/reddy/knowledge/knowledgeResolver`; the Task 2 modules did not exist yet.

A follow-up RED test for explicit `branches`, `operational_policy`, and `faq` intents also failed as expected because no corresponding facts were returned.

### GREEN

Command:

```powershell
node --test server/test/reddy-knowledge-system-v01.test.js
```

Result: exit 0 — 34 tests passed, 0 failed, 0 skipped.

The focused suite covers exact aliases without fuzzy matching, branch precedence and unknown handling, canonical scoped prices, injected Jakarta promotion dates, empty promotions, public/private membership separation, booking/live-slot boundaries, irrelevant chat, fact/character bounds, delimiter-safe JSON round-trip, unavailable context, and explicit category intents.

## Implementation notes

- Resolver validation, alias matching, promotion calculations, and bounds are deterministic and make no LLM, database, or network calls.
- Prices always expose canonical `standard` and `csb` values. A resolved branch can add `price_scope` and `price_idr`; an unknown branch never selects a fallback scope.
- Bounds drop complete facts only. The serialized envelope is never truncated.
- Serializer emits exactly one knowledge delimiter pair, allowlists envelope fields, and encodes `<`, `>`, and `&` in JSON values.

## Fix round 1/5

### RED

Command:

```powershell
node --test server/test/reddy-knowledge-system-v01.test.js
```

Result: exit 1 — 34 passed, 3 failed. The independent regression tests reproduced: an explicit `cabang Bandung` was overridden by an incidental `Tegal` alias and handler branch; `general_chat` emitted a Bypass fact from incidental text; and a caller-supplied `maxChars: 99999` allowed an escaped prompt payload above 4,000 characters.

### GREEN

Command:

```powershell
node --test server/test/reddy-knowledge-system-v01.test.js
```

Result: exit 0 — 37 passed, 0 failed, 0 skipped.

### Fix notes

- A branch named directly after `cabang` or `branch` is now resolved as the authoritative explicit reference. If that reference is unknown, it blocks all handler/incidental-alias branch selection and prevents a scoped price.
- `general_chat` is an explicit irrelevant intent and now always returns no verified facts, even when text contains a known branch alias.
- `knowledgeContext.js` owns exported hard limits (`12` facts, `4,000` prompt characters) and actual serialized-payload measurement. The resolver imports those values without a circular dependency, clamps caller input, and drops whole facts against the escaped JSON plus delimiter length.
