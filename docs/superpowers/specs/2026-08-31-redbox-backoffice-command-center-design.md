# Redbox Backoffice — Full Product Design Spec

Status: Phase 1A shipped to production (`main`, PR #60, merged and live-verified).
This revision extends scope from "Command Center foundation" to the **complete
23-screen Backoffice product**, decomposed into workstreams A–I per owner
direction. `design_handoff_command_center/README.md` remains the visual source of
truth (priority order in §12).

## 1. What this is

**Redbox Backoffice** — the internal operating system / management cockpit for
Redbox Barbershop, at `https://backoffice.redboxbarbershop.com`. Primary users:
Owner, Manager, Admin Cabang. It consolidates and eventually replaces
`public/crm.html` and `public/admin-moka.html` (not deleted yet — §10), and
implements all 23 screens in `design_handoff_command_center/`.

Explicitly **not**: part of `www.redboxbarbershop.com`, `frontend/`
(`admin.redboxbarbershop.com`), or the Stockist app (`stockist.redboxbarbershop.com`).
Those three stay untouched throughout this build.

## 2. Deployment topology (shipped, live)

- **Vercel project**: `redbox-barbershop` (`prj_WFHLGSGUzFMqERLKINHid13Y17dc`) —
  same project as `www.redboxbarbershop.com`. Hobby plan, hard-capped at **12
  serverless functions**; already at 12 before this feature and must stay there.
- **Domain**: `backoffice.redboxbarbershop.com`, attached to `redbox-barbershop`.

### 2a. Routing architecture (final, live-verified)

```
backoffice.redboxbarbershop.com
  → vercel.json "routes": src "^/$" + has host==backoffice... → /api/index   (root only)
  → vercel.json "rewrites": src "/(.*)" + has host==backoffice... → /api/index (everything else)
  → api/index.js (existing function, reused — no 13th function)
  → server/index.js: isolated host-dispatcher middleware (first middleware in the file)
  → backoffice/dist/ (static file match, or index.html SPA fallback)
  → React Router → React app
```

Two architectures were empirically tested against the live domain (Vercel blocks
Host-header spoofing on preview URLs, so only a deployment actually aliased to
the real domain is trustworthy for this kind of test):

- **Option A (static `public/backoffice/` + rewrite to a static destination):
  REJECTED.** `/` collided with the pre-existing `public/index.html` (Vercel's
  static-file resolution wins for that path); deep routes 404'd.
- **Option B (reuse `api/index.js` via a function-destination rewrite): SHIPPED.**
  Worked for every path except the bare root `/`, which had the *same* collision
  even through a function destination — traced to `rewrites` being documented by
  Vercel as "checks the filesystem by default." Fixed with one additional
  `routes` array entry (`src: "^/$"`, host-conditioned, `dest: "/api/index"`) —
  `routes` has no such documented default and is explicitly documented to coexist
  with `rewrites`/`headers`. Live-verified: `/` now serves the Backoffice shell,
  zero regression on any other path or domain.

`server/index.js`'s dispatcher: activates only for
`req.hostname === 'backoffice.redboxbarbershop.com'` AND
`!req.path.startsWith('/api/')`; resolves against `backoffice/dist/` with
path-traversal guarding (verified against raw `../` and percent-encoded `%2e%2e`
attempts) and SPA fallback to `index.html`. Any other host or any `/api/*` path
calls `next()` immediately — zero interaction with the rest of the file.

**Build wiring**: `vercel.json` `buildCommand: "npm --workspace=backoffice run build"`
(net-new — this project ran no build command before this feature, confirmed via
production build logs); `api/index.js`'s `includeFiles` widened to
`"{server/**,backoffice/dist/**}"`.

## 3. Tech stack

Vite + React + TypeScript + Tailwind CSS v4 + React Router, `base: '/'`.
Workspace `backoffice/` in root `package.json` `workspaces`.

## 4. Auth — compatibility layer now, real RBAC later

**Shipped and live-verified** (manual browser test with the real production
credential): password → `GET /api/admin/crm/command-center` probe with the
candidate as `x-admin-token` (200 = valid, 401 = wrong, network/5xx = distinct
server-error message) → token in `sessionStorage`
(`redbox_backoffice_admin_token`) → `AuthProvider` → `ProtectedRoute`. Refresh
persists the session in-tab; logout clears it; a protected route after logout
redirects to `/login`. Labeled `TEMPORARY COMPATIBILITY AUTH` throughout — never
represented as production RBAC. No username field (backend has no username
concept). `apiClient` attaches `x-admin-token` to every request, triggers global
logout on any `401`.

**Target (not built)**: per-user login → session → role → permission → branch
scope. Roles: `manager` (broad/cross-branch), `admin` (branch-scoped). Existing
`public.users` table (`role`: `owner`/`branch_admin`/`barber`, 7 rows) is the
likely migration input — `manager` could extend `owner`, `admin` could map to a
scoped `branch_admin`. **No decision made now; do not create a second identity
system.** `Roles Permissions` screen (workstream I) shows this target
architecture as a diagram/description, explicitly labeled DEMO/PARTIAL — never
claims enforcement that doesn't exist. Client-side visibility is never
represented as server-side authorization anywhere in the product.

## 5. Data classification — full 23-screen matrix

Every screen must show its data status: LIVE, PARTIAL LIVE, DEMO, or
UNAVAILABLE. Never fabricate a field an endpoint doesn't return (use PARTIAL
LIVE instead) and never present DEMO data as real business numbers (`DemoBadge`:
"DEMO — awaiting production database").

