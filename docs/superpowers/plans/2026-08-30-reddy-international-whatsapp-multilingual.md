# Reddy International WhatsApp + Multilingual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Reddy accept and reply to legitimate personal WhatsApp customers from any country (not just +62), and make response language follow the customer's actual message language (never phone country code), while leaving booking execution, frontend, CRM authority, and the PR53 barber-presence guard's fact boundaries untouched.

**Architecture:** (1) Replace the Indonesia-only phone regex in `trustedIdentity.js` with a shared, bounded E.164-style digit normalizer, reused by the outbound Fonnte sender so replies round-trip correctly. (2) Consolidate the four duplicated language-detection functions already living in `api/wa/webhook.js` into one shared `languageResolution.js` module with a single precedence contract (current message → recent conversation → neutral fallback), extend its recognized-language set to the contract's 11-language minimum, and point every existing call site at it — this is a behavior-preserving refactor for already-supported languages plus new detection for the languages that were missing. (3) Make the specific deterministic (non-LLM) fallbacks the contract names — `fallbackReply`, the booking guard's correction text, CRM points messages, and human-handoff messages — branch on `responseLanguage` for English (in addition to their existing Indonesian default), and extend the booking guard's English-language claim detection so a fake-booking-confirmation guard has the same bite in English replies it already has in Indonesian ones. The barber-presence guard (`realtimeFactGuard.js`) already branches EN/ID and needs no change. No other legacy foreign-routing code is touched or expanded.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict` (existing test runner convention in `server/test/`), no new dependencies.

