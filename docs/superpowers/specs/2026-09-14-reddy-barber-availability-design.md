# Spec: Reddy Barber Availability (Read-Only MVP)

**Date:** 2026-09-14
**Status:** Approved

## Problem

Reddy (WhatsApp CS agent) currently refuses to answer any barber schedule/availability question — `system.txt` PRIORITY RULES forbid "mengarang ... jadwal kapster ... status booking", and `contract.js` marks `unsupported_barber_availability` / `unsupported_slot_full_or_available` as prohibited claims for `booking_availability_inquiry`. Customers asking "Mas Abdul hari ini ada?" get deflected to the website with no information, which is a worse experience than necessary — the actual schedule data already exists and is already computed correctly for the website's own booking flow.

## Goal

Reddy can answer real-time barber/branch availability questions ("Abdul hari ini kosong jam berapa?", "Jam 7 malam di Bypass siapa yang kosong?", "Kalau jam 8?") using live data from the existing scheduling system, and only that data — never guessed or LLM-inferred. Reddy remains strictly read-only: it can inform, never create/hold/reserve/lock/reschedule/cancel a booking. Any request to act on a slot is redirected to `https://www.redboxbarbershop.com/booking.html`.

## Out of Scope (deferred to a later phase)

- `next_available_slot_query` — searching forward across multiple future dates for the soonest opening.
- Service-duration-aware precision beyond what `slotEngine.js` already safely supports (i.e. we pass `duration_minutes` through if the caller has it, but we do not build new continuous-free-window math beyond what the engine exposes).
- Fuzzy/typo-tolerant nickname resolution beyond what `bookingContext.js`'s existing barber matching already does.
- Any write path (booking create/reschedule/cancel) via WhatsApp — permanently out of scope for Reddy, not just this phase.

---

## Architecture

```
Customer → WhatsApp → Reddy/Orchestrator
  → intent classification (routingPolicy.js / classifier.js)
  → parameter resolution (bookingContext.js, extended)
  → reddy_agent action: answer_barber_availability
  → server/services/barberAvailabilityQuery.js  (new, thin adapter)
  → server/moka/slotEngine.js                    (existing, untouched math)
  → structured, PII-safe result
  → deterministic response template
  → customer
```

**Hard rule:** `barberAvailabilityQuery.js` is an adapter only. It must not reimplement working-hours logic, busy-slot/overlap logic, date-override logic, Moka busy-block logic, or cancelled/expired filtering. All of that stays inside `slotEngine.js` (`getAvailableSlots`, `getBarberDateAvailability`, `isSlotAvailable`), following the same reuse pattern already established by `server/services/barberScheduleAuthority.js`.

---

## 1. New service: `server/services/barberAvailabilityQuery.js`

Exposes one function:

```js
checkBarberAvailability({ branch, barberId, date, time, timeRange, serviceId, durationMinutes })
```

Behavior:
- Resolves the outlet/branch from `branch` (slug or id) the same way existing booking code resolves outlets.
- If `barberId` is given: calls `getBarberDateAvailability` (barber+date mode) or, if `time`/`timeRange` given, additionally calls `isSlotAvailable`/filters the returned slots against the requested time.
- If `barberId` is not given (branch-wide query): calls `getAvailableSlots` per active barber at that branch/date and returns the working+available set per barber, filtered by `time`/`timeRange` if given.
- Never queries or returns customer identity, phone, booking notes, booking IDs, or payment info — only barber/branch/date/time/availability fields.
- On any backend error (DB unreachable, outlet/barber not found, etc.) returns `{ success: false, reason_code: <specific> }` rather than throwing past the caller — the orchestrator layer must treat `success: false` as "no data available", never as a signal to guess.

### Result contract

Barber+date / branch-wide mode:

```js
{
  success: true,
  source: "slot_engine",
  checked_at: "2026-09-14T10:30:00+07:00",
  branch: { id: "...", name: "Bypass" },
  barber: { id: "abdul", name: "Abdul" },      // omitted in branch-wide mode; array of barbers instead
  date: "2026-09-14",
  working: true,
  working_hours: { start: "10:00", end: "22:00" },
  available_slots: ["17:00", "18:00", "20:00"],
  reason_code: "available"                      // | "no_slot" | "barber_off" | "barber_not_found" | "branch_not_found" | "invalid_date"
}
```

Specific-time mode adds:

```js
{
  requested_time: "17:00",
  available: true,
  alternative_slots: ["18:00", "20:00"]
}
```

Failure mode:

```js
{ success: false, reason_code: "tool_error" | "branch_not_found" | "barber_not_found" | "invalid_date" }
```

---

## 2. Parameter resolution

Extend `server/agents/reddy/bookingContext.js` (already resolves branch, barber, and relative dates like "besok"/"hari ini" across conversation turns):

- Add time-of-day parsing: explicit clock times ("jam 5", "jam 5 sore", "19.00", "19:00") resolved to 24h `HH:mm`; qualitative ranges (`pagi`/`siang`/`sore`/`malam`) resolved to the fixed windows from spec section 8 (pagi = opening–12:00, siang = 12:00–15:00, sore = 15:00–18:00, malam = 18:00–closing) used only as a search filter, never as fabricated availability.
- Add a "no barber pinned" resolution path for branch-wide queries (section 21), reusing the existing branch resolution.
- Conversation memory: a follow-up like "Kalau jam 8?" after an established barber+date context reuses `barber`/`date` from `bookingContext`'s existing per-turn accumulation and only replaces `time`.
- Freshness rule: every specific-time confirmation triggers a fresh `checkBarberAvailability` call — never answers from a stale in-memory result from an earlier turn.