| # | Screen | Status | Backing |
|---|---|---|---|
| 1 | Backoffice Login | LIVE | shipped, §4 |
| 2 | Command Center | LIVE / PARTIAL LIVE | audited (§8a): `owner-overview` (cross-branch today), `owner-revenue?branch=all&period=` (revenue/ATV/trend/branch compare/top barbers/top services), `/api/moka/status` (health), `membership` (client-aggregated). Inventory Snapshot is **UNAVAILABLE** — see §8a. |
| 3 | HR Employee List | DEMO | no `employees` table |
| 4 | Employee Detail | DEMO | no `employees` table |
| 5 | Attendance Overview | DEMO / PARTIAL | `barber_attendance` exists but has 2 rows — not a real source; `/api/admin/crm/attendance*` semantics don't match the intended company-wide HR attendance model |
| 6 | Fingerprint Import | DEMO | no upload/parser backend; UI prototype only, not claimed production-ready |
| 7 | Exception Review | DEMO | depends on Attendance data, same status |
| 8 | Payroll Overview | DEMO | no payroll table |
| 9 | Regular Payroll | DEMO | no salary/payroll backing |
| 10 | Barber Payroll | DEMO | **no commission-rate source — never hardcode a %, e.g. no invented 30% rule** |
| 11 | Payroll Employee Detail | DEMO | same as 8–10 |
| 12 | Stockist Inventory Dashboard | **UNAVAILABLE** (auth gap, §8a) | `/api/stockist/*` all require `req.adminAuth.sessionVerified === true` + a role — Backoffice's shared-token auth never sets these. Not a missing-field gap; a 403 wall. Deferred, not routed around — `stockist.redboxbarbershop.com` remains operational source of truth regardless |
| 13 | Reports Overview | LIVE / PARTIAL LIVE | directory + snapshot of 14–17 |
| 14 | Branch Performance | LIVE / PARTIAL LIVE | `outlets` + bookings/transactions aggregation |
| 15 | Customer Report | PARTIAL LIVE | `customers`/`bookings`; favorite barber/service need derivation |
| 16 | Membership Report | LIVE | `/api/admin/crm/membership`, `member_profiles`, `member_point_transactions` |
| 17 | Barber Performance | LIVE | `/api/admin/crm/leaderboard`, `barbers`, `moka_barber_services` — performance analytics only, never conflated with payroll commission |
| 18 | Operations | LIVE / PARTIAL LIVE | `bookings`, `schedules`, `/api/admin/crm/schedule`, booking reassign/reschedule/walkin |
| 19 | CRM Overview | LIVE | `/api/admin/crm/customers/loyal|new|dormant` |
| 20 | Customer 360 | LIVE / PARTIAL LIVE | `customers` + booking/visit history |
| 21 | Moka POS Integration | LIVE | `/api/moka/status`, `/sync-logs`, `/items`, `/map-items` |
| 22 | Roles Permissions | DEMO / PARTIAL | `users.role` has no `manager`/`admin` split yet — shows target architecture only |
| 23 | Package Feature Access | DEMO by design | product-planning screen, "Full Feature Review Mode" is the real current state |