**Spec:** The full "REDDY INTERNATIONAL WHATSAPP + MULTILINGUAL LANGUAGE CONTRACT" pasted into the task that produced this plan (not a separate file — reproduced in full at the end of this document's Appendix so this plan is self-contained for a worker with no prior context).

## Global Constraints

- Branch `fix/reddy-international-whatsapp-multilingual`, based on latest `origin/main` (PR53 "barber presence first-turn guard" already merged as the branch point — confirmed via `git merge-base --is-ancestor origin/main HEAD`).
- Do NOT touch anything under `frontend/**` or `redbox-frontend`.
- Do NOT touch Task17.3 code, and do NOT change Task14 booking authority (`REDDY_BOOKING_EXECUTION` in `server/agents/reddy/bookingGuards.js` must remain the string `'DISABLED'`).
- Do NOT create a PR, do NOT merge, no production mutation of any kind.
- No DB migration. If a schema blocker is discovered mid-plan, STOP and surface it instead of writing one.
- Never infer response language from phone number or country code — language detection functions take only message text / conversation history.
- Never weaken the webhook trust chain (`fonnteWebhookTrustGate.js`, `fonnteWebhookVerifier.js`, `whatsappIdentityAdapter.js`'s group/broadcast/JID rejection) — every change in this plan is additive/bounded within `normalizeVerifiedPhone`'s accepted digit shapes, never a relaxation of what counts as an authenticated event.
- Do not expand `server/whatsapp-ai/services/foreignBookingService.js` (confirmed dead code, unreachable from the live webhook route, locked unreachable by `server/test/booking-intelligence-v01.test.js:336-340`) — leave it untouched.
- Every task ends by running the full existing test suite (`npm test` at repo root, which runs `node:test` across `server/test/**`) so regressions are caught immediately, not deferred to Task 7.

---

## Audit Summary (grounds every task below — do not re-derive, cite these)

Full file:line citations were gathered by a research pass before this plan was written. Key facts:

- **Root cause (phone):** `server/identity/trustedIdentity.js:9-10` — `LOCAL_PHONE_PATTERN = /^08\d{8,11}$/` (fine, keep) and `INTERNATIONAL_PHONE_PATTERN = /^\+?628\d{8,11}$/` (Indonesia-only; must be replaced).
- **Second, independently-buggy normalizer:** `server/services/fonnte.js:127-136` (`sendWA`'s outbound formatter) unconditionally prepends `62` to any digit string not already starting with `0` or `62` — this corrupts foreign target numbers on the *send* path (e.g. a Singapore number becomes doubly-prefixed). Fixing inbound acceptance alone would leave replies to international customers broken, so this is in scope even though the contract's file list didn't name it — it's required for Objective 1's actual business goal ("Reddy must be able to serve... customers", not just accept their first message).
- **A third, unrelated Indonesia-only normalizer exists** at `server/member-identity.js:3-6` (`normalizeMemberPhone`, used for CRM/member lookup). **Out of scope for this plan** — it governs member matching, not WhatsApp acceptance/reply, isn't named in the contract's audit file list, and touching it risks CRM regressions for existing Indonesian members. Flagged in the final audit report as a follow-up, not fixed here.
- **Sender admission gate has a pre-existing, unrelated gap:** `server/services/waInboundGuard.js`'s `classifyInboundEvent()` (the actual admission gate for `handleMessage`) has no group/broadcast check at all — real group filtering exists in `fonnteWebhookVerifier.js`'s `classifyFonnteEvent()` but is wired only into the dormant trust-gated CRM-identity path (`whatsappIdentityAdapter.js`), not the live reply pipeline. **Out of scope for this plan** — it's a pre-existing P0 security gap orthogonal to phone internationalization, not something this contract's file list or objectives ask to fix, and fixing it is a materially different, larger task. Flagged in the final audit report; not fixed here. The contract's own group/broadcast rejection tests (8, 9) are scoped to the `trustedIdentity`/`whatsappIdentityAdapter` chain, which already does reject `@g.us`/`broadcast`/`s.whatsapp.net` shapes via `hasUnsupportedSenderShape` — that part is already correct and stays correct.
- **Language is already never derived from phone/country code** — confirmed both by reading and by an existing locked-in test (`server/test/whatsapp-identity-adapter-v01.test.js:165-181`). No change needed to preserve this; just don't regress it.
- **Language detection lives entirely in `api/wa/webhook.js`:** `hasIndonesianLanguageSignal` (:1015), `isForeignLanguage` (:1026), `detectForeignLanguage` (:1054, returns chinese/japanese/korean/arabic/thai/turkish/english — missing malay/french/german/spanish from the contract's 11-language minimum), `resolveExistingResponseLanguage` (:1067, presence-path only: text → conversation-history fallback → neutral default). The general (non-presence) path at :1490-1492 uses a plain ternary with **no history fallback at all** — this is why "neutral continuation follows recent same-conversation language" (contract test 19) doesn't reliably hold today outside the presence-guard path.
- **Legacy foreign routing (`handleForeignBooking` / `handleForeignGeneralQuestion`, `api/wa/webhook.js:1137-1286`) is live and tested** (`server/test/reddy-knowledge-system-v01.test.js:1311-1488`), triggered by `isForeignLanguage(text)` — language-triggered, never phone-triggered. `foreignMsg(lang, msgs)` (:1133) already falls back to `msgs['english']` for any language key not present in a given template map, so adding new recognized languages (malay/french/german/spanish) to `detectForeignLanguage` is safe by construction: those customers get correctly-tagged `responseLanguage` for the main LLM, and the deterministic booking-CTA snippet gracefully degrades to English text rather than breaking.
- **`server/whatsapp-ai/services/foreignBookingService.js` (541 lines) is dead code** — not mounted anywhere reachable from `vercel.json`'s routing, confirmed unreachable by `server/test/booking-intelligence-v01.test.js:336-340`. Leave untouched (see Global Constraints).
- **Deterministic fallback language-awareness gap (Objective 7):** confirmed always-Indonesian regardless of `responseLanguage`, even though `responseLanguage` is in scope at the call site: `fallbackReply()` (`api/wa/webhook.js:940-987`, 3 call sites at :1968, :2054, :2098), `bookingGuards.js`'s `guardReddyReply` correction text (:119-125, call site `reddyAdapter.js:396-400` doesn't even pass `responseLanguage`), CRM points-inquiry messages (`webhook.js:1441,1446,1448`), human-handoff messages (`webhook.js:1738,1775`). `realtimeFactGuard.js`'s `buildSafeStatement` (:159-210) **already** branches English vs. Indonesian correctly — no change needed there.
- **Booking-guard claim detection is Indonesian-phrase-only** (`bookingGuards.js:5-20`, `PROHIBITED_PATTERNS` / `UNVERIFIED_AVAILABILITY_PATTERNS`) — an English LLM reply like "Yes, I've already booked it for you" would not be caught today. Contract test 29 ("no fake booking confirmation in any tested language" — tested languages are English/Indonesian per the test list) requires this gap closed for English specifically, mirroring the pattern `realtimeFactGuard.js` already uses (`englishNamedBarberClaimType`).
- **Existing test that currently locks in the bug as correct** and must be updated: `server/test/whatsapp-identity-adapter-v01.test.js:87-109` asserts `'+1 415 555 2671'` is invalid. This assertion is removed (the contract explicitly requires accepting `+1...`) and replaced with a new "international personal senders accepted" test.

---

## Task 1: Shared bounded phone normalizer + trustedIdentity.js fix

**Files:**
- Create: `server/identity/phoneNormalization.js`
- Modify: `server/identity/trustedIdentity.js:1-25` (replace the three phone-related consts and `normalizeVerifiedPhone`)
- Test: `server/test/phone-normalization-v01.test.js` (new)

**Interfaces:**
- Produces: `normalizePhoneNumber(value: string) => string|null` — digits-only, bounded 8-15 total digits, no leading zero (E.164-shaped), OR the Indonesian local-convenience conversion (`08...` → `62...`). Returns `null` for anything malformed. This is the ONE function both `trustedIdentity.js` (inbound) and `fonnte.js` (outbound, Task 2) call.

- [ ] **Step 1: Write `server/identity/phoneNormalization.js`**

```js
'use strict';

/**
 * Bounded, side-effect-free E.164-style phone normalization shared by the
 * WhatsApp trusted-identity issuer (inbound, trustedIdentity.js) and the
 * Fonnte outbound sender (fonnte.js). Accepts realistic international
 * numbers in addition to the Indonesian 08-prefixed local convenience form.
 * Never infers or returns anything about language or country beyond the
 * digits themselves — callers must not use this to decide response language.
 */

// Optional single leading '+', otherwise digits/spaces/parens/dashes only.
// A second '+', a '+' not in leading position, letters, or '@' all fail this.
const SAFE_PHONE_CHARACTERS = /^\+?[0-9\s()-]+$/;

// Indonesian local convenience: "081234567890" (08 + 8-11 more digits).
const LOCAL_ID_PHONE_PATTERN = /^08\d{8,11}$/;

// Bounded realistic E.164 shape: 8-15 total digits, no leading zero (E.164
// country codes never start with 0). Covers 62xxxxxxxxxx (Indonesia, with
// or without leading +), and any other country code (65/60/1/44/81/82/...).
const E164_DIGITS_PATTERN = /^[1-9]\d{7,14}$/;

function normalizePhoneNumber(value) {
  if (typeof value !== 'string' || !SAFE_PHONE_CHARACTERS.test(value)) return null;
  const compact = value.replace(/[\s()-]/g, '');
  const hasPlus = compact.startsWith('+');
  const digits = hasPlus ? compact.slice(1) : compact;

  if (!hasPlus && LOCAL_ID_PHONE_PATTERN.test(digits)) {
    return `62${digits.slice(1)}`;
  }
  if (E164_DIGITS_PATTERN.test(digits)) {
    return digits;
  }
  return null;
}

module.exports = {
  normalizePhoneNumber,
  SAFE_PHONE_CHARACTERS,
  LOCAL_ID_PHONE_PATTERN,
  E164_DIGITS_PATTERN,
};
```

- [ ] **Step 2: Write the failing test for the new module**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhoneNumber } = require('../identity/phoneNormalization');

test('Indonesian local convenience form normalizes to 62-prefixed', () => {
  assert.equal(normalizePhoneNumber('081234567890'), '6281234567890');
  assert.equal(normalizePhoneNumber('0812-3456-7890'), '6281234567890');
});

test('already-62-prefixed Indonesian numbers pass through, with or without +', () => {
  assert.equal(normalizePhoneNumber('6281234567890'), '6281234567890');
  assert.equal(normalizePhoneNumber('+6281234567890'), '6281234567890');
});

test('international personal numbers are accepted (objective 1, requirement 2)', () => {
  const cases = [
    ['+6591234567', '6591234567'],       // Singapore
    ['6591234567', '6591234567'],        // Singapore, no plus
    ['+60123456789', '60123456789'],     // Malaysia
    ['+14155552671', '14155552671'],     // USA
    ['+447911123456', '447911123456'],   // UK
    ['+819012345678', '819012345678'],   // Japan
    ['+821012345678', '821012345678'],   // Korea
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizePhoneNumber(input), expected, `expected ${input} -> ${expected}`);
  }
});

test('normalized output is always digits-only', () => {
  assert.match(normalizePhoneNumber('+1 415 555 2671'), /^\d+$/);
  assert.match(normalizePhoneNumber('081234567890'), /^\d+$/);
});

test('malformed input is rejected: letters, multiple +, embedded @, group/broadcast shapes', () => {
  const invalid = [
    '0812abc345678',
    '+62+81234567890',
    '6281234567890@s.whatsapp.net',
    '120363012345678@g.us',
    'status@broadcast',
    '6.28123456789e12',
    '',
    123456789,
    null,
    undefined,
    {},
    [],
  ];
  for (const value of invalid) {
    assert.equal(normalizePhoneNumber(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('obviously too-short and too-long numbers are rejected', () => {
  assert.equal(normalizePhoneNumber('123'), null); // too short
  assert.equal(normalizePhoneNumber('1234567890123456'), null); // 16 digits, exceeds E.164 max
});

test('bounded to max 15 normalized digits, 15 exactly is accepted', () => {
  assert.equal(normalizePhoneNumber('123456789012345'), '123456789012345'); // 15 digits, boundary
  assert.equal(normalizePhoneNumber('1234567890123456'), null); // 16 digits, rejected
});
```

- [ ] **Step 3: Run the new test to verify it fails (module doesn't exist yet)**

Run: `node --test server/test/phone-normalization-v01.test.js`
Expected: FAIL — `Cannot find module '../identity/phoneNormalization'`

- [ ] **Step 4: Create the module from Step 1, run again**

Run: `node --test server/test/phone-normalization-v01.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Refactor `trustedIdentity.js` to use the shared normalizer**

In `server/identity/trustedIdentity.js`, replace:
```js
const LOCAL_PHONE_PATTERN = /^08\d{8,11}$/;
const INTERNATIONAL_PHONE_PATTERN = /^\+?628\d{8,11}$/;
const SAFE_PHONE_CHARACTERS = /^[0-9+\s()-]+$/;
```
and
```js
function normalizeVerifiedPhone(value) {
  if (typeof value !== 'string' || !SAFE_PHONE_CHARACTERS.test(value)) return null;
  const compact = value.replace(/[\s()-]/g, '');
  if (LOCAL_PHONE_PATTERN.test(compact)) return `62${compact.slice(1)}`;
  if (INTERNATIONAL_PHONE_PATTERN.test(compact)) return compact.replace(/^\+/, '');
  return null;
}
```
with:
```js
const { normalizePhoneNumber } = require('./phoneNormalization');

function normalizeVerifiedPhone(value) {
  return normalizePhoneNumber(value);
}
```
(Keep the function name `normalizeVerifiedPhone` — it's referenced later in the same file at the `issueTrustedIdentity` call site and this keeps the diff minimal and the file's internal naming self-documenting.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: `server/test/whatsapp-identity-adapter-v01.test.js` — the `'invalid personal senders fail closed'` test will now FAIL on the `'+1 415 555 2671'` case (it's now correctly accepted, not rejected). This is expected and fixed in Task 3. Every other test should still pass. Confirm no other unrelated failures before proceeding.

- [ ] **Step 7: Commit**

```bash
git add server/identity/phoneNormalization.js server/identity/trustedIdentity.js server/test/phone-normalization-v01.test.js
git commit -m "feat(identity): replace Indonesia-only phone validation with bounded E.164 normalizer"
```

---

## Task 2: Fix outbound Fonnte sender for international numbers

**Files:**
- Modify: `server/services/fonnte.js:127-136`
- Test: `server/test/fonnte-outbound-normalization-v01.test.js` (new)

**Interfaces:**
- Consumes: nothing new — this is a targeted fix to `sendWA`'s existing inline normalization, not a refactor to use `phoneNormalization.js` directly (see rationale below).

Rationale for NOT reusing `normalizePhoneNumber` here: `sendWA`'s `to` argument is called from many pre-existing sites throughout the codebase with a variety of already-loosely-formatted numbers (admin numbers, branch numbers, CRM-derived numbers) that are not guaranteed to satisfy the bounded/rejecting `normalizePhoneNumber` contract — that function is designed to be a security-relevant *gate* (reject malformed input) for the inbound trust chain, whereas `sendWA` must never refuse to attempt a send just because a number is shaped unusually; it should only stop corrupting numbers it doesn't need to touch. So this fix is a minimal, targeted change to the existing heuristic, not a swap-in of the stricter module.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// fonnte.js calls fetch() and reads env tokens at module scope in ways that
// make full sendWA() execution heavy to test in isolation; the outbound
// number-normalization logic is a pure, small block within it, so this test
// re-derives it from source rather than mocking the whole network call
// stack — consistent with how this codebase already tests other inline
// pure-logic blocks (see e.g. bookingGuards.js's own direct function tests).
// We instead assert on the actual sendWA behavior via a controllable fetch.

test('sendWA does not corrupt already-fully-qualified international target numbers', async (t) => {
  const fonntePath = path.resolve(__dirname, '../services/fonnte.js');
  const originalFetch = global.fetch;
  const capturedBodies = [];
  global.fetch = async (_url, opts) => {
    capturedBodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ status: true }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  process.env.FONNTE_TOKEN = 'test-token';
  delete require.cache[fonntePath];
  const { sendWA } = require(fonntePath);

  const cases = [
    ['6591234567', '6591234567'],     // Singapore, already has its own country code — must NOT get 62 prepended
    ['14155552671', '14155552671'],   // USA
    ['081234567890', '6281234567890'], // Indonesian local convenience — existing behavior preserved
    ['81234567890', '6281234567890'],  // bare Indonesian mobile, no country code — existing behavior preserved
    ['6281234567890', '6281234567890'], // already 62-prefixed — existing behavior preserved
  ];

  for (const [input, expected] of cases) {
    await sendWA(input, 'test message', { branch: 'bypass' });
  }

  assert.deepEqual(capturedBodies.map((b) => b.target), cases.map(([, expected]) => expected));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test/fonnte-outbound-normalization-v01.test.js`
Expected: FAIL on the `'6591234567'` case — current code produces `'626591234567'` (double-prefixed) instead of `'6591234567'`.

- [ ] **Step 3: Fix `server/services/fonnte.js:127-136`**

Replace:
```js
  // Normalize to full Indonesian international format (628xxx):
  //   "+628xxx" → strip + → "628xxx"
  //   "08xxx"   → remove leading 0, prepend 62 → "628xxx"
  //   "8xxx"    → no leading 0 or 62 prefix → prepend 62 → "628xxx"
  let number = String(to).replace(/\D/g, '');
  if (number.startsWith('0')) {
    number = '62' + number.slice(1);
  } else if (!number.startsWith('62')) {
    number = '62' + number;
  }
```
with:
```js
  // Normalize outbound target number:
  //   "+628xxx" / "628xxx"        → already has a country code (Indonesian
  //                                  or foreign) → left as-is
  //   "08xxx"                     → Indonesian local convenience → "628xxx"
  //   "8xxx" (bare, no 0/62/other
  //   country code prefix)        → bare Indonesian mobile shorthand →
  //                                  "628xxx" (pre-existing convenience,
  //                                  unchanged)
  // Anything that already starts with a digit other than 0 (i.e. already
  // carries SOME country code, Indonesian or foreign) is never touched —
  // the prior code's `else if (!number.startsWith('62'))` branch blindly
  // prepended 62 onto foreign numbers too (e.g. a Singapore number became
  // "62" + "6591234567"), which this fixes.
  let number = String(to).replace(/\D/g, '');
  if (number.startsWith('0')) {
    number = '62' + number.slice(1);
  } else if (number.startsWith('8') && !number.startsWith('62')) {
    number = '62' + number;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test/fonnte-outbound-normalization-v01.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: all prior-passing tests still pass (this file has no existing dedicated test suite per the audit, so no prior fonnte.js test to break).

- [ ] **Step 6: Commit**

```bash
git add server/services/fonnte.js server/test/fonnte-outbound-normalization-v01.test.js
git commit -m "fix(fonnte): stop corrupting foreign target numbers in outbound send"
```

---

## Task 3: Update identity test suite for international acceptance + rejection

**Files:**
- Modify: `server/test/whatsapp-identity-adapter-v01.test.js:87-109` (the `'invalid personal senders fail closed'` test)
- Modify: same file — add new tests after the existing `'authenticated personal Indonesian senders...'` test (currently ending at line 85)

**Interfaces:**
- Consumes: `adaptAuthenticatedWhatsappEvent`, `issueEvent` (already defined in this file), `normalizePhoneNumber` is NOT imported here — tests go through the full adapter, matching this file's existing convention.

- [ ] **Step 1: Remove the now-incorrect assertion from the invalid-senders test**

In `server/test/whatsapp-identity-adapter-v01.test.js`, in the `'invalid personal senders fail closed without identifier fallback'` test, remove `'+1 415 555 2671'` from the `invalidSenders` array (it is now a valid international sender — see the new test below).

- [ ] **Step 2: Add the new international-acceptance test**

Insert immediately after the existing `'authenticated personal Indonesian senders issue genuine trusted identities'` test (after line 85):

```js
test('authenticated personal international senders issue genuine trusted identities (objective 1)', () => {
  for (const [sender, canonical] of [
    ['+6591234567', '6591234567'],       // Singapore
    ['6591234567', '6591234567'],        // Singapore, no plus
    ['+60123456789', '60123456789'],     // Malaysia
    ['+14155552671', '14155552671'],     // USA
    ['+447911123456', '447911123456'],   // UK
    ['+819012345678', '819012345678'],   // Japan
    ['+821012345678', '821012345678'],   // Korea
  ]) {
    const event = issueEvent({ sender });
    const result = adaptAuthenticatedWhatsappEvent(event);

    assert.equal(result.status, 'success', `sender ${sender} should be accepted`);
    assert.equal(result.trustedIdentity.source, 'whatsapp');
    assert.equal(result.trustedIdentity.phone, canonical);
    assert.equal(isTrustedIdentity(result.trustedIdentity), true);
    assert.match(result.trustedIdentity.phone, /^\d+$/, 'normalized phone must be digits-only');
  }
});

test('more than 15 normalized digits is rejected', () => {
  const event = issueEvent({ sender: '+123456789012345678' }); // 18 digits
  const result = adaptAuthenticatedWhatsappEvent(event);
  assert.equal(result.trustedIdentity, null);
});

test('response language is never inferred from an accepted international sender\'s country code', () => {
  // Cross-checks objective 1 requirement 6 end-to-end through the adapter:
  // accepting a +65/+1/+44/etc sender must not create or expose any
  // language/country field on the issued identity.
  for (const sender of ['+6591234567', '+14155552671', '+819012345678']) {
    const event = issueEvent({ sender });
    const result = adaptAuthenticatedWhatsappEvent(event);
    assert.deepEqual(Object.keys(result.trustedIdentity).sort(), ['phone', 'source']);
  }
});
```

- [ ] **Step 3: Run this test file**

Run: `node --test server/test/whatsapp-identity-adapter-v01.test.js`
Expected: PASS, all tests green (including the previously-failing invalid-senders test, now that `+1 415 555 2671` is removed from it).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/test/whatsapp-identity-adapter-v01.test.js
git commit -m "test(identity): lock in international sender acceptance, remove obsolete +1-rejection assertion"
```

---

## Task 4: Unified language resolution module + webhook.js wiring

**Files:**
- Create: `server/agents/reddy/languageResolution.js`
- Modify: `api/wa/webhook.js:1015-1083` (remove the four local function bodies, require the new module instead), `api/wa/webhook.js:1490-1493` (use the unified resolver for both branches), `api/wa/webhook.js:2834-2835` (export lines)
- Test: `server/test/language-resolution-v01.test.js` (new)

**Interfaces:**
- Produces: `hasIndonesianLanguageSignal(text)`, `isForeignLanguage(text)`, `detectForeignLanguage(text)`, `resolveResponseLanguage(text, conversationContext, { presenceIntent })`, `SUPPORTED_LANGUAGES` (array, for reference/tests).
- Consumes (Task 5): `resolveResponseLanguage`'s output flows into `fallbackReply`, `guardReddyReply`, CRM/handoff messages as the `responseLanguage` string.

- [ ] **Step 1: Write `server/agents/reddy/languageResolution.js`**

```js
'use strict';

/**
 * One bounded language-resolution contract for Reddy (international
 * multilingual contract, objective 2). Consolidates what were four
 * independently-evolving functions inside api/wa/webhook.js into a single
 * module so there is exactly one precedence rule, used identically whether
 * or not the current turn matched the barber-presence intent path.
 *
 * Precedence: current message's clear language > recent same-conversation
 * customer language > neutral fallback (Indonesian). Never derives language
 * from phone number, country code, branch, or customer name — callers must
 * not pass any of that in.
 */

const SUPPORTED_LANGUAGES = Object.freeze([
  'indonesian', 'english', 'chinese', 'japanese', 'korean',
  'malay', 'arabic', 'french', 'german', 'spanish', 'turkish',
]);

function hasIndonesianLanguageSignal(text) {
  const lower = String(text || '').toLowerCase();
  const indonesianWords = ['mau', 'booking', 'potong', 'rambut', 'harga', 'berapa', 'bisa', 'kapan',
    'hari', 'jam', 'cabang', 'lokasi', 'dimana', 'ada', 'saya', 'aku', 'kak', 'mas',
    'terima kasih', 'makasih', 'tolong', 'bantu', 'info', 'dong', 'ya', 'iya', 'gak',
    'tidak', 'bukan', 'oke', 'siap', 'datang', 'jadi', 'batal'];
  const words = lower.split(/\s+/);
  const indonesianCount = words.filter((w) => indonesianWords.some((iw) => w.includes(iw))).length;
  return words.length > 0 && indonesianCount / words.length > 0.3;
}

const MALAY_WORDS = ['awak', 'ringgit', 'boleh tak', 'tak boleh', 'sila '];
const GERMAN_WORDS = ['wie viel', 'kostet', 'termin', 'haarschnitt', 'friseur', 'danke schön'];
const SPANISH_WORDS = ['cuánto', 'cuesta', 'corte de pelo', 'peluquero', 'reserva'];
const FRENCH_WORDS = ['bonjour', 'combien', 'coiffeur', 'réservation', 'rendez-vous', 'coupe de cheveux'];
const TURKISH_WORDS = ['merhaba', 'selam', 'günaydın', 'saç', 'berber', 'randevu',
  'rezervasyon', 'istiyorum', 'lütfen', 'teşekkürler', 'tıraş', 'kesim', 'sakal'];

function isForeignLanguage(text) {
  const lower = String(text || '').toLowerCase();
  if (hasIndonesianLanguageSignal(text)) return false;

  const foreignPatterns = [
    /\b(i want|i need|i would|i'd like|can i|could you|please|thank you|thanks)\b/i,
    /\b(hello|hey|good morning|good afternoon|good evening)\b/i,
    /\b(haircut|hair cut|barber|appointment|schedule|book|reserve)\b/i,
    /\b(how much|what time|when|where|which)\b/i,
    /\b(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(do you|are you|is there|can you|will you)\b/i,
    /\b(my name|i am|i'm)\b/i,
    // Turkish
    /\b(merhaba|selam|berber|randevu|rezervasyon|istiyorum|saç|kesim|tıraş)\b/i,
    // Chinese
    /[一-鿿]/,
    // Japanese
    /[぀-ゟ゠-ヿ]/,
    // Korean
    /[가-힯]/,
    // Arabic
    /[؀-ۿ]/,
    // Thai
    /[฀-๿]/,
    // German (distinctive umlauts/eszett, or keywords)
    /[äöüß]/i,
    new RegExp(`\\b(${GERMAN_WORDS.join('|')})\\b`, 'i'),
    // Spanish (distinctive inverted punctuation/ñ, or keywords)
    /[¿¡ñ]/,
    new RegExp(`\\b(${SPANISH_WORDS.join('|')})\\b`, 'i'),
    // French (distinctive accented letters, or keywords)
    /[àâçéèêëîïôûùÿœ]/i,
    new RegExp(`\\b(${FRENCH_WORDS.join('|')})\\b`, 'i'),
    // Malay
    new RegExp(`\\b(${MALAY_WORDS.map((w) => w.trim()).join('|')})\\b`, 'i'),
  ];
  return foreignPatterns.some((p) => p.test(lower));
}

function detectForeignLanguage(text) {
  const raw = String(text || '');
  if (/[一-鿿]/.test(raw)) return 'chinese';
  if (/[぀-ゟ゠-ヿ]/.test(raw)) return 'japanese';
  if (/[가-힯]/.test(raw)) return 'korean';
  if (/[؀-ۿ]/.test(raw)) return 'arabic';
  if (/[฀-๿]/.test(raw)) return 'thai';

  const lower = raw.toLowerCase();
  if (TURKISH_WORDS.some((w) => lower.includes(w))) return 'turkish';
  if (MALAY_WORDS.some((w) => lower.includes(w.trim()))) return 'malay';

  // German checked before Spanish/French: ß/ä/ö/ü are highly distinctive
  // and don't collide with the other two.
  if (/[äöüß]/i.test(raw) || GERMAN_WORDS.some((w) => lower.includes(w))) return 'german';
  // Spanish's ¿/¡ are unique to Spanish among these languages — check next.
  if (/[¿¡ñ]/.test(raw) || SPANISH_WORDS.some((w) => lower.includes(w))) return 'spanish';
  if (/[àâçéèêëîïôûùÿœ]/i.test(raw) || FRENCH_WORDS.some((w) => lower.includes(w))) return 'french';

  return 'english';
}

/**
 * Single entry point for both the barber-presence path and the general
 * path in api/wa/webhook.js — previously these had two different precedence
 * rules (the general path had no conversation-history fallback at all).
 */
function resolveResponseLanguage(text, conversationContext, options = {}) {
  const { presenceIntent = null } = options;
  if (hasIndonesianLanguageSignal(text)) return 'indonesian';
  if (isForeignLanguage(text)) return detectForeignLanguage(text);

  const turns = Array.isArray(conversationContext?.turns) ? conversationContext.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== 'user' || !String(turn?.content || '').trim()) continue;
    if (hasIndonesianLanguageSignal(turn.content)) return 'indonesian';
    if (isForeignLanguage(turn.content)) return detectForeignLanguage(turn.content);
  }

  // Bounded composition for matched named-presence turns only. Does not
  // alter global language detection or infer language from a phone number.
  if (presenceIntent?.matched && /\b(?:available|free)\b/i.test(String(text || ''))) return 'english';
  return 'indonesian';
}

module.exports = {
  SUPPORTED_LANGUAGES,
  hasIndonesianLanguageSignal,
  isForeignLanguage,
  detectForeignLanguage,
  resolveResponseLanguage,
};
```

- [ ] **Step 2: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasIndonesianLanguageSignal, isForeignLanguage, detectForeignLanguage, resolveResponseLanguage, SUPPORTED_LANGUAGES,
} = require('../agents/reddy/languageResolution');

test('supported language minimum list matches the contract (objective 2)', () => {
  for (const lang of ['indonesian', 'english', 'chinese', 'japanese', 'korean', 'malay', 'arabic', 'french', 'german', 'spanish', 'turkish']) {
    assert.ok(SUPPORTED_LANGUAGES.includes(lang), `missing ${lang}`);
  }
});

test('existing supported-language detection is unchanged (regression)', () => {
  assert.equal(detectForeignLanguage('你好，多少钱剪头发？'), 'chinese');
  assert.equal(detectForeignLanguage('こんにちは、散髪はいくらですか？'), 'japanese');
  assert.equal(detectForeignLanguage('안녕하세요, 이발 얼마예요?'), 'korean');
  assert.equal(detectForeignLanguage('Merhaba, saç kesimi ne kadar?'), 'turkish');
  assert.equal(detectForeignLanguage('How much is a haircut?'), 'english');
});

test('new supported languages are recognized (objective 2 minimum list)', () => {
  assert.equal(detectForeignLanguage('Wie viel kostet ein Haarschnitt beim Friseur?'), 'german');
  assert.equal(detectForeignLanguage('¿Cuánto cuesta un corte de pelo?'), 'spanish');
  assert.equal(detectForeignLanguage('Bonjour, combien coûte une coupe de cheveux chez le coiffeur?'), 'french');
  assert.equal(detectForeignLanguage('Awak, boleh tak saya nak tanya berapa ringgit potong rambut?'), 'malay');
});

test('language is never derived from phone/country code (function signatures take only text)', () => {
  assert.equal(hasIndonesianLanguageSignal.length, 1);
  assert.equal(isForeignLanguage.length, 1);
  assert.equal(detectForeignLanguage.length, 1);
});

test('resolveResponseLanguage: current message wins over conversation history', () => {
  const history = { turns: [{ role: 'user', content: 'How much is a haircut?' }] };
  assert.equal(resolveResponseLanguage('Kalau CSB berapa?', history, {}), 'indonesian');
});

test('resolveResponseLanguage: neutral continuation follows recent conversation language (objective 4, test 19)', () => {
  const history = { turns: [
    { role: 'user', content: 'How much is a haircut?' },
    { role: 'assistant', content: 'It is Rp100.000.' },
  ] };
  assert.equal(resolveResponseLanguage('ok', history, {}), 'english');
});

test('resolveResponseLanguage: falls back to neutral (indonesian) with no signal anywhere', () => {
  assert.equal(resolveResponseLanguage('ok', { turns: [] }, {}), 'indonesian');
});

test('resolveResponseLanguage: language switching follows current-turn override (objective 4, tests 17-18)', () => {
  const afterEnglish = { turns: [{ role: 'user', content: 'Hello, how much is a haircut?' }] };
  assert.equal(resolveResponseLanguage('Kalau CSB berapa?', afterEnglish, {}), 'indonesian');

  const afterIndonesian = { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] };
  assert.equal(resolveResponseLanguage('Can I come tomorrow?', afterIndonesian, {}), 'english');
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test server/test/language-resolution-v01.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Create the module (Step 1), run again**

Run: `node --test server/test/language-resolution-v01.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Wire `api/wa/webhook.js` to the new module**

Replace the block at `api/wa/webhook.js:1015-1083` (the four function definitions: `hasIndonesianLanguageSignal`, `isForeignLanguage`, `detectForeignLanguage`, `resolveExistingResponseLanguage`) with:

```js
const {
  hasIndonesianLanguageSignal, isForeignLanguage, detectForeignLanguage, resolveResponseLanguage,
} = require('../../server/agents/reddy/languageResolution');
```

Update the call site at `api/wa/webhook.js:1490-1492` from:
```js
  const responseLanguage = presenceIntent.matched
    ? resolveExistingResponseLanguage(text, conversationContext, presenceIntent)
    : (isForeignLanguage(text) ? detectForeignLanguage(text) : 'indonesian');
```
to:
```js
  const responseLanguage = resolveResponseLanguage(text, conversationContext, { presenceIntent });
```

Update the export lines at `api/wa/webhook.js:2834-2835` from:
```js
module.exports.detectForeignLanguage = detectForeignLanguage;
module.exports.resolveExistingResponseLanguage = resolveExistingResponseLanguage;
```
to:
```js
module.exports.detectForeignLanguage = detectForeignLanguage;
module.exports.resolveResponseLanguage = resolveResponseLanguage;
```
(`resolveExistingResponseLanguage` was not imported by any test per the audit — confirm with `grep -rn resolveExistingResponseLanguage server/test` before removing the export name; if any hit turns up, keep both names exported as aliases instead of removing.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — `server/test/reddy-knowledge-system-v01.test.js` (imports `detectForeignLanguage` from webhook.js) must still pass unchanged since existing language branches are untouched, only extended.

- [ ] **Step 7: Commit**

```bash
git add server/agents/reddy/languageResolution.js server/test/language-resolution-v01.test.js api/wa/webhook.js
git commit -m "refactor(reddy): unify language detection into one resolver, extend to malay/french/german/spanish"
```

---

## Task 5: Language-aware deterministic fallbacks (objective 7, bounded scope)

Scope decision (see Audit Summary): the contract explicitly says "do not translate everything... at minimum: no English customer should receive Indonesian safety text simply because a guard triggered," and the contract's own test list (30-33) only exercises English/Indonesian for this. `realtimeFactGuard.js` already satisfies this. This task closes the gap for the four remaining named guards: `fallbackReply` (knowledge-unavailable + generic fallback), the booking guard's correction text, CRM points messages, and human-handoff messages — English + Indonesian only, matching the literal test requirement. It also closes a real fact-authority gap in the booking guard's claim detection (English phrasing wasn't caught at all).

**Files:**
- Modify: `api/wa/webhook.js:940-987` (`fallbackReply`), and its 3 call sites at `:1968`, `:2054`, `:2098`
- Modify: `api/wa/webhook.js:1441,1446,1448` (CRM points messages) and the `isForeignLanguage` check needed at that call site (it runs before `responseLanguage` is computed — see Step 3)
- Modify: `api/wa/webhook.js:1738,1775` (human-handoff messages)
- Modify: `server/agents/reddy/bookingGuards.js:5-20` (add English claim-detection patterns), `:102-128` (`guardReddyReply`, add `responseLanguage` param)
- Modify: `server/agents/reddy/reddyAdapter.js:396-400` (pass `responseLanguage` into `guardReddyReply`)
- Test: `server/test/reddy-deterministic-fallback-language-v01.test.js` (new)

**Interfaces:**
- Consumes: `resolveResponseLanguage` output (a lowercase string like `'english'`/`'indonesian'`/`'french'`) — every function below treats anything other than `'english'` as Indonesian (the existing, established convention from `realtimeFactGuard.js:170`).

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const { fallbackReply } = require(webhookPath);
const { guardReddyReply, containsProhibitedClaim, containsUnverifiedAvailabilityClaim } = require('../agents/reddy/bookingGuards');

test('fallbackReply: generic fallback is English for an English customer (objective 7)', () => {
  const idReply = fallbackReply('asdkjfh random text', 'Bob', 'bypass', null, 'indonesian');
  const enReply = fallbackReply('asdkjfh random text', 'Bob', 'bypass', null, 'english');
  assert.match(idReply, /Mohon maaf/);
  assert.doesNotMatch(enReply, /Mohon maaf|Kak/);
  assert.match(enReply, /Bob|sorry|apologize/i);
});

test('fallbackReply: knowledge-unavailable guard is English for an English customer', () => {
  const enReply = fallbackReply('what is the price of a royal grooming package', 'Bob', 'bypass', 'unavailable', 'english');
  assert.doesNotMatch(enReply, /Maaf Kak|terverifikasi/);
});

test('fallbackReply: default (no responseLanguage passed) stays Indonesian (backward compatible)', () => {
  const reply = fallbackReply('halo', 'Bob');
  assert.match(reply, /Halo/);
});

test('bookingGuards: English fake-booking-confirmation claim is caught (objective 6/objective 7, test 29)', () => {
  assert.equal(containsProhibitedClaim("Yes, I've already booked it for you!"), true);
  assert.equal(containsProhibitedClaim('Your booking is confirmed for 3pm.'), true);
  assert.equal(containsProhibitedClaim('I have rescheduled your appointment.'), true);
});

test('bookingGuards: English unverified-availability claim is caught', () => {
  assert.equal(containsUnverifiedAvailabilityClaim('The slot at 3pm is still available.'), true);
});

test('bookingGuards: ordinary English informational text is not falsely blocked (test 32)', () => {
  assert.equal(containsProhibitedClaim('You can book online at redboxbarbershop.com.'), false);
  assert.equal(containsUnverifiedAvailabilityClaim('Our hours are 10am to 9pm.'), false);
});

test('guardReddyReply: correction text is English for an English customer (test 30-31 pairing)', () => {
  const en = guardReddyReply("Yes, I've already booked it for you!", {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true, responseLanguage: 'english',
  });
  assert.equal(en.blockedProhibitedClaim, true);
  assert.match(en.sanitizedReply, /booking|website/i);
  assert.doesNotMatch(en.sanitizedReply, /Kak|belum dibuat/);

  const id = guardReddyReply('Sudah aku booking ya kak!', {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true, responseLanguage: 'indonesian',
  });
  assert.equal(id.blockedProhibitedClaim, true);
  assert.match(id.sanitizedReply, /Kak/);
});

test('guardReddyReply: default responseLanguage stays Indonesian (backward compatible)', () => {
  const result = guardReddyReply('Sudah aku booking ya kak!', {
    isBackendVerified: false, bookingUrl: 'https://redboxbarbershop.com/booking.html', bookingCtaEligible: true,
  });
  assert.match(result.sanitizedReply, /Kak/);
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `node --test server/test/reddy-deterministic-fallback-language-v01.test.js`
Expected: FAIL on most assertions (no language-awareness yet).

- [ ] **Step 3: Add English claim-detection patterns to `bookingGuards.js`**

In `server/agents/reddy/bookingGuards.js`, after the existing `UNVERIFIED_AVAILABILITY_PATTERNS` array (after line 20), add:

```js
const ENGLISH_PROHIBITED_PATTERNS = [
  /\b(i|we)('ve| have)?\s*(already\s+)?(booked|locked|confirmed|saved|secured)\s+(it|the\s+slot|your\s+slot|your\s+booking|the\s+booking|that)\b/i,
  /\b(your\s+)?(booking|reservation|slot|appointment)\s+(is|has\s+been)\s+(confirmed|booked|locked|saved|secured)\b/i,
  /\bi\s+(have|'ve)\s+(already\s+)?(rescheduled|cancelled|canceled)\s+(it|your\s+booking|the\s+booking|your\s+appointment)\b/i,
  /\breschedul(e|ing)\s+(was\s+)?(successful|done|complete)\b/i,
];

const ENGLISH_UNVERIFIED_AVAILABILITY_PATTERNS = [
  /\b(the\s+)?slot\s*(at\s*)?\d{1,2}(:[0-5]\d)?\s*(am|pm)?\s*(is\s+)?(still\s+)?(open|available|free)\b/i,
  /\b(the\s+)?(schedule|slot|time)\s+(is\s+)?(open|available|free)\s+(right\s+now|now)?\b/i,
];
```

Update `containsProhibitedClaim` and `containsUnverifiedAvailabilityClaim` to also check these:
```js
function containsProhibitedClaim(text) {
  return typeof text === 'string'
    && (PROHIBITED_PATTERNS.some((pattern) => pattern.test(text))
      || ENGLISH_PROHIBITED_PATTERNS.some((pattern) => pattern.test(text)));
}

function containsUnverifiedAvailabilityClaim(text) {
  return typeof text === 'string'
    && (UNVERIFIED_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(text))
      || ENGLISH_UNVERIFIED_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(text)));
}
```

- [ ] **Step 4: Add `responseLanguage` to `guardReddyReply`**

In `server/agents/reddy/bookingGuards.js`, replace the `guardReddyReply` function body's return-string block:
```js
  const sanitizedReply = blockedProhibitedClaim
    ? (bookingCtaEligible
      ? `Booking belum dibuat atau diubah lewat WhatsApp ya Kak. Untuk memilih dan mengonfirmasi reservasi, lanjutkan di website resmi: ${bookingUrl}`
      : `Booking belum dibuat atau diubah lewat WhatsApp ya Kak.`)
    : (bookingCtaEligible
      ? `Ketersediaan kapster dan jam perlu dicek real-time di website resmi ya Kak: ${bookingUrl}`
      : `Aku belum bisa memastikan ketersediaan itu dari data yang terverifikasi, Kak.`);
```
with:
```js
  const isEnglish = String(options.responseLanguage || '').toLowerCase() === 'english';
  const sanitizedReply = isEnglish
    ? (blockedProhibitedClaim
      ? (bookingCtaEligible
        ? `No booking was made or changed via WhatsApp. To confirm a reservation, please continue on the official website: ${bookingUrl}`
        : `No booking was made or changed via WhatsApp.`)
      : (bookingCtaEligible
        ? `Barber and time-slot availability needs to be checked in real time on the official website: ${bookingUrl}`
        : `I can't confirm that availability from verified data right now.`))
    : (blockedProhibitedClaim
      ? (bookingCtaEligible
        ? `Booking belum dibuat atau diubah lewat WhatsApp ya Kak. Untuk memilih dan mengonfirmasi reservasi, lanjutkan di website resmi: ${bookingUrl}`
        : `Booking belum dibuat atau diubah lewat WhatsApp ya Kak.`)
      : (bookingCtaEligible
        ? `Ketersediaan kapster dan jam perlu dicek real-time di website resmi ya Kak: ${bookingUrl}`
        : `Aku belum bisa memastikan ketersediaan itu dari data yang terverifikasi, Kak.`));
```

- [ ] **Step 5: Wire `responseLanguage` through in `reddyAdapter.js`**

In `server/agents/reddy/reddyAdapter.js:396-400`, change:
```js
  const guarded = guardReddyReply(reply, {
    isBackendVerified: false,
    bookingUrl: handoffUrl,
    bookingCtaEligible,
  });
```
to:
```js
  const guarded = guardReddyReply(reply, {
    isBackendVerified: false,
    bookingUrl: handoffUrl,
    bookingCtaEligible,
    responseLanguage,
  });
```
(`responseLanguage` is already computed at `reddyAdapter.js:156` and in scope at this call site.)

- [ ] **Step 6: Add `responseLanguage` param to `fallbackReply` in `api/wa/webhook.js`**

Replace the function signature and the 8 return statements in `api/wa/webhook.js:940-987`:

```js
function fallbackReply(text, name, branch = 'bypass', knowledgeStatus = null, responseLanguage = 'indonesian') {
  const t = text.toLowerCase();
  const fn = extractFirstName(name);
  const nameLabel = fn ? 'Kak ' + fn : 'Kak';
  const isEnglish = String(responseLanguage || '').toLowerCase() === 'english';

  const has = (kws) => kws.some(k => t.includes(k));
  const bConfig = getBranchConfig(branch);

  // 1. High Authority Booking Intent / Status Fallback
  if (has(['konfirmasi booking', 'konfirmasi bkng', 'sudah booking', 'mau konfirmasi', 'ini konfirmasi'])) {
    return isEnglish
      ? `For the official status of your Redbox booking, please check the booking website directly: ${bookingUrl(branch)}`
      : `Untuk status resmi booking Redbox, Kakak bisa cek langsung di sistem booking website ya Kak: ${bookingUrl(branch)}`;
  }

  if (has(['slot terakhir', 'booking terakhir', 'slot malam', 'paling malam booking', 'bisa booking jam'])) {
    return isEnglish
      ? `The last booking slot at Redbox ${bConfig.name} is ${bConfig.last_booking_slot} WIB. To confirm real-time availability, please check and book directly via the booking website:\n${bookingUrl(branch)}`
      : `Slot booking terakhir di Redbox ${bConfig.name} adalah pukul ${bConfig.last_booking_slot} WIB Kak. Untuk memastikan slotnya masih tersedia real-time, silakan cek dan pesan langsung via website booking ya:\n${bookingUrl(branch)}`;
  }

  if (has(['booking', 'reservasi', 'jadwal', 'pesan', 'mau potong', 'mau cukur', 'slot', 'book'])) {
    return isEnglish
      ? `To make a booking or check real-time slot availability, please visit the Redbox booking website:\n${bookingUrl(branch)}`
      : `Untuk buat booking atau cek ketersediaan slot real-time, Kakak bisa langsung akses ke website booking Redbox ya Kak:\n${bookingUrl(branch)}`;
  }

  // 2. Factual Knowledge Unavailable Guard
  if ((knowledgeStatus === 'unavailable' || knowledgeStatus === 'no_verified_fact')
    && isFactualKnowledgeRequest('', text)) {
    return isEnglish
      ? `Sorry, verified information for this question isn't available right now. You can still find Redbox information at redboxbarbershop.com or contact the branch directly.`
      : `Maaf Kak, info terverifikasi untuk pertanyaan ini belum tersedia sekarang. Informasi Redbox tetap bisa dilihat di redboxbarbershop.com atau hubungi admin cabang ya.`;
  }

  // 3. Ordinary Deterministic Fallback
  if (has(['jam buka', 'jam tutup', 'buka jam', 'tutup jam', 'operasional', 'buka sampai', 'tutup jam berapa'])) {
    return isEnglish
      ? `Redbox ${bConfig.name} is open every day from ${bConfig.hours.opens} to ${bConfig.hours.closes} WIB.`
      : `Redbox ${bConfig.name} buka setiap hari pukul ${bConfig.hours.opens} – ${bConfig.hours.closes} WIB, Kak.`;
  }
  if (has(['halo', 'hai', 'hi ', 'hello', 'hei', 'hey', 'pagi', 'siang', 'sore', 'malam', 'selamat'])) {
    return isEnglish
      ? `Hi ${fn || 'there'}, is there anything I can help with about Redbox Barbershop's services, prices, or locations?`
      : `Halo ${nameLabel}, ada yang bisa aku bantu seputar layanan, harga, atau lokasi Redbox Barbershop?`;
  }
  if (has(['harga', 'berapa', 'layanan', 'menu', 'paket', 'price', 'tarif', 'biaya'])) {
    return isEnglish
      ? `Sorry, I can't confirm service or price information right now. Full Redbox information is available at redboxbarbershop.com.`
      : `Maaf Kak, aku belum bisa memastikan info layanan atau harga saat ini. Informasi lengkap Redbox tetap bisa dilihat di redboxbarbershop.com ya.`;
  }
  if (has(['lokasi', 'alamat', 'dimana', 'maps', 'cabang'])) {
    return isEnglish
      ? `Sorry, I can't confirm branch details right now. Please check verified information at redboxbarbershop.com.`
      : `Maaf Kak, aku belum bisa memastikan detail cabang saat ini. Cek informasi terverifikasi di redboxbarbershop.com ya.`;
  }
  if (has(['makasih', 'terima kasih', 'thanks', 'thx'])) {
    return isEnglish
      ? `You're welcome${fn ? ', ' + fn : ''}! Let me know if there's anything else about Redbox I can help with.`
      : `Sama-sama ${nameLabel}! Kalau ada hal lain seputar Redbox, silakan beri tahu aku ya.`;
  }

  // 4. Generic Fallback
  return isEnglish
    ? `Sorry${fn ? ', ' + fn : ''}, the system is currently reprocessing. Redbox information is still available at redboxbarbershop.com.`
    : `Mohon maaf ${nameLabel}, saat ini sistem sedang memproses ulang. Informasi Redbox tetap bisa dilihat di redboxbarbershop.com ya.`;
}
```

Update the 3 call sites to pass `responseLanguage` (already in scope at all three, per the audit):
- `:1968`: `fallbackReply(text, name, branch, knowledgeContext?.status, responseLanguage)`
- `:2054`: `fallbackReply(text, name, branch, knowledgeContext?.status, responseLanguage)`
- `:2098`: `fallbackReply(text, name, branch, fallbackKnowledgeContext?.status, responseLanguage)`

- [ ] **Step 7: Make CRM points-inquiry messages language-aware**

At `api/wa/webhook.js:1441,1446,1448`, this block runs BEFORE `responseLanguage` is computed (conversation history/language resolution happens later, at line ~1490, only after the points shortcut is ruled out — see the audit summary). Rather than reordering the function (high risk for a P0-sensitive live path), use the already-available pure function directly at this call site. Immediately before the `if (orchResult.execution_status === 'unauthorized')` block, add:
```js
    const pointsIsEnglish = isForeignLanguage(text) && detectForeignLanguage(text) === 'english';
```
Then change the four message assignments to:
```js
    let pointsReply;
    if (orchResult.execution_status === 'unauthorized') {
      pointsReply = pointsIsEnglish
        ? 'To check your Redbox member points balance, please make sure you contact us from your verified number.'
        : 'Untuk mengecek saldo poin member Redbox, pastikan kamu menghubungi kami via nomor terverifikasi ya Kak.';
    } else if (orchResult.execution_status === 'success') {
      const points = orchResult.result?.data?.points_balance ?? 0;
      pointsReply = pointsIsEnglish
        ? 'Your current Redbox member points balance: ' + points + ' points.'
        : 'Saldo poin member Redbox kamu saat ini: ' + points + ' poin.';
    } else if (orchResult.execution_status === 'customer_not_found') {
      pointsReply = pointsIsEnglish
        ? "This WhatsApp number isn't registered as a Redbox member yet. Get 5% loyalty points on every haircut visit!"
        : 'Nomor WhatsApp ini belum terdaftar sebagai member Redbox. Dapatkan poin loyalty 5% di setiap kunjungan cukur kamu!';
    } else {
      pointsReply = pointsIsEnglish
        ? 'The points-check service is temporarily unavailable. Please try again shortly.'
        : 'Layanan cek poin sedang tidak dapat diakses sementara. Coba beberapa saat lagi ya Kak.';
    }
```
(`isForeignLanguage` and `detectForeignLanguage` are already required into this file per Task 4 Step 5.)

- [ ] **Step 8: Make human-handoff messages language-aware**

At `api/wa/webhook.js:1738`, change:
```js
      const handoffReply = 'Pesan Kakak sudah aku teruskan ke admin Redbox. Admin akan membalas di chat ini.';
```
to:
```js
      const handoffReply = String(conversationContext?.response_language || 'indonesian').toLowerCase() === 'english'
        ? 'Your message has been forwarded to the Redbox admin. The admin will reply in this chat.'
        : 'Pesan Kakak sudah aku teruskan ke admin Redbox. Admin akan membalas di chat ini.';
```

At `api/wa/webhook.js:1775`, change:
```js
    const fallbackReply = 'Aku belum berhasil meneruskan permintaan ini ke tim RedBox. Bisa coba lagi sebentar atau hubungi customer service RedBox ya Kak.';
```
to:
```js
    const fallbackReply = String(conversationContext?.response_language || 'indonesian').toLowerCase() === 'english'
      ? "I wasn't able to forward this request to the RedBox team. Please try again shortly or contact RedBox customer service."
      : 'Aku belum berhasil meneruskan permintaan ini ke tim RedBox. Bisa coba lagi sebentar atau hubungi customer service RedBox ya Kak.';
```
(Note: this local variable is also named `fallbackReply`, shadowing the module-level function of the same name within this block's scope — this is pre-existing in the file, not introduced by this change; leave as-is to keep the diff minimal.)

- [ ] **Step 9: Run the new test file**

Run: `node --test server/test/reddy-deterministic-fallback-language-v01.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions. Pay special attention to `server/test/reddy-knowledge-system-v01.test.js` (calls `fallbackReply` directly — confirm any existing calls there omit the 5th arg and still get Indonesian output) and `server/test/reddy-barber-presence-first-turn-guard.test.js` (must still pass unchanged, since `realtimeFactGuard.js` was not touched).

- [ ] **Step 11: Commit**

```bash
git add api/wa/webhook.js server/agents/reddy/bookingGuards.js server/agents/reddy/reddyAdapter.js server/test/reddy-deterministic-fallback-language-v01.test.js
git commit -m "feat(reddy): make named deterministic fallbacks language-aware (EN/ID), extend booking-guard claim detection to English"
```

---

## Task 6: Barber-presence and booking-authority cross-language regression tests

These tests lock in behavior that Tasks 1-5 must NOT have changed — the barber-presence guard's fact boundaries and booking-execution-disabled invariant are explicitly out of scope for modification (Global Constraints), so this task is regression-proving, not new implementation.

**Files:**
- Test: `server/test/reddy-international-multilingual-regression-v01.test.js` (new)

**Interfaces:**
- Consumes: `guardRealtimeBarberFacts` from `../agents/reddy/realtimeFactGuard`, `REDDY_BOOKING_EXECUTION` from `../agents/reddy/bookingGuards`, `resolveResponseLanguage` from `../agents/reddy/languageResolution`.

- [ ] **Step 1: Write the regression tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guardRealtimeBarberFacts } = require('../agents/reddy/realtimeFactGuard');
const { REDDY_BOOKING_EXECUTION, containsProhibitedClaim } = require('../agents/reddy/bookingGuards');
const { resolveResponseLanguage } = require('../agents/reddy/languageResolution');

// ── Barber presence cross-language regression (contract tests 21-25) ──

test('Indonesian attendance claim is blocked and replaced with the verified schedule fact', () => {
  const result = guardRealtimeBarberFacts('Mas Husen ada kok, silakan datang sekarang.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    responseLanguage: 'indonesian',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /dijadwalkan masuk hari ini/);
  assert.doesNotMatch(result.sanitizedReply, /ada kok/);
});

test('English attendance claim is blocked and replaced with the same verified schedule fact (test 22)', () => {
  const result = guardRealtimeBarberFacts('Husen is here now, come on over.', {
    verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
    knownBarberNames: ['Husen'],
    responseLanguage: 'english',
  });
  assert.equal(result.triggered, true);
  assert.match(result.sanitizedReply, /scheduled to work today/);
  assert.doesNotMatch(result.sanitizedReply, /is here now/);
});

test('scheduled never becomes present, in any tested language (test 24)', () => {
  for (const [reply, responseLanguage] of [
    ['Mas Husen ada di sini sekarang.', 'indonesian'],
    ['Husen is here now.', 'english'],
  ]) {
    const result = guardRealtimeBarberFacts(reply, {
      verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
      knownBarberNames: ['Husen'],
      responseLanguage,
    });
    assert.equal(result.triggered, true);
    assert.doesNotMatch(result.sanitizedReply, /ada di sini sekarang|is here now/);
  }
});

test('scheduled never becomes available/free, in any tested language (test 25)', () => {
  for (const [reply, responseLanguage] of [
    ['Mas Husen ready kok sekarang.', 'indonesian'],
    ['Husen is free right now.', 'english'],
  ]) {
    const result = guardRealtimeBarberFacts(reply, {
      verifiedSchedule: { barberName: 'Husen', status: 'scheduled', date: '2026-08-30' },
      knownBarberNames: ['Husen'],
      responseLanguage,
    });
    assert.equal(result.triggered, true);
  }
});

// ── Booking authority regression (contract tests 26-29) ──

test('booking execution remains DISABLED (test 28)', () => {
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
});

test('no fake booking confirmation survives in Indonesian or English (test 29)', () => {
  assert.equal(containsProhibitedClaim('Sudah aku booking ya kak, slotnya aman!'), true);
  assert.equal(containsProhibitedClaim("Great news, I've already booked your slot!"), true);
});

// ── Language switching does not revive a stale booking CTA (test 33) ──

test('a language switch alone does not change booking CTA eligibility', () => {
  // resolveResponseLanguage only ever returns a language string — it has no
  // notion of booking CTA eligibility at all, so a language switch cannot,
  // by construction, revive a suppressed CTA. This test pins that contract.
  const lang = resolveResponseLanguage('Can I come tomorrow?', { turns: [{ role: 'user', content: 'Kalau CSB berapa?' }] }, {});
  assert.equal(lang, 'english');
  assert.equal(typeof lang, 'string');
  assert.equal(Object.keys({ lang }).includes('bookingCtaEligible'), false);
});
```

- [ ] **Step 2: Run the test file**

Run: `node --test server/test/reddy-international-multilingual-regression-v01.test.js`
Expected: PASS, all 7 tests green (this is the expected outcome since Tasks 1-5 did not touch `realtimeFactGuard.js`'s detection logic or `REDDY_BOOKING_EXECUTION`). If any test fails, STOP — it means an earlier task inadvertently touched fact-authority or booking-authority code, and that must be fixed before continuing, not worked around here.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/test/reddy-international-multilingual-regression-v01.test.js
git commit -m "test(reddy): lock in barber-presence and booking-authority invariants across languages"
```

---

## Task 7: Full regression sweep + fix any findings

**Files:** none pre-determined — this task's job is to run the named regression areas and fix anything that broke, citing exact file:line for any fix.

- [ ] **Step 1: Run the complete suite with verbose output**

Run: `npm test 2>&1 | tee /tmp/full-test-run.log` (or the project's actual test script from `package.json` if `npm test` isn't wired to `node --test` directly — check `package.json`'s `"test"` script first with `cat package.json | grep -A2 '"scripts"'` if unsure).

- [ ] **Step 2: Specifically confirm these named regression areas pass** (grep the log or re-run each file directly):
  - P0 anti-spam — locate via `grep -rl "anti.spam\|antispam" server/test`
  - P0.1 Fonnte normalization — `server/test/reddy-wa-live-incident-v01.test.js` and any `fonnteEnvelopeNormalizer` test
  - PR52 inbound lifecycle/conversation isolation — grep for `conversation.isolation\|inbound.lifecycle` in `server/test`
  - PR53 barber presence — `server/test/reddy-barber-presence-first-turn-guard.test.js`
  - Task14 / Task14.1 — grep for `task14` in `server/test`
  - Task15 — human handoff tests, grep for `handoff` in `server/test`
  - Task16 — grep for `task16` in `server/test`
  - Task45 — grep for `task45` in `server/test` (if not found by that name, note it as "no dedicated test file found under this name" in the final report rather than guessing)
  - PR50 closing suppression — `server/agents/reddy/closingSuppressionGuard.js`'s test, grep for `closing.suppress` in `server/test`

- [ ] **Step 3: For any failure found, fix it with the minimal targeted change and re-run that specific file before moving on.** Do not batch multiple unrelated fixes into one commit.

- [ ] **Step 4: Once everything passes, run the full suite one final time and record the pass count.**

Run: `npm test`
Expected: 100% pass, record total test count for the final report.

- [ ] **Step 5: Commit any fixes made in this task (only if fixes were needed — if the sweep was clean, skip this commit).**

```bash
git add -A
git commit -m "fix(reddy): address regressions found in full P0/PR/Task suite sweep"
```

---

## Task 8: Source audit report + final contract output

**Files:**
- Create: `docs/architecture/reddy-international-multilingual-audit-2026-08-30.md`

- [ ] **Step 1: Write the audit report**, classifying every code path from the Audit Summary section above as KEEP / REPLACE / LEGACY COMPATIBILITY / REMOVE LATER, organized under headings A (sender acceptance), B (phone normalization), C (language), D (foreign routing), E (deterministic response language) — reuse the exact file:line citations already gathered in this plan's Audit Summary section; do not re-research.

- [ ] **Step 2: Compose the 23-item contract OUTPUT block** (international sender root cause, exact trusted identity changes, accepted/rejected phone format contracts, language resolver precedence, country-code inference YES/NO, supported languages, language switching behavior, legacy foreign path status, fact authority cross-language result, booking authority result, deterministic fallback language result, files changed, migration YES/NO, production mutation YES/NO, frontend changes YES/NO, tests added, targeted results, regression results, full suite result, new HEAD SHA, pushed YES/NO, PR created YES/NO) as the final message to the user, ending with the exact required sentence: `READY FOR AIRA ACTUAL-SOURCE REVIEW — INTERNATIONAL WHATSAPP MULTILINGUAL REDDY`.

- [ ] **Step 3: Commit the audit report.**

```bash
git add docs/architecture/reddy-international-multilingual-audit-2026-08-30.md
git commit -m "docs(reddy): source audit report for international WhatsApp multilingual contract"
```

- [ ] **Step 4: Do NOT push, do NOT open a PR** — the contract explicitly says "DO NOT CREATE PR YET. DO NOT MERGE." Report the final HEAD SHA and stop.

---

## Appendix: Original Contract (verbatim, for a worker with no prior context)

See the task-launching message for the full "REDDY INTERNATIONAL WHATSAPP + MULTILINGUAL LANGUAGE CONTRACT" text — it is long (repository, branch name, 8 objectives, 33 required tests, P0 regression list, 23-item output spec) and is reproduced in the conversation that produced this plan rather than duplicated here to avoid drift between two copies. A worker executing this plan without access to that original message should ask for it before starting Task 1.
