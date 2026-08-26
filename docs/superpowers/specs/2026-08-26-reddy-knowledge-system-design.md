# Reddy Knowledge System v0.1 Design

## 1. Business objective

Reddy needs a small, deterministic, version-controlled source of verified public Redbox facts. The system must answer public questions about branches, services, prices, operating and booking policy, membership benefits, promotions, contact channels, FAQs, and static capabilities without expanding the system prompt or adding an AI component.

The exact knowledge version is `reddy_knowledge.v0.1`. Retrieval uses zero LLM calls. Task 13 does not add RAG, embeddings, a crawler, a CMS, booking tools, or customer automation.

## 2. Repository knowledge audit

### A. Facts currently hardcoded in the active system prompt

`api/wa/webhook.js#buildSystemPrompt` currently contains:

- five branch names, abbreviated addresses, and operating hours;
- branch-specific prices for Gentleman Grooming, Hair Spa, Shaving, and Men Massage;
- global prices and descriptions for Hair Curly, Down Perm, Hair Color, Royal Grooming, Creambath, and Ear Candles;
- payment methods;
- home-service hours, area, link, and wedding price range;
- free membership registration and generic points claims;
- booking-via-website, walk-in, availability, delay, and status policy;
- booking URLs and branch-specific context repeated later in the same prompt.

`buildServicesText`, `fallbackReply`, and foreign-language constants in the same file repeat subsets of these facts.

### B. Duplicate facts across the repository

- Service names and prices occur in `public/js/services-data.js`, `api/wa/webhook.js`, `server/whatsapp-ai/knowledge/services.json`, `server/whatsapp-ai/services/aiService.js`, frontend signage, database seed/repair scripts, and fallback copy.
- Branch addresses, hours, contacts, and booking URLs occur in `public/index.html`, `public/booking.html`, `public/js/main.js`, `public/js/booking.js`, `api/wa/webhook.js`, and the legacy WhatsApp FAQ.
- Membership pricing and benefits occur in `server/services/membershipRegistration.js`, `server/membership-benefits.js`, migrations, `public/membership.html`, member dashboard copy, and the legacy WhatsApp FAQ.
- Home-service and wedding facts occur in `public/home-service.html`, `public/js/booking.js`, `server/index.js`, the active webhook, and legacy WhatsApp JSON.

### C. Current service and price sources

`public/js/services-data.js` is the booking-facing full catalog and is explicitly referenced by server-side membership pricing safeguards. It includes numeric standard and CSB prices for every listed service. The active prompt and legacy JSON contain smaller, stale subsets.

### D. Branch metadata sources

`public/index.html` has the most complete public address and branch contact data. `public/js/main.js` applies the active customer-facing hours display: `10:00-21:00` for Bypass, Samadikun, Sumber, and Tegal, and `10:00-21:30` for CSB Mall. `public/booking.html` confirms the branch IDs and largely agrees on addresses, but gives Tegal only as “Pusat Kota Tegal.”

### E. Promotion and policy sources

No repository source defines a public promotion with an ID, validated start/end dates, eligibility, terms, and branch scope. “Promo spesial” copy and birthday cron text are not sufficient evidence for an active public promotion. Therefore canonical `promotions` starts empty.

Booking authority and walk-in rules are enforced in the active webhook: website/database is authoritative, live availability is not guessed, and walk-in is allowed but not guaranteed. Home-service and wedding prices are also enforced by booking code and `server/index.js`.

### F. Membership public information sources

Membership prices are enforced in `server/services/membershipRegistration.js` and the database migration: Silver Rp100,000, Gold Rp250,000, Platinum Rp1,500,000, each for one year after activation. Public discount behavior is enforced by `server/membership-benefits.js`: Silver gets the birthday discount, Gold gets 10% outside CSB plus birthday discount, and Platinum gets free Gentleman Grooming capped at its real price plus birthday discount. Customer tier/status remains CRM-only.

### G. Contradictory or stale copies

- Down Perm is Rp350,000 in the active prompt but Rp175,000 standard/Rp185,000 CSB in the booking catalog.
- Ear Candle is Rp85,000 in the prompt but Rp40,000 standard/Rp50,000 CSB in the booking catalog.
- Gentleman Grooming is 45 minutes in the prompt and legacy JSON but 60 minutes in the booking catalog.
- The prompt and fallback disagree on Bypass wording and hours; the prompt says Bypass/CSB close at 22:00, legacy FAQ says CSB 22:00, while the active location UI says standard branches 21:00 and CSB 21:30.
- The prompt says membership registration is free, while the enforced current membership system sells Silver, Gold, and Platinum tiers.
- The public membership page includes stale or internally contradictory claims such as Silver 5%, Gold 15% in one FAQ, and monthly free services that the backend benefit engine does not implement.
- Legacy group-booking JSON says two customers must use different barbers and the same time; current booking code supports the same barber with separate non-overlapping times.
- Fallback service copy invents “Hair Cut Rp85,000” beside the actual Gentleman Grooming catalog.

