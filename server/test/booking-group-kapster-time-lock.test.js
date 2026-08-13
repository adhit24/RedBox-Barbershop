'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bookingJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'booking.js'), 'utf8');
const bookingHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'booking.html'), 'utf8');

// Extracts a whole function body by brace-counting from its declaration,
// so nested blocks (if/else, forEach callbacks, etc.) don't cause an early
// cutoff the way a lazy "first closing brace" regex would.
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

test('after Task 4: setGroupSize person2 init site now has time field, step-4-details still untouched', () => {
  const setGroupSizeBody = extractFunctionBody(bookingJs, /function setGroupSize\(n\)\s*\{/);
  assert.ok(setGroupSizeBody, 'expected to find setGroupSize()');
  assert.match(setGroupSizeBody, /state\.person2 = state\.person2 \|\| \{ name: '', service: null, barber: null, time: null \};/, 'setGroupSize\'s person2 init site now has time field (Task 4 edit)');
  assert.match(bookingJs, /state\.person2 = state\.person2 \|\| \{\};/, 'the step-4-details bare fallback must stay untouched');
});

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

test('loadAndRenderDate writes in-flight fetch results to local variables, not directly to the shared module-scope vars', () => {
  // An abandoned fetch (user switched person/date before it settles) must not be able
  // to corrupt mokaAvailableSlots/mokaAvailabilityActive/fallbackBusyRanges/
  // state.barberOffOnDate directly - those writes have to go through locals first and
  // get "published" only after a seq/activePerson check (see the next test).
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.ok(fnBody, 'expected to find loadAndRenderDate()');
  assert.match(fnBody, /localMokaSlots = json\.slots \|\| \[\];/);
  assert.match(fnBody, /localMokaActive = true;/);
  assert.match(fnBody, /localBusyRanges = sJson\.schedules/);
  assert.match(fnBody, /localBarberOffOnDate = !bs\.isWorking;/);
  // The old unguarded direct-write forms must be gone from the fetch callbacks.
  assert.doesNotMatch(fnBody, /\n\s*mokaAvailableSlots = json\.slots/);
  assert.doesNotMatch(fnBody, /\n\s*mokaAvailabilityActive = true;/);
  assert.doesNotMatch(fnBody, /\n\s*fallbackBusyRanges = sJson\.schedules/);
  assert.doesNotMatch(fnBody, /\n\s*state\.barberOffOnDate = !bs\.isWorking;/);
});

test('the four local fetch-result variables are declared at function scope, not inside the if (USE_API) block', () => {
  // Regression guard: these four `let` bindings were briefly declared *inside*
  // `if (USE_API) { ... }`, which made them block-scoped. Since the cache-build and
  // publish steps read them *after* that block closes, that shape threw
  // `ReferenceError: localMokaSlots is not defined` on every single call to
  // loadAndRenderDate (not just the race-condition scenario) - a fully broken step 3.
  // The fix mirrors how `barberIdFixed` was already hoisted to function scope for the
  // same reason (it too is written inside the block and read after it).
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.ok(fnBody, 'expected to find loadAndRenderDate()');

  // Match the real block opener specifically (immediately followed by a newline),
  // not any mention of the literal text `if (USE_API) {` inside a comment.
  const useApiBlockMatch = fnBody.match(/if \(USE_API\) \{\r?\n/);
  assert.ok(useApiBlockMatch, 'expected the if (USE_API) { block');
  const idxUseApiBlock = useApiBlockMatch.index;

  for (const name of ['localMokaSlots', 'localMokaActive', 'localBusyRanges', 'localBarberOffOnDate']) {
    const declRe = new RegExp(`let ${name} = `);
    const declMatch = fnBody.match(declRe);
    assert.ok(declMatch, `expected a \`let ${name} = ...\` declaration`);
    assert.ok(
      declMatch.index < idxUseApiBlock,
      `\`${name}\` must be declared before \`if (USE_API) {\` (function-scoped), not inside it`
    );
    // Exactly one `let` declaration for this name in the whole function - if a second
    // `let name = ...` snuck back in inside the if-block (re-declaring/shadowing the
    // function-scoped one), later reads outside the block would silently read the
    // *outer* (never-assigned) binding instead of throwing, which text-matching a
    // single occurrence elsewhere wouldn't catch on its own.
    const allDecls = fnBody.match(new RegExp(`let ${name} = `, 'g')) || [];
    assert.equal(allDecls.length, 1, `expected exactly one \`let ${name} = ...\` declaration, found ${allDecls.length}`);
  }
});

test('loadAndRenderDate clears the calendar loading state unconditionally, and only publishes local fetch results to the shared vars after the activePerson guard', () => {
  const fnBody = extractFunctionBody(bookingJs, /async function loadAndRenderDate\(dateStr, dayEl = null, opts = \{\}\) \{/);
  assert.ok(fnBody, 'expected to find loadAndRenderDate()');

  const idxCacheBuild = fnBody.indexOf('personAvailabilityCache[forPerson] = {');
  // Anchored on `selectedEl.classList.remove(...)` specifically (not the earlier
  // `dayEls.forEach(d => d.classList.remove('loading'))` at the top of the function,
  // which clears loading off *all* calendar days before the fetch even starts and is
  // unrelated to this guard-ordering check).
  const idxLoadingClear = fnBody.indexOf("selectedEl.classList.remove('loading')");
  const idxGuard = fnBody.indexOf('if (state.activePerson !== forPerson) return;', idxLoadingClear);
  const idxPublish = fnBody.indexOf('mokaAvailableSlots = localMokaSlots;');

  assert.ok(idxCacheBuild !== -1, 'expected the per-person cache write');
  assert.ok(idxLoadingClear !== -1, 'expected the calendar day loading-class removal');
  assert.ok(idxGuard !== -1, 'expected an activePerson guard after the loading-class removal');
  assert.ok(idxPublish !== -1, 'expected the local-to-shared publish step');

  // Order matters: cache is built from locals unconditionally, then the loading
  // shimmer is cleared unconditionally (so it never gets stuck on a cache-hit tab
  // switch), and only after that does the activePerson guard gate the publish of
  // locals into the live module-scope vars.
  assert.ok(idxCacheBuild < idxLoadingClear, 'cache build must happen before the loading-class removal');
  assert.ok(idxLoadingClear < idxGuard, 'loading-class removal must happen before the activePerson guard, not after');
  assert.ok(idxGuard < idxPublish, 'the module-scope var publish must happen after the activePerson guard');
});

test('switchTimeGridToActivePerson exists and reuses cache before re-fetching', () => {
  const fnBody = extractFunctionBody(bookingJs, /function switchTimeGridToActivePerson\(\)\s*\{/);
  assert.ok(fnBody, 'expected to find switchTimeGridToActivePerson()');
  assert.match(fnBody, /personAvailabilityCache\[state\.activePerson\]/);
  assert.match(fnBody, /loadAndRenderDate\(/);
});

test('the person-tabs click handler re-renders the time grid when switching tabs on the time step', () => {
  // Anchored on the click callback itself (not the outer `.forEach(tabs => {`
  // wrapper), because that wrapper text also appears verbatim in
  // refreshPersonTabs() earlier in the file — matching the outer wrapper
  // would silently extract the wrong function body.
  const listenerBody = extractFunctionBody(bookingJs, /tabs\.addEventListener\('click', e => \{/);
  assert.ok(listenerBody, 'expected to find the person-tabs click wiring');
  assert.match(listenerBody, /personTabsTime/);
  assert.match(listenerBody, /switchTimeGridToActivePerson/);
});

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