`Locked Premium Module.dc.html` → reusable empty-state component reference only
(future entitlement gating), not a page. `Index.dc.html` → design-review
directory only, not part of the product.

## 6. Full Feature Review Mode

All 23 screens are navigable now — no production entitlement locking. §23
(Package Feature Access) documents this as a future commercial plan (Redbox
Free / Redbox Business Suite), not something currently enforced. Component
structure stays reusable for later gating; nothing is randomly locked today.

## 7. Information architecture / routing — final route map

```
/                        Command Center
/login                    Backoffice Login
/hr                       HR & People — Employee List
/hr/employees/:id         Employee Detail
/attendance                Attendance Overview
/attendance/import         Fingerprint Import
/attendance/exceptions     Exception Review
/payroll                   Payroll Overview
/payroll/regular           Regular Payroll
/payroll/barber            Barber Payroll
/payroll/employees/:id     Payroll Employee Detail
/stockist                  Stockist Inventory Dashboard
/reports                   Reports Overview
/reports/branches          Branch Performance
/reports/customers         Customer Report
/reports/membership        Membership Report
/reports/barbers           Barber Performance
/operations                 Operations
/crm                        CRM Overview
/crm/customers/:id          Customer 360
/moka                        Moka POS Integration
/system/roles                Peran & Izin
/system/packages             Akses Paket
/system/settings             Pengaturan (placeholder only — not one of the 23 designed screens; Sidebar nav item present per handoff, content stays a simple non-functional placeholder unless the handoff is later extended)
```

**Naming reconciliation from Phase 1A**: `/payroll/employee/:id` →
`/payroll/employees/:id` (pluralized) and `/membership` moves under
`/reports/membership` — both corrected in Workstream A before other workstreams
build on top of the route table.

Each screen is its own route — never collapsed into a giant multi-tab page.

Sidebar groups (unchanged from Phase 1A, shipped): (ungrouped) Command Center;
**HR & People** (HR & People, Attendance, Payroll); **Operations & Growth**
(Operations, CRM & Customer, Membership → under Reports, Stockist & Inventory,
Moka POS Integration, Reports); **System** (Peran & Izin, Akses Paket,
Pengaturan).

## 8. Workstream decomposition

Independent workstreams, delegated to parallel work only where they don't touch
the same files simultaneously and shared contracts (design tokens, reusable
components, route table) are established first in Workstream A.

- **A — Foundation** (do first, blocks everything else): route-table
  reconciliation, any new shared components needed across workstreams
  (`SectionHeader`, `DataCard`, `DataTable`, `FilterBar`, `SearchInput`,
  `PartialLiveBadge`, `LockedModule`, `Pagination`, `DetailHeader`,
  `ActivityList`, `AlertCard`, `IntegrationStatus`, `PeriodSelector` — added as
  each workstream actually needs them, not spéculatively all at once), a thin
  per-domain `services/` layer (`crm.ts`, `moka.ts`, `stockist.ts`) so
  components never call `apiClient` directly for business data.
- **B1 — Command Center** (real data — split from B2 after the data audit in §8a
  showed Operations needs its own per-branch aggregation design)
- **B2 — Operations** (needs N-branch aggregation of the branch-scoped
  `command-center` endpoint's `booking_feed`/`home_service` fields — a separate
  design decision from B1, sequenced right after it)
- **C — CRM / Customer** (CRM Overview, Customer 360, Customer Report,
  Membership Report)
