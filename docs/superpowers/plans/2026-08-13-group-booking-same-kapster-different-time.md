# Group Booking: Kapster Sama Jam Beda + Kapster Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let two people in a group booking pick the same kapster at different times (e.g. father at 10:00, son at 11:00), and require a double-click/double-tap to change an already-picked kapster in step 2 (solo and group).

**Architecture:** Pure vanilla JS booking wizard (`public/booking.html` + `public/js/booking.js`, no bundler, no framework). Person-1 fields stay top-level on `state` (`state.time`, `state.barber`, ...); person-2 fields live under `state.person2`. A new small pure module (`public/js/booking-time-overlap.js`, loaded via `<script>` tag, UMD-style like the existing `public/js/membership-access.js`) provides the only genuinely unit-testable piece (a time-range-overlap check). Everything else touches the existing `DOMContentLoaded` closure in `booking.js`, which has no module boundary — this repo's established pattern for testing code in that situation (see `server/test/booking-tier-discount.test.js`) is a **structural regression test**: read the source file as text with `fs.readFileSync` and assert the expected code shape exists via `assert.match(source, /regex/)`. This plan follows that same pattern for every non-pure change, plus a final manual browser verification pass.

**Tech Stack:** Vanilla JS (ES2020+), `node:test` + `node:assert/strict` for both the pure-module unit tests and the structural regression tests, no new dependencies.

## Global Constraints

- No build step for `public/` — files are served as-is, so no import/require syntax in `booking.js`/`booking-time-overlap.js` browser code (UMD wrapper only, matching `public/js/membership-access.js`).
- Run the whole test suite with `npm test` (`node --test server/test/*.test.js`) from the repo root (`d:\Digital Market\Website RedBox`) after every task.
- Line numbers cited below are accurate as of this plan's writing but are **approximate anchors, not guarantees** — always `Read` the current file content at the cited location immediately before editing (the `Edit` tool requires this anyway) rather than trusting a hand-copied old string.
- Keep the "shared date, per-person time" scope: `state.date` stays a single shared value for both people; only `time` becomes per-person. Do not touch mode 3+ (WhatsApp redirect) or the admin Next.js app (`frontend/`).
- Indonesian UI copy stays Indonesian, matching the rest of `booking.html`/`booking.js`.
- Design reference: `docs/superpowers/specs/2026-08-13-group-booking-same-kapster-different-time-design.md` (read it once before starting — it has the "why" behind every task here).

---

### Task 1: Pure time-overlap module + real unit tests

**Files:**
- Create: `public/js/booking-time-overlap.js`
- Modify: `public/booking.html` (add `<script>` tag)
- Test: `server/test/booking-time-overlap.test.js`

**Interfaces:**
- Produces: global `RedboxBookingOverlap.timeRangesOverlap(startAMin, durAMin, startBMin, durBMin) -> boolean` — pure function, no DOM/state access. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `server/test/booking-time-overlap.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { timeRangesOverlap } = require('../../public/js/booking-time-overlap.js');

test('non-overlapping ranges (B starts exactly when A ends) do not overlap', () => {
  // 10:00 (600min) + 30min duration ends at 10:30; B starts at 10:30
  assert.equal(timeRangesOverlap(600, 30, 630, 30), false);
});

test('ranges that share any minute overlap', () => {
  // A: 10:00-10:45, B: 10:30-11:00 -> overlap
  assert.equal(timeRangesOverlap(600, 45, 630, 30), true);
});

test('identical start times always overlap regardless of duration', () => {
  assert.equal(timeRangesOverlap(660, 30, 660, 30), true);
});

test('B fully contained inside A overlaps', () => {
  // A: 10:00-12:00, B: 10:30-10:45
  assert.equal(timeRangesOverlap(600, 120, 630, 15), true);
});

test('B entirely before A does not overlap', () => {
  // A: 11:00-11:30, B: 09:00-09:30
  assert.equal(timeRangesOverlap(660, 30, 540, 30), false);
});

test('module also exposes itself as a global for the browser UMD pattern', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'public', 'js', 'booking-time-overlap.js'),
    'utf8'
  );
  assert.match(src, /root\.RedboxBookingOverlap = api/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-time-overlap.test.js`
Expected: FAIL — `Cannot find module '../../public/js/booking-time-overlap.js'`

- [ ] **Step 3: Write the module**

Create `public/js/booking-time-overlap.js`. This mirrors the UMD wrapper already used by `public/js/membership-access.js` (read that file for the exact pattern) so it works both as a plain `<script>` global (`RedboxBookingOverlap`) and as a `require()`-able CommonJS module in tests:

```js
(function exposeBookingTimeOverlap(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxBookingOverlap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBookingTimeOverlap() {
  // startAMin/startBMin: minutes since midnight (e.g. 10:00 -> 600).
  // durAMin/durBMin: duration in minutes.
  // Two half-open ranges [start, start+dur) overlap iff each starts before the other ends.
  function timeRangesOverlap(startAMin, durAMin, startBMin, durBMin) {
    const aEnd = startAMin + durAMin;
    const bEnd = startBMin + durBMin;
    return (startAMin < bEnd) && (startBMin < aEnd);
  }

  return { timeRangesOverlap };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/booking-time-overlap.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the script into booking.html**

In `public/booking.html`, find the existing script include order near the bottom (`js/services-data.js`, then `js/booking-success.js`, then `js/booking.js`). Add the new module right before `js/booking.js` so it's loaded but not yet used:

```html
<script src="js/services-data.js"></script>
<script src="js/booking-time-overlap.js"></script>
```

(keep the existing `<script>` block and `js/booking-success.js`/`js/booking.js` tags exactly where they are — only insert the new line before `<script src="js/booking.js"></script>`).

- [ ] **Step 6: Confirm it loads (quick manual check, optional at this stage)**

Not required yet since nothing references `RedboxBookingOverlap` in `booking.js` until Task 6 — skip manual verification here, it's covered by Task 13's full pass.

- [ ] **Step 7: Run full suite and commit**

Run: `npm test`
Expected: all tests PASS, including the 6 new ones.

```bash
git add public/js/booking-time-overlap.js public/booking.html server/test/booking-time-overlap.test.js
git commit -m "feat: add pure time-range-overlap helper for group booking"
```

---

### Task 2: Allow the same kapster for both people in group mode

**Files:**
- Modify: `public/js/booking.js` (`step2Ready()` around line 207, kapster-card click handler around line 1281-1322)
- Test: `server/test/booking-group-kapster-time-lock.test.js` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `step2Ready()` no longer requires `state.barber.id !== state.person2.barber.id` — later tasks build on this.

- [ ] **Step 1: Write the failing test**

Create `server/test/booking-group-kapster-time-lock.test.js` (this file accumulates tests across Tasks 2-10 and 12):

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bookingJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'booking.js'), 'utf8');
const bookingHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'booking.html'), 'utf8');

test('step2Ready no longer requires the two people to have different kapster', () => {
  const fnMatch = bookingJs.match(/function step2Ready\(\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(fnMatch, 'expected to find step2Ready()');
  assert.doesNotMatch(fnMatch[0], /must be different kapster/);
  assert.doesNotMatch(fnMatch[0], /state\.barber\.id\)\s*===\s*String\(state\.person2\.barber\.id\)/);
});

test('step2Ready still requires the two people to be in the same branch', () => {
  const fnMatch = bookingJs.match(/function step2Ready\(\)\s*\{[\s\S]*?\n\s*\}/);
  assert.match(fnMatch[0], /state\.barber\.branch\s*!==\s*state\.person2\.barber\.branch/);
});

test('the kapster-card click handler no longer blocks picking the same kapster for both people', () => {
  assert.doesNotMatch(bookingJs, /Kapster ini sudah dipilih untuk orang yang lain/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL (2 of 3 assertions fail — the block and the old branch condition are still present)

- [ ] **Step 3: Edit `step2Ready()`**

Read `public/js/booking.js` around line 207 to confirm current text, then replace the function body so it only checks: both people have a barber, and both barbers are in the same branch (drop the "different kapster" check):

```js
function step2Ready() {
  if (!isGroup()) return !!state.barber;
  if (!state.barber || !state.person2?.barber) return false;
  if (state.barber.branch !== state.person2.barber.branch) return false;
  return true;
}
```

- [ ] **Step 4: Remove the same-kapster block from the click handler**

Read `public/js/booking.js` around line 1281-1300 to confirm current text (the `proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => { card.addEventListener('click', () => { ... })` block). Remove this inner block entirely, keeping everything else in the handler unchanged:

```js
        // Group mode: prevent picking same kapster for both persons
        if (isGroup()) {
          const otherBarber = state.activePerson === 1 ? state.person2?.barber : state.barber;
          if (otherBarber && String(otherBarber.id) === String(barberData.id)) {
            alert('Kapster ini sudah dipilih untuk orang yang lain. Pilih kapster berbeda agar bisa paralel di waktu yang sama.');
            return;
          }
        }

```

so the handler goes directly from building `barberData` to `setActiveBarber(barberData);`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: allow group booking to pick the same kapster for both people"
```

---

### Task 3: Per-person time state + accessors

**Files:**
- Modify: `public/js/booking.js` (state init ~line 30-44, `person2` init at ~lines 142 and 154, `getActiveBarber`/`setActiveBarber` block ~lines 148-159)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Produces: `getActiveTime() -> string|null`, `setActiveTime(t: string|null) -> void`. Consumed by Tasks 5, 6, 7, 8, 9.
- Consumes: `isGroup()`, `state.activePerson` (already exist).

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('getActiveTime/setActiveTime helpers exist next to the existing per-person accessors', () => {
  assert.match(bookingJs, /function getActiveTime\(\)\s*\{/);
  assert.match(bookingJs, /function setActiveTime\(t\)\s*\{/);
});

test('person2 gets a time field in setActiveService and setActiveBarber (the two sites this task owns)', () => {
  const setActiveServiceBody = extractFunctionBody(bookingJs, /function setActiveService\(svc\)\s*\{/);
  const setActiveBarberBody = extractFunctionBody(bookingJs, /function setActiveBarber\(b\)\s*\{/);
  assert.ok(setActiveServiceBody, 'expected to find setActiveService()');
  assert.ok(setActiveBarberBody, 'expected to find setActiveBarber()');
  assert.match(setActiveServiceBody, /state\.person2 = state\.person2 \|\| \{ name: '', service: null, barber: null, time: null \};/);
  assert.match(setActiveBarberBody, /state\.person2 = state\.person2 \|\| \{ name: '', service: null, barber: null, time: null \};/);
});

test('the setGroupSize and step-4-details person2 init sites are untouched by this task (reserved for Task 4 / intentionally left alone)', () => {
  const setGroupSizeBody = extractFunctionBody(bookingJs, /function setGroupSize\(n\)\s*\{/);
  assert.ok(setGroupSizeBody, 'expected to find setGroupSize()');
  assert.match(setGroupSizeBody, /state\.person2 = state\.person2 \|\| \{ name: '', service: null, barber: null \};/, 'setGroupSize\'s person2 init site must stay in its pre-Task-3 form; Task 4 edits it');
  assert.match(bookingJs, /state\.person2 = state\.person2 \|\| \{\};/, 'the step-4-details bare fallback must stay untouched');
});
```

**Note:** this task also adds a shared helper, `extractFunctionBody(src, signaturePattern)`, at the top of `server/test/booking-group-kapster-time-lock.test.js` (right after the `bookingJs`/`bookingHtml` constants). A naive `bookingJs.match(/function X\(\)\s*\{[\s\S]*?\n\s*\}/)` regex only captures up to the *first* closing brace after the opening one — for any function containing a nested block (`if (...) { ... }`, a `.forEach(cb => { ... })` callback, etc.) that stops at the inner block's closing brace, not the function's own one, silently truncating the match. `extractFunctionBody` instead brace-counts from the function's opening `{` to find its true matching `}`, so it works regardless of nesting depth:

```js
// Extracts a whole function body by brace-counting from its declaration,
// so nested blocks (if/else, forEach callbacks, etc.) don't cause an early
// cutoff the way a lazy "first closing brace" regex would. signaturePattern
// must match through to and include the function's own opening '{' (not
// a '{' that appears earlier, e.g. inside a default parameter value).
function extractFunctionBody(src, signaturePattern) {
  const sigMatch = src.match(signaturePattern);
  if (!sigMatch) return null;
  const start = sigMatch.index;
  const openBraceIdx = src.indexOf('{', start);
  if (openBraceIdx === -1) return null;
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}
```

All later tasks in this plan (4 onward) use this same helper instead of the naive regex pattern — look for it already present at the top of the test file rather than redefining it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL — helpers and `time: null` don't exist yet

- [ ] **Step 3: Add `time: null` to the two `setActiveService`/`setActiveBarber` init sites**

Read `public/js/booking.js` around lines 136-159 (the `getActiveService`/`setActiveService`/`getActiveBarber`/`setActiveBarber` block) to confirm current text, then change both occurrences of:

```js
    state.person2 = state.person2 || { name: '', service: null, barber: null };
```

to:

```js
    state.person2 = state.person2 || { name: '', service: null, barber: null, time: null };
```

(there are two matches in this block — one inside `setActiveService`, one inside `setActiveBarber`; update both).

- [ ] **Step 4: Add the `getActiveTime`/`setActiveTime` helpers**

Immediately after the `setActiveBarber` function closes (right after the block edited in Step 3), add:

```js
  function getActiveTime() {
    if (isGroup() && state.activePerson === 2) return state.person2?.time || null;
    return state.time;
  }
  function setActiveTime(t) {
    if (isGroup() && state.activePerson === 2) {
      state.person2 = state.person2 || { name: '', service: null, barber: null, time: null };
      state.person2.time = t;
    } else {
      state.time = t;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (6 tests) — note: this leaves 1 remaining `state.person2 = state.person2 || {...}` init site (in `setGroupSize`, handled in Task 4) and the `state.person2 = state.person2 || {}` bare fallback at the step4 details handler (~line 1718, intentionally left untouched — see Task 4 note).

- [ ] **Step 6: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: add per-person time state and getActiveTime/setActiveTime helpers"
```

---

### Task 4: Step 3 person-tabs UI (time, per person)

**Files:**
- Modify: `public/booking.html` (add `#personTabsTime` block inside `#step3`)
- Modify: `public/js/booking.js` (`setGroupSize()` ~line 246-290, `refreshPersonTabs()` ~line 162-185)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `getActiveTime()`/`setActiveTime()` from Task 3 (not called yet from this HTML — full grid switching lands in Task 5/6, this task only makes the tabs render and highlight correctly).
- Produces: `#personTabsTime` DOM element, toggled the same way as `#personTabsService`/`#personTabsBarber`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('booking.html has a personTabsTime block in step 3, mirroring personTabsBarber', () => {
  assert.match(bookingHtml, /id="personTabsTime"/);
  const step3Match = bookingHtml.match(/<!-- STEP 3: DATE & TIME -->[\s\S]*?<div class="cal-wrap">/);
  assert.ok(step3Match, 'expected to find step 3 markup before the calendar wrap');
  assert.match(step3Match[0], /id="personTabsTime"/);
});

test('setGroupSize toggles personTabsTime the same way as the other person-tab blocks', () => {
  const fnBody = extractFunctionBody(bookingJs, /function setGroupSize\(n\)\s*\{/);
  assert.ok(fnBody, 'expected to find setGroupSize()');
  assert.match(fnBody, /personTabsTime/);
});

test('refreshPersonTabs handles the time step (isTimeStep branch)', () => {
  const fnBody = extractFunctionBody(bookingJs, /function refreshPersonTabs\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find refreshPersonTabs()');
  assert.match(fnBody, /isTimeStep/);
  assert.match(fnBody, /state\.time/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL — none of this markup/logic exists yet

- [ ] **Step 3: Add the HTML block**

Read `public/booking.html` around the STEP 3 section (the `barber-off-warning` div, immediately followed by `<div class="cal-wrap">`) to confirm current text. Insert a new person-tabs block right before `<div class="cal-wrap">`, copying the exact structure/SVG check-icon markup already used by `#personTabsBarber` (read that block, ~lines 254-272, for the exact SVG path data to reuse verbatim):

```html
			<!-- PERSON TABS for Date & Time step (shown when 2 orang) -->
			<div class="person-tabs" id="personTabsTime" style="display:none">
				<button class="person-tab active" data-person="1">
					<span class="person-tab-badge">1</span>
					<span class="person-tab-label">Jam Orang 1</span>
					<span class="person-tab-status" data-status-for="1">Pilih jam</span>
					<span class="person-tab-check" aria-hidden="true">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/></svg>
					</span>
				</button>
				<button class="person-tab" data-person="2">
					<span class="person-tab-badge">2</span>
					<span class="person-tab-label">Jam Orang 2</span>
					<span class="person-tab-status" data-status-for="2">Pilih jam</span>
					<span class="person-tab-check" aria-hidden="true">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/></svg>
					</span>
				</button>
			</div>

```

(keep it immediately followed by the existing `<div class="cal-wrap">`).

- [ ] **Step 4: Wire display toggling in `setGroupSize()`**

Read `public/js/booking.js` around lines 240-290 to confirm current text. Add a `personTabsTime` constant next to the existing `personTabsService`/`personTabsBarber` ones:

```js
  const personTabsTime = document.getElementById('personTabsTime');
```

Then, inside `setGroupSize(n)`, add `personTabsTime` display toggling everywhere `personTabsBarber` is toggled (both in the `n === 3` early-return branch and the `n === 1 || n === 2` branch further down):

```js
    if (personTabsTime) personTabsTime.style.display = 'none';
```
(in the `n === 3` branch, alongside the existing `personTabsBarber.style.display = 'none';` line)

```js
    if (personTabsTime) personTabsTime.style.display = showTabs ? '' : 'none';
```
(further down, alongside the existing `personTabsBarber.style.display = showTabs ? '' : 'none';` line)

Also update the last remaining `state.person2 = state.person2 || { name: '', service: null, barber: null };` (in the `else` branch for `n !== 1`) to include `time: null`:

```js
    state.person2 = state.person2 || { name: '', service: null, barber: null, time: null };
```

- [ ] **Step 5: Extend `refreshPersonTabs()` with a time-step branch**

Read `public/js/booking.js` around lines 162-185 to confirm current text, then replace the whole function body with:

```js
  function refreshPersonTabs() {
    document.querySelectorAll('.person-tabs').forEach(tabs => {
      const isBarberStep = tabs.id === 'personTabsBarber';
      const isTimeStep = tabs.id === 'personTabsTime';
      tabs.querySelectorAll('.person-tab').forEach(t => {
        const p = parseInt(t.dataset.person, 10);
        const filled = isTimeStep
          ? (p === 1 ? !!state.time : !!state.person2?.time)
          : isBarberStep
            ? (p === 1 ? !!state.barber : !!state.person2?.barber)
            : (p === 1 ? !!state.service : !!state.person2?.service);
        t.classList.toggle('filled', filled);
        const statusEl = t.querySelector('.person-tab-status');
        if (statusEl) {
          if (filled) {
            const name = isTimeStep
              ? (p === 1 ? state.time : state.person2?.time)
              : isBarberStep
                ? (p === 1 ? state.barber?.name : state.person2?.barber?.name)
                : (p === 1 ? state.service?.name : state.person2?.service?.name);
            statusEl.textContent = name || 'Dipilih';
          } else {
            statusEl.textContent = isTimeStep ? 'Pilih jam' : (isBarberStep ? 'Pilih kapster' : 'Pilih service');
          }
        }
        t.classList.toggle('active', state.activePerson === p);
      });
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (9 tests)

- [ ] **Step 7: Commit**

```bash
git add public/booking.html public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: add per-person tabs to step 3 (time selection)"
```

---

### Task 5: Per-person availability cache in `loadAndRenderDate`

This is the core plumbing task: today `mokaAvailableSlots`/`fallbackBusyRanges`/`mokaAvailabilityActive`/`state.barberOffOnDate` are single module-scope values fetched for one barber (`state.barber`), including a live polling loop for today's date. This task makes that safe to use for two different people/barbers without one person's fetch clobbering the other's currently-displayed grid.

**Files:**
- Modify: `public/js/booking.js` (module-scope vars ~line 14-16, `loadAndRenderDate()` ~lines 782-951, `goToStep()` step-3 branch ~lines 756-778, person-tab click wiring ~lines 300-310)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `getActiveBarber()`, `getActiveService()`, `getActiveTime()`/`setActiveTime()` (Task 3), `step3Ready()` (defined in Task 6 — referenced here via a hoisted `function` declaration, safe to call before its own definition runs since both live in the same closure).
- Produces: module-scope `let personAvailabilityCache = { 1: null, 2: null };`, function `switchTimeGridToActivePerson()`. Consumed by Task 6's slot-click auto-advance and by the tab-click handler this task wires up.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('personAvailabilityCache exists as a module-scope cache keyed by person', () => {
  assert.match(bookingJs, /let personAvailabilityCache = \{ 1: null, 2: null \};/);
});

test('loadAndRenderDate accepts an opts param and only resets both people\'s time on a real date change', () => {
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.ok(fnBody, 'expected to find loadAndRenderDate()');
  assert.match(fnBody, /isDateChange/);
  assert.match(fnBody, /state\.person2\.time = null/);
});

test('loadAndRenderDate reads the active person\'s barber/service, not a single global barber', () => {
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.match(fnBody, /getActiveBarber\(\)\?\.id/);
  assert.match(fnBody, /getActiveService\(\)\?\.duration/);
});

test('loadAndRenderDate guards its final render against the user having switched person tabs mid-fetch', () => {
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.match(fnBody, /state\.activePerson !== forPerson/);
});

test('switchTimeGridToActivePerson exists and reuses cache before re-fetching', () => {
  const fnBody = extractFunctionBody(bookingJs, /function switchTimeGridToActivePerson\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find switchTimeGridToActivePerson()');
  assert.match(fnBody, /personAvailabilityCache\[state\.activePerson\]/);
  assert.match(fnBody, /loadAndRenderDate\(/);
});

test('the person-tabs click handler re-renders the time grid when switching tabs on the time step', () => {
  const listenerBody = extractFunctionBody(bookingJs, /document\.querySelectorAll\('\.person-tabs'\)\.forEach\(tabs => \{/);
  assert.ok(listenerBody, 'expected to find the person-tabs click wiring');
  assert.match(listenerBody, /personTabsTime/);
  assert.match(listenerBody, /switchTimeGridToActivePerson/);
});
```

**Important — hardening `extractFunctionBody` before this task can use it on `loadAndRenderDate`:** the helper Task 3 added (see its section above) finds the opening brace via `src.indexOf('{', start)`, where `start` is the *beginning* of the signature match. That's fine for every function used so far because none of their signatures contain a `{` before the real body brace — but `loadAndRenderDate(dateStr, dayEl = null, opts = {})` does (the `opts = {}` default). Searching for `{` from the start of the match would find that empty `{}` first and brace-count from the wrong position. Fix the helper (in `server/test/booking-group-kapster-time-lock.test.js`, near the top) to use the *end* of the signature match when the pattern itself ends with `{` (which all this plan's signature patterns do — they're written to include the function's own opening brace):

```js
function extractFunctionBody(src, signaturePattern) {
  const sigMatch = src.match(signaturePattern);
  if (!sigMatch) return null;
  const start = sigMatch.index;
  const openBraceIdx = sigMatch[0].endsWith('{')
    ? start + sigMatch[0].length - 1
    : src.indexOf('{', start + sigMatch[0].length);
  if (openBraceIdx === -1) return null;
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}
```

Replace the existing (Task 3) definition with this one — same name, same call sites elsewhere keep working unchanged since the signature patterns used so far all end with `{` and had no earlier stray `{`, so this is a strict superset fix, not a behavior change for existing callers.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL (6 new assertions fail)

- [ ] **Step 3: Add the module-scope cache variable**

Read `public/js/booking.js` lines 1-17 to confirm current text. Add, right after the existing `let fallbackBusyRanges = [];` line:

```js
let personAvailabilityCache = { 1: null, 2: null }; // per-person snapshot: { date, barberId, mokaAvailableSlots, mokaAvailabilityActive, fallbackBusyRanges, barberOffOnDate }
```

- [ ] **Step 4: Rewrite `loadAndRenderDate`**

Read `public/js/booking.js` lines 782-951 (the full `loadAndRenderDate` function) to confirm current exact text, then replace the entire function with:

```js
  async function loadAndRenderDate(dateStr, dayEl = null, opts = {}) {
    const forPerson = opts.forPerson || state.activePerson;
    const isDateChange = opts.isDateChange !== false;
    const seq = ++activeLoadSeq;

    state.date = dateStr;
    if (isDateChange) {
      state.time = null;
      if (state.person2) state.person2.time = null;
    }
    state.barberOffOnDate = false;
    mokaAvailabilityActive = false;
    mokaAvailableSlots = [];
    fallbackBusyRanges = [];

    const timeSection = document.getElementById('timeSection');
    const timeGrid = document.getElementById('timeGrid');
    if (timeSection) timeSection.style.display = '';
    if (timeGrid) {
      timeGrid.innerHTML = '<div class="time-grid-loading">Memuat jadwal...</div>';
    }
    document.getElementById('step3Next').disabled = true;

    const dayEls = document.querySelectorAll('.cal-day');
    dayEls.forEach(d => d.classList.remove('loading'));
    const selectedEl = dayEl || Array.from(dayEls).find(e => e.classList.contains('selected'));
    if (selectedEl) selectedEl.classList.add('loading');

    await new Promise(resolve => requestAnimationFrame(resolve));

    let barberIdFixed = null;
    if (USE_API) {
      const durMins = isHomeService ? 120 : _parseDurToMins(getActiveService()?.duration);
      const outletIdFixed = state.location || 'bypass';
      barberIdFixed = getActiveBarber()?.id || null;
      const promises = [];

      promises.push((async () => {
        try {
          const params = new URLSearchParams({
            outletId: outletIdFixed,
            date: dateStr,
            durationMinutes: durMins,
          });
          if (barberIdFixed) params.set('barberId', barberIdFixed);
          if (isHomeService) params.set('type', 'home_service');
          const res = await fetch(`${API_URL}/availability?${params}`, { signal: AbortSignal.timeout(12000) });
          if (res.ok) {
            const json = await res.json();
            mokaAvailableSlots = json.slots || [];
            mokaAvailabilityActive = true;
          }
        } catch (e) {
          console.warn('[Availability] Moka slot API unavailable', e.message);
        }
      })());

      if (barberIdFixed) {
        promises.push((async () => {
          try {
            const sRes = await fetch(
              `${API_URL}/schedules?outletId=${outletIdFixed}&date=${dateStr}&barberId=${barberIdFixed}`,
              { signal: AbortSignal.timeout(25000) }
            );
            if (sRes.ok) {
              const sJson = await sRes.json();
              if (sJson.schedules && sJson.schedules.length > 0) {
                fallbackBusyRanges = sJson.schedules
                  .map(s => {
                    const start = _parseDateTimeToMs(s.start_time);
                    const end = _parseDateTimeToMs(s.end_time);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                    return { start, end };
                  })
                  .filter(Boolean);
              } else {
                fallbackBusyRanges = [];
              }
            }
          } catch (e) {
            console.warn('[Schedules] Fetch error:', e.message);
          }
        })());

        promises.push((async () => {
          try {
            const tsRes = await fetch(
              `${API_URL}/barbers/today-status?date=${dateStr}`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (tsRes.ok) {
              const tsJson = await tsRes.json();
              const bs = (tsJson.barbers || []).find(b => String(b.id) === String(barberIdFixed));
              if (bs !== undefined) state.barberOffOnDate = !bs.isWorking;
            }
          } catch (e) {
            console.warn('[OffDuty] Status check failed:', e.message);
          }
        })());
      }

      await Promise.all(promises);

      const isToday = dateStr === todayStr();
      const shouldPollToday = isToday && barberIdFixed && barberIdFixed !== 'any';
      if (shouldPollToday) {
        const startedAt = Date.now();
        const maxMs = 30_000;
        const pollOnce = async () => {
          if (seq !== activeLoadSeq) return;
          if (Date.now() - startedAt > maxMs) return;
          try {
            const sRes = await fetch(
              `${API_URL}/schedules?outletId=${outletIdFixed}&date=${dateStr}&barberId=${barberIdFixed}&_t=${Date.now()}`,
              { signal: AbortSignal.timeout(25000) }
            );
            if (!sRes.ok) {
              setTimeout(pollOnce, 2200);
              return;
            }

            const sJson = await sRes.json();
            const nextRanges = (sJson.schedules || [])
              .map(s => {
                const start = _parseDateTimeToMs(s.start_time);
                const end = _parseDateTimeToMs(s.end_time);
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                return { start, end };
              })
              .filter(Boolean);

            if (seq !== activeLoadSeq) return;
            if (nextRanges.length > 0) {
              const cacheEntry = personAvailabilityCache[forPerson];
              const prevLen = cacheEntry ? cacheEntry.fallbackBusyRanges.length : 0;
              if (cacheEntry) cacheEntry.fallbackBusyRanges = nextRanges;
              if (state.activePerson === forPerson) {
                fallbackBusyRanges = nextRanges;
                if (prevLen !== nextRanges.length) {
                  requestAnimationFrame(() => {
                    if (seq !== activeLoadSeq) return;
                    if (state.activePerson !== forPerson) return;
                    buildTimeGrid([...fallbackBusyRanges]);
                    updateSidebar();
                  });
                }
              }
              return;
            }
          } catch {}

          setTimeout(pollOnce, 2200);
        };

        const needsImmediatePoll = !fallbackBusyRanges || fallbackBusyRanges.length === 0;
        if (needsImmediatePoll) {
          setTimeout(pollOnce, 900);
        }
      }
    }

    if (seq !== activeLoadSeq) return;

    personAvailabilityCache[forPerson] = {
      date: dateStr,
      barberId: barberIdFixed,
      mokaAvailableSlots: [...mokaAvailableSlots],
      mokaAvailabilityActive,
      fallbackBusyRanges: [...fallbackBusyRanges],
      barberOffOnDate: state.barberOffOnDate,
    };

    if (state.activePerson !== forPerson) return;

    if (selectedEl) selectedEl.classList.remove('loading');

    requestAnimationFrame(() => {
      if (seq !== activeLoadSeq) return;
      if (state.activePerson !== forPerson) return;
      const currentBusyRanges = fallbackBusyRanges && fallbackBusyRanges.length > 0
        ? [...fallbackBusyRanges]
        : [];
      buildCalendar();
      buildTimeGrid(currentBusyRanges);
      updateSidebar();
    });

    checkBarberOffDuty();
  }
```

- [ ] **Step 5: Add `switchTimeGridToActivePerson()`**

Add this new function directly after `loadAndRenderDate` closes:

```js
  function switchTimeGridToActivePerson() {
    if (!state.date) return;
    const cached = personAvailabilityCache[state.activePerson];
    const activeBarberId = getActiveBarber()?.id || null;
    if (cached && cached.date === state.date && cached.barberId === activeBarberId) {
      mokaAvailableSlots = cached.mokaAvailableSlots;
      mokaAvailabilityActive = cached.mokaAvailabilityActive;
      fallbackBusyRanges = cached.fallbackBusyRanges;
      state.barberOffOnDate = cached.barberOffOnDate;
      const warningEl = document.getElementById('barberOffWarning');
      const barberNameEl = document.getElementById('offDutyBarberName');
      if (warningEl) warningEl.style.display = state.barberOffOnDate ? 'block' : 'none';
      if (barberNameEl && state.barberOffOnDate) barberNameEl.textContent = getActiveBarber()?.name || '';
      buildTimeGrid(fallbackBusyRanges);
      document.getElementById('step3Next').disabled = !step3Ready();
      updateSidebar();
    } else {
      loadAndRenderDate(state.date, null, { forPerson: state.activePerson, isDateChange: false });
    }
  }
```

- [ ] **Step 6: Wire tab clicks to call it, and reset the cache when re-entering step 3**

Read `public/js/booking.js` lines 300-310 (the `.person-tabs` click listener) to confirm current text, then replace with:

```js
  document.querySelectorAll('.person-tabs').forEach(tabs => {
    tabs.addEventListener('click', e => {
      const tab = e.target.closest('.person-tab');
      if (!tab) return;
      state.activePerson = parseInt(tab.dataset.person, 10);
      refreshPersonTabs();
      refreshSvcListSelection();
      refreshBarberCardSelection();
      if (tabs.id === 'personTabsTime') {
        switchTimeGridToActivePerson();
      }
    });
  });
```

Then read `public/js/booking.js` lines 756-778 (the `if (n === 3) { ... }` branch inside `goToStep`) to confirm current text, and:
1. Add `personAvailabilityCache = { 1: null, 2: null };` right after the existing `mokaAvailableSlots = [];` reset line.
2. Change `document.getElementById('step3Next').disabled = !(state.date && state.time);` to `document.getElementById('step3Next').disabled = !step3Ready();`.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (15 tests)

- [ ] **Step 8: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: cache time-slot availability per person and re-fetch on tab switch"
```

---

### Task 6: Per-person time grid rendering + overlap guard + step3Ready gating

**Files:**
- Modify: `public/js/booking.js` (`buildTimeGrid()` ~lines 1550-1682, add `step3Ready()` near `updateStep2Cta()` ~line 237, `step3Next` click listener ~line 1694)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `getActiveBarber()`/`getActiveService()`/`getActiveTime()`/`setActiveTime()` (Task 3), `RedboxBookingOverlap.timeRangesOverlap` (Task 1), `switchTimeGridToActivePerson()` (Task 5).
- Produces: `step3Ready() -> boolean`, used by Task 5 (already referenced there) and the `step3Next` button.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('step3Ready requires both people to have a time when in group mode', () => {
  const fnBody = extractFunctionBody(bookingJs, /function step3Ready\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find step3Ready()');
  assert.match(fnBody, /state\.person2\?\.time/);
});

test('buildTimeGrid renders for the active person, not a single global barber/service/time', () => {
  const fnBody = extractFunctionBody(bookingJs, /function buildTimeGrid\(busyRanges = fallbackBusyRanges\)\s*\{/);
  assert.ok(fnBody, 'expected to find buildTimeGrid()');
  assert.match(fnBody, /const activeBarber = getActiveBarber\(\);/);
  assert.match(fnBody, /const activeService = getActiveService\(\);/);
  assert.match(fnBody, /getActiveTime\(\) === slot/);
});

test('buildTimeGrid no longer cross-checks both people against the same shared slot', () => {
  const fnBody = extractFunctionBody(bookingJs, /function buildTimeGrid\(busyRanges = fallbackBusyRanges\)\s*\{/);
  assert.doesNotMatch(fnBody, /Group mode: slot juga harus available untuk barber person 2/);
});

test('buildTimeGrid blocks slots that overlap the other person\'s time when they share a kapster', () => {
  const fnBody = extractFunctionBody(bookingJs, /function buildTimeGrid\(busyRanges = fallbackBusyRanges\)\s*\{/);
  assert.match(fnBody, /RedboxBookingOverlap\.timeRangesOverlap/);
  assert.match(fnBody, /sameBarberAsOther/);
});

test('the time-slot click handler advances the active person via setActiveTime and auto-switches to person 2', () => {
  const fnBody = extractFunctionBody(bookingJs, /function buildTimeGrid\(busyRanges = fallbackBusyRanges\)\s*\{/);
  assert.match(fnBody, /setActiveTime\(slot\)/);
  assert.match(fnBody, /state\.activePerson = 2/);
});

test('the step3Next click handler gates on step3Ready, not a shared state.time', () => {
  const listenerMatch = bookingJs.match(/document\.getElementById\('step3Next'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?\}\);/);
  assert.ok(listenerMatch, 'expected to find the step3Next click listener');
  assert.match(listenerMatch[0], /step3Ready\(\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL (6 new assertions fail)

- [ ] **Step 3: Add `step3Ready()`**

Read `public/js/booking.js` around lines 234-237 (`updateStep2Cta()`) to confirm current text, then add right after it:

```js
  function step3Ready() {
    if (!state.date) return false;
    if (!isGroup()) return !!state.time;
    return !!state.time && !!state.person2?.time;
  }
```

- [ ] **Step 4: Rewrite `buildTimeGrid`**

Read `public/js/booking.js` lines 1550-1682 (the full `buildTimeGrid` function) to confirm current exact text, then replace the entire function with:

```js
  function buildTimeGrid(busyRanges = fallbackBusyRanges) {
    const grid = document.getElementById('timeGrid');
    if (!grid) return;

    const slotsDefault = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
    const slotsCsb = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
    const slotsHomeService = ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];
    const slots = isHomeService ? slotsHomeService : (state.location === 'csb' ? slotsCsb : slotsDefault);
    const today = todayStr();
    const isToday = state.date === today;
    const floorHourMins = Math.floor(currentLocalMins() / 60) * 60;
    const visibleSlots = isToday ? slots.filter(s => timeToMins(s) > floorHourMins) : slots;

    const fragment = document.createDocumentFragment();

    if (!visibleSlots.length) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'grid-column:1/-1;color:var(--w50);font-size:.85rem;padding:8px 2px';
      emptyMsg.textContent = 'Tidak ada jam tersedia untuk hari ini. Silakan pilih tanggal lain.';
      fragment.appendChild(emptyMsg);
      grid.innerHTML = '';
      grid.appendChild(fragment);
      return;
    }

    const activeBarber = getActiveBarber();
    const activeService = getActiveService();

    const mokaFreeSet = new Set();
    if (mokaAvailabilityActive) {
      for (const s of mokaAvailableSlots) {
        const d = new Date(s.start);
        const wibH = String((d.getUTCHours() + 7) % 24).padStart(2, '0');
        const wibM = String(d.getUTCMinutes()).padStart(2, '0');
        mokaFreeSet.add(`${wibH}:${wibM}`);
      }
    }

    const hasBusyRanges = activeBarber?.id && activeBarber.id !== 'any' && busyRanges && busyRanges.length;
    const durMins = hasBusyRanges ? (isHomeService ? 120 : _parseDurToMins(activeService?.duration)) : 0;

    // Kapster yang sama dipilih 2 orang: cegah slot yang bentrok dengan jam orang lain.
    const otherPerson = state.activePerson === 1 ? 2 : 1;
    const otherBarber = otherPerson === 1 ? state.barber : state.person2?.barber;
    const otherTime = otherPerson === 1 ? state.time : state.person2?.time;
    const otherService = otherPerson === 1 ? state.service : state.person2?.service;
    const sameBarberAsOther = isGroup() && activeBarber && otherBarber && String(activeBarber.id) === String(otherBarber.id);
    const otherStartMins = sameBarberAsOther && otherTime ? timeToMins(otherTime) : null;
    const otherDurMins = sameBarberAsOther && otherTime ? (isHomeService ? 120 : _parseDurToMins(otherService?.duration)) : null;

    console.log('[TimeGrid] Building for', activeBarber?.name, 'on', state.date);
    console.log('[TimeGrid] hasBusyRanges:', hasBusyRanges, 'busyRanges:', busyRanges);

    let availableCount = 0;

    visibleSlots.forEach(slot => {
      const el = document.createElement('div');
      el.className = 'time-slot';
      el.textContent = slot;

      let isBooked = false;

      if (state.barberOffOnDate) {
        isBooked = true;
      }

      if (hasBusyRanges) {
        const slotStartMs = new Date(`${state.date}T${slot}:00+07:00`).getTime();
        const slotEndMs = slotStartMs + durMins * 60_000;
        for (let i = 0; i < busyRanges.length; i++) {
          const b = busyRanges[i];
          if (slotStartMs < b.end && slotEndMs > b.start) {
            isBooked = true;
            break;
          }
        }
      }

      if (!isBooked && mokaAvailabilityActive) {
        isBooked = !mokaFreeSet.has(slot);
      }

      if (!isBooked && !mokaAvailabilityActive) {
        isBooked = hasConflict(activeBarber?.id, state.date, slot, activeService?.duration);
      }

      if (!isBooked && otherStartMins !== null && typeof RedboxBookingOverlap !== 'undefined') {
        const slotStartMins = timeToMins(slot);
        const slotDurMins = isHomeService ? 120 : _parseDurToMins(activeService?.duration);
        if (RedboxBookingOverlap.timeRangesOverlap(slotStartMins, slotDurMins, otherStartMins, otherDurMins)) {
          isBooked = true;
          el.title = 'Bentrok dengan jadwal Orang ' + otherPerson;
        }
      }

      if (isBooked) {
        el.classList.add('unavailable');
      } else {
        availableCount++;
        if (getActiveTime() === slot) el.classList.add('selected');
        el.dataset.slot = slot;
      }

      fragment.appendChild(el);
    });

    grid.innerHTML = '';
    grid.appendChild(fragment);

    if (!grid.dataset.rbClickBound) {
      grid.dataset.rbClickBound = '1';
      grid.addEventListener('click', function timeSlotClickHandler(e) {
        const slotEl = e.target.closest('.time-slot:not(.unavailable)');
        if (!slotEl) return;

        const slot = slotEl.dataset.slot;
        if (!slot) return;

        setActiveTime(slot);
        grid.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
        slotEl.classList.add('selected');
        document.getElementById('step3Next').disabled = !step3Ready();
        refreshPersonTabs();
        updateSidebar();

        if (isGroup() && state.activePerson === 1 && !state.person2?.time) {
          state.activePerson = 2;
          refreshPersonTabs();
          switchTimeGridToActivePerson();
        }
      });
    }

    if (availableCount === 0 && (isToday || state.barberOffOnDate)) {
      const note = document.createElement('div');
      note.style.cssText = 'grid-column:1/-1;color:var(--w50);font-size:.85rem;padding:8px 2px';
      note.textContent = state.barberOffOnDate
        ? 'Kapster off duty hari ini. Silakan pilih tanggal lain.'
        : 'Semua slot hari ini sudah booked. Silakan pilih tanggal lain.';
      grid.appendChild(note);
      document.getElementById('step3Next').disabled = true;
    }
  }
```

- [ ] **Step 5: Update the `step3Next` click listener**

Read `public/js/booking.js` around line 1694 to confirm current text, then change:

```js
  document.getElementById('step3Next')?.addEventListener('click', () => {
    if (state.date && state.time) goToStep(4);
  });
```

to:

```js
  document.getElementById('step3Next')?.addEventListener('click', () => {
    if (step3Ready()) goToStep(4);
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (21 tests)

- [ ] **Step 7: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: render step 3 time grid per active person with same-kapster overlap guard"
```

---

### Task 7: Confirm summary + sidebar show per-person time

**Files:**
- Modify: `public/js/booking.js` (`buildConfirmSummary()` ~lines 1739-1804, `updateSidebar()` ~lines 1082-1084)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `state.time`, `state.person2?.time`, `isGroup()`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('buildConfirmSummary shows a per-person Jam row in group mode instead of one shared time', () => {
  const fnBody = extractFunctionBody(bookingJs, /function buildConfirmSummary\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find buildConfirmSummary()');
  assert.match(fnBody, /personRows\('Orang 1', state\.service, state\.barber, state\.name, state\.time\)/);
  assert.match(fnBody, /personRows\('Orang 2', state\.person2\?\.service, state\.person2\?\.barber, state\.person2\?\.name, state\.person2\?\.time\)/);
});

test('updateSidebar shows both people\'s time in group mode', () => {
  const fnBody = extractFunctionBody(bookingJs, /function updateSidebar\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find updateSidebar()');
  assert.match(fnBody, /groupTimeLabel/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Update `personRows`/`buildConfirmSummary`**

Read `public/js/booking.js` lines 1739-1804 (`buildConfirmSummary`) to confirm current exact text. Change the `personRows` function signature and body to accept and render a `time` param, and update its two group-mode call sites plus the now-conditional global Time row:

```js
    function personRows(label, svc, barber, name, time) {
      const addons = svc?.addons || [];
      const baseSvcPrice = svc?.basePrice
        ? (useCsb && svc.baseCsbPrice ? svc.baseCsbPrice : svc.basePrice)
        : (svc?.price || 0);
      const addonRows = addons.map(a => {
        const p = (useCsb && a.csbPrice) ? a.csbPrice : a.price;
        return `<div class="confirm-row addon-row"><span class="cr-label">${a.name}</span><span class="cr-val">${fmt(p)}</span></div>`;
      }).join('');
      return `
        ${label ? `<div class="confirm-row group-header"><span class="cr-label">${label}${name ? ' - ' + name : ''}</span><span class="cr-val">${barber?.name || '-'}</span></div>` : ''}
        <div class="confirm-row"><span class="cr-label">Service</span><span class="cr-val">${svc?.name || '-'}${addons.length ? ' - ' + fmt(baseSvcPrice) : ''}</span></div>
        ${addonRows}
        <div class="confirm-row"><span class="cr-label">Duration</span><span class="cr-val">${svc?.duration || '-'}</span></div>
        ${label ? `<div class="confirm-row"><span class="cr-label">Jam</span><span class="cr-val">${time || '-'}</span></div>` : ''}
        ${label ? '' : `<div class="confirm-row"><span class="cr-label">Professional</span><span class="cr-val">${barber?.name || '-'}</span></div>`}
      `;
    }

    const groupRows = isGroup()
      ? personRows('Orang 1', state.service, state.barber, state.name, state.time) +
        personRows('Orang 2', state.person2?.service, state.person2?.barber, state.person2?.name, state.person2?.time)
      : personRows('', state.service, state.barber);
```

Then find the global `<div class="confirm-row"><span class="cr-label">Time</span><span class="cr-val">${state.time || '-'}</span></div>` line inside the `box.innerHTML = ...` template further down in the same function, and make it conditional on solo mode:

```js
      ${isGroup() ? '' : `<div class="confirm-row"><span class="cr-label">Time</span><span class="cr-val">${state.time || '-'}</span></div>`}
```

- [ ] **Step 4: Update `updateSidebar`'s `sumDatetime`**

Read `public/js/booking.js` lines 1082-1084 to confirm current exact text, then replace:

```js
    document.getElementById('sumDatetime').textContent =
      (state.date && state.time) ? formatDate(state.date) + ', ' + state.time
      : state.date ? formatDate(state.date) : '-';
```

with:

```js
    const groupTimeLabel = (state.time && state.person2?.time)
      ? state.time + ' & ' + state.person2.time
      : (state.time || state.person2?.time || null);
    document.getElementById('sumDatetime').textContent = !state.date
      ? '-'
      : isGroup()
        ? formatDate(state.date) + (groupTimeLabel ? ', ' + groupTimeLabel : '')
        : (state.time ? formatDate(state.date) + ', ' + state.time : formatDate(state.date));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (23 tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: show per-person time in confirm summary and sidebar"
```

---

### Task 8: WhatsApp message shows per-person time

**Files:**
- Modify: `public/js/booking.js` (`_waBlockFor` and `_buildWaMessage` ~lines 1853-1896)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `state.time`, `state.person2?.time`, `isGroup()`.

**Important:** the existing `_waBlockFor` array entries use a specific leading-whitespace character for WhatsApp indentation (visually looks like 3 spaces in the source, e.g. before `Service:`, `Kapster:`) that may not be a plain ASCII space. When editing this function, copy the exact leading whitespace from an existing line in the same array (e.g. the `Kapster:` line) for the new `Jam:` line rather than retyping spaces by hand, so the WhatsApp formatting doesn't silently break.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('_waBlockFor accepts a time param and includes a Jam line when present', () => {
  const fnBody = extractFunctionBody(bookingJs, /function _waBlockFor\(label, name, svc, barber, time\)\s*\{/);
  assert.ok(fnBody, 'expected _waBlockFor to accept a time param');
  assert.match(fnBody, /Jam: ' \+ time/);
});

test('_buildWaMessage passes each person\'s own time to _waBlockFor', () => {
  const fnBody = extractFunctionBody(bookingJs, /function _buildWaMessage\(displayTotal\)\s*\{/);
  assert.ok(fnBody, 'expected to find _buildWaMessage()');
  assert.match(fnBody, /_waBlockFor\('ORANG 1', state\.name, state\.service, state\.barber, state\.time\)/);
  assert.match(fnBody, /_waBlockFor\('ORANG 2', state\.person2\?\.name, state\.person2\?\.service, state\.person2\?\.barber, state\.person2\?\.time\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Edit `_waBlockFor` and its call sites**

Read `public/js/booking.js` around lines 1853-1867 (`_waBlockFor`) to confirm the exact current text, **including the exact leading-whitespace bytes** on each line inside the returned array (copy-paste that whitespace into the new line below rather than retyping it — it may not be plain ASCII spaces). Add a `time` parameter and a conditional `Jam:` line right after the `Kapster:` line, reusing the identical leading whitespace:

```js
    function _waBlockFor(label, name, svc, barber, time) {
      const addons = svc?.addons || [];
      const addonLines = addons.map(a => {
        const p = (_useCsbWa && a.csbPrice) ? a.csbPrice : a.price;
        return '   ' + a.name + ' - ' + fmt(p); // reuse the exact indent char already used on this line, don't retype
      });
      return [
        label ? '*' + label + (name ? ' - ' + name : '') + '*' : '',
        '   Service: ' + (svc?.name || '-'), // reuse exact indent char from this existing line
        ...(addonLines.length ? ['   Add-On:', ...addonLines] : []),
        '   Duration: ' + (svc?.duration || '-'),
        '   Kapster: ' + (barber?.name || '-'),
        ...(time ? ['   Jam: ' + time] : []),
        '   Subtotal: ' + fmt(svc?.price || 0),
      ].filter(Boolean);
    }
```

(the `'   '` shown above is a stand-in — when actually editing, replace every occurrence, including the new `Jam:` line, with whatever exact leading-whitespace character the existing `Kapster:`/`Duration:`/`Subtotal:` lines already use, so all lines stay visually aligned in the WhatsApp message).

Then read lines ~1877-1896 (`_buildWaMessage`) and:
1. Pass `state.time` / `state.person2?.time` as the 5th argument at the two `_waBlockFor('ORANG 1'/'ORANG 2', ...)` call sites:

```js
          ..._waBlockFor('ORANG 1', state.name, state.service, state.barber, state.time), '',
          ..._waBlockFor('ORANG 2', state.person2?.name, state.person2?.service, state.person2?.barber, state.person2?.time), '',
```

2. Change the `' *Jadwal:* ' + (state.date ? formatDate(state.date) : '-') + ' at ' + state.time,` line so it only appends `' at ' + state.time` in solo mode (each group block now states its own time):

```js
    ' *Jadwal:* ' + (state.date ? formatDate(state.date) : '-') + (isGroup() ? '' : ' at ' + state.time),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (25 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: include per-person time in the WhatsApp booking message"
```

---

### Task 9: Booking payload + final-submit conflict recheck use per-person time

**Files:**
- Modify: `public/js/booking.js` (`_buildPayloadFor` + `payloads` ~lines 1912-1949, `finalBookBtn` conflict recheck ~lines 1837-1847)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `state.time`, `state.person2?.time`.
- Produces: each of the two POSTed booking rows (in group mode) now carries its own `time`, matching what the customer actually picked, and the `409`-conflict recheck validates each person against their own time.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('_buildPayloadFor takes a time param and both group payloads pass their own person time', () => {
  const fnBody = extractFunctionBody(bookingJs, /function _buildPayloadFor\(personIdx, name, svc, barber, time\)\s*\{/);
  assert.ok(fnBody, 'expected _buildPayloadFor to accept a time param');
  assert.match(fnBody, /time: time,/);

  const payloadsMatch = bookingJs.match(/const payloads = isGroup\(\)[\s\S]*?\];/);
  assert.ok(payloadsMatch, 'expected to find the payloads array construction');
  assert.match(payloadsMatch[0], /_buildPayloadFor\(1, state\.name, state\.service, state\.barber, state\.time\)/);
  assert.match(payloadsMatch[0], /_buildPayloadFor\(2, state\.person2\?\.name, state\.person2\?\.service, state\.person2\?\.barber, state\.person2\?\.time\)/);
});

test('the final-submit conflict recheck for person 2 uses person2.time, not the shared state.time', () => {
  assert.match(bookingJs, /hasConflict\(state\.person2\.barber\.id, state\.date, state\.person2\.time, state\.person2\.service\?\.duration\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Edit `_buildPayloadFor` and the `payloads` array**

Read `public/js/booking.js` lines 1912-1949 to confirm current exact text. Add a `time` parameter to `_buildPayloadFor` and use it for the `time:` field (instead of the current implicit `state.time`), then pass each person's own time at the two call sites:

```js
    function _buildPayloadFor(personIdx, name, svc, barber, time) {
      const addons = svc?.addons || [];
      const addonNote = addons.length ? '[ADD-ON: ' + addons.map(a => a.name).join(', ') + ']' : '';
      const noteParts = [];
      if (groupId) noteParts.push('[GROUP:' + groupId + ', ' + personIdx + '/2]');
      if (isWeddingPackage && state.address) noteParts.push('[WEDDING] Alamat: ' + state.address);
      else if (isHomeService && state.address) noteParts.push('[HOME SERVICE] Alamat: ' + state.address);
      if (addonNote) noteParts.push(addonNote);
      if (state.notes) noteParts.push(state.notes);
      const serviceFull = addons.length
        ? svc.name + ' + ' + addons.map(a => a.name).join(' + ')
        : (svc?.name || '');
      return {
        name: name || state.name,
        wa: state.wa,
        service_id: svc?.id || '',
        service: serviceFull,
        price: svc?.price || 0,
        duration: svc?.duration || '',
        barber_id: barber?.id || 'any',
        date: state.date,
        time: time,
        location: state.location,
        notes: noteParts.join('\n'),
        payment: state.payment?.name || '',
        status: 'pending',
        type: isWeddingPackage ? 'wedding' : (isHomeService ? 'home_service' : 'outlet'),
        address: isHomeService ? (state.address || '') : undefined,
        group: isGroup(),
      };
    }

    const payloads = isGroup()
      ? [
          _buildPayloadFor(1, state.name, state.service, state.barber, state.time),
          _buildPayloadFor(2, state.person2?.name, state.person2?.service, state.person2?.barber, state.person2?.time),
        ]
      : [_buildPayloadFor(1, state.name, state.service, state.barber, state.time)];
```

- [ ] **Step 4: Fix the final-submit conflict recheck**

Read `public/js/booking.js` around lines 1837-1847 (start of the `finalBookBtn` click handler) to confirm current text, then change:

```js
    if (isGroup() && state.person2?.barber && hasConflict(state.person2.barber.id, state.date, state.time, state.person2.service?.duration)) {
```

to:

```js
    if (isGroup() && state.person2?.barber && hasConflict(state.person2.barber.id, state.date, state.person2.time, state.person2.service?.duration)) {
```

(only the third argument changes, from `state.time` to `state.person2.time`).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (27 tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "fix: submit each person's own time in the booking payload and conflict recheck"
```

---

### Task 10: Fix `refreshBarberCardSelection()` selector bug

**Files:**
- Modify: `public/js/booking.js` (~lines 194-200)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- No new interfaces — this is a bugfix prerequisite for Task 12's lock UI to correctly reflect the active person's selection when switching tabs.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('refreshBarberCardSelection targets the real kapster card class (.pro-pick-card), not the unused .barber-card', () => {
  const fnBody = extractFunctionBody(bookingJs, /function refreshBarberCardSelection\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find refreshBarberCardSelection()');
  assert.match(fnBody, /querySelectorAll\('\.pro-pick-card'\)/);
  assert.doesNotMatch(fnBody, /querySelectorAll\('\.barber-card'\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL — current selector is `.barber-card`, which matches no elements (the rendered cards use `.pro-pick-card`), so this highlight never updates on tab switch today

- [ ] **Step 3: Fix the selector**

Read `public/js/booking.js` lines 194-200 to confirm current text, then change:

```js
  function refreshBarberCardSelection() {
    const activeB = getActiveBarber();
    document.querySelectorAll('.barber-card').forEach(c => {
      c.classList.toggle('selected', !!activeB && String(c.dataset.barber) === String(activeB.id));
    });
  }
```

to:

```js
  function refreshBarberCardSelection() {
    const activeB = getActiveBarber();
    document.querySelectorAll('.pro-pick-card').forEach(c => {
      c.classList.toggle('selected', !!activeB && String(c.dataset.barber) === String(activeB.id));
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (28 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "fix: refreshBarberCardSelection now targets the actual kapster card class"
```

---

### Task 11: CSS for the double-tap lock hint

**Files:**
- Modify: `public/css/booking.css` (`.pro-pick-card` block ~line 211-218, new rules after ~line 286)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Produces: CSS classes `.change-hint-badge` / `.change-hint-badge.visible`, consumed by `showChangeHint()` in Task 12.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
const bookingCss = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'booking.css'), 'utf8');

test('.pro-pick-card disables native double-tap-to-zoom so our manual double-click detection works on mobile', () => {
  const ruleMatch = bookingCss.match(/\.pro-pick-card\{[^}]*\}/);
  assert.ok(ruleMatch, 'expected to find the .pro-pick-card rule');
  assert.match(ruleMatch[0], /touch-action:\s*manipulation/);
});

test('.change-hint-badge styles exist for the "tap again to change kapster" hint', () => {
  assert.match(bookingCss, /\.change-hint-badge\{/);
  assert.match(bookingCss, /\.change-hint-badge\.visible\{/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Add `touch-action` to `.pro-pick-card`**

Read `public/css/booking.css` lines 211-218 to confirm current text, then change:

```css
.pro-pick-card{
	background:var(--bg-3);border:2px solid var(--w10);border-radius:16px;
	overflow:hidden;cursor:pointer;transition:all .25s;
	display: flex;
	flex-direction: column;
	height: 100%;
	position: relative;
}
```

to:

```css
.pro-pick-card{
	background:var(--bg-3);border:2px solid var(--w10);border-radius:16px;
	overflow:hidden;cursor:pointer;transition:all .25s;
	display: flex;
	flex-direction: column;
	height: 100%;
	position: relative;
	touch-action: manipulation;
}
```

- [ ] **Step 4: Add the hint badge styles**

Read `public/css/booking.css` around line 286-288 (`.pro-pick-card.selected .pro-pick-info h4{color:var(--red)}` right before the STEP 3 CSS comment block) to confirm current text, then add right after that line:

```css
.change-hint-badge{
	position:absolute;inset:0;z-index:3;
	display:flex;align-items:center;justify-content:center;
	background:rgba(10,10,10,.72);color:#fff;font-size:.72rem;font-weight:700;
	text-align:center;padding:10px;border-radius:14px;
	opacity:0;pointer-events:none;transition:opacity .2s;
}
.change-hint-badge.visible{opacity:1}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (30 tests)

- [ ] **Step 6: Commit**

```bash
git add public/css/booking.css server/test/booking-group-kapster-time-lock.test.js
git commit -m "style: add touch-action and change-hint badge styles for kapster card lock"
```

---

### Task 12: Lock kapster selection behind a double-click/double-tap

**Files:**
- Modify: `public/js/booking.js` (kapster-card click handler ~lines 1281-1322, as already modified by Task 2)
- Test: `server/test/booking-group-kapster-time-lock.test.js`

**Interfaces:**
- Consumes: `getActiveBarber()` (existing), `.change-hint-badge` CSS (Task 11).
- Produces: `showChangeHint(card)` helper.

- [ ] **Step 1: Write the failing test**

Append to `server/test/booking-group-kapster-time-lock.test.js`:

```js
test('showChangeHint helper exists and toggles the .visible class with a timeout', () => {
  const fnBody = extractFunctionBody(bookingJs, /function showChangeHint\(card\)\s*\{/);
  assert.ok(fnBody, 'expected to find showChangeHint()');
  assert.match(fnBody, /change-hint-badge/);
  assert.match(fnBody, /setTimeout/);
});

test('the kapster-card click handler requires a second click within 400ms to change an already-picked kapster', () => {
  const clickHandlerBody = extractFunctionBody(bookingJs, /proPickGrid\.querySelectorAll\('\.pro-pick-card'\)\.forEach\(card => \{/);
  assert.ok(clickHandlerBody, 'expected to find the kapster-card click handler');
  assert.match(clickHandlerBody, /currentActive/);
  assert.match(clickHandlerBody, /isSameCard/);
  assert.match(clickHandlerBody, /now - last > 400/);
  assert.match(clickHandlerBody, /showChangeHint\(card\)/);
});

test('the first pick for a person (no current kapster yet) does not require a double click', () => {
  const clickHandlerBody = extractFunctionBody(bookingJs, /proPickGrid\.querySelectorAll\('\.pro-pick-card'\)\.forEach\(card => \{/);
  assert.match(clickHandlerBody, /if \(currentActive && !isSameCard\) \{/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: FAIL

- [ ] **Step 3: Add `showChangeHint`**

Read `public/js/booking.js` around the top of the "STEP 3: PROFESSIONAL (Dynamic Rendering)" section (~line 1135-1140) to confirm current text, then add right before `const proPickGrid = document.getElementById('proPickGrid');`:

```js
  function showChangeHint(card) {
    let badge = card.querySelector('.change-hint-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'change-hint-badge';
      badge.textContent = 'Ketuk sekali lagi untuk ganti kapster';
      card.appendChild(badge);
    }
    badge.classList.add('visible');
    clearTimeout(card._hintTimer);
    card._hintTimer = setTimeout(() => badge.classList.remove('visible'), 1500);
  }

```

- [ ] **Step 4: Restructure the kapster-card click handler**

Read `public/js/booking.js` around lines 1281-1322 (the current state after Task 2's removal — starts with `proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => { card.addEventListener('click', () => {` and ends with the closing `});` `});`) to confirm exact current text, then replace the whole handler with:

```js
    proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => {
      card.addEventListener('click', () => {
        if (card.dataset.barber === 'none') return;

        const barberData = { id: card.dataset.barber, name: card.dataset.barberName, branch: card.dataset.branch };
        const currentActive = getActiveBarber();
        const isSameCard = currentActive && String(currentActive.id) === String(barberData.id);

        if (currentActive && !isSameCard) {
          const now = Date.now();
          const last = Number(card.dataset.lastTap || 0);
          card.dataset.lastTap = String(now);
          if (now - last > 400) {
            showChangeHint(card);
            return;
          }
          card.dataset.lastTap = '0';
        }

        setActiveBarber(barberData);
        refreshBarberCardSelection();
        mokaAvailabilityActive = false;
        mokaAvailableSlots = [];
        fallbackBusyRanges = [];

        // Auto-select branch if available (di-share antar person - cabang sama)
        if (card.dataset.branch && card.dataset.branch !== 'any') {
          state.location = card.dataset.branch;
          const locSel = document.getElementById('custLocation');
          if (locSel) locSel.value = state.location;
        }

        // Apply CSB-specific pricing when CSB branch is selected - untuk SEMUA service person
        applyCsbPricingTo(state.service);
        if (isGroup()) applyCsbPricingTo(state.person2?.service);

        // Group mode: auto-switch ke tab person 2 jika belum dipilih
        if (isGroup() && state.activePerson === 1 && !state.person2?.barber) {
          state.activePerson = 2;
          refreshBarberCardSelection();
        }
        refreshPersonTabs();
        updateStep2Cta();
        updateSidebar();
      });
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/booking-group-kapster-time-lock.test.js`
Expected: PASS (33 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests across the whole repo PASS.

- [ ] **Step 7: Commit**

```bash
git add public/js/booking.js server/test/booking-group-kapster-time-lock.test.js
git commit -m "feat: require a double-click/double-tap to change an already-picked kapster"
```

---

### Task 13: Manual browser verification

No automated test can exercise the full DOM/network flow for this vanilla-JS page — this task is a manual pass using the dev server, following the repo's `run` skill guidance for launching the app.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run `npm run dev` from the repo root (or use the project's `run` skill if one is registered for this repo) and open `http://localhost:3001/booking.html` (or whatever port `server/index.js` binds) in a browser.

- [ ] **Step 2: Verify solo booking still works end-to-end**

Pick a service, pick a kapster (single click), pick a date+time, fill details, confirm. No person tabs should appear anywhere. Kapster card should show the new "locked" behavior: after picking, clicking a *different* card once shows the "Ketuk sekali lagi untuk ganti kapster" hint instead of switching; clicking it again within ~400ms actually switches.

- [ ] **Step 3: Verify group booking with two different kapsters (existing behavior, must still work)**

Switch to "2 orang". Pick different services for Orang 1/Orang 2. Pick two *different* kapster (same branch). Confirm step 3 now shows "Jam Orang 1" / "Jam Orang 2" tabs; pick different times for each; confirm summary/WA message/submitted bookings show each person's own time.

- [ ] **Step 4: Verify the target scenario — same kapster, different time**

In "2 orang" mode, pick the **same kapster** for both Orang 1 and Orang 2 (should now be allowed, no alert). In step 3, pick a time for Orang 1 (e.g. 10:00), switch to the Orang 2 tab, and confirm the slot that would overlap Orang 1's booking (given their service duration) is greyed out/unavailable, while a non-overlapping slot (e.g. 11:00) is pickable. Complete the booking and confirm both bookings land correctly (check the admin bookings page or Supabase `bookings` table for two rows with the same `barber_id`, same `date`, different `time`).

- [ ] **Step 5: Verify tab-switching preserves picks and doesn't refetch unnecessarily**

Switch back and forth between Orang 1/Orang 2 tabs a few times in step 3 after both have picked times — confirm neither person's time selection is lost, and switching back to an already-visited tab doesn't show a loading spinner (served from cache).

- [ ] **Step 6: Verify off-duty and busy-slot rendering still works per person**

If possible, pick a kapster who is off-duty today for one person and on-duty for the other (or simulate via an already-busy slot) — confirm the off-duty warning and slot-blocking apply to the correct person's tab only.

- [ ] **Step 7: No commit for this task** — if any bug is found, go back and fix it in the relevant earlier task's commit lineage (new fixup commit), then re-run this manual pass.
