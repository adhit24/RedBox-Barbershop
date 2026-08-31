# Redbox Backoffice Command Center — Design Spec

Status: approved by owner (adhit24), pre-implementation. Source of truth for scope
questions during build; `design_handoff_command_center/README.md` remains the visual
source of truth (see priority order below).

## 1. What this is

A new, standalone internal app — **Redbox Backoffice** — served at
`https://backoffice.redboxbarbershop.com`. It consolidates and replaces the
functionality currently split across `public/crm.html` and `public/admin-moka.html`,
and implements the 23-screen design in `design_handoff_command_center/`.

It is explicitly **not**:
- part of the public marketing/booking site (`www.redboxbarbershop.com`)
- part of the existing Next.js admin app (`frontend/`, served at
  `admin.redboxbarbershop.com`)
- part of the Stockist app (`stockist.redboxbarbershop.com`)

Those three stay untouched.

## 2. Deployment topology

- **Vercel project**: existing `redbox-barbershop` (project id
  `prj_WFHLGSGUzFMqERLKINHid13Y17dc`) — the same project that owns
  `www.redboxbarbershop.com` / `redboxbarbershop.com`. It is *not* the `redbox-frontend`
  Next.js project.
- **Domain**: `backoffice.redboxbarbershop.com`, already attached to `redbox-barbershop`
  by the owner (confirmed via Vercel dashboard).
- **Framework**: this project has no framework (static `public/` + serverless
  functions in `api/*.js` running the Express app in `server/`). The backoffice app
  builds as a static SPA and is served from within this same deployment — no new
  Vercel project.
- **Routing**: host-based rewrite in root `vercel.json`, added additively (existing
  `functions`/`rewrites`/`headers` entries untouched). Exact mechanism and its
  file-system-precedence risk are documented in the Phase 1A plan; verified via a
  preview deployment before being considered done.

## 3. Tech stack

Vite + React + TypeScript + Tailwind CSS + React Router, building to static assets
under a `/backoffice/` base path. New npm workspace (e.g. `backoffice/`) added to root
`package.json` `workspaces`.

## 4. Auth — compatibility layer now, real RBAC later

**Now:** reuse the existing production mechanism — `x-admin-token` header checked
against `ADMIN_PASSWORD` (or `CRON_SECRET`) in `server/index.js`'s `adminAuth`
middleware. Login page posts the password, token is held client-side, sent on every
API call.