- **D — Reports** (Reports Overview, Branch Performance, Barber Performance —
  Customer/Membership reports live in C to avoid splitting one data domain
  across two workstreams)
- **E — Moka / Inventory** (Moka POS Integration, Stockist Inventory Dashboard)
- **F — HR** (Employee List, Employee Detail) — DEMO
- **G — Attendance** (Overview, Fingerprint Import, Exception Review) — DEMO
- **H — Payroll** (Overview, Regular, Barber, Employee Detail) — DEMO,
  never hardcodes a commission rate
- **I — System** (Roles Permissions, Package Feature Access)

Sequencing: A must land first. B–E (LIVE-first, highest business value) before
F–H (DEMO, lower urgency, no production backing to wire up anyway). I can run
anytime after A since it has no data dependency on the others.

## 8a. Data audit findings (Workstream B1, before any code)

Audited actual endpoint implementations rather than assuming shapes from names:

- `GET /api/admin/crm/owner-overview` — no params, always cross-branch, today
  only. Returns `{ today, branches: [{slug, name, revenue_moka, tx_moka,
  revenue_web, tx_web, hadir, total_barbers, goshow, pending_bookings}],
  totals: {revenue_moka, revenue_web, tx_total, hadir, goshow, pending} }`.
- `GET /api/admin/crm/owner-revenue?branch=all&period=today|7d|30d|month` —
  returns `{ summary: {revenue_moka, revenue_web, tx_total, avg_tx},
  daily_trend: [{date, moka, web}], branch_compare: [{slug, name,
  revenue_moka, revenue_web, tx_total}], top_barbers: [{barber_id, name,
  branch, tx_count, revenue}], top_services: [{service_name, count,
  revenue}] }`.
- `GET /api/moka/status` — not gated by `adminAuth` at all (pre-existing,
  unrelated finding, not something this project introduced or needs to fix).
  Returns `{oauthConfigured, outlets: [{hasToken, tokenExpiry,
  tokenExpired}], recentLogs: [{direction, status, created_at,
  error_message}]}`.
- `GET /api/admin/crm/membership` — flat array of all member profiles
  (`user_key, full_name, membership_status: 'ACTIVE'|'INACTIVE',
  current_tier, total_points, total_visits, created_at, last_visit, ...`).
  No pre-aggregated counts — Command Center computes "active members," "new
  this month" etc. client-side from this list.
- `GET /api/admin/crm/command-center` and `GET /api/admin/crm/leaderboard` —
  **both branch-scoped**, require a `branch` query param (and `leaderboard`
  also requires `category`). Not cross-branch KPI sources; useful for
  per-branch drill-down / Operations (§8, workstream B2) instead.
- `GET /api/admin/crm/schedule` — a weekly work-day/off-day roster, not a
  bookings feed. Not what Operations needs.

**Confirmed blocker — Stockist is architecturally unreachable from Backoffice
today, not just unwired:** every `/api/stockist/*` route calls
`getVerifiedStockistAccess(req)`
(`server/services/stockistAccess.js`), which requires
`req.adminAuth.sessionVerified === true` and a role of
`owner`/`manager`/`branch_admin`. Backoffice's TEMPORARY COMPATIBILITY AUTH
(shared `x-admin-token`) sets `sessionVerified: false, role: null` in
`adminAuth` (`server/index.js`) — every Stockist call gets a 403 regardless of
how the frontend is built. **Decision (owner, this session): mark
UNAVAILABLE, do not modify `getVerifiedStockistAccess` or the auth model to
route around it.** Command Center's Inventory Snapshot and the whole Stockist
Inventory Dashboard screen (workstream E) show an honest UNAVAILABLE state.
Revisiting this is its own explicitly-scoped decision for later, not a silent
workaround now.

## 9. Reusable component system

