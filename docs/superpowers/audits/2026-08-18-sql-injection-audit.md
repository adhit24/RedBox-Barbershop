# SQL / PostgREST Injection Audit — 2026-08-18

Scope: all `mysqlPool.execute`/`.query()` calls in `server/*.js`, and all
`.or()`/`.filter()` calls across `server/`, `server/moka/`, `server/services/`,
`server/whatsapp-ai/` that build filter strings from a template literal.

## Fixed

| Site | Endpoint | Auth | Issue | Fix |
|---|---|---|---|---|
| `server/index.js:953` | `GET /api/bookings` | **Unauthenticated** when `?date=` supplied | Raw `search` interpolated into PostgREST `.or()` — caller controls filter structure | Escape `,()` via `escapePostgrestValue` before interpolating |
| `server/index.js:1991` | `GET /api/customers` | `adminAuth` required | Same pattern | Same fix (defense in depth) |
| `server/whatsapp-ai/services/homeServiceHandler.js:67` | WA home-service handler, `_jobByCustomerPhone` | Internal, `phone` derived from inbound message handling | Same pattern | Same fix |

## Reviewed — no change needed

- `server/index.js` — every `mysqlPool.execute`/`.query()` call site (e.g. `hasOverlapMysql` at `:486-494`, booking list/search at `:958-981`, booking update `SET` clause at `:1715-1719`, barber deactivation at `:769-778`) uses `?` placeholders for values, and where the query text itself is built dynamically (e.g. the `SET` clause column list), the columns come from a fixed `allowed` whitelist (`server/index.js:1590`), never from arbitrary request keys.
- `server/moka/routes.js:1426,1980` and `server/services/reengagement.js:50,85` — these `.or()` calls interpolate server-computed `Date`/ISO-timestamp values, not request input. No caller-controlled data reaches the filter string.
