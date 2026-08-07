# Task 5 report — CRM membership UI

Status: complete

Implemented:

- Replaced the inactive-profile workflow with paid registration records from the Task 3 registration endpoint.
- Added Pending, Active, and Expired tabs with registration code, customer identity, stored tier, stored amount, and the relevant pending or membership expiry date.
- Added an activation dialog that requires payment method, payment reference, branch, and an explicit cashier confirmation.
- Kept tier and amount read-only from the selected registration. The browser sends only payment method, payment reference, and branch; it cannot submit authoritative tier, amount, staff identity, or customer identity.
- Kept duplicate-submit protection through the processing state, retained server conflict/error messages, and only closes the dialog after a successful activation.
- Refreshes all registrations after activation so the activated record leaves Pending and appears under Active.
- Preserved the Moka sync action for active members.
- Added Next API adapters that retain the server-side admin token, disable caching for status reads, encode the registration ID, allowlist activation metadata, and return a controlled `502` when the backend is unavailable.
- Expanded the static client contract test to cover all three statuses, read-only price, explicit confirmation, refresh-after-success, authenticated proxy headers, and rejection of client-controlled activation fields.

Task 5 files:

- `frontend/src/app/admin/membership/page.tsx`
- `frontend/src/app/api/admin/crm/membership/registrations/route.ts`
- `frontend/src/app/api/admin/crm/membership/registrations/[registrationId]/activate/route.ts`
- `server/test/crm-membership-client-contract.test.js`
- `.superpowers/sdd/2026-08-08-paid-tier-membership-plan/task-5-report.md`

Verification:

- Relevant backend/client contracts: `node --test server/test/crm-membership-client-contract.test.js server/test/admin-crm-membership-activation.test.js` — 17/17 passed.
- Task 5 lint: `npx --workspace frontend eslint src/app/admin/membership/page.tsx src/app/api/admin/crm/membership/registrations/route.ts "src/app/api/admin/crm/membership/registrations/[registrationId]/activate/route.ts"` — passed with no findings.
- TypeScript: `npx --workspace frontend tsc --noEmit` — passed.
- Production frontend build: `npm --workspace frontend run build` — passed; `/admin/membership` and both new API adapter routes were generated.
- Full frontend lint was also run. It remains red because of 38 errors and 8 warnings in pre-existing, out-of-scope files such as admin bookings, barbers, customers, owner pages, and barber pages. Task 5 files produced no lint findings and those unrelated files were not modified.
- Focused `git diff --check` — passed.

Caveats:

- This task does not apply or verify the paid-membership migration/RPC or the `users` role-integrity migration in Supabase production.
- Production must set `ADMIN_SESSION_PROXY_SECRET` on both the Next frontend deployment and backend deployment. Both deployments must use the same high-entropy value, and it must differ from `ADMIN_PASSWORD`; missing or equal values now fail closed.
- The commit is local only until it is pushed and deployed.

## Fix round 1 — server-side session authorization and branch scope

Reviewer finding addressed:

- The Next adapters no longer expose the global admin proxy to every authenticated user.
- Both adapters verify the Supabase session from cookies with `createClient(cookieStore)` and `auth.getUser()`, then load the matching `users` row.
- Unauthenticated callers receive `401`; roles other than `owner` and `branch_admin` receive `403`.
- `branch_admin` activation is fixed to the branch stored in the verified profile. A different browser-supplied branch is rejected with `403`.
- Owners retain the ability to activate at a configured RedBox branch.
- The adapter signs the verified user ID, role, branch, and issue time with a short-lived HMAC assertion. The backend verifies it before listing or activating registrations.
- The new membership endpoints reject a global admin token without a verified session assertion. Activation audit now writes the verified Supabase user ID, not a browser field or `ADMIN_AUDIT_STAFF_ID`.
- Backend list results expose only unassigned Pending registrations plus the branch admin's own Active/Expired history. Owners retain the complete view.
- Added a role-integrity migration that makes `users.role` and `users.branch` read-only to browser sessions while allowing each authenticated user to read only their own profile.

Fix verification:

- Focused authorization, activation, assertion, and client contract tests: 25/25 passed.
- Full server suite: 72/72 passed.
- Task 5 ESLint: passed.
- TypeScript `tsc --noEmit`: passed.
- Production frontend build: passed, including both membership API routes.
- Node syntax checks and `git diff --check`: passed.

## Fix round 2 — mandatory dedicated session assertion secret

Reviewer finding addressed:

- Removed the `ADMIN_PASSWORD` fallback from the Next membership adapter and backend assertion verifier.
- Added a dedicated secret resolver on each side. `ADMIN_SESSION_PROXY_SECRET` is mandatory and is rejected when blank or equal to `ADMIN_PASSWORD`.
- The backend verifier now receives both configured values and fails closed before verifying an assertion when the dedicated secret is unsafe or missing.
- An assertion forged with the browser-exposed `ADMIN_PASSWORD` is rejected when the dedicated proxy secret is configured.
- Session, role, branch, and verified staff audit enforcement from fix round 1 remain unchanged.
- Updated `server/.env.example` with the mandatory deployment variable.

Fix verification:

- Focused security and client contract tests: `node --test server/test/admin-session-assertion.test.js server/test/crm-membership-client-contract.test.js` — 9/9 passed.
- Full server suite: `node --test server/test/*.test.js` — 75/75 passed.
- Task 5 ESLint: `npx --workspace frontend eslint src/app/api/admin/crm/membership/_auth.ts src/app/api/admin/crm/membership/_proxySecret.ts src/app/api/admin/crm/membership/registrations/route.ts "src/app/api/admin/crm/membership/registrations/[registrationId]/activate/route.ts"` — passed.
- TypeScript: `npx --workspace frontend tsc --noEmit` — passed.
- Production frontend build: `npm --workspace frontend run build` — passed; membership page and both secured adapter routes were generated.
- Backend syntax checks and `git diff --check` — passed.

Deployment requirement:

- Configure `ADMIN_SESSION_PROXY_SECRET` in both Vercel projects/environments that run the Next frontend adapter and the backend API.
- Use the same random high-entropy secret in both places, but never reuse `ADMIN_PASSWORD`.
- Deploy both sides together. Until the environment variable exists on both sides, the new membership admin proxy intentionally rejects access.