```
components/  Sidebar, PageHeader, SectionHeader, StatCard, KPIComparison,
             StatusBadge, DemoBadge, LiveBadge, PartialLiveBadge, DataTable,
             FilterBar, SearchInput, EmptyState, LoadingState, ErrorState,
             PermissionDenied, LockedModule, Pagination, DetailHeader,
             ActivityList, AlertCard, IntegrationStatus, PeriodSelector
layouts/     BackofficeLayout
auth/        AuthProvider, ProtectedRoute, PermissionGuard
lib/         apiClient
services/    crm, moka, stockist  (thin wrappers; components never fetch directly)
pages/       one file per screen (23), each importing shared components
```

Shipped in Phase 1A: `Sidebar`, `PageHeader`, `StatCard`, `StatusBadge`,
`DemoBadge`, `LiveBadge`, `EmptyState`, `LoadingState`, `ErrorState`,
`PermissionDenied`, `BackofficeLayout`, `AuthProvider`, `ProtectedRoute`,
`PermissionGuard`, `apiClient`. Everything else in the list above is added when
the workstream that needs it starts — not scaffolded ahead of use.

## 10. Legacy pages

`public/crm.html` and `public/admin-moka.html` stay until their Backoffice
replacements (CRM Overview/Customer 360/Command Center for the former; Moka POS
Integration/Command Center Moka health card for the latter) reach documented
feature parity, pass live verification, and a reviewer explicitly authorizes
retirement. Track parity per legacy page as: NOT READY FOR RETIREMENT / PARTIAL
PARITY / FEATURE PARITY READY FOR REVIEW — only the reviewer decides retirement.

## 11. Do not touch

`frontend/`, `admin.redboxbarbershop.com`, `stockist.redboxbarbershop.com`
(operational inventory source of truth — Backoffice's Stockist screen is
read/monitor/analyze only, never a second inventory truth, never implements
stock-opname/adjustment/receiving/transfer actions), public booking flow,
customer-facing site, WhatsApp Reddy, cron jobs, Moka sync logic, booking
backend, existing Supabase business tables. No production schema migration to
make a screen look complete — HR/payroll/attendance tables require a separate,
explicit design decision, not silent creation during this build.

## 12. Design fidelity

Priority when sources conflict: (1) `design_handoff_command_center/README.md`,
(2) `.dc.html` screens, (3) `CLAUDE_CODE_PROMPT.md` (screen list/ordering/
shared-component guidance only — its build-location instruction is superseded),
(4) this spec, (5) existing Backoffice conventions. Reconstruct `.dc.html` as
real React + Tailwind components, never copied as raw inline-style HTML.
Preserve: layout hierarchy, sidebar rhythm, typography, spacing, card sizes,
section order, badge styles, table/list density, contextual actions, empty
states, responsive behavior. A route rendering is not "done" — compare each
screen against its `.dc.html` before calling it complete (checklist in the
implementation plan).

## 13. Backend change policy

Reuse existing API contracts first (full endpoint inventory: `/api/admin/crm/*`,
`/api/moka/*`, `/api/stockist/*` — see workstream-specific audits in the
implementation plan for exact fields used per screen). If a screen needs backend
capability that doesn't exist: classify that section PARTIAL LIVE/DEMO/
UNAVAILABLE and continue — do not silently modify an existing endpoint's
semantics. A small, additive, read-only new endpoint may be proposed with
documented business requirement / missing field / affected consumers / migration
risk, but requires explicit sign-off before implementation, same as any schema
change.

## 14. Production safety checklist (every workstream, before merge)

- `npm --workspace=backoffice run build` succeeds
- Full `npm test` suite: no new failures beyond the 24 pre-existing/unrelated
  ones already documented (verified via `git stash` A/B in Phase 1A)
- Serverless function count stays at exactly 12
- `www.redboxbarbershop.com`, `redboxbarbershop.com`, `admin.redboxbarbershop.com`,
  `stockist.redboxbarbershop.com` unaffected
- `/crm.html`, `/admin-moka.html` still present
- Preview deployment tested live before merge — never validate uncertain
  routing/architecture directly against production

## 15. Git discipline

Dedicated branch per workstream (or a shared `feat/backoffice-full-product`
branch with one commit per workstream — decided in the implementation plan),
never directly on `main`. No unrelated repository clutter in commits. Each
workstream's diff independently reviewable.