### H. Canonical-source decisions

| Category | Canonical Task 13 source | Decision |
|---|---|---|
| Service catalog and price | `public/js/services-data.js` | Export the existing booking catalog for Node and compose it into the knowledge contract. No second hand-copied price table. |
| Branch IDs and addresses | public location/booking UI | Curate the complete intentionally public addresses into the versioned contract. |
| Opening hours | active location UI behavior in `public/js/main.js` | Standard branches 10:00-21:00; CSB Mall 10:00-21:30, daily. |
| Public branch contact | `public/index.html` location controls | Use the five published WhatsApp numbers only. |
| Booking and walk-in policy | active webhook guards and booking website | Website/database is authoritative; walk-in is not guaranteed; no Task 14 actions. |
| Home service and wedding | `public/js/booking.js` and `server/index.js` | Use implemented links, capability, hours, and server-enforced wedding prices. |
| Membership prices | `server/services/membershipRegistration.js` | Use enforced tier price snapshots and one-year activation term. |
| Membership benefits | `server/membership-benefits.js` | Publish only behavior enforced server-side. |
| Promotion | none | Empty canonical list; “active promo” resolves to no verified active promotion. |

## 3. Architecture and categories

There remain only three AI components: `orchestrator`, `crm_agent`, and `reddy_agent`. Task 13 adds four focused modules under `server/agents/reddy/knowledge/`:

- `redboxKnowledge.js`: one frozen, explicit public knowledge contract;
- `validateKnowledge.js`: deterministic structural and reference validation;
- `knowledgeResolver.js`: intent/text/branch-aware minimal retrieval;
- `knowledgeContext.js`: bounded envelope and injection-safe prompt serialization.

The final categories are `branches`, `services`, `operational_policies`, `booking_policies`, `membership_public`, `promotions`, `faqs`, `contacts`, and `capabilities`.

## 4. Data contract

The root contract contains:

```js
{
  version: 'reddy_knowledge.v0.1',
  source_semantics: { ... },
  branches: [{ id, name, aliases, address, hours, contact_id, booking_url }],
  services: [{ id, name, aliases, description, duration_minutes, prices }],
  operational_policies: [{ id, summary, branches }],
  booking_policies: [{ id, summary, booking_url_template }],
  membership_public: { registration_url, tiers: [...] },
  promotions: [{ id, title, status, valid_from, valid_until, branches, eligibility, terms_summary }],
  faqs: [{ id, topics, question, answer_fact_ids }],
  contacts: [{ id, type, value, branches, public }],
  capabilities: [{ id, available, static_only, summary }]
}
```

Prices are integers in IDR. `prices` explicitly contains `standard` and `csb`; there is no implicit fallback from one branch scope to another. Unknown fields are omitted or surfaced in `unknown_fields`.

## 5. Branch aliases

Aliases are explicit and normalized by lowercase plus collapsed whitespace:

- `bypass`: `bypass`, `redbox bypass`, `pusat`;
- `samadikun`: `samadikun`, `redbox samadikun`;
- `csb`: `csb`, `csb mall`, `cirebon super block`;
- `sumber`: `sumber`, `redbox sumber`;
- `tegal`: `tegal`, `tegal kota`, `redbox tegal`.

No fuzzy matching is allowed. An unknown branch remains unknown.

## 6. Service aliases

Every service has its normalized exact name as an alias. Additional audited aliases are limited to stable customer language:

- Gentleman Grooming: `redbox gentleman grooming`, `gentleman grooming`, `haircut`, `hair cut`, `potong rambut`, `potong`, `fade`;
- Hair Spa: `hair spa`, `spa rambut`;
- Hair Color: `hair color`, `coloring`, `cat rambut`;
- Hair Curly: `hair curly`, `curly`, `keriting rambut`;
- Down Perm / Root Lift: `down perm`, `root lift`;
- Shaving: `shaving`, `cukur jenggot`, `cukur kumis`;
- Men Massage Service: `men massage`, `men massage service`, `pijat pria`.

