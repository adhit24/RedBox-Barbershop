# Task 2 Report — Public Membership Registration API

## Status

Implemented and committed as `508552b`:

`feat: add paid membership registration endpoint`

## Files changed

- `server/routes/adminCrm.js`
  - Added the public registration route handler.
  - Added canonical phone normalization, active-membership conflict handling, pending-registration deduplication, inactive profile/customer creation, fixed price snapshots, and seven-day expiry.
  - Existing admin activation route and atomic RPC delegation were preserved.
- `server/services/membershipRegistration.js`
  - Added the non-sensitive public registration response mapper.
- `server/index.js`
  - Mounted the public route at `/api/membership/registrations`.
- `server/test/admin-crm-membership.test.js`
  - Added endpoint contract tests for creation, validation, invalid tier, pending deduplication, active conflict, and inactive profile state.

## Test-first evidence

Before implementation:

```text
node --test server/test/admin-crm-membership.test.js
Result: 5 failed, 0 passed; endpoint returned 404 because the route was not implemented.
```

After implementation:

```text
node --test server/test/admin-crm-membership.test.js
Result: 5 passed, 0 failed
```

Focused regression suite:

```text
node --test server/test/admin-crm-membership*.test.js server/test/membership*.test.js
Result: 28 passed, 0 failed
```

Full server test suite:

```text
node --test server/test/*.test.js
Result: 40 passed, 0 failed, 0 cancelled
```

Syntax and diff checks:

```text
node --check server/routes/adminCrm.js
node --check server/services/membershipRegistration.js
node --check server/index.js
git diff --check
Result: all commands passed with no errors
```

## Concerns

- Registration profile/customer creation and registration insertion are separate writes; a database failure between them could leave partial setup. Task 2 does not introduce a registration RPC, while activation remains protected by the existing atomic RPC and target/expiry safeguards.
- Existing pending deduplication is application-level lookup plus insert. A future migration could add a database uniqueness policy for non-expired pending rows if concurrent public submissions become a material risk.
- The pre-existing unrelated worktree changes were preserved and excluded from commit: `claude-skills` plus two CSV files under `Transaksi`.

---

# Fix Round 1 — Important Review Findings

## Status

All six Important findings were fixed locally. The public route now delegates identity resolution, Pending deduplication, and all three writes to one PostgreSQL transaction. Prices, seven-day Pending expiry, manual cashier activation, and one-year activation validity remain unchanged.

## Fixes

- Added `create_membership_registration(...)` RPC with a per-canonical-phone transaction advisory lock.
- Added a unique partial index for one `PENDING` row per canonical phone+tier; expired rows are transitioned before insert and an existing non-expired row keeps its original price snapshot.
- Resolved legacy `member_profiles.phone`, `customers.phone_e164`, and `customers.wa` values through database canonical normalization without rewriting those records or creating duplicate identities.
- Moved customer, profile, and registration creation into the single RPC so PostgreSQL rolls all writes back on failure.
- Added unauthenticated fixed-window rate limits per IP (10/minute) and per canonical phone (3/minute), with `429`, `Retry-After`, and no RPC/write on rejected requests.
- Restricted accepted phone inputs to Indonesian mobile formats that canonicalize to `+628...` with valid domestic length; added canonical-variant, short, foreign, landline, malformed, and overlong coverage.
- Routed legacy `userKey` cashier activation through the same registration RPC before the existing atomic activation RPC, avoiding conflicts with the new Pending uniqueness guard.

## Test evidence

Focused Task 2/activation suite:

```text
node --test server/test/admin-crm-membership.test.js server/test/admin-crm-membership-activation.test.js server/test/membership-registration.test.js server/test/membership-activation-contract.test.js
Result: 30 passed, 0 failed
```

Full server suite:

```text
node --test server/test/*.test.js
Result: 48 passed, 0 failed, 0 cancelled
```

Syntax and diff checks:

```text
node --check server/routes/adminCrm.js
node --check server/services/membershipRegistration.js
node --check server/index.js
git diff --check
Result: passed
```

Count correction: the original post-implementation endpoint file contained 6 tests, so the earlier `5 passed, 0 failed` statement was incomplete. This fix round replaces that evidence with the exact current counts above.

## Migration concerns

- Per request, no live Supabase migration check was performed. The migration has static contract coverage but must be applied before deploying the RPC-based route; otherwise the endpoint will fail because `create_membership_registration` is unavailable.
- On migration, expired Pending rows become `EXPIRED`; if historical concurrent duplicates exist for one canonical phone+tier, the oldest live row is retained and later duplicates become `CANCELLED` before the unique index is created.
- Rate limiting follows the existing in-memory convention and is instance-local; counters reset on restart and are not shared across multiple server instances.
- Unrelated pre-existing `claude-skills` and `Transaksi/*.csv` changes remain untouched and excluded.
