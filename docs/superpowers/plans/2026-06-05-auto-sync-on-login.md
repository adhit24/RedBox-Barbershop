# Auto-Sync Moka on Member Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pull fresh Moka data when a returning member logs in, with a barbershop-themed animated loading screen between OTP success and the dashboard.

**Architecture:** After OTP verify succeeds, redirect to `member-loading.html` instead of directly to the dashboard. That page calls a new member-authenticated endpoint `POST /api/member/sync` which runs Moka sync using server-side admin credentials. On completion (or failure), the page shows a light toast if sync failed, then redirects to `member-dashboard.html`.

**Tech Stack:** Vanilla JS, HTML/CSS (no framework), Express.js (server/index.js), Supabase, Moka POS API via existing MokaClient

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/index.js` | **Modify** | Add `POST /api/member/sync` endpoint (member token auth, calls Moka) |
| `member-loading.html` | **Create** | Loading UI — spinner, name, cycling copy, toast |
| `js/member-loading.js` | **Create** | Timing logic, sync call, localStorage update, redirect |
| `member-login.html` | **Modify** | Lines 467 + 559: change redirect target to `member-loading.html` |

---

## Task 1: Add `POST /api/member/sync` to server/index.js

**Files:**
- Modify: `server/index.js` — insert after line 2332 (after the closing `});` of GET /api/auth/me)

- [ ] **Step 1.1: Insert the new endpoint**

Open `server/index.js`. After line 2332 (the `});` that closes `GET /api/auth/me`), insert:

```js
 // POST /api/member/sync — tarik data Moka fresh untuk member yang login
 app.post('/api/member/sync', async (req, res) => {
 if (!supabase) return res.status(503).json({ error: 'Database tidak tersedia' });
 const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || req.headers['x-member-token'];
 if (!token) return res.status(401).json({ error: 'Login diperlukan' });

 const { data: session } = await supabase.from('member_sessions')
 .select('customer_wa').eq('token', token)
 .gt('expires_at', new Date().toISOString()).maybeSingle();
 if (!session) return res.status(401).json({ success: false, error: 'Session expired' });

 const wa = session.customer_wa;
 const digits = String(wa).replace(/\D/g, '');
 const waNorm = digits.startsWith('62') ? digits : '62' + (digits.startsWith('0') ? digits.slice(1) : digits);
 const phoneE164 = '+' + waNorm;
 const normPhone = (raw) => {
 if (!raw) return '';
 let d = String(raw).replace(/\D/g, '');
 if (d.startsWith('62')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1);
 return d.slice(-11);
 };
 const targetNorm = normPhone(wa);

 const { data: outlets } = await supabase
 .from('outlets').select('id,slug,name,moka_outlet_id')
 .not('moka_outlet_id', 'is', null).eq('is_active', true);
 if (!outlets?.length) return res.json({ success: false, error: 'No active outlets' });

 const PAGE_DELAY_MS = 150;
 const MAX_BUDGET_MS = 8000;
 const POINTS_PER_VISIT = 50;
 const TIER_THRESHOLDS = [
 { name: 'platinum', min: 3000 },
 { name: 'gold', min: 1000 },
 { name: 'silver', min: 500 },
 { name: 'bronze', min: 0 },
 ];
 const getTier = (pts) => { for (const t of TIER_THRESHOLDS) if (pts >= t.min) return t.name; return 'bronze'; };

 let totalVisits = 0, totalSpent = 0, lastVisit = null, firstVisit = null;
 const startTime = Date.now();

 try {
 for (const outlet of outlets) {
 if (Date.now() - startTime > MAX_BUDGET_MS) break;
 const MokaClient = require('./moka/client');
 const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
 let sinceEpoch = null;
 while (true) {
 if (Date.now() - startTime > MAX_BUDGET_MS) break;
 let json;
 try { json = await client.getTransactionPage({ sinceEpoch, limit: 100 }); }
 catch (err) { if (err.status === 404 || err.status === 403) break; throw err; }
 const payments = json?.data?.payments ?? [];
 for (const p of payments) {
 if (p.is_deleted || p.is_refunded) continue;
 const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
 if (norm !== targetNorm) continue;
 totalVisits++;
 totalSpent += Number(p.total_collected || p.total_transaction || 0);
 const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
 if (txDate && (!lastVisit || txDate > lastVisit)) lastVisit = txDate;
 if (txDate && (!firstVisit || txDate < firstVisit)) firstVisit = txDate;
 }
 if (json?.data?.completed || !payments.length) break;
 const m2 = (json?.data?.next_url || '').match(/[?&]since=([0-9.]+)/);
 if (!m2) break;
 sinceEpoch = parseFloat(m2[1]);
 await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
 }
 }

 const newPoints = totalVisits * POINTS_PER_VISIT;
 const newTier = getTier(newPoints);
 const now = new Date().toISOString();

 const custPatch = { visits: totalVisits, points: newPoints, total_spent: totalSpent, last_visit: lastVisit, updated_at: now };
 if (firstVisit) custPatch.first_visit = firstVisit;
 await supabase.from('customers').update(custPatch).eq('wa', waNorm);

 const { data: existing } = await supabase.from('member_profiles')
 .select('id,full_name,phone').eq('phone', phoneE164).maybeSingle();

 if (existing) {
 await supabase.from('member_profiles').update({
 total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
 membership_status: 'ACTIVE', updated_at: now,
 }).eq('id', existing.id);
 } else {
 const { data: cust } = await supabase.from('customers')
 .select('name,email,referral_code,membership_activated_at')
 .eq('wa', waNorm).maybeSingle();
 const phoneNormShort = targetNorm;
 const userKey = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}`;
 const email = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}@redbox.internal`;
 await supabase.from('member_profiles').upsert({
 user_key: userKey, email, full_name: cust?.name || '', phone: phoneE164,
 membership_status: 'ACTIVE', membership_activated_at: cust?.membership_activated_at || now,
 total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
 }, { onConflict: 'user_key' });
 }

 const { data: custData } = await supabase.from('customers').select('name').eq('wa', waNorm).maybeSingle();

 return res.json({
 success: true,
 full_name: existing?.full_name || custData?.name || '',
 visits: totalVisits, points: newPoints, tier: newTier,
 last_visit: lastVisit, first_visit: firstVisit, total_spent: totalSpent,
 });
 } catch (err) {
 console.error('[MemberSync]', err.message);
 return res.status(500).json({ success: false, error: err.message });
 }
 });
