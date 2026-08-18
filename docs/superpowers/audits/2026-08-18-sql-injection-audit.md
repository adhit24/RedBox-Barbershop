# SQL / PostgREST Injection Audit — 2026-08-18

Scope: all `mysqlPool.execute`/`.query()` calls in `server/*.js`, and all
`.or()`/`.filter()` calls across `server/`, `server/moka/`, `server/services/`,
`server/whatsapp-ai/` that build filter strings from a template literal.

## Fixed

| Site | Endpoint | Auth | Issue | Fix |
|---|---|---|---|---|
| `server/index.js (search interpolation in GET /api/bookings — line numbers in this doc reflect the pre-hardening file, since drifted)` | `GET /api/bookings` | **Unauthenticated** when `?date=` supplied | Raw `search` interpolated into PostgREST `.or()` — caller controls filter structure | Escape `,()` via `escapePostgrestValue` before interpolating |
| `server/index.js (search interpolation in GET /api/customers — line numbers in this doc reflect the pre-hardening file, since drifted)` | `GET /api/customers` | `adminAuth` required | Same pattern | Same fix (defense in depth) |
| `server/whatsapp-ai/services/homeServiceHandler.js:67` | WA home-service handler, `_jobByCustomerPhone` | Internal, `phone` derived from inbound message handling | Same pattern | Same fix |

## Reviewed — no change needed

- `server/index.js` — every `mysqlPool.execute`/`.query()` call site (e.g. `hasOverlapMysql` at `:486-494`, booking list/search at `:958-981`, booking update `SET` clause at `:1715-1719`, barber deactivation at `:769-778`) uses `?` placeholders for values, and where the query text itself is built dynamically (e.g. the `SET` clause column list), the columns come from a fixed `allowed` whitelist (`server/index.js:1590`), never from arbitrary request keys.
- `server/moka/routes.js:1426,1980` and `server/services/reengagement.js:50,85` — these `.or()` calls interpolate server-computed `Date`/ISO-timestamp values, not request input. No caller-controlled data reaches the filter string.
- `server/index.js:2801` — `.or()` filter built from server-computed values, not user input.
- `server/index.js:3039,3048,3072` — `.or()` filters built from phone values passed through `normalizeMemberPhone`/`getMemberPhoneVariants`, which strip all non-digit characters via a `\D` regex before use — safe by construction, no PostgREST-structural characters (`,`, `(`, `)`) can survive that sanitization.
- `server/index.js:3333` — same pattern as the three above.

## Known limitation (Phase 1)

The Express-side rate limiters (`server/middleware/rateLimit.js`, applied to `adminAuth` and the OTP send/verify endpoints) use an in-memory `Map` scoped to a single process. Under Vercel, `server/index.js` runs as a serverless function — each concurrent/cold-started instance gets its own independent `Map`, so the effective rate limit under parallel load is `configured max × number of concurrent instances`, not a true global limit. This is a known, accepted Phase 1 limitation (matches the Next.js-side limiter's documented `single Vercel region` caveat in the design spec) — Phase 3's planned per-account progressive lockout will need a shared store (e.g. Redis) to close this gap properly.
