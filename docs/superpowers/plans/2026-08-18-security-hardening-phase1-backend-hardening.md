# Security Hardening — Phase 1: Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value backend attack surfaces — missing security headers, missing rate limiting on brute-forceable endpoints, and a real unauthenticated PostgREST filter-injection bug — without touching the existing (sound) Supabase Auth + HMAC session-assertion architecture.

**Architecture:** Reuse and extend the in-memory rate-limit pattern already present in `server/index.js` (extracted into a shared, bucket-namespaced middleware module so it can be applied safely to multiple routes), add `helmet` to the Express app, add a parallel lightweight rate-limit utility for Next.js API routes (no shared runtime between the two processes), fix the confirmed filter-injection sites, and add `zod` input validation to the one public write endpoint that currently does only manual field presence checks.

**Tech Stack:** Express 4 + `mysql2`/`@supabase/supabase-js` (`server/`), Next.js 16 App Router + `@supabase/ssr` (`frontend/`). No test runner exists in either package — verification steps below use small standalone Node scripts (CommonJS for `server/`, `node --experimental-strip-types` for `frontend/` TypeScript, since Node 24.x is the pinned engine) and manual curl/dev-server smoke checks instead of a unit-test framework. This is a deliberate deviation from a pytest-style plan, matching this repo's existing testing conventions (there are none — smoke-test the behavior instead).

**Spec:** [docs/superpowers/specs/2026-08-18-security-hardening-design.md](../specs/2026-08-18-security-hardening-design.md)

## Global Constraints

- Server engine: Node `24.x` (`server/package.json` `engines.node`). Frontend: Next.js `16.2.6`, React `19.2.4`.
- All new/modified SQL must follow the existing pattern already used throughout `server/index.js`: parameterized `?` placeholders for values, and a fixed whitelist for any column/identifier that ends up in the query text itself. Never interpolate request input directly into SQL or PostgREST filter strings.
- Fail closed on verification failures for endpoints that change data (per spec's Error Handling section) — reject with a clear error, don't silently skip the check.
- `server/` and `server/whatsapp-ai/` are separate Node packages (separate `package.json`/`node_modules`) — do not add cross-package `require()`s between them; duplicate small shared utilities instead.

---

## Task 1: Extract shared, namespaced rate-limit middleware (Express)

**Context:** `server/index.js:244-265` already defines an in-memory `rateLimit()` factory, used once at `server/index.js:1162` for `POST /api/bookings`. Its internal `rateLimitMap` is keyed only by IP, with no namespace — if the same factory is called for multiple different routes (which Task 3 needs to do), an IP hitting two different rate-limited routes would incorrectly share one budget between them. Fix this while extracting it into its own module.

**Files:**
- Create: `server/middleware/rateLimit.js`
- Modify: `server/index.js:244-265` (remove inline definition, require the new module), `server/index.js:1162` (add `name` to the existing call)

**Interfaces:**
- Produces: `rateLimit({ windowMs?: number, max?: number, name: string })` → Express middleware `(req, res, next) => void`. Throws if `name` is omitted. Responds `429 { error: string }` when the per-`name`-per-IP bucket is exceeded within `windowMs`; otherwise calls `next()`.

- [ ] **Step 1: Create the shared middleware module**

```js
// server/middleware/rateLimit.js
const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 10, name } = {}) {
  if (!name) throw new Error('rateLimit requires a unique `name` so routes do not share buckets');
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${name}:${ip}`;
    const record = buckets.get(key) || { count: 0, start: now };

    if (now - record.start > windowMs) {
      record.count = 1;
      record.start = now;
    } else {
      record.count++;
    }
    buckets.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa saat.' });
    }
    next();
  };
}

