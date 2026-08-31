# Redbox Backoffice Command Center — Design Spec

Status: Phase 1A implementation in progress (Option B architecture, approved after
Option A was empirically rejected — see §2a). Source of truth for scope questions
during build; `design_handoff_command_center/README.md` remains the visual source
of truth (see priority order below).

## 1. What this is

A new, standalone internal app — **Redbox Backoffice** — served at
`https://backoffice.redboxbarbershop.com`. It consolidates and replaces the
functionality currently split across `public/crm.html` and `public/admin-moka.html`
(not deleted yet — see §10), and implements the 23-screen design in
`design_handoff_command_center/`.

It is explicitly **not**:
- part of the public marketing/booking site (`www.redboxbarbershop.com`)
- part of the existing Next.js admin app (`frontend/`, served at
  `admin.redboxbarbershop.com`)
- part of the Stockist app (`stockist.redboxbarbershop.com`)

Those three stay untouched.

## 2. Deployment topology

- **Vercel project**: existing `redbox-barbershop` (project id
  `prj_WFHLGSGUzFMqERLKINHid13Y17dc`) — the same project that owns
  `www.redboxbarbershop.com` / `redboxbarbershop.com`. Not the `redbox-frontend`
  Next.js project.
- **Domain**: `backoffice.redboxbarbershop.com`, attached to `redbox-barbershop`.
- **Plan constraint**: this project is on Vercel's **Hobby plan**, hard-capped at
  **12 serverless functions per deployment** — and was already sitting at exactly
  12 before this feature. A dedicated new function (`api/backoffice.js`) is not an
  option without either exceeding the cap (build fails outright — confirmed
  empirically) or upgrading the plan, which was explicitly ruled out.

### 2a. Routing architecture — empirically tested, Option A rejected

Two architectures were evaluated by deploying real, minimal, isolated commits and
testing against the actual bound domain (necessary because Vercel blocks
Host-header spoofing against preview URLs with `X-Vercel-Mitigated: deny`, and
preview `.vercel.app` URLs are separately gated by Vercel Authentication/SSO on
this project — so only a deployment actually aliased to
`backoffice.redboxbarbershop.com` can be trusted for this test).

**Option A — static bundle under `public/backoffice/` + host-conditioned rewrite
to a static destination.** Tested by aliasing a real preview deployment to the
production domain. Result: **REJECTED**.
- `/` was captured by the pre-existing `public/index.html` (Vercel's static-file
  resolution won over the rewrite for that specific colliding path).
- `/hr`, `/attendance`, `/payroll/barber` (no colliding static file) returned a
  platform 404 instead of falling back to `/backoffice/index.html` — the rewrite
  did not resolve a static-file destination the way it does for Next.js/framework
  projects.
- `/api/*` and all other subdomains were unaffected in both cases (this part
  worked correctly under both options).

**Option B — reuse the existing `api/index.js` → `server/index.js` function, with
a narrowly-scoped early-exit host dispatcher.** Approved and implemented. Unlike
Option A, the rewrite destination is a **function** (`/api/index`), not a static
file path, so there is no collision with `public/index.html` — the request reaches
Express, where a dedicated middleware (added as the very first middleware, before
helmet/cors/json-parsing/logging/the pre-existing `express.static(repo root)` dev
convenience) checks `req.hostname === 'backoffice.redboxbarbershop.com'` and
`!req.path.startsWith('/api/')`; if both hold, it resolves the request against
`backoffice/dist/` (serving a matching built file, or `index.html` as the SPA
fallback for client-side routes), with path-traversal guarding. Any other host, or
any `/api/*` path even on this host, calls `next()` immediately and the rest of
the file behaves exactly as it did before this change. Verified locally (raw
`http.request` with a spoofed `Host` header, since Node's `fetch` silently
ignores a manually-set `Host` header) against `/`, `/hr`, `/payroll/barber`,
built JS/CSS assets, `/api/health`, and both raw (`../`) and percent-encoded
(`%2e%2e`) traversal attempts — all resolved correctly and safely. Function count
stays at exactly 12 (no new file under `api/`).

**Build wiring**: `vercel.json` gets a top-level `buildCommand` (this project
previously ran no build command at all — confirmed via production build logs,
so this is a net-new, safe addition, not a change to an existing gate) that runs
`npm --workspace=backoffice run build`, producing `backoffice/dist/`, and the
existing `api/index.js` function's `includeFiles` is widened from `"server/**"`
to `"{server/**,backoffice/dist/**}"` (brace-glob, same syntax Vercel documents
for `excludeFiles`) so the built SPA ships inside the same function bundle. One
new `rewrites` entry, appended **after** the existing `/api/:path*` catch-all
(so `/api/*` calls from the Backoffice SPA itself are never intercepted by the
new rule — order matters and this is the mechanism that guarantees it), routes
everything else on that host to `/api/index`.

## 3. Tech stack

