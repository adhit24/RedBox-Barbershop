# Vercel Hobby Plan Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the project back under Vercel Hobby plan limits so production deploys go READY again, without losing the Moka serverless-sync fix from commit `924b7ab`.

**Architecture:** Two surgical edits — delete one dead-code serverless function, prune the `crons` array in `vercel.json` from 4 entries to 2. Both rebalance counts to fit Hobby limits (12 functions, 2 cron jobs). The two pruned cron paths remain HTTP-callable functions so they can still be triggered by external schedulers (cron-job.org pattern already in use per commit `5311109`).

**Tech Stack:** Vercel Serverless Functions, `vercel.json` config, Node.js 24.x, npm workspaces.

---

## Context (for the engineer)

**Problem.** Production deploys have been ERROR-ing post-build since commit `b2613c0`. Three deploys in a row ended at "Deploying outputs..." with no further error in the build-log stream — error happens at the Vercel platform layer (limit validation), not in `vercel build`.

**Diagnosis.** Hobby plan caps at 12 Serverless Functions and 2 Cron Jobs. Current repo state:
- **13 `.js` files in `api/`** — Vercel auto-registers all of them as functions, even if they aren't in `vercel.json`'s `functions` block. The 13th is `api/wa/webhook-meta.js` (Meta Cloud API webhook).
- **4 cron entries** in `vercel.json` `crons` array.

