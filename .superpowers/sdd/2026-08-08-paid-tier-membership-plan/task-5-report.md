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

- This task does not apply or verify the paid-membership migration/RPC in Supabase production.
- Per-person activation audit still depends on the backend authentication design and `ADMIN_AUDIT_STAFF_ID`; the browser session display is informational and is never accepted as the authoritative staff identity.
- The commit is local only until it is pushed and deployed.