Vite + React + TypeScript + Tailwind CSS v4 + React Router, `base: '/'` (no
`/backoffice` URL prefix — the SPA behaves as if mounted at the domain root).
Workspace `backoffice/` added to root `package.json` `workspaces`.

## 4. Auth — compatibility layer now, real RBAC later

**Now:** reuse the existing production mechanism — `x-admin-token` header checked
against `ADMIN_PASSWORD` (or `CRON_SECRET`) in `server/index.js`'s `adminAuth`
middleware. Login page posts the password; there is no dedicated login endpoint
(the password *is* the token), so validation is done by calling the existing
`GET /api/admin/crm/command-center` with the candidate value as `x-admin-token`:
200 = valid, 401 = wrong password, network/5xx = distinct "server error" message.
Token is stored in `sessionStorage` (not `localStorage` — deliberate, so the
session ends when the tab/window closes), key `redbox_backoffice_admin_token`.
Labeled `TEMPORARY COMPATIBILITY AUTH` in code and UI. No username field (the
backend has no username concept — adding a decorative, non-functional one would
be misleading).

**Frontend abstraction (built now, so swapping auth later doesn't require a
rewrite):** `AuthProvider`, `ProtectedRoute`, `PermissionGuard`, `apiClient` are
real modules from day one, just backed by the single shared token today.
`apiClient` attaches `x-admin-token` to every request and triggers a global
logout on any `401`.

**Target (not built yet):** per-user login → session → role → permission →
branch scope. Initial roles: `manager` (broad, cross-branch) and `admin`
(branch-scoped). The existing `public.users` table (`role` constrained to
`owner`/`branch_admin`/`barber`, 7 rows) is the likely migration input for this
later — `manager` could extend/generalize `owner`, `admin` could map to a scoped
`branch_admin`. No decision is made now, and Phase 1A does not create a second
identity system.

## 5. Data classification (LIVE / PARTIAL LIVE / DEMO / UNAVAILABLE)

