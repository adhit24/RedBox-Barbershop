# Paid Tier Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a paid-tier membership registration flow where customers choose Silver, Gold, or Platinum online and staff activate the paid registration from the RedBox CRM for one year.

**Architecture:** Add a `membership_registrations` workflow table for pending registrations, extend membership audit data for payment and validity periods, expose public registration and admin activation APIs, and update the existing `frontend/src/app/admin/membership/page.tsx` CRM screen. Keep `member_profiles` as the active-member source of truth and `customers` as the synchronized CRM customer record. Use one database function for atomic activation so a payment audit row and active profile cannot diverge.

**Tech Stack:** Supabase/PostgreSQL, Express routes in `server/routes/adminCrm.js`, Next.js/React admin UI, existing static `membership.html` plus a focused registration page/script, Node built-in test runner.

## Global Constraints

- Tier prices are Silver Rp100.000, Gold Rp250.000, and Platinum Rp1.500.000.
- Membership validity is one year from activation.
- Payment is made at the outlet and activation is manual through `crm.html`.
- Customers select their tier online before visiting the outlet.
- Existing members keep their old validity period; renewal uses the new paid-tier flow.
- Upgrade while active requires full payment and starts a new one-year period.
- Payment method, payment reference, branch, and staff must be auditable.
- A pending registration does not grant active-member benefits.
- Existing unrelated worktree changes must not be staged or modified.

---

## File Map

- Create: `server/migrations/2026-08-08-paid-membership-registration.sql` — schema, constraints, indexes, and atomic activation function.
- Create: `server/services/membershipRegistration.js` — tier catalog, normalization, expiry calculations, and registration/activation helpers.
- Modify: `server/routes/adminCrm.js` — public registration endpoint, pending/active/expired admin reads, and admin activation endpoint.
- Modify: `frontend/src/app/admin/membership/page.tsx` — Pending/Active/Expired CRM tabs, registration details, payment reference, branch, and activation UX.
- Modify: `membership.html` — route tier CTAs to the registration page and replace copy that promises immediate activation.
- Create: `member-register.html` — customer-facing registration form with tier selection and pending-registration confirmation.
- Create: `js/member-registration.js` — form validation, API submission, and confirmation rendering.
- Create: `server/test/membership-registration.test.js` — unit tests for tier, status, expiry, duplicate, and payment validation rules.
- Modify: `server/test/admin-crm-membership.test.js` or create it if absent — endpoint contract tests using mocked Supabase dependencies.

## Interfaces

Public registration:

```text
POST /api/membership/registrations
Body: { fullName: string, phone: string, email?: string, tier: 'silver'|'gold'|'platinum' }
Response 201: {
  registrationId: string,
  registrationCode: string,
  tier: string,
  amount: number,
  status: 'PENDING',
  expiresAt: string
}
```

Admin registration list:

```text
GET /api/admin/crm/membership/registrations?status=pending|active|expired|all
Response 200: Registration[]
```

Admin activation:

```text
POST /api/admin/crm/membership/registrations/:id/activate
Body: { paymentMethod: 'cash'|'qris'|'transfer', paymentReference: string, branch: string }
Response 200: {
  success: true,
  registrationId: string,
  activationId: string,
  tier: string,
  amount: number,
  startsAt: string,
  expiresAt: string
}
```

The server derives the authenticated staff identity from existing `adminAuth`; the client never submits an authoritative staff identity.

---

### Task 1: Add registration and activation persistence

**Files:**
- Create: `server/migrations/2026-08-08-paid-membership-registration.sql`
- Test: `server/test/membership-registration.test.js`

**Interfaces:**
- Produces table `membership_registrations` with `registration_code`, `user_key`, customer snapshot fields, `tier`, `price_snapshot`, `status`, `expires_at`, and timestamps.
- Produces activation columns on `member_activations`: `registration_id`, `payment_reference`, `branch`, `starts_at`, `expires_at`, and `activated_at`.
- Produces membership period columns on `member_profiles`: `membership_started_at` and `membership_expires_at`.
- Produces database function `activate_membership_registration(...)` that atomically locks a Pending registration, validates the snapshot price and payment metadata, inserts the activation audit row, updates `member_profiles` and `customers`, and marks the registration `ACTIVATED`.

- [ ] **Step 1: Write failing unit tests for the domain rules.**

  Cover exactly these cases:

  ```js
  test('tier catalog returns the fixed price for each paid tier');
  test('registration defaults to PENDING and expires seven days later');
  test('activation period ends one year after its start date');
  test('invalid tier and invalid payment method are rejected');
  test('blank payment reference is rejected for cashier activation');
  test('active duplicate membership is rejected');
  ```