**Why webhook-meta.js is safe to delete.** Project uses Fonnte (handled by `api/wa/webhook.js`), not Meta. `api/wa/webhook-meta.js` was dead code never wired up to any Meta webhook subscription. The parallel `server/whatsapp-ai/` module is also not mounted in `server/index.js` — both are inert. (Out of scope for this plan: cleaning up `server/whatsapp-ai/`. Don't touch it.)

**Why removing 2 crons is safe.** Per the commit message of `b2613c0`: "Moka sync and expire-stale-bills now run daily as safety net. **Primary sync mechanism is on-demand await in /availability and /schedules endpoints.**" The on-demand sync via `_refreshFreshTodayData` (fix from commit `924b7ab`) is the primary mechanism. The Vercel cron was a backup. After this plan, the two pruned crons remain reachable as HTTP endpoints — external scheduler (cron-job.org) can hit them on whatever cadence the user wants.

**Verification approach.** This codebase has no test framework. Verification is the actual Vercel production deploy reaching `state: READY` (checked via Vercel MCP). Local pre-deploy verification: `node --check` syntax pass on edited files.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `api/wa/webhook-meta.js` | **Delete** | (was) Meta Cloud API webhook handler — dead code |
| `vercel.json` | **Modify** | Remove 2 of 4 cron entries; keep functions and rewrites untouched |

No other file changes. No code moved into Express.

---

### Task 1: Delete dead Meta webhook function

**Files:**
- Delete: `api/wa/webhook-meta.js`

- [ ] **Step 1: Verify webhook-meta.js is not referenced**

Run:
```bash
grep -rni "webhook-meta\|wa/webhook-meta" --include="*.js" --include="*.json" --include="*.html" --include="*.md" . || true
```

Expected output: matches only inside `api/wa/webhook-meta.js` itself (the file we're about to delete) and possibly `server/whatsapp-ai/` (separate Meta module, not in use). If you find ANY config file, route, env var, or HTML referring to `/api/wa/webhook-meta` as a live endpoint — STOP and re-confirm with the user before deleting.

- [ ] **Step 2: Delete the file**

Run:
```bash
rm "api/wa/webhook-meta.js"
```

- [ ] **Step 3: Verify function count is now 12**

Run:
```bash
find api -type f -name "*.js" | wc -l
```

Expected output: `12`

- [ ] **Step 4: Commit**

Run:
```bash
git add -A api/
git commit -m "$(cat <<'EOF'
chore: hapus api/wa/webhook-meta.js (dead code, Meta tidak dipakai)

Project pakai Fonnte (api/wa/webhook.js), bukan Meta Cloud API.
webhook-meta.js dead code, tapi Vercel auto-register sebagai function
ke-13 → lewati Hobby 12-function limit → deploy ERROR sejak b2613c0.

Function count: 13 → 12.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Prune Vercel crons from 4 to 2

**Files:**
- Modify: `vercel.json:53-58` (the `crons` array)

- [ ] **Step 1: Read the current crons array**

Run:
```bash
sed -n '53,58p' vercel.json
```

Expected: see the four entries — `reminders`, `birthday`, `moka-sync`, `expire-stale-bills`.

- [ ] **Step 2: Edit `vercel.json` to keep only 2 crons**

Open `vercel.json` and replace lines 53-58 (the `"crons"` array) with exactly:

```json
  "crons": [
    { "path": "/api/cron/reminders", "schedule": "0 3 * * *" },
    { "path": "/api/cron/birthday",  "schedule": "0 1 * * *" }
  ],
```

**Do NOT touch** the `functions` block or `rewrites` block — the two pruned cron paths (`/api/cron/moka-sync` and `/api/cron/expire-stale-bills`) must remain reachable as HTTP-triggerable functions for external scheduler (cron-job.org).

Decision rationale (keep this in mind, do not encode in code or comments):
- `reminders` is customer-facing H-1 WhatsApp reminder — critical, keep on Vercel cron.
- `birthday` is customer-facing birthday greeting — critical, keep on Vercel cron.
- `moka-sync` is safety net only (primary mechanism is on-demand sync per commit `924b7ab`) — fine to move to external scheduler.
- `expire-stale-bills` is cleanup safety net — fine to move to external scheduler.

- [ ] **Step 3: Verify vercel.json is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('OK')"
```

Expected output: `OK`

- [ ] **Step 4: Verify cron count is exactly 2**

Run:
```bash
node -e "const c=JSON.parse(require('fs').readFileSync('vercel.json','utf8')).crons; console.log('crons:', c.length); c.forEach(x=>console.log(' -', x.path, x.schedule))"
```

Expected output:
```
crons: 2
 - /api/cron/reminders 0 3 * * *
 - /api/cron/birthday 0 1 * * *
```

- [ ] **Step 5: Commit**

Run:
```bash
git add vercel.json
git commit -m "$(cat <<'EOF'
chore: pangkas vercel.json crons 4 → 2 (Hobby plan limit)

Hobby plan max 2 cron jobs. Keep customer-facing reminders & birthday
di Vercel cron. moka-sync dan expire-stale-bills tetap eksis sebagai
HTTP function (di api/cron/) — bisa di-trigger dari cron-job.org
(pattern yang sudah dipakai di commit 5311109).

Per commit 924b7ab: primary Moka sync via on-demand await di endpoint
/availability dan /schedules. Vercel cron untuk Moka cuma safety net,
aman dipindah ke external scheduler.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Deploy & verify state READY

**Files:** none modified — git push triggers Vercel.

- [ ] **Step 1: Push to main**

Run:
```bash
git push origin main
```

Expected: push succeeds, Vercel webhook fires, new deployment starts in BUILDING state.

- [ ] **Step 2: Wait for deploy to finish, then check state**

Use Vercel MCP `mcp__claude_ai_Vercel__list_deployments` with:
- `projectId: prj_WFHLGSGUzFMqERLKINHid13Y17dc`
- `teamId: team_hTyYnSffO7HztQbv0f8Nov5H`

Look at the first entry in the `deployments` array (most recent). Verify:
- `meta.githubCommitSha` matches the SHA you just pushed (run `git rev-parse HEAD` to confirm)
- `state` is `READY` (not `ERROR`, not `BUILDING`)

If still `BUILDING`, wait ~30s and recheck (typical deploy is 60–90s).

If `state: ERROR`, fetch build logs via `mcp__claude_ai_Vercel__get_deployment_build_logs` with the deployment `id` and `teamId`. Look at the last events — they will indicate which limit was still exceeded. Common possibilities:
- Function count still > 12 (re-run `find api -type f -name "*.js" | wc -l` — must be 12)
- Cron count still > 2 (re-check vercel.json)
- Different error entirely (different root cause — return to systematic-debugging Phase 1)

- [ ] **Step 3: Smoke test the production URL**

Once `state: READY`, fetch the production site once to confirm it serves:

Run:
```bash
curl -sI "https://redbox-barbershop-adhit24s-projects.vercel.app/" | head -5
```

Expected: `HTTP/2 200` (or 308 redirect — both fine; means the app is responding).

- [ ] **Step 4: Smoke test that the moka-sync endpoint still works**

The cron entry is removed, but the function file remains. Verify the endpoint still responds:

Run:
```bash
curl -sI "https://redbox-barbershop-adhit24s-projects.vercel.app/api/cron/moka-sync" | head -3
```

Expected: `HTTP/2 200` or `HTTP/2 401` (if it has auth). Anything in 2xx/4xx range proves the route is wired. A `404` would mean the function file got accidentally deleted along the way — STOP and check.

---

## Done criteria

- `api/` has exactly 12 `.js` files.
- `vercel.json` has exactly 2 cron entries.
- Latest production deploy on `main` is `state: READY`.
- Production URL returns 2xx/3xx.
- `/api/cron/moka-sync` still reachable (just not auto-scheduled by Vercel).

## Post-deploy follow-up (manual, not part of this plan)

If the user wants `moka-sync` and `expire-stale-bills` to keep running on a schedule, they need to configure cron-job.org (or any external scheduler) to hit:
- `https://<prod-domain>/api/cron/moka-sync` — daily, with the appropriate auth header (`x-admin-token` or `Authorization: Bearer <CRON_SECRET>` — see the function file for which it accepts)
- `https://<prod-domain>/api/cron/expire-stale-bills` — daily, same auth

Mention this to the user after deploy succeeds. Don't configure it yourself — it's their account.