---

## 3. Intent routing

Add to `routingPolicy.js` (deterministic keyword/regex classification, checked before the OpenAI fallback) and `contract.js`:

- `barber_availability_query`
- `specific_time_availability_query`
- `branch_availability_query`

All three route to `agent: 'reddy_agent'`, `action: 'answer_barber_availability'`, calling `barberAvailabilityQuery.js`. `next_available_slot_query` and `barber_schedule_query` are deferred — for MVP, phrasing that would map to them (e.g. "slot terdekat kapan?") falls back to the closest supported mode (barber+date) rather than adding new intents now.

For these three intents, `prohibited_claims` in `contract.js` drops `unsupported_barber_availability` / `unsupported_slot_full_or_available` (only for these intents — the general `booking_availability_inquiry` intent keeps the existing prohibition for anything not backed by a tool call).

Booking write intents (create/reschedule/cancel) are unaffected and continue to be refused via existing `bookingGuards.js`.

---

## 4. Response generation — deterministic templates

No LLM free-form claims about slots. A small template set (Indonesian, matches existing Reddy tone in `personalityPolicy.js`) selected by `reason_code`:

| reason_code | Template intent |
|---|---|
| `available` (list) | "Mas {barber} hari ini masih ada slot jam {slots} kak 👍" + soft CTA to booking.html (not "mau aku bantu booking") |
| `available` (specific time, true) | "Iya kak, dari jadwal saat ini Mas {barber} masih available jam {time} 👍" |
| `available` (specific time, false + alternatives) | "Jam {time} Mas {barber} udah terisi kak. Yang masih available paling dekat jam {alt1} dan {alt2}." |
| `barber_off` | "{Hari} Mas {barber} lagi nggak ada jadwal kak." + optional branch alternatives (also from tool data only) |
| `no_slot` | "Mas {barber} masuk hari ini, tapi slot beliau udah penuh kak." + alternatives if present |
| write-attempt detected | Existing `bookingGuards.js` refusal, redirecting to booking.html — never claims to have booked/held/locked anything |
| `success: false` (any reason) | "Aku belum bisa baca jadwal live-nya sebentar ini kak. ... {booking.html}" — no guessing |

Booking URL `https://www.redboxbarbershop.com/booking.html` is only appended once per relevant reply, not repeated on every turn (section 14).

---

## 5. System prompt / policy updates

- `server/whatsapp-ai/prompts/system.txt`: replace the blanket "Jangan mengarang ... jadwal kapster ... status booking" line with: Reddy may state barber availability **only** when returned by the approved availability tool; it must never guess, and it can never create/hold/reserve/lock/reschedule/cancel a booking via WhatsApp.
- `server/whatsapp-ai/policy/whatsapp-ai-policy.md`: update the "Request kapster" row — allowed to state tool-verified availability; still forbidden from claiming availability not backed by the tool, and still forbidden from performing the booking action itself.
- `contract.js`: scoped `prohibited_claims` change as described in section 3 above.

---

## 6. Logging

Extend `server/services/reddyEvaluationMonitoring.js` with a new event type `availability_query`, fields per spec section 26: `availability_query_id`, `timestamp`, `customer_phone_hash`, `branch`, `barber_id`, `requested_date`, `requested_time`, `intent`, `result_count`, `result_status` (`success|no_slot|barber_off|barber_not_found|branch_not_found|invalid_date|tool_error`), `latency_ms`, `tool_error`. Persisted via existing `observeTelemetry()` → Supabase, no new logging infrastructure.

---

## 7. Testing

Unit tests for `barberAvailabilityQuery.js` (mocking/fixturing `slotEngine.js`'s inputs, not reimplementing its logic):

1. "Mas Abdul hari ini ada?" → working status + slots
2. "Abdul kosong jam berapa?" → available_slots list
3. "Abdul jam 5 sore kosong?" → available true/false
4. "Besok Mas Abdul ada?" → tomorrow resolved correctly (Asia/Jakarta)
5. "Jam 7 malam Bypass siapa yang kosong?" → branch-wide available barbers
6. "Mas Abdul hari ini penuh?" → derived from real schedule, not guessed
7. "Kalau jam 8?" after prior Abdul/today context → context preserved, fresh lookup
8. "Tolong booking Abdul jam 8" → refused, redirected, no booking created
9. "Yaudah lock dulu slotnya" → refused, no lock/hold state created
10. Availability backend unavailable → safe fallback message, no hallucination
11. Barber off that day → explained, real alternatives only
12. Slot blocked by existing website booking → shown unavailable
13. Slot blocked by Moka-synced schedule → shown unavailable
14. Cancelled/expired blocking record → slot available per existing engine rules

Plus routing tests confirming the 3 new intents resolve to `reddy_agent`/`answer_barber_availability` and that write-intents are unaffected.

---

## Definition of Done

- Reddy answers the 3 in-scope availability query modes from live `slotEngine.js` data, never guessed.
- Branch and barber context resolved conversationally without re-asking known info.
- Relative dates (Asia/Jakarta) and clock/qualitative times resolved correctly.
- Existing bookings and Moka-synced busy blocks correctly block availability; cancelled/expired records do not.
- Reddy cannot create, hold, reserve, lock, reschedule, or cancel any booking.
- Customer is redirected to the booking website only when they want to act on a slot, not on every availability answer.
- No customer PII exposed in tool output or logs (phone is hashed).
- Availability failures degrade safely with no hallucinated slots.
- All 14 test cases above pass; routing tests pass.