```

- [ ] **Step 1.2: Manual smoke test (no automated test — Moka API requires live credentials)**

Start the server:
```bash
node server/index.js
```
Then test with a known member token (from browser localStorage `rb_member_token` after login):
```bash
curl -s -X POST http://localhost:3001/api/member/sync \
 -H "Authorization: Bearer YOUR_TOKEN_HERE" | jq .
```
Expected: `{ "success": true, "visits": N, "points": N, ... }`

Test with invalid token:
```bash
curl -s -X POST http://localhost:3001/api/member/sync \
 -H "Authorization: Bearer invalid" | jq .
```
Expected: `{ "error": "Session expired" }` with status 401

- [ ] **Step 1.3: Commit**

```bash
git add server/index.js
git commit -m "feat(member): add POST /api/member/sync endpoint (member-auth Moka pull)"
```

---

## Task 2: Create `js/member-loading.js`

**Files:**
- Create: `js/member-loading.js`

- [ ] **Step 2.1: Create the file**

```js
(function () {
 const COPY = [
 'Sedang mempersiapkan kursi hangat untukmu...',
 'Kapster lagi ngasihin minyak rambut dulu...',
 'Sebentar ya, sisirnya lagi dicuci...',
 'Data kamu hampir siap, sabar dulu bang!',
 ];
 const MIN_DISPLAY_MS = 2500;
 const CLIENT_TIMEOUT_MS = 10000;

 const token = localStorage.getItem('rb_member_token');
 if (!token) { window.location.href = 'member-login.html'; return; }

 const memberData = JSON.parse(localStorage.getItem('redbox_member') || '{}');
 const name = memberData.name || memberData.full_name || 'Sobat RedBox';

 const nameEl = document.getElementById('member-name');
 const copyEl = document.getElementById('loading-copy');
 const toastEl = document.getElementById('sync-toast');
 if (nameEl) nameEl.textContent = name;
 if (copyEl) copyEl.textContent = COPY[0];

 let idx = 0;
 const cycleTimer = setInterval(() => {
 idx = (idx + 1) % COPY.length;
 if (copyEl) copyEl.textContent = COPY[idx];
 }, 2500);

 const fetchSync = fetch('/api/member/sync', {
 method: 'POST',
 headers: { 'Authorization': 'Bearer ' + token },
 }).then(r => r.json()).catch(() => ({ success: false }));

 const syncPromise = Promise.race([
 fetchSync,
 new Promise(r => setTimeout(() => r({ success: false, error: 'timeout' }), CLIENT_TIMEOUT_MS)),
 ]);

 const minWait = new Promise(r => setTimeout(r, MIN_DISPLAY_MS));

 Promise.all([syncPromise, minWait]).then(function (results) {
 clearInterval(cycleTimer);
 var data = results[0];

 if (data && data.success) {
 var updated = Object.assign({}, memberData, {
 visits: data.visits,
 points: data.points,
 tier: data.tier,
 lastVisit: data.last_visit,
 joinDate: data.first_visit || memberData.joinDate,
 totalSpent: data.total_spent,
 full_name: data.full_name || memberData.full_name,
 name: data.full_name || memberData.name,
 });
 localStorage.setItem('redbox_member', JSON.stringify(updated));
 window.location.href = 'member-dashboard.html';
 } else {
 if (toastEl) {
 toastEl.textContent = 'Data tidak sempat diperbarui, tapi tetap bisa dipakai ya! ';
 toastEl.style.opacity = '1';
 }
 setTimeout(function () {
 window.location.href = 'member-dashboard.html';
 }, 2000);
 }
 });
})();
```

- [ ] **Step 2.2: Verify file exists**

```bash
ls js/member-loading.js
```
Expected: file listed

---

## Task 3: Create `member-loading.html`

**Files:**
- Create: `member-loading.html`

- [ ] **Step 3.1: Create the file**

```html
<!DOCTYPE html>
<html lang="id">
<head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>RedBox — Memuat...</title>
 <style>
 * { margin: 0; padding: 0; box-sizing: border-box; }
 body {
 min-height: 100vh;
 background: #0a0a0a;
 display: flex;
 flex-direction: column;
 align-items: center;
 justify-content: center;
 font-family: system-ui, -apple-system, sans-serif;
 color: #fff;
 gap: 20px;
 user-select: none;
 }
 .spinner {
 width: 56px;
 height: 56px;
 border-radius: 50%;
 border: 4px solid #222;
 border-top: 4px solid #ef4444;
 border-right: 4px solid #f5f5f5;
 animation: spin 1s linear infinite;
 }
 @keyframes spin { to { transform: rotate(360deg); } }
 .welcome {
 font-size: 1.1rem;
 font-weight: 700;
 letter-spacing: 0.3px;
 }
 #loading-copy {
 color: #6b7280;
 font-size: 0.85rem;
 text-align: center;
 max-width: 240px;
 line-height: 1.6;
 min-height: 2.8em;
 }
 #sync-toast {
 position: fixed;
 bottom: 32px;
 left: 50%;
 transform: translateX(-50%);
 background: #1e293b;
 border: 1px solid #334155;
 color: #94a3b8;
 font-size: 0.78rem;
 padding: 10px 18px;
 border-radius: 12px;
 opacity: 0;
 transition: opacity 0.4s;
 text-align: center;
 max-width: 280px;
 white-space: nowrap;
 }
 </style>