**Frontend abstraction (built now, so swapping auth later doesn't require a rewrite):**
`AuthProvider`, `Session`, `currentUser`, `role`, `branchScope`, `permissions`,
`apiClient` — all real modules from day one, just backed by the single shared token
today.

**Target (not built yet):** per-user login → session → role → permission →
branch scope. Initial roles: `manager` (broad, cross-branch, operational +
management modules) and `admin` (limited, branch-scoped, operational modules only).
Frontend route guards (`ProtectedRoute`, `PermissionGuard`) are built as real
enforcement points now; they gate on whatever the compatibility layer can express
today (effectively: authenticated or not) and get real role/branch logic wired in
once server-side RBAC exists. Never represent this as production RBAC before the
backend actually enforces it.

## 5. Data classification (LIVE / PARTIAL LIVE / DEMO / UNAVAILABLE)

Every module must show its data status. Do not fabricate fields an endpoint doesn't
return — use `PARTIAL LIVE` for that instead. Never present DEMO data as real business
numbers; label it (e.g. small "DEMO — awaiting production database" tag).

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
Component structure (`LockedModule` empty-state) is built reusable so gating can be
turned on later without a rewrite.

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
/system/roles               Roles & Permissions
/system/packages            Package Feature Access
/system/settings            Settings
```

Each screen from the design handoff is its own route/page — never merged into a
giant multi-tab component. Sidebar groups: (ungrouped) Command Center; **HR & People**
(HR & People, Attendance, Payroll); **Operations & Growth** (Operations, CRM & Customer,
Membership, Stockist & Inventory, Moka POS Integration, Reports); **System** (Peran &
Izin, Akses Paket, Pengaturan).

## 8. Component architecture

```
components/  Sidebar, PageHeader, SectionHeader, StatCard, DataCard, StatusBadge,
             DataTable, EmptyState, DemoBadge, LiveBadge, LockedModule,
             LoadingState, ErrorState, PermissionDenied, FilterBar, SearchInput
layouts/     BackofficeLayout
auth/        AuthProvider, ProtectedRoute, PermissionGuard
lib/         apiClient, auth, permissions
data/        demo HR / payroll / attendance fixtures
services/    crm, moka, stockist, reports (thin wrappers over apiClient, one per
             backend domain — presentation components never call fetch directly)
```

## 9. Phased build

1A — Foundation: scaffold, design tokens, router, layout, Sidebar, Login, temporary
     compat auth, `AuthProvider`/`ProtectedRoute`, session persistence, logout,
     access-denied/loading/error states, Review Mode badge, Command Center shell,
     host routing config. **Stop for review after this phase.**
2. 1B — Command Center real data wiring. **Stop for review.**
3. 1C — HR (List + Detail), DEMO data. **Stop for review.**
4. 1D — Attendance (Overview, Import, Exceptions), DEMO data. **Stop for review.**
5. 1E — Payroll (Overview, Regular, Barber, Employee Detail), DEMO data. **Stop for review.**
6. Phase 2 — Operations, CRM Overview, Customer 360, Membership Report, Stockist
   dashboard, Moka Integration — LIVE-first.
7. Phase 3 — Reports (Overview, Branch/Customer/Barber Performance), Roles &
   Permissions, Package Feature Access, Settings.

## 10. Legacy pages

`public/crm.html` and `public/admin-moka.html` are **not** deleted, redirected, or
deprecated during this build. They remain the fallback until Backoffice reaches
feature parity, has been live-verified, and a reviewer explicitly signs off on
cutover. That decision is out of scope for this spec.

## 11. Do not touch

`frontend/` Next.js admin app, `admin.redboxbarbershop.com`,
`stockist.redboxbarbershop.com`, the public booking flow, customer-facing site,
WhatsApp Reddy, cron jobs, Moka sync logic, booking backend, existing Supabase
business tables — except where strictly required for compatibility, and called out
explicitly before doing so.

## 12a. Phase 1A acceptance criteria (must verify on preview deploy before sign-off)

**Host rewrite / original-path resolution:**
- `GET /` → Backoffice `index.html`
- `GET /hr` → Backoffice `index.html` via SPA fallback
- `GET /attendance` → Backoffice `index.html` via SPA fallback
- `GET /assets/<actual-vite-built-file>.js` → correct JS asset, correct content-type
- `GET /assets/<actual-vite-built-file>.css` → correct CSS asset, correct content-type
- `GET /api/admin/crm/command-center` → existing CRM API, NOT `api/backoffice.js`
- `GET /api/stockist/dashboard/overview` → existing Stockist API, NOT `api/backoffice.js`

If the function does not receive/resolve the expected path, STOP and revise routing —
do not work around it by changing existing API routing.

**Build pipeline regression check (after adding `buildCommand`):**
- public `/`, `/booking.html`, `/crm.html`, `/admin-moka.html` still serve
- existing `/api/*` and existing serverless functions still work
- cron configuration still present in `vercel.json`
- `www.redboxbarbershop.com` / `redboxbarbershop.com` behavior unchanged
- `admin.redboxbarbershop.com` unchanged
- `stockist.redboxbarbershop.com` unchanged

`crm.html` and `admin-moka.html` are NOT removed in Phase 1A. They remain the
fallback until Backoffice reaches feature parity, passes live verification, and a
reviewer explicitly approves cutover.

## 12. Design fidelity

`design_handoff_command_center/README.md` and `screens/*.dc.html` are reconstructed
with high fidelity (layout hierarchy, sidebar grouping, nav labels, page titles, card
placement, table/list structure, status badges, spacing, typography, color, radius,
empty states) as real React + Tailwind components — never copied as raw inline-style
HTML. Priority when sources conflict: (1) design handoff README, (2) `.dc.html`
screens, (3) `CLAUDE_CODE_PROMPT.md` (for screen list / ordering / shared-component
guidance only — its instruction to build inside
`frontend/src/app/admin/(admin_portal)/` is superseded by this spec), (4) existing
app conventions.
