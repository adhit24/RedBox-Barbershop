# Task 1 Implementation Report

Status: DONE_WITH_CONCERNS

## Scope implemented

- Added the `membership_registrations` PostgreSQL table with customer snapshot fields, fixed tier/price/status checks, timestamps, and indexes for status, phone, and expiry.
- Added registration/activation persistence columns to `member_activations` and membership period columns to `member_profiles` using `ADD COLUMN IF NOT EXISTS`.
- Added partial uniqueness protection for activated registrations and active member profiles by phone.
- Added the atomic `activate_membership_registration(...)` PostgreSQL function. It locks a pending registration, validates the stored tier price and cashier payment metadata, rejects an active duplicate, writes the activation audit row, updates the profile/customer state, and marks the registration activated.
- Added the minimal domain helper module for tier prices, seven-day pending registration expiry, one-year membership periods, and activation input validation.
- Added exactly the six requested domain-rule tests.

## Changed files

- `server/migrations/2026-08-08-paid-membership-registration.sql`
- `server/services/membershipRegistration.js`
- `server/test/membership-registration.test.js`

## Tests

Initial TDD command:

```text
node --test server/test/membership-registration.test.js
```

Result: expected failure because `server/services/membershipRegistration.js` did not exist (`MODULE_NOT_FOUND`).

Final focused command:

```text
node --test server/test/membership-registration.test.js
```

Result: PASS — 6 tests passed, 0 failed, 0 skipped.

Also ran `git diff --check` and `git diff --cached --check`; both passed.

## Commit

`bd83c64` — `feat: add paid membership registration model`

## Concerns

- The migration was not executed against a live/non-production Supabase database in this task, so PostgreSQL execution and compatibility with the deployed member table definitions remain deployment-time verification items.
- The migration assumes the existing production schema includes the fields already used by the repository (`member_activations.id/user_key/amount/payment_method/status/confirmed_by`, `member_profiles.user_key/phone/current_tier/updated_at`, and `customers.phone_e164/updated_at`).
- Existing unrelated worktree changes remain untouched and were not staged or committed.

---

# Task 1 Fix Round 1 Report

Status: COMPLETE_WITH_DEPLOYMENT_CONCERNS

## Review findings fixed

- Membership validity is now an exclusive one-year period wherever server-side membership state is synced, returned to the member, listed in CRM, or used as an active-member filter. An expired or undated `ACTIVE` record resolves to `INACTIVE` and does not retain benefits.
- `activate_membership_registration(...)` rejects a pending registration at or after `expires_at` before any activation write.
- CRM activation now validates payment data, persists a pending registration for the legacy `userKey` caller, then invokes only `activate_membership_registration(...)`. It no longer writes `member_activations` or `member_profiles` directly.
- Payment methods are constrained to `cash`, `qris`, and `transfer` by both the server endpoint and a new-write PostgreSQL check constraint.
- Registration phone variants are canonicalized to Indonesian E.164 form, constrained at the table boundary, and deduplicated using canonical-phone indexes.
- Atomic activation locks and verifies its matching `member_profiles` and `customers` targets, checks affected-row counts, and only then marks the registration activated. Missing or failed targets roll back the whole transaction.

## Files changed

- `server/migrations/2026-08-08-paid-membership-registration.sql`
- `server/services/membershipRegistration.js`
- `server/membership-policy.js`
- `server/routes/adminCrm.js`
- `server/index.js`
- `server/moka/routes.js`
- `server/services/reengagement.js`
- `server/test/membership-registration.test.js`
- `server/test/membership-sync-policy.test.js`
- `server/test/membership-activation-contract.test.js`
- `server/test/membership-active-filters.test.js`
- `server/test/admin-crm-membership-activation.test.js`

## Tests and verification

```text
node --test server/test/*.test.js
```

Result: PASS — 26 tests passed, 0 failed, 0 skipped.

Focused coverage includes expiry regression handling, active-member filter contracts, registration expiry rejection, missing profile/customer safeguards, payment boundary validation, format-variant phone canonicalization, and both registration-id and legacy-userKey CRM activation flows.

```text
node --check server/routes/adminCrm.js
node --check server/index.js
node --check server/membership-policy.js
node --check server/services/membershipRegistration.js
node --check server/moka/routes.js
node --check server/services/reengagement.js
git diff --check
```

Result: PASS.

## Concerns

- The SQL migration has not been run against Supabase in this task. Its `NOT VALID` constraints enforce future writes without rejecting historical records, but deployment must verify the existing schema and data compatibility.
- The existing later-task CRM UI currently does not send `paymentReference`; this server fix deliberately requires it for cashier audit integrity. The API retains `userKey` compatibility but the later UI work must supply `paymentReference` (or a `registrationId`) before production activation can succeed.
- Existing active membership records without a valid `membership_expires_at` are intentionally treated as inactive. This prevents indefinite benefits, but any legitimate legacy entitlement needs an explicit expiry backfill before deployment.