- [ ] **Step 2: Run the focused test and verify it fails for missing domain helpers.**

  Run:

  ```powershell
  node --test server/test/membership-registration.test.js
  ```

  Expected: FAIL because the new registration helpers do not exist yet.

- [ ] **Step 3: Create the migration.**

  Use PostgreSQL checks for the fixed tier/status/payment values, a unique `registration_code`, indexes for `status`, `phone`, and `expires_at`, and a unique partial index preventing more than one active registration/profile for the same normalized phone. Preserve existing member data and do not rewrite historical activation records.

- [ ] **Step 4: Add the smallest domain helper implementation.**

  In `server/services/membershipRegistration.js`, export:

  ```js
  const TIER_PRICES = Object.freeze({ silver: 100000, gold: 250000, platinum: 1500000 });
  function getTierPrice(tier) {}
  function makePendingRegistration({ now, ... }) {}
  function getMembershipPeriod(start) {}
  function validateActivationInput({ tier, amount, paymentMethod, paymentReference }) {}
  module.exports = { TIER_PRICES, getTierPrice, makePendingRegistration, getMembershipPeriod, validateActivationInput };
  ```

  `getMembershipPeriod(start)` must return ISO `startsAt` and `expiresAt`, with the expiry representing the same calendar date one year later and an exclusive end boundary documented in the helper.

- [ ] **Step 5: Run the focused tests and verify they pass.**

  Run the same `node --test` command. Expected: all domain-rule tests PASS.

- [ ] **Step 6: Commit the persistence and domain foundation.**

  ```powershell
  git add server/migrations/2026-08-08-paid-membership-registration.sql server/services/membershipRegistration.js server/test/membership-registration.test.js
  git commit -m "feat: add paid membership registration model"
  ```

### Task 2: Implement public registration API

**Files:**
- Modify: `server/routes/adminCrm.js` or the project’s public membership route registration point.
- Modify: `server/services/membershipRegistration.js`.
- Test: `server/test/admin-crm-membership.test.js`.

**Interfaces:**
- Consumes the domain helpers from Task 1.
- Produces `POST /api/membership/registrations` with the public response contract above.

- [ ] **Step 1: Write endpoint contract tests.**

  Test that the endpoint:

  ```js
  test('creates a pending registration with a price snapshot');
  test('rejects missing name or invalid phone');
  test('rejects invalid tier without writing a row');
  test('returns an existing pending registration for the same phone and tier instead of duplicating it');
  test('does not mark the member profile ACTIVE');
  ```

- [ ] **Step 2: Run the endpoint tests and verify failure.**

  ```powershell
  node --test server/test/admin-crm-membership.test.js
  ```

  Expected: FAIL because the route is not implemented.

- [ ] **Step 3: Implement registration normalization and creation.**

  Normalize Indonesian phone numbers to the same `+62...`/digits convention already used by `adminCrm.js`. Resolve an existing profile/customer by normalized phone; otherwise create the minimum inactive profile needed for the member login flow. Insert `PENDING` with the fixed price snapshot and a seven-day expiry. Return a non-sensitive registration code; never return credentials or payment secrets.

- [ ] **Step 4: Add explicit duplicate handling.**

  If the phone already has an active membership, return a conflict response containing the current tier and expiry. If it has a non-expired Pending registration for the same tier, return that registration rather than creating a second one.

- [ ] **Step 5: Run the endpoint tests and verify success.**

  Run the focused test command and expect all registration endpoint tests PASS.

- [ ] **Step 6: Commit the public API.**

  ```powershell
  git add server/routes/adminCrm.js server/services/membershipRegistration.js server/test/admin-crm-membership.test.js
  git commit -m "feat: add paid membership registration endpoint"
  ```

### Task 3: Implement atomic CRM activation and status views

**Files:**
- Modify: `server/routes/adminCrm.js`.
- Modify: `server/services/membershipRegistration.js` if route adapter logic is needed.
- Test: `server/test/admin-crm-membership.test.js`.

**Interfaces:**
- Consumes `GET /api/admin/crm/membership/registrations` and `POST /api/admin/crm/membership/registrations/:id/activate` contracts.
- Produces activation response with activation ID, tier, amount, start, and expiry dates.

- [ ] **Step 1: Add failing tests for Pending/Active/Expired views.**

  Verify the admin list maps statuses correctly and includes payment/tier/period fields needed by CRM.