</head>
<body>
 <div class="spinner"></div>
 <p class="welcome">Selamat datang, <span id="member-name">Sobat RedBox</span>! </p>
 <p id="loading-copy">Sedang mempersiapkan kursi hangat untukmu...</p>
 <div id="sync-toast"></div>
 <script src="js/member-loading.js?v=20260605"></script>
</body>
</html>
```

- [ ] **Step 3.2: Open in browser and verify visual**

Open `member-loading.html` directly in browser (via live server or file://). You should see:
- Black background, red+white spinning circle
- Text "Selamat datang, Sobat RedBox! "
- Copy text cycling every 2.5 seconds through the 4 messages
- After ~2.5s it will try to redirect (token missing → goes to member-login.html) — that's expected

- [ ] **Step 3.3: Commit**

```bash
git add js/member-loading.js member-loading.html
git commit -m "feat(member): add member-loading.html with barbershop loading animation"
```

---

## Task 4: Wire up member-login.html

**Files:**
- Modify: `member-login.html` lines 467 and 559

- [ ] **Step 4.1: Change OTP success redirect (line 467)**

Find this line in `member-login.html`:
```js
 setTimeout(() => { window.location.href = 'member-dashboard.html'; }, 1200);
```
Replace with:
```js
 setTimeout(() => { window.location.href = 'member-loading.html'; }, 1200);