Other services resolve by exact normalized catalog name only. Substrings are matched at word boundaries and aliases are validated globally for duplicates.

## 7. Promotion date policy

Promotion dates use `YYYY-MM-DD` in `Asia/Jakarta`. The server-injected clock determines `active`, `future`, or `expired`; the LLM never decides. A record may be returned as active only when its configured status is `active` and the Jakarta date is inclusively between `valid_from` and `valid_until`. Invalid status, reversed dates, unknown branches, or unknown services fail validation. Canonical v0.1 has no verified promotion records.

## 8. Membership public/private boundary

Knowledge may state tier prices, duration, and enforced public benefits. It may never decide whether a customer is Gold, whether membership is active, personal points, or eligibility based on private identity. Phrases such as “saya Gold bukan?” return a CRM-required boundary fact, not a tier claim.

## 9. Booking static/live boundary

Knowledge may provide booking URLs, general website instructions, walk-in policy, home-service capability, and wedding package facts. It may not check a slot, barber availability, booking status, create/cancel/reschedule a booking, or promise service. Live questions receive a static capability boundary directing the customer to the booking system.

## 10. Trust zones and prompt order

The prompt order is:

1. Zone A: system policy;
2. Zone B1: verified Redbox business knowledge;
3. Zone B2: trusted CRM customer facts;
4. Zone C: untrusted role-preserving conversation turns;
5. Zone D: current user message.

Knowledge, CRM, and conversation remain separate arguments and separate serialized sections. Conversation claims cannot mutate business knowledge, and public knowledge cannot determine private customer membership.

## 11. Knowledge context contract and bounding

The resolver returns:

```js
{
  version: 'reddy_knowledge_context.v0.1',
  source: 'redbox_knowledge',
  trust: 'verified_business_facts',
  status: 'available | no_verified_fact | unavailable',
  topics: [],
  facts: [],
  unknown_fields: [],
  fact_count: 0
}
```

The default maximum is 12 fact objects and 4,000 serialized characters. Bounding drops complete lowest-priority fact objects; it never slices serialized JSON. Service-list queries return at most 12 catalog summaries and set a bounded indicator when more exist.

## 12. Serialization

`knowledgeContext.js` serializes only allowlisted envelope fields inside exactly one `<redbox_knowledge_json>` and one `</redbox_knowledge_json>` delimiter. It encodes `<`, `>`, and `&` as JSON unicode escapes. Values remain data even if they contain apparent system tags or role instructions.

## 13. Failure behavior

Malformed canonical knowledge fails validation before retrieval. Resolver errors are caught in the production handler. General conversation continues without knowledge; a factual business route receives an explicit `status: unavailable` context telling Reddy not to invent the fact. There is no whole-knowledge-base fallback.

## 14. Privacy and telemetry

The knowledge contract contains no secret, credential, database URL, customer ID, customer note, CRM value, owner metric, commission rule, or internal escalation note. Only intentionally public branch contacts are included.

Telemetry may include `knowledge_used`, `knowledge_status`, `knowledge_topics`, `knowledge_fact_count`, `branch`, `intent`, `route`, `history_turn_count`, and `crm_used`. It must not include fact values, customer messages, phone numbers, names, CRM values, prompts, or Reddy answers.

## 15. Cost

Knowledge retrieval and validation use zero LLM calls, zero database calls, and zero external network calls. A factual Reddy route still has at most one orchestrator call, one knowledge resolution, one Reddy generation, and one WhatsApp send. The points fast path remains zero orchestrator LLM, zero knowledge retrieval, zero history load, and zero Reddy generation.

## 16. Validation

Validation rejects the wrong version, unknown/duplicate branch IDs, duplicate normalized branch aliases, duplicate service IDs or aliases, negative/non-finite/non-integer prices, invalid promotion dates/statuses, and promotion references to unknown branches or services. It also recursively rejects forbidden internal field names.

## 17. Out of scope

No Task 14 booking tools, human-handoff redesign, evaluation platform, n8n automation, vector store, embeddings, RAG, new agent, CMS, runtime scraping, production database change, Vercel/Fonnte configuration, deployment, or merge is included.

## 18. Production canary plan (prepare only)

After separate approval and merge, start with Sumber and exercise the ten handoff prompts. Confirm verified prices/branches, no expired promotion, no private tier guess, no live-slot fabrication, points at zero LLM, one reply, at most one Reddy generation, and no full knowledge dump. Task 13 itself does not deploy.