module.exports = { rateLimit };
```

- [ ] **Step 2: Verify the middleware blocks correctly and namespaces buckets separately**

Run:
```bash
cd "server" && node -e "
const { rateLimit } = require('./middleware/rateLimit');
const req = { headers: { 'x-forwarded-for': '10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
function fakeRes() {
  const r = {};
  r.status = (s) => { r._status = s; return r; };
  r.json = (b) => { r._body = b; };
  return r;
}
const mwA = rateLimit({ windowMs: 60000, max: 2, name: 'bucket-a' });
const mwB = rateLimit({ windowMs: 60000, max: 2, name: 'bucket-b' });
let nextCount = 0;
const next = () => { nextCount++; };

mwA(req, fakeRes(), next); mwA(req, fakeRes(), next);
const blockedRes = fakeRes();
mwA(req, blockedRes, next); // 3rd call to bucket-a, should block

const bRes = fakeRes();
mwB(req, bRes, next); // bucket-b is untouched, should still pass

console.log(JSON.stringify({ nextCount, blockedStatus: blockedRes._status, bucketBBlocked: bRes._status === 429 }));
"
```

Expected output: `{"nextCount":3,"blockedStatus":429,"bucketBBlocked":false}` — confirms bucket-a blocks on the 3rd request while bucket-b (different `name`, same IP) is unaffected.

- [ ] **Step 3: Wire the module into `server/index.js`**

Remove the inline block at `server/index.js:244-265` (the `rateLimitMap` declaration and `function rateLimit(...) {...}`), and add near the other top-of-file `require`s (after the `mysql` require, `server/index.js:16`):

```js
const { rateLimit } = require('./middleware/rateLimit');
```

- [ ] **Step 4: Add a `name` to the existing usage so it doesn't share a bucket with new callers**

At `server/index.js:1162`, change:
```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
```
to:
```js
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10, name: 'bookings-create' }), async (req, res) => {
```

- [ ] **Step 5: Sanity-check the server still boots**

Run: `cd "server" && node -c index.js`
Expected: no output (syntax OK). This only checks syntax — it does not require DB env vars, unlike actually starting the server.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/rateLimit.js server/index.js
git commit -m "refactor(server): extract namespaced rate-limit middleware"
```

---

## Task 2: Add `helmet` security headers to Express

**Files:**
- Modify: `server/package.json` (add dependency)
- Modify: `server/index.js:35` (mount `helmet()` early, before any route registration)

**Interfaces:**
- Consumes: none beyond the `helmet` npm package.

- [ ] **Step 1: Install helmet**

Run: `cd "server" && npm install helmet@^8`
Expected: `server/package.json` dependencies gain `"helmet": "^8.x.x"` and `server/package-lock.json` updates.

- [ ] **Step 2: Mount it early in the middleware chain**

At `server/index.js`, add the require near the top (after `const express = require('express');` at line 11):
```js
const helmet = require('helmet');
```

Then right after `app.set('trust proxy', process.env.VERCEL === '1' ? 1 : false);` (`server/index.js:35`), add:
```js
app.use(helmet());
```

This runs well before the CORS middleware (`server/index.js:826`) and every route.

- [ ] **Step 3: Verify headers are actually set**

Run:
```bash
cd "server" && node -e "
const express = require('express');
const helmet = require('helmet');
const app = express();
app.use(helmet());
app.get('/ping', (req, res) => res.json({ ok: true }));
const server = app.listen(0, async () => {
  const port = server.address().port;
  const res = await fetch(\`http://localhost:\${port}/ping\`);
  const h = Object.fromEntries(res.headers.entries());
  console.log(JSON.stringify({
    xContentTypeOptions: h['x-content-type-options'],
    xFrameOptions: h['x-frame-options'],
    hasCsp: !!h['content-security-policy'],
  }));
  server.close();
});
"
```
Expected: `{"xContentTypeOptions":"nosniff","xFrameOptions":"SAMEORIGIN","hasCsp":true}` (helmet's defaults).

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/index.js
git commit -m "feat(server): add helmet security headers"
```

---

## Task 3: Rate-limit brute-forceable auth endpoints (Express)

**Context:** Four endpoints currently have no request throttling at all: the member OTP send/verify pair (`server/index.js`) and the barber OTP send/verify pair (`server/routes/barber.js`). `verifyBarberOTP` in particular (`server/services/barberOTP.js:61-93`) has zero attempt limiting on a 6-digit code — nothing stops unlimited guesses within its 10-minute validity window. `adminAuth` (`server/index.js:855-884`), used across every admin-gated route, also has no throttling on repeated bad tokens. This task applies Task 1's `rateLimit` middleware to all of these. (Smarter failure-only progressive lockout is deferred to Phase 3 per the spec — this task adds the baseline per-IP throttle.)

**Files:**
- Modify: `server/index.js:855-884` (`adminAuth`), `server/index.js:2829` (`/api/auth/otp/send`), `server/index.js:2941` (`/api/auth/otp/verify`)
- Modify: `server/routes/barber.js:27` (`/auth/otp/send`), `server/routes/barber.js:35` (`/auth/otp/verify`)

**Interfaces:**
- Consumes: `rateLimit` from `server/middleware/rateLimit.js` (Task 1).

- [ ] **Step 1: Wrap `adminAuth` with a generous per-IP throttle**

At `server/index.js:855-884`, replace:
```js
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || '';
  const validTokens = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
  if (!token || !validTokens.includes(token)) return res.status(401).json({ error: 'Unauthorized' });

  const sessionAssertion = req.headers['x-redbox-admin-session'];
  if (sessionAssertion) {
    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      req.adminAuth = verifyAdminSessionAssertion(String(sessionAssertion), {
        adminSessionProxySecret: process.env.ADMIN_SESSION_PROXY_SECRET,
        adminPassword: process.env.ADMIN_PASSWORD,
      });
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid admin session' });
    }
  }

  const credentialId = token === process.env.ADMIN_PASSWORD ? 'crm-admin' : 'cron-service';
  req.adminAuth = {
    staffId: String(process.env.ADMIN_AUDIT_STAFF_ID || credentialId).trim(),
    role: null,
    branch: null,
    sessionVerified: false,
  };
  next();
}
```
with:
```js
const adminAuthLimiter = rateLimit({ windowMs: 60000, max: 100, name: 'admin-auth' });

