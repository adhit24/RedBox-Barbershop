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