- [ ] **Step 2: Add failing activation tests.**

  Cover:

  ```js
  test('activates a pending registration with the stored price, not a client price');
  test('requires payment method, reference, and branch');
  test('rejects a second activation of the same registration');
  test('rejects activation when an active membership already exists');
  test('returns the new one-year period');
  test('does not activate when the atomic database function fails');
  ```

- [ ] **Step 3: Run the tests and verify failure.**

  ```powershell
  node --test server/test/admin-crm-membership.test.js
  ```

- [ ] **Step 4: Implement the admin list route.**

  Read registrations joined/matched to `member_profiles` by `user_key` or normalized phone. Derive `pending`, `active`, and `expired` views from registration/profile validity dates. Preserve the current legacy member list endpoint only where existing CRM consumers still need it.

- [ ] **Step 5: Implement the activation route through the database function.**

  Validate required request fields, invoke `activate_membership_registration` with the registration ID, payment metadata, branch, and authenticated staff identity, then return the database result. The server must derive tier and amount from the stored registration snapshot. Do not perform separate client-controlled `member_activations` and profile writes.

- [ ] **Step 6: Run all focused API tests and verify success.**

  ```powershell
  node --test server/test/admin-crm-membership.test.js server/test/membership-registration.test.js
  ```

- [ ] **Step 7: Commit the API and activation workflow.**

  ```powershell
  git add server/routes/adminCrm.js server/services/membershipRegistration.js server/test/admin-crm-membership.test.js
  git commit -m "feat: activate paid memberships from CRM"
  ```

### Task 4: Build the customer registration experience

**Files:**
- Create: `member-register.html`.
- Create: `js/member-registration.js`.
- Modify: `membership.html`.
- Test: `server/test/member-registration-page.test.js`.

**Interfaces:**
- Consumes `POST /api/membership/registrations`.
- Produces a mobile-friendly form and confirmation state with registration code, tier, amount, outlet payment instruction, and seven-day deadline.

- [ ] **Step 1: Write static-page tests.**

  Assert that the registration page contains fields for name, WhatsApp, email, tier, a submit button, and a clear “bayar di outlet; belum aktif sebelum kasir mengonfirmasi” message. Assert that each existing tier CTA links to the registration page with the correct tier query parameter.

- [ ] **Step 2: Run the page tests and verify failure.**

  ```powershell
  node --test server/test/member-registration-page.test.js
  ```

- [ ] **Step 3: Implement `member-register.html`.**

  Render Silver, Gold, and Platinum as selectable cards using the fixed prices. Preselect `?tier=` when present. Keep the form concise and mobile-first. Do not show “langsung aktif”; state that activation occurs at the outlet after payment.

- [ ] **Step 4: Implement `js/member-registration.js`.**

  Validate required fields, normalize phone input for submission, submit once with a disabled button, display API validation/conflict errors, and show the registration code on success. Never store payment data in the browser.

- [ ] **Step 5: Update `membership.html` copy and CTAs.**

  Replace old copy that says the account is immediately active. Link each tier CTA to `member-register.html?tier=<tier>` and explain the three-step flow: pilih tier, bayar di outlet, aktivasi oleh kasir.

- [ ] **Step 6: Run page tests and manually verify mobile layout.**

  ```powershell
  node --test server/test/member-registration-page.test.js
  ```

  Verify Silver, Gold, and Platinum preselection and the confirmation message at a 440px viewport.

- [ ] **Step 7: Commit the public UI.**

  ```powershell
  git add member-register.html js/member-registration.js membership.html server/test/member-registration-page.test.js
  git commit -m "feat: add paid membership registration page"
  ```

### Task 5: Update CRM Membership UI

**Files:**
- Modify: `frontend/src/app/admin/membership/page.tsx`.
- Test: `frontend/src/app/admin/membership/page.test.tsx`.

**Interfaces:**
- Consumes the registration list and activation endpoints from Task 3.
- Produces Pending/Active/Expired tabs and an activation form requiring payment method, payment reference, branch, and confirmation.

- [ ] **Step 1: Add failing UI tests.**

  Test that:

  ```text
  Pending tab shows registration code, customer, tier, price, and expiry.
  Activation modal requires payment reference and branch.
  The amount is read-only from the selected registration.
  Successful activation refreshes the list and moves the record to Active.
  Active rows show tier and membership expiry.
  Expired rows remain visible for history.
  ```

- [ ] **Step 2: Run the frontend tests and verify failure.**

  Run the frontend package’s explicit checks:

  ```powershell
  npm run lint --prefix frontend
  npm run build --prefix frontend
  ```

  If no frontend test runner exists, use the static contract test from Task 4 for the registration page and treat the lint/build commands as the UI verification gate.