```

- [ ] **Step 4.2: Change auto-redirect for already-logged-in users (line 559)**

Find this line in `member-login.html`:
```js
 window.location.href = 'member-dashboard.html';
```
(This is inside the `if (res.ok)` block of the auto-redirect check at the top of the page.)

Replace with:
```js
 window.location.href = 'member-loading.html';
```

- [ ] **Step 4.3: Verify both changes are present**

```bash
grep -n "member-loading\|member-dashboard" member-login.html
```
Expected output: two lines with `member-loading.html`, zero lines with `member-dashboard.html` (for redirects — the word may still appear in comments or other contexts).

- [ ] **Step 4.4: End-to-end test in browser**

1. Open `member-login.html`
2. Enter a valid WA number and request OTP
3. Enter OTP → verify
4. Should redirect to `member-loading.html` (black screen, spinner, name, cycling copy)
5. After sync + 2.5s min display → redirect to `member-dashboard.html`
6. Dashboard should show fresh visit count, points, and correct "Bergabung sejak" date

**Test failure path:**
- Temporarily change the endpoint URL in `member-loading.js` to `/api/member/sync-BROKEN`
- Login again → loading page → after 10s timeout → toast "Data tidak sempat diperbarui..." appears → 2s later → redirect to dashboard
- Revert the URL

- [ ] **Step 4.5: Commit**

```bash
git add member-login.html
git commit -m "feat(member): redirect to loading screen after OTP login for Moka auto-sync"
```

---

## Task 5: Push and verify on production

- [ ] **Step 5.1: Push to remote**

```bash
git push
```

- [ ] **Step 5.2: Verify Vercel deployment**

Monitor deployment at https://vercel.com/dashboard (project: redboxbarbershop.com / prj_WFHLGSGUzFMqERLKINHid13Y17dc).

Wait for deployment to go green.

- [ ] **Step 5.3: Production smoke test**

On a real device:
1. Open `redboxbarbershop.com/member-login.html`
2. Login with a known member's WA number
3. Confirm loading screen appears with correct name
4. Confirm redirect to dashboard with fresh data after sync completes

---

## Self-Review

**Spec coverage:**
- OTP → loading page redirect (Task 4)
- "Welcome back [Nama]" (Task 3 — `member-name` span)
- Cycling funny copy (Task 2 — `COPY` array + `setInterval`)
- Moka sync in background (Task 1 — `POST /api/member/sync`)
- Minimum display time 2.5s (Task 2 — `MIN_DISPLAY_MS`)
- Client-side 10s timeout (Task 2 — `Promise.race`)
- Save fresh data to localStorage (Task 2 — `localStorage.setItem`)
- Redirect to dashboard after sync (Task 2)
- Light toast notification on failure (Task 2 — `toastEl`, Task 3 — `#sync-toast`)
- Fallback redirect if no token (Task 2 — line 1 check)

**Placeholder scan:** No TBD/TODO found.

**Type consistency:** `data.full_name`, `data.visits`, `data.points`, `data.tier`, `data.last_visit`, `data.first_visit`, `data.total_spent` — all match the response shape from Task 1.