Every module must show its data status. Do not fabricate fields an endpoint
doesn't return — use `PARTIAL LIVE` instead. Never present DEMO data as real
business numbers; label it (`DemoBadge` component: "DEMO — awaiting production
database").

| Module | Status | Backing |
|---|---|---|
| Command Center | LIVE / PARTIAL LIVE | `GET /api/admin/crm/command-center`, `owner-overview`, `owner-revenue` |
| Operations | LIVE | `bookings`, `schedules`, `GET /api/admin/crm/schedule`, booking reassign/reschedule/walkin |
| CRM Overview | LIVE | `GET /api/admin/crm/customers/loyal|new|dormant` |
| Customer 360 | LIVE / PARTIAL LIVE | `customers` table, booking/visit history |
| Membership Report | LIVE | `GET /api/admin/crm/membership`, `member_profiles`, `member_point_transactions` |
| Branch Performance | LIVE / PARTIAL LIVE | `outlets`, bookings/transactions aggregation |
| Barber Performance | LIVE | `GET /api/admin/crm/leaderboard`, `barbers`, `moka_barber_services` |
| Stockist & Inventory Dashboard | LIVE (summary) | `GET /api/stockist/inventory/summary`, `/dashboard/overview` |
| Moka POS Integration | LIVE | `GET /api/moka/status`, `/api/moka/sync-logs` |
| HR & People (List + Detail) | DEMO | no `employees` table |
| Attendance (Overview, Import, Exceptions) | DEMO | no attendance table (`barber_attendance` exists but has 2 rows, not a real source) |
| Payroll (Overview, Regular, Barber, Employee Detail) | DEMO | no payroll table |
| Roles & Permissions | DEMO | `users.role` only has `owner`/`branch_admin`/`barber`, no `manager`/`admin` split yet |
| Package Feature Access | DEMO by design | product-planning screen, "Full Feature Review Mode" |
| Customer Report | PARTIAL LIVE | `customers`/`bookings`, some fields (favorite barber/service) need derivation |

## 6. Full Feature Review Mode

All modules are navigable now (no production entitlement locking). The
`Package Feature Access` screen documents this as a future-state plan
(Redbox Free / Redbox Business Suite), not a currently-enforced package system.
Component structure (`EmptyState`, parameterized) is built reusable so gating can
be turned on later (as a locked-module state) without a rewrite.

## 7. Information architecture / routing

```
/                        Command Center
/hr                       HR & People — Employee List
/hr/employees/:id         Employee Detail
/attendance                Attendance Overview
/attendance/import         Fingerprint Import
/attendance/exceptions     Exception Review
/payroll                   Payroll Overview
/payroll/regular           Regular Payroll
/payroll/barber            Barber Payroll
/payroll/employee/:id      Payroll Employee Detail
/operations                 Operations
/crm                        CRM Overview
/crm/customers/:id          Customer 360
/membership                 Membership Report
/stockist                   Stockist & Inventory Dashboard
/moka                       Moka POS Integration
/reports                    Reports Overview
/reports/branches           Branch Performance
/reports/customers          Customer Report
/reports/barbers            Barber Performance
/system/roles               Peran & Izin
/system/packages            Akses Paket
/system/settings            Pengaturan
```

Each screen from the design handoff is its own route — never merged into a giant
multi-tab component. In Phase 1A, every route except `/` and `/login` renders a
shared `ComingSoon` placeholder (built on the reusable `EmptyState` component)
rather than being a dead nav link — the full Sidebar is real and navigable now
(design fidelity, this section), the destination content is filled in
route-by-route in later phases.

Sidebar groups: (ungrouped) Command Center; **HR & People** (HR & People,
Attendance, Payroll); **Operations & Growth** (Operations, CRM & Customer,
Membership, Stockist & Inventory, Moka POS Integration, Reports); **System**
(Peran & Izin, Akses Paket, Pengaturan).

## 8. Component architecture

```
components/  Sidebar, PageHeader, StatCard, StatusBadge, DemoBadge, LiveBadge,
             EmptyState, LoadingState, ErrorState, PermissionDenied
layouts/     BackofficeLayout
auth/        AuthProvider, ProtectedRoute, PermissionGuard
lib/         apiClient
pages/       Login, CommandCenter, ComingSoon
```
`SectionHeader`, `DataCard`, `DataTable`, `FilterBar`, `SearchInput`, and
per-domain `services/` wrappers (crm/moka/stockist/reports) are introduced when
the phases that need them (1B onward) are built — not scaffolded speculatively
ahead of use.

## 9. Phased build

1. **1A — Foundation** (this phase): scaffold, design tokens, router, layout,
   Sidebar, Login, temporary compat auth, `AuthProvider`/`ProtectedRoute`/
   `PermissionGuard`, session persistence, logout, loading/error/access-denied
   states, Review Mode badge, Command Center shell, Option B host routing.
   **Stop for review after this phase.**
2. 1B — Command Center real data wiring.
3. 1C — HR (List + Detail), DEMO data.
4. 1D — Attendance (Overview, Import, Exceptions), DEMO data.
5. 1E — Payroll (Overview, Regular, Barber, Employee Detail), DEMO data.
6. Phase 2 — Operations, CRM Overview, Customer 360, Membership Report, Stockist
   dashboard, Moka Integration — LIVE-first.
7. Phase 3 — Reports (Overview, Branch/Customer/Barber Performance), Roles &
   Permissions, Package Feature Access, Settings.

## 10. Legacy pages

`public/crm.html` and `public/admin-moka.html` are **not** deleted, redirected, or
deprecated during this build. They remain the fallback until Backoffice reaches
feature parity, has been live-verified, and a reviewer explicitly signs off on
cutover.

## 11. Do not touch

`frontend/` Next.js admin app, `admin.redboxbarbershop.com`,
`stockist.redboxbarbershop.com`, the public booking flow, customer-facing site,
WhatsApp Reddy, cron jobs, Moka sync logic, booking backend, existing Supabase
business tables, and no unrelated changes to `server/index.js` beyond the single
isolated dispatcher middleware described in §2a.

## 12. Design fidelity

`design_handoff_command_center/README.md` and `screens/*.dc.html` are
reconstructed with high fidelity (layout hierarchy, sidebar grouping, nav labels,
page titles, card placement, table/list structure, status badges, spacing,
typography, color, radius, empty states) as real React + Tailwind components —
never copied as raw inline-style HTML. Priority when sources conflict: (1) design
handoff README, (2) `.dc.html` screens, (3) `CLAUDE_CODE_PROMPT.md` (screen list /
ordering / shared-component guidance only — its instruction to build inside
`frontend/src/app/admin/(admin_portal)/` is superseded by this spec), (4)
existing app conventions.

## 13. Phase 1A acceptance criteria

**Local/preview verification (before requesting a live alias test):**
- `npm --workspace=backoffice run build` succeeds
- `node --check server/index.js` and the full `npm test` suite pass
- serverless function count stays at exactly 12 (`api/*.js` file count)
- `git diff` reviewed — changes limited to `package.json`, `package-lock.json`,
  `vercel.json`, `server/index.js` (one isolated middleware block), `backoffice/`
- no unintended changes to `frontend/`, admin, or stockist

**Live-host verification (requires `backoffice.redboxbarbershop.com` temporarily
aliased to the built preview deployment — coordinated manually, since this
session has no working Vercel credential and preview URLs can't be tested via
spoofed Host headers):**
- `/`, `/login`, `/hr`, `/attendance`, `/payroll/barber` → Backoffice
- `/assets/<built-js>`, `/assets/<built-css>` → correct file, correct content-type
- `/api/admin/crm/command-center`, `/api/stockist/dashboard/overview` → existing
  API, never Backoffice HTML
- `www.redboxbarbershop.com`, `redboxbarbershop.com`, `admin.redboxbarbershop.com`,
  `stockist.redboxbarbershop.com` unchanged
- `/crm.html`, `/admin-moka.html` still available