- [ ] **Step 3: Replace the current inactive-member list behavior.**

  Load registration statuses from the new admin endpoint. Keep the existing Moka sync action for Active members, but do not treat every inactive `member_profiles` row as a pending paid registration.

- [ ] **Step 4: Build the activation modal.**

  Display the stored tier and price as read-only. Require payment method, payment reference, and branch. Send only the registration ID and payment metadata; do not allow the client to choose the authoritative amount or staff identity.

- [ ] **Step 5: Add loading, duplicate-submit protection, conflict, and error states.**

  Show the server’s current active membership conflict and do not close the modal unless the activation response succeeds.

- [ ] **Step 6: Run UI/build verification.**

  Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`, then run the focused membership tests.

- [ ] **Step 7: Commit the CRM UI.**

  ```powershell
  git add frontend/src/app/admin/membership/page.tsx frontend/src/app/admin/membership/page.test.tsx
  git commit -m "feat: add pending paid memberships to CRM"
  ```

### Task 6: Add expiry, renewal, and upgrade handling

**Files:**
- Modify: `server/services/membershipRegistration.js`.
- Modify: `server/routes/adminCrm.js`.
- Modify: `frontend/src/app/admin/membership/page.tsx`.
- Test: `server/test/membership-registration.test.js`.

**Interfaces:**
- Consumes the same registration and activation state model.
- Produces deterministic `EXPIRED` registration/profile views and full-price renewal/upgrade behavior.

- [ ] **Step 1: Add failing tests for lifecycle rules.**

  Test that pending registrations expire after seven days, expired memberships remain queryable, renewal creates a new activation period, upgrade charges the full destination-tier price, and old activation history remains unchanged.

- [ ] **Step 2: Run the lifecycle tests and verify failure.**

  ```powershell
  node --test server/test/membership-registration.test.js
  ```

- [ ] **Step 3: Implement deterministic status derivation.**

  Use `membership_expires_at` for active/expired display. Do not silently delete rows. Add an idempotent `expirePendingMembershipRegistrations(now)` service operation and call it at the start of `GET /api/admin/crm/membership/registrations`; it must only mark stale Pending registrations `EXPIRED` and must not touch active membership history. No new background scheduler is required for the first release.

- [ ] **Step 4: Add CRM actions for renewal/upgrade.**

  Renewal of an expired member starts a new Pending registration. Upgrade of an active member requires a new full-price registration and, after activation, starts a new one-year period. Existing activation rows remain immutable.

- [ ] **Step 5: Run lifecycle tests and verify success.**

  Run the focused membership test suite and expect all lifecycle cases PASS.

- [ ] **Step 6: Commit lifecycle behavior.**

  ```powershell
  git add server/services/membershipRegistration.js server/routes/adminCrm.js frontend/src/app/admin/membership/page.tsx server/test/membership-registration.test.js
  git commit -m "feat: add membership expiry renewal and upgrade rules"
  ```

### Task 7: End-to-end verification and production handoff

**Files:**
- Test/update only files required by failures from Tasks 1–6.
- Do not stage unrelated existing changes: `server/index.js`, `server/routes/adminCrm.js` changes unrelated to this feature, `claude-skills`, transaction CSVs, or unrelated membership policy work.

- [ ] **Step 1: Run the complete focused test set.**

  ```powershell
  node --test server/test/membership-registration.test.js server/test/admin-crm-membership.test.js server/test/member-registration-page.test.js server/test/member-dashboard-menu.test.js
  ```

- [ ] **Step 2: Run frontend lint/typecheck/build.**

  Use the package-local command defined in the frontend package manifest and record whether each command passes.

- [ ] **Step 3: Verify database migration in a non-production Supabase environment.**

  Check constraints, indexes, the activation function, and rollback behavior for invalid payment metadata before production use.

- [ ] **Step 4: Perform browser acceptance checks.**

  Verify customer registration for each tier, duplicate-phone handling, Pending confirmation, CRM activation, Active display, one-year expiry, and expired history at desktop and mobile widths.

- [ ] **Step 5: Verify production boundaries.**

  Confirm the deployed commit, public registration URL, CRM endpoint response, and database migration status separately. Do not report payment completion based only on an HTTP request; verify the activation audit record and profile state.

- [ ] **Step 6: Create a final focused commit if verification fixes are needed.**

  Keep the commit limited to this feature and run `git status --short` to confirm unrelated worktree changes remain untouched.