function adminAuth(req, res, next) {
  adminAuthLimiter(req, res, () => {
    const token = req.headers['x-admin-token'] || '';
    const validTokens = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter(Boolean);
    if (!token || !validTokens.includes(token)) return res.status(401).json({ error: 'Unauthorized' });

    const sessionAssertion = req.headers['x-redbox-admin-session'];
    if (sessionAssertion) {
      if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      try {
        req.adminAuth = verifyAdminSessionAssertion(String(sessionAssertion), {
          adminSessionProxySecret: process.env.ADMIN_SESSION_PROXY_SECRET,
          adminPassword: process.env.ADMIN_PASSWORD,
        });
        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid admin session' });
      }
    }

    const credentialId = token === process.env.ADMIN_PASSWORD ? 'crm-admin' : 'cron-service';
    req.adminAuth = {
      staffId: String(process.env.ADMIN_AUDIT_STAFF_ID || credentialId).trim(),
      role: null,
      branch: null,
      sessionVerified: false,
    };
    next();
  });
}
```
`max: 100` per minute per IP is deliberately generous — the admin dashboard fires many parallel calls through `adminAuth` on page load, and this task's goal is capping automated abuse, not throttling legitimate dashboard use.

- [ ] **Step 2: Rate-limit member OTP send**

At `server/index.js:2829`, change:
```js
  app.post('/api/auth/otp/send', async (req, res) => {
```
to:
```js
  app.post('/api/auth/otp/send', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'otp-send-member' }), async (req, res) => {
```
(This is on top of the existing per-phone DB check at `server/index.js:2913-2920` — that one bounds abuse per phone number, this bounds one IP hammering many different phone numbers.)

- [ ] **Step 3: Rate-limit member OTP verify**

At `server/index.js:2941`, change:
```js
  app.post('/api/auth/otp/verify', async (req, res) => {
```
to:
```js
  app.post('/api/auth/otp/verify', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'otp-verify-member' }), async (req, res) => {
```

- [ ] **Step 4: Rate-limit barber OTP send/verify**

In `server/routes/barber.js`, add the import near the top (after the existing requires, `server/routes/barber.js:5`):
```js
const { rateLimit } = require('../middleware/rateLimit');
```

Then change `server/routes/barber.js:27`:
```js
  router.post('/auth/otp/send', async (req, res) => {
```
to:
```js
  router.post('/auth/otp/send', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'otp-send-barber' }), async (req, res) => {
```

And `server/routes/barber.js:35`:
```js
  router.post('/auth/otp/verify', async (req, res) => {
```
to:
```js
  router.post('/auth/otp/verify', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'otp-verify-barber' }), async (req, res) => {
```

- [ ] **Step 5: Verify each of the four new bucket names is wired with a standalone reproduction of the same config**

Run:
```bash
cd "server" && node -e "
const { rateLimit } = require('./middleware/rateLimit');
const names = ['admin-auth', 'otp-send-member', 'otp-verify-member', 'otp-send-barber', 'otp-verify-barber'];
const req = { headers: { 'x-forwarded-for': '10.0.0.2' }, socket: { remoteAddress: '10.0.0.2' } };
function fakeRes() { const r = {}; r.status = (s) => { r._status = s; return r; }; r.json = () => {}; return r; }
const results = {};
for (const name of names) {
  const max = name === 'admin-auth' ? 100 : 20;
  const mw = rateLimit({ windowMs: 60000, max, name });
  let blocked = false;
  for (let i = 0; i < max + 1; i++) {
    const res = fakeRes();
    mw(req, res, () => {});
    if (res._status === 429) blocked = true;
  }
  results[name] = blocked;
}
console.log(JSON.stringify(results));
"
```
Expected: `{"admin-auth":true,"otp-send-member":true,"otp-verify-member":true,"otp-send-barber":true,"otp-verify-barber":true}` — every named bucket independently enforces its own limit.

- [ ] **Step 6: Syntax-check both modified files**

Run: `cd "server" && node -c index.js && node -c routes/barber.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/routes/barber.js
git commit -m "feat(server): rate-limit admin auth and OTP send/verify endpoints"
```

---

## Task 4: Fix unauthenticated PostgREST filter-injection in `.or()` search filters

**Context — this is the concrete SQL-injection-adjacent finding from the audit.** `GET /api/bookings` (`server/index.js:935`) is reachable **without** `adminAuth` whenever the caller supplies a `date` query param (`server/index.js:939`: `if (!isAdmin && !req.query.date) return res.status(401)...`). When `DB_TYPE === 'supabase'` and a `search` query param is present, `server/index.js:953` builds a PostgREST filter by directly interpolating the raw `search` string into `.or()`:
```js
if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%,service.ilike.%${search}%`);
```
PostgREST's `.or()` parses this string as a mini filter-language where `,` separates conditions and `(`/`)` nest `and()`/`or()` groups. An unauthenticated caller who controls `search` therefore controls the filter *structure*, not just the value — e.g. injecting extra `,column.op.value` clauses to manipulate which rows match. This is a real, documented Supabase/PostgREST footgun, distinct from but equivalent in effect to classic SQL injection. Two more sites do the same thing: `server/index.js:1991` (`GET /api/customers`, `adminAuth`-gated — still worth fixing as defense in depth) and `server/whatsapp-ai/services/homeServiceHandler.js:67` (interpolates a `phone` value).

Everywhere else checked (`server/index.js` `mysqlPool.execute`/`.query` call sites, and the `.or()` calls in `server/moka/routes.js:1426,1980` and `server/services/reengagement.js:50,85`) interpolate server-computed values (timestamps, ISO dates) or use `?` placeholders with a whitelist for any dynamic identifiers — those are safe and need no change.

**Files:**
- Create: `server/utils/postgrestEscape.js`
- Create: `server/whatsapp-ai/utils/postgrestEscape.js` (duplicated, not shared — `server/whatsapp-ai` is a separate package per Global Constraints)
- Modify: `server/index.js:953`, `server/index.js:1991`
- Modify: `server/whatsapp-ai/services/homeServiceHandler.js:67`
- Create: `docs/superpowers/audits/2026-08-18-sql-injection-audit.md` (findings record)

**Interfaces:**
- Produces: `escapePostgrestValue(value: string): string` — strips the PostgREST filter-grammar delimiter characters (`,`, `(`, `)`) so a value can be safely embedded in an `.or()`/`.filter()` string template.

- [ ] **Step 1: Create the escape helper (server package)**

```js
// server/utils/postgrestEscape.js
// PostgREST's .or()/.filter() string DSL uses `,` to separate conditions and
// `(`/`)` to nest and()/or() groups. Stripping those characters from a value
// before interpolating it into a filter template prevents a caller-controlled
// value from injecting extra filter clauses.
function escapePostgrestValue(value) {
  return String(value ?? '').replace(/[,()]/g, '');
}

module.exports = { escapePostgrestValue };
```

- [ ] **Step 2: Duplicate it into the `whatsapp-ai` package**

```js
// server/whatsapp-ai/utils/postgrestEscape.js
function escapePostgrestValue(value) {
  return String(value ?? '').replace(/[,()]/g, '');
}

module.exports = { escapePostgrestValue };
```

- [ ] **Step 3: Verify the escape function**

Run:
```bash
cd "server" && node -e "
const { escapePostgrestValue } = require('./utils/postgrestEscape');
const cases = [
  ['budi', 'budi'],
  ['budi,role.eq.admin', 'budirole.eq.admin'],
  ['a)(or(id.gt.0', 'aor id.gt.0'.replace(' ', '')],
];
const results = cases.map(([input, expected]) => escapePostgrestValue(input) === expected);
console.log(JSON.stringify({ allPass: results.every(Boolean), results }));
"
```
Expected: `{"allPass":true,"results":[true,true,true]}`

- [ ] **Step 4: Fix the unauthenticated site — `GET /api/bookings`**

At `server/index.js`, add the require near the top (after the `rateLimit` require added in Task 1):
```js
const { escapePostgrestValue } = require('./utils/postgrestEscape');
```

At `server/index.js:953`, change:
```js
    if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%,service.ilike.%${search}%`);
```
to:
```js
    if (search) {
      const safeSearch = escapePostgrestValue(search);
      q = q.or(`name.ilike.%${safeSearch}%,wa.ilike.%${safeSearch}%,service.ilike.%${safeSearch}%`);
    }
```

- [ ] **Step 5: Fix the admin-gated site — `GET /api/customers`**

At `server/index.js:1991`, change:
```js
    if (search) q = q.or(`name.ilike.%${search}%,wa.ilike.%${search}%`);
```
to:
```js
    if (search) {
      const safeSearch = escapePostgrestValue(search);
      q = q.or(`name.ilike.%${safeSearch}%,wa.ilike.%${safeSearch}%`);
    }
```

- [ ] **Step 6: Fix the WhatsApp-AI site**

At `server/whatsapp-ai/services/homeServiceHandler.js`, add near the top of the file (after existing requires):
```js
const { escapePostgrestValue } = require('../utils/postgrestEscape');
```

At `server/whatsapp-ai/services/homeServiceHandler.js:67`, change:
```js
    .or(`phone.eq.${phone},phone_e164.eq.${phone},wa.eq.${phone}`)
```
to:
```js
    .or(`phone.eq.${escapePostgrestValue(phone)},phone_e164.eq.${escapePostgrestValue(phone)},wa.eq.${escapePostgrestValue(phone)}`)
```

- [ ] **Step 7: Write the audit findings doc**

```markdown
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
```

Save as `docs/superpowers/audits/2026-08-18-sql-injection-audit.md`.

- [ ] **Step 8: Syntax-check modified files**

Run: `cd "server" && node -c index.js && node -c whatsapp-ai/services/homeServiceHandler.js`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add server/utils/postgrestEscape.js server/whatsapp-ai/utils/postgrestEscape.js server/index.js server/whatsapp-ai/services/homeServiceHandler.js docs/superpowers/audits/2026-08-18-sql-injection-audit.md
git commit -m "fix(server): escape PostgREST filter injection in search/phone lookups"
```

---

## Task 5: Add security headers to Next.js

**Files:**
- Modify: `frontend/next.config.ts`

**Interfaces:** none (config-only change).

- [ ] **Step 1: Replace the config with one that adds security headers to every route**

Current content of `frontend/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

Replace with:
```ts
import type { NextConfig } from 'next';

const supabaseOrigin = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const supabaseWsOrigin = supabaseOrigin.replace(/^https:/, 'wss:');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      `connect-src 'self' ${supabaseOrigin} ${supabaseWsOrigin}`,
      "img-src 'self' data: https://lh3.googleusercontent.com https://drive.google.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

The CSP ships as `Content-Security-Policy-Report-Only` (not enforced) per the spec's fail-safe rule — it reports violations without breaking any existing script/style loading. Enforcing it is a follow-up once a report period confirms the policy doesn't false-positive on legitimate app behavior.

- [ ] **Step 2: Verify headers are served by the dev server**

Run:
```bash
cd "frontend" && (npx next dev -p 3902 > /tmp/next-dev-headers-check.log 2>&1 &) && sleep 10 && curl -sI http://localhost:3902/ | grep -i "x-frame-options\|strict-transport-security\|content-security-policy-report-only\|x-content-type-options"
```
Expected output includes lines for `x-frame-options: DENY`, `strict-transport-security: ...`, `content-security-policy-report-only: ...`, `x-content-type-options: nosniff`.

Then stop the dev server:
```bash
pkill -f "next dev -p 3902" 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add frontend/next.config.ts
git commit -m "feat(frontend): add security headers and report-only CSP"
```

---

## Task 6: Add rate limiting to the public booking-creation route (Next.js)

**Context:** `POST /api/bookings` in Next.js (`frontend/src/app/api/bookings/route.ts:18-75`) writes directly to Supabase and is the actual live public booking-creation path (the Express `POST /api/bookings` rate-limited in Task 1 is a separate, MySQL-branch code path — see `server/index.js:31` `DB_TYPE`). This Next.js route currently has no rate limiting at all.

**Files:**
- Create: `frontend/src/lib/rateLimit.ts`
- Modify: `frontend/src/app/api/bookings/route.ts`

**Interfaces:**
- Produces: `checkRateLimit(req: { headers: Headers }, opts: { windowMs?: number, max?: number, name: string }): { allowed: true } | { allowed: false, retryAfterMs: number }`

- [ ] **Step 1: Create the rate-limit utility**

```ts
// frontend/src/lib/rateLimit.ts
type Bucket = { count: number; start: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  req: { headers: Headers },
  { windowMs = 60_000, max = 10, name }: { windowMs?: number; max?: number; name: string }
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const key = `${name}:${ip}`;
  const now = Date.now();
  const record = buckets.get(key) ?? { count: 0, start: now };

  if (now - record.start > windowMs) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }
  buckets.set(key, record);

  if (record.count > max) {
    return { allowed: false, retryAfterMs: windowMs - (now - record.start) };
  }
  return { allowed: true };
}
```

- [ ] **Step 2: Verify it in isolation**

Run:
```bash
cd "frontend" && cat > _verify-ratelimit.mjs << 'EOF'
import { checkRateLimit } from './src/lib/rateLimit.ts';

const req = { headers: new Headers({ 'x-forwarded-for': '9.9.9.9' }) };
const results = [];
for (let i = 0; i < 4; i++) {
  results.push(checkRateLimit(req, { windowMs: 60000, max: 3, name: 'verify-test' }).allowed);
}
console.log(JSON.stringify(results));
EOF
node --experimental-strip-types _verify-ratelimit.mjs
rm _verify-ratelimit.mjs
```
Expected output: `[true,true,true,false]`

- [ ] **Step 3: Apply it to the booking POST handler**

At `frontend/src/app/api/bookings/route.ts`, add the import (after the existing imports, line 3):
```ts
import { checkRateLimit } from '@/lib/rateLimit';
```

Change the start of `export async function POST(req: NextRequest) {` (line 18) from:
```ts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
```
to:
```ts
export async function POST(req: NextRequest) {
  const limit = checkRateLimit(req, { windowMs: 60_000, max: 5, name: 'bookings-create' });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan booking. Coba lagi dalam 1 menit.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
```

- [ ] **Step 4: Type-check the frontend**

Run: `cd "frontend" && npx tsc --noEmit`
Expected: no new errors introduced by this change (pre-existing errors, if any, are out of scope — compare against a run before this task if unsure).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/rateLimit.ts frontend/src/app/api/bookings/route.ts
git commit -m "feat(frontend): rate-limit public booking creation endpoint"
```

---

## Task 7: Add zod validation to the booking-creation route (Next.js)

**Context:** `POST /api/bookings` currently only checks that required fields are truthy (`frontend/src/app/api/bookings/route.ts:39`); it doesn't validate shapes (e.g. `date`/`time` format, `wa` looking like a phone number) before writing to Supabase.

**Files:**
- Create: `frontend/src/lib/validation/booking.ts`
- Modify: `frontend/package.json` (add `zod` dependency)
- Modify: `frontend/src/app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `checkRateLimit` from Task 6 (already applied to this route).
- Produces: `bookingSchema: ZodObject` (exported from `frontend/src/lib/validation/booking.ts`) with a `.safeParse()` result shape `{ success: true, data: {...} } | { success: false, error: ZodError }`.

- [ ] **Step 1: Install zod**

Run: `cd "frontend" && npm install zod`
Expected: `frontend/package.json` dependencies gain `"zod": "^..."`.

- [ ] **Step 2: Create the validation schema**

```ts
// frontend/src/lib/validation/booking.ts
import { z } from 'zod';

export const bookingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  wa: z.string().trim().regex(/^[0-9+\-\s()]{8,20}$/, 'Nomor WA tidak valid'),
  service_id: z.union([z.string(), z.number()]).optional().nullable(),
  service: z.string().trim().min(1).max(200),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  duration: z.union([z.string(), z.number()]).optional().nullable(),
  barber_id: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid (YYYY-MM-DD)'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Format waktu tidak valid (HH:mm)'),
  location: z.string().trim().min(1).max(60),
  payment: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;
```

- [ ] **Step 3: Verify the schema accepts valid input and rejects invalid input**

Run:
```bash
cd "frontend" && cat > _verify-booking-schema.mjs << 'EOF'
import { bookingSchema } from './src/lib/validation/booking.ts';

const valid = {
  name: 'Budi', wa: '081234567890', service: 'Haircut',
  date: '2026-08-20', time: '14:30', location: 'bypass',
};
const invalid = {
  name: '', wa: 'not-a-phone', service: 'Haircut',
  date: '20-08-2026', time: '2:30pm', location: 'bypass',
};

console.log(JSON.stringify({
  validOk: bookingSchema.safeParse(valid).success,
  invalidRejected: !bookingSchema.safeParse(invalid).success,
}));
EOF
node --experimental-strip-types _verify-booking-schema.mjs
rm _verify-booking-schema.mjs
```
Expected: `{"validOk":true,"invalidRejected":true}`

- [ ] **Step 4: Wire the schema into the route handler**

At `frontend/src/app/api/bookings/route.ts`, add the import (alongside the Task 6 import):
```ts
import { bookingSchema } from '@/lib/validation/booking';
```

Replace the body-parsing and manual-check block:
```ts
  try {
    const body = await req.json();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      name,
      wa,
      service_id,
      service,
      price,
      duration,
      barber_id,
      date,
      time,
      location,
      payment,
      notes,
    } = body;

    if (!name || !wa || !service || !date || !time || !location) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
```
with:
```ts
  try {
    const body = await req.json();
    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Data booking tidak valid' },
        { status: 400 }
      );
    }
    const {
      name,
      wa,
      service_id,
      service,
      price,
      duration,
      barber_id,
      date,
      time,
      location,
      payment,
      notes,
    } = parsed.data;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
```

(The `supabase`/`cookies()` setup moved after validation so an invalid request short-circuits before touching the DB client — no behavior change for valid requests.)

- [ ] **Step 5: Type-check the frontend**

Run: `cd "frontend" && npx tsc --noEmit`
Expected: no new errors introduced by this change.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/validation/booking.ts frontend/src/app/api/bookings/route.ts
git commit -m "feat(frontend): validate booking input with zod"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 1 spec bullets — security headers (Task 2, Task 5), rate limiting (Task 1, Task 3, Task 6), CORS allowlist (verified already adequate at `server/index.js:825-836`, no task needed — noted here rather than as a no-op task), SQL injection audit (Task 4), input validation (Task 7). All covered.
- **Type/name consistency:** `rateLimit`/`escapePostgrestValue`/`checkRateLimit`/`bookingSchema` names are used identically across every task that references them.
- **CORS correction:** the design spec assumed CORS had no allowlist; investigation during planning found `server/index.js:825-836` already implements one (`ALLOWED_ORIGINS` env + `.vercel.app` + `redboxbarbershop.com` + localhost). No Phase 1 task changes it — flagged here so the spec's assumption doesn't get treated as a follow-up gap later.
